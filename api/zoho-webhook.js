import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function extractStage(item) {
  // Try the flat hash first, then scan the custom_fields array
  if (item.custom_field_hash?.cf_stage) return item.custom_field_hash.cf_stage;
  if (Array.isArray(item.custom_fields)) {
    const f = item.custom_fields.find(f => f.api_name === 'cf_stage');
    if (f?.value) return f.value;
  }
  return null;
}

export default async function handler(req, res) {
  // Accept both GET (Zoho verification ping) and POST (actual webhook event)
  if (req.method === 'GET') return res.status(200).send('OK');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // SO-triggered payload from Zoho Deluge: { committed_sku, action: "sold" }
    // Process BEFORE responding — Vercel kills the execution context after res.end()
    const { committed_sku, action } = req.body || {};
    if (committed_sku && action === 'sold') {
      const { data: products } = await supabase
        .from('products')
        .select('id, status')
        .eq('reference', committed_sku)
        .eq('source', 'zoho');

      for (const product of products || []) {
        if (product.status !== 'sold' && product.status !== 'reserved') {
          await supabase.from('products').update({ status: 'sold' }).eq('id', product.id);
          console.log(`Webhook: SO committed — marked ${committed_sku} as sold`);
        }
      }
      return res.status(200).json({ ok: true });
    }

    res.status(200).json({ ok: true });

    const item = req.body?.item;
    if (!item) return;

    const sku = item.sku;
    if (!sku) return; // can't identify which product without SKU

    const availForSale = item.available_for_sale_stock;
    const committedStock = item.committed_stock;
    const stage = extractStage(item);
    const purchaseRate = item.purchase_rate;

    // Fail open: if we can't read the critical fields, do nothing rather
    // than wrongly marking something sold on a live dealer site.
    if (availForSale === undefined || availForSale === null) {
      console.log(`Webhook: skipping ${sku} — available_for_sale_stock missing from payload`);
      return;
    }
    if (!stage) {
      console.log(`Webhook: skipping ${sku} — cf_stage missing from payload`);
      return;
    }

    // committed_stock updates immediately when a SO is confirmed; available_for_sale_stock
    // is a derived field that Zoho recalculates asynchronously and can lag behind.
    // If committed_stock > 0 the item is definitively committed regardless of whether
    // available_for_sale_stock has caught up yet — this catches brand-new SO events.
    const isCommitted = Number(committedStock ?? 0) > 0;
    const shouldBeLive = stage === 'Per oferte' && Number(availForSale) >= 1 && !isCommitted;

    // Find the product in our DB by SKU/reference (Zoho source only)
    const { data: products, error: fetchErr } = await supabase
      .from('products')
      .select('id, status, cost_eur')
      .eq('reference', sku)
      .eq('source', 'zoho');

    if (fetchErr || !products?.length) {
      console.log(`Webhook: no Zoho product found for SKU ${sku}`);
      return;
    }

    for (const product of products) {
      const updates = {};

      // Only update status if it actually needs to change
      const newStatus = shouldBeLive ? 'available' : 'sold';
      if (product.status !== newStatus && product.status !== 'reserved') {
        updates.status = newStatus;
      }

      // Bonus: persist cost_eur from purchase_rate if present and not already set
      // (solves the cost_eur gap for Zoho watches without touching sync scripts)
      if (purchaseRate && Number(purchaseRate) > 0 && !product.cost_eur) {
        updates.cost_eur = Number(purchaseRate);
      }

      if (Object.keys(updates).length === 0) continue;

      const { error: updateErr } = await supabase
        .from('products')
        .update(updates)
        .eq('id', product.id);

      if (updateErr) {
        console.error(`Webhook: update failed for ${sku} (${product.id}):`, updateErr.message);
      } else {
        console.log(`Webhook: updated ${sku} →`, updates);
      }
    }
  } catch (e) {
    console.error('Webhook processing error:', e.message);
  }
}
