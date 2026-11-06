-- UP: Các sửa đổi bảo mật/nghiệp vụ sau review (2026-11).
--
--   1. Thu hồi quyền EXECUTE của anon/authenticated trên các hàm nội bộ `*_unchecked`,
--      allocate_*, replace_real_exam_sources, sync_app_sequences. Supabase grant EXECUTE
--      trực tiếp cho anon/authenticated theo default privileges, nên `revoke ... from public`
--      trong các script cũ là chưa đủ. Các hàm này vẫn chạy bình thường khi được gọi từ hàm
--      security definer (chạy với quyền owner).
--   2. Câu hỏi thuộc đề của Đợt thi thật chưa kết thúc (đã lên lịch hoặc đang diễn ra) bị ẩn
--      khỏi Luyện tập/Thi thử: anon không đọc được, Edge Function không trả đáp án.
--   3. quiz_attempts: anon chỉ đọc kết quả Thi thử 30 ngày của Space đã publish và chỉ các
--      cột bảng xếp hạng cần; admin đọc kết quả của Space mình quản lý.
--   4. get_real_exam_attempt_count đếm cả session đã bắt đầu (khớp với server).
--   5. Tự dọn session Thi thử cũ (thay cho việc phải tự lên lịch purge).
--
-- Thứ tự áp dụng:
--   1. Chạy script này (idempotent) trong Supabase SQL editor.
--   2. Deploy Edge Functions quiz-attempt và quiz-evaluate.
--   3. Phát hành frontend + admin (npm run version:bump && npm run build).

begin;

-- ---------------------------------------------------------------------------
-- 1. Hàm nội bộ: chỉ owner/service role được gọi.
-- ---------------------------------------------------------------------------
do $$
declare
  target regprocedure;
begin
  for target in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        p.proname like '%\_unchecked'
        or p.proname in (
          'allocate_question_code',
          'allocate_real_exam_code',
          'replace_real_exam_sources',
          'sync_app_sequences',
          'purge_stale_quiz_attempt_sessions',
          'start_quiz_attempt_session',
          'consume_rate_limit'
        )
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', target);
    execute format('grant execute on function %s to service_role', target);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Câu hỏi đang bị khóa bởi Đợt thi thật chưa kết thúc.
-- ---------------------------------------------------------------------------
create index if not exists real_exam_question_refs_code_idx
on public.real_exam_question_refs (question_code);

create index if not exists real_exam_revision_question_refs_code_idx
on public.real_exam_revision_question_refs (question_code);

-- True khi câu hỏi nằm trong đề hiện tại của một Đợt thi thật chưa kết thúc và chưa ẩn.
create or replace function public.is_question_locked_by_real_exam(target_question_code integer)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_question_code is not null and exists (
    select 1
    from public.real_exams exam
    where exam.hidden_at is null
      and exam.ended_at is null
      and now() <= exam.end_at
      and (
        exists (
          select 1 from public.real_exam_question_refs ref
          where ref.real_exam_id = exam.id and ref.question_code = target_question_code
        )
        or exists (
          select 1 from public.real_exam_revision_question_refs ref
          where ref.revision_id = exam.current_revision_id
            and ref.question_code = target_question_code
        )
      )
  );
$$;

-- Mã câu hỏi đang bị khóa trong một Space (Edge Function dùng để lọc ngân hàng).
create or replace function public.list_real_exam_locked_question_codes(target_space_id bigint)
returns setof integer
language sql
stable
security definer
set search_path = public
as $$
  select ref.question_code
  from public.real_exams exam
  join public.real_exam_question_refs ref on ref.real_exam_id = exam.id
  where exam.space_id = target_space_id
    and exam.hidden_at is null
    and exam.ended_at is null
    and now() <= exam.end_at
  union
  select ref.question_code
  from public.real_exams exam
  join public.real_exam_revision_question_refs ref on ref.revision_id = exam.current_revision_id
  where exam.space_id = target_space_id
    and exam.hidden_at is null
    and exam.ended_at is null
    and now() <= exam.end_at;
$$;

-- Policy của anon gọi hàm này nên anon/authenticated cần quyền EXECUTE.
revoke all on function public.is_question_locked_by_real_exam(integer) from public;
grant execute on function public.is_question_locked_by_real_exam(integer) to anon, authenticated, service_role;
revoke all on function public.list_real_exam_locked_question_codes(bigint) from public, anon, authenticated;
grant execute on function public.list_real_exam_locked_question_codes(bigint) to service_role;

drop policy if exists "questions public read published" on public.questions;
create policy "questions public read published"
on public.questions for select to anon
using (
  hidden_at is null
  and exists (select 1 from public.spaces space where space.id = space_id and space.published)
  and not public.is_question_locked_by_real_exam(question_code)
);

-- ---------------------------------------------------------------------------
-- 3. Quyền đọc quiz_attempts.
-- ---------------------------------------------------------------------------
create or replace function public.is_published_space_slug(target_slug text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.spaces s where s.slug = target_slug and s.published);
$$;

create or replace function public.can_manage_space_slug(target_slug text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.spaces s where s.slug = target_slug and public.can_manage_space(s.id)
  );
$$;

revoke all on function public.is_published_space_slug(text) from public;
grant execute on function public.is_published_space_slug(text) to anon, authenticated;
revoke all on function public.can_manage_space_slug(text) from public, anon;
grant execute on function public.can_manage_space_slug(text) to authenticated;

drop policy if exists "allow public read recent quiz attempts" on public.quiz_attempts;
drop policy if exists "quiz attempts public read recent mock" on public.quiz_attempts;
drop policy if exists "quiz attempts authenticated read" on public.quiz_attempts;

create policy "quiz attempts public read recent mock"
on public.quiz_attempts for select to anon
using (
  mode = 'mock'
  and submitted_at >= now() - interval '30 days'
  and public.is_published_space_slug(space_slug)
);

-- Trình duyệt đang đăng nhập admin dùng chung session với trang làm bài (cùng origin),
-- nên giữ quyền xem bảng xếp hạng Thi thử công khai cho authenticated.
create policy "quiz attempts authenticated read"
on public.quiz_attempts for select to authenticated
using (
  (
    mode = 'mock'
    and submitted_at >= now() - interval '30 days'
    and public.is_published_space_slug(space_slug)
  )
  or public.can_manage_space_slug(space_slug)
);

revoke all on public.quiz_attempts from anon;
grant select (
  id, space_slug, real_exam_code, student_name, student_name_key, group_name, mode, score,
  total_questions, correct_count, wrong_count, duration_seconds, started_at, submitted_at
) on public.quiz_attempts to anon;
revoke insert, update, delete on public.quiz_attempts from authenticated;

-- ---------------------------------------------------------------------------
-- 4. Số lượt Thi thật đã dùng = max(session đã bắt đầu, kết quả đã lưu), như server.
-- ---------------------------------------------------------------------------
create or replace function public.get_real_exam_attempt_count(
  requested_code integer,
  requested_student_name text
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select exam.current_revision_id as revision_id,
      lower(trim(regexp_replace(coalesce(requested_student_name, ''), '\s+', ' ', 'g'))) as name_key
    from public.real_exams exam
    where exam.code = requested_code
  )
  select greatest(
    coalesce((
      select count(*)::integer
      from public.quiz_attempt_sessions started, target
      where started.mode = 'real'
        and started.real_exam_revision_id = target.revision_id
        and started.student_name_key = target.name_key
    ), 0),
    coalesce((
      select count(*)::integer
      from public.quiz_attempts attempt, target
      where attempt.mode = 'real'
        and attempt.real_exam_revision_id = target.revision_id
        and attempt.student_name_key = target.name_key
    ), 0)
  );
$$;

revoke all on function public.get_real_exam_attempt_count(integer, text) from public;
grant execute on function public.get_real_exam_attempt_count(integer, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Dọn session Thi thử cũ hơn 2 ngày một cách ngẫu nhiên khi có lượt mới bắt đầu.
-- ---------------------------------------------------------------------------
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

    select count(*)::integer into used_attempts
    from public.quiz_attempts a
    where a.mode = 'real'
      and a.real_exam_revision_id = p_real_exam_revision_id
      and a.student_name_key = p_student_name_key;

    if greatest(used_sessions, used_attempts) >= p_max_attempts then
      raise exception 'Bạn đã hết số lượt thi.' using errcode = 'P0001';
    end if;
  elsif random() < 0.01 then
    perform public.purge_stale_quiz_attempt_sessions();
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

commit;

notify pgrst, 'reload schema';
