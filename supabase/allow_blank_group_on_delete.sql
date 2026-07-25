-- Allow historical attempts to keep their result data after a Group is deleted.
-- The attempt row remains, but group_name is cleared to NULL.

alter table public.quiz_attempts
alter column group_name drop not null;

drop policy if exists "allow public insert quiz attempts" on public.quiz_attempts;
create policy "allow public insert quiz attempts"
on public.quiz_attempts
for insert
to anon, authenticated
with check (
  mode in ('mock', 'real')
  and char_length(trim(student_name)) between 1 and 80
  and char_length(trim(student_name_key)) between 1 and 80
  and (
    group_name is null
    or char_length(trim(group_name)) between 1 and 120
  )
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
  and scoring_method in (1, 2)
  and knowledge_score between 0 and 95
  and coverage_score between 0 and 10
  and duration_score between 0 and 10
  and punctuality_score between 0 and 5
);

create or replace function public.clear_quiz_attempt_group_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.quiz_attempts qa
  set group_name = null
  from public.spaces s
  where s.id = old.space_id
    and qa.space_slug = s.slug
    and qa.group_name = old.name;

  return old;
end;
$$;

drop trigger if exists groups_clear_quiz_attempt_group on public.groups;
create trigger groups_clear_quiz_attempt_group
before delete on public.groups
for each row execute function public.clear_quiz_attempt_group_on_delete();

notify pgrst, 'reload schema';
