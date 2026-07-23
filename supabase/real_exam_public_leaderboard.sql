-- Public, read-only leaderboard data for a non-archived real exam.
-- This intentionally bypasses the seven-day generic quiz_attempts read policy,
-- while exposing only result fields needed by the student leaderboard.

drop function if exists public.get_real_exam_leaderboard_public(integer);

create or replace function public.get_real_exam_leaderboard_public(
  requested_code integer
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(result_row) order by result_row.submitted_at desc), '[]'::jsonb)
  from (
    select
      attempt.id,
      space.slug as space_slug,
      exam.code as real_exam_code,
      attempt.student_name,
      attempt.student_name_key,
      attempt.group_name,
      attempt.mode,
      attempt.score,
      attempt.total_questions,
      attempt.correct_count,
      attempt.wrong_count,
      attempt.duration_seconds,
      attempt.started_at,
      attempt.submitted_at
    from public.real_exams exam
    join public.spaces space on space.id = exam.space_id
    join public.quiz_attempts attempt on attempt.real_exam_id = exam.id
    where exam.code = requested_code
      and exam.hidden_at is null
      and attempt.mode = 'real'
    order by attempt.submitted_at desc
    limit 5000
  ) result_row;
$$;

revoke all on function public.get_real_exam_leaderboard_public(integer) from public;
grant execute on function public.get_real_exam_leaderboard_public(integer) to anon, authenticated;

notify pgrst, 'reload schema';
