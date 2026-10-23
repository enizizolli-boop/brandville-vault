-- Odoo x_b2b_price (product.template) for bags and jewellery
ALTER TABLE products ADD COLUMN IF NOT EXISTS b2b_price_eur numeric;
