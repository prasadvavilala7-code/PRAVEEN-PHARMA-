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
grant usage on schema private to authenticated;
grant execute on function private.is_active_admin() to authenticated;

create table if not exists public.godam_stock_products (
  id uuid primary key default gen_random_uuid(),
  product_name text not null,
  pack_type text,
  pack_size text,
  batch_no text,
  mfd date,
  expiry_date date,
  cotton_lots integer[] not null default '{}',
  cotton_entry_raw text,
  add_boxes integer not null default 0 check (add_boxes >= 0),
  less_boxes integer not null default 0 check (less_boxes >= 0),
  full_cotton_less integer not null default 0 check (full_cotton_less >= 0),
  units_per_box integer,
  remarks text,
  source_file text,
  is_demo boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.godam_stock_products
  add column if not exists cotton_entry_raw text,
  add column if not exists full_cotton_less integer not null default 0;
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

create table if not exists public.godam_stock_import_backups (
  id uuid primary key default gen_random_uuid(),
  source_file text,
  rows_snapshot jsonb not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.godam_stock_import_backups enable row level security;
drop policy if exists godam_backup_admin_select on public.godam_stock_import_backups;
drop policy if exists godam_backup_admin_insert on public.godam_stock_import_backups;
create policy godam_backup_admin_select on public.godam_stock_import_backups
  for select to authenticated using (private.is_active_admin());
create policy godam_backup_admin_insert on public.godam_stock_import_backups
  for insert to authenticated with check (private.is_active_admin() and (created_by is null or created_by = (select auth.uid())));
grant select, insert on public.godam_stock_import_backups to authenticated;

create or replace function public.replace_godam_stock_rows(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare inserted_count integer;
begin
  if not private.is_active_admin() then raise exception 'Active Admin access required'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Stock import payload must be a JSON array'; end if;
  insert into public.godam_stock_import_backups(source_file,rows_snapshot,created_by)
  select max(source_file),coalesce(jsonb_agg(to_jsonb(s) order by product_name,batch_no),'[]'::jsonb),(select auth.uid())
  from public.godam_stock_products s
  having count(*) > 0;
  delete from public.godam_stock_products;
  insert into public.godam_stock_products
    (product_name,pack_type,pack_size,batch_no,mfd,expiry_date,cotton_lots,cotton_entry_raw,
     add_boxes,less_boxes,full_cotton_less,units_per_box,remarks,source_file,is_demo,created_by)
  select x.product_name,x.pack_type,x.pack_size,x.batch_no,x.mfd,x.expiry_date,
         coalesce(x.cotton_lots,'{}'),x.cotton_entry_raw,coalesce(x.add_boxes,0),
         coalesce(x.less_boxes,0),coalesce(x.full_cotton_less,0),x.units_per_box,
         x.remarks,x.source_file,false,(select auth.uid())
  from pg_catalog.jsonb_to_recordset(p_rows) as x(
    product_name text,pack_type text,pack_size text,batch_no text,mfd date,expiry_date date,
    cotton_lots integer[],cotton_entry_raw text,add_boxes integer,less_boxes integer,
    full_cotton_less integer,units_per_box integer,remarks text,source_file text
  );
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;
revoke all on function public.replace_godam_stock_rows(jsonb) from public,anon;
grant execute on function public.replace_godam_stock_rows(jsonb) to authenticated;

do $$
begin
  if to_regclass('public.godam_stock_products_backup_20261127') is not null then
    execute 'alter table public.godam_stock_products_backup_20261127 set schema private';
  end if;
end $$;
