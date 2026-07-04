create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  space_slug text not null,
  student_name text not null,
  student_name_key text not null,
  group_name text not null,
  mode text not null default 'mock' check (mode in ('mock', 'practice', 'real')),
  score numeric(5,2) not null check (score between 0 and 100),
  total_questions integer not null check (total_questions > 0),
  bank_question_count integer not null check (bank_question_count > 0),
  correct_count integer not null check (correct_count >= 0),
  wrong_count integer not null check (wrong_count >= 0),
  multi_correct_count integer not null default 0 check (multi_correct_count >= 0),
  multi_similarity_score numeric(8,2) not null default 0 check (multi_similarity_score >= 0),
  duration_seconds integer not null check (duration_seconds >= 0),
  timer_seconds integer not null default 0 check (timer_seconds >= 0),
  knowledge_score numeric(5,2) not null default 0 check (knowledge_score between 0 and 75),
  coverage_score numeric(5,2) not null default 0 check (coverage_score between 0 and 10),
  duration_score numeric(5,2) not null default 0 check (duration_score between 0 and 10),
  punctuality_score numeric(5,2) not null default 0 check (punctuality_score between 0 and 5),
  started_at timestamptz not null default now(),
  submitted_at timestamptz not null default now()
);

alter table public.quiz_attempts
add column if not exists group_name text;

update public.quiz_attempts
set group_name = 'Chưa phân nhóm'
where group_name is null;

alter table public.quiz_attempts
alter column group_name set not null;

alter table public.quiz_attempts
add column if not exists started_at timestamptz;

update public.quiz_attempts
set started_at = submitted_at
where started_at is null;

alter table public.quiz_attempts
alter column started_at set default now(),
alter column started_at set not null;

create index if not exists quiz_attempts_space_submitted_idx
on public.quiz_attempts (space_slug, submitted_at desc);

alter table public.quiz_attempts enable row level security;

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

-- Optional cleanup. Run manually, or schedule with Supabase Cron.
delete from public.quiz_attempts
where submitted_at < now() - interval '7 days';

delete from public.quiz_attempts
where id in (
  select id
  from public.quiz_attempts
  order by submitted_at desc
  offset 1000
);
