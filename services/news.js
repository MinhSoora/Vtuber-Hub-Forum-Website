'use strict';
/** Tin tuc: data/news.json. Anh dinh kem upload qua imgbb (toi da 4 anh/bai). */
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { upload, checkB64, err } = require('./imgbb');
const FILE = process.env.NEWS_FILE || path.join(__dirname, '..', 'data', 'news.json');
const ID_RE = /^[a-f0-9]{12}$/;
const MAX_IMAGES = 4;
let chain = Promise.resolve();
const lock = (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };
async function read() {
  try { const a = JSON.parse(await fsp.readFile(FILE, 'utf8')); return Array.isArray(a) ? a : []; }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}
async function write(a) {
  const t = `${FILE}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(t, JSON.stringify(a, null, 2)); await fsp.rename(t, FILE);
}
const isValidId = (id) => typeof id === 'string' && ID_RE.test(id);
const httpUrl = (u) => { try { const x = new URL(u); return ['http:', 'https:'].includes(x.protocol) ? x.toString() : ''; } catch { return ''; } };
const norm = (x) => ({ id: x.id, title: x.title || '', content: x.content || '', images: Array.isArray(x.images) ? x.images.filter((u) => httpUrl(u)) : [],
  published: x.published !== false, createdAt: x.createdAt || null, updatedAt: x.updatedAt || null });

function validate(b, { partial = false } = {}) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw err(400, 'Dữ liệu không hợp lệ');
  const out = {}, has = (k) => b[k] !== undefined;
  if (!partial || has('title')) {
    const t = typeof b.title === 'string' ? b.title.replace(/[\u0000-\u001f]/g, ' ').trim() : '';
    if (!t) throw Object.assign(err(400, 'Tiêu đề không được để trống'), { field: 'title' });
    if (t.length > 150) throw Object.assign(err(400, 'Tiêu đề tối đa 150 ký tự'), { field: 'title' });
    out.title = t;
  }
  if (!partial || has('content')) {
    const c = typeof b.content === 'string' ? b.content.replace(/\r\n/g, '\n').trim() : '';
    if (!c) throw Object.assign(err(400, 'Nội dung không được để trống'), { field: 'content' });
    if (c.length > 8000) throw Object.assign(err(400, 'Nội dung tối đa 8000 ký tự'), { field: 'content' });
    out.content = c;
  }
  if (has('published')) {
    if (![true, false, 'true', 'false'].includes(b.published)) throw Object.assign(err(400, 'published phải là true/false'), { field: 'published' });
    out.published = b.published === true || b.published === 'true';
  }
  return out;
}
/** images = URL giu lai (phai la URL http(s)); newImages = base64 can upload. Tong <= MAX_IMAGES. */
async function resolveImages(b, keep) {
  let urls = keep;
  if (has(b, 'images')) {
    if (!Array.isArray(b.images)) throw Object.assign(err(400, 'Danh sách ảnh không hợp lệ'), { field: 'images' });
    urls = b.images.map(httpUrl).filter(Boolean);
  }
  const fresh = Array.isArray(b.newImages) ? b.newImages : [];
  if (urls.length + fresh.length > MAX_IMAGES) throw Object.assign(err(400, `Tối đa ${MAX_IMAGES} ảnh mỗi bài`), { field: 'images' });
  fresh.forEach((x) => checkB64(x));
  const uploaded = [];
  for (const x of fresh) { const d = await upload(x); uploaded.push(d.display_url || d.url); }
  return [...urls, ...uploaded];
}
const has = (b, k) => b && b[k] !== undefined;

const list = async ({ all } = {}) => (await read()).map(norm).filter((x) => all || x.published).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
async function get(id, { all } = {}) {
  if (!isValidId(id)) return null;
  const x = (await read()).find((n) => n.id === id);
  return x && (all || x.published !== false) ? norm(x) : null;
}
async function create(b) {
  const data = validate({ published: true, ...b });
  const images = await resolveImages(b, []);
  const now = new Date().toISOString();
  const item = { id: crypto.randomBytes(6).toString('hex'), ...data, images, createdAt: now, updatedAt: now };
  await lock(async () => write([item, ...(await read())]));
  return norm(item);
}
async function update(id, b) {
  if (!isValidId(id)) throw err(400, 'ID không hợp lệ');
  const data = validate(b, { partial: true });
  const cur = await get(id, { all: true });
  if (!cur) throw err(404, 'Không tìm thấy tin');
  const images = await resolveImages(b, cur.images);
  return lock(async () => {
    const a = await read(); const i = a.findIndex((n) => n.id === id);
    if (i < 0) throw err(404, 'Không tìm thấy tin');
    a[i] = { ...a[i], ...data, images, updatedAt: new Date().toISOString() }; await write(a); return norm(a[i]);
  });
}
const remove = (id) => lock(async () => {
  if (!isValidId(id)) throw err(400, 'ID không hợp lệ');
  const a = await read(); const i = a.findIndex((n) => n.id === id);
  if (i < 0) throw err(404, 'Không tìm thấy tin');
  const [x] = a.splice(i, 1); await write(a); return norm(x);
});
module.exports = { list, get, create, update, remove, validate, isValidId, MAX_IMAGES };
