import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB = process.env.ODOO_DB;
const ODOO_UID = parseInt(process.env.ODOO_USER_ID);
const ODOO_API_KEY = process.env.ODOO_API_KEY;

// Odoo eCommerce category ID for Handbags (from /shop/category/handbags-22)
// Covers all subcategories: Totes, Backpacks, Belt Bags, Pouches, Luggage, etc.
const BAGS_ECATEG_ID = 22;
const PRICE_MARKUP = 1.4; // cost + 40%

function domainToXml(domain) {
  return domain.map(([field, op, val]) => {
    let valXml;
    if (typeof val === 'boolean') valXml = '<value><boolean>' + (val ? 1 : 0) + '</boolean></value>';
    else if (Array.isArray(val)) {
      const arrXml = val.map(v => typeof v === 'number' ? '<value><int>' + v + '</int></value>' : '<value><string>' + v + '</string></value>').join('');
      valXml = '<value><array><data>' + arrXml + '</data></array></value>';
    } else if (typeof val === 'number') valXml = '<value><int>' + val + '</int></value>';
    else valXml = '<value><string>' + val + '</string></value>';
    return '<value><array><data><value><string>' + field + '</string></value><value><string>' + op + '</string></value>' + valXml + '</data></array></value>';
  }).join('');
}

async function odooCount(domain) {
  const body = '<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>' +
    '<param><value><string>' + ODOO_DB + '</string></value></param>' +
    '<param><value><int>' + ODOO_UID + '</int></value></param>' +
    '<param><value><string>' + ODOO_API_KEY + '</string></value></param>' +
    '<param><value><string>product.template</string></value></param>' +
    '<param><value><string>search_count</string></value></param>' +
    '<param><value><array><data><value><array><data>' + domainToXml(domain) + '</data></array></value></data></array></value></param>' +
    '<param><value><struct></struct></value></param>' +
    '</params></methodCall>';
  const res = await fetch(ODOO_URL + '/xmlrpc/2/object', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body });
  const text = await res.text();
  if (text.includes('<fault>')) throw new Error('Odoo count fault: ' + text.substring(0, 200));
  const m = text.match(/<int>(\d+)<\/int>/);
  return m ? parseInt(m[1]) : 0;
}

async function odooRead(domain, fields, limit, offset) {
  const fieldsXml = fields.map(f => '<value><string>' + f + '</string></value>').join('');
  const body = '<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>' +
    '<param><value><string>' + ODOO_DB + '</string></value></param>' +
    '<param><value><int>' + ODOO_UID + '</int></value></param>' +
    '<param><value><string>' + ODOO_API_KEY + '</string></value></param>' +
    '<param><value><string>product.template</string></value></param>' +
    '<param><value><string>search_read</string></value></param>' +
    '<param><value><array><data><value><array><data>' + domainToXml(domain) + '</data></array></value></data></array></value></param>' +
    '<param><value><struct>' +
    '<member><name>fields</name><value><array><data>' + fieldsXml + '</data></array></value></member>' +
    '<member><name>limit</name><value><int>' + limit + '</int></value></member>' +
    '<member><name>offset</name><value><int>' + offset + '</int></value></member>' +
    '</struct></value></param>' +
    '</params></methodCall>';
  const res = await fetch(ODOO_URL + '/xmlrpc/2/object', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body });
  const text = await res.text();
  if (text.includes('<fault>')) throw new Error('Odoo read fault: ' + text.substring(0, 300));
  return parseItems(text);
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
    while ((mm = memberRe.exec(sm[1])) !== null) {
      item[mm[1]] = parseVal(mm[2]);
    }
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
  m = raw.match(/<string>([\s\S]*?)<\/string>/);
  if (m) return m[1];
  m = raw.match(/<int>(\d+)<\/int>/);
  if (m) return parseInt(m[1]);
  m = raw.match(/<double>([^<]+)<\/double>/);
  if (m) return parseFloat(m[1]);
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
  if (text.includes('<fault>')) { console.error('Extra images fault:', text.substring(0, 300)); return []; }
  return parseItems(text);
}

async function fetchSoldProductTemplateIds() {
  // Returns a Set of product.template IDs on any non-cancelled sale order (draft or confirmed).
  // Two-step: sale.order.line → product.product → product.template (works across all Odoo versions).
  try {
    const domainXml = domainToXml([['order_id.state', 'in', ['sale', 'done']]]);
    const body1 = `<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>` +
      `<param><value><string>${ODOO_DB}</string></value></param>` +
      `<param><value><int>${ODOO_UID}</int></value></param>` +
      `<param><value><string>${ODOO_API_KEY}</string></value></param>` +
      `<param><value><string>sale.order.line</string></value></param>` +
      `<param><value><string>search_read</string></value></param>` +
      `<param><value><array><data><value><array><data>${domainXml}</data></array></value></data></array></value></param>` +
      `<param><value><struct>` +
      `<member><name>fields</name><value><array><data><value><string>product_id</string></value></data></array></value></member>` +
      `<member><name>limit</name><value><int>5000</int></value></member>` +
      `</struct></value></param></params></methodCall>`;
    const res1 = await fetch(ODOO_URL + '/xmlrpc/2/object', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body: body1 });
    const text1 = await res1.text();
    if (text1.includes('<fault>')) { console.error('fetchSoldIds step1 fault:', text1.substring(0, 300)); return new Set(); }

    const lines = parseItems(text1);
    const variantIds = [...new Set(lines.map(l => {
      const pid = Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;
      return typeof pid === 'number' ? pid : null;
    }).filter(Boolean))];

    if (!variantIds.length) return new Set();

    const idsXml = variantIds.map(id => `<value><int>${id}</int></value>`).join('');
    const domainXml2 = `<value><array><data><value><string>id</string></value><value><string>in</string></value><value><array><data>${idsXml}</data></array></value></data></array></value>`;
    const body2 = `<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>` +
      `<param><value><string>${ODOO_DB}</string></value></param>` +
      `<param><value><int>${ODOO_UID}</int></value></param>` +
      `<param><value><string>${ODOO_API_KEY}</string></value></param>` +
      `<param><value><string>product.product</string></value></param>` +
      `<param><value><string>search_read</string></value></param>` +
      `<param><value><array><data><value><array><data>${domainXml2}</data></array></value></data></array></value></param>` +
      `<param><value><struct>` +
      `<member><name>fields</name><value><array><data><value><string>product_tmpl_id</string></value></data></array></value></member>` +
      `<member><name>limit</name><value><int>5000</int></value></member>` +
      `</struct></value></param></params></methodCall>`;
    const res2 = await fetch(ODOO_URL + '/xmlrpc/2/object', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body: body2 });
    const text2 = await res2.text();
    if (text2.includes('<fault>')) { console.error('fetchSoldIds step2 fault:', text2.substring(0, 300)); return new Set(); }

    const variants = parseItems(text2);
    const ids = new Set();
    for (const v of variants) {
      const tmplId = Array.isArray(v.product_tmpl_id) ? v.product_tmpl_id[0] : v.product_tmpl_id;
      if (typeof tmplId === 'number') ids.add(tmplId);
    }
    return ids;
  } catch (e) {
    console.error('fetchSoldProductTemplateIds error:', e);
    return new Set();
  }
}

const BRAND_MAP = {
  'bvlgari': 'Bulgari', 'bulgari': 'Bulgari',
  'van cleef': 'Van Cleef & Arpels',
  'cartier': 'Cartier',
  'chanel': 'Chanel',
  'chopard': 'Chopard',
  'hermes': 'Hermès', 'hermès': 'Hermès',
  'louis vuitton': 'Louis Vuitton', ' lv ': 'Louis Vuitton',
  'gucci': 'Gucci',
  'prada': 'Prada',
  'christian dior': 'Dior', 'dior': 'Dior',
  'tiffany': 'Tiffany & Co',
  'harry winston': 'Harry Winston',
  'graff': 'Graff',
  'fendi': 'Fendi',
  'bottega veneta': 'Bottega Veneta',
  'saint laurent': 'Saint Laurent', 'ysl': 'Saint Laurent',
  'balenciaga': 'Balenciaga',
  'loewe': 'Loewe',
  'céline': 'Celine', 'celine': 'Celine',
  'burberry': 'Burberry',
  'valentino': 'Valentino',
  'chloé': 'Chloé', 'chloe': 'Chloé',
  'jacquemus': 'Jacquemus',
  'dolce & gabbana': 'Dolce & Gabbana', 'dolce': 'Dolce & Gabbana',
  'givenchy': 'Givenchy',
  'alexander mcqueen': 'Alexander McQueen',
  'mcm': 'MCM',
  'coach': 'Coach',
  'mulberry': 'Mulberry',
  'furla': 'Furla',
  'michael kors': 'Michael Kors',
  'versace': 'Versace',
  'miu miu': 'Miu Miu',
  'marc jacobs': 'Marc Jacobs',
  'mansur gavriel': 'Mansur Gavriel',
  'strathberry': 'Strathberry',
  'wandler': 'Wandler',
  'rolex': 'Rolex',
  'omega': 'Omega',
  'patek': 'Patek Philippe',
  'audemars': 'Audemars Piguet',
  'richard mille': 'Richard Mille',
};

function extractBrand(name, sku) {
  const combined = `${name || ''} ${sku || ''}`.toLowerCase();
  for (const [key, val] of Object.entries(BRAND_MAP)) {
    if (combined.includes(key)) return val;
  }
  return 'Unknown';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { batch_size = 5, offset = 0 } = req.body || {};

  try {
    const domain = [
      ['active', '=', true],
      ['website_published', '=', true],
      ['dr_free_qty', '>', 0],
      ['categ_id', '!=', 8],
    ];

    const totalCount = await odooCount(domain);
    const allItems = await odooRead(
      domain,
      ['id', 'name', 'default_code', 'standard_price', 'description_sale', 'image_1920', 'categ_id'],
      batch_size,
      offset
    );
    // Only process items that have an image
    const items = (allItems || []).filter(i => i.image_1920 && i.image_1920 !== false);

    // Sold status is handled by the cron job — skip here to avoid timeout
    const soldTemplateIds = new Set();

    if (!items || items.length === 0) {
      // If no items with images in this batch, skip to next batch or finish
      const nextOffset = offset + batch_size;
      const done = nextOffset >= totalCount;
      return res.status(200).json({ success: true, done, processed: 0, total: totalCount, added: 0, updated: 0, removed: 0, images_added: 0, next_offset: done ? null : nextOffset });
    }

    const odooIds = items.map(i => String(i.id));
    const { data: existing } = await supabase
      .from('products')
      .select('id, odoo_product_id, status')
      .eq('source', 'odoo_bags')
      .in('odoo_product_id', odooIds);
    const existingMap = {};
    (existing || []).forEach(i => { existingMap[i.odoo_product_id] = { id: i.id, status: i.status }; });

    // Fetch extra product images for this batch
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

    // On first batch: purge any existing products that have no images (stuck from past failed uploads)
    let removed = 0;
    if (offset === 0) {
      const { data: withImages } = await supabase.from('product_images').select('product_id');
      const idsWithImages = [...new Set((withImages || []).map(r => r.product_id))];
      const { data: allBagProducts } = await supabase.from('products').select('id').eq('source', 'odoo_bags');
      const imageless = (allBagProducts || []).filter(p => !idsWithImages.includes(p.id)).map(p => p.id);
      if (imageless.length > 0) {
        await supabase.from('products').delete().in('id', imageless);
        removed = imageless.length;
      }
    }

    let added = 0, updated = 0, imagesAdded = 0;
    const errors = [];

    for (const item of items) {
      const existingEntry = existingMap[String(item.id)];
      const isExisting = !!existingEntry;
      const currentStatus = existingEntry?.status;
      const cost = item.standard_price || 0;
      const priceEur = cost > 0 ? Math.round(cost * PRICE_MARKUP * 100) / 100 : null;

      const isSold = soldTemplateIds.has(item.id);

      const categName = (Array.isArray(item.categ_id) ? item.categ_id[1] : item.categ_id || '').replace('All / ', '').toLowerCase();
      const CATEG_MAP = {
        'handbags': { category: 'Bags', subcategory: 'Handbags' },
        'totes': { category: 'Bags', subcategory: 'Totes' },
        'backpacks': { category: 'Bags', subcategory: 'Backpacks' },
        'belt bags': { category: 'Bags', subcategory: 'Belt Bags' },
        'pouches': { category: 'Bags', subcategory: 'Pouches' },
        'luggage': { category: 'Bags', subcategory: 'Luggage' },
        "women's shoes": { category: 'Shoes', subcategory: null },
        "men's shoes": { category: 'Shoes', subcategory: null },
        'wallets': { category: 'Accessories', subcategory: 'Wallets' },
        'belts': { category: 'Accessories', subcategory: 'Belts' },
        'scarves': { category: 'Accessories', subcategory: 'Scarves' },
        'hats': { category: 'Accessories', subcategory: 'Hats' },
        'cardholder': { category: 'Accessories', subcategory: 'Cardholder' },
        'card holder': { category: 'Accessories', subcategory: 'Cardholder' },
      };
      const { category, subcategory } = CATEG_MAP[categName] || { category: 'Accessories', subcategory: null };

      const mapped = {
        odoo_product_id: String(item.id),
        source: 'odoo_bags',
        brand: extractBrand(item.name, item.default_code),
        model: (item.name || '').trim(),
        reference: item.default_code || null,
        price_eur: priceEur,
        category,
        subcategory: subcategory || null,
        condition: 'Pre-owned',
        notes: item.description_sale && item.description_sale.trim() ? item.description_sale.trim() : null,
        status: isSold ? 'sold' : 'available',
      };

      const { data: upserted, error } = await supabase
        .from('products')
        .upsert(mapped, { onConflict: 'odoo_product_id' })
        .select('id')
        .single();

      if (error) { errors.push({ item: mapped.odoo_product_id, error: error.message }); continue; }

      const watchId = upserted?.id || existingMap[mapped.odoo_product_id];
      isExisting ? updated++ : added++;

      if (watchId) {
        await supabase.from('product_images').delete().eq('product_id', watchId);
        let position = 0;

        // Primary image
        if (item.image_1920 && item.image_1920 !== false) {
          try {
            const buffer = Buffer.from(item.image_1920, 'base64');
            const path = watchId + '/bag_primary.jpg';
            const { error: upErr } = await supabase.storage.from('watch-images').upload(path, buffer, { contentType: 'image/jpeg', upsert: true });
            if (!upErr) {
              const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path);
              await supabase.from('product_images').insert({ product_id: watchId, url: publicUrl, position });
              position++;
              imagesAdded++;
            }
          } catch (e) { console.error('Primary img error:', e); }
        }

        // Extra product images
        const extras = extraImagesMap[String(item.id)] || [];
        for (let i = 0; i < extras.length; i++) {
          const extraImg = extras[i];
          if (!extraImg.image_1920 || extraImg.image_1920 === false) continue;
          try {
            const buffer = Buffer.from(extraImg.image_1920, 'base64');
            const path = watchId + '/bag_extra_' + i + '.jpg';
            const { error: upErr } = await supabase.storage.from('watch-images').upload(path, buffer, { contentType: 'image/jpeg', upsert: true });
            if (!upErr) {
              const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path);
              await supabase.from('product_images').insert({ product_id: watchId, url: publicUrl, position });
              position++;
              imagesAdded++;
            }
          } catch (e) { console.error('Extra img error:', e); }
        }

        // If no images were uploaded at all, remove the product — don't show image-less items
        if (position === 0) {
          await supabase.from('products').delete().eq('id', watchId);
          isExisting ? updated-- : added--;
        }
      }
    }

    const nextOffset = offset + batch_size;
    const done = nextOffset >= totalCount;

    return res.status(200).json({
      success: true,
      added,
      updated,
      removed,
      images_added: imagesAdded,
      processed: items.length,
      offset,
      next_offset: done ? null : nextOffset,
      total: totalCount,
      done,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('Bags sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
