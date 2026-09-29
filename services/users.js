'use strict';
/**
 * Luu tru nguoi dung Discord vao data/users.json (cung pattern voi store.js / fanart.js:
 * khoa tuan tu, ghi atomic tmp+rename, file hong thi bao loi va KHONG ghi de).
 *
 * Schema toi thieu (khong luu token/email/secret nao cua Discord):
 *   { id, username, avatar, createdAt, updatedAt, tosAcceptedAt?, communityRulesAcceptedAt?, termsVersion? }
 *   - tosAcceptedAt / communityRulesAcceptedAt / termsVersion: consent do SERVER ghi (services/legal.js), khong nhan tu client
 *   - id       : Discord ID (snowflake, chuoi so) - chinh la "userId" cua he thong
 *   - avatar   : avatar hash cua Discord (hoac null neu dung avatar mac dinh)
 *
 * Doc file 1 lan roi giu trong bo nho (server chay 1 process), moi thay doi ghi xuong đĩa
 * truoc khi cap nhat cache => restart khong mat du lieu.
 */
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { HttpError } = require('./store');
const discord = require('./discord');

const FILE = () => process.env.USERS_FILE || path.join(__dirname, '..', 'data', 'users.json');
const ID_RE = /^\d{15,25}$/;                 // Discord snowflake
const AVATAR_RE = /^(?:a_)?[a-f0-9]{32}$/;   // avatar hash (a_ = anh dong)

let chain = Promise.resolve();
const lock = (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };

let cache = null; // Map<id, user>
let cacheFile = null;

const isValidId = (id) => typeof id === 'string' && ID_RE.test(id);

/** Chuan hoa + kiem tra du lieu profile tu Discord. Nem 400 neu khong hop le. */
function sanitizeProfile(p) {
  if (!p || typeof p !== 'object') throw new HttpError(400, 'Dữ liệu tài khoản không hợp lệ');
  if (!isValidId(p.id)) throw new HttpError(400, 'Discord ID không hợp lệ');
  const username = typeof p.username === 'string' ? p.username.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64) : '';
  if (!username) throw new HttpError(400, 'Username Discord không hợp lệ');
  const avatar = typeof p.avatar === 'string' && AVATAR_RE.test(p.avatar) ? p.avatar : null;
  return { id: p.id, username, avatar };
}

async function load() {
  const file = FILE();
  if (cache && cacheFile === file) return cache;
  let raw;
  try { raw = await fsp.readFile(file, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') raw = '[]'; else throw e; }
  let arr;
  try { arr = JSON.parse(raw); } catch { throw new HttpError(500, 'users.json bị lỗi cú pháp; hãy sửa tay (server không tự ghi đè).'); }
  if (!Array.isArray(arr)) throw new HttpError(500, 'users.json phải là một mảng.');
  const m = new Map();
  for (const u of arr) if (u && isValidId(u.id) && typeof u.username === 'string') m.set(u.id, u);
  cache = m; cacheFile = file;
  return m;
}

async function persist(map) {
  const file = FILE();
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const fh = await fsp.open(tmp, 'w', 0o600);
  try { await fh.writeFile(JSON.stringify([...map.values()], null, 2)); await fh.sync(); } finally { await fh.close(); }
  await fsp.rename(tmp, file); // atomic
}

/** Lay user theo Discord ID (null neu khong co / ID sai dinh dang). */
async function getById(id) {
  if (!isValidId(id)) return null;
  const u = (await load()).get(id);
  return u ? { ...u } : null;
}

/** Consent hop le { version, at(ISO) } -> 3 truong luu trong users.json. Gia tri sai => bo qua (khong ghi consent). */
const VERSION_RE = /^[\w.\-]{1,32}$/;
function consentFields(c) {
  if (!c || typeof c.version !== 'string' || !VERSION_RE.test(c.version) || typeof c.at !== 'string' || isNaN(Date.parse(c.at))) return null;
  const at = new Date(c.at).toISOString();
  return { tosAcceptedAt: at, communityRulesAcceptedAt: at, termsVersion: c.version };
}
/** Giu nguyen consent da luu cua ban ghi cu (upsert khong duoc lam mat). */
const keepConsent = (u) => (u && u.termsVersion ? { tosAcceptedAt: u.tosAcceptedAt, communityRulesAcceptedAt: u.communityRulesAcceptedAt, termsVersion: u.termsVersion } : {});

/** Tao moi hoac cap nhat username/avatar sau moi lan dang nhap. Giu nguyen createdAt.
 *  consent (tuy chon, do SERVER truyen: { version, at }) => ghi nhan dong y TOS + Community Rules cung luc; khong co thi giu consent cu. */
const upsertFromDiscord = (profile, consent) => lock(async () => {
  const p = sanitizeProfile(profile);
  const map = await load();
  const now = new Date().toISOString();
  const old = map.get(p.id);
  const next = { id: p.id, username: p.username, avatar: p.avatar, createdAt: old ? old.createdAt : now, updatedAt: now, ...keepConsent(old), ...(consentFields(consent) || {}) };
  const copy = new Map(map); copy.set(p.id, next);
  await persist(copy);   // ghi dia thanh cong roi moi cap nhat cache
  cache = copy;
  return { ...next };
});

/** Ghi nhan user DANG DANG NHAP dong y phien ban TOS/Rules hien hanh (khong can qua Discord lai). null neu user khong ton tai. */
const recordConsent = (id, consent) => lock(async () => {
  const f = consentFields(consent); if (!f) throw new HttpError(400, 'Dữ liệu đồng ý không hợp lệ');
  const map = await load(); const old = map.get(id); if (!old) return null;
  const next = { ...old, ...f };   // khong doi updatedAt: day khong phai doi profile Discord
  const copy = new Map(map); copy.set(id, next);
  await persist(copy); cache = copy;
  return { ...next };
});

/** Thong tin CONG KHAI cua 1 user (id, username hien tai, avatar). Khong tra createdAt/role/session. null neu khong co. */
async function publicInfo(id) {
  const u = await getById(id);
  return u ? { id: u.id, username: u.username, avatarUrl: discord.avatarUrl(u) } : null;
}

/** Tim user cho Admin: khop Discord ID (chinh xac / tien to) hoac username (chua chuoi, khong phan biet hoa thuong). */
async function search(q, limit = 25) {
  const s = typeof q === 'string' ? q.trim().toLowerCase().slice(0, 64) : '';
  const rows = [...(await load()).values()];
  const hit = s ? rows.filter((u) => u.id.startsWith(s) || u.username.toLowerCase().includes(s)) : rows;
  return hit.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).slice(0, Math.min(Math.max(limit | 0, 1), 100)).map((u) => ({ ...u }));
}

async function count() { return (await load()).size; }

/** Chi dung cho test: bo cache trong bo nho de mo phong restart server. */
function _resetCache() { cache = null; cacheFile = null; }

module.exports = { publicInfo, getById, upsertFromDiscord, recordConsent, search, sanitizeProfile, isValidId, count, _resetCache };
