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

async function fetchAllLiveIds(accessToken) {
  let ids = [];
  let page = 1;
  const perPage = 200;
  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const url = `https://www.zohoapis.eu/inventory/v1/items?organization_id=${process.env.ZOHO_ORG_ID}&per_page=${perPage}&page=${page}&status=active`;
      const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }, signal: controller.signal });
      clearTimeout(timer);
      const data = await res.json();
      if (!data.items || data.items.length === 0) break;
      for (const item of data.items) {
        if (item.show_in_storefront !== true) continue;
        const stock = item.actual_available_stock ?? item.available_stock ?? item.stock_on_hand ?? 0;
        if (Number(stock) > 0) ids.push(String(item.item_id));
      }
      if (data.items.length < perPage) break;
      page++;
    } catch {
      clearTimeout(timer);
      // Any page failure means the list is incomplete — return null to signal abort
      return null;
    }
  }
  return ids;
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

  const condition = item.cf_conditions && item.cf_conditions.trim() ? item.cf_conditions.trim() : 'Pre-owned';

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
    // Log invocation time immediately so sync_log always reflects last run
    await supabase.from('sync_log').upsert({
      key: 'sync_zoho',
      last_sync_at: new Date().toISOString(),
      result: { status: 'running' },
    });

    const accessToken = await getAccessToken();

    // Only fetch items modified in the last 35 minutes
    const recentItems = await fetchRecentItems(accessToken, 35);

    // Filter: must be on storefront with stock
    const liveItems = recentItems.filter(item => {
      if (item.show_in_storefront !== true) return false;
      const stock = item.actual_available_stock ?? item.available_stock ?? item.stock_on_hand ?? 0;
      return Number(stock) > 0;
    });

    // Items recently modified but now out of stock/off storefront → mark sold
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
    let imagesAdded = 0;
    if (liveItems.length > 0) {
      const liveIds = liveItems.map(i => String(i.item_id));

      // Find which items are brand new (no existing DB record) — fetch images for those
      const { data: existingRows } = await supabase
        .from('products')
        .select('zoho_item_id')
        .in('zoho_item_id', liveIds)
        .eq('source', 'zoho');
      const existingSet = new Set((existingRows || []).map(r => r.zoho_item_id));
      const newItems = liveItems.filter(i => !existingSet.has(String(i.item_id)));

      // Preserve reserved status — upsert sets status:'available', which would wrongly
      // overwrite watches a dealer has reserved. Query first, restore after.
      const { data: reservedRows } = await supabase
        .from('products')
        .select('zoho_item_id')
        .in('zoho_item_id', liveIds)
        .eq('source', 'zoho')
        .eq('status', 'reserved');
      const reservedIds = new Set((reservedRows || []).map(r => r.zoho_item_id));

      const rows = liveItems.map(mapZohoItem);
      const { data: upsertedRows } = await supabase
        .from('products')
        .upsert(rows, { onConflict: 'zoho_item_id' })
        .select('id, zoho_item_id');
      upserted = rows.length;

      if (reservedIds.size > 0) {
        await supabase.from('products')
          .update({ status: 'reserved' })
          .in('zoho_item_id', [...reservedIds])
          .eq('source', 'zoho');
      }

      // Fetch full image gallery for new items only
      if (newItems.length > 0 && upsertedRows) {
        const idMap = {};
        upsertedRows.forEach(r => { idMap[r.zoho_item_id] = r.id; });
        for (const item of newItems) {
          const productId = idMap[String(item.item_id)];
          if (!productId) continue;
          try {
            const listRes = await fetch(
              `https://www.zohoapis.eu/inventory/v1/items/${item.item_id}/images?organization_id=${process.env.ZOHO_ORG_ID}`,
              { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
            );
            const listData = await listRes.json();
            if (listData.images && listData.images.length > 0) {
              await supabase.from('product_images').delete().eq('product_id', productId);
              for (let i = 0; i < listData.images.length; i++) {
                const docId = listData.images[i].image_document_id;
                if (!docId) continue;
                const imgRes = await fetch(
                  `https://www.zohoapis.eu/inventory/v1/items/${item.item_id}/image?organization_id=${process.env.ZOHO_ORG_ID}&document_id=${docId}`,
                  { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
                );
                if (!imgRes.ok) continue;
                const buffer = Buffer.from(await imgRes.arrayBuffer());
                const path = `${productId}/zoho_${i}.jpg`;
                const { error: upErr } = await supabase.storage.from('watch-images').upload(path, buffer, { contentType: 'image/jpeg', upsert: true });
                if (upErr) continue;
                const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path);
                await supabase.from('product_images').insert({ product_id: productId, url: publicUrl, position: i });
                imagesAdded++;
              }
            } else if (item.image_document_id) {
              // Gallery empty — fall back to primary image
              const imgRes = await fetch(
                `https://www.zohoapis.eu/inventory/v1/items/${item.item_id}/image?organization_id=${process.env.ZOHO_ORG_ID}`,
                { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
              );
              if (imgRes.ok) {
                const buffer = Buffer.from(await imgRes.arrayBuffer());
                const path = `${productId}/zoho_0.jpg`;
                const { error: upErr } = await supabase.storage.from('watch-images').upload(path, buffer, { contentType: 'image/jpeg', upsert: true });
                if (!upErr) {
                  const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path);
                  await supabase.from('product_images').insert({ product_id: productId, url: publicUrl, position: 0 });
                  imagesAdded++;
                }
              }
            }
          } catch (e) { console.error(`Cron image error for item ${item.item_id}:`, e); }
        }
      }
    }

    await supabase.from('sync_log').upsert({
      key: 'sync_zoho',
      last_sync_at: new Date().toISOString(),
      result: { status: 'done', upserted, marked_sold: offItems.length, total_recent: recentItems.length, images_added: imagesAdded },
    });

    return res.status(200).json({
      success: true,
      upserted,
      marked_sold: offItems.length,
      total_recent: recentItems.length,
      images_added: imagesAdded,
    });
  } catch (err) {
    console.error('Cron Zoho sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
