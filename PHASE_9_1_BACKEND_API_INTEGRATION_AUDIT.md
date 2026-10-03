# PHASE 9.1 - BACKEND & API INTEGRATION AUDIT

Ngày kiểm tra: 2026-10-03
Phạm vi: kiểm tra source/configuration hiện có, không thay đổi code nghiệp vụ.

## Phạm vi và cách xác minh

- Đã đọc `server.js`, `database.js`, `session-store.js`, React API client/services/pages, HTML/JS legacy, Vite config, service worker, `package.json`, README và deploy workflow.
- Không khởi động/restart service, không gửi request đến backend, không gọi endpoint có side effect, không import `database.js`, không mở hoặc truy vấn SQLite, không chạy migration.
- Chỉ đọc metadata file SQLite/WAL/SHM. Không đọc `.env`, secrets, token, password hoặc nội dung database.
- `MATCH` dưới đây nghĩa là method/path/request/response do source khai báo phù hợp với caller source. Đây **không** phải xác nhận API đang hoạt động trên môi trường thật. Tất cả runtime behavior, dữ liệu hiện thời và production routing vẫn cần xác minh riêng.

## A. Tổng quan kiến trúc

- Backend là Express 5 trong [`server.js`](server.js), khởi chạy bằng `npm start` → `node server.js`. JSON request body giới hạn 16 KB; rate limit đăng nhập và tạo mã dùng bộ đếm trong bộ nhớ process.
- SQLite mở trong [`database.js`](database.js). Đường dẫn mặc định là `data/history.sqlite`; file mặc định và các file `-wal`/`-shm` hiện có trong workspace. `DATABASE_PATH` có thể ghi đè đường dẫn, nên file đang được process production sử dụng **chưa thể xác nhận** nếu không đọc môi trường chạy.
- Session Express lưu trong SQLite qua [`session-store.js`](session-store.js). Có thêm token session riêng cho Kiểm kê; chỉ hash token được lưu trong `inventory_sessions`.
- Frontend React nằm trong `frontend/`, vào bằng [`frontend/index.html`](frontend/index.html), render qua [`frontend/src/main.jsx`](frontend/src/main.jsx) và [`frontend/src/app/App.jsx`](frontend/src/app/App.jsx). React dùng client [`frontend/src/shared/api/client.js`](frontend/src/shared/api/client.js); tất cả API URL là relative `/api/...` và fetch đặt `credentials: 'same-origin'`.
- Vite dev server proxy `/api` tới `VTP_BACKEND_ORIGIN` hoặc mặc định `http://127.0.0.1:3000` trong [`frontend/vite.config.js`](frontend/vite.config.js). Đây là cấu hình dev; build output cần được phục vụ cùng origin với API hoặc đi qua reverse proxy cùng origin.
- Express hiện phục vụ HTML legacy ở `/`, `/admin`, `/kiemke`, `/ketqua.html`, whitelist asset legacy bằng `res.sendFile`; không có `express.static(dist)` hoặc SPA fallback trong [`server.js`](server.js). Workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) chạy `npm ci --omit=dev` rồi restart service; không có bước `npm run build` hoặc publish React build.

## B. API Inventory

### B.1 Health, public, đăng nhập và Kiểm kê

| Method / URL | Request | Auth, success, lỗi theo source | Caller trong repo | Trạng thái |
|---|---|---|---|---|
| `GET /healthz` | Không có | Không cần auth. `200 {status:"ok"}` hoặc `503 {status:"unavailable"}` khi query SQLite thất bại. | Không có caller frontend; README đề xuất health monitor. | `UNUSED` (frontend); monitor bên ngoài `UNVERIFIED` |
| `POST /api/login` | JSON `{username,password}` | Không cần session trước. `200 {username}`; `401 {error}` sai user/password hoặc inactive; giới hạn login có thể trả `429`. | React [`AdminPage.jsx`](frontend/src/features/admin/AdminPage.jsx), legacy `login.js`/`admin.js`. | `MATCH` (source) |
| `POST /api/logout` | Không có body | Cần active authenticated user (admin hoặc operator). `204`; `401 {error}` nếu không còn session. Hủy session, token inventory tương ứng và clear cookies. | React [`AppShell.jsx`](frontend/src/shared/components/AppShell.jsx), legacy `navigation.js`/`admin.js`. | `MATCH` (source) |
| `GET /api/admin/me` | Không có | Cần admin. `200 {username}`; `401` chưa xác thực, `403` sai role. | React AppShell/AdminPage; legacy `navigation.js`, `admin.js`. | `MATCH` (source) |
| `POST /api/kiemke/login` | JSON `{username,password}` | Không cần session trước; chỉ tìm user role `operator`. `200 {id,username}`; `401 {error}` sai thông tin; `403 {code:"ACCOUNT_DISABLED",error,reason}` tài khoản khóa; rate limit `429`; IP block `403` dạng text. | React [`InventoryPage.jsx`](frontend/src/features/inventory/InventoryPage.jsx), legacy `kiemke.js`. | `MATCH` (source) |
| `GET /api/kiemke/me` | Không có | Cần session/token hợp lệ. `200 {id,username}`; `401 {error}` không hợp lệ. Lưu ý role admin được chấp nhận trên nhánh Express session; mục D/G phân tích riêng. | React AppShell/InventoryPage; legacy `kiemke.js`, `navigation.js`. | `MATCH` về response; policy role `UNVERIFIED` |
| `POST /api/kiemke/logout` | Không có body | Cần `requireInventoryUser`. `204`; `401 {error}`. Hủy inventory token và session. | Legacy `kiemke.js`; React dùng endpoint chung `POST /api/logout`, không gọi endpoint này. | `UNUSED` (React); `MATCH` (legacy) |
| `POST /api/history` | JSON `{barcode,chonHuyen,chonXa,chonThon,fields}` | Public, không yêu cầu đăng nhập; IP block/anonymous tracking/rate limit. `201 {id,fields}`; `400 {error}` input; `403` IP block dạng text; `429` rate limit. Server dùng default cho field ẩn/không hợp lệ. | React [`PublicOrderPage.jsx`](frontend/src/features/orders/PublicOrderPage.jsx), [`OrderManagementPage.jsx`](frontend/src/features/admin/OrderManagementPage.jsx); legacy `index.html`/`admin.js`. | `MATCH` (source) |
| `POST /api/kiemke` | JSON `{waybill}` | Cần `requireInventoryUser`; IP block, anonymous tracking, rate limit. `201 {id,qrCode}` (`qrCode` là PNG data URL); `400 {error}` mã/QR không hợp lệ; `401` session; `403` IP block; `429`. | React InventoryPage; legacy `kiemke.js`. | `MATCH` về body/response; authorization role cần làm rõ |
| `GET /api/barcode?text=...` | Query `text`, tối đa 512 ký tự | Public; IP block, anonymous tracking, rate limit. `200 image/png`; `400` text hoặc tạo barcode lỗi dạng text; `403` IP block; `429`. | React [`ResultLabel.jsx`](frontend/src/features/orders/ResultLabel.jsx), [`LabelSvg.jsx`](frontend/src/features/orders/LabelSvg.jsx); legacy `ketqua.html`/`admin.js`. | `MATCH` (source) |
| `GET /api/qrcode?text=...` | Query `text`, tối đa 512 ký tự | Như barcode; `200 image/png`, lỗi `400` dạng text. | React ResultLabel/LabelSvg; legacy `ketqua.html`/`admin.js`/`kiemke.js` (QR inventory trả từ POST riêng). | `MATCH` (source) |
| `GET /api/geography` | Không có | Public; IP block và ghi nhận anonymous activity. `200` array địa bàn lồng district → communes → villages, chỉ mục đang hiện; `403` IP block dạng text. | React [`PublicOrderPage.jsx`](frontend/src/features/orders/PublicOrderPage.jsx); legacy `index.html`. | `MATCH` (source) |
| `GET /api/form-fields` | Không có | Public; IP block và anonymous activity. `200` array `{key,label,inputType,visible,defaultValue,sortOrder}`; `403` IP block dạng text. | React PublicOrderPage; legacy `index.html`. | `MATCH` (source) |

### B.2 Admin - địa bàn và trường nhập

Tất cả route dưới đây yêu cầu `requireAdmin`: `401` chưa xác thực, `403` sai quyền. Update/delete thành công trả `204` không body. API client React xử lý `204` thành `null`.

| Method / URL | Request | Success và lỗi nghiệp vụ | Caller / trạng thái |
|---|---|---|---|
| `GET /api/admin/geography` | Không có | `200` cùng cấu trúc geography, gồm cả mục ẩn. | React [`AddressManagement.jsx`](frontend/src/features/admin/AddressManagement.jsx), legacy `admin.js`; `MATCH` |
| `GET /api/admin/form-fields` | Không có | `200` cùng schema trường công khai. | React [`FormFieldManagement.jsx`](frontend/src/features/admin/FormFieldManagement.jsx), legacy `admin.js`; `MATCH` |
| `PUT /api/admin/form-fields/:key` | `{label,visible,defaultValue}` | `204`; `400` field sai hoặc default số không hợp lệ; `404` key không tồn tại. | React FormFieldManagement, legacy `admin.js`; `MATCH` |
| `POST /api/admin/districts` | `{name,kind}` (`kind`: `city`/`district`) | `201 {id}`; `400` validation; `409` tên trùng. | React AddressManagement, legacy `admin.js`; `MATCH` |
| `PUT /api/admin/districts/:id` | `{name,kind}` | `204`; `400`, `404`, `409`. | React AddressManagement, legacy `admin.js`; `MATCH` |
| `DELETE /api/admin/districts/:id` | Không body | `204`; `400` ID sai; `404` không tồn tại. Cascade xóa commune/village theo FK. | React AddressManagement, legacy `admin.js`; `MATCH`, destructive cascade cần xác nhận người dùng |
| `PATCH /api/admin/districts/:id/visibility` | `{hidden:boolean}` | `204`; `400` input sai; `404` không tồn tại. | React AddressManagement, legacy `admin.js`; `MATCH` |
| `POST /api/admin/communes` | `{name,districtId}` | `201 {id}`; `400`; `404` parent FK không tồn tại; `409` trùng trong district. | React AddressManagement, legacy `admin.js`; `MATCH` |
| `PUT /api/admin/communes/:id` | `{name,districtId}` | `204`; `400`, `404` row/parent, `409` trùng. | React AddressManagement, legacy `admin.js`; `MATCH` |
| `DELETE /api/admin/communes/:id` | Không body | `204`; `400` ID sai; `404`. Cascade xóa villages theo FK. | React AddressManagement, legacy `admin.js`; `MATCH`, destructive cascade cần xác nhận người dùng |
| `PATCH /api/admin/communes/:id/visibility` | `{hidden:boolean}` | `204`; `400`, `404`. | React AddressManagement, legacy `admin.js`; `MATCH` |
| `POST /api/admin/villages` | `{name,communeId}` | `201 {id}`; `400`; `404` parent; `409` trùng trong commune. | React AddressManagement, legacy `admin.js`; `MATCH` |
| `PUT /api/admin/villages/:id` | `{name,communeId}` | `204`; `400`, `404` row/parent, `409` trùng. | React AddressManagement, legacy `admin.js`; `MATCH` |
| `DELETE /api/admin/villages/:id` | Không body | `204`; `400` ID sai; `404`. | React AddressManagement, legacy `admin.js`; `MATCH` |
| `PATCH /api/admin/villages/:id/visibility` | `{hidden:boolean}` | `204`; `400`, `404`. | React AddressManagement, legacy `admin.js`; `MATCH` |

### B.3 Admin - lịch sử, users, accounts, IP và anonymous users

Tất cả route dưới đây yêu cầu Admin, trừ khi ghi khác. Các lỗi auth chung là `401`/`403` JSON.

| Method / URL | Request | Success / lỗi theo source | Caller / trạng thái |
|---|---|---|---|
| `GET /api/admin/history` | Query `page`, `search` | `200 {rows,total,generatedCodeTotal,page,pages}`; page 50 dòng. Handler gọi pruning retention trước khi đọc. | React [`OrderManagementPage.jsx`](frontend/src/features/admin/OrderManagementPage.jsx), legacy `admin.js`; `MATCH` contract, GET có side effect retention |
| `GET /api/admin/created-codes` | Query `page`, `ip`, `anonymousUserId`, `search` | `200 {rows,total,page,pages}`; `400` IP/token không hợp lệ. | Không thấy caller trong React hoặc legacy; `UNUSED` (repo), caller ngoài repo `UNVERIFIED` |
| `GET /api/admin/kiemke-history` | Query `page`, `search` | `200 {rows,total,page,pages}`. | Không thấy caller trong repo; `UNUSED` (repo), caller ngoài repo `UNVERIFIED` |
| `GET /api/admin/anonymous-users` | Query `page`, `search` | `200 {rows,total,page,pages}`; row có IP/count/session metadata. | Legacy `admin.js`; chưa có React caller; `UNUSED` (React), `MATCH` (legacy) |
| `GET /api/admin/anonymous-users/:id` | Path ID | `200` chi tiết user/IP/session/count; `400` token sai; `404` không tồn tại. | Không thấy caller trong repo; `UNUSED` (repo), caller ngoài repo `UNVERIFIED` |
| `GET /api/admin/users` | Query `page`, `search`, `role`, `status` | `200 {rows,total,page,pages}`; `400` role/status filter sai. | React [`AccountManagement.jsx`](frontend/src/features/admin/AccountManagement.jsx), legacy `admin.js`; `MATCH` |
| `POST /api/admin/users` | `{username,password,role}` | `201 {id,username,role,active,created_at}`; `400` validation; `409` username trùng. | React AccountManagement, legacy `admin.js`; `MATCH` |
| `PATCH /api/admin/users/:id/role` | `{role}` | `204`; `400`, `404`, `409` tự đổi role hoặc hạ admin active cuối cùng. | React AccountManagement, legacy `admin.js`; `MATCH` |
| `PATCH /api/admin/users/:id/status` | `{active,reason?}`; khóa cần reason | `204`; `400`, `404`, `409` tự khóa hoặc khóa admin cuối. Thu hồi sessions. | React AccountManagement, legacy `admin.js`; `MATCH` |
| `PUT /api/admin/users/:id/password` | `{password}` | `204`; `400` password; `404`; thu hồi sessions. | React AccountManagement, legacy `admin.js`; `MATCH` |
| `GET /api/admin/inventory-accounts` | Query `page`, `search` | `200 {rows,total,page,pages}` cho role operator. | Không thấy caller trong repo; `UNUSED` (repo), caller ngoài repo `UNVERIFIED` |
| `GET /api/admin/inventory-accounts/:id/orders` | Query `page`, `from`, `to`, `timezoneOffset` | `200 {rows,total,page,pages}`; `400` ID/date/timezone/range sai; `404` account không tồn tại; chỉ 72 giờ gần nhất. | Legacy `admin.js`; chưa có React caller; `UNUSED` (React), `MATCH` (legacy) |
| `POST /api/admin/inventory-accounts` | `{username,password}` | `201 {id,username}` tạo operator; `400`; `409` username trùng. | Không thấy caller trong repo (UI hiện tạo qua `/api/admin/users`); `UNUSED` (repo) |
| `PATCH /api/admin/inventory-accounts/:id` | `{active,reason?}` | `204`; `400` input; `404` không phải operator/không tồn tại; khóa thu hồi sessions. | Không thấy caller trong repo; `UNUSED` (repo) |
| `PUT /api/admin/inventory-accounts/:id/password` | `{password}` | `204`; `400`; `404`; thu hồi sessions. | Không thấy caller trong repo; `UNUSED` (repo) |
| `GET /api/admin/ips` | Không có | `200` array `{ip,label,blocked,code_count,last_seen}`. Handler pruning retention. | React [`IpManagement.jsx`](frontend/src/features/admin/IpManagement.jsx), [`OrderManagementPage.jsx`](frontend/src/features/admin/OrderManagementPage.jsx), legacy `admin.js`; `MATCH` contract, GET có side effect retention |
| `GET /api/admin/ips/:ip/history` | Query `page` | `200 {rows,total,page,pages}`; `400` IP sai. | Legacy `admin.js`; chưa có React caller; `UNUSED` (React), `MATCH` (legacy) |
| `PUT /api/admin/ips` | `{ip,label,blocked}` | `204`; `400` IP/label/blocked sai; upsert IP control. | React IpManagement, legacy `admin.js`; `MATCH` |

### B.4 Phân loại tổng hợp API

- **MATCH:** tất cả endpoint React hiện gọi đều được khai báo trong Express; ở source, method, path, body/query, success status và shape được đối chiếu thấy tương thích. Điều này không chứng minh database/runtime/deploy thực tế hoạt động.
- **MISMATCH:** chưa thấy mismatch payload/API path cho các caller React đã rà. Có mismatch ở **routing/hosting app shell**, mô tả tại mục E. Có policy role chưa rõ ở `/api/kiemke/me`.
- **MISSING:** không tìm thấy React request nào trỏ tới API route hoàn toàn thiếu trong Express.
- **UNUSED:** API backend chỉ dùng một phần hoặc chưa có caller React; bảng B ghi rõ có legacy caller hay không. Không kết luận client bên ngoài repository không dùng.
- **UNVERIFIED:** tất cả HTTP success/error trên môi trường triển khai, health monitor bên ngoài, API callers ngoài repo, đường dẫn DB/env production và routing của proxy.

## C. API Compatibility

| Khu vực | Kết quả đối chiếu | Trạng thái |
|---|---|---|
| Public geography/form fields → order form | Schema nested geography và fields khớp cách React dựng form. | `MATCH` (source) |
| Tạo tem → history → result | React gửi body backend đọc; server trả fields chuẩn hóa và React chuyển thành query parameters mà result page đọc. | `MATCH` (source) |
| Barcode/QR result assets | React dùng URL ảnh same-origin; backend trả PNG hoặc lỗi text; React `<img onError>` chuyển lỗi thành trạng thái lỗi chung. | `MATCH` (source) |
| Admin login/session | React POST login rồi GET `/api/admin/me`; backend trả `{username}`. | `MATCH` (source) |
| Admin CRUD users/addresses/fields/IP | Request methods/body và 204/null handling khớp route contracts. | `MATCH` (source) |
| Inventory login/session/create/logout | Login và create payload/response khớp. React dùng common `/api/logout`; Express common logout xóa cả `vtp.sid` và `vtp.kiemke.sid`. | `MATCH` source; `/api/kiemke/logout` legacy-only trong React |
| Admin history per-IP, account inventory date detail | Backend/legacy có route; không tìm thấy React UI caller cho per-IP history hoặc inventory account orders. | `UNUSED` (React), không phải API thiếu |
| Anonymous-user detail, created-codes, inventory history riêng | Route tồn tại nhưng chưa tìm thấy caller repository. | `UNUSED` (repo); caller ngoài repo `UNVERIFIED` |
| React route hosting | Express trả HTML legacy thay vì React build tại các path trọng yếu. | `MISMATCH` |
| Runtime HTTP/API response | Không gọi endpoints vì một số GET ghi telemetry/prune và phase yêu cầu không chạy service/không ghi DB. | `UNVERIFIED` |

`apiRequest()` trong [`client.js`](frontend/src/shared/api/client.js) đặt `Accept: application/json`, JSON encode body, same-origin credentials, bỏ đọc body cho `204`; JSON/text error được chuyển thành `ApiError`. `handleAdminAuthorizationError()` xử lý cả `401` và `403`. Riêng [`OrderManagementPage.jsx`](frontend/src/features/admin/OrderManagementPage.jsx) đặc biệt xử lý `401`, còn `403` hiển thị như lỗi tải danh sách; guard UI bình thường hạn chế tình huống này nhưng khi quyền bị thu hồi giữa phiên, thông điệp không đồng nhất.

## D. Authentication & Authorization

- Admin và Operator dùng bcrypt hash trong `users`; password nhập phải tối thiểu 6 ký tự, tối đa 72 byte. Admin login route chỉ authenticate role `admin`; inventory login route chỉ authenticate role `operator`.
- Express session cookie `vtp.sid`: `HttpOnly`, `SameSite=Lax`, `Secure` khi `NODE_ENV=production`, thời hạn 8 giờ. `Path` không được đặt tường minh ở session cookie; logout clear cookie với path `/`.
- Inventory login tạo random 32-byte token, chỉ hash lưu ở `inventory_sessions`, đồng thời tạo Express session và cookie `vtp.kiemke.sid` (HttpOnly/SameSite Lax/Secure production/path `/`, 8 giờ). Common logout xóa cả hai loại cookie/session tương ứng.
- Middleware đọc trạng thái/role active từ database cho mỗi request; Admin API dùng `requireAdmin`. Inventory routes dùng `requireInventoryUser` và legacy token fallback. Password/role/status changes thu hồi session qua `revokeInventorySessions`.
- Login limits: 10 lần sai/15 phút cho mỗi loại login; generation limits: 120 request/phút. Bộ đếm rate-limit là trong bộ nhớ process, không chia sẻ giữa nhiều instance.
- Không thấy CORS middleware, CSRF token, Origin/Referer validation hoặc CORS config. Mô hình source hiện same-origin và cookie SameSite=Lax; nếu triển khai khác origin, credentials/CORS/cookie phải được thiết kế riêng. Không thực hiện kiểm thử xâm nhập.
- **Policy chưa nhất quán:** `getInventoryUser()` trả user từ Express session mà không lọc role `operator`; do đó active Admin session được `/api/kiemke/me` và `POST /api/kiemke` chấp nhận. React `InventoryPage` cũng có nhánh để Admin gọi `/api/kiemke/me`, nhưng README mô tả Kiểm kê cần tài khoản nhân viên. Cần product owner xác nhận Admin có được phép dùng/tạo QR kiểm kê không; source cho thấy có, tài liệu hiện chưa nói rõ.
- React xử lý network error/status `401`/`403` và locked Operator response. Một số GET/API component có thông báo loading/error; chưa có runtime xác nhận session cookie, expiry, Secure behind proxy hoặc rate-limit behavior.

## E. React Routing

| URL | Express hiện tại trong source | React app mong đợi | Kết quả |
|---|---|---|---|
| `/` và `/index.html` | `res.sendFile(index.html)` ở root repo (legacy). | React `frontend/index.html` và `PublicOrderPage`. | `MISMATCH` production source |
| `/admin` | Trả `admin.html` legacy; chưa đăng nhập trả status `401`, role không phải admin trả `403` text. | React shell rồi xác minh `/api/admin/me`. | `MISMATCH` |
| `/kiemke` | Trả `kiemke.html` legacy sau IP-block check; client legacy tự gọi `/api/kiemke/me`. | React shell và `InventoryPage`. | `MISMATCH` |
| `/ketqua.html` | Trả `ketqua.html` legacy. | React `OrderResultPage` đọc query. | `MISMATCH` |
| `/api/*` đã khai báo | Các handler API tường minh chạy tại Express. | React relative `/api/...`. | Đường dẫn API cùng origin phù hợp khi app được serve/proxy đúng |
| `/api/*` không khai báo | Không có catch-all React; Express mặc định xử lý 404. | Không nên fallback sang HTML app shell. | Không thấy API fallback nuốt route |
| assets | Express whitelist một số legacy CSS/JS/SVG. Không thấy `express.static` hoặc sendFile `dist`. | Vite build output trong `dist/`. | React assets chưa được Express phục vụ trong source |

Vite dev có history fallback cho SPA route và proxy `/api`; `base` cố định `/`. Đây không chứng minh Vite preview/production host hoặc Nginx hiện hoạt. Service worker React chỉ được đăng ký ở production build, chỉ xử lý navigation cho các route khai báo và bỏ qua `/api` rõ ràng; service worker không bổ sung route serving ở Express.

Deploy workflow hiện pull source, `npm ci --omit=dev`, restart systemd `vtp`, không build React và không publish `dist`. Không thấy Nginx config/unit file trong repository; không truy cập VPS. Vì vậy direct refresh production cho React `/admin`/`/kiemke` chưa được chứng minh và source Express hiện trả HTML legacy. Nếu tích hợp, cần chọn duy nhất một lớp phục vụ React (Nginx/static host hoặc Express), giữ `/api/*` tách khỏi SPA fallback và cấu hình refresh cho `/`, `/admin`, `/kiemke`, `/ketqua.html`.

## F. SQLite

### File và schema theo source

- File mặc định: `data/history.sqlite`; file này cùng `data/history.sqlite-wal` và `data/history.sqlite-shm` tồn tại. `DATABASE_PATH` có thể ghi đè nên active runtime path `UNVERIFIED`.
- `database.js` bật WAL và `foreign_keys=ON`. Không mở SQLite trong audit. Schema source khai báo các bảng:
  - `users`: username unique, role CHECK (`admin`/`operator`), active, disabled_reason, password_hash.
  - `history`: barcode, address snapshots, creator/ip, field_values JSON text, timestamps, anonymous ID; không có FK sang geography/user.
  - `inventory_history`: waybill, creator/IP/time, `created_by_user_id` FK tới users với `ON DELETE SET NULL`.
  - `districts` → `communes` → `villages`: FK cascade; tên commune unique trong district, village unique trong commune; districts name unique toàn bảng.
  - `form_fields`: key PK, input_type CHECK (`text`,`tel`,`number`), visible/default/sort_order.
  - `ip_controls`: IP PK, label/blocked.
  - `anonymous_users`, `anonymous_sessions`, `anonymous_user_ips`: FK anonymous sessions/IP tới anonymous_users; session key hash; composite PK user/IP.
  - `sessions`: session JSON và expires_at; `inventory_sessions`: token hash, user FK cascade, expires_at.
  - `app_settings`: key/value cho seed flags.
- Indexes được tạo cho lịch sử/time, IP, anonymous IDs, villages lookup, inventory user/session và session expiry.

### Data integrity và side effects

- `database.js` thực thi DDL/migration/seed ngay khi module được import. Có conditional `ALTER TABLE`; nhánh legacy `history` thiếu cột `ip` rename table, copy dữ liệu sang schema mới rồi `DROP TABLE history_legacy`. Không có migration command riêng và nhánh rebuild này không được bọc trong transaction bao toàn bộ các statement. **Không chạy migration** trong phase này; schema thực tế chưa đọc để xác định nhánh nào sẽ chạy.
- `server.js` chạy `pruneGeneratedCodeHistory()` lúc khởi động và mỗi giờ, xóa history/inventory history cũ hơn 72 giờ. Nhiều GET Admin (history, created-codes, kiểm kê history, anonymous, inventory-account orders, IP APIs) cũng gọi pruning. Đây là retention hiện có nhưng GET có thể DELETE business rows; caller phải hiểu rõ trước khi dùng/monitor.
- `GET /api/geography`, `/api/form-fields` và các API public có `identifyAnonymousUser`, ghi/cập nhật anonymous user/session/IP/request_count. Do đó GET công khai không thuần read-only. Đây là lý do audit không gửi request trực tiếp.
- `POST /api/history` kiểm tra loại/độ dài địa chỉ nhưng không xác nhận district/commune/village tồn tại hoặc đúng quan hệ parent-child trong bảng geography. UI gửi lựa chọn hợp lệ, nhưng client có thể lưu snapshot địa chỉ không khớp dữ liệu hiện tại.
- Xóa district/commune cascade xóa dữ liệu địa bàn con; history lưu snapshot chuỗi nên vẫn giữ địa chỉ cũ. Mọi endpoint mutate DB, kể cả `DELETE`, `INSERT`, `UPDATE`, migration và pruning, đều không được chạy trong phase này.
- Metadata file workspace cho thấy DB mode `0644`. Đây chỉ là file hiện tại trong dev workspace, không khẳng định production mode; nếu production dùng quyền tương tự thì local users khác có thể đọc hashes/session/PII. Cần kiểm tra quyền file khi triển khai.

## G. Danh sách lỗi/rủi ro

### Critical

- Không phát hiện lỗi Critical được chứng minh chỉ từ source audit.

### High

1. **React chưa được serve bởi Express/deploy hiện tại (integration blocker).** Express trả HTML legacy cho bốn route UI và không phục vụ `dist`; workflow không build/publish React. Nếu kỳ vọng React đã là production UI, refresh trực tiếp `/admin` hoặc `/kiemke` sẽ vào legacy, không phải React. Production reverse proxy chưa xác minh.
2. **Khởi động backend có thể thay đổi schema/dữ liệu.** `database.js` auto-migrate/seed khi import; nhánh legacy có `DROP TABLE history_legacy` sau rebuild. Chưa xác nhận schema active, migration backup/rollback, transaction atomicity. Đây là rủi ro trước deploy/mở DB, không phải migration đã chạy trong audit.

### Medium

1. **GET có side effects dữ liệu.** Anonymous tracking ghi dữ liệu từ public GET; Admin GET có thể prune rows >72h. Rủi ro hiểu nhầm read-only hoặc tích hợp health/monitor không đúng.
2. **Scope role Kiểm kê chưa rõ.** Active Admin session được `requireInventoryUser` chấp nhận và có thể gọi `/api/kiemke`; README lại mô tả user employee. Cần xác nhận policy trước khi tích hợp quyền.
3. **CSRF protection không thấy trong source.** Cookie session SameSite=Lax là giảm thiểu, nhưng không có token/Origin check; cần đánh giá threat model, nhất là nếu có subdomain/same-site origins.
4. **DB file permission trong workspace là `0644`.** Nếu production tương tự, database và session/password hash data có thể đọc bởi account hệ điều hành khác. Production permission chưa xác minh.
5. **Address payload chỉ validate kiểu/độ dài.** `POST /api/history` không validate tên/quan hệ district → commune → village với dataset server; có nguy cơ lưu address snapshot giả/inconsistent từ client tùy nghiệp vụ chấp nhận.
6. **Rate limit memory-only.** Không cộng gộp giữa processes/instances; an toàn vận hành nhiều instance chưa có.

### Low

1. **Admin overview xử lý `401` riêng nhưng `403` thành lỗi thường** ở `OrderManagementPage`; các màn quản lý khác phân loại cả hai. Có thể gây thông báo kém rõ sau khi quyền bị thu hồi giữa phiên.
2. **Session debug logging** ở `/admin` và `/api/admin/me` ghi trạng thái có cookie/secure/proto/session user/NODE_ENV. Không log token/password, nhưng có thể tạo log auth-state không cần thiết.
3. **API client không validate schema/content-type cho success response.** Nếu proxy/fallback trả `200 text/html`, `apiRequest` trả string như thành công; component có thể lỗi khi dùng `.map()`/properties thay vì báo lỗi hợp đồng. Express hiện không có SPA fallback cho API, nhưng đây là guard còn thiếu cho proxy tương lai.
4. **Nhiều API server-side không có caller repository.** Các endpoint marked UNUSED có thể là API compatibility surface cho client ngoài repo; không xóa/chuyển đổi nếu chưa xác minh consumer ngoài.

## H. Kế hoạch xử lý đề xuất Phase 9.2–9.7

1. **Phase 9.2 - Chốt hosting/routing:** chọn Nginx/static host hay Express serve `dist`; xác nhận production topology, cùng origin, base path, refresh routes, asset path, API proxy và loại API khỏi SPA fallback. Chưa sửa trong Phase 9.1.
2. **Phase 9.3 - Contract tests:** tạo test fixture DB cô lập; test request/response/status/error/schema cho từng React-used API, `204`, PNG và unauthorized paths. Không dùng DB thật; chỉ chạy sau khi được duyệt.
3. **Phase 9.4 - Auth/authorization:** chốt Admin có được dùng Kiểm kê không; test session expiry, operator/admin/guest, revoke, logout, cookie qua proxy, `401/403`; đánh giá CSRF/CORS theo topology.
4. **Phase 9.5 - React feature parity:** quyết định có port các màn legacy-only (IP history, account orders theo ngày, anonymous details, created-code/kiểm kê history) hay giữ legacy route; thống nhất route ownership trước khi bỏ legacy.
5. **Phase 9.6 - SQLite safety:** xác minh active DB path/schema bằng bản sao read-only hoặc snapshot; migration tests/transaction/rollback; retention policy và side effects; backup/WAL/SHM; production file permissions. Không chạy trên DB production trong kiểm thử.
6. **Phase 9.7 - E2E/release gate:** kiểm thử staging với DB cô lập cho tạo đơn → result/barcode/QR, Admin CRUD, inventory, refresh trực tiếp các route, service worker, network errors, console, build/deploy artifact và rollback; chỉ deploy sau xác nhận riêng.

## I. Kết luận

- **Tương thích ở source:** toàn bộ đường dẫn API React đã rà thấy route Express tương ứng; body/shape/status khớp ở mức code. Không thấy React caller trỏ tới API không tồn tại.
- **Chưa tương thích ở cách phục vụ hiện tại:** Express và workflow deploy hiện phục vụ/khởi chạy legacy app, không phục vụ React build. Đây là chặn tích hợp production chính.
- **React chưa có parity toàn bộ Admin legacy:** một số API có caller legacy hoặc không có caller repository; các màn chi tiết lịch sử/account/anonymous chưa có trong React.
- **Chưa xác minh:** API chạy thực tế, Nginx/proxy/VPS, origin/cookie trên production, DB path override/schema/data, caller ngoài repository, và thiết bị/browser thực tế.
- **Điều kiện trước tích hợp:** chốt hosting route; dùng staging + isolated DB cho contract/runtime tests; xác nhận role policy Kiểm kê, retention/migration/backup; test toàn bộ luồng và refresh URL trực tiếp.
- Phase 9.1 chỉ tạo báo cáo này. Không thay đổi backend, frontend, API, database, quyền, session, legacy code hay deployment; không có INSERT/UPDATE/DELETE/migration/request API nào được chạy. Dừng tại đây để chờ xác nhận trước Phase 9.2.
