-- Jewellery on an Odoo sales order tagged "Consignment" that is still on hand
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_consignment boolean DEFAULT false;
