# mquiz – Tài liệu đặc tả dự án

> Đây là tài liệu tham chiếu chuẩn khi phát triển mquiz. Hệ thống đã chuyển hoàn toàn sang Supabase; không còn backend cục bộ, dữ liệu offline hay quy trình generate/export cũ.

---

## 1. Tổng quan

**mquiz** là nền tảng thi trắc nghiệm tiếng Việt gồm ba chế độ: **Thi thử** (`mock`), **Luyện tập** (`practice`) và **Thi thật** (`real`). Đây là ứng dụng cloud-only: frontend tĩnh giao tiếp trực tiếp với Supabase.

| Lớp | Công nghệ |
|---|---|
| Giao diện người thi | Vanilla HTML, CSS, JavaScript (IIFE) |
| Cloud Admin | Vanilla HTML, CSS, JavaScript |
| Dữ liệu | Supabase PostgreSQL + RLS + RPC |
| Xác thực | Supabase Auth (JWT) |
| Chấm đáp án | Supabase Edge Functions (Deno/TypeScript) |
| Hosting | Cloudflare Workers Static Assets/Pages hoặc Netlify static |

Không thêm lại backend cục bộ, session server, file dữ liệu tĩnh chứa đề/đáp án, hoặc API `/api/*` cục bộ.

## 2. Kiến trúc

```text
Người thi
  Browser → /{slug} hoặc /exam/{code}
  frontend/assets/app.js
    ├─ Supabase RPC/REST: tải dữ liệu công khai
    ├─ Edge Function quiz-evaluate: kiểm tra/lấy đáp án
    └─ Supabase: lưu quiz_attempts

Quản trị viên
  /admin/
  cloud-admin/admin.js
    └─ Supabase Auth + RPC: quản lý Space, ngân hàng, câu hỏi, đợt thi, kết quả

Supabase
  PostgreSQL + RLS + triggers + RPC + Auth + Edge Functions
```

## 3. Cấu trúc thư mục

```text
mquiz/
├── frontend/                         # SPA người thi
│   ├── index.html
│   ├── app-version.json
│   └── assets/
│       ├── app.js                    # Logic làm bài
│       ├── style.css
│       ├── design-system.css
│       ├── supabase-config.js
│       └── favicon.svg
├── cloud-admin/                      # SPA quản trị Cloud
│   ├── index.html
│   ├── admin.js
│   └── admin.css
├── supabase/                         # Migrations và Edge Functions
│   ├── cloud_admin_schema.sql
│   ├── real_exams_v2.sql
│   ├── real_exam_revisions.sql
│   ├── archive_lifecycle.sql
│   ├── real_exam_rebuild.sql
│   ├── real_exam_public_leaderboard.sql
│   └── functions/
│       ├── quiz-evaluate/
│       └── admin-users/
├── scripts/
│   ├── app-version.js
│   ├── bump-app-version.js
│   └── check-design-system.js
├── build-cloudflare.sh               # Tạo dist/ từ frontend + cloud-admin
└── wrangler.toml
```

`dist/` là output build tạm thời, không phải nguồn dữ liệu hay backend.

## 4. Dữ liệu Supabase

### `profiles`

Liên kết `auth.users`; có `email`, `fullname`, `role` (`superadmin`/`admin`) và `active`.

### `spaces`

Space có khóa `bigint`, `name`, `slug` duy nhất, `published`, `timer_seconds`, `exam_start_time`, `allowed_late_minutes`, chính sách lưu kết quả và cấu hình tương thích cho thi thật. Chỉ Space `published = true` được người thi nhìn thấy.

### `question_sets` và `questions`

- Mỗi `question_set` thuộc một Space, hỗ trợ lưu trữ mềm bằng `hidden_at`.
- Câu hỏi chứa `question_set_id`, `order_no`, `type` (`single`/`multi`), `content`, `options_json`, `correct_json`, `question_code`, `hidden_at`, `hidden_by`, `permanent_hidden`.
- `question_code` là mã 8 chữ số được trigger `assign_question_code` cấp và không đổi.
- Câu đã được snapshot vào Đợt thi thật không được chỉnh nội dung: trigger `protect_snapshotted_question` sẽ chặn.

### `quiz_attempts`

Lưu `space_slug`, học viên, nhóm, `mode`, phương pháp chấm, điểm và breakdown, thời gian làm, số lần rời màn hình, mốc bắt đầu/nộp bài, cùng `real_exam_id`, `real_exam_code`, `real_exam_revision_id` khi là Thi thật.

### Đợt thi thật

- `real_exams`: mã thi 5 chữ số, Space, lịch, nguồn câu, tỷ lệ, giới hạn lượt, trạng thái và revision hiện tại.
- `real_exam_revisions`: lịch sử các phiên bản đề.
- `real_exam_question_refs`/`real_exam_revision_question_refs`: tham chiếu và snapshot đề.
- `real_exam_sources`/`real_exam_revision_sources`: nguồn ngân hàng và tỷ lệ lấy câu.
- `real_exam_revision_question_snapshots`: bản sao bất biến phục vụ audit và bảo toàn lịch sử khi câu gốc bị purge.

## 5. Xác thực, phân quyền và đáp án

- Supabase Auth xác thực bằng email/mật khẩu; thông tin quyền nằm ở `public.profiles`.
- Tất cả bảng liên quan đều bật RLS.
- Người thi anon chỉ đọc dữ liệu công khai và chỉ ghi attempt theo policy/RPC được phép.
- Admin phải qua `can_manage_space(space_id)`; superadmin qua `is_superadmin()`.
- `correct_json` không được cấp quyền đọc cho anon. Chỉ Edge Function `quiz-evaluate` dùng service-role nội bộ truy cập đáp án.
- Không được đưa đáp án, service-role key, hay cơ chế hash đáp án thay thế vào client.

Các RPC quan trọng: `get_space_public_status`, `get_real_exam_public`, `get_real_exam_attempt_count`, `clear_question_set_questions`, `delete_question_set_cascade`, `archive_question`, `unhide_question_set`, `hide_real_exam`, `unhide_real_exam`, `list_real_exams`, `get_real_exam_leaderboard_public`.

## 6. Chế độ làm bài

### Thi thử (`mock`)

- Người thi chọn Set, tỷ lệ câu và thời gian mỗi câu.
- Câu hỏi được Fisher–Yates shuffle từ pool đã chọn.
- Kết quả lưu Supabase; không hiện đáp án trong lúc thi.

### Luyện tập (`practice`)

- Tương tự Thi thử, có thể không giới hạn thời gian.
- Sau khi khóa câu, frontend gọi `quiz-evaluate` với action `check` để hiển thị kết quả.
- Không lưu `quiz_attempts`.

### Thi thật (`real`)

- Truy cập qua `/exam/{code}` hoặc Space hợp lệ trong thời gian thi.
- Đề dùng snapshot/revision cố định; frontend chỉ xáo thứ tự hiển thị theo thiết kế.
- Số lượt thi kiểm tra cả localStorage và RPC, lấy giá trị lớn hơn.
- Lưu attempt với code và revision. Trạng thái: `scheduled`, `active`, `paused`, `ended`, `hidden`.

## 7. Tính điểm

`calculateCompositeScore()` trong `frontend/assets/app.js` trả về đầy đủ breakdown.

| Phương pháp | Công thức |
|---|---|
| 1 – Tổng hợp | Knowledge 75 + Coverage 10 + Duration 10 + Punctuality 5 |
| 2 – Kiến thức/thời gian | Knowledge 95 + Duration 5 |

- Method 1 dùng Dice coefficient cho câu nhiều đáp án: `2TP / (2TP + FP + FN)`; trọng số multi là `min(2, 1 + 0.25 × (correctCount - 1))`.
- Method 2 chỉ tính câu multi đúng khi chọn đúng toàn bộ đáp án.
- Điểm thời gian được clamp vào giới hạn của từng phương pháp; điểm đúng giờ dựa trên `exam_start_time` và `allowed_late_minutes`.

## 8. Ngân hàng câu hỏi và CSV

- `single`: radio, đúng khi đúng một đáp án.
- `multi`: checkbox, có 2–5 đáp án đúng.
- Mỗi Space có nhiều Question Set; người thi chọn một hay nhiều Set khi mock/practice.
- CSV bắt buộc có số thứ tự, loại, nội dung, A, B, đáp án; C–E là tùy chọn. Lựa chọn phải liên tục; đáp án phải tồn tại và đúng số lượng với loại câu.

Việc import và quản lý được thực hiện ở Cloud Admin qua Supabase, không qua server upload cục bộ.

### Quản lý từng câu hỏi

- Cloud Admin hiển thị tối đa 20 câu mỗi trang trong một ngân hàng; nội dung dài hơn 256 ký tự được rút gọn trên danh sách.
- Chọn nội dung câu để xem popup gồm toàn bộ nội dung, đáp án và dấu hiệu đáp án đúng.
- Thêm mới, sửa và copy dùng chung form: nội dung plain text có xuống dòng, tối đa năm đáp án A–E, chọn loại `single` hoặc `multi`, và đánh dấu đáp án đúng.
- Danh sách có biểu tượng phân biệt `single`/`multi`; subtitle hiển thị question code và số đáp án, không in đậm nội dung câu hỏi.
- “Thêm nhiều câu hỏi” nhận free text theo từng cụm cách nhau bằng dòng trống: dòng đầu là câu hỏi (dùng `<BR>` cho xuống dòng), 2–5 dòng sau là đáp án, và `*` ở cuối dòng đánh dấu đáp án đúng. UI đánh số dòng, báo lỗi đúng dòng và chỉ xác nhận danh sách hợp lệ trước khi insert atomically. Nút AI Prompt mở màn hình thiết lập chủ đề, đối tượng/trình độ học viên, số lượng, số câu nhiều đáp án, mức độ khó và số câu dài; các trường tùy chọn bỏ trống không được đưa vào prompt.
- Danh sách hỗ trợ chọn nhiều câu hỏi bằng checkbox và xác nhận rõ danh sách trước khi gọi RPC `archive_questions`; xóa một câu gọi `archive_question`. Câu vào Thùng rác trong 30 ngày; không hard-delete. Thao tác thay đổi/xóa bị khóa khi ngân hàng là nguồn của Đợt thi thật đang diễn ra. Câu đã snapshot không thể sửa nội dung; hãy copy để tạo câu thay thế.

## 9. Luồng người thi

- Trên màn hình hẹp (điện thoại), giao diện làm bài chuyển sang bố cục một cột tối giản: chỉ giữ tiến độ, thời gian, câu hỏi, đáp án và thao tác điều hướng. Bảng xếp hạng ẩn bục vinh danh và các ô thống kê; chỉ giữ danh sách hạng, học viên/nhóm và điểm.

```text
Boot → xác định route
  ├─ /exam/{code} → get_real_exam_public(code)
  └─ /{slug} → tải Space public từ Supabase

Setup → tên + nhóm + Set + cấu hình được phép → startQuiz()
  → kiểm tra cửa sổ/lượt thi nếu real
  → chọn đề → renderQuestion()
  → practice: quiz-evaluate(check) khi khóa câu
  → submitQuiz()
     → quiz-evaluate(answers)
     → calculateCompositeScore()
     → INSERT quiz_attempts (trừ practice)
     → renderResults()
```

## 10. Chống gian lận

- Đếm một lần cho mỗi lượt rời màn hình qua `visibilitychange`/`blur`, tối đa 1000.
- Hiện cảnh báo từ ngưỡng `FOCUS_WARNING_THRESHOLD` (2).
- Lưu `focus_violation_count` cùng attempt.
- Vô hiệu context menu, copy, drag và select trên vùng `data-copy-protected`.
- Mock/real không tải đáp án xuống client trước khi nộp.

## 11. Leaderboard

- Thi thử dùng attempt `mock` trong cửa sổ thời gian hiện hành; mỗi học viên giữ kết quả cao nhất theo ngày.
- Thi thật lấy qua `get_real_exam_leaderboard_public(code)`, đối chiếu `real_exam_id` để tương thích lịch sử.
- Xếp hạng nhóm dùng trung bình kết quả tốt nhất của từng học viên; hòa điểm ưu tiên nhóm đông hơn rồi tên nhóm.
- RPC public chỉ trả cột phục vụ xếp hạng, không lộ nội dung câu hỏi hay đáp án.

## 12. Vòng đời Đợt thi thật

1. Admin tạo đợt, cấu hình nguồn và tỷ lệ.
2. Khi Start, `set_real_exam_running` build snapshot/revision nếu `needs_rebuild = true`.
3. Đề snapshot bất biến với người thi; nộp bài gắn revision.
4. Admin có thể Pause, Start lại, End hoặc Hide đợt đã kết thúc.
5. Chỉ superadmin có thể unhide.

`real_exam_status`: `hidden` ưu tiên cao nhất, sau đó `ended`, `scheduled`, `paused`, `active`.

## 13. Lưu trữ, khôi phục và purge

- Cloud UI gọi thao tác archive là “Xóa”, nhưng dữ liệu được lưu trữ mềm 30 ngày bằng `hidden_at` và `purge_after`.
- `clear_question_set_questions` luôn đặt `permanent_hidden = true`.
- Khi admin thường xóa ngân hàng, câu hỏi `permanent_hidden = true`; superadmin xóa ngân hàng đặt `false` để có thể phục hồi.
- `unhide_question_set` chỉ khôi phục câu có `permanent_hidden = false`.
- Chỉ superadmin gọi `purge_expired_question_trash(space_id)`; trước purge phải có snapshot revision tương ứng.
- Archive đợt thi không xóa nguồn, revision hay kết quả; học viên không truy cập được đợt đã archive.

## 14. Giao diện và thiết kế

- Font: `Be Vietnam Pro` với fallback `Trebuchet MS`.
- Light/Dark mode, responsive, toast tự ẩn, native dialog, progress bar và score ring.
- Tất cả màu và bề mặt giao diện dùng token trong `design-system.css`.
- Frontend và Cloud Admin đều là Vanilla JS; re-render bằng `innerHTML`, không dùng React/Vue/Angular.
- Popup cấu hình Space có nút X và điều hướng ‹/› cố định; khi có thay đổi chưa lưu, chuyển màn hình, đóng bằng X hoặc Escape đều yêu cầu xác nhận bỏ thay đổi.
- Danh sách Đợt thi thật phản hồi ngay khi đổi trạng thái lọc; tìm keyword dùng nút `Tìm kiếm`. Tab quản trị retention có nhãn `Thiết lập Database`.
- Danh sách Admin có thể cấp lại mật khẩu qua Edge Function `admin-users`: form tạo sẵn mật khẩu 8 ký tự có chữ hoa, số và ký tự đặc biệt, đồng thời cho phép hiện/ẩn trước khi Update. Triển khai thay đổi này bằng `npm run deploy:admin-users`.

## 15. Phiên bản và phát hành

- `npm run version:bump` cập nhật version timestamp, cache-busting của `frontend/index.html` và `cloud-admin/index.html`, cùng `frontend/app-version.json`.
- Chạy version bump trước khi phát hành tính năng.
- `npm run build` ghép `frontend/` và `cloud-admin/` thành `dist/`; đây là artifact để deploy static hosting.
- `npm run dev` build, theo dõi thay đổi trong `frontend/` và `cloud-admin/`, rồi phục vụ ứng dụng ở `http://127.0.0.1:8787`.
- App kiểm tra `/app-version.json` mỗi 60 giây và chỉ nhắc làm mới khi không đang làm bài.

## 16. Quy tắc phát triển bắt buộc

1. Mỗi thay đổi schema cần migration trong `supabase/`, policy/RPC liên quan và `notify pgrst, 'reload schema'` nếu cần refresh schema cache.
2. Không sửa nội dung câu đã snapshot; tạo câu mới để thay thế.
3. Không bypass RLS từ client và không đưa service-role key vào frontend.
4. Không lưu attempt ở mode `practice`.
5. Khi nguồn câu, tỷ lệ hay câu hỏi của Đợt thi thay đổi, cập nhật `needs_rebuild`; chỉ Start mới build snapshot/revision mới.
6. Khi Đợt thi đang chạy, nguồn đề bị khóa theo `real_exam_sources`; khi dừng, nguồn được mở khóa nhưng có thể yêu cầu rebuild trước lần Start sau.
7. Cập nhật tài liệu này sau mọi thay đổi đáng kể về schema, luồng nghiệp vụ, quyền, hoặc kiến trúc.
