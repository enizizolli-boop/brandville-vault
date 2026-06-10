import { createClient } from '@supabase/supabase-js';

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

// Cache Zoho items in sync_log for 10 minutes so each batch call in a sync session
// reuses the same snapshot instead of re-fetching all pages from Zoho every time.
async function getAllItemsCached(accessToken) {
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

  const items = await fetchAllItems(accessToken);
  await supabase.from('sync_log').upsert(
    { key: 'zoho_items_cache', last_sync_at: new Date().toISOString(), result: { items } },
    { onConflict: 'key' }
  );
  return items;
}

async function fetchAndUploadZohoImages(accessToken, zohoItem, productId) {
  const itemId = zohoItem.item_id;
  try {
    // Try gallery API first
    const listRes = await fetch(
      `https://www.zohoapis.eu/inventory/v1/items/${itemId}/images?organization_id=${process.env.ZOHO_ORG_ID}`,
      { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
    );
    // Some Zoho items return binary (ZIP/PKCS) instead of JSON — guard before parsing
    let listData = null;
    try {
      const ct = listRes.headers.get('content-type') || '';
      if (ct.includes('application/json') || ct.includes('text/')) listData = await listRes.json();
    } catch { listData = null; }

    if (listData?.images && listData.images.length > 0) {
      await supabase.from('product_images').delete().eq('product_id', productId);
      let uploaded = 0;
      for (let i = 0; i < listData.images.length; i++) {
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
        } catch (e) { console.error(`Image ${i} upload error for item ${itemId}:`, e); }
      }
      return uploaded;
    }

    // Gallery API returned nothing — fall back to primary image via image_document_id
    if (!zohoItem.image_document_id) return 0;
    const { count: existing } = await supabase
      .from('product_images').select('id', { count: 'exact', head: true }).eq('product_id', productId);
    if (existing > 0) return 0; // already has image, don't overwrite
    try {
      const imgRes = await fetch(
        `https://www.zohoapis.eu/inventory/v1/items/${itemId}/image?organization_id=${process.env.ZOHO_ORG_ID}`,
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
  } catch (e) {
    console.error(`fetchAndUploadZohoImages error for ${itemId}:`, e);
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
    const allItems = await getAllItemsCached(accessToken);

    // Safety guard — if Zoho returns nothing, abort rather than wiping the DB
    if (!allItems || allItems.length === 0) {
      return res.status(200).json({ success: false, error: 'Zoho returned 0 items — aborting to prevent accidental deletion', removed: 0 });
    }

    // Filter: must be on storefront AND have stock available
    let zohoItems = allItems.filter(item => {
      if (item.show_in_storefront !== true) return false;
      const stock = item.actual_available_stock ?? item.available_stock ?? item.stock_on_hand ?? 0;
      return Number(stock) > 0;
    });
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

    // Find which existing products already have proper Supabase-hosted images
    // Products with only scraped (non-Supabase) URLs are treated as imageless so they get re-fetched
    const existingProductIds = (existingItems || []).map(i => i.id);
    let productsWithImages = new Set();
    if (existingProductIds.length > 0) {
      const { data: imgRows } = await supabase
        .from('product_images').select('product_id, url').in('product_id', existingProductIds);
      (imgRows || []).forEach(r => {
        if (r.url && r.url.includes('supabase.co')) productsWithImages.add(r.product_id);
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
      const liveZohoIds = allItems.filter(i => {
        if (i.show_in_storefront !== true) return false;
        const stock = i.actual_available_stock ?? i.available_stock ?? i.stock_on_hand ?? 0;
        return Number(stock) > 0;
      }).map(i => String(i.item_id));
      // Safety guard — abort if Zoho returned suspiciously few live items vs what's in DB
      // A drop >50% almost certainly means a partial/bad API response, not real sold-through
      const minExpected = Math.ceil(allExistingIds.length * 0.5);
      if (liveZohoIds.length < minExpected) {
        console.error(`Stale cleanup aborted: Zoho returned ${liveZohoIds.length} live items but DB has ${allExistingIds.length} — looks like a partial API response`);
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
      const isExisting = existingZohoIds.includes(mapped.zoho_item_id);

      const { data: upserted, error } = await supabase
        .from('products')
        .upsert(mapped, { onConflict: 'zoho_item_id' })
        .select('id')
        .single();

      if (error) {
        errors.push({ item: mapped.zoho_item_id, error: error.message });
        continue;
      }

      const watchId = upserted?.id || existingMap[mapped.zoho_item_id];
      isExisting ? updated++ : added++;

      if (watchId && !productsWithImages.has(watchId)) {
        imagesAdded += await fetchAndUploadZohoImages(accessToken, zohoItem, watchId);
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
