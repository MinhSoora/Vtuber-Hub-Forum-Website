'use strict';
const express = require('express');
const path = require('path');
const store = require('../services/store');
const cache = require('../services/cache');
const yt = require('../services/youtube');
const { getState } = require('../services/state');
const auth = require('../middleware/auth');
const fanart = require('../services/fanart');
const forum = require('../services/forum');
const news = require('../services/news');
const users = require('../services/users');
const discord = require('../services/discord');
const moderation = require('../services/moderation');
const ann = require('../services/announcements');
const { makeUserLimiter } = require('../middleware/rateLimit');
const { wrap, ok } = require('./api');

const V = path.join(__dirname, '..', 'views', 'admin');
const page = (f) => (req, res) => res.sendFile(path.join(V, f));
// adminId LUON lay tu session server-side (Discord ID cua admin; phien legacy khong co Discord ID => 'legacy-admin'). Khong bao gio nhan tu client.
const actor = (req) => (req.user ? req.user.id : 'legacy-admin');
// Rate limit cho thao tac nhay cam (ban/kick/warn, tao/sua/xoa thong bao): 30 lan/phut/tai khoan admin (chinh bang ADMIN_RATE_MAX).
const sensitive = makeUserLimiter({ windowMs: 60e3, max: Number(process.env.ADMIN_RATE_MAX) > 0 ? Number(process.env.ADMIN_RATE_MAX) : 30 });
const warm = (v) => { if (v.enabled) getState(v, { force: true }).catch(() => {}); };

/** Nhan ID/URL/@handle -> channelId that su ton tai (fetch tuoi) va nap cache. */
async function verifyChannel(input) {
  let id, info;
  try { id = await yt.resolveChannelId(input); info = await yt.fetchChannel(id); }
  catch (e) {
    if (e.code === 'INVALID') throw new store.HttpError(400, e.message, 'youtube');
    if (e.code === 'NOT_FOUND') throw new store.HttpError(400, e.message === 'Not found' ? 'Channel không tồn tại' : e.message, 'youtube');
    throw new store.HttpError(502, `Không kiểm tra được channel lúc này (${e.message}). Thử lại sau.`, 'youtube');
  }
  await cache.set('channel', id, info);
  return { id, info };
}
const pick = (b, keys) => Object.fromEntries(keys.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
const FIELDS = ['name', 'type', 'slug', 'avatar', 'description', 'social', 'graduated', 'enabled'];

// ---------- Pages ----------
const pages = express.Router();
pages.get('/login', (req, res) => (auth.isAdmin(req) ? res.redirect('/admin') : page('login.html')(req, res)));
pages.use(auth.requireAuthPage);
pages.get('/', page('index.html'));
pages.get('/vtubers', page('vtubers.html'));
pages.get('/users', page('users.html'));
pages.get(['/moderation', '/moderation/ban', '/moderation/kick', '/moderation/warn'], (req, res) => (req.path === '/moderation' ? res.redirect('/admin/moderation/ban') : page('moderation.html')(req, res)));
pages.get('/popups', page('popups.html'));
pages.get('/marquee', page('marquee.html'));
pages.get('/fanart', page('fanart.html'));
pages.get('/forum', page('forum.html'));
pages.get('/news', page('news.html'));
pages.get('/news/add', page('news-form.html'));
pages.get('/news/:id/edit', (req, res) => (news.isValidId(req.params.id) ? page('news-form.html')(req, res) : res.status(404).send('Not found')));
pages.get('/vtubers/add', page('form.html'));
pages.get('/vtubers/:id/edit', (req, res) => (store.isValidId(req.params.id) ? page('form.html')(req, res) : res.status(404).send('Not found')));
pages.use((req, res) => res.status(404).send('Not found'));

// ---------- API ----------
const api = express.Router();
api.use(auth.sameOrigin);

api.post('/login', auth.loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !auth.checkCredentials(username, password)) {
    req.loginFail();
    return res.status(401).json({ success: false, error: 'Sai tài khoản hoặc mật khẩu' });
  }
  req.loginOk();
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ success: false, error: 'Lỗi session' });
    req.session.admin = true;
    req.session.save((err2) => (err2 ? res.status(500).json({ success: false, error: 'Không lưu được session' }) : ok(res, { loggedIn: true })));
  });
});
api.post('/logout', (req, res) => req.session.destroy(() => { res.clearCookie('vth.sid'); ok(res, { loggedIn: false }); }));
api.get('/me', (req, res) => ok(res, { loggedIn: auth.isAdmin(req), discordEnabled: discord.enabled(),
  admin: auth.isAdmin(req) ? (req.user ? { id: req.user.id, username: req.user.username, avatarUrl: req.user.avatarUrl, source: 'discord' } : { id: null, username: process.env.ADMIN_USERNAME || 'admin', avatarUrl: null, source: 'legacy' }) : null }));

api.use(auth.requireAuthApi);

api.get('/vtubers', wrap(async (req, res) => {
  const list = await store.list();
  ok(res, await Promise.all(list.map(async (v) => {
    const s = await getState(v, { cacheOnly: true }); // admin list khong goi mang
    return { ...v, avatarUrl: s.avatar, channelUrl: s.channel ? s.channel.url : null, status: v.enabled ? s.status : 'disabled', pending: s.meta.pending };
  })));
}));

api.get('/vtubers/:id', wrap(async (req, res) => {
  const v = await store.getBySlug(req.params.id);
  if (!v) throw new store.HttpError(404, 'Không tìm thấy VTuber');
  ok(res, v);
}));

api.post('/vtubers', wrap(async (req, res) => {
  const b = req.body || {};
  const data = pick(b, FIELDS);
  const yInput = typeof (b.youtube ?? b.youtubeChannelId) === 'string' ? (b.youtube ?? b.youtubeChannelId).trim() : '';
  store.validate({ name: data.name, ...data, youtubeChannelId: '' });            // validate som, truoc khi goi mang
  if (yInput) data.youtubeChannelId = (await verifyChannel(yInput)).id;          // sai => khong luu
  const item = await store.create(data);
  warm(item);
  res.status(201).json({ success: true, data: item });
}));

api.put('/vtubers/:id', wrap(async (req, res) => {
  const old = await store.getBySlug(req.params.id);
  if (!old) throw new store.HttpError(404, 'Không tìm thấy VTuber');
  const b = req.body || {};
  const patch = pick(b, FIELDS);
  store.validate(patch, { partial: true });
  const yRaw = b.youtube ?? b.youtubeChannelId;
  let changed = false;
  if (yRaw !== undefined) {
    const yInput = typeof yRaw === 'string' ? yRaw.trim() : '';
    if (!yInput) patch.youtubeChannelId = '';
    else { patch.youtubeChannelId = (await verifyChannel(yInput)).id; }
    changed = patch.youtubeChannelId !== old.youtubeChannelId;
  }
  const { after } = await store.update(old.id, patch);
  if (changed && old.youtubeChannelId) await cache.clearChannel(old.youtubeChannelId);
  warm(after);
  ok(res, after);
}));

api.delete('/vtubers/:id', wrap(async (req, res) => {
  const item = await store.remove(req.params.id);
  if (item.youtubeChannelId) await cache.clearChannel(item.youtubeChannelId);
  ok(res, { deleted: item.id });
}));

api.post('/vtubers/:id/toggle', wrap(async (req, res) => {
  const item = await store.toggle(req.params.id);
  warm(item);
  ok(res, item);
}));

api.post('/vtubers/:id/refresh', wrap(async (req, res) => {
  const v = await store.getBySlug(req.params.id);
  if (!v) throw new store.HttpError(404, 'Không tìm thấy VTuber');
  const s = await getState(v, { force: true });
  ok(res, { status: s.status, errors: s.meta.errors });
}));

// ---- Fan art: xem tat ca (ke ca cho duyet), duyet / tu choi (+ly do) / xoa ----
const adminView = { admin: true };
api.get('/fanart', wrap(async (req, res) => {
  const st = req.query.status;
  ok(res, await fanart.present(await fanart.list(fanart.STATUSES.includes(st) ? { status: st } : { all: true }), adminView));
}));
api.post('/fanart/:id/status', wrap(async (req, res) => { const b = req.body || {}; ok(res, (await fanart.present([await fanart.setStatus(String(req.params.id), b.status, b.reason)], adminView))[0]); }));
api.delete('/fanart/:id', wrap(async (req, res) => ok(res, { deleted: (await fanart.remove(String(req.params.id))).id })));

// ---- Forum: kiem duyet bai viet (chi Admin; requireAuthApi o tren da chan Guest/User) ----
api.get('/forum/summary', wrap(async (req, res) => ok(res, { posts: await forum.pendingCount(), fanart: await fanart.pendingCount() })));
api.get('/forum/posts', wrap(async (req, res) => ok(res, await forum.present(await forum.listAdmin({ status: req.query.status }), adminView))));
api.post('/forum/posts/:id/status', wrap(async (req, res) => { const b = req.body || {}; ok(res, (await forum.present(await forum.setStatus(req.params.id, b.status, b.reason), adminView))[0]); }));
api.delete('/forum/posts/:id', wrap(async (req, res) => ok(res, { deleted: (await forum.adminRemovePost(req.params.id)).id })));
api.get('/forum/posts/:id/comments', wrap(async (req, res) => ok(res, await forum.presentComments(await forum.listComments(String(req.params.id))))));
api.delete('/forum/comments/:id', wrap(async (req, res) => ok(res, { deleted: (await forum.adminRemoveComment(req.params.id)).id })));

// ---- Tin tuc ----
api.get('/news', wrap(async (req, res) => ok(res, await news.list({ all: true }))));
api.get('/news/:id', wrap(async (req, res) => {
  const n = await news.get(req.params.id, { all: true });
  if (!n) throw new store.HttpError(404, 'Không tìm thấy tin');
  ok(res, n);
}));
api.post('/news', wrap(async (req, res) => res.status(201).json({ success: true, data: await news.create(req.body || {}) })));
api.put('/news/:id', wrap(async (req, res) => ok(res, await news.update(req.params.id, req.body || {}))));
api.delete('/news/:id', wrap(async (req, res) => ok(res, { deleted: (await news.remove(req.params.id)).id })));


// ---- Dashboard: so lieu tong quan (chi doc) ----
api.get('/summary', wrap(async (req, res) => {
  const [mod, pop, mar, vt] = await Promise.all([moderation.summary(), ann.popup.count(), ann.marquee.count(), store.list()]);
  ok(res, { users: await users.count(), ...mod, pendingPosts: await forum.pendingCount(), pendingFanart: await fanart.pendingCount(),
    popups: pop, marquee: mar, vtubers: vt.length });
}));

// ---- Users + Moderation (ban / unban / kick / warn) ----
const idParam = (req) => { const id = String(req.params.id); if (!users.isValidId(id)) throw new store.HttpError(400, 'Discord ID không hợp lệ', 'userId'); return id; };
const userRow = (u, h) => ({ id: u.id, username: u.username, avatarUrl: discord.avatarUrl(u), role: discord.roleOf(u.id), createdAt: u.createdAt, updatedAt: u.updatedAt,
  ban: h ? h.ban : null, warnCount: h ? h.warns.length : 0, kickCount: h ? h.kicks.length : 0 });
async function withUsers(rows) {   // gan username/avatar hien tai cho ban ghi moderation
  const ids = [...new Set(rows.flatMap((r) => [r.userId]))];
  const m = new Map(await Promise.all(ids.map(async (id) => [id, await users.getById(id)])));
  return rows.map((r) => { const u = m.get(r.userId); return { ...r, user: u ? { id: u.id, username: u.username, avatarUrl: discord.avatarUrl(u) } : { id: r.userId, username: 'Không rõ', avatarUrl: null } }; });
}
api.get('/users', wrap(async (req, res) => {
  const found = await users.search(req.query.q, 50);
  const log = await moderation.list({ limit: 1e6 });
  const by = new Map();
  for (const r of log) { const h = by.get(r.userId) || { ban: null, warns: [], kicks: [] }; if (r.type === 'ban' && r.state === 'active' && !h.ban) h.ban = r; if (r.type === 'warn') h.warns.push(r); if (r.type === 'kick') h.kicks.push(r); by.set(r.userId, h); }
  ok(res, found.map((u) => userRow(u, by.get(u.id))));
}));
api.get('/users/:id', wrap(async (req, res) => {
  const u = await users.getById(idParam(req));
  if (!u) throw new store.HttpError(404, 'Không tìm thấy người dùng');
  const h = await moderation.history(u.id);
  ok(res, { ...userRow(u, h), history: h });
}));
api.post('/users/:id/ban', sensitive, wrap(async (req, res) => ok(res, await moderation.ban(idParam(req), actor(req), req.body || {}))));
api.post('/users/:id/unban', sensitive, wrap(async (req, res) => ok(res, await moderation.unban(idParam(req), actor(req)))));
api.post('/users/:id/kick', sensitive, wrap(async (req, res) => ok(res, await moderation.kick(idParam(req), actor(req), req.body || {}))));
api.post('/users/:id/warn', sensitive, wrap(async (req, res) => ok(res, await moderation.warn(idParam(req), actor(req), req.body || {}))));
api.get('/moderation', wrap(async (req, res) => ok(res, await withUsers(await moderation.list({ type: req.query.type, activeOnly: req.query.active === '1', limit: 200 })))));

// ---- Popup + Marquee (Admin CRUD; noi dung luu van ban thuan) ----
for (const [name, svc] of [['popups', ann.popup], ['marquee', ann.marquee]]) {
  api.get('/' + name, wrap(async (req, res) => ok(res, await svc.listAdmin())));
  api.post('/' + name, sensitive, wrap(async (req, res) => res.status(201).json({ success: true, data: await svc.create(req.body || {}, actor(req)) })));
  api.put('/' + name + '/:id', sensitive, wrap(async (req, res) => ok(res, await svc.update(String(req.params.id), req.body || {}))));
  api.post('/' + name + '/:id/toggle', sensitive, wrap(async (req, res) => ok(res, await svc.toggle(String(req.params.id)))));
  api.delete('/' + name + '/:id', sensitive, wrap(async (req, res) => ok(res, await svc.remove(String(req.params.id)))));
}

api.use((req, res) => res.status(404).json({ success: false, error: 'API không tồn tại' }));
module.exports = { pages, api };
