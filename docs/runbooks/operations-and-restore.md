# LOHA PMS — Operations and Restore Runbook

Tài liệu hướng dẫn vận hành worker, kiểm tra sức khỏe hệ thống, sao lưu và diễn tập phục hồi cơ sở dữ liệu cho `backend/`.

## 1. Kiểm tra sức khỏe hệ thống (Health & Readiness)

- **Liveness**: `GET /api/health` — xác nhận tiến trình web/API đang chạy.
- **Readiness**: `GET /api/ready` — xác nhận kết nối PostgreSQL, trạng thái migration (`alembic_version`) và quyền runtime role (`NOSUPERUSER`, `NOBYPASSRLS`, không sở hữu bảng ứng dụng).
- **Operations overview**: `GET /api/admin/operations` (yêu cầu quyền quản trị hệ thống) — theo dõi heartbeat của worker, độ trễ queue và lỗi theo tenant/job.

## 2. Database Migration

Chạy migration một lần bằng tài khoản `DATABASE_MIGRATION_URL` trước khi mở traffic cho phiên bản mới:

```sh
python manage.py db upgrade
python manage.py db-check
```

- Không chạy migration tự động trong `Dockerfile` hoặc mỗi lần Gunicorn khởi động.
- Không chỉnh sửa các file migration đã phát hành; chỉ rollback code khi schema hiện tại tương thích ngược.

## 3. Workers

Các worker (OTA / Channex và Housekeeping) chạy như các tiến trình tách biệt với API, dùng chung database, phiên bản code và `CHANNEX_ENCRYPTION_KEY`:

- Đảm bảo `APP_ENV=production` và biến môi trường runtime được cung cấp qua secret manager.
- Giám sát `worker_heartbeats` và bảng `channel_jobs` qua `/api/admin/operations` để phát hiện worker bị stale hoặc job tồn đọng.

## 4. Sao lưu và Diễn tập Phục hồi (Backup & Restore)

1. **Sao lưu định kỳ**:
   - Dùng `pg_dump --format=custom` để tạo bản sao lưu PostgreSQL.
   - Lưu giữ `CHANNEX_ENCRYPTION_KEY` tách biệt với bản sao lưu database.
   - Ghi nhận thời điểm backup, checksum (SHA-256) và RPO/RTO.

2. **Diễn tập phục hồi trên sandbox local**:
   Dùng `backend/scripts/verify_restore.py` để khôi phục bản dump vào một database tạm thời biệt lập và kiểm tra tính toàn vẹn schema, quyền role và số dòng các bảng trọng yếu (`reservations`, `reservation_rooms`, `payments`, `audit_logs`, `channel_jobs`, `worker_heartbeats`):

   ```sh
   python scripts/verify_restore.py --dump <path-to-backup.dump> --admin-url <loopback-postgres-admin-url>
   ```

   - Không bật worker OTA với khóa thật trên bản restore trước khi có kế hoạch xử lý tránh gửi trùng hoặc ghi đè tồn/giá cũ.

