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

async function fetchSoldProductTemplateIds() {
  try {
    // Step 1: product.product IDs from non-cancelled sale order lines
    const body1 = `<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>` +
      `<param><value><string>${ODOO_DB}</string></value></param>` +
      `<param><value><int>${ODOO_UID}</int></value></param>` +
      `<param><value><string>${ODOO_API_KEY}</string></value></param>` +
      `<param><value><string>sale.order.line</string></value></param>` +
      `<param><value><string>search_read</string></value></param>` +
      `<param><value><array><data><value><array><data>` +
      `<value><array><data><value><string>order_id.state</string></value><value><string>in</string></value><value><array><data><value><string>sale</string></value><value><string>done</string></value></data></array></value></data></array></value>` +
      `</data></array></value></data></array></value></param>` +
      `<param><value><struct>` +
      `<member><name>fields</name><value><array><data><value><string>product_id</string></value></data></array></value></member>` +
      `<member><name>limit</name><value><int>5000</int></value></member>` +
      `</struct></value></param></params></methodCall>`;
    const res1 = await fetch(ODOO_URL + '/xmlrpc/2/object', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body: body1 });
    const text1 = await res1.text();
    if (text1.includes('<fault>')) { console.error('cron step1 fault:', text1.substring(0, 300)); return new Set(); }

    const lines = parseItems(text1);
    const variantIds = [...new Set(lines.map(l => {
      const pid = Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;
      return typeof pid === 'number' ? pid : null;
    }).filter(Boolean))];

    if (!variantIds.length) return new Set();

    // Step 2: map product.product → product.template
    const idsXml = variantIds.map(id => `<value><int>${id}</int></value>`).join('');
    const domainXml2 = `<value><array><data><value><string>id</string></value><value><string>in</string></value><value><array><data>${idsXml}</data></array></value></data></array></value>`;
    const body2 = `<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>` +
      `<param><value><string>${ODOO_DB}</string></value></param>` +
      `<param><value><int>${ODOO_UID}</int></value></param>` +
      `<param><value><string>${ODOO_API_KEY}</string></value></param>` +
      `<param><value><string>product.product</string></value></param>` +
      `<param><value><string>search_read</string></value></param>` +
      `<param><value><array><data><value><array><data>${domainXml2}</data></array></value></data></array></value></param>` +
      `<param><value><struct>` +
      `<member><name>fields</name><value><array><data><value><string>product_tmpl_id</string></value></data></array></value></member>` +
      `<member><name>limit</name><value><int>5000</int></value></member>` +
      `</struct></value></param></params></methodCall>`;
    const res2 = await fetch(ODOO_URL + '/xmlrpc/2/object', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body: body2 });
    const text2 = await res2.text();
    if (text2.includes('<fault>')) { console.error('cron step2 fault:', text2.substring(0, 300)); return new Set(); }

    const variants = parseItems(text2);
    const ids = new Set();
    for (const v of variants) {
      const tmplId = Array.isArray(v.product_tmpl_id) ? v.product_tmpl_id[0] : v.product_tmpl_id;
      if (typeof tmplId === 'number') ids.add(tmplId);
    }
    return ids;
  } catch (e) {
    console.error('fetchSoldProductTemplateIds error:', e);
    return new Set();
  }
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
      const body = `<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>` +
        `<param><value><string>${ODOO_DB}</string></value></param>` +
        `<param><value><int>${ODOO_UID}</int></value></param>` +
        `<param><value><string>${ODOO_API_KEY}</string></value></param>` +
        `<param><value><string>product.template</string></value></param>` +
        `<param><value><string>search_read</string></value></param>` +
        `<param><value><array><data><value><array><data>${domainXml}</data></array></value></data></array></value></param>` +
        `<param><value><struct>` +
        `<member><name>fields</name><value><array><data><value><string>id</string></value><value><string>virtual_available</string></value></data></array></value></member>` +
        `<member><name>limit</name><value><int>${CHUNK}</int></value></member>` +
        `</struct></value></param></params></methodCall>`;
      const res = await fetch(ODOO_URL + '/xmlrpc/2/object', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body });
      const text = await res.text();
      if (!text.includes('<fault>')) {
        for (const item of parseItems(text)) {
          if (item.id !== undefined) qtyMap.set(String(item.id), item.virtual_available ?? 0);
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
    const soldTemplateIds = await fetchSoldProductTemplateIds();
    const soldIdStrings = [...soldTemplateIds].map(String);

    // Fetch all Odoo-sourced products with their current status (exclude Jewellery — handled separately with qty check below)
    const { data: allProducts, error } = await supabase
      .from('products')
      .select('id, odoo_product_id, status')
      .in('source', ['odoo', 'odoo_bags'])
      .neq('category', 'Jewellery');

    if (error) throw error;

    let markedSold = 0;
    let markedAvailable = 0;

    for (const product of allProducts || []) {
      const isSold = soldIdStrings.includes(product.odoo_product_id);

      if (isSold && product.status !== 'sold') {
        await supabase.from('products').update({ status: 'sold' }).eq('id', product.id);
        markedSold++;
      } else if (!isSold && product.status === 'sold') {
        // Order cancelled and stock available again — restore to available
        await supabase.from('products').update({ status: 'available' }).eq('id', product.id);
        markedAvailable++;
      }
    }

    // Also update jewellery status (source = 'odoo', category = 'Jewellery')
    const { data: allJewellery } = await supabase
      .from('products')
      .select('id, odoo_product_id, status')
      .eq('source', 'odoo')
      .eq('category', 'Jewellery');

    let jewelleryMarkedSold = 0;
    let jewelleryMarkedAvailable = 0;

    if (allJewellery && allJewellery.length > 0) {
      const jewelleryOdooIds = allJewellery.map(w => parseInt(w.odoo_product_id)).filter(Boolean);
      const qtyMap = await fetchOdooQtyMap(jewelleryOdooIds);

      for (const item of allJewellery) {
        // virtual_available covers both confirmed-SO and already-sold cases for max-1-stock items
        const qty = qtyMap.get(item.odoo_product_id);
        const isSold = qty === undefined || qty <= 0;

        if (isSold && item.status !== 'sold') {
          await supabase.from('products').update({ status: 'sold' }).eq('id', item.id);
          jewelleryMarkedSold++;
        } else if (!isSold && item.status === 'sold') {
          // Only restore to available if qty is explicitly > 0 and not on SO
          await supabase.from('products').update({ status: 'available' }).eq('id', item.id);
          jewelleryMarkedAvailable++;
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
            .filter(i => i.show_in_storefront === true && Number(i.actual_available_stock ?? i.available_stock ?? i.stock_on_hand ?? 0) > 0)
            .map(i => String(i.item_id))
        );
        const { data: zohoProducts } = await supabase.from('products').select('id, zoho_item_id, status').eq('source', 'zoho');
        for (const p of zohoProducts || []) {
          const isLive = liveIds.has(p.zoho_item_id);
          if (!isLive && p.status !== 'sold') {
            await supabase.from('products').update({ status: 'sold' }).eq('id', p.id);
            zohoMarkedSold++;
          } else if (isLive && p.status === 'sold') {
            await supabase.from('products').update({ status: 'available' }).eq('id', p.id);
            zohoMarkedAvailable++;
          }
        }
      }
    } catch (e) {
      console.error('Zoho status check error:', e.message);
    }

    console.log(`Cron status sync: ${markedSold} marked sold, ${markedAvailable} restored available | jewellery: ${jewelleryMarkedSold} sold, ${jewelleryMarkedAvailable} restored | zoho: ${zohoMarkedSold} sold, ${zohoMarkedAvailable} restored`);
    return res.status(200).json({
      success: true,
      sold_on_order: soldTemplateIds.size,
      marked_sold: markedSold,
      marked_available: markedAvailable,
      total_checked: allProducts?.length || 0,
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
