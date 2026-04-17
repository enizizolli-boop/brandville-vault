import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
    const url = `https://www.zohoapis.eu/inventory/v1/items?organization_id=${process.env.ZOHO_ORG_ID}&per_page=${perPage}&page=${page}&status=active`;
    const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } });
    const data = await parseJsonSafe(res, `Zoho items page ${page}`);
    if (!data.items || data.items.length === 0) break;
    items = items.concat(data.items);
    if (data.items.length < perPage) break;
    page++;
  }
  return items;
}

export default async function handler(req, res) {
  try {
    const accessToken = await getAccessToken();
    const allItems = await fetchAllItems(accessToken);

    const liveItems = allItems.filter(item => {
      if (item.show_in_storefront !== true) return false;
      const stock = item.actual_available_stock ?? item.available_stock ?? item.stock_on_hand ?? 0;
      return Number(stock) > 0;
    });
    const liveIds = new Set(liveItems.map(i => String(i.item_id)));

    const { data: dbRows, error } = await supabase
      .from('products')
      .select('zoho_item_id, brand, model, status')
      .eq('source', 'zoho');
    if (error) throw new Error('Supabase read failed: ' + error.message);

    const dbById = new Map((dbRows || []).map(r => [String(r.zoho_item_id), r]));
    const dbIds = new Set(dbById.keys());

    const missingInDb = [...liveIds].filter(id => !dbIds.has(id)).map(id => {
      const it = liveItems.find(i => String(i.item_id) === id);
      return { zoho_item_id: id, name: it?.name || null, sku: it?.sku || null };
    });

    const extraInDb = [...dbIds].filter(id => !liveIds.has(id)).map(id => ({
      zoho_item_id: id,
      brand: dbById.get(id)?.brand || null,
      model: dbById.get(id)?.model || null,
      status: dbById.get(id)?.status || null,
    }));

    return res.status(200).json({
      in_sync: missingInDb.length === 0 && extraInDb.length === 0,
      zoho_live_count: liveItems.length,
      db_zoho_count: dbRows?.length || 0,
      zoho_total_active: allItems.length,
      missing_in_db_count: missingInDb.length,
      extra_in_db_count: extraInDb.length,
      missing_in_db: missingInDb.slice(0, 50),
      extra_in_db: extraInDb.slice(0, 50),
    });
  } catch (err) {
    console.error('Zoho status error:', err);
    return res.status(500).json({ error: err.message });
  }
}
