-- UP: Server-side attempt sessions, server-side scoring support and API rate limiting.
--
-- Apply order for this change:
--   1. Run this script in the Supabase SQL editor.
--   2. Deploy Edge Functions: npm run deploy:quiz-attempt && npm run deploy:quiz-evaluate
--   3. Publish the frontend (npm run version:bump && npm run build).
-- Applying step 1 BEFORE the frontend is published makes old browsers fail to save results
-- (direct inserts into quiz_attempts are revoked), so do steps 1-3 in one maintenance window.
--
-- Rollback: supabase/rollback_server_side_attempt_scoring.sql

begin;

-- ---------------------------------------------------------------------------
-- 1. Attempt sessions: the server fixes started_at, the question list and the
--    scoring parameters when an attempt starts, so none of them can be forged
--    when the attempt is submitted.
-- ---------------------------------------------------------------------------
create table if not exists public.quiz_attempt_sessions (
  id uuid primary key default gen_random_uuid(),
  space_id bigint not null references public.spaces(id) on delete cascade,
  space_slug text not null,
  mode text not null check (mode in ('mock', 'real')),
  real_exam_id bigint references public.real_exams(id) on delete cascade,
  real_exam_code integer,
  real_exam_revision_id bigint,
  student_name text not null check (char_length(student_name) between 1 and 80),
  student_name_key text not null check (char_length(student_name_key) between 1 and 80),
  group_name text not null check (char_length(group_name) between 1 and 120),
  question_ids bigint[] not null check (cardinality(question_ids) between 1 and 500),
  bank_question_count integer not null check (bank_question_count >= 1),
  timer_seconds integer not null check (timer_seconds between 1 and 600),
  scoring_method integer not null check (scoring_method in (1, 2)),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text not null default 'pending' check (outcome in ('pending', 'saved', 'abandoned')),
  quiz_attempt_id uuid,
  check (mode <> 'real' or real_exam_id is not null)
);

-- Counts the attempts a student has used in a real exam revision.
create index if not exists quiz_attempt_sessions_real_usage_idx
on public.quiz_attempt_sessions (real_exam_revision_id, student_name_key)
where mode = 'real';

create index if not exists quiz_attempt_sessions_started_idx
on public.quiz_attempt_sessions (started_at);

-- Only the service role (Edge Functions) touches this table: RLS on, no policies.
alter table public.quiz_attempt_sessions enable row level security;
revoke all on public.quiz_attempt_sessions from public, anon, authenticated;

-- Creates a session atomically. For real exams the per-student attempt limit is
-- checked under an advisory lock, so parallel requests cannot exceed it. An attempt
-- is "used" as soon as it starts (abandoning or reloading consumes it).
create or replace function public.start_quiz_attempt_session(
  p_space_id bigint,
  p_space_slug text,
  p_mode text,
  p_real_exam_id bigint,
  p_real_exam_code integer,
  p_real_exam_revision_id bigint,
  p_student_name text,
  p_student_name_key text,
  p_group_name text,
  p_question_ids bigint[],
  p_bank_question_count integer,
  p_timer_seconds integer,
  p_scoring_method integer,
  p_max_attempts integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  used_sessions integer;
  used_attempts integer;
  created_session public.quiz_attempt_sessions%rowtype;
begin
  if p_mode = 'real' then
    perform pg_advisory_xact_lock(
      hashtextextended('quiz-attempts:' || p_real_exam_revision_id::text || ':' || p_student_name_key, 0)
    );

    select count(*)::integer into used_sessions
    from public.quiz_attempt_sessions s
    where s.mode = 'real'
      and s.real_exam_revision_id = p_real_exam_revision_id
      and s.student_name_key = p_student_name_key;

    -- Attempts saved before sessions existed have no session row.
    select count(*)::integer into used_attempts
    from public.quiz_attempts a
    where a.mode = 'real'
      and a.real_exam_revision_id = p_real_exam_revision_id
      and a.student_name_key = p_student_name_key;

    if greatest(used_sessions, used_attempts) >= p_max_attempts then
      raise exception 'Bạn đã hết số lượt thi.' using errcode = 'P0001';
    end if;
  end if;

  insert into public.quiz_attempt_sessions (
    space_id, space_slug, mode, real_exam_id, real_exam_code, real_exam_revision_id,
    student_name, student_name_key, group_name, question_ids,
    bank_question_count, timer_seconds, scoring_method
  )
  values (
    p_space_id, p_space_slug, p_mode, p_real_exam_id, p_real_exam_code, p_real_exam_revision_id,
    p_student_name, p_student_name_key, p_group_name, p_question_ids,
    p_bank_question_count, p_timer_seconds, p_scoring_method
  )
  returning * into created_session;

  return jsonb_build_object('id', created_session.id, 'started_at', created_session.started_at);
end;
$$;

revoke all on function public.start_quiz_attempt_session(
  bigint, text, text, bigint, integer, bigint, text, text, text, bigint[], integer, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.start_quiz_attempt_session(
  bigint, text, text, bigint, integer, bigint, text, text, text, bigint[], integer, integer, integer, integer
) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Fixed-window rate limiter used by the Edge Functions (service role only).
-- ---------------------------------------------------------------------------
create table if not exists public.api_rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key (bucket, window_start)
);

alter table public.api_rate_limits enable row level security;
revoke all on public.api_rate_limits from public, anon, authenticated;

create or replace function public.consume_rate_limit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_window timestamptz;
  used_count integer;
begin
  if p_bucket is null or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate limit arguments';
  end if;

  current_window := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.api_rate_limits as limits (bucket, window_start, request_count)
  values (p_bucket, current_window, 1)
  on conflict (bucket, window_start)
  do update set request_count = limits.request_count + 1
  returning limits.request_count into used_count;

  -- Opportunistic cleanup keeps the table small without a scheduled job.
  if random() < 0.01 then
    delete from public.api_rate_limits where window_start < now() - interval '1 day';
  end if;

  return used_count <= p_limit;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

-- Removes finished or abandoned mock sessions older than two days. Real-exam
-- sessions are kept: they are the audit trail for attempt usage.
create or replace function public.purge_stale_quiz_attempt_sessions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.quiz_attempt_sessions
  where mode = 'mock'
    and started_at < now() - interval '2 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.purge_stale_quiz_attempt_sessions() from public, anon, authenticated;
grant execute on function public.purge_stale_quiz_attempt_sessions() to service_role;

-- ---------------------------------------------------------------------------
-- 3. Results can no longer be inserted directly by browsers. Edge Function
--    quiz-attempt (service role) is the only writer of quiz_attempts.
-- ---------------------------------------------------------------------------
drop policy if exists "allow public insert quiz attempts" on public.quiz_attempts;
revoke insert on public.quiz_attempts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The leaderboard UI shows the last 30 days of mock results; the original
--    policy only exposed 7 days. Align the policy with the documented range.
-- ---------------------------------------------------------------------------
drop policy if exists "allow public read recent quiz attempts" on public.quiz_attempts;
create policy "allow public read recent quiz attempts"
on public.quiz_attempts
for select
to anon, authenticated
using (
  submitted_at >= now() - interval '30 days'
);

commit;

notify pgrst, 'reload schema';
