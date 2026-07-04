# vn.Quiz

Hướng dẫn chuyển Admin lên Supabase Auth và deploy ZIP không dùng Git:
[CLOUD-MIGRATION-GUIDE.md](CLOUD-MIGRATION-GUIDE.md).

Ứng dụng quiz gồm backend local và frontend static để deploy thủ công lên Netlify.

## Chạy backend local

```bash
npm install
npm run dev
```

Mở `http://localhost:3000/admin`.

Tài khoản seed lần đầu:

- Username: `superadmin`
- Password: `admin123`

Hãy đổi mật khẩu sau khi đăng nhập.

## Quy trình nội dung

1. Tạo hoặc sửa space trong backend.
2. Upload CSV câu hỏi và xác nhận lưu.
3. Bấm `Generate` cho space đã thay đổi.
4. Bấm `Xuất bộ deploy`.
5. Deploy thủ công file zip/thư mục dist lên Netlify.

Frontend static được sinh vào `backend/dist`. Zip deploy được sinh vào `backend/export`.

## CSV mẫu

Xem `sample-questions.csv` để biết đúng header và định dạng đáp án.

## Supabase leaderboard

Ứng dụng có thể lưu kết quả thi và hiển thị bảng xếp hạng qua Supabase.

1. Chạy SQL trong `supabase/quiz_attempts.sql` trên Supabase SQL editor.
2. Điền cấu hình public vào `frontend/assets/supabase-config.js`:

```js
window.__SQ_SUPABASE__ = {
  url: "https://your-project.supabase.co",
  anonKey: "your-anon-public-key"
};
```

Chỉ dùng `anon public key` trong file này. Không đưa `service_role` key vào frontend.

Nếu chưa cấu hình Supabase, quiz vẫn chạy bình thường nhưng sẽ không lưu kết quả và bảng xếp hạng sẽ báo chưa cấu hình.

Khi nâng cấp từ phiên bản chưa có Group, chạy lại toàn bộ `supabase/quiz_attempts.sql` để bổ sung cột `group_name` và cập nhật RLS trước khi nhận kết quả thi mới.

Có thể chạy riêng migration `supabase/add_quiz_attempt_metadata.sql` để bổ sung `group_name`, `mode` và `started_at` cho database Supabase đang hoạt động mà không tạo lại bảng.

Khi bật tính năng Thi thật, chạy thêm `supabase/add_real_exam_mode.sql` để đổi dữ liệu chế độ cũ từ `exam` sang `mock` và cho phép lưu kết quả `real`.

## Tạo file ZIP để deploy lên Netlify

Trước khi tạo file ZIP:

1. Hoàn tất thay đổi space và upload CSV.
2. Bấm `Generate` cho từng space đã thay đổi.
3. Kiểm tra frontend tại:

```text
http://localhost:3000/preview/<slug>
```

### Cách 1: Tạo ZIP từ giao diện backend

1. Chạy backend:

```bash
npm run dev
```

2. Mở:

```text
http://localhost:3000/admin
```

3. Bấm `Xuất bộ deploy`.
4. File ZIP được tạo trong:

```text
backend/export/
```

### Cách 2: Tạo ZIP từ terminal

Chạy tại thư mục gốc của dự án:

```powershell
@'
const { exportDeployZip } = require('./backend/src/generator');

exportDeployZip()
  .then((zipPath) => console.log(zipPath))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
'@ | node -
```

Terminal sẽ in ra đường dẫn file ZIP vừa tạo, ví dụ:

```text
D:\AI\Simple.Quiz\backend\export\simple-quiz-deploy-1782821338888.zip
```

### Deploy lên Netlify

Upload trực tiếp file ZIP trong `backend/export/` lên Netlify.

Gói deploy phải chứa:

```text
index.html
_redirects
assets/
data/
```

Sau mỗi lần sửa giao diện, cấu hình Supabase, CSV hoặc dữ liệu space, cần `Generate` và tạo lại file ZIP trước khi deploy.
