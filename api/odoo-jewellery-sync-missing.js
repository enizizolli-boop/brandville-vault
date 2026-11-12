import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

// Photos are compared by fingerprint: the SHA-1 of the image bytes, which is exactly the checksum Odoo stores for every
// image (same method as odoo-bags-sync-missing.js).
const imageKey = b64 => createHash('sha1').update(Buffer.from(String(b64), 'base64')).digest('hex');
// Fingerprint in a Vault photo address (odoo_primary_<sha1>.jpg / odoo_extra_<sha1>.png); null for old names.
const urlKey = url => (String(url).match(/_([0-9a-f]{40})\.(?:jpg|png|webp)(?:\?|$)/) || [])[1] || null;
const sameList = (a, b) => a.length === b.length && a.every((k, i) => k === b[i]);
const byOdooOrder = (a, b) => (a.sequence || 0) - (b.sequence || 0) || a.id - b.id;
function imageFormat(b64) {
  if (b64.startsWith('iVBOR')) return { ext: 'png', type: 'image/png' };
  if (b64.startsWith('UklGR')) return { ext: 'webp', type: 'image/webp' };
  return { ext: 'jpg', type: 'image/jpeg' };
}
// Path inside the watch-images bucket from a public address.
const storagePath = url => (String(url).split('/object/public/watch-images/')[1] || '').split('?')[0] || null;

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL,
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
    else if (Array.isArray(val)) {
      const arrXml = val.map(v => typeof v === 'number' ? '<value><int>' + v + '</int></value>' : '<value><string>' + v + '</string></value>').join('');
      valXml = '<value><array><data>' + arrXml + '</data></array></value>';
    } else if (typeof val === 'number') valXml = '<value><int>' + val + '</int></value>';
    else valXml = '<value><string>' + val + '</string></value>';
    return '<value><array><data><value><string>' + field + '</string></value><value><string>' + op + '</string></value>' + valXml + '</data></array></value>';
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
    while ((mm = memberRe.exec(sm[1])) !== null) {
      item[mm[1]] = parseVal(mm[2]);
    }
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
  m = raw.match(/<string>([\s\S]*?)<\/string>/);
  if (m) return decodeXml(m[1]);
  return null;
}

async function odooSearchRead(model, domain, fields, limit, offset) {
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
    '</struct></value></param></params></methodCall>';
  const res = await fetch(ODOO_URL + '/xmlrpc/2/object', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body });
  const text = await res.text();
  if (text.includes('<fault>')) throw new Error(`Odoo ${model} fault: ` + text.substring(0, 300));
  return parseItems(text);
}

async function odooReadById(model, ids, fields) {
  if (!ids.length) return [];
  const idsXml = ids.map(id => `<value><int>${id}</int></value>`).join('');
  const fieldsXml = fields.map(f => `<value><string>${f}</string></value>`).join('');
  const body = `<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>` +
    `<param><value><string>${ODOO_DB}</string></value></param>` +
    `<param><value><int>${ODOO_UID}</int></value></param>` +
    `<param><value><string>${ODOO_API_KEY}</string></value></param>` +
    `<param><value><string>${model}</string></value></param>` +
    `<param><value><string>read</string></value></param>` +
    `<param><value><array><data><value><array><data>${idsXml}</data></array></value><value><array><data>${fieldsXml}</data></array></value></data></array></value></param>` +
    `</params></methodCall>`;
  const res = await fetch(ODOO_URL + '/xmlrpc/2/object', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body });
  const text = await res.text();
  if (text.includes('<fault>')) throw new Error(`Odoo read ${model} fault: ` + text.substring(0, 300));
  return parseItems(text);
}

async function fetchBrandMap(templateIds, attrName = 'Brand') {
  if (!templateIds.length) return {};
  try {
    const attrs = await odooSearchRead('product.attribute', [['name', '=', attrName]], ['id'], 1, 0);
    if (!attrs.length) return {};
    const brandAttrId = attrs[0].id;
    const lines = await odooSearchRead(
      'product.template.attribute.line',
      [['attribute_id', '=', brandAttrId], ['product_tmpl_id', 'in', templateIds]],
      ['product_tmpl_id', 'value_ids'], 5000, 0
    );
    if (!lines.length) return {};
    const valueIds = [...new Set(lines.map(l => typeof l.value_ids === 'number' ? l.value_ids : null).filter(Boolean))];
    if (!valueIds.length) return {};
    const values = await odooSearchRead('product.attribute.value', [['id', 'in', valueIds]], ['id', 'name'], valueIds.length, 0);
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
// a value after it is removed in the module's dropdown. Returns { tmplId: { comesWith, extras: [] } }, or null on failure.
async function fetchDeliveryAttrs(templateIds) {
  try {
    const attrs = await odooJson('product.attribute', 'search_read', [[['name', 'in', ['Comes with', 'Extras']]]], { fields: ['id', 'name'] });
    if (!attrs.length) return {};
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
    }
    return out;
  } catch (e) { console.error('fetchDeliveryAttrs error:', e.message); return null; }
}

// Text stored in products.jewellery_extras, e.g. "Box, Papers, Screwdriver, Covers, Purchase Invoice".
function jewelleryScope(d) {
  if (!d) return null;
  const none = d.comesWith && /^no box/i.test(d.comesWith);
  const parts = d.comesWith && !none ? d.comesWith.split('/').map(s => s.trim()).filter(Boolean) : [];
  parts.push(...d.extras);
  if (parts.length) return parts.join(', ');
  return none ? 'No Box or Papers' : null;
}


const JEWELLERY_TYPE_MAP = {
  'bracelets': 'Bracelets', 'bracelet': 'Bracelets',
  'earrings': 'Earrings', 'earring': 'Earrings',
  'necklaces': 'Necklaces', 'necklace': 'Necklaces',
  'rings': 'Rings', 'ring': 'Rings',
  'pendants': 'Necklaces', 'pendant': 'Necklaces',
};

// SHA-1 checksums of stored images (model.image_1920), keyed by record id. Odoo keeps them on ir.attachment.
async function odooImageChecksums(model, ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 1000) {
    const rows = await odooSearchRead('ir.attachment',
      [['res_model', '=', model], ['res_field', '=', 'image_1920'], ['res_id', 'in', ids.slice(i, i + 1000)]],
      ['res_id', 'checksum'], 50000, 0);
    for (const r of rows) if (r.checksum) out[r.res_id] = r.checksum;
  }
  return out;
}

// Last run of this job in sync_log (key sync_odoo_jewellery_photos). Never throws: logging must not break the sync.
async function logRun(result) {
  try {
    const { error } = await supabase.from('sync_log').upsert({ key: 'sync_odoo_jewellery_photos', last_sync_at: new Date().toISOString(), result });
    if (error) console.error('odoo-jewellery-sync-missing: sync_log write failed:', error.message);
  } catch (e) { console.error('odoo-jewellery-sync-missing: sync_log write failed:', e.message); }
}

export default async function handler(req, res) {
  const startTime = Date.now();
  const limit = parseInt(req.query?.limit || '10');
  const dryRun = req.query?.dry_run === '1';
  const onlySku = req.query?.sku || null;

  try {
    // 1. List eligible Odoo jewellery (metadata only, no image data).
    const domain = [
      ['active', '=', true],
      ['categ_id', 'child_of', JEWELRY_CATEG_ID],
      ['qty_available', '>', 0],
    ];
    let odooItems = [];
    let page = 0;
    const pageSize = 200;
    while (true) {
      const batch = await odooSearchRead(
        'product.template', domain,
        ['id', 'name', 'default_code', 'list_price', 'x_b2b_price', 'description_sale', 'categ_id', 'x_studio_condition', 'brand_id'],
        pageSize, page * pageSize
      );
      if (!batch.length) break;
      odooItems = odooItems.concat(batch);
      if (batch.length < pageSize) break;
      page++;
    }

    // 2. Fetch brand from Odoo attribute (no hardcoded map needed)
    const brandMap = (await fetchBrandMap(odooItems.map(i => i.id))) || {};
    const deliveryMap = await fetchDeliveryAttrs(odooItems.map(i => i.id));

    // 3. The photos each piece has in Odoo, in order, as fingerprints (same method as odoo-bags-sync-missing.js).
    //    Odoo stores a SHA-1 checksum of every image (ir.attachment.checksum), so this needs no photo downloads.
    //    Order: main photo, then the extra photos by sequence, then id. A photo stored twice is listed once.
    //    (Before, only the photo COUNT was compared: a photo replaced or reordered in Odoo never reached the Vault.)
    const allIds = odooItems.map(b => b.id);
    const extrasByTmpl = {}; // template id -> [{ id, sequence }]
    for (let i = 0; i < allIds.length; i += 500) {
      const rows = await odooSearchRead('product.image', [['product_tmpl_id', 'in', allIds.slice(i, i + 500)]], ['product_tmpl_id', 'sequence'], 50000, 0);
      for (const r of rows) {
        const t = Array.isArray(r.product_tmpl_id) ? r.product_tmpl_id[0] : r.product_tmpl_id;
        (extrasByTmpl[t] ||= []).push({ id: r.id, sequence: r.sequence || 0 });
      }
    }
    const primaryCk = await odooImageChecksums('product.template', allIds);
    const extraCk = await odooImageChecksums('product.image', Object.values(extrasByTmpl).flat().map(e => e.id));
    const expectedByTmpl = {};
    for (const id of allIds) {
      const list = [];
      if (primaryCk[id]) list.push(primaryCk[id]);
      for (const e of (extrasByTmpl[id] || []).sort(byOdooOrder)) {
        const ck = extraCk[e.id];
        if (ck && !list.includes(ck)) list.push(ck);
      }
      expectedByTmpl[id] = list;
    }

    // 4. The photos each piece has in the Vault, in order. Files are named after their fingerprint
    //    (older files odoo_primary.jpg / odoo_extra_N.jpg have none).
    // Paged: Supabase returns at most 1000 rows per request. Reading only the first 1000 made every other
    // existing row look "missing", so the same items were re-synced (and overwritten) on every run.
    const dbProducts = [];
    for (let from = 0; ; from += 1000) {
      const { data: page, error: pageErr } = await supabase
        .from('products')
        .select('id, odoo_product_id')
        .eq('source', 'odoo')
        .order('id')
        .range(from, from + 999);
      if (pageErr) throw pageErr;
      dbProducts.push(...page);
      if (page.length < 1000) break;
    }
    const dbByOdooId = new Map(dbProducts.map(p => [String(p.odoo_product_id), p]));
    const keysByDbId = new Map();
    const liveDbIds = odooItems.map(i => dbByOdooId.get(String(i.id))?.id).filter(Boolean);
    for (let i = 0; i < liveDbIds.length; i += 100) {
      for (let from = 0; ; from += 1000) {
        const { data: imgs, error: imgErr } = await supabase.from('product_images')
          .select('product_id, url, position').in('product_id', liveDbIds.slice(i, i + 100))
          .order('product_id').order('position').order('id').range(from, from + 999);
        if (imgErr) throw imgErr;
        for (const r of imgs) {
          if (!keysByDbId.has(r.product_id)) keysByDbId.set(r.product_id, []);
          keysByDbId.get(r.product_id).push(urlKey(r.url));
        }
        if (imgs.length < 1000) break;
      }
    }

    // 5. A piece needs work when it is not in the Vault yet, or its Vault photos differ from Odoo's in any way
    //    (missing, extra, replaced, reordered).
    const needs = [];
    for (const item of odooItems) {
      if (onlySku && item.default_code !== onlySku) continue;
      const expected = expectedByTmpl[item.id] || [];
      const dbRow = dbByOdooId.get(String(item.id));
      if (!dbRow && expected.length === 0) continue; // nothing to show yet
      const vault = dbRow ? (keysByDbId.get(dbRow.id) || []) : [];
      if (dbRow && sameList(vault, expected)) continue;
      const reason = !dbRow ? 'new'
        : vault.length !== expected.length ? 'count'
        : vault.includes(null) ? 'old_file_names'
        : 'changed';
      needs.push({
        odoo_id: item.id,
        name: item.name,
        default_code: item.default_code,
        description_sale: item.description_sale,
        categ_id: item.categ_id,
        list_price: item.list_price,
        x_b2b_price: item.x_b2b_price,
        // brand and condition were never carried over, so every row was written as brand Unknown / condition Fair
        brand_id: item.brand_id,
        x_studio_condition: item.x_studio_condition,
        db_image_count: vault.length,
        odoo_image_count: expected.length,
        reason,
        db_row_id: dbRow?.id || null,
      });
    }
    // Order: pieces not in the Vault yet, then real photo differences, then old file names. Shuffled within each group
    // on every run, so a piece that keeps failing can never block the queue.
    const rank = { new: 0, count: 1, changed: 1, old_file_names: 2 };
    for (const n of needs) n._r = Math.random();
    needs.sort((a, b) => rank[a.reason] - rank[b.reason] || a._r - b._r);

    if (dryRun) {
      const byReason = {};
      for (const n of needs) byReason[n.reason] = (byReason[n.reason] || 0) + 1;
      return res.status(200).json({
        total_odoo_jewellery: odooItems.length,
        total_db_jewellery: dbProducts.length,
        needs_sync_count: needs.length,
        by_reason: byReason,
        sample: needs.slice(0, 20).map(n => `${n.default_code} ${n.reason} vault=${n.db_image_count} odoo=${n.odoo_image_count}`),
      });
    }

    // 6. Process up to `limit` pieces: download their photos and make the Vault match Odoo exactly.
    const toProcess = needs.slice(0, limit);
    let upsertedRows = 0, imagesAdded = 0, itemsDone = 0;
    const errors = [];

    for (const n of toProcess) {
      if (Date.now() - startTime > 260000) break;

      const [fullItem] = await odooReadById('product.template', [n.odoo_id], ['image_1920']);
      const extrasRows = await odooSearchRead('product.image', [['product_tmpl_id', '=', n.odoo_id]], ['image_1920', 'sequence'], 500, 0);
      extrasRows.sort(byOdooOrder);
      const photos = [];
      const seen = new Set();
      const addPhoto = (b64, primary) => {
        if (!b64) return;
        const ck = imageKey(b64);
        if (seen.has(ck)) return;
        seen.add(ck);
        photos.push({ b64, ck, primary });
      };
      addPhoto(fullItem?.image_1920, true);
      for (const ex of extrasRows) addPhoto(ex.image_1920, false);
      if (photos.length === 0) {
        errors.push({ odoo_id: n.odoo_id, sku: n.default_code, stage: 'download', error: `Odoo lists ${n.odoo_image_count} photos but none could be read` });
        continue;
      }

      const categName = Array.isArray(n.categ_id) ? n.categ_id[1] : (typeof n.categ_id === 'string' ? n.categ_id : null);
      const subcategory = categName ? (JEWELLERY_TYPE_MAP[categName.toLowerCase()] || null) : null;

      const mapped = {
        subcategory,
        odoo_product_id: String(n.odoo_id),
        source: 'odoo',
        brand: (Array.isArray(n.brand_id) ? n.brand_id[1] : null) || brandMap[String(n.odoo_id)] || 'Unknown',
        model: (n.name || '').trim(),
        reference: n.default_code || null, // same as the full sync (was digits only, so the two jobs kept overwriting each other)
        price_eur: n.list_price || null,
        b2b_price_eur: n.x_b2b_price > 0 ? n.x_b2b_price : null,
        condition: n.x_studio_condition || 'Pre-owned', // same default as the full sync (was 'Fair')
        ...(deliveryMap ? { jewellery_extras: jewelleryScope(deliveryMap[String(n.odoo_id)]) } : {}),
        category: 'Jewellery',
        notes: n.description_sale && typeof n.description_sale === 'string' && n.description_sale.trim() ? n.description_sale.trim() : null,
        // Only set status on brand-new rows; leave existing status alone.
        ...(n.db_row_id ? {} : { status: 'available' }),
      };

      const write = m => supabase.from('products').upsert(m, { onConflict: 'odoo_product_id' }).select('id').single();
      let { data: upserted, error: upErr } = await write(mapped);
      // The database may reject jewellery_extras (e.g. the column was not added yet): write the row without
      // it so the piece and its photos still sync, and report it.
      if (upErr && 'jewellery_extras' in mapped) {
        const { jewellery_extras, ...rest } = mapped;
        const retry = await write(rest);
        if (!retry.error) errors.push({ odoo_id: n.odoo_id, sku: n.default_code, stage: 'scope_rejected', value: jewellery_extras, error: upErr.message });
        ({ data: upserted, error: upErr } = retry);
      }
      if (upErr) { errors.push({ odoo_id: n.odoo_id, sku: n.default_code, stage: 'upsert', error: upErr.message }); continue; }
      upsertedRows++;
      const productId = upserted.id;

      // Re-read the Vault photos (they may have changed since the plan) and stop if they already match.
      let { data: current, error: curErr } = await supabase.from('product_images')
        .select('id, url, position').eq('product_id', productId).order('position').order('id');
      if (curErr) { errors.push({ odoo_id: n.odoo_id, sku: n.default_code, stage: 'read_images', error: curErr.message }); continue; }
      if (sameList(current.map(i => urlKey(i.url)), photos.map(p => p.ck))) { itemsDone++; continue; }

      // Build the full set in Odoo's order. A photo already in the Vault (same fingerprint) is reused; others are uploaded
      // under a file named after the fingerprint, so a changed photo never reuses an old (cached) address.
      const urlByKey = new Map(current.filter(i => urlKey(i.url)).map(i => [urlKey(i.url), i.url]));
      const newRows = [];
      let failed = false;
      for (const [position, p] of photos.entries()) {
        // Stop before Vercel's 300 s limit even in the middle of a piece: the old photos stay and the next run redoes it.
        if (Date.now() - startTime > 285000) { errors.push({ odoo_id: n.odoo_id, sku: n.default_code, stage: 'timeout', error: 'stopped mid-piece near the time limit' }); failed = true; break; }
        let url = urlByKey.get(p.ck);
        if (!url) {
          const { ext, type } = imageFormat(p.b64);
          const path = `${productId}/odoo_${p.primary ? 'primary' : 'extra'}_${p.ck}.${ext}`;
          const { error: upErr2 } = await supabase.storage.from('watch-images').upload(path, Buffer.from(p.b64, 'base64'), { contentType: type, upsert: true });
          if (upErr2) { errors.push({ odoo_id: n.odoo_id, sku: n.default_code, stage: 'upload', error: upErr2.message }); failed = true; break; }
          url = supabase.storage.from('watch-images').getPublicUrl(path).data.publicUrl;
          imagesAdded++;
        }
        newRows.push({ product_id: productId, url, position });
      }
      if (failed) continue; // the old photos stay; the next run retries

      // Swap: add the new rows first and only then remove the old ones, so the piece is never left without photos.
      // (product_id, position) is unique, so the new rows go in at temporary positions above any real one and move to
      // 0, 1, 2 ... after the old rows are gone. If that last step stops halfway, the order is still right.
      const TEMP = 100000;
      // Leftovers of a swap that stopped halfway sit at temporary positions and would block this insert. The old photos
      // are still there in that case, so they can go.
      const leftovers = current.filter(i => i.position >= TEMP);
      if (leftovers.length) {
        const { error: lErr } = await supabase.from('product_images').delete().in('id', leftovers.map(i => i.id));
        if (lErr) { errors.push({ odoo_id: n.odoo_id, sku: n.default_code, stage: 'cleanup', error: lErr.message }); continue; }
        current = current.filter(i => i.position < TEMP);
      }
      const { data: inserted, error: insErr } = await supabase.from('product_images')
        .insert(newRows.map(r => ({ ...r, position: TEMP + r.position }))).select('id, position');
      if (insErr) { errors.push({ odoo_id: n.odoo_id, sku: n.default_code, stage: 'insert', error: insErr.message }); continue; }
      if (current.length) {
        const { error: delErr } = await supabase.from('product_images').delete().in('id', current.map(i => i.id));
        if (delErr) { errors.push({ odoo_id: n.odoo_id, sku: n.default_code, stage: 'delete_old', error: delErr.message }); continue; }
        const keep = new Set(newRows.map(r => r.url));
        const oldPaths = current.filter(i => !keep.has(i.url)).map(i => storagePath(i.url)).filter(Boolean);
        if (oldPaths.length) {
          const { error: rmErr } = await supabase.storage.from('watch-images').remove(oldPaths);
          if (rmErr) console.error('odoo-jewellery-sync-missing: old photo files not removed (harmless, unused):', productId, rmErr.message);
        }
      }
      for (const row of [...inserted].sort((a, b) => a.position - b.position)) {
        const { error: posErr } = await supabase.from('product_images').update({ position: row.position - TEMP }).eq('id', row.id);
        if (posErr) { errors.push({ odoo_id: n.odoo_id, sku: n.default_code, stage: 'reorder', error: posErr.message }); break; }
      }

      // Should not happen: Odoo's checksums and the downloaded photos disagree. Reported so it gets looked at.
      const expected = expectedByTmpl[n.odoo_id] || [];
      if (!sameList(photos.map(p => p.ck), expected)) {
        errors.push({ odoo_id: n.odoo_id, sku: n.default_code, stage: 'verify', error: `synced ${photos.length} photos, Odoo checksums list ${expected.length}` });
      }

      itemsDone++;
    }

    const result = {
      total_odoo_jewellery: odooItems.length,
      total_db_jewellery: dbProducts.length,
      needs_sync_count: needs.length,
      processed: itemsDone,
      upserted_rows: upsertedRows,
      images_added: imagesAdded,
      remaining: Math.max(0, needs.length - itemsDone),
      elapsed_ms: Date.now() - startTime,
      error_count: errors.length,
      errors: errors.length ? errors.slice(0, 20) : undefined,
    };
    // Recorded so failures are visible (cron-sync-health reads it).
    if (errors.length) console.error('odoo-jewellery-sync-missing errors:', JSON.stringify(errors.slice(0, 20)));
    if (!onlySku) await logRun({ ok: true, ...result });
    return res.status(200).json(result);
  } catch (err) {
    console.error('odoo-jewellery-sync-missing error:', err);
    if (!dryRun && !onlySku) await logRun({ ok: false, error: err.message, elapsed_ms: Date.now() - startTime });
    return res.status(500).json({ error: err.message });
  }
}

