# SIMPLE.QUIZ — Đặc tả kỹ thuật chi tiết (Technical Specification)

> Tài liệu này dùng để cung cấp cho AI coding agent thực hiện phát triển ứng dụng.
> Mọi quyết định thiết kế đã được chốt qua quá trình thảo luận với chủ đầu tư (owner).

---

## 1. Tổng quan ứng dụng

**Tên ứng dụng**: vn.Quiz

**Mục đích**: Ứng dụng web phục vụ học viên làm bài quiz theo từng "space" (nhóm kiến thức). Học viên truy cập qua link bí mật, làm bài, nhận điểm ngay trên màn hình. Superadmin/Admin quản trị nội dung quiz và người dùng quản trị thông qua một backend **chỉ chạy local**, không public lên Internet.

**Ràng buộc kiến trúc quan trọng nhất**:
- Frontend là site **tĩnh hoàn toàn** (HTML/CSS/JS), host trên Netlify, **không có khả năng viết dữ liệu** lên hosting (chỉ đọc).
- Backend (Node.js + SQLite) **chỉ chạy trên máy local** của superadmin/admin, dùng để sinh ra bộ file tĩnh rồi deploy **thủ công** lên Netlify (kéo thả / Netlify CLI). Không có CI/CD tự động, không có git-based deploy.
- Vì là static hosting, **không thể đạt bảo mật tuyệt đối** cho dữ liệu câu hỏi/đáp án. Mục tiêu là giảm thiểu rủi ro cheat ở mức hợp lý (chi tiết Mục 6), không phải là bất khả xâm phạm.

**3 đối tượng sử dụng**:
| Đối tượng | Truy cập qua | Quyền |
|---|---|---|
| Học viên | Frontend (Netlify, không cần đăng nhập) | Làm quiz qua link bí mật của space |
| Superadmin | Backend (local, có đăng nhập) | Toàn quyền: quản lý admin + tất cả space |
| Admin | Backend (local, có đăng nhập) | Chỉ quản lý các space được gán |

**Yêu cầu UI chung**: giao diện hiện đại, gọn gàng, chữ to dễ nhìn, hỗ trợ light/dark mode (toggle, lưu lựa chọn).

---

## 2. Kiến trúc tổng thể

```
┌──────────────────────────────────────────┐          	┌───────────────────────────────────────┐
│  BACKEND (local only)                     │          	│  FRONTEND (Netlify, static)      	│
│  Node.js + Express + SQLite               │  Export  	│                                   	│
│  - Login (superadmin/admin)               │  thủ công	│  /index.html                     	│
│  - Quản lý user                           │ ───────▶		│  /assets/app.js					|
│  - Quản lý space                          │ (kéo thả/	│  /assets/style.css                	│
│  - Upload CSV → validate → lưu SQLite     │  Netlify 	│  /_redirects                      	│
│  - "Generate" → sinh file tĩnh + mã hoá   │   CLI)   	│  /data/index.enc.js (mapping ẩn) 	│
│  - "Xuất bộ deploy" (đóng gói dist/)      │          	│  /data/<token>.data.js (per space)	│
└──────────────────────────────────────────┘          	│  /data/<keytoken>.key.js (đáp án) 	│
                                                        └─────────────▲───────────────────────────┘
                                                                      │ HTTPS, đọc only
                                                              minhquiz.netlify.app/<slug>
                                                                  Học viên
```

**Nguyên tắc**: Backend là nguồn sự thật duy nhất (SQLite). Mọi thay đổi (thêm space, sửa câu hỏi, đổi cấu hình) phải qua bước **"Generate"** để sinh lại file tĩnh, sau đó **owner phải tự deploy thủ công** lên Netlify — ứng dụng phải luôn nhắc rõ điều này trên UI backend (banner "Bạn cần Export & Deploy lại để thay đổi có hiệu lực").

---

## 3. FRONTEND — Yêu cầu chức năng chi tiết

### 3.1. Cấu trúc file

```
/index.html              (SPA, không build step — vanilla JS)
/assets/app.js            (router + toàn bộ logic: state machine, quiz engine)
/assets/style.css         (CSS variables cho theme light/dark)
/_redirects                → nội dung: "/*    /index.html   200"
/data/index.enc.js         (mapping ẩn: hash(slug) → data_token, xem Mục 6)
/data/<data_token>.data.js (bộ câu hỏi + lựa chọn của 1 space, KHÔNG có đáp án đúng)
/data/<key_token>.key.js   (đáp án đúng của 1 space, chỉ fetch khi cần — xem Mục 6)
```

### 3.2. Routing & màn hình chào mừng

- Dùng `_redirects` để mọi path đều trả về `index.html` (SPA routing).
- `app.js` đọc `window.location.pathname`:
  - Path rỗng (`/`) → hiển thị **màn hình chào mừng**: dòng chữ "Chào mừng tới hệ thống vn.Quiz", không có liên kết/gợi ý nào tới danh sách space.
  - Path có dạng `/<slug>` → hash slug, tra trong `index.enc.js`. Nếu khớp → load space tương ứng. Nếu không khớp → coi như không tồn tại, quay về màn hình chào mừng (không phân biệt "slug sai" với "slug không tồn tại" để tránh dò quét).

### 3.3. Màn hình thiết lập bài quiz (trước khi bắt đầu)

Sau khi vào đúng space, hiển thị màn hình thiết lập với 3 nhóm lựa chọn (dạng nút bấm lớn, không dùng dropdown):

**Thông tin học viên**:
- Hiển thị ô **Tên học viên** ở màn hình thiết lập.
- Tên học viên bắt buộc nhập lần đầu, được trim khoảng trắng đầu/cuối và gom nhiều khoảng trắng liên tiếp thành 1 khoảng trắng.
- Tên học viên được lưu vào `localStorage` của trình duyệt và cho phép sửa lại ở màn hình thiết lập.
- Hiển thị ô chọn **Group** ở màn hình thiết lập. Học viên bắt buộc chọn một Group thuộc Space trước khi bắt đầu.
- Lựa chọn Group được nhớ riêng theo từng Space trong `localStorage` và được lưu cùng kết quả thi.

**a) Số lượng câu hỏi** — tính theo % tổng số câu của bộ đề, làm tròn tới số 5 gần nhất:
```js
function calcQuestionCount(total, percent) {
  const raw = total * percent / 100;
  return Math.max(5, Math.round(raw / 5) * 5); // tối thiểu 5 câu
}
```
4 mức cố định: 30%, 50%, 70%, 100%.

**b) Chế độ làm bài**:
- **Thi thử** và **Thi thật**: không hiển thị đúng/sai khi đang làm; chỉ xem đáp án sau khi nộp bài toàn bộ.
- **Chế độ luyện tập**: sau khi học viên chọn/khóa đáp án của từng câu, ứng dụng chấm đúng/sai ngay trên màn hình câu hỏi và hiển thị đáp án đúng thật của câu đó trước khi học viên bấm Next. Ở chế độ này, file đáp án đúng (`.key.js`) được fetch khi cần hiển thị review trong lượt luyện tập, không chờ tới màn hình kết thúc.

**c) Thời gian trả lời mỗi câu (`timer_seconds`)**:
- Học viên được tự chọn thời gian trả lời mỗi câu tại màn hình thiết lập.
- Các mức gợi ý: 15s, 30s, 45s, 60s, 90s, 120s; frontend có thể cho phép nhập số giây tuỳ chỉnh nếu muốn, miễn là giá trị là số nguyên dương.
- Giá trị mặc định lấy từ cấu hình `timer_seconds` của space do backend generate ra.
- Không hiển thị form nhập giây tùy chỉnh ở màn hình thiết lập.
- Nếu học viên chọn **Chế độ luyện tập**, hiển thị thêm lựa chọn **Không giới hạn**. Khi chọn lựa chọn này, các câu hỏi không có bộ đếm giây và không tự khóa theo thời gian.
- Màn hình thiết lập có nút/tab **Bảng xếp hạng** để xem kết quả theo space.

### 3.4. Trong lúc làm bài

- Random thứ tự câu hỏi bằng Fisher–Yates shuffle trên tập index, lấy đủ N câu theo lựa chọn ở 3.3a. Không lặp câu trong cùng 1 lượt làm bài.
- Single choice → input `radio`. Multi choice → input `checkbox`. Chấm đúng/sai theo **so khớp toàn bộ tập đáp án** (chọn thiếu/thừa = sai câu đó, không tính điểm phần).
- Bộ đếm ngược thời gian hiển thị theo từng câu hỏi, dùng `timer_seconds` học viên đã chọn tại màn hình thiết lập.
- Ngay phía trên nội dung câu hỏi phải hiển thị nhãn loại câu hỏi: **Một đáp án** hoặc **Nhiều đáp án**.
- **Thi thử** và **Thi thật**: hết giờ của một câu → tự động khóa câu hiện tại và chuyển sang câu tiếp theo; nếu đang ở câu cuối → tự động nộp bài. Câu chưa trả lời khi hết giờ = sai.
- **Chế độ luyện tập**: hết giờ của một câu → tự động khóa câu hiện tại, chấm đúng/sai và hiển thị đáp án đúng của câu đó. Không tự động chuyển câu. `timer_seconds` chỉ giới hạn thời gian trả lời, **không giới hạn thời gian review đáp án**.
- Màn hình câu hỏi phải có nút **Prev** và **Next** để học viên điều hướng sang câu trước/câu sau. Câu hỏi chỉ tự động chuyển sang câu tiếp theo trong **Thi thử/Thi thật** khi hết thời gian `timer_seconds`.
- Không có nút **Trả lời** riêng. Nút **Next/Nộp bài** xác nhận lựa chọn hiện tại; ứng dụng cảnh báo nếu chưa chọn đáp án hoặc câu nhiều lựa chọn mới chọn một đáp án. Câu một đáp án dùng radio, câu nhiều đáp án dùng checkbox.
- Trong Luyện tập, nút đầu tiên là **Kiểm tra đáp án** và hiển thị review ngay trong panel; sau khi đã kiểm tra, nút đổi thành **Next/Nộp bài**.
- Nút khóa câu trả lời hiển thị là **Trả lời**. Nếu học viên chưa chọn đáp án thì nút **Trả lời** bị disable.
- Học viên chỉ bấm được **Next** sau khi câu hiện tại đã được bấm **Trả lời** hoặc đã bị tự động khóa do hết giờ.
- Góc phải bên dưới panel câu hỏi có nút **Kết thúc làm bài**. Khi bấm, hiển thị 2 popup xác nhận liên tiếp:
  1. "Các câu chưa làm sẽ được tính là sai."
  2. "Bạn chắc chắn muốn kết thúc làm bài?"
- Nếu học viên xác nhận kết thúc sớm, điểm vẫn tính trên tổng số câu hỏi đã được đưa vào bài thi; câu chưa trả lời được tính tương đương câu sai.
- Ở **Chế độ luyện tập** với lựa chọn **Không giới hạn**, màn hình làm bài không hiển thị bộ đếm giây và không hiển thị text "Không giới hạn".
- Màn hình làm bài phải tự co giãn theo viewport để hạn chế tối đa việc học viên phải cuộn trang hoặc cuộn panel câu hỏi.
- Thanh progress hiển thị số câu đã làm / tổng số câu đã chọn.

### 3.5. Màn hình kết thúc bài quiz

- Tính điểm: `score = round(số câu đúng / tổng số câu trong lượt làm bài * 100)`. Câu chưa trả lời được tính như sai nếu bài bị kết thúc sớm. Ví dụ 68% đúng → hiển thị **68 điểm**.
- Hiển thị danh sách toàn bộ câu đã làm, kèm: đáp án học viên chọn (đánh dấu sai nếu sai), đáp án đúng thật.
- Ở **Thi thử/Thi thật**, file `.key.js` chỉ được fetch sau khi học viên nộp bài / hệ thống tự động nộp bài.
- Ở **Chế độ luyện tập**, `.key.js` có thể đã được fetch trong quá trình làm bài để hiển thị đáp án đúng ngay sau khi từng câu được khóa.
- Nút "Làm lại" → quay về màn hình thiết lập (Mục 3.3), reset toàn bộ state, không giữ lại câu hỏi/đáp án của lượt trước trong memory.
- Màn hình kết quả có nút/tab **Bảng xếp hạng**.
- Nếu lượt làm bài là **Thi thử/Thi thật**, học viên nộp bài bình thường và đã hoàn thành toàn bộ câu hỏi trong lượt thi, frontend lưu kết quả lên Supabase. Không lưu kết quả ở Chế độ luyện tập hoặc khi học viên dùng nút **Kết thúc làm bài**.

### 3.6. Bảng xếp hạng & lưu kết quả Supabase

- Frontend static kết nối Supabase bằng `supabase-js` với `anon key` public và RLS; không dùng service role key trên frontend.
- Cấu hình Supabase nằm trong `/assets/supabase-config.js`.
- Bảng kết quả theo space, lấy 7 ngày gần nhất.
- Mỗi ngày là 1 panel. Trong mỗi ngày, nếu trùng tên học viên thì chỉ hiển thị lượt tốt nhất của học viên đó.
- Tên học viên khi dedupe được normalize bằng trim khoảng trắng, gom nhiều khoảng trắng thành 1, và so sánh không phân biệt hoa thường.
- Mỗi kết quả thi lưu thêm tên Group mà học viên đã chọn.
- Mỗi kết quả thi lưu chế độ làm bài và thời điểm bắt đầu (`started_at`); bảng Kết quả hiển thị Group, Chế độ, duration và ngày giờ làm bài.
- Điểm tổng hợp gồm 75 điểm kiến thức (câu nhiều đáp án chấm gần đúng bằng F1 và có trọng số theo số đáp án đúng), 10 điểm quy mô bài thi, 10 điểm thời gian và 5 điểm đúng giờ. Bảng xếp hạng sắp xếp theo tổng điểm giảm dần.
- Trang Kết quả chỉ hiển thị 3 ngày có kết quả gần nhất.
- Admin có thể bật **Thi thật** theo Space, cố định tỷ lệ câu hỏi, timer, tỷ lệ câu nhiều đáp án và giới hạn 1-5 lượt theo tên học viên trên trình duyệt. Khi bật, frontend ẩn toggle Thi thử/Luyện tập và áp dụng cấu hình đã Generate.
- Mỗi kỳ Thi thật có một định danh riêng; khi bật một kỳ mới hoặc đổi khoảng thời gian thi, bộ đếm lượt trong `localStorage` tự bắt đầu lại từ 0.
- Thi thật có ngày giờ bắt đầu/kết thúc. Ngoài khoảng này frontend ẩn cấu hình làm bài, hiển thị **Hết thời gian thi** và chỉ cho truy cập Kết quả; bảng Kết quả chỉ lấy các bản ghi `real` có `started_at` trong kỳ thi.
- Space cloud có trạng thái Published. Khi tắt Published, truy cập slug trả về màn hình **404 error** và không fallback sang dữ liệu Generate cũ.
- Upload CSV mặc định nối thêm câu hỏi vào Space. Admin có nút xóa toàn bộ câu hỏi riêng trong popup Upload CSV.
- Thứ tự xếp hạng: điểm cao hơn → thời gian làm bài ngắn hơn → thời điểm nộp sớm hơn.
- Mặc định hiển thị 15 học viên/ngày; có thể mở rộng để xem toàn bộ.
- 3 học viên cao nhất trong ngày được làm nổi bật với thứ hạng Vàng, Bạc, Đồng.
- Dữ liệu lưu tối đa 7 ngày gần nhất và tối đa 1000 bản ghi; việc dọn dữ liệu thực hiện bằng SQL/Supabase Cron.

---

## 4. BACKEND — Yêu cầu chức năng chi tiết

### 4.1. Stack kỹ thuật

| Thành phần | Lựa chọn |
|---|---|
| Runtime | Node.js (LTS) |
| Web framework | Express |
| Database | SQLite qua `better-sqlite3` |
| Hash password | `bcrypt` |
| Upload file | `multer` |
| Parse CSV | `csv-parse` (hoặc `papaparse` bản Node) |
| Session | `express-session` (lưu session local, không cần JWT vì chỉ chạy local) |
| Mã hoá dữ liệu quiz | Module tự viết theo Mục 6 |

### 4.2. Đăng nhập & phân quyền

- 2 vai trò: `superadmin`, `admin`.
- Form đăng nhập: username + password. Password được hash ở phía client trước khi submit (vd SHA-256) **và** hash lại bằng bcrypt ở server trước khi so sánh/lưu (double layer theo đúng yêu cầu BRD).
- Chức năng "Quên mật khẩu" tại màn hình login:
  - Người dùng nhập username → kiểm tra tồn tại trong DB.
  - Nếu tồn tại → hiển thị popup xác nhận "Bạn có chắc muốn yêu cầu reset mật khẩu?".
  - Nếu xác nhận → set `reset_password = ON` cho user đó (superadmin sẽ thấy cảnh báo và xử lý cấp lại mật khẩu mới thủ công — không gửi email vì backend không có kết nối ra ngoài).
- Mỗi user tự đổi được mật khẩu của mình (cả superadmin và admin).

### 4.3. Quản lý Admin (chỉ superadmin)

Bảng hiển thị danh sách user (admin + superadmin) với các cột: Fullname, username, space đã gán, trạng thái active, trạng thái reset_password.

- Icon cảnh báo ⚠️ hiển thị trên dòng nếu `reset_password = ON` hoặc `active = OFF`.
- Thao tác: Thêm / Sửa / Xóa admin, Cấp lại mật khẩu (superadmin set password mới trực tiếp), Gán space (1 admin ↔ nhiều space, multi-select), Active/Inactive, Toggle reset_password ON/OFF.
- Giá trị mặc định khi tạo user mới: `active = ON`, `reset_password = OFF`.

### 4.4. Quản lý Space

CRUD cho space, mỗi space có:
| Field | Ghi chú |
|---|---|
| `name` | Tên hiển thị (chỉ thấy trong backend) |
| `slug` | Đường dẫn bí mật, vd `quiz1234`. Không hiển thị ở trang chủ frontend. |
| `timer_seconds` | Thời gian làm bài (giây), cấu hình tại đây |
| `data_token` | Random, tự sinh mỗi lần Generate — xem Mục 6 |
| `key_salt` | Salt dùng để derive key_token và hash đáp án — xem Mục 6 |

- Gán space cho 1 hoặc nhiều admin (many-to-many).
- Mỗi khi tạo/sửa space hoặc cập nhật bộ câu hỏi → backend hiển thị banner nhắc: **"Bạn cần Generate lại và Export/Deploy thủ công lên Netlify để thay đổi có hiệu lực."**
- Mỗi space cho phép cài đặt timer_seconds là thời gian trả lời của mỗi câu hỏi, của riêng space đó với các mốc: 15s, 30s, 45s, 60s, 90s,120s, không giới hạn.

### 4.5. Upload & quản lý câu hỏi (CSV)

**Cấu trúc CSV bắt buộc** (header tiếng Việt, theo đúng mẫu trong BRD; cho phép alias thực tế từ file Excel/CSV nội bộ):

| Số thứ tự | Loại câu hỏi | Nội dung câu hỏi | A | B | C | D | E | Đáp án đúng |
|---|---|---|---|---|---|---|---|---|

- Cột `Số thứ tự` được phép dùng alias `TT`.
- Các cột lựa chọn `A`, `B` là bắt buộc và phải có dữ liệu. `C`, `D`, `E` là tùy chọn theo số lượng lựa chọn thực tế; nếu không có lựa chọn thì để trống. File chỉ có dữ liệu ở A,B được hiểu là câu hỏi có 2 lựa chọn; có dữ liệu ở A,B,C là 3 lựa chọn; tương tự tới tối đa A–E.
- Các lựa chọn có dữ liệu phải liên tục từ A → B → C → D → E. Ví dụ A,B,D có dữ liệu nhưng C trống là không hợp lệ.
- Backend phải trim khoảng trắng thừa trong header, loại câu hỏi, nội dung, lựa chọn và đáp án đúng trước khi validate.
- `Loại câu hỏi`: chỉ nhận giá trị `"Một lựa chọn"` hoặc `"Nhiều lựa chọn"`.
- Số đáp án (cột A–E): 2 đến 5 đáp án, cột nào không tồn tại hoặc trống thì coi là không có đáp án đó (cho phép câu hỏi chỉ có A,B,C hoặc A,B,C,D).
- `Đáp án đúng`: với "Một lựa chọn" → đúng 1 ký tự (A–E); với "Nhiều lựa chọn" → 2 đến 5 ký tự, phân tách bằng dấu phẩy (vd `A, B, C`), không trùng lặp, phải nằm trong các cột đáp án đã điền.

**Quy trình xử lý**:
1. Admin/Superadmin vào màn hình Space → upload CSV.
2. Backend parse + validate **toàn bộ** file trước khi lưu bất kỳ dòng nào:
   - Sai cấu trúc cột → báo lỗi, dừng, không lưu gì.
   - Đúng cấu trúc nhưng có dòng lỗi logic (vd đáp án đúng không khớp cột đáp án, loại câu hỏi sai giá trị, số đáp án ngoài khoảng 2–5) → liệt kê **chi tiết theo từng dòng lỗi**, dừng, không lưu.
3. Nếu toàn bộ hợp lệ → hiển thị bảng preview (số câu hỏi, vài câu mẫu) + nút "Xác nhận tạo dữ liệu".
4. Khi xác nhận → ghi vào bảng `questions` của SQLite, **xoá sạch** câu hỏi cũ của space đó trước khi ghi mới (replace toàn bộ, không merge).

### 4.6. Generate & Export

- Nút **"Generate"** tại màn hình Space: đọc câu hỏi từ SQLite của space đó → mã hoá theo Mục 6 → ghi ra 3 loại file tĩnh (`index.enc.js` cập nhật mapping, `<data_token>.data.js`, `<key_token>.key.js`) vào thư mục build local (`/backend/dist/`).
  - Mỗi lần Generate → `data_token` và `key_token`/`key_salt` được **sinh mới hoàn toàn** (rotate), token cũ ngay lập tức không còn được tham chiếu trong `index.enc.js` mới.
- Nút **"Xuất bộ deploy"**: đóng gói toàn bộ `/backend/dist/` (gồm `index.html`, `/assets`, `/data`, `_redirects`) thành 1 thư mục/zip sẵn sàng để owner tự kéo thả lên Netlify (deploy thủ công, không có CI/CD).

---

## 5. Database Schema (SQLite)

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
  timer_seconds INTEGER NOT NULL DEFAULT 1800,
  data_token TEXT,
  key_token TEXT,
  key_salt TEXT,
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
  options_json TEXT NOT NULL,     -- {"A":"...","B":"...",...}
  correct_json TEXT NOT NULL      -- ["A","C"]
);
```

---

## 6. Cơ chế chống cheat / ẩn dữ liệu (mức "nâng cao")

> **Lưu ý quan trọng cần ghi rõ cho AI agent**: vì frontend là static site chạy hoàn toàn trên browser, **không có giải pháp nào chặn được 100%** một người dùng có kỹ thuật cố tình đọc source code / Console. Toàn bộ cơ chế dưới đây nhằm mục tiêu: (a) chặn dò quét slug không có thật, (b) chặn việc xem trước đáp án đúng trước/trong khi làm bài — đây là kiểu cheat phổ biến nhất với học viên thông thường.

### 6.1. Ẩn tên file dữ liệu (chống dò mù)

- `data_token`: chuỗi hex ngẫu nhiên 16 ký tự (`crypto.randomBytes(8).toString('hex')`), không liên quan gì tới `slug`.
- File `index.enc.js` **không lưu slug dạng plaintext**. Chỉ lưu cặp `sha256(slug) → data_token`. Ví dụ nội dung:
```js
window.__SQ_INDEX__ = {
  "a94f...": "7f9a2c4e1b8d33aa",
  "c102...": "11bb9f0e2d4c55ff"
};
```
- Khi app load, tính `sha256(currentSlugFromURL)` rồi tra trong object trên để tìm `data_token` tương ứng.
- Mỗi lần "Generate" → toàn bộ `data_token` rotate mới → link/file cũ vô hiệu ngay khi owner deploy bản mới.

### 6.2. Tách đáp án đúng khỏi câu hỏi (chống xem trước đáp án)

- File `<data_token>.data.js`: chỉ chứa nội dung câu hỏi + các lựa chọn. **Tuyệt đối không có đáp án đúng dạng plaintext.** Thay vào đó, mỗi câu hỏi có thêm 1 trường `check` là **hash của tổ hợp đáp án đúng + salt riêng của câu đó**:
```js
// per câu hỏi trong file data
{
  id, type, content, options: {A:"...", B:"...", C:"..."},
  check: sha256(sortedCorrectLetters.join(",") + perQuestionSalt)
}
```
- **Chế độ luyện tập**: client tính `sha256(sortedSelectedLetters.join(",") + perQuestionSalt)` và so với `check` để biết đúng/sai ngay sau khi câu được khóa; đồng thời fetch file `<key_token>.key.js` khi cần để hiển thị đáp án đúng thật ngay trên màn hình câu hỏi. Việc fetch đáp án trong chế độ luyện tập chỉ diễn ra sau khi học viên đã chọn/khóa đáp án của câu hiện tại.
- **Đáp án đúng thật** nằm trong file riêng `<key_token>.key.js`, với `key_token = sha256(data_token + key_salt)` — **không được nhúng sẵn trong `data.js` hay trong code tải lúc đầu**.
- Ở **Chế độ thi**, hàm tính `key_token` chỉ được gọi trong logic xử lý lúc bấm "Nộp bài" / khi hệ thống tự động nộp bài / khi vào màn hình kết thúc, tức là **chỉ fetch file đáp án đúng sau khi học viên đã hoàn thành lượt làm bài** đó.
- Ở **Chế độ luyện tập**, hàm tính `key_token` được phép gọi sau khi học viên khóa câu trả lời đầu tiên để phục vụ review tức thời. Đây là đánh đổi UX có chủ đích theo yêu cầu sản phẩm.
- `key_salt` cũng rotate mỗi lần Generate, đồng bộ với `data_token`.

### 6.3. Các lớp deter bổ sung (không phải bảo mật thật, chỉ tăng độ khó)

- Disable chuột phải (context menu) trên toàn trang quiz.
- Phát hiện cơ bản DevTools mở (qua chênh lệch `window.outerWidth/innerWidth`) → có thể hiển thị overlay cảnh báo (tuỳ chọn, không bắt buộc chặn cứng vì có thể gây trải nghiệm xấu với học viên dùng màn hình nhỏ/responsive — AI agent cần cân nhắc UX trước khi bật).

---

## 7. Quy trình Deploy (thủ công)

1. Owner thực hiện toàn bộ thay đổi trên backend (local): thêm/sửa space, upload CSV, sửa câu hỏi.
2. Bấm **Generate** cho từng space đã thay đổi (rotate token, sinh file mã hoá).
3. Bấm **Xuất bộ deploy** → backend đóng gói thư mục `dist/` hoàn chỉnh.
4. Owner tự kéo thả thư mục đó vào Netlify (Drag & drop deploy) **hoặc** chạy `netlify deploy --prod --dir=dist` nếu đã cài Netlify CLI — không có bước này tự động trong backend, chỉ chuẩn bị sẵn thư mục.
5. Backend hiển thị rõ trạng thái: "Có thay đổi chưa deploy" (so sánh thời điểm Generate gần nhất với thời điểm sửa dữ liệu gần nhất) để owner không quên deploy.

---

## 8. UI/UX Design Guide

### 8.1. Font & màu sắc

- Font: `Be Vietnam Pro` hoặc `Inter` (hỗ trợ tốt dấu tiếng Việt), cỡ chữ tối thiểu 16px cho nội dung, 20px+ cho câu hỏi quiz.
- Theme dùng CSS variables, ví dụ:
```css
:root {
  --bg: #ffffff; --text: #1a1a1a; --primary: #4f46e5;
  --correct: #16a34a; --wrong: #dc2626; --muted: #6b7280;
}
[data-theme="dark"] {
  --bg: #111827; --text: #f3f4f6; --primary: #818cf8;
  --correct: #4ade80; --wrong: #f87171; --muted: #9ca3af;
}
```
- Toggle light/dark lưu trong `localStorage`, mặc định theo `prefers-color-scheme`.

### 8.2. Màn hình Frontend (học viên)

| Màn hình | Bố cục chính |
|---|---|
| Chào mừng | Logo/tên app giữa màn hình, không có liên kết nào khác |
| Thiết lập quiz | Card trung tâm: 4 nút lớn chọn %, 2 nút lớn chọn chế độ, nút "Bắt đầu" |
| Làm bài | Progress bar trên cùng, timer góc phải, câu hỏi + lựa chọn chiếm giữa màn hình, nút Tiếp theo/Nộp bài |
| Kết quả | Điểm số dạng số lớn/donut chart ở trên, danh sách review từng câu (đúng = viền xanh, sai = viền đỏ kèm đáp án đúng), nút "Làm lại" |

### 8.3. Màn hình Backend (superadmin/admin)

- Layout sidebar cố định: Dashboard, Quản lý Admin (chỉ superadmin thấy), Quản lý Space, Đổi mật khẩu.
- Bảng danh sách dùng icon cảnh báo cho trạng thái bất thường (reset_password=ON, active=OFF).
- Form thêm/sửa hiển thị dạng modal, không chuyển trang.
- Khu vực upload CSV: kéo-thả + hiển thị bảng lỗi rõ theo từng dòng nếu có.

---

## 9. Acceptance Criteria (Definition of Done)

- [ ] Học viên vào đúng slug → load đúng space; vào slug sai/space gốc → luôn thấy màn hình chào mừng, không có cách nào phân biệt được "slug sai" và "site gốc".
- [ ] Ở **Chế độ thi**, đáp án đúng không xuất hiện ở bất kỳ request/response nào trước khi học viên nộp bài (kiểm tra bằng tab Network khi đang làm bài).
- [ ] Ở **Chế độ luyện tập**, đáp án đúng chỉ được fetch/hiển thị sau khi học viên đã khóa câu trả lời để review câu hỏi; timer chỉ giới hạn thời gian trả lời, không giới hạn thời gian review.
- [ ] Học viên chọn được `timer_seconds` tại màn hình thiết lập; giá trị này được dùng làm bộ đếm ngược riêng cho từng câu hỏi.
- [ ] Màn hình câu hỏi có nút Prev/Next; chỉ Chế độ thi mới tự động chuyển câu khi hết thời gian.
- [ ] Mỗi lần Generate, `data_token`/`key_token` đổi hoàn toàn so với lần trước.
- [ ] CSV sai cấu trúc/logic → backend chặn và báo lỗi rõ theo dòng, không cho lưu dữ liệu nửa chừng.
- [ ] Superadmin thấy và quản lý được toàn bộ admin + space; admin chỉ thấy space được gán.
- [ ] Toggle dark/light hoạt động và giữ trạng thái sau khi reload.
- [ ] Điểm số tính đúng theo công thức `round(đúng/tổng đã chọn làm * 100)`.
- [ ] Backend luôn cảnh báo rõ khi có thay đổi chưa được Generate/Export/Deploy.
