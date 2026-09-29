'use strict';
/**
 * Rate limiter dung chung (khong can dependency moi). Luu trong bo nho => phu hop 1 instance;
 * nhieu instance can chuyen sang Redis.
 *
 *  - Cua so TRUOT (2 bucket) thay vi cua so co dinh: khong con "gap doi" o ranh gioi cua so.
 *  - clientIp(): sau Cloudflare dat TRUST_CLOUDFLARE=true de lay IP that tu CF-Connecting-IP
 *    (chi bat khi server that su chi nhan traffic qua Cloudflare, neu khong header nay gia mao duoc).
 *  - Gioi han theo TAI KHOAN (userId tu session) + theo IP + tai khoan moi bi siet chat hon.
 *  - stack(a, b, c): chay lan luot nhieu limiter (vd burst/phut + gio + IP).
 *  - Bo nho bi chan tran (MAX_KEYS) de khong bi lam phinh boi luong IP gia.
 */
const MAX_KEYS = 50000;
const DEFAULT_MSG = 'Quá nhiều yêu cầu, vui lòng thử lại sau.';
// RATE_LIMIT_SCALE: nhan he so cho MOI gioi han (mac dinh 1). Dung khi test logic nghiep vu (dat lon) hoac noi long tam thoi luc cao diem.
const scaled = (max) => { const k = Number(process.env.RATE_LIMIT_SCALE); return k > 0 ? Math.max(1, Math.ceil(max * k)) : max; };

function clientIp(req) {
  if (process.env.TRUST_CLOUDFLARE === 'true') {
    const cf = req.headers && req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && /^[0-9a-fA-F:.]{3,45}$/.test(cf.trim())) return cf.trim();
  }
  return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function makeRateLimiter({ windowMs = 60e3, max = 120, message = DEFAULT_MSG, key = clientIp } = {}) {
  max = scaled(max);
  const hits = new Map(); // key -> { start, cur, prev }
  setInterval(() => {
    const now = Date.now();
    for (const [k, r] of hits) if (now - r.start > 2 * windowMs) hits.delete(k);
  }, Math.max(windowMs, 60e3)).unref();

  return function rateLimit(req, res, next) {
    const now = Date.now(), k = String(key(req));
    let r = hits.get(k);
    if (!r) {
      if (hits.size >= MAX_KEYS) hits.delete(hits.keys().next().value);
      r = { start: now, cur: 0, prev: 0 }; hits.set(k, r);
    }
    const steps = Math.floor((now - r.start) / windowMs);
    if (steps >= 1) { r.prev = steps === 1 ? r.cur : 0; r.cur = 0; r.start += steps * windowMs; }
    const est = r.prev * (1 - (now - r.start) / windowMs) + r.cur;   // uoc luong so request trong cua so truot
    const retry = Math.max(1, Math.ceil((r.start + windowMs - now) / 1000));
    res.set({ 'RateLimit-Limit': String(max), 'RateLimit-Remaining': String(Math.max(0, Math.floor(max - est - 1))) });
    if (est >= max) {
      res.set('Retry-After', String(retry));
      return res.status(429).json({ success: false, error: message, retryAfter: retry });
    }
    r.cur++;
    next();
  };
}

const userKey = (req) => (req.user ? 'u:' + req.user.id : 'ip:' + clientIp(req));
const isNewAccount = (u, ageMs) => { const t = u && Date.parse(u.createdAt); return !!t && Date.now() - t < ageMs; };

/**
 * Gioi han theo TAI KHOAN (khach => theo IP).
 * newAccountMax: neu dat, tai khoan tao < newAccountAgeMs (mac dinh 24h) bi siet xuong muc nay (chong tai khoan spam dung xong bo).
 */
function makeUserLimiter({ newAccountMax, newAccountAgeMs = 24 * 3600e3, message = 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.', ...opts } = {}) {
  const base = makeRateLimiter({ message, ...opts, key: userKey });
  if (!newAccountMax) return base;
  const strict = makeRateLimiter({ message, ...opts, max: newAccountMax, key: userKey });
  return (req, res, next) => (isNewAccount(req.user, newAccountAgeMs) ? strict : base)(req, res, next);
}

/** Gioi han theo IP (chan 1 nguoi xoay nhieu tai khoan tu cung 1 mang). */
const makeIpLimiter = (opts = {}) => makeRateLimiter({ message: 'Có quá nhiều thao tác từ mạng của bạn, vui lòng thử lại sau ít phút.', ...opts, key: (req) => 'ip:' + clientIp(req) });

/** Chay lan luot nhieu middleware; dung o cai dau tien tra loi 429. */
const stack = (...mws) => function stacked(req, res, next) {
  let i = 0;
  const run = (e) => { if (e) return next(e); const m = mws[i++]; return m ? m(req, res, run) : next(); };
  run();
};

module.exports = { makeRateLimiter, makeUserLimiter, makeIpLimiter, stack, clientIp };
