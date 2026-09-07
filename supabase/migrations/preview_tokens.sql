-- preview_tokens: time-limited shareable links for bank verification
-- Each token represents a unique, non-login link showing available inventory.
-- Only admins can create, list, revoke, or extend tokens.

create table if not exists preview_tokens (
  id         uuid        primary key default gen_random_uuid(),
  token      text        unique not null default encode(gen_random_bytes(24), 'base64url'),
  label      text,
  expires_at timestamptz not null default now() + interval '30 days',
  revoked    boolean     not null default false,
  created_by uuid        references auth.users(id),
  created_at timestamptz not null default now()
);

alter table preview_tokens enable row level security;

-- Only admins can manage preview tokens (create, read, update, delete)
create policy "admin_manage_preview_tokens" on preview_tokens
  for all
  using (
    (select role from profiles where id = auth.uid()) = 'admin'
  );
