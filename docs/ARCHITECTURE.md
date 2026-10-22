# Kiến trúc mquiz

## Toàn cảnh

```text
Người dự thi ──> frontend SPA (/{slug}, /exam/{code})
                       │
                       ├─ Supabase REST/RPC (đọc dữ liệu công khai, bảng xếp hạng)
                       ├─ Edge Function quiz-attempt (start/submit Thi thử + Thi thật: chấm điểm, lưu kết quả)
                       └─ Edge Function quiz-evaluate (phản hồi Luyện tập)

Admin ───────────> cloud-admin SPA (/admin/)
                       │
                       ├─ Supabase Auth
                       ├─ REST/RPC (quản lý theo RLS)
                       └─ Edge Function admin-users (tác vụ user đặc quyền)

Supabase ─────────> PostgreSQL + RLS + RPC + triggers + Edge Functions
```

Không có API server cục bộ. Browser dùng Supabase JS CDN và cấu hình public ở `frontend/assets/supabase-config.js`.

## Cấu trúc thư mục

```text
frontend/                 SPA người dự thi, được copy vào dist/
  index.html              shell và các CDN script
  assets/app.js           routing, state làm bài, chấm điểm, leaderboard
  assets/style.css        giao diện người dự thi
  assets/design-system.css token chung light/dark
  assets/supabase-config.js cấu hình public Supabase
cloud-admin/              SPA admin, được copy vào dist/admin/
  admin.js                auth, Space/question/exam/user/backup workflows
  admin.css               giao diện quản trị
supabase/                 lịch sử schema/RLS/RPC và Edge Functions
  functions/_shared/      scoring, validation, rate limit, truy cập dữ liệu dùng chung
tests/                    unit test (node) và test Edge Function (deno, Supabase giả)
scripts/                  build tĩnh, dev server, kiểm tra design/security, version
dist/                     output sinh ra; không sửa trực tiếp
```

## Route và luồng chính

| Route | Chủ thể | Entry state |
|---|---|---|
| `/` | công khai | Trang chào, yêu cầu URL Space hợp lệ |
| `/{slug}` | người dự thi | Nạp Space đã publish; cho mock/practice và leaderboard |
| `/exam/{code}` | người dự thi | Nạp Thi thật theo mã năm chữ số, kiểm tra lịch/lượt/revision |
| `/admin/` | admin | Đăng nhập Supabase Auth, sau đó quản lý Space và dữ liệu |

`frontend/assets/app.js` giữ state trong bộ nhớ. Khi làm Thi thật, localStorage chỉ hỗ trợ hiển thị lượt phía client; `quiz-attempt` và trigger `attach_real_exam_metadata` là nguồn kiểm tra quyền/lượt đáng tin cậy.

### Chế độ làm bài

- **Mock**: câu hỏi lấy từ ngân hàng đã chọn và được shuffle trên client; `quiz-attempt` `start` kiểm tra danh sách câu/số câu và mở session, `submit` chấm điểm và ghi `quiz_attempts`.
- **Practice**: gọi `quiz-evaluate` `check` để phản hồi từng câu và `review` để chấm màn kết quả; không tạo session hay `quiz_attempts`.
- **Real**: đề lấy từ snapshot/revision của `real_exams`; `start` kiểm tra lịch thi, trạng thái và số lượt (khóa advisory trong `start_quiz_attempt_session`), kết quả gắn `real_exam_id`, mã đề và revision.

### Luồng `start` → `submit`

1. Client chọn câu hỏi, gọi `quiz-attempt` `start`; server xác thực tên/group/danh sách câu, ghi `quiz_attempt_sessions` (thời điểm bắt đầu, câu hỏi, timer, scoring method do server cố định) và trả `attempt_id`. Với Thi thật, lượt thi được tính ngay khi bắt đầu.
2. Khi nộp, client chỉ gửi lựa chọn. Server "claim" session (chống nộp lặp), kiểm tra tổng thời gian cho phép (`số câu × timer × 1,5 + 120 s`), chấm điểm bằng `_shared/scoring.ts`, ghi `quiz_attempts` bằng service role rồi trả điểm, đúng/sai và đáp án để xem lại. Nếu ghi thất bại, session được nhả để thử lại.
3. Trình duyệt không có quyền `insert` vào `quiz_attempts`; trigger `attach_real_exam_metadata` vẫn kiểm tra lại lịch và giới hạn lượt ở tầng database.

Rủi ro còn lại (không có đăng nhập cho người thi): tên học viên không xác thực, nên có thể mạo danh và tiêu hao lượt người khác; giới hạn tần suất theo IP và kiểm tra `focus_violation_count` do client báo chỉ giảm thiểu, không loại bỏ.

## Điểm vào theo loại thay đổi

| Thay đổi | Thành phần thường liên quan |
|---|---|
| Screen/routing người thi | `frontend/assets/app.js`, `style.css` |
| Leaderboard công khai | `app.js`, `get_real_exam_leaderboard_public` |
| Workflow Space/câu hỏi | `cloud-admin/admin.js`, schema/RLS/RPC liên quan |
| Workflow Thi thật | `admin.js`, `real_exams_v2.sql`, `real_exam_revisions.sql`, `real_exam_rebuild.sql`, `archive_lifecycle.sql` |
| Chấm hoặc xác thực kết quả | `supabase/functions/quiz-evaluate/index.ts` |
| Quản trị user | `supabase/functions/admin-users/index.ts`, `profiles`, `space_admins` |
| UI dùng chung | `design-system.css`, `.interface-design/system.md` |
| Deploy/routing static | `scripts/build-static.js`, `scripts/dev-static.js`, `wrangler.toml` |

## Build và phát hành

`npm run build` chạy `scripts/build-static.js`: xóa/tạo lại `dist/`, copy `frontend/` (gồm `_headers`), bỏ `_redirects`, rồi copy `cloud-admin/` vào `dist/admin/`. Cờ `--out <dir>`, `--keep-redirects`, `--spa-404` phục vụ các đường phát hành khác (`build-cloudflare.sh`, `package-cloudflare.bat`, GitHub Pages) để tất cả dùng chung một logic build. `npm run dev` vừa build vừa phục vụ `127.0.0.1:8787` với SPA fallback—`/admin/*` trả shell admin, các route khác trả shell người thi.

Cloudflare dùng `wrangler.toml` với `assets.directory = "./dist"` và SPA fallback; `_headers` được Cloudflare áp dụng (CSP, nosniff, X-Frame-Options, Referrer-Policy). `_redirects` chỉ dành cho deployment tĩnh kiểu Netlify nên bị loại khỏi build Cloudflare. GitHub Pages (`deploy-pages.yml`) không gửi được header tùy biến, vì vậy chỉ coi là bản sao phụ.

CSP cho phép `connect-src` tới origin Supabase trong `supabase-config.js`; đổi project Supabase thì phải sửa `frontend/_headers` (`npm run security:check` sẽ báo nếu lệch).

CI (`.github/workflows/ci.yml`) chạy `npm run check` và `npm run audit:deps` cho mỗi pull request và push vào `main`.
