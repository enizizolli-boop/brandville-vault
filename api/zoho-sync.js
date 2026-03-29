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

async function downloadAndUploadImage(accessToken, zohoItemId, watchId) {
  try {
    // Fetch image from Zoho
    const imageRes = await fetch(
      `https://www.zohoapis.eu/inventory/v1/items/${zohoItemId}/image?organization_id=${process.env.ZOHO_ORG_ID}`,
      { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
    );

    if (!imageRes.ok) return null;

    const contentType = imageRes.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const arrayBuffer = await imageRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to Supabase storage
    const path = `${watchId}/zoho_primary.${ext}`;

    // Remove existing image first
    await supabase.storage.from('watch-images').remove([path]);

    const { error: uploadError } = await supabase.storage
      .from('watch-images')
      .upload(path, buffer, { contentType, upsert: true });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return null;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('watch-images')
      .getPublicUrl(path);

    return publicUrl;
  } catch (err) {
    console.error('Image download/upload error:', err);
    return null;
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

  const testMode = req.body?.test_mode === true;

  try {
    const accessToken = await getAccessToken();
    const allItems = await fetchAllItems(accessToken);

    // Only items listed on Zoho Commerce storefront
    let zohoItems = allItems.filter(item => item.show_in_storefront === true);

    // Test mode: only process 1 item that has an image
    if (testMode) {
      const withImage = zohoItems.find(i => i.image_document_id);
      zohoItems = withImage ? [withImage] : [zohoItems[0]];
    }

    const zohoIds = zohoItems.map(i => String(i.item_id));

    const { data: existingItems } = await supabase
      .from('watches')
      .select('id, zoho_item_id')
      .eq('source', 'zoho');

    const existingZohoIds = (existingItems || []).map(i => i.zoho_item_id);
    const existingMap = {};
    (existingItems || []).forEach(i => { existingMap[i.zoho_item_id] = i.id; });

    // Only delete if NOT in test mode
    let removed = 0;
    if (!testMode) {
      const toDelete = existingZohoIds.filter(id => !zohoIds.includes(id));
      if (toDelete.length > 0) {
        await supabase.from('watches').delete().in('zoho_item_id', toDelete);
        removed = toDelete.length;
      }
    }

    let added = 0;
    let updated = 0;
    let imagesUploaded = 0;
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

      // Download and upload image if item has one
      if (watchId && zohoItem.image_document_id) {
        const publicUrl = await downloadAndUploadImage(accessToken, zohoItem.item_id, watchId);
        if (publicUrl) {
          // Delete old image records for this watch
          await supabase.from('watch_images').delete().eq('watch_id', watchId);
          // Insert new image record
          await supabase.from('watch_images').insert({
            watch_id: watchId,
            url: publicUrl,
            position: 0
          });
          imagesUploaded++;
        }
      }

      isExisting ? updated++ : added++;
    }

    return res.status(200).json({
      success: true,
      test_mode: testMode,
      added,
      updated,
      removed,
      images_uploaded: imagesUploaded,
      total_synced: zohoItems.length,
      total_on_store: allItems.filter(i => i.show_in_storefront === true).length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('Sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
