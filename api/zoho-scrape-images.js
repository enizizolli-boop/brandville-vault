import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const STORE_DOMAIN = 'thewatchstore.zohocommerce.eu';

async function scrapeImagesFromStorePage(itemId) {
  try {
    const res = await fetch(`https://${STORE_DOMAIN}/products/${itemId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const matches = [...html.matchAll(/https:\/\/[^"'\s<>]*(?:zoho|zohostatic|zohocdn)[^"'\s<>]*\.(jpg|jpeg|png|webp)/gi)];
    const ogMatches = [...html.matchAll(/content="(https:\/\/[^"]+\.(jpg|jpeg|png|webp)[^"]*)"/gi)];
    const allUrls = [
      ...matches.map(m => m[0].split('?')[0]),
      ...ogMatches.map(m => m[1].split('?')[0]),
    ];
    const unique = [...new Set(allUrls)];
    return unique.filter(u => !u.includes('thumb') && !u.includes('icon') && !u.includes('logo') && !u.includes('favicon')).slice(0, 10);
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { batch_size = 20, offset = 0 } = req.body || {};

  try {
    const { data: products, error } = await supabase
      .from('products')
      .select('id, zoho_item_id, product_images(id)')
      .eq('source', 'zoho')
      .not('zoho_item_id', 'is', null)
      .neq('status', 'sold')
      .order('created_at', { ascending: true })
      .range(offset, offset + batch_size - 1);

    if (error) throw error;
    if (!products || products.length === 0) {
      return res.status(200).json({ success: true, done: true, processed: 0, images_added: 0 });
    }

    const withoutImages = products.filter(p => !p.product_images || p.product_images.length === 0);

    let imagesAdded = 0;
    let skipped = 0;

    for (const product of withoutImages) {
      const urls = await scrapeImagesFromStorePage(product.zoho_item_id);
      if (urls.length === 0) { skipped++; continue; }
      const rows = urls.map((url, i) => ({ product_id: product.id, url, position: i }));
      await supabase.from('product_images').insert(rows);
      imagesAdded += urls.length;
    }

    const { count: totalCount } = await supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'zoho')
      .neq('status', 'sold');

    const nextOffset = offset + batch_size;
    const done = nextOffset >= (totalCount || 0);

    return res.status(200).json({
      success: true,
      processed: products.length,
      without_images: withoutImages.length,
      images_added: imagesAdded,
      skipped,
      offset,
      next_offset: done ? null : nextOffset,
      total: totalCount,
      done,
    });
  } catch (err) {
    console.error('Scrape images error:', err);
    return res.status(500).json({ error: err.message });
  }
}
