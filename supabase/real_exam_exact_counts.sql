-- Chuyển "Số lượng câu hỏi" và "Tỷ lệ câu nhiều đáp án" từ % sang số lượng chính xác.
-- Mở rộng "Số lần thi tối đa" lên 1-10 và "Thời gian mỗi câu" cho phép 30 giây.
-- Run sau real_exam_rebuild.sql.
begin;

-- 1. real_exams: đổi question_percent/multi_percent thành số lượng tuyệt đối.
--    Đặt tên target_question_count/target_multi_count để không đụng key "question_count"
--    (số câu thực tế đã snapshot) mà get_real_exam_admin/list_real_exams đang trả về.
alter table public.real_exams
  drop constraint if exists real_exams_question_percent_check,
  drop constraint if exists real_exams_multi_percent_check,
  drop constraint if exists real_exams_max_attempts_check,
  drop constraint if exists real_exams_timer_seconds_check;

alter table public.real_exams
  rename column question_percent to target_question_count;
alter table public.real_exams
  rename column multi_percent to target_multi_count;

update public.real_exams exam
set target_question_count = greatest(5, (
      select count(*) from public.real_exam_question_refs ref where ref.real_exam_id = exam.id
    )),
    target_multi_count = (
      select count(*)
      from public.real_exam_question_refs ref
      join public.questions q on q.question_code = ref.question_code
      where ref.real_exam_id = exam.id and q.type = 'multi'
    )
where exam.target_question_count in (30, 50, 70, 100);

alter table public.real_exams
  alter column target_question_count set default 20,
  alter column target_multi_count set default 0;

alter table public.real_exams
  add constraint real_exams_target_question_count_check check (target_question_count >= 5),
  add constraint real_exams_target_multi_count_check check (target_multi_count >= 0),
  add constraint real_exams_max_attempts_check check (max_attempts between 1 and 10),
  add constraint real_exams_timer_seconds_check check (timer_seconds in (30, 45, 60, 90, 120));

-- 2. real_exam_revisions: cùng thay đổi để mỗi phiên bản lưu đúng số lượng đã dùng.
alter table public.real_exam_revisions
  drop constraint if exists real_exam_revisions_question_percent_check,
  drop constraint if exists real_exam_revisions_multi_percent_check,
  drop constraint if exists real_exam_revisions_max_attempts_check,
  drop constraint if exists real_exam_revisions_timer_seconds_check;

alter table public.real_exam_revisions
  rename column question_percent to target_question_count;
alter table public.real_exam_revisions
  rename column multi_percent to target_multi_count;

alter table public.real_exam_revisions
  add constraint real_exam_revisions_target_question_count_check check (target_question_count >= 5),
  add constraint real_exam_revisions_target_multi_count_check check (target_multi_count >= 0),
  add constraint real_exam_revisions_max_attempts_check check (max_attempts between 1 and 10),
  add constraint real_exam_revisions_timer_seconds_check check (timer_seconds in (30, 45, 60, 90, 120));

-- 3. Sinh đề: X = target_question_count (kẹp trong tổng nguồn khả dụng),
--    Y = target_multi_count (kẹp trong X); tỷ lệ multi mỗi nguồn suy ra từ Y/X.
create or replace function public.generate_real_exam_snapshot_unchecked(target_real_exam_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  target_exam public.real_exams%rowtype;
  source_row record;
  source_count integer;
  source_index integer := 0;
  candidate_count integer;
  target_count integer;
  source_quota integer;
  target_multi integer;
  multi_ratio numeric;
  inserted_count integer;
  selected_count integer;
  remaining_count integer;
  current_multi integer;
  available_multi integer;
  available_single integer;
  swap_count integer;
begin
  select *
  into target_exam
  from public.real_exams
  where id = target_real_exam_id
  for update;

  if not found then
    raise exception 'Đợt thi thật không tồn tại.';
  end if;

  select count(*)
  into source_count
  from public.real_exam_sources
  where real_exam_id = target_real_exam_id and percent > 0;

  if source_count = 0 then
    raise exception 'Chọn ít nhất một Ngân hàng câu hỏi.';
  end if;

  select count(*)
  into candidate_count
  from public.questions q
  join public.real_exam_sources rs
    on rs.real_exam_id = target_real_exam_id
   and rs.question_set_id = q.question_set_id
  where q.hidden_at is null
    and rs.percent > 0;

  if candidate_count = 0 then
    raise exception 'Nguồn câu hỏi chưa có câu hỏi khả dụng.';
  end if;

  target_count := greatest(5, least(target_exam.target_question_count, candidate_count));
  target_multi := greatest(0, least(target_exam.target_multi_count, target_count));
  multi_ratio := case when target_count > 0 then target_multi::numeric / target_count else 0 end;

  drop table if exists pg_temp.real_exam_selected_questions;
  create temporary table real_exam_selected_questions (
    question_code integer primary key,
    type text not null
  ) on commit drop;

  remaining_count := target_count;
  for source_row in
    select rs.question_set_id, rs.percent
    from public.real_exam_sources rs
    where rs.real_exam_id = target_real_exam_id and rs.percent > 0
    order by rs.question_set_id
  loop
    source_index := source_index + 1;
    source_quota := case
      when source_index = source_count then remaining_count
      else least(remaining_count, round(target_count * source_row.percent / 100.0)::integer)
    end;

    insert into real_exam_selected_questions(question_code, type)
    select q.question_code, q.type
    from public.questions q
    where q.question_set_id = source_row.question_set_id
      and q.hidden_at is null
      and q.type = 'multi'
      and not exists (
        select 1 from real_exam_selected_questions selected
        where selected.question_code = q.question_code
      )
    order by random()
    limit least(source_quota, round(source_quota * multi_ratio)::integer);

    select count(*) into selected_count
    from real_exam_selected_questions selected
    join public.questions q on q.question_code = selected.question_code
    where q.question_set_id = source_row.question_set_id;

    insert into real_exam_selected_questions(question_code, type)
    select q.question_code, q.type
    from public.questions q
    where q.question_set_id = source_row.question_set_id
      and q.hidden_at is null
      and q.type = 'single'
      and not exists (
        select 1 from real_exam_selected_questions selected
        where selected.question_code = q.question_code
      )
    order by random()
    limit greatest(0, source_quota - selected_count);

    select count(*) into selected_count
    from real_exam_selected_questions selected
    join public.questions q on q.question_code = selected.question_code
    where q.question_set_id = source_row.question_set_id;

    insert into real_exam_selected_questions(question_code, type)
    select q.question_code, q.type
    from public.questions q
    where q.question_set_id = source_row.question_set_id
      and q.hidden_at is null
      and not exists (
        select 1 from real_exam_selected_questions selected
        where selected.question_code = q.question_code
      )
    order by random()
    limit greatest(0, source_quota - selected_count);

    select count(*) into inserted_count
    from real_exam_selected_questions selected
    join public.questions q on q.question_code = selected.question_code
    where q.question_set_id = source_row.question_set_id;
    remaining_count := greatest(0, remaining_count - inserted_count);
  end loop;

  select count(*) into selected_count from real_exam_selected_questions;
  if selected_count < target_count then
    insert into real_exam_selected_questions(question_code, type)
    select q.question_code, q.type
    from public.questions q
    join public.real_exam_sources rs
      on rs.real_exam_id = target_real_exam_id
     and rs.question_set_id = q.question_set_id
    where q.hidden_at is null
      and not exists (
        select 1 from real_exam_selected_questions selected
        where selected.question_code = q.question_code
      )
    order by
      case when q.type = 'multi'
        and (select count(*) from real_exam_selected_questions where type = 'multi') < target_multi
        then 0 else 1 end,
      random()
    limit target_count - selected_count;
  end if;

  -- Nguyên tắc theo nguồn xác định lựa chọn ban đầu. Chốt lại snapshot toàn cục
  -- để Y đúng số lượng câu nhiều đáp án mục tiêu, cho phép câu một đáp án thay thế
  -- khi thiếu hụt thật sự về câu nhiều đáp án.
  select count(*) into current_multi
  from real_exam_selected_questions
  where type = 'multi';

  select count(*) into available_multi
  from public.questions q
  join public.real_exam_sources rs
    on rs.real_exam_id = target_real_exam_id
   and rs.question_set_id = q.question_set_id
  where q.hidden_at is null
    and q.type = 'multi'
    and rs.percent > 0;

  swap_count := least(
    greatest(0, target_multi - current_multi),
    greatest(0, available_multi - current_multi)
  );

  if swap_count > 0 then
    delete from real_exam_selected_questions
    where question_code in (
      select selected.question_code
      from real_exam_selected_questions selected
      where selected.type = 'single'
      order by random()
      limit swap_count
    );

    insert into real_exam_selected_questions(question_code, type)
    select q.question_code, q.type
    from public.questions q
    join public.real_exam_sources rs
      on rs.real_exam_id = target_real_exam_id
     and rs.question_set_id = q.question_set_id
    where q.hidden_at is null
      and q.type = 'multi'
      and rs.percent > 0
      and not exists (
        select 1
        from real_exam_selected_questions selected
        where selected.question_code = q.question_code
      )
    order by random()
    limit swap_count;
  end if;

  select count(*) into current_multi
  from real_exam_selected_questions
  where type = 'multi';

  select count(*) into available_single
  from public.questions q
  join public.real_exam_sources rs
    on rs.real_exam_id = target_real_exam_id
   and rs.question_set_id = q.question_set_id
  where q.hidden_at is null
    and q.type = 'single'
    and rs.percent > 0;

  swap_count := least(
    greatest(0, current_multi - target_multi),
    greatest(
      0,
      available_single - (
        select count(*)
        from real_exam_selected_questions
        where type = 'single'
      )
    )
  );

  if swap_count > 0 then
    delete from real_exam_selected_questions
    where question_code in (
      select selected.question_code
      from real_exam_selected_questions selected
      where selected.type = 'multi'
      order by random()
      limit swap_count
    );

    insert into real_exam_selected_questions(question_code, type)
    select q.question_code, q.type
    from public.questions q
    join public.real_exam_sources rs
      on rs.real_exam_id = target_real_exam_id
     and rs.question_set_id = q.question_set_id
    where q.hidden_at is null
      and q.type = 'single'
      and rs.percent > 0
      and not exists (
        select 1
        from real_exam_selected_questions selected
        where selected.question_code = q.question_code
      )
    order by random()
    limit swap_count;
  end if;

  select count(*) into selected_count from real_exam_selected_questions;
  if selected_count < target_count then
    raise exception 'Nguồn câu hỏi chỉ đáp ứng %/% câu cần thiết.', selected_count, target_count;
  end if;

  delete from public.real_exam_question_refs
  where real_exam_id = target_real_exam_id;

  insert into public.real_exam_question_refs(real_exam_id, question_code, generated_order)
  select target_real_exam_id, selected.question_code, row_number() over (order by random())::integer
  from real_exam_selected_questions selected;

  update public.real_exams
  set questions_generated_at = now(),
      source_version = gen_random_uuid(),
      updated_at = now()
  where id = target_real_exam_id;

  return selected_count;
end;
$$;

-- 4. Lưu Phiên bản Đề thi với số lượng chính xác của thời điểm build.
create or replace function public.create_real_exam_revision_unchecked(target_real_exam_id bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  target_exam public.real_exams%rowtype;
  next_revision_no integer;
  created_revision_id bigint;
begin
  select *
  into target_exam
  from public.real_exams
  where id = target_real_exam_id
  for update;

  if not found then
    raise exception 'Đợt thi thật không tồn tại.';
  end if;

  select coalesce(max(revision_no), 0) + 1
  into next_revision_no
  from public.real_exam_revisions
  where real_exam_id = target_real_exam_id;

  insert into public.real_exam_revisions(
    real_exam_id,
    revision_no,
    start_at,
    end_at,
    target_question_count,
    timer_seconds,
    target_multi_count,
    max_attempts,
    scoring_method,
    source_version,
    created_by
  )
  values (
    target_exam.id,
    next_revision_no,
    target_exam.start_at,
    target_exam.end_at,
    target_exam.target_question_count,
    target_exam.timer_seconds,
    target_exam.target_multi_count,
    target_exam.max_attempts,
    target_exam.scoring_method,
    target_exam.source_version,
    auth.uid()
  )
  returning id into created_revision_id;

  insert into public.real_exam_revision_sources(
    revision_id,
    question_set_id,
    question_set_name,
    percent
  )
  select
    created_revision_id,
    source.question_set_id,
    source.question_set_name,
    source.percent
  from public.real_exam_sources source
  where source.real_exam_id = target_real_exam_id;

  perform public.archive_real_exam_revision_unchecked(
    target_real_exam_id,
    created_revision_id
  );

  update public.real_exams
  set current_revision_id = created_revision_id,
      updated_at = now()
  where id = target_real_exam_id;

  return created_revision_id;
end;
$$;

-- 5. Tạo/sửa Đợt thi thật nhận số lượng chính xác thay vì %.
create or replace function public.create_real_exam(target_space_id bigint, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  created_exam public.real_exams%rowtype;
  allocated_code integer;
  generated_count integer;
  created_revision_id bigint;
  created_revision_no integer;
  start_value timestamptz;
  end_value timestamptz;
begin
  if not public.can_manage_space(target_space_id) then
    raise exception 'Bạn không có quyền quản lý Space này.';
  end if;

  start_value := nullif(payload ->> 'start_at', '')::timestamptz;
  end_value := nullif(payload ->> 'end_at', '')::timestamptz;
  if start_value is null or end_value is null or start_value >= end_value then
    raise exception 'Khoảng thời gian Thi thật không hợp lệ.';
  end if;

  allocated_code := public.allocate_real_exam_code();
  insert into public.real_exams(
    code, space_id, name, start_at, end_at, target_question_count, timer_seconds,
    target_multi_count, max_attempts, scoring_method, created_by
  )
  values (
    allocated_code,
    target_space_id,
    nullif(trim(payload ->> 'name'), ''),
    start_value,
    end_value,
    greatest(5, coalesce((payload ->> 'question_count')::integer, 20)),
    coalesce((payload ->> 'timer_seconds')::integer, 60),
    greatest(0, coalesce((payload ->> 'multi_count')::integer, 0)),
    coalesce((payload ->> 'max_attempts')::integer, 1),
    coalesce((payload ->> 'scoring_method')::integer, 2),
    auth.uid()
  )
  returning * into created_exam;

  if created_exam.name is null then
    raise exception 'Tên Đợt thi thật là bắt buộc.';
  end if;

  perform public.replace_real_exam_sources(created_exam.id, payload -> 'sources');
  generated_count := public.generate_real_exam_snapshot_unchecked(created_exam.id);
  created_revision_id := public.create_real_exam_revision_unchecked(created_exam.id);

  select revision_no
  into created_revision_no
  from public.real_exam_revisions
  where id = created_revision_id;

  return to_jsonb(created_exam) || jsonb_build_object(
    'current_revision_id', created_revision_id,
    'current_revision_no', created_revision_no,
    'question_count', generated_count,
    'share_path', '/exam/' || created_exam.code::text
  );
end;
$$;

create or replace function public.update_real_exam(target_real_exam_id bigint, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_exam public.real_exams%rowtype;
  generated_count integer;
  created_revision_id bigint;
  created_revision_no integer;
  start_value timestamptz;
  end_value timestamptz;
begin
  select *
  into target_exam
  from public.real_exams
  where id = target_real_exam_id
  for update;

  if not found or not public.can_manage_space(target_exam.space_id) then
    raise exception 'Không có quyền quản lý Đợt thi thật này.';
  end if;
  if target_exam.hidden_at is not null then
    raise exception 'Đợt thi thật đã được ẩn.';
  end if;
  if target_exam.manual_running and now() between target_exam.start_at and target_exam.end_at then
    raise exception 'Hãy Stop Đợt thi trước khi thay đổi nguồn hoặc nguyên tắc tạo đề.';
  end if;

  start_value := nullif(payload ->> 'start_at', '')::timestamptz;
  end_value := nullif(payload ->> 'end_at', '')::timestamptz;
  if start_value is null or end_value is null or start_value >= end_value then
    raise exception 'Khoảng thời gian Thi thật không hợp lệ.';
  end if;
  if not (payload ? 'sources') then
    raise exception 'Nguồn câu hỏi là bắt buộc khi tạo phiên bản mới.';
  end if;

  update public.real_exams
  set name = coalesce(nullif(trim(payload ->> 'name'), ''), name),
      start_at = start_value,
      end_at = end_value,
      ended_at = null,
      target_question_count = greatest(5, coalesce((payload ->> 'question_count')::integer, target_question_count)),
      timer_seconds = coalesce((payload ->> 'timer_seconds')::integer, timer_seconds),
      target_multi_count = greatest(0, coalesce((payload ->> 'multi_count')::integer, target_multi_count)),
      max_attempts = coalesce((payload ->> 'max_attempts')::integer, max_attempts),
      scoring_method = coalesce((payload ->> 'scoring_method')::integer, scoring_method),
      updated_at = now()
  where id = target_real_exam_id
  returning * into target_exam;

  perform public.replace_real_exam_sources(target_real_exam_id, payload -> 'sources');
  update public.real_exams
  set needs_rebuild = true,
      updated_at = now()
  where id = target_real_exam_id;

  select *
  into target_exam
  from public.real_exams
  where id = target_real_exam_id;

  return to_jsonb(target_exam) || jsonb_build_object(
    'current_revision_id', target_exam.current_revision_id,
    'current_revision_no', (select revision_no from public.real_exam_revisions where id = target_exam.current_revision_id),
    'question_count', (select count(*) from public.real_exam_question_refs where real_exam_id = target_real_exam_id),
    'needs_rebuild', true,
    'created_new_revision', false
  );
end;
$$;

notify pgrst, 'reload schema';

commit;
