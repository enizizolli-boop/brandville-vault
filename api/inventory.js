import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VALID_CATEGORIES = ['Watches', 'Jewellery', 'Bags', 'Accessories', 'Shoes'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'x-api-key, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // API key check — accept via header or query param
  const apiKey = req.headers['x-api-key'] || req.query.key;
  if (!process.env.INVENTORY_API_KEY || apiKey !== process.env.INVENTORY_API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }

  const { category, status = 'available', page = '0', limit = '100' } = req.query;
  const pageNum = Math.max(0, parseInt(page) || 0);
  const pageSize = Math.min(500, Math.max(1, parseInt(limit) || 100));
  const from = pageNum * pageSize;
  const to = from + pageSize - 1;

  // Products query
  let q = supabase
    .from('products')
    .select('id, brand, model, reference, price_eur, price_usd, category, subcategory, condition, scope_of_delivery, notes, status, source, created_at, updated_at, product_images(url, position)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (status === 'all') {
    // return everything
  } else {
    q = q.eq('status', status);
  }

  if (category && VALID_CATEGORIES.includes(category)) {
    q = q.eq('category', category);
  }

  const { data: products, error, count } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const now = new Date().toISOString();

  // Preorders query (available, not expired)
  let pq = supabase
    .from('preorders')
    .select('id, brand, model, reference, price_eur, price_usd, category, subcategory, condition, scope_of_delivery, notes, status, created_at, updated_at, expires_at, preorder_images(url, position)', { count: 'exact' })
    .eq('status', 'available')
    .or(`expires_at.is.null,expires_at.gte.${now}`)
    .order('created_at', { ascending: false });

  if (category && VALID_CATEGORIES.includes(category)) {
    pq = pq.eq('category', category);
  }

  const { data: preorders, error: pErr, count: preorderCount } = await pq;
  if (pErr) return res.status(500).json({ error: pErr.message });

  const formatImages = (imgs) =>
    (imgs || [])
      .sort((a, b) => a.position - b.position)
      .map(i => i.url);

  const formatProduct = (p) => ({
    id: p.id,
    type: 'product',
    brand: p.brand,
    model: p.model,
    reference: p.reference || null,
    price_eur: p.price_eur ? Number(p.price_eur) : null,
    price_usd: p.price_usd ? Number(p.price_usd) : null,
    category: p.category,
    subcategory: p.subcategory || null,
    condition: p.condition || null,
    scope_of_delivery: p.scope_of_delivery || null,
    notes: p.notes || null,
    status: p.status,
    images: formatImages(p.product_images),
    created_at: p.created_at,
    updated_at: p.updated_at,
  });

  const formatPreorder = (p) => ({
    id: p.id,
    type: 'preorder',
    brand: p.brand,
    model: p.model,
    reference: p.reference || null,
    price_eur: p.price_eur ? Number(p.price_eur) : null,
    price_usd: p.price_usd ? Number(p.price_usd) : null,
    category: p.category,
    subcategory: p.subcategory || null,
    condition: p.condition || null,
    scope_of_delivery: p.scope_of_delivery || null,
    notes: p.notes || null,
    status: p.status,
    expires_at: p.expires_at || null,
    images: formatImages(p.preorder_images),
    created_at: p.created_at,
    updated_at: p.updated_at,
  });

  return res.status(200).json({
    products: (products || []).map(formatProduct),
    preorders: (preorders || []).map(formatPreorder),
    pagination: {
      page: pageNum,
      limit: pageSize,
      total_products: count || 0,
      total_preorders: preorderCount || 0,
      has_more: from + pageSize < (count || 0),
    },
  });
}
