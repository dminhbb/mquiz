# SIMPLE.QUIZ — Đặc tả kỹ thuật chi tiết (Technical Specification)

> Tài liệu này dùng để cung cấp cho AI coding agent thực hiện phát triển ứng dụng.
> Mọi quyết định thiết kế đã được chốt qua quá trình thảo luận với chủ đầu tư (owner) và kiểm tra tính nhất quán với mã nguồn thực tế.

---

## 1. Tổng quan ứng dụng

**Tên ứng dụng**: vn.Quiz

**Mục đích**: Ứng dụng web phục vụ học viên làm bài quiz theo từng "space" (nhóm kiến thức). Học viên truy cập qua link bí mật, làm bài, nhận điểm ngay trên màn hình. Superadmin/Admin quản trị nội dung quiz và người dùng quản trị thông qua một backend **chỉ chạy local** hoặc một hệ thống **Cloud Supabase** đi kèm.

**Ràng buộc kiến trúc quan trọng nhất**:
- **Chế độ Tĩnh (Local Mode)**:
  - Frontend là site **tĩnh hoàn toàn** (HTML/CSS/JS), host trên Netlify, **không có khả năng viết dữ liệu** trực tiếp lên hosting (chỉ đọc dữ liệu tĩnh).
  - Backend (Node.js + SQLite) **chỉ chạy trên máy local** của superadmin/admin, dùng để sinh ra bộ file tĩnh rồi deploy **thủ công** lên Netlify (kéo thả / Netlify CLI). Không có CI/CD tự động, không có git-based deploy.
  - Vì là static hosting, **không thể đạt bảo mật tuyệt đối** cho dữ liệu câu hỏi/đáp án. Mục tiêu là giảm thiểu rủi ro cheat ở mức hợp lý (chi tiết Mục 6), không phải là bất khả xâm phạm.
- **Chế độ Đám mây (Cloud Mode)**:
  - Nếu frontend được cấu hình kết nối tới Supabase, ứng dụng sẽ đọc cấu hình space, câu hỏi, group trực tiếp từ Cloud.
  - Kết quả làm bài và bảng xếp hạng được đồng bộ trực tuyến thời gian thực.
  - Việc đánh giá đáp án và trả về lời giải được thực hiện thông qua Supabase Edge Functions nhằm tăng tính bảo mật.

**3 đối tượng sử dụng**:
| Đối tượng | Truy cập qua | Quyền |
|---|---|---|
| Học viên | Frontend (Netlify, không cần đăng nhập) | Làm quiz qua link bí mật của space, xem Bảng xếp hạng |
| Superadmin | Backend local hoặc Cloud Admin (đăng nhập) | Toàn quyền: quản lý admin + tất cả space, backup/restore dữ liệu |
| Admin | Backend local hoặc Cloud Admin (đăng nhập) | Chỉ quản lý các space được gán |

**Yêu cầu UI chung**: giao diện hiện đại, gọn gàng, chữ to dễ nhìn, hỗ trợ light/dark mode (toggle, lưu lựa chọn).

---

## 2. Kiến trúc tổng thể & Cấu trúc Thư mục

### 2.1. Sơ đồ kiến trúc

```
┌──────────────────────────────────────────┐          	┌───────────────────────────────────────┐
│  BACKEND (local only)                     │          	│  FRONTEND (Netlify, static)      	│
│  Node.js + Express + SQLite               │  Export  	│                                   	│
│  - Login (superadmin/admin)               │  thủ công	│  /index.html                     	│
│  - Quản lý user                           │ ───────▶		│  /assets/app.js					|
│  - Quản lý space & Group                  │ (kéo thả/	│  /assets/style.css                	│
│  - Upload CSV → validate → lưu SQLite     │  Netlify 	│  /assets/supabase-config.js (nếu có)  │
│  - "Generate" → sinh file tĩnh + mã hoá   │   CLI)   	│  /_redirects                      	│
│  - "Xuất bộ deploy" (đóng gói dist/)      │          	│  /data/index.enc.js (mapping ẩn) 	│
│  - Hỗ trợ CLI và Migration sang Cloud     │          	│  /data/<token>.data.js (per space)	│
└──────────────────────────────────────────┘          	│  /data/<keytoken>.key.js (đáp án) 	│
                                                        └─────────────▲───────────▲─────────────┘
                                                                      │           │
                                                Đọc dữ liệu tĩnh (HTTP)           │ Truy cập/Lưu (HTTPS)
                                                                      │           │
                                                             Học viên ────────────┘
                                                                       (Supabase Cloud)
```

**Nguyên tắc**: 
- Ở chế độ Local, Backend là nguồn sự thật duy nhất (SQLite). Mọi thay đổi (thêm space, sửa câu hỏi, đổi cấu hình) phải qua bước **"Generate"** để sinh lại file tĩnh, sau đó **owner phải tự deploy thủ công** lên Netlify — ứng dụng phải luôn nhắc rõ điều này trên UI backend (banner "Bạn cần Export & Deploy lại để thay đổi có hiệu lực").
- Ở chế độ Cloud, cơ sở dữ liệu trên Supabase là nguồn sự thật. Thay đổi trên Cloud Admin sẽ có hiệu lực ngay lập tức đối với học viên mà không cần Generate/Deploy lại.

### 2.2. Cấu trúc thư mục mã nguồn

```
├── backend/
│   ├── data/                 # Nơi lưu SQLite database (simple-quiz.sqlite)
│   ├── dist/                 # Thư mục build tĩnh tạo ra sau khi Generate
│   ├── export/               # Lưu trữ các file deploy dạng ZIP đã xuất
│   ├── uploads/              # Thư mục tạm chứa CSV khi upload
│   └── src/
│       ├── cli-generate.js   # Công cụ CLI để chạy generate cho toàn bộ space
│       ├── config.js         # Các hằng số cấu hình hệ thống (port, session secret, admin mặc định)
│       ├── crypto-utils.js   # Các hàm băm mật mã (sha256, answerHash, randomToken)
│       ├── csv.js            # Module phân tích cú pháp và kiểm định CSV câu hỏi
│       ├── db.js             # Kết nối SQLite, chạy khởi tạo database (db migrations)
│       ├── generator.js      # Logic sinh static site (copy frontend, mã hóa câu hỏi, tạo token)
│       └── server.js         # Khởi chạy Express HTTP server & API quản trị local
├── frontend/                 # Mã nguồn Client tĩnh (SPA, vanilla JS, không build step)
│   ├── assets/
│   │   ├── app.js            # Luồng logic chính của frontend, router, State Machine & Quiz Engine
│   │   ├── style.css         # Thiết kế giao diện (hỗ trợ Light/Dark mode)
│   │   └── supabase-config.js# Cấu hình endpoint Supabase và anon key
│   ├── data/                 # Thư mục chứa dữ liệu tĩnh sau khi deploy lên hosting
│   ├── _redirects            # Cấu hình chuyển hướng cho Netlify SPA Routing
│   └── index.html            # File HTML duy nhất phục vụ client
├── cloud-admin/              # Trang quản trị đám mây (SPA quản trị trực tiếp trên Supabase)
│   ├── admin.js              # Xử lý logic nghiệp vụ quản trị đám mây
│   ├── admin.css             # Style giao diện admin cloud
│   └── index.html            # File entry point của cloud admin
├── supabase/                 # Các file SQL thiết lập Cloud Database
│   ├── cloud_admin_schema.sql# Schema các bảng (profiles, spaces, groups, questions), RLS, Backup/Restore
│   ├── quiz_attempts.sql     # Định nghĩa cấu trúc bảng lưu lịch sử thi & RLS
│   └── functions/            # Supabase Edge Functions (VD: quiz-evaluate để chấm thi bảo mật)
├── scripts/
│   └── migrate-sqlite-to-supabase.js # Script di chuyển dữ liệu từ SQLite local lên Supabase
└── package.json              # Khai báo dependency và các script NPM vận hành
```

---

## 3. FRONTEND — Yêu cầu chức năng chi tiết

### 3.1. Cấu trúc file trên production
```
/index.html              (SPA, không build step — vanilla JS)
/assets/app.js            (router + toàn bộ logic: state machine, quiz engine)
/assets/style.css         (CSS variables cho theme light/dark)
/assets/supabase-config.js(cấu hình Supabase client)
/_redirects                → nội dung: "/*    /index.html   200"
/data/index.enc.js         (mapping ẩn: hash(slug) → data_token)
/data/<data_token>.data.js (bộ câu hỏi + lựa chọn của 1 space, KHÔNG có đáp án đúng)
/data/<key_token>.key.js   (đáp án đúng của 1 space, chỉ fetch khi cần)
```

### 3.2. Routing & màn hình chào mừng
- Dùng `_redirects` để mọi path đều trả về `index.html` (SPA routing).
- `app.js` đọc `window.location.pathname`:
  - Path rỗng (`/`) → hiển thị **màn hình chào mừng**: dòng chữ "Chào mừng tới hệ thống vn.Quiz", không có liên kết/gợi ý nào tới danh sách space.
  - Path có dạng `/<slug>` (sau khi bỏ tiền tố `/preview` nếu có) → kiểm tra trạng thái trong Cloud trước (nếu Supabase được bật), sau đó tra cứu cục bộ bằng SHA-256 hash của slug trong `index.enc.js`.
  - Nếu không tồn tại hoặc space bị tắt `published` → trả về màn hình **404 error** ("Space chưa được phát hành hoặc không thể truy cập"), không fallback lung tung để tránh bị dò quét thông tin.

### 3.3. Màn hình thiết lập bài quiz (trước khi bắt đầu)
Sau khi vào đúng space, hiển thị màn hình thiết lập với các lựa chọn dạng nút bấm lớn, không dùng dropdown:
- **Thông tin học viên**:
  - Nhập **Tên học viên** (bắt buộc, trim khoảng trắng thừa đầu cuối và giữa). Lưu vào `localStorage` (`sq_student_name`).
  - Chọn **Group**: Danh sách group của space được load động. Học viên bắt buộc chọn 1 Group để tiếp tục. Lựa chọn Group được ghi nhớ riêng theo từng Space trong `localStorage`.
- **a) Số lượng câu hỏi**: Mặc định 4 mức: 30%, 50%, 70%, 100% tổng số câu hiện có (làm tròn về bội số của 5 gần nhất, tối thiểu 5 câu).
  - Công thức: `Math.min(total, Math.max(5, Math.round((total * percent / 100) / 5) * 5))`.
- **b) Chế độ làm bài**:
  - **Thi thử** và **Thi thật**: Không hiển thị đúng/sai khi đang làm, chỉ tải và chấm điểm bằng đáp án đúng (`.key.js` hoặc gọi API) sau khi hoàn thành.
  - **Luyện tập**: Cho phép chấm đúng/sai ngay sau khi khóa câu hỏi, hiển thị kèm giải thích đáp án đúng thật. Có thêm tùy chọn thời gian **Không giới hạn**.
- **c) Thời gian trả lời mỗi câu (`timer_seconds`)**:
  - Học viên được chọn các mốc: 15s, 30s, 45s, 60s, 90s, 120s. Mặc định lấy từ cấu hình space.
  - Đối với chế độ **Luyện tập**, có thể chọn **Không giới hạn** (vô hiệu hóa bộ đếm giây).
- **Xem Bảng xếp hạng**: Nút xem bảng xếp hạng kết quả thi của space này trong vòng 7 ngày gần nhất.

### 3.4. Trong lúc làm bài
- Trộn ngẫu nhiên câu hỏi bằng thuật toán Fisher-Yates shuffle. Không lặp câu hỏi.
- Hiển thị rõ loại câu hỏi trên tiêu đề: **Một đáp án** (input radio) hoặc **Nhiều lựa chọn** (input checkbox).
- Bộ đếm ngược thời gian chạy theo từng câu:
  - Hết giờ trong **Thi thử/Thi thật** → Tự động khóa câu trả lời hiện tại, chuyển sang câu kế tiếp (hoặc nộp bài nếu ở câu cuối).
  - Hết giờ trong **Luyện tập** → Khóa câu trả lời hiện tại, hiển thị đúng/sai và lời giải đáp án đúng, cho phép review không giới hạn thời gian (không tự động chuyển câu).
- Có nút **Prev** và **Next** để điều hướng linh hoạt giữa các câu hỏi.
- **Nút hành động**:
  - Nút **Trả lời** dùng để khóa đáp án đã chọn (bị disable nếu chưa chọn đáp án nào). Học viên chỉ bấm được **Next** sau khi câu hiện tại đã được khóa hoặc tự khóa do hết giờ.
  - Trong chế độ Luyện tập, nút đổi thành **Kiểm tra đáp án**, sau khi kiểm tra xong mới đổi thành **Next/Nộp bài**.
- Nút **Kết thúc làm bài** nằm ở góc dưới màn hình. Yêu cầu học viên xác nhận qua 2 popup liên tiếp:
  1. "Các câu chưa làm sẽ được tính là sai."
  2. "Bạn chắc chắn muốn kết thúc làm bài?"
- Giao diện làm bài tự co giãn (responsive) để hạn chế tối đa việc cuộn màn hình. Có thanh tiến độ (Progress bar) trực quan.

### 3.5. Màn hình kết thúc bài quiz & Cách tính điểm
- Chấm điểm và hiển thị kết quả chi tiết cho học viên.
- Chi tiết đáp án đúng chỉ được tải sau khi nộp bài (trong chế độ thi).
- Nút **Làm lại**: Xóa sạch bộ nhớ thi cũ, quay lại màn hình thiết lập.
- Ghi nhận kết quả: Nếu là **Thi thử** hoặc **Thi thật** và học viên hoàn thành hết câu hỏi, kết quả sẽ được ghi vào Supabase (nếu có cấu hình). Chế độ Luyện tập hoặc các lượt làm bài bị bấm kết thúc sớm sẽ **không lưu** lên cơ sở dữ liệu.

### 3.6. Chi tiết công thức tính Điểm Tổng hợp (Composite Score)
Điểm số lưu trữ trên Supabase và hiển thị tại bảng xếp hạng là **Điểm tổng hợp (Composite Score)** từ 0 đến 100 điểm, cấu thành bởi 4 thành phần điểm thành phần:
```
Composite_Score = clamp(Knowledge_Score + Coverage_Score + Duration_Score + Punctuality_Score, 0, 100)
```

1. **Điểm Kiến thức (Knowledge Score - tối đa 75 điểm)**:
   - Được chấm dựa trên độ chính xác đáp án của học viên so với đáp án đúng, có tính trọng số theo loại câu hỏi.
   - Với mỗi câu hỏi thứ $i$:
     - Tính độ tương đồng đáp án $F_1$ (F1-score):
       - Câu một đáp án (single choice): $F_1 = 1$ nếu chọn đúng, ngược lại $F_1 = 0$.
       - Câu nhiều lựa chọn (multi choice): Áp dụng hệ số tương đồng Sørensen–Dice:
         $$F_1 = \frac{2 \times TP}{2 \times TP + FP + FN}$$
         *Trong đó: $TP$ là số đáp án đúng được chọn; $FP$ là số đáp án sai bị chọn nhầm; $FN$ là số đáp án đúng bị bỏ sót.*
     - Trọng số câu hỏi $W_i$:
       - Câu một đáp án: $W_i = 1.0$.
       - Câu nhiều đáp án: $W_i = \min(2.0, 1.0 + 0.25 \times (C - 1))$ với $C$ là tổng số đáp án đúng thực tế của câu hỏi đó.
   - Công thức Điểm kiến thức:
     $$Knowledge\_Score = 75 \times \frac{\sum_{i} (F_1 \times W_i)}{\sum_{i} W_i}$$

2. **Điểm Quy mô đề thi (Coverage Score - tối đa 10 điểm)**:
   - Khuyến khích học viên thử thách với số lượng câu hỏi lớn hơn.
   - Công thức:
     $$Coverage\_Score = 10 \times \frac{\text{Số câu hỏi đã chọn trong lượt thi}}{\text{Tổng số câu hỏi trong ngân hàng của Space}}$$

3. **Điểm Thời gian (Duration Score - tối đa 10 điểm)**:
   - Khuyến khích phản xạ nhanh trong thời gian ngắn.
   - Định nghĩa Thời gian tối đa cho phép: $T_{max} = \text{Số câu đã chọn} \times \text{Thời gian mỗi câu}$.
   - Định nghĩa Thời gian hợp lý tối thiểu: $T_{min} = T_{max} \times 0.3$.
   - Nếu thời gian thực tế làm bài $T_{used}$ nằm trong khoảng từ $T_{min}$ đến $T_{max}$:
     $$Duration\_Score = 10 \times \text{clamp}\left(\frac{T_{max} - T_{used}}{T_{max} - T_{min}}, 0, 1\right)$$
   - Nếu $T_{max} \le T_{min}$, mặc định $Duration\_Score = 10$.

4. **Điểm Đúng giờ (Punctuality Score - tối đa 5 điểm)**:
   - Chỉ áp dụng nếu Space có cấu hình **Giờ thi chuẩn** (`exam_start_time`). Nếu không cấu hình, học viên mặc định nhận **5 điểm**.
   - Tính thời gian đi muộn $L$ (phút) so với giờ thi chuẩn đã hẹn:
     $$L = \max(0, \text{Giờ bắt đầu thi thực tế} - \text{Giờ thi chuẩn})$$
   - Công thức:
     $$Punctuality\_Score = 5 \times \max\left(0, 1 - \frac{L}{\text{allowed\_late\_minutes}}\right)$$
     *(Mặc định `allowed_late_minutes` là 30 phút)*.

---

## 4. BACKEND (Local) — Yêu cầu chức năng chi tiết

### 4.1. Stack kỹ thuật local
- Runtime: Node.js (LTS)
- Web framework: Express
- Database: SQLite qua thư viện `better-sqlite3` (chạy ở chế độ WAL để tối ưu hiệu suất ghi)
- Hash password: `bcrypt`
- Xử lý CSV: `multer` (upload) + `csv-parse` (phân tích dữ liệu)
- Session: `express-session` lưu trữ cục bộ trên server.

### 4.2. Đăng nhập & quản lý Admin
- Có 2 vai trò: `superadmin` và `admin`.
- Mật khẩu khi đăng nhập được băm lớp 1 bằng SHA-256 ở client, sau đó so khớp bằng bcrypt ở server (bảo mật 2 lớp).
- Chức năng reset mật khẩu: Admin yêu cầu reset mật khẩu → chuyển cờ `reset_password = 1` trong SQLite. Superadmin sẽ nhìn thấy biểu tượng cảnh báo ⚠️ trên danh sách và thực hiện cấp lại mật khẩu trực tiếp cho admin (không qua mail do server chạy offline).

### 4.3. Quản lý Space & Group
- CRUD Space: Tên hiển thị, slug bí mật, thời gian làm bài, giờ thi chuẩn, phút đi muộn cho phép.
- CRUD Group trong Space: Mỗi Space có tối thiểu 1 Group (mặc định trùng tên Space khi tạo mới). Hệ thống bắt buộc duy trì tối thiểu 1 group và không cho phép xóa group duy nhất cuối cùng.
- Cờ hiệu `dirty = 1` tự động bật mỗi khi cấu hình Space hoặc bộ câu hỏi thay đổi để nhắc nhở người dùng cần chạy **Generate** và **Export/Deploy**.

### 4.4. Đọc & Kiểm tra file CSV tải lên
- Cấu trúc file CSV bắt buộc:
  `Số thứ tự/TT | Loại câu hỏi | Nội dung câu hỏi | A | B | C | D | E | Đáp án đúng`
- Hỗ trợ bí danh (Header Aliases) cho phép đọc không phân biệt hoa thường và loại bỏ dấu tiếng Việt (VD: "loai cau hoi" -> `type`, "tt" -> `order_no`).
- **Quy tắc validate**:
  - Cột A và B bắt buộc phải có nội dung. C, D, E có thể trống nhưng phải liên tục (không được điền A, B, D bỏ trống C).
  - Loại câu hỏi chỉ nhận: "Một lựa chọn" hoặc "Nhiều lựa chọn".
  - Đáp án đúng của câu một lựa chọn phải có duy nhất 1 ký tự (A-E). Câu nhiều lựa chọn phải từ 2-5 ký tự phân tách bởi dấu phẩy, không trùng lặp và phải nằm trong số các cột đáp án đã điền.
  - Trim khoảng trắng toàn bộ dữ liệu trước khi validate.
  - Validate toàn bộ file, nếu có bất kỳ dòng nào lỗi thì dừng ghi nhận và báo cáo danh sách chi tiết lỗi theo từng dòng cho admin sửa.

---

## 5. Cơ chế lưu trữ Database

### 5.1. Database Schema local (SQLite)

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fullname TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT CHECK(role IN ('superadmin','admin')) NOT NULL,
  active INTEGER DEFAULT 1,
  reset_password INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE spaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  timer_seconds INTEGER NOT NULL DEFAULT 60,
  exam_start_time TEXT,
  allowed_late_minutes INTEGER NOT NULL DEFAULT 30,
  real_exam_enabled INTEGER NOT NULL DEFAULT 0,
  real_question_percent INTEGER NOT NULL DEFAULT 50,
  real_timer_seconds INTEGER NOT NULL DEFAULT 60,
  real_multi_percent INTEGER NOT NULL DEFAULT 50,
  real_max_attempts INTEGER NOT NULL DEFAULT 1,
  real_exam_version TEXT,
  real_start_at TEXT,
  real_end_at TEXT,
  data_token TEXT,
  key_token TEXT,
  key_salt TEXT,
  dirty INTEGER DEFAULT 1,
  generated_at TEXT,
  exported_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE admin_space (
  admin_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  space_id INTEGER REFERENCES spaces(id) ON DELETE CASCADE,
  PRIMARY KEY (admin_id, space_id)
);

CREATE TABLE questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id INTEGER REFERENCES spaces(id) ON DELETE CASCADE,
  order_no INTEGER NOT NULL,
  type TEXT CHECK(type IN ('single','multi')) NOT NULL,
  content TEXT NOT NULL,
  options_json TEXT NOT NULL,     -- Dạng JSON: {"A":"...","B":"...",...}
  correct_json TEXT NOT NULL      -- Dạng JSON mảng đáp án đúng: ["A","C"]
);

CREATE TABLE groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id INTEGER REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(space_id, name)
);
```

### 5.2. Database Schema Đám mây (Supabase)

Supabase Cloud sử dụng PostgreSQL làm hệ quản trị cơ sở dữ liệu. Cấu trúc bảng gần tương tự SQLite nhưng bổ sung UUID, RLS (Row Level Security) và cơ chế phân quyền bảo mật:

- `public.profiles`: Lưu tài khoản admin đồng bộ với Auth.users của Supabase.
- `public.spaces`: Lưu cấu hình space đám mây, tích hợp cờ `published` để bật/tắt hiển thị.
- `public.space_admins`: Bảng liên kết trung gian phân quyền quản lý space cho admin.
- `public.groups`: Lưu nhóm học viên theo từng space.
- `public.questions`: Lưu trữ ngân hàng câu hỏi trên cloud. RLS chỉ cho phép lấy các cột `id, space_id, order_no, type, content, options_json` đối với vai trò ẩn danh (`anon`), ẩn đi cột `correct_json`.
- `public.quiz_attempts`: Lưu kết quả làm bài thi của học viên trong vòng 7 ngày gần nhất (tự động dọn dẹp bằng Cron/SQL trigger). RLS cho phép role `anon` hoặc `authenticated` thực hiện lệnh `INSERT` nếu thỏa mãn các ràng buộc nghiệp vụ (điểm số hợp lệ, tên học viên, thời gian làm bài...).

**Một số RPC Functions nổi bật trên Supabase**:
- `get_space_public_status(requested_slug)`: Cho phép client ẩn danh kiểm tra xem một space có tồn tại và đã published hay chưa mà không cần quyền đọc trực tiếp bảng spaces.
- `prevent_last_group_delete()`: Trigger ngăn chặn việc xóa group cuối cùng của một space hoạt động trên Supabase.
- `backup_app_data()` / `restore_app_data()`: Cho phép superadmin kết xuất toàn bộ dữ liệu trên cloud thành định dạng JSON để backup hoặc import phục hồi nhanh.
- `sync_app_sequences()`: Đồng bộ lại index sequence của PostgreSQL sau khi thực hiện phục hồi dữ liệu lớn.

---

## 6. Cơ chế chống cheat / ẩn dữ liệu nâng cao

Vì ứng dụng chạy trên trình duyệt client, mục tiêu của các cơ chế bảo mật dưới đây là nâng cao độ khó để ngăn cản việc xem trước hoặc đoán mò đáp án của học viên thông thường.

### 6.1. Phân biệt Cơ chế Chạy: Local Mode vs Cloud Mode

Ứng dụng Frontend tự động phân biệt cơ chế vận hành tại hàm khởi động `boot()`:

| Nghiệp vụ | Chế độ Local (Static) | Chế độ Cloud (Supabase) |
|---|---|---|
| **Khởi động** | Tra hash của slug `sha256(slug)` trong file tĩnh `data/index.enc.js` để lấy `data_token`. | Gọi RPC `get_space_public_status` để kiểm định slug và trạng thái published trên Supabase. |
| **Tải câu hỏi** | Tải script chứa câu hỏi tĩnh từ đường dẫn `/data/<data_token>.data.js`. | Thực hiện câu truy vấn SQL qua API REST của Supabase để lấy danh sách từ bảng `questions`. |
| **Đánh giá câu (Luyện tập)** | So khớp SHA-256 của đáp án chọn kèm salt cục bộ với giá trị `check` lưu trong file `.data.js`. | Gửi yêu cầu HTTP POST để gọi Supabase Edge Function `quiz-evaluate` chạy chấm điểm độc lập trên Cloud. |
| **Tải toàn bộ đáp án** | Tải script chứa bộ key giải từ file `/data/<key_token>.key.js`. | Gọi Edge Function `quiz-evaluate` với action "answers" để tải về bộ đáp án đầy đủ. |
| **Ghi nhận lịch sử** | Không lưu trữ (hoặc lưu qua Supabase nếu học viên làm bài ở chế độ Mock và có cấu hình client). | Tự động ghi bản ghi kết quả thi trực tiếp vào bảng `quiz_attempts` trên Supabase. |

### 6.2. Thuật toán mã hóa & che giấu đáp án ở chế độ Local
- **Ẩn tên file tĩnh**: `data_token` là chuỗi hex ngẫu nhiên sinh mới hoàn toàn mỗi lần admin bấm Generate. `index.enc.js` chỉ lưu cặp key-value dạng `sha256(slug): data_token`.
- **Loại bỏ đáp án đúng khỏi file chứa câu hỏi**: File dữ liệu `<data_token>.data.js` chỉ chứa nội dung câu hỏi, các lựa chọn A-E, một chuỗi `salt` ngẫu nhiên cho từng câu và trường `check` được tính theo công thức:
  ```js
  check = sha256(sortedCorrectLetters.join(",") + perQuestionSalt)
  ```
  Nhờ đó, khi luyện tập, client có thể biết được học viên làm đúng hay sai bằng cách băm đáp án chọn của học viên với `salt` rồi so khớp với `check`, mà không cần biết đáp án chính xác là gì.
- **Tải đáp án trễ**: File chứa đáp án chính xác `<key_token>.key.js` được lưu dưới đường dẫn bí mật với:
  ```js
  key_token = sha256(data_token + key_salt)
  ```
  File này chỉ được client tải về (fetch) sau khi bài thi đã được nộp hoặc tự động nộp khi hết giờ.
- **Vô hiệu hóa chuột phải**: Ngăn chặn học viên mở Context Menu trên giao diện thi bằng code JS xử lý sự kiện `contextmenu`.

---

## 7. Quy trình Vận hành & Deploy thủ công

1. **Thay đổi dữ liệu**: Admin thực hiện các thao tác thêm sửa xóa space, group hoặc tải lên CSV câu hỏi mới trên giao diện quản trị Backend local.
2. **Cập nhật File tĩnh**: Admin bấm nút **Generate** cho space đó. Hệ thống sẽ:
   - Sinh mới `data_token`, `key_salt` và tính `key_token`.
   - Biên dịch và ghi các file tĩnh mới vào thư mục `/backend/dist/data/`.
   - Sinh lại file ánh xạ `data/index.enc.js`.
3. **Đóng gói deploy**: Admin bấm **Xuất bộ deploy**. Hệ thống nén toàn bộ thư mục `/backend/dist/` thành một file ZIP đặt tại thư mục `/backend/export/`.
4. **Đưa lên Hosting**: Người quản trị lấy file ZIP và kéo thả trực tiếp lên giao diện của Netlify (hoặc sử dụng Netlify CLI thông qua câu lệnh `netlify deploy --prod --dir=dist`) để đưa trang web lên môi trường chạy thực tế.

---

## 8. Hướng dẫn Lệnh CLI & Phát triển nhanh

Dành cho AI agent hoặc lập trình viên khi tiếp cận dự án, dưới đây là các câu lệnh có sẵn định nghĩa trong [package.json](file:///d:/git/mquiz/package.json):

- **Chạy server quản trị local**:
  ```bash
  npm run dev
  # Hoặc: npm start
  ```
  Khởi chạy Express server tại địa chỉ `http://localhost:3000/admin`. Tài khoản mặc định ban đầu là `superadmin / admin123`.

- **Chạy biên dịch tĩnh hàng loạt**:
  ```bash
  npm run generate
  ```
  Quét toàn bộ không gian làm việc (spaces) trong SQLite local để thực hiện Generate lại toàn bộ file tĩnh ra thư mục build `backend/dist`.

- **Di chuyển dữ liệu lên Cloud (Supabase Migration)**:
  ```bash
  # Thiết lập môi trường trước khi chạy
  $env:SUPABASE_URL="https://your-project.supabase.co"
  $env:SUPABASE_SERVICE_ROLE_KEY="sb_secret_your_service_role_key"
  
  # Thực hiện migration dữ liệu
  npm run migrate:cloud
  ```
  Di chuyển toàn bộ các dữ liệu về `spaces`, `groups`, và `questions` từ file SQLite cục bộ lên database đám mây trên Supabase.

---

## 9. UI/UX Design Guide

### 9.1. Font & màu sắc
- Font chữ chủ đạo: `Be Vietnam Pro` hoặc `Inter` nhằm hiển thị tốt nhất tiếng Việt có dấu. Cỡ chữ tối thiểu cho nội dung là 16px, tiêu đề câu hỏi từ 20px trở lên để đảm bảo độ rõ ràng, dễ đọc.
- Hệ thống màu sắc (Theme CSS variables) hỗ trợ Light/Dark mode tự động chuyển đổi theo cấu hình hệ điều hành hoặc do người dùng lựa chọn:

```css
:root {
  --bg: #ffffff;
  --text: #1a1a1a;
  --primary: #4f46e5;
  --correct: #16a34a;
  --wrong: #dc2626;
  --muted: #6b7280;
}
[data-theme="dark"] {
  --bg: #111827;
  --text: #f3f4f6;
  --primary: #818cf8;
  --correct: #4ade80;
  --wrong: #f87171;
  --muted: #9ca3af;
}
```

### 9.2. Bố cục các màn hình chính

- **Màn hình Chào mừng (Welcome Screen)**:
  - Cực kỳ tối giản. Hiển thị logo vn.Quiz căn giữa màn hình kèm mô tả ngắn gọn. Không hiển thị liên kết hay danh sách space để bảo mật link slug.
- **Màn hình Cấu hình (Setup Dashboard)**:
  - Bố cục kiểu sidebar chứa thông tin học viên.
  - Workspace trung tâm hiển thị các tùy chọn cấu hình bài thi: Tên học viên, Chọn Group, Chọn % câu hỏi, Chọn thời gian đếm ngược.
- **Màn hình Làm bài (Quiz Interface)**:
  - Phía trên cùng có thanh tiến độ (Progress bar) và đồng hồ đếm ngược.
  - Nội dung câu hỏi chiếm trung tâm giao diện với các nút lựa chọn lớn.
  - Phía dưới cùng chứa thanh điều hướng: nút "Prev", nút "Kiểm tra đáp án / Next / Nộp bài" và nút hủy thi "Kết thúc làm bài".
- **Màn hình Kết quả (Results Screen)**:
  - Hiển thị điểm số dạng số lớn nổi bật kèm mô hình vòng tròn màu sắc biểu thị hiệu năng.
  - Hiển thị chi tiết điểm thành phần (Kiến thức, Quy mô, Tốc độ, Đúng giờ).
  - Liệt kê toàn bộ câu hỏi đã làm: những câu làm sai được bo viền đỏ và hiển thị rõ đáp án đúng thật của câu đó để học viên tự ôn tập.
- **Giao diện Admin local & Cloud Admin**:
  - Thiết kế bảng hiện đại với sidebar điều hướng cố định: Dashboard, Quản lý Admin, Quản lý Space, Đổi mật khẩu.
  - Các chức năng thêm/sửa được thực hiện thông qua hộp thoại Modal trực quan, hạn chế chuyển hướng trang để tạo cảm giác mượt mà.

---

## 10. Tiêu chuẩn Hoàn thành (Definition of Done)

- [ ] Đường dẫn slug không tồn tại hoặc bị ẩn phát hành luôn trả về trang lỗi 404 giống hệt trang mặc định của web tĩnh.
- [ ] Trong **Chế độ Thi**, không có bất kỳ API, biến global, hay file script nào chứa đáp án đúng thật dạng plaintext được tải về browser trước khi học viên nộp bài.
- [ ] Trong **Chế độ Luyện tập**, học viên có thể tùy chọn tắt giới hạn thời gian thi. Đáp án đúng và hướng dẫn giải chỉ hiển thị sau khi học viên bấm nút khóa lựa chọn của câu hỏi đó.
- [ ] Điểm số Composite Score được tính toán chính xác theo đúng 4 thành phần điểm (Kiến thức, Quy mô, Tốc độ, Đúng giờ) và làm tròn tới 2 chữ số thập phân trước khi lưu trữ.
- [ ] Group lựa chọn của học viên được lưu trữ đầy đủ trong từng bản ghi lịch sử thi trên Supabase.
- [ ] CSV tải lên sai quy chuẩn cột hoặc logic đáp án sẽ bị hệ thống chặn hoàn toàn và chỉ ra chính xác số dòng kèm nội dung lỗi trên giao diện quản trị.
- [ ] Nút đổi màu giao diện (Dark/Light mode) hoạt động trơn tru trên mọi màn hình và ghi nhớ trạng thái sau khi tải lại trang.
- [ ] Trạng thái cờ `dirty` của Space được cập nhật chuẩn xác trong database local mỗi khi có thay đổi dữ liệu câu hỏi hoặc thông tin Space.
