'use strict';
const { clientIp } = require('./rateLimit');
const crypto = require('crypto');
const users = require('../services/users');
const discord = require('../services/discord');
const legal = require('../services/legal');
const moderation = require('../services/moderation');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const env = (k) => String(process.env[k] || '').trim();

/**
 * So sanh mat khau:
 *  - Neu co ADMIN_PASSWORD_HASH (dinh dang "salt:hash" hex, tao bang scripts/hash-password.js)
 *    thi dung scrypt de bam mat khau nguoi dung nhap va so sanh - mat khau that KHONG con nam
 *    dang plaintext trong .env.
 *  - Neu chua cau hinh ADMIN_PASSWORD_HASH, fallback ve ADMIN_PASSWORD (plaintext, cach cu) de
 *    khong lam vo cau hinh hien tai - nhung se canh bao ra console de nguoi van hanh biet ma
 *    nang cap.
 * Ca 2 nhanh deu dung crypto.timingSafeEqual tren buffer cung do dai de tranh timing attack.
 */
const SCRYPT_KEYLEN = 64;
function verifyPassword(pass) {
  const hashCfg = env('ADMIN_PASSWORD_HASH');
  if (hashCfg) {
    const [saltHex, hashHex] = hashCfg.split(':');
    if (!saltHex || !hashHex) return false;
    try {
      const salt = Buffer.from(saltHex, 'hex');
      const expected = Buffer.from(hashHex, 'hex');
      const actual = crypto.scryptSync(String(pass), salt, expected.length || SCRYPT_KEYLEN);
      return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    } catch { return false; }
  }
  return crypto.timingSafeEqual(sha(pass), sha(env('ADMIN_PASSWORD')));
}
function checkCredentials(user, pass) {
  if (!env('ADMIN_USERNAME') || (!env('ADMIN_PASSWORD') && !env('ADMIN_PASSWORD_HASH'))) return false; // login legacy chua cau hinh => tat
  const okU = crypto.timingSafeEqual(sha(String(user).trim()), sha(env('ADMIN_USERNAME')));
  const okP = verifyPassword(pass);
  return okU && okP;
}

/* ================= Role + middleware chung (Guest / User / Admin) =================
 *  - Guest : chua dang nhap                       -> req.role = 'guest', req.user = null
 *  - User  : dang nhap Discord                    -> req.role = 'user',  req.user = {id, username, avatar, ...}
 *  - Admin : Discord ID nam trong ADMIN_DISCORD_IDS, HOAC phien admin username/password cu (legacy)
 * "userId" luon lay tu req.user.id (session server-side) - KHONG BAO GIO tin userId do client gui.
 */
const USER_ABS_MS = 14 * 24 * 3600e3;   // toi da 14 ngay ke tu luc dang nhap, du con hoat dong
const USER_IDLE_MS = 3 * 24 * 3600e3;   // het han neu 3 ngay khong hoat dong (cookie rolling)

async function attachUser(req, res, next) {
  req.user = null; req.role = 'guest';
  const s = req.session;
  if (!s) return next();
  try {
    if (s.user) {
      const su = s.user;
      if (!su || typeof su.id !== 'string' || !su.loginAt || Date.now() - su.loginAt > USER_ABS_MS) { delete s.user; delete s.csrf; }
      else {
        const u = await users.getById(su.id);
        if (!u) { delete s.user; delete s.csrf; }   // tai khoan khong con trong users.json => huy dang nhap
        else {
          // Ban duoc kiem tra o MOI request tu kho moderation (khong phu thuoc session): session moi/cu deu bi chan.
          // Admin (theo ADMIN_DISCORD_IDS) khong bi ban qua co che nay.
          const role = discord.roleOf(u.id), ban = role === 'admin' ? null : await moderation.activeBan(u.id);
          if (ban) { req.ban = ban; delete s.user; delete s.csrf; }
          else { req.user = { ...u, avatarUrl: discord.avatarUrl(u) }; req.role = role; }
        }
      }
    }
    if (req.role !== 'admin' && s.admin === true) req.role = 'admin'; // phien admin legacy (username/password)
  } catch (e) { return next(e); }
  next();
}
const isAdmin = (req) => req.role === 'admin';
const wantsJson = (req) => req.originalUrl.startsWith('/api/') || String(req.get('accept') || '').includes('application/json');

/** Bat buoc dang nhap Discord (userId that su). API => 401 JSON; trang => chuyen sang dang nhap. */
function requireAuth(req, res, next) {
  if (req.user) return next();
  if (wantsJson(req)) return res.status(401).json({ success: false, error: 'Bạn cần đăng nhập bằng Discord' });
  res.redirect('/auth/discord/login?next=' + encodeURIComponent(req.originalUrl));
}
/** Bat buoc Admin. Dang nhap nhung khong phai admin => 403; chua dang nhap => 401 / chuyen toi /admin/login. */
function requireAdmin(req, res, next) {
  if (req.role === 'admin') return next();
  if (wantsJson(req)) {
    return req.user
      ? res.status(403).json({ success: false, error: 'Bạn không có quyền quản trị' })
      : res.status(401).json({ success: false, error: 'Chưa đăng nhập hoặc session đã hết hạn' });
  }
  if (req.user) return res.status(403).type('text').send('Bạn không có quyền truy cập trang này');
  res.redirect('/admin/login');
}
// Ten cu giu lai de code hien co khong vo: dung chung 1 middleware requireAdmin.
const requireAuthApi = requireAdmin;
const requireAuthPage = requireAdmin;

/** Da dang nhap nhung chua dong y phien ban TOS/Community Rules hien hanh => chan (API 403 code=consent_required; trang => /login).
 *  Dat SAU requireAuth. Trang thai consent lay tu users.json (req.user), khong bao gio tin client. */
function requireConsent(req, res, next) {
  if (!req.user) return next();
  let ok; try { ok = legal.hasConsent(req.user); } catch (e) { return next(e); }
  if (ok) return next();
  if (wantsJson(req)) return res.status(403).json({ success: false, code: 'consent_required', error: 'Bạn cần đồng ý Terms of Service và Community Rules (phiên bản mới nhất) để tiếp tục.' });
  res.redirect('/login?reconsent=1&next=' + encodeURIComponent(req.originalUrl));
}

/** CSRF token theo session (double-submit qua header X-CSRF-Token) cho cac thao tac ghi cua tai khoan Discord. */
const newCsrfToken = () => crypto.randomBytes(32).toString('hex');
function requireCsrf(req, res, next) {
  const tok = req.get('x-csrf-token'), want = req.session && req.session.csrf;
  const ok = typeof tok === 'string' && typeof want === 'string' && tok.length === want.length && crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(want));
  return ok ? next() : res.status(403).json({ success: false, error: 'CSRF token không hợp lệ' });
}

// CSRF co ban: request ghi phai cung origin (Host hoac X-Forwarded-Host khi sau proxy) + cookie SameSite.
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    let host = null;
    try { host = new URL(origin).host; } catch { /* invalid */ }
    const allowed = [req.get('host'), req.get('x-forwarded-host')].filter(Boolean);
    if (!host || !allowed.includes(host)) return res.status(403).json({ success: false, error: 'Origin không hợp lệ' });
  }
  next();
}

/** Gioi han so lan THAT BAI theo IP (mac dinh 10 lan / 15 phut). Dung cho login admin va OAuth callback. */
function makeAttemptLimiter({ max = 10, windowMs = 15 * 60e3, onLimit } = {}) {
  const attempts = new Map();
  setInterval(() => { const now = Date.now(); for (const [ip, r] of attempts) if (now - r.t > windowMs) attempts.delete(ip); }, windowMs).unref();
  return function attemptLimiter(req, res, next) {
    const now = Date.now(), rec = attempts.get(clientIp(req)) || { n: 0, t: now };
    if (now - rec.t > windowMs) { rec.n = 0; rec.t = now; }
    attempts.set(clientIp(req), rec);
    if (rec.n >= max) return onLimit ? onLimit(req, res) : res.status(429).json({ success: false, error: 'Thử quá nhiều lần, vui lòng đợi 15 phút' });
    req.loginFail = () => { rec.n++; };
    req.loginOk = () => attempts.delete(clientIp(req));
    next();
  };
}
const loginLimiter = makeAttemptLimiter();
module.exports = { checkCredentials, requireAuthApi, requireAuthPage, sameOrigin, loginLimiter, makeAttemptLimiter,
  attachUser, requireAuth, requireAdmin, requireCsrf, requireConsent, newCsrfToken, isAdmin, USER_IDLE_MS, USER_ABS_MS };
