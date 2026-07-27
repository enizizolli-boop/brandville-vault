// Debug endpoint: shows raw Zoho API data for specific SKUs
// GET /api/zoho-debug?skus=15874,15951

import { createClient } from '@supabase/supabase-js';

async function getAccessToken() {
  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  const { data: cached } = await supabase.from('sync_log').select('result, last_sync_at').eq('key', 'zoho_access_token').single();
  if (cached?.result?.token && cached.last_sync_at) {
    const ageMs = Date.now() - new Date(cached.last_sync_at).getTime();
    if (ageMs < 50 * 60 * 1000) return cached.result.token;
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
  if (!data.access_token) throw new Error('Token failed: ' + JSON.stringify(data));
  return data.access_token;
}

export default async function handler(req, res) {
  const skus = (req.query.skus || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!skus.length) return res.status(400).json({ error: 'Pass ?skus=15874,15951' });

  try {
    const token = await getAccessToken();
    const orgId = process.env.ZOHO_ORG_ID;

    // Fetch list API pages to find these SKUs
    let found = [];
    let page = 1;
    while (found.length < skus.length) {
      const r = await fetch(
        `https://www.zohoapis.eu/inventory/v1/items?organization_id=${orgId}&per_page=200&page=${page}&status=active`,
        { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
      );
      const d = await r.json();
      if (!d.items || d.items.length === 0) break;
      for (const item of d.items) {
        if (skus.includes(String(item.sku))) found.push(item);
      }
      if (d.items.length < 200) break;
      page++;
    }

    const results = [];
    for (const listItem of found) {
      // Extract all stock-related fields from list API
      const listFields = {};
      for (const key of Object.keys(listItem)) {
        if (/stock|available|committed|quantity|qty/i.test(key) || key === 'cf_stage' || key === 'status') {
          listFields[key] = listItem[key];
        }
      }

      // Fetch detail API
      const dr = await fetch(
        `https://www.zohoapis.eu/inventory/v1/items/${listItem.item_id}?organization_id=${orgId}`,
        { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
      );
      const dd = await dr.json();
      const detailItem = dd?.item || {};
      const detailFields = {};
      for (const key of Object.keys(detailItem)) {
        if (/stock|available|committed|quantity|qty/i.test(key) || key === 'cf_stage' || key === 'status') {
          detailFields[key] = detailItem[key];
        }
      }

      results.push({ sku: listItem.sku, item_id: listItem.item_id, list_api: listFields, detail_api: detailFields });
    }

    return res.status(200).json({ results, not_found: skus.filter(s => !found.find(f => String(f.sku) === s)) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
