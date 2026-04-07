import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = req.body;
    console.log('Odoo webhook received:', JSON.stringify(body));

    // Odoo sends product_id and event type
    const productId = body.product_id?.[0] || body.product_id;
    const qty = body.virtual_available ?? body.qty_available ?? null;
    const event = body.event; // 'sale', 'draft_order', or 'cancel'
    const orderState = body.order_state; // optional: 'draft', 'sale', 'cancel', etc.

    if (!productId) return res.status(400).json({ error: 'No product_id' });

    let newStatus;

    if (event === 'cancel' || orderState === 'cancel') {
      newStatus = 'available';
    } else if (event === 'sale' || event === 'draft_order' || orderState === 'draft' || orderState === 'sale' || orderState === 'sent' || qty === 0) {
      newStatus = 'sold';
    } else if (qty > 0) {
      newStatus = 'available';
    }

    if (!newStatus) return res.status(200).json({ message: 'No action taken' });

    const { error } = await supabase
      .from('products')
      .update({ status: newStatus })
      .eq('odoo_product_id', String(productId));

    if (error) throw error;

    console.log(`Product ${productId} → ${newStatus}`);
    return res.status(200).json({ success: true, productId, status: newStatus });

  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
}
