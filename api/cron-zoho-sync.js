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

async function fetchAvailableForSale(accessToken, itemId, isRetry = false) {
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
    if (res.status === 429 && !isRetry) {
      await new Promise(r => setTimeout(r, 3000));
      return fetchAvailableForSale(accessToken, itemId, true);
    }
    if (!res.ok) {
      console.error(`fetchAvailableForSale: ${itemId} returned HTTP ${res.status}`);
      return { availForSale: null, readyToShip: false };
    }
    const data = await res.json();
    const val = data?.item?.available_for_sale_stock;
    if (val === undefined) console.error(`fetchAvailableForSale: ${itemId} response missing available_for_sale_stock`);
    const warehouses = data?.item?.warehouses || [];
    const nikoBG = warehouses.find(w => w.warehouse_name === 'Niko BG');
    const readyToShip = nikoBG ? Number(nikoBG.warehouse_available_for_sale_stock) > 0 : false;
    return { availForSale: val === undefined ? null : Number(val), readyToShip };
  } catch (e) {
    console.error(`fetchAvailableForSale failed for ${itemId}:`, e.message);
    return { availForSale: null, readyToShip: false };
  }
}

async function fetchAllActiveItems(accessToken) {
  let items = [];
  let page = 1;
  const perPage = 200;
  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const url = `https://www.zohoapis.eu/inventory/v1/items?organization_id=${process.env.ZOHO_ORG_ID}&per_page=${perPage}&page=${page}&status=active`;
      const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }, signal: controller.signal });
      clearTimeout(timer);
      const data = await res.json();
      if (!data.items || data.items.length === 0) break;
      items = items.concat(data.items);
      if (data.items.length < perPage) break;
      page++;
    } catch (e) {
      clearTimeout(timer);
      throw new Error(`Zoho fetch failed on page ${page}: ${e.message}`);
    }
  }
  return items;
}

// Sync gallery images for an item.
// forceRefresh=true: replace all existing images, but ONLY after confirming we
// have new ones to replace them with. Never delete first — a 429 or timeout
// after an upfront delete leaves the item with zero images on a live site.
async function syncGalleryImages(accessToken, itemId, productId, forceRefresh = false) {
  try {
    const { data: existingImgs } = await supabase
      .from('product_images').select('position').eq('product_id', productId);
    // For forceRefresh: treat all positions as empty so we upload all images fresh.
    // The actual DB delete happens below, only after we've confirmed we have images.
    const existingPositions = forceRefresh
      ? new Set()
      : new Set((existingImgs || []).map(r => r.position));

    const listRes = await fetch(
      `https://www.zohoapis.eu/inventory/v1/items/${itemId}/images?organization_id=${process.env.ZOHO_ORG_ID}`,
      { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
    );

    if (listRes.status === 429) {
      console.log(`Gallery rate limited (429) for item ${itemId} — keeping existing images`);
      return 0;
    }

    const ct = listRes.headers.get('content-type') || '';
    let uploaded = 0;

    if (ct.includes('application/zip') || ct.includes('octet-stream')) {
      try {
        const buffer = Buffer.from(await listRes.arrayBuffer());
        const zip = await JSZip.loadAsync(buffer);
        let imageFiles = Object.values(zip.files)
          .filter(f => !f.dir && /\.(jpe?g|png|webp|gif)$/i.test(f.name))
          .sort((a, b) => a.name.localeCompare(b.name));
        if (imageFiles.length === 0) {
          imageFiles = Object.values(zip.files).filter(f => !f.dir).sort((a, b) => a.name.localeCompare(b.name));
        }
        if (imageFiles.length > 0) {
          // We have replacement images — safe to clear old records now
          if (forceRefresh) await supabase.from('product_images').delete().eq('product_id', productId);
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
      } catch (e) {
        if (ct.includes('application/zip')) { console.error(`ZIP extract error for ${itemId}:`, e); return 0; }
      }
    }

    let listData = null;
    try {
      if (ct.includes('application/json') || ct.includes('text/')) listData = await listRes.json();
    } catch { listData = null; }

    if (listData?.images?.length > 0) {
      if (forceRefresh) await supabase.from('product_images').delete().eq('product_id', productId);
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
          const buf = Buffer.from(await imgRes.arrayBuffer());
          const path = `${productId}/zoho_${i}.jpg`;
          const { error: upErr } = await supabase.storage.from('watch-images').upload(path, buf, { contentType: 'image/jpeg', upsert: true });
          if (upErr) continue;
          const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path);
          await supabase.from('product_images').insert({ product_id: productId, url: publicUrl, position: i });
          uploaded++;
        } catch (e) { console.error(`Gallery image ${i} error for ${itemId}:`, e); }
      }
      return uploaded;
    }

    // No gallery images — try Front View via image_document_id
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
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const path = `${productId}/zoho_0.jpg`;
      const { error: upErr } = await supabase.storage.from('watch-images').upload(path, buf, { contentType: 'image/jpeg', upsert: true });
      if (upErr) return 0;
      const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path);
      await supabase.from('product_images').insert({ product_id: productId, url: publicUrl, position: 0 });
      return 1;
    } catch (e) { console.error(`Primary image fallback error for ${itemId}:`, e); return 0; }
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

    // Full catalog every tick (not just "recently modified") so Sales Order
    // commitments get caught even on items nothing else has touched recently —
    // confirming an order does NOT update last_modified_time on the item.
    const allItems = await fetchAllActiveItems(accessToken);
    if (!allItems || allItems.length === 0) {
      throw new Error('Zoho returned 0 items — aborting to avoid wiping the catalog');
    }

    const candidates = allItems.filter(isLiveItem);

    // The authoritative per-item commitment check is the expensive part (~150-200
    // extra API calls). Running it every 30-min tick was ~15k calls/day, half the
    // daily quota. So it only runs once an hour; every tick reuses the cached
    // result in between, so a fast cheap-check tick can't undo a commitment
    // exclusion the last hourly check found.
    const { data: commLog } = await supabase.from('sync_log').select('result, last_sync_at').eq('key', 'zoho_committed_ids_cache').single();
    const commAge = commLog?.last_sync_at ? Date.now() - new Date(commLog.last_sync_at).getTime() : Infinity;
    let committedIds;
    const readyToShipMap = new Map();
    let commitmentCheckRefreshed = false;
    if (commAge < 6 * 60 * 60 * 1000 && commLog?.result?.ids) {
      committedIds = new Set(commLog.result.ids);
    } else {
      committedIds = new Set();
      let nullResults = 0;
      for (const item of candidates) {
        const { availForSale, readyToShip } = await fetchAvailableForSale(accessToken, item.item_id);
        if (availForSale === null) nullResults++;
        else if (availForSale < 1) committedIds.add(String(item.item_id));
        readyToShipMap.set(String(item.item_id), readyToShip);
        await new Promise(r => setTimeout(r, 250));
      }
      if (nullResults > 0) console.error(`Commitment check: ${nullResults}/${candidates.length} items returned null (failed/missing field)`);
      commitmentCheckRefreshed = true;
      await supabase.from('sync_log').upsert(
        { key: 'zoho_committed_ids_cache', last_sync_at: new Date().toISOString(), result: { ids: [...committedIds] } },
        { onConflict: 'key' }
      );
    }

    const liveItems = candidates.filter(item => !committedIds.has(String(item.item_id)));
    const liveZohoIds = liveItems.map(i => String(i.item_id));

    // Stale cleanup with the same safety guards as the manual sync: abort if
    // Zoho returned suspiciously few items, or if the live set collapsed
    // relative to what's in the DB — signs of a broken response/filter, not
    // a real mass removal (this is what caused the incident last time).
    const { data: allExisting } = await supabase.from('products').select('zoho_item_id').eq('source', 'zoho');
    const allExistingIds = (allExisting || []).map(r => r.zoho_item_id);
    const minExpected = Math.ceil(allExistingIds.length * 0.5);
    const minLiveExpected = Math.ceil(allExistingIds.length * 0.3);
    let markedSold = 0;
    if (allItems.length < minExpected) {
      console.error(`Stale cleanup aborted: Zoho returned only ${allItems.length} total items but DB has ${allExistingIds.length}`);
    } else if (allExistingIds.length > 20 && liveZohoIds.length < minLiveExpected) {
      console.error(`Stale cleanup aborted: live set is only ${liveZohoIds.length} but DB has ${allExistingIds.length} zoho products`);
    } else {
      const toMarkSold = allExistingIds.filter(id => !liveZohoIds.includes(id));
      if (toMarkSold.length > 0) {
        await supabase.from('products').update({ status: 'sold' }).in('zoho_item_id', toMarkSold).eq('source', 'zoho');
        markedSold = toMarkSold.length;
      }
    }

    // Upsert covers both new items (insert) and existing ones (update) in one go.
    let upserted = 0;
    let imagesAdded = 0;
    if (liveItems.length > 0) {
      const liveIds = liveZohoIds;

      const { data: soldBefore } = await supabase
        .from('products').select('zoho_item_id').in('zoho_item_id', liveIds).eq('source', 'zoho').eq('status', 'sold');
      const reactivatedIds = new Set((soldBefore || []).map(r => r.zoho_item_id));

      const { data: reservedRows } = await supabase
        .from('products').select('zoho_item_id').in('zoho_item_id', liveIds).eq('source', 'zoho').eq('status', 'reserved');
      const reservedIds = new Set((reservedRows || []).map(r => r.zoho_item_id));

      const rows = liveItems.map(item => {
        const mapped = mapZohoItem(item);
        const itemId = String(item.item_id);
        if (readyToShipMap.has(itemId)) mapped.ready_to_ship = readyToShipMap.get(itemId);
        return mapped;
      });
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

    // Secondary pass: backfill up to 3 available items with no images per cron run
    try {
      const { data: imgCandidates } = await supabase
        .from('products').select('id, zoho_item_id').eq('source', 'zoho').eq('status', 'available').limit(50);
      if (imgCandidates && imgCandidates.length > 0) {
        const { data: imgCheck } = await supabase
          .from('product_images').select('product_id').in('product_id', imgCandidates.map(r => r.id));
        const withImgSet = new Set((imgCheck || []).map(r => r.product_id));
        const toFill = imgCandidates.filter(r => !withImgSet.has(r.id)).slice(0, 3);
        for (const row of toFill) {
          imagesAdded += await syncGalleryImages(accessToken, row.zoho_item_id, row.id, false);
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    } catch (e) { console.error('Secondary image pass error:', e); }

    await supabase.from('sync_log').upsert({
      key: 'sync_zoho',
      last_sync_at: new Date().toISOString(),
      result: {
        status: 'done', upserted, marked_sold: markedSold,
        total_candidates: candidates.length, committed_ids: committedIds.size,
        commitment_check_refreshed: commitmentCheckRefreshed, images_added: imagesAdded,
      },
    });

    return res.status(200).json({
      success: true,
      upserted,
      marked_sold: markedSold,
      total_candidates: candidates.length,
      committed_ids: committedIds.size,
      commitment_check_refreshed: commitmentCheckRefreshed,
      images_added: imagesAdded,
    });
  } catch (err) {
    console.error('Cron Zoho sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
