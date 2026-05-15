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
  if (!data.access_token) throw new Error('Failed to get Zoho access token');
  return data.access_token;
}

async function fetchAndUploadZohoImages(accessToken, itemId, productId) {
  try {
    const listRes = await fetch(
      `https://www.zohoapis.eu/inventory/v1/items/${itemId}/images?organization_id=${process.env.ZOHO_ORG_ID}`,
      { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
    );
    const listData = await listRes.json();
    if (!listData.images || listData.images.length === 0) return 0;

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
  } catch (e) {
    console.error(`fetchAndUploadZohoImages error for ${itemId}:`, e);
    return 0;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { batch_size = 10, offset = 0 } = req.body || {};

  try {
    const accessToken = await getAccessToken();

    const { data: watches, error } = await supabase
      .from('products')
      .select('id, zoho_item_id')
      .eq('source', 'zoho')
      .not('zoho_item_id', 'is', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + batch_size - 1);

    if (error) throw error;
    if (!watches || watches.length === 0) {
      return res.status(200).json({ success: true, done: true, processed: 0 });
    }

    let processed = 0;
    let imagesAdded = 0;
    const errors = [];

    for (const watch of watches) {
      try {
        imagesAdded += await fetchAndUploadZohoImages(accessToken, watch.zoho_item_id, watch.id);
      } catch (e) {
        errors.push({ watch_id: watch.id, error: e.message });
      }
      processed++;
    }

    const { count: totalCount } = await supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'zoho');

    const nextOffset = offset + batch_size;
    const done = nextOffset >= (totalCount || 0);

    return res.status(200).json({
      success: true,
      processed,
      images_added: imagesAdded,
      offset,
      next_offset: done ? null : nextOffset,
      total: totalCount,
      done,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('Image sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
