# PHASE 9.3D - SAFE BARCODE UNIQUENESS IMPLEMENTATION REPORT

Ngày hoàn tất: 2026-10-03
Kết quả: **Đã triển khai và migrate DB development local; không thao tác production.**

## 1. Chính sách được áp dụng

- **Retention: RELEASE.** Registry chỉ chuyển sang `released` sau khi retention xóa hết history liên quan; tombstone registry được giữ lại để có thể tái sử dụng barcode theo chính sách.
- **Recreate label: REUSE.** Admin in lại từ đúng history row đã chọn, không POST order mới và không tạo history row mới.
- **Ambiguous access: ADMIN ONLY.** Tra cứu chính xác theo barcode nằm dưới `requireAdmin`; trả mọi history row còn tồn tại, không tự chọn một row và không thêm public lookup.
- Chuẩn hóa barcode giữ nguyên JavaScript `trim()`, so sánh exact/case-sensitive theo SQLite `BINARY`; không thêm lowercase, NFC hay NFKC.

## 2. DB và sao lưu

Chỉ DB development mặc định `/workspaces/vtp/data/history.sqlite` được migrate. Script yêu cầu `--confirm-local-dev-db`, từ chối `NODE_ENV=production`, từ chối `DATABASE_PATH` khác đường dẫn workspace mặc định, và không tự tạo DB còn thiếu.

Trước thay đổi, read-only kiểm tra cho thấy 8 history rows, `integrity_check=ok`, không có foreign-key violation. Tại thời điểm kiểm tra, cả 8 rows đã cũ hơn 72 giờ; preflight và migration không gọi retention cleanup hoặc xóa history.

Runner tạo backup bằng SQLite Online Backup API, đặt mode `0600`, rồi đối chiếu số dòng, fingerprint, integrity và foreign keys trước khi migrate:

| Thuộc tính | Kết quả |
|---|---|
| Backup | `data/history.pre-barcode-2026-10-03T030050-944Z.sqlite` |
| Kích thước | 167,936 bytes |
| SHA-256 | `f568777976cd71482551267e54146353618c6d498b9e503bf792e5d6069fb182` |
| Mode | `0600` |
| History count / fingerprint trước migration | `8` / `d9aa9a038150e3b86ca4f874b5fe912f403d9d7bc9290d432f6437c3028b2eba` |

## 3. Thay đổi kỹ thuật

- `barcode-registry.js` tạo registry key unique bằng `PRIMARY KEY` với collation `BINARY`, cùng mapping một-nhiều giữa barcode và `history.id`. Backfill giữ nguyên mọi history row và phân loại barcode legacy thành `legacy_unique` hoặc `legacy_ambiguous`.
- Public `POST /api/history` dùng `BEGIN IMMEDIATE` để tạo registry reservation, history row và mapping trong cùng transaction. Barcode đang được giữ trả HTTP `409` với code `BARCODE_ALREADY_EXISTS`, không kèm dữ liệu order. Insert thất bại rollback cả reservation; response thành công vẫn là `201 {id, fields}`.
- Retention xóa history/inventory history và đánh dấu barcode `released` trong cùng transaction. Chỉ giải phóng khi không còn mapping hoặc history row nào tham chiếu barcode; lần cleanup lặp lại an toàn.
- Admin exact lookup trả đủ rows cho barcode ambiguous và trạng thái resolution. React Admin và legacy Admin đều thông báo ambiguous/released; Guest và Operator bị từ chối theo middleware hiện có.
- Cả hai Admin UI in lại từ dữ liệu history row được chọn, không tạo order mới. Public form chặn submit đồng thời, trim barcode, xử lý 409 và giữ dữ liệu form khi trùng; giới hạn input ở 512 ký tự.
- Thêm migration runner tường minh tại `migrations/20261003_barcode_registry.js`; không sửa `database.js` hoặc `package.json`.

## 4. Kết quả migration và đối chiếu

Migration chạy thành công trong transaction immediate. Đối chiếu độc lập current DB với backup, cả hai mở readonly:

| Kiểm tra | Kết quả |
|---|---|
| History rows trước / sau | `8 / 8` |
| Fingerprint trước / sau | Khớp chính xác |
| History `(id, barcode)` identical | Có |
| Registry keys / mappings | `4 / 8` |
| `integrity_check` hiện tại / backup | `ok / ok` |
| Foreign-key violations hiện tại / backup | `0 / 0` |
| History row unmapped / mapping orphan | `0 / 0` |
| `barcode_registry_v1` marker | `2026-10-03T03:00:50.974Z` |

| Barcode | Trạng thái | History IDs | Mapping count |
|---|---|---|---:|
| `150727587513` | `legacy_unique` | 12 | 1 |
| `PKE1482272070` | `legacy_ambiguous` | 5, 14, 15, 19 | 4 |
| `PKE1486195236` | `legacy_ambiguous` | 8, 9 | 2 |
| `PKE1507997610` | `legacy_unique` | 10 | 1 |

Không có history row nào bị hợp nhất, sửa hoặc xóa trong migration. Do 8 rows đã quá retention cutoff, lần chạy server/cleanup thông thường tiếp theo sẽ xóa chúng theo hành vi retention hiện có; sau khi mọi row liên quan bị xóa, barcode được phép tái sử dụng theo chính sách RELEASE. Server không được khởi động trên DB local trong phase này để tránh kích hoạt cleanup trước khi hoàn tất xác minh.

## 5. Kiểm thử

- `node --test tests/barcode-registry.test.js`: **7/7 pass**. Bao gồm backfill/rerun, RELEASE, idempotency, cleanup và insert rollback, trim/case sensitivity, hai SQLite writer cạnh tranh, role authorization, HTTP 201/409 không lộ PII và lỗi insert trả 500.
- `npm run build`: **pass**.
- `node --check admin.js`: **pass**.
- Read-only registry readiness check: **ready**, history count vẫn `8`.
- `get_errors` cho các file React/legacy liên quan: không phát hiện lỗi.
- `git diff --check`: pass trước khi tạo report; sẽ kiểm tra lại cùng report trong lần nghiệm thu cuối.
- Browser preview mock trước migration: form giữ trạng thái khi lỗi, submit lock, Admin ambiguous lookup và reprint đều pass; preview đã dừng.

## 6. Giới hạn và vận hành

- Không xác định DB production; kết quả này chỉ chứng minh DB development trong workspace. **Không chạy production migration, deploy, VPS, PM2, Nginx, Cloudflare hoặc thao tác vận hành production.**
- Preflight đã ghi nhận `creator_username` còn thiếu trên `history` và `inventory_history` của DB local; đây là sai khác schema có trước. Barcode migration không thêm cột này. `database.js` có migration điều kiện hiện hữu để thêm cột khi module được khởi chạy; vì import module đó đồng thời thực hiện DDL/retention, phase này không khởi động server local sau migration.
- Các file `.vscode/settings.json` và thay đổi Phase 9.2 đã có trước được giữ lại; report và các file untracked trước đó cũng không bị xóa. Không commit hoặc deploy.

## 7. Git status

Worktree còn các sửa đổi và report có trước phase này. Thay đổi barcode mới thuộc `server.js`, `admin.html`, `admin.js`, các component order/admin liên quan, `barcode-registry.js`, `migrations/`, `tests/` và report này. Không sửa `.vscode/settings.json`, `frontend/src/features/admin/AdminPage.jsx`, `frontend/src/features/inventory/InventoryPage.jsx` hoặc `frontend/src/shared/components/AppShell.jsx` trong phase barcode.