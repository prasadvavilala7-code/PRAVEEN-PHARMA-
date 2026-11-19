-- Additive migration: does not alter existing medicine rows or photo URLs.
create table if not exists public.medicine_photo_studio (
 id uuid primary key default gen_random_uuid(),
 medicine_id uuid references public.medicines(id) on delete set null,
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
 using (private.is_owner())
 with check (private.is_owner());
grant select, insert, update on public.medicine_photo_studio to authenticated;
alter table public.medicines add column if not exists image_gallery jsonb not null default '[]'::jsonb;
create index if not exists medicine_photo_studio_created_at_idx on public.medicine_photo_studio(created_at desc);
create index if not exists medicine_photo_studio_medicine_id_idx on public.medicine_photo_studio(medicine_id);
