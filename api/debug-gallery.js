import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getAccessToken() {
  const { data: cached } = await supabase
    .from('sync_log')
    .select('result, last_sync_at')
    .eq('key', 'zoho_access_token')
    .single();
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
  if (!data.access_token) throw new Error('token fail: ' + JSON.stringify(data));
  return data.access_token;
}

export default async function handler(req, res) {
  const itemId = req.query.item_id;
  if (!itemId) return res.status(400).json({ error: 'item_id required' });

  try {
    const accessToken = await getAccessToken();
    const listRes = await fetch(
      `https://www.zohoapis.eu/inventory/v1/items/${itemId}/images?organization_id=${process.env.ZOHO_ORG_ID}`,
      { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
    );
    const ct = listRes.headers.get('content-type') || '';
    const buffer = Buffer.from(await listRes.arrayBuffer());

    let preview = null;
    if (ct.includes('application/json') || ct.includes('text/')) {
      try { preview = JSON.parse(buffer.toString('utf8')); } catch { preview = buffer.toString('utf8').slice(0, 300); }
    } else {
      preview = `binary, ${buffer.length} bytes, first 4 bytes: ${buffer.slice(0, 4).toString('hex')}`;
    }

    return res.status(200).json({
      status: listRes.status,
      contentType: ct,
      byteLength: buffer.length,
      preview,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
