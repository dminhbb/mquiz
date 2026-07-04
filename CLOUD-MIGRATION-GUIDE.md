# Chuyển vn.Quiz sang Supabase Cloud Admin

Tài liệu này không yêu cầu Git. Netlify vẫn nhận một file ZIP chứa static HTML, CSS và JavaScript.

## 1. Bản backup legacy

Bản đóng băng đã được tạo ngoài workspace:

```text
D:\AI\Simple.Quiz-Backups\vn-quiz-legacy-local-v1-20260702-213301.zip
```

Kiểm tra file `.sha256` cùng tên trước khi dùng. Để chạy lại bản legacy:

1. Giải nén vào một thư mục mới.
2. Chạy `npm install`.
3. Chạy `npm run dev`.
4. Mở `http://localhost:3000/admin`.

## 2. Cấu hình URL Supabase Auth

Trong Supabase Dashboard, mở `Authentication > URL Configuration`:

```text
Site URL:
https://vn-quiz.netlify.app

Redirect URLs:
http://localhost:3000/**
https://vn-quiz.netlify.app/**
```

Trong `Authentication > Providers > Email`, bật Email/Password. Tắt đăng ký công khai nếu chỉ superadmin được tạo tài khoản.

## 3. Chạy schema theo đúng thứ tự

Trong Supabase SQL Editor:

1. Chạy `supabase/quiz_attempts.sql` nếu bảng kết quả chưa tồn tại.
2. Chạy `supabase/add_quiz_attempt_metadata.sql`.
3. Chạy `supabase/add_real_exam_mode.sql`.
4. Chạy `supabase/fix_quiz_attempt_policy.sql`.
5. Chạy `supabase/cloud_admin_schema.sql`.
6. Chạy `supabase/add_real_exam_version.sql` nếu schema cloud đã được tạo từ phiên bản cũ.
7. Chạy `supabase/add_space_status_rpc.sql` để frontend trả về 404 cho Space chưa Published.
8. Chạy `supabase/add_real_exam_result_export.sql` để lưu mã đợt Thi thật và cho phép Admin xuất Excel 3 đợt gần nhất.

Các script dùng `if exists`/`if not exists` ở những vị trí cần thiết và không xóa dữ liệu kết quả cũ.

## 4. Tạo superadmin đầu tiên

1. Trong `Authentication > Users`, tạo user bằng email và mật khẩu.
2. Mở `supabase/bootstrap_superadmin.sql`.
3. Thay `YOUR_ADMIN_EMAIL@example.com` và họ tên.
4. Chạy script trong SQL Editor.

Mật khẩu SQLite cũ không được migrate. Tài khoản Supabase dùng mật khẩu mới.

## 5. Deploy Edge Functions

Hai function cần deploy:

```text
supabase/functions/admin-users
supabase/functions/quiz-evaluate
```

Có thể dùng Supabase Dashboard để tạo function và dán nội dung `index.ts`. Với `quiz-evaluate`, tắt Verify JWT. `admin-users` giữ Verify JWT.

Hoặc dùng Supabase CLI, không cần Git:

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy admin-users
npx supabase functions deploy quiz-evaluate --no-verify-jwt
```

Không đưa service-role key vào HTML, ZIP Netlify hoặc `supabase-config.js`.

## 6. Migrate SQLite lên Supabase

Trong Supabase Dashboard, mở `Settings > API Keys`. Ưu tiên tạo/copy **Secret key** (`sb_secret_...`); legacy `service_role` cũng được hỗ trợ. Chỉ đặt key trong cửa sổ PowerShell hiện tại:

```powershell
$env:SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="YOUR_SECRET_OR_SERVICE_ROLE_KEY"
npm run migrate:cloud
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY
```

Script migrate:

- Space và cấu hình Thi thật.
- Group.
- Câu hỏi và đáp án.

Tài khoản Admin không được migrate vì phải tạo bằng Supabase Auth.

## 7. Test local

Khởi động:

```powershell
npm run dev
```

Mở:

```text
Cloud Admin: http://localhost:3000/cloud-admin/
Quiz:        http://localhost:3000/preview/<slug>
Legacy Admin:http://localhost:3000/admin
```

Kiểm tra:

1. Đăng nhập email/mật khẩu.
2. Tạo/sửa Space và Group.
3. Upload CSV.
4. Bật/tắt Thi thật.
5. Làm một lượt Thi thử và Thi thật.
6. Kiểm tra kết quả.
7. Tạo backup JSON.
8. Restore trên dữ liệu thử nghiệm.

## 8. Tạo ZIP Netlify

Trong Legacy Admin có thể dùng `Xuất bộ deploy`, hoặc chạy:

```powershell
@'
const { exportDeployZip } = require('./backend/src/generator');
exportDeployZip().then(console.log).catch(console.error);
'@ | node -
```

ZIP tạo ra trong `backend/export`. Bên trong phải có:

```text
index.html
admin/index.html
admin/admin.js
admin/admin.css
assets/
data/
_redirects
```

Kéo trực tiếp ZIP lên Netlify. Netlify không cần chạy Express hoặc SQLite.

## 9. Chạy song song và rollback

Trong giai đoạn thử nghiệm:

- Cloud Admin dùng `/cloud-admin/` ở local và `/admin/` trên Netlify.
- Legacy Admin vẫn dùng `http://localhost:3000/admin`.
- Frontend học viên ưu tiên Supabase; nếu schema cloud chưa có dữ liệu, nó quay về file Generate legacy.

Chỉ ngừng Legacy Admin sau khi:

1. Backup JSON tạo thành công.
2. Restore thành công trên dữ liệu thử.
3. CRUD Space/Group/câu hỏi hoạt động.
4. Thi thử/Thi thật lưu và đọc kết quả đúng.

## Backup và restore

Menu `Backup & Restore` chỉ hiển thị cho superadmin.

- Backup tạo file JSON chứa profiles, Space, phân quyền, Group, câu hỏi và kết quả.
- Trước mỗi restore, trình duyệt tự tải một bản `vn-quiz-before-restore-*.json`.
- `Merge` cập nhật/thêm dữ liệu theo ID.
- `Replace` xóa dữ liệu nghiệp vụ hiện tại rồi phục hồi từ file.
- User trong `auth.users` phải còn tồn tại để restore các profile tương ứng.
