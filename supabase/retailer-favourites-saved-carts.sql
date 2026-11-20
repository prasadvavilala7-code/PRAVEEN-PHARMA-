-- PRAVEEN PHARMA: retailer favourites and saved draft carts.
-- Additive only. Does not alter medicines, photos, retailers, prices, orders or invoices.
-- The same migration was applied to the PRAVEEN PHARMA Supabase project.
begin;

create table if not exists public.retailer_favorites (
  retailer_user_id uuid not null references auth.users(id) on delete cascade,
  medicine_id uuid not null references public.medicines(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (retailer_user_id, medicine_id)
);
create index if not exists retailer_favorites_medicine_idx
  on public.retailer_favorites (medicine_id);
alter table public.retailer_favorites enable row level security;
revoke all on table public.retailer_favorites from anon, authenticated;
grant select, insert, delete on table public.retailer_favorites to authenticated;

drop policy if exists "Approved retailers read own favourites" on public.retailer_favorites;
drop policy if exists "Approved retailers add own favourites" on public.retailer_favorites;
drop policy if exists "Approved retailers remove own favourites" on public.retailer_favorites;

create policy "Approved retailers read own favourites"
  on public.retailer_favorites for select to authenticated
  using ((select auth.uid()) = retailer_user_id and exists (
    select 1 from public.retailer_profiles rp
    where rp.user_id = (select auth.uid()) and rp.approval_status = 'approved'
  ));
create policy "Approved retailers add own favourites"
  on public.retailer_favorites for insert to authenticated
  with check ((select auth.uid()) = retailer_user_id and exists (
    select 1 from public.retailer_profiles rp
    where rp.user_id = (select auth.uid()) and rp.approval_status = 'approved'
  ));
create policy "Approved retailers remove own favourites"
  on public.retailer_favorites for delete to authenticated
  using ((select auth.uid()) = retailer_user_id and exists (
    select 1 from public.retailer_profiles rp
    where rp.user_id = (select auth.uid()) and rp.approval_status = 'approved'
  ));

create table if not exists public.retailer_saved_carts (
  id uuid primary key default gen_random_uuid(),
  retailer_user_id uuid not null references auth.users(id) on delete cascade,
  cart_name text not null default 'Saved cart',
  cart_items jsonb not null default '[]'::jsonb
    check (jsonb_typeof(cart_items) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists retailer_saved_carts_owner_updated_idx
  on public.retailer_saved_carts (retailer_user_id, updated_at desc);
alter table public.retailer_saved_carts enable row level security;
revoke all on table public.retailer_saved_carts from anon, authenticated;
grant select, insert, update, delete on table public.retailer_saved_carts to authenticated;

drop policy if exists "Approved retailers read own saved carts" on public.retailer_saved_carts;
drop policy if exists "Approved retailers create own saved carts" on public.retailer_saved_carts;
drop policy if exists "Approved retailers update own saved carts" on public.retailer_saved_carts;
drop policy if exists "Approved retailers delete own saved carts" on public.retailer_saved_carts;

create policy "Approved retailers read own saved carts"
  on public.retailer_saved_carts for select to authenticated
  using ((select auth.uid()) = retailer_user_id and exists (
    select 1 from public.retailer_profiles rp
    where rp.user_id = (select auth.uid()) and rp.approval_status = 'approved'
  ));
create policy "Approved retailers create own saved carts"
  on public.retailer_saved_carts for insert to authenticated
  with check ((select auth.uid()) = retailer_user_id and exists (
    select 1 from public.retailer_profiles rp
    where rp.user_id = (select auth.uid()) and rp.approval_status = 'approved'
  ));
create policy "Approved retailers update own saved carts"
  on public.retailer_saved_carts for update to authenticated
  using ((select auth.uid()) = retailer_user_id and exists (
    select 1 from public.retailer_profiles rp
    where rp.user_id = (select auth.uid()) and rp.approval_status = 'approved'
  ))
  with check ((select auth.uid()) = retailer_user_id and exists (
    select 1 from public.retailer_profiles rp
    where rp.user_id = (select auth.uid()) and rp.approval_status = 'approved'
  ));
create policy "Approved retailers delete own saved carts"
  on public.retailer_saved_carts for delete to authenticated
  using ((select auth.uid()) = retailer_user_id and exists (
    select 1 from public.retailer_profiles rp
    where rp.user_id = (select auth.uid()) and rp.approval_status = 'approved'
  ));

commit;
