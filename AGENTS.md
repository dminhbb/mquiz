# Hướng dẫn làm việc với mquiz

## Bản đồ nhanh

| Khi cần thay đổi | Đọc/sửa trước |
|---|---|
| Trải nghiệm người dự thi | `frontend/assets/app.js`, `frontend/assets/style.css` |
| Trải nghiệm quản trị | `cloud-admin/admin.js`, `cloud-admin/admin.css` |
| Token/chủ đề dùng chung | `frontend/assets/design-system.css` |
| Quy tắc UI | `.interface-design/system.md` |
| Dữ liệu, quyền hoặc nghiệp vụ server | `supabase/*.sql`, `supabase/functions/` |
| Build/route/phát hành | `scripts/`, `wrangler.toml` |

Đọc [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) và [docs/SUPABASE.md](docs/SUPABASE.md) trước khi sửa luồng nghiệp vụ hoặc Supabase.

## Kiến trúc và quy ước mã nguồn

- Cả hai UI là Vanilla HTML/CSS/JavaScript theo IIFE. Chúng render bằng `innerHTML`, sau đó gắn event handler. Không thêm framework hay bundler nếu yêu cầu không thật sự cần.
- `frontend/index.html` là shell của SPA người thi; `cloud-admin/index.html` là shell admin. Build copy chúng lần lượt thành `/` và `/admin/`.
- `supabase-config.js` chỉ chứa URL và **publishable/anon key**. Không đưa service-role key, đáp án hay cơ chế thay thế đáp án vào client.
- Hỗ trợ mã nguồn UTF-8. Nội dung tiếng Việt hiển thị bị lỗi encoding trong một vài file lịch sử không phải là lý do để đổi encoding hàng loạt.
- `dist/`, file zip và `node_modules/` là output/phụ thuộc, không chỉnh trực tiếp.
- Script CDN trong `index.html` phải ghim phiên bản chính xác và có SRI; `frontend/_headers` chứa CSP/security header (`npm run security:check` bảo vệ cả hai). Khi thêm domain bên ngoài, cập nhật CSP tương ứng.

## Bất biến nghiệp vụ và bảo mật

1. `correct_json` không được trả về cho người dùng anon. Đáp án chỉ do Edge Function dùng service role trả: `quiz-evaluate` (`check`/`review`, chỉ Luyện tập) và `quiz-attempt` (`submit`, sau khi nộp bài). Không thêm endpoint trả đáp án hàng loạt.
2. Thi thật dùng revision/snapshot bất biến. Không sửa câu đã được snapshot; copy hoặc tạo câu mới. Mọi thay đổi nguồn đề phải giữ lịch sử revision và khóa thời điểm thi ở database.
3. Luyện tập (`practice`) hiển thị phản hồi từng câu nhưng không lưu attempt. Thi thử (`mock`) và Thi thật (`real`) lưu `quiz_attempts`, và **chỉ** Edge Function `quiz-attempt` được ghi bảng này: trình duyệt không có quyền `insert`. Điểm, thời gian bắt đầu, thời lượng và giới hạn lượt do server tính/kiểm tra (`start` mở session, `submit` chấm điểm); client chỉ hiển thị kết quả. Công thức chấm điểm nằm ở `supabase/functions/_shared/scoring.ts`.
4. Enforcement về quyền, giới hạn lượt, lịch thi, archive/hide và khả năng sửa đề phải nằm trong RLS/RPC/trigger; UI chỉ phản ánh trạng thái đó.
5. Mọi truy vấn anon mới phải được kiểm tra với RLS thực tế; không truy vấn cột hoặc bảng chỉ dành cho admin.

## Quy tắc UI

- Dùng token semantic từ `frontend/assets/design-system.css`; không thêm màu hex/rgb trong phần override được quản trị.
- Không dùng `transition: all`; chỉ animate `transform`/`opacity`, 100–220ms, đồng thời tôn trọng reduced motion.
- Giữ skip link, focus-visible, nhãn field, loading/empty/error state và hit target tối thiểu (44px người thi, 40px admin).
- Với thay đổi UI, đọc `.interface-design/system.md`, chạy `npm run design:check`, và kiểm tra tối thiểu tại 360px, 768px, 1280px.

## Thay đổi Supabase

- `supabase/` là tập các script SQL đã áp dụng theo lịch sử, không phải thư mục migration có thứ tự tự động. Không sửa migration cũ chỉ để thay đổi production state.
- Cho thay đổi mới, thêm một file SQL đặt tên mô tả, idempotent khi khả thi, chứa schema/RLS/grant/revoke/trigger liên quan và nêu thứ tự áp dụng trong pull request hoặc handoff.
- Trước khi đổi RPC hoặc Edge Function, tìm tất cả nơi gọi trong `frontend/assets/app.js` và `cloud-admin/admin.js`.
- Deploy function: `npm run deploy:quiz-attempt`, `npm run deploy:quiz-evaluate` hoặc `npm run deploy:admin-users`. SQL cần được áp dụng bằng quy trình Supabase của môi trường, không có lệnh migrate tự động trong `package.json`.

## Kiểm tra trước khi bàn giao

```bash
npm run check   # lint, format, design, security config, test, deno check, test Edge Function, build
```

`npm run check` gồm `npm run lint`, `format:check`, `design:check`, `security:check`, `test`, `check:functions` (`deno check`), `test:functions` và `build`. Chạy thêm `npm run audit:deps` khi đổi dependency. Tiêu chuẩn mã hoá chung và phần áp dụng cho mquiz nằm ở [CODING_STANDARD_AI.md](CODING_STANDARD_AI.md) (mục 8).

Khi thay đổi `frontend/` hoặc `cloud-admin/` để phát hành, chạy `npm run version:bump` để người dùng nhận thông báo làm mới.

Khi thay đổi có liên quan Supabase, kiểm tra thêm quyền RLS, payload RPC/function và đường đi thành công/lỗi trên UI.
