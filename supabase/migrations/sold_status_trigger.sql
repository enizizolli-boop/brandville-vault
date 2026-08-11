-- Trigger: when a supplier marks their listing as sold,
-- automatically update the linked preorder so n8n won't post it.
CREATE OR REPLACE FUNCTION sync_preorder_on_sold()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'sold' AND OLD.status IS DISTINCT FROM 'sold' AND NEW.preorder_id IS NOT NULL THEN
    UPDATE preorders SET status = 'sold' WHERE id = NEW.preorder_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_supplier_listing_sold ON supplier_listings;
CREATE TRIGGER on_supplier_listing_sold
  AFTER UPDATE ON supplier_listings
  FOR EACH ROW EXECUTE FUNCTION sync_preorder_on_sold();
