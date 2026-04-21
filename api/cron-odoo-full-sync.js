import { createClient } from '@supabase/supabase-js';

// Vercel Pro: allow up to 300 seconds for this function
export const config = { maxDuration: 300 };

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB = process.env.ODOO_DB;
const ODOO_UID = parseInt(process.env.ODOO_USER_ID);
const ODOO_API_KEY = process.env.ODOO_API_KEY;
const JEWELRY_CATEG_ID = 8;
const BATCH_SIZE = 50; // larger batches since we skip images for existing items

const BRAND_MAP = {
  'bvlgari': 'Bulgari', 'bulgari': 'Bulgari',
  'van cleef': 'Van Cleef & Arpels', 'vca': 'Van Cleef & Arpels',
  'cartier': 'Cartier', 'chanel': 'Chanel', 'chopard': 'Chopard',
  'hermes': 'Hermès', 'hermès': 'Hermès',
  'louis vuitton': 'Louis Vuitton', 'gucci': 'Gucci', 'prada': 'Prada',
  'dior': 'Dior', 'tiffany': 'Tiffany & Co', 'harry winston': 'Harry Winston',
  'graff': 'Graff', 'piaget': 'Piaget', 'de beers': 'De Beers',
  'mikimoto': 'Mikimoto', 'rolex': 'Rolex', 'omega': 'Omega',
  'breitling': 'Breitling', 'patek': 'Patek Philippe',
  'audemars': 'Audemars Piguet', 'richard mille': 'Richard Mille',
  'iwc': 'IWC', 'jaeger': 'Jaeger-LeCoultre', 'vacheron': 'Vacheron Constantin',
};

const JEWELLERY_TYPE_MAP = {
  'bracelets': 'Bracelets', 'bracelet': 'Bracelets',
  'earrings': 'Earrings', 'earring': 'Earrings',
  'necklaces': 'Necklaces', 'necklace': 'Necklaces',
  'rings': 'Rings', 'ring': 'Rings',
  'pendants': 'Necklaces', 'pendant': 'Necklaces',
};

function domainToXml(domain) {
  return domain.map(([field, op, val]) => {
    let valXml;
    if (typeof val === 'boolean') valXml = `<value><boolean>${val ? 1 : 0}</boolean></value>`;
    else if (typeof val === 'number') valXml = `<value><int>${val}</int></value>`;
    else valXml = `<value><string>${val}</string></value>`;
    return `<value><array><data><value><string>${field}</string></value><value><string>${op}</string></value>${valXml}</data></array></value>`;
  }).join('');
}

function parseItems(xml) {
  const norm = xml.replace(/>\s+</g, '><');
  const items = [];
  const structRe = /<struct>([\s\S]*?)<\/struct>/g;
  let sm;
  while ((sm = structRe.exec(norm)) !== null) {
    const item = {};
    const memberRe = /<member><name>([^<]+)<\/name><value>([\s\S]*?)<\/value><\/member>/g;
    let mm;
    while ((mm = memberRe.exec(sm[1])) !== null) { item[mm[1]] = parseVal(mm[2]); }
    if (item.id !== undefined) items.push(item);
  }
  return items;
}

function parseVal(raw) {
  raw = raw.trim();
  let m;
  m = raw.match(/^<int>(\d+)<\/int>$/) || raw.match(/^<i4>(\d+)<\/i4>$/);
  if (m) return parseInt(m[1]);
  m = raw.match(/^<double>([^<]+)<\/double>$/);
  if (m) return parseFloat(m[1]);
  m = raw.match(/^<boolean>([01])<\/boolean>$/);
  if (m) return m[1] === '1';
  m = raw.match(/^<string>([\s\S]*)<\/string>$/);
  if (m) return m[1];
  m = raw.match(/^<base64>([\s\S]*)<\/base64>$/);
  if (m) return m[1].replace(/\s/g, '');
  if (raw === '<nil/>') return null;
  if (raw.startsWith('<array>')) {
    const intM = raw.match(/<int>(\d+)<\/int>/);
    const strM = raw.match(/<string>([^<]+)<\/string>/);
    if (intM && strM) return [parseInt(intM[1]), strM[1]];
    if (intM) return parseInt(intM[1]);
    return null;
  }
  m = raw.match(/<int>(\d+)<\/int>/); if (m) return parseInt(m[1]);
  return null;
}

async function odooReadProductImages(productTmplIds) {
  if (!productTmplIds.length) return [];
  const idsXml = productTmplIds.map(id => `<value><int>${id}</int></value>`).join('');
  const domainXml = `<value><array><data><value><string>product_tmpl_id</string></value><value><string>in</string></value><value><array><data>${idsXml}</data></array></value></data></array></value>`;
  const body = `<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>` +
    `<param><value><string>${ODOO_DB}</string></value></param>` +
    `<param><value><int>${ODOO_UID}</int></value></param>` +
    `<param><value><string>${ODOO_API_KEY}</string></value></param>` +
    `<param><value><string>product.image</string></value></param>` +
    `<param><value><string>search_read</string></value></param>` +
    `<param><value><array><data><value><array><data>${domainXml}</data></array></value></data></array></value></param>` +
    `<param><value><struct>` +
    `<member><name>fields</name><value><array><data><value><string>product_tmpl_id</string></value><value><string>image_1920</string></value><value><string>sequence</string></value></data></array></value></member>` +
    `<member><name>limit</name><value><int>500</int></value></member>` +
    `</struct></value></param></params></methodCall>`;
  const res = await fetch(ODOO_URL + '/xmlrpc/2/object', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body });
  const text = await res.text();
  if (text.includes('<fault>')) return [];
  return parseItems(text);
}

async function odooCount(domain) {
  const body = `<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>` +
    `<param><value><string>${ODOO_DB}</string></value></param>` +
    `<param><value><int>${ODOO_UID}</int></value></param>` +
    `<param><value><string>${ODOO_API_KEY}</string></value></param>` +
    `<param><value><string>product.template</string></value></param>` +
    `<param><value><string>search_count</string></value></param>` +
    `<param><value><array><data><value><array><data>${domainToXml(domain)}</data></array></value></data></array></value></param>` +
    `<param><value><struct></struct></value></param></params></methodCall>`;
  const res = await fetch(ODOO_URL + '/xmlrpc/2/object', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body });
  const text = await res.text();
  const m = text.match(/<int>(\d+)<\/int>/);
  return m ? parseInt(m[1]) : 0;
}

async function odooRead(domain, fields, limit, offset) {
  const fieldsXml = fields.map(f => `<value><string>${f}</string></value>`).join('');
  const body = `<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>` +
    `<param><value><string>${ODOO_DB}</string></value></param>` +
    `<param><value><int>${ODOO_UID}</int></value></param>` +
    `<param><value><string>${ODOO_API_KEY}</string></value></param>` +
    `<param><value><string>product.template</string></value></param>` +
    `<param><value><string>search_read</string></value></param>` +
    `<param><value><array><data><value><array><data>${domainToXml(domain)}</data></array></value></data></array></value></param>` +
    `<param><value><struct>` +
    `<member><name>fields</name><value><array><data>${fieldsXml}</data></array></value></member>` +
    `<member><name>limit</name><value><int>${limit}</int></value></member>` +
    `<member><name>offset</name><value><int>${offset}</int></value></member>` +
    `</struct></value></param></params></methodCall>`;
  const res = await fetch(ODOO_URL + '/xmlrpc/2/object', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body });
  const text = await res.text();
  if (text.includes('<fault>')) throw new Error('Odoo read fault: ' + text.substring(0, 200));
  return parseItems(text);
}

async function fetchSoldProductTemplateIds() {
  try {
    const body1 = `<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>` +
      `<param><value><string>${ODOO_DB}</string></value></param>` +
      `<param><value><int>${ODOO_UID}</int></value></param>` +
      `<param><value><string>${ODOO_API_KEY}</string></value></param>` +
      `<param><value><string>sale.order.line</string></value></param>` +
      `<param><value><string>search_read</string></value></param>` +
      `<param><value><array><data><value><array><data>` +
      `<value><array><data><value><string>order_id.state</string></value><value><string>!=</string></value><value><string>cancel</string></value></data></array></value>` +
      `</data></array></value></data></array></value></param>` +
      `<param><value><struct><member><name>fields</name><value><array><data><value><string>product_id</string></value></data></array></value></member>` +
      `<member><name>limit</name><value><int>5000</int></value></member></struct></value></param></params></methodCall>`;
    const res1 = await fetch(ODOO_URL + '/xmlrpc/2/object', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body: body1 });
    const lines = parseItems(await res1.text());
    const variantIds = [...new Set(lines.map(l => {
      const pid = Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;
      return typeof pid === 'number' ? pid : null;
    }).filter(Boolean))];
    if (!variantIds.length) return new Set();

    const idsXml = variantIds.map(id => `<value><int>${id}</int></value>`).join('');
    const body2 = `<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>` +
      `<param><value><string>${ODOO_DB}</string></value></param>` +
      `<param><value><int>${ODOO_UID}</int></value></param>` +
      `<param><value><string>${ODOO_API_KEY}</string></value></param>` +
      `<param><value><string>product.product</string></value></param>` +
      `<param><value><string>search_read</string></value></param>` +
      `<param><value><array><data><value><array><data>` +
      `<value><array><data><value><string>id</string></value><value><string>in</string></value><value><array><data>${idsXml}</data></array></value></data></array></value>` +
      `</data></array></value></data></array></value></param>` +
      `<param><value><struct><member><name>fields</name><value><array><data><value><string>product_tmpl_id</string></value></data></array></value></member>` +
      `<member><name>limit</name><value><int>5000</int></value></member></struct></value></param></params></methodCall>`;
    const res2 = await fetch(ODOO_URL + '/xmlrpc/2/object', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body: body2 });
    const variants = parseItems(await res2.text());
    const ids = new Set();
    for (const v of variants) {
      const tmplId = Array.isArray(v.product_tmpl_id) ? v.product_tmpl_id[0] : v.product_tmpl_id;
      if (typeof tmplId === 'number') ids.add(tmplId);
    }
    return ids;
  } catch (e) { console.error('fetchSoldIds error:', e); return new Set(); }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const startTime = Date.now();
  let added = 0, updated = 0, imagesAdded = 0, removed = 0;

  try {
    const domain = [['sale_ok', '=', true], ['active', '=', true], ['categ_id', '=', JEWELRY_CATEG_ID]];
    const [totalCount, soldTemplateIds] = await Promise.all([
      odooCount(domain),
      fetchSoldProductTemplateIds(),
    ]);

    // Remove stale items
    const allOdooItems = await odooRead(domain, ['id'], 5000, 0);
    const allOdooIds = allOdooItems.map(i => String(i.id));
    const { data: allExisting } = await supabase.from('products').select('odoo_product_id').eq('source', 'odoo').eq('category', 'Jewellery');
    const toDelete = (allExisting || []).map(i => i.odoo_product_id).filter(id => id && !allOdooIds.includes(id));
    if (toDelete.length > 0) {
      await supabase.from('products').delete().in('odoo_product_id', toDelete).eq('source', 'odoo').eq('category', 'Jewellery');
      removed = toDelete.length;
    }

    // Process all items in batches
    for (let offset = 0; offset < totalCount; offset += BATCH_SIZE) {
      // Stop if we're getting close to the 300s limit
      if (Date.now() - startTime > 270000) {
        console.log(`Stopping at offset ${offset} to avoid timeout`);
        break;
      }

      const items = await odooRead(
        domain,
        ['id', 'name', 'default_code', 'list_price', 'description_sale', 'image_1920', 'qty_available', 'virtual_available', 'categ_id'],
        BATCH_SIZE, offset
      );
      if (!items || items.length === 0) break;

      // Fetch extra images for this batch
      const extraImagesMap = {};
      try {
        const extraImgs = await odooReadProductImages(items.map(i => i.id));
        for (const img of extraImgs) {
          const tmplId = String(Array.isArray(img.product_tmpl_id) ? img.product_tmpl_id[0] : img.product_tmpl_id);
          if (!extraImagesMap[tmplId]) extraImagesMap[tmplId] = [];
          extraImagesMap[tmplId].push(img);
        }
        for (const key of Object.keys(extraImagesMap)) {
          extraImagesMap[key].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
        }
      } catch (e) { console.error('Extra images fetch error:', e); }

      const odooIds = items.map(i => String(i.id));
      const { data: existing } = await supabase.from('products')
        .select('id, odoo_product_id, status')
        .eq('source', 'odoo')
        .in('odoo_product_id', odooIds);
      const existingMap = {};
      (existing || []).forEach(i => { existingMap[i.odoo_product_id] = { id: i.id, status: i.status }; });

      for (const item of items) {
        let brand = 'Unknown';
        const nameLower = item.name?.toLowerCase() || '';
        const refLower = (item.default_code || '').toLowerCase();
        for (const [key, val] of Object.entries(BRAND_MAP)) {
          if (nameLower.includes(key) || refLower.includes(key)) { brand = val; break; }
        }

        const existingEntry = existingMap[String(item.id)];
        const isExisting = !!existingEntry;
        const currentStatus = existingEntry?.status;

        const qtyOnHand = item.qty_available != null ? item.qty_available : null;
        const qtyForecast = item.virtual_available != null ? item.virtual_available : null;
        const isSold = soldTemplateIds.has(item.id) ||
          (qtyOnHand !== null && qtyOnHand <= 0) ||
          (qtyForecast !== null && qtyForecast <= 0);

        const categName = Array.isArray(item.categ_id) ? item.categ_id[1] : (typeof item.categ_id === 'string' ? item.categ_id : null);
        const jewelleryType = categName ? (JEWELLERY_TYPE_MAP[categName.toLowerCase()] || null) : null;

        const mapped = {
          subcategory: jewelleryType,
          odoo_product_id: String(item.id),
          source: 'odoo',
          brand,
          model: (item.name || '').trim(),
          reference: item.default_code || null,
          price_eur: item.list_price || null,
          condition: 'Fair',
          ...(isSold ? { status: 'sold' } : currentStatus === 'sold' ? { status: 'available' } : isExisting ? {} : { status: 'available' }),
          category: 'Jewellery',
          notes: item.description_sale && typeof item.description_sale === 'string' ? item.description_sale.trim() || null : null,
        };

        let productId;
        if (isExisting) {
          const { error } = await supabase.from('products').update(mapped).eq('id', existingEntry.id);
          if (error) { console.error('update error', error.message); continue; }
          productId = existingEntry.id;
          updated++;
        } else {
          // Don't insert brand-new products that are already sold — only add available items
          if (isSold) continue;
          const { data: inserted, error } = await supabase.from('products').insert(mapped).select('id').single();
          if (error) { console.error('insert error', error.message); continue; }
          productId = inserted?.id;
          added++;
        }

        // Upload missing images — check how many are in DB vs how many Odoo has
        if (productId) {
          const extras = extraImagesMap[String(item.id)] || [];
          const odooTotal = (item.image_1920 && item.image_1920 !== false ? 1 : 0) + extras.length;
          if (odooTotal > 0) {
            const { count: dbCount } = await supabase.from('product_images')
              .select('id', { count: 'exact', head: true }).eq('product_id', productId);
            const existing = dbCount || 0;
            if (existing < odooTotal) {
              let position = existing;
              // Primary image (position 0)
              if (existing === 0 && item.image_1920 && item.image_1920 !== false) {
                try {
                  const buffer = Buffer.from(item.image_1920, 'base64');
                  const path = `${productId}/odoo_primary.jpg`;
                  const { error: upErr } = await supabase.storage.from('watch-images').upload(path, buffer, { contentType: 'image/jpeg', upsert: true });
                  if (!upErr) {
                    const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path);
                    await supabase.from('product_images').insert({ product_id: productId, url: publicUrl, position });
                    position++; imagesAdded++;
                  }
                } catch (e) { console.error('primary img error', e); }
              }
              // Extra images — only upload ones beyond what's already stored
              const extrasToUpload = extras.slice(Math.max(0, existing - 1));
              for (let i = 0; i < extrasToUpload.length; i++) {
                const extraImg = extrasToUpload[i];
                if (!extraImg.image_1920 || extraImg.image_1920 === false) continue;
                try {
                  const buffer = Buffer.from(extraImg.image_1920, 'base64');
                  const path = `${productId}/odoo_extra_${position}.jpg`;
                  const { error: upErr } = await supabase.storage.from('watch-images').upload(path, buffer, { contentType: 'image/jpeg', upsert: true });
                  if (!upErr) {
                    const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path);
                    await supabase.from('product_images').insert({ product_id: productId, url: publicUrl, position });
                    position++; imagesAdded++;
                  }
                } catch (e) { console.error('extra img error', e); }
              }
            }
          }
        }
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`Full sync done: +${added} added, ${updated} updated, ${removed} removed, ${imagesAdded} images, ${elapsed}s`);
    return res.status(200).json({ success: true, added, updated, removed, images_added: imagesAdded, total: totalCount, sold_on_order: soldTemplateIds.size, elapsed_seconds: elapsed });

  } catch (err) {
    console.error('Full sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
