# PHASE 0 — VTP Project Audit

## 1. Tổng quan dự án

Repository hiện là ứng dụng Node.js/Express phục vụ frontend HTML/CSS/JavaScript trực tiếp từ backend. Không có cấu trúc `client/server`; phần lớn file mã nguồn nằm ở thư mục gốc.

Frontend gồm luồng nhập dữ liệu tạo tem, trang kết quả/in tem A7, khu vực kiểm kê và dashboard quản trị. Backend lưu dữ liệu trong SQLite và cung cấp API cho các luồng này.

## 2. Cấu trúc repository

- Thư mục gốc: các trang `.html`, stylesheet `.css`, script `.js`, `server.js`, `database.js`, `session-store.js`, `package.json`, `package-lock.json`, README, cấu hình môi trường mẫu và SVG.
- `.github/workflows/`: workflow deploy.
- `.vscode/`: cấu hình workspace.
- `data/`: có `history.sqlite`, `history.sqlite-shm`, `history.sqlite-wal`. Nội dung database không được đọc hoặc thay đổi trong Phase này.
- `.git/` và `node_modules/` cũng hiện diện trong workspace.

Không thấy thư mục build frontend, `src/`, manifest PWA, service worker, thư mục ảnh/font riêng, cấu hình Vite hay cấu trúc React.

## 3. Danh sách trang và chức năng

| Trang | File nguồn | Chức năng và phụ thuộc chính |
|---|---|---|
| Trang nhập/tạo tem | [index.html](index.html), [home.css](home.css) | Chọn thành phố/huyện, xã, thôn; nhập mã vận đơn và các trường cấu hình từ API; gửi dữ liệu lưu history rồi chuyển sang kết quả. Script xử lý form và thao tác DOM nằm inline trong HTML. |
| Kết quả đơn/tem | [ketqua.html](ketqua.html), [ketqua.css](ketqua.css), [a7.svg](a7.svg) | Đọc giá trị từ query string, gọi API barcode và QR, hiển thị tem và gọi `window.print()`. Layout in đặt `105mm × 74mm`. |
| Kiểm kê | [kiemke.html](kiemke.html), [kiemke.js](kiemke.js), [kiemke.css](kiemke.css) | Đăng nhập operator, đọc mã từ clipboard, gửi mã vận đơn tạo QR, xem QR trong dialog và đăng xuất. Phụ thuộc Clipboard API, session và API kiểm kê. |
| Quản trị | [admin.html](admin.html), [admin.js](admin.js), [admin.css](admin.css) | Dashboard theo tab: lịch sử mã, tài khoản, UID/IP, địa bàn, trường nhập. Có tìm kiếm, phân trang, chỉnh sửa, xác nhận thao tác và nhiều dialog. Gần như toàn bộ nội dung quản trị nằm trong một HTML lớn. |
| Đăng nhập quản trị | [login.html](login.html), [login.js](login.js), [login.css](login.css) | Có trang đăng nhập riêng trong source. Tuy nhiên backend hiện chuyển `/login` sang `/admin`, và phần đăng nhập đang dùng trong dashboard là modal của `admin.html`; không thấy route backend phục vụ `login.html`. |
| Navigation dùng chung | [navigation.js](navigation.js) | Tạo liên kết điều hướng theo role, kiểm tra session, đổi sáng/tối qua `localStorage`, thêm nút xóa cho input động và cập nhật khoảng tránh bàn phím ảo. Được nạp ở các trang chính. |

## 4. Kiểm kê frontend

**Điểm vào và liên kết API:** `/` và `/index.html` trả về `index.html`; `/ketqua.html`, `/kiemke` và `/admin` có route riêng trong backend. CSS và JS được phục vụ qua danh sách route tĩnh chỉ định rõ, không thấy `express.static`.

**DOM trực tiếp:** `index.html` dùng `getElementById`, tạo option/input bằng `document.createElement` và gắn event listener; `ketqua.html` cập nhật tem trực tiếp từ URL; `admin.js` dựng và thay nội dung bảng bằng DOM API, đồng thời gắn nhiều listener; `kiemke.js` điều khiển panel và dialog trực tiếp; `navigation.js` tạo navigation, quan sát DOM bằng `MutationObserver`.

**Phụ thuộc backend:** geography và form fields được tải từ API; việc tạo tem ghi history trước khi chuyển trang; mã barcode/QR được tạo qua API. Admin cần API xác thực và CRUD. Kiểm kê yêu cầu đăng nhập operator, clipboard và API tạo QR. Đây không phải frontend tĩnh có thể chuyển hoàn toàn độc lập khỏi backend.

**Responsive có trong source:** home có breakpoint đến 768px; kiểm kê có breakpoint 480/760px và nút cố định có tính đến safe area, bàn phím ảo; Admin có các breakpoint 900/960/760/430px, chuyển một số bảng thành dạng card trên điện thoại. Một số bảng/dialog khác vẫn giữ `min-width` và cuộn ngang. Trang tem có CSS riêng thay đổi vị trí trên màn nhỏ, nhưng kích thước vật lý của tem vẫn cố định.

**Điểm cần lưu ý:** `ketqua.html` khai báo `user-scalable=no`; khả năng zoom hỗ trợ người dùng bị hạn chế. Đây là một rủi ro mobile/accessibility nhìn thấy từ source, không phải kết luận về trải nghiệm production.

## 5. Kiểm kê giao diện

- **Màu sắc:** token sáng chủ đạo xanh lá, nền xám xanh nhạt, surface trắng; có bộ token dark theme trong `home.css`. Navigation có màu thương hiệu xanh đậm và điểm nhấn đỏ.
- **Font:** dùng system stack `-apple-system`, `BlinkMacSystemFont`, `"Segoe UI"`, `system-ui`; tem dùng `"Times New Roman"`. Không thấy `@font-face` hoặc file font.
- **Logo/asset:** navigation hiển thị chữ “VTP”; chưa xác định được file logo độc lập. `a7.svg` được dùng làm nền tem. QR và barcode là ảnh được API sinh động, không phải asset tĩnh.
- **Header/navigation:** `navigation.js` dựng liên kết Trang chủ, Kiểm kê, và Quản trị theo role; có nút đổi theme và thông tin/đăng xuất khi phù hợp.
- **Form/button:** form nhập tem có select địa bàn, mã vận đơn và các trường động; button có trạng thái disabled. Kiểm kê có nút đọc clipboard. Admin có thao tác bảng, lọc, tìm kiếm và phân trang.
- **Modal/dialog:** dùng phần tử HTML `<dialog>` cho đăng nhập, xác nhận, tạo/sửa tài khoản, xem QR và các lịch sử liên quan.
- **Table/card:** Admin chủ yếu dùng bảng desktop; một số nhóm chuyển thành card-like rows trên màn nhỏ. Đây là cách trình bày theo CSS, không phải cấu trúc component riêng.
- **Print:** source quy định trang in 105 × 74 mm, lề 0, ẩn print controls/navigation và in nền. Kích thước, barcode, QR và vị trí nội dung là yêu cầu cần bảo toàn khi chuyển đổi.
- **Điều chưa thể xác minh:** giao diện đang chạy trên production, khác biệt so với source hiện tại, và mức độ chính xác của tem trên máy in thực tế. Source không đủ để xác nhận production là gì.

## 6. Kiểm kê backend

- **Runtime/framework:** Node.js; README yêu cầu Node.js 20 trở lên; Express 5.
- **Database/session:** SQLite qua `better-sqlite3`; schema, index, seed và các bước cập nhật schema nằm trong `database.js`. Session Express được lưu SQLite qua `session-store.js`.
- **Middleware/chính sách:** JSON body limit, trust proxy cấu hình bằng số hop, rate limit cho đăng nhập và tạo mã, chặn IP, gắn anonymous user/session cookie, xác thực admin/operator.
- **Nhóm API:** health check; login/logout admin và kiểm kê; tạo history tem, barcode, QR, tạo mã kiểm kê; geography và form fields công khai; admin CRUD địa bàn/trường nhập; history, mã đã tạo, mã kiểm kê, anonymous users, users/accounts, IP controls.
- **Nghiệp vụ:** lưu tem và snapshot trường form, quản lý địa chỉ phân cấp, quản lý role/trạng thái/mật khẩu tài khoản, lọc lịch sử, chặn IP, liên kết anonymous UID với session/IP. History mã được dọn theo retention ba ngày.
- **Phục vụ frontend:** backend gửi trực tiếp HTML qua các route trang và gửi CSS/JS/SVG qua whitelist route. Không thấy static middleware tổng quát hoặc route build output của Vite trong source hiện tại.

## 7. Kiểm kê dependencies

`package.json` khai báo dependencies runtime: `bcryptjs`, `better-sqlite3`, `bwip-js`, `dotenv`, `express`, `express-rate-limit`, `express-session`, `qrcode`. Dependency dev: `@playwright/test`.

Không thấy React, React DOM, Vite, router, thư viện component UI, export Excel hay export PDF được khai báo. Script npm duy nhất là `start`; không có script build, dev hoặc test trong `package.json`. `package-lock.json` khóa phiên bản cụ thể. Không cài đặt hoặc chạy dependency trong Phase này.

## 8. Khả năng tái sử dụng

- Các CSS token và thành phần nền tảng trong `home.css` có thể làm tham chiếu khi giữ lại màu, spacing, focus, dialog, tab và table styles. Tuy nhiên nhiều selector gắn với DOM hiện tại nên không thể coi là CSS component độc lập.
- `navigation.js` là hành vi dùng chung rõ ràng: điều hướng theo quyền, theme, clear-input và keyboard inset. Khi chuyển đổi cần giữ tương đương hành vi, không nhất thiết giữ nguyên cơ chế DOM.
- Form địa bàn và trường động của trang nhập có quan hệ chặt với API và query string của trang kết quả.
- Bảng lịch sử, quản lý tài khoản, dialog xác nhận và trạng thái lỗi có mẫu lặp lại trong Admin; đây là nơi có tiềm năng component hóa thực tế.
- CSS tem A7 và asset nền có phạm vi riêng; nên xem như yêu cầu đầu ra/in ấn độc lập với giao diện mobile app-like.
- Barcode/QR hiện được backend tạo. Không có bằng chứng trong source cho thấy cần chuyển phần sinh mã sang browser hoặc thay backend.

## 9. Rủi ro khi chuyển sang React

- Mất tương thích giữa form, payload lưu history và query string mà `ketqua.html` đang đọc.
- Thay đổi luồng authentication/session, cookie, role hoặc cách backend phục vụ file có thể làm hỏng các trang hiện hữu.
- Sai khác CSS hoặc cách tải asset có thể làm lệch tem khi in A7, dù giao diện màn hình trông đúng.
- Clipboard API phụ thuộc quyền và secure context; cần kiểm tra trên thiết bị/trình duyệt đích.
- Admin có nhiều tab, bộ lọc, phân trang, dialog và cập nhật bất đồng bộ; cần giữ trạng thái, xác nhận, lỗi và xử lý session hết hạn.
- Chuyển static serving sang asset build cần làm việc với cách triển khai hiện tại. Source hiện chỉ liệt kê một số đường dẫn tĩnh.
- Chưa có manifest/service worker trong repository; khả năng cài đặt, cache/offline và hành vi cập nhật PWA chưa được thể hiện trong source.
- Màn hình nhỏ có các cách responsive không đồng nhất giữa các bảng; cần kiểm tra trên thiết bị thật và dữ liệu dài.

## 10. Những vấn đề cần kiểm tra ở các Phase sau

1. Đối chiếu source hiện tại với giao diện VTP production được chủ dự án xác nhận; không dùng GitHub Pages cũ làm chuẩn.
2. Kiểm tra toàn bộ luồng nhập → lưu → kết quả → in và xác nhận tem trên máy in A7.
3. Kiểm thử API payload/status, đăng nhập, session hết hạn, role và khóa tài khoản trước/sau chuyển giao diện.
4. Kiểm tra Admin trên điện thoại với bảng rộng, nội dung dài, dialog, bàn phím và thao tác hàng loạt.
5. Xác minh yêu cầu PWA cụ thể: cài đặt, offline, cache, cập nhật, icon và phạm vi hỗ trợ thiết bị.
6. Xác minh quy trình phục vụ asset frontend build cùng workflow deploy hiện tại trước khi chọn cách tích hợp.

## 11. Thông tin chưa xác định

- Không truy cập/kiểm tra giao diện production; `CNAME` chứa `vtp.biloveg.io.vn` nhưng bản thân file không chứng minh domain hiện trỏ đến hệ thống nào.
- Workflow deploy cho biết push vào `main` sẽ SSH đến VPS, pull code, chạy `npm ci --omit=dev`, restart systemd service `vtp` và kiểm tra service. Secrets/host production không thể xác minh từ source.
- Không xác minh được nội dung database, dữ liệu thực tế hoặc trạng thái migration.
- Không thể xác nhận workflow GitHub Pages còn hoạt động hay chỉ là cấu hình cũ; hiện thấy workflow deploy VPS.
- Chưa có bằng chứng trong source về tính năng xuất Excel/PDF; chỉ thấy chức năng in tem bằng `window.print()`.
- Chưa xác minh trạng thái working tree ban đầu hoặc có thay đổi do người dùng khác hay không.

## 12. Trình tự chuyển đổi tham khảo từ source

1. Chốt ảnh chụp/giao diện production chuẩn, luồng nghiệp vụ và yêu cầu mobile/PWA trước khi coi source là chuẩn hình ảnh.
2. Lập contract cho route, API, session, payload form, query string, barcode/QR và print layout; giữ nguyên backend khi chưa có bằng chứng cần đổi.
3. Chuyển các hành vi dùng chung (điều hướng, theme, form controls) và xác nhận tương đương.
4. Chuyển luồng nhập và kết quả tem như một cặp, vì chúng chia sẻ dữ liệu qua API và URL; xác minh in A7 ở bước này.
5. Chuyển trang kiểm kê, đặc biệt đăng nhập, clipboard, QR và dialog.
6. Chuyển Admin theo các khu vực hiện hữu, giữ nguyên API và kiểm tra riêng quyền, lỗi, phân trang, lọc, chỉnh sửa và responsive.
7. Chỉ sau khi các luồng chính được xác nhận mới kiểm tra manifest, service worker, cache/offline và cài đặt PWA theo yêu cầu đã thống nhất.
