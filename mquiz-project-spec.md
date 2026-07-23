# mquiz – Tài liệu Đặc tả Dự án

> Tài liệu này mô tả toàn diện hệ thống mquiz: kiến trúc, chức năng, cấu trúc dữ liệu, logic nghiệp vụ, bảo mật và giao diện. Dùng làm ngữ cảnh nền tảng khi phát triển mở rộng bằng AI.

---

## 1. Tổng quan Hệ thống

**mquiz** (hay *simple-quiz*) là nền tảng thi trắc nghiệm tiếng Việt, hỗ trợ ba chế độ: **Thi thử (mock)**, **Luyện tập (practice)** và **Thi thật (real)**. Hệ thống có hai deployment mode:

| Mode | Mô tả |
|---|---|
| **Local (Offline)** | Backend Node.js + SQLite + export file tĩnh HTML/JS |
| **Cloud** | Netlify (frontend tĩnh) + Supabase (PostgreSQL + Auth + Edge Functions) |

### Ngôn ngữ & Công nghệ

| Lớp | Công nghệ |
|---|---|
| Frontend (giao diện thi) | Vanilla HTML + CSS + JavaScript (IIFE, không framework) |
| Backend local (admin) | Node.js, Express, better-sqlite3, bcrypt, multer, archiver |
| Cloud admin | Vanilla JS được nhúng inline trong server.js (adminHtml()) |
| Database local | SQLite qua better-sqlite3 |
| Database cloud | Supabase (PostgreSQL) với Row Level Security (RLS) |
| Edge Functions | Deno/TypeScript chạy trên Supabase Edge Functions |
| Auth cloud | Supabase Auth (JWT + anon key) |
| Hosting | Netlify (static), hoặc server Node.js tự chạy |

---

## 2. Kiến trúc Tổng thể

```
┌──────────────────────────────────────────────────────────────┐
│                       NGƯỜI DÙNG THI                         │
│  Browser → /slug hoặc /exam/NNNNN                            │
│  frontend/assets/app.js (IIFE, ~1466 dòng)                  │
│  ├── Tải Space data từ Supabase hoặc file .data.js tĩnh      │
│  ├── Gọi Edge Function quiz-evaluate (check/answers)         │
│  └── Lưu kết quả vào quiz_attempts (Supabase)               │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                    ADMIN (LOCAL BACKEND)                      │
│  http://localhost:3000/admin                                  │
│  backend/src/server.js (Express, ~684 dòng)                  │
│  ├── Quản lý Users, Spaces, Groups, Questions, Sets           │
│  ├── Import CSV câu hỏi                                       │
│  ├── Generate file tĩnh (dist/) + export ZIP                  │
│  └── SQLite: backend/data/simple-quiz.sqlite                  │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                    CLOUD ADMIN                                │
│  /cloud-admin/ (admin.js + admin.css)                        │
│  Gọi Supabase RPC functions để:                              │
│  ├── Quản lý Spaces, Question Sets, Questions                 │
│  ├── Tạo và quản lý Đợt thi thật (real_exams)               │
│  └── Xem bảng xếp hạng và xuất kết quả                      │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                    SUPABASE                                   │
│  ├── PostgreSQL: spaces, questions, quiz_attempts, ...        │
│  ├── RLS Policies (anon chỉ đọc public, authenticated manage) │
│  ├── Edge Function: quiz-evaluate (Deno/TypeScript)           │
│  └── Auth: profiles (superadmin / admin)                      │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Cấu trúc Thư mục Dự án

```
mquiz/
├── frontend/                    # Giao diện thi (HTML + CSS + JS tĩnh)
│   ├── index.html               # Entry point duy nhất (SPA)
│   ├── app-version.json         # Phiên bản app, dùng để auto-reload
│   ├── assets/
│   │   ├── app.js               # Toàn bộ logic giao diện thi (~1466 dòng)
│   │   ├── style.css            # CSS giao diện thi (~56KB)
│   │   ├── design-system.css    # Design tokens
│   │   ├── supabase-config.js   # URL + anon key Supabase
│   │   └── favicon.svg
│   └── data/                    # Thư mục chứa .data.js và .key.js (tạo ra lúc generate)
│
├── backend/                     # Backend local (Node.js + Express)
│   ├── src/
│   │   ├── server.js            # Express app, toàn bộ API routes (~684 dòng)
│   │   ├── db.js                # SQLite schema + helper functions
│   │   ├── generator.js         # Tạo file tĩnh và ZIP deploy
│   │   ├── csv.js               # Parse và validate CSV câu hỏi
│   │   ├── config.js            # Cấu hình paths, port, superadmin
│   │   ├── crypto-utils.js      # sha256, randomToken, answerHash
│   │   └── app-version.js       # Stamp version khi export
│   ├── data/
│   │   └── simple-quiz.sqlite   # SQLite database (tạo tự động)
│   ├── dist/                    # Output tạo ra bởi generate (serve preview)
│   └── export/                  # ZIP file để deploy
│
├── cloud-admin/                 # Cloud Admin UI (vanilla JS)
│   ├── admin.js                 # Toàn bộ logic cloud admin (~128KB)
│   ├── admin.css                # CSS cloud admin (~52KB)
│   └── index.html               # Entry point cloud admin
│
├── supabase/                    # SQL migrations và Edge Functions
│   ├── quiz_attempts.sql        # Schema bảng quiz_attempts (gốc)
│   ├── add_quiz_attempt_metadata.sql  # Migration thêm cột metadata
│   ├── cloud_admin_schema.sql   # Schema đầy đủ cho cloud (profiles, spaces, questions…)
│   ├── real_exams_v2.sql        # Schema Đợt thi thật (real_exams, snapshots...)
│   ├── real_exam_revisions.sql  # Schema Revision của Đợt thi thật
│   ├── fix_quiz_attempt_policy.sql   # RLS policy fix
│   ├── add_permanent_hidden.sql # Migration: cột permanent_hidden + hàm unhide
│   └── functions/
│       ├── quiz-evaluate/       # Edge Function chấm bài (check + answers)
│       └── admin-users/         # Edge Function quản lý users cloud
│
└── scripts/                     # Scripts tiện ích
```

---

## 4. Cấu trúc Dữ liệu

### 4.1 SQLite (Backend Local)

#### Bảng `users`
| Cột | Kiểu | Mô tả |
|---|---|---|
| id | INTEGER PK | Auto increment |
| fullname | TEXT | Họ tên đầy đủ |
| username | TEXT UNIQUE | Tên đăng nhập |
| password_hash | TEXT | bcrypt hash (client SHA-256 + server bcrypt) |
| role | TEXT | `superadmin` hoặc `admin` |
| active | INTEGER | 1 = hoạt động |
| reset_password | INTEGER | 1 = cần đổi mật khẩu |
| created_at | TEXT | Timestamp |

#### Bảng `spaces`
| Cột | Kiểu | Mô tả |
|---|---|---|
| id | INTEGER PK | |
| name | TEXT | Tên Space |
| slug | TEXT UNIQUE | URL slug (a-z, 0-9, dấu gạch) |
| timer_seconds | INTEGER | Thời gian mỗi câu (giây), mặc định 60 |
| exam_start_time | TEXT | Giờ thi dự kiến (HH:MM) để tính điểm đúng giờ |
| allowed_late_minutes | INTEGER | Số phút trễ được chấp nhận, mặc định 30 |
| real_exam_enabled | INTEGER | 1 = bật chế độ Thi thật |
| real_question_percent | INTEGER | % câu hỏi Thi thật (30/50/70/100) |
| real_timer_seconds | INTEGER | Thời gian mỗi câu Thi thật (45/60/90/120) |
| real_multi_percent | INTEGER | % câu nhiều đáp án trong Thi thật |
| real_max_attempts | INTEGER | Số lượt thi tối đa (1-5) |
| real_scoring_method | INTEGER | 1 = tổng hợp, 2 = kiến thức+thời gian |
| real_exam_version | TEXT | UUID thay đổi mỗi khi thi thật cập nhật |
| real_start_at | TEXT | Thời gian bắt đầu Thi thật (ISO 8601) |
| real_end_at | TEXT | Thời gian kết thúc Thi thật |
| data_token | TEXT | Token file .data.js đã generate |
| key_token | TEXT | Token file .key.js đã generate |
| key_salt | TEXT | Salt cho key_token |
| dirty | INTEGER | 1 = cần generate lại |
| generated_at | TEXT | Thời điểm generate cuối |
| exported_at | TEXT | Thời điểm export cuối |

#### Bảng `questions`
| Cột | Kiểu | Mô tả |
|---|---|---|
| id | INTEGER PK | |
| space_id | INTEGER FK | Tham chiếu spaces.id |
| order_no | INTEGER | Thứ tự sắp xếp |
| type | TEXT | `single` hoặc `multi` |
| content | TEXT | Nội dung câu hỏi |
| options_json | TEXT | JSON object `{A, B, C, D, E}` |
| correct_json | TEXT | JSON array đáp án đúng, ví dụ `["A","C"]` |

#### Bảng `groups`
| Cột | Kiểu | Mô tả |
|---|---|---|
| id | INTEGER PK | |
| space_id | INTEGER FK | |
| name | TEXT | Tên group |

#### Bảng `admin_space`
| Cột | Mô tả |
|---|---|
| admin_id | FK → users.id |
| space_id | FK → spaces.id |

---

### 4.2 PostgreSQL / Supabase (Cloud)

#### Bảng `profiles`
| Cột | Kiểu | Mô tả |
|---|---|---|
| id | UUID PK | Liên kết auth.users |
| email | TEXT | |
| fullname | TEXT | |
| role | TEXT | `superadmin` hoặc `admin` |
| active | BOOLEAN | |

#### Bảng `spaces`
Tương tự SQLite nhưng:
- `id` dùng `bigint generated by default as identity`
- Thêm `published BOOLEAN` (chỉ space published mới hiển thị công khai)
- Thêm `mock_result_retention_days` (3–15 ngày, mặc định 7)
- Thêm `real_result_retention_exams` (3–15 đợt, mặc định 7)
- Thêm `real_exam_name TEXT`, `real_question_sets JSONB`

#### Bảng `question_sets`
| Cột | Mô tả |
|---|---|
| id | BIGINT PK |
| space_id | FK → spaces.id |
| name | TEXT |
| hidden_at | TIMESTAMPTZ (soft delete) |

#### Bảng `questions` (Cloud)
| Cột | Mô tả |
|---|---|
| id | BIGINT PK |
| space_id | FK → spaces.id |
| question_set_id | FK → question_sets.id |
| order_no | INTEGER |
| type | `single` / `multi` |
| content | TEXT |
| options_json | JSONB |
| correct_json | JSONB |
| question_code | INTEGER UNIQUE (8 chữ số, cố định vĩnh viễn) |
| hidden_at | TIMESTAMPTZ (soft delete) |
| hidden_by | UUID FK → auth.users |
| permanent_hidden | BOOLEAN DEFAULT false — Nếu `true`, câu hỏi không được khôi phục khi ngân hàng được unhide |

> **Quan trọng:** `question_code` được cấp tự động qua trigger `assign_question_code`. Câu hỏi đã snapshot vào Đợt thi thật **KHÔNG được sửa nội dung** (trigger `protect_snapshotted_question` sẽ raise exception).

> **`permanent_hidden` flag:** Cờ này được đặt `true` khi câu hỏi bị xóa bởi thao tác "Xóa toàn bộ câu hỏi" (mọi role) hoặc "Xóa ngân hàng" bởi admin thường. Khi superadmin xóa ngân hàng, cờ được đặt `false` để có thể khôi phục về sau.

#### Bảng `quiz_attempts`
| Cột | Kiểu | Mô tả |
|---|---|---|
| id | UUID PK | |
| space_slug | TEXT | Slug của space |
| student_name | TEXT | Tên học viên (tối đa 80 ký tự) |
| student_name_key | TEXT | lowercase để so sánh không phân biệt hoa thường/dấu |
| group_name | TEXT | Group của học viên |
| mode | TEXT | `mock`, `practice`, `real` |
| scoring_method | INTEGER | 1 hoặc 2 |
| score | NUMERIC(5,2) | Điểm tổng (0–100) |
| total_questions | INTEGER | Số câu trong bài thi |
| bank_question_count | INTEGER | Tổng câu trong ngân hàng lúc thi |
| correct_count | INTEGER | Số câu đúng |
| wrong_count | INTEGER | Số câu sai |
| multi_correct_count | INTEGER | Số câu multi trả lời hoàn toàn đúng |
| multi_similarity_score | NUMERIC(8,2) | Tổng điểm similarity câu multi |
| duration_seconds | INTEGER | Tổng thời gian làm bài |
| timer_seconds | INTEGER | Thời gian mỗi câu cấu hình |
| knowledge_score | NUMERIC(5,2) | Điểm kiến thức (≤75 hoặc ≤95) |
| coverage_score | NUMERIC(5,2) | Điểm độ phủ (≤10) |
| duration_score | NUMERIC(5,2) | Điểm thời gian (≤10 hoặc ≤5) |
| punctuality_score | NUMERIC(5,2) | Điểm đúng giờ (≤5) |
| focus_violation_count | INTEGER | Số lần rời màn hình thi |
| started_at | TIMESTAMPTZ | Thời điểm bắt đầu |
| submitted_at | TIMESTAMPTZ | Thời điểm nộp bài |
| real_exam_id | BIGINT FK | Liên kết real_exams (chỉ mode real) |
| real_exam_code | INTEGER | Mã đợt thi (5 chữ số) |
| real_exam_revision_id | BIGINT | Revision ID |

#### Bảng `real_exams`
| Cột | Mô tả |
|---|---|
| id | BIGINT PK |
| code | INTEGER UNIQUE (5 chữ số: 10000–99999) |
| space_id | FK → spaces.id |
| name | TEXT |
| start_at / end_at | TIMESTAMPTZ |
| ended_at | TIMESTAMPTZ (kết thúc thủ công) |
| hidden_at | TIMESTAMPTZ (soft delete / ẩn) |
| hidden_by | UUID FK → auth.users |
| question_percent | INTEGER (30/50/70/100) |
| timer_seconds | INTEGER (45/60/90/120) |
| multi_percent | INTEGER (30/50/70/100) |
| max_attempts | INTEGER (1–5) |
| scoring_method | INTEGER (1 hoặc 2) |
| manual_running | BOOLEAN |
| current_revision_id | BIGINT FK → real_exam_revisions |
| source_version | UUID (thay đổi khi snapshot lại) |

#### Bảng `real_exam_revisions`
Lưu lịch sử các phiên bản đề thi thật (mỗi lần tạo lại snapshot tạo 1 revision).

#### Bảng `real_exam_question_refs` / `real_exam_revision_question_refs`
Snapshot danh sách câu hỏi (theo `question_code`) của một đợt thi / revision, bao gồm thứ tự ngẫu nhiên.

#### Bảng `real_exam_sources` / `real_exam_revision_sources`
Cấu hình nguồn ngân hàng câu hỏi (question_set) và tỷ lệ % cho mỗi đợt thi.

---

## 5. Xác thực & Phân quyền

### 5.1 Backend Local

- **Đăng nhập**: POST `/api/login` với `{username, password_hash}`.
  - Client tự SHA-256 mật khẩu trước khi gửi.
  - Server so sánh `bcrypt.compare(client_sha256, stored_bcrypt_hash)`.
- **Session**: express-session, cookie `sameSite: lax`.
- **Middleware `requireAuth`**: kiểm tra `req.session.userId` và `user.active`.
- **Middleware `requireSuperadmin`**: kiểm tra `user.role === 'superadmin'`.

#### Vai trò (Local)
| Role | Quyền |
|---|---|
| `superadmin` | Toàn quyền: quản lý users, tất cả spaces |
| `admin` | Chỉ quản lý các spaces được gán qua `admin_space` |

### 5.2 Supabase Cloud

- **Auth**: Supabase Auth (email/password). Profiles lưu trong `public.profiles`.
- **RLS**: Mọi bảng đều bật Row Level Security.
- **Người thi (anon)**: Chỉ được đọc spaces đã published, groups, questions (không có correct_json), và INSERT vào quiz_attempts.
- **Admin (authenticated)**: Dùng hàm `can_manage_space(space_id)` để kiểm tra quyền.
- **Superadmin**: Dùng hàm `is_superadmin()` để kiểm tra.

#### Hàm bảo mật chính
| Hàm | Mô tả |
|---|---|
| `is_superadmin()` | Kiểm tra role = 'superadmin' AND active |
| `can_manage_space(id)` | is_superadmin OR có trong space_admins |
| `get_space_public_status(slug)` | Trả `{exists, published}`, không lộ dữ liệu |
| `get_real_exam_public(code)` | Trả thông tin đợt thi cho người thi (anon) |
| `clear_question_set_questions(id)` | Xóa toàn bộ câu hỏi (admin + superadmin); đặt `permanent_hidden = true` |
| `delete_question_set_cascade(id)` | Xóa ngân hàng câu hỏi: superadmin đặt câu hỏi `permanent_hidden = false`, admin thường đặt `true` |
| `unhide_question_set(id)` | **Superadmin only**: Khôi phục ngân hàng; unhide câu hỏi có `permanent_hidden = false` |
| `unhide_real_exam(id)` | **Superadmin only**: Khôi phục đợt thi thật đã bị ẩn |
| `list_real_exams(...)` | Liệt kê đợt thi; hỗ trợ `status_filter = 'hidden'` (chỉ trả kết quả khi gọi bởi superadmin) |

### 5.3 Bảo vệ đáp án

**Chế độ offline (file tĩnh)**:
- Đáp án được tách ra file `.key.js` riêng biệt với file `.data.js`.
- File `.data.js` chứa `salt` và `check` (SHA-256 của đáp án+salt) thay vì đáp án thật.
- Người dùng chỉ tải `.key.js` khi nộp bài hoặc xem đáp án (mode practice).

**Chế độ cloud**:
- Đáp án (`correct_json`) được **loại khỏi** SELECT grant cho `anon`.
- Chỉ Edge Function `quiz-evaluate` (dùng service_role key) mới truy cập được đáp án.
- Người thi gửi lựa chọn → Edge Function trả `{is_correct, correct}` từng câu.

---

## 6. Chế độ Làm bài

### 6.1 Thi thử (mock)

- Người thi tự chọn số lượng câu (30/50/70/100% ngân hàng câu), bộ câu hỏi, và thời gian mỗi câu.
- Câu hỏi được **xáo trộn ngẫu nhiên** từ pool đã chọn (Fisher-Yates shuffle).
- Kết quả **được lưu** vào Supabase → hiển thị trên bảng xếp hạng 7 ngày gần nhất.
- **Không hiện đáp án** trong khi làm (chỉ thấy đúng/sai sau khi nộp).
- Hỗ trợ kết thúc sớm (các câu chưa làm tính là sai, **không lưu** kết quả).

### 6.2 Luyện tập (practice)

- Giống Thi thử nhưng:
  - **Hiện ngay đáp án đúng/sai** sau mỗi câu (inline review).
  - Nút "Kiểm tra đáp án" thay vì "Next" khi chưa lock.
  - Có thể chọn "Không giới hạn" thời gian mỗi câu.
  - Kết quả **KHÔNG được lưu** vào Supabase.
  - Đáp án được tải từ Edge Function sau khi lock từng câu.

### 6.3 Thi thật (real)

- Chỉ kích hoạt khi:
  1. Admin bật `real_exam_enabled` và cấu hình thời gian.
  2. Người thi truy cập qua URL `/exam/NNNNN` (5 chữ số) HOẶC qua URL space bình thường trong thời gian thi.
- Câu hỏi lấy từ **snapshot cố định** (`real_exam_question_refs` / revision refs), không random lại.
- Cấu hình cứng: số câu, thời gian, tỷ lệ câu multi – do Admin thiết lập.
- **Giới hạn số lượt thi**: được kiểm tra cả phía client (localStorage) và phía server (Supabase RPC `get_real_exam_attempt_count`).
- Kết quả luôn được lưu với `mode = 'real'`, gắn `real_exam_code` và `real_exam_revision_id`.
- Trạng thái đợt thi: `scheduled` / `active` / `paused` / `ended` / `hidden`.
- Admin có thể tạm dừng (`manual_running = false`) hoặc kết thúc sớm.

---

## 7. Logic Tính điểm

Hàm `calculateCompositeScore()` trong `app.js` trả về object breakdown.

### Scoring Method 1 (Tổng hợp – mặc định)

Tổng điểm = **Knowledge (75) + Coverage (10) + Duration (10) + Punctuality (5) = 100**

| Thành phần | Max | Công thức |
|---|---|---|
| **Knowledge** | 75 | `75 × (earnedWeight / totalWeight)` — dựa trên similarity score, câu multi có trọng số cao hơn |
| **Coverage** | 10 | `10 × (totalQuestions / bankQuestionCount)` — tỷ lệ câu làm / ngân hàng |
| **Duration** | 10 | `10 × clamp((maxDuration - actualDuration) / (maxDuration - minDuration), 0, 1)` |
| **Punctuality** | 5 | `5 × (1 - lateness / allowedLateMinutes)` — dựa vào `exam_start_time` |

**Trọng số câu multi (method 1)**:
- Câu single: weight = 1.
- Câu multi: weight = `min(2, 1 + 0.25 × (correctCount - 1))`.

**Điểm similarity câu multi (method 1)**:
```
similarity = (2 × truePositive) / (2 × truePositive + falsePositive + falseNegative)
```
(Dice coefficient)

### Scoring Method 2 (Kiến thức + Thời gian – dành cho Thi thật)

Tổng điểm = **Knowledge (95) + Duration (5) = 100**

| Thành phần | Max | Công thức |
|---|---|---|
| **Knowledge** | 95 | `95 × (multiAwareCorrectCount / totalQuestions)` — câu multi chỉ đếm khi trả lời HOÀN TOÀN đúng |
| **Duration** | 5 | `5 × clamp((maxDuration - actualDuration) / (maxDuration - minDuration), 0, 1)` |

Câu multi method 2: similarity = 1 nếu đúng tất cả, 0 nếu sai bất kỳ chữ nào.

### Điểm Đúng giờ (Punctuality)
```javascript
calculatePunctualityScore(startedAt) {
  // Nếu không cấu hình exam_start_time → trả 5 điểm (tối đa)
  // lateness = (phút bắt đầu thực tế) - (phút giờ thi dự kiến)
  // score = 5 × max(0, 1 - lateness / allowedLateMinutes)
}
```

---

## 8. Chống gian lận trong khi thi

| Cơ chế | Chi tiết |
|---|---|
| **Focus Violation** | Đếm số lần người dùng rời màn hình (`visibilitychange` hoặc `blur`). Mỗi "chuyến đi" chỉ tính 1 lần. Tối đa 1000 lần. |
| **Hiện cảnh báo** | Sau khi rời màn hình > `FOCUS_WARNING_THRESHOLD` (2 lần), hiện banner cảnh báo chống gian lận |
| **Lưu vào DB** | `focus_violation_count` được lưu cùng quiz_attempts để admin theo dõi |
| **Copy protection** | Disable contextmenu, copy, dragstart, selectstart trên vùng có `data-copy-protected` |
| **Không hiện đáp án** | Trong mode mock/real, đáp án không bao giờ được tải về client trước khi nộp bài |

---

## 9. Ngân hàng Câu hỏi

### 9.1 Loại câu hỏi

| Loại | Mã | Mô tả |
|---|---|---|
| Một đáp án | `single` | Radio button, đúng khi chọn đúng 1 đáp án |
| Nhiều lựa chọn | `multi` | Checkbox, có 2–5 đáp án đúng |

### 9.2 Cấu trúc câu hỏi

```json
{
  "id": 123,
  "type": "multi",
  "content": "Nội dung câu hỏi...",
  "options": {
    "A": "Lựa chọn A",
    "B": "Lựa chọn B",
    "C": "Lựa chọn C",
    "D": "Lựa chọn D"
  },
  "correct": ["A", "C"]
}
```

### 9.3 Question Sets (Bộ câu hỏi)

- Mỗi Space có thể có nhiều Question Set (bộ câu hỏi / ngân hàng chủ đề).
- Câu hỏi không gán Set sẽ thuộc Set "Mặc định" (id=0).
- Người thi có thể **chọn một hoặc nhiều Set** để thi thử/luyện tập.
- Admin cấu hình Set nào và tỷ lệ % cho Thi thật.
- Lựa chọn Set được lưu vào `localStorage` với key `sq_question_sets_{slug}`.

### 9.4 Import CSV

Format CSV bắt buộc:

| Cột | Bắt buộc | Mô tả |
|---|---|---|
| `Số thứ tự` | ✓ | Thứ tự câu hỏi |
| `Loại câu hỏi` | ✓ | `Một lựa chọn` hoặc `Nhiều lựa chọn` |
| `Nội dung câu hỏi` | ✓ | Nội dung |
| `A` | ✓ | Lựa chọn A |
| `B` | ✓ | Lựa chọn B |
| `C`, `D`, `E` | Tùy chọn | Lựa chọn C, D, E |
| `Đáp án đúng` | ✓ | Ví dụ `A` hoặc `A,C` |

Validation:
- Cột lựa chọn phải liên tục (không nhảy cột).
- Câu single: đúng 1 đáp án. Câu multi: 2–5 đáp án.
- Đáp án phải tham chiếu đến lựa chọn đã điền.

---

## 10. Bố trí Space (Space Configuration)

### 10.1 URL Routing

| URL | Hành vi |
|---|---|
| `/{slug}` | Load Space theo slug |
| `/exam/{code}` | Load Đợt thi thật theo mã 5 chữ số |
| `/` | Trang chào mừng |

### 10.2 Trạng thái Space

- Space có `published = true` → hiển thị công khai.
- Space có `published = false` → trả 404 (renderNotFound).
- Space không tồn tại trên cloud → thử load từ file tĩnh offline.

### 10.3 Cấu hình Space

```
Space
├── name          : Tên hiển thị
├── slug          : URL path (duy nhất)
├── timer_seconds : Thời gian mỗi câu mặc định
├── exam_start_time : Giờ thi dự kiến (HH:MM) cho điểm đúng giờ
├── allowed_late_minutes : Phút trễ tối đa
├── groups[]      : Danh sách nhóm học viên
├── question_sets[]: Danh sách bộ câu hỏi
│   └── {id, name}
├── questions[]   : Danh sách câu hỏi
│   └── {id, type, content, options, question_set_id}
└── real_exam{}   : Cấu hình thi thật
    ├── enabled
    ├── question_percent (30/50/70/100)
    ├── timer_seconds (45/60/90/120)
    ├── multi_percent (30/50/70/100)
    ├── max_attempts (1-5)
    ├── scoring_method (1/2)
    ├── start_at / end_at
    └── question_sets[] : [{id, percent}] – phân bổ theo Set
```

### 10.4 Chọn câu hỏi cho Thi thật

Hàm `selectRealExamQuestionIds()`:
1. Nếu có cấu hình `real_exam.question_sets` với percent → phân bổ theo từng Set.
2. Mỗi Set: chọn câu multi trước (theo `multi_percent`), sau đó câu single.
3. Nếu không đủ câu → lấy thêm từ pool chung.
4. Kết quả được shuffle lần cuối.

---

## 11. Luồng Thi

```
Boot → Xác định route
  ├── /exam/{code} → loadCloudRealExam() → configureLoadedSpace() → renderSetup()
  └── /{slug}      → loadCloudSpace() → configureLoadedSpace() → renderSetup()
                      hoặc loadScript(.data.js) [offline mode]

renderSetup()
  ├── Nhập tên học viên (lưu localStorage sq_student_name)
  ├── Chọn Group
  ├── Chọn Bộ câu hỏi (mock/practice)
  ├── Chọn % câu hỏi (mock/practice)
  ├── Chọn thời gian mỗi câu
  └── Nút "Bắt đầu" → startQuiz()

startQuiz()
  ├── Validate tên + group
  ├── Kiểm tra cửa sổ thi (real mode)
  ├── Kiểm tra số lượt còn lại (real mode: localStorage + RPC Supabase)
  ├── confirmDialog (xem lại thông tin)
  ├── Tăng attempt count (real mode: localStorage)
  ├── Chọn câu hỏi (shuffle hoặc selectRealExamQuestionIds)
  └── renderQuestion(true)

renderQuestion()
  ├── Hiển thị câu hỏi + options + timer
  ├── toggleChoice() khi chọn đáp án
  └── handleNext() / requestFinishEarly()

handleNext() / lockCurrent()
  ├── Nếu cloud + practice: gọi Edge Function quiz-evaluate (action=check)
  ├── Nếu cloud + mock/real: chỉ mark locked, không check đáp án
  ├── Nếu offline: SHA-256(selected + salt) === check
  └── submitQuiz() khi câu cuối

submitQuiz()
  ├── Lock tất cả câu chưa lock
  ├── ensureAnswers() → tải đáp án từ Edge Function hoặc .key.js
  ├── updateCorrectnessFromAnswers()
  ├── calculateCompositeScore() → state.scoreBreakdown
  ├── saveExamAttempt() → INSERT vào quiz_attempts (Supabase)
  └── renderResults()
```

---

## 12. Bảng Xếp Hạng (Leaderboard)

- Bảng có hai tab: **Xếp hạng Học viên** và **Xếp hạng Nhóm**. Cả hai tab dùng chung dữ liệu đã tải, không làm lộ đáp án hay nội dung câu hỏi.
- Ba ô tóm tắt đầu bảng lần lượt là **Tổng số lượt thi**, **Tổng số người thi** (mỗi `student_name_key` tính một lần) và **Điểm cao nhất**.
- Hai khung podium có nền vàng nhạt. Bục hạng 1/vàng, 2/bạc và 3/đồng dùng chữ đen và biểu tượng huy chương tương ứng; khi hạng chưa có dữ liệu thì toàn bộ nội dung, gồm cả huy chương, trong bục đó để trống.
- **Thi thử**: Lấy `quiz_attempts` trong 30 ngày gần nhất, `mode = 'mock'`, theo `space_slug`. Phần vinh danh đầu trang hiển thị hai bục top 3 Học viên và top 3 Nhóm của cùng cửa sổ 30 ngày.
- **Thi thật**: Chỉ xem từ link của Đợt thi, lấy theo `real_exam_code` + `mode = 'real'`, không phụ thuộc thời điểm Start/End/Stop. Link Đợt thi đã lưu trữ không truy cập được nên không hiển thị bảng xếp hạng.
- Dữ liệu leaderboard Thi thật được đọc qua RPC `get_real_exam_leaderboard_public(code)`, không dùng trực tiếp policy đọc kết quả 7 ngày của `quiz_attempts`. RPC chỉ trả các cột phục vụ xếp hạng, chỉ cho Đợt chưa archived, và đọc kết quả bằng `real_exam_id` để tương thích dữ liệu lịch sử.
- Migration bắt buộc: chạy `supabase/real_exam_public_leaderboard.sql` trước khi deploy frontend có gọi RPC này.
- Với **Thi thử**, tab Học viên vẫn nhóm theo ngày `submitted_at`; một học viên chỉ giữ kết quả **cao nhất trong ngày**. Hiển thị tối đa 15 hàng/ngày, có nút "Xem toàn bộ"; danh sách hiển thị tối đa 3 ngày mới nhất để giữ màn hình gọn.
- Với **Thi thật**, tab Học viên so sánh **một kết quả cao nhất duy nhất của mỗi học viên** trong toàn bộ Đợt thi; học viên không xuất hiện lặp lại theo ngày. Hiển thị tối đa 15 hàng trước khi mở rộng.
- Tab Học viên có nút **"Kết quả của tôi"**: lọc theo `student_name_key` của học viên đang dùng ứng dụng và disabled khi chưa có tên; dropdown Nhóm lọc kết quả theo `group_name`.
- Tab Nhóm xếp hạng giảm dần theo **điểm trung bình của kết quả tốt nhất của từng học viên** trong Nhóm, trong phạm vi 30 ngày (Thi thử) hoặc toàn bộ Đợt thi (Thi thật). Cách này không để một học viên thi nhiều lần làm lệch điểm trung bình Nhóm. Hai bục vinh danh Học viên/Nhóm dùng chính quy tắc này: Học viên lấy một kết quả cao nhất; Nhóm tính trung bình từ một kết quả cao nhất của từng học viên.
- Khi các Nhóm cùng điểm trung bình, Nhóm có nhiều học viên hơn được ưu tiên, rồi sắp xếp theo tên để kết quả ổn định. Số điểm dùng hiển thị số nguyên.
- Giới hạn truy vấn hiện tại là 1000 dòng mỗi lần tải.
- RLS policy: chỉ đọc các attempt `submitted_at >= now() - interval '7 days'`.

---

## 13. Đợt Thi Thật – Vòng đời đầy đủ

```
Admin tạo Đợt thi thật (create_real_exam RPC)
  ├── Cấp code 5 chữ số ngẫu nhiên duy nhất (10000–99999)
  ├── Cấu hình nguồn câu hỏi (replace_real_exam_sources)
  ├── Generate snapshot (generate_real_exam_snapshot_unchecked)
  │   ├── Chọn câu theo % từng Set và multi_percent
  │   ├── Lưu vào real_exam_question_refs (question_code, generated_order)
  │   └── Snapshot này bất biến khi có người đã thi
  └── Trả về {code, question_count, share_path: '/exam/CODE'}

Người thi vào /exam/CODE
  ├── Frontend gọi RPC get_real_exam_public(code)
  │   → Trả {space, questions (từ snapshot), start_at, end_at, status, ...}
  ├── Người thi làm bài, câu hỏi lấy từ snapshot
  ├── Đáp án check qua Edge Function quiz-evaluate
  └── Nộp bài → quiz_attempts với real_exam_code, real_exam_revision_id

Admin quản lý
  ├── Tạm dừng: set_real_exam_running(id, false) → status = 'paused'
  ├── Tiếp tục: set_real_exam_running(id, true) → status = 'active'
  ├── Kết thúc: ended_at = now() → status = 'ended'
  ├── Ẩn (admin): hide_real_exam(id) → hidden_at = now() → status = 'hidden'
  │   Admin thường không thể tự hoàn tác.
  ├── Unhide (superadmin only): unhide_real_exam(id) → hidden_at = null
  └── Xem kết quả + export CSV
```

### Trạng thái Đợt thi thật (real_exam_status)

| Trạng thái | Điều kiện | Ghi chú |
|---|---|---|
| `hidden` | `hidden_at IS NOT NULL` | Ưu tiên cao nhất; chỉ superadmin thấy |
| `ended` | `ended_at IS NOT NULL` hoặc `now() > end_at` | |
| `scheduled` | `now() < start_at` | |
| `paused` | `manual_running = false` | |
| `active` | Còn lại | |

---

## 14. Vòng đời Dữ liệu Offline (Generate & Deploy)

```
Admin → POST /api/spaces/:id/generate
  backend/src/generator.js:generateSpace()
  ├── Tạo dataToken (8 ký tự random hex)
  ├── Tạo keySalt (16 ký tự) + keyToken = SHA-256(dataToken + keySalt)
  ├── Tạo publicQuestions: mỗi câu có {id, type, content, options, salt, check}
  │   check = SHA-256(sorted(correct).join(',') + salt)
  ├── Tạo keyAnswers: {questionId: correctArray}
  ├── Ghi dist/data/{dataToken}.data.js (window.__SQ_SPACE__ = {...})
  ├── Ghi dist/data/{keyToken}.key.js (window.__SQ_ANSWERS__ = {...})
  ├── Ghi dist/data/index.enc.js (window.__SQ_INDEX__ = {sha256(slug): dataToken})
  └── Cập nhật spaces SET data_token, key_token, dirty=0

POST /api/export → exportDeployZip()
  └── Đóng gói dist/ thành ZIP → tải về → upload lên Netlify
```

---

## 15. Giao diện Người dùng

### 15.1 Các màn hình chính

| Màn hình | Mô tả |
|---|---|
| Welcome | Trang chào mừng khi không có slug |
| Setup | Cấu hình bài thi: chọn tên, group, bộ câu, % câu, thời gian |
| Question | Giao diện làm bài: câu hỏi, options, timer, progress bar |
| Results | Kết quả tổng: điểm, breakdown, review từng câu |
| Leaderboard | Bảng xếp hạng theo ngày |
| Not Found | 404 khi space không tồn tại / chưa published |

### 15.2 Thiết kế

- **Font**: `"Be Vietnam Pro"` (Google Fonts) + fallback `"Trebuchet MS"`.
- **Theme**: Hỗ trợ Light / Dark mode, toggle qua nút FAB "Dark/Light" góc phải.
- **Design tokens**: `design-system.css` định nghĩa CSS variables (`--bg`, `--ink`, `--brand`, `--muted`, v.v.)
- **Responsive**: Layout co giãn mobile/desktop.
- **Toast**: Thông báo nhỏ tự ẩn sau 3.6 giây.
- **Dialog**: Modal native (không library) dùng Promise để confirm.
- **Progress bar**: `--value: XX%` CSS variable, cập nhật mỗi câu.
- **Timer**: Hiển thị countdown theo giây, đổi màu khi hết giờ.
- **Score ring**: SVG circle với `--score` CSS variable.
- **Copy protection**: `data-copy-protected` attribute disable context menu.

### 15.3 Sidebar Setup Dashboard

- **Sidebar trái**: Logo, navigation (Làm bài / Kết quả), thẻ học viên + nút "Đăng xuất".
- **Main area**: Header (tên Space), action bar (chế độ, bắt đầu), widgets (tên, group, bộ câu, số câu, thời gian).

---

## 16. Auto-update Monitoring

- Mỗi 60 giây, app fetch `/app-version.json` (no-cache).
- Nếu version khác với version hiện tại → hiện toast "Làm mới ứng dụng".
- Click toast → redirect với `?app_version=X` để bypass cache.
- Toast không hiện khi đang làm bài.

---

## 17. Local Backend API Reference

### Auth
| Method | Path | Mô tả |
|---|---|---|
| POST | `/api/login` | Đăng nhập |
| POST | `/api/logout` | Đăng xuất |
| POST | `/api/forgot-password` | Yêu cầu reset password |
| POST | `/api/change-password` | Đổi mật khẩu |

### Users (Superadmin only)
| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/users` | Danh sách users |
| POST | `/api/users` | Tạo user mới |
| PUT | `/api/users/:id` | Sửa user |
| DELETE | `/api/users/:id` | Xóa user |

### Spaces
| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/spaces` | Danh sách spaces (theo quyền) |
| POST | `/api/spaces` | Tạo space mới |
| PUT | `/api/spaces/:id` | Sửa space |
| DELETE | `/api/spaces/:id` | Xóa space |
| PUT | `/api/spaces/:id/real-exam` | Cấu hình thi thật |

### Groups
| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/spaces/:id/groups` | Danh sách groups |
| POST | `/api/spaces/:id/groups` | Tạo group |
| PUT | `/api/groups/:id` | Sửa group |
| DELETE | `/api/groups/:id` | Xóa group (tối thiểu 1 group) |

### Questions
| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/spaces/:id/questions` | Danh sách câu hỏi |
| POST | `/api/spaces/:id/csv/preview` | Preview CSV |
| POST | `/api/spaces/:id/csv/confirm` | Xác nhận import CSV |
| DELETE | `/api/spaces/:id/questions` | Xóa toàn bộ câu hỏi |

### Build & Deploy
| Method | Path | Mô tả |
|---|---|---|
| POST | `/api/spaces/:id/generate` | Generate file tĩnh cho space |
| POST | `/api/export` | Export ZIP deploy |

---

## 18. Edge Functions (Supabase)

### `quiz-evaluate`

**URL**: `{supabase_url}/functions/v1/quiz-evaluate`

#### Action: `check`
Kiểm tra đáp án một câu (dùng cho mode practice).
```json
Request: { "action": "check", "slug": "...", "question_id": 123, "selected": ["A","B"], "exam_code": 27313 }
Response: { "correct": ["A","B"], "is_correct": true }
```

#### Action: `answers`
Lấy tất cả đáp án sau khi nộp bài.
```json
Request: { "action": "answers", "slug": "...", "question_ids": [1,2,3], "exam_code": 27313 }
Response: { "answers": { "1": ["A"], "2": ["B","C"], "3": ["D"] } }
```

Bảo mật: Dùng `SUPABASE_SERVICE_ROLE_KEY` nội bộ. Validate space published + đợt thi còn hiệu lực.

---

## 19. LocalStorage Keys

| Key | Nội dung |
|---|---|
| `sq_student_name` | Tên học viên (persist qua sessions) |
| `sq_question_sets_{slug}` | Danh sách Set ID đã chọn (comma-separated) |
| `sq_real_attempts_{slug}_{version}_{name_key}` | Số lượt đã thi thật |
| `sq-admin-theme` | Theme admin (light/dark) |

---

## 20. Các Điểm Cần Lưu ý khi Phát triển

1. **Schema migration**: Mỗi khi thêm cột vào `quiz_attempts`, phải cập nhật cả:
   - File SQL migration trong `supabase/`
   - RLS policy (recreate nếu policy tham chiếu cột mới)
   - `notify pgrst, 'reload schema'` để reload schema cache
   
2. **question_code bất biến**: Câu hỏi đã snapshot không được sửa nội dung. Tạo câu mới thay thế.

3. **Dirty flag**: Khi sửa Space/Questions, `dirty = 1`. Phải generate lại trước khi deploy.

4. **Mode practice không lưu**: Hàm `saveExamAttempt()` return sớm nếu `attemptMode === 'practice'`.

5. **Focus violation**: Mỗi "chuyến đi" (rời màn hình) chỉ tính 1 lần, không tính mỗi giây.

6. **Shuffle câu hỏi thật**: `selectRealExamQuestionIds()` dùng pool client-side, nhưng snapshot đã được define server-side. Đây là thiết kế intentional: snapshot lưu `question_code`, client shuffle trình tự hiển thị.

7. **Attempt count Thi thật**: Kiểm tra cả localStorage lẫn DB (lấy max). Increment localStorage trước khi bắt đầu để tránh thi lại nếu crash.

8. **Supabase anon key**: Public key, được hardcode trong `supabase-config.js`. RLS đảm bảo bảo mật thay vì key bí mật.

9. **Không có React/Vue/Angular**: Frontend hoàn toàn vanilla JS, re-render bằng cách set `innerHTML`. Không có virtual DOM.

10. **Cloud admin và Local admin song song**: Hai hệ thống admin độc lập, không sync dữ liệu với nhau.

11. **Soft delete chỉ áp dụng trên Cloud**: Local SQLite dùng hard delete trực tiếp (`DELETE FROM questions`). Toàn bộ cơ chế `hidden_at`, `permanent_hidden`, unhide chỉ có ý nghĩa trên Cloud/Supabase.

12. **permanent_hidden flag**: Không được reset `permanent_hidden = false` thủ công nếu không có lý do rõ ràng. Flag này được thiết kế để phân biệt câu hỏi "bị xóa vĩnh viễn" vs "bị ẩn tạm thời cùng ngân hàng".

---

## 21. Cơ chế Ẩn / Khôi phục (Hide & Unhide)

> Áp dụng **chỉ trên Cloud (Supabase)**. Local SQLite không có cơ chế này.

### 21.1 Ngân hàng Câu hỏi (question_sets)

#### Xóa toàn bộ câu hỏi trong ngân hàng — `clear_question_set_questions`
- **Áp dụng**: Admin và Superadmin
- **Hành vi**: Soft-delete toàn bộ câu hỏi active (`hidden_at = now()`), đồng thời đặt **`permanent_hidden = true`**
- **Ý nghĩa**: Câu hỏi đã bị xóa thủ công → không thể khôi phục khi unhide ngân hàng

#### Xóa ngân hàng câu hỏi — `delete_question_set_cascade`
- **Áp dụng**: Admin và Superadmin
- **Hành vi chung**: Soft-delete ngân hàng (`question_sets.hidden_at = now()`) + soft-delete câu hỏi active
- **Phân biệt theo role**:
  - **Admin thường**: `permanent_hidden = true` → câu hỏi không thể khôi phục
  - **Superadmin**: `permanent_hidden = false` → câu hỏi có thể được unhide cùng ngân hàng
- **Ràng buộc**: Không thể xóa nếu ngân hàng đang là nguồn của đợt thi đang diễn ra; Space phải còn ≥ 1 ngân hàng

#### Khôi phục ngân hàng — `unhide_question_set`
- **Áp dụng**: **Superadmin only**
- **Hành vi**:
  1. `question_sets.hidden_at = null`
  2. `questions.hidden_at = null` — chỉ với các câu có `permanent_hidden = false`
- **Câu hỏi có `permanent_hidden = true`** (đã bị "Xóa toàn bộ" hoặc xóa bởi admin thường) **KHÔNG được khôi phục**

#### Hiển thị UI cho Superadmin
- Trong màn hình Quản lý ngân hàng câu hỏi: hiển thị cả ngân hàng đã bị ẩn với opacity mờ + border dashed + badge "Đã ẩn"
- Khi mở chi tiết ngân hàng đã ẩn: thay thế các nút Sửa/Xóa bằng nút **"Khôi phục ngân hàng câu hỏi"**

### 21.2 Đợt Thi Thật (real_exams)

#### Ẩn đợt thi — `hide_real_exam`
- **Áp dụng**: Admin và Superadmin (chỉ khi đợt thi đã kết thúc `status = 'ended'`)
- **Hành vi**: `hidden_at = now()` → `real_exam_status` trả `'hidden'`
- **Lưu ý**: Admin thường không thể tự khôi phục; mã, revision và toàn bộ kết quả vẫn được giữ trong DB

#### Khôi phục đợt thi — `unhide_real_exam`
- **Áp dụng**: **Superadmin only**
- **Hành vi**: `hidden_at = null` → đợt thi trở lại trạng thái trước khi bị ẩn (thường là `ended`)
- **Ràng buộc**: Hàm raise exception nếu người gọi không phải superadmin

#### Hiển thị UI cho Superadmin
- Trong màn hình Quản lý đợt thi thật: Superadmin thấy thêm option **"Đã ẩn"** trong bộ lọc Trạng thái
- Filter `status_filter = 'hidden'` trong `list_real_exams` chỉ trả kết quả khi caller là superadmin
- Khi mở chi tiết đợt thi đã ẩn: toggle Start/Stop bị vô hiệu hóa; nút **"Bỏ ẩn Đợt thi"** xuất hiện thay cho nút Sửa/Ẩn

### 21.3 Bảng tóm tắt quyền

| Thao tác | Admin | Superadmin |
|---|---|---|
| Xóa toàn bộ câu hỏi trong ngân hàng | ✅ (`permanent_hidden = true`) | ✅ (`permanent_hidden = true`) |
| Xóa ngân hàng câu hỏi | ✅ (câu hỏi `permanent_hidden = true`) | ✅ (câu hỏi `permanent_hidden = false`) |
| Khôi phục ngân hàng câu hỏi | ❌ | ✅ |
| Ẩn đợt thi thật | ✅ (khi `ended`) | ✅ (khi `ended`) |
| Khôi phục đợt thi thật | ❌ | ✅ |
| Xem ngân hàng/đợt thi đã ẩn trong UI | ❌ | ✅ |

---

## 22. Vòng đời lưu trữ và dọn dữ liệu (Archive lifecycle)

> Migration bắt buộc: chạy `supabase/archive_lifecycle.sql` sau `real_exam_revisions.sql` và `add_permanent_hidden.sql`.

### Nguyên tắc

- Trong UI Cloud, thao tác archive được ghi nhãn là **Xóa** để gần gũi với người dùng. Nó không xóa dữ liệu ngay.
- Ngân hàng và câu hỏi đã lưu trữ vào Thùng rác trong **30 ngày** (`hidden_at`, `purge_after`). Trong thời gian này admin có quyền quản lý Space có thể khôi phục.
- Chỉ superadmin gọi `purge_expired_question_trash(space_id)` để xóa vĩnh viễn dữ liệu đã quá hạn. Không có thao tác purge tự động.
- Không cấp quyền `DELETE` trực tiếp cho admin trên `questions` và `question_sets`; mọi thay đổi vòng đời đi qua RPC để kiểm tra quyền, Đợt thi đang diễn ra và thời hạn khôi phục.

### Bảo toàn lịch sử Đợt thi thật

- Mỗi revision có snapshot bất biến tại `real_exam_revision_question_snapshots`: mã câu, thứ tự, loại câu, nội dung, lựa chọn và đáp án.
- Migration backfill snapshot cho mọi revision hiện có trước khi cho phép purge câu hỏi. Vì vậy dữ liệu lịch sử không phụ thuộc vào hàng `questions` gốc.
- Lưu trữ Đợt thi (`hide_real_exam`) chỉ cập nhật trạng thái ẩn; **không xóa** `real_exam_sources` hoặc `real_exam_revision_sources`. Cấu hình nguồn đề, revision và kết quả vẫn dùng được cho audit và khôi phục.
- Học viên không thấy ngân hàng/câu đã lưu trữ trong Thi thử và không truy cập được Đợt thi đã lưu trữ. Các lượt thi và kết quả đã nộp được giữ nguyên.

### Quy tắc purge

1. Chỉ purge câu hỏi `hidden_at IS NOT NULL` và `purge_after <= now()`.
2. Trước khi xóa câu gốc, hệ thống kiểm tra snapshot revision tương ứng; snapshot thiếu thì không xóa tham chiếu revision đó.
3. Chỉ purge ngân hàng khi đã quá hạn, không còn câu hỏi và không còn là nguồn của Đợt thi.
4. Kết quả Thi thật không nằm trong job dọn dữ liệu. Chính sách giữ/xóa kết quả phải được phê duyệt riêng, không dựa trên số lượng bản ghi.

### Local SQLite

Local admin vẫn là hệ thống độc lập. Lệnh xóa câu hỏi của local hiện là hard-delete và không được coi là tương đương với Cloud archive lifecycle. Không dùng local để vận hành dữ liệu có Đợt thi thật cần lưu lịch sử.

---

## 23. Cờ build lại Đợt thi thật

> Migration bắt buộc: chạy `supabase/real_exam_rebuild.sql` sau `archive_lifecycle.sql`.

- `real_exams.needs_rebuild = true` khi nguồn đề thay đổi, tỷ lệ nguồn thay đổi, quy tắc tạo đề thay đổi, hoặc câu hỏi trong nguồn được thêm/lưu trữ/xóa.
- Khi Admin Stop, ngân hàng không còn bị khóa, không phụ thuộc khoảng thời gian đã cấu hình. Lưu trữ câu hỏi hoặc toàn bộ câu hỏi chỉ đặt `needs_rebuild = true` và giữ nguồn để Admin thấy nguồn đã rỗng; lưu trữ cả ngân hàng mới gỡ nguồn đó khỏi các Đợt thi đang Stop.
- Khi Start, `set_real_exam_running` build snapshot và tạo revision mới nếu cờ là `true`; sau khi build thành công cờ trở thành `false`, cập nhật `last_built_at` và tăng `build_no`.
- Badge xanh và khóa thao tác trong màn hình Ngân hàng chỉ đọc `real_exam_sources` của Đợt thi đang chạy. Không dùng `spaces.real_question_sets` vì đây là cấu hình legacy có thể cũ.
- Học viên luôn bị chặn ở cả UI lẫn trigger ghi lượt thi khi Đợt thi có trạng thái `paused`.
- Start bị chặn ở backend nếu không còn nguồn hoặc bất kỳ nguồn nào bị lưu trữ/không còn câu hỏi. Màn hình quản lý hiển thị cảnh báo và yêu cầu chọn ít nhất một nguồn có câu hỏi trước khi Start.

## 24. Phiên bản ứng dụng

- `npm run version:bump` tạo phiên bản timestamp mới, cập nhật cache-busting query string của cả trang học viên và Admin, đồng thời cập nhật `frontend/app-version.json`.
- Footer của hai trang hiển thị `Version` và `Build`; mỗi lần phát hành tính năng phải chạy lệnh bump trước build/deploy.

## 25. Cách tính điểm 2

- `A = (số câu trả lời đúng / tổng số câu hỏi) × 95`.
- `B = tổng số câu hỏi × thời gian cài đặt cho mỗi câu` (giây).
- `C = ((B - thời gian làm bài) / B) × 5`, giới hạn từ `0` đến `5`.
- Điểm cuối cùng là `A + C`, giới hạn tối đa `100`. Câu nhiều đáp án chỉ được tính đúng khi chọn đúng toàn bộ đáp án.
