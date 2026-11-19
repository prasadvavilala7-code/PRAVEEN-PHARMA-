-- Applied migration: link AI-generated medicine photo sets to their catalogue medicine.
alter table public.medicine_photo_studio
  add column if not exists medicine_id uuid references public.medicines(id) on delete set null;

alter table public.medicines
  add column if not exists image_gallery jsonb not null default '[]'::jsonb;

create index if not exists medicine_photo_studio_medicine_id_idx
  on public.medicine_photo_studio(medicine_id);
