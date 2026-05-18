const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB = process.env.ODOO_DB;
const ODOO_UID = parseInt(process.env.ODOO_USER_ID);
const ODOO_API_KEY = process.env.ODOO_API_KEY;

async function xmlrpc(model, method, params, kwargs = {}) {
  const kwargsXml = Object.entries(kwargs).map(([k, v]) => {
    const val = Array.isArray(v)
      ? `<array><data>${v.map(i => `<value><string>${i}</string></value>`).join('')}</data></array>`
      : `<string>${v}</string>`;
    return `<member><name>${k}</name><value>${val}</value></member>`;
  }).join('');
  const paramsXml = params.map(p => {
    if (typeof p === 'number') return `<param><value><int>${p}</int></value></param>`;
    if (typeof p === 'string') return `<param><value><string>${p}</string></value></param>`;
    if (Array.isArray(p)) {
      const inner = p.map(i => typeof i === 'number' ? `<value><int>${i}</int></value>` : `<value><string>${i}</string></value>`).join('');
      return `<param><value><array><data>${inner}</data></array></value></param>`;
    }
    return `<param><value><string>${JSON.stringify(p)}</string></value></param>`;
  }).join('');
  const body = `<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>
    <param><value><string>${ODOO_DB}</string></value></param>
    <param><value><int>${ODOO_UID}</int></value></param>
    <param><value><string>${ODOO_API_KEY}</string></value></param>
    <param><value><string>${model}</string></value></param>
    <param><value><string>${method}</string></value></param>
    ${paramsXml}
    <param><value><struct>${kwargsXml}</struct></value></param>
  </params></methodCall>`;
  const res = await fetch(ODOO_URL + '/xmlrpc/2/object', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body });
  return res.text();
}

export default async function handler(req, res) {
  const sku = req.query.sku;
  const id = req.query.id ? parseInt(req.query.id) : null;
  if (!sku && !id) return res.status(400).json({ error: 'Pass ?sku=Christian-Dior-24196 or ?id=<odoo_template_id>' });

  // Search for the product
  let searchDomain;
  if (sku) searchDomain = `<value><array><data><value><string>default_code</string></value><value><string>=</string></value><value><string>${sku}</string></value></data></array></value>`;
  else searchDomain = `<value><array><data><value><string>id</string></value><value><string>=</string></value><value><int>${id}</int></value></data></array></value>`;

  const searchBody = `<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>
    <param><value><string>${ODOO_DB}</string></value></param>
    <param><value><int>${ODOO_UID}</int></value></param>
    <param><value><string>${ODOO_API_KEY}</string></value></param>
    <param><value><string>product.template</string></value></param>
    <param><value><string>search_read</string></value></param>
    <param><value><array><data><value><array><data>${searchDomain}</data></array></value></data></array></value></param>
    <param><value><struct>
      <member><name>limit</name><value><int>1</int></value></member>
    </struct></value></param>
  </params></methodCall>`;

  const searchRes = await fetch(ODOO_URL + '/xmlrpc/2/object', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body: searchBody });
  const searchText = await searchRes.text();

  // Extract all field names and values from the response
  const fields = {};
  const memberRe = /<member><name>([^<]+)<\/name><value>([\s\S]*?)<\/value><\/member>/g;
  let m;
  while ((m = memberRe.exec(searchText)) !== null) {
    const key = m[1];
    const val = m[2].replace(/<[^>]+>/g, '').trim();
    if (val && val !== 'False' && val !== '0' && val !== '') {
      fields[key] = val;
    }
  }

  // Also get the raw XML for attribute_line_ids context
  return res.status(200).json({ fields, raw: searchText.slice(0, 8000) });
}
