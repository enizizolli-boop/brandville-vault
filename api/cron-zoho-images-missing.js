import { createClient } from '@supabase/supabase-js';
import JSZip from 'jszip';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getAccessToken() {
  const TOKEN_TTL_MS = 50 * 60 * 1000;
  const { data: cached } = await supabase
    .from('sync_log').select('result, last_sync_at').eq('key', 'zoho_access_token').single();
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
    let res = await fetch(
      `https://www.zohoapis.eu/inventory/v1/items/${itemId}/images?organization_id=${process.env.ZOHO_ORG_ID}`,
      { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
    );
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 5000));
      res = await fetch(
        `https://www.zohoapis.eu/inventory/v1/items/${itemId}/images?organization_id=${process.env.ZOHO_ORG_ID}`,
        { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
      );
      if (res.status === 429) res = null;
    }

    const ct = res ? (res.headers.get('content-type') || '') : '';

    if (res && (ct.includes('application/zip') || ct.includes('octet-stream'))) {
      try {
        const buffer = Buffer.from(await res.arrayBuffer());
        const zip = await JSZip.loadAsync(buffer);
        let imageFiles = Object.values(zip.files)
          .filter(f => !f.dir && /\.(jpe?g|png|webp|gif)$/i.test(f.name))
          .sort((a, b) => a.name.localeCompare(b.name));
        if (imageFiles.length === 0) {
          imageFiles = Object.values(zip.files).filter(f => !f.dir).sort((a, b) => a.name.localeCompare(b.name));
        }
        if (imageFiles.length > 0) {
          let uploaded = 0;
          for (let i = 0; i < imageFiles.length; i++) {
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
          return uploaded;
        }
      } catch (e) {
        if (ct.includes('application/zip')) return 0;
      }
    }

    if (res && !ct.includes('application/zip') && !ct.includes('octet-stream')) {
      let listData = null;
      try {
        if (ct.includes('application/json') || ct.includes('text/')) listData = await res.json();
      } catch { listData = null; }
      if (listData?.images && listData.images.length > 0) {
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
    }

    // Fallback: primary image via item detail
    const detailRes = await fetch(
      `https://www.zohoapis.eu/inventory/v1/items/${itemId}?organization_id=${process.env.ZOHO_ORG_ID}`,
      { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
    );
    if (!detailRes.ok) return 0;
    const detailData = await detailRes.json();
    const imageDocId = detailData?.item?.image_document_id;
    if (!imageDocId) return 0;
    const imgRes = await fetch(
      `https://www.zohoapis.eu/inventory/v1/items/${itemId}/image?organization_id=${process.env.ZOHO_ORG_ID}&document_id=${imageDocId}`,
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
  } catch (e) {
    console.error(`fetchAndUploadZohoImages error for ${itemId}:`, e);
    return 0;
  }
}

export default async function handler(req, res) {
  const limit = parseInt(req.query?.limit || '10');
  const startTime = Date.now();

  try {
    // Find Zoho watches with no images in product_images
    const { data: allZohoWatches } = await supabase
      .from('products')
      .select('id, zoho_item_id')
      .eq('source', 'zoho')
      .eq('status', 'available')
      .not('zoho_item_id', 'is', null);

    if (!allZohoWatches || allZohoWatches.length === 0) {
      return res.status(200).json({ success: true, missing: 0, processed: 0, images_added: 0 });
    }

    // Find which ones have no images
    const allIds = allZohoWatches.map(w => w.id);
    const withImages = new Set();
    const ID_CHUNK = 200;
    for (let i = 0; i < allIds.length; i += ID_CHUNK) {
      const { data: imgs } = await supabase
        .from('product_images')
        .select('product_id')
        .in('product_id', allIds.slice(i, i + ID_CHUNK));
      for (const r of imgs || []) withImages.add(r.product_id);
    }

    const missing = allZohoWatches.filter(w => !withImages.has(w.id));
    const toProcess = missing.slice(0, limit);

    if (toProcess.length === 0) {
      return res.status(200).json({ success: true, missing: 0, processed: 0, images_added: 0 });
    }

    const accessToken = await getAccessToken();
    let imagesAdded = 0, processed = 0;
    const errors = [];

    for (const watch of toProcess) {
      if (Date.now() - startTime > 55000) break;
      try {
        const added = await fetchAndUploadZohoImages(accessToken, watch.zoho_item_id, watch.id);
        imagesAdded += added;
      } catch (e) {
        errors.push({ id: watch.id, zoho_item_id: watch.zoho_item_id, error: e.message });
      }
      processed++;
      await new Promise(r => setTimeout(r, 1200));
    }

    return res.status(200).json({
      success: true,
      missing: missing.length,
      processed,
      images_added: imagesAdded,
      remaining: Math.max(0, missing.length - processed),
      elapsed_ms: Date.now() - startTime,
      errors: errors.length ? errors : undefined,
    });
  } catch (err) {
    console.error('cron-zoho-images-missing error:', err);
    return res.status(500).json({ error: err.message });
  }
}
