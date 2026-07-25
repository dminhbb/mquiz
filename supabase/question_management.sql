-- Question-level management for Cloud Admin.
-- Run after archive_lifecycle.sql and real_exam_rebuild.sql.

begin;

create or replace function public.archive_question(target_question_id bigint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare target_question public.questions%rowtype;
begin
  select * into target_question from public.questions where id = target_question_id for update;
  if not found or target_question.hidden_at is not null then
    raise exception 'Câu hỏi không tồn tại hoặc đã được lưu trữ.';
  end if;
  if not public.can_manage_space(target_question.space_id) then
    raise exception 'Bạn không có quyền quản lý Space này.';
  end if;
  if exists (
    select 1
    from public.real_exams exam
    join public.real_exam_sources source on source.real_exam_id = exam.id
    where source.question_set_id = target_question.question_set_id
      and exam.hidden_at is null and exam.manual_running and exam.ended_at is null
      and now() between exam.start_at and exam.end_at
  ) then
    raise exception 'Không thể xóa câu hỏi khi ngân hàng đang là nguồn của Đợt thi thật diễn ra.';
  end if;

  update public.questions
  set hidden_at = now(), hidden_by = auth.uid(), permanent_hidden = true,
      purge_after = now() + interval '30 days', archived_reason = 'single_question_archive'
  where id = target_question_id;

  return jsonb_build_object('id', target_question_id, 'archived', true);
end;
$$;

create or replace function public.archive_questions(target_question_ids bigint[])
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  target_count integer;
  archived_count integer;
begin
  select count(distinct id) into target_count
  from unnest(target_question_ids) as input(id);
  if target_count = 0 then
    raise exception 'Hãy chọn ít nhất một câu hỏi.';
  end if;

  if (select count(*) from public.questions where id = any(target_question_ids) and hidden_at is null) <> target_count then
    raise exception 'Một hoặc nhiều câu hỏi không còn tồn tại hoặc đã được lưu trữ.';
  end if;
  if exists (
    select 1 from public.questions question
    where question.id = any(target_question_ids)
      and not public.can_manage_space(question.space_id)
  ) then
    raise exception 'Bạn không có quyền quản lý một hoặc nhiều câu hỏi đã chọn.';
  end if;
  if exists (
    select 1
    from public.questions question
    join public.real_exam_sources source on source.question_set_id = question.question_set_id
    join public.real_exams exam on exam.id = source.real_exam_id
    where question.id = any(target_question_ids)
      and exam.hidden_at is null and exam.manual_running and exam.ended_at is null
      and now() between exam.start_at and exam.end_at
  ) then
    raise exception 'Không thể xóa câu hỏi khi ngân hàng đang là nguồn của Đợt thi thật diễn ra.';
  end if;

  update public.questions
  set hidden_at = now(), hidden_by = auth.uid(), permanent_hidden = true,
      purge_after = now() + interval '30 days', archived_reason = 'bulk_question_archive'
  where id = any(target_question_ids) and hidden_at is null;
  get diagnostics archived_count = row_count;

  return jsonb_build_object('archived_questions', archived_count);
end;
$$;

-- Editing question content must also request a rebuild of stopped real-exam sources.
drop trigger if exists questions_mark_real_exam_rebuild on public.questions;
create trigger questions_mark_real_exam_rebuild
after insert or update of hidden_at, type, content, options_json, correct_json, question_set_id or delete
on public.questions
for each row execute function public.mark_real_exam_needs_rebuild_from_question();

revoke all on function public.archive_question(bigint) from public;
grant execute on function public.archive_question(bigint) to authenticated;
revoke all on function public.archive_questions(bigint[]) from public;
grant execute on function public.archive_questions(bigint[]) to authenticated;
notify pgrst, 'reload schema';
commit;
