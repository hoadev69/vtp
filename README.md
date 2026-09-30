# VTP Label Generator

Ứng dụng Node.js tạo tem có barcode Code 128 và QR. Người dùng tạo mã không cần tài khoản; hệ thống lưu IP, nội dung mã, địa chỉ và thời điểm tạo trong SQLite.

## Chạy ứng dụng

1. Cài Node.js 20 trở lên.
2. Chạy `npm install`.
3. Sao chép `.env.example` thành `.env`.
4. Đặt `ADMIN_USERNAME`, `ADMIN_PASSWORD` (ít nhất 12 ký tự) và `SESSION_SECRET` (ít nhất 32 ký tự) trong `.env`. Có thể tạo secret bằng `openssl rand -hex 32`.
5. Chạy `npm start`, rồi mở `http://localhost:3000`.

Người dùng mở trang chủ để tạo mã không cần đăng nhập. Mở `/admin` để đăng nhập bằng thông tin trong `.env`; tại đây admin xem lịch sử, bấm tên gợi nhớ để mở IP tương ứng, bấm số lượt tạo để xem mã gần đây của IP đó, và bấm chỉ số IP chặn để lọc danh sách bị chặn. Từ lịch sử hoặc modal IP, chọn **Tạo lại** để xem tem trong modal rồi ghi nhận/in lại; snapshot các trường nhập được lưu cùng bản ghi mới. Admin cũng đặt nhãn/chặn IP, tạo/sửa/xóa/ẩn/hiện thành phố, huyện, xã. Nút **Sửa danh sách** bật chỉnh sửa hàng loạt và hiện form thêm địa bàn; **Lưu thay đổi** áp dụng các dòng đã đổi, **Hủy** hoàn nguyên thay đổi chưa lưu và **Thoát sửa** đóng chế độ chỉnh sửa. Admin có thể đổi tên bốn trường nhập liệu, ẩn trường và đặt giá trị mặc định; trường ẩn luôn dùng giá trị mặc định được kiểm tra phía server. Xóa thành phố/huyện sẽ xóa các xã trực thuộc; lịch sử tem cũ vẫn giữ nguyên địa chỉ đã ghi. IP bị chặn không thể mở trang tạo mã hoặc gọi API tạo mã. Mật khẩu admin được băm trước khi lưu.

Dữ liệu nằm trong `data/history.sqlite` và được giữ qua các lần khởi động. Bản ghi lịch sử cũ được giữ lại nhưng IP hiển thị là `unknown`, vì trước đây hệ thống chưa ghi nhận địa chỉ IP.

Có thể đặt `DATABASE_PATH` để dùng đường dẫn DB khác; trên nền tảng có ổ đĩa tạm thời, cần mount ổ đĩa bền vững và trỏ biến này vào đó. Sao lưu SQLite cùng các file `-wal`/`-shm` bằng công cụ SQLite phù hợp hoặc sau khi dừng ứng dụng. Phiên đăng nhập được lưu trong cùng DB và tự hết hạn sau 8 giờ. Giữ `SESSION_SECRET` ổn định giữa các lần triển khai để phiên hiện tại tiếp tục hợp lệ.

`/healthz` trả HTTP 200 khi ứng dụng truy vấn được SQLite và 503 khi DB không khả dụng. Đặt endpoint này làm health check của nền tảng triển khai. Đăng nhập bị giới hạn 10 lần sai trong 15 phút; các endpoint tạo/lưu mã bị giới hạn tổng cộng 120 yêu cầu mỗi phút trên mỗi IP.

Khi chạy sau reverse proxy, đặt `TRUST_PROXY_HOPS` bằng số proxy đáng tin cậy đứng trước Node server để Express ghi nhận đúng IP thật; không bật tin cậy proxy nếu chưa kiểm soát proxy đó. SQLite phù hợp cho một máy chủ/instance với ổ đĩa bền vững. Bộ đếm rate limit hiện nằm trong bộ nhớ tiến trình nên reset khi restart và không chia sẻ giữa các instance; triển khai nhiều instance cần hệ quản trị DB cùng store dùng chung cho session và rate limit thay vì các file SQLite cục bộ.