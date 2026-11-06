-- UP: Thêm lựa chọn thời gian mỗi câu 300s và "Không giới hạn" (timer_seconds = 0).
--
-- Quy ước: timer_seconds = 0 nghĩa là không giới hạn thời gian mỗi câu. Điểm Thời gian
-- của lượt không giới hạn được tính theo mốc 300s/câu (supabase/functions/_shared/scoring.ts);
-- quiz-attempt chỉ nhận bài nộp trong vòng 24 giờ kể từ lúc bắt đầu.
--
-- Thứ tự áp dụng:
--   1. Chạy script này (idempotent) trong Supabase SQL editor.
--   2. Deploy Edge Functions: npm run deploy:quiz-attempt && npm run deploy:quiz-evaluate
--   3. Phát hành frontend + admin (npm run version:bump && npm run build).
-- Chạy bước 1 trước: admin chỉ lưu được Đợt thi 300s/Không giới hạn khi ràng buộc đã nới.
--
-- Rollback: chỉ thực hiện được khi không còn dòng nào dùng 0 hoặc 300, bằng cách tạo lại
-- các ràng buộc dưới đây với danh sách cũ:
--   real_exams / real_exam_revisions: timer_seconds in (30, 45, 60, 90, 120)
--   quiz_attempt_sessions:            timer_seconds between 1 and 600

begin;

alter table public.real_exams
  drop constraint if exists real_exams_timer_seconds_check;
alter table public.real_exams
  add constraint real_exams_timer_seconds_check
  check (timer_seconds in (0, 30, 45, 60, 90, 120, 300));

alter table public.real_exam_revisions
  drop constraint if exists real_exam_revisions_timer_seconds_check;
alter table public.real_exam_revisions
  add constraint real_exam_revisions_timer_seconds_check
  check (timer_seconds in (0, 30, 45, 60, 90, 120, 300));

alter table public.quiz_attempt_sessions
  drop constraint if exists quiz_attempt_sessions_timer_seconds_check;
alter table public.quiz_attempt_sessions
  add constraint quiz_attempt_sessions_timer_seconds_check
  check (timer_seconds between 0 and 600);

-- quiz_attempts.timer_seconds đã cho phép 0 (check timer_seconds >= 0 trong quiz_attempts.sql).

commit;

notify pgrst, 'reload schema';
