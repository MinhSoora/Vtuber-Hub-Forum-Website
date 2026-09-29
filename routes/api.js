'use strict';
const express = require('express');
const store = require('../services/store');
const { getState, summarize } = require('../services/state');
const fanart = require('../services/fanart');
const news = require('../services/news');
const captcha = require('../services/captcha');
const contribute = require('../services/contribute');
const legal = require('../services/legal');
const ann = require('../services/announcements');
const auth = require('../middleware/auth');
const { makeUserLimiter, makeIpLimiter, stack, clientIp } = require('../middleware/rateLimit');
const { requireCaptcha, honeypot } = require('../middleware/antispam');

const router = express.Router();
const ok = (res, data) => res.json({ success: true, data });
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  const status = e.status || 500;
  if (status >= 500) console.error('[api]', e.stack || e.message);
  const body = { success: false, error: status >= 500 ? 'Lỗi máy chủ' : e.message };
  if (e.field) body.field = e.field;
  res.status(status).json(body);
});
async function activeOr404(key) {
  const v = await store.getBySlug(key);
  if (!v || v.enabled !== true) throw new store.HttpError(404, 'Không tìm thấy VTuber');
  return v;
}
/** Danh sach public chi doc cache (khong goi mang) => nhanh, khong tao hang tram request. Refresher nap cache nen. */
const listStates = async () => Promise.all((await store.list()).filter((v) => v.enabled).map((v) => getState(v, { cacheOnly: true })));

/** Thong bao dang hien (chi ban ghi active, truong an toan). Popup loc theo audience theo session server-side. */
router.get('/announcements', wrap(async (req, res) => ok(res, { marquee: await ann.marquee.listPublic(), popups: await ann.popupsFor(req.user) })));

router.get('/vtubers', wrap(async (req, res) => ok(res, (await listStates()).map((s) => summarize(s)))));

router.get('/stats', wrap(async (req, res) => {
  const all = await listStates();
  ok(res, {
    totalVtubers: all.length,
    withYoutube: all.filter((s) => !s.meta.noYoutube).length,
    live: all.filter((s) => s.status === 'live').length,
    upcoming: all.reduce((n, s) => n + s.upcoming.length, 0),
    videos: all.filter((s) => s.videosKnown).reduce((n, s) => n + s.videoCount, 0),
    pending: all.filter((s) => s.meta.pending).length,
    updatedAt: Math.max(0, ...all.map((s) => s.meta.updatedAt || 0)) || null,
  });
}));

router.get('/videos/latest', wrap(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 12, 1), 30);
  const vids = (await listStates()).flatMap((s) => s.videos.map((x) => ({ ...x, vtuber: { slug: s.slug, name: s.name, avatar: s.avatar } })));
  vids.sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
  ok(res, vids.slice(0, limit));
}));

// Chi tiet 1 VTuber: fetch neu cache het han (1 VTuber = toi da 4 request, da co dedupe/backoff)
router.get('/vtubers/:slug', wrap(async (req, res) => ok(res, await getState(await activeOr404(req.params.slug)))));
router.get('/vtubers/:slug/live', wrap(async (req, res) => {
  const s = await getState(await activeOr404(req.params.slug));
  ok(res, { isLive: s.isLive, status: s.status, live: s.live, channel: s.channel });
}));
router.get('/vtubers/:slug/upcoming', wrap(async (req, res) => ok(res, (await getState(await activeOr404(req.params.slug))).upcoming)));
router.get('/vtubers/:slug/videos', wrap(async (req, res) => {
  const v = (await getState(await activeOr404(req.params.slug))).videos;
  const off = Math.max(parseInt(req.query.offset, 10) || 0, 0), lim = parseInt(req.query.limit, 10);
  ok(res, lim > 0 ? v.slice(off, off + Math.min(lim, 50)) : v);
}));

// ---- Fan art (gan voi tai khoan Discord; upload qua imgbb) ----
// authorId + username do backend ghi tu session; client khong gui/gia mao duoc. Anh moi luon "pending".
const fanartLimit = stack(
  makeUserLimiter({ windowMs: 60e3, max: 2, message: 'Bạn đăng Fan Art quá nhanh, hãy chờ một phút rồi thử lại.' }),
  makeUserLimiter({ windowMs: 3600e3, max: 5, newAccountMax: 2, message: 'Bạn đăng/sửa Fan Art quá nhiều, thử lại sau ít phút.' }),
  makeIpLimiter({ windowMs: 3600e3, max: 15 }));
const fanartDelLimit = makeUserLimiter({ windowMs: 60e3, max: 30 });
const write = [auth.sameOrigin, auth.requireAuth, auth.requireCsrf, auth.requireConsent];  // cookie session => Origin cung site + CSRF token + da dong y TOS/Rules hien hanh
const viewerOf = (req) => ({ viewerId: req.user ? req.user.id : null, admin: false });
// TOS + Community Rules (cong khai, khong can dang nhap). Noi dung o data/legal.json.
router.get('/legal', wrap(async (req, res) => ok(res, legal.get())));
router.get('/config', (req, res) => ok(res, { turnstileSiteKey: captcha.enabled() ? captcha.siteKey() : null, contribute: contribute.enabled() }));
router.get('/fanart', wrap(async (req, res) => { // chi anh da duyet
  const items = (await fanart.list()).slice(0, Math.min(Math.max(parseInt(req.query.limit, 10) || 60, 1), 100));
  ok(res, await fanart.present(items, viewerOf(req)));
}));
router.get('/fanart/mine', auth.requireAuth, wrap(async (req, res) => ok(res, await fanart.present(await fanart.list({ all: true, authorId: req.user.id }), viewerOf(req))))); // Fan Art cua chinh minh (moi trang thai)
router.post('/fanart', ...write, fanartLimit, honeypot(), requireCaptcha(), wrap(async (req, res) => {
  const body = req.body || {};                                          // Turnstile + o an da duoc kiem tra o middleware
  const item = await fanart.add(req.user, body);                       // authorId/username = session; luon pending
  res.status(201).json({ success: true, data: { id: item.id, status: item.status } });
}));
router.put('/fanart/:id', ...write, fanartLimit, honeypot(), requireCaptcha(), wrap(async (req, res) => {
  const item = await fanart.update(req.user, String(req.params.id), req.body || {});  // chi chu so huu; ve pending
  ok(res, { id: item.id, status: item.status });
}));
router.delete('/fanart/:id', ...write, fanartDelLimit, wrap(async (req, res) => ok(res, { deleted: (await fanart.removeOwn(req.user, String(req.params.id))).id })));

// ---- Dong gop / chinh sua -> Discord webhook (captcha bat buoc) ----
const cHits = new Map(); // ip -> thoi diem gui (gioi han 5 dong gop/gio/IP)
router.post('/contribute', wrap(async (req, res) => {
  const ip = clientIp(req), now = Date.now(), arr = (cHits.get(ip) || []).filter((t) => now - t < 36e5);
  if (arr.length >= 5) throw new store.HttpError(429, 'Bạn gửi quá nhiều, thử lại sau ít phút');
  const body = req.body || {};
  if (!contribute.enabled()) throw new store.HttpError(503, 'Chức năng đóng góp chưa được cấu hình (DISCORD_WEBHOOK_URL)');
  const data = contribute.validate(body);               // kiem tra du lieu truoc (re)
  await captcha.verify(body.captcha, ip);               // roi moi ton request toi Cloudflare
  await contribute.send(data, ip);
  cHits.set(ip, [...arr, now]);
  ok(res, { sent: true });
}));

// ---- Tin tuc (chi bai da xuat ban) ----
router.get('/news', wrap(async (req, res) => ok(res, (await news.list()).slice(0, Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50)))));
router.get('/news/:id', wrap(async (req, res) => {
  const n = await news.get(req.params.id);
  if (!n) throw new store.HttpError(404, 'Không tìm thấy tin');
  ok(res, n);
}));

router.use((req, res) => res.status(404).json({ success: false, error: 'API không tồn tại' }));
module.exports = { router, wrap, ok };
