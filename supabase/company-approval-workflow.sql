-- PRAVEEN PHARMA: secure company-wise catalogue approval workflow
-- Additive: preserves existing medicine rows. Existing medicines stay unpublished.
-- Requires PostgreSQL 15+ for security_invoker views. Review, then run in Supabase SQL Editor.

begin;

do $$
begin
  if current_setting('server_version_num')::integer < 150000 then
    raise exception 'This migration requires PostgreSQL 15+ (security_invoker views). No changes were committed.';
  end if;
end $$;

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
alter table public.medicines enable row level security;

-- Only the configured Admin may create, edit, approve or remove companies.
drop policy if exists "Public can read approved medicine companies" on public.medicine_companies;
drop policy if exists "Configured admin can manage medicine companies" on public.medicine_companies;
drop policy if exists "Read approved companies or admin list" on public.medicine_companies;
drop policy if exists "Configured admin manages companies" on public.medicine_companies;
create policy "Read approved companies or admin list"
  on public.medicine_companies for select to anon, authenticated
  using (is_approved = true or auth.uid() = '9be3d5ee-e09a-4738-9b27-f2fae15e93c7'::uuid);
create policy "Configured admin manages companies"
  on public.medicine_companies for all to authenticated
  using (auth.uid() = '9be3d5ee-e09a-4738-9b27-f2fae15e93c7'::uuid)
  with check (auth.uid() = '9be3d5ee-e09a-4738-9b27-f2fae15e93c7'::uuid);

-- Remove the previous retailer rule that exposed every active medicine.
drop policy if exists "retailers_view_medicines" on public.medicines;
drop policy if exists "retailers_view_approved_company_medicines" on public.medicines;
drop policy if exists "Public can read approved medicines" on public.medicines;
drop policy if exists "Public catalogue reads approved medicines" on public.medicines;

-- Publicly approved rows may be read by visitors and signed-in users.
create policy "Public catalogue reads approved medicines"
  on public.medicines for select to anon
  using (
    is_active = true
    and public_approved = true
  );

-- Approved retailers can read only the same published catalogue (including price columns).
create policy "retailers_view_approved_company_medicines"
  on public.medicines for select to authenticated
  using (
    is_active = true
    and public_approved = true
    and exists (
      select 1 from public.medicine_companies mc
      where mc.id = medicines.company_id and mc.is_approved = true
    )
    and exists (
      select 1 from public.retailer_profiles rp
      where rp.user_id = auth.uid() and rp.approval_status = 'approved'
    )
  );

-- Remove unsafe broad anonymous table privileges; allow only catalogue-safe columns.
revoke all on table public.medicines from anon;
grant select (id, name, composition, pack_size, category, image_url, is_active, company_id, public_approved)
  on table public.medicines to anon;
revoke truncate, references, trigger on table public.medicines from authenticated;

-- Company lookup columns needed by RLS and the company picker.
revoke all on table public.medicine_companies from anon, authenticated;
grant select (id, name, is_approved) on table public.medicine_companies to anon, authenticated;
grant insert, update, delete on table public.medicine_companies to authenticated;
revoke truncate, references, trigger on table public.medicine_companies from anon, authenticated;

-- Invoker views ensure underlying RLS is enforced for the actual visitor/retailer.
create or replace view public.public_medicine_catalogue
with (security_invoker = true)
as
select m.id, m.name, m.composition, m.pack_size, m.category, m.image_url, m.company_id
from public.medicines m
where m.is_active = true
  and m.public_approved = true;

create or replace view public.public_medicines
with (security_invoker = true)
as
select m.id, m.name, m.composition, m.pack_size, m.category, m.image_url,
       m.common_price, m.gst_rate, m.company_id
from public.medicines m
where m.is_active = true
  and m.public_approved = true;

revoke all on public.public_medicine_catalogue from anon, authenticated;
revoke all on public.public_medicines from anon, authenticated;
grant select on public.public_medicine_catalogue to anon, authenticated;
grant select on public.public_medicines to authenticated;

commit;

-- Expected behaviour after commit:
-- * Existing medicines have public_approved=false and remain hidden until Admin approval.
-- * A medicine appears on the Customer Brochure when the medicine itself is Published and active; company approval does not block it.
-- * Admin's existing admin_all_medicines policy remains in place.
-- * Retailer table access is limited to published rows; anon cannot read price/GST columns.
