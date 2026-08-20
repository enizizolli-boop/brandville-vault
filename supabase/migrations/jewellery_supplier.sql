-- Jewellery supplier support
-- Adds jewellery-specific columns to supplier_listings and opens RLS for the
-- new jewellery_agent role so they can review jewellery submissions.

ALTER TABLE supplier_listings
  ADD COLUMN IF NOT EXISTS category     TEXT DEFAULT 'Watches',
  ADD COLUMN IF NOT EXISTS jewellery_type TEXT,
  ADD COLUMN IF NOT EXISTS metal        TEXT,
  ADD COLUMN IF NOT EXISTS stone        TEXT,
  ADD COLUMN IF NOT EXISTS size_info    TEXT;

-- Jewellery supplier listings will use supplier_listing_images just like watches.
-- No table changes needed there.

-- Drop old policies and recreate them to include jewellery_agent.
DROP POLICY IF EXISTS "agent_admin_all_listings"       ON supplier_listings;
DROP POLICY IF EXISTS "agent_admin_all_listing_images" ON supplier_listing_images;

CREATE POLICY "agent_admin_all_listings" ON supplier_listings
  FOR ALL USING (
    (SELECT role FROM profiles WHERE id = auth.uid())
    IN ('agent', 'admin', 'jewellery_agent')
  );

CREATE POLICY "agent_admin_all_listing_images" ON supplier_listing_images
  FOR ALL USING (
    (SELECT role FROM profiles WHERE id = auth.uid())
    IN ('agent', 'admin', 'jewellery_agent')
  );

-- Also allow jewellery_supplier to manage their own listings
-- (same pattern as the existing supplier policy which allows supplier_id = auth.uid()).
-- The existing "supplier_own_listings" policy already allows any user whose UUID
-- matches supplier_id — jewellery_supplier users work automatically there.
-- No additional policy needed.
