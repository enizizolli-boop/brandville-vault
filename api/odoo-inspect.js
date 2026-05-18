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
      const raw = mm[2].trim();
      let m;
      m = raw.match(/^<int>(\d+)<\/int>$/) || raw.match(/^<i4>(\d+)<\/i4>$/);
      if (m) { item[mm[1]] = parseInt(m[1]); continue; }
      m = raw.match(/^<string>([\s\S]*)<\/string>$/);
      if (m) { item[mm[1]] = m[1]; continue; }
      if (raw.startsWith('<array>')) {
        const intM = raw.match(/<int>(\d+)<\/int>/);
        const strM = raw.match(/<string>([^<]+)<\/string>/);
        if (intM && strM) item[mm[1]] = [parseInt(intM[1]), strM[1]];
        else if (intM) item[mm[1]] = parseInt(intM[1]);
        else item[mm[1]] = null;
        continue;
      }
      item[mm[1]] = raw.replace(/<[^>]+>/g, '').trim() || null;
    }
    if (item.id !== undefined) items.push(item);
  }
  return items;
}

async function rpc(model, domain, fields, limit = 50) {
  const fieldsXml = fields.map(f => '<value><string>' + f + '</string></value>').join('');
  const domainXml = domain.map(([f, op, val]) => {
    let valXml;
    if (Array.isArray(val)) {
      const inner = val.map(v => typeof v === 'number' ? '<value><int>' + v + '</int></value>' : '<value><string>' + v + '</string></value>').join('');
      valXml = '<value><array><data>' + inner + '</data></array></value>';
    } else if (typeof val === 'number') valXml = '<value><int>' + val + '</int></value>';
    else valXml = '<value><string>' + val + '</string></value>';
    return '<value><array><data><value><string>' + f + '</string></value><value><string>' + op + '</string></value>' + valXml + '</data></array></value>';
  }).join('');
  const body = '<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>' +
    '<param><value><string>' + ODOO_DB + '</string></value></param>' +
    '<param><value><int>' + ODOO_UID + '</int></value></param>' +
    '<param><value><string>' + ODOO_API_KEY + '</string></value></param>' +
    '<param><value><string>' + model + '</string></value></param>' +
    '<param><value><string>search_read</string></value></param>' +
    '<param><value><array><data><value><array><data>' + domainXml + '</data></array></value></data></array></value></param>' +
    '<param><value><struct>' +
    '<member><name>fields</name><value><array><data>' + fieldsXml + '</data></array></value></member>' +
    '<member><name>limit</name><value><int>' + limit + '</int></value></member>' +
    '</struct></value></param>' +
    '</params></methodCall>';
  const res = await fetch(ODOO_URL + '/xmlrpc/2/object', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body });
  const text = await res.text();
  if (text.includes('<fault>')) return { error: text.slice(0, 500) };
  return parseItems(text);
}

export default async function handler(req, res) {
  try {
  // Step 1: find attribute records
  const TARGET_ATTRS = ['Condition', 'Brand', 'Gender', 'Colors', 'Shoe Size'];
  const attrRecords = await rpc('product.attribute', [['name', 'in', TARGET_ATTRS]], ['id', 'name'], 50);

  if (!Array.isArray(attrRecords)) return res.status(200).json({ step: 'attribute lookup failed', raw: attrRecords });
  if (attrRecords.length === 0) return res.status(200).json({ step: 'no attributes found', tried: TARGET_ATTRS });

  const nameById = {};
  const attrIds = attrRecords.map(a => { nameById[a.id] = a.name; return a.id; });

  // Step 2: fetch a few attribute lines
  const lines = await rpc(
    'product.template.attribute.line',
    [['attribute_id', 'in', attrIds]],
    ['product_tmpl_id', 'attribute_id', 'value_ids'],
    10
  );

  if (!Array.isArray(lines)) return res.status(200).json({ step: 'attribute lines failed', raw: lines, attr_ids: attrIds });

  // Step 3: read value names
  const valueIds = lines.map(l => typeof l.value_ids === 'number' ? l.value_ids : null).filter(Boolean);
  let valueNames = [];
  if (valueIds.length > 0) {
    const idsXml = valueIds.map(i => '<value><int>' + i + '</int></value>').join('');
    const body = '<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>' +
      '<param><value><string>' + ODOO_DB + '</string></value></param>' +
      '<param><value><int>' + ODOO_UID + '</int></value></param>' +
      '<param><value><string>' + ODOO_API_KEY + '</string></value></param>' +
      '<param><value><string>product.attribute.value</string></value></param>' +
      '<param><value><string>read</string></value></param>' +
      '<param><value><array><data><value><array><data>' + idsXml + '</data></array></value></data></array></value></param>' +
      '<param><value><struct><member><name>fields</name><value><array><data><value><string>name</string></value></data></array></value></member></struct></value></param>' +
      '</params></methodCall>';
    const r = await fetch(ODOO_URL + '/xmlrpc/2/object', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body });
    valueNames = parseItems(await r.text());
  }

  return res.status(200).json({
    attributes_found: attrRecords,
    attr_ids: attrIds,
    sample_lines: lines,
    value_names: valueNames,
  });
  } catch (e) {
    return res.status(200).json({ crashed: true, error: e.message, stack: e.stack?.slice(0, 500) });
  }
}
