# VTuber Hub

Website tổng hợp VTuber (Node.js + Express, lưu JSON). **Không dùng và không cần API key** — dữ liệu YouTube lấy từ RSS/Atom và trang công khai, do backend fetch + cache.

## Chạy
```
npm install
cp .env.example .env      # điền ADMIN_USERNAME, ADMIN_PASSWORD (và SESSION_SECRET)
npm start                 # http://localhost:3000
npm test                  # kiểm thử logic (store, parser, cache, state, auth, Discord OAuth/account) - không cần mạng
```
Vào `/admin/login` → đăng nhập → **+ Thêm VTuber**.

## Trang
| Route | Nội dung |
|---|---|
| `/` | Hero, thống kê thật, nổi bật, danh sách, mới thêm/cập nhật, video mới nhất |
| `/vtubers` · `/clippers` | Tìm kiếm, lọc, sắp xếp; **phân trang 24 mục/trang** (`?page=N`, giữ nguyên khi tải lại/chia sẻ link) |
| `/fanart` · `/fanart/upload` | Thư viện Fan Art (chỉ ảnh đã duyệt, hiện avatar + username Discord của tác giả) · trang đăng / sửa Fan Art (`?edit=<id>`), **cần đăng nhập Discord**; mục *Fan Art của tôi* kèm trạng thái + lý do từ chối |
| `/forum` · `/forum/:id` | Forum dạng social feed: đăng bài (chữ + tối đa 4 ảnh), reaction 👍 ❤️ 😂 😮 😢 😡, bình luận. Khách chỉ xem bài đã duyệt; tab *Bài của tôi* thấy mọi trạng thái + lý do từ chối |
| `/users/:id` (`/profile/:id` chuyển hướng) | Profile công khai: avatar + username Discord, bài Forum và Fan Art **đã duyệt**. Bấm tên/avatar ở Forum, comment, Fan Art để mở. `/account` vẫn là trang quản lý tài khoản |
| `/contribute` | Đóng góp / chỉnh sửa nội dung (thêm VTuber mới, sửa thông tin, báo sai, góp ý) → gửi về **Discord webhook**, có **Cloudflare Turnstile** |
| `/news` · `/news/:id` | Tin tức (nhiều ảnh đính kèm) |
| `/vtuber/:slug` | Profile: avatar, mô tả, social, live, lịch live, video (Xem thêm). Slug lạ → 404 |
| `/account` | Tài khoản Discord (avatar, tên, Discord ID, vai trò, ngày tham gia, đăng xuất). Khách bị chuyển sang đăng nhập |
| `/auth/discord/login`, `/auth/discord/callback` | Bắt đầu / hoàn tất đăng nhập Discord OAuth2 |
| `/admin/login`, `/admin`, `/admin/vtubers/add`, `/admin/vtubers/:id/edit` | Admin: VTuber & Clipper (đăng nhập bằng username/password **hoặc** Discord Admin) |
| `/admin/forum` | Admin: **Bài viết + Fan Art**, tab Pending / Approved / Rejected; Approve, Reject (bắt buộc lý do), Delete; xóa comment vi phạm |
| `/admin/fanart` | Admin: duyệt / từ chối (kèm lý do) / gỡ / xóa Fan Art (trang cũ, vẫn dùng được) |
| `/admin/news`, `/admin/news/add`, `/admin/news/:id/edit` | Admin: đăng / sửa / ẩn / xóa tin (tối đa 4 ảnh/bài, upload qua imgbb) |

## Đăng nhập Discord + Tài khoản
Đăng nhập bằng Discord OAuth2 (scope `identify`: chỉ lấy id / username / avatar — **không** lấy email, **không** lưu token). Không dùng YouTube API key. Hệ thống Admin username/password cũ **vẫn hoạt động** như trước.

### Cài đặt
1. https://discord.com/developers/applications → *New Application* → **OAuth2** → thêm **Redirects** đúng bằng `DISCORD_REDIRECT_URI` (sai một ký tự là Discord từ chối).
2. Điền `.env` (xem `.env.example`):

| ENV | Ý nghĩa |
|---|---|
| `DISCORD_CLIENT_ID` | Client ID của ứng dụng Discord |
| `DISCORD_CLIENT_SECRET` | Client Secret — chỉ nằm ở server, không bao giờ gửi ra trình duyệt/log |
| `DISCORD_REDIRECT_URI` | Vd `http://localhost:3000/auth/discord/callback` (local) hoặc `https://ten-mien/auth/discord/callback` |
| `SESSION_SECRET` | Chuỗi ngẫu nhiên ≥16 ký tự. **Bắt buộc khi chạy thật** để phiên đăng nhập sống sau restart |
| `ADMIN_DISCORD_IDS` | Discord ID của Admin, cách nhau bằng dấu phẩy. Lấy ID: Discord → Cài đặt → Nâng cao → bật *Chế độ nhà phát triển* → chuột phải tên mình → *Sao chép ID* |

Thiếu/sai `DISCORD_*` → nút đăng nhập tự ẩn, `/auth/discord/login` báo "chưa bật" (server vẫn chạy). Khi đã có `ADMIN_DISCORD_IDS` + Discord OAuth, có thể bỏ `ADMIN_USERNAME/ADMIN_PASSWORD` để tắt hẳn đăng nhập admin bằng mật khẩu. Chạy HTTPS: đặt `COOKIE_SECURE=true` (và `TRUST_PROXY=true` nếu sau reverse proxy). Truy cập bằng đúng host đã khai trong `DISCORD_REDIRECT_URI` (đừng đăng nhập ở `127.0.0.1` nếu redirect là `localhost`, cookie sẽ không khớp).

### Vai trò
| Vai trò | Điều kiện | Quyền |
|---|---|---|
| **Guest** | chưa đăng nhập | xem nội dung công khai |
| **User** | đăng nhập Discord | + `/account`, mọi API dùng `requireAuth` |
| **Admin** | Discord ID nằm trong `ADMIN_DISCORD_IDS` (hoặc phiên admin username/password cũ) | + `/admin`, `/api/admin/*` |

Vai trò Admin **tính từ ENV mỗi request**, không lưu trong DB: xóa ID khỏi `ADMIN_DISCORD_IDS` + restart là mất quyền ngay.

### Dùng trong code
`middleware/auth.js` (dùng chung, không có hệ thống thứ hai): `attachUser` (gắn `req.user`, `req.role`), `requireAuth`, `requireAdmin`, `requireCsrf`. `requireAuthApi/requireAuthPage` cũ là alias của `requireAdmin` nên toàn bộ route Admin cũ tự nhận cả Admin Discord.
```js
const auth = require('../middleware/auth');
router.post('/favorite', auth.requireAuth, auth.requireCsrf, (req, res) => {
  const userId = req.user.id;   // Discord ID lấy từ session — KHÔNG đọc userId từ req.body/query
});
router.delete('/x', auth.requireAdmin, handler);
```
Client gọi API ghi cần header `X-CSRF-Token` (lấy từ `GET /api/auth/me` hoặc `/api/auth/account`).

### API
`GET /api/auth/me` (mọi vai trò: `loggedIn, role, discordEnabled, user, csrfToken`) · `GET /api/auth/account` (cần đăng nhập) · `POST /api/auth/logout` (cần `X-CSRF-Token`) · `GET /auth/discord/login[?next=/duong-dan-noi-bo]` · `GET /auth/discord/callback`.

### Lưu trữ (persist sau restart)
- `data/users.json`: `id` (Discord ID = `userId`), `username`, `avatar` (hash), `createdAt`, `updatedAt`. Ghi atomic, file hỏng thì báo lỗi và không ghi đè. Đã có trong `.gitignore`.
- `data/sessions.json`: session server-side (khóa là SHA-256 của session id, quyền file 0600) thay MemoryStore ⇒ **đăng nhập còn hiệu lực sau restart** (cần `SESSION_SECRET` cố định). Đã có trong `.gitignore`.
- Có thể đổi đường dẫn bằng `USERS_FILE`, `SESSIONS_FILE`. Lưu file phù hợp 1 instance; nhiều instance cần chuyển sang DB/Redis.

### Bảo mật
- OAuth `state` ngẫu nhiên 256-bit, gắn với session của chính trình duyệt, dùng **một lần**, hết hạn sau 10 phút, so sánh timing-safe (chống login CSRF). Callback validate chặt `code`/`state` (kiểu, độ dài, ký tự) trước khi gọi Discord.
- `next` chỉ nhận đường dẫn nội bộ (chặn open redirect). Session được **tạo mới sau đăng nhập** (chống session fixation); cookie `httpOnly`, `SameSite=Lax`, `Secure` khi HTTPS.
- Hết hạn: 3 ngày không hoạt động hoặc 14 ngày kể từ lúc đăng nhập; tối đa 5 phiên đồng thời/tài khoản (phiên cũ nhất bị xóa); tổng phiên tối đa `MAX_SESSIONS` (mặc định 5000); tài khoản bị xóa khỏi `users.json` ⇒ phiên mất hiệu lực.
- Rate limit: `/auth/*` 30 request/phút/IP; 10 lần callback lỗi/15 phút/IP; `/api/*` vẫn 120/phút/IP. Logout cần CSRF token + kiểm tra Origin.
- Token Discord được thu hồi ngay sau khi lấy profile và không được lưu. Secret không xuất hiện trong `public/` hay response.

## Tag "Tốt nghiệp"
Tick **Đã tốt nghiệp** trong form thêm/sửa VTuber (trường `graduated`, mặc định `false`; bản ghi cũ tự là `false`). VTuber tốt nghiệp hiển thị tag 🎓 *Tốt nghiệp*, thẻ/avatar/chữ **nhạt hơn**, luôn xếp sau các VTuber còn hoạt động (trừ khi mở tab **Tốt nghiệp** ở trang danh sách).

## Forum, Fan Art, Profile
Luồng: **Đăng nhập Discord → đăng bài / Fan Art → `pending` → Admin duyệt → public → hiện ở profile**. Bị `rejected` → tác giả sửa → `pending` → duyệt lại → public.

**Quy tắc (thực thi ở backend, không tin frontend)**
- `authorId` (và `username` của Fan Art) luôn lấy từ **session Discord**. Body gửi `authorId` / `username` / `status` / `rejectReason` / `reactions` / `id` bị bỏ qua. Admin/role luôn tính từ session, không từ client.
- Bài mới luôn `pending`. Sửa bài `approved` / `rejected` → `pending` lại và xóa `rejectReason`. Chỉ `approved` mới public, mới được reaction / comment.
- `status` + `rejectReason` chỉ trả cho **chủ bài** (và admin). Bài `pending`/`rejected` của người khác trả **404** (không lộ sự tồn tại); sửa/xóa bài `approved` của người khác trả 403.
- Mỗi user 1 reaction / bài (đổi hoặc bỏ được). API chỉ trả số đếm + reaction của chính người xem, không lộ ID người react.
- Comment chỉ trên bài `approved`; chỉ sửa/xóa comment của mình (kể cả chủ bài cũng không xóa được comment người khác; admin xóa được ở `/admin/forum`).
- Fan Art: hiển thị **username + avatar Discord hiện tại** (đổi tên Discord → tự cập nhật); `authorId` là Discord ID cố định. Ảnh cũ (không có `authorId`) vẫn hiển thị như cũ với tên tác giả cũ.
- Profile `/api/users/:id` chỉ trả id, username, avatar, ngày tham gia + nội dung `approved`. Không có role, session, token, secret hay dữ liệu quản trị.

**Chống lạm dụng**: mọi request ghi cần đăng nhập + `X-CSRF-Token` + cùng Origin; giới hạn theo **tài khoản** (đăng/sửa bài 10/giờ, comment 30/10 phút, reaction 60/phút, Fan Art 5/giờ); tối đa **10 bài / 10 Fan Art đang chờ duyệt** mỗi user; chặn đăng trùng nội dung liên tiếp; nội dung bỏ ký tự điều khiển/bidi, giới hạn độ dài (bài 5000, comment 1000, tiêu đề 80, mô tả 500); ảnh tối đa 4/bài, chỉ giữ URL đã có trong bài (không chèn URL tùy ý). Frontend chỉ render bằng text node (không `innerHTML`) + CSP nghiêm ngặt. Turnstile giờ là lớp **tùy chọn** (chỉ bật khi đã cấu hình `TURNSTILE_*`).

## Đóng góp → Discord
- Đặt `DISCORD_WEBHOOK_URL` trong `.env` (Discord → Cài đặt kênh → Tích hợp → Webhook). Dùng chung `TURNSTILE_SITE_KEY/SECRET_KEY` với Fan Art. URL webhook chỉ nằm ở server, không bao giờ gửi ra trình duyệt.
- Thiếu webhook hoặc captcha → form bị khóa (fail-closed). Server kiểm tra dữ liệu → xác minh captcha → gửi embed. Tối đa 5 đóng góp/giờ/IP. `@everyone`/mention trong nội dung bị vô hiệu hóa.
- Trang hồ sơ VTuber có nút **✎ Đề xuất chỉnh sửa** mở sẵn form với VTuber đó.
- API: `POST /api/contribute {kind: add|edit|remove|other, targetType, target, name, channel, content, link, sender, contact, captcha}`.

## Thêm VTuber
Nhập tên; ô **Kênh YouTube** nhận Channel ID (`UC…`), URL `youtube.com/channel/UC…` hoặc `@handle` — server tự resolve, kiểm tra kênh tồn tại, lấy avatar/video. Kênh sai → không lưu. Có thể để trống (VTuber chưa có YouTube). Avatar URL tùy chọn (ưu tiên hơn avatar YouTube). Slug tự sinh từ tên, sửa được.

## Schema `data/vtubers.json` (bản ghi cũ vẫn dùng được, tự chuẩn hóa)
`id, slug, name, youtubeChannelId, avatar, description, social{twitter,facebook,instagram,tiktok,twitch,discord,website}, enabled, createdAt, updatedAt`

## API
Public (`{success,data}`): `GET /api/vtubers` · `/api/stats` · `/api/videos/latest?limit=` · `/api/vtubers/:slug` · `/:slug/live|upcoming|videos`.
Danh sách/stats **chỉ đọc cache** (không gọi mạng, không sinh hàng trăm request); nền refresher cập nhật mỗi 60s. Trang chi tiết fetch khi cache hết hạn.
Khác: `GET /api/config` (site key Turnstile) · `GET /api/news?limit=` · `GET /api/news/:id`.
Forum (`/api/forum`, ghi = đăng nhập + CSRF): `GET /meta` · `GET /posts?page=&limit=` (chỉ approved) · `GET /posts/mine` · `GET /posts/:id` · `POST /posts {content, newImages[]}` · `PUT /posts/:id {content, images[] (URL giữ lại), newImages[]}` · `DELETE /posts/:id` · `POST|DELETE /posts/:id/reaction {emoji}` · `GET|POST /posts/:id/comments {content}` · `PUT|DELETE /comments/:id`.
Fan Art (ghi = đăng nhập + CSRF): `GET /api/fanart` (approved) · `GET /api/fanart/mine` · `POST /api/fanart {image(base64), title, description}` · `PUT /api/fanart/:id` · `DELETE /api/fanart/:id`. Profile: `GET /api/users/:id`.
Admin moderation (chỉ Admin): `GET /api/admin/forum/summary` · `GET /api/admin/forum/posts[?status=]` · `POST /api/admin/forum/posts/:id/status {status, reason}` (reason bắt buộc khi `rejected`) · `DELETE /api/admin/forum/posts/:id` · `GET /api/admin/forum/posts/:id/comments` · `DELETE /api/admin/forum/comments/:id`; Fan Art: `POST /api/admin/fanart/:id/status {status, reason}`.
Admin thêm: `GET /api/admin/fanart[?status=]` · `DELETE /api/admin/fanart/:id` · `GET|POST /api/admin/news` · `GET|PUT|DELETE /api/admin/news/:id` (body: `title, content, published, images[] (URL giữ lại), newImages[] (base64)`).
Admin (cần đăng nhập): `POST /api/admin/login|logout`, `GET /api/admin/me`, `GET|POST /api/admin/vtubers`, `GET|PUT|DELETE /api/admin/vtubers/:id`, `POST …/:id/toggle`, `POST …/:id/refresh`.

## Lỗi đăng nhập Admin – nguyên nhân đã sửa
- Cookie session bị đặt `Secure` cứng khi `NODE_ENV=production` → chạy `http://` thì trình duyệt bỏ cookie, đăng nhập "thành công" nhưng bị đá ra. Nay dùng `secure:'auto'`, `SameSite=Lax`.
- Kiểm tra Origin lỗi khi sau reverse proxy → chấp nhận thêm `X-Forwarded-Host`.
- Session được `save()` trước khi trả kết quả; `.env` được `trim`; thiếu `SESSION_SECRET` không còn làm server thoát.
- Trang login gọi `/api/admin/me` sau khi đăng nhập để xác nhận cookie thật sự được giữ và báo lỗi rõ ràng nếu không.

## Dữ liệu mới
`data/posts.json` (`id, authorId, content, images[], status, rejectReason, reactions{userId:emoji}, createdAt, updatedAt`), `data/comments.json` (`id, postId, authorId, content, createdAt, updatedAt`), `data/fanarts.json` (`id, authorId, username, image, thumb, title, description, status, rejectReason, createdAt, updatedAt`; tự đọc `data/fanart.json` cũ nếu chưa có file mới), `data/news.json` (`id, title, content, images[], published, createdAt, updatedAt`) — tự tạo khi có bản ghi đầu tiên. Ảnh cần `IMGBB_API_KEY`.

## Giới hạn
Live/upcoming/avatar đọc từ HTML công khai của YouTube — có thể đổi cấu trúc; khi đó trả `unknown`/rỗng và dùng cache cũ (sửa trong `services/youtube.js`). Session lưu file `data/sessions.json` (1 instance; nhiều instance cần Redis/DB). Avatar nhập bằng URL (chưa upload file).

## TOS + Community Rules + đồng ý khi đăng nhập

- Trang công khai (không cần đăng nhập): `/tos`, `/community-rules`. Link có ở footer, màn hình đăng nhập, trang Account và trang đăng nhập Admin.
- **Nội dung** nằm ở `data/legal.json` (API công khai `GET /api/legal`). Sửa file là đủ, không cần restart và không đụng code đăng nhập. Sửa xong nhớ đọc lại nội dung với luật/khu vực của bạn: đây là bản mẫu, không phải tư vấn pháp lý.
- **Tăng `termsVersion`** trong `legal.json` khi thay đổi quan trọng: mọi user chưa đồng ý đúng phiên bản đó sẽ bị chặn ở các thao tác ghi (đăng bài/comment/reaction/Fan Art, trang `/fanart/upload`; API trả `403 code=consent_required`) và được chuyển tới `/login?reconsent=1` để bấm xác nhận. Đọc/xem vẫn dùng bình thường. Muốn chỉ sửa chính tả mà không bắt xác nhận lại thì giữ nguyên `termsVersion`.
- **Luồng đăng nhập**: mọi nút "Đăng nhập" (`/auth/discord/login`) đều chuyển tới `/login` (màn hình consent). OAuth chỉ bắt đầu khi khách bấm nút "Đăng nhập bằng Discord" (`POST /api/auth/login`, kèm token dùng 1 lần gắn với session). Server tự ghi version + thời điểm vào session cùng `state` OAuth; callback thành công mới lưu vào `users.json`: `tosAcceptedAt`, `communityRulesAcceptedAt`, `termsVersion`. Frontend không gửi/quyết định các giá trị này. `state` OAuth, regenerate session, CSRF hiện có giữ nguyên.
- User đã đăng nhập từ trước (chưa có trường consent) vẫn xem được site, nhưng cần xác nhận một lần (`POST /api/auth/consent`, cần session + CSRF token) trước khi ghi nội dung.

## Admin Dashboard (Sidebar + Navbar)

`/admin` dung layout rieng: **Admin Sidebar** (Dashboard, Users, Moderation > Ban/Kick/Warn, Forum, Fan Art, Popup Announcements,
Marquee Announcements, VTuber & Clipper, Tin tuc; co active state, mobile thu/mo bang nut ☰) + **Admin Navbar** (avatar/ten Admin Discord,
chuong thong bao -> bai cho duyet, ve Website, dang xuat). Danh sach VTuber cu nam o `/admin/vtubers`; `/admin` la trang tong quan.

| Module | Trang | API (deu qua `requireAdmin`) |
|---|---|---|
| Users | `/admin/users` | `GET /api/admin/users?q=` (Discord ID hoac username), `GET /api/admin/users/:id` |
| Ban / Kick / Warn | `/admin/moderation/{ban,kick,warn}` | `POST /api/admin/users/:id/{ban,unban,kick,warn}`, `GET /api/admin/moderation?type=` |
| Popup | `/admin/popups` | CRUD + `POST /:id/toggle` tai `/api/admin/popups` |
| Marquee | `/admin/marquee` | CRUD + `POST /:id/toggle` tai `/api/admin/marquee` |
| Public | moi trang | `GET /api/announcements` (chi ban ghi active) |

Quy tac: `adminId` lay tu session (Discord ID; phien username/password cu ghi `legacy-admin`); ban kiem tra o `attachUser` moi request
(session moi khong bypass duoc; dang nhap OAuth cung bi chan); kick/ban huy moi session cua user; khong ban/kick/warn chinh minh hay Admin khac
(chua co phan quyen Admin); noi dung thong bao la van ban thuan (bo HTML), link chi http(s). Du lieu luu `data/moderation.json`,
`popups.json`, `marquee.json` (ghi atomic, con sau restart). Test: `npm test` (them `test/admin.js`).


## Chống spam Feed / Fan Art (Cloudflare Turnstile + Rate limit)

**Captcha.** Bài viết mới, bình luận mới và Fan Art (đăng + sửa) yêu cầu token Cloudflare Turnstile, server xác minh lại với Cloudflare (`middleware/antispam.js`). Cấu hình `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` (tạo widget tại dash.cloudflare.com → Turnstile). Widget ở chế độ *interaction-only* nên người dùng thật gần như không thấy. Sửa bài, reaction, xóa **không** cần captcha (đã có rate limit và bài sửa quay lại chờ duyệt). Đặt `CAPTCHA_REQUIRED=true` để **chặn đăng khi chưa cấu hình Turnstile** (fail-closed). Ngoài ra có ô ẩn chống bot (honeypot): bot điền vào ô ẩn `hp` sẽ bị từ chối.

**Rate limit** (cửa sổ trượt, `middleware/rateLimit.js`; 429 kèm `Retry-After`):

| Hành động | Theo tài khoản | Tài khoản mới (<24h) | Theo IP |
|---|---|---|---|
| Đăng / sửa bài | 3 / phút và 10 / giờ | 3 / giờ | 30 / giờ |
| Bình luận | 6 / phút và 30 / 10 phút | 10 / 10 phút | 80 / 10 phút |
| Fan Art | 2 / phút và 5 / giờ | 2 / giờ | 15 / giờ |
| Reaction | 60 / phút | | 150 / phút |
| Mọi thao tác ghi `/api/*` | | | 40 / phút |
| Mọi request `/api/*` | | | 120 / phút |

Sau Cloudflare, đặt `TRUST_CLOUDFLARE=true` (+ `TRUST_PROXY=true`) để giới hạn theo IP thật (`CF-Connecting-IP`); thiếu bước này mọi người dùng có thể bị tính chung một IP của Cloudflare. `RATE_LIMIT_SCALE` nhân hệ số cho mọi giới hạn. Limiter lưu trong bộ nhớ (1 instance); nhiều instance cần Redis.

## Giao diện Feed (kiểu Facebook)
`/forum`: ô "Bạn đang nghĩ gì?" mở cửa sổ soạn bài (chữ + tối đa 4 ảnh), lưới ảnh 1/2/3/4, tóm tắt reaction, nút **Thích** (rê chuột / nhấn giữ trên điện thoại để chọn 👍 ❤️ 😂 😮 😢 😡), Bình luận dạng bong bóng (Enter để gửi), Chia sẻ (sao chép liên kết), menu ⋯ Sửa/Xóa cho bài của mình. Mã nằm ở `public/js/forum.js` + khối "Feed kiểu Facebook" cuối `public/css/style.css`.

## Sửa giao diện Admin (CSS)
- CSP chặn Google Fonts (`style-src`/`font-src` thiếu `fonts.googleapis.com`, `fonts.gstatic.com`) → mất font, console báo lỗi. Đã bổ sung trong `middleware/security.js`.
- `.modal` khai báo 2 lần: `max-width:420px` + `padding:24px` lan sang modal nội dung (Popup, Bình luận) làm chúng bị bóp 420px và đệm kép. Đã tách `.modal-bg .modal` (hộp thoại nhỏ) và `.mov .modal` (modal rộng).
- Hộp thoại xác nhận (`z-index:90`) nằm **dưới** modal Bình luận (`100`) nên bấm "Xóa bình luận" không thấy hộp xác nhận. Đã nâng lên 120.
- Mobile: thanh trên tràn, tiêu đề bảng bị bẻ 3 dòng, sidebar dùng `100vh` bị cắt trên trình duyệt di động (đổi sang `100dvh`).
