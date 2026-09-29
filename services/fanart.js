'use strict';
/**
 * Fan art gan voi tai khoan Discord (data/fanarts.json; tu doc file cu data/fanart.json neu co, khong mat du lieu).
 *   { id, authorId, username, image, thumb, title, description, status, rejectReason, createdAt, updatedAt }
 *  - authorId + username do BACKEND ghi tu session Discord; client khong gui / khong gia mao duoc.
 *  - username luu la anh chup luc dang; khi HIEN THI luon lay ten + avatar hien tai cua account (authorId la ID co dinh).
 *  - Moi bai moi = "pending". Sua bai approved/rejected => "pending" lai. Chi "approved" moi public.
 *  - Ban ghi cu (truoc khi co Discord) khong co authorId => hien nhu cu, ten lay tu truong `author` cu.
 */
const path = require('path');
const crypto = require('crypto');
const { upload, checkB64, err } = require('./imgbb');
const users = require('./users');
const forum = require('./forum');
const { makeList } = require('./jsonlist');

const DATA = path.join(__dirname, '..', 'data');
const list_ = makeList(() => process.env.FANART_FILE || path.join(DATA, 'fanarts.json'), {
  label: 'fanarts.json', legacyFile: () => (process.env.FANART_FILE ? null : path.join(DATA, 'fanart.json')),
});
const STATUSES = ['pending', 'approved', 'rejected'];
const LIMITS = { title: 80, description: 500, reason: 300, pendingPerUser: 10 };
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;    // ID cu (vd "old1") + ID moi (12 hex)
const isValidId = (id) => typeof id === 'string' && ID_RE.test(id);
const bad = (msg, field, status = 400) => Object.assign(err(status, msg), field ? { field } : {});
const str = (s) => (typeof s === 'string' ? s : '');

/** Ban ghi cu khong co status => da duyet (nhu truoc). Status co nhung la => "pending" (an toan). */
function norm(x) {
  const image = str(x.image) || str(x.url);
  return {
    id: x.id, authorId: users.isValidId(x.authorId) ? x.authorId : null, username: str(x.username) || str(x.author),
    image, thumb: str(x.thumb) || image, title: str(x.title), description: str(x.description),
    status: x.status === undefined ? 'approved' : STATUSES.includes(x.status) ? x.status : 'pending',
    rejectReason: str(x.rejectReason), createdAt: x.createdAt || null, updatedAt: x.updatedAt || x.createdAt || null,
    reviewedAt: x.reviewedAt || null, deleteUrl: str(x.deleteUrl),
  };
}
const read = async () => (await list_.read()).filter((x) => x && isValidId(x.id)).map(norm);
const byNewest = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt));

/** list() = chi anh da duyet (public). list({ all:true }) / list({ status }) cho admin; { authorId } loc theo tac gia. */
async function list({ status, all, authorId } = {}) {
  let a = await read();
  if (authorId) a = a.filter((x) => x.authorId === authorId);
  if (!all) a = a.filter((x) => x.status === (status || 'approved'));
  return a.sort(byNewest);
}
const get = async (id) => (isValidId(id) ? (await read()).find((x) => x.id === id) || null : null);

function mustUser(user) {
  if (!user || !users.isValidId(user.id) || typeof user.username !== 'string') throw err(401, 'Bạn cần đăng nhập bằng Discord');
  return user;
}
function fields(b) {
  return { title: forum.cleanText(b.title, LIMITS.title, 'title', 'Tiêu đề').replace(/\n+/g, ' '), description: forum.cleanText(b.description, LIMITS.description, 'description', 'Mô tả') };
}
const checkPending = (all, uid) => {
  if (all.filter((x) => x.authorId === uid && x.status === 'pending').length >= LIMITS.pendingPerUser) throw bad(`Bạn đang có quá nhiều Fan Art chờ duyệt (tối đa ${LIMITS.pendingPerUser}). Hãy đợi admin duyệt.`, null, 429);
};

/** Dang moi. `user` = req.user (tu session); body.authorId / username / status bi bo qua hoan toan. */
async function add(user, b) {
  const u = mustUser(user);
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad('Dữ liệu không hợp lệ');
  checkB64(b.image);
  const f = fields(b);
  checkPending(await read(), u.id);
  const d = await upload(b.image, f.title || undefined);
  const now = new Date().toISOString(), image = d.display_url || d.url;
  const item = { id: crypto.randomBytes(6).toString('hex'), authorId: u.id, username: u.username, image, thumb: (d.thumb && d.thumb.url) || image,
    ...f, status: 'pending', rejectReason: '', deleteUrl: d.delete_url || '', createdAt: now, updatedAt: now };
  await list_.tx((a) => { checkPending(a.filter((x) => x && isValidId(x.id)).map(norm), u.id); a.unshift(item); });
  return norm(item);
}

/** Chi tac gia. Nguoi khac: da public => 403, chua public => 404 (khong lo su ton tai). */
function own(x, uid) {
  if (!x) throw err(404, 'Không tìm thấy Fan Art');
  if (x.authorId !== uid) throw x.status === 'approved' ? err(403, 'Bạn chỉ có thể sửa/xóa Fan Art của mình') : err(404, 'Không tìm thấy Fan Art');
  return x;
}
/** Sua tieu de / mo ta / (tuy chon) anh moi. Luon ve "pending", xoa rejectReason. */
async function update(user, id, b) {
  const u = mustUser(user);
  if (!isValidId(id)) throw bad('ID không hợp lệ');
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad('Dữ liệu không hợp lệ');
  const cur = own(await get(id), u.id);
  const f = { title: b.title === undefined ? cur.title : fields(b).title, description: b.description === undefined ? cur.description : fields(b).description };
  let img = null;
  if (b.image !== undefined && b.image !== null && b.image !== '') { checkB64(b.image); img = await upload(b.image, f.title || undefined); }
  return list_.tx((a) => {
    const i = a.findIndex((x) => x && x.id === id);
    if (i < 0 || a[i].authorId !== u.id) throw err(404, 'Không tìm thấy Fan Art');
    const patch = { ...f, username: u.username, status: 'pending', rejectReason: '', updatedAt: new Date().toISOString() };
    if (img) Object.assign(patch, { image: img.display_url || img.url, thumb: (img.thumb && img.thumb.url) || img.url, deleteUrl: img.delete_url || '' });
    a[i] = { ...a[i], ...patch }; delete a[i].url;          // truong `url` cu (ban ghi legacy) khong duoc de lech voi `image`
    return norm(a[i]);
  });
}

const dropOne = (id, uid) => list_.tx((a) => {
  const i = a.findIndex((x) => x && x.id === id);
  if (i < 0) throw err(404, 'Không tìm thấy Fan Art');
  if (uid) own(norm(a[i]), uid);
  return norm(a.splice(i, 1)[0]);
});
const removeOwn = (user, id) => { const u = mustUser(user); if (!isValidId(id)) throw bad('ID không hợp lệ'); return dropOne(id, u.id); };
const remove = (id) => dropOne(id, null);   // admin

async function setStatus(id, status, reason) {
  if (!STATUSES.includes(status)) throw bad('Trạng thái không hợp lệ', 'status');
  let r = '';
  if (status === 'rejected') { r = forum.cleanText(reason, LIMITS.reason, 'reason', 'Lý do'); if (!r) throw bad('Cần nhập lý do từ chối', 'reason'); }
  return list_.tx((a) => {
    const i = a.findIndex((x) => x && x.id === id);
    if (i < 0) throw err(404, 'Không tìm thấy ảnh');
    a[i] = { ...a[i], status, rejectReason: r, reviewedAt: new Date().toISOString() };
    return norm(a[i]);
  });
}
const pendingCount = async () => (await read()).filter((x) => x.status === 'pending').length;

/**
 * Dang tra ve client: khong co deleteUrl. Ten + avatar lay tu account Discord HIEN TAI (fallback: ten luc dang / ten cu).
 * status + rejectReason chi cho chu bai va admin.
 */
async function present(items, { viewerId = null, admin = false } = {}) {
  const cache = new Map(), out = [];
  for (const x of items) {
    if (!cache.has(x.authorId)) cache.set(x.authorId, x.authorId ? await forum.authorOf(x.authorId).then((a) => (a.username === 'Người dùng Discord' && x.username ? { ...a, username: x.username } : a))
      : { id: null, username: x.username || 'Ẩn danh', avatarUrl: null });
    const o = { id: x.id, author: cache.get(x.authorId), image: x.image, url: x.image, thumb: x.thumb, title: x.title, description: x.description, createdAt: x.createdAt, updatedAt: x.updatedAt };
    if (admin || (viewerId && x.authorId === viewerId)) { o.status = x.status; o.rejectReason = x.rejectReason; }
    out.push(o);
  }
  return out;
}

module.exports = { list, get, add, update, removeOwn, remove, setStatus, pendingCount, present, isValidId, STATUSES, LIMITS };
