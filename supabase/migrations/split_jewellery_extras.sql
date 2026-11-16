-- Split jewellery delivery info into two columns (2026-11-16). Run in the Supabase SQL Editor BEFORE deploying the code.
--   jewellery_comes_with      Odoo "Comes with" attribute, public: "Box, Papers, Screwdriver", "No Box or Papers" ...
--   jewellery_extras          Odoo "Extras" attribute + the Covers / Purchase Invoice tick boxes: "Covers, Purchase Invoice"
--                             (until now this column held both, e.g. "Box, Papers, Covers")
--   jewellery_extras_visible  copy of the "Extras" attribute's visibility setting in Odoo (Hidden = false).
--                             When false, Extras are shown only to admins and agents, not to dealers or preview links.
ALTER TABLE products ADD COLUMN IF NOT EXISTS jewellery_comes_with text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS jewellery_extras_visible boolean NOT NULL DEFAULT false;

-- Keep today's text on the pages until the next jewellery full sync (about 30 min after the deploy) writes the columns
-- properly: COPY the combined value to "Comes with" for now. jewellery_extras is left as it is, because the code that is
-- live until the deploy still reads and writes it (147 jewellery rows on 2026-11-16).
UPDATE products
SET jewellery_comes_with = jewellery_extras
WHERE jewellery_extras IS NOT NULL AND jewellery_comes_with IS NULL;
