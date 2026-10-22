# Hướng dẫn Coding Standard cho AI Agent (Đa ngôn ngữ + Vercel Build + An toàn thông tin)

> File này dùng làm system prompt / context chuẩn khi nhờ AI (Claude, ChatGPT/Codex, Gemini, GitHub Copilot, Claude Code...)
> viết code cho dự án web app: TypeScript/JavaScript (Next.js, React, Node), Python (backend/script) và SQL (database),
> deploy lên Vercel (hoặc hạ tầng tương đương).
> Phạm vi áp dụng: ứng dụng quy mô nhỏ (< 100 người dùng, < 50 người truy cập đồng thời).
> Mục tiêu: code AI sinh ra phải chạy đúng, build/deploy thành công ngay lần đầu, không phát sinh lỗi type, lỗi lint,
> và không mắc các lỗi bảo mật phổ biến (theo OWASP Top 10) ở mức cơ bản phù hợp với quy mô ứng dụng nhỏ.

---

## 1. Quy định chung cho mọi ngôn ngữ

Áp dụng cho **mọi** đoạn code AI viết ra, bất kể ngôn ngữ nào (TypeScript, JavaScript, Python, SQL, Shell, YAML...):

1. **Không hardcode secrets/credentials** (API key, password, connection string...) — luôn đọc từ biến môi trường (`process.env`, `os.environ`, `.env`) và báo cho người dùng nếu phát sinh biến mới.
2. **Xử lý lỗi rõ ràng, không nuốt lỗi âm thầm** — dùng `try/catch` (JS/TS) hoặc `try/except` (Python) có mục đích cụ thể, không để `catch (e) {}` hoặc `except: pass` trống rỗng.
3. **Validate dữ liệu đầu vào** — mọi dữ liệu từ user, API, request body, query param, hoặc DB đều phải được kiểm tra/validate trước khi dùng (không tin tưởng input tuyệt đối).
4. **Không dùng magic number/string** — định nghĩa hằng số (`const`, `enum`, `Final`) có tên rõ nghĩa thay vì số/chuỗi rời rạc trong logic.
5. **Đặt tên rõ ràng, nhất quán** theo convention chuẩn của từng ngôn ngữ (xem mục 2), không viết tắt tùy tiện.
6. **Tuân thủ nguyên tắc DRY & Single Responsibility** — không copy-paste logic giữa nhiều nơi; mỗi hàm/module chỉ làm một việc.
7. **Không log dữ liệu nhạy cảm** (mật khẩu, token, thông tin cá nhân) ra console/log file.
8. **Nhất quán với codebase hiện có** — trước khi viết mới, đọc pattern/convention đã dùng trong dự án (thư viện, cấu trúc thư mục, style) và làm theo, không tự ý đổi phong cách.
9. **Format code bằng tool chuẩn của ngôn ngữ** trước khi bàn giao (Prettier cho JS/TS, Black/Ruff cho Python, sqlfluff cho SQL...).
10. **Viết comment/docstring cho phần logic phức tạp**, không comment những gì đã quá hiển nhiên từ tên biến/hàm.
11. **Không tự ý thêm dependency/thư viện mới** nếu không cần thiết — nếu thêm, phải nêu rõ lý do và cập nhật file quản lý dependency (`package.json`, `requirements.txt`, `pyproject.toml`...).

---

## 2. Tiêu chuẩn riêng theo từng ngôn ngữ

### 2.1. TypeScript (Strict Mode)

#### 2.1.1. Không bao giờ để tham số hàm bị implicit `any`
❌ **Sai:**
```ts
users.map((user) => user.name)
```
Nếu `users` không có kiểu rõ ràng, `user` sẽ bị lỗi `Parameter 'user' implicitly has an 'any' type`.

✅ **Đúng:**
```ts
const users: User[] = await getUsers();
users.map((user) => user.name) // TS tự suy luận đúng, không cần khai báo lại
```
Áp dụng nguyên tắc này cho mọi hàm mảng: `map`, `filter`, `reduce`, `forEach`... — đặc biệt khi mảng nguồn có kiểu điều kiện hoặc suy luận (conditional/inferred types), phải khai báo type tường minh cho callback.

#### 2.1.2. Tuyệt đối không dùng `any` để "cho qua" lỗi
❌ Tránh:
```ts
function handleData(data: any) { ... }
```
✅ Thay bằng:
```ts
function handleData(data: UserData) { ... }
```
- Nếu thực sự chưa biết kiểu chính xác, dùng `unknown` rồi kiểm tra kiểu (type narrowing) trước khi dùng.
- Chỉ chấp nhận `any` khi bị ép buộc bởi một type của thư viện bên thứ ba (third-party) không thể thay đổi.

#### 2.1.3. Luôn định nghĩa `interface`/`type` rõ ràng cho:
- Props của component (`interface Props { ... }`)
- Dữ liệu trả về từ API / database
- Tham số của mọi hàm (callback, event handler, arrow function...)
- State (`useState<Type>(...)`)
- Các object dùng trong code — không dùng `any` cho object.

Import type dùng chung từ một nơi duy nhất, không định nghĩa lại rải rác nhiều file:
```ts
import type { User, Account } from "@/types";
```
Nên gom các type dùng chung vào `src/types.ts` hoặc thư mục `src/types/` để tránh trùng lặp, không đồng nhất giữa các file do AI generate.

#### 2.1.4. Không khai báo biến khởi tạo rỗng mà thiếu kiểu
Khi giá trị ban đầu là `[]`, `{}`, `null`, hoặc một `Promise` rỗng, phải khai báo kiểu tường minh để tránh TS suy luận thành `any[]`:
```ts
// ❌ Sai — dễ bị suy luận thành any[]
return Promise.resolve([]);

// ✅ Đúng
return Promise.resolve<Bank[]>([]);
```
Nếu một giá trị có thể được trả về từ nhiều nhánh Promise/điều kiện khác nhau, đảm bảo tất cả các nhánh đều resolve về cùng một kiểu dữ liệu (shape) thống nhất.

#### 2.1.5. Xử lý giá trị có thể `null` / `undefined`
❌ Sai:
```ts
function getName(user: User) {
  return user.profile.name; // lỗi nếu profile có thể undefined
}
```
✅ Đúng:
```ts
function getName(user: User) {
  return user.profile?.name ?? "Unknown";
}
```
Mọi giá trị có khả năng `null`/`undefined` phải được xử lý bằng `?.`, `??`, hoặc kiểm tra `if` rõ ràng.

#### 2.1.6. Định nghĩa kiểu trả về cho hàm phức tạp
```ts
function calculateTotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}
```

#### 2.1.7. Component React — luôn khai báo Props type
```tsx
interface AccountsListProps {
  accounts: Account[];
  onSelect: (id: string) => void;
}

export function AccountsList({ accounts, onSelect }: AccountsListProps) {
  ...
}
```

#### 2.1.8. Event handler — luôn dùng đúng type của React
```tsx
function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
  console.log(e.target.value);
}

function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
  ...
}
```

#### 2.1.9. Dữ liệu từ API (fetch/axios) — luôn ép kiểu rõ ràng, nên validate bằng zod
```ts
interface ApiResponse {
  data: User[];
  total: number;
}

const res = await fetch("/api/users");
const json: ApiResponse = await res.json();
```

#### 2.1.10. Thận trọng với type từ ORM (ví dụ Prisma)
Tránh import trực tiếp model type từ root exports của `@prisma/client` cho các đoạn code build-critical. Ưu tiên dùng type suy diễn từ chính lệnh gọi client, hoặc định nghĩa shape cục bộ:
```ts
type Bank = Awaited<ReturnType<typeof prisma.bank.findMany>>[number];
```

#### 2.1.11. Quy tắc Lint & ràng buộc riêng của Next.js
- Chạy `next lint` (hoặc linter tương đương của framework) trước khi hoàn tất.
- Không để các ký tự như `'`, `"`, `<`, `>` đứng trơ trọi trong JSX/HTML. Phải bọc trong `{'...'}` hoặc dùng HTML entity (ví dụ `&apos;` thay cho dấu nháy đơn).
- Không dùng thẻ `<img>` thuần trong Next.js; bắt buộc dùng component `<Image />`.
- Đảm bảo tên file/component được import ĐÚNG chính xác từng chữ hoa/chữ thường — Vercel (Linux, phân biệt hoa/thường) khác với môi trường localhost (thường không phân biệt), nên lỗi sai chính tả import chỉ lộ ra khi build trên Vercel.
- Với route động (dynamic routing params), đảm bảo kiểu tham số khớp chính xác với template typing của Next.js.

---

### 2.2. JavaScript (khi dự án/phần code không dùng TypeScript)

- Ưu tiên đề xuất chuyển sang TypeScript nếu dự án cho phép; nếu bắt buộc dùng JS thuần, phải bù lại phần thiếu type bằng các quy tắc dưới đây.
- Dùng **JSDoc** để chú thích kiểu cho hàm/tham số quan trọng, giúp editor và AI hiểu rõ kiểu dữ liệu:
  ```js
  /**
   * @param {User[]} users
   * @returns {string[]}
   */
  function getUserNames(users) {
    return users.map((user) => user.name);
  }
  ```
- Luôn dùng `const`/`let`, **không dùng `var`**.
- Dùng `===`/`!==`, không dùng `==`/`!=` (tránh so sánh ép kiểu ngầm).
- Dùng `async/await` thay vì callback lồng nhau (callback hell) hoặc `.then()` chuỗi dài.
- Bật và tuân thủ **ESLint** (kèm plugin phù hợp: `eslint-plugin-react`, `eslint-plugin-node`...) — sửa hết lỗi/warning trước khi bàn giao.
- Kiểm tra `null`/`undefined` tường minh trước khi truy cập thuộc tính lồng nhau (dùng optional chaining `?.` và nullish coalescing `??`, đều đã hỗ trợ trong JS hiện đại).
- Không mutate trực tiếp state/props trong React (tạo object/array mới thay vì sửa tại chỗ).
- Với dữ liệu từ API, validate bằng thư viện runtime (ví dụ `zod`, `yup`, `joi`) vì JS không có type-checking lúc build.

---

### 2.3. Python (backend API, script xử lý dữ liệu, automation)

- **Tuân thủ PEP8**; format bằng `black`, lint bằng `ruff` hoặc `flake8`.
- **Luôn dùng type hints** (`typing` module) cho tham số hàm và giá trị trả về:
  ```python
  def calculate_total(items: list[CartItem]) -> float:
      return sum(item.price for item in items)
  ```
- Chạy `mypy` (hoặc `pyright`) để kiểm tra type tĩnh trước khi bàn giao, tương đương `tsc --noEmit` bên TypeScript.
- Dùng **Pydantic** (nếu dùng FastAPI) hoặc **dataclass** để định nghĩa schema dữ liệu request/response và validate input, thay vì dict rời rạc không kiểm soát:
  ```python
  from pydantic import BaseModel

  class UserCreate(BaseModel):
      name: str
      email: str
  ```
- Xử lý exception **cụ thể**, không dùng bare `except:` — luôn bắt đúng loại exception và xử lý/log rõ ràng:
  ```python
  # ❌ Sai
  try:
      ...
  except:
      pass

  # ✅ Đúng
  try:
      ...
  except ValueError as e:
      logger.error(f"Invalid input: {e}")
      raise
  ```
- Dùng f-string (`f"{name}"`) thay vì `%` hoặc `.format()`.
- Quản lý dependency rõ ràng qua `requirements.txt` hoặc `pyproject.toml` (kèm version pin khi deploy production); khai báo và dùng **virtual environment** (`venv`, `poetry`, `uv`).
- Viết docstring theo chuẩn nhất quán (Google style hoặc NumPy style) cho các hàm/class public.
- Với code chạy async (FastAPI, `asyncio`), không gọi hàm blocking (I/O đồng bộ) trong hàm `async def` — dùng thư viện async tương ứng hoặc `run_in_executor`.

---

### 2.4. SQL (truy vấn, schema, migration)

- **Không dùng `SELECT *`** trong code production — chỉ định rõ danh sách cột cần lấy.
- **Luôn dùng parameterized query / prepared statement**, tuyệt đối không nối chuỗi trực tiếp giá trị vào câu SQL (chống SQL Injection):
  ```sql
  -- ❌ Sai (nối chuỗi trực tiếp)
  SELECT * FROM users WHERE email = '" + userInput + "'

  -- ✅ Đúng (dùng placeholder của driver/ORM)
  SELECT id, name, email FROM users WHERE email = $1
  ```
- Đặt tên bảng/cột theo convention nhất quán trong dự án (thường là `snake_case`), số nhiều cho tên bảng (`users`, `orders`).
- Thêm **index** cho các cột thường xuyên dùng trong `WHERE`, `JOIN`, `ORDER BY` — đặc biệt khóa ngoại (foreign key).
- Mỗi **migration** phải có cả chiều `up` và `down` (rollback được), không sửa trực tiếp migration đã chạy production — luôn tạo migration mới.
- Dùng **transaction** cho các thao tác gồm nhiều câu lệnh ghi dữ liệu liên quan đến nhau, đảm bảo tính toàn vẹn (all-or-nothing).
- Tránh vấn đề **N+1 query** — khi cần dữ liệu quan hệ, dùng `JOIN` hoặc `include`/`select` của ORM thay vì query trong vòng lặp.
- Khi dùng ORM (Prisma, Drizzle, SQLAlchemy...), ưu tiên API/type-safe query của ORM hơn raw SQL; nếu buộc phải dùng raw SQL, vẫn phải qua parameter binding của ORM, không tự nối chuỗi.
- Ràng buộc dữ liệu (NOT NULL, UNIQUE, FOREIGN KEY, CHECK) nên được định nghĩa ở tầng database, không chỉ dựa vào validate ở tầng ứng dụng.

---

## 3. Tiêu chuẩn An toàn thông tin (Security) — mức cơ bản cho ứng dụng nhỏ

> Phạm vi: ứng dụng < 100 người dùng, < 50 người truy cập đồng thời. Không yêu cầu hạ tầng phức tạp (WAF, SOC2, pentest định kỳ...),
> nhưng bắt buộc chặn được các lỗi phổ biến nhất theo **OWASP Top 10**, vì đây là nguyên nhân chính khiến app nhỏ bị tấn công tự động (bot quét lỗ hổng hàng loạt, không phân biệt quy mô).

### 3.1. Chống Injection (SQL Injection, NoSQL Injection, Command Injection)
- Không bao giờ nối chuỗi trực tiếp input của user vào câu lệnh SQL, câu lệnh shell, hay query NoSQL (xem thêm mục 2.4).
- Không dùng `eval()`, `exec()`, `child_process.exec()` (Node) hoặc `os.system()` (Python) với dữ liệu có nguồn gốc từ user.
- Nếu cần chạy lệnh hệ thống, dùng danh sách tham số tách rời (ví dụ `execFile`/`subprocess.run([...])` với mảng argument) thay vì chuỗi lệnh ghép.

### 3.2. Chống XSS (Cross-Site Scripting)
- Không dùng `dangerouslySetInnerHTML` (React) hoặc render HTML thô từ input user; nếu bắt buộc, phải sanitize bằng thư viện đáng tin cậy (ví dụ `DOMPurify`).
- Framework hiện đại (React/Next.js) tự động escape output — không tự ý bypass cơ chế escape mặc định.
- Với API trả dữ liệu ra frontend, đảm bảo `Content-Type` khai báo đúng (`application/json`) để trình duyệt không tự diễn giải nhầm thành HTML.

### 3.3. Chống CSRF (Cross-Site Request Forgery)
- Với các action làm thay đổi dữ liệu (POST/PUT/PATCH/DELETE), xác thực request đến từ đúng nguồn gốc (kiểm tra CSRF token, hoặc dùng cookie `SameSite=Lax`/`Strict`).
- Nếu dùng cookie-based session, luôn bật `SameSite` cho cookie thay vì để mặc định.

### 3.4. Xác thực (Authentication) & Phân quyền (Authorization)
- **Không tự viết thuật toán mã hoá mật khẩu riêng** — dùng thư viện chuẩn đã kiểm chứng: `bcrypt`, `argon2` (không dùng MD5/SHA1 để lưu mật khẩu).
- Mật khẩu, token phải được hash trước khi lưu DB; không bao giờ lưu plaintext.
- Mọi API endpoint xử lý dữ liệu riêng tư/nhạy cảm đều phải kiểm tra người dùng đã đăng nhập (authentication) **và** có quyền truy cập đúng tài nguyên đó (authorization) — không chỉ kiểm tra đăng nhập rồi mặc định cho phép truy cập mọi resource (lỗi **IDOR – Insecure Direct Object Reference**, ví dụ: user A gọi `/api/orders/123` sửa được đơn hàng của user B nếu chỉ check "đã đăng nhập" mà không check "đơn hàng này có thuộc về user A không").
- Với session/JWT: đặt thời gian hết hạn hợp lý (ví dụ vài giờ đến vài ngày tùy loại app), có cơ chế refresh token hoặc logout thu hồi được session.
- Giới hạn số lần đăng nhập sai (rate limit cho endpoint login) để chống brute-force — với app nhỏ, có thể dùng giải pháp đơn giản như đếm số lần thất bại trong DB/cache và khoá tạm thời.

### 3.5. Quản lý Secrets & Cấu hình
- Không commit file `.env`, API key, private key lên Git — luôn có `.env` trong `.gitignore`.
- Không để secrets xuất hiện trong code phía client (frontend) — biến `NEXT_PUBLIC_*` (Next.js) là **public**, chỉ dùng cho dữ liệu không nhạy cảm; secrets thật sự chỉ được dùng ở phía server.
- Khi AI viết code mẫu/test, dùng giá trị giả (`YOUR_API_KEY_HERE`), không tự bịa secrets trông giống thật.

### 3.6. Bảo vệ dữ liệu & Database
- Áp dụng nguyên tắc **least privilege**: tài khoản DB dùng cho ứng dụng chỉ có quyền cần thiết (không dùng tài khoản admin/root cho kết nối ứng dụng thông thường).
- Với dữ liệu nhạy cảm (số điện thoại, CMND/CCCD, thông tin thanh toán...), cân nhắc mã hoá ở tầng lưu trữ hoặc tối thiểu hạn chế field trả về API (không trả toàn bộ record nếu không cần).
- Có cơ chế backup định kỳ cho database, dù app nhỏ — tối thiểu backup tự động theo lịch của nhà cung cấp hosting/DB (Vercel Postgres, Supabase, PlanetScale... đều có sẵn tính năng này).

### 3.7. Rate Limiting & Chống lạm dụng
- Với app < 50 người dùng đồng thời, không cần hệ thống rate-limit phức tạp, nhưng nên có giới hạn cơ bản cho các endpoint dễ bị lạm dụng (login, form liên hệ, gửi email, upload file) để tránh spam/bot — có thể dùng middleware đơn giản hoặc dịch vụ có sẵn (Vercel Edge Config, Upstash Ratelimit...).
- Giới hạn kích thước request body (`body-parser` limit, Next.js API route config) để tránh tấn công gửi payload khổng lồ.

### 3.8. Upload file (nếu ứng dụng có tính năng này)
- Giới hạn định dạng file cho phép (whitelist theo MIME type thực tế, không chỉ dựa vào đuôi file).
- Giới hạn dung lượng file tối đa.
- Không lưu file upload trực tiếp vào thư mục có thể thực thi code; ưu tiên lưu lên storage riêng (S3, Vercel Blob, Supabase Storage...) và phục vụ qua URL riêng, không phải qua route thực thi code của server.
- Đổi tên file khi lưu (tránh dùng tên file gốc từ user để tránh path traversal, ví dụ `../../etc/passwd`).

### 3.9. HTTPS & Security Headers
- Đảm bảo toàn bộ traffic chạy qua HTTPS (Vercel tự động cấp SSL — không cần cấu hình thêm, nhưng phải kiểm tra không có link/API nào gọi qua `http://`).
- Thêm các HTTP security header cơ bản (có thể cấu hình qua `next.config.js` hoặc middleware):
  - `Content-Security-Policy` (hạn chế nguồn script/style được phép chạy)
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `X-Frame-Options: DENY` (hoặc CSP `frame-ancestors`) để chống clickjacking

### 3.10. Xử lý lỗi & Logging an toàn
- Không trả chi tiết lỗi hệ thống (stack trace, câu SQL, đường dẫn file nội bộ) ra response cho client ở môi trường production — chỉ trả thông báo lỗi chung chung, log chi tiết ở phía server.
- Log đủ thông tin để điều tra sự cố (thời gian, endpoint, user id nếu có) nhưng không log mật khẩu/token/dữ liệu cá nhân nhạy cảm.

### 3.11. Quản lý Dependency
- Định kỳ kiểm tra lỗ hổng bảo mật của thư viện bên thứ ba: `npm audit` (JS/TS) hoặc `pip-audit`/`safety` (Python).
- Không dùng package không rõ nguồn gốc, ít người dùng, lâu không cập nhật cho các chức năng nhạy cảm (auth, thanh toán, mã hoá).
- Cập nhật dependency có lỗ hổng mức độ cao/nghiêm trọng (`high`/`critical`) sớm nhất có thể, kể cả với app nhỏ.

---

## 4. Biến môi trường (Environment Variables)

- Xác nhận mọi biến môi trường (`process.env` trong JS/TS, `os.environ`/`os.getenv` trong Python, connection string trong SQL config) được sử dụng trong code đều đã tồn tại (local `.env` hoặc được mock khi test).
- Nếu code mới phát sinh biến môi trường mới, phải báo ngay cho người dùng biết để họ thêm vào Vercel Dashboard (hoặc hệ thống secret management tương ứng).

---

## 5. Checklist AI phải tự kiểm tra trước khi trả code

**Chung cho mọi ngôn ngữ:**
- [ ] Không hardcode secrets/credentials; biến môi trường mới (nếu có) đã được báo cho người dùng.
- [ ] Không có khối `catch`/`except` trống rỗng nuốt lỗi âm thầm.
- [ ] Dữ liệu đầu vào từ user/API/DB đều được validate.
- [ ] Không có magic number/string; đặt tên biến/hàm rõ ràng, nhất quán với codebase hiện có.
- [ ] Đã format code bằng tool chuẩn của ngôn ngữ tương ứng.

**TypeScript/JavaScript:**
- [ ] Mọi tham số hàm/callback đều có kiểu tường minh (TS) hoặc JSDoc (JS), không có implicit `any`.
- [ ] Không có `any` nào xuất hiện (trừ khi bị ép buộc bởi type của thư viện bên thứ ba).
- [ ] Mọi Props của component đều có `interface`/`type`.
- [ ] Mọi giá trị có khả năng `null`/`undefined` đều được xử lý bằng `?.`, `??`, hoặc `if`.
- [ ] Dữ liệu trả về từ API/database được ép kiểu hoặc validate (ưu tiên dùng `zod` nếu có).
- [ ] Không có biến/mảng/Promise nào khởi tạo rỗng mà thiếu kiểu tường minh.
- [ ] Không có ký tự `'`, `"`, `<`, `>` trơ trọi trong JSX; đã dùng `<Image />` thay cho `<img>`.
- [ ] Tên import khớp chính xác hoa/thường với tên file thực tế.
- [ ] Đã chạy (hoặc mô phỏng chạy) `tsc --noEmit` / ESLint để đảm bảo không lỗi type/lint.

**Python:**
- [ ] Mọi hàm public đều có type hints đầy đủ (tham số + return type).
- [ ] Dữ liệu request/response được validate bằng Pydantic/dataclass, không dùng `dict` tự do cho dữ liệu quan trọng.
- [ ] Không có bare `except:`.
- [ ] Đã chạy (hoặc mô phỏng chạy) `mypy`/`ruff` để đảm bảo không lỗi type/lint.

**SQL:**
- [ ] Không dùng `SELECT *`; không nối chuỗi trực tiếp giá trị vào câu lệnh SQL.
- [ ] Migration có cả `up` và `down`.
- [ ] Có transaction cho các thao tác ghi nhiều bước liên quan nhau.
- [ ] Đã kiểm tra index cho các cột dùng trong `WHERE`/`JOIN` quan trọng.

**An toàn thông tin:**
- [ ] Không có chuỗi SQL/shell được ghép trực tiếp từ input user (chống injection).
- [ ] Không render HTML thô từ input user mà không sanitize (chống XSS).
- [ ] Endpoint thay đổi dữ liệu có kiểm tra CSRF/SameSite cookie.
- [ ] Mật khẩu được hash bằng `bcrypt`/`argon2`, không lưu plaintext.
- [ ] Mọi endpoint dữ liệu riêng tư đều kiểm tra cả authentication **và** authorization đúng chủ sở hữu tài nguyên (chống IDOR).
- [ ] Không có secrets trong code phía client hoặc bị commit lên Git.
- [ ] Endpoint nhạy cảm (login, upload, form liên hệ) có giới hạn tần suất gọi cơ bản.
- [ ] Upload file (nếu có) được kiểm tra định dạng, dung lượng, và không lưu vào thư mục thực thi code.
- [ ] Response lỗi ở production không lộ stack trace/chi tiết hệ thống.
- [ ] Đã cân nhắc thêm security header cơ bản (CSP, X-Content-Type-Options, X-Frame-Options).

---

## 6. Quy trình kiểm tra trước khi deploy lên Vercel

1. Chạy `npm run build` (hoặc lệnh build tương ứng của backend Python nếu có) ở local trước khi push code — Vercel dùng đúng chế độ build này.
2. Nếu có lỗi type, sửa tận gốc — **không** tắt `strict` trong `tsconfig.json` hoặc bỏ qua lỗi `mypy` để né lỗi.
3. Chạy `npx tsc --noEmit` (TS) và/hoặc `mypy .` (Python) để rà soát lỗi type trước khi đưa code.
4. Chạy `next lint` / ESLint (JS-TS) và `ruff`/`flake8` (Python) để rà soát lỗi lint.
5. Chạy `npm audit` / `pip-audit` để rà soát lỗ hổng dependency.
6. Với thay đổi schema DB, chạy thử migration (`up` và `down`) trên môi trường staging trước khi merge.
7. Mô phỏng môi trường Vercel bằng lệnh: `vercel build`.
8. Cân nhắc thêm các bước tự động trong quy trình phát triển:
   - `npx tsc --noEmit` / `mypy` trong CI (GitHub Actions) trước khi merge.
   - `husky` + `lint-staged` để chặn commit nếu có lỗi type hoặc lỗi lint.

---

## 7. Câu lệnh mẫu để nhắc AI khi yêu cầu viết code

> "Hãy viết code tuân thủ coding standard đa ngôn ngữ (TypeScript strict mode / JavaScript có JSDoc / Python có type hints + Pydantic / SQL parameterized query), chuẩn build Vercel, và các tiêu chuẩn an toàn thông tin cơ bản (chống SQL Injection, XSS, CSRF, hash mật khẩu bằng bcrypt/argon2, kiểm tra authorization theo đúng chủ sở hữu tài nguyên, không hardcode secrets, giới hạn tần suất cho endpoint nhạy cảm). Không dùng `any` (TS/JS) hay bare `except` (Python). Định nghĩa đầy đủ interface/type/type-hint cho mọi props, tham số hàm, dữ liệu API và các object. Xử lý rõ ràng các giá trị có thể null/undefined/None. Validate mọi input từ user/API/DB. Báo cho tôi nếu có biến môi trường mới hoặc dependency mới cần thêm."

---

## 8. Phụ lục: áp dụng cho dự án mquiz

mquiz dùng Vanilla JavaScript (IIFE) cho hai SPA, Supabase (PostgreSQL + RLS + Edge Function chạy Deno/TypeScript) và Cloudflare Workers Static Assets, nên không có Next.js, Vercel, Prisma hay Python. Các mục dưới đây thay thế phần tương ứng ở mục 2.1.11, 2.3 và 6.

### 8.1. Tương ứng quy tắc

| Chuẩn gốc | Trong mquiz |
|---|---|
| `tsc --noEmit`, strict mode | Edge Function viết bằng TypeScript: `npm run check:functions` (`deno check`). JS thuần ở frontend: JSDoc cho hàm và kiểu dùng chung |
| `next lint`, ESLint | `npm run lint` (ESLint, cấu hình ở `eslint.config.js`) |
| Prettier/Black | `npm run format:check`; áp dụng cho code mới/được bảo trì (`scripts/`, `tests/`, `supabase/functions/`). Hai SPA cũ nằm trong `.prettierignore` để tránh diff nhiễu |
| Validate bằng `zod` | Validator nhỏ ở `supabase/functions/_shared/validation.ts` (không thêm dependency). Mọi request body của Edge Function phải đi qua đó |
| `vercel build` | `npm run build` (`scripts/build-static.js`) |
| `npm audit` | `npm run audit:deps` |
| Security header | `frontend/_headers` (CSP, nosniff, X-Frame-Options, Referrer-Policy); `npm run security:check` bảo vệ cấu hình này |
| Migration có `up`/`down` | Mỗi thay đổi SQL có file `rollback_*.sql` đi kèm; xem `docs/SUPABASE.md` |
| CI | `.github/workflows/ci.yml` chạy `npm run check` và `npm run audit:deps` |

Chạy toàn bộ kiểm tra trước khi bàn giao:

```bash
npm run check
```

### 8.2. Quy tắc riêng cho mquiz

1. **Không tin dữ liệu từ trình duyệt cho kết quả thi.** Điểm, thời gian bắt đầu, thời lượng, số câu đúng và giới hạn lượt luôn do Edge Function `quiz-attempt` tính hoặc kiểm tra; client chỉ hiển thị. Không thêm lại `insert` trực tiếp vào `quiz_attempts` từ trình duyệt (`security:check` sẽ báo lỗi).
2. **Không lộ đáp án.** Chỉ `quiz-evaluate` (`check`/`review`, chỉ cho Luyện tập) và `quiz-attempt` (`submit`, sau khi nộp) được trả `correct_json`. Không thêm endpoint trả đáp án hàng loạt.
3. **Edge Function:** trả lỗi qua `AppError` (thông báo an toàn để hiển thị); mọi lỗi khác bị che thành thông báo chung và chỉ ghi log ở server. Không trả `error.message` của Supabase ra client. Endpoint công khai phải gọi `enforceRateLimit`.
4. **CDN:** mọi `<script src="https://...">` phải ghim phiên bản chính xác và có `integrity` (SRI) cùng `crossorigin="anonymous"`. Cập nhật phiên bản = tính lại hash (`curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A`).
5. **Hằng số có tên:** trọng số điểm, ngưỡng, giới hạn thời gian và kích thước nằm ở khai báo `const` đầu module; công thức chấm điểm chỉ tồn tại ở `supabase/functions/_shared/scoring.ts` và phải có test.
6. **Biến môi trường mới cho Edge Function** (đặt bằng `supabase secrets set`): `ALLOWED_ORIGINS` (tuỳ chọn, danh sách origin cách nhau bằng dấu phẩy để giới hạn CORS) và `QUIZ_TIMEZONE` (tuỳ chọn, mặc định `Asia/Ho_Chi_Minh`, dùng cho điểm đúng giờ).
