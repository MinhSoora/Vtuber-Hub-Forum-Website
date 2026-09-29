'use strict';
/**
 * Kiem thu Discord OAuth2 + tai khoan:  npm test   (khong can mang, khong can Discord that)
 *
 * Chay CODE THAT cua services/users|discord|sessionStore, middleware/auth va routes/auth.
 * Chi 2 thu duoc thay the: `express` (Router gia ghi lai handler roi goi truc tiep) va tang mang
 * (global.fetch mo phong Discord). `express-session` chi bi thay bang lop Store rong khi chua cai.
 */
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), Module = require('module');
const { EventEmitter } = require('events');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vth-auth-'));
Object.assign(process.env, {
  USERS_FILE: path.join(tmp, 'users.json'), SESSIONS_FILE: path.join(tmp, 'sessions.json'),
  VTUBER_DATA_FILE: path.join(tmp, 'vtubers.json'), VTUBER_CACHE_DIR: tmp, FANART_FILE: path.join(tmp, 'fanart.json'), NEWS_FILE: path.join(tmp, 'news.json'),
  DISCORD_CLIENT_ID: '111111111111111111', DISCORD_CLIENT_SECRET: 'super-secret-value', DISCORD_REDIRECT_URI: 'http://localhost:3000/auth/discord/callback',
  ADMIN_DISCORD_IDS: '999999999999999999, 222222222222222222 ,not-an-id', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'pw123',
});

/* ---- stub express / express-session (chi de nap module; logic auth la code that) ---- */
class FakeRouter {
  constructor() { this.layers = []; }
  _add(method, args) { const [a, ...rest] = args; const hasPath = typeof a === 'string'; this.layers.push({ method, path: hasPath ? a : null, fns: (hasPath ? rest : args).flat() }); return this; }
  use(...a) { return this._add(null, a); } get(...a) { return this._add('GET', a); } post(...a) { return this._add('POST', a); }
  put(...a) { return this._add('PUT', a); } delete(...a) { return this._add('DELETE', a); }
  /** Chay chuoi handler khop method+path (kem router.use) giong Express. */
  async run(method, p, req, res) {
    const fns = this.layers.filter((l) => (!l.method || l.method === method) && (!l.path || l.path === p)).flatMap((l) => l.fns);
    for (let i = 0; i < fns.length && !res.done; i++) {
      let called = false, err;
      await new Promise((resolve) => {
        const next = (e) => { called = true; err = e; resolve(); };
        Promise.resolve(fns[i](req, res, next)).then(() => { if (!called) { const t = setInterval(() => { if (called || res.done) { clearInterval(t); resolve(); } }, 1); } }).catch((e) => { err = e; called = true; resolve(); });
        if (res.done) resolve();
      });
      if (err) throw err;
      if (!called) break; // handler ket thuc response, khong goi next
    }
  }
}
const expressStub = () => {}; expressStub.Router = () => new FakeRouter(); expressStub.json = () => () => {};
class StubStore extends EventEmitter {}
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'express') return expressStub;
  if (req === 'express-session') { try { return origLoad.call(this, req, ...rest); } catch { return { Store: StubStore }; } }
  return origLoad.call(this, req, ...rest);
};

const users = require('../services/users'), discord = require('../services/discord'), auth = require('../middleware/auth');
const { FileSessionStore } = require('../services/sessionStore'), sessionStore = require('../services/sessionStore');
const authRoutes = require('../routes/auth');

/* ---- mo phong Discord ---- */
const realFetch = global.fetch;
const DID = '222222222222222222', AV = 'ab'.repeat(16);
let discordCalls = [], tokenFails = false, profile = { id: DID, username: 'hoshi', avatar: AV };
global.fetch = async (url, opts = {}) => {
  const u = String(url), j = (o, ok = true, status = 200) => ({ ok, status, json: async () => o });
  if (!u.startsWith('https://discord.com/api/v10/')) throw new Error('goi mang ngoai y muon: ' + u);
  discordCalls.push({ url: u, opts });
  if (u.endsWith('/oauth2/token')) return tokenFails ? j({ error: 'invalid_grant' }, false, 400) : j({ access_token: 'tok-abc', token_type: 'Bearer', scope: 'identify' });
  if (u.endsWith('/oauth2/token/revoke')) return j({});
  if (u.endsWith('/users/@me')) return opts.headers.Authorization === 'Bearer tok-abc' ? j(profile) : j({}, false, 401);
  throw new Error('endpoint la: ' + u);
};

/* ---- request/response gia ---- */
const store = sessionStore.get();
let sidN = 0;
function makeSession(data = {}) {
  const s = { cookie: { maxAge: 8 * 3600e3 }, ...data };
  Object.defineProperties(s, {
    regenerate: { enumerable: false, value(cb) { for (const k of Object.keys(this)) delete this[k]; this.cookie = { maxAge: 8 * 3600e3 }; s.__req.sessionID = 'sid-' + (++sidN); cb(); } },
    save: { enumerable: false, value(cb) { store.set(s.__req.sessionID, JSON.parse(JSON.stringify(this)), () => cb && cb()); } },
    destroy: { enumerable: false, value(cb) { store.destroy(s.__req.sessionID, () => { s.__req.destroyed = true; cb && cb(); }); } },
    __req: { enumerable: false, writable: true, value: null },
  });
  return s;
}
function mkReq(o = {}) {
  const req = { method: 'GET', ip: o.ip || '10.0.0.' + (++sidN), query: {}, headers: {}, originalUrl: o.url || '/', sessionID: 'sid-' + (++sidN), ...o };
  req.session = o.session || makeSession(); req.session.__req = req;
  req.get = (h) => req.headers[h.toLowerCase()];
  return req;
}
function mkRes() {
  const r = { done: false, status_: 200, headers: {}, cookiesCleared: [] };
  r.status = (c) => { r.status_ = c; return r; }; r.type = () => r; r.set = () => r;
  r.json = (b) => { r.body = b; r.done = true; return r; }; r.send = (b) => { r.body = b; r.done = true; return r; };
  r.redirect = (l) => { r.location = l; r.status_ = 302; r.done = true; return r; };
  r.clearCookie = (n) => r.cookiesCleared.push(n);
  return r;
}
/** Chay toan bo chuoi middleware toan cuc (attachUser) + router nhu app that. */
async function hit(router, method, p, reqOpts) {
  const req = mkReq({ method, ...reqOpts }), res = mkRes();
  await new Promise((resolve, reject) => auth.attachUser(req, res, (e) => (e ? reject(e) : resolve())));
  await router.run(method, p, req, res);
  return { req, res };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Man hinh consent: GET /login-intent (lay token) -> POST /login (user bam nut) => session.oauth + URL Discord. */
async function beginLogin({ ip, next, session, token } = {}) {
  const i = await hit(authRoutes.api, 'GET', '/login-intent', { ip, session });
  const r = await hit(authRoutes.api, 'POST', '/login', { ip, session: i.req.session, body: { token: token === undefined ? i.res.body.data.token : token, next } });
  return { req: r.req, res: { location: r.res.body && r.res.body.data && r.res.body.data.redirect, raw: r.res }, intent: i.res.body.data };
}
async function login({ ip, next } = {}) {   // di het luong: /login (consent) -> Discord -> /callback
  const a = await beginLogin({ ip, next });
  const state = new URL(a.res.location).searchParams.get('state');
  const b = await hit(authRoutes.pages, 'GET', '/discord/callback', { ip, session: a.req.session, query: { code: 'abcdef1234567890', state } });
  return { a, b, state };
}

let n = 0; const t = async (name, fn) => { try { await fn(); n++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n', e); process.exitCode = 1; } };

(async () => {
  /* ===== users.json ===== */
  await t('users: upsert tao moi, giu createdAt khi dang nhap lai, chi luu 5 truong toi thieu', async () => {
    const a = await users.upsertFromDiscord({ id: DID, username: 'hoshi', avatar: AV, email: 'x@y.z', access_token: 'leak' });
    assert.deepEqual(Object.keys(a).sort(), ['avatar', 'createdAt', 'id', 'updatedAt', 'username']);
    await wait(5); const b = await users.upsertFromDiscord({ id: DID, username: 'hoshi2', avatar: null });
    assert.equal(b.createdAt, a.createdAt); assert.notEqual(b.updatedAt, a.updatedAt); assert.equal(b.username, 'hoshi2'); assert.equal(b.avatar, null);
    const disk = fs.readFileSync(process.env.USERS_FILE, 'utf8'); assert.ok(!/leak|x@y\.z/.test(disk));
  });
  await t('users: persist sau restart (xoa cache bo nho, doc lai tu dia)', async () => {
    users._resetCache(); const u = await users.getById(DID); assert.equal(u.username, 'hoshi2'); assert.equal(await users.count(), 1);
  });
  await t('users: validate Discord ID / username / avatar', async () => {
    for (const bad of [{ id: 'abc', username: 'x' }, { id: '../../etc', username: 'x' }, { id: DID, username: '   ' }, null, { id: 123456789012345678, username: 'x' }]) await assert.rejects(users.upsertFromDiscord(bad), (e) => e.status === 400);
    const u = await users.upsertFromDiscord({ id: '333333333333333333', username: 'a\u0000b\nc', avatar: '../evil' }); assert.equal(u.username, 'abc'); assert.equal(u.avatar, null);
    assert.equal(await users.getById('nope'), null);
  });
  await t('users: song song khong hong file; file hong => loi va KHONG bi ghi de', async () => {
    await Promise.all(Array.from({ length: 8 }, (_, i) => users.upsertFromDiscord({ id: '4444444444444444' + String(10 + i), username: 'p' + i })));
    assert.equal(JSON.parse(fs.readFileSync(process.env.USERS_FILE, 'utf8')).length, 10);
    users._resetCache(); fs.writeFileSync(process.env.USERS_FILE + '.bad', '{oops'); const keep = process.env.USERS_FILE; process.env.USERS_FILE += '.bad';
    await assert.rejects(users.upsertFromDiscord({ id: DID, username: 'z' }), (e) => e.status === 500); assert.equal(fs.readFileSync(process.env.USERS_FILE, 'utf8'), '{oops');
    process.env.USERS_FILE = keep; users._resetCache();
  });

  /* ===== discord service ===== */
  await t('discord: config day du/thieu; secret khong nam trong URL authorize', () => {
    assert.ok(discord.enabled()); const url = discord.authorizeUrl('s'.repeat(64)); assert.ok(!url.includes('super-secret'));
    const q = new URL(url).searchParams; assert.equal(q.get('client_id'), '111111111111111111'); assert.equal(q.get('scope'), 'identify'); assert.equal(q.get('response_type'), 'code'); assert.equal(q.get('redirect_uri'), process.env.DISCORD_REDIRECT_URI);
    const keep = process.env.DISCORD_CLIENT_SECRET; process.env.DISCORD_CLIENT_SECRET = ''; assert.ok(!discord.enabled()); assert.throws(() => discord.authorizeUrl('x'), (e) => e.status === 503); process.env.DISCORD_CLIENT_SECRET = keep;
    const r = process.env.DISCORD_REDIRECT_URI; process.env.DISCORD_REDIRECT_URI = 'javascript:alert(1)'; assert.ok(!discord.enabled()); process.env.DISCORD_REDIRECT_URI = r;
  });
  await t('discord: ADMIN_DISCORD_IDS -> role (bo qua gia tri sai, chiu khoang trang)', () => {
    assert.equal(discord.roleOf('999999999999999999'), 'admin'); assert.equal(discord.roleOf('222222222222222222'), 'admin'); assert.equal(discord.roleOf('555555555555555555'), 'user');
    assert.equal(discord.roleOf(undefined), 'user'); assert.equal(discord.roleOf('not-an-id'), 'user'); assert.deepEqual(discord.invalidAdminIds(), ['not-an-id']);
  });
  await t('discord: sanitizeNext chan open redirect', () => {
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', '/\r\nSet-Cookie: x', 'javascript:alert(1)', '/auth/discord/login', '', 5, ['/a'], null, '/a\u0000b', 'x'.repeat(300), '/' + '\n']) assert.equal(discord.sanitizeNext(bad), '/account', String(bad));
    assert.equal(discord.sanitizeNext('/fanart?page=2'), '/fanart?page=2'); assert.equal(discord.sanitizeNext('/vtuber/abc'), '/vtuber/abc'); assert.equal(discord.sanitizeNext('/%0d%0ax'), '/%0d%0ax'); // da percent-encode => vo hai
  });
  await t('discord: validate state/code', () => {
    assert.ok(discord.isValidState('a'.repeat(64))); for (const b of ['', 'g'.repeat(64), 'a'.repeat(63), ['a'.repeat(64)], undefined, {}]) assert.ok(!discord.isValidState(b));
    assert.ok(discord.isValidCode('AbC123._~-xyzXYZ')); for (const b of ['short', 'has space here', 'a'.repeat(513), ['abcdefgh1'], '<script>alert(1)</script>', undefined]) assert.ok(!discord.isValidCode(b));
  });
  await t('discord: avatarUrl (co avatar / gif / mac dinh)', () => {
    assert.equal(discord.avatarUrl({ id: DID, avatar: AV }), `https://cdn.discordapp.com/avatars/${DID}/${AV}.png?size=128`);
    assert.ok(discord.avatarUrl({ id: DID, avatar: 'a_' + AV }).includes('.gif')); assert.match(discord.avatarUrl({ id: DID, avatar: null }), /embed\/avatars\/[0-5]\.png$/);
  });

  /* ===== session store ===== */
  await t('sessionStore: luu bang hash, persist sau restart, het han bi bo, gioi han theo user', async () => {
    const file = path.join(tmp, 's2.json'), s1 = new FileSessionStore(file, { flushMs: 5 });
    const future = new Date(Date.now() + 60e3).toISOString(), past = new Date(Date.now() - 1e3).toISOString();
    await new Promise((r) => s1.set('SID-ALIVE', { cookie: { expires: future }, user: { id: DID, loginAt: 1 } }, r));
    await new Promise((r) => s1.set('SID-DEAD', { cookie: { expires: past } }, r)); await s1.flush();
    assert.ok(!fs.readFileSync(file, 'utf8').includes('SID-ALIVE'), 'session id khong duoc luu ro');
    const s2 = new FileSessionStore(file); const got = await new Promise((r) => s2.get('SID-ALIVE', (e, v) => r(v))); assert.equal(got.user.id, DID);
    assert.equal(await new Promise((r) => s2.get('SID-DEAD', (e, v) => r(v))), null); assert.equal(await new Promise((r) => s2.get('nope', (e, v) => r(v))), null);
    for (let i = 1; i <= 6; i++) await new Promise((r) => s2.set('U' + i, { cookie: { expires: future }, user: { id: '777777777777777777', loginAt: i } }, r));
    assert.equal(s2.pruneUser('777777777777777777', 3, 'U6'), 3);
    for (const [sid, want] of [['U1', null], ['U3', null], ['U4', 1], ['U5', 1], ['U6', 1]]) assert.equal(!!(await new Promise((r) => s2.get(sid, (e, v) => r(v)))), !!want, sid);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  });

  /* ===== middleware chung ===== */
  await t('attachUser: guest / user / admin (Discord) / admin (legacy) / user bi xoa khoi users.json', async () => {
    const run = async (sess) => { const req = mkReq({ session: makeSession(sess) }); await new Promise((r, j) => auth.attachUser(req, mkRes(), (e) => (e ? j(e) : r()))); return req; };
    let r = await run({}); assert.equal(r.role, 'guest'); assert.equal(r.user, null);
    r = await run({ user: { id: '333333333333333333', loginAt: Date.now() } }); assert.equal(r.role, 'user'); assert.equal(r.user.id, '333333333333333333'); assert.match(r.user.avatarUrl, /^https:\/\/cdn\.discordapp\.com\//);
    r = await run({ user: { id: DID, loginAt: Date.now() } }); assert.equal(r.role, 'admin');
    r = await run({ admin: true }); assert.equal(r.role, 'admin'); assert.equal(r.user, null);
    r = await run({ user: { id: '888888888888888888', loginAt: Date.now() } }); assert.equal(r.role, 'guest'); assert.equal(r.session.user, undefined);
    r = await run({ user: { id: DID, loginAt: Date.now() - auth.USER_ABS_MS - 1000 } }); assert.equal(r.role, 'guest'); // qua han tuyet doi
    r = await run({ user: { id: DID } }); assert.equal(r.role, 'guest');
  });
  await t('requireAuth / requireAdmin: API => 401/403 JSON; trang => redirect / 403', () => {
    const go = (mw, req) => { const res = mkRes(); let passed = false; mw(req, res, () => { passed = true; }); return { res, passed }; };
    let x = go(auth.requireAuth, { user: null, originalUrl: '/api/auth/account', get: () => '' }); assert.equal(x.res.status_, 401); assert.equal(x.passed, false);
    x = go(auth.requireAuth, { user: null, originalUrl: '/account', get: () => '' }); assert.equal(x.res.location, '/auth/discord/login?next=%2Faccount');
    x = go(auth.requireAuth, { user: { id: 'x' }, originalUrl: '/account', get: () => '' }); assert.ok(x.passed);
    x = go(auth.requireAdmin, { user: null, role: 'guest', originalUrl: '/api/admin/vtubers', get: () => '' }); assert.equal(x.res.status_, 401);
    x = go(auth.requireAdmin, { user: { id: 'x' }, role: 'user', originalUrl: '/api/admin/vtubers', get: () => '' }); assert.equal(x.res.status_, 403);
    x = go(auth.requireAdmin, { user: { id: 'x' }, role: 'user', originalUrl: '/admin', get: () => '' }); assert.equal(x.res.status_, 403);
    x = go(auth.requireAdmin, { user: null, role: 'guest', originalUrl: '/admin', get: () => '' }); assert.equal(x.res.location, '/admin/login');
    x = go(auth.requireAdmin, { user: { id: 'x' }, role: 'admin', originalUrl: '/admin', get: () => '' }); assert.ok(x.passed);
    assert.equal(auth.requireAuthApi, auth.requireAdmin); assert.equal(auth.requireAuthPage, auth.requireAdmin); // route admin cu dung chung middleware moi
  });
  await t('legacy admin: checkCredentials van chay; tat han khi chua cau hinh', () => {
    assert.ok(auth.checkCredentials('admin', 'pw123')); assert.ok(!auth.checkCredentials('admin', 'no'));
    const u = process.env.ADMIN_USERNAME, p = process.env.ADMIN_PASSWORD; process.env.ADMIN_USERNAME = ''; process.env.ADMIN_PASSWORD = ''; assert.ok(!auth.checkCredentials('', '')); process.env.ADMIN_USERNAME = u; process.env.ADMIN_PASSWORD = p;
  });

  /* ===== luong OAuth day du (routes/auth.js that) ===== */
  await t('login: tao state ngau nhien 64 hex trong session, redirect dung Discord; next ngoai bi bo', async () => {
    const { req, res } = await beginLogin({ next: '//evil.com' });
    const u = new URL(res.location); assert.equal(u.origin + u.pathname, 'https://discord.com/oauth2/authorize'); assert.match(u.searchParams.get('state'), /^[a-f0-9]{64}$/);
    assert.equal(req.session.oauth.state, u.searchParams.get('state')); assert.equal(req.session.oauth.next, '/account'); assert.ok(!res.location.includes('super-secret'));
    const b = await beginLogin({}); assert.notEqual(new URL(b.res.location).searchParams.get('state'), u.searchParams.get('state'));
  });
  await t('callback thanh cong: doi code, tao/cap nhat user, regenerate session, CSRF token, thu hoi token, redirect next', async () => {
    discordCalls = []; profile = { id: DID, username: 'hoshi', avatar: AV };
    const oldSid = 'sid-old'; const { a, b } = await login({ next: '/fanart?page=2' });
    assert.equal(b.res.location, '/fanart?page=2'); assert.equal(b.req.session.user.id, DID); assert.ok(b.req.session.user.loginAt);
    assert.equal(b.req.session.oauth, undefined, 'state phai bi xoa (dung 1 lan)'); assert.match(b.req.session.csrf, /^[a-f0-9]{64}$/); assert.equal(b.req.session.cookie.maxAge, auth.USER_IDLE_MS);
    assert.notEqual(b.req.sessionID, a.req.sessionID, 'session id phai doi sau dang nhap'); assert.ok(oldSid);
    const tok = discordCalls.find((c) => c.url.endsWith('/oauth2/token')), body = new URLSearchParams(String(tok.opts.body));
    assert.equal(tok.opts.method, 'POST'); assert.equal(body.get('grant_type'), 'authorization_code'); assert.equal(body.get('client_secret'), 'super-secret-value'); assert.equal(body.get('redirect_uri'), process.env.DISCORD_REDIRECT_URI); assert.equal(body.get('code'), 'abcdef1234567890');
    assert.ok(discordCalls.some((c) => c.url.endsWith('/revoke')), 'phai thu hoi token'); assert.ok(discordCalls.every((c) => c.url.startsWith('https://discord.com/')));
    const u = await users.getById(DID); assert.equal(u.username, 'hoshi'); assert.equal(u.avatar, AV);
    assert.ok(store.map.size > 0 && JSON.stringify([...store.map.values()]).includes(DID), 'session nam o store server-side');
  });
  await t('callback: sai state / thieu state / state cu dung lai / het han / khong co session => that bai, KHONG goi Discord', async () => {
    discordCalls = [];
    const l = await beginLogin({ ip: '10.9.9.1' }); const state = new URL(l.res.location).searchParams.get('state');
    const cb = (session, query, ip) => hit(authRoutes.pages, 'GET', '/discord/callback', { ip, session, query });
    let r = await cb(l.req.session, { code: 'abcdef1234567890', state: 'f'.repeat(64) }, '10.9.9.1'); assert.equal(r.res.location, '/?login_error=state'); assert.equal(r.req.session.user, undefined);
    r = await cb(l.req.session, { code: 'abcdef1234567890', state }, '10.9.9.1'); assert.equal(r.res.location, '/?login_error=state', 'state da bi tieu huy sau lan thu dau');
    const l2 = await beginLogin({ ip: '10.9.9.2' }); l2.req.session.oauth.at = Date.now() - 11 * 60e3;
    r = await cb(l2.req.session, { code: 'abcdef1234567890', state: l2.req.session.oauth.state }, '10.9.9.2'); assert.equal(r.res.location, '/?login_error=state');
    r = await cb(makeSession(), { code: 'abcdef1234567890', state }, '10.9.9.3'); assert.equal(r.res.location, '/?login_error=state');
    r = await cb(makeSession(), { code: 'abcdef1234567890' }, '10.9.9.3'); assert.equal(r.res.location, '/?login_error=invalid');
    assert.equal(discordCalls.length, 0);
  });
  await t('callback: input bat thuong (mang, object, qua dai, ky tu la) bi tu choi truoc khi goi Discord', async () => {
    discordCalls = [];
    for (const q of [{ code: ['a1234567890', 'b1234567890'], state: 'a'.repeat(64) }, { code: { $ne: 1 }, state: 'a'.repeat(64) }, { code: 'x'.repeat(600), state: 'a'.repeat(64) }, { code: '<script>alert(1)</script>', state: 'a'.repeat(64) }, { code: 'abcdefgh12', state: ['a'.repeat(64)] }, {}]) {
      const r = await hit(authRoutes.pages, 'GET', '/discord/callback', { ip: '10.8.8.' + (++sidN), query: q }); assert.equal(r.res.location, '/?login_error=invalid', JSON.stringify(q));
    }
    assert.equal(discordCalls.length, 0);
  });
  await t('callback: nguoi dung huy (access_denied) / Discord loi => bao loi ro rang, khong tao session dang nhap', async () => {
    let r = await hit(authRoutes.pages, 'GET', '/discord/callback', { ip: '10.7.7.1', query: { error: 'access_denied', state: 'a'.repeat(64) } }); assert.equal(r.res.location, '/?login_error=denied');
    tokenFails = true; const l = await beginLogin({ ip: '10.7.7.2' });
    r = await hit(authRoutes.pages, 'GET', '/discord/callback', { ip: '10.7.7.2', session: l.req.session, query: { code: 'abcdef1234567890', state: l.req.session.oauth.state } }); tokenFails = false;
    assert.equal(r.res.location, '/?login_error=failed'); assert.equal(r.req.session.user, undefined);
    profile = { id: 'not-a-snowflake', username: 'x' }; const l2 = await beginLogin({ ip: '10.7.7.3' });
    r = await hit(authRoutes.pages, 'GET', '/discord/callback', { ip: '10.7.7.3', session: l2.req.session, query: { code: 'abcdef1234567890', state: l2.req.session.oauth.state } }); profile = { id: DID, username: 'hoshi', avatar: AV };
    assert.equal(r.res.location, '/?login_error=failed'); assert.equal(await users.getById('not-a-snowflake'), null);
  });
  await t('rate limit: qua 10 callback loi / IP => /?login_error=rate (ke ca hop le)', async () => {
    const ip = '10.6.6.6'; let last;
    for (let i = 0; i < 11; i++) last = await hit(authRoutes.pages, 'GET', '/discord/callback', { ip, query: { code: 'abcdefgh12', state: 'a'.repeat(64) } });
    assert.equal(last.res.location, '/?login_error=rate');
  });
  await t('rate limit chung: /auth/* toi da 30 request/phut/IP', async () => {
    let last; for (let i = 0; i < 32; i++) last = await hit(authRoutes.pages, 'GET', '/discord/login', { ip: '10.5.5.5' });
    assert.equal(last.res.status_, 429);
  });
  await t('chua cau hinh Discord => /auth/discord/login chuyen ve thong bao, khong crash', async () => {
    const keep = process.env.DISCORD_CLIENT_ID; process.env.DISCORD_CLIENT_ID = '';
    const r = await hit(authRoutes.pages, 'GET', '/discord/login', {}); assert.equal(r.res.location, '/?login_error=disabled');
    const me = await hit(authRoutes.api, 'GET', '/me', {}); assert.equal(me.res.body.data.discordEnabled, false); process.env.DISCORD_CLIENT_ID = keep;
  });
  await t('gioi han so phien dong thoi / tai khoan (5): dang nhap lan 6 xoa phien cu nhat', async () => {
    const before = [...store.map.values()].filter((v) => v.user && v.user.id === DID).length;
    for (let i = 0; i < 7; i++) await login({ ip: '10.4.4.' + i });
    const mine = [...store.map.values()].filter((v) => v.user && v.user.id === DID); assert.equal(mine.length, 5, `truoc: ${before}`);
  });

  /* ===== API tai khoan ===== */
  await t('/api/auth/me: guest / user / admin; khong ro ri secret; userId tu session', async () => {
    let r = await hit(authRoutes.api, 'GET', '/me', {}); assert.deepEqual([r.res.body.data.loggedIn, r.res.body.data.role, r.res.body.data.user, r.res.body.data.csrfToken], [false, 'guest', null, null]);
    const { b } = await login({ ip: '10.3.3.1' });
    r = await hit(authRoutes.api, 'GET', '/me', { session: b.req.session, query: { userId: '1' }, headers: {} });
    assert.equal(r.res.body.data.user.id, DID); assert.equal(r.res.body.data.role, 'admin'); assert.equal(r.res.body.data.csrfToken, b.req.session.csrf);
    const json = JSON.stringify(r.res.body); assert.ok(!json.includes('super-secret') && !json.includes('tok-abc'));
    assert.deepEqual(Object.keys(r.res.body.data.user).sort(), ['avatar', 'avatarUrl', 'communityRulesAcceptedAt', 'createdAt', 'id', 'role', 'termsVersion', 'tosAcceptedAt', 'updatedAt', 'username']); // consent chi cua chinh chu
    await users.upsertFromDiscord({ id: '555555555555555555', username: 'thuong' }); const s = makeSession({ user: { id: '555555555555555555', loginAt: Date.now() } });
    r = await hit(authRoutes.api, 'GET', '/me', { session: s }); assert.equal(r.res.body.data.role, 'user');
  });
  await t('/api/auth/account: guest => 401; user => thong tin Discord cua CHINH ho (bo qua userId tu client)', async () => {
    let r = await hit(authRoutes.api, 'GET', '/account', { url: '/api/auth/account' }); assert.equal(r.res.status_, 401);
    const s = makeSession({ user: { id: '555555555555555555', loginAt: Date.now() } });
    r = await hit(authRoutes.api, 'GET', '/account', { url: '/api/auth/account', session: s, query: { userId: DID }, body: { userId: DID } });
    assert.equal(r.res.body.data.user.id, '555555555555555555'); assert.equal(r.res.body.data.user.username, 'thuong'); assert.equal(r.res.body.data.user.role, 'user');
  });
  await t('/api/auth/logout: can CSRF token; dung => huy session + xoa cookie; guest => ok, khong dung vao phien admin legacy', async () => {
    const { b } = await login({ ip: '10.2.2.1' }); const sid = b.req.sessionID;
    let r = await hit(authRoutes.api, 'POST', '/logout', { session: b.req.session, sessionID: sid }); assert.equal(r.res.status_, 403); assert.ok(!r.req.destroyed);
    r = await hit(authRoutes.api, 'POST', '/logout', { session: b.req.session, sessionID: sid, headers: { 'x-csrf-token': 'f'.repeat(64) } }); assert.equal(r.res.status_, 403);
    r = await hit(authRoutes.api, 'POST', '/logout', { session: b.req.session, sessionID: sid, headers: { 'x-csrf-token': b.req.session.csrf } });
    assert.equal(r.res.body.success, true); assert.ok(r.req.destroyed); assert.deepEqual(r.res.cookiesCleared, ['vth.sid']);
    assert.equal(await new Promise((res) => store.get(sid, (e, v) => res(v))), null);
    const legacy = makeSession({ admin: true }); r = await hit(authRoutes.api, 'POST', '/logout', { session: legacy }); assert.equal(r.res.body.success, true); assert.ok(!r.req.destroyed); assert.equal(legacy.admin, true);
  });
  await t('sameOrigin (CSRF co ban) ap dung cho /api/auth: Origin la bi chan', async () => {
    const r = await hit(authRoutes.api, 'POST', '/logout', { headers: { origin: 'https://evil.example', host: 'localhost:3000' } }); assert.equal(r.res.status_, 403);
  });

  /* ===== TOS + Community Rules + consent ===== */
  const legalSvc = require('../services/legal');
  const legalFile = path.join(tmp, 'legal.json'), base = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'legal.json'), 'utf8'));
  let mtimeN = 0;
  const writeLegal = (o) => { fs.writeFileSync(legalFile, typeof o === 'string' ? o : JSON.stringify(o)); const tt = new Date(Date.now() + 1000 * (++mtimeN)); fs.utimesSync(legalFile, tt, tt); };
  process.env.LEGAL_FILE = legalFile; writeLegal(base); legalSvc._reset();

  await t('legal: /api/legal cong khai (khach), du 11 luat bat buoc; bo ky tu dieu khien; file hong giu ban tot', async () => {
    const pubApi = require('../routes/api'); assert.ok(pubApi.router);
    const d = legalSvc.get(); assert.equal(d.termsVersion, '1.0'); assert.ok(d.tos.sections.length >= 5); assert.equal(d.rules.sections.length, 11);
    const all = JSON.stringify(d.rules).toLowerCase();
    for (const k of ['spam', 'nsfw', 'gore', 'quấy rối', 'phân biệt', 'bản quyền', 'giả mạo', 'bypass', 'reaction', 'lừa đảo', 'admin']) assert.ok(all.includes(k), k);
    writeLegal('{oops'); assert.equal(legalSvc.get().termsVersion, '1.0', 'file hong => giu ban truoc');
    writeLegal({ ...base, termsVersion: '../x' }); assert.equal(legalSvc.get().termsVersion, '1.0', 'version sai dinh dang bi tu choi');
    writeLegal({ ...base, tos: { ...base.tos, title: 'A\u0000B' } }); assert.equal(legalSvc.get().tos.title, 'AB');
    writeLegal(base);
  });
  await t('GET /auth/discord/login: khach => chuyen sang /login (consent), KHONG tao state OAuth / khong sang Discord', async () => {
    const r = await hit(authRoutes.pages, 'GET', '/discord/login', { query: { next: '/forum' } });
    assert.equal(r.res.location, '/login?next=%2Fforum'); assert.equal(r.req.session.oauth, undefined);
    const bad = await hit(authRoutes.pages, 'GET', '/discord/login', { query: { next: '//evil.com' } }); assert.equal(bad.res.location, '/login?next=%2Faccount');
    assert.equal(discord.sanitizeNext('/login?x=1'), '/account');
  });
  await t('consent: /login-intent cap token; POST /login thieu/sai token => 403, khong tao OAuth; token dung 1 lan', async () => {
    const i = await hit(authRoutes.api, 'GET', '/login-intent', {}); const d = i.res.body.data;
    assert.equal(d.loggedIn, false); assert.match(d.token, /^[a-f0-9]{64}$/); assert.equal(d.termsVersion, '1.0'); assert.equal(i.req.session.oauth, undefined);
    const nt = await hit(authRoutes.api, 'POST', '/login', { session: makeSession({ loginToken: d.token }), body: {} }); assert.equal(nt.res.status_, 403, 'thieu token'); assert.equal(nt.req.session.oauth, undefined);
    for (const tok of ['', 'f'.repeat(64), 123, null]) {
      const r = await beginLogin({ session: makeSession({ loginToken: d.token }), token: tok }); assert.equal(r.res.raw.status_, 403, String(tok)); assert.equal(r.req.session.oauth, undefined);
    }
    const noSess = await hit(authRoutes.api, 'POST', '/login', { body: { token: d.token } }); assert.equal(noSess.res.status_, 403);
    const ok1 = await hit(authRoutes.api, 'POST', '/login', { session: i.req.session, body: { token: d.token, next: '/forum' } });
    assert.equal(ok1.res.status_, 200); assert.ok(ok1.res.body.data.redirect.startsWith('https://discord.com/oauth2/authorize?'));
    assert.deepEqual([ok1.req.session.oauth.next, ok1.req.session.oauth.consent.version], ['/forum', '1.0']); assert.ok(!isNaN(Date.parse(ok1.req.session.oauth.consent.at)));
    const again = await hit(authRoutes.api, 'POST', '/login', { session: i.req.session, body: { token: d.token } }); assert.equal(again.res.status_, 403, 'token da dung');
  });
  await t('consent: version/thoi diem do SERVER ghi, client gui version/consent/tosAcceptedAt gia bi bo qua', async () => {
    const i = await hit(authRoutes.api, 'GET', '/login-intent', {});
    const r = await hit(authRoutes.api, 'POST', '/login', { session: i.req.session, body: { token: i.res.body.data.token, version: '999', termsVersion: '999', consent: { version: '999', at: '2000-01-01T00:00:00Z' }, tosAcceptedAt: '2000-01-01T00:00:00Z' } });
    assert.equal(r.req.session.oauth.consent.version, '1.0'); assert.ok(Date.now() - Date.parse(r.req.session.oauth.consent.at) < 5000);
  });
  await t('callback thanh cong => users.json luu tosAcceptedAt / communityRulesAcceptedAt / termsVersion; khong luu mat khau/token', async () => {
    const uid = '666666666666666601'; profile = { id: uid, username: 'newbie', avatar: null };
    const before = Date.now(); const { b } = await login({ ip: '10.61.1.1' });
    const row = JSON.parse(fs.readFileSync(process.env.USERS_FILE, 'utf8')).find((u) => u.id === uid);
    assert.equal(row.termsVersion, '1.0'); assert.equal(row.tosAcceptedAt, row.communityRulesAcceptedAt); assert.ok(Date.parse(row.tosAcceptedAt) >= before - 2000 && Date.parse(row.tosAcceptedAt) <= Date.now());
    assert.deepEqual(Object.keys(row).sort(), ['avatar', 'communityRulesAcceptedAt', 'createdAt', 'id', 'termsVersion', 'tosAcceptedAt', 'updatedAt', 'username']);
    const me = await hit(authRoutes.api, 'GET', '/me', { session: b.req.session }); assert.equal(me.res.body.data.consentRequired, false); assert.equal(me.res.body.data.user.termsVersion, '1.0');
    profile = { id: DID, username: 'hoshi', avatar: AV };
  });
  await t('callback: state OAuth khong co consent (khong bat dau tu man hinh consent) => tu choi', async () => {
    const s = makeSession({ oauth: { state: 'a'.repeat(64), next: '/', at: Date.now() } }); const before = discordCalls.length;
    const r = await hit(authRoutes.pages, 'GET', '/discord/callback', { ip: '10.62.1.1', session: s, query: { code: 'abcdef1234567890', state: 'a'.repeat(64) } });
    assert.equal(r.res.location, '/?login_error=state'); assert.equal(r.req.session.user, undefined); assert.equal(discordCalls.length, before, 'khong duoc goi Discord');
  });
  await t('users: upsert khong consent GIU consent cu; consent gia/sai dinh dang bi bo qua; recordConsent cap nhat, user la => null', async () => {
    const uid = '666666666666666602';
    await users.upsertFromDiscord({ id: uid, username: 'a' }, { version: '1.0', at: '2026-01-02T03:04:05.000Z' });
    const k = await users.upsertFromDiscord({ id: uid, username: 'a2' }); assert.deepEqual([k.termsVersion, k.tosAcceptedAt], ['1.0', '2026-01-02T03:04:05.000Z']);
    for (const bad of [{ version: '../x', at: '2026-01-01T00:00:00Z' }, { version: '1.0', at: 'not-a-date' }, { version: 5, at: '2026-01-01T00:00:00Z' }, 'yes', null]) {
      const u = await users.upsertFromDiscord({ id: uid, username: 'a3' }, bad); assert.equal(u.tosAcceptedAt, '2026-01-02T03:04:05.000Z', JSON.stringify(bad));
    }
    const fresh = await users.upsertFromDiscord({ id: '666666666666666603', username: 'nc' }, { version: '1.0', at: 'bad' }); assert.equal(fresh.termsVersion, undefined);
    const r = await users.recordConsent(uid, { version: '2.0', at: '2026-05-05T00:00:00.000Z' }); assert.equal(r.termsVersion, '2.0'); assert.equal(await users.recordConsent('777777777777777799', { version: '2.0', at: '2026-05-05T00:00:00.000Z' }), null);
    await assert.rejects(users.recordConsent(uid, { version: 'x y', at: 'z' }), (e) => e.status === 400);
    assert.equal((JSON.parse(fs.readFileSync(process.env.USERS_FILE, 'utf8')).find((u) => u.id === uid)).termsVersion, '2.0', 'da ghi xuong dia');
  });
  await t('requireConsent: khach qua (requireAuth lo); user chua consent => API 403 consent_required / trang => /login?reconsent=1; da consent qua', async () => {
    const go = (req) => { const res = mkRes(); let passed = false; auth.requireConsent(req, res, () => { passed = true; }); return { res, passed }; };
    const now = new Date().toISOString(), okU = { id: 'x', termsVersion: '1.0', tosAcceptedAt: now, communityRulesAcceptedAt: now };
    assert.ok(go({ user: null, originalUrl: '/api/x', get: () => '' }).passed); assert.ok(go({ user: okU, originalUrl: '/api/x', get: () => '' }).passed);
    let x = go({ user: { id: 'x' }, originalUrl: '/api/forum/posts', get: () => '' }); assert.equal(x.passed, false); assert.equal(x.res.status_, 403); assert.equal(x.res.body.code, 'consent_required');
    x = go({ user: { id: 'x' }, originalUrl: '/fanart/upload', get: () => '' }); assert.equal(x.res.location, '/login?reconsent=1&next=%2Ffanart%2Fupload');
    for (const u of [{ ...okU, termsVersion: '0.9' }, { ...okU, tosAcceptedAt: undefined }, { ...okU, communityRulesAcceptedAt: 'zzz' }]) assert.equal(go({ user: u, originalUrl: '/api/x', get: () => '' }).passed, false);
  });
  await t('nang version TOS: user cu bi yeu cau xac nhan lai; POST /consent can dang nhap + CSRF + agree:true; server tu quyet dinh version', async () => {
    const uid = '666666666666666604'; profile = { id: uid, username: 'oldtimer', avatar: null };
    const { b } = await login({ ip: '10.63.1.1' }); const sess = b.req.session;
    writeLegal({ ...base, termsVersion: '2.0', updatedAt: '2027-01-01' });   // admin tang version trong legal.json - khong dong vao code auth
    let me = await hit(authRoutes.api, 'GET', '/me', { session: sess }); assert.equal(me.res.body.data.consentRequired, true); assert.equal(me.res.body.data.termsVersion, '2.0'); assert.equal(me.res.body.data.loggedIn, true);
    let r = await hit(authRoutes.pages, 'GET', '/discord/login', { session: sess, query: { next: '/forum' } }); assert.equal(r.res.location, '/login?reconsent=1&next=%2Fforum');
    r = await hit(authRoutes.api, 'GET', '/login-intent', { session: sess }); assert.deepEqual([r.res.body.data.loggedIn, r.res.body.data.consentRequired, r.res.body.data.token], [true, true, null]);
    r = await hit(authRoutes.api, 'POST', '/consent', { url: '/api/auth/consent', body: { agree: true } }); assert.equal(r.res.status_, 401);
    r = await hit(authRoutes.api, 'POST', '/consent', { url: '/api/auth/consent', session: sess, body: { agree: true } }); assert.equal(r.res.status_, 403);
    r = await hit(authRoutes.api, 'POST', '/consent', { url: '/api/auth/consent', session: sess, headers: { 'x-csrf-token': sess.csrf }, body: {} }); assert.equal(r.res.status_, 400);
    assert.equal((await users.getById(uid)).termsVersion, '1.0', 'chua dong y thi khong doi');
    r = await hit(authRoutes.api, 'POST', '/consent', { url: '/api/auth/consent', session: sess, headers: { 'x-csrf-token': sess.csrf }, body: { agree: true, version: '1.0', at: '2000-01-01T00:00:00Z' } });
    assert.equal(r.res.status_, 200); assert.equal(r.res.body.data.consentRequired, false);
    const row = await users.getById(uid); assert.equal(row.termsVersion, '2.0'); assert.ok(Date.now() - Date.parse(row.tosAcceptedAt) < 5000, 'thoi diem do server');
    me = await hit(authRoutes.api, 'GET', '/me', { session: sess }); assert.equal(me.res.body.data.consentRequired, false);
    r = await hit(authRoutes.pages, 'GET', '/discord/login', { session: sess, query: { next: '/forum' } }); assert.equal(r.res.location, '/forum');
    writeLegal(base); profile = { id: DID, username: 'hoshi', avatar: AV };
  });
  await t('user cu (truoc khi co TOS, chua co truong consent): dang nhap duoc, nhung bi yeu cau xac nhan; dang nhap lai qua consent thi het', async () => {
    const uid = '666666666666666605'; await users.upsertFromDiscord({ id: uid, username: 'legacy' });   // khong consent
    const s = makeSession({ user: { id: uid, loginAt: Date.now() } }); s.csrf = 'c'.repeat(64);
    let me = await hit(authRoutes.api, 'GET', '/me', { session: s }); assert.equal(me.res.body.data.loggedIn, true); assert.equal(me.res.body.data.consentRequired, true); assert.equal(me.res.body.data.user.termsVersion, undefined);
    profile = { id: uid, username: 'legacy', avatar: null }; await login({ ip: '10.64.1.1' });
    assert.equal((await users.getById(uid)).termsVersion, '1.0'); profile = { id: DID, username: 'hoshi', avatar: AV };
  });
  await t('chua bat Discord: /login-intent khong cap token; POST /login => 503', async () => {
    const keep = process.env.DISCORD_CLIENT_ID; process.env.DISCORD_CLIENT_ID = '';
    const i = await hit(authRoutes.api, 'GET', '/login-intent', {}); assert.deepEqual([i.res.body.data.discordEnabled, i.res.body.data.token], [false, null]);
    const r = await hit(authRoutes.api, 'POST', '/login', { body: {} }); assert.equal(r.res.status_, 503); process.env.DISCORD_CLIENT_ID = keep;
  });
  await t('trang /tos, /community-rules, /login + footer + form login co link TOS/Rules; khong nhung secret', () => {
    const pub = path.join(__dirname, '..', 'public'), rd = (f) => fs.readFileSync(path.join(pub, f), 'utf8');
    for (const [f, page] of [['tos.html', 'tos'], ['community-rules.html', 'rules'], ['login.html', 'login']]) { const c = rd(f); assert.ok(c.includes(`data-page="${page}"`) && c.includes('/js/legal.js'), f); }
    const app = rd('js/app.js'); assert.ok(app.includes("'/tos'") && app.includes("'/community-rules'"), 'footer');
    const lg = rd('js/legal.js'); assert.ok(lg.includes('Bằng cách đăng nhập, bạn xác nhận rằng bạn đã đọc và đồng ý với') && lg.includes('Đăng nhập bằng Discord') && lg.includes('/tos') && lg.includes('/community-rules'));
    const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.match(srv, /app\.get\('\/tos', send\(/); assert.match(srv, /app\.get\('\/community-rules', send\(/); assert.match(srv, /app\.get\('\/fanart\/upload', auth\.requireAuth, auth\.requireConsent/);
    assert.ok(!/app\.get\('\/(tos|community-rules|login)', auth\./.test(srv), 'cong khai, khong can dang nhap');
  });

  /* ===== khong ro ri secret ra frontend ===== */
  await t('public/*, views/* khong chua DISCORD_CLIENT_SECRET / SESSION_SECRET / token', () => {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of [...walk(path.join(__dirname, '..', 'public')), ...walk(path.join(__dirname, '..', 'views'))]) {
      const c = fs.readFileSync(f, 'utf8'); assert.ok(!/DISCORD_CLIENT_SECRET|SESSION_SECRET|client_secret|access_token/i.test(c), f);
    }
  });

  global.fetch = realFetch;
  console.log(`\n${n} auth tests passed${process.exitCode ? ' (co test FAIL)' : ''}`);
  store.flushSync(); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(process.exitCode || 0);
})();
