-- Allow the public frontend to distinguish an unpublished Space from a
-- legacy Space that has not been migrated to cloud yet.

create or replace function public.get_space_public_status(requested_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when s.id is null then jsonb_build_object('exists', false, 'published', false)
    else jsonb_build_object('exists', true, 'published', s.published)
  end
  from (select 1) seed
  left join public.spaces s on s.slug = requested_slug
  limit 1;
$$;

revoke all on function public.get_space_public_status(text) from public;
grant execute on function public.get_space_public_status(text) to anon, authenticated;

notify pgrst, 'reload schema';
