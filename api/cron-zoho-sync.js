import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

const ALLOWED_CONDITIONS = [
  'pre-owned conditions with MINOR signs of usage',
  'pre-owned conditions with MAJOR signs of usage',
  'Fair', 'Needs Repair', 'Repaired', 'Repaired Albania',
  'Polished A', 'Polished B',
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

  let condition = extractConditionFromText(model);
  if (!condition) condition = extractConditionFromText(notes);
  if (!condition) condition = mapCondition(item.cf_conditions);

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
    const accessToken = await getAccessToken();

    // Only fetch items modified in the last 35 minutes
    const recentItems = await fetchRecentItems(accessToken, 35);

    // Filter: must be on storefront with stock
    const liveItems = recentItems.filter(item => {
      if (item.show_in_storefront !== true) return false;
      const stock = item.actual_available_stock ?? item.available_stock ?? item.stock_on_hand ?? 0;
      return Number(stock) > 0;
    });

    // Items that were recently modified but now out of stock/off storefront → mark sold
    const offItems = recentItems.filter(item => {
      if (item.show_in_storefront !== true) return true;
      const stock = item.actual_available_stock ?? item.available_stock ?? item.stock_on_hand ?? 0;
      return Number(stock) <= 0;
    });

    if (offItems.length > 0) {
      const offIds = offItems.map(i => String(i.item_id));
      await supabase.from('products').update({ status: 'sold' }).in('zoho_item_id', offIds).eq('source', 'zoho');
    }

    // Upsert recently modified live items
    let upserted = 0;
    if (liveItems.length > 0) {
      const rows = liveItems.map(mapZohoItem);
      await supabase.from('products').upsert(rows, { onConflict: 'zoho_item_id' });
      upserted = rows.length;
    }

    return res.status(200).json({
      success: true,
      upserted,
      marked_sold: offItems.length,
      total_recent: recentItems.length,
    });
  } catch (err) {
    console.error('Cron Zoho sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
