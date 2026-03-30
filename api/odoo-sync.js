import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB = process.env.ODOO_DB;
const ODOO_USER_ID = parseInt(process.env.ODOO_USER_ID);
const ODOO_API_KEY = process.env.ODOO_API_KEY;

async function odooCall(model, method, args, kwargs = {}) {
  const body = `<?xml version="1.0"?>
<methodCall>
  <methodName>execute_kw</methodName>
  <params>
    <param><value><string>${ODOO_DB}</string></value></param>
    <param><value><int>${ODOO_USER_ID}</int></value></param>
    <param><value><string>${ODOO_API_KEY}</string></value></param>
    <param><value><string>${model}</string></value></param>
    <param><value><string>${method}</string></value></param>
    <param><value><array><data>${args}</data></array></value></param>
    <param><value><struct>${kwargs}</struct></value></param>
  </params>
</methodCall>`;

  const res = await fetch(`${ODOO_URL}/xmlrpc/2/object`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body
  });
  const text = await res.text();
  return text;
}

function parseXmlValue(xml) {
  // Parse a simple XML-RPC response into JS objects
  const extractValue = (str) => {
    // int
    let m = str.match(/<int>(\d+)<\/int>/);
    if (m) return parseInt(m[1]);
    // double
    m = str.match(/<double>([^<]+)<\/double>/);
    if (m) return parseFloat(m[1]);
    // boolean
    m = str.match(/<boolean>([01])<\/boolean>/);
    if (m) return m[1] === '1';
    // string
    m = str.match(/<string>([^<]*)<\/string>/);
    if (m) return m[1];
    // nil
    if (str.includes('<nil/>')) return null;
    return null;
  };

  // Parse array of structs
  const structs = [];
  const structRegex = /<struct>([\s\S]*?)<\/struct>/g;
  let structMatch;
  while ((structMatch = structRegex.exec(xml)) !== null) {
    const struct = {};
    const memberRegex = /<member>\s*<name>([^<]+)<\/name>\s*<value>([\s\S]*?)<\/value>\s*<\/member>/g;
    let memberMatch;
    while ((memberMatch = memberRegex.exec(structMatch[1])) !== null) {
      const key = memberMatch[1];
      const valStr = memberMatch[2];
      // Handle array values (like categ_id which is [id, name])
      if (valStr.includes('<array>')) {
        const arrayInts = [...valStr.matchAll(/<int>(\d+)<\/int>/g)].map(m => parseInt(m[1]));
        const arrayStrs = [...valStr.matchAll(/<string>([^<]*)<\/string>/g)].map(m => m[1]);
        if (arrayInts.length > 0 && arrayStrs.length > 0) {
          struct[key] = [arrayInts[0], arrayStrs[0]];
        } else if (arrayStrs.length > 0) {
          struct[key] = arrayStrs[0];
        } else {
          struct[key] = arrayInts;
        }
      } else {
        struct[key] = extractValue(valStr);
      }
    }
    if (Object.keys(struct).length > 0) structs.push(struct);
  }
  return structs;
}

async function fetchOdooJewellery(offset = 0, limit = 5) {
  // Filter: active=true, sale_ok=true, category contains "Jewel" or "jewel"
  const args = `<value><array><data>
    <value><array><data>
      <value><array><data>
        <value><string>sale_ok</string></value>
        <value><string>=</string></value>
        <value><boolean>1</boolean></value>
      </data></array></value>
      <value><array><data>
        <value><string>active</string></value>
        <value><string>=</string></value>
        <value><boolean>1</boolean></value>
      </data></array></value>
      <value><array><data>
        <value><string>categ_id.name</string></value>
        <value><string>ilike</string></value>
        <value><string>jewel</string></value>
      </data></array></value>
    </data></array></value>
  </data></array></value>`;

  const kwargs = `
    <member><name>fields</name><value><array><data>
      <value><string>id</string></value>
      <value><string>name</string></value>
      <value><string>default_code</string></value>
      <value><string>list_price</string></value>
      <value><string>categ_id</string></value>
      <value><string>description_sale</string></value>
      <value><string>image_1920</string></value>
    </data></array></value></member>
    <member><name>limit</name><value><int>${limit}</int></value></member>
    <member><name>offset</name><value><int>${offset}</int></value></member>
  `;

  const xml = await odooCall('product.template', 'search_read', args, kwargs);
  return parseXmlValue(xml);
}

async function fetchOdooBrand(productId) {
  // Fetch brand via separate call since it's a Many2one field
  const args = `<value><array><data>
    <value><array><data>
      <value><array><data>
        <value><string>id</string></value>
        <value><string>=</string></value>
        <value><int>${productId}</int></value>
      </data></array></value>
    </data></array></value>
  </data></array></value>`;

  const kwargs = `
    <member><name>fields</name><value><array><data>
      <value><string>id</string></value>
      <value><string>name</string></value>
      <value><string>x_brand</string></value>
      <value><string>product_brand_id</string></value>
    </data></array></value></member>
    <member><name>limit</name><value><int>1</int></value></member>
  `;

  const xml = await odooCall('product.template', 'search_read', args, kwargs);
  const results = parseXmlValue(xml);
  if (results.length > 0) {
    const item = results[0];
    // Try different brand field names
    if (item.product_brand_id && Array.isArray(item.product_brand_id)) return item.product_brand_id[1];
    if (item.x_brand) return item.x_brand;
  }
  return null;
}

async function countOdooJewellery() {
  const args = `<value><array><data>
    <value><array><data>
      <value><array><data>
        <value><string>sale_ok</string></value>
        <value><string>=</string></value>
        <value><boolean>1</boolean></value>
      </data></array></value>
      <value><array><data>
        <value><string>active</string></value>
        <value><string>=</string></value>
        <value><boolean>1</boolean></value>
      </data></array></value>
      <value><array><data>
        <value><string>categ_id.name</string></value>
        <value><string>ilike</string></value>
        <value><string>jewel</string></value>
      </data></array></value>
    </data></array></value>
  </data></array></value>`;

  const xml = await odooCall('product.template', 'search_count', args, '');
  const m = xml.match(/<int>(\d+)<\/int>/);
  return m ? parseInt(m[1]) : 0;
}

function mapOdooItem(item) {
  // Extract brand from name if not in separate field
  // Name format: "Brand ModelName Reference"
  const name = item.name || '';
  const reference = item.default_code || null;
  const priceEur = item.list_price || null;
  const notes = item.description_sale && item.description_sale.trim() ? item.description_sale.trim() : null;

  return {
    odoo_product_id: String(item.id),
    source: 'odoo',
    brand: 'Unknown', // will be updated with brand fetch
    model: name.trim(),
    reference,
    price_eur: priceEur,
    condition: 'pre-owned conditions with MINOR signs of usage',
    status: 'available',
    category: 'Jewellery',
    notes,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { batch_size = 5, offset = 0 } = req.body || {};

  try {
    const totalCount = await countOdooJewellery();
    const items = await fetchOdooJewellery(offset, batch_size);

    if (!items || items.length === 0) {
      return res.status(200).json({ success: true, done: true, processed: 0, total: totalCount });
    }

    // Get existing Odoo items
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
      const mapped = mapOdooItem(item);
      const isExisting = !!existingMap[mapped.odoo_product_id];

      // Try to get brand
      const brandXml = await odooCall('product.template', 'search_read',
        `<value><array><data>
          <value><array><data>
            <value><array><data>
              <value><string>id</string></value>
              <value><string>=</string></value>
              <value><int>${item.id}</int></value>
            </data></array></value>
          </data></array></value>
        </data></array></value>`,
        `<member><name>fields</name><value><array><data>
          <value><string>product_brand_id</string></value>
          <value><string>x_brand</string></value>
        </data></array></value></member>
        <member><name>limit</name><value><int>1</int></value></member>`
      );
      const brandResults = parseXmlValue(brandXml);
      if (brandResults.length > 0) {
        const b = brandResults[0];
        if (b.product_brand_id && Array.isArray(b.product_brand_id)) {
          mapped.brand = b.product_brand_id[1];
        } else if (b.x_brand) {
          mapped.brand = b.x_brand;
        }
      }

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
          const base64Data = item.image_1920;
          const buffer = Buffer.from(base64Data, 'base64');
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
