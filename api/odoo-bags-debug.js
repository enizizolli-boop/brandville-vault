import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB = process.env.ODOO_DB;
const ODOO_UID = parseInt(process.env.ODOO_USER_ID);
const ODOO_API_KEY = process.env.ODOO_API_KEY;

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
  if (m) return '<base64 omitted>';
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
  return null;
}

async function odooSearchReadBySku(sku) {
  const domainXml = `<value><array><data><value><array><data><value><string>default_code</string></value><value><string>=</string></value><value><string>${sku}</string></value></data></array></value></data></array></value>`;
  const fields = ['id', 'name', 'default_code', 'active', 'website_published', 'dr_free_qty', 'categ_id', 'standard_price'];
  const fieldsXml = fields.map(f => `<value><string>${f}</string></value>`).join('');
  const body = `<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>` +
    `<param><value><string>${ODOO_DB}</string></value></param>` +
    `<param><value><int>${ODOO_UID}</int></value></param>` +
    `<param><value><string>${ODOO_API_KEY}</string></value></param>` +
    `<param><value><string>product.template</string></value></param>` +
    `<param><value><string>search_read</string></value></param>` +
    `<param><value><array><data>${domainXml}</data></array></value></param>` +
    `<param><value><struct>` +
    `<member><name>fields</name><value><array><data>${fieldsXml}</data></array></value></member>` +
    `<member><name>limit</name><value><int>10</int></value></member>` +
    `</struct></value></param></params></methodCall>`;
  const res = await fetch(ODOO_URL + '/xmlrpc/2/object', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body });
  const text = await res.text();
  if (text.includes('<fault>')) throw new Error('Odoo search fault: ' + text.substring(0, 300));
  return parseItems(text);
}

async function odooReadImageInfo(tmplId) {
  // Check if image_1920 is set on product.template (boolean check - don't download base64)
  const domainXml = `<value><array><data><value><array><data><value><string>id</string></value><value><string>=</string></value><value><int>${tmplId}</int></value></data></array></value></data></array></value>`;
  const body = `<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>` +
    `<param><value><string>${ODOO_DB}</string></value></param>` +
    `<param><value><int>${ODOO_UID}</int></value></param>` +
    `<param><value><string>${ODOO_API_KEY}</string></value></param>` +
    `<param><value><string>product.template</string></value></param>` +
    `<param><value><string>search_read</string></value></param>` +
    `<param><value><array><data>${domainXml}</data></array></value></param>` +
    `<param><value><struct>` +
    `<member><name>fields</name><value><array><data><value><string>image_1920</string></value></data></array></value></member>` +
    `<member><name>limit</name><value><int>1</int></value></member>` +
    `</struct></value></param></params></methodCall>`;
  const res = await fetch(ODOO_URL + '/xmlrpc/2/object', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body });
  const text = await res.text();
  const hasBase64 = /<base64>[^<]+<\/base64>/.test(text);
  const isFalse = /<boolean>0<\/boolean>/.test(text);
  return { primary_image_present: hasBase64, primary_image_false: isFalse };
}

async function odooCountExtraImages(tmplId) {
  const domainXml = `<value><array><data><value><array><data><value><string>product_tmpl_id</string></value><value><string>=</string></value><value><int>${tmplId}</int></value></data></array></value></data></array></value>`;
  const body = `<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>` +
    `<param><value><string>${ODOO_DB}</string></value></param>` +
    `<param><value><int>${ODOO_UID}</int></value></param>` +
    `<param><value><string>${ODOO_API_KEY}</string></value></param>` +
    `<param><value><string>product.image</string></value></param>` +
    `<param><value><string>search_count</string></value></param>` +
    `<param><value><array><data>${domainXml}</data></array></value></param>` +
    `<param><value><struct></struct></value></param>` +
    `</params></methodCall>`;
  const res = await fetch(ODOO_URL + '/xmlrpc/2/object', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body });
  const text = await res.text();
  const m = text.match(/<int>(\d+)<\/int>/);
  return m ? parseInt(m[1]) : 0;
}

export default async function handler(req, res) {
  const sku = req.query?.sku;
  if (!sku) return res.status(400).json({ error: 'missing ?sku=' });

  try {
    const odooMatches = await odooSearchReadBySku(sku);

    const odooDetails = [];
    for (const m of odooMatches) {
      const imgInfo = await odooReadImageInfo(m.id);
      const extraCount = await odooCountExtraImages(m.id);
      odooDetails.push({
        ...m,
        primary_image_present: imgInfo.primary_image_present,
        extra_images_count: extraCount,
        total_images_in_odoo: (imgInfo.primary_image_present ? 1 : 0) + extraCount,
        sync_eligible: m.active && m.website_published && (m.dr_free_qty || 0) > 0,
      });
    }

    // Supabase lookup: by reference (=SKU) or by odoo_product_id
    const { data: dbByRef } = await supabase
      .from('products')
      .select('id, odoo_product_id, source, brand, model, reference, status, category, subcategory')
      .eq('source', 'odoo_bags')
      .eq('reference', sku);

    const dbIds = (dbByRef || []).map(r => r.id);
    let imagesByProduct = {};
    if (dbIds.length > 0) {
      const { data: imgs } = await supabase
        .from('product_images')
        .select('product_id, url, position')
        .in('product_id', dbIds)
        .order('position', { ascending: true });
      for (const img of imgs || []) {
        if (!imagesByProduct[img.product_id]) imagesByProduct[img.product_id] = [];
        imagesByProduct[img.product_id].push(img);
      }
    }

    const dbDetails = (dbByRef || []).map(r => ({
      ...r,
      images_in_db: imagesByProduct[r.id]?.length || 0,
      image_urls: (imagesByProduct[r.id] || []).map(i => i.url),
    }));

    return res.status(200).json({
      sku,
      odoo_matches: odooDetails,
      db_matches: dbDetails,
      diagnosis: diagnose(odooDetails, dbDetails),
    });
  } catch (err) {
    console.error('odoo-bags-debug error:', err);
    return res.status(500).json({ error: err.message });
  }
}

function diagnose(odooDetails, dbDetails) {
  if (odooDetails.length === 0) return 'SKU not found in Odoo';
  const odoo = odooDetails[0];
  if (!odoo.sync_eligible) {
    const reasons = [];
    if (!odoo.active) reasons.push('inactive');
    if (!odoo.website_published) reasons.push('not published on website');
    if (!(odoo.dr_free_qty > 0)) reasons.push(`dr_free_qty=${odoo.dr_free_qty || 0}`);
    return `Odoo item excluded from sync: ${reasons.join(', ')}`;
  }
  if (odoo.total_images_in_odoo === 0) return 'Odoo has no images (primary or extras) — sync removes imageless items';
  if (dbDetails.length === 0) return `Odoo has ${odoo.total_images_in_odoo} image(s) but product is missing from Supabase`;
  const db = dbDetails[0];
  if (db.images_in_db === 0) return `Product exists in Supabase but 0 images uploaded (Odoo has ${odoo.total_images_in_odoo})`;
  if (db.images_in_db < odoo.total_images_in_odoo) return `Partial images: Odoo ${odoo.total_images_in_odoo}, DB ${db.images_in_db}`;
  return 'In sync';
}
