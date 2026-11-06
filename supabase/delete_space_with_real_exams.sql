-- UP: Cho phép superadmin xóa Space đã có Đợt thi thật.
--
-- Trước đây real_exams.space_id (on delete restrict) chặn xóa mọi Space có Đợt thi thật,
-- và delete_space_cascade không dọn dữ liệu Thi thật. Phiên bản mới xóa theo đúng thứ tự
-- khóa ngoại: kết quả -> session -> snapshot/refs/sources của revision -> revision
-- -> nguồn/refs của đợt thi -> đợt thi -> Space (Group, Ngân hàng, câu hỏi cascade).
--
-- An toàn:
--   * chỉ superadmin; slug xác nhận phải khớp;
--   * từ chối nếu còn Đợt thi đang diễn ra (đang chạy, trong khung giờ, chưa kết thúc);
--   * mã đợt thi (real_exam_code_registry) và mã câu hỏi (question_code_registry) được
--     giữ lại để không bao giờ cấp lại mã cũ.
-- Dữ liệu bị xóa vĩnh viễn: hãy xuất kết quả Thi thật / tạo backup trước khi xóa.
--
-- Thứ tự áp dụng: chạy file này (idempotent), sau đó phát hành admin
-- (npm run version:bump && npm run build). Không cần deploy Edge Function.

begin;

create or replace function public.delete_space_cascade(
  requested_space_id bigint,
  requested_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actual_slug text;
  exam_ids bigint[];
  revision_ids bigint[];
  deleted_attempts integer := 0;
  deleted_real_exams integer := 0;
  deleted_groups integer := 0;
  deleted_question_sets integer := 0;
  deleted_questions integer := 0;
begin
  if not public.is_superadmin() then
    raise exception 'Chỉ superadmin được xóa Space.';
  end if;

  select s.slug into actual_slug
  from public.spaces s
  where s.id = requested_space_id
  for update;

  if actual_slug is null then
    raise exception 'Space không tồn tại.';
  end if;
  if requested_slug is distinct from actual_slug then
    raise exception 'Slug xác nhận không khớp.';
  end if;

  if exists (
    select 1
    from public.real_exams exam
    where exam.space_id = requested_space_id
      and exam.hidden_at is null
      and exam.ended_at is null
      and exam.manual_running
      and now() between exam.start_at and exam.end_at
  ) then
    raise exception 'Space đang có Đợt thi thật diễn ra. Hãy tạm dừng hoặc kết thúc đợt thi trước khi xóa Space.';
  end if;

  perform 1 from public.real_exams exam where exam.space_id = requested_space_id for update;

  select coalesce(array_agg(exam.id), '{}')
  into exam_ids
  from public.real_exams exam
  where exam.space_id = requested_space_id;

  select coalesce(array_agg(revision.id), '{}')
  into revision_ids
  from public.real_exam_revisions revision
  where revision.real_exam_id = any(exam_ids);

  select count(*) into deleted_groups from public.groups where space_id = requested_space_id;
  select count(*) into deleted_question_sets from public.question_sets where space_id = requested_space_id;
  select count(*) into deleted_questions from public.questions where space_id = requested_space_id;
  deleted_real_exams := cardinality(exam_ids);

  -- 1. Kết quả và session làm bài (Thi thử + Thi thật).
  delete from public.quiz_attempts
  where space_slug = actual_slug
     or real_exam_id = any(exam_ids)
     or real_exam_revision_id = any(revision_ids);
  get diagnostics deleted_attempts = row_count;

  delete from public.quiz_attempt_sessions
  where space_id = requested_space_id
     or real_exam_id = any(exam_ids);

  -- 2. Revision và dữ liệu bất biến của revision.
  update public.real_exams
  set current_revision_id = null
  where id = any(exam_ids);

  delete from public.real_exam_revision_question_snapshots where revision_id = any(revision_ids);
  delete from public.real_exam_revision_question_refs where revision_id = any(revision_ids);
  delete from public.real_exam_revision_sources where revision_id = any(revision_ids);
  delete from public.real_exam_revisions where id = any(revision_ids);

  -- 3. Đợt thi thật.
  delete from public.real_exam_question_refs where real_exam_id = any(exam_ids);
  delete from public.real_exam_sources where real_exam_id = any(exam_ids);
  delete from public.real_exams where id = any(exam_ids);

  -- 4. Space; Group, Ngân hàng câu hỏi, câu hỏi và space_admins xóa theo cascade.
  delete from public.spaces where id = requested_space_id;

  return jsonb_build_object(
    'ok', true,
    'space_slug', actual_slug,
    'quiz_attempts_deleted', deleted_attempts,
    'real_exams_deleted', deleted_real_exams,
    'groups_deleted', deleted_groups,
    'question_sets_deleted', deleted_question_sets,
    'questions_deleted', deleted_questions
  );
end;
$$;

revoke all on function public.delete_space_cascade(bigint, text) from public, anon;
grant execute on function public.delete_space_cascade(bigint, text) to authenticated;

commit;

notify pgrst, 'reload schema';
