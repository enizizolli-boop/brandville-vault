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

function extractStage(item) {
  if (item.custom_field_hash?.cf_stage) return item.custom_field_hash.cf_stage;
  if (Array.isArray(item.custom_fields)) {
    const f = item.custom_fields.find(f => f.api_name === 'cf_stage');
    if (f?.value) return f.value;
  }
  return null;
}

const ALLOWED_SCOPES = ['Watch Only', 'With Card', 'With Box', 'Card & Box'];
const ALLOWED_CONDITIONS = [
  'pre-owned conditions with MINOR signs of usage',
  'pre-owned conditions with MAJOR signs of usage',
  'Fair', 'Needs Repair', 'Repaired', 'Repaired Albania',
  'Polished A', 'Polished B',
];

function mapZohoItem(item) {
  const brand = (item.cf_brand || item.brand || item.custom_field_hash?.cf_brand || 'Unknown').trim();
  const model = (item.cf_model || item.custom_field_hash?.cf_model || item.name || 'Unknown').trim();
  const reference = item.sku || null;
  const scopeRaw = item.cf_scope_of_delivery || item.custom_field_hash?.cf_scope_of_delivery || null;
  const conditionRaw = item.cf_conditions || item.custom_field_hash?.cf_conditions || null;
  const rawDesc = item.description && item.description.trim() ? item.description.trim() : null;
  const notes = rawDesc && /^\d+\s*-\s*\S/.test(rawDesc) ? null : rawDesc;
  const condition = conditionRaw && ALLOWED_CONDITIONS.includes(conditionRaw.trim())
    ? conditionRaw.trim() : 'Pre-owned';

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

async function fetchFullItem(accessToken, itemId) {
  const res = await fetch(
    `https://www.zohoapis.eu/inventory/v1/items/${itemId}?organization_id=${process.env.ZOHO_ORG_ID}`,
    { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data?.item || null;
}

async function syncGalleryImages(accessToken, itemId, productId) {
  try {
    const listRes = await fetch(
      `https://www.zohoapis.eu/inventory/v1/items/${itemId}/images?organization_id=${process.env.ZOHO_ORG_ID}`,
      { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
    );
    if (listRes.status === 429) return 0;

    const ct = listRes.headers.get('content-type') || '';
    let uploaded = 0;

    if (ct.includes('application/zip') || ct.includes('octet-stream')) {
      try {
        const buffer = Buffer.from(await listRes.arrayBuffer());
        const zip = await JSZip.loadAsync(buffer);
        let imageFiles = Object.values(zip.files)
          .filter(f => !f.dir && /\.(jpe?g|png|webp|gif)$/i.test(f.name))
          .sort((a, b) => a.name.localeCompare(b.name));
        if (imageFiles.length === 0) {
          imageFiles = Object.values(zip.files).filter(f => !f.dir).sort((a, b) => a.name.localeCompare(b.name));
        }
        for (let i = 0; i < imageFiles.length; i++) {
          const imgBuffer = Buffer.from(await imageFiles[i].async('arraybuffer'));
          const path = `${productId}/zoho_${i}.jpg`;
          const { error } = await supabase.storage.from('watch-images').upload(path, imgBuffer, { contentType: 'image/jpeg', upsert: true });
          if (error) continue;
          const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path);
          await supabase.from('product_images').insert({ product_id: productId, url: publicUrl, position: i });
          uploaded++;
        }
        return uploaded;
      } catch { if (ct.includes('application/zip')) return 0; }
    }

    let listData = null;
    try { if (ct.includes('application/json') || ct.includes('text/')) listData = await listRes.json(); } catch { }
    if (listData?.images?.length > 0) {
      for (let i = 0; i < listData.images.length; i++) {
        const docId = listData.images[i].image_document_id;
        if (!docId) continue;
        const imgRes = await fetch(
          `https://www.zohoapis.eu/inventory/v1/items/${itemId}/image?organization_id=${process.env.ZOHO_ORG_ID}&document_id=${docId}`,
          { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
        );
        if (!imgRes.ok) continue;
        const buf = Buffer.from(await imgRes.arrayBuffer());
        const path = `${productId}/zoho_${i}.jpg`;
        const { error } = await supabase.storage.from('watch-images').upload(path, buf, { contentType: 'image/jpeg', upsert: true });
        if (error) continue;
        const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path);
        await supabase.from('product_images').insert({ product_id: productId, url: publicUrl, position: i });
        uploaded++;
      }
      return uploaded;
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
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const path = `${productId}/zoho_0.jpg`;
    const { error } = await supabase.storage.from('watch-images').upload(path, buf, { contentType: 'image/jpeg', upsert: true });
    if (error) return 0;
    const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path);
    await supabase.from('product_images').insert({ product_id: productId, url: publicUrl, position: 0 });
    return 1;
  } catch (e) {
    console.error(`syncGalleryImages error for ${itemId}:`, e);
    return 0;
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).send('OK');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // SO-triggered payload from Zoho Deluge: { committed_sku, action: "sold" }
    // Process BEFORE responding — Vercel kills the execution context after res.end()
    const { committed_sku, action } = req.body || {};
    if (committed_sku && action === 'sold') {
      const { data: products } = await supabase
        .from('products').select('id, status').eq('reference', committed_sku).eq('source', 'zoho');
      for (const product of products || []) {
        if (product.status !== 'sold' && product.status !== 'reserved') {
          await supabase.from('products').update({ status: 'sold' }).eq('id', product.id);
          console.log(`Webhook: SO committed — marked ${committed_sku} as sold`);
        }
      }
      return res.status(200).json({ ok: true });
    }

    // Respond immediately so Zoho doesn't time out waiting
    res.status(200).json({ ok: true });

    const item = req.body?.item;
    if (!item) return;

    const sku = item.sku;
    const itemId = item.item_id ? String(item.item_id) : null;
    if (!sku && !itemId) return;

    const availForSale = item.available_for_sale_stock;
    const committedStock = item.committed_stock;
    const stage = extractStage(item);
    const purchaseRate = item.purchase_rate;

    if (availForSale === undefined || availForSale === null) {
      console.log(`Webhook: skipping ${sku} — available_for_sale_stock missing from payload`);
      return;
    }
    if (!stage) {
      console.log(`Webhook: skipping ${sku} — cf_stage missing from payload`);
      return;
    }

    const isCommitted = Number(committedStock ?? 0) > 0;
    const shouldBeLive = stage === 'Per oferte' && Number(availForSale) >= 1 && !isCommitted;

    // Always look up by zoho_item_id first (reliable, always present), then fall
    // back to reference. This prevents misses when reference is null in the DB
    // because the list API returned sku as empty at initial sync time.
    let products, fetchErr;
    if (itemId) {
      ({ data: products, error: fetchErr } = await supabase
        .from('products').select('id, status, cost_eur, reference, zoho_item_id')
        .eq('source', 'zoho').eq('zoho_item_id', itemId));
    }
    if (!products?.length && sku) {
      ({ data: products, error: fetchErr } = await supabase
        .from('products').select('id, status, cost_eur, reference, zoho_item_id')
        .eq('source', 'zoho').eq('reference', sku));
    }

    if (fetchErr || !products?.length) {
      // Product not in DB yet — create it if it should be live
      if (!shouldBeLive || !itemId) {
        console.log(`Webhook: no product for ${sku || itemId}, not live — skipping`);
        return;
      }
      try {
        console.log(`Webhook: ${sku} should be live but not in DB — creating`);
        const accessToken = await getAccessToken();
        const fullItem = await fetchFullItem(accessToken, itemId);
        if (!fullItem) {
          console.log(`Webhook: couldn't fetch full item for ${sku}`);
          return;
        }
        const mapped = mapZohoItem(fullItem);
        const { data: upserted, error: upsertErr } = await supabase
          .from('products').upsert(mapped, { onConflict: 'zoho_item_id' }).select('id').single();
        if (upsertErr || !upserted?.id) {
          console.error(`Webhook: upsert failed for ${sku}:`, upsertErr?.message);
          return;
        }
        const imagesAdded = await syncGalleryImages(accessToken, itemId, upserted.id);
        console.log(`Webhook: created ${sku} (${upserted.id}), ${imagesAdded} images`);
      } catch (e) {
        console.error(`Webhook: create failed for ${sku}:`, e.message);
      }
      return;
    }

    for (const product of products) {
      const updates = {};

      const newStatus = shouldBeLive ? 'available' : 'sold';
      if (product.status !== newStatus && product.status !== 'reserved') {
        updates.status = newStatus;
      }

      if (purchaseRate && Number(purchaseRate) > 0 && !product.cost_eur) {
        updates.cost_eur = Number(purchaseRate);
      }
      // Backfill missing reference/zoho_item_id — happens when list API returned
      // sku as empty at creation time but the webhook payload has it correctly.
      if (sku && !product.reference) updates.reference = sku;
      if (itemId && !product.zoho_item_id) updates.zoho_item_id = itemId;

      if (Object.keys(updates).length > 0) {
        const { error: updateErr } = await supabase.from('products').update(updates).eq('id', product.id);
        if (updateErr) console.error(`Webhook: update failed for ${sku} (${product.id}):`, updateErr.message);
        else console.log(`Webhook: updated ${sku} →`, updates);
      }

      // If newly made live and has no images, fetch them now
      if (shouldBeLive && updates.status === 'available' && itemId) {
        const { count } = await supabase.from('product_images')
          .select('id', { count: 'exact', head: true }).eq('product_id', product.id);
        if (!count) {
          try {
            const accessToken = await getAccessToken();
            const imagesAdded = await syncGalleryImages(accessToken, itemId, product.id);
            console.log(`Webhook: fetched ${imagesAdded} images for reactivated ${sku}`);
          } catch (e) { console.error(`Webhook: image sync failed for ${sku}:`, e.message); }
        }
      }
    }
  } catch (e) {
    console.error('Webhook processing error:', e.message);
  }
}
