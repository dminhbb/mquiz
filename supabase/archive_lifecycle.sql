-- Archive lifecycle for question banks, questions, and real exams.
-- Run after real_exam_revisions.sql and add_permanent_hidden.sql.
-- This migration is non-destructive: it first materializes immutable revision snapshots.

begin;

create table if not exists public.real_exam_revision_question_snapshots (
  revision_id bigint not null references public.real_exam_revisions(id) on delete restrict,
  question_code integer not null,
  generated_order integer not null,
  type text not null check (type in ('single', 'multi')),
  content text not null,
  options_json jsonb not null,
  correct_json jsonb not null,
  captured_at timestamptz not null default now(),
  primary key (revision_id, question_code),
  unique (revision_id, generated_order)
);

create index if not exists real_exam_revision_question_snapshots_revision_idx
on public.real_exam_revision_question_snapshots(revision_id, generated_order);

alter table public.question_sets
  add column if not exists purge_after timestamptz,
  add column if not exists archived_reason text;
alter table public.questions
  add column if not exists purge_after timestamptz,
  add column if not exists archived_reason text;
alter table public.real_exams
  add column if not exists archived_reason text;

-- Backfill immutable content for every existing revision before allowing any purge.
insert into public.real_exam_revision_question_snapshots (
  revision_id, question_code, generated_order, type, content, options_json, correct_json, captured_at
)
select ref.revision_id, ref.question_code, ref.generated_order,
       question.type, question.content, question.options_json, question.correct_json,
       coalesce(ref.created_at, now())
from public.real_exam_revision_question_refs ref
join public.questions question on question.question_code = ref.question_code
on conflict (revision_id, question_code) do nothing;

create or replace function public.archive_real_exam_revision_unchecked(
  target_real_exam_id bigint,
  target_revision_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.real_exam_revision_question_refs where revision_id = target_revision_id;

  insert into public.real_exam_revision_question_refs(revision_id, question_code, generated_order, created_at)
  select target_revision_id, ref.question_code, ref.generated_order, ref.created_at
  from public.real_exam_question_refs ref
  where ref.real_exam_id = target_real_exam_id;

  insert into public.real_exam_revision_question_snapshots(
    revision_id, question_code, generated_order, type, content, options_json, correct_json, captured_at
  )
  select target_revision_id, ref.question_code, ref.generated_order,
         question.type, question.content, question.options_json, question.correct_json, now()
  from public.real_exam_question_refs ref
  join public.questions question on question.question_code = ref.question_code
  where ref.real_exam_id = target_real_exam_id
  on conflict (revision_id, question_code) do nothing;
end;
$$;

-- Hiding an exam is an archive operation. Its source and revision-source audit trail must remain intact.
create or replace function public.hide_real_exam(target_real_exam_id bigint, confirmation_code integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare target_exam public.real_exams%rowtype;
begin
  select * into target_exam from public.real_exams where id = target_real_exam_id for update;
  if not found or not public.can_manage_space(target_exam.space_id) then
    raise exception 'Không có quyền quản lý Đợt thi thật này.';
  end if;
  if target_exam.ended_at is null and now() <= target_exam.end_at then
    raise exception 'Chỉ có thể lưu trữ Đợt thi thật đã kết thúc.';
  end if;
  if confirmation_code is distinct from target_exam.code then
    raise exception 'Mã xác nhận Đợt thi không chính xác.';
  end if;

  update public.real_exams
  set hidden_at = now(), hidden_by = auth.uid(), archived_reason = 'admin_archive', updated_at = now()
  where id = target_real_exam_id
  returning * into target_exam;
  return to_jsonb(target_exam);
end;
$$;

-- Existing RPC names are retained for clients, but now mean archive to a 30-day trash window.
create or replace function public.clear_question_set_questions(target_question_set_id bigint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare target_set public.question_sets%rowtype; changed_count integer;
begin
  select * into target_set from public.question_sets where id = target_question_set_id for update;
  if not found then raise exception 'Ngân hàng câu hỏi không tồn tại.'; end if;
  if not public.can_manage_space(target_set.space_id) then raise exception 'Bạn không có quyền quản lý Space này.'; end if;
  if exists (
    select 1 from public.real_exams exam join public.real_exam_sources source on source.real_exam_id = exam.id
    where source.question_set_id = target_question_set_id and exam.hidden_at is null
      and exam.manual_running and exam.ended_at is null and now() between exam.start_at and exam.end_at
  ) then raise exception 'Không thể lưu trữ câu hỏi khi đang là nguồn của Đợt thi thật diễn ra.'; end if;

  update public.questions
  set hidden_at = now(), hidden_by = auth.uid(), permanent_hidden = false,
      purge_after = now() + interval '30 days', archived_reason = 'bulk_archive'
  where question_set_id = target_question_set_id and hidden_at is null;
  get diagnostics changed_count = row_count;
  return jsonb_build_object('question_set_id', target_question_set_id, 'archived_questions', changed_count, 'purge_after', now() + interval '30 days');
end;
$$;

create or replace function public.delete_question_set_cascade(target_question_set_id bigint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare target_set public.question_sets%rowtype; set_count integer; changed_count integer;
begin
  select * into target_set from public.question_sets where id = target_question_set_id for update;
  if not found then raise exception 'Ngân hàng câu hỏi không tồn tại.'; end if;
  if not public.can_manage_space(target_set.space_id) then raise exception 'Bạn không có quyền quản lý Space này.'; end if;
  select count(*) into set_count from public.question_sets where space_id = target_set.space_id and hidden_at is null;
  if set_count <= 1 then raise exception 'Space phải có ít nhất một ngân hàng câu hỏi đang hoạt động.'; end if;
  if exists (
    select 1 from public.real_exams exam join public.real_exam_sources source on source.real_exam_id = exam.id
    where source.question_set_id = target_question_set_id and exam.hidden_at is null
      and exam.manual_running and exam.ended_at is null and now() between exam.start_at and exam.end_at
  ) then raise exception 'Không thể lưu trữ ngân hàng đang là nguồn của Đợt thi thật diễn ra.'; end if;

  update public.questions
  set hidden_at = now(), hidden_by = auth.uid(), permanent_hidden = false,
      purge_after = now() + interval '30 days', archived_reason = 'bank_archive'
  where question_set_id = target_question_set_id and hidden_at is null;
  get diagnostics changed_count = row_count;
  update public.question_sets
  set hidden_at = now(), hidden_by = auth.uid(), purge_after = now() + interval '30 days', archived_reason = 'admin_archive'
  where id = target_question_set_id;
  return jsonb_build_object('id', target_question_set_id, 'name', target_set.name, 'archived_questions', changed_count, 'purge_after', now() + interval '30 days');
end;
$$;

create or replace function public.unhide_question_set(target_question_set_id bigint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare target_set public.question_sets%rowtype;
begin
  select * into target_set from public.question_sets where id = target_question_set_id for update;
  if not found then raise exception 'Ngân hàng câu hỏi không tồn tại.'; end if;
  if not public.can_manage_space(target_set.space_id) then raise exception 'Bạn không có quyền quản lý Space này.'; end if;
  update public.question_sets set hidden_at = null, hidden_by = null, purge_after = null, archived_reason = null where id = target_question_set_id;
  update public.questions set hidden_at = null, hidden_by = null, purge_after = null, archived_reason = null
  where question_set_id = target_question_set_id and hidden_at is not null and coalesce(purge_after, now()) > now();
  return jsonb_build_object('id', target_question_set_id, 'restored', true);
end;
$$;

-- Superadmin-only, irreversible cleanup. Snapshots preserve historic exam/revision content.
create or replace function public.purge_expired_question_trash(target_space_id bigint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare purged_questions integer; purged_sets integer;
begin
  if not public.is_superadmin() then raise exception 'Chỉ superadmin mới có quyền xóa vĩnh viễn dữ liệu trong Thùng rác.'; end if;
  delete from public.real_exam_revision_question_refs ref
  using public.questions question
  where ref.question_code = question.question_code and question.space_id = target_space_id
    and question.hidden_at is not null and question.purge_after <= now()
    and exists (select 1 from public.real_exam_revision_question_snapshots snap where snap.revision_id = ref.revision_id and snap.question_code = ref.question_code)
    and not exists (
      select 1 from public.real_exam_question_refs live_ref join public.real_exams live_exam on live_exam.id = live_ref.real_exam_id
      where live_ref.question_code = question.question_code
        and live_exam.hidden_at is null and live_exam.ended_at is null and now() <= live_exam.end_at
    );
  delete from public.real_exam_question_refs ref
  using public.questions question, public.real_exams exam
  where ref.question_code = question.question_code and ref.real_exam_id = exam.id and question.space_id = target_space_id
    and question.hidden_at is not null and question.purge_after <= now()
    and (exam.hidden_at is not null or exam.ended_at is not null or now() > exam.end_at);
  delete from public.questions question
  where question.space_id = target_space_id and question.hidden_at is not null and question.purge_after <= now()
    and not exists (select 1 from public.real_exam_question_refs ref where ref.question_code = question.question_code);
  get diagnostics purged_questions = row_count;
  delete from public.question_sets set_row
  where set_row.space_id = target_space_id and set_row.hidden_at is not null and set_row.purge_after <= now()
    and not exists (select 1 from public.questions q where q.question_set_id = set_row.id)
    and not exists (select 1 from public.real_exam_sources source where source.question_set_id = set_row.id);
  get diagnostics purged_sets = row_count;
  return jsonb_build_object('purged_questions', purged_questions, 'purged_question_sets', purged_sets);
end;
$$;

alter table public.real_exam_revision_question_snapshots enable row level security;
drop policy if exists "real exam revision snapshots admins read" on public.real_exam_revision_question_snapshots;
create policy "real exam revision snapshots admins read"
on public.real_exam_revision_question_snapshots for select to authenticated
using (exists (
  select 1 from public.real_exam_revisions revision join public.real_exams exam on exam.id = revision.real_exam_id
  where revision.id = real_exam_revision_question_snapshots.revision_id and public.can_manage_space(exam.space_id)
));

revoke delete on public.questions, public.question_sets from authenticated;
revoke all on function public.purge_expired_question_trash(bigint) from public;
grant execute on function public.purge_expired_question_trash(bigint) to authenticated;
grant select on public.real_exam_revision_question_snapshots to authenticated;
notify pgrst, 'reload schema';
commit;
