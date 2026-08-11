ALTER TABLE supplier_listings
DROP CONSTRAINT supplier_listings_status_check;

ALTER TABLE supplier_listings
ADD CONSTRAINT supplier_listings_status_check
CHECK (status IN ('draft', 'pending_review', 'approved', 'rejected', 'sold'));
