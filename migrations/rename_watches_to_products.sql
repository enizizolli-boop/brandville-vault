-- Migration: rename watches → products, watch_images → product_images
-- Run this in Supabase SQL editor

-- 1. Rename tables
ALTER TABLE watches RENAME TO products;
ALTER TABLE watch_images RENAME TO product_images;

-- 2. Rename columns
ALTER TABLE products RENAME COLUMN jewellery_type TO subcategory;
ALTER TABLE product_images RENAME COLUMN watch_id TO product_id;

-- 3. Rename check constraint (if it exists with this name — adjust if yours differs)
-- Check current constraint name first:
--   SELECT conname FROM pg_constraint WHERE conrelid = 'products'::regclass;
-- Then rename:
-- ALTER TABLE products RENAME CONSTRAINT watches_jewellery_type_check TO products_subcategory_check;

-- 4. NOTE: The Supabase Storage bucket "watch-images" must be manually renamed
--    in the Supabase dashboard (Storage → rename bucket).
--    Until renamed, storage uploads/reads still use "watch-images" bucket name.
--    Code references to the bucket name are NOT changed in this migration.

-- 5. Verify
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('products', 'product_images');
