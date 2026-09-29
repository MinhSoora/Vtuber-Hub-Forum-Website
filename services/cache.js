'use strict';
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const DIR = process.env.VTUBER_CACHE_DIR || path.join(__dirname, '..', 'cache');
const TTL = { live: 90e3, upcoming: 3 * 60e3, videos: 7 * 60e3, channel: 45 * 60e3 };
const FAIL_BACKOFF = 30e3;
const KEY_RE = /^UC[A-Za-z0-9_-]{22}$/;
const mem = new Map(), failures = new Map(), inflight = new Map();

function file(kind, key) {
  if (!TTL[kind] || !KEY_RE.test(key)) throw new Error('Invalid cache key');
  return path.join(DIR, `${kind}_${key}.json`);
}
async function load(kind, key) {
  const k = `${kind}:${key}`;
  if (mem.has(k)) return mem.get(k);
  try {
    const e = JSON.parse(await fsp.readFile(file(kind, key), 'utf8'));
    if (e && typeof e.fetchedAt === 'number') { mem.set(k, e); return e; }
  } catch { /* cache hong/khong co => bo qua */ }
  return null;
}
async function save(kind, key, entry) {
  mem.set(`${kind}:${key}`, entry);
  const f = file(kind, key), tmp = `${f}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try { await fsp.writeFile(tmp, JSON.stringify(entry)); await fsp.rename(tmp, f); }
  catch (e) { console.warn('[cache] write failed:', e.message); fsp.unlink(tmp).catch(() => {}); }
}

/** Tra {data, stale, fetchedAt, error?}. Loi + co cache cu => tra cache cu (stale). */
async function get(kind, key, fetcher, { force = false, cacheOnly = false } = {}) {
  const k = `${kind}:${key}`, now = Date.now();
  const entry = await load(kind, key);
  const fresh = (e) => ({ data: e.data, stale: false, fetchedAt: e.fetchedAt });
  if (cacheOnly) { // khong bao gio goi mang: dung cho request public
    if (entry) return { data: entry.data, stale: now - entry.fetchedAt >= TTL[kind], fetchedAt: entry.fetchedAt };
    const err = new Error('Chưa có dữ liệu'); err.code = 'NO_CACHE'; throw err;
  }
  if (entry && !force && now - entry.fetchedAt < TTL[kind]) return fresh(entry);
  const f = failures.get(k);
  if (!force && f && now - f.at < FAIL_BACKOFF) {
    if (entry) return { data: entry.data, stale: true, fetchedAt: entry.fetchedAt, error: f.err.message };
    throw f.err;
  }
  if (inflight.has(k)) return inflight.get(k);
  const p = (async () => {
    try {
      const e = { data: await fetcher(), fetchedAt: Date.now() };
      failures.delete(k);
      await save(kind, key, e);
      return fresh(e);
    } catch (err) {
      failures.set(k, { at: Date.now(), err });
      if (entry) return { data: entry.data, stale: true, fetchedAt: entry.fetchedAt, error: err.message };
      throw err;
    } finally { inflight.delete(k); }
  })();
  inflight.set(k, p);
  return p;
}
async function set(kind, key, data) { await save(kind, key, { data, fetchedAt: Date.now() }); failures.delete(`${kind}:${key}`); }
async function peek(kind, key) { const e = await load(kind, key); return e ? e.data : null; }
async function clearChannel(key) {
  if (!KEY_RE.test(key)) return;
  for (const kind of Object.keys(TTL)) {
    mem.delete(`${kind}:${key}`); failures.delete(`${kind}:${key}`);
    await fsp.unlink(file(kind, key)).catch(() => {});
  }
}
module.exports = { get, set, peek, clearChannel, TTL };
