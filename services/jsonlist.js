'use strict';
/**
 * Kho JSON dang mang dung chung cho posts / comments / fanarts (cung mo hinh voi news.js, users.js:
 * khoa tuan tu, ghi atomic tmp+rename, file hong thi bao loi va KHONG ghi de).
 *  - read()   : doc mang (khong khoa; rename atomic nen luon doc duoc ban nhat quan)
 *  - tx(fn)   : doc -> fn(mang, sua truc tiep) -> ghi, tat ca trong 1 khoa. fn nem loi => KHONG ghi.
 * Nen goi mang cham (upload imgbb) TRUOC tx de khong giu khoa lau.
 */
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { HttpError } = require('./store');

function makeList(getFile, { label = 'du lieu', legacyFile } = {}) {
  let chain = Promise.resolve();
  const lock = (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };

  async function read() {
    let raw;
    try { raw = await fsp.readFile(getFile(), 'utf8'); }
    catch (e) {
      if (e.code !== 'ENOENT') throw e;
      const lf = legacyFile && legacyFile();      // file cu (vd fanart.json) => doc de khong mat du lieu, lan ghi dau se tao file moi
      if (!lf) return [];
      try { raw = await fsp.readFile(lf, 'utf8'); } catch (e2) { if (e2.code === 'ENOENT') return []; throw e2; }
    }
    let a;
    try { a = JSON.parse(raw); } catch { throw new HttpError(500, `${label} bị lỗi cú pháp; hãy sửa tay (server không tự ghi đè).`); }
    if (!Array.isArray(a)) throw new HttpError(500, `${label} phải là một mảng.`);
    return a;
  }
  async function write(a) {
    const file = getFile();
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    const fh = await fsp.open(tmp, 'w', 0o600);
    try { await fh.writeFile(JSON.stringify(a, null, 2)); await fh.sync(); } finally { await fh.close(); }
    await fsp.rename(tmp, file);
  }
  const tx = (fn) => lock(async () => { const a = await read(); const out = await fn(a); await write(a); return out; });
  return { read, tx };
}
module.exports = { makeList };
