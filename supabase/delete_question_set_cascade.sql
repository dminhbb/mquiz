begin;

alter table public.questions
  drop constraint if exists questions_question_set_id_fkey;

alter table public.questions
  add constraint questions_question_set_id_fkey
  foreign key (question_set_id)
  references public.question_sets(id)
  on delete restrict;

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
    where exam.space_id = target_set.space_id
      and exam.hidden_at is null
      and exam.ended_at is null
      and now() between exam.start_at and exam.end_at
  ) then
    raise exception 'Không thể xóa câu hỏi khi Đợt thi thật đang diễn ra. Hãy chờ đợt thi kết thúc hoặc điều chỉnh thời gian Thi thật.';
  end if;

  select count(*)
  into deleted_question_count
  from public.questions
  where question_set_id = target_question_set_id
    and hidden_at is null;

  update public.questions
  set hidden_at = now(),
      hidden_by = auth.uid()
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
    where exam.space_id = target_set.space_id
      and exam.hidden_at is null
      and exam.ended_at is null
      and now() between exam.start_at and exam.end_at
  ) then
    raise exception 'Không thể xóa ngân hàng câu hỏi khi Đợt thi thật đang diễn ra. Hãy chờ đợt thi kết thúc hoặc điều chỉnh thời gian Thi thật.';
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
      hidden_by = auth.uid()
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

revoke all on function public.clear_question_set_questions(bigint) from public;
grant execute on function public.clear_question_set_questions(bigint) to authenticated;
revoke all on function public.delete_question_set_cascade(bigint) from public;
grant execute on function public.delete_question_set_cascade(bigint) to authenticated;
revoke delete on public.question_sets, public.questions from authenticated;

notify pgrst, 'reload schema';

commit;
