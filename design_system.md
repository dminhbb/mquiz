# Hướng Dẫn Thiết Kế (Design System) - Dự án mQuiz

Tài liệu này quy định hệ thống thiết kế cho ứng dụng quản trị mQuiz, dựa trên phong cách **Chuyên nghiệp & Tương phản cao (High Contrast & Professional)**. Mọi thiết kế mới hoặc tính năng do con người hay AI Agent phát triển đều phải tuân thủ nghiêm ngặt các nguyên tắc trong tài liệu này.

## 1. Nguyên tắc cốt lõi (Core Principles)
* **Tương phản rõ nét:** Sử dụng các mảng màu tối (Dark) cho khu vực điều hướng và màu sáng (Light) cho khu vực nội dung để người dùng tập trung vào dữ liệu.
* **Tối giản & Công sở:** Không dùng các hiệu ứng gradient rườm rà hay shadow quá đậm. Tập trung vào không gian trắng (white space) và đường viền (border) tinh tế.
* **Tín hiệu thị giác rõ ràng:** Màu sắc phải đại diện cho trạng thái (Ví dụ: Đỏ/Cam cho cảnh báo, Xanh lá cho thành công, Xanh dương cho trạng thái active).

## 2. Bảng màu (Color Palette)

### 2.1. Màu chủ đạo (Primary Colors)
* **Dark Navy (`#1E293B`):** Dùng cho nền Sidebar, các Nút hành động chính (Primary Button), và tiêu đề cấp 1.
* **Vivid Cyan (`#0EA5E9`):** Dùng cho trạng thái Active trên menu, focus vào input, và các đường link.

### 2.2. Màu nền & Đường viền (Background & Borders)
* **App Background (`#F8FAFC`):** Màu nền tổng thể của khu vực nội dung chính.
* **Card/Surface (`#FFFFFF`):** Màu nền cho các khối thẻ (Cards), Panels, Popups, Form.
* **Border Light (`#E2E8F0`):** Đường viền cho các bảng biểu, input form, card bình thường.

### 2.3. Màu ngữ nghĩa (Semantic Colors)
* **Warning (`#EA580C` - Viền/Chữ) / (`#FFF7ED` - Nền):** Dùng cho các thẻ cảnh báo (VD: "Chưa có câu hỏi"), toast message cảnh báo.
* **Success (`#16A34A` - Viền/Chữ) / (`#F0FDF4` - Nền):** Dùng cho trạng thái "Đã xuất bản", toast message thành công.
* **Danger/Error (`#DC2626` - Viền/Chữ/Icon):** Dùng cho nút Xóa, thông báo lỗi, trạng thái nguy hiểm.
* **Neutral/Muted (`#64748B`):** Dùng cho văn bản phụ, chú thích, text trong ô input khi chưa nhập (placeholder).

---

## 3. Typography
* **Font chữ:** `Inter`, `Roboto` hoặc hệ thống sans-serif tiêu chuẩn.
* **Kích thước & Trọng lượng:**
  * **H1 (Page Title):** 24px, Bold, Màu Dark Navy.
  * **H2 (Card Title):** 16px, Semi-Bold, Màu Đen/Dark Navy.
  * **Body Text:** 14px, Regular, Màu Đen xám (`#334155`).
  * **Small/Caption:** 12px, Regular, Màu Muted (`#64748B`).

---

## 4. Bố cục & Cấu trúc trang (Layout)

### 4.1. Left Panel (Sidebar)
* **Chiều rộng:** Cố định ở 240px - 260px.
* **Background:** Dark Navy (`#1E293B`). Text màu Trắng (`#FFFFFF`) hoặc Xám nhạt (`#CBD5E1`).
* **Hệ thống Menu:**
  * Các mục menu có padding thoải mái (vd: `12px 16px`).
  * **Trạng thái Active:** Background màu Vivid Cyan (`#0EA5E9`), bo góc (border-radius: 8px), text màu Trắng.
  * **Trạng thái Hover:** Background sáng hơn nền một chút (`#334155`).
* **User Profile (Góc dưới):** Nằm tách biệt bằng một đường kẻ ngang hoặc một khối background màu tối hơn (`#0F172A`).

### 4.2. Main Content Area
* **Page Header:** Bao gồm Tiêu đề trang (Bên trái) và Nút hành động chính (Bên phải). Căn lề rõ ràng, có margin-bottom lớn (vd: 24px) để cách biệt với nội dung.
* **Grid System:** Dùng Flexbox hoặc CSS Grid với gap (khoảng cách) tiêu chuẩn là `16px` hoặc `24px` giữa các khối.

---

## 5. Components UI (Thành phần giao diện)

### 5.1. Panels & Content Boxes (Thẻ & Khối nội dung)
* **Card Thống kê / Nội dung:**
  * Background: Trắng (`#FFFFFF`).
  * Border: `1px solid #E2E8F0`.
  * Border-radius: `8px`.
  * Shadow: Rất nhẹ (`box-shadow: 0 1px 2px rgba(0,0,0,0.05)`).
* **Card Cảnh báo (Highlight):** Dùng border màu Semantic tương ứng (VD: Cam cho cảnh báo) và nền nhạt.

### 5.2. Nút bấm (Buttons)
* **Primary Button (Hành động chính):** Nền Dark Navy (`#1E293B`), text Trắng. Hover: Tối hơn (`#0F172A`). Bo góc 6px.
* **Secondary Button:** Nền Xám nhạt (`#F1F5F9`), text Đen (`#334155`).
* **Outline/Icon Button:** Nền Trong suốt, Border `1px solid #E2E8F0`. Text/Icon màu tương ứng. (VD: Nút Xóa có icon đỏ, viền đỏ nhạt khi hover).

### 5.3. Trạng thái (Badges/Tags)
* Hình chữ nhật bo góc mềm (border-radius: 4px hoặc 999px).
* Font size: 12px, Semi-bold.
* Background nhạt, Text đậm cùng tông (VD: Nền xanh dương nhạt + Text xanh dương đậm).

### 5.4. Hệ thống Form (Inputs)
* **Input Form (Text/Password) & Textarea:**
  * Background: Trắng.
  * Border: `1px solid #CBD5E1`. Border-radius: `6px`.
  * Padding: `8px 12px`.
  * **Trạng thái Focus:** Border đổi sang màu Vivid Cyan (`#0EA5E9`), có thể thêm `box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.2)`.
* **Dropdown List (Select):** Giao diện tương tự Input. Khi mở dropdown, menu xổ xuống có nền trắng, shadow rõ hơn (`box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1)`), các mục hover có nền xám nhạt (`#F1F5F9`).
* **Single Choice (Radio Button):** Vòng tròn. Khi chọn, có chấm bên trong màu Vivid Cyan.
* **Multi Choices (Checkbox):** Hình vuông bo góc 4px. Khi chọn, nền màu Vivid Cyan và có icon dấu check màu trắng.

### 5.5. Overlays (Popup & Toast)
* **Popup / Modal:**
  * Phủ một lớp nền đen trong suốt (`rgba(0,0,0,0.5)`) lên toàn màn hình.
  * Box Popup: Nền trắng, nằm giữa màn hình, border-radius `12px`, padding rộng rãi (24px). Có icon X để đóng ở góc trên bên phải.
* **Toast Message (Thông báo nhỏ):**
  * Nằm ở góc trên bên phải (Top-Right) hoặc giữa bên dưới (Bottom-Center).
  * Chứa icon biểu thị trạng thái (Thành công/Lỗi/Thông tin), nội dung ngắn gọn.
  * Tự động biến mất sau 3-5 giây. Border-left hoặc Background nhẹ dựa theo Semantic Colors.

---

## 6. Hướng dẫn dành cho AI Agent
Khi nhận yêu cầu thiết kế giao diện hoặc sinh mã (HTML/CSS/React/Vue...) cho một tính năng mới trong dự án này, AI Agent **BẮT BUỘC** phải:
1. Đọc và áp dụng đúng mã màu được định nghĩa tại Mục 2. KHÔNG tự ý sáng tạo màu sắc lệch khỏi bảng màu này.
2. Thiết kế Sidebar luôn mang màu tối (`#1E293B`) với mục active màu xanh sáng (`#0EA5E9`).
3. Nếu tạo form nhập liệu, input phải tuân thủ trạng thái focus màu xanh sáng.
4. Đảm bảo cấu trúc code gọn gàng, sử dụng class name mang tính hệ thống (ví dụ: Tailwind CSS được khuyến khích sử dụng vì rất phù hợp với hệ thống màu sắc và spacing này).