-- Run this once in Supabase SQL Editor for PRAVEEN PHARMA.
create table if not exists public.admin_login_alerts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  user_email text,
  is_configured_admin boolean not null default false,
  login_at timestamptz not null default now(),
  source text not null default 'admin-dashboard',
  user_agent text
);
create index if not exists admin_login_alerts_login_at_idx
  on public.admin_login_alerts (login_at desc);
alter table public.admin_login_alerts enable row level security;
drop policy if exists "Configured admin can read login alerts" on public.admin_login_alerts;
create policy "Configured admin can read login alerts"
  on public.admin_login_alerts for select to authenticated
  using (auth.uid() = '9be3d5ee-e09a-4738-9b27-f2fae15e93c7'::uuid);
-- No client INSERT policy: only the Edge Function using the service-role key may write logs.
