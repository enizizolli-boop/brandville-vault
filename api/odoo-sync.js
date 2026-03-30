import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB = process.env.ODOO_DB;
const ODOO_UID = parseInt(process.env.ODOO_USER_ID);
const ODOO_API_KEY = process.env.ODOO_API_KEY;
const JEWELRY_CATEG_ID = 8;

function domainToXml(domain) {
  return domain.map(([field, op, val]) => {
    let valXml;
    if (typeof val === 'boolean') valXml = '<value><boolean>' + (val ? 1 : 0) + '</boolean></value>';
    else if (typeof val === 'number') valXml = '<value><int>' + val + '</int></value>';
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

  const res = await fetch(ODOO_URL + '/xmlrpc/2/object', {
    method: 'POST', headers: { 'Content-Type': 'text/xml' }, body
  });
  const text = await res.text();
  if (text.includes('<fault>')) throw new Error('Odoo count fault: ' + text.substring(0, 200));
  const m = text.match(/<int>(\d+)<\/int>/);
  return m ? parseInt(m[1]) : 0;
}

async function odooRead(domain, fields, limit, offset) {
  const fieldsXml = fields.map(f => '<value><string>' + f + '</string></value>').join('');
  const nameTag = 'name';

  const body = '<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>' +
    '<param><value><string>' + ODOO_DB + '</string></value></param>' +
    '<param><value><int>' + ODOO_UID + '</int></value></param>' +
    '<param><value><string>' + ODOO_API_KEY + '</string></value></param>' +
    '<param><value><string>product.template</string></value></param>' +
    '<param><value><string>search_read</string></value></param>' +
    '<param><value><array><data><value><array><data>' + domainToXml(domain) + '</data></array></value></data></array></value></param>' +
    '<param><value><struct>' +
    '<member><' + nameTag + '>fields</' + nameTag + '><value><array><data>' + fieldsXml + '</data></array></value></member>' +
    '<member><' + nameTag + '>limit</' + nameTag + '><value><int>' + limit + '</int></value></member>' +
    '<member><' + nameTag + '>offset</' + nameTag + '><value><int>' + offset + '</int></value></member>' +
    '</struct></value></param>' +
    '</params></methodCall>';

  const res = await fetch(ODOO_URL + '/xmlrpc/2/object', {
    method: 'POST', headers: { 'Content-Type': 'text/xml' }, body
  });
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
  m = raw.match(/<double>([^<]+)<\/double>/);
  if (m) return parseFloat(m[1]);
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { batch_size = 5, offset = 0 } = req.body || {};

  try {
    const domain = [['sale_ok', '=', true], ['active', '=', true], ['categ_id', '=', JEWELRY_CATEG_ID]];
    const totalCount = await odooCount(domain);
    const items = await odooRead(domain, ['id', 'name', 'default_code', 'list_price', 'description_sale', 'image_1920'], batch_size, offset);

    if (!items || items.length === 0) return res.status(200).json({ success: true, done: true, processed: 0, total: totalCount });

    const odooIds = items.map(i => String(i.id));
    const { data: existing } = await supabase.from('watches').select('id, odoo_product_id').eq('source', 'odoo').in('odoo_product_id', odooIds);
    const existingMap = {};
    (existing || []).forEach(i => { existingMap[i.odoo_product_id] = i.id; });

    let added = 0, updated = 0, imagesAdded = 0;
    const errors = [];

    for (const item of items) {
      let brand = 'Unknown';
      if (item.name) {
        const brands = ['Van Cleef', 'Cartier', 'Bulgari', 'Chanel', 'Chopard',
          'Hermes', 'Louis Vuitton', 'Gucci', 'Prada', 'Dior', 'Tiffany',
          'Harry Winston', 'Graff', 'Piaget', 'De Beers', 'Mikimoto'];
        for (const b of brands) {
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
      const { data: upserted, error } = await supabase.from('watches').upsert(mapped, { onConflict: 'odoo_product_id' }).select('id').single();
      if (error) { errors.push({ item: mapped.odoo_product_id, error: error.message }); continue; }

      const watchId = upserted?.id || existingMap[mapped.odoo_product_id];
      isExisting ? updated++ : added++;

      if (watchId && item.image_1920 && item.image_1920 !== false) {
        try {
          const buffer = Buffer.from(item.image_1920, 'base64');
          const path = watchId + '/odoo_primary.jpg';
          await supabase.storage.from('watch-images').remove([path]);
          const { error: upErr } = await supabase.storage.from('watch-images').upload(path, buffer, { contentType: 'image/jpeg', upsert: true });
          if (!upErr) {
            const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path);
            await supabase.from('watch_images').delete().eq('watch_id', watchId);
            await supabase.from('watch_images').insert({ watch_id: watchId, url: publicUrl, position: 0 });
            imagesAdded++;
          }
        } catch (e) { console.error('img err', e); }
      }
    }

    const nextOffset = offset + batch_size;
    const done = nextOffset >= totalCount;
    return res.status(200).json({ success: true, added, updated, images_added: imagesAdded, processed: items.length, offset, next_offset: done ? null : nextOffset, total: totalCount, done, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    console.error('Odoo sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
