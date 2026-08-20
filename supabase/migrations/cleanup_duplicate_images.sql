-- One-time cleanup: remove duplicate product_image rows keeping only the first
-- inserted row per (product_id, position) pair.
-- Run BEFORE adding the unique constraint if the table already has duplicates.
DELETE FROM product_images
WHERE id NOT IN (
  SELECT DISTINCT ON (product_id, position) id
  FROM product_images
  ORDER BY product_id, position, id  -- keep lowest id (earliest insert)
);
