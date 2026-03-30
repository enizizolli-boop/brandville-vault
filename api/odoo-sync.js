import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB = process.env.ODOO_DB;
const ODOO_UID = parseInt(process.env.ODOO_USER_ID);
const ODOO_API_KEY = process.env.ODOO_API_KEY;

// Build XML-RPC value
function xmlVal(val) {
  if (val === null || val === undefined) return '<value><nil/></value>';
  if (typeof val === 'boolean') return `<value><boolean>${val ? 1 : 0}</boolean></value>`;
  if (typeof val === 'number' && Number.isInteger(val)) return `<value><int>${val}</int></value>`;
  if (typeof val === 'number') return `<value><double>${val}</double></value>`;
  if (typeof val === 'string') return `<value><string>${val}</string></value>`;
  if (Array.isArray(val)) return `<value><array><data>${val.map(xmlVal).join('')}</data></array></value>`;
  if (typeof val === 'object') {
    const members = Object.entries(val).map(([k, v]) => `<member><name>${k}</name>${xmlVal(v)}</member>`).join('');
    return `<value><struct>${members}</struct></value>`;
  }
  return `<value><string>${String(val)}</string></value>`;
}

async function xmlrpc(method, params) {
  const body = `<?xml version="1.0"?>
<methodCall>
  <methodName>${method}</methodName>
  <params>${params.map(p => `<param>${xmlVal(p)}</param>`).join('')}</params>
</methodCall>`;

  const res = await fetch(`${ODOO_URL}/xmlrpc/2/object`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body
  });
  const text = await res.text();
  return parseXmlRpcResponse(text);
}

function parseXmlRpcResponse(xml) {
  // Check for fault
  if (xml.includes('<fault>')) {
    const msg = xml.match(/<name>faultString<\/name>\s*<value><string>([^<]*)<\/string>/)?.[1] || 'XML-RPC fault';
    throw new Error(msg);
  }

  function parseValue(node) {
    const intMatch = node.match(/^<int>(\d+)<\/int>$/) || node.match(/^<i4>(\d+)<\/i4>$/);
    if (intMatch) return parseInt(intMatch[1]);

    const doubleMatch = node.match(/^<double>([^<]+)<\/double>$/);
    if (doubleMatch) return parseFloat(doubleMatch[1]);

    const boolMatch = node.match(/^<boolean>([01])<\/boolean>$/);
    if (boolMatch) return boolMatch[1] === '1';

    const strMatch = node.match(/^<string>([\s\S]*)<\/string>$/);
    if (strMatch) return strMatch[1];

    if (node === '<nil/>') return null;

    if (node.startsWith('<array>')) {
      const dataContent = node.replace(/^<array><data>/, '').replace(/<\/data><\/array>$/, '');
      return parseValueList(dataContent);
    }

    if (node.startsWith('<struct>')) {
      const obj = {};
      const memberRegex = /<member><name>([^<]+)<\/name><value>([\s\S]*?)<\/value><\/member>/g;
      let m;
      while ((m = memberRegex.exec(node)) !== null) {
        obj[m[1]] = parseValue(m[2].trim());
      }
      return obj;
    }

    // Try to extract any string
    const anyStr = node.match(/<string>([\s\S]*?)<\/string>/)?.[1];
    if (anyStr !== undefined) return anyStr;
    const anyInt = node.match(/<int>(\d+)<\/int>/)?.[1];
    if (anyInt !== undefined) return parseInt(anyInt);

    return node;
  }

  function parseValueList(content) {
    const results = [];
    const valueRegex = /<value>([\s\S]*?)<\/value>/g;
    let m;
    while ((m = valueRegex.exec(content)) !== null) {
      results.push(parseValue(m[1].trim()));
    }
    return results;
  }

  // Normalize whitespace
  const normalized = xml.replace(/>\s+</g, '><').trim();

  // Extract the response value
  const paramMatch = normalized.match(/<params><param><value>([\s\S]*?)<\/value><\/param><\/params>/);
  if (!paramMatch) return null;

  return parseValue(paramMatch[1].trim());
}

async function odooExecute(model, method, domain, kwargs = {}) {
  return xmlrpc('execute_kw', [
    ODOO_DB,
    ODOO_UID,
    ODOO_API_KEY,
    model,
    method,
    [domain],
    kwargs
  ]);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { batch_size = 5, offset = 0 } = req.body || {};

  try {
    const domain = [
      ['sale_ok', '=', true],
      ['active', '=', true],
      ['categ_id.name', 'ilike', 'jewel'],
    ];

    // Count items
    const totalCount = await odooExecute('product.template', 'search_count', domain);

    // Fetch batch
    const items = await odooExecute('product.template', 'search_read', domain, {
      fields: ['id', 'name', 'default_code', 'list_price', 'categ_id', 'description_sale', 'image_1920'],
      limit: batch_size,
      offset: offset,
    });

    if (!items || items.length === 0) {
      return res.status(200).json({ success: true, done: true, processed: 0, total: totalCount });
    }

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
      let brand = 'Unknown';
      // Brand is stored separately - for now extract from name if possible
      // Name format often: "BrandName ModelRef Description"
      // Will be fixed once we identify the correct brand field
      if (item.name) {
        // Try to match known brands in the name
        const knownBrands = ['Van Cleef', 'Cartier', 'Bulgari', 'Chanel', 'Chopard', 'Rolex',
          'Omega', 'Hermès', 'Louis Vuitton', 'Gucci', 'Prada', 'Dior', 'Tiffany', 'Harry Winston',
          'Graff', 'Piaget', 'De Beers', 'Mikimoto'];
        for (const b of knownBrands) {
          if (item.name.toLowerCase().includes(b.toLowerCase())) {
            brand = b === 'Van Cleef' ? 'Van Cleef & Arpels' : b;
            break;
          }
        }
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

      // Upload image
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
