CREATE TABLE supplier_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  brand TEXT,
  model TEXT,
  reference TEXT,
  condition TEXT DEFAULT 'Pre-owned',
  scope_of_delivery TEXT,
  notes TEXT,
  asking_price NUMERIC,
  selling_price NUMERIC,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_review', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  preorder_id UUID REFERENCES preorders(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE supplier_listing_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES supplier_listings(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  position INT NOT NULL DEFAULT 0
);

ALTER TABLE supplier_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_listing_images ENABLE ROW LEVEL SECURITY;

-- Suppliers manage only their own listings
CREATE POLICY "supplier_own_listings" ON supplier_listings
  FOR ALL USING (supplier_id = auth.uid());

-- Agents and admins see and manage all listings
CREATE POLICY "agent_admin_all_listings" ON supplier_listings
  FOR ALL USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('agent', 'admin')
  );

-- Suppliers manage images for their own listings
CREATE POLICY "supplier_own_listing_images" ON supplier_listing_images
  FOR ALL USING (
    listing_id IN (SELECT id FROM supplier_listings WHERE supplier_id = auth.uid())
  );

-- Agents and admins see all images
CREATE POLICY "agent_admin_all_listing_images" ON supplier_listing_images
  FOR ALL USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('agent', 'admin')
  );
