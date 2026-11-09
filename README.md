# LOHA PMS

Hệ thống quản lý khách sạn SaaS, gồm ba ứng dụng triển khai riêng:

| Thư mục | Chức năng | Local |
| --- | --- | --- |
| `landingpage/` | Trang chủ, bảng giá, liên hệ, blog | `http://127.0.0.1:5174` |
| `frontend/` | PMS `/id/*`, đăng nhập `/id/login`, quản trị `/manager/*` | `http://127.0.0.1:5173` |
| `backend/` | API Flask/PostgreSQL, migration và worker | `http://127.0.0.1:5000` |

## Chạy local

Cần Python 3.14, PostgreSQL 18 và Node.js từ 22.12 trở lên. Dùng phiên bản npm
đã khai báo trong `packageManager` của từng ứng dụng web.

Mỗi ứng dụng dùng file `.env` riêng, được Git ignore. Nếu chưa có, sao chép
`.env.example` thành `.env` trong `backend/`, `frontend/` và `landingpage/`.
Backend cần `DATABASE_URL` và `DATABASE_MIGRATION_URL`; công cụ PostgreSQL local
bên dưới sẽ điền hai biến này khi cả hai còn trống trong cấu hình development.
Chỉ điền SMTP/Channex khi sử dụng; giữ nguyên khóa mã hóa Channex nếu đã có.
Backend production nhận biến từ môi trường runtime và không đọc file `.env`.

Khi chạy hai ứng dụng web trên hai cổng local, đặt
`VITE_LANDINGPAGE_URL=http://127.0.0.1:5174` trong `frontend/.env` và
`VITE_PMS_URL=http://127.0.0.1:5173` trong `landingpage/.env`. Để trống
`VITE_API_BASE_URL` để dùng proxy `/api` tới backend. Các biến `VITE_*` là công
khai và được đọc khi khởi động Vite hoặc build; khởi động lại sau khi đổi `.env`.

```powershell
cd backend
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --require-hashes --only-binary=:all: -r requirements-installer.txt
.\.venv\Scripts\python.exe -m pip install --require-hashes --only-binary=:all: -r requirements-dev.txt
.\.venv\Scripts\python.exe scripts/local_postgres.py start
.\.venv\Scripts\python.exe manage.py db upgrade
.\.venv\Scripts\python.exe manage.py db-check
.\.venv\Scripts\python.exe manage.py seed-local
.\.venv\Scripts\python.exe manage.py run --host 127.0.0.1 --port 5000
```

`local_postgres.py` tạo cluster riêng, mật khẩu ngẫu nhiên và `backend/.env` nếu
chưa có; khi file đã có, chỉ điền hai URL database nếu cả hai còn trống và
`APP_ENV` là development hoặc chưa đặt. Giá trị đã cấu hình được giữ nguyên.
Dữ liệu nằm trong `backend/.local-postgres/` và được Git ignore.
`seed-local` chỉ dùng lần đầu trên database local trống. Nếu dùng PostgreSQL
riêng, điền cấu hình theo [backend/.env.example](backend/.env.example) và bỏ qua
lệnh khởi tạo cluster. File mẫu để trống các giá trị nhạy cảm.

Mở thêm hai terminal, chạy lần lượt trong `frontend/` và `landingpage/`:

```sh
npm ci --ignore-scripts
npm run dev
```

Sau khi cài đặt, có thể dùng `start_backend.bat`, `start_frontend.bat` và
`start_landingpage.bat` từ Windows. Hai ứng dụng web proxy `/api` tới backend khi
chạy local.

## Triển khai

Backend dùng build context `backend/`, Dockerfile `backend/Dockerfile`, port
`8000`. Image chạy Gunicorn bằng tài khoản không có quyền root. Cấp biến môi
trường runtime bằng secret manager của hệ thống triển khai:

| Biến | Yêu cầu |
| --- | --- |
| `APP_ENV` | `production`; backend không đọc `.env` trong chế độ này |
| `DATABASE_URL` | PostgreSQL runtime, tài khoản không superuser/BYPASSRLS và không sở hữu bảng |
| `DATABASE_MIGRATION_URL` | Cùng database, tài khoản riêng có quyền thay đổi schema |
| `CORS_ORIGINS` | Origin HTTPS chính xác của các ứng dụng web được phép truy cập API, phân cách dấu phẩy |
| `PORT` | `8000` trong container |
| `CHANNEX_ENCRYPTION_KEY` | Khóa Fernet ổn định, dùng chung cho API và worker khi sử dụng OTA |
| `CHANNEX_WEBHOOK_BASE_URL` | Origin HTTPS công khai của API nếu sử dụng webhook |
| `CHANNEX_MANAGER_API_KEY_STAGING`, `CHANNEX_MANAGER_API_KEY_PRODUCTION` | Chỉ cấu hình khi cần chức năng Channex cấp hệ thống |

API key của từng khách sạn được nhập qua ứng dụng và mã hóa trong database.
Sao lưu khóa mã hóa riêng với database; không sinh khóa mới mỗi lần deploy.
Không đưa secret vào biến frontend có tiền tố `VITE_`, vì các biến này được
đóng gói công khai trong JavaScript.

Khi tạo database **mới**, quản trị PostgreSQL cần tạo role runtime và migrator
riêng; nhập mật khẩu qua prompt `\password`, không ghi vào SQL/Git:

```sql
CREATE ROLE pms_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE pms_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
\password pms_migrator
\password pms_app
CREATE DATABASE pms_prod OWNER pms_migrator;
\connect pms_prod
SET ROLE pms_migrator;
GRANT CONNECT ON DATABASE pms_prod TO pms_app;
GRANT USAGE ON SCHEMA public TO pms_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pms_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO pms_app;
RESET ROLE;
```

Migrator cần quyền cài extension `btree_gist`. Database đang có dữ liệu cần đối
chiếu owner và quyền hiện tại trước khi cấp quyền; không tạo lại database.

Build hai ứng dụng web tại thư mục riêng bằng `npm ci --ignore-scripts` và
`npm run build`; phục vụ mỗi thư mục `dist/` bằng static hosting có SPA fallback
về `index.html`. Cấu hình URL công khai theo `.env.example` của từng ứng dụng
**trước khi build**. Với hai domain, ví dụ `www.example.com` cho landing và
`pms.example.com` cho PMS, proxy `/api` của mỗi domain tới backend để dùng API
cùng origin. Nếu dùng API khác origin, cấu hình `VITE_API_BASE_URL` và CORS phù
hợp; xác nhận cookie/CSRF trên staging, đặc biệt khi khác site.
Nếu dùng chung domain, route `/id`, `/manager`, `/pms-assets` tới frontend;
route `/`, `/pricing`, `/blog`, `/contact`, `/landing-assets` tới landingpage và
`/api` tới backend. Mỗi ứng dụng cần SPA fallback riêng. Cấu hình
`VITE_PMS_URL` trong landing và `VITE_LANDINGPAGE_URL` trong frontend khi dùng
hai domain; để trống khi dùng chung domain.

Thực hiện migration một lần bằng code phiên bản mới, trước khi mở traffic:

```sh
python manage.py db upgrade
python manage.py db-check
```

Không chạy migration lúc build image hoặc mỗi lần Gunicorn khởi động. Sau
migration, `/api/ready` phải trả `200`; `/api/health` chỉ xác nhận tiến trình còn
chạy. Chỉ lần đầu, dùng `python manage.py init-admin` để tạo quản trị qua prompt.
Worker OTA và buồng phòng là các tiến trình riêng, xem
[hướng dẫn vận hành và phục hồi](docs/runbooks/operations-and-restore.md).

## Kiểm tra trước release

```sh
python .agents/skills/loha-release/scripts/release_check.py
```

Chạy `npm run format:check`, `npm run lint`, `npm run build` trong **cả hai** ứng
dụng web; chạy `python -m ruff check .`, `python -m ruff format --check .` và
`python -m pip check` trong môi trường backend. Định dạng lại bằng `npm run
format` hoặc `python -m ruff format .`.

Skill dự án [loha-release](.agents/skills/loha-release/SKILL.md) hướng dẫn kiểm tra
cấu trúc source, secret, migration, dependency, build, staging, backup/restore,
worker và rollback. Có thể yêu cầu Codex dùng `$loha-release` để kiểm tra release.
CI chạy các kiểm tra source/build; nghiệm thu database, OTA và backup thực tế
phải có bằng chứng trên môi trường phù hợp trước khi phát hành.
