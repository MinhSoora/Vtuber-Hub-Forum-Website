# Ghi chú bản vá bảo mật

Áp dụng sau buổi rà soát theo checklist 20 mục. Không có lỗ hổng nghiêm trọng (SQLi, XSS lưu
trữ, path traversal...) trong code gốc — các thay đổi dưới đây là để **vá các điểm còn thiếu**.

## Đã thêm / sửa

1. **`middleware/security.js` (mới)** — thêm các header còn thiếu:
   - `Content-Security-Policy` (chặn script/style/frame lạ, chỉ cho phép domain đã dùng thật
     sự: `challenges.cloudflare.com` cho Turnstile, `livecounts.io` cho iframe thống kê).
   - `Strict-Transport-Security` (chỉ bật khi `req.secure` — tức đang chạy HTTPS thật, tránh
     hỏng môi trường dev HTTP).
   - `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`.
   - Giữ nguyên các header cũ (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`).

2. **`middleware/rateLimit.js` (mới)** — rate limit chung 120 request/phút/IP cho toàn bộ
   `/api/*`. Trước đây chỉ `login`, `fanart`, `contribute` có giới hạn; các endpoint đọc công
   khai (`/api/vtubers`, `/api/news`, `/api/videos/latest`...) không có giới hạn nào.

3. **`middleware/auth.js`** — hỗ trợ thêm `ADMIN_PASSWORD_HASH` (scrypt, định dạng
   `salt:hash` hex) thay cho việc chỉ có thể lưu `ADMIN_PASSWORD` dạng plaintext trong `.env`.
   Vẫn giữ tương thích ngược: nếu chưa cấu hình hash thì dùng `ADMIN_PASSWORD` như cũ (có in
   cảnh báo khuyến nghị nâng cấp).

4. **`scripts/hash-password.js` (mới)** — CLI tạo `ADMIN_PASSWORD_HASH`:
   ```
   node scripts/hash-password.js "mật-khẩu-của-bạn"
   ```
   rồi dán kết quả vào `.env`, xoá dòng `ADMIN_PASSWORD` cũ.

5. **`server.js`** — gắn 2 middleware trên vào đầu pipeline; validate `.env` giờ chấp nhận
   `ADMIN_PASSWORD` hoặc `ADMIN_PASSWORD_HASH`.

6. **`.env.example`** — thêm hướng dẫn `ADMIN_PASSWORD_HASH`.

## Việc bạn cần tự làm khi deploy (không thể tự động hoá trong sandbox này — không có mạng)

- **Tạo `package-lock.json`**: chạy `npm install` trên máy có mạng rồi commit file này, sau đó
  chạy `npm audit` / `npm audit fix` định kỳ. Sandbox vá bản này không có kết nối mạng nên
  không tự sinh được lockfile.
- **Kiểm tra Git history cũ** (nếu repo thật đã từng commit `.env` hay secret khác): chạy
  `gitleaks detect` hoặc `trufflehog git file://.` rồi `git filter-repo`/`BFG` nếu phát hiện.
  Không kiểm tra được việc này vì bản gửi lên không kèm `.git`.
- **Đổi sang `ADMIN_PASSWORD_HASH`** bằng `scripts/hash-password.js` rồi xoá `ADMIN_PASSWORD`
  plaintext khỏi `.env`.
- Khi chạy sau reverse proxy/Cloudflare: nhớ đặt `TRUST_PROXY=true` và `COOKIE_SECURE=true`
  để HSTS + cookie `Secure` hoạt động đúng.

## Bổ sung: Discord OAuth2 + tài khoản

Xem mục "Đăng nhập Discord + Tài khoản" trong README. Tóm tắt thay đổi bảo mật: OAuth `state` một lần + TTL, session mới sau đăng nhập, session store file (thay MemoryStore) với giới hạn số phiên, rate limit `/auth/*`, CSRF token cho logout, role Admin tính từ `ADMIN_DISCORD_IDS` mỗi request, `checkCredentials` trả `false` khi login username/password chưa cấu hình (tránh so sánh chuỗi rỗng).
