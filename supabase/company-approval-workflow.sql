-- PRAVEEN PHARMA: company-wise public catalogue approval workflow
-- Safe additive migration. Does not delete or rewrite existing medicine records.
-- Run in Supabase SQL Editor before enabling the new website UI.

create table if not exists public.medicine_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid,
  constraint medicine_companies_name_unique unique (name)
);

alter table public.medicines
  add column if not exists company_id uuid
    references public.medicine_companies(id) on delete set null,
  add column if not exists public_approved boolean not null default false;

create index if not exists medicines_company_public_idx
  on public.medicines (company_id, public_approved, is_active);
create index if not exists medicine_companies_approved_name_idx
  on public.medicine_companies (is_approved, name);

alter table public.medicine_companies enable row level security;

drop policy if exists "Public can read approved medicine companies" on public.medicine_companies;
create policy "Public can read approved medicine companies"
  on public.medicine_companies for select
  to anon, authenticated
  using (
    is_approved = true
    or auth.uid() = '9be3d5ee-e09a-4738-9b27-f2fae15e93c7'::uuid
  );

drop policy if exists "Configured admin can manage medicine companies" on public.medicine_companies;
create policy "Configured admin can manage medicine companies"
  on public.medicine_companies for all
  to authenticated
  using (auth.uid() = '9be3d5ee-e09a-4738-9b27-f2fae15e93c7'::uuid)
  with check (auth.uid() = '9be3d5ee-e09a-4738-9b27-f2fae15e93c7'::uuid);

-- NOTE:
-- Existing medicines table policies must be audited before deployment of public
-- catalogue queries. PostgreSQL permissive RLS policies are OR-combined; an older
-- broad SELECT policy could otherwise expose unapproved medicine rows.
-- The website rollout must query only medicines where:
--   is_active = true AND public_approved = true
--   AND the linked medicine_companies.is_approved = true.
-- Existing medicines are deliberately left unapproved until the Admin confirms them.
