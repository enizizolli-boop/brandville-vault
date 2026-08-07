-- Remove duplicate product_images rows caused by the 5-min cron re-uploading
-- images it incorrectly thought were missing (1000-row Supabase query limit bug).
-- Keeps the earliest row per (product_id, url), deletes the rest.
-- After this runs, re-number positions to be sequential (0, 1, 2...) per product.

-- Step 1: delete duplicates
DELETE FROM product_images
WHERE id NOT IN (
  SELECT MIN(id)
  FROM product_images
  GROUP BY product_id, url
);

-- Step 2: re-number positions sequentially per product
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY position, id) - 1 AS new_pos
  FROM product_images
)
UPDATE product_images
SET position = ranked.new_pos
FROM ranked
WHERE product_images.id = ranked.id
  AND product_images.position != ranked.new_pos;
