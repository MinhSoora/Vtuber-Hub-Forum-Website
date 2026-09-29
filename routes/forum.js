'use strict';
/**
 * Forum + Profile API.
 *   /api/forum/*  : posts / comments / reactions  (doc: ai cung duoc, chi thay "approved"; ghi: dang nhap Discord + CSRF token)
 *   /api/users/:id: profile cong khai (chi noi dung "approved")
 * userId/authorId LUON lay tu req.user (session server-side); body khong bao gio duoc tin cho danh tinh/quyen/trang thai.
 */
const express = require('express');
const auth = require('../middleware/auth');
const { makeUserLimiter, makeIpLimiter, stack } = require('../middleware/rateLimit');
const { requireCaptcha, honeypot } = require('../middleware/antispam');
const forum = require('../services/forum');
const fanart = require('../services/fanart');
const usersSvc = require('../services/users');
const discord = require('../services/discord');
const store = require('../services/store');
const captcha = require('../services/captcha');
const { wrap, ok } = require('./api');

const notFound = (m) => new store.HttpError(404, m);
const viewerOf = (req) => ({ viewerId: req.user ? req.user.id : null, admin: req.role === 'admin' });
const write = [auth.requireAuth, auth.requireCsrf, auth.requireConsent]; // dang nhap Discord + X-CSRF-Token + da dong y TOS/Rules hien hanh (server kiem tra users.json)

// Chong spam nhieu tang (thu tu: burst/phut -> theo gio -> theo IP). Tai khoan moi (<24h) bi siet chat hon.
const postLimit = stack(
  makeUserLimiter({ windowMs: 60e3, max: 3, message: 'Bạn đăng bài quá nhanh, hãy chờ một phút rồi thử lại.' }),
  makeUserLimiter({ windowMs: 3600e3, max: 10, newAccountMax: 3, message: 'Bạn đăng/sửa bài quá nhiều, thử lại sau ít phút.' }),
  makeIpLimiter({ windowMs: 3600e3, max: 30 }));
const commentLimit = stack(
  makeUserLimiter({ windowMs: 60e3, max: 6, message: 'Bạn bình luận quá nhanh, hãy chờ một chút.' }),
  makeUserLimiter({ windowMs: 10 * 60e3, max: 30, newAccountMax: 10, message: 'Bạn bình luận quá nhiều, thử lại sau ít phút.' }),
  makeIpLimiter({ windowMs: 10 * 60e3, max: 80 }));
const reactLimit = stack(makeUserLimiter({ windowMs: 60e3, max: 60 }), makeIpLimiter({ windowMs: 60e3, max: 150 }));
const deleteLimit = makeUserLimiter({ windowMs: 60e3, max: 30 });
const newContent = [honeypot(), requireCaptcha()];   // chi cho NOI DUNG MOI (bai/binh luan moi): Turnstile + o an

const api = express.Router();
api.use(auth.sameOrigin);

api.get('/meta', (req, res) => ok(res, { captcha: captcha.enabled(), reactions: forum.EMOJIS, maxImages: forum.LIMITS.images, contentMax: forum.LIMITS.content, commentMax: forum.LIMITS.comment }));

/* ---- posts ---- */
api.get('/posts', wrap(async (req, res) => {
  const r = await forum.listPublic({ page: req.query.page, limit: req.query.limit });   // guest chi thay approved
  ok(res, { items: await forum.present(r.items, viewerOf(req)), total: r.total, page: r.page, limit: r.limit });
}));
// Bai cua CHINH MINH (moi trang thai + ly do tu choi). Dat truoc /posts/:id.
api.get('/posts/mine', auth.requireAuth, wrap(async (req, res) => ok(res, await forum.present(await forum.listByAuthor(req.user.id), viewerOf(req)))));
api.get('/posts/:id', wrap(async (req, res) => {
  const p = await forum.getPost(req.params.id);
  const mine = p && req.user && p.authorId === req.user.id;
  if (!p || (p.status !== 'approved' && !mine && req.role !== 'admin')) throw notFound('Không tìm thấy bài viết'); // pending/rejected: 404 voi nguoi khac
  ok(res, (await forum.present(p, viewerOf(req)))[0]);
}));
api.post('/posts', ...write, postLimit, ...newContent, wrap(async (req, res) => {
  const p = await forum.createPost(req.user, req.body);                 // authorId = req.user.id, status = pending (cung bo qua moi truong khac)
  res.status(201).json({ success: true, data: (await forum.present(p, viewerOf(req)))[0] });
}));
api.put('/posts/:id', ...write, postLimit, wrap(async (req, res) => ok(res, (await forum.present(await forum.updatePost(req.user, req.params.id, req.body), viewerOf(req)))[0])));
api.delete('/posts/:id', ...write, deleteLimit, wrap(async (req, res) => ok(res, { deleted: (await forum.removePost(req.user, req.params.id)).id })));

/* ---- reaction: 1 user / 1 bai; POST = dat hoac doi, DELETE = bo ---- */
api.post('/posts/:id/reaction', ...write, reactLimit, wrap(async (req, res) => ok(res, (await forum.present(await forum.react(req.user, req.params.id, (req.body || {}).emoji), viewerOf(req)))[0])));
api.delete('/posts/:id/reaction', ...write, reactLimit, wrap(async (req, res) => ok(res, (await forum.present(await forum.unreact(req.user, req.params.id), viewerOf(req)))[0])));

/* ---- comments ---- */
api.get('/posts/:id/comments', wrap(async (req, res) => {
  const p = await forum.getPost(req.params.id);
  if (!p || p.status !== 'approved') throw notFound('Không tìm thấy bài viết');   // comment chi ton tai/hien tren bai approved
  ok(res, await forum.presentComments(await forum.listComments(p.id), req.user && req.user.id));
}));
api.post('/posts/:id/comments', ...write, commentLimit, ...newContent, wrap(async (req, res) => {
  const c = await forum.addComment(req.user, req.params.id, req.body);   // authorId tu session
  res.status(201).json({ success: true, data: (await forum.presentComments([c], req.user.id))[0] });
}));
api.put('/comments/:id', ...write, commentLimit, wrap(async (req, res) => ok(res, (await forum.presentComments([await forum.updateComment(req.user, req.params.id, req.body)], req.user.id))[0])));
api.delete('/comments/:id', ...write, deleteLimit, wrap(async (req, res) => ok(res, { deleted: (await forum.removeComment(req.user, req.params.id)).id })));

api.use((req, res) => res.status(404).json({ success: false, error: 'API không tồn tại' }));

/* ---- profile cong khai: /api/users/:id ---- */
const usersApi = express.Router();
usersApi.get('/:id', wrap(async (req, res) => {
  const id = req.params.id;
  const u = usersSvc.isValidId(id) ? await usersSvc.getById(id) : null;
  if (!u) throw notFound('Không tìm thấy người dùng');
  const v = viewerOf(req);
  // Chi noi dung approved cua user nay. Khong tra role, session, token hay bat ky du lieu quan tri nao.
  const [pp, fa] = await Promise.all([forum.listPublic({ authorId: id, limit: 50 }), fanart.list({ authorId: id })]);
  ok(res, {
    user: { id: u.id, username: u.username, avatarUrl: discord.avatarUrl(u), createdAt: u.createdAt, isSelf: !!req.user && req.user.id === u.id },
    posts: await forum.present(pp.items, v), postTotal: pp.total,
    fanarts: await fanart.present(fa.slice(0, 60), v), fanartTotal: fa.length,
  });
}));
usersApi.use((req, res) => res.status(404).json({ success: false, error: 'API không tồn tại' }));

module.exports = { api, usersApi };
