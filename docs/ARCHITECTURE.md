# Kiến trúc mquiz

## Toàn cảnh

```text
Người dự thi ──> frontend SPA (/{slug}, /exam/{code})
                       │
                       ├─ Supabase REST/RPC (dữ liệu công khai, attempts)
                       └─ Edge Function quiz-evaluate (chấm đáp án)

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
scripts/                  build tĩnh, dev server, kiểm tra design, version
dist/                     output sinh ra; không sửa trực tiếp
```

## Route và luồng chính

| Route | Chủ thể | Entry state |
|---|---|---|
| `/` | công khai | Trang chào, yêu cầu URL Space hợp lệ |
| `/{slug}` | người dự thi | Nạp Space đã publish; cho mock/practice và leaderboard |
| `/exam/{code}` | người dự thi | Nạp Thi thật theo mã năm chữ số, kiểm tra lịch/lượt/revision |
| `/admin/` | admin | Đăng nhập Supabase Auth, sau đó quản lý Space và dữ liệu |

`frontend/assets/app.js` giữ state trong bộ nhớ. Khi làm Thi thật, localStorage chỉ hỗ trợ theo dõi lượt phía client; RPC là nguồn kiểm tra quyền/lượt đáng tin cậy.

### Chế độ làm bài

- **Mock**: câu hỏi lấy từ ngân hàng đã chọn, shuffle trên client, nộp kết quả vào `quiz_attempts`.
- **Practice**: gọi `quiz-evaluate` với action kiểm tra từng câu để hiển thị phản hồi; không tạo `quiz_attempts`.
- **Real**: đề lấy từ snapshot/revision của `real_exams`; kết quả gắn `real_exam_id`, mã đề và revision.

Điểm composite được tính tại `calculateCompositeScore()` trong `frontend/assets/app.js`; việc đối chiếu đáp án luôn do `quiz-evaluate` thực hiện.

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

`npm run build` chạy `scripts/build-static.js`: xóa/tạo lại `dist/`, copy `frontend/`, bỏ `_redirects`, rồi copy `cloud-admin/` vào `dist/admin/`. `npm run dev` vừa build vừa phục vụ `127.0.0.1:8787` với SPA fallback—`/admin/*` trả shell admin, các route khác trả shell người thi.

Cloudflare dùng `wrangler.toml` với `assets.directory = "./dist"` và SPA fallback. `_redirects` chỉ dành cho deployment tĩnh kiểu Netlify nên bị loại khỏi build Cloudflare.
