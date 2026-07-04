-- Run this migration in Supabase SQL Editor.
-- It is safe to run more than once.

alter table public.quiz_attempts
add column if not exists group_name text;

alter table public.quiz_attempts
add column if not exists mode text;

alter table public.quiz_attempts
add column if not exists started_at timestamptz;

alter table public.quiz_attempts
add column if not exists bank_question_count integer;

alter table public.quiz_attempts
add column if not exists multi_correct_count integer;

alter table public.quiz_attempts
add column if not exists multi_similarity_score numeric(8,2);

alter table public.quiz_attempts
add column if not exists timer_seconds integer;

alter table public.quiz_attempts
add column if not exists knowledge_score numeric(5,2);

alter table public.quiz_attempts
add column if not exists coverage_score numeric(5,2);

alter table public.quiz_attempts
add column if not exists duration_score numeric(5,2);

alter table public.quiz_attempts
add column if not exists punctuality_score numeric(5,2);

-- PostgreSQL does not allow changing a column type while an RLS policy
-- references that column. The policy is recreated at the end of this file.
drop policy if exists "allow public insert quiz attempts" on public.quiz_attempts;

alter table public.quiz_attempts
drop constraint if exists quiz_attempts_mode_check;

alter table public.quiz_attempts
alter column score type numeric(5,2) using score::numeric;

update public.quiz_attempts
set group_name = 'Chưa phân nhóm'
where group_name is null or trim(group_name) = '';

update public.quiz_attempts
set mode = case
  when mode is null or trim(mode) = '' then 'mock'
  when mode = 'exam' then 'mock'
  else mode
end
where mode is null or trim(mode) = '' or mode = 'exam';

update public.quiz_attempts
set started_at = submitted_at
where started_at is null;

update public.quiz_attempts
set
  bank_question_count = coalesce(bank_question_count, total_questions),
  multi_correct_count = coalesce(multi_correct_count, 0),
  multi_similarity_score = coalesce(multi_similarity_score, 0),
  timer_seconds = coalesce(timer_seconds, 0),
  knowledge_score = coalesce(knowledge_score, least(score, 75)),
  coverage_score = coalesce(coverage_score, 0),
  duration_score = coalesce(duration_score, 0),
  punctuality_score = coalesce(punctuality_score, 0);

alter table public.quiz_attempts
alter column group_name set not null,
alter column mode set default 'mock',
alter column mode set not null,
alter column started_at set default now(),
alter column started_at set not null,
alter column bank_question_count set not null,
alter column multi_correct_count set default 0,
alter column multi_correct_count set not null,
alter column multi_similarity_score set default 0,
alter column multi_similarity_score set not null,
alter column timer_seconds set default 0,
alter column timer_seconds set not null,
alter column knowledge_score set default 0,
alter column knowledge_score set not null,
alter column coverage_score set default 0,
alter column coverage_score set not null,
alter column duration_score set default 0,
alter column duration_score set not null,
alter column punctuality_score set default 0,
alter column punctuality_score set not null;

alter table public.quiz_attempts
add constraint quiz_attempts_mode_check
check (mode in ('mock', 'practice', 'real'));

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

notify pgrst, 'reload schema';
