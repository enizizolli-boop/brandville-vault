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

// Reuses the same cache key as zoho-sync.js so consecutive calls share one Zoho fetch
async function getAllItemsCached(accessToken) {
  const CACHE_TTL_MS = 10 * 60 * 1000;
  const { data: cached } = await supabase
    .from('sync_log').select('result, last_sync_at').eq('key', 'zoho_items_cache').single();
  if (cached?.result?.items && cached.last_sync_at) {
    if (Date.now() - new Date(cached.last_sync_at).getTime() < CACHE_TTL_MS) return cached.result.items;
  }
  let items = [], page = 1;
  while (true) {
    const res = await fetch(
      `https://www.zohoapis.eu/inventory/v1/items?organization_id=${process.env.ZOHO_ORG_ID}&per_page=200&page=${page}&status=active`,
      { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
    );
    const data = await res.json();
    if (!data.items || data.items.length === 0) break;
    items = items.concat(data.items);
    if (data.items.length < 200) break;
    page++;
  }
  await supabase.from('sync_log').upsert(
    { key: 'zoho_items_cache', last_sync_at: new Date().toISOString(), result: { items } },
    { onConflict: 'key' }
  );
  return items;
}

async function fetchGalleryWithRetry(accessToken, itemId) {
  let res = await fetch(
    `https://www.zohoapis.eu/inventory/v1/items/${itemId}/images?organization_id=${process.env.ZOHO_ORG_ID}`,
    { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
  );
  if (res.status !== 429) return res;
  console.log(`Gallery API rate limited (429) for item ${itemId}, waiting 5s then retrying`);
  await new Promise(r => setTimeout(r, 5000));
  res = await fetch(
    `https://www.zohoapis.eu/inventory/v1/items/${itemId}/images?organization_id=${process.env.ZOHO_ORG_ID}`,
    { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
  );
  if (res.status === 429) {
    console.log(`Gallery still rate limited for item ${itemId} after retry — falling back to primary image`);
    return null;
  }
  return res;
}

async function fetchAndUploadZohoImages(accessToken, itemId, productId) {
  try {
    const listRes = await fetchGalleryWithRetry(accessToken, itemId);
    const ct = listRes ? (listRes.headers.get('content-type') || '') : '';

    // Zoho returns a ZIP file containing all gallery images. Content-type is usually
    // application/zip but some items return application/octet-stream for the same ZIP.
    if (listRes && (ct.includes('application/zip') || ct.includes('octet-stream'))) {
      try {
        const buffer = Buffer.from(await listRes.arrayBuffer());
        const zip = await JSZip.loadAsync(buffer);
        let imageFiles = Object.values(zip.files)
          .filter(f => !f.dir && /\.(jpe?g|png|webp|gif)$/i.test(f.name))
          .sort((a, b) => a.name.localeCompare(b.name));
        // Some Zoho items use extensionless filenames in the ZIP — fall back to all files
        if (imageFiles.length === 0) {
          imageFiles = Object.values(zip.files).filter(f => !f.dir).sort((a, b) => a.name.localeCompare(b.name));
        }

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

    // JSON gallery list (body not yet consumed by the ZIP path above)
    let listData = null;
    if (listRes && !ct.includes('application/zip') && !ct.includes('octet-stream')) {
      try {
        if (ct.includes('application/json') || ct.includes('text/')) listData = await listRes.json();
      } catch { listData = null; }
    }

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

    // No gallery — fetch item detail to get image_document_id, then download that image.
    // Zoho requires the document_id parameter even for the primary/front image.
    const { count: existing } = await supabase
      .from('product_images')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', productId)
      .like('url', '%supabase.co%');
    if (existing > 0) return 0;
    try {
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
      await new Promise(r => setTimeout(r, 1500));
    }

    // On first batch: also backfill products that have no zoho_item_id yet.
    // These are items that were never on the Zoho storefront so the main sync skipped them,
    // but they ARE active in Zoho Inventory and can be matched by reference/SKU.
    if (offset === 0) {
      const { data: unlinked } = await supabase
        .from('products')
        .select('id, reference')
        .eq('source', 'zoho')
        .is('zoho_item_id', null)
        .not('reference', 'is', null);

      if (unlinked && unlinked.length > 0) {
        const allZohoItems = await getAllItemsCached(accessToken);
        const refMap = {};
        for (const item of allZohoItems) {
          if (item.sku) refMap[item.sku] = String(item.item_id);
        }
        for (const w of unlinked) {
          const zohoItemId = refMap[w.reference];
          if (!zohoItemId) continue;
          await supabase.from('products').update({ zoho_item_id: zohoItemId }).eq('id', w.id);
          try {
            imagesAdded += await fetchAndUploadZohoImages(accessToken, zohoItemId, w.id);
          } catch (e) {
            errors.push({ watch_id: w.id, error: e.message });
          }
          processed++;
          await new Promise(r => setTimeout(r, 1500));
        }
      }
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
