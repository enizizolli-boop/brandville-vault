import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
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

async function fetchZohoCommerceItems(accessToken) {
  let items = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const url = `https://www.zohoapis.eu/inventory/v1/items?organization_id=${process.env.ZOHO_ORG_ID}&per_page=${perPage}&page=${page}&channel_name=zohocommerce`;
    const res = await fetch(url, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });
    const data = await res.json();
    if (!data.items || data.items.length === 0) break;
    items = items.concat(data.items);
    if (data.items.length < perPage) break;
    page++;
  }
  return items;
}

function getCustomField(item, ...keywords) {
  if (!item.custom_fields || !Array.isArray(item.custom_fields)) return null;
  for (const field of item.custom_fields) {
    const label = (field.label || '').toLowerCase();
    if (keywords.some(k => label.includes(k))) {
      return field.value || null;
    }
  }
  return null;
}

const ALLOWED_CONDITIONS = [
  'pre-owned conditions with MINOR signs of usage',
  'pre-owned conditions with MAJOR signs of usage',
  'Fair',
  'Needs Repair',
  'Repaired',
  'Repaired Albania',
];

const ALLOWED_SCOPES = ['Watch Only', 'With Card', 'With Box', 'Card & Box'];

function mapZohoItem(item) {
  const brand = item.brand || getCustomField(item, 'brand') || 'Unknown';
  const model = item.cf_model || getCustomField(item, 'model') || item.name || 'Unknown';
  const reference = item.sku || null;
  const priceEur = item.rate || null;

  let condition = item.cf_conditions || getCustomField(item, 'condition') || 'Fair';
  if (!ALLOWED_CONDITIONS.includes(condition)) condition = 'Fair';

  let scopeOfDelivery = item.cf_scope_of_delivery || getCustomField(item, 'scope', 'delivery') || null;
  if (!ALLOWED_SCOPES.includes(scopeOfDelivery)) scopeOfDelivery = null;

  return {
    zoho_item_id: String(item.item_id),
    source: 'zoho',
    brand,
    model,
    reference,
    price_eur: priceEur,
    condition,
    scope_of_delivery: scopeOfDelivery,
    status: 'available',
    category: 'Watches',
    notes: item.description || null,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const accessToken = await getAccessToken();
    const zohoItems = await fetchZohoCommerceItems(accessToken);
    const zohoIds = zohoItems.map(i => String(i.item_id));

    const { data: existingItems } = await supabase
      .from('watches')
      .select('id, zoho_item_id')
      .eq('source', 'zoho');

    const existingZohoIds = (existingItems || []).map(i => i.zoho_item_id);

    const toDelete = existingZohoIds.filter(id => !zohoIds.includes(id));
    if (toDelete.length > 0) {
      await supabase.from('watches').delete().in('zoho_item_id', toDelete);
    }

    let added = 0;
    let updated = 0;
    const errors = [];

    for (const zohoItem of zohoItems) {
      const mapped = mapZohoItem(zohoItem);
      const isExisting = existingZohoIds.includes(mapped.zoho_item_id);

      const { error } = await supabase
        .from('watches')
        .upsert(mapped, { onConflict: 'zoho_item_id' });

      if (error) {
        errors.push({ item: mapped.zoho_item_id, error: error.message });
      } else {
        isExisting ? updated++ : added++;
      }
    }

    return res.status(200).json({
      success: true,
      added,
      updated,
      removed: toDelete.length,
      total: zohoItems.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('Sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
