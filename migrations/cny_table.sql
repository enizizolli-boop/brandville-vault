-- Add CNY price and currency columns to preorders table
alter table public.preorders
add column if not exists price_cny numeric,
add column if not exists price_currency text;

