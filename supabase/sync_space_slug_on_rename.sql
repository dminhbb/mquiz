-- UP: Khi đổi slug của Space, cập nhật slug mới vào kết quả và session làm bài cũ.
--
-- quiz_attempts.space_slug và quiz_attempt_sessions.space_slug lưu slug dạng text. Trước đây
-- đổi slug làm kết quả Thi thử cũ biến khỏi bảng xếp hạng, không được dọn theo retention/xóa
-- Space, và học viên đang làm dở không nộp được bài. Trigger này giữ chúng đi theo Space.
-- Link cũ /{slug-cũ} vẫn không còn hoạt động (chủ ý).
--
-- Thứ tự áp dụng: chạy file này (idempotent). Không cần deploy Edge Function hay frontend.

begin;

create or replace function public.sync_space_slug_on_rename()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.slug is distinct from old.slug then
    update public.quiz_attempts
    set space_slug = new.slug
    where space_slug = old.slug;

    update public.quiz_attempt_sessions
    set space_slug = new.slug
    where space_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_space_slug_on_rename() from public, anon, authenticated;

drop trigger if exists spaces_sync_slug_on_rename on public.spaces;
create trigger spaces_sync_slug_on_rename
after update of slug on public.spaces
for each row execute function public.sync_space_slug_on_rename();

commit;

notify pgrst, 'reload schema';
