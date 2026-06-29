-- Preorder expiry/archive migration
-- Run this in the Supabase SQL Editor against production.

-- 1. Expiry timestamp, defaults to 7 days from creation
alter table preorders
  add column if not exists expires_at timestamptz
  default (now() + interval '7 days');

-- 2. Backfill existing rows
update preorders
set expires_at = coalesce(created_at, now()) + interval '7 days'
where expires_at is null;

-- 3. Index for fast active/archive filtering
create index if not exists idx_preorders_expires_at
  on preorders (expires_at);

-- 4. Fix RLS: the existing "Authenticated users can view preorders" policy
-- uses `using (true)` with no condition, granting every logged-in user
-- (including dealers) unrestricted SELECT access. Since Postgres OR's
-- multiple policies for the same command together, simply adding the new
-- restrictive policies below would do nothing while this one still exists.
-- It must be dropped, not just supplemented.
drop policy if exists "Authenticated users can view preorders" on preorders;

-- Anonymous visitors: active, available preorders only.
-- (Currently unused in practice — every app route requires login — but
-- kept for defense-in-depth in case the anon key is ever queried directly.)
create policy "public sees active preorders"
on preorders for select to anon
using (
  expires_at > now()
  and status = 'available'
);

-- Dealers: active/available only — same visibility as the public view.
create policy "dealers see active preorders"
on preorders for select to authenticated
using (
  expires_at > now()
  and status = 'available'
  and exists (
    select 1 from profiles
    where profiles.id = auth.uid()
    and profiles.role = 'dealer'
  )
);

-- Admin + agents: everything, including archived/expired and sold.
create policy "admin and agents see all preorders"
on preorders for select to authenticated
using (
  exists (
    select 1 from profiles
    where profiles.id = auth.uid()
    and profiles.role in ('admin', 'agent')
  )
);
