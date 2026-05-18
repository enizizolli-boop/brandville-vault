import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB = process.env.ODOO_DB;
const ODOO_UID = parseInt(process.env.ODOO_USER_ID);
const ODOO_API_KEY = process.env.ODOO_API_KEY;
const PRICE_MARKUP = 1.4;

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

async function odooModelRead(model, domain, fields, limit = 200, offset = 0) {
  const fieldsXml = fields.map(f => '<value><string>' + f + '</string></value>').join('');
  const body = '<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>' +
    '<param><value><string>' + ODOO_DB + '</string></value></param>' +
    '<param><value><int>' + ODOO_UID + '</int></value></param>' +
    '<param><value><string>' + ODOO_API_KEY + '</string></value></param>' +
    '<param><value><string>' + model + '</string></value></param>' +
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
  if (text.includes('<fault>')) throw new Error('Odoo model read fault (' + model + '): ' + text.substring(0, 200));
  return parseItems(text);
}

async function fetchAttributeMap() {
  const TARGET_ATTRS = ['Condition', 'Brand', 'Gender', 'Colors', 'Shoe Size'];

  // Step 1: look up attribute IDs by name (avoids dot-notation domain issue)
  const attrRecords = await odooModelRead('product.attribute', [['name', 'in', TARGET_ATTRS]], ['id', 'name'], 50);
  if (!attrRecords || attrRecords.length === 0) return {};
  const nameById = {};
  const attrIds = attrRecords.map(a => { nameById[a.id] = a.name; return a.id; });

  // Step 2: fetch all attribute lines for those attribute IDs
  const lines = await odooModelRead(
    'product.template.attribute.line',
    [['attribute_id', 'in', attrIds]],
    ['product_tmpl_id', 'attribute_id', 'value_ids'],
    5000
  );
  if (!lines || lines.length === 0) return {};

  // Step 3: collect all value IDs to read their names
  const allValueIds = new Set();
  for (const line of lines) {
    const vid = line.value_ids;
    if (typeof vid === 'number') allValueIds.add(vid);
  }

  const valueMap = {};
  if (allValueIds.size > 0) {
    const idsXml = [...allValueIds].map(i => '<value><int>' + i + '</int></value>').join('');
    const body = '<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>' +
      '<param><value><string>' + ODOO_DB + '</string></value></param>' +
      '<param><value><int>' + ODOO_UID + '</int></value></param>' +
      '<param><value><string>' + ODOO_API_KEY + '</string></value></param>' +
      '<param><value><string>product.attribute.value</string></value></param>' +
      '<param><value><string>read</string></value></param>' +
      '<param><value><array><data><value><array><data>' + idsXml + '</data></array></value></data></array></value></param>' +
      '<param><value><struct><member><name>fields</name><value><array><data><value><string>name</string></value></data></array></value></member></struct></value></param>' +
      '</params></methodCall>';
    const res = await fetch(ODOO_URL + '/xmlrpc/2/object', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body });
    const vals = parseItems(await res.text());
    for (const v of vals) valueMap[v.id] = v.name;
  }

  // Step 4: build map: tmplId → { Condition, Brand, Gender, Colors, 'Shoe Size' }
  const attrMap = {};
  for (const line of lines) {
    const tmplId = String(Array.isArray(line.product_tmpl_id) ? line.product_tmpl_id[0] : line.product_tmpl_id);
    const attrId = Array.isArray(line.attribute_id) ? line.attribute_id[0] : line.attribute_id;
    const attrName = nameById[attrId];
    const valueId = typeof line.value_ids === 'number' ? line.value_ids : null;
    if (!tmplId || !attrName || !valueId) continue;
    if (!attrMap[tmplId]) attrMap[tmplId] = {};
    attrMap[tmplId][attrName] = valueMap[valueId] || '';
  }
  return attrMap;
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
  return null;
}

const BRAND_MAP = {
  'bvlgari': 'Bulgari', 'bulgari': 'Bulgari',
  'van cleef': 'Van Cleef & Arpels',
  'cartier': 'Cartier', 'chanel': 'Chanel', 'chopard': 'Chopard',
  'hermes': 'Hermès', 'hermès': 'Hermès',
  'louis vuitton': 'Louis Vuitton', ' lv ': 'Louis Vuitton',
  'gucci': 'Gucci', 'prada': 'Prada',
  'christian dior': 'Dior', 'dior': 'Dior',
  'tiffany': 'Tiffany & Co', 'harry winston': 'Harry Winston', 'graff': 'Graff',
  'fendi': 'Fendi', 'bottega veneta': 'Bottega Veneta',
  'saint laurent': 'Saint Laurent', 'ysl': 'Saint Laurent',
  'balenciaga': 'Balenciaga', 'loewe': 'Loewe',
  'céline': 'Celine', 'celine': 'Celine', 'burberry': 'Burberry',
  'valentino': 'Valentino', 'chloé': 'Chloé', 'chloe': 'Chloé',
  'jacquemus': 'Jacquemus', 'dolce & gabbana': 'Dolce & Gabbana', 'dolce': 'Dolce & Gabbana',
  'givenchy': 'Givenchy', 'alexander mcqueen': 'Alexander McQueen',
  'mcm': 'MCM', 'coach': 'Coach', 'mulberry': 'Mulberry', 'furla': 'Furla',
  'michael kors': 'Michael Kors', 'versace': 'Versace', 'miu miu': 'Miu Miu',
  'marc jacobs': 'Marc Jacobs',
};

function extractBrand(name, sku) {
  const combined = `${name || ''} ${sku || ''}`.toLowerCase();
  for (const [key, val] of Object.entries(BRAND_MAP)) {
    if (combined.includes(key)) return val;
  }
  return 'Unknown';
}

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

export default async function handler(req, res) {
  try {
    const domain = [
      ['active', '=', true],
      ['website_published', '=', true],
      ['dr_free_qty', '>', 0],
      ['categ_id', '!=', 8],
    ];

    // Fetch attribute map (Condition, Brand, Gender, Colors, Shoe Size) from Odoo
    const attrMap = await fetchAttributeMap();

    // Fetch all items in pages of 200 — no images, data only
    let allItems = [];
    let page = 0;
    const pageSize = 200;
    while (true) {
      const batch = await odooRead(
        domain,
        ['id', 'name', 'default_code', 'standard_price', 'description_sale', 'categ_id', 'image_1920'],
        pageSize,
        page * pageSize
      );
      if (!batch || batch.length === 0) break;
      allItems = allItems.concat(batch);
      if (batch.length < pageSize) break;
      page++;
    }

    // Keep every eligible item — bags may only have extra images (product.image)
    // and no primary image_1920. The webhook sync handles image upload from either source.
    const items = allItems;
    const liveOdooIds = items.map(i => String(i.id));

    // Remove stale items no longer in Odoo
    const { data: existing } = await supabase
      .from('products').select('odoo_product_id').eq('source', 'odoo_bags');
    const existingIds = (existing || []).map(i => i.odoo_product_id);
    const toDelete = existingIds.filter(id => !liveOdooIds.includes(id));
    if (toDelete.length > 0) {
      await supabase.from('products').delete().in('odoo_product_id', toDelete).eq('source', 'odoo_bags');
    }

    // Build rows — data only, no image uploads
    const rows = items.map(item => {
      const cost = item.standard_price || 0;
      const priceEur = cost > 0 ? Math.round(cost * PRICE_MARKUP * 100) / 100 : null;
      const categName = (Array.isArray(item.categ_id) ? item.categ_id[1] : item.categ_id || '').replace('All / ', '').toLowerCase();
      const { category, subcategory } = CATEG_MAP[categName] || { category: 'Accessories', subcategory: null };
      const attrs = attrMap[String(item.id)] || {};
      const brand = attrs['Brand'] || extractBrand(item.name, item.default_code);
      const condition = attrs['Condition'] || '';
      const itemSize = attrs['Shoe Size'] || null;
      const baseNotes = item.description_sale && item.description_sale.trim() ? item.description_sale.trim() : null;
      const extraParts = [attrs['Gender'] && `Gender: ${attrs['Gender']}`, attrs['Colors'] && `Color: ${attrs['Colors']}`].filter(Boolean);
      const notes = [baseNotes, ...extraParts].filter(Boolean).join(' | ') || null;
      return {
        odoo_product_id: String(item.id),
        source: 'odoo_bags',
        brand,
        model: (item.name || '').trim(),
        reference: item.default_code || null,
        price_eur: priceEur,
        category,
        subcategory: subcategory || null,
        condition,
        item_size: itemSize,
        notes,
        status: 'available',
      };
    });

    // Upsert in chunks of 100
    const CHUNK = 100;
    let upserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await supabase.from('products').upsert(rows.slice(i, i + CHUNK), { onConflict: 'odoo_product_id' });
      upserted += rows.slice(i, i + CHUNK).length;
    }

    await supabase.from('sync_log').upsert({
      key: 'sync_odoo_bags',
      last_sync_at: new Date().toISOString(),
      result: { upserted, removed: toDelete.length, total: items.length },
    });

    return res.status(200).json({
      success: true,
      upserted,
      removed: toDelete.length,
      total: items.length,
    });
  } catch (err) {
    console.error('Cron bags sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
