'use strict';
/**
 * Noi dung TOS + Community Rules doc tu data/legal.json (LEGAL_FILE de doi duong dan).
 * Muon cap nhat luat: sua file JSON (tang "termsVersion" neu muon user xac nhan lai) - KHONG can dong
 * vao code dang nhap. File duoc doc lai khi mtime doi, khong can restart. File loi => giu ban tot gan nhat.
 * Consent cua user luu o users.json (tosAcceptedAt / communityRulesAcceptedAt / termsVersion).
 */
const fs = require('fs');
const path = require('path');
const { HttpError } = require('./store');

const FILE = () => process.env.LEGAL_FILE || path.join(__dirname, '..', 'data', 'legal.json');
const VERSION_RE = /^[\w.\-]{1,32}$/;
let cache = null; // { file, mtimeMs, data }

const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : '');
function doc(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.sections) || !d.sections.length) throw new Error('tai lieu phap ly khong hop le');
  return {
    title: str(d.title, 200), intro: str(d.intro, 2000),
    sections: d.sections.slice(0, 60).map((s) => ({
      heading: str(s && s.heading, 200),
      paragraphs: Array.isArray(s && s.paragraphs) ? s.paragraphs.slice(0, 30).map((p) => str(p, 3000)).filter(Boolean) : [],
      items: Array.isArray(s && s.items) ? s.items.slice(0, 50).map((p) => str(p, 1000)).filter(Boolean) : [],
    })).filter((s) => s.heading),
  };
}
function parse(raw) {
  const j = JSON.parse(raw);
  if (typeof j.termsVersion !== 'string' || !VERSION_RE.test(j.termsVersion)) throw new Error('termsVersion khong hop le');
  return { termsVersion: j.termsVersion, updatedAt: str(j.updatedAt, 40), tos: doc(j.tos), rules: doc(j.rules) };
}

/** Noi dung hien hanh (dong bo, file nho). Nem 500 neu chua tung doc duoc file hop le. */
function get() {
  const file = FILE();
  let st;
  try { st = fs.statSync(file); } catch { st = null; }
  if (st && cache && cache.file === file && cache.mtimeMs === st.mtimeMs) return cache.data;
  try {
    if (!st) throw new Error('khong tim thay ' + file);
    const data = parse(fs.readFileSync(file, 'utf8'));
    cache = { file, mtimeMs: st.mtimeMs, data };
    return data;
  } catch (e) {
    if (cache && cache.file === file) { console.error('[legal] legal.json loi, dung ban truoc do:', e.message); return cache.data; }
    throw new HttpError(500, 'Không đọc được nội dung điều khoản (data/legal.json).');
  }
}

const version = () => get().termsVersion;
/** User da dong y dung phien ban hien hanh cua TOS + Community Rules chua (chi tin du lieu server luu). */
function hasConsent(user, v = version()) {
  return !!user && user.termsVersion === v && !isNaN(Date.parse(user.tosAcceptedAt)) && !isNaN(Date.parse(user.communityRulesAcceptedAt));
}
const _reset = () => { cache = null; };

module.exports = { get, version, hasConsent, _reset };
