'use strict';
/**
 * Forum dang social feed: posts + comments + reactions (data/posts.json, data/comments.json).
 *
 * Quy tac (thuc thi o DAY, khong o frontend):
 *  - authorId LUON do route truyen tu session (user.id); client gui authorId/status/rejectReason/reactions bi bo qua.
 *  - Bai moi => "pending". Sua bai approved/rejected => "pending" lai, xoa rejectReason.
 *  - Chi "approved" moi public, moi duoc reaction / comment. pending & rejected chi tac gia (va admin) thay.
 *  - Moi user 1 reaction / bai (reactions = { [userId]: emoji }); API chi tra so dem + reaction cua chinh nguoi xem.
 *  - Noi dung luu dang van ban thuan (bo ky tu dieu khien / bidi); frontend chi render bang textContent.
 */
const path = require('path');
const crypto = require('crypto');
const { upload, checkB64, err } = require('./imgbb');
const users = require('./users');
const discord = require('./discord');
const { makeList } = require('./jsonlist');

const DATA = path.join(__dirname, '..', 'data');
const posts = makeList(() => process.env.POSTS_FILE || path.join(DATA, 'posts.json'), { label: 'posts.json' });
const comments = makeList(() => process.env.COMMENTS_FILE || path.join(DATA, 'comments.json'), { label: 'comments.json' });

const STATUSES = ['pending', 'approved', 'rejected'];
const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡'];
const stripVS = (s) => String(s).replace(/\uFE0F/g, '');
const EMOJI_MAP = new Map(EMOJIS.map((e) => [stripVS(e), e]));
const LIMITS = { content: 5000, comment: 1000, images: 4, reason: 300, pendingPerUser: 10, dupWindowMs: 10 * 60e3, commentDupMs: 60e3 };
const ID_RE = /^[a-f0-9]{12}$/;
const BAD_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

const bad = (msg, field, status = 400) => Object.assign(err(status, msg), field ? { field } : {});
const isValidId = (id) => typeof id === 'string' && ID_RE.test(id);
const newId = () => crypto.randomBytes(6).toString('hex');
const obj = (b) => { if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad('Dữ liệu không hợp lệ'); return b; };
const checkId = (id) => { if (!isValidId(id)) throw bad('ID không hợp lệ'); return id; };
/** userId chi lay tu session (req.user.id) - khong bao gio tu body. */
function mustUser(user) {
  if (!user || !users.isValidId(user.id)) throw err(401, 'Bạn cần đăng nhập bằng Discord');
  return user.id;
}
function cleanText(v, max, field, label) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw bad(`${label} không hợp lệ`, field);
  const s = v.replace(/\r\n?/g, '\n').replace(BAD_CHARS, '').replace(/\n{4,}/g, '\n\n\n').trim();
  if (s.length > max) throw bad(`${label} tối đa ${max} ký tự`, field);
  return s;
}

/** Ban ghi tu file -> dang chuan. Trang thai la/thieu => "pending" (an toan: khong bao gio tu dong public). */
const norm = (p) => ({
  id: p.id, authorId: users.isValidId(p.authorId) ? p.authorId : null,
  content: typeof p.content === 'string' ? p.content : '',
  images: Array.isArray(p.images) ? p.images.filter((u) => typeof u === 'string') : [],
  status: STATUSES.includes(p.status) ? p.status : 'pending',
  rejectReason: typeof p.rejectReason === 'string' ? p.rejectReason : '',
  reactions: p.reactions && typeof p.reactions === 'object' && !Array.isArray(p.reactions) ? p.reactions : {},
  createdAt: p.createdAt || null, updatedAt: p.updatedAt || p.createdAt || null, reviewedAt: p.reviewedAt || null,
});
const readPosts = async () => (await posts.read()).filter((p) => p && isValidId(p.id)).map(norm);
const byNewest = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt));

/* ---------------- anh ---------------- */
/** keep = URL giu lai (CHI nhan URL da co san trong bai => client khong chen duoc URL tuy y); newImages = base64 can upload. */
function prepareImages(b, existing) {
  let keep = existing;
  if (b.images !== undefined) {
    if (!Array.isArray(b.images) || b.images.length > LIMITS.images) throw bad('Danh sách ảnh không hợp lệ', 'images');
    keep = existing.filter((u) => b.images.includes(u));
  }
  const fresh = b.newImages === undefined ? [] : b.newImages;
  if (!Array.isArray(fresh)) throw bad('Danh sách ảnh không hợp lệ', 'images');
  if (keep.length + fresh.length > LIMITS.images) throw bad(`Tối đa ${LIMITS.images} ảnh mỗi bài`, 'images');
  fresh.forEach((x) => checkB64(x));
  return { keep, fresh };
}
async function uploadAll(fresh) {
  const urls = [];
  for (const x of fresh) { const d = await upload(x); urls.push(d.display_url || d.url); }
  return urls;
}

/* ---------------- chong spam ---------------- */
function guardPost(all, uid, content) {
  const mine = all.filter((p) => p.authorId === uid);
  if (mine.filter((p) => p.status === 'pending').length >= LIMITS.pendingPerUser) throw bad(`Bạn đang có quá nhiều bài chờ duyệt (tối đa ${LIMITS.pendingPerUser}). Hãy đợi admin duyệt.`, null, 429);
  if (content && mine.some((p) => p.content === content && Date.now() - Date.parse(p.createdAt) < LIMITS.dupWindowMs)) throw bad('Bạn vừa đăng nội dung này rồi.', 'content', 409);
}

/* ---------------- bai viet ---------------- */
async function createPost(user, b) {
  const uid = mustUser(user); b = obj(b);
  const content = cleanText(b.content, LIMITS.content, 'content', 'Nội dung');
  const { fresh } = prepareImages(b, []);
  if (!content && !fresh.length) throw bad('Bài viết cần có nội dung hoặc ảnh', 'content');
  guardPost(await readPosts(), uid, content);                 // kiem tra som, truoc khi ton upload
  const images = await uploadAll(fresh);
  const now = new Date().toISOString();
  const post = { id: newId(), authorId: uid, content, images, status: 'pending', rejectReason: '', reactions: {}, createdAt: now, updatedAt: now };
  await posts.tx((a) => { guardPost(a.filter((p) => p && isValidId(p.id)).map(norm), uid, content); a.unshift(post); });
  return norm(post);
}

/** Chi tac gia. Nguoi khac: bai da public => 403, bai chua public => 404 (khong lo su ton tai). */
function own(p, uid) {
  if (!p) throw err(404, 'Không tìm thấy bài viết');
  if (p.authorId !== uid) throw p.status === 'approved' ? err(403, 'Bạn chỉ có thể sửa/xóa bài viết của mình') : err(404, 'Không tìm thấy bài viết');
  return p;
}

async function updatePost(user, id, b) {
  const uid = mustUser(user); checkId(id); b = obj(b);
  const cur = own((await readPosts()).find((p) => p.id === id), uid);
  const content = b.content === undefined ? cur.content : cleanText(b.content, LIMITS.content, 'content', 'Nội dung');
  const { keep, fresh } = prepareImages(b, cur.images);
  if (!content && !keep.length && !fresh.length) throw bad('Bài viết cần có nội dung hoặc ảnh', 'content');
  const uploaded = await uploadAll(fresh);
  return posts.tx((a) => {
    const i = a.findIndex((p) => p && p.id === id);
    if (i < 0 || a[i].authorId !== uid) throw err(404, 'Không tìm thấy bài viết');
    // Chi content/images duoc doi. status luon ve "pending"; rejectReason bi xoa; authorId/reactions giu nguyen.
    a[i] = { ...a[i], content, images: [...keep, ...uploaded], status: 'pending', rejectReason: '', updatedAt: new Date().toISOString() };
    return norm(a[i]);
  });
}

async function dropPost(id, uid) {
  const removed = await posts.tx((a) => {
    const i = a.findIndex((p) => p && p.id === id);
    if (i < 0) throw err(404, 'Không tìm thấy bài viết');
    if (uid) own(norm(a[i]), uid);
    return a.splice(i, 1)[0];
  });
  await comments.tx((a) => { for (let i = a.length - 1; i >= 0; i--) if (a[i] && a[i].postId === id) a.splice(i, 1); });
  return norm(removed);
}
const removePost = (user, id) => { const uid = mustUser(user); checkId(id); return dropPost(id, uid); };
const adminRemovePost = (id) => dropPost(checkId(id), null);

const getPost = async (id) => (isValidId(id) ? (await readPosts()).find((p) => p.id === id) || null : null);
/** Public: chi approved. */
async function listPublic({ page = 1, limit = 20, authorId } = {}) {
  limit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50); page = Math.max(parseInt(page, 10) || 1, 1);
  const all = (await readPosts()).filter((p) => p.status === 'approved' && (!authorId || p.authorId === authorId)).sort(byNewest);
  return { items: all.slice((page - 1) * limit, page * limit), total: all.length, page, limit };
}
const listByAuthor = async (uid) => (await readPosts()).filter((p) => p.authorId === uid).sort(byNewest); // moi trang thai - chi cho chinh chu
async function listAdmin({ status } = {}) {
  const all = (await readPosts()).sort(byNewest);
  return STATUSES.includes(status) ? all.filter((p) => p.status === status) : all;
}
const pendingCount = async () => (await readPosts()).filter((p) => p.status === 'pending').length;

async function setStatus(id, status, reason) {
  checkId(id);
  if (!STATUSES.includes(status)) throw bad('Trạng thái không hợp lệ', 'status');
  let r = '';
  if (status === 'rejected') {
    r = cleanText(reason, LIMITS.reason, 'reason', 'Lý do');
    if (!r) throw bad('Cần nhập lý do từ chối', 'reason');
  }
  return posts.tx((a) => {
    const i = a.findIndex((p) => p && p.id === id);
    if (i < 0) throw err(404, 'Không tìm thấy bài viết');
    a[i] = { ...a[i], status, rejectReason: r, reviewedAt: new Date().toISOString() };
    return norm(a[i]);
  });
}

/* ---------------- reaction ---------------- */
async function react(user, postId, emoji) {
  const uid = mustUser(user); checkId(postId);
  const e = EMOJI_MAP.get(stripVS(typeof emoji === 'string' ? emoji : ''));
  if (!e) throw bad('Reaction không hợp lệ', 'emoji');
  return posts.tx((a) => {
    const i = a.findIndex((p) => p && p.id === postId);
    if (i < 0 || norm(a[i]).status !== 'approved') throw err(404, 'Không tìm thấy bài viết');
    a[i] = { ...a[i], reactions: { ...norm(a[i]).reactions, [uid]: e } };   // 1 user = 1 reaction: ghi de = doi reaction
    return norm(a[i]);
  });
}
async function unreact(user, postId) {
  const uid = mustUser(user); checkId(postId);
  return posts.tx((a) => {
    const i = a.findIndex((p) => p && p.id === postId);
    if (i < 0 || norm(a[i]).status !== 'approved') throw err(404, 'Không tìm thấy bài viết');
    const r = { ...norm(a[i]).reactions }; delete r[uid]; a[i] = { ...a[i], reactions: r };
    return norm(a[i]);
  });
}

/* ---------------- comment ---------------- */
const readComments = async () => (await comments.read()).filter((c) => c && isValidId(c.id) && isValidId(c.postId) && users.isValidId(c.authorId));
async function addComment(user, postId, b) {
  const uid = mustUser(user); checkId(postId); b = obj(b);
  const post = await getPost(postId);
  if (!post || post.status !== 'approved') throw err(404, 'Không tìm thấy bài viết');   // chi comment tren bai approved
  const content = cleanText(b.content, LIMITS.comment, 'content', 'Bình luận');
  if (!content) throw bad('Bình luận không được để trống', 'content');
  const now = new Date().toISOString();
  const c = { id: newId(), postId, authorId: uid, content, createdAt: now, updatedAt: now };
  await comments.tx((a) => {
    if (a.some((x) => x && x.postId === postId && x.authorId === uid && x.content === content && Date.now() - Date.parse(x.createdAt) < LIMITS.commentDupMs)) throw bad('Bạn vừa gửi bình luận này rồi.', 'content', 409);
    a.push(c);
  });
  return c;
}
async function findComment(id) { const c = (await readComments()).find((x) => x.id === checkId(id)); if (!c) throw err(404, 'Không tìm thấy bình luận'); return c; }
async function updateComment(user, id, b) {
  const uid = mustUser(user); b = obj(b);
  const cur = await findComment(id);
  if (cur.authorId !== uid) throw err(403, 'Bạn chỉ có thể sửa bình luận của mình');
  const post = await getPost(cur.postId);
  if (!post || post.status !== 'approved') throw err(404, 'Không tìm thấy bài viết');
  const content = cleanText(b.content, LIMITS.comment, 'content', 'Bình luận');
  if (!content) throw bad('Bình luận không được để trống', 'content');
  return comments.tx((a) => {
    const i = a.findIndex((x) => x && x.id === id);
    if (i < 0 || a[i].authorId !== uid) throw err(404, 'Không tìm thấy bình luận');
    a[i] = { ...a[i], content, updatedAt: new Date().toISOString() }; return a[i];
  });
}
async function dropComment(id, uid) {
  return comments.tx((a) => {
    const i = a.findIndex((x) => x && x.id === id);
    if (i < 0) throw err(404, 'Không tìm thấy bình luận');
    if (uid && a[i].authorId !== uid) throw err(403, 'Bạn chỉ có thể xóa bình luận của mình');
    return a.splice(i, 1)[0];
  });
}
const removeComment = (user, id) => { const uid = mustUser(user); return dropComment(checkId(id), uid); };
const adminRemoveComment = (id) => dropComment(checkId(id), null);
async function listComments(postId, { limit = 200 } = {}) {
  return (await readComments()).filter((c) => c.postId === postId).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).slice(0, limit);
}
async function commentCounts(ids) {
  const want = new Set(ids), m = {};
  for (const c of await readComments()) if (want.has(c.postId)) m[c.postId] = (m[c.postId] || 0) + 1;
  return m;
}

/* ---------------- trinh bay (chi truong an toan de tra ve client) ---------------- */
const authorOf = async (id) => (id && (await users.publicInfo(id))) || { id: id || null, username: 'Người dùng Discord', avatarUrl: discord.avatarUrl({ id: id || '0' }) };

/** Ten + avatar lay tu account HIEN TAI (doi username Discord => hien ten moi); authorId van la Discord ID co dinh. */
async function present(list, { viewerId = null, admin = false } = {}) {
  const arr = Array.isArray(list) ? list : [list];
  const counts = await commentCounts(arr.map((p) => p.id));
  const cache = new Map(), out = [];
  for (const p of arr) {
    if (!cache.has(p.authorId)) cache.set(p.authorId, await authorOf(p.authorId));
    const rc = Object.fromEntries(EMOJIS.map((e) => [e, 0]));
    for (const v of Object.values(p.reactions)) if (v in rc) rc[v]++;
    const o = { id: p.id, author: cache.get(p.authorId), content: p.content, images: p.images, createdAt: p.createdAt, updatedAt: p.updatedAt,
      reactions: { counts: rc, total: Object.values(rc).reduce((s, n) => s + n, 0) }, myReaction: viewerId ? p.reactions[viewerId] || null : null, commentCount: counts[p.id] || 0 };
    if (admin || (viewerId && p.authorId === viewerId)) { o.status = p.status; o.rejectReason = p.rejectReason; }   // status/reason: chi chu bai + admin
    out.push(o);
  }
  return out;
}
async function presentComments(list, viewerId = null) {
  const cache = new Map(), out = [];
  for (const c of list) {
    if (!cache.has(c.authorId)) cache.set(c.authorId, await authorOf(c.authorId));
    out.push({ id: c.id, postId: c.postId, author: cache.get(c.authorId), content: c.content, createdAt: c.createdAt, updatedAt: c.updatedAt, mine: !!viewerId && c.authorId === viewerId });
  }
  return out;
}

module.exports = {
  STATUSES, EMOJIS, LIMITS, isValidId, cleanText, authorOf,
  createPost, updatePost, removePost, adminRemovePost, getPost, listPublic, listByAuthor, listAdmin, pendingCount, setStatus,
  react, unreact, addComment, updateComment, removeComment, adminRemoveComment, listComments,
  present, presentComments,
};
