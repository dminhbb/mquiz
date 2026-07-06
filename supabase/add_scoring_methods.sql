-- Add per-space scoring methods while preserving the existing formula as method 1.

alter table public.spaces
add column if not exists real_scoring_method integer not null default 1;

alter table public.spaces
drop constraint if exists spaces_real_scoring_method_check;

alter table public.spaces
add constraint spaces_real_scoring_method_check
check (real_scoring_method in (1, 2));

alter table public.quiz_attempts
add column if not exists scoring_method integer not null default 1;

alter table public.quiz_attempts
drop constraint if exists quiz_attempts_scoring_method_check;

alter table public.quiz_attempts
add constraint quiz_attempts_scoring_method_check
check (scoring_method in (1, 2));

alter table public.quiz_attempts
drop constraint if exists quiz_attempts_knowledge_score_check;

alter table public.quiz_attempts
add constraint quiz_attempts_knowledge_score_check
check (knowledge_score between 0 and 95);

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
);

notify pgrst, 'reload schema';
