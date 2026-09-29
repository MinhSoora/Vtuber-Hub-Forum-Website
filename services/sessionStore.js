'use strict';
/**
 * Session store server-side luu file (data/sessions.json) thay cho MemoryStore mac dinh cua
 * express-session => dang nhap con hieu luc sau khi restart, khong ro ri bo nho.
 *
 *  - Khoa luu tru = SHA-256(session id): lo file khong cho phep dung lai cookie.
 *  - Het han theo cookie.expires; don dinh ky; gioi han tong so session (MAX_SESSIONS) de
 *    chong lam phinh bo nho/dia (vd spam /auth/discord/login tao session rac).
 *  - pruneUser(): gioi han so session dong thoi cua 1 tai khoan Discord.
 *  - Ghi debounce + atomic (tmp+rename), quyen file 0600.
 *  - Tuong thich store.get/set/destroy/touch cua express-session.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const session = require('express-session');

const MAX_SESSIONS = Number(process.env.MAX_SESSIONS) > 0 ? Number(process.env.MAX_SESSIONS) : 5000;
const hash = (sid) => crypto.createHash('sha256').update(String(sid)).digest('hex');
const expiresOf = (sess) => (sess && sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Infinity);

class FileSessionStore extends session.Store {
  constructor(file, { flushMs = 300, sweepMs = 10 * 60e3 } = {}) {
    super();
    this.file = file; this.flushMs = flushMs; this.map = new Map(); this.timer = null; this.writing = Promise.resolve();
    this._load();
    this.sweepTimer = setInterval(() => this._sweep(), sweepMs); this.sweepTimer.unref();
  }
  _load() {
    let raw;
    try { raw = fs.readFileSync(this.file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return; console.error('[sessions] không đọc được file session:', e.message); return; }
    try {
      const obj = JSON.parse(raw); const now = Date.now();
      for (const [k, v] of Object.entries(obj || {})) if (v && typeof v === 'object' && expiresOf(v) > now) this.map.set(k, v);
    } catch { console.error('[sessions] sessions.json lỗi cú pháp - bỏ qua (mọi người phải đăng nhập lại).'); }
  }
  _schedule() { if (this.timer) return; this.timer = setTimeout(() => { this.timer = null; this.flush().catch((e) => console.error('[sessions] ghi lỗi:', e.message)); }, this.flushMs); this.timer.unref(); }
  /** Ghi atomic; cac lan ghi duoc xep hang de khong de len nhau. */
  flush() {
    this.writing = this.writing.then(async () => {
      const fsp = fs.promises;
      await fsp.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(Object.fromEntries(this.map)), { mode: 0o600 });
      await fsp.rename(tmp, this.file);
    });
    return this.writing.catch((e) => { this.writing = Promise.resolve(); throw e; });
  }
  /** Ghi dong bo khi tat server de khong mat session vua tao. */
  flushSync() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.sync.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.map)), { mode: 0o600 }); fs.renameSync(tmp, this.file);
    } catch (e) { console.error('[sessions] ghi đồng bộ lỗi:', e.message); }
  }
  _sweep() {
    const now = Date.now(); let changed = false;
    for (const [k, v] of this.map) if (expiresOf(v) <= now) { this.map.delete(k); changed = true; }
    if (changed) this._schedule();
  }
  _evict() {
    if (this.map.size <= MAX_SESSIONS) return;
    // Bo cac session het han som nhat truoc
    const sorted = [...this.map.entries()].sort((a, b) => expiresOf(a[1]) - expiresOf(b[1]));
    for (const [k] of sorted) { if (this.map.size <= MAX_SESSIONS) break; this.map.delete(k); }
  }

  get(sid, cb) {
    const k = hash(sid), s = this.map.get(k);
    if (!s) return cb(null, null);
    if (expiresOf(s) <= Date.now()) { this.map.delete(k); this._schedule(); return cb(null, null); }
    cb(null, JSON.parse(JSON.stringify(s)));
  }
  set(sid, sess, cb) {
    this.map.set(hash(sid), JSON.parse(JSON.stringify(sess)));
    this._evict(); this._schedule(); if (cb) cb(null);
  }
  touch(sid, sess, cb) {
    const k = hash(sid), s = this.map.get(k);
    if (s && sess && sess.cookie) { s.cookie = JSON.parse(JSON.stringify(sess.cookie)); this._schedule(); }
    if (cb) cb(null);
  }
  destroy(sid, cb) { this.map.delete(hash(sid)); this._schedule(); if (cb) cb(null); }

  /** Chi giu toi da `max` session cua 1 Discord user (xoa cu nhat), khong bao gio xoa session `keepSid`. */
  pruneUser(userId, max, keepSid) {
    const keep = keepSid ? hash(keepSid) : null;
    const mine = [...this.map.entries()].filter(([k, v]) => v.user && v.user.id === userId && k !== keep)
      .sort((a, b) => (a[1].user.loginAt || 0) - (b[1].user.loginAt || 0));
    const excess = mine.length - (max - (keep ? 1 : 0));
    let n = 0; for (let i = 0; i < excess; i++) { this.map.delete(mine[i][0]); n++; }
    if (n) this._schedule();
    return n;
  }
  /** Huy TAT CA session cua 1 Discord user (kick / ban). Tra ve so session da huy. */
  destroyUser(userId) {
    let n = 0;
    for (const [k, v] of this.map) if (v && v.user && v.user.id === userId) { this.map.delete(k); n++; }
    if (n) this._schedule();
    return n;
  }
  /** Thong ke cho test/van hanh. */
  size() { return this.map.size; }
}

let instance = null;
/** Singleton dung chung cho server.js va routes/auth.js. */
function get() {
  if (!instance) {
    instance = new FileSessionStore(process.env.SESSIONS_FILE || path.join(__dirname, '..', 'data', 'sessions.json'));
    for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { instance.flushSync(); process.exit(0); });
    process.on('exit', () => instance && instance.flushSync());
  }
  return instance;
}

module.exports = { FileSessionStore, get, MAX_SESSIONS };
