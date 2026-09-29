'use strict';
/**
 * Moderation (ban / unban / kick / warn) luu trong data/moderation.json - dung chung kho jsonlist
 * (khoa tuan tu + ghi atomic) nhu forum/fanart. Ban ghi la nhat ky chi-them (append-only):
 *   { id, type:'ban'|'warn'|'kick', userId, reason, adminId, createdAt,
 *     // rieng ban:
 *     expiresAt (ISO | null = vinh vien), revokedAt?, revokedBy? }
 *  - adminId do ROUTE truyen tu session, client khong gui.
 *  - Trang thai ban duoc suy ra luc doc (het han theo expiresAt, go ban theo revokedAt) => khong can cron.
 *  - Bo nho dem (cache) de middleware xac thuc kiem tra ban moi request ma khong doc dia.
 */
const path = require('path');
const crypto = require('crypto');
const users = require('./users');
const discord = require('./discord');
const sessions = () => require('./sessionStore').get();   // require luoi: chi can khi ban/kick
const forum = require('./forum');
const { err } = require('./imgbb');
const { makeList } = require('./jsonlist');

const L = makeList(() => process.env.MODERATION_FILE || path.join(__dirname, '..', 'data', 'moderation.json'), { label: 'moderation.json' });
const LIMITS = { reason: 300, maxBanMinutes: 60 * 24 * 365 * 5 };
const TYPES = ['ban', 'warn', 'kick'];
const ID_RE = /^[a-f0-9]{12}$/;
const isValidId = (id) => typeof id === 'string' && ID_RE.test(id);

let cache = null;
const all = async () => cache || (cache = (await L.read()).filter((x) => x && TYPES.includes(x.type) && users.isValidId(x.userId)));
const tx = async (fn) => { const out = await L.tx(async (a) => { const r = await fn(a); cache = null; return r; }); return out; };
const bad = (msg, field, status = 400) => Object.assign(err(status, msg), field ? { field } : {});
const newId = () => crypto.randomBytes(6).toString('hex');

/** Lay ly do: van ban thuan, 1..300 ky tu, bo tag HTML (bat buoc). */
function cleanReason(v) {
  const s = forum.cleanText(v, LIMITS.reason * 4, 'reason', 'Lý do').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (!s) throw bad('Cần nhập lý do', 'reason');
  if (s.length > LIMITS.reason) throw bad(`Lý do tối đa ${LIMITS.reason} ký tự`, 'reason');
  return s;
}
const isActive = (b, now = Date.now()) => b.type === 'ban' && !b.revokedAt && (!b.expiresAt || Date.parse(b.expiresAt) > now);
const banState = (b, now = Date.now()) => (b.revokedAt ? 'revoked' : b.expiresAt && Date.parse(b.expiresAt) <= now ? 'expired' : 'active');
const view = (x) => ({ ...x, ...(x.type === 'ban' ? { state: banState(x) } : {}) });

/** Ban dang co hieu luc cua user (hoac null). Duoc middleware auth goi o MOI request. */
async function activeBan(userId) {
  if (!users.isValidId(userId)) return null;
  const now = Date.now();
  const b = (await all()).find((x) => x.userId === userId && isActive(x, now));
  return b ? { id: b.id, reason: b.reason, expiresAt: b.expiresAt || null, createdAt: b.createdAt } : null;
}

/** Kiem tra doi tuong hop le: ton tai trong users.json, khong phai chinh admin, khong phai admin khac. */
async function target(userId, actorId) {
  if (!users.isValidId(userId)) throw bad('Discord ID không hợp lệ', 'userId');
  const u = await users.getById(userId);
  if (!u) throw bad('Không tìm thấy người dùng', 'userId', 404);
  if (userId === actorId) throw bad('Bạn không thể tự xử lý chính mình', 'userId', 403);
  if (discord.roleOf(userId) === 'admin') throw bad('Không thể xử lý một Admin khác (chưa có cơ chế phân quyền Admin)', 'userId', 403);
  return u;
}

/** duration: { permanent:true } | { minutes:int } -> expiresAt (ISO | null) */
function expiry({ permanent, minutes } = {}) {
  if (permanent === true) return null;
  const m = Number(minutes);
  if (!Number.isInteger(m) || m < 1 || m > LIMITS.maxBanMinutes) throw bad('Thời hạn ban không hợp lệ (1 phút – 5 năm) hoặc chọn vĩnh viễn', 'duration');
  return new Date(Date.now() + m * 60e3).toISOString();
}

async function ban(userId, actorId, b = {}) {
  await target(userId, actorId);
  const reason = cleanReason(b.reason), expiresAt = expiry({ permanent: b.permanent, minutes: b.durationMinutes });
  const rec = await tx(async (a) => {
    if (a.some((x) => x.userId === userId && isActive(x))) throw bad('Người dùng này đang bị ban', 'userId', 409);
    const r = { id: newId(), type: 'ban', userId, reason, adminId: actorId, createdAt: new Date().toISOString(), expiresAt };
    a.push(r); return r;
  });
  sessions().destroyUser(userId);      // bi ban => mat phien hien tai ngay
  return view(rec);
}
async function unban(userId, actorId) {
  if (!users.isValidId(userId)) throw bad('Discord ID không hợp lệ', 'userId');
  return view(await tx(async (a) => {
    const r = a.find((x) => x.userId === userId && isActive(x));
    if (!r) throw bad('Người dùng này không bị ban', 'userId', 404);
    r.revokedAt = new Date().toISOString(); r.revokedBy = actorId; return r;
  }));
}
async function warn(userId, actorId, b = {}) {
  await target(userId, actorId);
  const reason = cleanReason(b.reason);
  return view(await tx(async (a) => { const r = { id: newId(), type: 'warn', userId, reason, adminId: actorId, createdAt: new Date().toISOString() }; a.push(r); return r; }));
}
async function kick(userId, actorId, b = {}) {
  await target(userId, actorId);
  const reason = cleanReason(b.reason);
  const rec = await tx(async (a) => { const r = { id: newId(), type: 'kick', userId, reason, adminId: actorId, createdAt: new Date().toISOString() }; a.push(r); return r; });
  return { ...view(rec), sessionsClosed: sessions().destroyUser(userId) };  // invalidate moi session hien co cua user
}

/** Lich su cua 1 user (moi nhat truoc). */
async function history(userId) {
  const rows = (await all()).filter((x) => x.userId === userId).map(view).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { ban: rows.find((x) => x.type === 'ban' && x.state === 'active') || null, bans: rows.filter((x) => x.type === 'ban'), warns: rows.filter((x) => x.type === 'warn'), kicks: rows.filter((x) => x.type === 'kick') };
}
/** Nhat ky toan he thong; type=ban co the loc { activeOnly }. */
async function list({ type, activeOnly, limit = 200 } = {}) {
  let rows = (await all()).map(view);
  if (TYPES.includes(type)) rows = rows.filter((x) => x.type === type);
  if (activeOnly) rows = rows.filter((x) => x.type === 'ban' && x.state === 'active');
  return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit);
}
async function summary() {
  const rows = (await all()).map(view);
  return { activeBans: rows.filter((x) => x.state === 'active').length, warns: rows.filter((x) => x.type === 'warn').length, kicks: rows.filter((x) => x.type === 'kick').length };
}
const _resetCache = () => { cache = null; };

module.exports = { activeBan, ban, unban, warn, kick, history, list, summary, cleanReason, isValidId, LIMITS, _resetCache };
