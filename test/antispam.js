'use strict';
/** Kiem thu lop chong spam: rate limit (cua so truot, tai khoan/IP/tai khoan moi), Turnstile, o an, va viec gan vao route. npm test, khong can mang. */
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), Module = require('module');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vth-spam-')); const F = (n) => path.join(tmp, n);
Object.assign(process.env, { USERS_FILE: F('u.json'), SESSIONS_FILE: F('s.json'), POSTS_FILE: F('p.json'), COMMENTS_FILE: F('c.json'), FANART_FILE: F('f.json'),
  VTUBER_DATA_FILE: F('v.json'), VTUBER_CACHE_DIR: tmp, NEWS_FILE: F('n.json'), IMGBB_API_KEY: 'k', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'pw' });
delete process.env.TURNSTILE_SITE_KEY; delete process.env.TURNSTILE_SECRET_KEY; delete process.env.CAPTCHA_REQUIRED; delete process.env.RATE_LIMIT_SCALE; delete process.env.TRUST_CLOUDFLARE;

class FakeRouter { constructor() { this.layers = []; }
  _add(m, a) { const [x, ...r] = a; const hp = typeof x === 'string'; this.layers.push({ method: m, path: hp ? x : null, fns: (hp ? r : a).flat() }); return this; }
  use(...a) { return this._add(null, a); } get(...a) { return this._add('GET', a); } post(...a) { return this._add('POST', a); } put(...a) { return this._add('PUT', a); } delete(...a) { return this._add('DELETE', a); } }
const expressStub = () => {}; expressStub.Router = () => new FakeRouter(); expressStub.json = () => () => {};
const origLoad = Module._load; Module._load = function (req, ...rest) { return req === 'express' ? expressStub : origLoad.call(this, req, ...rest); };

const { makeRateLimiter, makeUserLimiter, makeIpLimiter, stack, clientIp } = require('../middleware/rateLimit');
const { requireCaptcha, honeypot } = require('../middleware/antispam');

const mkRes = () => { const r = { h: {}, code: 200, done: false, set(a, b) { if (typeof a === 'object') Object.assign(this.h, a); else this.h[a] = b; return this; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; this.done = true; return this; } }; return r; };
/** Chay middleware; tra { passed, res }. */
const run = (mw, req) => new Promise((resolve) => { const res = mkRes(); let passed = false; const next = () => { passed = true; resolve({ passed, res }); }; const out = mw(req, res, next); Promise.resolve(out).then(() => { if (!passed) resolve({ passed, res }); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0; const t = async (name, fn) => { try { await fn(); n++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n', e); process.exitCode = 1; } };

(async () => {
  await t('cua so truot: qua gioi han => 429 + Retry-After + retryAfter; key khac khong bi anh huong', async () => {
    const lim = makeRateLimiter({ windowMs: 1000, max: 3, key: (r) => r.k });
    for (let i = 0; i < 3; i++) assert.ok((await run(lim, { k: 'a' })).passed);
    const r = await run(lim, { k: 'a' });
    assert.equal(r.passed, false); assert.equal(r.res.code, 429); assert.ok(Number(r.res.h['Retry-After']) >= 1); assert.ok(r.res.body.retryAfter >= 1); assert.equal(r.res.body.success, false);
    assert.ok((await run(lim, { k: 'b' })).passed);
  });

  await t('het cua so thi duoc dung lai (khong bi khoa vinh vien)', async () => {
    const lim = makeRateLimiter({ windowMs: 60, max: 2, key: () => 'k' });
    await run(lim, {}); await run(lim, {}); assert.equal((await run(lim, {})).res.code, 429);
    await sleep(200); assert.ok((await run(lim, {})).passed);
  });

  await t('tai khoan moi (<24h) bi siet chat hon tai khoan cu; gioi han theo tai khoan, khong lan sang nguoi khac', async () => {
    const lim = makeUserLimiter({ windowMs: 60e3, max: 5, newAccountMax: 2 });
    const fresh = { user: { id: '1', createdAt: new Date().toISOString() } }, old = { user: { id: '2', createdAt: new Date(Date.now() - 3 * 864e5).toISOString() } };
    assert.ok((await run(lim, fresh)).passed); assert.ok((await run(lim, fresh)).passed); assert.equal((await run(lim, fresh)).res.code, 429);
    for (let i = 0; i < 5; i++) assert.ok((await run(lim, old)).passed); assert.equal((await run(lim, old)).res.code, 429);
    assert.ok((await run(lim, { user: { id: '3', createdAt: new Date(Date.now() - 3 * 864e5).toISOString() } })).passed);
  });

  await t('gioi han theo IP chan xoay nhieu tai khoan tu cung mang; stack: burst chan truoc', async () => {
    const ip = makeIpLimiter({ windowMs: 60e3, max: 3 });
    for (let i = 0; i < 3; i++) assert.ok((await run(ip, { ip: '9.9.9.9', user: { id: 'u' + i } })).passed);
    assert.equal((await run(ip, { ip: '9.9.9.9', user: { id: 'u-moi' } })).res.code, 429);
    assert.ok((await run(ip, { ip: '8.8.8.8', user: { id: 'u0' } })).passed);
    const st = stack(makeUserLimiter({ windowMs: 60e3, max: 1, message: 'burst' }), makeIpLimiter({ windowMs: 60e3, max: 100 }));
    const rq = { ip: '7.7.7.7', user: { id: 'x' } }; assert.ok((await run(st, rq)).passed);
    const r = await run(st, rq); assert.equal(r.res.code, 429); assert.equal(r.res.body.error, 'burst');
  });

  await t('clientIp: chi tin CF-Connecting-IP khi TRUST_CLOUDFLARE=true va gia tri hop le', async () => {
    const req = { ip: '10.0.0.1', headers: { 'cf-connecting-ip': '203.0.113.7' } };
    assert.equal(clientIp(req), '10.0.0.1');                                   // mac dinh: KHONG tin header (co the gia mao)
    process.env.TRUST_CLOUDFLARE = 'true';
    assert.equal(clientIp(req), '203.0.113.7');
    assert.equal(clientIp({ ip: '10.0.0.1', headers: { 'cf-connecting-ip': 'x; drop table' } }), '10.0.0.1');
    delete process.env.TRUST_CLOUDFLARE;
  });

  await t('o an (honeypot): bot dien => 400; nguoi that bo trong => qua va truong bi go', async () => {
    const hp = honeypot();
    const bad = await run(hp, { body: { content: 'x', hp: 'http://spam' } }); assert.equal(bad.passed, false); assert.equal(bad.res.code, 400);
    const body = { content: 'x', hp: '  ' }; assert.ok((await run(hp, { body })).passed); assert.ok(!('hp' in body));
  });

  await t('Turnstile: chua cau hinh => cho qua; CAPTCHA_REQUIRED=true => 503 (fail-closed)', async () => {
    const cap = requireCaptcha();
    assert.ok((await run(cap, { body: { content: 'x' } })).passed);
    process.env.CAPTCHA_REQUIRED = 'true';
    const r = await run(cap, { body: { content: 'x' } }); assert.equal(r.res.code, 503); assert.equal(r.res.body.code, 'captcha_unavailable');
    delete process.env.CAPTCHA_REQUIRED;
  });

  await t('Turnstile da cau hinh: thieu/sai token => 400 captcha_failed; dung => qua va token bi go khoi body', async () => {
    process.env.TURNSTILE_SITE_KEY = 'site'; process.env.TURNSTILE_SECRET_KEY = 'secret';
    const calls = []; const realFetch = global.fetch;
    global.fetch = async (url, opts) => { calls.push(String(opts.body)); return { json: async () => ({ success: /response=good/.test(String(opts.body)) }) }; };
    const cap = requireCaptcha();
    let r = await run(cap, { body: { content: 'x' }, headers: {}, ip: '1.1.1.1' }); assert.equal(r.res.code, 400); assert.equal(r.res.body.code, 'captcha_failed'); assert.equal(calls.length, 0); // khong ton luot goi Cloudflare
    r = await run(cap, { body: { captcha: 'bad' }, headers: {}, ip: '1.1.1.1' }); assert.equal(r.res.code, 400); assert.equal(r.res.body.code, 'captcha_failed');
    const body = { content: 'x', captcha: 'good' }; r = await run(cap, { body, headers: {}, ip: '1.1.1.1' }); assert.ok(r.passed); assert.ok(!('captcha' in body));
    assert.ok(calls.some((c) => /remoteip=1.1.1.1/.test(c)));
    global.fetch = realFetch; delete process.env.TURNSTILE_SITE_KEY; delete process.env.TURNSTILE_SECRET_KEY;
  });

  await t('gan vao route: bai moi, binh luan moi, Fan Art (dang + sua) co captcha + o an; reaction/xoa thi khong', async () => {
    const forumApi = require('../routes/forum').api, pubApi = require('../routes/api').router;
    const names = (r, m, p) => r.layers.filter((l) => l.method === m && l.path === p).flatMap((l) => l.fns).map((f) => f.name);
    for (const [r, m, p] of [[forumApi, 'POST', '/posts'], [forumApi, 'POST', '/posts/:id/comments'], [pubApi, 'POST', '/fanart'], [pubApi, 'PUT', '/fanart/:id']]) {
      const ns = names(r, m, p); assert.ok(ns.includes('captchaGuard') && ns.includes('honeypotGuard'), `${m} ${p}: ${ns}`);
      assert.ok(ns.indexOf('stacked') >= 0 && ns.indexOf('stacked') < ns.indexOf('honeypotGuard') && ns.indexOf('honeypotGuard') < ns.indexOf('captchaGuard'), `thu tu limiter -> o an -> captcha: ${ns}`);
    }
    assert.ok(!names(forumApi, 'POST', '/posts/:id/reaction').includes('captchaGuard'));
    assert.ok(!names(forumApi, 'DELETE', '/posts/:id').includes('captchaGuard'));
  });

  console.log(`\n${n} antispam tests passed`);
})();
