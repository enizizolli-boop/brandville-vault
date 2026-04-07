import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
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
  if (!data.access_token) throw new Error('Failed to get Zoho access token: ' + JSON.stringify(data));
  return data.access_token;
}

async function fetchAllItems(accessToken) {
  let page = 1;
  let allItems = [];
  while (true) {
    const res = await fetch(`https://commerce.zoho.eu/api/v1/items?store_id=${STORE_ID}&page=${page}&per_page=200`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, 'Content-Type': 'application/json' }
    });
    const data = await res.json();
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

function extractJewelleryType(text) {
  if (!text) return null;
  const lower = String(text).toLowerCase();
  if (/\b(?:earrings?|studs?|hoops?)\b/.test(lower)) return 'Earrings';
  if (/\bbracelets?\b/.test(lower) && !/watch\s+bracelet|bracelet\s*\(|strap/i.test(lower)) return 'Bracelets';
  if (/\bnecklaces?\b/.test(lower)) return 'Necklaces';
  if (/\brings?\b/.test(lower)) return 'Rings';
  return null;
}

const WATCH_BRANDS = new Set([
  'rolex','audemars piguet','patek philippe','omega','iwc','jaeger-lecoultre',
  'breitling','tag heuer','tudor','hublot','richard mille','vacheron constantin',
  'a. lange & söhne','panerai','blancpain','breguet','zenith','grand seiko',
  'ulysse nardin','girard-perregaux','piaget','chopard',
]);

function mapZohoItem(item) {
  const name = item.name || '';
  const brand = (item.brand || 'Unknown').trim();
  const isWatchBrand = WATCH_BRANDS.has(brand.toLowerCase());
  const jewellery_type = isWatchBrand ? null : (extractJewelleryType(name) || extractJewelleryType(item.description));
  const category = jewellery_type ? 'Jewellery' : 'Watches';
  return {
    zoho_item_id: String(item.item_id),
    source: 'zoho',
    brand: item.brand || 'Unknown',
    model: name.trim(),
    reference: item.sku || null,
    price_eur: item.price ? parseFloat(item.price) : null,
    status: 'available',
    category,
    jewellery_type: jewellery_type || null,
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
    const zohoItems = allItems.filter(item => item.show_in_storefront === true);

    // Remove items no longer on storefront
    const allZohoIds = zohoItems.map(i => String(i.item_id));
    const { data: allExisting } = await supabase.from('watches').select('zoho_item_id').eq('source', 'zoho');
    const toDelete = (allExisting || []).map(i => i.zoho_item_id).filter(id => !allZohoIds.includes(id));
    if (toDelete.length > 0) await supabase.from('watches').delete().in('zoho_item_id', toDelete);

    const zohoIds = zohoItems.map(i => String(i.item_id));
    const { data: existingItems } = await supabase.from('watches').select('id, zoho_item_id').eq('source', 'zoho').in('zoho_item_id', zohoIds);
    const existingMap = {};
    (existingItems || []).forEach(i => { existingMap[i.zoho_item_id] = i.id; });

    let added = 0, updated = 0, imagesAdded = 0;

    for (const zohoItem of zohoItems) {
      const mapped = mapZohoItem(zohoItem);
      const isExisting = !!existingMap[mapped.zoho_item_id];
      if (isExisting) delete mapped.status; // never override status of existing items

      const { data: upserted, error } = await supabase.from('watches').upsert(mapped, { onConflict: 'zoho_item_id' }).select('id').single();
      if (error) continue;

      const watchId = upserted?.id || existingMap[mapped.zoho_item_id];
      isExisting ? updated++ : added++;

      if (watchId && !isExisting) {
        const images = await fetchImagesFromStorePage(zohoItem.item_id);
        if (images.length > 0) {
          await supabase.from('watch_images').delete().eq('watch_id', watchId);
          await supabase.from('watch_images').insert(images.map((url, i) => ({ watch_id: watchId, url, position: i })));
          imagesAdded += images.length;
        }
      }
    }

    return res.status(200).json({ ok: true, added, updated, removed: toDelete.length, images_added: imagesAdded });
  } catch (err) {
    console.error('Zoho webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
}
