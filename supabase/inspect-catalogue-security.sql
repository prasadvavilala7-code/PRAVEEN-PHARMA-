-- PRAVEEN PHARMA: read-only catalogue security inspection
-- Safe to run in Supabase SQL Editor. This script does not modify data or schema.

-- 1) Actual medicines table columns and types
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'medicines'
order by ordinal_position;

-- 2) Existing public catalogue view definition and security options
select
  c.relname as view_name,
  pg_get_viewdef(c.oid, true) as view_definition,
  c.reloptions as view_options
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'public_medicine_catalogue'
  and c.relkind = 'v';

-- 3) RLS status for the relevant relations
select
  c.relname as relation_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('medicines', 'public_medicine_catalogue', 'medicine_companies')
order by c.relname;

-- 4) Every existing policy on medicines and the public catalogue's base tables
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('medicines', 'medicine_companies')
order by tablename, policyname;

-- 5) Views depending on medicines (helps identify other public data paths)
select
  dependent.relname as dependent_view,
  pg_get_viewdef(dependent.oid, true) as view_definition,
  dependent.reloptions as view_options
from pg_rewrite rw
join pg_class base on base.oid = rw.ev_class
join pg_depend d on d.objid = rw.oid
join pg_class dependent on dependent.oid = d.refobjid
join pg_namespace n on n.oid = base.relnamespace
where n.nspname = 'public'
  and base.relname = 'medicines'
  and dependent.relkind = 'v'
group by dependent.oid, dependent.relname, dependent.reloptions
order by dependent.relname;
