import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const STORE_DOMAIN = 'thewatchstore.zohocommerce.eu';
const STORE_ID = 'e332ab1967';

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
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get access token: ' + JSON.stringify(data));
  return data.access_token;
}

async function fetchAllItems(accessToken) {
  let items = [];
  let page = 1;
  const perPage = 200;
  while (true) {
    const url = `https://www.zohoapis.eu/inventory/v1/items?organization_id=${process.env.ZOHO_ORG_ID}&per_page=${perPage}&page=${page}&status=active`;
    const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } });
    const data = await res.json();
    if (!data.items || data.items.length === 0) break;
    items = items.concat(data.items);
    if (data.items.length < perPage) break;
    page++;
  }
  return items;
}

async function fetchImagesFromStorePage(zohoItemId) {
  try {
    const url = `https://${STORE_DOMAIN}/products/${STORE_ID}/${zohoItemId}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return [];
    const html = await res.text();

    const regex = /https:\/\/cdn3\.zohoecommerce\.com\/product-images\/[^"'\s]+/g;
    const allMatches = [...new Set(html.match(regex) || [])];

    const imageMap = {};
    for (const imgUrl of allMatches) {
      const filenameMatch = imgUrl.match(/product-images\/([^/]+)\//);
      if (!filenameMatch) continue;
      const filename = filenameMatch[1];
      const is600 = imgUrl.includes('600x600');
      if (!imageMap[filename] || is600) {
        imageMap[filename] = imgUrl.replace('300x300', '600x600');
      }
    }

    return Object.values(imageMap);
  } catch {
    return [];
  }
}

const ALLOWED_CONDITIONS = [
  'pre-owned conditions with MINOR signs of usage',
  'pre-owned conditions with MAJOR signs of usage',
  'Fair', 'Needs Repair', 'Repaired', 'Repaired Albania',
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

  // Extract condition from name first, then description, then custom field
  let condition = extractConditionFromText(model);
  if (!condition) condition = extractConditionFromText(notes);
  if (!condition) condition = mapCondition(item.cf_conditions);

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
    const allItems = await fetchAllItems(accessToken);
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
      const toDelete = allExistingIds.filter(id => !liveZohoIds.includes(id));
      if (toDelete.length > 0) {
        await supabase.from('products').delete().in('zoho_item_id', toDelete);
        removed = toDelete.length;
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

      // Fetch all images from Commerce store page
      if (watchId) {
        const images = await fetchImagesFromStorePage(zohoItem.item_id);
        if (images.length > 0) {
          await supabase.from('product_images').delete().eq('product_id', watchId);
          const imageRows = images.map((url, i) => ({ product_id: watchId, url, position: i }));
          await supabase.from('product_images').insert(imageRows);
          imagesAdded += images.length;
        }
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
