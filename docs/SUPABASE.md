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
- `quiz_attempts`: attempt mock/real và breakdown điểm; practice không ghi bảng này.
- `real_exams`: đợt thi có mã cố định, lịch, trạng thái, nguồn câu và revision hiện hành.
- `real_exam_revisions` cùng source/ref/snapshot: lưu lịch sử đề bất biến để audit và bảo toàn kết quả cũ.

## Quyền và dữ liệu nhạy cảm

- RLS phải bật trên bảng công khai/quản trị. Admin space được xác định bằng `can_manage_space`; superadmin bằng `is_superadmin`.
- Anon chỉ được đọc nội dung câu hỏi công khai đã được policy lọc. `correct_json`, registry mã, dữ liệu quản trị và service-role key không được lộ ra client.
- `quiz-evaluate` dùng service role ở môi trường Edge Function để đọc đáp án và trả kết quả tối thiểu cần thiết.
- Trigger bảo vệ câu đã snapshot và các RPC archive/rebuild là lớp enforcement nghiệp vụ, không được thay bằng disable button trên UI.

## Hợp đồng phía người dự thi

| Endpoint | Mục đích |
|---|---|
| `get_space_public_status(requested_slug)` | Kiểm tra/nạp Space công khai |
| `get_real_exam_public(requested_code)` | Nạp metadata và đề Thi thật phù hợp thời điểm |
| `get_real_exam_attempt_count(...)` | Kiểm tra số lượt Thi thật đã dùng |
| `get_real_exam_leaderboard_public(requested_code)` | Bảng xếp hạng Thi thật công khai |
| `quiz-evaluate` Edge Function | `check` cho practice và đánh giá bài nộp |

Người dự thi còn đọc `groups`, `questions` (không bao gồm đáp án) và `question_sets` theo RLS, rồi insert `quiz_attempts` cho mock/real.

## Hợp đồng quản trị

Admin dùng CRUD RLS-protected cho Space, group, question set và question; các thao tác nghiệp vụ quan trọng qua RPC: archive/restore/clear/delete question set, CRUD/rebuild/start-stop/hide real exam, danh sách/kết quả/export, dọn retention, backup/restore. Danh sách lời gọi thực tế là nguồn chính xác nhất: tìm `client.rpc(` trong `cloud-admin/admin.js` trước khi đổi chữ ký SQL.

`admin-users` Edge Function thực hiện tạo user, reset password và cập nhật user thông qua Supabase Admin API. Chỉ gọi khi có JWT hợp lệ và quyền superadmin được function kiểm tra.

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

## Deploy Edge Function

```bash
npm run deploy:quiz-evaluate
npm run deploy:admin-users
```

Secrets service-role chỉ cấu hình trong Supabase Edge Function environment. Không commit chúng vào source, tài liệu hay config frontend.
