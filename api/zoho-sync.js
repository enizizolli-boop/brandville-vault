import { createClient } from '@supabase/supabase-js';
import JSZip from 'jszip';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const STORE_DOMAIN = 'thewatchstore.zohocommerce.eu';
const STORE_ID = 'e332ab1967';

async function parseJsonSafe(res, context) {
  const text = await res.text();
  if (!text) throw new Error(`${context} returned empty body (status ${res.status})`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${context} returned non-JSON (status ${res.status}): ${text.slice(0, 200)}`);
  }
}

async function getAccessToken() {
  // Cache token in sync_log for 50 min (Zoho tokens last 1h) to avoid
  // hitting the auth endpoint on every batch call.
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
  const data = await parseJsonSafe(res, 'Zoho OAuth token');
  if (!data.access_token) throw new Error('Failed to get access token: ' + JSON.stringify(data));

  await supabase.from('sync_log').upsert(
    { key: 'zoho_access_token', last_sync_at: new Date().toISOString(), result: { token: data.access_token } },
    { onConflict: 'key' }
  );
  return data.access_token;
}

async function fetchAllItems(accessToken) {
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
      const data = await parseJsonSafe(res, `Zoho inventory items page ${page}`);
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

// The List API's available_stock never reflects Sales Order commitments. The
// authoritative field, available_for_sale_stock, only exists on the per-item
// Detail endpoint (verified directly against Zoho — confirmed via OAuth scope
// fix). Checking every item via Detail doesn't scale for the full catalog, but
// it's cheap for the handful of items actually being written in one batch.
// Returns null on failure — caller should fail open (treat as available)
// rather than risk wrongly hiding an item over a transient API error.
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
      return null;
    }
    const data = await res.json();
    const val = data?.item?.available_for_sale_stock;
    if (val === undefined) console.error(`fetchAvailableForSale: ${itemId} response missing available_for_sale_stock`);
    return val === undefined ? null : Number(val);
  } catch (e) {
    console.error(`fetchAvailableForSale failed for ${itemId}:`, e.message);
    return null;
  }
}

// Cache Zoho items in sync_log for 10 minutes so each batch call in a sync session
// reuses the same snapshot instead of re-fetching all pages from Zoho every time.
async function getAllItemsCached(accessToken, forceRefresh = false) {
  if (!forceRefresh) {
    const CACHE_TTL_MS = 10 * 60 * 1000;
    const { data: cached } = await supabase
      .from('sync_log')
      .select('result, last_sync_at')
      .eq('key', 'zoho_items_cache')
      .single();

    if (cached?.result?.items && cached.last_sync_at) {
      const ageMs = Date.now() - new Date(cached.last_sync_at).getTime();
      if (ageMs < CACHE_TTL_MS) return cached.result.items;
    }
  }

  const items = await fetchAllItems(accessToken);
  await supabase.from('sync_log').upsert(
    { key: 'zoho_items_cache', last_sync_at: new Date().toISOString(), result: { items } },
    { onConflict: 'key' }
  );
  return items;
}

function withTimeout(ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(timer) };
}

async function fetchAndUploadZohoImages(accessToken, zohoItem, productId) {
  const itemId = zohoItem.item_id;

  // Returns null if rate limited even after retry; otherwise returns the fetch Response
  async function fetchGallery() {
    const t1 = withTimeout(8000);
    let res;
    try {
      res = await fetch(
        `https://www.zohoapis.eu/inventory/v1/items/${itemId}/images?organization_id=${process.env.ZOHO_ORG_ID}`,
        { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }, signal: t1.signal }
      );
    } finally { t1.clear(); }
    if (res.status !== 429) return res;
    console.log(`[img] ${itemId}: gallery rate limited (429), waiting 5s then retrying`);
    await new Promise(r => setTimeout(r, 5000));
    const t2 = withTimeout(10000);
    try {
      res = await fetch(
        `https://www.zohoapis.eu/inventory/v1/items/${itemId}/images?organization_id=${process.env.ZOHO_ORG_ID}`,
        { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }, signal: t2.signal }
      );
    } finally { t2.clear(); }
    if (res.status === 429) {
      console.log(`[img] ${itemId}: gallery still rate limited after retry, skipping gallery`);
      return null;
    }
    return res;
  }

  try {
    const listRes = await fetchGallery();

    if (listRes !== null) {
      const ct = listRes.headers.get('content-type') || '';
      console.log(`[img] ${itemId}: gallery status=${listRes.status} ct="${ct}"`);

      // Zoho returns a ZIP. Content-type is application/zip or application/octet-stream.
      if (ct.includes('application/zip') || ct.includes('octet-stream')) {
        try {
          const buffer = Buffer.from(await listRes.arrayBuffer());
          console.log(`[img] ${itemId}: buffer size=${buffer.length}`);
          const zip = await JSZip.loadAsync(buffer);
          const allZipFiles = Object.values(zip.files);
          console.log(`[img] ${itemId}: ZIP entries=${allZipFiles.map(f => f.name + (f.dir ? '/' : '')).join(', ')}`);
          let imageFiles = allZipFiles
            .filter(f => !f.dir && /\.(jpe?g|png|webp|gif)$/i.test(f.name))
            .sort((a, b) => a.name.localeCompare(b.name));
          // Some Zoho items use extensionless filenames in the ZIP
          if (imageFiles.length === 0) {
            imageFiles = allZipFiles.filter(f => !f.dir).sort((a, b) => a.name.localeCompare(b.name));
            if (imageFiles.length > 0) console.log(`[img] ${itemId}: using extensionless fallback, ${imageFiles.length} files`);
          }
          if (imageFiles.length > 0) {
            await supabase.from('product_images').delete().eq('product_id', productId);
            let uploaded = 0;
            for (let i = 0; i < imageFiles.length; i++) {
              try {
                const imgBuffer = Buffer.from(await imageFiles[i].async('arraybuffer'));
                const path = `${productId}/zoho_${i}.jpg`;
                const { error: upErr } = await supabase.storage.from('watch-images').upload(path, imgBuffer, { contentType: 'image/jpeg', upsert: true });
                if (upErr) { console.error(`[img] ${itemId}: upload error pos ${i}:`, upErr.message); continue; }
                const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path);
                await supabase.from('product_images').insert({ product_id: productId, url: publicUrl, position: i });
                uploaded++;
              } catch (e) { console.error(`[img] ${itemId}: ZIP image ${i} error:`, e.message); }
            }
            console.log(`[img] ${itemId}: ZIP uploaded ${uploaded}/${imageFiles.length}`);
            return uploaded;
          }
          console.log(`[img] ${itemId}: ZIP has no usable files — trying primary image`);
        } catch (e) {
          if (ct.includes('application/zip')) { console.error(`[img] ${itemId}: ZIP parse error:`, e.message); return 0; }
          console.log(`[img] ${itemId}: octet-stream not a valid ZIP (${e.message}), trying primary image`);
        }
      } else {
        // JSON gallery list (body not yet consumed)
        let listData = null;
        try {
          if (ct.includes('application/json') || ct.includes('text/')) listData = await listRes.json();
        } catch { listData = null; }
        if (listData?.images && listData.images.length > 0) {
          console.log(`[img] ${itemId}: JSON gallery has ${listData.images.length} images`);
          await supabase.from('product_images').delete().eq('product_id', productId);
          let uploaded = 0;
          for (let i = 0; i < listData.images.length; i++) {
            const docId = listData.images[i].image_document_id;
            if (!docId) continue;
            try {
              const img = withTimeout(8000);
              let imgRes;
              try {
                imgRes = await fetch(
                  `https://www.zohoapis.eu/inventory/v1/items/${itemId}/image?organization_id=${process.env.ZOHO_ORG_ID}&document_id=${docId}`,
                  { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }, signal: img.signal }
                );
              } finally { img.clear(); }
              if (!imgRes.ok) { console.error(`[img] ${itemId}: JSON image ${i} fetch ${imgRes.status}`); continue; }
              const buffer = Buffer.from(await imgRes.arrayBuffer());
              const path = `${productId}/zoho_${i}.jpg`;
              const { error: upErr } = await supabase.storage.from('watch-images').upload(path, buffer, { contentType: 'image/jpeg', upsert: true });
              if (upErr) { console.error(`[img] ${itemId}: JSON image ${i} upload error:`, upErr.message); continue; }
              const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path);
              await supabase.from('product_images').insert({ product_id: productId, url: publicUrl, position: i });
              uploaded++;
            } catch (e) { console.error(`[img] ${itemId}: JSON image ${i} error:`, e.message); }
          }
          return uploaded;
        }
      }
    }

    // No gallery images (empty ZIP, rate limited, or no Other Images) —
    // fetch item detail to get image_document_id and download the primary/front image.
    console.log(`[img] ${itemId}: no gallery images, trying primary image via item detail`);
    const { count: existing } = await supabase
      .from('product_images').select('id', { count: 'exact', head: true })
      .eq('product_id', productId).like('url', '%supabase.co%');
    if (existing > 0) { console.log(`[img] ${itemId}: already has ${existing} supabase images, skipping`); return 0; }
    try {
      const detail = withTimeout(8000);
      let detailRes;
      try {
        detailRes = await fetch(
          `https://www.zohoapis.eu/inventory/v1/items/${itemId}?organization_id=${process.env.ZOHO_ORG_ID}`,
          { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }, signal: detail.signal }
        );
      } finally { detail.clear(); }
      if (!detailRes.ok) { console.error(`[img] ${itemId}: item detail fetch ${detailRes.status}`); return 0; }
      const detailData = await detailRes.json();
      const imageDocId = detailData?.item?.image_document_id;
      console.log(`[img] ${itemId}: image_document_id=${imageDocId}`);
      if (!imageDocId) return 0;
      const primary = withTimeout(8000);
      let imgRes;
      try {
        imgRes = await fetch(
          `https://www.zohoapis.eu/inventory/v1/items/${itemId}/image?organization_id=${process.env.ZOHO_ORG_ID}&document_id=${imageDocId}`,
          { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }, signal: primary.signal }
        );
      } finally { primary.clear(); }
      if (!imgRes.ok) { console.error(`[img] ${itemId}: primary image fetch ${imgRes.status}`); return 0; }
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      const path = `${productId}/zoho_0.jpg`;
      const { error: upErr } = await supabase.storage.from('watch-images').upload(path, buffer, { contentType: 'image/jpeg', upsert: true });
      if (upErr) { console.error(`[img] ${itemId}: primary image upload error:`, upErr.message); return 0; }
      const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path);
      await supabase.from('product_images').insert({ product_id: productId, url: publicUrl, position: 0 });
      console.log(`[img] ${itemId}: primary image uploaded OK`);
      return 1;
    } catch (e) { console.error(`[img] ${itemId}: primary image error:`, e.message); return 0; }
  } catch (e) {
    console.error(`[img] ${itemId}: error:`, e.message);
    return 0;
  }
}

const ALLOWED_CONDITIONS = [
  'pre-owned conditions with MINOR signs of usage',
  'pre-owned conditions with MAJOR signs of usage',
  'Fair', 'Needs Repair', 'Repaired', 'Repaired Albania',
  'Polished A', 'Polished B', 'pre-owned'
];
const ALLOWED_SCOPES = ['Watch Only', 'With Card', 'With Box', 'Card & Box'];

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
  // Check for exact matches first
  for (const condition of ALLOWED_CONDITIONS) {
    if (lower.includes(condition.toLowerCase())) return condition;
  }
  // Then check for partial matches
  if (lower.includes('minor')) return 'pre-owned conditions with MINOR signs of usage';
  if (lower.includes('major')) return 'pre-owned conditions with MAJOR signs of usage';
  if (lower.includes('albania')) return 'Repaired Albania';
  if (lower.includes('repaired')) return 'Repaired';
  if (lower.includes('repair')) return 'Needs Repair';
  if (lower.includes('fair')) return 'Fair';
  return null;
}


const WATCH_BRANDS = new Set([
  'rolex','audemars piguet','patek philippe','omega','iwc','jaeger-lecoultre',
  'breitling','tag heuer','tudor','hublot','richard mille','vacheron constantin',
  'a. lange & söhne','panerai','blancpain','breguet','zenith','grand seiko',
  'ulysse nardin','girard-perregaux','piaget','chopard','a. lange & sohne',
]);

function mapZohoItem(item) {
  const brand = (item.cf_brand || item.brand || 'Unknown').trim();
  const model = (item.cf_model || item.name || 'Unknown').trim();
  const reference = item.sku || null;
  const scopeRaw = item.cf_scope_of_delivery || null;
  const notes = item.description && item.description.trim() ? item.description.trim() : null;

  const condition = item.cf_conditions && item.cf_conditions.trim() ? item.cf_conditions.trim() : 'Pre-owned';

  // Zoho items are always Watches — Jewellery comes exclusively from Odoo
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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { test_mode = false, batch_size = 5, offset = 0 } = req.body || {};

  try {
    const accessToken = await getAccessToken();
    // Force fresh fetch on first batch so new/updated items are never missed
    const allItems = await getAllItemsCached(accessToken, offset === 0);

    // Safety guard — if Zoho returns nothing, abort rather than wiping the DB
    if (!allItems || allItems.length === 0) {
      return res.status(200).json({ success: false, error: 'Zoho returned 0 items — aborting to prevent accidental deletion', removed: 0 });
    }

    // Cheap pre-filter using the List API (cf_stage + available_stock). This does NOT
    // reflect Sales Order commitments — that's checked per-item below via the Detail
    // API's available_for_sale_stock, which is the authoritative field but only exists
    // on the per-item Detail endpoint, not the bulk List endpoint (verified directly).
    const isLive = item => (item.cf_stage || '') === 'Per oferte' && Number(item.available_stock ?? 0) >= 1;
    let zohoItems = allItems.filter(isLive);
    const totalOnStore = zohoItems.length;

    if (test_mode) {
      const withImage = zohoItems.find(i => i.image_document_id);
      zohoItems = withImage ? [withImage] : [zohoItems[0]];
    } else {
      zohoItems = zohoItems.slice(offset, offset + batch_size);
    }

    const zohoIds = zohoItems.map(i => String(i.item_id));

    const { data: existingItems } = await supabase
      .from('products')
      .select('id, zoho_item_id')
      .eq('source', 'zoho')
      .in('zoho_item_id', zohoIds);

    const existingZohoIds = (existingItems || []).map(i => i.zoho_item_id);
    const existingMap = {};
    (existingItems || []).forEach(i => { existingMap[i.zoho_item_id] = i.id; });

    // Find which existing products already have a full gallery of Supabase-hosted images.
    // Products with only scraped (non-Supabase) URLs, or just a single leftover image
    // (e.g. from the old primary-image-only fallback), are treated as imageless so the
    // full gallery gets (re-)fetched.
    const existingProductIds = (existingItems || []).map(i => i.id);
    let productsWithImages = new Set();
    if (existingProductIds.length > 0) {
      const { data: imgRows } = await supabase
        .from('product_images').select('product_id, url').in('product_id', existingProductIds);
      const supabaseImageCounts = new Map();
      (imgRows || []).forEach(r => {
        if (r.url && r.url.includes('supabase.co')) {
          supabaseImageCounts.set(r.product_id, (supabaseImageCounts.get(r.product_id) || 0) + 1);
        }
      });
      supabaseImageCounts.forEach((count, productId) => {
        if (count >= 2) productsWithImages.add(productId);
      });
      // Delete any bad (non-Supabase) image rows so they don't persist
      const badRows = (imgRows || []).filter(r => !r.url || !r.url.includes('supabase.co'));
      if (badRows.length > 0) {
        const badIds = [...new Set(badRows.map(r => r.product_id))];
        await supabase.from('product_images').delete()
          .in('product_id', badIds)
          .not('url', 'like', '%supabase.co%');
      }
    }

    // Remove stale items on first batch only (out of stock or removed from storefront)
    let removed = 0;
    if (offset === 0) {
      const { data: allExisting } = await supabase
        .from('products').select('zoho_item_id').eq('source', 'zoho');
      const allExistingIds = (allExisting || []).map(i => i.zoho_item_id);
      const liveZohoIds = allItems.filter(isLive).map(i => String(i.item_id));
      // Safety guards: abort if Zoho returned suspiciously few TOTAL items vs DB,
      // OR if the live-filter itself collapsed (e.g. a field-name bug) and would
      // wipe out most of the catalog. Both are signs of a broken response/filter,
      // not a real mass removal.
      const minExpected = Math.ceil(allExistingIds.length * 0.5);
      const minLiveExpected = Math.ceil(allExistingIds.length * 0.3);
      if (allItems.length < minExpected) {
        console.error(`Stale cleanup aborted: Zoho returned only ${allItems.length} total items but DB has ${allExistingIds.length} — looks like a partial API response`);
      } else if (allExistingIds.length > 20 && liveZohoIds.length < minLiveExpected) {
        console.error(`Stale cleanup aborted: live-filter matched only ${liveZohoIds.length} items but DB has ${allExistingIds.length} zoho products — looks like a broken filter, not a real mass removal`);
      } else {
        const toDelete = allExistingIds.filter(id => !liveZohoIds.includes(id));
        if (toDelete.length > 0) {
          await supabase.from('products').update({ status: 'sold' }).in('zoho_item_id', toDelete).eq('source', 'zoho');
          removed = toDelete.length;
        }
      }
    }

    let added = 0;
    let updated = 0;
    let imagesAdded = 0;
    const errors = [];

    for (const zohoItem of zohoItems) {
      const mapped = mapZohoItem(zohoItem);

      // Authoritative check: does this item actually have stock free of Sales
      // Order commitments right now? available_stock (used in the pre-filter
      // above) doesn't reflect this; available_for_sale_stock does, but only
      // via the per-item Detail endpoint. null on failure means fail open
      // (leave status as 'available' from mapZohoItem rather than wrongly hide it).
      const availForSale = await fetchAvailableForSale(accessToken, zohoItem.item_id);
      if (availForSale !== null && availForSale < 1) {
        mapped.status = 'sold';
      }

      let watchId = existingMap[mapped.zoho_item_id];

      if (watchId) {
        // Already linked by zoho_item_id — update fields
        await supabase.from('products').update(mapped).eq('id', watchId);
        updated++;
      } else {
        // Fallback: find a manually-added product with the same SKU/reference
        // and backfill the zoho_item_id link on first encounter
        if (mapped.reference) {
          const { data: byRef } = await supabase
            .from('products')
            .select('id')
            .eq('reference', mapped.reference)
            .is('zoho_item_id', null)
            .maybeSingle();

          if (byRef?.id) {
            await supabase.from('products').update({ ...mapped }).eq('id', byRef.id);
            watchId = byRef.id;
            updated++;
          }
        }

        if (!watchId) {
          // Genuinely new — insert
          const { data: upserted, error } = await supabase
            .from('products')
            .upsert(mapped, { onConflict: 'zoho_item_id' })
            .select('id')
            .single();

          if (error) {
            errors.push({ item: mapped.zoho_item_id, error: error.message });
            continue;
          }
          watchId = upserted?.id;
          added++;
        }
      }

      if (watchId && !productsWithImages.has(watchId)) {
        imagesAdded += await fetchAndUploadZohoImages(accessToken, zohoItem, watchId);
        await new Promise(r => setTimeout(r, 1200));
      }
    }

    const nextOffset = offset + batch_size;
    const done = test_mode || nextOffset >= totalOnStore;

    return res.status(200).json({
      success: true,
      test_mode,
      added,
      updated,
      removed,
      images_added: imagesAdded,
      processed: zohoItems.length,
      offset,
      next_offset: done ? null : nextOffset,
      total: totalOnStore,
      done,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('Sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
