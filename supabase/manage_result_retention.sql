-- Manage per-space result retention and real-exam result export by exam name/version.
-- Run after cloud_admin_schema.sql and add_real_exam_result_export.sql.

alter table public.spaces
add column if not exists mock_result_retention_days integer,
add column if not exists real_result_retention_exams integer;

update public.spaces
set
  mock_result_retention_days = coalesce(mock_result_retention_days, 7),
  real_result_retention_exams = coalesce(real_result_retention_exams, 7);

alter table public.spaces
alter column mock_result_retention_days set default 7,
alter column mock_result_retention_days set not null,
alter column real_result_retention_exams set default 7,
alter column real_result_retention_exams set not null;

alter table public.spaces
drop constraint if exists spaces_mock_result_retention_days_check,
drop constraint if exists spaces_real_result_retention_exams_check;

alter table public.spaces
add constraint spaces_mock_result_retention_days_check check (mock_result_retention_days between 3 and 15),
add constraint spaces_real_result_retention_exams_check check (real_result_retention_exams between 3 and 15);

alter table public.quiz_attempts
add column if not exists real_exam_name text;

update public.quiz_attempts qa
set real_exam_name = s.real_exam_name
from public.spaces s
where qa.space_slug = s.slug
  and qa.mode = 'real'
  and qa.real_exam_name is null;

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

create or replace function public.cleanup_space_results_unchecked(target_space_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_slug text;
  mock_days integer;
  real_exams integer;
  deleted_mock_by_days integer := 0;
  deleted_mock_by_cap integer := 0;
  deleted_real_by_exams integer := 0;
  deleted_real_by_cap integer := 0;
begin
  select
    s.slug,
    coalesce(s.mock_result_retention_days, 7),
    coalesce(s.real_result_retention_exams, 7)
  into target_slug, mock_days, real_exams
  from public.spaces s
  where s.id = target_space_id;

  if target_slug is null then
    raise exception 'Space không tồn tại.';
  end if;

  delete from public.quiz_attempts qa
  where qa.space_slug = target_slug
    and qa.mode = 'mock'
    and qa.submitted_at < now() - make_interval(days => mock_days);
  get diagnostics deleted_mock_by_days = row_count;

  with old_mock as (
    select qa.id
    from public.quiz_attempts qa
    where qa.space_slug = target_slug
      and qa.mode = 'mock'
    order by qa.submitted_at desc
    offset 500
  )
  delete from public.quiz_attempts qa
  using old_mock om
  where qa.id = om.id;
  get diagnostics deleted_mock_by_cap = row_count;

  with ranked_exams as (
    select
      qa.real_exam_version,
      dense_rank() over (order by max(qa.submitted_at) desc) as exam_rank
    from public.quiz_attempts qa
    where qa.space_slug = target_slug
      and qa.mode = 'real'
      and qa.real_exam_version is not null
    group by qa.real_exam_version
  ),
  old_exams as (
    select re.real_exam_version
    from ranked_exams re
    where re.exam_rank > real_exams
  )
  delete from public.quiz_attempts qa
  using old_exams oe
  where qa.space_slug = target_slug
    and qa.mode = 'real'
    and qa.real_exam_version = oe.real_exam_version;
  get diagnostics deleted_real_by_exams = row_count;

  with old_real as (
    select qa.id
    from public.quiz_attempts qa
    where qa.space_slug = target_slug
      and qa.mode = 'real'
    order by qa.submitted_at desc
    offset 1000
  )
  delete from public.quiz_attempts qa
  using old_real orl
  where qa.id = orl.id;
  get diagnostics deleted_real_by_cap = row_count;

  return jsonb_build_object(
    'ok', true,
    'mock_deleted_by_days', deleted_mock_by_days,
    'mock_deleted_by_cap', deleted_mock_by_cap,
    'real_deleted_by_exam_limit', deleted_real_by_exams,
    'real_deleted_by_cap', deleted_real_by_cap
  );
end;
$$;

revoke all on function public.cleanup_space_results_unchecked(bigint) from public;

create or replace function public.cleanup_space_results(target_space_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_space(target_space_id) then
    raise exception 'Không có quyền quản lý kết quả của Space này.';
  end if;

  return public.cleanup_space_results_unchecked(target_space_id);
end;
$$;

revoke all on function public.cleanup_space_results(bigint) from public;
grant execute on function public.cleanup_space_results(bigint) to authenticated;

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

drop trigger if exists quiz_attempts_cleanup_space_results on public.quiz_attempts;
create trigger quiz_attempts_cleanup_space_results
after insert on public.quiz_attempts
for each row execute function public.cleanup_space_results_after_insert();

create or replace function public.list_real_exam_periods(requested_slug text)
returns table (
  real_exam_version text,
  real_exam_name text,
  real_exam_start_at timestamptz,
  real_exam_end_at timestamptz,
  submitted_count bigint,
  latest_submitted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_space_id bigint;
begin
  select s.id into target_space_id
  from public.spaces s
  where s.slug = requested_slug;

  if target_space_id is null or not public.can_manage_space(target_space_id) then
    raise exception 'Không có quyền xem kết quả của Space này.';
  end if;

  return query
  select
    qa.real_exam_version,
    coalesce(max(nullif(qa.real_exam_name, '')), 'Đợt thi thật chưa đặt tên') as real_exam_name,
    min(qa.real_exam_start_at) as real_exam_start_at,
    max(qa.real_exam_end_at) as real_exam_end_at,
    count(*) as submitted_count,
    max(qa.submitted_at) as latest_submitted_at
  from public.quiz_attempts qa
  where qa.space_slug = requested_slug
    and qa.mode = 'real'
    and qa.real_exam_version is not null
  group by qa.real_exam_version
  order by max(qa.submitted_at) desc;
end;
$$;

revoke all on function public.list_real_exam_periods(text) from public;
grant execute on function public.list_real_exam_periods(text) to authenticated;

create or replace function public.export_real_exam_results_by_version(
  requested_slug text,
  requested_exam_version text
)
returns table (
  group_name text,
  real_exam_name text,
  real_exam_version text,
  real_exam_start_at timestamptz,
  real_exam_end_at timestamptz,
  student_name text,
  score numeric,
  total_questions integer,
  correct_count integer,
  wrong_count integer,
  duration_seconds integer,
  started_at timestamptz,
  submitted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_space_id bigint;
begin
  select s.id into target_space_id
  from public.spaces s
  where s.slug = requested_slug;

  if target_space_id is null or not public.can_manage_space(target_space_id) then
    raise exception 'Không có quyền xuất kết quả của Space này.';
  end if;

  return query
  with best_attempts as (
    select
      qa.*,
      row_number() over (
        partition by qa.real_exam_version, qa.student_name_key
        order by qa.score desc, qa.duration_seconds asc, qa.submitted_at desc
      ) as attempt_rank
    from public.quiz_attempts qa
    where qa.space_slug = requested_slug
      and qa.mode = 'real'
      and qa.real_exam_version = requested_exam_version
  )
  select
    ba.group_name,
    ba.real_exam_name,
    ba.real_exam_version,
    ba.real_exam_start_at,
    ba.real_exam_end_at,
    ba.student_name,
    ba.score,
    ba.total_questions,
    ba.correct_count,
    ba.wrong_count,
    ba.duration_seconds,
    ba.started_at,
    ba.submitted_at
  from best_attempts ba
  where ba.attempt_rank = 1
  order by ba.score desc, ba.duration_seconds asc, ba.submitted_at desc, ba.student_name;
end;
$$;

revoke all on function public.export_real_exam_results_by_version(text, text) from public;
grant execute on function public.export_real_exam_results_by_version(text, text) to authenticated;

notify pgrst, 'reload schema';
