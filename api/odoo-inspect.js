const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB = process.env.ODOO_DB;
const ODOO_UID = parseInt(process.env.ODOO_USER_ID);
const ODOO_API_KEY = process.env.ODOO_API_KEY;

export default async function handler(req, res) {
  const productId = parseInt(req.query.id || 0);
  if (!productId) return res.status(400).json({ error: 'Pass ?id=<odoo_product_id>' });

  // Fetch fields_get to list all available fields
  const fieldsGetBody = `<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>
    <param><value><string>${ODOO_DB}</string></value></param>
    <param><value><int>${ODOO_UID}</int></value></param>
    <param><value><string>${ODOO_API_KEY}</string></value></param>
    <param><value><string>product.template</string></value></param>
    <param><value><string>fields_get</string></value></param>
    <param><value><array><data></data></array></value></param>
    <param><value><struct>
      <member><name>attributes</name><value><array><data>
        <value><string>string</string></value>
        <value><string>type</string></value>
      </data></array></value></member>
    </struct></value></param>
  </params></methodCall>`;

  const fieldsRes = await fetch(ODOO_URL + '/xmlrpc/2/object', {
    method: 'POST', headers: { 'Content-Type': 'text/xml' }, body: fieldsGetBody
  });
  const fieldsText = await fieldsRes.text();

  // Extract field names that mention condition/state/quality
  const conditionFields = [];
  const memberRe = /<member><name>([^<]+)<\/name>/g;
  let m;
  while ((m = memberRe.exec(fieldsText)) !== null) {
    const name = m[1];
    if (name.toLowerCase().includes('condition') || name.toLowerCase().includes('state') || name.toLowerCase().includes('quality') || name.toLowerCase().includes('x_studio')) {
      conditionFields.push(name);
    }
  }

  // Now read the specific product with those fields + attribute_line_ids
  const fieldsToRead = [...new Set([...conditionFields, 'name', 'default_code', 'attribute_line_ids'])];
  const fieldsXml = fieldsToRead.map(f => `<value><string>${f}</string></value>`).join('');
  const readBody = `<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>
    <param><value><string>${ODOO_DB}</string></value></param>
    <param><value><int>${ODOO_UID}</int></value></param>
    <param><value><string>${ODOO_API_KEY}</string></value></param>
    <param><value><string>product.template</string></value></param>
    <param><value><string>read</string></value></param>
    <param><value><array><data><value><array><data><value><int>${productId}</int></value></data></array></value></data></array></value></param>
    <param><value><struct>
      <member><name>fields</name><value><array><data>${fieldsXml}</data></array></value></member>
    </struct></value></param>
  </params></methodCall>`;

  const readRes = await fetch(ODOO_URL + '/xmlrpc/2/object', {
    method: 'POST', headers: { 'Content-Type': 'text/xml' }, body: readBody
  });
  const readText = await readRes.text();

  return res.status(200).json({
    condition_related_fields: conditionFields,
    raw_response: readText.slice(0, 5000),
  });
}
