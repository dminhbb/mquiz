-- Run after cloud_admin_schema.sql.
-- Adds secure Excel-export metadata and RPCs for the latest real-exam periods.

alter table public.quiz_attempts
add column if not exists real_exam_version text;

alter table public.quiz_attempts
add column if not exists real_exam_start_at timestamptz;

alter table public.quiz_attempts
add column if not exists real_exam_end_at timestamptz;

update public.quiz_attempts qa
set
  real_exam_version = s.real_exam_version,
  real_exam_start_at = s.real_start_at,
  real_exam_end_at = s.real_end_at
from public.spaces s
where qa.space_slug = s.slug
  and qa.mode = 'real'
  and qa.real_exam_version is null;

create or replace function public.attach_real_exam_metadata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.mode = 'real' then
    select s.real_exam_version, s.real_start_at, s.real_end_at
      into new.real_exam_version, new.real_exam_start_at, new.real_exam_end_at
    from public.spaces s
    where s.slug = new.space_slug;
  else
    new.real_exam_version := null;
    new.real_exam_start_at := null;
    new.real_exam_end_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists quiz_attempts_attach_real_exam_metadata on public.quiz_attempts;
create trigger quiz_attempts_attach_real_exam_metadata
before insert on public.quiz_attempts
for each row execute function public.attach_real_exam_metadata();

create index if not exists quiz_attempts_real_exam_export_idx
on public.quiz_attempts (space_slug, mode, real_exam_version, submitted_at desc);

create or replace function public.can_export_real_exam_results(requested_slug text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.can_manage_space(s.id)
    from public.spaces s
    where s.slug = requested_slug
  ), false);
$$;

revoke all on function public.can_export_real_exam_results(text) from public;
grant execute on function public.can_export_real_exam_results(text) to authenticated;

create or replace function public.export_real_exam_results(
  requested_slug text,
  exam_limit integer default 3
)
returns table (
  group_name text,
  exam_rank bigint,
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
  with ranked_exams as (
    select
      qa.real_exam_version,
      dense_rank() over (order by max(qa.submitted_at) desc) as exam_rank
    from public.quiz_attempts qa
    where qa.space_slug = requested_slug
      and qa.mode = 'real'
      and qa.real_exam_version is not null
    group by qa.real_exam_version
  ),
  latest_exams as (
    select re.real_exam_version, re.exam_rank
    from ranked_exams re
    where re.exam_rank <= greatest(1, least(coalesce(exam_limit, 3), 3))
  ),
  best_attempts as (
    select
      qa.*,
      le.exam_rank,
      row_number() over (
        partition by qa.real_exam_version, qa.student_name_key
        order by qa.score desc, qa.duration_seconds asc, qa.submitted_at desc
      ) as attempt_rank
    from public.quiz_attempts qa
    join latest_exams le on le.real_exam_version = qa.real_exam_version
    where qa.space_slug = requested_slug
      and qa.mode = 'real'
  )
  select
    ba.group_name,
    ba.exam_rank,
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
  order by ba.group_name, ba.exam_rank, ba.score desc, ba.duration_seconds, ba.student_name;
end;
$$;

revoke all on function public.export_real_exam_results(text, integer) from public;
grant execute on function public.export_real_exam_results(text, integer) to authenticated;

notify pgrst, 'reload schema';
