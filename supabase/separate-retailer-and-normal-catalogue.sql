-- PRAVEEN PHARMA: separate Retailer Website catalogue from Normal Website publication.
-- Additive only: preserves all medicine rows, photos, prices and orders.
-- Run after company-approval-workflow.sql and medicine-formula-auto-info.sql.

begin;

create or replace view public.public_medicine_details
with (security_invoker = true)
as
select m.id, m.name, m.composition, m.pack_size, m.category, m.image_url,
       m.company_id, m.uses, m.benefits, m.side_effects, m.precautions,
       m.info_source_url, m.info_status, m.info_checked_at,
       m.mechanism_of_action, m.image_gallery
from public.medicines m
where m.is_active = true and m.public_approved = true;

create or replace view public.public_medicine_catalogue
with (security_invoker = true)
as
select m.id, m.name, m.composition, m.pack_size, m.category, m.image_url, m.company_id
from public.medicines m
where m.is_active = true and m.public_approved = true;

create or replace view public.retailer_medicine_details
with (security_invoker = true)
as
select m.id, m.name, m.composition, m.pack_size, m.category, m.image_url,
       m.company_id, m.uses, m.benefits, m.mechanism_of_action,
       m.side_effects, m.precautions, m.info_source_url, m.info_status,
       m.info_checked_at, m.is_active
from public.medicines m
where m.is_active = true;

grant select (id, name, composition, pack_size, category, image_url, is_active, company_id,
              uses, benefits, mechanism_of_action, side_effects, precautions,
              info_source_url, info_status, info_checked_at, image_gallery)
  on table public.medicines to anon, authenticated;

revoke all on public.retailer_medicine_details from anon, authenticated;
grant select on public.retailer_medicine_details to anon, authenticated;
revoke all on public.public_medicine_details from anon, authenticated;
grant select on public.public_medicine_details to anon, authenticated;
revoke all on public.public_medicine_catalogue from anon, authenticated;
grant select on public.public_medicine_catalogue to anon, authenticated;

drop policy if exists "retailers_view_approved_company_medicines" on public.medicines;
drop policy if exists "Approved retailers can view active medicine pricing" on public.medicines;
create policy "Approved retailers can view active medicine pricing"
  on public.medicines for select to authenticated
  using (
    is_active = true
    and exists (
      select 1 from public.retailer_profiles rp
      where rp.user_id = auth.uid() and rp.approval_status = 'approved'
    )
  );

notify pgrst, 'reload schema';
commit;

-- Retailer Website: all active medicine details appear immediately, without approval.
-- Pending/anonymous visitors do not receive price, GST, HSN or stock fields.
-- Approved retailers can view active medicine prices; existing order controls remain.
-- Normal Website: only medicines separately published by Admin appear.
