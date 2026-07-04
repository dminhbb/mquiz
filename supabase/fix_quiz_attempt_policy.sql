-- Fix result inserts when the browser also has a Supabase Auth Admin session.
-- Safe to run more than once. Existing quiz attempts are preserved.

drop policy if exists "allow public insert quiz attempts" on public.quiz_attempts;

create policy "allow public insert quiz attempts"
on public.quiz_attempts
for insert
to anon, authenticated
with check (
  mode in ('mock', 'real')
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
  and knowledge_score between 0 and 75
  and coverage_score between 0 and 10
  and duration_score between 0 and 10
  and punctuality_score between 0 and 5
);

drop policy if exists "allow public read recent quiz attempts" on public.quiz_attempts;

create policy "allow public read recent quiz attempts"
on public.quiz_attempts
for select
to anon, authenticated
using (
  submitted_at >= now() - interval '7 days'
);

grant select, insert on public.quiz_attempts to anon, authenticated;

notify pgrst, 'reload schema';
