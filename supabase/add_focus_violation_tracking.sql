-- UP: Add focus-loss tracking to quiz attempts and admin result exports.

begin;

alter table public.quiz_attempts
add column if not exists focus_violation_count integer not null default 0;

alter table public.quiz_attempts
drop constraint if exists quiz_attempts_focus_violation_count_check;

alter table public.quiz_attempts
add constraint quiz_attempts_focus_violation_count_check
check (focus_violation_count between 0 and 1000);

drop policy if exists "allow public insert quiz attempts" on public.quiz_attempts;
create policy "allow public insert quiz attempts"
on public.quiz_attempts
for insert
to anon, authenticated
with check (
  mode in ('mock', 'real')
  and scoring_method in (1, 2)
  and char_length(trim(student_name)) between 1 and 80
  and char_length(trim(student_name_key)) between 1 and 80
  and char_length(trim(group_name)) between 1 and 120
  and score between 0 and 100
  and total_questions > 0
  and bank_question_count >= total_questions
  and correct_count >= 0
  and wrong_count >= 0
  and multi_correct_count >= 0
  and multi_similarity_score >= 0
  and correct_count + wrong_count = total_questions
  and duration_seconds >= 0
  and timer_seconds >= 0
  and knowledge_score between 0 and 95
  and coverage_score between 0 and 10
  and duration_score between 0 and 10
  and punctuality_score between 0 and 5
  and focus_violation_count between 0 and 1000
);

drop function if exists public.export_real_exam_results(text, integer);
create function public.export_real_exam_results(
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
  focus_violation_count integer,
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
    ba.focus_violation_count,
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

drop function if exists public.export_real_exam_results_by_version(text, text);
create function public.export_real_exam_results_by_version(
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
  focus_violation_count integer,
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
    ba.focus_violation_count,
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

commit;
