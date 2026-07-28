-- Allow authenticated users to update product_images (needed for image reorder)
CREATE POLICY "images_update" ON product_images
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Allow authenticated users to delete their own preorders
CREATE POLICY "preorders_delete" ON preorders
  FOR DELETE USING (auth.uid() IS NOT NULL);
