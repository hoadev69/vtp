# PHASE 9.2 - AUTHENTICATION & AUTHORIZATION INTEGRATION

Ngày: 2026-10-03

## 1. File thay đổi

Các file frontend được chỉnh:

- [`frontend/src/shared/components/AppShell.jsx`](frontend/src/shared/components/AppShell.jsx)
- [`frontend/src/features/admin/AdminPage.jsx`](frontend/src/features/admin/AdminPage.jsx)
- [`frontend/src/features/admin/OrderManagementPage.jsx`](frontend/src/features/admin/OrderManagementPage.jsx)
- [`frontend/src/features/inventory/InventoryPage.jsx`](frontend/src/features/inventory/InventoryPage.jsx)

Báo cáo này là file mới. Không sửa Express, API contract, database/schema, dữ liệu tài khoản, cookie/session config, deploy hoặc legacy code. `.vscode/settings.json` có thay đổi trong worktree nhưng không thuộc Phase 9.2 và không bị chỉnh sửa trong quá trình này.

## 2. Đối chiếu Phase 9.1 và vấn đề phát hiện

- Phase 9.1 xác nhận client gọi API bằng URL tương đối `/api/...` và `credentials: 'same-origin'`. `apiRequest` không lưu mật khẩu/session vào storage; không cần thay đổi client hay tạo token mới.
- Source Express hiện có các API đăng nhập, session probe, logout. `POST /api/login` xác thực role `admin`; `POST /api/kiemke/login` xác thực role `operator`; `requireAdmin` từ chối guest bằng `401` và role khác bằng `403`; `/api/logout` dùng session chung. Đây là xác minh source, không phải request live.
- Phase 9.1 ghi nhận `requireInventoryUser` hiện chấp nhận Admin có Express session hợp lệ. Source `getInventoryUser()` xác nhận hành vi này. Phase 9.2 giữ nguyên policy hiện có, không đổi phân quyền backend.
- `InventoryPage` trước đây chỉ chuyển màn hình cục bộ khi `/api/kiemke/me` trả `401`, khiến `AppShell` có thể tiếp tục hiển thị identity/menu Admin cũ. Đã đồng bộ 401 thành auth-change Guest và hiện thông báo phiên hết hạn.
- Admin management helper chuyển 403 với trạng thái `forbidden`, nhưng `AdminPage` trước đây bỏ qua tham số và phát sự kiện Guest; dashboard tổng quan cũng chỉ xử lý 401. Đã phân biệt: 401 xóa identity, 403 recheck role rồi hiển thị trạng thái không đủ quyền. Recheck được khóa để các request song song không khởi chạy nhiều lần.
- Callback `retryAuth`/xử lý quyền trước đây thay đổi identity mỗi lần render, có thể khiến effect phụ thuộc callback tải lại không cần thiết. Đã ổn định callback bằng `useCallback`.
- Form Admin và Operator dựa vào trạng thái disabled của nút nhưng không có chốt đồng bộ chống submit nhanh liên tiếp. Đã thêm guard bằng `useRef` ở cả hai luồng.
- `OrderManagementPage` coi 401 từ `POST /api/history` (route public theo source) là phiên Admin hết hạn. Đã giữ lỗi tại thao tác tạo lại tem, không xóa auth state dựa trên API công khai.

## 3. Luồng sau tích hợp

| Trạng thái | Xác minh và hiển thị React | Quyền backend theo source |
|---|---|---|
| Guest | AppShell thử `/api/admin/me`, sau 401/403 thử `/api/kiemke/me`. Chỉ 401/403 ở cả hai mới thành Guest; 500/network thành `error`. `/admin` hiện form đăng nhập, `/kiemke` hiện form đăng nhập; nội dung dashboard/kiểm kê không render lúc `checking`. Trang chủ vẫn công khai. | Admin API cần Admin; inventory API cần phiên theo middleware hiện có. |
| Operator | AppShell nhận 403 ở Admin probe rồi xác minh `/api/kiemke/me`; `/admin` hiển thị forbidden, `/kiemke` hiển thị workspace. | `requireAdmin` trả 403 cho Operator; Inventory login chỉ xác thực role `operator`. |
| Admin | `/api/admin/me` xác nhận Admin; `/admin` hiển thị dashboard. `/kiemke` xác minh bằng `/api/kiemke/me` và được phép theo source hiện tại. | Admin API tiếp tục được middleware bảo vệ. Admin được phép dùng inventory theo source hiện có; không thay đổi policy. |
| Phiên hết hạn | Protected 401 xóa identity phía React. Auth probe 500/network vẫn là `error`, không bị phân loại nhầm thành Guest. | Session validity và thu hồi vẫn do backend quyết định. |
| Đã xác thực nhưng bị từ chối | Protected Admin 403 kích hoạt một lần recheck; UI chuyển sang forbidden, không giả vờ đăng xuất. Inventory probe 403 giữ trạng thái forbidden. | Backend tiếp tục là lớp quyết định quyền; không thay đổi middleware. |

Đăng xuất React tiếp tục gọi `POST /api/logout`; khi thành công hoặc session đã hết hạn (`401`), frontend xóa auth state và về trang chủ. Không thêm cookie/token persistence.

## 4. Kết quả kiểm thử

Các browser checks chạy trên Vite production preview với API được mock trong Playwright. Không request nào tới Express hoặc SQLite thật.

| Tình huống | Kết quả |
|---|---|
| Guest mở `/` | PASS - trang tạo đơn công khai render. |
| Guest tải trực tiếp `/admin` | PASS - chỉ thấy form login, không thấy dashboard. |
| Guest tải trực tiếp `/kiemke` | PASS - chỉ thấy form login. |
| Operator tải trực tiếp `/admin` | PASS - forbidden, không render dashboard. |
| Operator tải trực tiếp `/kiemke` | PASS - workspace Kiểm kê render. |
| Admin tải trực tiếp `/admin` và `/kiemke` | PASS - dashboard và workspace tương ứng render. |
| `/api/kiemke/me` trả 401 khi UI trước đó nhận diện Admin | PASS - identity/menu Admin bị xóa, hiện login. |
| API Admin trả 403 khi dashboard đang mở | PASS - hiện forbidden và chỉ recheck role một lần. |
| Auth probe trả 500 | PASS - hiện lỗi xác minh; không chuyển thành Guest và không gọi probe Operator tiếp. |
| Admin API sau đăng nhập trả 401 | PASS - dashboard bị gỡ và trở về form login. |
| Submit liên tiếp login Admin/Operator | PASS - mỗi form chỉ gửi một request đăng nhập. |
| Logout Admin/Operator | PASS - gọi common logout, xóa identity và về trang chủ. |
| Back sau logout Admin | PASS - quay lại URL `/admin` chỉ hiện login, không khôi phục dashboard. |
| `npm run build` | PASS - Vite build production thành công. |
| Kiểm tra lỗi editor và `git diff --check` | PASS - không có lỗi file hoặc whitespace mới. |

Có 15 browser-preview assertions thành công. Đây là kiểm tra React state/UI với response mock; **không** xác nhận cookie, session store hay middleware đang hoạt động thực tế. Dev preview ban đầu có thêm auth probe do React StrictMode; số lần request trong production-preview được dùng để kiểm tra chống lặp.

## 5. Mức độ xác minh API/session

### Xác minh qua source

- `POST /api/login`, `GET /api/admin/me`, `POST /api/kiemke/login`, `GET /api/kiemke/me` và `POST /api/logout` tồn tại; request/response và auth branches được đọc trong `server.js` và đối chiếu với React.
- `requireAdmin` trả 401 khi không có active session và 403 khi role không phải Admin.
- Inventory middleware hiện cho phép Admin session theo source. Common logout phá session và clear cookie theo source hiện tại.
- Cookie `HttpOnly`, `SameSite=Lax`, `Secure` theo `NODE_ENV`, session expiry và credentials mode không bị thay đổi trong phase.

### Xác minh bằng mock

- React hiển thị đúng các nhánh 401/403/500, switch role, login, logout, URL trực tiếp và Back sau logout.
- Số request đăng nhập lặp được đếm ở phía mock; test 403 dashboard đếm số lần recheck.

### Chưa xác minh runtime

- Không gọi backend thật, không kiểm tra cookie/session ID trong browser với Express, không test session expiry thật hoặc cookie không hợp lệ trên session store.
- Không xác minh route API bị từ chối bằng HTTP thực tế; điều đó mới được xác minh từ middleware source, còn browser 403 là mock.
- Không kiểm tra VPS, reverse proxy hay hành vi server production.

## 6. Backend và rủi ro còn lại

1. **Chặn tích hợp production:** theo Phase 9.1, Express hiện trả HTML legacy tại `/`, `/admin`, `/kiemke`; deploy workflow không build/serve React `dist`. Các browser checks trên Vite preview chỉ kiểm tra React shell, không sửa hoặc chứng minh đường đi production. Cần xử lý hosting/routing ở phase được duyệt riêng.
2. **Session hết hạn khi không có request:** frontend cập nhật auth khi protected API trả 401 hoặc người dùng thử lại; không có heartbeat/polling mới được thêm. Khi người dùng idle, UI có thể giữ identity hiển thị cho đến request tiếp theo; backend vẫn từ chối API protected.
3. **Policy Admin–Kiểm kê:** source hiện cho Admin truy cập `/api/kiemke/me` và nghiệp vụ Kiểm kê. Giữ nguyên như yêu cầu; tài liệu nghiệp vụ cần tiếp tục xác nhận policy này.
4. **Backend thực tế:** DB path, cookie qua proxy, session store, expiry và 401/403/500 trên runtime vẫn chưa được thử. Không được suy ra từ mock.
5. **Console:** build/editor checks đạt; browser suite không thu thập toàn bộ console warning/error có chủ đích, nên không kết luận console production hoàn toàn sạch.

Không phát hiện yêu cầu sửa backend trong phạm vi Phase 9.2. Các vấn đề hosting/runtime được ghi nhận, không sửa vì ngoài phạm vi cho phép.

## 7. Kết luận

Phase 9.2 hoàn tất phần **React auth-state integration** ở mức source/build/production-preview mock: Guest, Operator và Admin được phân biệt; 401 xóa auth state; 403 không bị đánh đồng với Guest; 500/network giữ trạng thái không xác định; login lặp bị chặn; logout không để lại identity UI cũ.

Chưa thể tuyên bố tích hợp auth end-to-end với Express/VPS đã hoàn tất: backend không được gọi trong test và Express hiện vẫn phục vụ legacy HTML theo Phase 9.1. Không thay đổi API, middleware, database/schema, tài khoản, cookie/session config, quyền nghiệp vụ, legacy code hoặc deploy. Dừng tại Phase 9.2 để chờ xác nhận trước phase tiếp theo.
