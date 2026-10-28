import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB = process.env.ODOO_DB;
const ODOO_UID = parseInt(process.env.ODOO_USER_ID);
const ODOO_API_KEY = process.env.ODOO_API_KEY;

async function getZohoAccessToken() {
  const res = await fetch('https://accounts.zoho.eu/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: process.env.ZOHO_REFRESH_TOKEN,
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Zoho token failed: ' + JSON.stringify(data));
  return data.access_token;
}

async function fetchZohoSoItemIds(accessToken) {
  // Returns item_ids that appear on confirmed/open Zoho Sales Orders.
  // These watches are reserved regardless of what the stock level shows.
  const soldItemIds = new Set();
  const ACTIVE_STATUSES = ['confirmed', 'partially_invoiced'];
  for (const status of ACTIVE_STATUSES) {
    let page = 1;
    while (true) {
      const res = await fetch(
        `https://www.zohoapis.eu/inventory/v1/salesorders?organization_id=${process.env.ZOHO_ORG_ID}&status=${status}&per_page=200&page=${page}`,
        { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
      );
      const data = await res.json();
      if (!data.salesorders || data.salesorders.length === 0) break;
      for (const so of data.salesorders) {
        for (const line of (so.line_items || [])) {
          if (line.item_id) soldItemIds.add(String(line.item_id));
        }
      }
      if (data.salesorders.length < 200) break;
      page++;
    }
  }
  return soldItemIds;
}

async function fetchAllZohoItems(accessToken) {
  let items = [], page = 1;
  while (true) {
    const res = await fetch(
      `https://www.zohoapis.eu/inventory/v1/items?organization_id=${process.env.ZOHO_ORG_ID}&per_page=200&page=${page}&status=active`,
      { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
    );
    const data = await res.json();
    if (!data.items || data.items.length === 0) break;
    items = items.concat(data.items);
    if (data.items.length < 200) break;
    page++;
  }
  return items;
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
  m = raw.match(/^<boolean>([01])<\/boolean>$/);
  if (m) return m[1] === '1';
  // Odoo sends quantities as <double>; without this they were read as null and every item looked out of stock
  m = raw.match(/^<double>([^<]+)<\/double>$/);
  if (m) return parseFloat(m[1]);
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
  m = raw.match(/<int>(\d+)<\/int>/);
  if (m) return parseInt(m[1]);
  return null;
}

async function fetchOdooQtyMap(odooIds) {
  // Returns a Map of odoo_product_id (string) → qty_available for all given IDs
  if (!odooIds.length) return new Map();
  try {
    const CHUNK = 200;
    const qtyMap = new Map();
    for (let i = 0; i < odooIds.length; i += CHUNK) {
      const chunk = odooIds.slice(i, i + CHUNK);
      const idsXml = chunk.map(id => `<value><int>${id}</int></value>`).join('');
      const domainXml = `<value><array><data><value><string>id</string></value><value><string>in</string></value><value><array><data>${idsXml}</data></array></value></data></array></value>`;
      // Only items still for sale in Odoo (same rule as the jewellery full sync): not-for-sale items are
      // missing from the result, so they count as sold and can never be restored to available here.
      const saleOkXml = `<value><array><data><value><string>sale_ok</string></value><value><string>=</string></value><value><boolean>1</boolean></value></data></array></value>`;
      const body = `<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>` +
        `<param><value><string>${ODOO_DB}</string></value></param>` +
        `<param><value><int>${ODOO_UID}</int></value></param>` +
        `<param><value><string>${ODOO_API_KEY}</string></value></param>` +
        `<param><value><string>product.template</string></value></param>` +
        `<param><value><string>search_read</string></value></param>` +
        `<param><value><array><data><value><array><data>${domainXml}${saleOkXml}</data></array></value></data></array></value></param>` +
        `<param><value><struct>` +
        `<member><name>fields</name><value><array><data><value><string>id</string></value><value><string>virtual_available</string></value></data></array></value></member>` +
        `<member><name>limit</name><value><int>${CHUNK}</int></value></member>` +
        `</struct></value></param></params></methodCall>`;
      const res = await fetch(ODOO_URL + '/xmlrpc/2/object', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body });
      const text = await res.text();
      if (!text.includes('<fault>')) {
        for (const item of parseItems(text)) {
          if (item.id !== undefined) qtyMap.set(String(item.id), typeof item.virtual_available === 'number' ? item.virtual_available : null);
        }
      }
    }
    return qtyMap;
  } catch (e) {
    console.error('fetchOdooQtyMap error:', e);
    return new Map();
  }
}

export default async function handler(req, res) {
  // Accept GET (Vercel cron) or POST (manual trigger)
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  try {
    // Bags/accessories/shoes (source odoo_bags) are no longer handled here. Their sold/available status comes
    // from cron-odoo-bags-sync, which uses Odoo stock (on hand and forecast quantity). The sale-order lookup that
    // used to run here read only 5,000 of 27,000+ order lines and fought the bags sync.
    const markedSold = 0;
    const markedAvailable = 0;

    // Also update jewellery status (source = 'odoo', category = 'Jewellery')
    // Paged: Supabase returns at most 1000 rows per request, so a single query skipped part of the jewellery.
    const allJewellery = [];
    for (let from = 0; ; from += 1000) {
      const { data: page, error: jErr } = await supabase
        .from('products')
        .select('id, odoo_product_id, status')
        .eq('source', 'odoo')
        .eq('category', 'Jewellery')
        .order('id')
        .range(from, from + 999);
      if (jErr) throw jErr;
      allJewellery.push(...page);
      if (page.length < 1000) break;
    }

    let jewelleryMarkedSold = 0;
    let jewelleryMarkedAvailable = 0;

    if (allJewellery && allJewellery.length > 0) {
      const jewelleryOdooIds = allJewellery.map(w => parseInt(w.odoo_product_id)).filter(Boolean);
      const qtyMap = await fetchOdooQtyMap(jewelleryOdooIds);

      // Safety guard: if Odoo returned nothing (timeout/error), skip entirely —
      // an empty qtyMap would mark every item as sold (qty === undefined → isSold)
      if (qtyMap.size === 0) {
        console.error('Odoo qty fetch returned empty map — skipping jewellery status update to prevent mass wipe');
      } else {
        for (const item of allJewellery) {
          const qty = qtyMap.get(item.odoo_product_id);
          // null = Odoo returned the item but the quantity could not be read: leave the status alone
          if (qty === null) continue;
          const isSold = qty === undefined || qty <= 0;

          if (isSold && item.status !== 'sold') {
            await supabase.from('products').update({ status: 'sold' }).eq('id', item.id);
            jewelleryMarkedSold++;
          } else if (!isSold && item.status === 'sold') {
            await supabase.from('products').update({ status: 'available' }).eq('id', item.id);
            jewelleryMarkedAvailable++;
          }
        }
      }
    }

    // Check ALL Zoho watches against live Zoho stock every run
    let zohoMarkedSold = 0, zohoMarkedAvailable = 0;
    try {
      const zohoToken = await getZohoAccessToken();
      const allZohoItems = await fetchAllZohoItems(zohoToken);
      if (allZohoItems.length > 0) {
        const liveIds = new Set(
          allZohoItems
            .filter(i => (i.show_in_storefront === true || i.show_in_storefront === 'true') && Number(i.actual_available_stock ?? i.available_stock ?? i.stock_on_hand ?? 0) > 0)
            .map(i => String(i.item_id))
        );
        const { data: zohoProducts } = await supabase.from('products').select('id, zoho_item_id, status, updated_at').eq('source', 'zoho');
        const RESTORE_AFTER_MS = 24 * 60 * 60 * 1000; // 24 hours
        for (const p of zohoProducts || []) {
          const isLive = liveIds.has(p.zoho_item_id);
          if (!isLive && p.status !== 'sold') {
            await supabase.from('products').update({ status: 'sold' }).eq('id', p.id);
            zohoMarkedSold++;
          } else if (isLive && p.status === 'sold') {
            // Only restore if sold for >24h — prevents SO merge/cancellation windows
            // (which last minutes) from triggering a false restore.
            // Genuine returns take at least a day before the watch is back on sale.
            const soldMs = Date.now() - new Date(p.updated_at).getTime();
            if (soldMs > RESTORE_AFTER_MS) {
              await supabase.from('products').update({ status: 'available' }).eq('id', p.id);
              zohoMarkedAvailable++;
            }
          }
        }
      }
      // Also check Zoho SOs — a confirmed SO means the watch is reserved regardless of stock
      let zohoNativeSoMarkedSold = 0;
      try {
        const soItemIds = await fetchZohoSoItemIds(zohoToken);
        if (soItemIds.size > 0) {
          const { data: notSold } = await supabase
            .from('products')
            .select('id, zoho_item_id')
            .eq('source', 'zoho')
            .neq('status', 'sold');
          for (const p of notSold || []) {
            if (soItemIds.has(p.zoho_item_id)) {
              await supabase.from('products').update({ status: 'sold' }).eq('id', p.id);
              zohoNativeSoMarkedSold++;
            }
          }
        }
      } catch (e) {
        console.error('Zoho SO check error:', e.message);
      }
      zohoMarkedSold += zohoNativeSoMarkedSold;
    } catch (e) {
      console.error('Zoho status check error:', e.message);
    }

    console.log(`Cron status sync: ${markedSold} marked sold, ${markedAvailable} restored available | jewellery: ${jewelleryMarkedSold} sold, ${jewelleryMarkedAvailable} restored | zoho: ${zohoMarkedSold} sold, ${zohoMarkedAvailable} restored`);
    return res.status(200).json({
      success: true,
      marked_sold: markedSold,
      marked_available: markedAvailable,
      jewellery_marked_sold: jewelleryMarkedSold,
      jewellery_marked_available: jewelleryMarkedAvailable,
      jewellery_checked: allJewellery?.length || 0,
      zoho_marked_sold: zohoMarkedSold,
      zoho_marked_available: zohoMarkedAvailable,
    });
  } catch (err) {
    console.error('Cron status sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
