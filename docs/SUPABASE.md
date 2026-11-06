# Supabase: dữ liệu, quyền và hợp đồng tích hợp

## Mô hình dữ liệu

```text
profiles ──< space_admins >── spaces ──< groups
                                  ├──< question_sets ──< questions
                                  ├──< quiz_attempts
                                  └──< real_exams ──< revisions ──< revision snapshots
                                                    └──< sources / question refs
```

Các bảng quan trọng:

- `profiles`: profile nối với `auth.users`, role `superadmin` hoặc `admin`, trạng thái hoạt động.
- `spaces`: đơn vị tổ chức theo `slug`, publish/timer và chính sách lưu kết quả.
- `groups`, `question_sets`, `questions`: tổ chức ngân hàng câu hỏi. `questions.correct_json` là dữ liệu nhạy cảm.
- `quiz_attempts`: attempt mock/real và breakdown điểm; practice không ghi bảng này. Chỉ service role (Edge Function `quiz-attempt`) được `insert`; anon/authenticated chỉ có quyền `select` theo policy (30 ngày gần nhất).
- `quiz_attempt_sessions`: session làm bài do server tạo (thời điểm bắt đầu, câu hỏi, timer, scoring method, outcome `pending`/`saved`/`abandoned`). RLS bật, không có policy: chỉ service role truy cập.
- `api_rate_limits`: bộ đếm cửa sổ cố định cho `consume_rate_limit`. Chỉ service role.
- `real_exams`: đợt thi có mã cố định, lịch, trạng thái, nguồn câu và revision hiện hành.
- `real_exam_revisions` cùng source/ref/snapshot: lưu lịch sử đề bất biến để audit và bảo toàn kết quả cũ.

## Quyền và dữ liệu nhạy cảm

- RLS phải bật trên bảng công khai/quản trị. Admin space được xác định bằng `can_manage_space`; superadmin bằng `is_superadmin`.
- Anon chỉ được đọc nội dung câu hỏi công khai đã được policy lọc. `correct_json`, registry mã, dữ liệu quản trị và service-role key không được lộ ra client.
- `quiz-attempt` và `quiz-evaluate` dùng service role ở môi trường Edge Function để đọc đáp án. `quiz-attempt` chấm điểm và ghi kết quả; `quiz-evaluate` chỉ phục vụ Luyện tập. Hai function đặt `verify_jwt = false` vì người thi không đăng nhập (publishable key không phải JWT), nên bảo vệ bằng validate đầu vào, session và rate limit.
- Trigger bảo vệ câu đã snapshot và các RPC archive/rebuild là lớp enforcement nghiệp vụ, không được thay bằng disable button trên UI.

## Hợp đồng phía người dự thi

| Endpoint | Mục đích |
|---|---|
| `get_space_public_status(requested_slug)` | Kiểm tra/nạp Space công khai |
| `get_real_exam_public(requested_code)` | Nạp metadata và đề Thi thật phù hợp thời điểm |
| `get_real_exam_attempt_count(...)` | Kiểm tra số lượt Thi thật đã dùng |
| `get_real_exam_leaderboard_public(requested_code)` | Bảng xếp hạng Thi thật công khai |
| `quiz-attempt` Edge Function | `start` mở session Thi thử/Thi thật; `submit` chấm điểm, ghi `quiz_attempts`, trả đáp án để xem lại |
| `quiz-evaluate` Edge Function | `check` (từng câu) và `review` (kết quả cả bài) cho Luyện tập |

Người dự thi còn đọc `groups`, `questions` (không bao gồm đáp án) và `question_sets` theo RLS. Trình duyệt **không** insert `quiz_attempts`.

Lỗi nghiệp vụ trong SQL dùng `raise exception ... using errcode = 'P0001'`: Edge Function hiển thị nguyên văn các lỗi này, còn lỗi DB khác bị che thành thông báo chung.

## Hợp đồng quản trị

Admin dùng CRUD RLS-protected cho Space, group, question set và question; các thao tác nghiệp vụ quan trọng qua RPC: archive/restore/clear/delete question set, CRUD/rebuild/start-stop/hide real exam, danh sách/kết quả/export, dọn retention, backup/restore. Danh sách lời gọi thực tế là nguồn chính xác nhất: tìm `client.rpc(` trong `cloud-admin/admin.js` trước khi đổi chữ ký SQL.

`admin-users` Edge Function thực hiện tạo user, reset password và cập nhật user thông qua Supabase Admin API. Chỉ gọi khi có JWT hợp lệ và quyền superadmin được function kiểm tra. Function validate email/mật khẩu (cả khi tạo), không cho tự hạ quyền/khóa/xóa chính mình và luôn giữ ít nhất một Superadmin đang hoạt động.

## Thứ tự và cách thay đổi SQL

Thư mục `supabase/` chứa các script lịch sử được áp dụng dần, không có `supabase/migrations/` hay lệnh migration tự động. Vì vậy trạng thái database production là tổng hợp của các script đã áp dụng; file cuối theo tên **không** mặc định là trạng thái chuẩn.

Các nền tảng lịch sử chính:

1. `quiz_attempts.sql`, `cloud_admin_schema.sql`: Space, ngân hàng câu hỏi, profile/RLS và attempt.
2. `real_exams_v2.sql`: đợt thi, snapshot, code registry và RPC ban đầu.
3. `real_exam_revisions.sql`, `real_exam_rebuild.sql`: revision và lifecycle rebuild/start-stop.
4. `archive_lifecycle.sql`, `question_management.sql`: soft-delete, snapshot archive và khóa nghiệp vụ.
5. Các file `add_*`, `fix_*`, `manage_result_retention.sql`, `real_exam_public_leaderboard.sql`: thay đổi bổ sung/sửa quyền và tính năng.

Khi thêm thay đổi database:

1. Kiểm tra schema/function hiện tại trong Supabase Dashboard hoặc môi trường đích, không suy đoán chỉ từ một script.
2. Thêm script mới có tên mô tả; dùng `if exists`/`if not exists` hoặc `create or replace` khi phù hợp.
3. Cập nhật cùng lúc RLS, `grant`/`revoke`, trigger và các caller JS/Edge Function chịu ảnh hưởng.
4. Áp dụng bằng quy trình Supabase của môi trường, xác thực anon/admin bằng tài khoản thật, rồi deploy Edge Function nếu đã đổi function.

## Thay đổi gần đây: chấm điểm phía server

Áp dụng theo đúng thứ tự (nên làm trong một cửa sổ bảo trì ngắn):

1. Chạy `supabase/server_side_attempt_scoring.sql` (tạo `quiz_attempt_sessions`, `api_rate_limits`, `consume_rate_limit`, `start_quiz_attempt_session`; bỏ policy/quyền `insert` của `quiz_attempts`; đưa policy đọc về 30 ngày). Rollback: `supabase/rollback_server_side_attempt_scoring.sql` (mở lại insert trực tiếp, nên đi kèm frontend cũ).
2. `npm run deploy:quiz-attempt && npm run deploy:quiz-evaluate && npm run deploy:admin-users`.
3. Phát hành frontend: `npm run version:bump && npm run build`. Trình duyệt dùng bản cũ sẽ không lưu được kết quả sau bước 1 và sẽ nhận thông báo làm mới.
4. Kiểm tra: làm một lượt Thi thử và một lượt Thi thật; xác nhận `insert` trực tiếp bằng anon key vào `quiz_attempts` bị từ chối (HTTP 401/403).

Dọn dữ liệu định kỳ (tuỳ chọn, Supabase Cron): `select public.purge_stale_quiz_attempt_sessions();` xóa session Thi thử cũ hơn 2 ngày; session Thi thật được giữ làm dấu vết sử dụng lượt.

## Thay đổi gần đây: timer 300s và Không giới hạn

`timer_seconds = 0` nghĩa là không giới hạn thời gian mỗi câu (Luyện tập, Thi thử và Đợt thi thật). Điểm Thời gian của lượt không giới hạn tính theo mốc 300s/câu; `quiz-attempt` chỉ nhận bài nộp trong 24 giờ kể từ khi bắt đầu.

1. Chạy `supabase/add_unlimited_and_300s_question_timers.sql` (nới ràng buộc `timer_seconds` của `real_exams`, `real_exam_revisions`, `quiz_attempt_sessions`).
2. `npm run deploy:quiz-attempt && npm run deploy:quiz-evaluate`.
3. Phát hành frontend + admin: `npm run version:bump && npm run build`.

## Thay đổi gần đây: xóa Space có Đợt thi thật

`real_exams.space_id` là `on delete restrict`, nên xóa thẳng bảng `spaces` bị lỗi `real_exams_space_id_fkey` khi Space đã có Đợt thi thật. Chạy `supabase/delete_space_with_real_exams.sql` để `delete_space_cascade` (chỉ superadmin, xác nhận bằng slug) xóa cả kết quả, revision/snapshot và Đợt thi thật trước khi xóa Space; hàm từ chối khi còn đợt thi đang diễn ra. Admin gọi RPC này từ nút Xóa Space. Mã đợt thi và mã câu hỏi trong các registry được giữ lại để không cấp lại.

## Thay đổi gần đây: sửa sau review (2026-11)

Áp dụng theo thứ tự:

1. `supabase/review_security_hardening.sql`: thu hồi EXECUTE của anon/authenticated trên các hàm nội bộ (`*_unchecked`, `allocate_*`, `replace_real_exam_sources`...), khóa câu hỏi thuộc Đợt thi thật chưa kết thúc, giới hạn quyền đọc `quiz_attempts` (anon: chỉ Thi thử 30 ngày của Space đã publish, chỉ cột bảng xếp hạng), `get_real_exam_attempt_count` đếm cả session, tự dọn session Thi thử cũ.
2. `supabase/sync_space_slug_on_rename.sql`: đổi slug Space thì kết quả và session cũ đi theo slug mới (link `/{slug-cũ}` vẫn ngừng hoạt động).
3. Deploy `quiz-attempt` và `quiz-evaluate`.
4. Phát hành frontend + admin.

Kiểm tra sau khi áp dụng: `select has_function_privilege('anon', 'public.cleanup_space_results_unchecked(bigint)', 'execute');` phải trả `false`.

## Deploy Edge Function

```bash
npm run deploy:quiz-attempt
npm run deploy:quiz-evaluate
npm run deploy:admin-users
```

Secrets service-role chỉ cấu hình trong Supabase Edge Function environment. Không commit chúng vào source, tài liệu hay config frontend. Biến tùy chọn (đặt bằng `supabase secrets set`):

| Biến | Ý nghĩa |
|---|---|
| `ALLOWED_ORIGINS` | Danh sách origin được phép gọi function (phân tách bằng dấu phẩy). Bỏ trống = cho mọi origin |
| `QUIZ_TIMEZONE` | Múi giờ tính điểm đúng giờ (mặc định `Asia/Ho_Chi_Minh`) |

Giới hạn tần suất nằm ở `supabase/functions/_shared/rate-limit.ts` (`RATE_LIMITS`); đặt rộng vì cả lớp học có thể dùng chung một IP.
