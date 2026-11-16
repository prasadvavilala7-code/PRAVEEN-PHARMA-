-- PRAVEEN PHARMA medicine photo storage
-- Run once in Supabase Dashboard > SQL Editor > New query.
-- Public bucket allows anyone to view a known photo URL; only the configured admin can upload/change/delete.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'medicine-images',
  'medicine-images',
  true,
  5242880,
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "PRAVEEN admin upload medicine photos" on storage.objects;
create policy "PRAVEEN admin upload medicine photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'medicine-images'
  and (select auth.uid()) = '9be3d5ee-e09a-4738-9b27-f2fae15e93c7'::uuid
);

drop policy if exists "PRAVEEN admin update medicine photos" on storage.objects;
create policy "PRAVEEN admin update medicine photos"
on storage.objects for update to authenticated
using (
  bucket_id = 'medicine-images'
  and (select auth.uid()) = '9be3d5ee-e09a-4738-9b27-f2fae15e93c7'::uuid
)
with check (
  bucket_id = 'medicine-images'
  and (select auth.uid()) = '9be3d5ee-e09a-4738-9b27-f2fae15e93c7'::uuid
);

drop policy if exists "PRAVEEN admin delete medicine photos" on storage.objects;
create policy "PRAVEEN admin delete medicine photos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'medicine-images'
  and (select auth.uid()) = '9be3d5ee-e09a-4738-9b27-f2fae15e93c7'::uuid
);

-- No public SELECT policy is required: public buckets serve object URLs publicly.
