-- UP: Restrict Space deletion to superadmins and make restore a full replacement.

begin;

drop policy if exists "spaces admins manage" on public.spaces;
drop policy if exists "spaces authenticated read" on public.spaces;
drop policy if exists "spaces superadmin insert" on public.spaces;
drop policy if exists "spaces admins update" on public.spaces;
drop policy if exists "spaces superadmin delete" on public.spaces;

create policy "spaces authenticated read"
on public.spaces
for select
to authenticated
using (public.can_manage_space(id));

create policy "spaces superadmin insert"
on public.spaces
for insert
to authenticated
with check (public.is_superadmin());

create policy "spaces admins update"
on public.spaces
for update
to authenticated
using (public.can_manage_space(id))
with check (public.can_manage_space(id));

create policy "spaces superadmin delete"
on public.spaces
for delete
to authenticated
using (public.is_superadmin());

create or replace function public.delete_space_cascade(
  requested_space_id bigint,
  requested_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actual_slug text;
  deleted_attempts integer := 0;
  deleted_groups integer := 0;
  deleted_question_sets integer := 0;
  deleted_questions integer := 0;
begin
  if not public.is_superadmin() then
    raise exception 'Chỉ superadmin được xóa Space.';
  end if;

  select s.slug into actual_slug
  from public.spaces s
  where s.id = requested_space_id
  for update;

  if actual_slug is null then
    raise exception 'Space không tồn tại.';
  end if;
  if requested_slug is distinct from actual_slug then
    raise exception 'Slug xác nhận không khớp.';
  end if;

  select count(*) into deleted_attempts
  from public.quiz_attempts qa
  where qa.space_slug = actual_slug;

  select count(*) into deleted_groups
  from public.groups g
  where g.space_id = requested_space_id;

  select count(*) into deleted_question_sets
  from public.question_sets qs
  where qs.space_id = requested_space_id;

  select count(*) into deleted_questions
  from public.questions q
  where q.space_id = requested_space_id;

  delete from public.quiz_attempts
  where space_slug = actual_slug;

  delete from public.spaces
  where id = requested_space_id;

  return jsonb_build_object(
    'ok', true,
    'space_slug', actual_slug,
    'quiz_attempts_deleted', deleted_attempts,
    'groups_deleted', deleted_groups,
    'question_sets_deleted', deleted_question_sets,
    'questions_deleted', deleted_questions
  );
end;
$$;

revoke all on function public.delete_space_cascade(bigint, text) from public;
grant execute on function public.delete_space_cascade(bigint, text) to authenticated;

create or replace function public.delete_space_attempts_before_space()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.quiz_attempts
  where space_slug = old.slug;
  return old;
end;
$$;

drop trigger if exists spaces_delete_quiz_attempts on public.spaces;
create trigger spaces_delete_quiz_attempts
before delete on public.spaces
for each row execute function public.delete_space_attempts_before_space();

create or replace function public.attach_real_exam_metadata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('mquiz.restore_mode', true) = 'on' then
    return new;
  end if;
  if new.mode = 'real' then
    select s.real_exam_version, s.real_exam_name, s.real_start_at, s.real_end_at
      into new.real_exam_version, new.real_exam_name, new.real_exam_start_at, new.real_exam_end_at
    from public.spaces s
    where s.slug = new.space_slug;
  else
    new.real_exam_version := null;
    new.real_exam_name := null;
    new.real_exam_start_at := null;
    new.real_exam_end_at := null;
  end if;
  return new;
end;
$$;

create or replace function public.cleanup_space_results_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_space_id bigint;
begin
  if current_setting('mquiz.restore_mode', true) = 'on' then
    return null;
  end if;
  select s.id into target_space_id
  from public.spaces s
  where s.slug = new.space_slug;

  if target_space_id is not null then
    perform public.cleanup_space_results_unchecked(target_space_id);
  end if;

  return null;
end;
$$;

create or replace function public.restore_app_data(
  payload jsonb,
  replace_existing boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  restored_profiles integer := 0;
  restored_spaces integer := 0;
  restored_space_admins integer := 0;
  restored_groups integer := 0;
  restored_question_sets integer := 0;
  restored_questions integer := 0;
  restored_quiz_attempts integer := 0;
begin
  if not public.is_superadmin() then
    raise exception 'Only superadmin can restore backups';
  end if;
  if not replace_existing then
    raise exception 'Restore bắt buộc phải thay thế toàn bộ dữ liệu hiện tại.';
  end if;
  if jsonb_typeof(payload) is distinct from 'object'
    or coalesce((payload ->> 'schema_version')::integer, 0) <> 1 then
    raise exception 'Unsupported backup schema version';
  end if;
  if jsonb_typeof(payload -> 'profiles') is distinct from 'array'
    or jsonb_typeof(payload -> 'spaces') is distinct from 'array'
    or jsonb_typeof(payload -> 'space_admins') is distinct from 'array'
    or jsonb_typeof(payload -> 'groups') is distinct from 'array'
    or jsonb_typeof(payload -> 'question_sets') is distinct from 'array'
    or jsonb_typeof(payload -> 'questions') is distinct from 'array'
    or jsonb_typeof(payload -> 'quiz_attempts') is distinct from 'array' then
    raise exception 'Backup payload is incomplete';
  end if;
  if not exists (
    select 1
    from jsonb_to_recordset(payload -> 'profiles') as restored_profile(
      id uuid,
      role text,
      active boolean
    )
    where restored_profile.id = auth.uid()
      and restored_profile.role = 'superadmin'
      and restored_profile.active
  ) then
    raise exception 'Backup phải chứa tài khoản superadmin hiện tại đang hoạt động.';
  end if;

  delete from public.quiz_attempts;
  delete from public.spaces;
  delete from public.profiles;

  insert into public.profiles
  select *
  from jsonb_populate_recordset(null::public.profiles, payload -> 'profiles');
  get diagnostics restored_profiles = row_count;

  insert into public.spaces
  select *
  from jsonb_populate_recordset(null::public.spaces, payload -> 'spaces');
  get diagnostics restored_spaces = row_count;

  insert into public.groups
  select *
  from jsonb_populate_recordset(null::public.groups, payload -> 'groups');
  get diagnostics restored_groups = row_count;

  insert into public.question_sets
  select *
  from jsonb_populate_recordset(null::public.question_sets, payload -> 'question_sets');
  get diagnostics restored_question_sets = row_count;

  insert into public.questions
  select *
  from jsonb_populate_recordset(null::public.questions, payload -> 'questions');
  get diagnostics restored_questions = row_count;

  insert into public.space_admins
  select *
  from jsonb_populate_recordset(null::public.space_admins, payload -> 'space_admins');
  get diagnostics restored_space_admins = row_count;

  perform set_config('mquiz.restore_mode', 'on', true);

  insert into public.quiz_attempts
  select *
  from jsonb_populate_recordset(null::public.quiz_attempts, payload -> 'quiz_attempts');
  get diagnostics restored_quiz_attempts = row_count;

  perform set_config('mquiz.restore_mode', 'off', true);

  perform setval(pg_get_serial_sequence('public.spaces', 'id'), coalesce((select max(id) from public.spaces), 1), true);
  perform setval(pg_get_serial_sequence('public.groups', 'id'), coalesce((select max(id) from public.groups), 1), true);
  perform setval(pg_get_serial_sequence('public.question_sets', 'id'), coalesce((select max(id) from public.question_sets), 1), true);
  perform setval(pg_get_serial_sequence('public.questions', 'id'), coalesce((select max(id) from public.questions), 1), true);

  return jsonb_build_object(
    'ok', true,
    'profiles', restored_profiles,
    'spaces', restored_spaces,
    'space_admins', restored_space_admins,
    'groups', restored_groups,
    'question_sets', restored_question_sets,
    'questions', restored_questions,
    'quiz_attempts', restored_quiz_attempts
  );
end;
$$;

revoke all on function public.restore_app_data(jsonb, boolean) from public;
grant execute on function public.restore_app_data(jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';

commit;
