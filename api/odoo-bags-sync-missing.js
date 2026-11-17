import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { toJpeg } from './_imageUtils.js';

// Photos are compared by fingerprint: the SHA-1 of the image bytes, which is exactly the checksum Odoo stores for every
// image. (Comparing only the first 100 base64 characters matched the file header, which is the same for every photo of
// the same size and format, so different photos were dropped as duplicates and bags lost most of their photos.)
const imageKey = b64 => createHash('sha1').update(Buffer.from(String(b64), 'base64')).digest('hex');
// Fingerprint in a Vault photo address (files are named bag_primary_<sha1>.jpg / bag_extra_<sha1>.png); null for old names.
const urlKey = url => (String(url).match(/_([0-9a-f]{40})\.(?:jpg|png|webp)(?:\?|$)/) || [])[1] || null;
const sameList = (a, b) => a.length === b.length && a.every((k, i) => k === b[i]);
const byOdooOrder = (a, b) => (a.sequence || 0) - (b.sequence || 0) || a.id - b.id;
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

// Templates whose entire on-hand stock sits in the RealReal warehouse (consigned there, code 'Real').
// They are not for sale in the Vault, so they are left out of the live list and get marked sold.
// Stock in any other warehouse (Tirana, Magazina Zyra TR, Bulgaria, ...) still counts.
async function fetchRealRealOnlyIds() {
  const quants = await odooSearchRead('stock.quant',
    [['location_id.warehouse_id.code', '=', 'Real'], ['location_id.usage', '=', 'internal'], ['quantity', '>', 0]],
    ['product_tmpl_id', 'quantity'], 5000, 0);
  const realReal = new Map();
  for (const q of quants) {
    const id = Array.isArray(q.product_tmpl_id) ? q.product_tmpl_id[0] : q.product_tmpl_id;
    if (typeof id === 'number') realReal.set(id, (realReal.get(id) || 0) + (q.quantity || 0));
  }
  if (realReal.size === 0) return [];
  const templates = await odooSearchRead('product.template', [['id', 'in', [...realReal.keys()]]], ['id', 'qty_available'], realReal.size, 0);
  return templates.filter(t => (t.qty_available || 0) - realReal.get(t.id) <= 0).map(t => t.id);
}

// Last run of this job in sync_log (key sync_odoo_bags_photos). Never throws: logging must not break the sync.
async function logRun(result) {
  try {
    const { error } = await supabase.from('sync_log').upsert({ key: 'sync_odoo_bags_photos', last_sync_at: new Date().toISOString(), result });
    if (error) console.error('odoo-bags-sync-missing: sync_log write failed:', error.message);
  } catch (e) { console.error('odoo-bags-sync-missing: sync_log write failed:', e.message); }
}

export default async function handler(req, res) {
  const startTime = Date.now();
  const limit = parseInt(req.query?.limit || '20');
  const dryRun = req.query?.dry_run === '1';
  const onlySku = req.query?.sku || null;

  try {
    // 1. List all eligible Odoo bags (metadata only, no image data) — cheap.
    const domain = [
      ['active', '=', true],
      ['is_published', '=', true],
      // Shop rule in Odoo: a bag in the Tirana (1|Tirane) or Sofia (BGStore) shop shows in the Vault only after 2 months
      // there. Odoo sets x_vault_hold itself and clears it on x_vault_from. A held bag drops out of this list, so it is
      // marked sold (hidden) like any other bag that left the list, and comes back as available once the hold ends.
      ['x_vault_hold', '=', false],
      ['qty_available', '>', 0],
      // also require forecast > 0: a bag reserved on a confirmed order (on hand 1, forecast 0) is sold.
      // on hand must stay > 0 too, so a stale incoming transfer can never bring a sold bag back.
      ['virtual_available', '>', 0],
      ['categ_id', '!=', 8],
    ];

    // Not for sale: bags whose only stock is at RealReal
    const realRealOnly = await fetchRealRealOnlyIds();
    if (realRealOnly.length > 0) domain.push(['id', 'not in', realRealOnly]);
    let odooBags = [];
    let page = 0;
    const pageSize = 200;
    while (true) {
      const batch = await odooSearchRead(
        'product.template', domain,
        ['id', 'name', 'default_code', 'standard_price', 'list_price', 'x_b2b_price', 'description_sale', 'categ_id', 'x_studio_condition'],
        pageSize, page * pageSize
      );
      if (!batch.length) break;
      odooBags = odooBags.concat(batch);
      if (batch.length < pageSize) break;
      page++;
    }

    // 2. The photos each bag has in Odoo, in order, as fingerprints. Odoo stores a SHA-1 checksum of every image
    //    (ir.attachment.checksum), so this needs no photo downloads. Order: main photo, then the extra photos by
    //    sequence, then id. A photo stored twice (e.g. the main photo also saved as an extra) is listed once.
    const allIds = odooBags.map(b => b.id);
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

    // 3. The photos each bag has in the Vault, in order. Photo files are named after their fingerprint, so the list can
    //    be compared with Odoo's directly (older files named bag_primary.jpg / bag_extra_N.jpg have no fingerprint).
    // Paged: Supabase returns at most 1000 rows per request. Reading only the first 1000 made the other bags
    // look "missing", so their primary photo was inserted again on every run.
    const dbProducts = [];
    for (let from = 0; ; from += 1000) {
      const { data: page, error: pageErr } = await supabase
        .from('products')
        .select('id, odoo_product_id')
        .eq('source', 'odoo_bags')
        .order('id')
        .range(from, from + 999);
      if (pageErr) throw pageErr;
      dbProducts.push(...page);
      if (page.length < 1000) break;
    }
    const dbByOdooId = new Map(dbProducts.map(p => [String(p.odoo_product_id), p]));
    const keysByDbId = new Map();
    const dbIds = dbProducts.map(p => p.id);
    for (let i = 0; i < dbIds.length; i += 100) {
      for (let from = 0; ; from += 1000) {
        const { data: imgs, error: imgErr } = await supabase.from('product_images')
          .select('product_id, url, position').in('product_id', dbIds.slice(i, i + 100))
          .order('product_id').order('position').order('id').range(from, from + 999);
        if (imgErr) throw imgErr;
        for (const r of imgs) {
          if (!keysByDbId.has(r.product_id)) keysByDbId.set(r.product_id, []);
          keysByDbId.get(r.product_id).push(urlKey(r.url));
        }
        if (imgs.length < 1000) break;
      }
    }

    // 4. A bag needs work when it is not in the Vault yet, or its Vault photos differ from Odoo's in any way
    //    (missing, extra, replaced, reordered). Real differences go first, renaming old files last.
    const needs = [];
    for (const bag of odooBags) {
      if (onlySku && bag.default_code !== onlySku) continue;
      const expected = expectedByTmpl[bag.id] || [];
      const dbRow = dbByOdooId.get(String(bag.id));
      if (!dbRow && expected.length === 0) continue; // nothing to show yet
      const vault = dbRow ? (keysByDbId.get(dbRow.id) || []) : [];
      if (dbRow && sameList(vault, expected)) continue;
      const reason = !dbRow ? 'new'
        : vault.length !== expected.length ? 'count'
        : vault.includes(null) ? 'old_file_names'
        : 'changed';
      needs.push({
        odoo_id: bag.id,
        name: bag.name,
        default_code: bag.default_code,
        description_sale: bag.description_sale,
        categ_id: bag.categ_id,
        standard_price: bag.standard_price,
        list_price: bag.list_price,
        x_b2b_price: bag.x_b2b_price,
        x_studio_condition: bag.x_studio_condition,
        db_image_count: vault.length,
        odoo_image_count: expected.length,
        reason,
        db_row_id: dbRow?.id || null,
      });
    }
    // Order: bags not in the Vault yet, then real photo differences, then old file names. Shuffled within each group on
    // every run, so a bag that keeps failing can never block the queue. (The old job always took the same first bags; some
    // of them could never be completed, so every run worked on those and new bags never reached the Vault.)
    const rank = { new: 0, count: 1, changed: 1, old_file_names: 2 };
    for (const n of needs) n._r = Math.random();
    needs.sort((a, b) => rank[a.reason] - rank[b.reason] || a._r - b._r);

    if (dryRun) {
      const byReason = {};
      for (const n of needs) byReason[n.reason] = (byReason[n.reason] || 0) + 1;
      return res.status(200).json({
        total_odoo_bags: odooBags.length,
        total_db_bags: dbProducts.length,
        needs_sync_count: needs.length,
        by_reason: byReason,
        sample: needs.slice(0, 20),
      });
    }

    // 5. Process up to `limit` bags: download their photos and make the Vault match Odoo exactly.
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

      // Upsert product row
      const cost = n.standard_price || 0;
      const priceEur = cost > 0 ? Math.round(cost * PRICE_MARKUP * 100) / 100 : null;
      const categName = (Array.isArray(n.categ_id) ? n.categ_id[1] : n.categ_id || '').replace('All / ', '').toLowerCase();
      const { category, subcategory } = CATEG_MAP[categName] || { category: 'Accessories', subcategory: null };

      let productId;
      if (n.db_row_id) {
        // The row already exists: only fix its photos. Brand, condition and prices belong to
        // cron-odoo-bags-sync; overwriting them here made the two jobs undo each other.
        productId = n.db_row_id;
      } else {
        const mapped = {
          odoo_product_id: String(n.odoo_id),
          source: 'odoo_bags',
          brand: extractBrand(n.name, n.default_code),
          model: (n.name || '').trim(),
          reference: n.default_code || null,
          price_eur: priceEur,
          cost_eur: cost > 0 ? cost : null,
          b2c_price_eur: n.list_price > 0 ? n.list_price : null,
          b2b_price_eur: n.x_b2b_price > 0 ? n.x_b2b_price : null,
          category,
          subcategory: subcategory || null,
          condition: n.x_studio_condition || '',
          notes: n.description_sale && typeof n.description_sale === 'string' && n.description_sale.trim() ? n.description_sale.trim() : null,
          status: 'available',
        };
        const { data: upserted, error: upErr } = await supabase
          .from('products')
          .upsert(mapped, { onConflict: 'odoo_product_id' })
          .select('id')
          .single();
        if (upErr) { errors.push({ odoo_id: n.odoo_id, stage: 'upsert', error: upErr.message }); continue; }
        upsertedRows++;
        productId = upserted.id;
      }

      // Re-read the Vault photos (they may have changed since the plan) and stop if they already match.
      let { data: current, error: curErr } = await supabase.from('product_images')
        .select('id, url, position').eq('product_id', productId).order('position').order('id');
      if (curErr) { errors.push({ odoo_id: n.odoo_id, stage: 'read_images', error: curErr.message }); continue; }
      if (sameList(current.map(i => urlKey(i.url)), photos.map(p => p.ck))) { itemsDone++; continue; }

      // Build the full set in Odoo's order. A photo already in the Vault (same fingerprint) is reused; others are uploaded
      // under a file named after the fingerprint, so a changed photo never reuses an old (cached) address.
      const urlByKey = new Map(current.filter(i => urlKey(i.url)).map(i => [urlKey(i.url), i.url]));
      const newRows = [];
      let failed = false;
      for (const [position, p] of photos.entries()) {
        // Stop before Vercel's 300 s limit even in the middle of a bag: the old photos stay and the next run redoes it.
        if (Date.now() - startTime > 285000) { errors.push({ odoo_id: n.odoo_id, sku: n.default_code, stage: 'timeout', error: 'stopped mid-bag near the time limit' }); failed = true; break; }
        let url = urlByKey.get(p.ck);
        if (!url) {
          const buffer = await toJpeg(Buffer.from(p.b64, 'base64'));
          const path = `${productId}/bag_${p.primary ? 'primary' : 'extra'}_${p.ck}.jpg`;
          const { error: upErr } = await supabase.storage.from('watch-images').upload(path, buffer, { contentType: 'image/jpeg', upsert: true });
          if (upErr) { errors.push({ odoo_id: n.odoo_id, sku: n.default_code, stage: 'upload', error: upErr.message }); failed = true; break; }
          url = supabase.storage.from('watch-images').getPublicUrl(path).data.publicUrl;
          imagesAdded++;
        }
        newRows.push({ product_id: productId, url, position });
      }
      if (failed) continue; // the old photos stay; the next run retries

      // Swap: add the new rows first and only then remove the old ones, so the bag is never left without photos.
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
          if (rmErr) console.error('odoo-bags-sync-missing: old photo files not removed (harmless, unused):', productId, rmErr.message);
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
      total_odoo_bags: odooBags.length,
      total_db_bags: dbProducts?.length || 0,
      needs_sync_count: needs.length,
      processed: itemsDone,
      upserted_rows: upsertedRows,
      images_added: imagesAdded,
      remaining: Math.max(0, needs.length - itemsDone),
      elapsed_ms: Date.now() - startTime,
      error_count: errors.length,
      errors: errors.length ? errors.slice(0, 20) : undefined,
    };
    // Recorded so failures are visible (cron-sync-health reads it); before, errors only went into a response nobody read.
    if (errors.length) console.error('odoo-bags-sync-missing errors:', JSON.stringify(errors.slice(0, 20)));
    if (!onlySku) await logRun({ ok: true, ...result });
    return res.status(200).json(result);
  } catch (err) {
    console.error('odoo-bags-sync-missing error:', err);
    if (!dryRun && !onlySku) await logRun({ ok: false, error: err.message, elapsed_ms: Date.now() - startTime });
    return res.status(500).json({ error: err.message });
  }
}
