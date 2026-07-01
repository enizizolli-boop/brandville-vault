-- Add repost_request table
create table public.repost_requests (
  id uuid primary key default gen_random_uuid(),

  product_id uuid references public.products(id) on delete set null,
  preorder_id uuid references public.preorders(id) on delete set null,

  requested_by uuid references public.profiles(id),
  requested_at timestamptz not null default now(),

  status text not null default 'pending'
    check (status in ('pending', 'completed', 'failed')),

  completed_at timestamptz,
  error_message text,

  constraint repost_requests_one_item_check
  check (
    (product_id is not null and preorder_id is null)
    or
    (product_id is null and preorder_id is not null)
  )
);

-- Add index to repost_requests table
create index repost_requests_product_id_idx
on public.repost_requests(product_id, requested_at desc);

create index repost_requests_preorder_id_idx
on public.repost_requests(preorder_id, requested_at desc);

create index repost_requests_status_idx
on public.repost_requests(status);

-- Prevent double-click duplicates while one request is still pending

create unique index repost_requests_one_pending_product_idx
on public.repost_requests(product_id)
where product_id is not null and status = 'pending';

create unique index repost_requests_one_pending_preorder_idx
on public.repost_requests(preorder_id)
where preorder_id is not null and status = 'pending';


-- Enable row level security
alter table public.repost_requests enable row level security;

drop policy if exists "Users can create repost requests" on public.repost_requests;
drop policy if exists "Users can read their own repost requests" on public.repost_requests;

create policy "Users can create repost requests"
on public.repost_requests
for insert
to authenticated
with check (requested_by = auth.uid());

create policy "Users can read their own repost requests"
on public.repost_requests
for select
to authenticated
using (requested_by = auth.uid());
