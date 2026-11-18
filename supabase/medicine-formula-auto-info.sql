-- PRAVEEN PHARMA: verified formula information for public catalogue.
-- Additive migration: preserves all existing medicine rows and photos.
begin;
alter table public.medicines
  add column if not exists uses text,
  add column if not exists benefits text,
  add column if not exists mechanism_of_action text,
  add column if not exists side_effects text,
  add column if not exists precautions text,
  add column if not exists info_source_url text,
  add column if not exists info_status text not null default 'not_checked',
  add column if not exists info_checked_at timestamptz;

-- The view exposes only medicines already approved for public catalogue.
create or replace view public.public_medicine_details
with (security_invoker = true)
as
select m.id, m.name, m.composition, m.pack_size, m.category, m.image_url,
       m.company_id, m.uses, m.benefits, m.side_effects, m.precautions,
       m.info_source_url, m.info_status, m.info_checked_at,
       m.mechanism_of_action
from public.medicines m
where m.is_active = true
  and m.public_approved = true
  and exists (
    select 1 from public.medicine_companies mc
    where mc.id = m.company_id and mc.is_approved = true
  );

-- Column-level read access required by the invoker view; RLS still limits rows.
grant select (uses, benefits, mechanism_of_action, side_effects, precautions,
              info_source_url, info_status, info_checked_at)
  on table public.medicines to anon, authenticated;
revoke all on public.public_medicine_details from anon, authenticated;
grant select on public.public_medicine_details to anon, authenticated;
notify pgrst, 'reload schema';
commit;
