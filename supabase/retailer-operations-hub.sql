-- PRAVEEN PHARMA: additive retailer operations + central order hub
-- Safe to re-run. Creates new tables only; does not alter or delete existing stock,
-- retailer profiles, orders, order items, medicine photos, or account data.
-- Run manually in Supabase SQL Editor after reviewing. External platform writes
-- must be made by a trusted Edge Function using the service-role key (never browser JS).

begin;

create table if not exists public.retailer_shortage_book (
  id uuid primary key default gen_random_uuid(),
  retailer_user_id uuid not null references auth.users(id) on delete cascade,
  medicine_name text not null,
  composition text not null default '',
  requested_quantity numeric(12,2) not null default 1 check (requested_quantity > 0),
  unit text not null default 'pack',
  notes text not null default '',
  photo_url text,
  status text not null default 'open'
    check (status in ('open','reviewed','converted_to_order','closed')),
  linked_order_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists retailer_shortage_book_owner_created_idx
  on public.retailer_shortage_book (retailer_user_id, created_at desc);
create index if not exists retailer_shortage_book_status_idx
  on public.retailer_shortage_book (status, created_at desc);

create table if not exists public.retailer_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  retailer_user_id uuid not null references auth.users(id) on delete restrict,
  entry_type text not null check (entry_type in ('opening_balance','invoice','payment','credit_note','adjustment')),
  amount numeric(14,2) not null check (amount > 0),
  direction text not null check (direction in ('debit','credit')),
  reference_number text not null default '',
  payment_method text not null default '',
  notes text not null default '',
  entry_date date not null default current_date,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists retailer_ledger_owner_date_idx
  on public.retailer_ledger_entries (retailer_user_id, entry_date desc, created_at desc);

create table if not exists public.retailer_invoices (
  id uuid primary key default gen_random_uuid(),
  order_id text not null unique,
  retailer_user_id uuid not null references auth.users(id) on delete restrict,
  invoice_number text not null unique,
  invoice_date timestamptz not null default now(),
  invoice_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists retailer_invoices_owner_date_idx
  on public.retailer_invoices (retailer_user_id, invoice_date desc);

create table if not exists public.external_order_intake (
  id uuid primary key default gen_random_uuid(),
  source_platform text not null,
  external_order_id text not null,
  retailer_name text not null default '',
  retailer_phone text not null default '',
  retailer_gstin text not null default '',
  order_payload jsonb not null default '{}'::jsonb,
  intake_status text not null default 'received'
    check (intake_status in ('received','reviewing','accepted','rejected','imported')),
  internal_order_id text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid,
  admin_notes text not null default '',
  constraint external_order_source_ref_unique unique (source_platform, external_order_id)
);
create index if not exists external_order_intake_status_date_idx
  on public.external_order_intake (intake_status, received_at desc);

alter table public.retailer_shortage_book enable row level security;
alter table public.retailer_ledger_entries enable row level security;
alter table public.retailer_invoices enable row level security;
alter table public.external_order_intake enable row level security;

-- Shortage book: approved retailers see and manage only their own requests.
drop policy if exists "Retailer manages own shortage book" on public.retailer_shortage_book;
drop policy if exists "Configured admin manages shortage book" on public.retailer_shortage_book;
create policy "Retailer manages own shortage book"
  on public.retailer_shortage_book for all to authenticated
  using (
    auth.uid() = retailer_user_id
    and exists (select 1 from public.retailer_profiles rp
      where rp.user_id = auth.uid() and rp.approval_status = 'approved')
  )
  with check (
    auth.uid() = retailer_user_id
    and exists (select 1 from public.retailer_profiles rp
      where rp.user_id = auth.uid() and rp.approval_status = 'approved')
  );
create policy "Configured admin manages shortage book"
  on public.retailer_shortage_book for all to authenticated
  using (auth.uid() = '9be3d5ee-e09a-4738-9b27-f2fae15e93c7'::uuid)
  with check (auth.uid() = '9be3d5ee-e09a-4738-9b27-f2fae15e93c7'::uuid);

-- Ledger: retailer can read only their own entries. Only configured Admin writes.
drop policy if exists "Retailer reads own ledger" on public.retailer_ledger_entries;
drop policy if exists "Configured admin manages retailer ledger" on public.retailer_ledger_entries;
create policy "Retailer reads own ledger"
  on public.retailer_ledger_entries for select to authenticated
  using (auth.uid() = retailer_user_id);
create policy "Configured admin manages retailer ledger"
  on public.retailer_ledger_entries for all to authenticated
  using (auth.uid() = '9be3d5ee-e09a-4738-9b27-f2fae15e93c7'::uuid)
  with check (
    auth.uid() = '9be3d5ee-e09a-4738-9b27-f2fae15e93c7'::uuid
    and created_by = auth.uid()
  );

-- Invoice: retailer can read their own invoice; only Admin can issue/manage records.
drop policy if exists "Retailer reads own invoices" on public.retailer_invoices;
drop policy if exists "Configured admin manages invoices" on public.retailer_invoices;
create policy "Retailer reads own invoices"
  on public.retailer_invoices for select to authenticated
  using (auth.uid() = retailer_user_id);
create policy "Configured admin manages invoices"
  on public.retailer_invoices for all to authenticated
  using (auth.uid() = '9be3d5ee-e09a-4738-9b27-f2fae15e93c7'::uuid)
  with check (
    auth.uid() = '9be3d5ee-e09a-4738-9b27-f2fae15e93c7'::uuid
    and created_by = auth.uid()
  );

-- External partner orders are service-role/Edge-Function intake only.
-- Browser clients cannot insert orders or read partner payloads.
drop policy if exists "Configured admin reads external order intake" on public.external_order_intake;
drop policy if exists "Configured admin updates external order intake" on public.external_order_intake;
create policy "Configured admin reads external order intake"
  on public.external_order_intake for select to authenticated
  using (auth.uid() = '9be3d5ee-e09a-4738-9b27-f2fae15e93c7'::uuid);
create policy "Configured admin updates external order intake"
  on public.external_order_intake for update to authenticated
  using (auth.uid() = '9be3d5ee-e09a-4738-9b27-f2fae15e93c7'::uuid)
  with check (auth.uid() = '9be3d5ee-e09a-4738-9b27-f2fae15e93c7'::uuid);

grant select, insert, update, delete on public.retailer_shortage_book to authenticated;
grant select on public.retailer_ledger_entries to authenticated;
grant insert, update, delete on public.retailer_ledger_entries to authenticated;
grant select on public.retailer_invoices to authenticated;
grant insert, update, delete on public.retailer_invoices to authenticated;
grant select, update on public.external_order_intake to authenticated;

commit;

-- Post-migration checks:
-- 1) shortage book retailer policies require an approved retailer profile.
-- 2) ledger/invoice write policies are Admin-only; retailers can read their own rows.
-- 3) external_order_intake has no authenticated INSERT policy. Use an Edge Function
--    with service-role credentials only after partner API onboarding and verification.
-- 4) invoice_snapshot should store a frozen copy of seller, buyer, GST, line items,
--    tax amounts and totals so later catalogue edits do not change an issued invoice.
