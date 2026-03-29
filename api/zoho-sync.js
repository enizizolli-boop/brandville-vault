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

async function fetchAllItems(accessToken) {
  let items = [];
  let page = 1;
  const perPage = 200;
  while (true) {
    const url = `https://www.zohoapis.eu/inventory/v1/items?organization_id=${process.env.ZOHO_ORG_ID}&per_page=${perPage}&page=${page}&status=active`;
    const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } });
    const data = await res.json();
    if (!data.items || data.items.length === 0) break;
    items = items.concat(data.items);
    if (data.items.length < perPage) break;
    page++;
  }
  return items;
}

async function fetchItemImages(accessToken, itemId) {
  try {
    const url = `https://www.zohoapis.eu/inventory/v1/items/${itemId}?organization_id=${process.env.ZOHO_ORG_ID}`;
    const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } });
    const data = await res.json();
    const item = data.item;
    if (!item) return [];

    const images = [];

    // Primary image
    if (item.image_document_id) {
      images.push({
        url: `https://www.zohoapis.eu/inventory/v1/items/${itemId}/image?organization_id=${process.env.ZOHO_ORG_ID}&authtoken=${accessToken}`,
        position: 0
      });
    }

    // Additional images from documents
    if (item.documents && Array.isArray(item.documents)) {
      item.documents.forEach((doc, i) => {
        if (doc.file_type && ['jpeg','jpg','png','webp'].includes(doc.file_type.toLowerCase())) {
          images.push({
            url: `https://www.zohoapis.eu/inventory/v1/items/${itemId}/documents/${doc.document_id}?organization_id=${process.env.ZOHO_ORG_ID}`,
            position: i + 1
          });
        }
      });
    }

    return images;
  } catch {
    return [];
  }
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

function mapCondition(raw) {
  if (!raw) return 'Fair';
  if (ALLOWED_CONDITIONS.includes(raw)) return raw;
  const lower = raw.toLowerCase();
  if (lower.includes('minor')) return 'pre-owned conditions with MINOR signs of usage';
  if (lower.includes('major')) return 'pre-owned conditions with MAJOR signs of usage';
  if (lower.includes('albania')) return 'Repaired Albania';
  if (lower.includes('repaired')) return 'Repaired';
  if (lower.includes('repair')) return 'Needs Repair';
  return 'Fair';
}

function mapZohoItem(item) {
  const brand = (item.cf_brand || item.brand || 'Unknown').trim();
  const model = (item.cf_model || item.name || 'Unknown').trim();
  const reference = item.sku || null;
  const priceEur = item.rate || null;
  const condition = mapCondition(item.cf_conditions);
  const scopeRaw = item.cf_scope_of_delivery || null;
  const scopeOfDelivery = ALLOWED_SCOPES.includes(scopeRaw) ? scopeRaw : null;
  // Only use description if it's non-empty and not just whitespace
  const notes = item.description && item.description.trim() ? item.description.trim() : null;

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
    notes,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const accessToken = await getAccessToken();
    const allItems = await fetchAllItems(accessToken);

    // Only items listed on Zoho Commerce storefront
    const zohoItems = allItems.filter(item => item.show_in_storefront === true);
    const zohoIds = zohoItems.map(i => String(i.item_id));

    const { data: existingItems } = await supabase
      .from('watches')
      .select('id, zoho_item_id')
      .eq('source', 'zoho');

    const existingZohoIds = (existingItems || []).map(i => i.zoho_item_id);
    const existingMap = {};
    (existingItems || []).forEach(i => { existingMap[i.zoho_item_id] = i.id; });

    // Remove items no longer on storefront
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

      const { data: upserted, error } = await supabase
        .from('watches')
        .upsert(mapped, { onConflict: 'zoho_item_id' })
        .select('id')
        .single();

      if (error) {
        errors.push({ item: mapped.zoho_item_id, error: error.message });
        continue;
      }

      const watchId = upserted?.id || existingMap[mapped.zoho_item_id];

      // Sync images only for new items (skip re-fetching for updated to save API calls)
      if (!isExisting && watchId && zohoItem.image_document_id) {
        // Delete old images first
        await supabase.from('watch_images').delete().eq('watch_id', watchId);

        // Primary image URL - direct Zoho image endpoint
        const imageUrl = `https://www.zohoapis.eu/inventory/v1/items/${zohoItem.item_id}/image?organization_id=${process.env.ZOHO_ORG_ID}&authtoken=${accessToken}`;
        await supabase.from('watch_images').insert({
          watch_id: watchId,
          url: imageUrl,
          position: 0
        });
      }

      isExisting ? updated++ : added++;
    }

    return res.status(200).json({
      success: true,
      added,
      updated,
      removed: toDelete.length,
      total: zohoItems.length,
      total_in_inventory: allItems.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('Sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
