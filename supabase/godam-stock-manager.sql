create or replace function private.is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users a
    where a.user_id = (select auth.uid()) and a.is_active = true
  );
$$;

create table if not exists public.godam_stock_products (
  id uuid primary key default gen_random_uuid(),
  product_name text not null,
  pack_type text,
  pack_size text,
  batch_no text,
  mfd date,
  expiry_date date,
  cotton_lots integer[] not null default '{}',
  add_boxes integer not null default 0 check (add_boxes >= 0),
  less_boxes integer not null default 0 check (less_boxes >= 0),
  units_per_box integer,
  remarks text,
  source_file text,
  is_demo boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.godam_stock_products enable row level security;
drop policy if exists godam_stock_admin_select on public.godam_stock_products;
drop policy if exists godam_stock_admin_insert on public.godam_stock_products;
drop policy if exists godam_stock_admin_update on public.godam_stock_products;
drop policy if exists godam_stock_admin_delete on public.godam_stock_products;
create policy godam_stock_admin_select on public.godam_stock_products for select to authenticated using (private.is_active_admin());
create policy godam_stock_admin_insert on public.godam_stock_products for insert to authenticated with check (private.is_active_admin() and (created_by is null or created_by = (select auth.uid())));
create policy godam_stock_admin_update on public.godam_stock_products for update to authenticated using (private.is_active_admin()) with check (private.is_active_admin());
create policy godam_stock_admin_delete on public.godam_stock_products for delete to authenticated using (private.is_active_admin());
grant select, insert, update, delete on public.godam_stock_products to authenticated;
