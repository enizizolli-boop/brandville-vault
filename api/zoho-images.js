const STORE_ID = 'e332ab1967';
const STORE_DOMAIN = 'thewatchstore.zohocommerce.eu';

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fetchImagesFromStorePage(zohoItemId) {
  try {
    const url = `https://${STORE_DOMAIN}/products/${STORE_ID}/${zohoItemId}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) return [];
    const html = await res.text();

    // Extract all CDN image URLs from the page
    const regex = /https:\/\/cdn3\.zohoecommerce\.com\/product-images\/[^"'\s]+/g;
    const allMatches = [...new Set(html.match(regex) || [])];

    // Prefer 600x600 versions, fall back to 300x300
    // Group by filename to deduplicate
    const imageMap = {};
    for (const url of allMatches) {
      // Extract filename as key
      const filenameMatch = url.match(/product-images\/([^/]+)\//);
      if (!filenameMatch) continue;
      const filename = filenameMatch[1];
      const is600 = url.includes('600x600');
      const is300 = url.includes('300x300');

      if (!imageMap[filename]) {
        imageMap[filename] = url;
      } else if (is600) {
        // Prefer 600x600
        imageMap[filename] = url;
      }
    }

    // Convert to array of unique image URLs, upgrade 300x300 to 600x600
    const images = Object.values(imageMap).map(url =>
      url.replace('300x300', '600x600')
    );

    return images;
  } catch (err) {
    console.error(`Error fetching images for ${zohoItemId}:`, err);
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { batch_size = 10, offset = 0 } = req.body || {};

  try {
    // Get Zoho-sourced watches that need images (or all for full refresh)
    const { data: watches, error } = await supabase
      .from('watches')
      .select('id, zoho_item_id')
      .eq('source', 'zoho')
      .not('zoho_item_id', 'is', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + batch_size - 1);

    if (error) throw error;
    if (!watches || watches.length === 0) {
      return res.status(200).json({ success: true, done: true, processed: 0 });
    }

    let processed = 0;
    let imagesAdded = 0;
    const errors = [];

    for (const watch of watches) {
      const images = await fetchImagesFromStorePage(watch.zoho_item_id);

      if (images.length > 0) {
        // Delete existing images for this watch
        await supabase.from('watch_images').delete().eq('watch_id', watch.id);

        // Insert all images
        const imageRows = images.map((url, i) => ({
          watch_id: watch.id,
          url,
          position: i
        }));

        const { error: insertError } = await supabase
          .from('watch_images')
          .insert(imageRows);

        if (insertError) {
          errors.push({ watch_id: watch.id, error: insertError.message });
        } else {
          imagesAdded += images.length;
        }
      }

      processed++;
    }

    const total = await supabase
      .from('watches')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'zoho');

    const totalCount = total.count || 0;
    const nextOffset = offset + batch_size;
    const done = nextOffset >= totalCount;

    return res.status(200).json({
      success: true,
      processed,
      images_added: imagesAdded,
      offset,
      next_offset: done ? null : nextOffset,
      total: totalCount,
      done,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('Image sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
