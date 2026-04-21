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
  if (!data.access_token) throw new Error('Failed to get Zoho access token: ' + JSON.stringify(data));
  return data.access_token;
}

async function fetchAllItems(accessToken) {
  let page = 1;
  let allItems = [];
  while (true) {
    const url = `https://www.zohoapis.eu/inventory/v1/items?organization_id=${process.env.ZOHO_ORG_ID}&per_page=200&page=${page}&status=active`;
    const res = await fetch(url, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
    });
    const data = await parseJsonSafe(res, `Zoho items page ${page}`);
    const items = data.items || [];
    allItems = allItems.concat(items);
    if (items.length < 200) break;
    page++;
  }
  return allItems;
}

async function fetchImagesFromStorePage(itemId) {
  try {
    const pageUrl = `https://${STORE_DOMAIN}/products/${itemId}`;
    const res = await fetch(pageUrl);
    const html = await res.text();
    const matches = [...html.matchAll(/https:\/\/[^"']*zohocommerce[^"']*\.(jpg|jpeg|png|webp)/gi)];
    const unique = [...new Set(matches.map(m => m[0].split('?')[0]))];
    return unique.filter(u => !u.includes('thumb') && !u.includes('icon')).slice(0, 10);
  } catch { return []; }
}


const WATCH_BRANDS = new Set([
  'rolex','audemars piguet','patek philippe','omega','iwc','jaeger-lecoultre',
  'breitling','tag heuer','tudor','hublot','richard mille','vacheron constantin',
  'a. lange & söhne','panerai','blancpain','breguet','zenith','grand seiko',
  'ulysse nardin','girard-perregaux','piaget','chopard',
]);

function mapZohoItem(item) {
  const name = item.name || '';
  // Zoho items are always Watches — Jewellery comes exclusively from Odoo
  return {
    zoho_item_id: String(item.item_id),
    source: 'zoho',
    brand: item.brand || 'Unknown',
    model: name.trim(),
    reference: item.sku || null,
    price_eur: item.price ? parseFloat(item.price) : null,
    status: 'available',
    category: 'Watches',
    subcategory: null,
    notes: item.description || null,
  };
}

export default async function handler(req, res) {
  // Accept both GET (Zoho verification) and POST (actual webhook)
  if (req.method === 'GET') {
    return res.status(200).send('OK');
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const accessToken = await getAccessToken();
    const allItems = await fetchAllItems(accessToken);
    // Live items: in storefront AND with stock
    const zohoItems = allItems.filter(item => {
      if (item.show_in_storefront !== true) return false;
      const stock = item.actual_available_stock ?? item.available_stock ?? item.stock_on_hand ?? 0;
      return Number(stock) > 0;
    });

    // Safety guard — if Zoho returned nothing, abort to prevent mass deletion
    if (allItems.length === 0) {
      return res.status(200).json({ ok: false, error: 'Zoho returned 0 items — aborting to prevent accidental deletion' });
    }
    if (zohoItems.length === 0) {
      return res.status(200).json({ ok: false, error: 'All Zoho items filtered out — aborting to prevent accidental deletion' });
    }

    // Mark items no longer on storefront or out of stock as sold (don't delete)
    const allZohoIds = zohoItems.map(i => String(i.item_id));
    const { data: allExisting } = await supabase.from('products').select('zoho_item_id').eq('source', 'zoho');
    const toMarkSold = (allExisting || []).map(i => i.zoho_item_id).filter(id => !allZohoIds.includes(id));
    if (toMarkSold.length > 0) {
      await supabase.from('products').update({ status: 'sold' }).in('zoho_item_id', toMarkSold).eq('source', 'zoho');
    }

    const zohoIds = zohoItems.map(i => String(i.item_id));
    const { data: existingItems } = await supabase.from('products').select('id, zoho_item_id').eq('source', 'zoho').in('zoho_item_id', zohoIds);
    const existingMap = {};
    (existingItems || []).forEach(i => { existingMap[i.zoho_item_id] = i.id; });

    let added = 0, updated = 0, imagesAdded = 0;

    for (const zohoItem of zohoItems) {
      const mapped = mapZohoItem(zohoItem);
      const isExisting = !!existingMap[mapped.zoho_item_id];
      if (isExisting) delete mapped.status; // never override status of existing items

      const { data: upserted, error } = await supabase.from('products').upsert(mapped, { onConflict: 'zoho_item_id' }).select('id').single();
      if (error) continue;

      const watchId = upserted?.id || existingMap[mapped.zoho_item_id];
      isExisting ? updated++ : added++;

      if (watchId && !isExisting) {
        const images = await fetchImagesFromStorePage(zohoItem.item_id);
        if (images.length > 0) {
          await supabase.from('product_images').delete().eq('product_id', watchId);
          await supabase.from('product_images').insert(images.map((url, i) => ({ product_id: watchId, url, position: i })));
          imagesAdded += images.length;
        }
      }
    }

    return res.status(200).json({ ok: true, added, updated, marked_sold: toMarkSold.length, images_added: imagesAdded });
  } catch (err) {
    console.error('Zoho webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
}
