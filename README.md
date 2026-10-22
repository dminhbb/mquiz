# mquiz

Ứng dụng thi trắc nghiệm nội bộ, triển khai dạng static site và dùng Supabase làm lớp dữ liệu, xác thực, RPC và Edge Functions. Dự án có hai SPA độc lập:

- Người dự thi: `frontend/`, truy cập `/{space-slug}` cho Thi thử/Luyện tập hoặc `/exam/{code}` cho Thi thật.
- Quản trị: `cloud-admin/`, được build thành `/admin/` và yêu cầu Supabase Auth.

## Bắt đầu phát triển

```bash
npm install
npm run dev
```

Mở `http://127.0.0.1:8787`. Dev server tự build lại `dist/` khi `frontend/` hoặc `cloud-admin/` thay đổi và gửi cùng security header như bản phát hành. Chạy toàn bộ kiểm tra (lint, format, design, security config, test, type-check và test Edge Function, build):

```bash
npm run check
```

Build phát hành chạy `npm run build`; kết quả là `dist/`. Cloudflare Workers Static Assets sử dụng cấu hình trong `wrangler.toml`.

## Tài liệu cho người sửa đổi

- [Hướng dẫn agent](AGENTS.md): điểm vào, quy trình sửa đổi và các bất biến bắt buộc.
- [Kiến trúc](docs/ARCHITECTURE.md): luồng dữ liệu, route, ranh giới client/server và triển khai.
- [Dữ liệu Supabase](docs/SUPABASE.md): miền dữ liệu, RPC/Edge Function và cách thay đổi schema an toàn.
- [Đặc tả sản phẩm](PRODUCT.md): người dùng, phạm vi và nguyên tắc trải nghiệm.
- [Định hướng giao diện](.interface-design/system.md): token, component contract và acceptance UI.

`mquiz-project-spec.md` là đặc tả lịch sử chi tiết. Khi mâu thuẫn, mã nguồn hiện hành, migration SQL mới nhất và ba tài liệu điều hướng bên trên là nguồn chính xác hơn.
