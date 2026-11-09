---
name: loha-release
description: Prepare and review a LOHA PMS release, run local source and packaging checks, and collect staging, migration, backup, worker and rollback evidence for this repository.
---

# LOHA PMS release

Chuẩn bị release cho backend Flask/PostgreSQL, ứng dụng PMS/Manager `frontend/`
và website công khai `landingpage/`. Đọc [README](../../../README.md) và
[runbook vận hành/phục hồi](../../../docs/runbooks/operations-and-restore.md).
Xác định commit/image, môi trường và người vận hành trước khi chốt kết quả.

## Repository

Chạy từ thư mục gốc bằng Python 3.14 trở lên:

```sh
python .agents/skills/loha-release/scripts/release_check.py
python .agents/skills/loha-release/scripts/release_check.py --json
```

[Checker](scripts/release_check.py) chỉ đọc source, không nạp env, cài dependency,
gọi database/OTA, build, deploy hoặc chạy migration. Nó kiểm tra dấu hiệu token/key,
placeholder trong env mẫu, Git/Docker exclusions, Python syntax, migration graph,
lockfile và liên kết tài liệu. Secret scan là heuristic trên source hiện tại,
không chứng minh source/lịch sử Git chưa từng lộ secret. Không ghi giá trị key,
cookie, mật khẩu hoặc URL database vào log/báo cáo. Secret thật đã commit cần
thu hồi/đổi khóa riêng; xóa file không thu hồi khóa.

Exit `0`: các kiểm tra local được yêu cầu đã đạt; `1`: có lỗi; `2`: thiếu Git nên
không thể kiểm tra đầy đủ. `SKIP` về môi trường không phải đã đạt. Working tree
chưa commit là `INFO`; thêm `--strict-git` khi chốt commit để chặn tree chưa sạch.

Kiểm tra CI đúng commit đã chạy lint/format/build, pip check và audit dependency.
Theo lệnh cài đặt trong README, dùng Python virtualenv backend để chạy Ruff
check, Ruff format --check và pip check từ backend. Chạy npm run lint,
npm run format:check và npm run build riêng trong frontend và landingpage.
Audit Python bằng công cụ đã khóa trong backend/requirements-audit.txt; chạy
npm audit --package-lock-only --audit-level=high riêng ở hai web app. Báo rõ khi
thiếu tool/mạng. Không tự đổi dependency hoặc chạy audit fix trong kiểm tra release.
Xác nhận artifact chỉ chứa runtime source/static build/migration, không có env,
backup, local database, secret, báo cáo thử nghiệm hoặc cache.

## Staging và vận hành

- Dùng đúng image/commit, HTTPS, CORS origin chính xác và API URL công khai.
  VITE_* đi vào trình duyệt nên không chứa credential. Backend production dùng
  runtime secret; không đọc env file. API/worker dùng cùng database, phiên bản code
  và CHANNEX_ENCRYPTION_KEY; không tạo lại khóa mã hóa đang dùng.
- Ghi checksum/thời điểm backup PostgreSQL, RPO/RTO, người giữ backup và bản sao
  khóa mã hóa riêng. Diễn tập restore từ archive tin cậy vào database local riêng
  theo runbook. backend/scripts/verify_restore.py có tạo/xóa sandbox nên không
  thuộc checker chỉ đọc; chạy bằng Python virtualenv backend. Đối chiếu manifest
  số dòng tại thời điểm backup khi có. Không bật worker OTA với khóa thật trên bản
  restore trước khi có kế hoạch tránh gửi trùng hoặc gửi tồn/giá cũ.
- Đọc migration mới và tương thích với bản đang chạy; không sửa lịch sử migration
  đã phát hành. Trên staging được phép thay đổi, chạy python manage.py db upgrade
  từ backend bằng migrator tách biệt, rồi python manage.py db-check. Runtime
  không được superuser/BYPASSRLS/owner bảng; xác minh quyền/default privileges và
  forced RLS. Checker chỉ xác minh graph một head, không xác minh schema thật.
- /api/health và /api/ready phải HTTP 200. Liveness không chứng minh schema,
  readiness không chứng minh worker. Xem /api/admin/operations với quyền hệ
  thống: heartbeat/vòng quét thành công mới và tenant coverage đủ; lệnh worker
  và ngưỡng stale nằm trong runbook. Quan sát queue age và lỗi theo tenant/job.
- Dùng dữ liệu staging của hai tenant: login/logout/thu hồi session, CSRF, vai trò
  Manager/Owner/lễ tân/buồng phòng/kế toán và đổi workspace. Tenant A không đọc/ghi
  được B khi sửa ID/URL; quản trị SaaS không tự có quyền PMS. Smoke booking →
  nhận/trả phòng → thanh toán/hoàn tiền → đối soát: đúng tiền, không trùng phòng,
  idempotency và bảo toàn bản nháp khi đổi ngôn ngữ/refresh.
- Với Channex staging được cấp quyền: mapping property/phòng/gói giá, webhook
  HTTPS, import booking/sửa/hủy, retry idempotent, giá/tồn/stop-sell và lịch sử job.
  Đối chiếu tiền/hoa hồng/availability với nguồn. Booking cần review không được
  ACK tự động. Không dùng production credentials cho smoke hoặc tự phát lệnh OTA.
- Mở trực tiếp/refresh /, /pricing, /contact, /blog trên landingpage;
  xác minh link login và PMS/Manager deep link, trang lỗi, bản dịch, mobile,
  cookie Secure/HttpOnly và proxy /api. Ghi vai trò, môi trường và từng kết quả;
  build thành công không chứng minh các luồng này hoạt động.

## Rollout và rollback

Chuẩn bị image cũ, thứ tự migration/API/worker/web, cửa sổ bảo trì nếu cần, người
trực, chỉ số lỗi/latency/queue, cảnh báo và điều kiện dừng. Kiểm tra log migration
và readiness riêng trước khi mở traffic; ghi nhận kết quả từng bước triển khai.
Migration không chạy trong Docker build hay mỗi lần web worker khởi động.

Chuẩn bị/check không tự cấp quyền deploy hoặc thay đổi production. Khi user đã
cho phép hành động cụ thể, tiếp tục trong phạm vi đó. Nếu cần MCP, khám phá
connector hiện có và đọc trạng thái môi trường trước; skill này không tạo MCP
server hoặc giả định quyền Coolify/GitHub. Thiếu connector thì nêu phần bằng chứng
còn cần, không báo đã thực thi.

Chỉ rollback code khi schema tương thích. Nhiều downgrade từ chối xóa dữ liệu
nghiệp vụ: không ép downgrade/bỏ guard. Kế hoạch phục hồi DB phải tính phần dữ
liệu phát sinh từ thời điểm backup, dừng tác vụ ghi/OTA theo kế hoạch đã duyệt,
và diễn tập trên bản sao trước.

Báo cáo commit/image, môi trường, lệnh + exit status, PASS/FAIL/SKIP và bằng
chứng còn thiếu. Thiếu staging, backup/restore, worker hoặc smoke evidence nghĩa
là **chưa đủ bằng chứng để release**, kể cả khi local đều đạt. Không tự chạy
production để lấp bằng chứng thiếu.
