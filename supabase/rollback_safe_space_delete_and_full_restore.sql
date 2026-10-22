-- DOWN: Roll back add_safe_space_delete_and_full_restore.sql.

begin;

drop function if exists public.delete_space_cascade(bigint, text);
drop trigger if exists spaces_delete_quiz_attempts on public.spaces;
drop function if exists public.delete_space_attempts_before_space();

drop policy if exists "spaces authenticated read" on public.spaces;
drop policy if exists "spaces superadmin insert" on public.spaces;
drop policy if exists "spaces admins update" on public.spaces;
drop policy if exists "spaces superadmin delete" on public.spaces;

create policy "spaces admins manage"
on public.spaces
for all
to authenticated
using (public.can_manage_space(id))
with check (public.is_superadmin() or public.can_manage_space(id));

create or replace function public.attach_real_exam_metadata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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
  restored_spaces integer := 0;
  restored_groups integer := 0;
  restored_questions integer := 0;
begin
  if not public.is_superadmin() then
    raise exception 'Only superadmin can restore backups';
  end if;
  if coalesce((payload ->> 'schema_version')::integer, 0) <> 1 then
    raise exception 'Unsupported backup schema version';
  end if;

  if replace_existing then
    delete from public.spaces;
    delete from public.quiz_attempts;
  end if;

  insert into public.profiles
  select *
  from jsonb_populate_recordset(null::public.profiles, coalesce(payload -> 'profiles', '[]'::jsonb))
  on conflict (id) do update set
    email = excluded.email,
    fullname = excluded.fullname,
    role = excluded.role,
    active = excluded.active,
    updated_at = excluded.updated_at;

  insert into public.spaces
  select *
  from jsonb_populate_recordset(null::public.spaces, coalesce(payload -> 'spaces', '[]'::jsonb))
  on conflict (id) do update set
    name = excluded.name,
    slug = excluded.slug,
    timer_seconds = excluded.timer_seconds,
    exam_start_time = excluded.exam_start_time,
    allowed_late_minutes = excluded.allowed_late_minutes,
    real_exam_enabled = excluded.real_exam_enabled,
    real_question_percent = excluded.real_question_percent,
    real_timer_seconds = excluded.real_timer_seconds,
    real_multi_percent = excluded.real_multi_percent,
    real_max_attempts = excluded.real_max_attempts,
    real_scoring_method = excluded.real_scoring_method,
    real_exam_name = excluded.real_exam_name,
    real_question_sets = excluded.real_question_sets,
    mock_result_retention_days = excluded.mock_result_retention_days,
    real_result_retention_exams = excluded.real_result_retention_exams,
    real_exam_version = excluded.real_exam_version,
    real_start_at = excluded.real_start_at,
    real_end_at = excluded.real_end_at,
    published = excluded.published,
    updated_at = excluded.updated_at;
  get diagnostics restored_spaces = row_count;

  insert into public.groups
  select *
  from jsonb_populate_recordset(null::public.groups, coalesce(payload -> 'groups', '[]'::jsonb))
  on conflict (id) do update set space_id = excluded.space_id, name = excluded.name;
  get diagnostics restored_groups = row_count;

  insert into public.question_sets
  select *
  from jsonb_populate_recordset(null::public.question_sets, coalesce(payload -> 'question_sets', '[]'::jsonb))
  on conflict (id) do update set space_id = excluded.space_id, name = excluded.name;

  insert into public.questions
  select *
  from jsonb_populate_recordset(null::public.questions, coalesce(payload -> 'questions', '[]'::jsonb))
  on conflict (id) do update set
    space_id = excluded.space_id,
    question_set_id = excluded.question_set_id,
    order_no = excluded.order_no,
    type = excluded.type,
    content = excluded.content,
    options_json = excluded.options_json,
    correct_json = excluded.correct_json;
  get diagnostics restored_questions = row_count;

  insert into public.space_admins
  select *
  from jsonb_populate_recordset(null::public.space_admins, coalesce(payload -> 'space_admins', '[]'::jsonb))
  on conflict do nothing;

  insert into public.quiz_attempts
  select *
  from jsonb_populate_recordset(null::public.quiz_attempts, coalesce(payload -> 'quiz_attempts', '[]'::jsonb))
  on conflict (id) do nothing;

  perform setval(pg_get_serial_sequence('public.spaces', 'id'), coalesce((select max(id) from public.spaces), 1), true);
  perform setval(pg_get_serial_sequence('public.groups', 'id'), coalesce((select max(id) from public.groups), 1), true);
  perform setval(pg_get_serial_sequence('public.question_sets', 'id'), coalesce((select max(id) from public.question_sets), 1), true);
  perform setval(pg_get_serial_sequence('public.questions', 'id'), coalesce((select max(id) from public.questions), 1), true);

  return jsonb_build_object(
    'ok', true,
    'spaces', restored_spaces,
    'groups', restored_groups,
    'questions', restored_questions
  );
end;
$$;

revoke all on function public.restore_app_data(jsonb, boolean) from public;
grant execute on function public.restore_app_data(jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';

commit;
