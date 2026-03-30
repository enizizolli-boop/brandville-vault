import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB = process.env.ODOO_DB;
const ODOO_USER_ID = parseInt(process.env.ODOO_USER_ID);
const ODOO_API_KEY = process.env.ODOO_API_KEY;

async function odooRPC(model, method, args, kwargs = {}) {
  const res = await fetch(`${ODOO_URL}/web/dataset/call_kw`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      id: 1,
      params: {
        model,
        method,
        args,
        kwargs: {
          context: { lang: 'en_US' },
          ...kwargs,
        },
      },
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.data?.message || data.error.message || 'Odoo RPC error');
  return data.result;
}

async function authenticate() {
  const res = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: {
        db: ODOO_DB,
        login: process.env.ODOO_EMAIL,
        password: ODOO_API_KEY,
      },
    }),
  });
  const data = await res.json();
  if (!data.result?.uid) throw new Error('Odoo authentication failed');
  // Extract session cookie
  const cookie = res.headers.get('set-cookie');
  return { uid: data.result.uid, cookie };
}

async function odooRPCWithSession(sessionCookie, model, method, args, kwargs = {}) {
  const res = await fetch(`${ODOO_URL}/web/dataset/call_kw`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': sessionCookie,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      id: 1,
      params: {
        model,
        method,
        args,
        kwargs: {
          context: { lang: 'en_US' },
          ...kwargs,
        },
      },
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.data?.message || data.error.message || 'Odoo RPC error');
  return data.result;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { batch_size = 5, offset = 0 } = req.body || {};

  try {
    // Authenticate and get session
    const { uid, cookie } = await authenticate();

    // Count jewellery items
    const domain = [
      ['sale_ok', '=', true],
      ['active', '=', true],
      ['categ_id.name', 'ilike', 'jewel'],
    ];

    const totalCount = await odooRPCWithSession(cookie, 'product.template', 'search_count', [domain]);

    // Fetch batch of items
    const items = await odooRPCWithSession(cookie, 'product.template', 'search_read', [domain], {
      fields: ['id', 'name', 'default_code', 'list_price', 'categ_id', 'description_sale', 'product_brand_id', 'image_1920'],
      limit: batch_size,
      offset: offset,
    });

    if (!items || items.length === 0) {
      return res.status(200).json({ success: true, done: true, processed: 0, total: totalCount });
    }

    // Get existing Odoo items in Supabase
    const odooIds = items.map(i => String(i.id));
    const { data: existingItems } = await supabase
      .from('watches')
      .select('id, odoo_product_id')
      .eq('source', 'odoo')
      .in('odoo_product_id', odooIds);

    const existingMap = {};
    (existingItems || []).forEach(i => { existingMap[i.odoo_product_id] = i.id; });

    let added = 0;
    let updated = 0;
    let imagesAdded = 0;
    const errors = [];

    for (const item of items) {
      // Extract brand
      let brand = 'Unknown';
      if (item.product_brand_id && Array.isArray(item.product_brand_id) && item.product_brand_id.length > 1) {
        brand = item.product_brand_id[1];
      }

      const mapped = {
        odoo_product_id: String(item.id),
        source: 'odoo',
        brand,
        model: (item.name || '').trim(),
        reference: item.default_code || null,
        price_eur: item.list_price || null,
        condition: 'pre-owned conditions with MINOR signs of usage',
        status: 'available',
        category: 'Jewellery',
        notes: item.description_sale && item.description_sale.trim() ? item.description_sale.trim() : null,
      };

      const isExisting = !!existingMap[mapped.odoo_product_id];

      const { data: upserted, error } = await supabase
        .from('watches')
        .upsert(mapped, { onConflict: 'odoo_product_id' })
        .select('id')
        .single();

      if (error) {
        errors.push({ item: mapped.odoo_product_id, error: error.message });
        continue;
      }

      const watchId = upserted?.id || existingMap[mapped.odoo_product_id];
      isExisting ? updated++ : added++;

      // Handle image — stored as base64 in image_1920
      if (watchId && item.image_1920 && item.image_1920 !== false) {
        try {
          const buffer = Buffer.from(item.image_1920, 'base64');
          const path = `${watchId}/odoo_primary.jpg`;
          await supabase.storage.from('watch-images').remove([path]);
          const { error: uploadError } = await supabase.storage
            .from('watch-images')
            .upload(path, buffer, { contentType: 'image/jpeg', upsert: true });

          if (!uploadError) {
            const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path);
            await supabase.from('watch_images').delete().eq('watch_id', watchId);
            await supabase.from('watch_images').insert({ watch_id: watchId, url: publicUrl, position: 0 });
            imagesAdded++;
          }
        } catch (imgErr) {
          console.error('Image error:', imgErr);
        }
      }
    }

    const nextOffset = offset + batch_size;
    const done = nextOffset >= totalCount;

    return res.status(200).json({
      success: true,
      added,
      updated,
      images_added: imagesAdded,
      processed: items.length,
      offset,
      next_offset: done ? null : nextOffset,
      total: totalCount,
      done,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('Odoo sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
