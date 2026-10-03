# Hướng dẫn bootstrap VPS VTP

Tài liệu này là checklist có bước xác minh trước khi thay đổi. Các lệnh kiểm kê chỉ đọc có thể chạy để thu thập facts; không chạy lệnh bootstrap/restart/reload/cutover bên dưới nếu chưa có phê duyệt và maintenance window. Live inventory ngày 2026-10-03 được ghi trong phần dưới; các thay đổi vẫn chưa được áp dụng lên VPS.

## Phase 10.4: Kiểm kê trước bootstrap

`ops/vps-inventory.sh` có hai chế độ chỉ đọc. Script không cài package, restart/reload service, sửa unit/Nginx, chạm SQLite, đổi quyền, hoặc thay `current`. `--check` đối chiếu cấu hình với các gate của deployment helper; lệnh sudo chỉ liệt kê quyền bằng `sudo -n -l`, không chạy systemctl.

Chạy trên VPS từ terminal/quy trình quản trị đã được phê duyệt, dưới tài khoản dự kiến dùng làm GitHub `VPS_USER`. Bản inventory được chép tạm vào `/tmp/vps-inventory-vtp-3001.sh`; nó không thuộc ứng dụng và không ghi vào app root/release.

```sh
export VTP_DEPLOY_USER="$(id -un)"
bash /approved/temp/path/vps-inventory.sh --read-only
bash /approved/temp/path/vps-inventory.sh --check
```

Nếu tài khoản hiện tại không phải GitHub `VPS_USER`, chỉ đặt `VTP_DEPLOY_USER` thành tên tài khoản đã xác nhận; chạy lại trực tiếp dưới tài khoản đó để kiểm tra filesystem/sudo thực tế. Không chạy dưới root thay cho deploy user. Có thể đặt `VTP_INVENTORY_ROOT` nếu app root thực tế khác `/var/www/vtp`, nhưng ghi nhận riêng việc đó là khác với workflow hiện tại.

`--read-only` thu thập OS, Node/npm, Nginx/systemd, cấu hình đã lọc, paths/owner/group/mode, PM2 process-name summary và trạng thái sudo. `--check` dùng `PASS`, `FAIL`, `CONFIRM`; exit code khác 0 có nghĩa còn blocker hoặc mục chưa được operator xác nhận, không phải chỉ riêng lỗi kỹ thuật. Script không gọi `/healthz` để tránh tạo request/log; deployment helper sẽ kiểm tra health trong một rollout được duyệt.

Để gửi kết quả đánh giá, chia sẻ stdout đầy đủ của cả hai chế độ cùng exit code và thời điểm kiểm kê qua kênh riêng được phép. Giữ nguyên các giá trị cần đối chiếu như service user/group, DB path, mode, unit, Nginx root/upstream và hostname; trước khi chia sẻ rà lại thông tin nội bộ không cần thiết. Script không đọc/in `.env`, giá trị secrets, SQLite content, private key hay các tham số `ExecStart`; đừng tự thêm `systemctl cat`, `env`, `printenv`, `cat .env`, `pm2 jlist` vào output gửi đi.

Phân loại: `PASS` là điều kiện cấu hình được script xác minh; `FAIL` là sai/thiếu so với gate repository; `CONFIRM` cần người vận hành xác nhận thủ công (ví dụ hostname/TLS/proxy chain, deploy identity hoặc nguồn credentials). Không có output VPS thì mọi cột “thực tế” trong [PHASE_10_4_VPS_INVENTORY_REPORT.md](PHASE_10_4_VPS_INVENTORY_REPORT.md) vẫn là **Chưa xác minh**. Bất kỳ `FAIL`/`CONFIRM` nào, đặc biệt service user hoặc DB path, đều chặn quyết định deploy cho tới khi xử lý và đánh giá lại.

## Bootstrap chỉ sau xác nhận rõ ràng

Trước mọi thay đổi, cần có output inventory đã review, service user/group và **DB path thực tế** được chủ hệ thống xác nhận, backup/rollback plan, hostname/TLS/proxy được chốt, deploy user khớp GitHub `VPS_USER`, quyền filesystem/sudo được kiểm tra. Nếu tồn tại cấu hình cũ, lưu bản sao theo quy trình vận hành trước khi thay. Không chạy lệnh tổng quát `chown -R`, không cài đặt đè unit/Nginx hiện có, không tạo/di chuyển SQLite/WAL/SHM và không đổi `current` trong phase kiểm kê.

Các lệnh dưới đây là ví dụ thao tác có tác dụng; **chỉ operator chạy sau khi người dùng/chủ VPS xác nhận từng thay đổi và đã điền đúng paths đã inventory**. Chúng chưa được chạy trong Phase 10.4:

```sh
# Chỉ sau khi unit đã được điền, review và kiểm tra trên file tạm.
sudo systemd-analyze verify /approved/path/vtp.service

# Chỉ sau khi phê duyệt cài/thay unit và đã lưu cấu hình cũ nếu có.
sudo install -o root -g root -m 0644 /approved/path/vtp.service /etc/systemd/system/vtp.service
sudo systemctl daemon-reload

# Chỉ sau khi Nginx candidate đã review/backup và cài theo kế hoạch được duyệt.
sudo nginx -t
sudo systemctl reload nginx
```

Lệnh tạo thư mục chỉ được viết riêng cho các path đã xác nhận là **chưa tồn tại**; không áp dụng `install -d`/`chown` lên thư mục hiện hữu để “sửa cho khớp”. Tạo baseline release, cài dependencies và chuyển `current` là cutover riêng, cần phê duyệt riêng; không nằm trong Phase 10.4.

## Tham chiếu lệnh đọc thủ công (chỉ khi inventory cần bổ sung)

Các lệnh dưới đây vẫn chỉ đọc; không in toàn bộ systemd environment hoặc nội dung config ra nơi chia sẻ.

Đăng nhập bằng tài khoản vận hành được cấp sẵn, rồi ghi nhận nội bộ:

```sh
cat /etc/os-release
node --version
npm --version
command -v node npm
nginx -v
systemctl --version
sudo systemctl show vtp --property=User --property=Group --property=WorkingDirectory --property=ExecStart --property=EnvironmentFiles
sudo systemctl show vtp --property=Environment --value | tr ' ' '\n' | sed -n -E '/^(NODE_ENV|PORT|DATABASE_PATH|TRUST_PROXY_HOPS)=/p'
readlink -f /var/www/vtp/current
ss -ltnp
```

Lệnh lọc `Environment` chỉ in các key không phải credential; không in toàn bộ `systemctl cat`, environment, `.env`, private key hoặc GitHub Secret vào chat/log. Đọc trực tiếp nội bộ unit hiện tại nếu cần, nhưng che credential trước khi chia sẻ.

Kiểm tra đường dẫn và quyền mà không đọc nội dung DB:

```sh
namei -l /var/www/vtp/data/history.sqlite
stat -c '%U:%G %a %n' /var/www/vtp /var/www/vtp/data /var/www/vtp/data/history.sqlite
for f in /var/www/vtp/data/history.sqlite-wal /var/www/vtp/data/history.sqlite-shm; do
  if test -e "$f"; then stat -c '%U:%G %a %n' "$f"; fi
done
```

Xác nhận `DATABASE_PATH` thực tế từ systemd `Environment` (chỉ in key đó) và so với `.env` nếu file có khai báo. Helper yêu cầu đường dẫn tuyệt đối, hiện hữu, được khai báo rõ trong `Environment`; nếu dùng EnvironmentFile, chỉ chấp nhận đúng `/var/www/vtp/.env`. Các giá trị `NODE_ENV`, `PORT` hoặc `DATABASE_PATH` khai báo trong `.env` phải nhất quán với lần lượt `production`, `3001` và `/var/www/vtp/data/history.sqlite`, vì EnvironmentFile có thể ghi đè các giá trị `Environment=` khi systemd khởi chạy process. Đường dẫn DB phải nằm ngoài `releases/`.

Xác nhận Nginx worker user qua cấu hình đang dùng và trạng thái process. Đối chiếu document root, `server_name`, TLS termination, proxy chain, headers `/api/` và `/healthz`; không dùng Nginx mẫu thay cho việc kiểm kê cấu hình hoạt động.

**Dừng tại đây** nếu VPS đang dùng layout, service manager, DB path hoặc Nginx khác mà chưa có kế hoạch chuyển đổi được duyệt. Không `git pull`, không copy đè root, không `chown -R`, không di chuyển DB/WAL/SHM.

## VPS hiện trạng đã quan sát (2026-10-03)

Inventory read-only đã chạy trên host. Các giá trị secret không được hiển thị:

- systemd service `vtp` đang active; `User=deploy`, không khai báo `Group=` (primary group hiện tại của deploy là `deploy`); `WorkingDirectory=/var/www/vtp`; `ExecStart=/usr/bin/npm start`; có `EnvironmentFile=/var/www/vtp/.env`. Effective `NODE_ENV=production`; port VTP đang listen là `3001`. EnvironmentFile có `PORT`, không có `DATABASE_PATH`; code trong `/var/www/vtp` vì vậy resolve DB về `/var/www/vtp/data/history.sqlite` theo default. Path này tồn tại, nhưng giữ nguyên .env/unit backup trước thay đổi.
- `/var/www/vtp` hiện là cây ứng dụng flat do `deploy` sở hữu. Chưa có `current`, `releases/`, `backups/`, `ops/`, `scripts/`; không thể chạy helper production trực tiếp và helper từ chối first deploy nếu thiếu baseline `current`.
- `/var/www/vtp/data` là `deploy:deploy` mode `0775`; `history.sqlite`, `history.sqlite-wal`, `history.sqlite-shm` đều `deploy:deploy` mode `0644`. Các mode này không đạt deploy helper; DB và hai sidecar đang tồn tại, WAL khoảng 4 MB tại thời điểm kiểm tra. Không xóa, di chuyển hay copy riêng các file SQLite.
- `.env` tồn tại ở `/var/www/vtp/.env`, owner `deploy:deploy`, mode `0600`. Chỉ giữ nguyên; systemd hiện đọc file này và ứng dụng cũng dùng dotenv với `WorkingDirectory` hiện tại.
- Nginx VTP đang cấu hình domain `vtp.biloveg.io.vn`, TLS certificate/key tại `/etc/nginx/ssl/vtp/origin.pem` và `origin.key`, proxy toàn bộ `/` tới `127.0.0.1:3001`. Config TLS/domain đúng host; routing chưa phù hợp với release architecture sẽ serve `current/frontend/dist` tĩnh.
- Listener `*:3001` là VTP; listener `0.0.0.0:3000` là process Node khác, thuộc ứng dụng cần giữ nguyên (được xác định là IM theo thông tin vận hành). VTP hiện bind wildcard thay vì loopback; target production code phải bind `127.0.0.1:3001`. Deploy user `deploy` có NOPASSWD restart quyền `systemctl restart vtp`, và sở hữu app root.

### Kiểm tra lại sau lần deploy bị chặn (2026-10-03)

Một inventory chỉ đọc bổ sung xác nhận trạng thái hiện tại sau lần upload thất bại:

- VPS đang chạy Node.js `v22.23.3` và npm `10.9.9`; inventory gate của repo yêu cầu Node.js 24, nên cần quyết định rõ phiên bản runtime trước deploy.
- `current`, `releases/`, và `backups/` vẫn chưa tồn tại. Artifact `7e2e26f94498b2af8d84773b0d3928d82b159586` còn nguyên trong `incoming/` và một bản giải nén còn trong `staging/`; không xóa hoặc ghi đè chúng trong bước bootstrap.
- Cây live có các trang HTML/CSS/JS cũ ở app root nhưng không có `frontend/dist`. Bản staging đang giữ có `frontend/dist`, song package không chứa các HTML legacy ở app root; server trong artifact cũ vẫn có route `sendFile(__dirname/index.html)`.
- Nginx đang proxy toàn bộ VTP tới Express, không phục vụ `current/frontend/dist`. Source workspace đã được cập nhật để bản build mới phục vụ React entry/assets từ từng release qua Express; helper cũng kiểm tra `/` trước khi coi release khỏe. Artifact cũ đang ở `incoming/`/`staging/` chưa có thay đổi này và không được deploy lại.
- Mẫu Nginx dùng static assets với named `@app` fallback. Khi candidate có assets, Nginx phục vụ trực tiếp; khi rollback về snapshot legacy thiếu `frontend/dist`, request UI được proxy lại về Express cũ. Live Nginx chưa được chỉnh.
- `DATABASE_PATH` vẫn chưa được khai báo trong systemd; app hiện dùng default `/var/www/vtp/data/history.sqlite`. DB/WAL/SHM vẫn là `0644`, thư mục data là `0775`. Chưa đổi quyền hoặc đọc nội dung database.

### Đã chuẩn bị rollback baseline (2026-10-03)

Sau inventory bổ sung, các bước chuẩn bị an toàn sau đã được áp dụng trên VPS:

- Tạo online SQLite backup qua `better-sqlite3` Backup API, kiểm tra `integrity_check` và `foreign_key_check`: `/var/www/vtp/backups/history-precutover-20261003T064740Z.sqlite`, owner `deploy:deploy`, mode `0600`.
- Snapshot code/assets legacy từ app đang chạy thành `/var/www/vtp/releases/baseline-live-20261003-1`; `current` trỏ tới baseline này. Snapshot không chứa `.env` hoặc DB; `data/` trỏ về DB persistent và `node_modules` trỏ về bộ dependencies live.
- Đặt `/var/www/vtp/data` mode `0700`, DB và sidecars hiện hữu mode `0600`; owner vẫn `deploy:deploy`.
- Cài `/etc/systemd/system/vtp.service.d/95-vtp-release-helper.conf` với `.env` được giữ lại, runtime values tường minh và ExecStart tới `current/server.js`; `daemon-reload` đã chạy.

**Không restart VTP, không reload Nginx, không xóa/sửa archive hoặc staging, không thay đổi IM.** Service vẫn active bằng process cũ; cấu hình ExecStart mới sẽ được dùng ở lần restart kế tiếp. Source workspace có fix UI/health mới nhưng chưa được đóng gói vào artifact đang nằm trong `incoming/`/`staging/`. Cần đưa source đã sửa lên `main` qua quy trình được duyệt để tạo artifact mới; không deploy artifact cũ.

**Kết luận:** port/domain và dự đoán DB path đã khớp mục tiêu, nhưng deployment chưa sẵn sàng: thiếu baseline release/current, unit còn `EnvironmentFile`/`npm start`/thiếu `Group=`, Nginx chưa serve React release, và SQLite mode chưa đạt gate. Chưa có lệnh nào ở dưới được chạy.

## 2. User, group và quyền tối thiểu

`ops/vtp.service.example` dùng `User=deploy`, `Group=deploy` theo identity đã kiểm kê. Xác nhận lại trước khi thay unit; không tái sử dụng/chỉnh account có mục đích khác.

Sau khi chủ máy chọn service identity:

- Express chạy bằng user/group riêng, không phải root; unit phải khai báo cả `User` và `Group` tường minh.
- Service user sở hữu thư mục dữ liệu và DB; owner có read/write DB và read/write/execute thư mục để SQLite tạo/cập nhật WAL/SHM. DB và sidecars hiện hữu phải thuộc đúng service user/group.
- DB/sidecar cho phép group-read khi cần cho online backup, nhưng không group-write/execute hoặc bất kỳ quyền `other` nào; thư mục dữ liệu không group-write/other-access. Owner bits phải đủ cho service user. Helper kiểm tra các mode/owner này và thử backup bằng chính deploy identity.
- Deploy user cần quyền ghi `incoming`, `staging`, `releases` và thư mục backup riêng; cần quyền đọc DB/WAL/SHM để tạo online backup. Helper sẽ thử backup thật trước khi đổi symlink và abort nếu access không đủ.
- `.env` ở app root phải là regular file, không phải symlink; service user/group đọc được, group không ghi được, other không có quyền. Không đưa file này vào artifact.
- Nginx chỉ cần traverse thư mục release và đọc `frontend/dist`; không cấp quyền đọc `data/`, backup hay `.env` cho worker Nginx.
- Release code/assets cần quyền đọc/traverse cho service/Nginx; deploy user cần ghi vào khu vực release. Cấp quyền theo từng thư mục sau khi `stat`; không recursively đổi ownership toàn `/var/www/vtp`.
- Helper tạo `backups/` riêng với mode `0700`, do deploy user sở hữu; backup file đặt `0600`. Không tự dọn backup.

Nếu cần ACL/group membership để deploy user đọc SQLite nhưng không đọc secrets, thiết kế chúng riêng với quyền đọc cần thiết; không thêm deploy user vào group có thể đọc `.env` một cách vô tình. Backup preflight là gate cuối cho WAL/SHM access.

## 3. Persistent data và release layout

Mục tiêu sau bootstrap:

```text
/var/www/vtp/
  .env
  data/history.sqlite                 # persistent; giữ nguyên vị trí/nội dung đã xác minh
  current -> releases/<sha>-<run-id>-<run-attempt>
  releases/<release-id>/              # backend, frontend/dist, production node_modules
  staging/<release-id>/               # candidate trước activation
  incoming/                            # archive/checksum tạm
  backups/history-*.sqlite             # online backups đã kiểm tra
```

`data/` trong mỗi release là symlink tới `/var/www/vtp/data`; deploy helper yêu cầu DB path tuyệt đối khai báo trong systemd và xác nhận DB đã tồn tại. DB thiếu, nằm trong `releases/`, sai owner/mode, hay có sidecar không đúng quyền đều làm helper dừng trước activation. Không tạo DB rỗng, không copy trực tiếp một DB đang mở, và không rollback bằng cách phục hồi snapshot DB: rollback ứng dụng giữ nguyên dữ liệu phát sinh sau deploy.

Hiện chưa có `current` baseline được xác nhận. Deploy helper cố ý từ chối activation nếu chưa có symlink trỏ tới một release cũ còn tồn tại. Bootstrap lần đầu cần chuẩn bị một baseline release có frontend/backend cùng phiên bản, cài production dependencies, symlink `data/`, kiểm tra DB/config, rồi mới chuyển unit/Nginx sang `current`. Hãy giữ nguyên ứng dụng và DB hiện đang chạy cho tới khi baseline và rollback path được duyệt. Không đổi tên/xóa `/var/www/vtp` để dựng layout mới.

## 4. Environment và systemd

Yêu cầu helper/unit mẫu:

- `WorkingDirectory=/var/www/vtp` để `dotenv` đọc root `.env`.
- `ExecStart` gọi `/var/www/vtp/current/server.js`.
- `User`/`Group` non-root tường minh.
- `Environment=NODE_ENV=production`, `Environment=PORT=3001` và `Environment=DATABASE_PATH=/var/www/vtp/data/history.sqlite` tường minh. DB phải thực sự nằm tại path này; nếu inventory cho thấy path khác, dừng và lập kế hoạch bảo toàn dữ liệu riêng, không tự di chuyển.
- Chỉ dùng `EnvironmentFile=/var/www/vtp/.env` nếu cần; helper từ chối mọi path EnvironmentFile khác. Credentials ứng dụng để trong `.env` an toàn; không đưa secrets vào systemd output, workflow artifact hoặc log. Giá trị runtime trong `.env` phải nhất quán với các gate tường minh của unit.
- VTP bind `127.0.0.1:3001` để không đụng ứng dụng IM trên cổng `3000`; `ReadWritePaths` chỉ mở persistent DB directory cho service. Unit mẫu dùng `Restart=on-failure` và hardening cơ bản.
- Node executable phải được xác minh trên host. Unit mẫu dùng `/usr/bin/env node`; kiểm tra systemd `PATH` thực tế, hoặc thay bằng absolute path tìm thấy trên VPS.
- Không cấp thêm sudo cho workflow. Tài khoản hiện có phải qua được `sudo -n -l <systemctl-path> restart vtp`; deploy helper kiểm tra quyền này trước khi cài candidate.

Đối chiếu unit hiện tại và `ops/vtp.service.example`; không ghi đè unit đang dùng. Sau khi thay đổi được duyệt, lưu bản cũ, xác minh file mẫu/override bằng `systemd-analyze verify`, reload/restart chỉ trong cửa sổ thay đổi được chấp thuận. `systemd-analyze verify` không thay thế kiểm thử thực tế với user, filesystem và environment trên host.

## Chuyển cấu hình VTP sang release và cổng 3001

Repository hiện thống nhất VTP dùng `127.0.0.1:3001` và `DATABASE_PATH=/var/www/vtp/data/history.sqlite`. Cổng `3000` dành nguyên cho IM. Inventory ngày 2026-10-03 xác nhận file DB đó đang tồn tại, service identity là deploy, và Nginx VTP đã dùng domain/TLS đúng; effective DB path được resolve về file đó do không có override `DATABASE_PATH`.

Inventory hiện tại ở `/tmp/vps-inventory-vtp-3001.sh`; có thể chạy lại sau khi bootstrap dưới đúng deploy identity. `--check` sẽ báo các blocker còn lại:

```sh
VTP_DEPLOY_USER=deploy bash /tmp/vps-inventory-vtp-3001.sh --read-only
VTP_DEPLOY_USER=deploy bash /tmp/vps-inventory-vtp-3001.sh --check
```

Chỉ tiếp tục khi `/var/www/vtp/data/history.sqlite` đúng là database hiện hành. Không di chuyển DB khi chưa có kế hoạch migration riêng. Trước mọi thay đổi, tạo một bản sao lưu online mới bằng SQLite Backup API và xác minh bản sao; thao tác này không copy riêng WAL/SHM:

```sh
set -euo pipefail
umask 077
APP_ROOT=/var/www/vtp
DB="$APP_ROOT/data/history.sqlite"
BACKUP_DIR="/root/vtp-prebootstrap-$(date -u +%Y%m%dT%H%M%SZ)"
test -f "$DB"
command -v sqlite3 >/dev/null
mkdir -m 0700 "$BACKUP_DIR"
sqlite3 "$DB" ".backup '$BACKUP_DIR/history.sqlite'"
test "$(sqlite3 "$BACKUP_DIR/history.sqlite" 'PRAGMA integrity_check;')" = ok
if test -f "$APP_ROOT/.env"; then cp -a --no-clobber "$APP_ROOT/.env" "$BACKUP_DIR/.env"; fi
UNIT_FILE=$(systemctl show --property=FragmentPath --value vtp)
test -f "$UNIT_FILE"
cp -a --no-clobber "$UNIT_FILE" "$BACKUP_DIR/vtp.service"
NGINX_VTP_FILE=$(readlink -f /etc/nginx/sites-enabled/vtp.biloveg.io.vn)
test -f "$NGINX_VTP_FILE"
cp -a --no-clobber "$NGINX_VTP_FILE" "$BACKUP_DIR/nginx-vtp.conf"
```

Giữ backup `.env` và systemd unit chỉ đọc được bởi root; không gửi nội dung của chúng. Nếu thiếu `sqlite3`, dừng và dùng quy trình backup online đã được duyệt; không cài package hoặc dùng `cp` trên DB đang mở.

Sau khi backup integrity-check đạt và được duyệt, siết **chỉ metadata quyền** để thỏa preflight hiện tại; không đổi owner vì các file đã thuộc `deploy:deploy`:

```sh
chmod 0700 /var/www/vtp/data
chmod 0600 /var/www/vtp/data/history.sqlite
for f in /var/www/vtp/data/history.sqlite-wal /var/www/vtp/data/history.sqlite-shm; do
  if test -f "$f"; then chmod 0600 "$f"; fi
done
```

Lệnh này không xóa/di chuyển hay ghi nội dung SQLite/WAL/SHM. Chạy trong cửa sổ bảo trì đã duyệt; xác nhận lại bằng `stat` và inventory. Giữ nguyên `.env` hiện mode `0600`.

Baseline release phải được tạo từ đúng code đang chạy, có dependencies phù hợp, và chứa symlink `data -> /var/www/vtp/data`. **Không thể suy ra source baseline từ repo hoặc địa chỉ VPS**; lấy source/commit từ inventory và operator xác nhận trước khi copy. Release ID của workflow mới có dạng `<40-hex-sha>-<run-id>-<run-attempt>`; helper vẫn nhận release ID cũ `<40-hex-sha>-<run-id>` để tương thích. Không ghi đè thư mục release, `.env`, DB, WAL/SHM hay `current`; chỉ tạo `current` khi baseline hoàn chỉnh và đã có backup.

Sau khi baseline tồn tại, tạo drop-in cho đúng service hiện tại. Reset rồi khai báo lại duy nhất `EnvironmentFile=/var/www/vtp/.env`; credentials vẫn giữ trong `.env` tại app root và không bị copy vào unit. Helper xác nhận file regular/private, đồng thời tiếp tục đòi runtime keys tường minh trong `Environment`:

```ini
[Service]
WorkingDirectory=/var/www/vtp
User=deploy
Group=deploy
EnvironmentFile=
EnvironmentFile=/var/www/vtp/.env
ExecStart=
ExecStart=/usr/bin/env node /var/www/vtp/current/server.js
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=DATABASE_PATH=/var/www/vtp/data/history.sqlite
```

Áp dụng drop-in bằng `systemctl edit vtp`; không thay unit chính hoặc `.env`:

```sh
sudo systemctl edit --drop-in=95-vtp-release-helper.conf --stdin vtp <<'EOF'
[Service]
WorkingDirectory=/var/www/vtp
User=deploy
Group=deploy
EnvironmentFile=
EnvironmentFile=/var/www/vtp/.env
ExecStart=
ExecStart=/usr/bin/env node /var/www/vtp/current/server.js
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=DATABASE_PATH=/var/www/vtp/data/history.sqlite
EOF
sudo systemctl daemon-reload
```

Nếu drop-in `95-vtp-release-helper.conf` đã tồn tại, dừng và xem xét nội dung trước khi sửa; không ghi đè cấu hình khác.

Xác minh unit candidate và sau khi được duyệt mới áp dụng/restart VTP:

```sh
UNIT_FILE=$(systemctl show --property=FragmentPath --value vtp)
sudo systemd-analyze verify "$UNIT_FILE"
sudo systemctl daemon-reload
sudo systemctl restart vtp
curl --fail --silent --show-error http://127.0.0.1:3001/healthz
```

Nginx hiện proxy toàn bộ `/` tới Express. Sau khi baseline React release đã tồn tại, thay **chỉ** server block `vtp.biloveg.io.vn` bằng routing của `nginx/vtp.conf.example`: giữ nguyên listen/TLS/domain/cert paths hiện tại, serve `current/frontend/dist`, proxy `/api`, `/api/`, `/healthz` đến `127.0.0.1:3001`. Không chạm server block IM hoặc listener `3000`. Kiểm tra cấu hình rồi mới reload Nginx:

```sh
sudo nginx -t
sudo systemctl reload nginx
```

Không chạy các bước tạo baseline, đổi symlink, restart hoặc reload chỉ dựa trên mẫu này. Nếu inventory cho thấy database ở path khác, service không phải `vtp`, hoặc server block dùng chung với IM, dừng và xin duyệt kế hoạch cụ thể trước.

## 5. Nginx, port và TLS

`nginx/vtp.conf.example` dùng document root `/var/www/vtp/current/frontend/dist`, SPA fallback cho UI và proxy riêng `/api`, `/api/`, `/healthz` tới `127.0.0.1:3001`. Hashed assets được cache immutable; manifest/service worker có MIME/cache handling riêng. Bảo đảm worker user có traverse/read static files nhưng không thấy data/secrets. Không sửa server block/domain đang phục vụ IM.

Mẫu dùng domain và certificate paths đã quan sát cho VTP, nhưng vẫn phải so sánh file thật trước khi áp dụng. Chỉ cập nhật server block `vtp.biloveg.io.vn`, giữ nguyên TLS/domain; tuyệt đối không thay server block IM. Kiểm tra `ss -ltnp`: VTP `3001` chỉ loopback, còn IM `3000` không bị thay đổi; public traffic của VTP chỉ qua Nginx.

Express `trust proxy` vẫn là 0 nếu không cấu hình khác; Phase 10.3 không bật nó. Vẽ chuỗi client → Cloudflare/load balancer → Nginx → Express và xác nhận các proxy tin cậy/header overwrite. Chỉ cấu hình hop count phù hợp sau xác minh. Với cookie `Secure` trong production, kiểm thử login/session qua HTTPS sau khi TLS/proxy trust hoàn chỉnh; local HTTP smoke test không xác nhận hành vi này.

## 6. GitHub Actions và kiểm tra trước rollout

Workflow dùng các Secrets hiện có: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (SSH port mặc định 22). Xác nhận chúng tồn tại trong GitHub Settings → Secrets and variables → Actions mà không hiển thị giá trị. Không thêm secret cho DB path: path phải được xác minh và khai báo trong systemd `Environment`. Workflow tự deploy khi push `main`; không tạo push thử để kiểm tra production.

Sau bootstrap được duyệt, các gate trên host/local gồm:

```sh
systemd-analyze verify /tmp/vtp.service
sudo nginx -t
ss -ltnp
sudo -u deploy test -r /var/www/vtp/data/history.sqlite
sudo -u deploy test -w /var/www/vtp/data/history.sqlite
sudo -u deploy test -r /var/www/vtp/data
sudo -u deploy test -w /var/www/vtp/data
sudo -n -l "$(command -v systemctl)" restart vtp
```

Điều chỉnh user/group trong ví dụ theo kết quả inventory; port VTP là `3001` và DB path bắt buộc là `/var/www/vtp/data/history.sqlite`. Kiểm tra quyền mọi sidecar `history.sqlite-wal`/`history.sqlite-shm` nếu tồn tại và xác minh deploy user có thể tạo backup online; không `cat`, `cp` riêng WAL/SHM. Trước rollout, phải có release cũ healthy, backup verified, và frontend/backend cùng artifact SHA.

Sau khi có phê duyệt triển khai: workflow stage dependency/artifact, backup SQLite, atomic switch, restart systemd rồi gọi health endpoint. Nếu restart/health lỗi, helper đổi `current` về release cũ và thử restart/health lần nữa. Nếu recovery restart cũng thất bại, giữ pointer cũ và xử lý sự cố thủ công; không xóa release/backup. Manual rollback:

```sh
bash /var/www/vtp/current/ops/deploy-release.sh rollback <release-id> /var/www/vtp
```

Rollback chỉ đổi frontend/backend; không phục hồi backup DB và do đó giữ lại các bản ghi mới phát sinh sau deploy. Không tự động prune releases hoặc backups.