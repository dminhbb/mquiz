begin;

-- Add permanent_hidden column to public.questions
alter table public.questions add column if not exists permanent_hidden boolean not null default false;

-- Create or replace clear_question_set_questions to set permanent_hidden = true
create or replace function public.clear_question_set_questions(target_question_set_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_set public.question_sets%rowtype;
  target_space public.spaces%rowtype;
  deleted_question_count integer;
begin
  select *
  into target_set
  from public.question_sets
  where id = target_question_set_id
  for update;

  if not found then
    raise exception 'Ngân hàng câu hỏi không tồn tại.';
  end if;

  if not public.can_manage_space(target_set.space_id) then
    raise exception 'Bạn không có quyền quản lý Space này.';
  end if;

  select *
  into target_space
  from public.spaces
  where id = target_set.space_id
  for update;

  if exists (
    select 1
    from public.real_exams exam
    join public.real_exam_sources source on source.real_exam_id = exam.id
    where exam.space_id = target_set.space_id
      and source.question_set_id = target_question_set_id
      and exam.hidden_at is null
      and exam.ended_at is null
      and now() between exam.start_at and exam.end_at
  ) then
    raise exception 'Không thể xóa câu hỏi khi đang là nguồn của một Đợt thi thật đang diễn ra. Hãy chờ đợt thi kết thúc hoặc loại bỏ ngân hàng này khỏi cấu hình Đợt thi thật.';
  end if;

  select count(*)
  into deleted_question_count
  from public.questions
  where question_set_id = target_question_set_id
    and hidden_at is null;

  update public.questions
  set hidden_at = now(),
      hidden_by = auth.uid(),
      permanent_hidden = true
  where question_set_id = target_question_set_id
    and hidden_at is null;

  update public.spaces
  set updated_at = now()
  where id = target_set.space_id;

  return jsonb_build_object(
    'question_set_id', target_question_set_id,
    'name', target_set.name,
    'deleted_questions', deleted_question_count
  );
end;
$$;

-- Create or replace delete_question_set_cascade to check user role (superadmin vs admin)
create or replace function public.delete_question_set_cascade(target_question_set_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_set public.question_sets%rowtype;
  target_space public.spaces%rowtype;
  remaining_config jsonb;
  set_count integer;
  deleted_question_count integer;
begin
  select *
  into target_set
  from public.question_sets
  where id = target_question_set_id
  for update;

  if not found then
    raise exception 'Ngân hàng câu hỏi không tồn tại.';
  end if;

  if not public.can_manage_space(target_set.space_id) then
    raise exception 'Bạn không có quyền quản lý Space này.';
  end if;

  select *
  into target_space
  from public.spaces
  where id = target_set.space_id
  for update;

  if exists (
    select 1
    from public.real_exams exam
    join public.real_exam_sources source on source.real_exam_id = exam.id
    where exam.space_id = target_set.space_id
      and source.question_set_id = target_question_set_id
      and exam.hidden_at is null
      and exam.ended_at is null
      and now() between exam.start_at and exam.end_at
  ) then
    raise exception 'Không thể xóa ngân hàng câu hỏi khi đang là nguồn của một Đợt thi thật đang diễn ra. Hãy chờ đợt thi kết thúc hoặc loại bỏ ngân hàng này khỏi cấu hình Đợt thi thật.';
  end if;

  perform 1
  from public.question_sets
  where space_id = target_set.space_id
  for update;

  select count(*)
  into set_count
  from public.question_sets
  where space_id = target_set.space_id
    and hidden_at is null;

  if set_count <= 1 then
    raise exception 'Space phải có ít nhất 1 ngân hàng câu hỏi.';
  end if;

  select coalesce(
    jsonb_agg(item) filter (
      where coalesce(
        nullif(item ->> 'question_set_id', '')::bigint,
        nullif(item ->> 'id', '')::bigint
      ) <> target_question_set_id
    ),
    '[]'::jsonb
  )
  into remaining_config
  from jsonb_array_elements(coalesce(target_space.real_question_sets, '[]'::jsonb)) as item;

  select count(*)
  into deleted_question_count
  from public.questions
  where question_set_id = target_question_set_id
    and hidden_at is null;

  update public.spaces
  set real_question_sets = remaining_config,
      updated_at = now()
  where id = target_set.space_id;

  update public.questions
  set hidden_at = now(),
      hidden_by = auth.uid(),
      permanent_hidden = not public.is_superadmin()
  where question_set_id = target_question_set_id
    and hidden_at is null;

  update public.question_sets
  set hidden_at = now(),
      hidden_by = auth.uid()
  where id = target_question_set_id;

  return jsonb_build_object(
    'id', target_question_set_id,
    'name', target_set.name,
    'deleted_questions', deleted_question_count
  );
end;
$$;

-- Create unhide_question_set
create or replace function public.unhide_question_set(target_question_set_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_set public.question_sets%rowtype;
begin
  if not public.is_superadmin() then
    raise exception 'Chỉ superadmin mới có quyền khôi phục ngân hàng câu hỏi.';
  end if;

  select * into target_set from public.question_sets where id = target_question_set_id for update;
  if not found then
    raise exception 'Ngân hàng câu hỏi không tồn tại.';
  end if;

  update public.question_sets
  set hidden_at = null,
      hidden_by = null
  where id = target_question_set_id;

  update public.questions
  set hidden_at = null,
      hidden_by = null
  where question_set_id = target_question_set_id
    and permanent_hidden = false
    and hidden_at is not null;

  return to_jsonb(target_set);
end;
$$;

-- Create unhide_real_exam
create or replace function public.unhide_real_exam(target_real_exam_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_exam public.real_exams%rowtype;
begin
  if not public.is_superadmin() then
    raise exception 'Chỉ superadmin mới có quyền khôi phục Đợt thi thật.';
  end if;

  select * into target_exam from public.real_exams where id = target_real_exam_id for update;
  if not found then
    raise exception 'Đợt thi thật không tồn tại.';
  end if;

  update public.real_exams
  set hidden_at = null,
      hidden_by = null,
      updated_at = now()
  where id = target_real_exam_id
  returning * into target_exam;

  return to_jsonb(target_exam);
end;
$$;

-- Revoke all permissions and grant execute on the new functions
revoke all on function public.unhide_question_set(bigint) from public;
grant execute on function public.unhide_question_set(bigint) to authenticated;
revoke all on function public.unhide_real_exam(bigint) from public;
grant execute on function public.unhide_real_exam(bigint) to authenticated;

-- Update list_real_exams to support status_filter = 'hidden' for superadmin
create or replace function public.list_real_exams(
  target_space_id bigint,
  requested_page integer default 1,
  requested_page_size integer default 15,
  search_text text default null,
  status_filter text default null
)
returns table (
  id bigint,
  code integer,
  name text,
  status text,
  start_at timestamptz,
  end_at timestamptz,
  question_count bigint,
  result_count bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  safe_page integer := greatest(1, coalesce(requested_page, 1));
  safe_size integer := least(15, greatest(1, coalesce(requested_page_size, 15)));
  include_hidden boolean := (nullif(status_filter, '') = 'hidden' and public.is_superadmin());
begin
  if not public.can_manage_space(target_space_id) then
    raise exception 'Không có quyền quản lý Space này.';
  end if;
  return query
  with rows_with_status as (
    select exam.*, public.real_exam_status(exam) as computed_status
    from public.real_exams exam
    where exam.space_id = target_space_id
      and (include_hidden or exam.hidden_at is null)
      and (
        nullif(trim(search_text), '') is null
        or exam.name ilike '%' || trim(search_text) || '%'
        or exam.code::text = regexp_replace(search_text, '[^0-9]', '', 'g')
      )
  ),
  filtered as (
    select *
    from rows_with_status
    where nullif(status_filter, '') is null or computed_status = status_filter
  )
  select
    exam.id,
    exam.code,
    exam.name,
    exam.computed_status,
    exam.start_at,
    exam.end_at,
    (select count(*) from public.real_exam_question_refs ref where ref.real_exam_id = exam.id),
    (select count(*) from public.quiz_attempts attempt where attempt.real_exam_id = exam.id),
    count(*) over()
  from filtered exam
  order by
    case exam.computed_status when 'active' then 0 when 'scheduled' then 1 else 2 end,
    case when exam.computed_status = 'scheduled' then exam.start_at end asc,
    case when exam.computed_status <> 'scheduled' then exam.start_at end desc,
    exam.id desc
  limit safe_size
  offset (safe_page - 1) * safe_size;
end;
$$;

notify pgrst, 'reload schema';

commit;
