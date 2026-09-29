'use strict';
/**
 * Discord OAuth2 + tai khoan.
 *   pages (mount /auth)    : GET /auth/discord/login (chi dieu huong sang trang consent /login), GET /auth/discord/callback
 *   api   (mount /api/auth): GET /me (moi vai tro), GET /account (can dang nhap), POST /logout (can CSRF token),
 *                            GET /login-intent + POST /login (bat dau OAuth SAU KHI user bam nut o trang consent),
 *                            POST /consent (user da dang nhap xac nhan lai TOS/Rules moi)
 * Consent: server tu ghi { version hien hanh, thoi diem } vao session luc bam nut, callback thanh cong moi luu vao users.json.
 * Client khong bao gio gui/quyet dinh version hay thoi diem.
 * Tai khoan Discord chi luu trong users.json; phien nam o server (session store), cookie httpOnly + SameSite=Lax.
 */
const express = require('express');
const auth = require('../middleware/auth');
const { makeRateLimiter } = require('../middleware/rateLimit');
const users = require('../services/users');
const discord = require('../services/discord');
const legal = require('../services/legal');
const moderation = require('../services/moderation');
const sessionStore = require('../services/sessionStore');
const { ok } = require('./api');

const STATE_TTL_MS = 10 * 60e3;          // state OAuth chi co hieu luc 10 phut, dung 1 lan
const MAX_SESSIONS_PER_USER = 5;         // toi da 5 phien dong thoi / tai khoan (chong tao phien tran lan)
const fail = (code) => `/?login_error=${code}`;

const promisify = (fn) => new Promise((resolve, reject) => fn((e) => (e ? reject(e) : resolve())));

/** Ban ghi tai khoan tra ve cho client: khong co secret/token/thong tin session. */
const publicUser = (u, role) => ({ id: u.id, username: u.username, avatar: u.avatar, avatarUrl: u.avatarUrl || discord.avatarUrl(u), createdAt: u.createdAt, updatedAt: u.updatedAt, role,
  ...(u.termsVersion ? { termsVersion: u.termsVersion, tosAcceptedAt: u.tosAcceptedAt, communityRulesAcceptedAt: u.communityRulesAcceptedAt } : {}) }); // consent chi tra cho CHINH chu tai khoan (/me, /account)
/** Trang thai consent cua user so voi phien ban hien hanh (loi doc legal.json khong duoc lam hong /me). */
function termsState(user) {
  try { return { termsVersion: legal.version(), consentRequired: !!user && !legal.hasConsent(user) }; }
  catch { return { termsVersion: null, consentRequired: false }; }
}
const loginUrl = (next, reconsent) => '/login?' + (reconsent ? 'reconsent=1&' : '') + 'next=' + encodeURIComponent(next);

/* ---------------- Pages: /auth/... ---------------- */
const pages = express.Router();
pages.use(makeRateLimiter({ windowMs: 60e3, max: 30 }));                       // gioi han moi IP: 30 request/phut cho /auth/*
const failLimiter = auth.makeAttemptLimiter({ max: 10, onLimit: (req, res) => res.redirect(fail('rate')) }); // 10 lan callback loi / 15 phut / IP

/** Moi duong vao dang nhap cu (nav, forum, requireAuth...) deu qua day: KHONG bao gio nhay thang sang Discord -
 *  khach phai thay man hinh consent (/login) va bam nut. Da dang nhap + da dong y => ve trang dich. */
pages.get('/discord/login', (req, res) => {
  if (!discord.enabled()) return res.redirect(fail('disabled'));
  const next = discord.sanitizeNext(req.query.next);   // chi duong dan noi bo
  if (!req.user) return res.redirect(loginUrl(next));
  res.redirect(termsState(req.user).consentRequired ? loginUrl(next, true) : next);
});

pages.get('/discord/callback', failLimiter, async (req, res) => {
  const stored = req.session.oauth;
  delete req.session.oauth;                              // state chi dung 1 lan, du thanh cong hay that bai
  const bad = (code) => { req.loginFail(); res.redirect(fail(code)); };
  if (!discord.enabled()) return res.redirect(fail('disabled'));
  const q = req.query;
  if (typeof q.error === 'string') return res.redirect(fail(q.error === 'access_denied' ? 'denied' : 'failed')); // nguoi dung huy tren Discord
  if (!discord.isValidState(q.state) || !discord.isValidCode(q.code)) return bad('invalid');
  if (!stored || typeof stored.state !== 'string' || !(Date.now() - stored.at < STATE_TTL_MS) || !discord.safeEqual(stored.state, q.state)) return bad('state');
  if (!stored.consent || typeof stored.consent.version !== 'string') return bad('state');   // OAuth chi hop le khi da bat dau tu man hinh consent

  try {
    const token = await discord.exchangeCode(q.code);
    let profile;
    try { profile = await discord.fetchProfile(token); } finally { discord.revokeToken(token); } // khong giu token cua Discord
    const user = await users.upsertFromDiscord(profile, stored.consent);   // consent = version + thoi diem do SERVER ghi luc user bam nut

    if (discord.roleOf(user.id) !== 'admin' && await moderation.activeBan(user.id)) return res.redirect(fail('banned')); // bi ban: khong cap session moi
    await promisify((cb) => req.session.regenerate(cb));  // session moi => chong session fixation
    req.session.user = { id: user.id, loginAt: Date.now() };  // userId chi do server ghi
    req.session.csrf = auth.newCsrfToken();
    req.session.cookie.maxAge = auth.USER_IDLE_MS;
    await promisify((cb) => req.session.save(cb));
    sessionStore.get().pruneUser(user.id, MAX_SESSIONS_PER_USER, req.sessionID);
    req.loginOk();
    res.redirect(discord.sanitizeNext(stored.next));
  } catch (e) {
    console.error('[auth] Đăng nhập Discord thất bại:', e.status || '', e.message); // khong log code/token/secret
    bad('failed');
  }
});

/* ---------------- API: /api/auth/... ---------------- */
const api = express.Router();
api.use(auth.sameOrigin);

/** Ai cung goi duoc (Guest/User/Admin): giup frontend biet trang thai dang nhap + co hien nut Discord khong. */
api.get('/me', (req, res) => {
  if (req.user && !req.session.csrf) req.session.csrf = auth.newCsrfToken();
  ok(res, {
    loggedIn: !!req.user, role: req.role, discordEnabled: discord.enabled(), ...termsState(req.user),
    user: req.user ? publicUser(req.user, req.role) : null,
    ...(req.ban ? { ban: { reason: req.ban.reason, expiresAt: req.ban.expiresAt } } : {}),   // chi de nguoi bi ban biet ly do
    csrfToken: req.user ? req.session.csrf : null,
  });
});

/** Thong tin tai khoan Discord dang dang nhap (userId lay tu session, khong nhan tu client). */
api.get('/account', auth.requireAuth, (req, res) => {
  if (!req.session.csrf) req.session.csrf = auth.newCsrfToken();
  ok(res, { user: publicUser(req.user, req.role), csrfToken: req.session.csrf });
});

const loginLimit = makeRateLimiter({ windowMs: 60e3, max: 20 });

/** Man hinh consent goi khi mo: cap token dung 1 lan cho phien khach hien tai (chong bat dau OAuth ngoai man hinh consent). */
api.get('/login-intent', loginLimit, (req, res) => {
  const terms = termsState(req.user);
  const d = { discordEnabled: discord.enabled(), loggedIn: !!req.user, ...terms, token: null };
  if (!req.user && d.discordEnabled) {
    if (typeof req.session.loginToken !== 'string') req.session.loginToken = auth.newCsrfToken();
    d.token = req.session.loginToken;
  }
  ok(res, d);
});

/** Bam "Dang nhap bang Discord": kiem token, server ghi consent (version hien hanh + thoi diem) vao session cung state OAuth. */
api.post('/login', loginLimit, (req, res, next) => {
  if (!discord.enabled()) return res.status(503).json({ success: false, error: 'Đăng nhập Discord chưa được bật trên máy chủ này' });
  const body = req.body || {}, next_ = discord.sanitizeNext(body.next);
  if (req.user) return ok(res, { redirect: termsState(req.user).consentRequired ? loginUrl(next_, true) : next_ });
  const want = req.session.loginToken;
  if (typeof body.token !== 'string' || typeof want !== 'string' || !discord.safeEqual(body.token, want)) return res.status(403).json({ success: false, error: 'Phiên đăng nhập hết hạn, hãy tải lại trang và thử lại.' });
  let version; try { version = legal.version(); } catch (e) { return next(e); }
  delete req.session.loginToken;                         // dung 1 lan
  const state = discord.newState(), now = Date.now();
  req.session.oauth = { state, next: next_, at: now, consent: { version, at: new Date(now).toISOString() } }; // state gan voi session (chong login CSRF)
  req.session.save((err) => (err ? res.status(500).json({ success: false, error: 'Không thể bắt đầu đăng nhập' }) : ok(res, { redirect: discord.authorizeUrl(state) })));
});

/** User DA dang nhap dong y phien ban TOS/Rules moi (khong can qua Discord lai). Chi can session + CSRF; version do server quyet dinh. */
api.post('/consent', auth.requireAuth, auth.requireCsrf, async (req, res, next) => {
  try {
    if ((req.body || {}).agree !== true) return res.status(400).json({ success: false, error: 'Bạn cần xác nhận đồng ý để tiếp tục' });
    const u = await users.recordConsent(req.user.id, { version: legal.version(), at: new Date().toISOString() });
    if (!u) return res.status(401).json({ success: false, error: 'Tài khoản không tồn tại' });
    ok(res, { user: publicUser(u, req.role), ...termsState(u) });
  } catch (e) { next(e); }
});

api.post('/logout', (req, res, next) => (req.user ? next() : ok(res, { loggedOut: true })), auth.requireCsrf, (req, res) => {
  req.session.destroy(() => { res.clearCookie('vth.sid'); ok(res, { loggedOut: true }); });
});

module.exports = { pages, api, publicUser };
