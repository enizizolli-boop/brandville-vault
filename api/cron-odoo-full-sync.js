import { createClient } from '@supabase/supabase-js';
import { toJpeg } from './_imageUtils.js';

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
    else if (Array.isArray(val)) {
      const inner = val.map(v => typeof v === 'number' ? `<value><int>${v}</int></value>` : `<value><string>${v}</string></value>`).join('');
      valXml = `<value><array><data>${inner}</data></array></value>`;
    } else if (typeof val === 'number') valXml = `<value><int>${val}</int></value>`;
    else valXml = `<value><string>${val}</string></value>`;
    return `<value><array><data><value><string>${field}</string></value><value><string>${op}</string></value>${valXml}</data></array></value>`;
  }).join('');
}

async function odooModelRead(model, domain, fields, limit = 200) {
  const fieldsXml = fields.map(f => `<value><string>${f}</string></value>`).join('');
  const body = `<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>` +
    `<param><value><string>${ODOO_DB}</string></value></param>` +
    `<param><value><int>${ODOO_UID}</int></value></param>` +
    `<param><value><string>${ODOO_API_KEY}</string></value></param>` +
    `<param><value><string>${model}</string></value></param>` +
    `<param><value><string>search_read</string></value></param>` +
    `<param><value><array><data><value><array><data>${domainToXml(domain)}</data></array></value></data></array></value></param>` +
    `<param><value><struct><member><name>fields</name><value><array><data>${fieldsXml}</data></array></value></member>` +
    `<member><name>limit</name><value><int>${limit}</int></value></member></struct></value></param></params></methodCall>`;
  const res = await fetch(ODOO_URL + '/xmlrpc/2/object', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body });
  const text = await res.text();
  if (text.includes('<fault>')) throw new Error(`Odoo model read fault (${model}): ` + text.substring(0, 200));
  return parseItems(text);
}

async function fetchBrandMap(templateIds, attrName = 'Brand') {
  if (!templateIds.length) return {};
  try {
    const attrs = await odooModelRead('product.attribute', [['name', '=', attrName]], ['id'], 1);
    if (!attrs.length) return {};
    const brandAttrId = attrs[0].id;
    const lines = await odooModelRead(
      'product.template.attribute.line',
      [['attribute_id', '=', brandAttrId], ['product_tmpl_id', 'in', templateIds]],
      ['product_tmpl_id', 'value_ids'], 5000
    );
    if (!lines.length) return {};
    const valueIds = [...new Set(lines.map(l => typeof l.value_ids === 'number' ? l.value_ids : null).filter(Boolean))];
    if (!valueIds.length) return {};
    const values = await odooModelRead('product.attribute.value', [['id', 'in', valueIds]], ['id', 'name'], valueIds.length);
    const valueMap = {};
    values.forEach(v => { valueMap[v.id] = v.name; });
    const brandMap = {};
    for (const line of lines) {
      const tmplId = String(Array.isArray(line.product_tmpl_id) ? line.product_tmpl_id[0] : line.product_tmpl_id);
      const valueId = typeof line.value_ids === 'number' ? line.value_ids : null;
      if (tmplId && valueId && valueMap[valueId]) brandMap[tmplId] = valueMap[valueId];
    }
    return brandMap;
  } catch (e) { console.error('fetchBrandMap error:', attrName, e); return null; } // null = lookup failed
}

// Odoo JSON-RPC. Used where a list must come back whole: the XML parser above keeps only the first id of a list.
async function odooJson(model, method, args, kwargs = {}) {
  const res = await fetch(ODOO_URL + '/jsonrpc', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service: 'object', method: 'execute_kw', args: [ODOO_DB, ODOO_UID, ODOO_API_KEY, model, method, args, kwargs] } }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`Odoo ${model}.${method}: ` + (j.error.data?.message || j.error.message));
  return j.result;
}

// "Comes with" (Box, Papers, Box/Papers/Screwdriver, No Box or Papers ...) and "Extras" (Covers, Purchase Invoice; zero to two)
// as the staff see them: the product_fix_attributes module's own table, product.attribute.line.custom. Odoo's standard
// attribute lines are not used: they hold only a fraction of the values (7 vs 85 available jewellery on 2026-11-12) and keep
// a value after it is removed in the module's dropdown.
// Returns { byTmpl: { tmplId: { comesWith, extras: [] } }, extrasVisible }, or null on failure. extrasVisible is the
// visibility setting of the "Extras" attribute in Odoo (true only when set to Visible; it is Hidden on 2026-11-16).
async function fetchDeliveryAttrs(templateIds) {
  try {
    const attrs = await odooJson('product.attribute', 'search_read', [[['name', 'in', ['Comes with', 'Extras']]]], { fields: ['id', 'name', 'visibility'] });
    const extrasVisible = attrs.some(a => a.name === 'Extras' && a.visibility === 'visible');
    if (!attrs.length) return { byTmpl: {}, extrasVisible };
    const attrName = Object.fromEntries(attrs.map(a => [a.id, a.name]));
    const values = await odooJson('product.attribute.value', 'search_read', [[['attribute_id', 'in', attrs.map(a => a.id)]]], { fields: ['id', 'name'] });
    const valueName = Object.fromEntries(values.map(v => [v.id, v.name]));
    const out = {};
    for (let i = 0; i < templateIds.length; i += 1000) {
      const rows = await odooJson('product.attribute.line.custom', 'search_read',
        [[['attribute_id', 'in', attrs.map(a => a.id)], ['product_tmpl_id', 'in', templateIds.slice(i, i + 1000)]]],
        { fields: ['product_tmpl_id', 'attribute_id', 'value_ids'] });
      for (const r of rows) {
        const names = [...r.value_ids].sort((a, b) => a - b).map(v => valueName[v]).filter(Boolean);
        if (!names.length) continue;
        const entry = (out[String(r.product_tmpl_id[0])] ||= { comesWith: null, extras: [] });
        if (attrName[r.attribute_id[0]] === 'Comes with') entry.comesWith = names.join('/');
        else for (const n of names) if (!entry.extras.includes(n)) entry.extras.push(n);
      }
      // The "Covers" and "Purchase Invoice" tick boxes on the product (x_extra_covers, x_extra_purchase_invoice, added in
      // Odoo on 2026-11-12). A piece has an extra when its box is ticked or the Extras attribute has it.
      const ticked = await odooJson('product.template', 'search_read',
        [[['id', 'in', templateIds.slice(i, i + 1000)], '|', ['x_extra_covers', '=', true], ['x_extra_purchase_invoice', '=', true]]],
        { fields: ['id', 'x_extra_covers', 'x_extra_purchase_invoice'] });
      for (const t of ticked) addTickedExtras(out, t);
    }
    for (const entry of Object.values(out)) sortExtras(entry);
    return { byTmpl: out, extrasVisible };
  } catch (e) { console.error('fetchDeliveryAttrs error:', e.message); return null; }
}

// Adds Covers / Purchase Invoice from the product's tick boxes to the delivery map entry (no duplicates).
function addTickedExtras(out, t) {
  const entry = (out[String(t.id)] ||= { comesWith: null, extras: [] });
  if (t.x_extra_covers && !entry.extras.includes('Covers')) entry.extras.push('Covers');
  if (t.x_extra_purchase_invoice && !entry.extras.includes('Purchase Invoice')) entry.extras.push('Purchase Invoice');
}

// Fixed order (Covers, then Purchase Invoice, then anything else) so the text stays the same whichever source set it.
const EXTRAS_ORDER = ['Covers', 'Purchase Invoice'];
function sortExtras(entry) {
  const rank = n => (EXTRAS_ORDER.indexOf(n) + 1) || EXTRAS_ORDER.length + 1;
  entry.extras.sort((a, b) => rank(a) - rank(b));
}

// Text stored in products.jewellery_comes_with, e.g. "Box, Papers, Screwdriver" or "No Box or Papers".
function comesWithText(d) {
  if (!d || !d.comesWith) return null;
  if (/^no box/i.test(d.comesWith)) return 'No Box or Papers';
  const parts = d.comesWith.split('/').map(s => s.trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

// Text stored in products.jewellery_extras, e.g. "Covers, Purchase Invoice".
function extrasText(d) {
  return d && d.extras.length ? d.extras.join(', ') : null;
}

// The delivery columns of a jewellery row (written together; left out when the Odoo lookup failed).
const DELIVERY_COLS = ['jewellery_comes_with', 'jewellery_extras', 'jewellery_extras_visible'];
function deliveryFields(delivery, tmplId) {
  if (!delivery) return {};
  const d = delivery.byTmpl[String(tmplId)];
  return { jewellery_comes_with: comesWithText(d), jewellery_extras: extrasText(d), jewellery_extras_visible: delivery.extrasVisible };
}

// The row without its delivery columns, for a retry when the database rejects them (e.g. a column was not added yet).
function withoutDelivery(mapped) {
  const rest = { ...mapped };
  for (const c of DELIVERY_COLS) delete rest[c];
  return rest;
}


// Template ids of products on a non-cancelled sales order tagged "Consignment" that is not fully invoiced
// (invoice status "To Invoice" or "Nothing to Invoice"). A fully invoiced order is complete: its products drop out.
// Throws on failure so the caller can leave is_consignment untouched instead of clearing it for every product.
async function fetchConsignmentTemplateIds() {
  const lines = await odooModelRead(
    'sale.order.line',
    [
      ['order_id.tag_ids.name', '=', 'Consignment'], ['order_id.state', '!=', 'cancel'],
      ['product_id', '!=', false], ['product_uom_qty', '>', 0], ['order_id.invoice_status', '!=', 'invoiced'],
    ],
    ['product_template_id'], 5000
  );
  return new Set(lines.map(l => Array.isArray(l.product_template_id) ? l.product_template_id[0] : l.product_template_id).filter(Boolean));
}

// Template ids of jewellery sold to a client on a confirmed sales order but not delivered yet (e.g. a pre-order that has
// not reached the office): reserved for that client, so not for sale. Odoo's forecast misses these when the order line has
// no delivery move (6 pieces on 2026-11-16, e.g. S10317), so the order itself is checked. Not counted: Consignment orders
// (they stay available until fully invoiced), delivered lines, and lines delivered and then returned (the piece is back in
// stock, e.g. Cartier-28814 / S10082). Same rule in cron-odoo-status.js. Throws on failure.
async function fetchReservedTemplateIds() {
  const lines = [];
  for (let offset = 0; ; offset += 2000) {
    const page = await odooJson('sale.order.line', 'search_read',
      [[['order_id.state', '=', 'sale'], ['product_id.categ_id', 'child_of', JEWELRY_CATEG_ID], ['product_uom_qty', '>', 0]]],
      { fields: ['id', 'order_id', 'product_template_id', 'product_uom_qty', 'qty_delivered'], limit: 2000, offset, order: 'id' });
    lines.push(...page);
    if (page.length < 2000) break;
  }
  const open = lines.filter(l => l.product_template_id && l.qty_delivered < l.product_uom_qty);
  if (!open.length) return new Set();
  const consignment = new Set(await odooJson('sale.order', 'search', [[['tag_ids.name', '=', 'Consignment']]]));
  const delivered = new Set(); // lines with a done delivery to the customer (a later return keeps them out)
  const ids = open.map(l => l.id);
  for (let i = 0; i < ids.length; i += 1000) {
    const moves = await odooJson('stock.move', 'search_read',
      [[['sale_line_id', 'in', ids.slice(i, i + 1000)], ['state', '=', 'done'], ['location_dest_id.usage', '=', 'customer']]],
      { fields: ['sale_line_id'] });
    for (const m of moves) delivered.add(m.sale_line_id[0]);
  }
  return new Set(open.filter(l => !consignment.has(l.order_id[0]) && !delivered.has(l.id)).map(l => l.product_template_id[0]));
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

// Odoo's XML-RPC escapes text (&amp; &lt; ...). Decode it, or "Van Cleef & Arpels" is stored as "Van Cleef &amp; Arpels".
function decodeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
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
  if (m) return decodeXml(m[1]);
  m = raw.match(/^<base64>([\s\S]*)<\/base64>$/);
  if (m) return m[1].replace(/\s/g, '');
  if (raw === '<nil/>') return null;
  if (raw.startsWith('<array>')) {
    const intM = raw.match(/<int>(\d+)<\/int>/);
    const strM = raw.match(/<string>([^<]+)<\/string>/);
    if (intM && strM) return [parseInt(intM[1]), decodeXml(strM[1])];
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

async function odooRead(domain, fields, limit, offset, order) {
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
    (order ? `<member><name>order</name><value><string>${order}</string></value></member>` : '') +
    `</struct></value></param></params></methodCall>`;
  const res = await fetch(ODOO_URL + '/xmlrpc/2/object', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body });
  const text = await res.text();
  if (text.includes('<fault>')) throw new Error('Odoo read fault: ' + text.substring(0, 200));
  return parseItems(text);
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const startTime = Date.now();
  let added = 0, updated = 0, imagesAdded = 0, removed = 0;
  // Write problems, recorded in sync_log (before, they only went to the console, so a rejected write went unnoticed).
  const writeErrors = [];
  let scopeRejected = 0;
  // Writes a product row. If the database rejects the delivery columns (e.g. a column was not added yet),
  // the row is written again without them, so price, condition and sold status still sync.
  async function writeProduct(run, runWith, mapped, item) {
    let r = await run();
    if (r.error && DELIVERY_COLS.some(c => c in mapped)) {
      const retry = await runWith(withoutDelivery(mapped));
      if (!retry.error) {
        scopeRejected++;
        if (writeErrors.length < 20) writeErrors.push({ sku: item.default_code, stage: 'scope_rejected', value: [mapped.jewellery_comes_with, mapped.jewellery_extras].filter(Boolean).join(' | '), error: r.error.message });
        return retry;
      }
      r = retry;
    }
    if (r.error) {
      console.error('jewellery write error', item.default_code, r.error.message);
      if (writeErrors.length < 20) writeErrors.push({ sku: item.default_code, stage: 'write', error: r.error.message });
    }
    return r;
  }

  try {
    const domain = [['sale_ok', '=', true], ['active', '=', true], ['categ_id', 'child_of', JEWELRY_CATEG_ID]];
    const totalCount = await odooCount(domain);

    // Remove stale items
    const allOdooItems = await odooRead(domain, ['id'], 5000, 0);
    const allOdooIds = allOdooItems.map(i => String(i.id));

    // Consignment products (jewellery only): null when the lookup fails, so is_consignment is then left as it is
    let consignmentIds = null;
    try { consignmentIds = await fetchConsignmentTemplateIds(); }
    catch (e) { console.error('fetchConsignmentTemplateIds error:', e.message); }

    // Jewellery reserved for a client on a confirmed sales order. null when the lookup fails: no piece is then
    // restored from sold to available in this run, so a reserved piece cannot come back by mistake.
    let reservedIds = null;
    try { reservedIds = await fetchReservedTemplateIds(); }
    catch (e) { console.error('fetchReservedTemplateIds error:', e.message); }

    // Fetch brand from Odoo attribute (no hardcoded map needed)
    const brandMap = (await fetchBrandMap(allOdooItems.map(i => i.id))) || {};
    // "Comes with" + "Extras" (null when the lookup fails: the delivery columns are then left as they are)
    const deliveryMap = await fetchDeliveryAttrs(allOdooItems.map(i => i.id));
    // Paged: Supabase returns at most 1000 rows per request, so a single query skipped part of the jewellery.
    const allExisting = [];
    for (let from = 0; ; from += 1000) {
      const { data: page, error: pageErr } = await supabase.from('products').select('odoo_product_id')
        .eq('source', 'odoo').eq('category', 'Jewellery').order('id').range(from, from + 999);
      if (pageErr) throw pageErr;
      allExisting.push(...page);
      if (page.length < 1000) break;
    }
    const toDelete = (allExisting || []).map(i => i.odoo_product_id).filter(id => id && !allOdooIds.includes(id));
    if (toDelete.length > 0) {
      await supabase.from('products').update({ status: 'sold' }).in('odoo_product_id', toDelete).eq('source', 'odoo').eq('category', 'Jewellery');
      removed = toDelete.length;
    }

    // Process the items in batches. One run cannot finish all of them inside the 300 s limit, so each run
    // resumes where the previous one stopped (position saved in sync_log) and wraps around at the end.
    const { data: cursorRow } = await supabase.from('sync_log').select('result').eq('key', 'sync_odoo_jewellery_cursor').maybeSingle();
    let startOffset = Number(cursorRow?.result?.offset) || 0;
    if (startOffset >= totalCount) startOffset = 0;
    let nextOffset = 0; // 0 = reached the end of the list, start over next time

    for (let offset = startOffset; offset < totalCount; offset += BATCH_SIZE) {
      // Stop if we're getting close to the 300s limit
      if (Date.now() - startTime > 270000) {
        console.log(`Stopping at offset ${offset} to avoid timeout`);
        nextOffset = offset;
        break;
      }

      const items = await odooRead(
        domain,
        ['id', 'name', 'default_code', 'list_price', 'x_b2b_price', 'description_sale', 'image_1920', 'qty_available', 'virtual_available', 'categ_id', 'x_studio_condition', 'brand_id'],
        BATCH_SIZE, offset, 'id' // fixed order so the saved position stays valid between runs
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
        const brand = (Array.isArray(item.brand_id) ? item.brand_id[1] : null)
          || brandMap[String(item.id)]
          || 'Unknown';

        const existingEntry = existingMap[String(item.id)];
        const isExisting = !!existingEntry;
        const currentStatus = existingEntry?.status;


        const categName = Array.isArray(item.categ_id) ? item.categ_id[1] : (typeof item.categ_id === 'string' ? item.categ_id : null);
        const jewelleryType = categName ? (JEWELLERY_TYPE_MAP[categName.toLowerCase()] || null) : null;

        // A consignment piece is on a Consignment sales order that is not fully invoiced. It stays visible whatever its
        // quantity is (it is reserved or already at the customer); once the order is fully invoiced it is no longer flagged.
        const isConsignment = consignmentIds ? consignmentIds.has(item.id) : false;

        // virtual_available (forecasted qty) drops to 0 when on a confirmed SO or already sold.
        // For max-1-stock items this is the single reliable sold signal — no SO lookup needed.
        // Exception: a consignment piece (order not fully invoiced) stays available. After the full invoice it counts as sold again.
        // Also sold: reserved for a client on a confirmed sales order (see fetchReservedTemplateIds).
        const isReserved = reservedIds ? reservedIds.has(item.id) : false;
        const isSold = (item.virtual_available == null || item.virtual_available <= 0 || isReserved) && !isConsignment;

        const mapped = {
          subcategory: jewelleryType,
          odoo_product_id: String(item.id),
          source: 'odoo',
          brand,
          model: (item.name || '').trim(),
          reference: item.default_code || null,
          price_eur: item.list_price || null,
          b2b_price_eur: item.x_b2b_price > 0 ? item.x_b2b_price : null,
          ...(consignmentIds ? { is_consignment: isConsignment } : {}),
          condition: item.x_studio_condition || 'Pre-owned',
          ...deliveryFields(deliveryMap, item.id),
          ...(isSold ? { status: 'sold' } : currentStatus === 'sold' ? (reservedIds ? { status: 'available' } : {}) : isExisting ? {} : { status: 'available' }),
          category: 'Jewellery',
          notes: item.description_sale && typeof item.description_sale === 'string' ? item.description_sale.trim() || null : null,
        };

        let productId;
        if (isExisting) {
          const { error } = await writeProduct(() => supabase.from('products').update(mapped).eq('id', existingEntry.id),
            m => supabase.from('products').update(m).eq('id', existingEntry.id), mapped, item);
          if (error) continue;
          productId = existingEntry.id;
          updated++;
        } else {
          // Don't insert brand-new products that are already sold — only add available items
          if (isSold) continue;
          const { data: inserted, error } = await writeProduct(() => supabase.from('products').insert(mapped).select('id').single(),
            m => supabase.from('products').insert(m).select('id').single(), mapped, item);
          if (error) continue;
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
                  const buffer = await toJpeg(Buffer.from(item.image_1920, 'base64'));
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
                  const buffer = await toJpeg(Buffer.from(extraImg.image_1920, 'base64'));
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

    // Saved only when the run finished without an error, so a failed run retries the same batch
    await supabase.from('sync_log').upsert({
      key: 'sync_odoo_jewellery_cursor',
      last_sync_at: new Date().toISOString(),
      result: { offset: nextOffset },
    });

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`Full sync done: +${added} added, ${updated} updated, ${removed} removed, ${imagesAdded} images, ${elapsed}s`);
    await supabase.from('sync_log').upsert({
      key: 'sync_odoo_jewellery',
      last_sync_at: new Date().toISOString(),
      result: { added, updated, removed, images_added: imagesAdded, total: totalCount, start_offset: startOffset, next_offset: nextOffset, elapsed_seconds: elapsed, delivery_lookup: deliveryMap ? 'ok' : 'failed', reserved_lookup: reservedIds ? 'ok' : 'failed', reserved_count: reservedIds ? reservedIds.size : undefined,scope_rejected: scopeRejected, error_count: writeErrors.length, errors: writeErrors.length ? writeErrors : undefined },
    });
    return res.status(200).json({ success: true, added, updated, removed, images_added: imagesAdded, total: totalCount, elapsed_seconds: elapsed });

  } catch (err) {
    console.error('Full sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
