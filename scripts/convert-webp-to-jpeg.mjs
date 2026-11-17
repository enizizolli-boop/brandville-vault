/**
 * One-time script: convert all .webp images in product_images to .jpeg
 *
 * Requirements: add SUPABASE_SERVICE_ROLE_KEY to .env before running
 * Run: node --env-file=.env scripts/convert-webp-to-jpeg.mjs
 */

import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BUCKET = 'watch-images';
const BATCH_SIZE = 50;
const STORAGE_PREFIX = `${process.env.REACT_APP_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;

function extractStoragePath(url) {
  return url.replace(STORAGE_PREFIX, '');
}

async function run() {
  let converted = 0, skipped = 0, errors = 0;
  let page = 0;

  while (true) {
    const { data: images, error } = await supabase
      .from('product_images')
      .select('id, url, product_id, position')
      .ilike('url', '%.webp')
      .range(page * BATCH_SIZE, (page + 1) * BATCH_SIZE - 1);

    if (error) { console.error('DB fetch error:', error.message); break; }
    if (!images || images.length === 0) break;

    console.log(`\nBatch ${page + 1}: processing ${images.length} images...`);

    for (const img of images) {
      try {
        // Download original webp
        const res = await fetch(img.url);
        if (!res.ok) { console.error(`  SKIP ${img.id}: download failed (${res.status})`); skipped++; continue; }
        const webpBuffer = Buffer.from(await res.arrayBuffer());

        // Convert to jpeg
        const jpegBuffer = await sharp(webpBuffer).jpeg({ quality: 90 }).toBuffer();

        // Build new storage path (.webp → .jpg)
        const oldPath = extractStoragePath(img.url);
        const newPath = oldPath.replace(/\.webp$/i, '.jpg');

        // Upload jpeg
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(newPath, jpegBuffer, {
          contentType: 'image/jpeg',
          upsert: true,
        });
        if (upErr) { console.error(`  ERROR ${img.id}: upload failed — ${upErr.message}`); errors++; continue; }

        // Get new public URL
        const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(newPath);

        // Update DB record
        const { error: dbErr } = await supabase.from('product_images').update({ url: publicUrl }).eq('id', img.id);
        if (dbErr) { console.error(`  ERROR ${img.id}: DB update failed — ${dbErr.message}`); errors++; continue; }

        // Delete old webp file
        await supabase.storage.from(BUCKET).remove([oldPath]);

        console.log(`  ✓ ${oldPath} → ${newPath}`);
        converted++;
      } catch (e) {
        console.error(`  ERROR ${img.id}:`, e.message);
        errors++;
      }
    }

    if (images.length < BATCH_SIZE) break;
    page++;

    // Brief pause between batches to avoid rate limits
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\nDone. Converted: ${converted}, Skipped: ${skipped}, Errors: ${errors}`);
}

run().catch(console.error);
