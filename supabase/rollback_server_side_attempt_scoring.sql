-- DOWN: Reverts server_side_attempt_scoring.sql.
--
-- WARNING: this re-opens direct inserts into public.quiz_attempts for anon and
-- authenticated users (client-computed scores). Deploy the previous frontend
-- (which inserts results from the browser) before or together with this rollback,
-- and redeploy the previous quiz-evaluate Edge Function if it was changed.
-- Session and rate-limit rows are deleted with their tables.

begin;

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
grant insert on public.quiz_attempts to anon, authenticated;

drop policy if exists "allow public read recent quiz attempts" on public.quiz_attempts;
create policy "allow public read recent quiz attempts"
on public.quiz_attempts
for select
to anon, authenticated
using (
  submitted_at >= now() - interval '7 days'
);

drop function if exists public.start_quiz_attempt_session(
  bigint, text, text, bigint, integer, bigint, text, text, text, bigint[], integer, integer, integer, integer
);
drop function if exists public.purge_stale_quiz_attempt_sessions();
drop function if exists public.consume_rate_limit(text, integer, integer);
drop table if exists public.api_rate_limits;
drop table if exists public.quiz_attempt_sessions;

commit;

notify pgrst, 'reload schema';
