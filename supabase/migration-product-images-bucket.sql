-- Migration: Supabase Storage bucket «product-images» for the admin panel's
-- photo upload (admin/admin.js → «انتخاب عکس از کامپیوتر»). Safe to re-run.
--
-- - Public bucket: product photos are shown on the public storefront, so
--   anyone may READ files in this bucket (and only this bucket).
-- - 5 MB per file, JPEG / PNG / WebP only. The admin panel already shrinks
--   photos to ≤ 1600 px JPEG 0.85 before uploading, so real uploads are far
--   below the limit.
-- - Writing (upload / replace / delete) is admins only, with EXACTLY the same
--   check the products table policies use in supabase/schema.sql:
--     exists (select 1 from public.profiles where id = auth.uid() and is_admin)
--   A customer cannot pass it: profiles has no insert policy, and its
--   "update own" policy forces is_admin to stay unchanged — only the project
--   owner can set is_admin, by running SQL in Supabase.
--
-- Run in Supabase -> SQL Editor as one script.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "product-images: public read" on storage.objects;
create policy "product-images: public read" on storage.objects for select
  using (bucket_id = 'product-images');

drop policy if exists "product-images: admin insert" on storage.objects;
create policy "product-images: admin insert" on storage.objects for insert
  with check (
    bucket_id = 'product-images'
    and exists (select 1 from public.profiles where id = auth.uid() and is_admin)
  );

drop policy if exists "product-images: admin update" on storage.objects;
create policy "product-images: admin update" on storage.objects for update
  using (
    bucket_id = 'product-images'
    and exists (select 1 from public.profiles where id = auth.uid() and is_admin)
  )
  with check (
    bucket_id = 'product-images'
    and exists (select 1 from public.profiles where id = auth.uid() and is_admin)
  );

drop policy if exists "product-images: admin delete" on storage.objects;
create policy "product-images: admin delete" on storage.objects for delete
  using (
    bucket_id = 'product-images'
    and exists (select 1 from public.profiles where id = auth.uid() and is_admin)
  );

commit;

-- Result: the bucket and its four policies (one row per policy)
select
  b.id as bucket,
  b.public,
  b.file_size_limit,
  b.allowed_mime_types,
  p.policyname,
  p.cmd,
  p.qual as using_expr,
  p.with_check
from storage.buckets b
left join pg_policies p
  on p.schemaname = 'storage'
  and p.tablename = 'objects'
  and p.policyname like 'product-images:%'
where b.id = 'product-images'
order by p.cmd, p.policyname;
