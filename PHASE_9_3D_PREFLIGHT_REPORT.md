# PHASE 9.3D - PREFLIGHT REPORT

Ngày kiểm tra: 2026-10-03
Kết quả: **DỪNG tại Giai đoạn A. Chưa sửa source, migration hoặc database.**

## 1. Phạm vi đã kiểm tra

Đã đọc đầy đủ:

- `PHASE_9_1_BACKEND_API_INTEGRATION_AUDIT.md`
- `PHASE_9_2_AUTHENTICATION_AUTHORIZATION_REPORT.md`
- `PHASE_9_3_PUBLIC_ORDER_INTEGRATION_REPORT.md`
- `PHASE_9_3C_SAFE_BARCODE_MIGRATION_PLAN.md`

Đã đối chiếu source hiện tại của `POST /api/history`, các Admin history routes, retention, React/legacy thao tác “tạo lại tem”, OrderForm và trang kết quả. Git status được kiểm tra trước khi làm việc. `.vscode/settings.json`, thay đổi Phase 9.2 và các report trước đó được giữ nguyên.

Không gọi HTTP API: `GET /api/admin/history` và các API liên quan có thể prune dữ liệu; `POST /api/history` ghi history. Không import `database.js` vì module tự chạy DDL/migrations/seeds.

## 2. DB local và dữ liệu được xác minh chỉ đọc

`DATABASE_PATH` không được đặt; DB local resolve là `/workspaces/vtp/data/history.sqlite`. Đây chỉ là file trong workspace, **không xác nhận** file DB mà production/VPS đang sử dụng. Không truy cập VPS hay production. Kết nối SQLite dùng `readonly: true`, `fileMustExist: true` và `PRAGMA query_only=ON`; truy vấn chỉ đọc.

| Kiểm tra | Kết quả |
|---|---|
| SQLite / better-sqlite3 | 3.53.2 / 12.11.1 |
| `history` row count | 8 |
| `barcode` NULL / non-string | 0 / 0 |
| Empty sau JavaScript `trim()` / trim thay đổi giá trị | 0 / 0 |
| Index barcode | Không có; 3 index hiện tại đều non-unique và không đánh trên barcode |
| `PRAGMA integrity_check` | `ok` |
| `PRAGMA foreign_key_check` | Không có vi phạm |

| Barcode trùng | Số row | History IDs |
|---|---:|---|
| `PKE1482272070` | 4 | 5, 14, 15, 19 |
| `PKE1486195236` | 2 | 8, 9 |

Kết quả khớp dữ liệu Phase 9.3B/9.3C: 2 nhóm, tổng 6/8 rows. Không có thay đổi dữ liệu nào được thực hiện.

Schema DB local thiếu cột `creator_username`, trong khi `database.js` có migration điều kiện thêm cột này khi được import. Vì vậy schema hiện tại khác schema mà source mong đợi; không import module để “đồng bộ” vì việc đó sẽ ghi DB. Sai khác này phải được đối chiếu lại trên DB đích trước bất kỳ migration nào.

## 3. Source hiện tại và tác động

### Tạo order

`POST /api/history` trong `server.js` chạy sau IP block, anonymous identification và rate limit. Handler gọi `pruneGeneratedCodeHistory()` trước validation; kiểm tra barcode string, raw length tối đa 512 và không rỗng sau `trim()`, validate địa chỉ/fields, rồi INSERT trực tiếp vào `history`. Backend lưu `barcode.trim()`, không kiểm tra duplicate và không có transaction với registry. Success hiện tại là `201 {id,fields}`; chưa có lỗi 409 cho barcode trùng.

`PublicOrderPage.jsx` gửi barcode từ state chưa trim; khi POST lỗi thì hiển thị `error.message` và giữ state/input. `OrderForm.jsx` hiện `required`, chưa khai báo `maxLength`. `apiRequest` chuyển response lỗi thành `ApiError` có `status` và `data`, nên có thể phân biệt code 409 mà không đổi success contract.

### History, result và tạo lại tem

- `GET /api/admin/history` yêu cầu `requireAdmin`, list/search tối đa 50 rows mỗi trang và gọi prune trước khi đọc. Response trả riêng từng history row; hiện không có API lấy một order theo barcode hoặc xử lý ambiguous registry.
- React `OrderManagementPage.jsx` và legacy `admin.js` đều có thao tác “Tạo lại tem” gọi `POST /api/history` với barcode đã có trong history. Hiện hành vi này tạo **một history row mới**; sau uniqueness enforcement cùng barcode sẽ bị 409.
- React `OrderResultPage.jsx` và legacy `ketqua.html` dựng tem từ query string; không tra DB. QR/barcode là ảnh từ `/api/qrcode` và `/api/barcode`. Không sửa label/A7 trong preflight.
- `pruneGeneratedCodeHistory()` xóa `history` và `inventory_history` cũ hơn 3 ngày; chạy khi khởi động, mỗi giờ, trước POST `/api/history` và trong các Admin GET liên quan. Thay đổi retention nằm ngoài phạm vi được phép.

## 4. Các quyết định nghiệp vụ còn thiếu

Các tài liệu 9.1–9.3C không xác nhận ba quyết định dưới đây. Yêu cầu hiện tại cũng nêu chúng là điều kiện cần xác nhận chứ chưa chọn đáp án. Do đó không đủ điều kiện đi tiếp Giai đoạn B–E.

| Quyết định cần owner xác nhận | Trạng thái trong tài liệu/yêu cầu | Đề xuất ít tác động nhất |
|---|---|---|
| Registry giữ barcode sau khi `history` bị prune 72 giờ? | Chưa quyết định. Plan 9.3C nêu các phương án và yêu cầu duyệt. | Giữ registry/tombstone lâu dài, không tự giải phóng barcode; giữ nguyên retention 72 giờ cho history. Sau prune, resolver trả expired/not available thay vì order. Trade-off: barcode đã đăng ký không bao giờ tái sử dụng. Chỉ áp dụng nếu owner chấp thuận. |
| “Tạo lại tem” phải làm gì khi cùng barcode đã tồn tại? | Chưa quyết định. Source hiện tạo thêm history row bằng POST cùng barcode. | Ít tác động dữ liệu nhất: thao tác từ một history row chỉ dựng/in lại chính row đã chọn, không POST và không tạo order/history row mới. Nếu nghiệp vụ muốn tạo một đơn mới, yêu cầu barcode mới qua luồng tạo đơn bình thường; không bypass 409. Cần xác nhận vì đây là thay đổi semantics của chức năng hiện có. |
| Vai trò nào được xem đầy đủ các row ambiguous? | Chưa có quyết định role cụ thể. Plan 9.3C chỉ đề xuất Admin-only; request cấm public PII nhưng chưa khẳng định Admin/Operator. | Chỉ Admin (`requireAdmin`) được xem chi tiết/danh sách history; Guest và Operator bị từ chối. Không thêm public barcode lookup. Phù hợp với `/api/admin/history` hiện tại, nhưng cần owner duyệt rõ. |

### Chuẩn hóa barcode

Yêu cầu Phase 9.3D đã chỉ đạo giữ `trim()` hiện tại. Backend dùng JavaScript `barcode.trim()` và SQLite column hiện mặc định `BINARY`, nên đề xuất giữ nguyên case-sensitive, không tự thêm lowercase/NFC/NFKC. Plan 9.3C chưa có phê duyệt cho quy tắc mới. Dữ liệu local hiện không có khoảng trắng biên và không phát sinh collision ngoài các duplicate exact-match đã liệt kê. Không thay đổi chuẩn hóa trong lần này.

### DB mục tiêu

Đã xác định DB local mà source mặc định resolve tới, không xác định DB production. Trước migration thật, owner/operation phải chỉ rõ DB đích và quy trình snapshot/backup; không dùng kết quả local để kết luận production sạch/an toàn. Không thay đổi database ở preflight.

## 5. Kết luận và điểm dừng

**Preflight không đạt điều kiện cho implementation.** Ba quyết định nghiệp vụ trong bảng trên chưa được phê duyệt; request yêu cầu phải dừng thay vì tự suy đoán. Đề xuất tác động thấp nhất đã ghi để owner xác nhận, không coi là mặc định được duyệt.

Sau khi nhận xác nhận, cần chạy lại preflight trên đúng DB đích/snapshot, so sánh schema với migrations trong source và backup trước khi lập/thi hành migration riêng. Nếu DB đích khác local hoặc có thêm collisions, dừng và cập nhật báo cáo trước.

## 6. Thay đổi và kiểm thử

- Chỉ tạo file báo cáo preflight này.
- Không sửa `server.js`, `database.js`, React, legacy UI, config hoặc reports trước đó.
- Không chạy migration, DDL, INSERT/UPDATE/DELETE, tạo order, gọi API, cài package, build, restart server, deploy, hoặc thao tác VPS/production.
- Chưa chạy test/build vì preflight dừng trước code changes; `git diff --check` và Git status cuối được kiểm tra riêng sau khi tạo báo cáo.

Báo cáo này kết thúc Phase 9.3D ở Giai đoạn A và chờ owner xác nhận ba quyết định nghiệp vụ cùng DB đích trước khi tiếp tục.
