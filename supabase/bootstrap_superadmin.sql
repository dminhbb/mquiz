-- 1. Create the user first in Supabase Dashboard > Authentication > Users.
-- 2. Replace the email and fullname below.
-- 3. Run this script once in SQL Editor.

insert into public.profiles (id, email, fullname, role, active)
select
  id,
  email,
  'Minh Nguyen',
  'superadmin',
  true
from auth.users
where lower(email) = lower('dminhbb@gmail.com')
on conflict (id) do update set
  email = excluded.email,
  fullname = excluded.fullname,
  role = 'superadmin',
  active = true,
  updated_at = now();

do $$
begin
  if not exists (
    select 1
    from public.profiles
    where role = 'superadmin' and active
  ) then
    raise exception 'Superadmin was not created. Check the email in auth.users.';
  end if;
end
$$;
