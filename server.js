'use strict';
require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { router: publicApi } = require('./routes/api');
const admin = require('./routes/admin');
const authRoutes = require('./routes/auth');
const forumRoutes = require('./routes/forum');
const users = require('./services/users');
const legal = require('./services/legal');
const auth = require('./middleware/auth');
const discord = require('./services/discord');
const sessionStore = require('./services/sessionStore');
const store = require('./services/store');
const newsSvc = require('./services/news');
const refresher = require('./services/refresher');
const { securityHeaders } = require('./middleware/security');
const { makeRateLimiter } = require('./middleware/rateLimit');

for (const k of ['ADMIN_USERNAME', 'ADMIN_PASSWORD', 'ADMIN_PASSWORD_HASH', 'SESSION_SECRET', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_REDIRECT_URI', 'ADMIN_DISCORD_IDS']) if (process.env[k]) process.env[k] = process.env[k].trim();
// Phai co it nhat 1 cach dang nhap Admin: (a) username/password cu, hoac (b) Discord OAuth2 + ADMIN_DISCORD_IDS.
const legacyAdmin = !!process.env.ADMIN_USERNAME && !!(process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD_HASH);
const discordAdmin = discord.enabled() && discord.adminIds().size > 0;
if (!legacyAdmin && !discordAdmin) {
  console.error('\n[!] Chưa cấu hình tài khoản Admin. Điền ADMIN_USERNAME + ADMIN_PASSWORD (hoặc ADMIN_PASSWORD_HASH), hoặc cấu hình Discord OAuth2 (DISCORD_CLIENT_ID/SECRET/REDIRECT_URI) + ADMIN_DISCORD_IDS trong .env (xem .env.example).\n');
  process.exit(1);
}
if (!legacyAdmin) console.warn('[i] Đăng nhập Admin bằng username/password đang TẮT (thiếu ADMIN_USERNAME/ADMIN_PASSWORD) - chỉ Admin Discord vào được /admin.');
const dKeys = ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_REDIRECT_URI'];
if (!discord.enabled()) {
  if (dKeys.some((k) => process.env[k])) console.warn('[!] Discord OAuth2 cấu hình chưa đủ/không hợp lệ (cần DISCORD_CLIENT_ID số, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI dạng URL) - đăng nhập Discord bị tắt.');
  if (process.env.ADMIN_DISCORD_IDS) console.warn('[!] ADMIN_DISCORD_IDS có giá trị nhưng Discord OAuth2 chưa bật - chưa ai đăng nhập Discord được.');
}
if (discord.invalidAdminIds().length) console.warn('[!] ADMIN_DISCORD_IDS có giá trị không phải Discord ID (chỉ gồm chữ số, 15-25 ký tự) và bị bỏ qua: ' + discord.invalidAdminIds().join(', '));
if (process.env.ADMIN_PASSWORD && !process.env.ADMIN_PASSWORD_HASH) {
  console.warn('[!] Đang dùng ADMIN_PASSWORD dạng plaintext trong .env. Khuyến nghị chạy `node scripts/hash-password.js` và chuyển sang ADMIN_PASSWORD_HASH.');
}
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 16) {
  process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[!] SESSION_SECRET thiếu/quá ngắn: dùng secret ngẫu nhiên tạm (đăng nhập sẽ mất khi restart). Hãy đặt trong .env.');
  if (discord.enabled()) console.warn('[!] Đang bật đăng nhập Discord: BẮT BUỘC đặt SESSION_SECRET (>=16 ký tự) khi chạy thật để phiên đăng nhập tồn tại sau restart.');
}

const captchaSvc = require('./services/captcha');
if (!captchaSvc.enabled()) console.warn('[!] Chưa cấu hình Cloudflare Turnstile (TURNSTILE_SITE_KEY/SECRET_KEY): bài viết, bình luận, Fan Art KHÔNG có captcha chống spam.' + (process.env.CAPTCHA_REQUIRED === 'true' ? ' CAPTCHA_REQUIRED=true nên việc đăng bị chặn cho tới khi cấu hình.' : ''));
if (process.env.TRUST_CLOUDFLARE === 'true' && !process.env.TRUST_PROXY) console.warn('[i] TRUST_CLOUDFLARE=true: rate limit lấy IP thật từ CF-Connecting-IP. Chỉ an toàn khi server chỉ nhận traffic qua Cloudflare.');
try { console.log('[i] TOS/Community Rules phiên bản ' + legal.version() + ' (data/legal.json)'); } catch (e) { console.error('[!] ' + e.message + ' Đăng nhập Discord sẽ lỗi cho tới khi sửa file.'); }

const app = express();
const PUB = path.join(__dirname, 'public');
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);

app.use(securityHeaders);
// Rate limit rong cho toan bo /api/* (120 request/phut/IP) - chan lam dung/DoS o cac endpoint
// doc (vd /api/vtubers, /api/news...) truoc day chua co gioi han nao. Cac endpoint nhay cam hon
// (login, fanart, contribute) van giu limiter rieng chat hon o ben trong route cua chung.
app.use('/api', makeRateLimiter({ windowMs: 60e3, max: 120 }));
// Moi thao tac GHI (POST/PUT/PATCH/DELETE) tu 1 IP: toi da 40/phut - lop chan tho truoc cac limiter theo tai khoan/tung route.
const writeIpLimit = makeRateLimiter({ windowMs: 60e3, max: 40, message: 'Bạn gửi quá nhiều yêu cầu, vui lòng thử lại sau ít phút.' });
app.use('/api', (req, res, next) => (/^(GET|HEAD|OPTIONS)$/.test(req.method) ? next() : writeIpLimit(req, res, next)));
app.use('/api/fanart', express.json({ limit: '8mb' })); // anh base64; parser nay chay truoc parser 20kb
app.use('/api/admin/news', express.json({ limit: '16mb' })); // toi da 4 anh base64/bai
// Bai forum kem toi da 4 anh base64: chi POST /posts va PUT /posts/:id moi duoc parser lon; comment/reaction van gioi han 20kb.
const bigJson = express.json({ limit: '16mb' });
app.use('/api/forum/posts', (req, res, next) => ((req.method === 'POST' && req.path === '/') || (req.method === 'PUT' && /^\/[a-f0-9]{12}$/.test(req.path)) ? bigJson(req, res, next) : next()));
app.use(express.json({ limit: '20kb' }));
app.use(session({
  name: 'vth.sid',
  store: sessionStore.get(),   // luu file (data/sessions.json): phien con hieu luc sau restart, khong dung MemoryStore
  secret: process.env.SESSION_SECRET,
  resave: false, saveUninitialized: false, rolling: true,
  // secure:'auto' => chi bat Secure khi request that su la HTTPS (tranh mat cookie khi chay http:// o production)
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true' ? true : 'auto', maxAge: 8 * 60 * 60 * 1000 },
}));
app.use(auth.attachUser);   // gan req.user / req.role (guest|user|admin) tu session server-side
app.use((req, res, next) => { if (req.path.startsWith('/api/') || req.path.startsWith('/admin') || req.path.startsWith('/auth') || req.path === '/account' || req.path === '/login') res.set('Cache-Control', 'no-store'); next(); });

app.use('/api/admin', admin.api);      // dat truoc /api
app.use('/api/auth', authRoutes.api);  // /api/auth/me|account|logout
app.use('/api/forum', forumRoutes.api);   // posts / comments / reactions
app.use('/api/users', forumRoutes.usersApi); // profile cong khai
app.use('/api', publicApi);
app.use('/admin', admin.pages);
app.use('/auth', authRoutes.pages);    // /auth/discord/login|callback

// Public pages
const send = (f, status) => (req, res) => res.status(status || 200).sendFile(path.join(PUB, f));
app.get('/', send('index.html'));
app.get('/vtubers', send('vtubers.html'));
app.get('/clippers', send('clippers.html'));
app.get('/contribute', send('contribute.html'));
app.get('/fanart', send('fanart.html'));
app.get('/fanart/upload', auth.requireAuth, auth.requireConsent, send('fanart-upload.html')); // dang / sua Fan Art can dang nhap Discord + da dong y TOS/Rules hien hanh
app.get('/tos', send('tos.html'));                          // cong khai, khong can dang nhap
app.get('/community-rules', send('community-rules.html'));   // cong khai, khong can dang nhap
app.get('/login', send('login.html'));                       // man hinh consent truoc khi sang Discord OAuth (cung dung de xac nhan lai khi TOS doi version)
app.get('/forum', send('forum.html'));
app.get('/forum/:id', (req, res) => res.sendFile(path.join(PUB, 'forum.html'))); // trang tu render bai / bao khong tim thay
app.get('/users/:id', (req, res) => res.status(users.isValidId(req.params.id) ? 200 : 404).sendFile(path.join(PUB, 'user.html'))); // profile cong khai
app.get('/profile/:id', (req, res) => res.redirect(users.isValidId(req.params.id) ? '/users/' + req.params.id : '/'));
app.get('/account', auth.requireAuth, send('account.html')); // can dang nhap Discord (khach bi chuyen sang dang nhap)
app.get('/news', send('news.html'));
app.get('/news/:id', async (req, res, next) => {
  try { const n = await newsSvc.get(req.params.id); res.status(n ? 200 : 404).sendFile(path.join(PUB, 'news-item.html')); } catch (e) { next(e); } // trang tu render "Khong tim thay" khi 404
});
app.get('/vtuber/:slug', async (req, res, next) => {
  try {
    const v = store.isValidId(req.params.slug) ? await store.getBySlug(req.params.slug) : null;
    res.status(v && v.enabled ? 200 : 404).sendFile(path.join(PUB, 'vtuber.html')); // trang tu render "Khong tim thay" khi 404
  } catch (e) { next(e); }
});
app.use(express.static(PUB, { dotfiles: 'ignore', index: false, maxAge: '5m' }));

app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ success: false, error: 'API không tồn tại' });
  res.status(404).sendFile(path.join(PUB, '404.html'));
});
app.use((err, req, res, next) => { // eslint-disable-line
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ success: false, error: 'JSON không hợp lệ' });
  console.error('[server]', err && err.stack || err);
  if (res.headersSent) return next(err);
  if (req.path.startsWith('/api')) return res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  res.status(500).type('text').send('Lỗi máy chủ');
});

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Website: http://localhost:${port}   Admin: http://localhost:${port}/admin${legacyAdmin ? `  (user: ${process.env.ADMIN_USERNAME})` : ''}${discord.enabled() ? `   Discord login: /auth/discord/login` : ''}`);
  refresher.start(Number(process.env.REFRESH_INTERVAL_MS) || 60000);
});
