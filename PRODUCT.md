# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: Nhân viên / người đi làm** thi nội bộ trong môi trường tổ chức — ôn tập chứng chỉ nghề nghiệp, thi đánh giá năng lực, hoặc hoàn thành đào tạo nhân sự theo yêu cầu. Họ làm bài trong giờ làm việc, thường trên máy tính bàn hoặc laptop; đôi khi trên điện thoại khi di chuyển. Kỳ vọng của họ: giao diện không gây lo lắng, không có sự phân tâm, thời gian đếm ngược rõ ràng, và kết quả trung thực.

**Secondary: Admin / Superadmin** — người quản lý ngân hàng câu hỏi, tạo Đợt thi, theo dõi kết quả và vận hành hệ thống. Họ cần mật độ thông tin cao hơn, thao tác nhanh và phản hồi lỗi chi tiết. Không cần "đẹp" — cần chính xác và tin cậy.

## Product Purpose

mquiz là nền tảng thi trắc nghiệm nội bộ dành cho tổ chức, hoạt động hoàn toàn trên cloud (Supabase). Nó cho phép tổ chức:
- Tạo và quản lý ngân hàng câu hỏi nhiều lựa chọn (single/multi answer)
- Tổ chức thi theo 3 chế độ: **Thi thử** (mock), **Luyện tập** (practice), **Thi thật** (real)
- Kiểm soát chặt chẽ quá trình thi: window thời gian, giới hạn lượt, chống gian lận cơ bản, snapshot đề bất biến
- Xem kết quả và bảng xếp hạng công khai ngay sau khi nộp bài

Thành công với người dùng cuối: hoàn thành bài thi một lần, không bị gián đoạn, nhận kết quả rõ ràng và tin được.

## Positioning

Công cụ thi nội bộ white-label dành riêng cho một tổ chức — không phải SaaS đa khách hàng. Điểm khác biệt: kiến trúc zero-backend (Supabase trực tiếp), đáp án không bao giờ xuống client, kết quả tính điểm có trọng số composite (knowledge + coverage + duration + punctuality). Sản phẩm "thi thật" với snapshot bất biến và audit trail là tính năng mà hệ thống Google Form hay Kahoot không có.

## Operating Context

- Thi được truy cập qua URL dạng `/{slug}` hoặc `/exam/{code}` — không cần đăng nhập cho người thi
- Admin truy cập qua `/admin/` với Supabase Auth
- Tổ chức chạy nhiều Space (đề thi theo chủ đề/phòng ban); mỗi Space có nhiều Question Set
- Đợt thi thật có lịch chính xác, giới hạn lượt, và trạng thái vận hành (scheduled → active → paused → ended → hidden)
- Người thi không cần tài khoản — chỉ nhập tên và nhóm trước khi bắt đầu
- Môi trường làm việc: thường là văn phòng, màn hình 1280px+; mobile là fallback

## Capabilities and Constraints

**Đang có:**
- 3 chế độ thi: mock (thi thử, lưu kết quả), practice (luyện tập, không lưu, hiện đáp án từng câu), real (thi chính thức, snapshot cố định)
- Hệ thống tính điểm composite 2 phương pháp; hỗ trợ câu nhiều đáp án với Dice coefficient
- Chống gian lận: đếm lượt rời màn hình, block copy/right-click, đáp án không có trên client
- Light/dark mode; responsive (mobile rút gọn UI)
- Bảng xếp hạng real-time theo cá nhân và nhóm
- Import câu hỏi qua CSV và free-text bulk entry

**Ràng buộc kỹ thuật:**
- Vanilla HTML/CSS/JS (IIFE), không React/Vue/Angular — re-render bằng innerHTML
- Không thêm backend cục bộ; mọi dữ liệu qua Supabase REST/RPC/Edge Functions
- Màu sắc và surface bắt buộc dùng token CSS từ `design-system.css`; không dùng hex/rgb trực tiếp
- `transition: all` bị cấm; chỉ animate `transform`/`opacity` trong 100–220ms

**Chưa quyết định:**
- Sẽ mở rộng multi-tenant trong tương lai — hiện tại vẫn là white-label nội bộ.
- Không có native mobile app. Tuy nhiên, student UI phải responsive tốt trên điện thoại: đơn giản, friendly, one-thumb usable.

## Brand Commitments

- **Tên sản phẩm**: `mquiz` (chữ thường)
- **Font**: `Be Vietnam Pro` — hỗ trợ tiếng Việt tốt, cảm giác chính xác nhưng không lạnh
- **Accent duy nhất**: `--pen-blue` (#315f88 light / #8ab2d1 dark) — màu bút xanh, gợi lên việc viết bài thi truyền thống
- **Palette nền**: warm exam-paper (kem vàng nhạt) cho light mode; dark green-gray cho dark mode
- **Ký hiệu đặc trưng**: Answer strip — dải ô vuông theo dõi tiến độ làm bài, ngôn ngữ visual core của sản phẩm
- **Giọng điệu**: Trực tiếp, chính xác, không hoa mỹ — như đề thi được soạn kỹ càng

## Evidence on Hand

- Spec đầy đủ: `mquiz-project-spec.md`
- Design system tokens: `frontend/assets/design-system.css`
- Interface direction: `.interface-design/system.md`
- Frontend source: `frontend/assets/style.css` (~66KB), `frontend/assets/app.js` (~76KB)
- Admin source: `cloud-admin/admin.css`, `cloud-admin/admin.js`
- Không có ảnh chụp màn hình thực tế đính kèm (cần chạy `npm run dev` để xem)

## Product Principles

1. **Không gian tĩnh lặng, ít nhiễu** — Người thi đang trong trạng thái tập trung; mọi yếu tố giao diện không phục vụ câu hỏi hoặc điều hướng là nhiễu cần loại bỏ.
2. **Số liệu trung thực, không che giấu** — Điểm số, thời gian, và trạng thái phải luôn hiển thị chính xác và ngay lập tức. Không animation che phủ dữ liệu.
3. **Thi thật nghiêm túc** — Snapshot bất biến, audit trail, và giới hạn lượt là tính năng, không phải hạn chế. Giao diện phải truyền cảm giác chính thức và đáng tin cậy.
4. **Admin hiệu quả hơn đẹp** — Giao diện quản trị ưu tiên mật độ thông tin và thao tác nhanh; thẩm mỹ phục vụ khả năng đọc, không phục vụ ấn tượng.
5. **Token-first, không hardcode** — Mọi quyết định màu sắc và surface phải đến từ design system tokens để đảm bảo dark mode, khả năng mở rộng và kiểm tra tự động.

## Accessibility & Inclusion

- Tiếng Việt là ngôn ngữ duy nhất (`lang="vi"`)
- Skip link có mặt trên cả hai SPA
- Focus-visible ring trên tất cả interactive elements
- `prefers-reduced-motion` được tôn trọng — animation rút xuống 0.01ms
- Hit target tối thiểu: 44px cho student view, 40px cho admin view
- Tabular figures bắt buộc cho số đếm ngược, điểm số, số thứ tự câu

