-- Run once on an existing cloud database.
-- Public visitors can read published quiz content, while authenticated admins
-- can only read spaces and related data granted by can_manage_space().

drop policy if exists "spaces public read published" on public.spaces;
create policy "spaces public read published"
on public.spaces for select to anon
using (published);

drop policy if exists "groups public read published" on public.groups;
create policy "groups public read published"
on public.groups for select to anon
using (
  exists (
    select 1
    from public.spaces s
    where s.id = space_id
      and s.published
  )
);

drop policy if exists "questions public read published" on public.questions;
create policy "questions public read published"
on public.questions for select to anon
using (
  exists (
    select 1
    from public.spaces s
    where s.id = space_id
      and s.published
  )
);

notify pgrst, 'reload schema';
