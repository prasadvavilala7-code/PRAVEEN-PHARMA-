create table if not exists public.site_settings (
  id integer primary key default 1 check (id = 1),
  business_name text not null default 'PRAVEEN PHARMA',
  tagline text not null default 'Wholesale Medicine Supply',
  about_text text not null default 'Wholesale medicine supply in Sircilla.',
  address text not null default 'Opposite Union Bank, Sircilla, Telangana',
  phone_primary text not null default '9550620353',
  phone_secondary text not null default '9398117337',
  announcement text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create table if not exists public.site_settings_history (
  id bigint generated always as identity primary key,
  snapshot jsonb not null,
  changed_at timestamptz not null default now(),
  changed_by uuid
);
alter table public.site_settings enable row level security;
alter table public.site_settings_history enable row level security;
drop policy if exists "Public can read site settings" on public.site_settings;
create policy "Public can read site settings" on public.site_settings for select using (true);
drop policy if exists "Admin can manage site settings" on public.site_settings;
create policy "Admin can manage site settings" on public.site_settings for all to authenticated
using (auth.uid() = '9be3d5ee-e09a-4738-9b27-f2fae15e93c7'::uuid)
with check (auth.uid() = '9be3d5ee-e09a-4738-9b27-f2fae15e93c7'::uuid);
drop policy if exists "Admin can read settings history" on public.site_settings_history;
create policy "Admin can read settings history" on public.site_settings_history for select to authenticated
using (auth.uid() = '9be3d5ee-e09a-4738-9b27-f2fae15e93c7'::uuid);
drop policy if exists "Admin can add settings history" on public.site_settings_history;
create policy "Admin can add settings history" on public.site_settings_history for insert to authenticated
with check (auth.uid() = '9be3d5ee-e09a-4738-9b27-f2fae15e93c7'::uuid);
insert into public.site_settings (id) values (1) on conflict (id) do nothing;
