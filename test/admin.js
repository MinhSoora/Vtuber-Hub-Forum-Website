'use strict';
/**
 * Kiem thu Admin Users / Moderation (ban-kick-warn) / Popup / Marquee:  npm test   (khong can mang)
 * Chay CODE THAT cua services/forum|fanart|users, middleware/auth + rateLimit, routes/forum|api|admin.
 * Chi thay: `express` (Router gia ghi lai handler roi goi truc tiep) va tang mang (global.fetch gia lap imgbb).
 */
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), Module = require('module');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vth-admin-'));
const F = (n) => path.join(tmp, n);
Object.assign(process.env, {
  USERS_FILE: F('users.json'), SESSIONS_FILE: F('sessions.json'), POSTS_FILE: F('posts.json'), COMMENTS_FILE: F('comments.json'), FANART_FILE: F('fanarts.json'),
  VTUBER_DATA_FILE: F('vtubers.json'), VTUBER_CACHE_DIR: tmp, NEWS_FILE: F('news.json'), MODERATION_FILE: F('moderation.json'), POPUPS_FILE: F('popups.json'), MARQUEE_FILE: F('marquee.json'), IMGBB_API_KEY: 'k',
  ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'pw123', ADMIN_DISCORD_IDS: '555555555555555555', ADMIN_RATE_MAX: '200',
});
delete process.env.TURNSTILE_SITE_KEY; delete process.env.TURNSTILE_SECRET_KEY;

class FakeRouter {
  constructor() { this.layers = []; }
  _add(method, args) { const [a, ...rest] = args; const hasPath = typeof a === 'string'; this.layers.push({ method, path: hasPath ? a : null, fns: (hasPath ? rest : args).flat() }); return this; }
  use(...a) { return this._add(null, a); } get(...a) { return this._add('GET', a); } post(...a) { return this._add('POST', a); }
  put(...a) { return this._add('PUT', a); } delete(...a) { return this._add('DELETE', a); }
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
      if (!called) break;
    }
  }
}
const expressStub = () => {}; expressStub.Router = () => new FakeRouter(); expressStub.json = () => () => {};
const { EventEmitter } = require('events'); class StubStore extends EventEmitter {}
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'express') return expressStub;
  if (req === 'express-session') { try { return origLoad.call(this, req, ...rest); } catch { return { Store: StubStore }; } }
  return origLoad.call(this, req, ...rest);
};

const users = require('../services/users'), forum = require('../services/forum'), fanart = require('../services/fanart'), auth = require('../middleware/auth');
const { makeList } = require('../services/jsonlist');
const forumRoutes = require('../routes/forum'), publicApi = require('../routes/api'), admin = require('../routes/admin');
const moderation = require('../services/moderation'), sessionStore = require('../services/sessionStore');

// mo phong imgbb
let imgN = 0; const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).includes('imgbb.com')) { imgN++; return { ok: true, json: async () => ({ success: true, data: { display_url: `https://i.ibb.co/${imgN}/a.jpg`, thumb: { url: `https://i.ibb.co/${imgN}/t.jpg` }, delete_url: 'https://ibb.co/del' } }) }; }
  return realFetch(url, opts);
};
const IMG = 'aGVsbG8=', CSRF = 'c'.repeat(64);
let ipn = 0;
/** as = user (dang nhap) | null (khach); admin:true = phien admin legacy; csrf:false = khong gui CSRF token. */
async function call(router, method, p, { as = null, admin: adm = false, csrf = true, params = {}, body = {}, query = {} } = {}) {
  const req = { method, ip: '10.7.' + (++ipn) + '.1', query, params, body, originalUrl: '/api/test', headers: {}, session: { cookie: {} } };
  if (as) { req.session.user = { id: as.id, loginAt: Date.now() }; req.session.csrf = CSRF; if (csrf) req.headers['x-csrf-token'] = CSRF; }
  if (adm) req.session.admin = true;
  req.get = (h) => req.headers[h.toLowerCase()];
  const res = { done: false, status_: 200 };
  res.status = (c) => { res.status_ = c; return res; }; res.set = () => res; res.type = () => res;
  res.json = (b) => { res.body = b; res.done = true; return res; }; res.send = res.json; res.redirect = (l) => { res.location = l; res.status_ = 302; res.done = true; return res; };
  await new Promise((resolve, reject) => auth.attachUser(req, res, (e) => (e ? reject(e) : resolve())));
  await router.run(method, p, req, res);
  return { s: res.status_, b: res.body, d: res.body && res.body.data };
}

const Fo = forumRoutes.api, Pub = publicApi.router, Ad = admin.api;
const disk = (f) => JSON.parse(fs.readFileSync(F(f), 'utf8'));
let n = 0; const t = async (name, fn) => { try { await fn(); n++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n', e); process.exitCode = 1; } };
const OK = 'a'.repeat(12);

(async () => {
  const legalSvc = require('../services/legal');
  const mk = (id, username) => users.upsertFromDiscord({ id, username, avatar: null }, { version: legalSvc.version(), at: new Date().toISOString() });
  const alice = await mk('111111111111111101', 'alice'), bob = await mk('111111111111111102', 'bob'), root = await mk('555555555555555555', 'root');
  const ADM = { as: root };

  await t('bao mat: moi Admin API moi (users/moderation/popups/marquee/summary) can requireAdmin: khach 401, user thuong 403', async () => {
    const eps = [['GET', '/users'], ['GET', '/users/:id'], ['POST', '/users/:id/ban'], ['POST', '/users/:id/unban'], ['POST', '/users/:id/kick'], ['POST', '/users/:id/warn'], ['GET', '/moderation'], ['GET', '/summary'],
      ['GET', '/popups'], ['POST', '/popups'], ['PUT', '/popups/:id'], ['POST', '/popups/:id/toggle'], ['DELETE', '/popups/:id'],
      ['GET', '/marquee'], ['POST', '/marquee'], ['PUT', '/marquee/:id'], ['POST', '/marquee/:id/toggle'], ['DELETE', '/marquee/:id']];
    for (const [m, p] of eps) {
      const o = { params: { id: bob.id }, body: { reason: 'x', text: 'x', title: 'x', message: 'x' } };
      assert.equal((await call(Ad, m, p, o)).s, 401, 'khach ' + m + p);
      assert.equal((await call(Ad, m, p, { ...o, as: alice })).s, 403, 'user ' + m + p);
    }
    assert.equal((await call(Ad, 'GET', '/users', { admin: true })).s, 200);   // phien legacy van vao duoc
  });

  await t('tim user: theo Discord ID (tien to/chinh xac) hoac username; ket qua khong lo secret', async () => {
    assert.equal((await call(Ad, 'GET', '/users', { ...ADM, query: { q: 'ali' } })).d.map((u) => u.username).join(), 'alice');
    assert.equal((await call(Ad, 'GET', '/users', { ...ADM, query: { q: bob.id } })).d[0].id, bob.id);
    assert.equal((await call(Ad, 'GET', '/users', { ...ADM })).d.length, 3);
    assert.deepEqual(Object.keys((await call(Ad, 'GET', '/users', { ...ADM, query: { q: 'ali' } })).d[0]).sort(), ['avatarUrl', 'ban', 'createdAt', 'id', 'kickCount', 'role', 'updatedAt', 'username', 'warnCount']);
  });

  await t('validate: ID sai 400, user khong ton tai 404, thieu ly do 400, thoi han sai 400; tu ban / ban Admin khac bi chan 403', async () => {
    assert.equal((await call(Ad, 'POST', '/users/:id/ban', { ...ADM, params: { id: 'abc' }, body: { reason: 'x', permanent: true } })).s, 400);
    assert.equal((await call(Ad, 'POST', '/users/:id/ban', { ...ADM, params: { id: '999999999999999999' }, body: { reason: 'x', permanent: true } })).s, 404);
    assert.equal((await call(Ad, 'POST', '/users/:id/ban', { ...ADM, params: { id: alice.id }, body: { permanent: true } })).s, 400);
    assert.equal((await call(Ad, 'POST', '/users/:id/ban', { ...ADM, params: { id: alice.id }, body: { reason: 'x' } })).s, 400);
    assert.equal((await call(Ad, 'POST', '/users/:id/ban', { ...ADM, params: { id: alice.id }, body: { reason: 'x', durationMinutes: -5 } })).s, 400);
    assert.equal((await call(Ad, 'POST', '/users/:id/ban', { ...ADM, params: { id: alice.id }, body: { reason: 'x', durationMinutes: 'abc' } })).s, 400);
    assert.equal((await call(Ad, 'POST', '/users/:id/ban', { ...ADM, params: { id: root.id }, body: { reason: 'x', permanent: true } })).s, 403);   // tu ban
    const boss = await mk('666666666666666666', 'boss'); process.env.ADMIN_DISCORD_IDS += ',666666666666666666';
    for (const a of ['ban', 'kick', 'warn']) assert.equal((await call(Ad, 'POST', '/users/:id/' + a, { ...ADM, params: { id: boss.id }, body: { reason: 'x', permanent: true } })).s, 403, a + ' admin khac');
    process.env.ADMIN_DISCORD_IDS = '555555555555555555';
    assert.equal(moderation.LIMITS.reason, 300);
    assert.equal((await call(Ad, 'POST', '/users/:id/warn', { ...ADM, params: { id: alice.id }, body: { reason: 'y'.repeat(301) } })).s, 400);
    assert.equal(disk_exists(), false, 'validate loi khong duoc ghi file');
  });
  function disk_exists() { return fs.existsSync(F('moderation.json')) && disk('moderation.json').length > 0; }

  await t('ban: adminId lay tu SESSION (adminId/createdAt/id tu client bi bo qua); luu reason + createdAt + expiresAt; ban dang co => 409', async () => {
    const r = await call(Ad, 'POST', '/users/:id/ban', { ...ADM, params: { id: alice.id }, body: { reason: '<b>Spam</b> link', durationMinutes: 60, adminId: '1'.repeat(18), createdAt: '2000-01-01', id: OK, userId: bob.id } });
    assert.equal(r.s, 200); assert.equal(r.d.adminId, root.id); assert.equal(r.d.userId, alice.id); assert.notEqual(r.d.id, OK);
    assert.equal(r.d.reason, 'Spam link'); assert.ok(Date.parse(r.d.createdAt) > Date.parse('2001-01-01'));
    const ms = Date.parse(r.d.expiresAt) - Date.now(); assert.ok(ms > 59 * 60e3 && ms <= 60 * 60e3);
    assert.equal(disk('moderation.json').length, 1);
    assert.equal((await call(Ad, 'POST', '/users/:id/ban', { ...ADM, params: { id: alice.id }, body: { reason: 'again', permanent: true } })).s, 409);
    const legacy = await call(Ad, 'POST', '/users/:id/warn', { admin: true, params: { id: bob.id }, body: { reason: 'legacy warn' } });
    assert.equal(legacy.d.adminId, 'legacy-admin');   // phien admin username/password khong co Discord ID
  });

  await t('ban kiem tra o authentication middleware: user bi ban thanh khach (khong bypass bang session moi); admin khong bi anh huong', async () => {
    const r = await call(Fo, 'POST', '/posts', { as: alice, body: { content: 'toi van dang bai?' } });
    assert.equal(r.s, 401);
    const me = await call(require('../routes/auth').api, 'GET', '/me', { as: alice });
    assert.equal(me.d.loggedIn, false); assert.equal(me.d.ban.reason, 'Spam link');
    assert.equal((await call(Ad, 'GET', '/users', { as: alice })).s, 401);
    assert.equal((await call(Fo, 'POST', '/posts', { as: bob, body: { content: 'bob van dang duoc' } })).s, 201);
  });

  await t('ban co han: het han thi tu het hieu luc; unban go ngay; unban khi khong bi ban => 404; lich su giu du ban ghi', async () => {
    const rows = disk('moderation.json'); rows.find((x) => x.type === 'ban').expiresAt = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(F('moderation.json'), JSON.stringify(rows)); moderation._resetCache();
    assert.equal(await moderation.activeBan(alice.id), null);
    assert.equal((await call(Fo, 'POST', '/posts', { as: alice, body: { content: 'het han ban' } })).s, 201);
    assert.equal((await call(Ad, 'POST', '/users/:id/unban', { ...ADM, params: { id: alice.id } })).s, 404);
    await call(Ad, 'POST', '/users/:id/ban', { ...ADM, params: { id: alice.id }, body: { reason: 'vinh vien', permanent: true } });
    assert.equal((await call(Ad, 'GET', '/users/:id', { ...ADM, params: { id: alice.id } })).d.ban.expiresAt, null);
    assert.equal((await call(Fo, 'POST', '/posts', { as: alice, body: { content: 'x' } })).s, 401);
    const u = await call(Ad, 'POST', '/users/:id/unban', { ...ADM, params: { id: alice.id } });
    assert.equal(u.s, 200); assert.equal(u.d.revokedBy, root.id); assert.equal(u.d.state, 'revoked');
    assert.equal((await call(Fo, 'POST', '/posts', { as: alice, body: { content: 'sau unban' } })).s, 201);
    const h = (await call(Ad, 'GET', '/users/:id', { ...ADM, params: { id: alice.id } })).d;
    assert.equal(h.history.bans.length, 2); assert.equal(h.ban, null);
  });

  await t('kick: huy MOI session hien co cua user (khong ban); ghi nhat ky; user dang nhap lai duoc', async () => {
    const st = sessionStore.get(); st.set('sid-a1', { cookie: {}, user: { id: bob.id, loginAt: 1 } }); st.set('sid-a2', { cookie: {}, user: { id: bob.id, loginAt: 2 } }); st.set('sid-x', { cookie: {}, user: { id: alice.id, loginAt: 3 } });
    const r = await call(Ad, 'POST', '/users/:id/kick', { ...ADM, params: { id: bob.id }, body: { reason: 'phien la' } });
    assert.equal(r.s, 200); assert.equal(r.d.sessionsClosed, 2); assert.equal(r.d.type, 'kick');
    const got = (sid) => new Promise((res) => st.get(sid, (e, v) => res(v)));
    assert.equal(await got('sid-a1'), null); assert.equal(await got('sid-a2'), null); assert.ok(await got('sid-x'));
    assert.equal(await moderation.activeBan(bob.id), null);
    assert.equal((await call(Ad, 'POST', '/users/:id/kick', { ...ADM, params: { id: bob.id }, body: {} })).s, 400);
  });

  await t('ban huy session dang co ngay lap tuc', async () => {
    const st = sessionStore.get(); st.set('sid-b1', { cookie: {}, user: { id: alice.id, loginAt: 1 } });
    await call(Ad, 'POST', '/users/:id/ban', { ...ADM, params: { id: alice.id }, body: { reason: 'test', durationMinutes: 5 } });
    assert.equal(await new Promise((res) => st.get('sid-b1', (e, v) => res(v))), null);
    await call(Ad, 'POST', '/users/:id/unban', { ...ADM, params: { id: alice.id } });
  });

  await t('warn: luu reason/adminId/createdAt; lich su + dem hien trong danh sach user va nhat ky', async () => {
    await call(Ad, 'POST', '/users/:id/warn', { ...ADM, params: { id: bob.id }, body: { reason: 'Nói tục' } });
    const d = (await call(Ad, 'GET', '/users/:id', { ...ADM, params: { id: bob.id } })).d;
    assert.equal(d.warnCount, 2); assert.equal(d.history.warns[0].reason, 'Nói tục'); assert.equal(d.history.warns[0].adminId, root.id); assert.equal(d.history.kicks.length, 1);
    assert.equal((await call(Ad, 'GET', '/moderation', { ...ADM, query: { type: 'warn' } })).d.every((x) => x.type === 'warn' && x.user.username), true);
    assert.equal((await call(Ad, 'GET', '/users/:id', { ...ADM, params: { id: '12' } })).s, 400);
  });

  await t('persist: sau restart (xoa cache bo nho) ban/warn van con va van chan', async () => {
    await call(Ad, 'POST', '/users/:id/ban', { ...ADM, params: { id: alice.id }, body: { reason: 'persist', permanent: true } });
    moderation._resetCache(); users._resetCache();
    assert.equal((await moderation.activeBan(alice.id)).reason, 'persist');
    assert.equal((await call(Fo, 'POST', '/posts', { as: alice, body: { content: 'x' } })).s, 401);
    assert.equal((await moderation.list({ type: 'warn' })).length, 2);
    assert.equal((await call(Ad, 'GET', '/summary', ADM)).d.activeBans, 1);
    await call(Ad, 'POST', '/users/:id/unban', { ...ADM, params: { id: alice.id } });
  });

  await t('popup: CRUD + toggle; sanitize HTML/JS thanh van ban; createdBy tu session; validate type/audience/thoi gian', async () => {
    const c = await call(Ad, 'POST', '/popups', { ...ADM, body: { title: '<img src=x onerror=alert(1)>Hi', message: 'A <script>alert(1)</script>B\n\nC', type: 'warning', audience: 'all', createdBy: 'evil', id: OK } });
    assert.equal(c.s, 201); const p = c.d;
    assert.equal(p.title, 'Hi'); assert.equal(p.message, 'A alert(1)B\n\nC'.replace('alert(1)', 'alert(1)')); assert.ok(!/[<>]/.test(p.title + p.message));
    assert.equal(p.createdBy, root.id); assert.notEqual(p.id, OK); assert.equal(p.enabled, true);
    for (const bad of [{ type: 'evil' }, { audience: 'admins' }, { title: '' }, { message: 'x'.repeat(1001) }, { startsAt: 'nope' }, { startsAt: '2030-01-02', endsAt: '2030-01-01' }])
      assert.equal((await call(Ad, 'POST', '/popups', { ...ADM, body: { title: 't', message: 'm', ...bad } })).s, 400, JSON.stringify(bad));
    const u = await call(Ad, 'PUT', '/popups/:id', { ...ADM, params: { id: p.id }, body: { title: 'Moi', createdBy: 'evil', enabled: false } });
    assert.equal(u.d.title, 'Moi'); assert.equal(u.d.message, p.message); assert.equal(u.d.createdBy, root.id); assert.equal(u.d.enabled, false);
    assert.equal((await call(Ad, 'PUT', '/popups/:id', { ...ADM, params: { id: 'zz' }, body: {} })).s, 400);
    assert.equal((await call(Ad, 'PUT', '/popups/:id', { ...ADM, params: { id: OK }, body: { title: 'x' } })).s, 404);
    assert.equal((await call(Ad, 'POST', '/popups/:id/toggle', { ...ADM, params: { id: p.id } })).d.enabled, true);
    assert.equal((await call(Ad, 'DELETE', '/popups/:id', { ...ADM, params: { id: p.id } })).s, 200);
    assert.equal((await call(Ad, 'DELETE', '/popups/:id', { ...ADM, params: { id: p.id } })).s, 404);
  });

  await t('popup public: chi active (bat + trong khung gio) va dung audience (guests/users/all); khong lo createdBy', async () => {
    const mkp = (b) => call(Ad, 'POST', '/popups', { ...ADM, body: { title: b.title, message: 'm', ...b } });
    await mkp({ title: 'all' }); await mkp({ title: 'guests', audience: 'guests' }); await mkp({ title: 'users', audience: 'users' });
    await mkp({ title: 'off', enabled: false }); await mkp({ title: 'future', startsAt: new Date(Date.now() + 3600e3).toISOString() }); await mkp({ title: 'past', endsAt: new Date(Date.now() - 3600e3).toISOString() });
    const titles = async (o) => (await call(Pub, 'GET', '/announcements', o)).d.popups.map((x) => x.title).sort().join();
    assert.equal(await titles({}), 'all,guests'); assert.equal(await titles({ as: bob }), 'all,users');
    const pp = (await call(Pub, 'GET', '/announcements', {})).d.popups[0];
    assert.deepEqual(Object.keys(pp).sort(), ['id', 'message', 'title', 'type', 'updatedAt']);
  });

  await t('marquee: CRUD; link chi http(s) (chan javascript:/data:); chi active hien o public; sanitize', async () => {
    for (const link of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x.com/a', '//evil.com', 'not a url', 'https://u:p@x.com'])
      assert.equal((await call(Ad, 'POST', '/marquee', { ...ADM, body: { text: 't', link } })).s, 400, link);
    assert.equal((await call(Ad, 'POST', '/marquee', { ...ADM, body: { text: '' } })).s, 400);
    assert.equal((await call(Ad, 'POST', '/marquee', { ...ADM, body: { text: 'x'.repeat(201) } })).s, 400);
    const a = (await call(Ad, 'POST', '/marquee', { ...ADM, body: { text: '<b>Sự kiện</b> mới <script>x</script>', link: 'https://example.com/a?b=1', createdBy: 'evil' } })).d;
    assert.equal(a.text, 'Sự kiện mới x'); assert.equal(a.link, 'https://example.com/a?b=1'); assert.equal(a.createdBy, root.id);
    const off = (await call(Ad, 'POST', '/marquee', { ...ADM, body: { text: 'tat', enabled: false } })).d;
    await call(Ad, 'POST', '/marquee', { ...ADM, body: { text: 'het han', endsAt: new Date(Date.now() - 1000).toISOString() } });
    await call(Ad, 'POST', '/marquee', { ...ADM, body: { text: 'chua toi', startsAt: new Date(Date.now() + 3600e3).toISOString() } });
    assert.deepEqual((await call(Pub, 'GET', '/announcements', {})).d.marquee, [{ id: a.id, text: 'Sự kiện mới x', link: 'https://example.com/a?b=1' }]);
    await call(Ad, 'POST', '/marquee/:id/toggle', { ...ADM, params: { id: off.id } });
    assert.equal((await call(Pub, 'GET', '/announcements', {})).d.marquee.length, 2);
    const e = (await call(Ad, 'PUT', '/marquee/:id', { ...ADM, params: { id: a.id }, body: { link: '' } })).d; assert.equal(e.link, '');
    assert.equal((await call(Ad, 'GET', '/marquee', ADM)).d.length, 4);
    assert.equal((await call(Ad, 'DELETE', '/marquee/:id', { ...ADM, params: { id: a.id } })).s, 200);
  });

  await t('dashboard summary: chi Admin; dem dung; du lieu popup/marquee persist tren dia', async () => {
    const s = (await call(Ad, 'GET', '/summary', ADM)).d;
    assert.equal(s.users, 4); assert.equal(s.activeBans, 0); assert.equal(s.warns, 2); assert.ok(s.popups.total >= 6); assert.ok(s.marquee.active >= 1);
    assert.ok(disk('popups.json').length >= 6 && disk('marquee.json').length >= 3);
  });

  await t('rate limit: thao tac nhay cam (ban/kick/warn/thong bao) bi 429 khi thao tac qua nhanh', async () => {
    let got429 = false;
    const m = (await call(Ad, 'GET', '/marquee', ADM)).d[0];
    for (let i = 0; i < 260 && !got429; i++) got429 = (await call(Ad, 'POST', '/marquee/:id/toggle', { ...ADM, params: { id: m.id } })).s === 429;
    assert.ok(got429);
    assert.equal((await call(Ad, 'GET', '/marquee', ADM)).s, 200);   // doc khong bi gioi han
  });

  console.log(n + ' tests passed');
})();
