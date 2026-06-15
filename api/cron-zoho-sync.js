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
        if (item.show_in_storefront !== true && item.show_in_storefront !== 'true') continue;
        const stock = item.actual_available_stock ?? item.available_stock ?? item.stock_on_hand ?? 0;
        if (Number(stock) > 0) ids.push(String(item.item_id));
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

    // Zoho returns a ZIP file containing all gallery images
    if (ct.includes('application/zip')) {
      try {
        const buffer = Buffer.from(await listRes.arrayBuffer());
        const zip = await JSZip.loadAsync(buffer);
        const imageFiles = Object.values(zip.files)
          .filter(f => !f.dir && /\.(jpe?g|png|webp|gif)$/i.test(f.name))
          .sort((a, b) => a.name.localeCompare(b.name));

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
        console.log(`Item ${itemId}: ${imageFiles.length} images in ZIP, uploaded ${uploaded}`);
      } catch (e) { console.error(`ZIP extract error for ${itemId}:`, e); }
      return uploaded;
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

    const liveItems = recentItems.filter(item => {
      if (item.show_in_storefront !== true && item.show_in_storefront !== 'true') return false;
      const stock = item.actual_available_stock ?? item.available_stock ?? item.stock_on_hand ?? 0;
      return Number(stock) > 0;
    });

    const offItems = recentItems.filter(item => {
      if (item.show_in_storefront !== true && item.show_in_storefront !== 'true') return true;
      const stock = item.actual_available_stock ?? item.available_stock ?? item.stock_on_hand ?? 0;
      return Number(stock) <= 0;
    });

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

    // 12-hour reconciliation: find items missing from DB or stuck as sold, and fix them
    try {
      const { data: logRow } = await supabase.from('sync_log').select('result').eq('key', 'sync_zoho_reconcile').single();
      const lastReconcile = logRow?.result?.last_reconcile_at ? new Date(logRow.result.last_reconcile_at) : null;
      const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
      if (!lastReconcile || lastReconcile < twelveHoursAgo) {
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
            const toInsert = allFull.filter(item => {
              if (!missingSet.has(String(item.item_id))) return false;
              if (item.show_in_storefront !== true && item.show_in_storefront !== 'true') return false;
              const stock = item.actual_available_stock ?? item.available_stock ?? item.stock_on_hand ?? 0;
              return Number(stock) > 0;
            }).map(mapZohoItem);
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
