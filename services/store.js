'use strict';
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const FILE = process.env.VTUBER_DATA_FILE || path.join(__dirname, '..', 'data', 'vtubers.json');
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const SOCIAL_KEYS = ['twitter', 'facebook', 'instagram', 'tiktok', 'twitch', 'discord', 'website'];

class HttpError extends Error {
  constructor(status, message, field) { super(message); this.status = status; this.field = field; }
}

let chain = Promise.resolve();
function withLock(fn) { const p = chain.then(fn); chain = p.catch(() => {}); return p; }

const isEntry = (v) => v && typeof v === 'object' && typeof v.id === 'string' && ID_RE.test(v.id) && typeof v.name === 'string';
/** Chuan hoa ban ghi cu (chi co id/name/youtubeChannelId/enabled) sang schema day du. */
function norm(v) {
  return {
    id: v.id,
    slug: typeof v.slug === 'string' && ID_RE.test(v.slug) ? v.slug : v.id,
    name: v.name,
    type: v.type === 'clipper' ? 'clipper' : 'vtuber',
    youtubeChannelId: typeof v.youtubeChannelId === 'string' ? v.youtubeChannelId : '',
    avatar: typeof v.avatar === 'string' ? v.avatar : '',
    description: typeof v.description === 'string' ? v.description : '',
    social: v.social && typeof v.social === 'object' && !Array.isArray(v.social) ? v.social : {},
    graduated: v.graduated === true,
    enabled: v.enabled === true,
    createdAt: v.createdAt || null,
    updatedAt: v.updatedAt || null,
  };
}

/** Doc raw: ban ghi khong hop le duoc giu nguyen khi ghi lai (khong mat du lieu). */
async function readRaw() {
  let raw;
  try { raw = await fsp.readFile(FILE, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  let arr;
  try { arr = JSON.parse(raw); } catch { throw new HttpError(500, 'vtubers.json bị lỗi cú pháp; hãy sửa tay (server không tự ghi đè).'); }
  if (!Array.isArray(arr)) throw new HttpError(500, 'vtubers.json phải là một mảng.');
  return arr.map((v) => (isEntry(v) ? norm(v) : v));
}
async function writeAll(arr) {
  const tmp = `${FILE}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const fh = await fsp.open(tmp, 'w');
  try { await fh.writeFile(JSON.stringify(arr, null, 2)); await fh.sync(); } finally { await fh.close(); }
  await fsp.rename(tmp, FILE); // atomic
}

function slugify(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36).replace(/-+$/g, '') || 'vtuber';
}
function cleanUrl(v, field, label, max = 300) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string' || v.length > max) throw new HttpError(400, `${label} không hợp lệ`, field);
  let u; try { u = new URL(v.trim()); } catch { throw new HttpError(400, `${label} phải là URL đầy đủ (https://...)`, field); }
  if (!['https:', 'http:'].includes(u.protocol)) throw new HttpError(400, `${label} phải bắt đầu bằng http(s)://`, field);
  return u.toString();
}

/** Validate; partial=true cho update. Chi tra cac truong hop le duoc gui len. */
function validate(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Dữ liệu không hợp lệ');
  const out = {}; const has = (k) => input[k] !== undefined;
  if (!partial || has('name')) {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) throw new HttpError(400, 'Tên không được để trống', 'name');
    if (name.length > 100 || /[\u0000-\u001f]/.test(name)) throw new HttpError(400, 'Tên tối đa 100 ký tự, không chứa ký tự điều khiển', 'name');
    out.name = name;
  }
  if (has('slug') && input.slug !== '' && input.slug !== null) {
    if (typeof input.slug !== 'string' || !ID_RE.test(input.slug.trim())) throw new HttpError(400, 'Slug chỉ gồm a-z, 0-9, dấu gạch ngang (tối đa 40)', 'slug');
    out.slug = input.slug.trim();
  }
  if (has('type')) {
    if (!['vtuber', 'clipper'].includes(input.type)) throw new HttpError(400, 'Loại phải là vtuber hoặc clipper', 'type');
    out.type = input.type;
  }
  if (has('youtubeChannelId')) {
    const c = typeof input.youtubeChannelId === 'string' ? input.youtubeChannelId.trim() : '';
    if (c && !CHANNEL_ID_RE.test(c)) throw new HttpError(400, 'Channel ID không hợp lệ (UC + 22 ký tự)', 'youtube');
    out.youtubeChannelId = c;
  }
  if (has('avatar')) out.avatar = cleanUrl(input.avatar, 'avatar', 'Avatar', 500);
  if (has('description')) {
    if (typeof input.description !== 'string' || input.description.length > 500) throw new HttpError(400, 'Mô tả tối đa 500 ký tự', 'description');
    out.description = input.description.trim();
  }
  if (has('social')) {
    if (!input.social || typeof input.social !== 'object' || Array.isArray(input.social)) throw new HttpError(400, 'Social links không hợp lệ', 'social');
    out.social = {};
    for (const k of SOCIAL_KEYS) { const u = cleanUrl(input.social[k], `social.${k}`, `Link ${k}`); if (u) out.social[k] = u; }
  }
  if (has('graduated')) {
    const g = input.graduated;
    if (g !== true && g !== false && g !== 'true' && g !== 'false') throw new HttpError(400, 'graduated phải là true/false', 'graduated');
    out.graduated = g === true || g === 'true';
  }
  if (has('enabled')) {
    const e = input.enabled;
    if (e !== true && e !== false && e !== 'true' && e !== 'false') throw new HttpError(400, 'enabled phải là true/false', 'enabled');
    out.enabled = e === true || e === 'true';
  }
  return out;
}
const isValidId = (id) => typeof id === 'string' && ID_RE.test(id);
const items = (all) => all.filter(isEntry);

const list = async () => items(await readRaw());
async function getBySlug(key) { if (!isValidId(key)) return null; const all = items(await readRaw()); return all.find((v) => v.slug === key) || all.find((v) => v.id === key) || null; }
const get = getBySlug;

function conflict(all, { slug, channelId, exceptId }) {
  const others = items(all).filter((v) => v.id !== exceptId);
  if (slug && others.some((v) => v.slug === slug || v.id === slug)) throw new HttpError(409, 'Slug đã được dùng', 'slug');
  if (channelId && others.some((v) => v.youtubeChannelId === channelId)) throw new HttpError(409, 'Channel YouTube này đã có VTuber khác sử dụng', 'youtube');
}

const create = (input) => withLock(async () => {
  const data = validate({ enabled: true, ...input });
  if (!('name' in data)) throw new HttpError(400, 'Tên không được để trống', 'name');
  const all = await readRaw();
  const chId = data.youtubeChannelId || '';
  let slug = data.slug;
  if (slug) conflict(all, { slug, channelId: chId });
  else {
    const base = slugify(data.name); slug = base;
    for (let i = 2; items(all).some((v) => v.slug === slug || v.id === slug); i++) slug = `${base.slice(0, 36)}-${i}`;
    conflict(all, { channelId: chId });
  }
  const now = new Date().toISOString();
  const item = { id: slug, slug, name: data.name, type: data.type || 'vtuber', youtubeChannelId: chId, avatar: data.avatar || '', description: data.description || '',
    social: data.social || {}, graduated: data.graduated === true, enabled: data.enabled, createdAt: now, updatedAt: now };
  await writeAll([...all, item]);
  return item;
});

const update = (id, patch) => withLock(async () => {
  if (!isValidId(id)) throw new HttpError(400, 'ID không hợp lệ');
  const data = validate(patch, { partial: true });
  const all = await readRaw();
  const idx = all.findIndex((v) => isEntry(v) && v.id === id);
  if (idx < 0) throw new HttpError(404, 'Không tìm thấy VTuber');
  conflict(all, { slug: data.slug, channelId: data.youtubeChannelId, exceptId: id });
  const before = all[idx];
  const after = { ...before, ...data, id: before.id, updatedAt: new Date().toISOString() };
  const copy = all.slice(); copy[idx] = after;
  await writeAll(copy);
  return { before, after };
});

const remove = (id) => withLock(async () => {
  if (!isValidId(id)) throw new HttpError(400, 'ID không hợp lệ');
  const all = await readRaw();
  const item = all.find((v) => isEntry(v) && v.id === id);
  if (!item) throw new HttpError(404, 'Không tìm thấy VTuber');
  await writeAll(all.filter((v) => v !== item));
  return item;
});

const toggle = (id) => withLock(async () => {
  if (!isValidId(id)) throw new HttpError(400, 'ID không hợp lệ');
  const all = await readRaw();
  const idx = all.findIndex((v) => isEntry(v) && v.id === id);
  if (idx < 0) throw new HttpError(404, 'Không tìm thấy VTuber');
  const copy = all.slice(); copy[idx] = { ...all[idx], enabled: !all[idx].enabled, updatedAt: new Date().toISOString() };
  await writeAll(copy);
  return copy[idx];
});

module.exports = { list, get, getBySlug, create, update, remove, toggle, HttpError, isValidId, validate, slugify, SOCIAL_KEYS };
