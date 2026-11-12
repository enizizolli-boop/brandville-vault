-- Odoo "Comes with" + "Extras" attributes for jewellery (e.g. "Box, Papers, Covers"), written by the jewellery syncs.
-- Nullable, no default: existing rows stay null and nothing else reads it until the UI shows it.
-- (scope_of_delivery could not be used: watches_scope_of_delivery_check only allows the four watch values.)
ALTER TABLE products ADD COLUMN IF NOT EXISTS jewellery_extras text;
