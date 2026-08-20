-- Prevent duplicate image rows for the same product at the same position.
-- This makes upsert on (product_id, position) work, and closes the race condition
-- where two concurrent syncs both read "no images" and both upload a full set.
ALTER TABLE product_images
  ADD CONSTRAINT product_images_product_position_unique UNIQUE (product_id, position);
