# PHASE 9.3C - SAFE BARCODE MIGRATION PLAN

Ngày xác minh: 2026-10-03
Trạng thái: **PLAN ONLY - chưa chạy migration, chưa sửa source/schema/database/API.**
Phạm vi DB: SQLite local tại `data/history.sqlite`; đây không phải bằng chứng về đường dẫn hoặc dữ liệu production.

## Tóm tắt quyết định

Người dùng đã chọn phương án A: giữ nguyên mọi row hiện có trong `history`, đồng thời dành một registry key duy nhất cho từng barcode chuẩn hóa để chặn duplicate của đơn mới. Backfill một barcode thành đúng một registry row; các history row cùng barcode được liên kết đầy đủ và giữ trạng thái `legacy_ambiguous`, không chọn một row đại diện.

Kiểm tra mới nhất xác nhận dữ liệu local vẫn trùng ở hai nhóm đã biết. Không được tạo unique index trực tiếp trên `history.barcode`. Kế hoạch đề xuất `barcode_registry` làm nguồn bảo đảm uniqueness và một bảng mapping một-nhiều tới history. Trước khi triển khai vẫn cần xác nhận chính sách canonical hóa và cách lookup kết hợp với retention 72 giờ.

## 1. Hiện trạng database

Database được resolve theo `DATABASE_PATH` đã nạp bằng quy trình dotenv của server; kết quả trong workspace là `/workspaces/vtp/data/history.sqlite`. Kết nối dùng `better-sqlite3` `readonly: true`, `fileMustExist: true` và `PRAGMA query_only=ON`; không import `database.js`.

| Thuộc tính | Kết quả chỉ đọc |
|---|---|
| SQLite runtime | 3.53.2 |
| better-sqlite3 runtime | 12.11.1 (package khai báo `^12.2.0`) |
| `history` rows | 8 |
| Barcode NULL / không phải string | 0 / 0 |
| Barcode rỗng sau JavaScript `trim()` | 0 |
| Barcode có whitespace biên theo JavaScript `trim()` | 0 |
| Index trên barcode | Không có |
| Index khác trên `history` | `history_anonymous_user_idx(anonymous_user_id)`, `history_ip_idx(ip)`, `history_created_at_idx(created_at DESC)`; đều non-unique |
| `PRAGMA integrity_check` | `ok` |

Schema thực tế của `history`: `id INTEGER PRIMARY KEY AUTOINCREMENT`, `ip TEXT NOT NULL`, `barcode TEXT NOT NULL`, `district TEXT NOT NULL`, `commune TEXT NOT NULL`, `village TEXT NOT NULL`, `legacy_username TEXT`, `created_at TEXT NOT NULL`, `field_values TEXT NOT NULL DEFAULT '{}'`, `anonymous_user_id TEXT`. Schema local hiện không có `creator_username`, dù source `database.js` có migration thêm cột đó khi được import; đó là khác biệt giữa file DB hiện tại và source. Không import source module để tránh auto-DDL/seed.

### Barcode trùng hiện có

| Barcode | Số row | History IDs |
|---|---:|---|
| `PKE1482272070` | 4 | 5, 14, 15, 19 |
| `PKE1486195236` | 2 | 8, 9 |

Hai nhóm ảnh hưởng 6/8 rows; hai row còn lại có barcode riêng. Các group trên là exact string match. Truy vấn kiểm tra cả exact/BINARY, JavaScript trim, lowercase, NFC, NFKC và NFKC + lowercase: trên dữ liệu hiện tại không phát hiện collision mới giữa các chuỗi gốc khác nhau. Kết quả chỉ phản ánh DB local tại thời điểm truy vấn; production phải chạy preflight riêng trên snapshot/DB đích trước khi được phê duyệt.

## 2. Chuẩn hóa barcode và tương thích

### Hành vi source hiện tại

- Express `POST /api/history` kiểm tra `barcode` là string, raw JavaScript length không quá 512 và `barcode.trim()` không rỗng; giá trị được lưu là `barcode.trim()`.
- React `OrderForm` dùng input text `required`, chưa trim và chưa khai báo max length. `PublicOrderPage` gửi và đặt barcode từ state nguyên bản vào URL kết quả. Admin React/legacy có thể gửi lại barcode lưu trong history khi “tạo lại tem”.
- Cột SQLite `barcode` không khai báo collation; mặc định SQLite là `BINARY`, so khớp phân biệt chữ hoa/thường. Không có `NOCASE` hoặc unique index hiện tại.
- Không thấy `toLowerCase()`, `casefold()`, NFC/NFKC trong source. JavaScript `String.prototype.trim()` xử lý tập whitespace Unicode của JavaScript; SQLite `trim()` mặc định chỉ loại U+0020 nếu không truyền tập ký tự. Không thể thay JavaScript trim bằng SQLite trim mà mặc nhiên cho rằng hai hàm tương đương.
- Unicode normalization không diễn ra: chuỗi composed/decomposed hoặc ký tự compatibility/full-width vẫn có thể khác byte/string; whitespace nội bộ không bị trim. Ký tự zero-width cũng không nhất thiết được JavaScript trim loại bỏ.

### Đề xuất cần xác nhận, chưa phải quy tắc đã chốt

Để giữ tương thích, đề xuất dùng đúng hành vi hiện tại ở backend: `String.trim()` một lần, giữ nguyên hoa/thường, không NFC/NFKC, sau đó so sánh/lưu với collation `BINARY`. Không dùng normalization do SQLite tự suy diễn. Backend vẫn là nguồn chuẩn; việc trim phía React (nếu được duyệt) chỉ cải thiện UX và phải tạo query result từ giá trị server đã xác nhận.

Đây không phải quyết định cho mã Unicode hoặc case-folding. Nếu nghiệp vụ muốn lowercase/NFKC hoặc quy tắc khác, chạy preflight riêng trên mọi barcode thật: liệt kê `history id`, raw value và canonical value cho mọi group có từ hai raw string khác nhau. Dừng trước backfill để duyệt danh sách đó; không tự gộp về một mã. Kết quả local hiện tại không có collision mới theo các phép biến đổi đã thử, nhưng không chứng minh dữ liệu DB khác cũng an toàn.

## 3. Schema đề xuất

### `barcode_registry`

- `normalized_barcode TEXT COLLATE BINARY PRIMARY KEY`: canonical key duy nhất, phân biệt hoa/thường theo đề xuất tương thích.
- `status TEXT CHECK`: chỉ nhận `legacy_unique`, `legacy_ambiguous`, `new`.
- `registered_at TEXT NOT NULL`: ISO-8601 UTC; với backfill là thời điểm registry được lập, không thay thế `history.created_at`.
- `legacy_row_count INTEGER NOT NULL`: snapshot số row history tại backfill; `1` cho `legacy_unique`, `>1` cho `legacy_ambiguous`, `0` cho `new`. Giá trị snapshot không giảm khi retention xóa rows.

### `barcode_registry_history`

Mapping một-nhiều để giữ toàn bộ IDs history cho cả legacy unique/ambiguous và tham chiếu order cho `new`. Composite primary key `(normalized_barcode, history_id)` ngăn mapping lặp; `UNIQUE(history_id)` ngăn một history row bị gắn vào nhiều barcode registry. Foreign key từ `normalized_barcode` tới registry là cần thiết. Foreign key từ `history_id` tới `history(id) ON DELETE CASCADE` giữ mapping đồng bộ với retention hiện hữu. Không đặt một `history_id` đơn trong registry, vì ambiguous có nhiều row và không được chọn tùy tiện.

### DDL dự kiến (chỉ ghi trong kế hoạch)

```sql
CREATE TABLE IF NOT EXISTS barcode_registry (
    normalized_barcode TEXT COLLATE BINARY NOT NULL PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('legacy_unique', 'legacy_ambiguous', 'new')),
    registered_at TEXT NOT NULL,
    legacy_row_count INTEGER NOT NULL CHECK (legacy_row_count >= 0),
    CHECK (
        (status = 'legacy_unique' AND legacy_row_count = 1) OR
        (status = 'legacy_ambiguous' AND legacy_row_count > 1) OR
        (status = 'new' AND legacy_row_count = 0)
    )
);

CREATE TABLE IF NOT EXISTS barcode_registry_history (
    normalized_barcode TEXT COLLATE BINARY NOT NULL,
    history_id INTEGER NOT NULL,
    PRIMARY KEY (normalized_barcode, history_id),
    UNIQUE (history_id),
    FOREIGN KEY (normalized_barcode)
        REFERENCES barcode_registry(normalized_barcode) ON DELETE CASCADE,
    FOREIGN KEY (history_id)
        REFERENCES history(id) ON DELETE CASCADE
);
```

Không cần surrogate integer key cho registry vì barcode canonical chính là unique identity; không cần FK ngược từ `history` sang registry vì migration phải để nguyên bảng history và schema cũ có thể cần đọc bởi phiên bản cũ. Bật/kiểm tra `PRAGMA foreign_keys=ON` trên mọi connection liên quan; source `database.js` hiện bật FK.

better-sqlite3 12.11.1 chạy SQLite 3.53.2, đủ hỗ trợ transaction DDL, composite/partial constraints, `ON CONFLICT` chỉ định conflict target và `ON DELETE CASCADE`. Không cần package mới. Mọi DDL và backfill phải dùng một transaction; `CREATE TABLE IF NOT EXISTS` một mình không đủ làm migration idempotent an toàn.

## 4. Backfill đề xuất

1. Tạo backup hợp lệ và đưa ghi order vào maintenance/quiesce window. Dùng snapshot kiểm thử trước; xác nhận schema thực tế và phiên bản migration.
2. Trong preflight, đọc `SELECT id, barcode FROM history ORDER BY id`; dùng chính JavaScript `trim()` đã chốt để tính canonical key. Dừng nếu NULL/non-string/empty, nếu canonical collision giữa các raw values khác nhau chưa được duyệt, hoặc nếu số rows thay đổi giữa preflight và migration.
3. Bắt đầu `BEGIN IMMEDIATE` qua `better-sqlite3` transaction `.immediate()`. Tạo hai bảng, staging tạm trong connection, backfill registry và mapping, kiểm tra invariant, ghi marker/version migration cuối cùng rồi commit.
4. Group theo canonical barcode: `COUNT(*)=1` → `legacy_unique`; `COUNT(*)>1` → `legacy_ambiguous`. Mỗi source row có đúng một mapping. Không sửa, xóa, cập nhật, gộp hay chọn primary history row.
5. Mọi thất bại trước commit rollback DDL, marker, registry và mappings. Chỉ công bố phiên bản server dùng registry sau khi kiểm tra sau migration đạt.

SQL phần aggregate dự kiến; staging được populate bởi migration runner sau khi JavaScript tính đúng canonical key, không dùng SQL `trim()` thay thế:

```sql
CREATE TEMP TABLE barcode_registry_backfill_stage (
    history_id INTEGER PRIMARY KEY,
    raw_barcode TEXT NOT NULL,
    normalized_barcode TEXT COLLATE BINARY NOT NULL
);

INSERT INTO barcode_registry (
    normalized_barcode, status, registered_at, legacy_row_count
)
SELECT normalized_barcode,
       CASE WHEN COUNT(*) = 1 THEN 'legacy_unique' ELSE 'legacy_ambiguous' END,
       ?,
       COUNT(*)
FROM barcode_registry_backfill_stage
GROUP BY normalized_barcode COLLATE BINARY
ON CONFLICT(normalized_barcode) DO NOTHING;

INSERT INTO barcode_registry_history (normalized_barcode, history_id)
SELECT normalized_barcode, history_id
FROM barcode_registry_backfill_stage
ON CONFLICT(normalized_barcode, history_id) DO NOTHING;
```

Dấu `?` là một migration timestamp UTC duy nhất được bind parameterized. `ON CONFLICT` chỉ để lần chạy lại sau một migration đã hoàn tất là no-op cho key/mapping đã có; trước khi coi lần chạy lại là an toàn, runner phải xác nhận schema, migration marker, registry counts và mapping khớp history. Nếu phát hiện trạng thái lệch/partial do phiên bản migration khác, abort để điều tra, không tự sửa bằng `DO NOTHING`.

Repo hiện không có migration runner/version ledger chuyên dụng; `database.js` chạy DDL/seed khi import và có nhánh rebuild legacy. Khi triển khai, ưu tiên một migration entry point/version marker tường minh, không để backfill lịch sử chạy ngầm mỗi lần server khởi động. DDL migration và phần khởi tạo ứng dụng phải tương thích với thứ tự deploy đã duyệt.

## 5. Transaction tạo order mới

Pseudocode đề xuất cho `POST /api/history`, chưa thay API:

```text
canonical = barcode.trim()
validate raw type/length, canonical non-empty, address and effective fields
BEGIN IMMEDIATE
  INSERT registry(canonical, status='new', registered_at, legacy_row_count=0)
    ON CONFLICT(normalized_barcode) DO NOTHING
  if changes == 0:
    return duplicate outcome; do not INSERT history
  historyResult = INSERT history(..., barcode=canonical, ...)
  INSERT barcode_registry_history(canonical, historyResult.id)
COMMIT
return existing 201 { id, fields }
```

Nếu history insert, mapping insert hoặc bất kỳ statement nào khác thất bại, rollback registry và history cùng nhau. SQLite unique constraint là chốt bảo vệ, không `SELECT` pre-check. `BEGIN IMMEDIATE` xin write lock trước thao tác; SQLite tuần tự hóa writers kể cả nhiều process, sau commit chỉ một request giành được canonical key. Request cạnh tranh thấy key đã có và không tạo history thứ hai. Busy/locked sau timeout là lỗi transient, không được ánh xạ nhầm thành duplicate 409.

Ưu tiên `INSERT ... ON CONFLICT(normalized_barcode) DO NOTHING` với conflict target cụ thể; `changes === 0` là nhánh duplicate. Lỗi unique ở `history`, foreign key, CHECK hoặc mapping không được coi là barcode duplicate. Nếu triển khai bằng exception thay vì conflict clause, chỉ bắt đúng constraint/table/column của registry key; lỗi khác phải đi vào xử lý server error không lộ SQL/stack.

Response lỗi dự kiến giữ message tương thích client cũ và thêm code ổn định:

```json
{
  "error": "Mã vận đơn đã tồn tại.",
  "code": "BARCODE_ALREADY_EXISTS"
}
```

HTTP status `409`. `201 {id,fields}` giữ nguyên. Các frontend có thể đọc `ApiError.status` và `ApiError.data.code`; legacy Admin hiện hiển thị `result.error`. Không trả 409 từ mọi lỗi constraint.

Atomicity ở đây bao phủ registry, history và mapping của order. Middleware hiện chạy trước handler có thể ghi anonymous activity; rate limit và `pruneGeneratedCodeHistory()` cũng nằm ngoài transaction order. Chúng không được mô tả là rollback cùng request. Cần test/ghi rõ side effects này; không mở rộng transaction ngầm qua tracking middleware.

## 6. Tra cứu và tương thích

### Resolver nội bộ/Admin đề xuất

Tạo service đọc registry rồi join mapping với các row `history` còn tồn tại; không query chỉ theo barcode rồi chọn `ORDER BY id DESC LIMIT 1`.

| Registry state | Kết quả resolver |
|---|---|
| `legacy_unique` | Trả row duy nhất nếu còn trong history; nếu retention đã xóa row, trả trạng thái expired/not available, không dựng lại row. |
| `legacy_ambiguous` | Trả trạng thái ambiguous và toàn bộ history rows còn tồn tại qua mapping; không chọn mới nhất/cũ nhất. Bao gồm `legacy_row_count` snapshot để thể hiện số nguồn lúc backfill. |
| `new` | Trả row đã liên kết nếu còn tồn tại; nếu mapping mất do retention, trạng thái phải thể hiện expired/not available, không giả vờ còn đơn. |
| Không có registry row | `not_found`. |

Hiện chưa có API lấy một đơn theo barcode/ID cho trang kết quả. `GET /api/admin/history` là list/search phân trang 50 rows, có `barcode LIKE`, trả từng history row và gọi prune trước khi đọc. Admin React `OrderManagementPage` và legacy `admin.js` dùng endpoint này. Legacy `/api/admin/created-codes` hợp nhất `history` với `inventory_history`; không thấy caller trong `admin.js` hiện tại, nhưng caller ngoài repo chưa được loại trừ. Các GET Admin có pruning side effect.

Public React `PublicOrderPage` và legacy Admin “tạo lại tem” gọi `POST /api/history`; React/legacy result (`OrderResultPage.jsx`, `ketqua.html`) lấy barcode/địa chỉ/field từ query string và gọi `/api/barcode`, `/api/qrcode` để dựng ảnh. Không có DB lookup trong trang kết quả hiện tại.

Đề xuất resolver mới mặc định chỉ dùng từ route Admin được bảo vệ (`requireAdmin`), trả danh sách ambiguous không làm thay đổi response của `/api/admin/history`. Không thêm public endpoint trả name/phone/address theo barcode nếu chưa có quyết định quyền riêng tư: barcode có thể bị biết bởi người khác và dữ liệu history chứa PII. Public tạo đơn chỉ nhận 409 khi mã đã được registry giữ. Public lookup lịch sử/ambiguous là quyết định sản phẩm/bảo mật riêng; không thay response hay query URL trong migration này.

### Rủi ro retention 72 giờ cần duyệt

`server.js` prune `history` và `inventory_history` cũ hơn 3 ngày theo timer mỗi giờ, khi khởi động, trong `POST /api/history`, và trong một số Admin GET. Với FK mapping `ON DELETE CASCADE`, mapping sẽ mất cùng history row nhưng registry/tombstone tồn tại để không tái sử dụng barcode. Điều này giữ uniqueness lâu dài nhưng lookup không thể trả order sau khi history bị prune; `legacy_ambiguous` chỉ còn danh sách các row còn lưu.

Trước khi triển khai cần chọn một trong các chính sách: giữ retention hiện tại và định nghĩa kết quả expired; giữ các history rows đã registry-refer bằng cách sửa retention; hoặc lưu archive/result snapshot riêng với chính sách PII/retention rõ ràng. Không thể vừa xóa history sau 72h vừa đảm bảo resolver luôn trả order đầy đủ chỉ bằng registry. Đây là gate, không tự đổi retention trong Phase 9.3C.

## 7. Backup, xác minh và rollback

- Trước bất kỳ migration thật nào: maintenance/quiesce writes, chụp backup consistent bằng SQLite Online Backup API (hoặc công cụ SQLite hỗ trợ snapshot/WAL đúng cách). Không chỉ copy file main DB khi WAL đang hoạt động.
- Mở backup bằng kết nối readonly riêng; chạy `PRAGMA integrity_check` và `foreign_key_check`; đối chiếu schema, tổng `history` count, danh sách `id` và canonical barcode groups.
- Tính SHA-256 cho backup đã đóng hoàn chỉnh và lưu checksum, size, thời gian, DB path/phiên bản ở nơi kiểm soát. Backup không được xóa tự động; giữ các backup cũ theo chính sách retention.
- Ghi baseline `COUNT(*)`, `MIN(id)`, `MAX(id)` và hash ổn định của cặp `(id, barcode)` theo `ORDER BY id`. Sau migration các giá trị `history` này phải bất biến; registry count bằng số canonical keys, mapping count bằng số rows history trong snapshot.
- Migration DDL/backfill/marker dùng `BEGIN IMMEDIATE`; constraint/validation failure trước commit rollback toàn bộ transaction. Chạy `integrity_check`, `foreign_key_check`, duplicate/mapping reconciliation và so sánh baseline trước khi mở lại writes.
- Nếu transaction chưa commit: rollback rồi điều tra, không cần xóa tay bảng. Nếu đã commit nhưng release app lỗi, ưu tiên rollback app code và giữ schema additive. Không restore backup cũ sau khi đã có order mới mà chưa bảo toàn writes phát sinh sau snapshot; restore DB chỉ trong maintenance window, sau khi xác định delta và có quyết định khôi phục riêng. Không drop registry hoặc xóa backup như thao tác rollback mặc định.

## 8. Test plan dự kiến

Tất cả test migration/API ban đầu chạy trên SQLite tạm trong thư mục temporary, đặt `DATABASE_PATH` trước khi load app/module. Không import `database.js` trong quá trình đọc DB thật; module hiện auto-DDL/seeds. Không gửi request tới API gắn DB thật. Repo chưa có test script riêng.

| Case | Môi trường | Kỳ vọng |
|---|---|---|
| History có barcode unique | SQLite tạm | Backfill tạo `legacy_unique`, một mapping, không đổi history. |
| History có exact duplicate | SQLite tạm | Một registry row `legacy_ambiguous`, mọi history ID được mapping; không chọn primary. |
| Backfill chạy lại | SQLite tạm | No-op có kiểm chứng; registry/mapping counts không tăng, history không đổi. |
| Leading/trailing ASCII space và Unicode whitespace | SQLite tạm | JS trim policy khớp backend; empty canonical bị abort; không dùng SQL trim thay JS. |
| Barcode khác chữ hoa/thường | SQLite tạm | Theo policy đề xuất BINARY, `ABC` và `abc` là hai keys; nếu nghiệp vụ chọn case-insensitive phải có preflight collision report. |
| NFC/NFKC/full-width hoặc chuỗi composed/decomposed | SQLite tạm | Quy tắc hiện tại phân biệt chuỗi; nếu bật Unicode normalization, test và báo mọi group collision trước migration. |
| Hai POST đồng thời cùng barcode | SQLite tạm, hai connections/requests | Đúng một 201, một 409 `BARCODE_ALREADY_EXISTS`, chỉ một history row và một registry row. |
| History INSERT thất bại sau registry insert | SQLite tạm với lỗi cưỡng bức | Toàn bộ transaction rollback; không còn registry row/mapping đơn lẻ. |
| Mapping/FK/constraint failure | SQLite tạm | Rollback và lỗi không bị đổi thành 409 duplicate. |
| Mã đã tồn tại từ legacy/new | SQLite tạm | POST mới trả 409; history cũ không bị sửa. |
| Resolver legacy unique | SQLite tạm | Trả đúng row duy nhất. |
| Resolver legacy ambiguous | SQLite tạm | Trả state ambiguous và tất cả rows, không auto-select. |
| Resolver new | SQLite tạm | Trả mapping tới đúng row; test riêng tình huống retention xóa row theo chính sách được duyệt. |
| Không tìm thấy | SQLite tạm | Trả `not_found`, không fallback sang gần đúng/case-fold. |
| Đọc đơn cũ sau migration | SQLite tạm | `/api/admin/history` shape/status hiện hành không đổi, mọi row/field/address còn đọc được. |
| Backup/rollback | SQLite tạm và staging được duyệt | Backup readonly mở/integrity đúng; rollback transaction không mất row hoặc registry. |

Chỉ sau khi test SQLite tạm đạt mới chạy integration trên staging/snapshot được phê duyệt. Không test/đọc/ghi production trong kế hoạch này. Race, disk-full/SQLITE_BUSY, migration rollback và PII exposure phải được xem xét riêng ở staging.

## 9. Files có thể cần trong giai đoạn triển khai

| Khu vực | File/module có thể liên quan | Mục đích dự kiến |
|---|---|---|
| Migration | Module/script mới dưới `migrations/` hoặc `scripts/migrations/` | DDL, preflight, backfill, version marker và verify/rollback; phải chạy tường minh, không backfill ngầm khi server import. Chưa tồn tại trong repo. |
| Backend/schema | `database.js` | Khai báo schema/queries hoặc truy cập registry sau khi migration được duyệt; chú ý module đang auto-migrate/seed khi import. |
| Backend API | `server.js` | Transaction create, exact 409 mapping, resolver Admin mới nếu được duyệt; không thay success response hiện có. |
| React public | `frontend/src/features/orders/PublicOrderPage.jsx`, `OrderForm.jsx`, `frontend/src/shared/api/client.js` | Trim/validation/sync submit và hiển thị 409 theo code nếu được duyệt; client hiện giữ `ApiError.data`. |
| React Admin | `frontend/src/features/admin/OrderManagementPage.jsx`, `OrderDetailDialog.jsx` | Xử lý “tạo lại” bị 409 và/hoặc hiển thị ambiguous qua route được bảo vệ. |
| Legacy Admin | `admin.js` | Tạo lại tem cũng POST `/api/history`, cần xử lý response duplicate nếu legacy còn được phục vụ. |
| Result / lookup | `frontend/src/features/orders/OrderResultPage.jsx`, `ketqua.html`, có thể `ResultLabel.jsx`/`LabelSvg.jsx` | Chỉ sửa nếu sản phẩm duyệt API lookup mới; hiện các trang dựng tem từ URL và không tra DB. Bảo toàn A7 SVG/tọa độ/font/layout nếu có thay đổi. |
| Test/docs | test mới cho migration/API và README vận hành | Test isolated SQLite, hướng dẫn backup/migrate/verify/rollback. Repo hiện không có test script chuyên biệt. |

Các file `.vscode/settings.json`, Phase 9.2 auth/admin/inventory edits, A7 layout, deployment/VPS không thuộc kế hoạch chỉnh sửa mặc định; không đụng vào nếu chưa có phê duyệt riêng.

## 10. Rủi ro và điều kiện cần xác nhận

1. **Preflight production:** local DB đã xác minh nhưng không xác nhận active `DATABASE_PATH`, schema, WAL state hay dữ liệu VPS. Cần snapshot/read-only audit đúng DB đích trước migration.
2. **Normalization:** xác nhận rõ trim theo JavaScript, phân biệt hoa/thường, không NFC/NFKC. Nếu khác, yêu cầu collision report cho từng raw barcode/IDs trước khi tiếp tục.
3. **Duplicate lịch sử:** phương án A giữ cả hai nhóm: `PKE1482272070` (4 rows) và `PKE1486195236` (2 rows). Registry coi chúng là occupied/ambiguous; không sửa lịch sử và POST barcode đó sẽ bị từ chối. Xác nhận hành vi này chấp nhận được.
4. **Retention:** quyết định registry có giữ barcode vĩnh viễn và cách hiển thị/tra cứu sau khi history bị xóa ở mốc 72 giờ. Unique tombstone bền vững ngăn reuse nhưng không phục hồi order đã prune.
5. **PII/lookup:** lookup theo barcode có thể lộ người nhận/điện thoại/địa chỉ. Resolver ambiguous nên Admin-only mặc định; public lookup cần threat-model và auth/privacy approval.
6. **Admin tạo lại:** React và legacy Admin đang gửi lại cùng barcode qua `POST /api/history`. Khi unique policy hoạt động, đây sẽ nhận 409; xác định “tạo lại tem” là tạo bản copy có barcode mới, chỉ in lại không ghi history, hay bị cấm. Không tạo đường bypass uniqueness.
7. **Operational migrations:** repo hiện auto-DDL khi import database module và chưa có migration ledger/runner chuẩn. Cần chốt migration entry point, maintenance/quiesce, app compatibility và version marker để tránh migration tự chạy khi deploy.
8. **Concurrency/availability:** SQLite một writer; dùng immediate transaction, unique constraint, busy timeout rõ ràng và phân biệt SQLITE_BUSY với duplicate 409.
9. **Response compatibility:** duyệt JSON 409 có `code` ổn định và message localized; success `{id,fields}` giữ nguyên. Không đổi `/api/admin/history` hiện hành hoặc public result response trong cùng đợt nếu không có phê duyệt.
10. **Mất dữ liệu khi rollback:** không restore backup cũ sau khi app đã nhận order mới mà chưa bảo toàn delta. Backup cũ được giữ nguyên.

## 11. Thứ tự triển khai đề xuất sau khi duyệt

1. Xác nhận owner các quyết định normalization, legacy duplicate behavior, Admin recreate, lookup/PII, registry retention và lookup sau 72h.
2. Chụp snapshot backup DB đích theo quy trình WAL-aware; xác minh readonly/integrity/checksum; lập preflight report schema, barcode canonicalization collisions và baseline history IDs/hash. Abort nếu DB khác hoặc có collision chưa được duyệt.
3. Viết migration tường minh và isolated tests; kiểm tra rerun, rollback, FK, counts/hash trên các SQLite fixtures có unique/ambiguous/Unicode cases.
4. Chạy migration trên staging clone; verify `integrity_check`, `foreign_key_check`, mọi history rows unchanged, 1 registry key mỗi canonical barcode, mọi mapping đúng.
5. Triển khai backend route transaction + unique conflict `409 BARCODE_ALREADY_EXISTS`, giữ nguyên success contract; chạy concurrent/error tests trên staging.
6. Triển khai/kiểm thử UI React và legacy Admin duplicate/recreate behavior; nếu lookup được duyệt, thêm resolver Admin-protected và giữ nguyên public result/A7 contract.
7. Chạy staging acceptance, backup/rollback rehearsal và xác minh retention behavior; chỉ áp dụng production sau một phê duyệt triển khai riêng.

## Trạng thái thực thi

Đây chỉ là kế hoạch. Trong Phase 9.3C, database chỉ được mở bằng kết nối readonly và chỉ chạy `SELECT`/`PRAGMA`; không migration, DDL thật, INSERT/UPDATE/DELETE, tạo order, API request, source edit ngoài file kế hoạch, package install, commit/push, restart server, VPS hoặc production operation nào được thực hiện.
