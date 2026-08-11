ALTER TABLE supplier_listings
ADD COLUMN IF NOT EXISTS asking_price_currency TEXT DEFAULT 'CNY';
