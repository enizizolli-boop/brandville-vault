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
  const startTime = Date.now();
  const limit = parseInt(req.query?.limit || '20');
  const dryRun = req.query?.dry_run === '1';
  const onlySku = req.query?.sku || null;

  try {
    // 1. List all eligible Odoo bags (metadata only, no image data) — cheap.
    const domain = [
      ['active', '=', true],
      ['website_published', '=', true],
      ['dr_free_qty', '>', 0],
      ['categ_id', '!=', 8],
    ];
    let odooBags = [];
    let page = 0;
    const pageSize = 200;
    while (true) {
      const batch = await odooSearchRead(
        'product.template', domain,
        ['id', 'name', 'default_code', 'standard_price', 'description_sale', 'categ_id'],
        pageSize, page * pageSize
      );
      if (!batch.length) break;
      odooBags = odooBags.concat(batch);
      if (batch.length < pageSize) break;
      page++;
    }

    // 2. Count extra images per Odoo template (one search_read, sequence irrelevant for counting).
    const allIds = odooBags.map(b => b.id);
    const extrasByTmpl = {};
    if (allIds.length > 0) {
      // Chunked to avoid huge payloads
      const CHUNK = 500;
      for (let i = 0; i < allIds.length; i += CHUNK) {
        const chunk = allIds.slice(i, i + CHUNK);
        const idsXml = chunk.map(id => `<value><int>${id}</int></value>`).join('');
        const domainXml = `<value><array><data><value><array><data><value><string>product_tmpl_id</string></value><value><string>in</string></value><value><array><data>${idsXml}</data></array></value></data></array></value></data></array></value>`;
        const body = `<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>` +
          `<param><value><string>${ODOO_DB}</string></value></param>` +
          `<param><value><int>${ODOO_UID}</int></value></param>` +
          `<param><value><string>${ODOO_API_KEY}</string></value></param>` +
          `<param><value><string>product.image</string></value></param>` +
          `<param><value><string>search_read</string></value></param>` +
          `<param><value><array><data>${domainXml}</data></array></value></param>` +
          `<param><value><struct>` +
          `<member><name>fields</name><value><array><data><value><string>product_tmpl_id</string></value></data></array></value></member>` +
          `<member><name>limit</name><value><int>10000</int></value></member>` +
          `</struct></value></param></params></methodCall>`;
        const r = await fetch(ODOO_URL + '/xmlrpc/2/object', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body });
        const t = await r.text();
        if (t.includes('<fault>')) throw new Error('extra count fault: ' + t.substring(0, 200));
        for (const row of parseItems(t)) {
          const tmplId = String(Array.isArray(row.product_tmpl_id) ? row.product_tmpl_id[0] : row.product_tmpl_id);
          extrasByTmpl[tmplId] = (extrasByTmpl[tmplId] || 0) + 1;
        }
      }
    }

    // 3. Fetch Supabase state: bag products + per-product image counts.
    const { data: dbProducts } = await supabase
      .from('products')
      .select('id, odoo_product_id')
      .eq('source', 'odoo_bags');
    const dbByOdooId = new Map((dbProducts || []).map(p => [String(p.odoo_product_id), p]));

    const dbIds = (dbProducts || []).map(p => p.id);
    const imageCountByDbId = new Map();
    if (dbIds.length > 0) {
      // Supabase returns at most 1000 rows per request. With ~10 images per bag,
      // a single IN() query covering hundreds of product_ids would truncate.
      // Small chunks + explicit .range() pagination guarantees a complete count.
      const ID_CHUNK = 100;
      for (let i = 0; i < dbIds.length; i += ID_CHUNK) {
        const chunkIds = dbIds.slice(i, i + ID_CHUNK);
        const PAGE = 1000;
        let from = 0;
        while (true) {
          const { data: imgs } = await supabase
            .from('product_images')
            .select('product_id')
            .in('product_id', chunkIds)
            .range(from, from + PAGE - 1);
          if (!imgs || imgs.length === 0) break;
          for (const r of imgs) {
            imageCountByDbId.set(r.product_id, (imageCountByDbId.get(r.product_id) || 0) + 1);
          }
          if (imgs.length < PAGE) break;
          from += PAGE;
        }
      }
    }

    // 4. Identify bags where DB images < extras count (definitely missing).
    //    We intentionally use extras-only as the lower bound to avoid fetching image_1920
    //    (heavy base64) on every item just to verify. Items with a primary image already
    //    uploaded will still land here if extras are missing, which is the common case.
    const needs = [];
    for (const bag of odooBags) {
      if (onlySku && bag.default_code !== onlySku) continue;
      const odooId = String(bag.id);
      const dbRow = dbByOdooId.get(odooId);
      const dbImageCount = dbRow ? (imageCountByDbId.get(dbRow.id) || 0) : 0;
      const extrasCount = extrasByTmpl[odooId] || 0;
      // Missing if: no DB row yet, OR DB image count is less than Odoo extras count.
      if (!dbRow || dbImageCount < extrasCount) {
        needs.push({
          odoo_id: bag.id,
          name: bag.name,
          default_code: bag.default_code,
          description_sale: bag.description_sale,
          categ_id: bag.categ_id,
          standard_price: bag.standard_price,
          db_image_count: dbImageCount,
          extras_count: extrasCount,
          db_row_id: dbRow?.id || null,
        });
      }
    }

    if (dryRun) {
      return res.status(200).json({
        total_odoo_bags: odooBags.length,
        total_db_bags: dbProducts?.length || 0,
        needs_sync_count: needs.length,
        sample: needs.slice(0, 20),
      });
    }

    // 5. Process up to `limit` items: fetch heavy data (primary + extras) just for them.
    const toProcess = needs.slice(0, limit);
    let upsertedRows = 0, imagesAdded = 0, itemsDone = 0;
    const errors = [];

    for (const n of toProcess) {
      if (Date.now() - startTime > 260000) break;

      // Fetch the one item's image_1920 + metadata
      const [fullItem] = await odooReadById('product.template', [n.odoo_id], ['image_1920']);
      const extrasRows = await odooSearchRead(
        'product.image',
        [['product_tmpl_id', '=', n.odoo_id]],
        ['image_1920', 'sequence'],
        500, 0
      );
      extrasRows.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

      const hasPrimary = fullItem?.image_1920 && fullItem.image_1920 !== false;
      const odooTotal = (hasPrimary ? 1 : 0) + extrasRows.length;
      if (odooTotal === 0) continue;

      // Upsert product row
      const cost = n.standard_price || 0;
      const priceEur = cost > 0 ? Math.round(cost * PRICE_MARKUP * 100) / 100 : null;
      const categName = (Array.isArray(n.categ_id) ? n.categ_id[1] : n.categ_id || '').replace('All / ', '').toLowerCase();
      const { category, subcategory } = CATEG_MAP[categName] || { category: 'Accessories', subcategory: null };

      const mapped = {
        odoo_product_id: String(n.odoo_id),
        source: 'odoo_bags',
        brand: extractBrand(n.name, n.default_code),
        model: (n.name || '').trim(),
        reference: n.default_code || null,
        price_eur: priceEur,
        category,
        subcategory: subcategory || null,
        condition: 'Pre-owned',
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
      const productId = upserted.id;

      // Re-read DB image count (in case it changed since the plan)
      const { count: dbCount } = await supabase
        .from('product_images')
        .select('id', { count: 'exact', head: true })
        .eq('product_id', productId);
      let existing = dbCount || 0;
      let position = existing;

      // Upload primary if missing
      if (existing === 0 && hasPrimary) {
        try {
          const buffer = Buffer.from(fullItem.image_1920, 'base64');
          const path = productId + '/bag_primary.jpg';
          const { error: upErr2 } = await supabase.storage.from('watch-images').upload(path, buffer, { contentType: 'image/jpeg', upsert: true });
          if (!upErr2) {
            const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path);
            await supabase.from('product_images').insert({ product_id: productId, url: publicUrl, position });
            position++; existing++; imagesAdded++;
          }
        } catch (e) { errors.push({ odoo_id: n.odoo_id, stage: 'primary', error: String(e) }); }
      }

      // Upload extras beyond what's already in DB
      const alreadyUploadedExtras = Math.max(0, existing - (hasPrimary ? 1 : 0));
      const extrasToUpload = extrasRows.slice(alreadyUploadedExtras);
      for (const ex of extrasToUpload) {
        if (!ex.image_1920 || ex.image_1920 === false) continue;
        try {
          const buffer = Buffer.from(ex.image_1920, 'base64');
          const path = `${productId}/bag_extra_${position}.jpg`;
          const { error: upErr2 } = await supabase.storage.from('watch-images').upload(path, buffer, { contentType: 'image/jpeg', upsert: true });
          if (!upErr2) {
            const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path);
            await supabase.from('product_images').insert({ product_id: productId, url: publicUrl, position });
            position++; imagesAdded++;
          }
        } catch (e) { errors.push({ odoo_id: n.odoo_id, stage: 'extra', error: String(e) }); }
      }

      itemsDone++;
    }

    return res.status(200).json({
      total_odoo_bags: odooBags.length,
      total_db_bags: dbProducts?.length || 0,
      needs_sync_count: needs.length,
      processed: itemsDone,
      upserted_rows: upsertedRows,
      images_added: imagesAdded,
      remaining: Math.max(0, needs.length - itemsDone),
      elapsed_ms: Date.now() - startTime,
      errors: errors.length ? errors.slice(0, 20) : undefined,
    });
  } catch (err) {
    console.error('odoo-bags-sync-missing error:', err);
    return res.status(500).json({ error: err.message });
  }
}
