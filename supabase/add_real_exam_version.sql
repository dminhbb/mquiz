-- Give each real exam event its own identifier.
-- Safe to run more than once. Existing data is preserved.

alter table public.spaces
add column if not exists real_exam_version text;

update public.spaces
set real_exam_version = gen_random_uuid()::text
where real_exam_version is null;

alter table public.spaces
alter column real_exam_version set default gen_random_uuid()::text,
alter column real_exam_version set not null;

notify pgrst, 'reload schema';
