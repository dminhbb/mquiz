-- Rebuild-on-start lifecycle. Run after archive_lifecycle.sql.
begin;

alter table public.real_exams
  add column if not exists needs_rebuild boolean not null default false,
  add column if not exists last_built_at timestamptz,
  add column if not exists build_no integer not null default 0;

-- Any change to a configured source makes a future Start rebuild the current proposal.
create or replace function public.mark_real_exam_needs_rebuild_from_source()
returns trigger language plpgsql security definer set search_path = public as $$
declare exam_id bigint := coalesce(new.real_exam_id, old.real_exam_id);
begin
  update public.real_exams set needs_rebuild = true, updated_at = now() where id = exam_id;
  return coalesce(new, old);
end;
$$;

drop trigger if exists real_exam_sources_mark_rebuild on public.real_exam_sources;
create trigger real_exam_sources_mark_rebuild
after insert or update or delete on public.real_exam_sources
for each row execute function public.mark_real_exam_needs_rebuild_from_source();

create or replace function public.mark_real_exam_needs_rebuild_from_question()
returns trigger language plpgsql security definer set search_path = public as $$
declare set_id bigint := coalesce(new.question_set_id, old.question_set_id);
begin
  update public.real_exams exam
  set needs_rebuild = true, updated_at = now()
  from public.real_exam_sources source
  where source.real_exam_id = exam.id
    and source.question_set_id = set_id
    and exam.hidden_at is null;

  return coalesce(new, old);
end;
$$;

drop trigger if exists questions_mark_real_exam_rebuild on public.questions;
create trigger questions_mark_real_exam_rebuild
after insert or update of hidden_at or delete on public.questions
for each row execute function public.mark_real_exam_needs_rebuild_from_question();

create or replace function public.detach_archived_question_set_from_stopped_exams()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.hidden_at is not null and old.hidden_at is null then
    delete from public.real_exam_sources source
    using public.real_exams exam
    where source.real_exam_id = exam.id and source.question_set_id = new.id
      and exam.hidden_at is null and not exam.manual_running;
  end if;
  return new;
end;
$$;

drop trigger if exists question_sets_detach_stopped_real_exam_sources on public.question_sets;
create trigger question_sets_detach_stopped_real_exam_sources
after update of hidden_at on public.question_sets
for each row execute function public.detach_archived_question_set_from_stopped_exams();

-- Creating a revision is the atomic signal that a new question snapshot was built.
create or replace function public.mark_real_exam_rebuild_complete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.real_exams
  set needs_rebuild = false, last_built_at = now(), build_no = build_no + 1, updated_at = now()
  where id = new.real_exam_id;
  return new;
end;
$$;

drop trigger if exists real_exam_revisions_mark_rebuild_complete on public.real_exam_revisions;
create trigger real_exam_revisions_mark_rebuild_complete
after insert on public.real_exam_revisions
for each row execute function public.mark_real_exam_rebuild_complete();

create or replace function public.set_real_exam_running(target_real_exam_id bigint, should_run boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare target_exam public.real_exams%rowtype; generated_count integer; revision_id bigint;
begin
  select * into target_exam from public.real_exams where id = target_real_exam_id for update;
  if not found or not public.can_manage_space(target_exam.space_id) then
    raise exception 'Không có quyền quản lý Đợt thi thật này.';
  end if;
  if target_exam.hidden_at is not null then raise exception 'Đợt thi thật đã được lưu trữ.'; end if;
  if coalesce(should_run, false) and target_exam.end_at <= now() then
    raise exception 'Hãy điều chỉnh thời gian kết thúc Đợt thi.';
  end if;

  if coalesce(should_run, false) and target_exam.needs_rebuild then
    if not exists (select 1 from public.real_exam_sources where real_exam_id = target_real_exam_id) then
      raise exception 'Đợt thi cần build lại nhưng hiện không còn nguồn câu hỏi. Hãy cấu hình nguồn trước khi Start.';
    end if;
    if exists (
      select 1
      from public.real_exam_sources source
      left join public.question_sets set_row
        on set_row.id = source.question_set_id and set_row.hidden_at is null
      left join public.questions question
        on question.question_set_id = source.question_set_id and question.hidden_at is null
      where source.real_exam_id = target_real_exam_id
      group by source.question_set_id, set_row.id
      having set_row.id is null or count(question.id) = 0
    ) then
      raise exception 'Đợt thi chưa thể Start vì có nguồn câu hỏi đã lưu trữ hoặc không còn câu hỏi. Hãy vào Quản lý Đợt thi để chọn nguồn có ít nhất một câu hỏi.';
    end if;
    generated_count := public.generate_real_exam_snapshot_unchecked(target_real_exam_id);
    revision_id := public.create_real_exam_revision_unchecked(target_real_exam_id);
  end if;

  update public.real_exams
  set manual_running = coalesce(should_run, false),
      ended_at = case when coalesce(should_run, false) then null else ended_at end,
      updated_at = now()
  where id = target_real_exam_id
  returning * into target_exam;
  return to_jsonb(target_exam) || jsonb_build_object(
    'status', public.real_exam_status(target_exam),
    'rebuilt', revision_id is not null,
    'question_count', generated_count,
    'current_revision_id', coalesce(revision_id, target_exam.current_revision_id)
  );
end;
$$;

-- Expose rebuild state in admin detail/list responses without exposing it publicly.
create or replace function public.get_real_exam_admin(target_real_exam_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare target_exam public.real_exams%rowtype;
begin
  select * into target_exam from public.real_exams where id = target_real_exam_id;
  if not found or not public.can_manage_space(target_exam.space_id) then raise exception 'Không có quyền quản lý Đợt thi thật này.'; end if;
  return to_jsonb(target_exam) || jsonb_build_object(
    'status', public.real_exam_status(target_exam),
    'current_revision_no', (select revision_no from public.real_exam_revisions where id = target_exam.current_revision_id),
    'question_count', (select count(*) from public.real_exam_question_refs where real_exam_id = target_real_exam_id),
    'result_count', (select count(*) from public.quiz_attempts where real_exam_id = target_real_exam_id),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('id', source.question_set_id, 'name', source.question_set_name, 'percent', source.percent, 'active_question_count', (select count(*) from public.questions question where question.question_set_id = source.question_set_id and question.hidden_at is null)) order by source.question_set_name) from public.real_exam_sources source where source.real_exam_id = target_real_exam_id), '[]'::jsonb),
    'rebuild_validation', jsonb_build_object(
      'has_sources', exists(select 1 from public.real_exam_sources source where source.real_exam_id = target_real_exam_id),
      'has_empty_source', exists(select 1 from public.real_exam_sources source left join public.question_sets set_row on set_row.id = source.question_set_id and set_row.hidden_at is null left join public.questions question on question.question_set_id = source.question_set_id and question.hidden_at is null where source.real_exam_id = target_real_exam_id group by source.question_set_id, set_row.id having set_row.id is null or count(question.id) = 0)
    ),
    'revisions', coalesce((select jsonb_agg(jsonb_build_object('id', revision.id, 'revision_no', revision.revision_no, 'start_at', revision.start_at, 'end_at', revision.end_at, 'question_count', (select count(*) from public.real_exam_revision_question_refs ref where ref.revision_id = revision.id), 'result_count', (select count(*) from public.quiz_attempts attempt where attempt.real_exam_revision_id = revision.id)) order by revision.revision_no desc) from public.real_exam_revisions revision where revision.real_exam_id = target_real_exam_id), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.set_real_exam_running(bigint, boolean) from public;
grant execute on function public.set_real_exam_running(bigint, boolean) to authenticated;
revoke all on function public.get_real_exam_admin(bigint) from public;
grant execute on function public.get_real_exam_admin(bigint) to authenticated;
notify pgrst, 'reload schema';
commit;
