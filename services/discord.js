'use strict';
/**
 * Discord OAuth2 (scope "identify" - chi doc id/username/avatar, KHONG lay email).
 * Moi secret (DISCORD_CLIENT_SECRET) chi doc o server, khong bao gio tra ra client/log.
 */
const crypto = require('crypto');
const { HttpError } = require('./store');

const API = 'https://discord.com/api/v10';
const AUTHORIZE = 'https://discord.com/oauth2/authorize';
const TIMEOUT_MS = 10000;
const UA = 'VTuberHub (OAuth2 login, 1.0)';

const env = (k) => String(process.env[k] || '').trim();
const SNOWFLAKE = /^\d{15,25}$/;

/** Cau hinh hop le chi khi du CLIENT_ID + CLIENT_SECRET + REDIRECT_URI (http/https, khong kem hash). */
function config() {
  const clientId = env('DISCORD_CLIENT_ID'), clientSecret = env('DISCORD_CLIENT_SECRET'), redirectUri = env('DISCORD_REDIRECT_URI');
  if (!SNOWFLAKE.test(clientId) || !clientSecret || !redirectUri) return null;
  let u; try { u = new URL(redirectUri); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol) || u.hash) return null;
  return { clientId, clientSecret, redirectUri };
}
const enabled = () => !!config();

/** Danh sach Discord ID admin tu ADMIN_DISCORD_IDS (phan cach bang dau phay/khoang trang). */
let _adm = { raw: null, set: new Set(), bad: [] };
function parseAdminIds() {
  const raw = env('ADMIN_DISCORD_IDS');
  if (_adm.raw !== raw) {
    const tokens = raw.split(/[\s,;]+/).filter(Boolean);
    _adm = { raw, set: new Set(tokens.filter((t) => SNOWFLAKE.test(t))), bad: tokens.filter((t) => !SNOWFLAKE.test(t)) };
  }
  return _adm;
}
const adminIds = () => parseAdminIds().set;
const invalidAdminIds = () => parseAdminIds().bad;
/** Role suy ra tu ENV moi lan kiem tra (khong luu vao DB) => go ID khoi env la mat quyen ngay. */
const roleOf = (id) => (typeof id === 'string' && adminIds().has(id) ? 'admin' : 'user');

/* ---------- validate input cua OAuth callback ---------- */
const newState = () => crypto.randomBytes(32).toString('hex');
const isValidState = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const isValidCode = (c) => typeof c === 'string' && /^[\w.~-]{8,512}$/.test(c);
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
/** Chi cho phep chuyen huong ve duong dan noi bo (chong open redirect). */
function sanitizeNext(v, fallback = '/account') {
  if (typeof v !== 'string' || !v || v.length > 200 || !v.startsWith('/') || /[\u0000-\u001f\u007f\\]/.test(v)) return fallback;
  if (v.startsWith('//')) return fallback;
  let u; try { u = new URL(v, 'http://local.invalid'); } catch { return fallback; }
  if (u.origin !== 'http://local.invalid' || u.pathname.startsWith('/auth/') || u.pathname === '/login') return fallback;
  return u.pathname + u.search;
}

function authorizeUrl(state) {
  const c = config(); if (!c) throw new HttpError(503, 'Đăng nhập Discord chưa được cấu hình');
  const q = new URLSearchParams({ client_id: c.clientId, redirect_uri: c.redirectUri, response_type: 'code', scope: 'identify', state, prompt: 'none' });
  return `${AUTHORIZE}?${q}`;
}

async function call(url, init) {
  let res;
  try { res = await fetch(url, { ...init, headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers || {}) }, signal: AbortSignal.timeout(TIMEOUT_MS) }); }
  catch { throw new HttpError(502, 'Không kết nối được Discord'); }
  let json = null; try { json = await res.json(); } catch { /* body khong phai JSON */ }
  if (!res.ok || !json) throw new HttpError(res.status === 429 ? 429 : 502, `Discord trả lỗi (${res.status})`);
  return json;
}

/** Doi authorization code lay access token. Code chi dung 1 lan (Discord tu thu hoi neu dung lai). */
async function exchangeCode(code) {
  const c = config(); if (!c) throw new HttpError(503, 'Đăng nhập Discord chưa được cấu hình');
  if (!isValidCode(code)) throw new HttpError(400, 'Mã xác thực không hợp lệ');
  const body = new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, grant_type: 'authorization_code', code, redirect_uri: c.redirectUri });
  const t = await call(`${API}/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (typeof t.access_token !== 'string' || !t.access_token) throw new HttpError(502, 'Discord không trả access token');
  if (typeof t.scope === 'string' && !t.scope.split(/\s+/).includes('identify')) throw new HttpError(400, 'Thiếu quyền identify');
  return t.access_token;
}

async function fetchProfile(accessToken) {
  const u = await call(`${API}/users/@me`, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } });
  if (typeof u.id !== 'string' || !SNOWFLAKE.test(u.id)) throw new HttpError(502, 'Discord trả dữ liệu tài khoản không hợp lệ');
  return { id: u.id, username: typeof u.username === 'string' ? u.username : '', avatar: typeof u.avatar === 'string' ? u.avatar : null };
}

/** Thu hoi token ngay sau khi lay xong profile (server khong luu token). Best-effort. */
async function revokeToken(accessToken) {
  const c = config(); if (!c) return;
  const body = new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, token: accessToken, token_type_hint: 'access_token' });
  try { await fetch(`${API}/oauth2/token/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA }, body, signal: AbortSignal.timeout(TIMEOUT_MS) }); } catch { /* bo qua */ }
}

/** URL avatar tren CDN Discord; khong co avatar thi dung avatar mac dinh theo ID. */
function avatarUrl(user, size = 128) {
  if (user && user.avatar && /^(?:a_)?[a-f0-9]{32}$/.test(user.avatar) && SNOWFLAKE.test(user.id)) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith('a_') ? 'gif' : 'png'}?size=${size}`;
  }
  let idx = 0; try { idx = Number((BigInt(user.id) >> 22n) % 6n); } catch { /* id loi => 0 */ }
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

module.exports = {
  config, enabled, adminIds, invalidAdminIds, roleOf,
  newState, isValidState, isValidCode, safeEqual, sanitizeNext,
  authorizeUrl, exchangeCode, fetchProfile, revokeToken, avatarUrl,
};
