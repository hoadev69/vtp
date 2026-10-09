# BACKEND_COMPATIBILITY_REPORT.md

## 1. Phạm vi và phương pháp kiểm tra

Đây là báo cáo chỉ đọc source/configuration trong repository. Không đọc `.env`, không truy cập VPS, không chạy ứng dụng, không import `database.js`, không chạy migration và không truy vấn SQLite. Các thông tin production chỉ được nêu khi được cấu hình trong source/workflow; không suy luận giá trị secrets hoặc cấu hình máy chủ ngoài repository.

Đã đối chiếu `server.js`, `database.js`, `session-store.js`, `package.json`, `package-lock.json`, workflow deploy, cùng các HTML/JS có gọi API. Không tìm thấy cấu hình Nginx trong repository.

## 2. Kiến trúc backend hiện tại

- Backend entry point là `server.js`; npm có script `start: node server.js` ([package.json](package.json#L6-L8), [server.js](server.js#L1370)).
- Server dùng Express, middleware JSON giới hạn 16 KB, Express Session và rate limiter ([server.js](server.js#L51-L64)).
- `database.js` mở SQLite, tạo schema/index/seed và có các bước cập nhật schema khi module được load. Module này không được import hoặc chạy trong audit ([database.js](database.js#L1-L5), [database.js](database.js#L60-L72), [database.js](database.js#L240-L274)).
- SQLite mặc định đặt tại `data/history.sqlite`, có thể đổi bằng `DATABASE_PATH`; session được lưu trong cùng database qua `session-store.js` ([database.js](database.js#L5), [database.js](database.js#L52-L59), [session-store.js](session-store.js#L1-L18)).
- Backend phục vụ HTML và whitelist CSS/JS/SVG bằng `res.sendFile`; không thấy `express.static` ([server.js](server.js#L388-L415)).

## 3. Bảng API contract

Frontend hiện gọi URL tương đối `/api/...`. Bảng dưới chỉ mô tả endpoints có caller trong các file frontend được kiểm tra. Payload, response và status chỉ ghi nội dung có bằng chứng trực tiếp trong source.

### API công khai, tạo mã và đăng nhập

| Method và URL | Request/query từ frontend | Thành công | Quyền và lỗi thể hiện trong source |
|---|---|---|---|
| `GET /api/geography` | Không có | `200`: mảng địa bàn lồng district → communes → villages | Không cần đăng nhập; mục ẩn được lọc; chặn IP và ghi anonymous activity ([server.js](server.js#L617-L619)). |
| `GET /api/form-fields` | Không có | `200`: mảng trường `{ key, label, inputType, visible, defaultValue, sortOrder }` | Không cần đăng nhập; chặn IP và ghi anonymous activity ([server.js](server.js#L621-L623)). |
| `POST /api/history` | `{ barcode, chonHuyen, chonXa, chonThon, fields }` | `201`: `{ id, fields }` | Không yêu cầu tài khoản; ghi anonymous identity. `400` khi dữ liệu không hợp lệ; có chặn IP và rate limit ([index.html](index.html#L147-L159), [server.js](server.js#L513-L548)). |
| `GET /api/barcode?text=...` | Query `text` | `200`: ảnh PNG | `400` nếu text không hợp lệ/không tạo được; chặn IP, anonymous activity, rate limit ([ketqua.html](ketqua.html#L82-L83), [server.js](server.js#L580-L596)). |
| `GET /api/qrcode?text=...` | Query `text` | `200`: ảnh PNG | `400` nếu text không hợp lệ/không tạo được; chặn IP, anonymous activity, rate limit ([ketqua.html](ketqua.html#L82-L83), [server.js](server.js#L598-L608)). |
| `POST /api/login` | `{ username, password }` | `200`: `{ username }` | Admin login; `401` nếu thông tin sai hoặc user inactive; rate limit ([login.js](login.js#L10-L21), [server.js](server.js#L418-L430)). |
| `POST /api/logout` | Không có body | `204` | Cần authenticated user; `401` nếu chưa đăng nhập. Hủy session và xóa cookie ([navigation.js](navigation.js#L95-L105), [server.js](server.js#L432-L450)). |
| `GET /api/admin/me` | Không có | `200`: `{ username }` | Cần admin; `401` chưa đăng nhập, `403` sai quyền ([navigation.js](navigation.js#L115-L129), [server.js](server.js#L610-L615)). |
| `POST /api/kiemke/login` | `{ username, password }` | `200`: `{ id, username }` | Operator login; `401` sai thông tin; `403` tài khoản khóa trả `{ code, error, reason }`; rate limit và IP block ([kiemke.js](kiemke.js#L52-L72), [server.js](server.js#L456-L493)). |
| `GET /api/kiemke/me` | Không có | `200`: `{ id, username }` | Cần inventory user; middleware xử lý xác thực session ([kiemke.js](kiemke.js#L33-L44), [server.js](server.js#L452-L454)). |
| `POST /api/kiemke/logout` | Không có body | `204` | Cần inventory user; hủy session/token và xóa cookie ([kiemke.js](kiemke.js#L85-L88), [server.js](server.js#L495-L511)). |
| `POST /api/kiemke` | `{ waybill }` | `201`: `{ id, qrCode }` | Cần operator; `401` session không hợp lệ; `400` dữ liệu/QR không hợp lệ; chặn IP và rate limit ([kiemke.js](kiemke.js#L106-L121), [server.js](server.js#L551-L578)). |

### API Admin được frontend gọi

| Method và URL | Request/query hoặc body từ frontend | Thành công | Quyền/status |
|---|---|---|---|
| `GET /api/admin/history` | Query `page`, `search` | `200`: `{ rows, total, generatedCodeTotal, page, pages }` | Admin; phân trang 50 dòng ([admin.js](admin.js#L520-L522), [server.js](server.js#L848-L884)). |
| `GET /api/admin/users` | Query `page`, `search`, `role`, `status` | `200`: `{ rows, total, page, pages }`; mỗi row có thông tin user, số mã và lần hoạt động gần nhất | Admin; `400` nếu filter role/status sai ([admin.js](admin.js#L596-L603), [server.js](server.js#L1052-L1084)). |
| `GET /api/admin/inventory-accounts/:id/orders` | Query `page`, `from`, `to`, `timezoneOffset` | `200`: `{ rows, total, page, pages }`; row gồm waybill/IP/creator/time | Admin; lọc ngày và retention ([admin.js](admin.js#L719-L727), [server.js](server.js#L1198-L1252)). |
| `GET /api/admin/ips` | Không có | `200`: mảng IP, label, blocked, code_count, last_seen | Admin ([admin.js](admin.js#L771), [server.js](server.js#L1309-L1326)). |
| `GET /api/admin/ips/:ip/history` | Query `page` | `200`: `{ rows, total, page, pages }` | Admin; `400` nếu IP sai ([admin.js](admin.js#L465-L466), [server.js](server.js#L1328-L1348)). |
| `GET /api/admin/anonymous-users` | Query `page`, `search` | `200`: `{ rows, total, page, pages }` | Admin ([admin.js](admin.js#L853-L858), [server.js](server.js#L967-L1012)). |
| `GET /api/admin/geography` | Không có | `200`: cấu trúc địa bàn, bao gồm mục ẩn | Admin ([admin.js](admin.js#L1580), [server.js](server.js#L625-L627)). |
| `GET /api/admin/form-fields` | Không có | `200`: cùng cấu trúc form-fields công khai | Admin ([admin.js](admin.js#L2045), [server.js](server.js#L629-L631)). |
| `POST /api/admin/users` | `{ username, password, role }` | `201`: `{ id, username, role, active, created_at }` | Admin; `400` input sai, `409` username trùng ([admin.js](admin.js#L1148-L1155), [server.js](server.js#L1086-L1110)). |
| `PATCH /api/admin/users/:id/role` | `{ role }` | `204` | Admin; `400`, `404`, hoặc `409` khi tự đổi role/ảnh hưởng admin cuối cùng ([admin.js](admin.js#L1118-L1122), [server.js](server.js#L1115-L1135)). |
| `PATCH /api/admin/users/:id/status` | `{ active, reason? }` | `204` | Admin; khóa yêu cầu reason; có thể trả `400`, `404`, `409` ([admin.js](admin.js#L1189-L1193), [admin.js](admin.js#L1308-L1312), [server.js](server.js#L1137-L1159)). |
| `PUT /api/admin/users/:id/password` | `{ password }` | `204` | Admin; `400` password sai, `404` không tìm thấy user ([admin.js](admin.js#L1232-L1236), [server.js](server.js#L1161-L1174)). |
| `DELETE /api/admin/users/:id` | Không có body | `204` | Admin; `400` ID sai, `404` không tồn tại, `409` tự xóa hoặc xóa Admin hoạt động cuối cùng; thu hồi session và giữ lịch sử tạo mã. |
| `PUT /api/admin/ips` | `{ ip, label, blocked }` | `204` | Admin; `400` input sai ([admin.js](admin.js#L1407-L1415), [server.js](server.js#L1350-L1368)). |
| `PUT /api/admin/form-fields/:key` | `{ label, visible, defaultValue }` | `204` | Admin; `400` input sai, `404` field không tồn tại ([admin.js](admin.js#L220-L224), [server.js](server.js#L633-L652)). |
| `POST /api/admin/districts` | `{ name, kind }` (UI gửi `kind: "district"`) | `201`: `{ id }` | Admin; `400` input sai, `409` trùng tên ([admin.js](admin.js#L1939-L1940), [server.js](server.js#L654-L671)). |
| `PUT /api/admin/districts/:id` | `{ name, kind }` | `204` | Admin; `400`, `404`, `409` ([server.js](server.js#L673-L691)). |
| `DELETE /api/admin/districts/:id` | Không có body | `204` | Admin; `400` ID sai, `404` không tồn tại ([server.js](server.js#L693-L699)). |
| `PATCH /api/admin/districts/:id/visibility` | `{ hidden }` | `204` | Admin; `400` hoặc `404` ([admin.js](admin.js#L2014-L2026), [server.js](server.js#L756-L766)). |
| `POST /api/admin/communes` | `{ name, districtId }` | `201`: `{ id }` | Admin; `400`, `404` parent không tồn tại, `409` trùng ([admin.js](admin.js#L1942-L1943), [server.js](server.js#L701-L722)). |
| `PUT /api/admin/communes/:id` | `{ name, districtId }` | `204` | Admin; `400`, `404`, `409` ([server.js](server.js#L724-L746)). |
| `DELETE /api/admin/communes/:id` | Không có body | `204` | Admin; `400` hoặc `404` ([server.js](server.js#L748-L754)). |
| `PATCH /api/admin/communes/:id/visibility` | `{ hidden }` | `204` | Admin; `400` hoặc `404` ([server.js](server.js#L768-L778)). |
| `POST /api/admin/villages` | `{ name, communeId }` | `201`: `{ id }` | Admin; `400`, `404` parent không tồn tại, `409` trùng ([admin.js](admin.js#L1945-L1947), [server.js](server.js#L780-L802)). |
| `PUT /api/admin/villages/:id` | `{ name, communeId }` | `204` | Admin; `400`, `404`, `409` ([server.js](server.js#L804-L826)). |
| `DELETE /api/admin/villages/:id` | Không có body | `204` | Admin; `400` hoặc `404` ([server.js](server.js#L828-L834)). |
| `PATCH /api/admin/villages/:id/visibility` | `{ hidden }` | `204` | Admin; `400` hoặc `404` ([server.js](server.js#L836-L846)). |

Các lời gọi admin dùng helper `api()`: đọc JSON trừ status `204`, phát hiện `401` trên `/api/admin/` và ném lỗi theo trường `error` ([admin.js](admin.js#L71-L83)).

### API chỉ tìm thấy trong backend, không thấy caller ở frontend đã kiểm tra

- `GET /api/admin/created-codes` ([server.js](server.js#L886)).
- `GET /api/admin/kiemke-history` ([server.js](server.js#L935)).
- `GET /api/admin/anonymous-users/:id` ([server.js](server.js#L1014)).
- `GET /api/admin/inventory-accounts` ([server.js](server.js#L1176)).
- `POST /api/admin/inventory-accounts` ([server.js](server.js#L1254)).
- `PATCH /api/admin/inventory-accounts/:id` ([server.js](server.js#L1277)).
- `PUT /api/admin/inventory-accounts/:id/password` ([server.js](server.js#L1294)).

Đây là phân loại theo các file frontend được rà soát; không kết luận rằng client bên ngoài repository không sử dụng các endpoint trên. Không bổ sung endpoint ngoài những route tìm thấy trong source.

## 4. Authentication và session

- Admin đăng nhập qua `POST /api/login`; frontend xác nhận session qua `/api/admin/me`. Khi chưa đăng nhập, Admin JS hiện modal login. Operator đăng nhập qua `/api/kiemke/login`; trang kiểm kê kiểm tra `/api/kiemke/me` ([admin.js](admin.js#L1048-L1069), [kiemke.js](kiemke.js#L25-L45), [server.js](server.js#L418-L430), [server.js](server.js#L452-L493)).
- `express-session` cookie có tên `vtp.sid`, `HttpOnly: true`, `SameSite: 'lax'`, `Secure` khi `NODE_ENV === 'production'`, `maxAge` 8 giờ ([server.js](server.js#L54-L65)).
- `Path` **không được đặt tường minh** trong object `cookie` của express-session. Cookie package/session middleware mặc định `Path=/` khi không chỉ định path; đây là giá trị mặc định, không phải cấu hình explicit trong source. Khi xóa cookie, logout lại truyền `path: '/'` một cách tường minh ([server.js](server.js#L438-L446), [server.js](server.js#L500-L508)).
- Inventory token cookie `vtp.kiemke.sid` được cấu hình riêng: `HttpOnly`, `SameSite=Lax`, `Secure` theo production, `Path=/`, thời hạn 8 giờ ([server.js](server.js#L485-L490)).
- Anonymous cookie `vtp.uid` có thời hạn một năm; `vtp.anon.sid` không khai báo `maxAge`. Cả hai dùng các option `HttpOnly`, `SameSite=Lax`, `Secure` theo production và `Path=/` từ `anonymousCookieOptions`; chúng dùng cho tracking, không phải đăng nhập ([server.js](server.js#L23-L28), [server.js](server.js#L193-L200)).
- SQLite session store đọc, ghi, xóa và dọn session hết hạn ([session-store.js](session-store.js#L1-L79)). Role được xác minh lại từ database qua middleware server, không chỉ tin giá trị role ở frontend ([server.js](server.js#L253-L310)).
- Frontend hiện dùng URL tương đối, cùng origin với API. Fetch cùng origin tự gửi cookie theo mặc định. Nếu triển khai React khác origin, phải xem xét credentials/CORS/cookie; source hiện tại không cấu hình cross-origin.
- `trust proxy` lấy từ `TRUST_PROXY_HOPS`, mặc định 0 ([server.js](server.js#L20-L21), [server.js](server.js#L51)). Giá trị triển khai thực tế chưa xác minh.

**Cùng origin:** cấu hình session hiện tại có thể dùng với React cùng origin mà không cần đổi auth/session, miễn browser giữ cookie và request gọi đúng host/scheme. Không có bằng chứng cần đổi cookie name hoặc session store.

**Bảo vệ app shell:** nếu Nginx trả React app shell tại `/admin` và `/kiemke`, việc ẩn màn hình hoặc route guard phía React chỉ là điều khiển hiển thị, không thay thế middleware xác thực API. React phải xác minh quyền qua `/api/admin/me` và `/api/kiemke/me` trước khi hiển thị nội dung tương ứng; mọi API vẫn phải dựa vào middleware `requireAdmin`/`requireInventoryUser` ở backend. Nếu không, app shell có thể tải cho người chưa đăng nhập nhưng dữ liệu/endpoint vẫn phải được bảo vệ tại server.

## 5. CORS, CSRF và bảo mật

- Không thấy CORS middleware/package hoặc thiết lập `Access-Control-*` trong `server.js`. Frontend hiện được backend phục vụ và gọi API bằng URL tương đối, tức mô hình cùng origin theo source ([server.js](server.js#L390-L415), [index.html](index.html#L97-L98)).
- Không thấy CSRF token/middleware. Cookie `SameSite=Lax` được cấu hình; không có bằng chứng về cơ chế CSRF token riêng.
- Có rate limit cho đăng nhập admin/operator và tạo mã; có IP block ở route công khai/generation và login kiểm kê ([server.js](server.js#L66-L98), [server.js](server.js#L418-L418), [server.js](server.js#L456-L456), [server.js](server.js#L513-L513)).
- Anonymous ID/session được tạo ngẫu nhiên; ID session anonymous lưu dạng hash. Middleware ghi nhận activity và IP ([server.js](server.js#L125-L150), [server.js](server.js#L152-L205)).
- API quản trị và kiểm kê kiểm tra quyền ở backend; status `401`/`403` được xác định tại middleware ([server.js](server.js#L292-L310)).
- Nếu React khác origin, source không cho thấy backend đã bật CORS hay cross-origin cookies. Không nên tắt bảo vệ hiện tại để xử lý lỗi tích hợp; cùng-origin proxy tránh nhu cầu CORS cho browser.
- Không đọc `.env`, token, password, private key hoặc GitHub Secrets.

## 6. Static files và Vite build compatibility

Backend hiện có route trang và assets tường minh:

- `/` và `/index.html` → `index.html`; `/ketqua.html` → `ketqua.html`.
- `/admin` → `admin.html`; chưa đăng nhập vẫn trả HTML với status `401`, role không phù hợp trả `403`.
- `/kiemke` → `kiemke.html`; `/login` redirect `/admin`.
- CSS/JS/SVG được gửi qua whitelist; không có static middleware tổng quát trong source ([server.js](server.js#L388-L415)).

**Route SPA:** `/`, `/admin`, `/kiemke`, `/ketqua.html`, `/login`, `/healthz` và `/api/*` đã có ý nghĩa trong Express hiện tại. Khi dùng React Router, cần quyết định lớp nào phục vụ route UI; SPA fallback không được bắt `/api/*` hoặc `/healthz`. Nếu app shell được Nginx trả trực tiếp tại `/admin` và `/kiemke`, middleware của Express cho page route không còn là lớp kiểm soát hiển thị chính; bảo vệ API vẫn bắt buộc ở backend.

**Nginx phục vụ React build:** Có thể để Nginx phục vụ `dist` và proxy `/api/` đến Express mà không đổi nghiệp vụ/API backend, nếu cấu hình cùng origin. Cần giữ đường dẫn API nguyên trạng, cấu hình fallback chỉ cho route UI, chuyển tiếp host/proto/IP phù hợp reverse proxy và giữ cookie cùng host. Không thấy cấu hình Nginx trong repository nên chưa xác minh khả năng cấu hình trên production.

**Express phục vụ React build:** Có thể phục vụ `dist` từ Express nhưng source chưa có `express.static` hoặc SPA fallback. Cần sửa Express để mount asset/fallback đúng thứ tự và loại trừ `/api/*` cùng `/healthz`; đây là thay đổi cách phục vụ frontend, không phải thay đổi nghiệp vụ API.

**Vite paths:** Nếu build được host tại root, URL API `/api/...` tiếp tục cùng origin. Nếu đặt dưới subpath, phải cấu hình Vite `base` cho asset và xử lý API base riêng; `base` không tự đổi các URL API bắt đầu bằng `/`. Refresh route React cần fallback của web server. Cần xác định route UI thay thế cho `/admin`, `/kiemke` và kết quả tem trước khi chuyển ([admin.html](admin.html#L7-L10), [kiemke.html](kiemke.html#L7-L11), [ketqua.html](ketqua.html#L7-L9)).

## 7. Deployment và môi trường

- Khởi động bằng `npm start` → `node server.js`; không có script build/dev/test trong `package.json` ([package.json](package.json#L6-L8)).
- Workflow deploy khi push `main` dùng SSH, pull code, chạy `npm ci --omit=dev`, restart systemd service `vtp` rồi kiểm tra service ([.github/workflows/deploy.yml](.github/workflows/deploy.yml#L1-L7), [.github/workflows/deploy.yml](.github/workflows/deploy.yml#L30-L40)).
- Workflow chứng minh lệnh systemd restart, nhưng không có unit file, Nginx config, DB path production, backup hoặc rollback. Không thấy PM2 config.
- Nếu thêm Vite build, quy trình hiện tại thiếu build step. Vite thường cần ở build stage; cần bổ sung bước tạo/phát hành artifact trước khi chỉ cài production dependencies, hoặc một build stage phù hợp. Cách triển khai cụ thể phụ thuộc phương án hosting đã chọn.
- `.gitignore` loại trừ `data/*.sqlite*`. `git pull` trong workflow không chứng minh dữ liệu production có persistent volume, backup hay rollback. Database mặc định và session cùng SQLite; cần bảo vệ DB/WAL/SHM và xác minh `DATABASE_PATH`/persistence trước khi đổi quy trình deploy.
- Không giả định VPS path, giá trị env hay production topology; các giá trị đó chưa được xác minh.

## 8. Những thành phần frontend cần giữ nguyên contract

- Geography: schema địa chỉ lồng district → commune → village và quy tắc lọc mục ẩn.
- Form fields: key/label/input type/visible/default/order; field ẩn dùng default phía server.
- Luồng tạo đơn: gửi `POST /api/history`, nhận `fields` đã chuẩn hóa rồi điều hướng với các giá trị trên query string ([index.html](index.html#L147-L162), [server.js](server.js#L513-L548)).
- Kết quả: query keys `barcode`, `chonHuyen`, `chonXa`, `chonThon` cùng field động; API barcode/QR ([ketqua.html](ketqua.html#L42-L83)).
- Auth: `/api/login`, `/api/admin/me`, `/api/logout`; inventory: `/api/kiemke/login`, `/api/kiemke/me`, `/api/kiemke/logout`. Không thay cookie/session hoặc quyền.
- Admin: giữ method/path/payload/status, lưu ý `204` không có JSON body và lỗi JSON dùng trường `error`.
- Kiểm kê: clipboard → `POST /api/kiemke` → nhận `qrCode` data URL.
- In: A7 `105mm × 74mm`, margin 0; giữ đúng kích thước nền, barcode, QR, vị trí và print CSS ([ketqua.css](ketqua.css#L198-L225)).

## 9. Rủi ro tương thích

- React khác origin hoặc request thiếu credentials có thể làm mất session; hiện backend không có bằng chứng bật CORS.
- URL API sai hoặc SPA fallback bắt `/api/*` có thể trả HTML thay vì JSON/PNG.
- Payload, tên field, cách đọc `204`, hoặc response mapping thay đổi có thể làm lỗi tạo tem, Admin hay đăng nhập.
- Client-side route guard không bảo vệ API; app shell tại `/admin` hoặc `/kiemke` không thay thế `requireAdmin`/`requireInventoryUser`. Phải kiểm tra `/api/admin/me` hoặc `/api/kiemke/me` trước khi hiển thị nội dung theo quyền và tiếp tục để backend kiểm tra mọi API.
- Nếu không kiểm tra session ban đầu hoặc xử lý sai `401`/`403`, giao diện có thể hiện sai quyền hoặc trông như bị đăng xuất liên tục.
- Barcode/QR có thể lỗi nếu query encoding/URL sai, route bị SPA fallback bắt, hoặc image API không cùng origin.
- Tạo đơn phải lưu history trước khi chuyển kết quả; bỏ POST sẽ thay đổi nghiệp vụ.
- CSS mới có thể làm sai in tem A7 dù giao diện màn hình đúng.
- Direct URL/refresh `/admin`, `/kiemke`, `/ketqua.html` có thể bị Express route hiện tại, Nginx hoặc thiếu SPA fallback xử lý khác nhau.
- Workflow hiện không build React; deploy có thể thiếu `dist` nếu chưa bổ sung build/artifact.

## 10. Phương án tích hợp đề xuất và lý do

Đánh giá hai hướng, chưa triển khai và chưa thay người dùng quyết định:

1. **Nginx phục vụ React build, proxy API sang Express:** nên được đánh giá trước nếu Nginx khả dụng trên môi trường thực tế. Có thể giữ cùng origin, tránh thay API/auth/database và tránh yêu cầu CORS cho browser. Cần cấu hình proxy, fallback route UI, build artifact và giữ API ngoài fallback.
2. **Express phục vụ `dist`:** có thể giữ một origin/server, nhưng phải bổ sung static serving và SPA fallback vào Express, loại trừ `/api/*` và `/healthz`.

Không tìm thấy Nginx config trong repository nên chưa thể chốt phương án nào deploy được trên production.

## 11. Những thay đổi backend thực sự cần thiết (nếu có)

- **Nghiệp vụ/API/database/auth/phân quyền:** chưa thấy thay đổi bắt buộc chỉ để React gọi API hiện tại cùng origin.
- **Build/deploy:** cần có bước build/phát hành Vite; workflow hiện tại không có bước này.
- **Nếu Nginx phục vụ `dist`:** có thể không cần sửa Express nếu Nginx proxy đúng API và giữ backend nguyên trạng. Cấu hình Nginx/workflow sẽ cần bổ sung, nhưng chưa thấy file Nginx hiện tại.
- **Nếu Express phục vụ `dist`:** cần sửa Express static serving/fallback, bảo đảm API/health không bị bắt nhầm.
- **Nếu khác origin:** cần đánh giá cấu hình CORS/credentials/cookie; source không chứng minh hỗ trợ hiện tại. Không có bằng chứng API nghiệp vụ bắt buộc phải sửa.

## 12. Những nội dung chưa thể xác minh

- Nginx có chạy trên production không; virtual host/proxy/fallback/origin thực tế.
- `DATABASE_PATH`, `TRUST_PROXY_HOPS`, `NODE_ENV` thực tế; `.env` và secrets không được đọc.
- systemd unit, persistence, backup/restore, rollback, deploy artifact và database production.
- Production UI, domain routing, trạng thái GitHub Pages và browser/device thực tế.
- Session sau reverse proxy, Clipboard API và kết quả in trên thiết bị/máy in A7.
- Endpoint backend không có caller trong các file frontend đã kiểm tra có được client ngoài repository sử dụng hay không.

## Kết luận

- **Có thể tích hợp React mà không đổi backend nghiệp vụ hay không?** Có, nếu giữ nguyên API contract và phục vụ frontend cùng origin với API. Việc phục vụ app shell tại `/admin` hoặc `/kiemke` không loại bỏ xác thực API; React cần kiểm tra `/api/admin/me` hoặc `/api/kiemke/me`, còn backend tiếp tục thực thi middleware quyền.
- **Cần thay đổi cấu hình nào?** Cần bổ sung bước build/phát hành React. Với Nginx, cấu hình static root, proxy `/api/` và fallback UI; với Express, bổ sung static serving/fallback có loại trừ API/health.
- **Có API nào bắt buộc phải sửa không?** Chưa thấy endpoint nào bắt buộc phải sửa dựa trên source đã kiểm tra.
- **Điều kiện trước Phase 1:** xác nhận production UI làm chuẩn; chọn/duyệt cách phục vụ build; xác minh origin, proxy và trust proxy; lập kiểm tra contract/auth; bảo vệ SQLite/session runtime khi deploy; kiểm tra tạo tem, kiểm kê, Admin, refresh URL trực tiếp và in A7.
