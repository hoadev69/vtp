# PHASE 9.3 - PUBLIC ORDER INTEGRATION REPORT

Ngày kiểm tra: 2026-10-03
Trạng thái: **Tạm dừng trước chỉnh sửa code theo giới hạn Phase 9.3**.

## 1. File đã kiểm tra

- [`PHASE_9_1_BACKEND_API_INTEGRATION_AUDIT.md`](PHASE_9_1_BACKEND_API_INTEGRATION_AUDIT.md)
- [`PHASE_9_2_AUTHENTICATION_AUTHORIZATION_REPORT.md`](PHASE_9_2_AUTHENTICATION_AUTHORIZATION_REPORT.md)
- Backend: [`server.js`](server.js), [`database.js`](database.js)
- React: [`PublicOrderPage.jsx`](frontend/src/features/orders/PublicOrderPage.jsx), [`OrderForm.jsx`](frontend/src/features/orders/OrderForm.jsx), [`AddressSelector.jsx`](frontend/src/features/orders/AddressSelector.jsx), [`client.js`](frontend/src/shared/api/client.js), [`OrderResultPage.jsx`](frontend/src/features/orders/OrderResultPage.jsx), [`LabelSvg.jsx`](frontend/src/features/orders/LabelSvg.jsx), [`ResultLabel.jsx`](frontend/src/features/orders/ResultLabel.jsx), [`result.css`](frontend/src/features/orders/result.css)
- Legacy result comparison: [`ketqua.html`](ketqua.html)
- Build configuration/scripts: [`package.json`](package.json), [`vite.config.js`](frontend/vite.config.js)
- `.vscode/settings.json` đã được đọc theo yêu cầu bảo vệ thay đổi hiện có; không chỉnh sửa.

## 2. File đã chỉnh sửa

- Chỉ tạo report này. Không sửa React, Express, API contract, schema/dữ liệu SQLite, A7 SVG/CSS, legacy code hoặc cấu hình triển khai.
- Các thay đổi có sẵn trong worktree trước khi Phase 9.3 bắt đầu được giữ nguyên; không sửa `.vscode/settings.json` hay các file Phase 9.2.

## 3. API và contract xác định từ source

### `GET /api/geography`

Public, không body. Trả danh sách district → commune → village hiện hành (ẩn mục hidden). Middleware `identifyAnonymousUser` có ghi activity vào SQLite; do đó không gọi trong audit/runtime test.

### `GET /api/form-fields`

Public, không body. Trả các field cấu hình gồm `key`, `label`, `inputType`, `visible`, `defaultValue`, `sortOrder`. Middleware cũng ghi anonymous activity.

### `POST /api/history`

Public, không yêu cầu session. Request body mà Express destructure:

```json
{
  "barcode": "...",
  "chonHuyen": "...",
  "chonXa": "...",
  "chonThon": "...",
  "fields": { "fieldKey": "string value" }
}
```

Các middleware trước handler gồm IP block, anonymous activity và generation rate limit. JSON body toàn ứng dụng giới hạn 16 KB.

| Giá trị | Validation / persistence theo source |
|---|---|
| `barcode` | Bắt buộc là string, sau `trim()` không rỗng, length tối đa 512. Giá trị đã trim mới được ghi vào `history.barcode`. |
| `chonHuyen`, `chonXa`, `chonThon` | Cả ba phải có kiểu string, tối đa 120 ký tự. `chonThon: ""` được chấp nhận. Handler không kiểm tra địa danh tồn tại hoặc đúng quan hệ cha-con. |
| `fields` | Mặc định `{}`. Với mỗi field đang cấu hình, string gửi lên được cắt tối đa 160 ký tự; thiếu/không phải string dùng default. Field `visible=false` luôn bị server thay bằng `defaultValue`. Key không nằm trong cấu hình không được ghi. |
| Thành công | `201 { id, fields }`; `id` là SQLite row id, `fields` là giá trị hiệu lực sau khi áp dụng visibility/default. Response không trả lại barcode hoặc địa chỉ. |
| Lỗi | `400 {error}` cho barcode/địa chỉ sai; `403` plain text khi IP bị chặn; `429` rate limit. Handler không khai báo `409` cho barcode trùng. Lỗi DB/500 không có response JSON riêng được xác định tại handler. |

Trong [`database.js`](database.js), `history` lưu `id`, `ip`, `barcode`, `district`, `commune`, `village`, `field_values`, thời gian, anonymous ID và creator. `barcode` là `TEXT NOT NULL`; schema source không có unique constraint/index cho barcode. Không truy vấn schema/data SQLite thực tế.

### `GET /api/barcode?text=...` và `GET /api/qrcode?text=...`

Public; query `text` phải là string khác rỗng, tối đa 512 ký tự. Trả ảnh `image/png`; input/tạo ảnh lỗi trả HTTP 400 dạng text; IP block 403 và generation limit 429. React result component gọi hai URL này bằng chính barcode trong query; không có API GET lấy order theo ID.

## 4. Đối chiếu field React ↔ backend ↔ result

| Dữ liệu | React request/form | Backend source | Result React hiện tại |
|---|---|---|---|
| Huyện | `chonHuyen`, tên từ select; bắt buộc HTML | String ≤120; không verify membership; lưu nguyên văn | Đọc query `chonHuyen`, in tên và phần sau dấu chấm |
| Xã | `chonXa`, tên từ select; bắt buộc HTML | String ≤120; không verify membership | Đọc query `chonXa` |
| Thôn | `chonThon`; select không `required`, gửi `""` nếu không có village | String ≤120; empty được phép | Đọc query `chonThon` |
| Mã vận đơn | `barcode`, input `required`; hiện không khai báo `maxLength` | Trim để kiểm tra/lưu, tối đa 512 | React hiện đưa barcode local vào query và dùng query đó cho QR/barcode |
| Người nhận | Dynamic field `nhapTen` nếu server trả field | Không bắt buộc; server dùng default khi thiếu/hidden; string bị cắt 160 | Hiển thị `nhapTen` |
| Số điện thoại | Dynamic field `nhapSdt` nếu cấu hình | Không bắt buộc; quy tắc string/default/truncate như trên | Hiển thị `nhapSdt`, rỗng thì placeholder số sao |
| Hàng hóa | Seed có `tenHang` và `soHang`; các dynamic field không `required` | Các field chỉ được chấp nhận nếu có trong `form_fields`; không có nghiệp vụ goods riêng trong endpoint | `tenHang`/`soHang` được hiển thị |
| Ghi chú | Không có field ghi chú trong seed; có thể xuất hiện như custom dynamic field | Field tùy chỉnh lưu trong `field_values` nếu được cấu hình | `OrderResultPage`/SVG/legacy result không đọc hoặc in ghi chú |
| COD / cước | Không có field COD/cước trong seed | Có thể truyền custom field khi được cấu hình, nhưng API chỉ áp quy tắc field động chung | Nhãn React hiện có tiền COD dạng dấu sao và cước tĩnh `0đ`; không dùng giá trị custom COD/cước |
| Field ẩn | `OrderForm` render hidden input với default/value; được đưa vào `fields` body | Server bỏ giá trị gửi lên và buộc dùng default | URL được tạo từ `result.fields` sau response; field không được result component nhận biết vẫn không hiển thị |

Seed hiện tại trong `database.js` tạo bốn key: `nhapTen`, `nhapSdt`, `soHang`, `tenHang`. Không thấy backend hay React contract đặt tên chuẩn cho ghi chú/COD/cước. Không tự đặt thêm key hoặc sửa nội dung/tọa độ nhãn A7.

## 5. Kết quả response → URL kết quả

`PublicOrderPage` hiện gửi `POST /api/history` qua `apiRequest`, sau HTTP success tạo `/ketqua.html?...`. URL gồm địa chỉ và barcode lấy từ state form, sau đó flatten từng `result.fields` vào query. `OrderResultPage` đọc các query keys và dựng SVG mặc định; refresh/mở lại URL giữ dữ liệu trong query. Thiếu `barcode` thì hiển thị lỗi và không render nhãn. Thiếu field tùy chọn khác thì hiện rỗng/placeholder.

Điểm không khớp: backend trim barcode khi lưu nhưng React hiện gửi và đưa barcode chưa trim vào URL; nhập barcode có khoảng trắng biên có thể khiến DB lưu barcode khác với barcode/QR/result hiển thị. Response `{id,fields}` không trả barcode/address; frontend không xác thực đủ shape response trước khi điều hướng. Không có endpoint đọc lại order theo `id`, nên result hiện phụ thuộc query string, trong đó có thể chứa PII. Không thay đổi URL contract trong audit.

Kích thước `105mm × 74mm` và `@page size: 105mm 74mm` hiện có trong result components/CSS. Không sửa SVG, tọa độ, font, nội dung hay quy tắc print.

## 6. Backend blocker: duplicate barcode

1. **File/vị trí:** handler `POST /api/history` trong [`server.js`](server.js); schema `history` trong [`database.js`](database.js).
2. **Contract hiện tại:** validate string/trim/length rồi `INSERT`; success là HTTP 201 `{id,fields}`. Không có SELECT duplicate, no 409 branch cho history, và schema không có unique barcode constraint/index. `server.js` có 409 ở các route quản lý địa chỉ/tài khoản nhưng không ở public history.
3. **React cần:** phân biệt một barcode đã tồn tại và hiện thông báo phù hợp theo yêu cầu Phase 9.3.
4. **Khác biệt:** React không có API công khai để tra cứu barcode tồn tại; `GET /api/admin/history` là Admin-only và cũng không phải contract duplicate check. `POST /api/history` hiện không biểu diễn trường hợp duplicate thành 409.
5. **Hậu quả:** không thể xác định duplicate đáng tin cậy ở frontend; nhiều order có cùng barcode có thể được ghi. Chỉ kiểm tra client hoặc ánh xạ mọi 409 thành “trùng mã” đều không đúng contract và có race condition.
6. **Hướng xử lý cần xác nhận:** chủ nghiệp vụ cần quyết định barcode trùng có bị từ chối hay được phép. Nếu từ chối, backend cần contract rõ (ví dụ HTTP 409 JSON) và cơ chế chống race phù hợp; trước khi thêm uniqueness cần kiểm tra duplicate hiện tồn tại bằng snapshot/test DB, nhưng không làm trong phase này. Không sửa backend hoặc database ở đây.

Theo mục 8 của yêu cầu Phase 9.3, đây là capability backend cần quyết định/sửa để đáp ứng yêu cầu duplicate; vì bị cấm sửa backend/schema, implementation bị dừng trước khi chỉnh code frontend. Không tự giả lập duplicate bằng dữ liệu local.

## 7. Lỗi frontend còn quan sát được, chưa sửa

- `isSubmitting` disable nút sau render, nhưng `handleSubmit` không có synchronous in-flight ref; hai submit event liên tiếp trước render có thể tạo hai POST.
- Barcode input không khai báo `maxLength=512`; chuỗi whitespace có thể qua native `required`, dù backend sẽ 400 sau khi trim.
- React gửi barcode chưa trim, khác giá trị backend lưu.
- `apiRequest` chuyển lỗi JSON/text thành `ApiError`; `PublicOrderPage` hiện hiển thị `error.message`, giữ input và bỏ trạng thái submitting. 400/409/500 không có xử lý theo status cụ thể; 409 nếu từ upstream sẽ hiện message nếu có, nhưng Express history không trả 409. 500 dạng HTML có nguy cơ hiện nguyên response text thay vì thông báo lỗi hệ thống gọn.
- Không có retry tự động; input state không bị xóa khi request thất bại.
- Response thành công chưa được kiểm tra `id`/`fields` theo contract trước khi điều hướng; fallback `result?.fields || {}` có thể đi tiếp với response thiếu dữ liệu.
- Dynamic field values được đưa vào query string; field ghi chú/COD/cước tùy chỉnh không được result label ánh xạ. Không thay đổi label do ràng buộc A7.

Các vấn đề này được ghi nhận, chưa chỉnh vì phải dừng tại backend blocker; không khẳng định luồng tạo đơn đã hoàn chỉnh.

## 8. Kiểm thử và mức độ xác minh

| Cấp | Kết quả |
|---|---|
| Frontend build | `npm run build` PASS trên code hiện tại. |
| Test script hiện có | `package.json` có `build`, không có script `test`. Không tìm thấy test suite public-order được khai báo trong package scripts. |
| API contract | Đối chiếu source Express/React hoàn tất; xác định status/body như mục 3. |
| Mock | Không chạy mock test trong Phase 9.3; không tuyên bố kết quả mock. |
| Express runtime | UNVERIFIED; không khởi động/gọi endpoint. |
| SQLite runtime/schema/data | UNVERIFIED; không import `database.js`, mở SQLite, migrate hoặc ghi dữ liệu. |
| Duplicate/409 | Source-confirmed là không được hỗ trợ trong route history; không test thực tế. |

Không gửi POST test vì endpoint ghi lịch sử, không có test DB đã được xác nhận. `GET /api/geography` và `/api/form-fields` cũng có middleware ghi anonymous activity. Chưa chạy `git diff --check` sau khi tạo report; cần xác minh report/worktree trước khi kết thúc.

## 9. Mức độ hoàn thành và điều kiện trước Phase 9.4

Phase 9.3 mới hoàn tất **source/API contract audit và build hiện trạng**; chưa tích hợp/fix frontend và chưa nghiệm thu runtime. Blocker chính là backend không có contract duplicate handling trong khi yêu cầu cần thông báo barcode trùng. Các lệch barcode trim, synchronous submit lock, response validation, lỗi 500 và field result được ghi nhận nhưng chưa sửa theo chỉ thị dừng.

Điều kiện cần trước khi tiếp tục:

1. Xác nhận nghiệp vụ có cấm trùng barcode không và quy tắc so sánh (trim/case sensitivity).
2. Nếu cấm trùng, duyệt thay đổi backend/API/schema cần thiết; kiểm tra dữ liệu duplicate trên bản sao test trước khi áp dụng uniqueness.
3. Xác định field keys/hiển thị chính thức cho ghi chú, COD và cước; nhãn A7 hiện chưa hỗ trợ các giá trị đó và không được thay đổi theo ràng buộc hiện tại.
4. Dùng test DB cô lập đã được xác nhận để kiểm tra POST success/400/409/500, giữ nguyên payload khi lỗi, idempotency/duplicate race, query result reload và PNG QR/barcode. Không dùng production DB.
5. Sau khi được duyệt, hoàn tất các chỉnh sửa React trực tiếp liên quan và chạy build, contract/mock tests, runtime test cô lập cùng diff review.

**Đề xuất model Copilot cho Phase 9.4:** chọn **GPT-4.1 mini** nếu có trong model picker để tiết kiệm credits cho implementation/test có phạm vi rõ; dùng model mạnh hơn chỉ cho lượt review bảo mật cuối nếu phát sinh thay đổi auth/authorization. Chi phí/availability thực tế phụ thuộc cấu hình Copilot hiện tại.

## Phase 9.3B - Backend Contract Completion Addendum

Ngày kiểm tra DB: 2026-10-03
Trạng thái: **DỪNG trước migration và code changes do phát hiện barcode trùng trong dữ liệu hiện có.** Nội dung audit Phase 9.3 phía trên được giữ nguyên.

### Database thực tế được đọc

- `.env` không tồn tại trong workspace và `DATABASE_PATH` không được đặt trong process hiện tại; file local được resolve là `data/history.sqlite`. Đây là database trong workspace, không chứng minh đường dẫn DB của VPS/systemd.
- Mở bằng `better-sqlite3` với `readonly: true`, `fileMustExist: true`; không import `database.js`. Không có process nào đang giữ các file database/WAL/SHM khi kiểm tra.
- `PRAGMA integrity_check` trả `ok`.
- Schema hiện tại của `history`: `id INTEGER PRIMARY KEY AUTOINCREMENT`, `ip TEXT NOT NULL`, `barcode TEXT NOT NULL`, `district TEXT NOT NULL`, `commune TEXT NOT NULL`, `village TEXT NOT NULL`, `legacy_username TEXT`, `created_at TEXT NOT NULL`, `field_values TEXT NOT NULL DEFAULT '{}'`, `anonymous_user_id TEXT`.
- Index của `history`: `history_anonymous_user_idx (anonymous_user_id)`, `history_ip_idx (ip)`, `history_created_at_idx (created_at DESC)`. Cả ba đều không unique. Không có index/constraint trên barcode.

### Kết quả barcode chỉ-read

Chính sách normalization quan sát được trong backend hiện tại là JavaScript `trim()` rồi so sánh nguyên văn, tức phân biệt hoa/thường; không có lower-case conversion. Database hiện có không chứa barcode NULL, không phải string, rỗng sau JS `trim()`, hoặc khác giá trị sau khi trim. Không thấy bản ghi chỉ khác nhau do hoa/thường. Các duplicate dưới đây là exact match, nên trùng theo cả phép so sánh phân biệt và không phân biệt hoa/thường:

| Barcode | Số bản ghi | Row ID |
|---|---:|---|
| `PKE1482272070` | 4 | 5, 14, 15, 19 |
| `PKE1486195236` | 2 | 8, 9 |

Tổng cộng có 2 nhóm duplicate, ảnh hưởng 6 trong 8 rows; 2 rows còn lại có barcode riêng. Không có row nào bị chọn làm bản ghi chuẩn, xóa, sửa, gộp hoặc di chuyển.

### Quyết định migration

- Migration **không chạy**; không tạo unique index/constraint và không sửa schema/dữ liệu. Vì duplicate tồn tại, `CREATE UNIQUE INDEX ... ON history(barcode)` hiện sẽ thất bại.
- Chưa thể bảo đảm backend từ chối barcode mới trùng một trong các giá trị lịch sử nếu chưa có cơ chế uniqueness cuối cùng. Chỉ `SELECT` trước `INSERT` không đủ chống hai request đồng thời.
- Cần người dùng/chủ nghiệp vụ quyết định cách xử lý các nhóm duplicate hiện có (giữ tất cả và cho phép tồn tại lịch sử, hay chọn một quy trình xử lý/đánh dấu rõ ràng). Không tự quyết định. Sau quyết định mới thiết kế migration; không chạy migration production trong phase này.
- Để giữ tương thích hiện tại, đề xuất barcode mới tiếp tục được `trim()` ở backend và so sánh case-sensitive (`BINARY`), không đổi cách diễn giải các barcode lịch sử. Cần xác nhận lại chính sách trước khi chốt unique key.

### Contract và trạng thái sau addendum

- `POST /api/history` chưa thay đổi: request `{barcode,chonHuyen,chonXa,chonThon,fields}`, success `201 {id,fields}`. Chưa có response `409 BARCODE_ALREADY_EXISTS`; chưa có contract cuối cùng cho duplicate.
- Không sửa server, database, React Public Order hoặc Result. Không thực hiện integration/runtime tests; POST sẽ ghi order và hiện chưa có test DB cô lập được xác nhận. Build hiện trạng đã chạy ở lượt Phase 9.3 trước addendum, nhưng không xác nhận database/API runtime.
- **Frontend integration:** vẫn chưa hoàn tất; các vấn đề barcode chưa trim, submit race, response-shape validation và mapping ghi chú/COD/cước giữ nguyên như audit ban đầu.
- **Backend/API integration:** dừng; duplicate business rule và tính duy nhất chưa được triển khai.
- **Runtime verification:** chỉ schema/data local đã được truy vấn read-only; Express POST và database trên production chưa xác minh.

### Cần xác nhận trước khi tiếp tục

1. Barcode trùng có phải bị từ chối không? Quy tắc hiện quan sát được là trim khoảng trắng, phân biệt hoa/thường.
2. Chọn cách xử lý hai nhóm lịch sử trùng nêu trên; không có thay đổi dữ liệu nào được thực hiện.
3. Sau khi được duyệt, xác định migration phù hợp và kiểm thử trên bản sao/test DB trước; chỉ sau đó mới thêm unique enforcement cùng HTTP 409 JSON ổn định và hoàn thiện React mapping.

Phase 9.3B dừng theo điều kiện an toàn dữ liệu. Không code, schema, index, service hoặc database contents nào bị thay đổi trong lần kiểm tra này.
