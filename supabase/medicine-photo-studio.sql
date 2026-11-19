-- AI Medicine Photo Studio: additive only; does not alter medicines or existing photos.
create table if not exists public.medicine_photo_studio (
 id uuid primary key default gen_random_uuid(),
 admin_user_id uuid not null references auth.users(id) on delete cascade,
 medicine_name text not null,
 product_type text not null default 'auto',
 source_path text not null,
 images jsonb not null default '[]'::jsonb,
 status text not null default 'draft' check (status in ('draft','approved','rejected')),
 approved_at timestamptz,
 approved_by uuid references auth.users(id),
 created_at timestamptz not null default now()
);
alter table public.medicine_photo_studio enable row level security;
drop policy if exists "Owner admin manages medicine photo studio" on public.medicine_photo_studio;
create policy "Owner admin manages medicine photo studio" on public.medicine_photo_studio
 for all to authenticated
 using (exists (select 1 from public.admin_users a where a.user_id=auth.uid() and a.role='owner' and a.is_active=true))
 with check (exists (select 1 from public.admin_users a where a.user_id=auth.uid() and a.role='owner' and a.is_active=true));
create index if not exists medicine_photo_studio_created_at_idx on public.medicine_photo_studio(created_at desc);
