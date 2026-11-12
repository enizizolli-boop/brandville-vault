import { createClient } from '@supabase/supabase-js';

// Daily (06:00 UTC, see vercel.json), read-only health check of the Odoo -> Vault syncs. It changes nothing: it compares Odoo with Supabase and
// records what does not match in sync_log (key sync_health), so problems are found before dealers see them.
//   level 'error' : a sync has stopped (no recent run) or failed on its last run
//   level 'warn'  : data differs between Odoo and the Vault (some differences are normal for one sync cycle)
// Responds 500 when there is any 'error', so the failed cron also shows in Vercel. ?details=1 lists every SKU.
//
// The rules below must stay the same as in the syncs they check:
//   bags      -> cron-odoo-bags-sync.js / odoo-bags-sync-missing.js (domain, RealReal, photo fingerprints)
//   jewellery -> cron-odoo-full-sync.js (sold rule, consignment, fetchDeliveryAttrs + jewelleryScope)

export const config = { maxDuration: 120 };

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB = process.env.ODOO_DB;
const ODOO_UID = parseInt(process.env.ODOO_USER_ID);
const ODOO_API_KEY = process.env.ODOO_API_KEY;

// Minutes after which a sync counts as stopped (its cron interval plus margin).
const MAX_AGE_MIN = { sync_odoo_bags: 75, sync_odoo_jewellery: 45, sync_odoo_bags_photos: 35 };
const SAMPLE = 15;

async function odoo(model, method, args, kwargs = {}) {
  const res = await fetch(ODOO_URL + '/jsonrpc', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service: 'object', method: 'execute_kw', args: [ODOO_DB, ODOO_UID, ODOO_API_KEY, model, method, args, kwargs] } }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`Odoo ${model}.${method}: ` + (j.error.data?.message || j.error.message));
  return j.result;
}

async function chunked(ids, size, fn) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(...await fn(ids.slice(i, i + size)));
  return out;
}

async function allRows(build) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

// ---- same rules as the syncs ------------------------------------------------------------------------------------
async function realRealOnlyIds() {
  const quants = await odoo('stock.quant', 'search_read',
    [[['location_id.warehouse_id.code', '=', 'Real'], ['location_id.usage', '=', 'internal'], ['quantity', '>', 0]]],
    { fields: ['product_tmpl_id', 'quantity'] });
  const rr = new Map();
  for (const q of quants) { const id = q.product_tmpl_id[0]; rr.set(id, (rr.get(id) || 0) + q.quantity); }
  if (!rr.size) return [];
  const t = await odoo('product.template', 'read', [[...rr.keys()], ['qty_available']]);
  return t.filter(x => (x.qty_available || 0) - rr.get(x.id) <= 0).map(x => x.id);
}

const urlKey = url => (String(url).match(/_([0-9a-f]{40})\.(?:jpg|png|webp)(?:\?|$)/) || [])[1] || null;
const sameList = (a, b) => a.length === b.length && a.every((k, i) => k === b[i]);
const byOdooOrder = (a, b) => (a.sequence || 0) - (b.sequence || 0) || a.id - b.id;

async function checksums(model, ids) {
  const rows = await chunked(ids, 1000, c => odoo('ir.attachment', 'search_read',
    [[['res_model', '=', model], ['res_field', '=', 'image_1920'], ['res_id', 'in', c]]], { fields: ['res_id', 'checksum'] }));
  return Object.fromEntries(rows.filter(r => r.checksum).map(r => [r.res_id, r.checksum]));
}

function jewelleryScope(d) {
  if (!d) return null;
  const none = d.comesWith && /^no box/i.test(d.comesWith);
  const parts = d.comesWith && !none ? d.comesWith.split('/').map(s => s.trim()).filter(Boolean) : [];
  parts.push(...d.extras);
  if (parts.length) return parts.join(', ');
  return none ? 'No Box or Papers' : null;
}

async function deliveryAttrs(templateIds) {
  const attrs = await odoo('product.attribute', 'search_read', [[['name', 'in', ['Comes with', 'Extras']]]], { fields: ['id', 'name'] });
  if (!attrs.length) return {};
  const attrName = Object.fromEntries(attrs.map(a => [a.id, a.name]));
  const valueName = Object.fromEntries((await odoo('product.attribute.value', 'search_read', [[['attribute_id', 'in', attrs.map(a => a.id)]]], { fields: ['id', 'name'] })).map(v => [v.id, v.name]));
  const rows = await chunked(templateIds, 1000, c => odoo('product.attribute.line.custom', 'search_read',
    [[['attribute_id', 'in', attrs.map(a => a.id)], ['product_tmpl_id', 'in', c]]], { fields: ['product_tmpl_id', 'attribute_id', 'value_ids'] }));
  const out = {};
  for (const r of rows) {
    const names = [...r.value_ids].sort((a, b) => a - b).map(v => valueName[v]).filter(Boolean);
    if (!names.length) continue;
    const e = (out[String(r.product_tmpl_id[0])] ||= { comesWith: null, extras: [] });
    if (attrName[r.attribute_id[0]] === 'Comes with') e.comesWith = names.join('/');
    else for (const n of names) if (!e.extras.includes(n)) e.extras.push(n);
  }
  return out;
}

// ---- checks -----------------------------------------------------------------------------------------------------
async function checkSyncRuns(add) {
  const { data, error } = await supabase.from('sync_log').select('key, last_sync_at, result').in('key', Object.keys(MAX_AGE_MIN));
  if (error) throw error;
  const byKey = Object.fromEntries(data.map(r => [r.key, r]));
  for (const [key, maxMin] of Object.entries(MAX_AGE_MIN)) {
    const row = byKey[key];
    const ageMin = row ? Math.round((Date.now() - new Date(row.last_sync_at).getTime()) / 60000) : null;
    if (ageMin === null || ageMin > maxMin) {
      add('error', `${key}: no successful run for ${ageMin === null ? 'ever' : ageMin + ' min'} (expected every ${maxMin} min at most). The job is failing or not scheduled; see its Vercel logs.`);
    }
    if (row?.result?.ok === false) add('error', `${key}: last run failed: ${row.result.error}`);
    if (row?.result?.error_count > 0) add('warn', `${key}: ${row.result.error_count} errors on the last run`, row.result.errors);
    if (row?.result?.delivery_lookup === 'failed') add('warn', `${key}: could not read Comes with / Extras from Odoo on the last run (scope of delivery left unchanged)`);
  }
}

async function checkBags(add, details) {
  const domain = [['active', '=', true], ['is_published', '=', true], ['x_vault_hold', '=', false],
    ['qty_available', '>', 0], ['virtual_available', '>', 0], ['categ_id', '!=', 8]];
  const rr = await realRealOnlyIds();
  if (rr.length) domain.push(['id', 'not in', rr]);
  const live = await odoo('product.template', 'search_read', [domain], { fields: ['id', 'default_code'] });
  const liveIds = new Set(live.map(b => String(b.id)));
  const skuOf = Object.fromEntries(live.map(b => [String(b.id), b.default_code]));

  const vault = await allRows(() => supabase.from('products').select('id, odoo_product_id, reference, status').eq('source', 'odoo_bags').order('id'));
  const visible = vault.filter(r => r.status === 'available');
  const visibleIds = new Set(visible.map(r => r.odoo_product_id));

  const shownNotLive = visible.filter(r => !liveIds.has(r.odoo_product_id));
  if (shownNotLive.length) add('warn', `bags: ${shownNotLive.length} shown in the Vault but sold, on hold or unpublished in Odoo (normal for up to 30 min)`, shownNotLive.map(r => r.reference));
  const liveNotShown = live.filter(b => !visibleIds.has(String(b.id)));
  if (liveNotShown.length) add('warn', `bags: ${liveNotShown.length} for sale in Odoo but not shown in the Vault (new bags wait for the photo job)`, liveNotShown.map(b => b.default_code));

  // Photos: same fingerprint comparison as odoo-bags-sync-missing.js.
  const ids = live.map(b => b.id);
  const extras = await chunked(ids, 500, c => odoo('product.image', 'search_read', [[['product_tmpl_id', 'in', c]]], { fields: ['product_tmpl_id', 'sequence'] }));
  const extrasBy = {};
  for (const e of extras) (extrasBy[e.product_tmpl_id[0]] ||= []).push(e);
  const pCk = await checksums('product.template', ids);
  const eCk = await checksums('product.image', extras.map(e => e.id));
  const rowByOdoo = Object.fromEntries(visible.map(r => [r.odoo_product_id, r]));
  const dbIds = visible.filter(r => liveIds.has(r.odoo_product_id)).map(r => r.id);
  const keysBy = {};
  for (let i = 0; i < dbIds.length; i += 100) {
    const imgs = await allRows(() => supabase.from('product_images').select('product_id, url, position, id')
      .in('product_id', dbIds.slice(i, i + 100)).order('product_id').order('position').order('id'));
    for (const r of imgs) (keysBy[r.product_id] ||= []).push(urlKey(r.url));
  }
  const wrong = [], oldNames = [], noPhotos = [];
  for (const id of ids) {
    const row = rowByOdoo[String(id)];
    if (!row) continue;
    const expected = [];
    if (pCk[id]) expected.push(pCk[id]);
    for (const e of (extrasBy[id] || []).sort(byOdooOrder)) { const ck = eCk[e.id]; if (ck && !expected.includes(ck)) expected.push(ck); }
    const got = keysBy[row.id] || [];
    if (got.length === 0) noPhotos.push(skuOf[String(id)]);
    else if (sameList(got, expected)) continue;
    else if (got.length === expected.length && got.includes(null)) oldNames.push(skuOf[String(id)]);
    else wrong.push(`${skuOf[String(id)]} (${got.length}/${expected.length})`);
  }
  if (noPhotos.length) add('warn', `bags: ${noPhotos.length} shown in the Vault with no photo`, noPhotos);
  if (wrong.length) add('warn', `bags: ${wrong.length} with photos that differ from Odoo (Vault/Odoo count; the photo job fixes 20 bags per 10 min)`, wrong);
  if (oldNames.length && details) add('info', `bags: ${oldNames.length} with old-style photo file names (same count; renamed by the photo job over time)`, oldNames);
  return { live: live.length, visible: visible.length, photos_checked: dbIds.length };
}

async function checkJewellery(add) {
  const all = await odoo('product.template', 'search_read',
    [[['sale_ok', '=', true], ['active', '=', true], ['categ_id', 'child_of', 8]]], { fields: ['id', 'default_code', 'virtual_available'] });
  const forSale = new Set(all.filter(t => t.virtual_available > 0).map(t => String(t.id)));
  const sku = Object.fromEntries(all.map(t => [String(t.id), t.default_code]));
  const vault = await allRows(() => supabase.from('products').select('odoo_product_id, reference, status, is_consignment, scope_of_delivery')
    .eq('source', 'odoo').eq('category', 'Jewellery').order('id'));
  const visible = vault.filter(r => r.status === 'available');
  const visibleIds = new Set(visible.map(r => r.odoo_product_id));

  // Consignment pieces stay visible on purpose whatever the stock (see cron-odoo-full-sync.js).
  const shownNotForSale = visible.filter(r => !forSale.has(r.odoo_product_id) && !r.is_consignment);
  if (shownNotForSale.length) add('warn', `jewellery: ${shownNotForSale.length} shown in the Vault but sold or gone in Odoo`, shownNotForSale.map(r => r.reference));
  const forSaleNotShown = [...forSale].filter(id => !visibleIds.has(id));
  if (forSaleNotShown.length) add('warn', `jewellery: ${forSaleNotShown.length} for sale in Odoo but not shown in the Vault`, forSaleNotShown.map(id => sku[id]));

  // Scope of delivery: the full sync covers every piece about once an hour, so a difference that lasts is a bug.
  const delivery = await deliveryAttrs(all.map(t => t.id));
  const scopeWrong = visible.filter(r => (jewelleryScope(delivery[r.odoo_product_id]) || null) !== (r.scope_of_delivery || null))
    .map(r => `${r.reference}: Vault "${r.scope_of_delivery || ''}" / Odoo "${jewelleryScope(delivery[r.odoo_product_id]) || ''}"`);
  if (scopeWrong.length) add('warn', `jewellery: ${scopeWrong.length} with a scope of delivery (Comes with / Extras) that differs from Odoo`, scopeWrong);
  return { for_sale: forSale.size, visible: visible.length };
}

export default async function handler(req, res) {
  const start = Date.now();
  const details = req.query?.details === '1';
  const problems = [];
  const add = (level, message, items) => problems.push({ level, message, ...(items?.length ? { count: items.length, sample: details ? items : items.slice(0, SAMPLE) } : {}) });
  const stats = {};

  // Each check on its own: one failing check must not hide the others.
  for (const [name, fn] of [['sync_runs', () => checkSyncRuns(add)], ['bags', () => checkBags(add, details)], ['jewellery', () => checkJewellery(add)]]) {
    try { stats[name] = await fn(); }
    catch (e) { add('error', `health check "${name}" could not run: ${e.message}`); }
  }

  const levels = problems.map(p => p.level);
  const status = levels.includes('error') ? 'error' : levels.includes('warn') ? 'warn' : 'ok';
  const result = { status, checked_at: new Date().toISOString(), elapsed_ms: Date.now() - start, stats, problems };
  if (status !== 'ok') console.error('sync health:', status, JSON.stringify(problems.map(p => `${p.level}: ${p.message}`)));
  if (!details) {
    const { error } = await supabase.from('sync_log').upsert({ key: 'sync_health', last_sync_at: result.checked_at, result });
    if (error) console.error('sync health: sync_log write failed:', error.message);
  }
  return res.status(status === 'error' ? 500 : 200).json(result);
}
