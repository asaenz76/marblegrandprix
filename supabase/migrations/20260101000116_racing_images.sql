-- Racing Phase 16: optional rounded icon/image for competitions and races.
--
-- Additive and nullable: no change to existing rows, RLS on the racing tables,
-- grants, RPCs, or any money/grading/settlement path. Images are cosmetic
-- identity only. Writes to the bucket happen exclusively through the
-- server-side upload route using the service role (which bypasses RLS), never
-- directly from the browser — exactly like the Phase 1 avatars bucket.

alter table public.racing_competitions add column image_url text;
alter table public.races add column image_url text;

-- Public bucket for competition/race icons (public read; server-side writes).
insert into storage.buckets (id, name, public)
values ('racing-images', 'racing-images', true)
on conflict (id) do nothing;

create policy "racing_images_public_read"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'racing-images');
