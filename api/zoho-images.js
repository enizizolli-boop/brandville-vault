import { createClient } from '@supabase/supabase-js';
import JSZip from 'jszip';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getAccessToken() {
  const TOKEN_TTL_MS = 50 * 60 * 1000;
  const { data: cached } = await supabase
    .from('sync_log')
    .select('result, last_sync_at')
    .eq('key', 'zoho_access_token')
    .single();

  if (cached?.result?.token && cached.last_sync_at) {
    const ageMs = Date.now() - new Date(cached.last_sync_at).getTime();
    if (ageMs < TOKEN_TTL_MS) return cached.result.token;
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
  if (!data.access_token) throw new Error('Failed to get Zoho access token');

  await supabase.from('sync_log').upsert(
    { key: 'zoho_access_token', last_sync_at: new Date().toISOString(), result: { token: data.access_token } },
    { onConflict: 'key' }
  );
  return data.access_token;
}

async function fetchAndUploadZohoImages(accessToken, itemId, productId) {
  try {
    const listRes = await fetch(
      `https://www.zohoapis.eu/inventory/v1/items/${itemId}/images?organization_id=${process.env.ZOHO_ORG_ID}`,
      { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
    );

    const ct = listRes.headers.get('content-type') || '';

    if (listRes.status === 429) {
      console.log(`Gallery API rate limited (429) for item ${itemId} — skipping`);
      return 0;
    }

    // Zoho returns a ZIP file containing all gallery images. Content-type is usually
    // application/zip but some items return application/octet-stream for the same ZIP.
    if (ct.includes('application/zip') || ct.includes('octet-stream')) {
      try {
        const buffer = Buffer.from(await listRes.arrayBuffer());
        const zip = await JSZip.loadAsync(buffer);
        const imageFiles = Object.values(zip.files)
          .filter(f => !f.dir && /\.(jpe?g|png|webp|gif)$/i.test(f.name))
          .sort((a, b) => a.name.localeCompare(b.name));

        if (imageFiles.length > 0) {
          const { data: existingImgs } = await supabase
            .from('product_images').select('position, url').eq('product_id', productId);
          // Only treat Supabase-hosted images as already uploaded; skip bad/external URLs
          const existingPositions = new Set(
            (existingImgs || []).filter(r => r.url && r.url.includes('supabase.co')).map(r => r.position)
          );
          let uploaded = 0;
          for (let i = 0; i < imageFiles.length; i++) {
            if (existingPositions.has(i)) continue;
            try {
              const imgBuffer = Buffer.from(await imageFiles[i].async('arraybuffer'));
              const path = `${productId}/zoho_${i}.jpg`;
              const { error: upErr } = await supabase.storage.from('watch-images').upload(path, imgBuffer, { contentType: 'image/jpeg', upsert: true });
              if (upErr) continue;
              const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path);
              await supabase.from('product_images').insert({ product_id: productId, url: publicUrl, position: i });
              uploaded++;
            } catch (e) { console.error(`ZIP image ${i} upload error for item ${itemId}:`, e); }
          }
          console.log(`Item ${itemId}: extracted ${imageFiles.length} images from ZIP, uploaded ${uploaded}`);
          return uploaded;
        }
        // ZIP was empty (item only has a Front View, no Other Images) — fall through to primary image
      } catch (e) {
        if (ct.includes('application/zip')) {
          console.error(`ZIP extract error for item ${itemId}:`, e);
          return 0;
        }
        // octet-stream that isn't a valid ZIP — fall through to primary image fallback
        console.log(`octet-stream was not a valid ZIP for item ${itemId}, trying primary image`);
      }
    }

    // JSON gallery list
    let listData = null;
    try {
      if (ct.includes('application/json') || ct.includes('text/')) listData = await listRes.json();
    } catch { listData = null; }

    if (listData?.images && listData.images.length > 0) {
      const { data: existingImgs } = await supabase
        .from('product_images').select('position').eq('product_id', productId);
      const existingPositions = new Set((existingImgs || []).map(r => r.position));

      let uploaded = 0;
      for (let i = 0; i < listData.images.length; i++) {
        if (existingPositions.has(i)) continue;
        const docId = listData.images[i].image_document_id;
        if (!docId) continue;
        try {
          const imgRes = await fetch(
            `https://www.zohoapis.eu/inventory/v1/items/${itemId}/image?organization_id=${process.env.ZOHO_ORG_ID}&document_id=${docId}`,
            { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
          );
          if (!imgRes.ok) continue;
          const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
          const path = `${productId}/zoho_${i}.jpg`;
          const { error: upErr } = await supabase.storage.from('watch-images').upload(path, imgBuffer, { contentType: 'image/jpeg', upsert: true });
          if (upErr) continue;
          const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path);
          await supabase.from('product_images').insert({ product_id: productId, url: publicUrl, position: i });
          uploaded++;
        } catch (e) { console.error(`Image ${i} upload error for item ${itemId}:`, e); }
      }
      return uploaded;
    }

    // No gallery — try primary image, only if item has no Supabase-hosted images
    console.log(`Item ${itemId}: no gallery (ct="${ct}", status=${listRes.status})`);
    const { count: existing } = await supabase
      .from('product_images')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', productId)
      .like('url', '%supabase.co%');
    if (existing > 0) return 0;
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { batch_size = 5, offset = 0 } = req.body || {};

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
      // Pause between items — Zoho gallery API has a strict per-minute rate limit
      await new Promise(r => setTimeout(r, 1500));
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
