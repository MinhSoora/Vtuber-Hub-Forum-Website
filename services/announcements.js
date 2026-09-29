'use strict';
/**
 * Thong bao do Admin quan ly (dung chung kho jsonlist):
 *   popup   -> data/popups.json   { id, title, message, type, audience, enabled, startsAt, endsAt, createdBy, createdAt, updatedAt }
 *   marquee -> data/marquee.json  { id, text, link, enabled, startsAt, endsAt, createdBy, createdAt, updatedAt }
 *  - Noi dung luu dang VAN BAN THUAN (bo tag HTML + ky tu dieu khien/bidi); frontend chi render bang textContent.
 *  - link chi nhan http(s). createdBy do route truyen tu session, client khong gui.
 *  - "Active" = enabled va now nam trong [startsAt, endsAt] (moc trong = khong gioi han).
 */
const path = require('path');
const crypto = require('crypto');
const forum = require('./forum');
const { err } = require('./imgbb');
const { makeList } = require('./jsonlist');

const DATA = path.join(__dirname, '..', 'data');
const ID_RE = /^[a-f0-9]{12}$/;
const isValidId = (id) => typeof id === 'string' && ID_RE.test(id);
const bad = (msg, field, status = 400) => Object.assign(err(status, msg), field ? { field } : {});
const POPUP_TYPES = ['info', 'success', 'warning', 'danger'], AUDIENCES = ['all', 'guests', 'users'];

const plain = (v, max, field, label, { required = true, multiline = false } = {}) => {
  let s = forum.cleanText(v, max * 4, field, label).replace(/<[^>]*>/g, '').replace(/[<>]/g, '');
  s = multiline ? s.replace(/[ \t]+/g, ' ').trim() : s.replace(/\s+/g, ' ').trim();
  if (required && !s) throw bad(`${label} không được để trống`, field);
  if (s.length > max) throw bad(`${label} tối đa ${max} ký tự`, field);
  return s;
};
function link(v) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string' || v.length > 500) throw bad('Link không hợp lệ (tối đa 500 ký tự)', 'link');
  let u; try { u = new URL(v.trim()); } catch { throw bad('Link không hợp lệ', 'link'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw bad('Link chỉ nhận http(s)://', 'link');
  return u.toString();
}
function when(v, field, label) {
  if (v === undefined || v === null || v === '') return null;
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  if (isNaN(t)) throw bad(`${label} không hợp lệ`, field);
  return new Date(t).toISOString();
}
const bool = (v, field) => { if (v !== true && v !== false) throw bad(`${field} phải là true/false`, field); return v; };
const has = (b, k) => b[k] !== undefined;

function makeKind(file, label, fieldsFn, pub) {
  const L = makeList(() => process.env[file.env] || path.join(DATA, file.name), { label: file.name });
  const read = async () => (await L.read()).filter((x) => x && isValidId(x.id));
  const isActive = (x, now = Date.now()) => x.enabled === true && (!x.startsAt || Date.parse(x.startsAt) <= now) && (!x.endsAt || Date.parse(x.endsAt) > now);
  const sort = (a) => a.sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)));
  function schedule(b, cur = {}) {
    const startsAt = has(b, 'startsAt') ? when(b.startsAt, 'startsAt', 'Thời gian bắt đầu') : cur.startsAt || null;
    const endsAt = has(b, 'endsAt') ? when(b.endsAt, 'endsAt', 'Thời gian kết thúc') : cur.endsAt || null;
    if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) throw bad('Thời gian kết thúc phải sau thời gian bắt đầu', 'endsAt');
    return { startsAt, endsAt };
  }
  return {
    isActive, isValidId,
    /** Admin: tat ca, kem co isLive de UI hien trang thai. */
    async listAdmin() { return sort(await read()).map((x) => ({ ...x, live: isActive(x) })); },
    async get(id) { return isValidId(id) ? (await read()).find((x) => x.id === id) || null : null; },
    /** Public: chi ban ghi dang active, chi truong an toan. */
    async listPublic(ctx) { return sort((await read()).filter((x) => isActive(x))).map((x) => pub(x)).filter((x) => x && (!ctx || (x.audience === undefined) || ctx(x))); },
    async create(b, adminId) {
      if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad('Dữ liệu không hợp lệ');
      const now = new Date().toISOString();
      const item = { id: crypto.randomBytes(6).toString('hex'), ...fieldsFn(b), enabled: has(b, 'enabled') ? bool(b.enabled, 'enabled') : true, ...schedule(b), createdBy: adminId, createdAt: now, updatedAt: now };
      await L.tx((a) => { a.push(item); }); return { ...item, live: isActive(item) };
    },
    async update(id, b) {
      if (!isValidId(id)) throw bad('ID không hợp lệ', null, 400);
      if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad('Dữ liệu không hợp lệ');
      return L.tx((a) => {
        const i = a.findIndex((x) => x && x.id === id); if (i < 0) throw bad(`Không tìm thấy ${label}`, null, 404);
        const cur = a[i];
        a[i] = { ...cur, ...fieldsFn(b, true), ...(has(b, 'enabled') ? { enabled: bool(b.enabled, 'enabled') } : {}), ...schedule(b, cur), updatedAt: new Date().toISOString() };
        return { ...a[i], live: isActive(a[i]) };
      });
    },
    toggle(id) {
      if (!isValidId(id)) throw bad('ID không hợp lệ');
      return L.tx((a) => { const x = a.find((y) => y && y.id === id); if (!x) throw bad(`Không tìm thấy ${label}`, null, 404); x.enabled = !x.enabled; x.updatedAt = new Date().toISOString(); return { ...x, live: isActive(x) }; });
    },
    remove(id) {
      if (!isValidId(id)) throw bad('ID không hợp lệ');
      return L.tx((a) => { const i = a.findIndex((y) => y && y.id === id); if (i < 0) throw bad(`Không tìm thấy ${label}`, null, 404); return { id: a.splice(i, 1)[0].id }; });
    },
    async count() { const a = await read(); return { total: a.length, active: a.filter((x) => isActive(x)).length }; },
  };
}

const popup = makeKind({ env: 'POPUPS_FILE', name: 'popups.json' }, 'popup', (b, partial) => {
  const o = {}, need = (k) => !partial || has(b, k);
  if (need('title')) o.title = plain(b.title, 100, 'title', 'Tiêu đề');
  if (need('message')) o.message = plain(b.message, 1000, 'message', 'Nội dung', { multiline: true });
  if (need('type')) { const t = has(b, 'type') ? b.type : 'info'; if (!POPUP_TYPES.includes(t)) throw bad('Loại popup không hợp lệ', 'type'); o.type = t; }
  if (need('audience')) { const t = has(b, 'audience') ? b.audience : 'all'; if (!AUDIENCES.includes(t)) throw bad('Đối tượng không hợp lệ', 'audience'); o.audience = t; }
  return o;
}, (x) => ({ id: x.id, title: x.title, message: x.message, type: POPUP_TYPES.includes(x.type) ? x.type : 'info', audience: AUDIENCES.includes(x.audience) ? x.audience : 'all', updatedAt: x.updatedAt }));

const marquee = makeKind({ env: 'MARQUEE_FILE', name: 'marquee.json' }, 'thông báo chạy', (b, partial) => {
  const o = {};
  if (!partial || has(b, 'text')) o.text = plain(b.text, 200, 'text', 'Nội dung');
  if (!partial || has(b, 'link')) o.link = link(b.link);
  return o;
}, (x) => ({ id: x.id, text: x.text, link: x.link || '' }));

/** Popup hien cho nguoi xem hien tai: loc theo audience dua tren req.user (server), khong tin client. */
async function popupsFor(user) {
  const rows = await popup.listPublic();
  return rows.filter((x) => x.audience === 'all' || (x.audience === 'guests' && !user) || (x.audience === 'users' && !!user)).map(({ audience, ...r }) => r);
}
module.exports = { popup, marquee, popupsFor, POPUP_TYPES, AUDIENCES };
