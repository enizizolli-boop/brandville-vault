import { createClient } from '@supabase/supabase-js';
import JSZip from 'jszip';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getAccessToken() {
  const TOKEN_TTL_MS = 50 * 60 * 1000;
  const { data: cached } = await supabase
    .from('sync_log')
    .select('result, last_sync_at')
    .eq('key', 'zoho_access_token')
    .single();

  if (cached?.result?.token && cached.last_sync_at) {
    const ageMs = Date.now() - new Date(cached.last_sync_at).getTime();
    if (ageMs < TOKEN_TTL_MS) return cached.result.token;
  }

  const res = await fetch('https://accounts.zoho.eu/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: process.env.ZOHO_REFRESH_TOKEN,
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get access token: ' + JSON.stringify(data));

  await supabase.from('sync_log').upsert(
    { key: 'zoho_access_token', last_sync_at: new Date().toISOString(), result: { token: data.access_token } },
    { onConflict: 'key' }
  );
  return data.access_token;
}

// Cheap pre-filter using the List API. Does NOT reflect Sales Order commitments —
// the authoritative field, available_for_sale_stock, only exists on the per-item
// Detail endpoint (verified directly against Zoho). See fetchAvailableForSale,
// used per-item for the small set actually being written, not the whole catalog.
function isLiveItem(item) {
  return (item.cf_stage || '') === 'Per oferte' && Number(item.available_stock ?? 0) >= 1;
}

async function fetchAvailableForSale(accessToken, itemId) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let res;
    try {
      res = await fetch(
        `https://www.zohoapis.eu/inventory/v1/items/${itemId}?organization_id=${process.env.ZOHO_ORG_ID}`,
        { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }, signal: controller.signal }
      );
    } finally { clearTimeout(timer); }
    if (!res.ok) return null;
    const data = await res.json();
    const val = data?.item?.available_for_sale_stock;
    return val === undefined ? null : Number(val);
  } catch (e) {
    console.error(`fetchAvailableForSale failed for ${itemId}:`, e.message);
    return null;
  }
}

async function fetchAllLiveIds(accessToken) {
  let ids = [];
  let page = 1;
  const perPage = 200;
  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const url = `https://www.zohoapis.eu/inventory/v1/items?organization_id=${process.env.ZOHO_ORG_ID}&per_page=${perPage}&page=${page}&status=active`;
      const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }, signal: controller.signal });
      clearTimeout(timer);
      const data = await res.json();
      if (!data.items || data.items.length === 0) break;
      for (const item of data.items) {
        if (isLiveItem(item)) ids.push(String(item.item_id));
      }
      if (data.items.length < perPage) break;
      page++;
    } catch {
      clearTimeout(timer);
      return null;
    }
  }
  return ids;
}

async function fetchRecentItems(accessToken, sinceMinutes = 35) {
  const since = new Date(Date.now() - sinceMinutes * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  const dateStr = `${since.getFullYear()}-${pad(since.getMonth()+1)}-${pad(since.getDate())} ${pad(since.getHours())}:${pad(since.getMinutes())}:${pad(since.getSeconds())}`;

  let items = [];
  let page = 1;
  const perPage = 200;
  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const url = `https://www.zohoapis.eu/inventory/v1/items?organization_id=${process.env.ZOHO_ORG_ID}&per_page=${perPage}&page=${page}&status=active&last_modified_time=${encodeURIComponent(dateStr)}`;
      const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }, signal: controller.signal });
      clearTimeout(timer);
      const data = await res.json();
      if (!data.items || data.items.length === 0) break;
      items = items.concat(data.items);
      if (data.items.length < perPage) break;
      page++;
    } catch {
      clearTimeout(timer);
      break;
    }
  }
  return items;
}

// Sync all gallery images for an item. Handles both ZIP and JSON responses from Zoho.
// forceRefresh=true deletes existing images first (used for re-activated items).
async function syncGalleryImages(accessToken, itemId, productId, forceRefresh = false) {
  try {
    if (forceRefresh) {
      await supabase.from('product_images').delete().eq('product_id', productId);
    }

    const { data: existingImgs } = await supabase
      .from('product_images').select('position').eq('product_id', productId);
    const existingPositions = new Set((existingImgs || []).map(r => r.position));

    const listRes = await fetch(
      `https://www.zohoapis.eu/inventory/v1/items/${itemId}/images?organization_id=${process.env.ZOHO_ORG_ID}`,
      { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
    );

    if (listRes.status === 429) {
      console.log(`Gallery rate limited (429) for item ${itemId}`);
      return 0;
    }

    const ct = listRes.headers.get('content-type') || '';
    let uploaded = 0;

    // Zoho returns a ZIP. Content-type is application/zip or application/octet-stream.
    if (ct.includes('application/zip') || ct.includes('octet-stream')) {
      try {
        const buffer = Buffer.from(await listRes.arrayBuffer());
        const zip = await JSZip.loadAsync(buffer);
        let imageFiles = Object.values(zip.files)
          .filter(f => !f.dir && /\.(jpe?g|png|webp|gif)$/i.test(f.name))
          .sort((a, b) => a.name.localeCompare(b.name));
        // Some Zoho items use extensionless filenames in the ZIP — fall back to all files
        if (imageFiles.length === 0) {
          imageFiles = Object.values(zip.files).filter(f => !f.dir).sort((a, b) => a.name.localeCompare(b.name));
        }

        if (imageFiles.length > 0) {
          for (let i = 0; i < imageFiles.length; i++) {
            if (existingPositions.has(i)) continue;
            try {
              const imgBuffer = Buffer.from(await imageFiles[i].async('arraybuffer'));
              const path = `${productId}/zoho_${i}.jpg`;
              const { error: upErr } = await supabase.storage.from('watch-images').upload(path, imgBuffer, { contentType: 'image/jpeg', upsert: true });
              if (upErr) continue;
              const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path);
              await supabase.from('product_images').insert({ product_id: productId, url: publicUrl, position: i });
              uploaded++;
            } catch (e) { console.error(`ZIP image ${i} error for ${itemId}:`, e); }
          }
          return uploaded;
        }
        // ZIP empty — fall through to primary image fallback
      } catch (e) {
        if (ct.includes('application/zip')) { console.error(`ZIP extract error for ${itemId}:`, e); return 0; }
        // octet-stream that isn't a valid ZIP — fall through
      }
    }

    // JSON gallery list
    let listData = null;
    try {
      if (ct.includes('application/json') || ct.includes('text/')) listData = await listRes.json();
    } catch { listData = null; }

    if (listData?.images?.length > 0) {
      for (let i = 0; i < listData.images.length; i++) {
        if (existingPositions.has(i)) continue;
        const docId = listData.images[i].image_document_id;
        if (!docId) continue;
        try {
          const imgRes = await fetch(
            `https://www.zohoapis.eu/inventory/v1/items/${itemId}/image?organization_id=${process.env.ZOHO_ORG_ID}&document_id=${docId}`,
            { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
          );
          if (!imgRes.ok) continue;
          const buffer = Buffer.from(await imgRes.arrayBuffer());
          const path = `${productId}/zoho_${i}.jpg`;
          const { error: upErr } = await supabase.storage.from('watch-images').upload(path, buffer, { contentType: 'image/jpeg', upsert: true });
          if (upErr) continue;
          const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path);
          await supabase.from('product_images').insert({ product_id: productId, url: publicUrl, position: i });
          uploaded++;
        } catch (e) { console.error(`Gallery image ${i} error for ${itemId}:`, e); }
      }
      return uploaded;
    }

    // No gallery — fetch item detail to get image_document_id for the Front View
    if (existingPositions.size > 0) return 0;
    try {
      const detailRes = await fetch(
        `https://www.zohoapis.eu/inventory/v1/items/${itemId}?organization_id=${process.env.ZOHO_ORG_ID}`,
        { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
      );
      if (!detailRes.ok) return 0;
      const detailData = await detailRes.json();
      const imageDocId = detailData?.item?.image_document_id;
      if (!imageDocId) return 0;
      const imgRes = await fetch(
        `https://www.zohoapis.eu/inventory/v1/items/${itemId}/image?organization_id=${process.env.ZOHO_ORG_ID}&document_id=${imageDocId}`,
        { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
      );
      if (!imgRes.ok) return 0;
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      const path = `${productId}/zoho_0.jpg`;
      const { error: upErr } = await supabase.storage.from('watch-images').upload(path, buffer, { contentType: 'image/jpeg', upsert: true });
      if (upErr) return 0;
      const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path);
      await supabase.from('product_images').insert({ product_id: productId, url: publicUrl, position: 0 });
      return 1;
    } catch (e) { console.error(`Primary image fallback error for ${itemId}:`, e); return 0; }

    return 0;
  } catch (e) {
    console.error(`syncGalleryImages error for ${itemId}:`, e);
    return 0;
  }
}

const ALLOWED_SCOPES = ['Watch Only', 'With Card', 'With Box', 'Card & Box'];

const ALLOWED_CONDITIONS = [
  'pre-owned conditions with MINOR signs of usage',
  'pre-owned conditions with MAJOR signs of usage',
  'Fair', 'Needs Repair', 'Repaired', 'Repaired Albania',
  'Polished A', 'Polished B',
];

function mapCondition(raw) {
  if (!raw) return 'Fair';
  if (ALLOWED_CONDITIONS.includes(raw)) return raw;
  const lower = raw.toLowerCase();
  if (lower.includes('minor')) return 'pre-owned conditions with MINOR signs of usage';
  if (lower.includes('major')) return 'pre-owned conditions with MAJOR signs of usage';
  if (lower.includes('albania')) return 'Repaired Albania';
  if (lower.includes('repaired')) return 'Repaired';
  if (lower.includes('repair')) return 'Needs Repair';
  if (lower.includes('polished a')) return 'Polished A';
  if (lower.includes('polished b')) return 'Polished B';
  if (lower.includes('polish')) return 'Polished A';
  return 'Fair';
}

function extractConditionFromText(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const condition of ALLOWED_CONDITIONS) {
    if (lower.includes(condition.toLowerCase())) return condition;
  }
  if (lower.includes('minor')) return 'pre-owned conditions with MINOR signs of usage';
  if (lower.includes('major')) return 'pre-owned conditions with MAJOR signs of usage';
  if (lower.includes('albania')) return 'Repaired Albania';
  if (lower.includes('repaired')) return 'Repaired';
  if (lower.includes('repair')) return 'Needs Repair';
  if (lower.includes('fair')) return 'Fair';
  return null;
}

function mapZohoItem(item) {
  const brand = (item.cf_brand || item.brand || 'Unknown').trim();
  const model = (item.cf_model || item.name || 'Unknown').trim();
  const reference = item.sku || null;
  const scopeRaw = item.cf_scope_of_delivery || null;
  const notes = item.description && item.description.trim() ? item.description.trim() : null;
  const condition = item.cf_conditions && item.cf_conditions.trim() ? item.cf_conditions.trim() : 'Pre-owned';

  return {
    zoho_item_id: String(item.item_id),
    source: 'zoho',
    brand,
    model,
    reference,
    price_eur: item.rate || null,
    condition,
    subcategory: null,
    scope_of_delivery: ALLOWED_SCOPES.includes(scopeRaw) ? scopeRaw : null,
    status: 'available',
    category: 'Watches',
    notes,
  };
}

export default async function handler(req, res) {
  try {
    await supabase.from('sync_log').upsert({
      key: 'sync_zoho',
      last_sync_at: new Date().toISOString(),
      result: { status: 'running' },
    });

    const accessToken = await getAccessToken();

    const recentItems = await fetchRecentItems(accessToken, 35);

    const stageStockLive = recentItems.filter(isLiveItem);
    let offItems = recentItems.filter(item => !isLiveItem(item));

    // Authoritative per-item check: stage+stock passing doesn't mean the item is
    // actually free of Sales Order commitments. recentItems is a small, bounded
    // set (items modified in the last 35 min), so a per-item Detail check here
    // is cheap — unlike checking the whole catalog.
    const liveItems = [];
    for (const item of stageStockLive) {
      const availForSale = await fetchAvailableForSale(accessToken, item.item_id);
      if (availForSale !== null && availForSale < 1) {
        offItems.push(item);
      } else {
        liveItems.push(item);
      }
    }

    if (offItems.length > 0) {
      const offIds = offItems.map(i => String(i.item_id));
      await supabase.from('products').update({ status: 'sold' }).in('zoho_item_id', offIds).eq('source', 'zoho');
    }

    let upserted = 0;
    let imagesAdded = 0;
    if (liveItems.length > 0) {
      const liveIds = liveItems.map(i => String(i.item_id));

      // Track which items were sold before upsert — these just got re-activated and need fresh images
      const { data: soldBefore } = await supabase
        .from('products')
        .select('zoho_item_id')
        .in('zoho_item_id', liveIds)
        .eq('source', 'zoho')
        .eq('status', 'sold');
      const reactivatedIds = new Set((soldBefore || []).map(r => r.zoho_item_id));

      // Preserve reserved status across upsert
      const { data: reservedRows } = await supabase
        .from('products')
        .select('zoho_item_id')
        .in('zoho_item_id', liveIds)
        .eq('source', 'zoho')
        .eq('status', 'reserved');
      const reservedIds = new Set((reservedRows || []).map(r => r.zoho_item_id));

      const rows = liveItems.map(mapZohoItem);
      const { data: upsertedRows } = await supabase
        .from('products')
        .upsert(rows, { onConflict: 'zoho_item_id' })
        .select('id, zoho_item_id');
      upserted = rows.length;

      if (reservedIds.size > 0) {
        await supabase.from('products')
          .update({ status: 'reserved' })
          .in('zoho_item_id', [...reservedIds])
          .eq('source', 'zoho');
      }

      if (upsertedRows && upsertedRows.length > 0) {
        const idMap = {};
        upsertedRows.forEach(r => { idMap[r.zoho_item_id] = r.id; });
        const upsertedProductIds = upsertedRows.map(r => r.id);

        const { data: existingImgs } = await supabase
          .from('product_images').select('product_id').in('product_id', upsertedProductIds);
        const withImages = new Set((existingImgs || []).map(r => r.product_id));

        // Re-activated items: force-refresh all gallery images (limit 3 to avoid timeout)
        const reactivatedItems = liveItems
          .filter(item => reactivatedIds.has(String(item.item_id)))
          .slice(0, 3);
        for (const item of reactivatedItems) {
          const productId = idMap[String(item.item_id)];
          if (!productId) continue;
          imagesAdded += await syncGalleryImages(accessToken, item.item_id, productId, true);
          await new Promise(r => setTimeout(r, 1500));
        }

        // New items with no images: fetch gallery
        const itemsNeedingImages = liveItems
          .filter(item => {
            const productId = idMap[String(item.item_id)];
            return productId && !withImages.has(productId) && !reactivatedIds.has(String(item.item_id));
          })
          .slice(0, 3);
        for (const item of itemsNeedingImages) {
          const productId = idMap[String(item.item_id)];
          if (!productId) continue;
          imagesAdded += await syncGalleryImages(accessToken, item.item_id, productId, false);
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    }

    // Reconciliation: find items missing from DB or stuck as sold, and fix them.
    // Does a full paginated inventory fetch, so it's gated to once every 2 hours
    // (was 12h, which left items unsynced too long; was briefly every-tick, which
    // burns far too much of the daily Zoho API quota across all orgs/items).
    try {
      const { data: logRow } = await supabase.from('sync_log').select('result').eq('key', 'sync_zoho_reconcile').single();
      const lastReconcile = logRow?.result?.last_reconcile_at ? new Date(logRow.result.last_reconcile_at) : null;
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      if (!lastReconcile || lastReconcile < twoHoursAgo) {
        const allZohoIds = await fetchAllLiveIds(accessToken);
        if (allZohoIds && allZohoIds.length > 0) {
          const { data: dbRows } = await supabase
            .from('products').select('zoho_item_id, status').eq('source', 'zoho');
          const inDb = new Set((dbRows || []).map(r => r.zoho_item_id));
          const soldInDb = new Set((dbRows || []).filter(r => r.status === 'sold').map(r => r.zoho_item_id));

          // Restore items that are live in Zoho but stuck as sold in DB
          const toRestoreIds = allZohoIds.filter(id => soldInDb.has(id));
          if (toRestoreIds.length > 0) {
            await supabase.from('products')
              .update({ status: 'available' })
              .in('zoho_item_id', toRestoreIds)
              .eq('source', 'zoho');
            console.log(`Reconciliation: restored ${toRestoreIds.length} items from sold → available`);
          }

          // Insert items that are live in Zoho but missing from DB entirely
          const missingIds = allZohoIds.filter(id => !inDb.has(id));
          if (missingIds.length > 0) {
            let allFull = [];
            let rPage = 1;
            while (true) {
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), 15000);
              try {
                const url = `https://www.zohoapis.eu/inventory/v1/items?organization_id=${process.env.ZOHO_ORG_ID}&per_page=200&page=${rPage}&status=active`;
                const rRes = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }, signal: controller.signal });
                clearTimeout(timer);
                const rData = await rRes.json();
                if (!rData.items || rData.items.length === 0) break;
                allFull = allFull.concat(rData.items);
                if (rData.items.length < 200) break;
                rPage++;
              } catch { clearTimeout(timer); break; }
            }
            const missingSet = new Set(missingIds);
            const toInsert = allFull.filter(item => missingSet.has(String(item.item_id)) && isLiveItem(item)).map(mapZohoItem);
            if (toInsert.length > 0) {
              await supabase.from('products').upsert(toInsert, { onConflict: 'zoho_item_id' });
              console.log(`Reconciliation: inserted ${toInsert.length} missing items`);
            }
          }

          await supabase.from('sync_log').upsert({
            key: 'sync_zoho_reconcile',
            last_sync_at: new Date().toISOString(),
            result: {
              last_reconcile_at: new Date().toISOString(),
              missing_added: missingIds.length,
              restored: toRestoreIds.length,
            },
          });
        }
      }
    } catch (e) { console.error('Reconciliation error:', e); }

    // Secondary pass: backfill up to 3 available items with no images per cron run
    try {
      const { data: candidates } = await supabase
        .from('products').select('id, zoho_item_id').eq('source', 'zoho').eq('status', 'available').limit(50);
      if (candidates && candidates.length > 0) {
        const { data: imgCheck } = await supabase
          .from('product_images').select('product_id').in('product_id', candidates.map(r => r.id));
        const withImgSet = new Set((imgCheck || []).map(r => r.product_id));
        const toFill = candidates.filter(r => !withImgSet.has(r.id)).slice(0, 3);
        for (const row of toFill) {
          imagesAdded += await syncGalleryImages(accessToken, row.zoho_item_id, row.id, false);
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    } catch (e) { console.error('Secondary image pass error:', e); }

    await supabase.from('sync_log').upsert({
      key: 'sync_zoho',
      last_sync_at: new Date().toISOString(),
      result: { status: 'done', upserted, marked_sold: offItems.length, total_recent: recentItems.length, images_added: imagesAdded },
    });

    return res.status(200).json({
      success: true,
      upserted,
      marked_sold: offItems.length,
      total_recent: recentItems.length,
      images_added: imagesAdded,
    });
  } catch (err) {
    console.error('Cron Zoho sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
