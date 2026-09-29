'use strict';
/**
 * Kiem thu Forum / Fan Art / Profile / Admin moderation:  npm test   (khong can mang)
 * Chay CODE THAT cua services/forum|fanart|users, middleware/auth + rateLimit, routes/forum|api|admin.
 * Chi thay: `express` (Router gia ghi lai handler roi goi truc tiep) va tang mang (global.fetch gia lap imgbb).
 */
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), Module = require('module');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vth-forum-'));
const F = (n) => path.join(tmp, n);
Object.assign(process.env, {
  USERS_FILE: F('users.json'), SESSIONS_FILE: F('sessions.json'), POSTS_FILE: F('posts.json'), COMMENTS_FILE: F('comments.json'), FANART_FILE: F('fanarts.json'),
  VTUBER_DATA_FILE: F('vtubers.json'), VTUBER_CACHE_DIR: tmp, NEWS_FILE: F('news.json'), IMGBB_API_KEY: 'k',
  ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'pw123', RATE_LIMIT_SCALE: '1000', // test logic nghiep vu: nong gioi han (gioi han that duoc test rieng o test/antispam.js)
  ADMIN_DISCORD_IDS: '555555555555555555',
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
const origLoad = Module._load;
Module._load = function (req, ...rest) { if (req === 'express') return expressStub; return origLoad.call(this, req, ...rest); };

const users = require('../services/users'), forum = require('../services/forum'), fanart = require('../services/fanart'), auth = require('../middleware/auth');
const { makeList } = require('../services/jsonlist');
const forumRoutes = require('../routes/forum'), publicApi = require('../routes/api'), admin = require('../routes/admin');

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
const Fo = forumRoutes.api, Us = forumRoutes.usersApi, Pub = publicApi.router, Ad = admin.api;
const disk = (f) => JSON.parse(fs.readFileSync(F(f), 'utf8'));
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
let n = 0; const t = async (name, fn) => { try { await fn(); n++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n', e); process.exitCode = 1; } };

(async () => {
  const legalSvc = require('../services/legal');
  const mk = (id, username) => users.upsertFromDiscord({ id, username, avatar: null }, { version: legalSvc.version(), at: new Date().toISOString() }); // user da dong y TOS/Rules hien hanh
  const alice = await mk('111111111111111101', 'alice'), bob = await mk('111111111111111102', 'bob'), carol = await mk('111111111111111103', 'carol');
  const dave = await mk('111111111111111104', 'dave'), root = await mk('555555555555555555', 'root');
  let p1, p1Url;

  await t('khach: khong dang bai / reaction / comment (401); thieu CSRF token => 403', async () => {
    assert.equal((await call(Fo, 'POST', '/posts', { body: { content: 'x' } })).s, 401);
    assert.equal((await call(Fo, 'POST', '/posts/:id/reaction', { params: { id: 'a'.repeat(12) }, body: { emoji: '👍' } })).s, 401);
    assert.equal((await call(Fo, 'POST', '/posts/:id/comments', { params: { id: 'a'.repeat(12) }, body: { content: 'x' } })).s, 401);
    assert.equal((await call(Fo, 'POST', '/posts', { as: alice, csrf: false, body: { content: 'x' } })).s, 403);
    assert.equal((await call(Pub, 'POST', '/fanart', { body: { image: IMG } })).s, 401);
    assert.equal((await call(Pub, 'POST', '/fanart', { as: alice, csrf: false, body: { image: IMG } })).s, 403);
  });

  await t('consent: user chua dong y TOS/Rules hien hanh khong dang bai / comment / reaction / fan art (403 consent_required); doc van duoc', async () => {
    const eve = await users.upsertFromDiscord({ id: '111111111111111199', username: 'eve' });   // khong co consent
    const chk = (r) => { assert.equal(r.s, 403); assert.equal(r.b.code, 'consent_required'); };
    chk(await call(Fo, 'POST', '/posts', { as: eve, body: { content: 'x' } }));
    chk(await call(Fo, 'POST', '/posts/:id/comments', { as: eve, params: { id: 'a'.repeat(12) }, body: { content: 'x' } }));
    chk(await call(Fo, 'POST', '/posts/:id/reaction', { as: eve, params: { id: 'a'.repeat(12) }, body: { emoji: '👍' } }));
    chk(await call(Pub, 'POST', '/fanart', { as: eve, body: { image: IMG } }));
    assert.equal((await call(Fo, 'GET', '/posts', { as: eve })).s, 200);
    assert.equal((await call(Pub, 'GET', '/legal')).s, 200);   // /api/legal cong khai cho khach
    await users.recordConsent(eve.id, { version: legalSvc.version(), at: new Date().toISOString() });
    assert.equal((await call(Fo, 'POST', '/posts', { as: eve, body: { content: 'sau khi dong y' } })).s, 201);
    await call(Fo, 'DELETE', '/posts/:id', { as: eve, params: { id: (await call(Fo, 'GET', '/posts/mine', { as: eve })).d[0].id } });
  });

  await t('dang bai: bat buoc pending; authorId/status/rejectReason/reactions/id tu client bi bo qua; authorId = session', async () => {
    const r = await call(Fo, 'POST', '/posts', { as: alice, body: { content: 'Hello <b>x</b>', authorId: bob.id, status: 'approved', rejectReason: 'z', reactions: { [bob.id]: '👍' }, id: 'a'.repeat(12) } });
    assert.equal(r.s, 201); p1 = r.d;
    assert.equal(p1.status, 'pending'); assert.equal(p1.author.id, alice.id); assert.equal(p1.reactions.total, 0); assert.notEqual(p1.id, 'a'.repeat(12)); assert.equal(p1.rejectReason, '');
    const row = disk('posts.json')[0]; assert.equal(row.authorId, alice.id); assert.equal(row.status, 'pending'); assert.deepEqual(row.reactions, {});
    assert.deepEqual(Object.keys(row).sort(), ['authorId', 'content', 'createdAt', 'id', 'images', 'reactions', 'rejectReason', 'status', 'updatedAt']);
  });

  await t('pending: khach/nguoi khac khong thay (list + chi tiet 404); chu bai va admin thay; reaction/comment => 404', async () => {
    assert.equal((await call(Fo, 'GET', '/posts')).d.total, 0);
    assert.equal((await call(Fo, 'GET', '/posts/:id', { params: { id: p1.id } })).s, 404);
    assert.equal((await call(Fo, 'GET', '/posts/:id', { as: bob, params: { id: p1.id } })).s, 404);
    const mine = await call(Fo, 'GET', '/posts/:id', { as: alice, params: { id: p1.id } }); assert.equal(mine.s, 200); assert.equal(mine.d.status, 'pending');
    assert.equal((await call(Fo, 'GET', '/posts/:id', { admin: true, params: { id: p1.id } })).s, 200);
    assert.equal((await call(Fo, 'POST', '/posts/:id/reaction', { as: bob, params: { id: p1.id }, body: { emoji: '👍' } })).s, 404);
    assert.equal((await call(Fo, 'POST', '/posts/:id/comments', { as: bob, params: { id: p1.id }, body: { content: 'hi' } })).s, 404);
    assert.equal((await call(Fo, 'GET', '/posts/:id/comments', { params: { id: p1.id } })).s, 404);
    assert.equal((await call(Fo, 'GET', '/posts/mine', { as: bob })).d.length, 0); assert.equal((await call(Fo, 'GET', '/posts/mine', { as: alice })).d.length, 1);
    assert.equal((await call(Fo, 'GET', '/posts/mine')).s, 401);
  });

  await t('admin moderation: khach 401, user 403, admin duoc; tu choi bat buoc co ly do; approve => public', async () => {
    const p = { params: { id: p1.id } };
    assert.equal((await call(Ad, 'POST', '/forum/posts/:id/status', { ...p, body: { status: 'approved' } })).s, 401);
    assert.equal((await call(Ad, 'POST', '/forum/posts/:id/status', { as: alice, ...p, body: { status: 'approved' } })).s, 403); // ke ca chu bai
    assert.equal((await call(Ad, 'GET', '/forum/posts', { as: bob })).s, 403);
    assert.equal((await call(Ad, 'DELETE', '/forum/posts/:id', { as: bob, ...p })).s, 403);
    assert.equal((await call(Ad, 'POST', '/forum/posts/:id/status', { admin: true, ...p, body: { status: 'rejected' } })).s, 400);
    assert.equal((await call(Ad, 'POST', '/forum/posts/:id/status', { admin: true, ...p, body: { status: 'hack' } })).s, 400);
    assert.equal((await call(Ad, 'POST', '/forum/posts/:id/status', { as: root, ...p, body: { status: 'approved' } })).s, 200); // admin Discord (ADMIN_DISCORD_IDS)
    assert.equal((await call(Ad, 'GET', '/forum/posts', { admin: true, query: { status: 'approved' } })).d.length, 1);
  });

  await t('approved: public thay; status/rejectReason CHI chu bai thay (khach + nguoi khac khong co truong nay)', async () => {
    const g = await call(Fo, 'GET', '/posts'); assert.equal(g.d.total, 1); assert.ok(!has(g.d.items[0], 'status') && !has(g.d.items[0], 'rejectReason'));
    const o = await call(Fo, 'GET', '/posts/:id', { as: bob, params: { id: p1.id } }); assert.equal(o.s, 200); assert.ok(!has(o.d, 'status') && !has(o.d, 'rejectReason'));
    assert.equal((await call(Fo, 'GET', '/posts/:id', { as: alice, params: { id: p1.id } })).d.status, 'approved');
    assert.equal(g.d.items[0].author.username, 'alice'); assert.ok(g.d.items[0].author.avatarUrl.startsWith('https://cdn.discordapp.com/'));
  });

  await t('reaction: 1 user = 1 reaction, doi duoc, bo duoc; chi 6 emoji; khong lo userId nguoi react', async () => {
    const r = (as, m, body) => call(Fo, m, '/posts/:id/reaction', { as, params: { id: p1.id }, body });
    let x = await r(bob, 'POST', { emoji: '👍' }); assert.equal(x.d.reactions.counts['👍'], 1); assert.equal(x.d.myReaction, '👍');
    x = await r(bob, 'POST', { emoji: '❤️' }); assert.equal(x.d.reactions.counts['👍'], 0); assert.equal(x.d.reactions.counts['❤️'], 1); assert.equal(x.d.reactions.total, 1); assert.equal(x.d.myReaction, '❤️');
    x = await r(carol, 'POST', { emoji: '😡' }); assert.equal(x.d.reactions.total, 2); assert.equal(x.d.myReaction, '😡');
    x = await r(bob, 'POST', { emoji: '❤' }); assert.equal(x.s, 200); assert.equal(x.d.myReaction, '❤️'); // thieu variation selector van khop
    for (const e of ['💩', '', null, 5, ['👍'], { a: 1 }]) assert.equal((await r(bob, 'POST', { emoji: e })).s, 400, JSON.stringify(e));
    const g = await call(Fo, 'GET', '/posts'); assert.equal(g.d.items[0].myReaction, null); assert.ok(!JSON.stringify(g.b).includes(bob.id) && !JSON.stringify(g.b).includes(carol.id));
    x = await r(bob, 'DELETE'); assert.equal(x.d.reactions.total, 1); assert.equal(x.d.myReaction, null);
    assert.equal(Object.keys(disk('posts.json')[0].reactions).length, 1);
    await r(carol, 'DELETE');
  });

  let c1;
  await t('comment: chi user dang nhap; authorId lay tu session; khong sua/xoa comment nguoi khac', async () => {
    const add = await call(Fo, 'POST', '/posts/:id/comments', { as: bob, params: { id: p1.id }, body: { content: 'nice <i>art</i>', authorId: alice.id, postId: 'b'.repeat(12), id: 'c'.repeat(12) } });
    assert.equal(add.s, 201); c1 = add.d; assert.equal(c1.author.id, bob.id); assert.equal(c1.postId, p1.id); assert.equal(c1.mine, true); assert.equal(disk('comments.json')[0].authorId, bob.id);
    assert.equal((await call(Fo, 'POST', '/posts/:id/comments', { as: bob, params: { id: p1.id }, body: { content: 'nice <i>art</i>' } })).s, 409); // trung noi dung lien tiep
    assert.equal((await call(Fo, 'POST', '/posts/:id/comments', { as: bob, params: { id: p1.id }, body: { content: '   ' } })).s, 400);
    assert.equal((await call(Fo, 'POST', '/posts/:id/comments', { as: bob, params: { id: p1.id }, body: { content: 'x'.repeat(1001) } })).s, 400);
    const l = await call(Fo, 'GET', '/posts/:id/comments', { params: { id: p1.id } }); assert.equal(l.d.length, 1); assert.equal(l.d[0].mine, false);
    assert.equal((await call(Fo, 'GET', '/posts/:id/comments', { as: bob, params: { id: p1.id } })).d[0].mine, true);
    for (const who of [carol, alice]) { // ke ca chu bai cung khong xoa duoc comment cua nguoi khac
      assert.equal((await call(Fo, 'PUT', '/comments/:id', { as: who, params: { id: c1.id }, body: { content: 'hack' } })).s, 403);
      assert.equal((await call(Fo, 'DELETE', '/comments/:id', { as: who, params: { id: c1.id } })).s, 403);
    }
    assert.equal((await call(Fo, 'PUT', '/comments/:id', { as: bob, params: { id: c1.id }, body: { content: 'sua' } })).d.content, 'sua');
    assert.equal((await call(Fo, 'GET', '/posts', {})).d.items[0].commentCount, 1);
    assert.equal((await call(Fo, 'DELETE', '/comments/:id', { as: bob, params: { id: c1.id } })).s, 200); assert.equal(disk('comments.json').length, 0);
    assert.equal((await call(Fo, 'DELETE', '/comments/:id', { as: bob, params: { id: c1.id } })).s, 404);
  });

  await t('sua bai: nguoi khac bi chan (403 bai public / 404 bai chua public); sua approved => pending, xoa rejectReason, khong tu doi status/authorId', async () => {
    const put = (as, body) => call(Fo, 'PUT', '/posts/:id', { as, params: { id: p1.id }, body });
    assert.equal((await put(bob, { content: 'hack' })).s, 403);
    const r = await put(alice, { content: 'edited', status: 'approved', authorId: bob.id, rejectReason: '', reactions: {} });
    assert.equal(r.s, 200); assert.equal(r.d.status, 'pending'); assert.equal(r.d.content, 'edited'); assert.equal(r.d.author.id, alice.id);
    assert.equal((await call(Fo, 'GET', '/posts')).d.total, 0);                 // het public ngay khi sua
    assert.equal((await put(bob, { content: 'hack' })).s, 404);                  // bai chua public: khong lo ton tai
    await call(Ad, 'POST', '/forum/posts/:id/status', { admin: true, params: { id: p1.id }, body: { status: 'rejected', reason: 'Sai quy tắc' } });
    const own = await call(Fo, 'GET', '/posts/:id', { as: alice, params: { id: p1.id } }); assert.equal(own.d.status, 'rejected'); assert.equal(own.d.rejectReason, 'Sai quy tắc');
    assert.equal((await call(Fo, 'GET', '/posts/:id', { as: bob, params: { id: p1.id } })).s, 404);
    assert.equal((await call(Fo, 'GET', '/posts')).d.total, 0);
    const again = await put(alice, { content: 'fixed' }); assert.equal(again.d.status, 'pending'); assert.equal(again.d.rejectReason, '');
    await call(Ad, 'POST', '/forum/posts/:id/status', { admin: true, params: { id: p1.id }, body: { status: 'approved' } });
    assert.equal((await call(Fo, 'GET', '/posts')).d.total, 1);                  // Reject -> sua -> Pending -> duyet lai -> Public
  });

  await t('anh: toi da 4, chi giu URL da co trong bai (khong chen URL tuy y), base64 sai bi tu choi, bai rong bi tu choi', async () => {
    const r = await call(Fo, 'POST', '/posts', { as: alice, body: { content: 'co anh', newImages: [IMG, IMG] } });
    assert.equal(r.s, 201); assert.equal(r.d.images.length, 2); assert.ok(r.d.images.every((u) => u.startsWith('https://i.ibb.co/')));
    const id = r.d.id, keep = r.d.images[0];
    const u = await call(Fo, 'PUT', '/posts/:id', { as: alice, params: { id }, body: { images: ['https://evil.example/x.png', keep] } });
    assert.deepEqual(u.d.images, [keep]);
    assert.equal((await call(Fo, 'PUT', '/posts/:id', { as: alice, params: { id }, body: { newImages: [IMG, IMG, IMG, IMG, IMG] } })).s, 400);
    assert.equal((await call(Fo, 'PUT', '/posts/:id', { as: alice, params: { id }, body: { newImages: ['not base64!!'] } })).s, 400);
    assert.equal((await call(Fo, 'POST', '/posts', { as: alice, body: { content: '   ' } })).s, 400);
    assert.equal((await call(Fo, 'POST', '/posts', { as: alice, body: { newImages: [IMG] } })).s, 201); // chi anh cung duoc
    assert.equal((await call(Fo, 'DELETE', '/posts/:id', { as: bob, params: { id } })).s, 404);          // bai chua public cua nguoi khac
    assert.equal((await call(Fo, 'DELETE', '/posts/:id', { as: alice, params: { id } })).s, 200);
  });

  await t('noi dung: bo ky tu dieu khien/bidi, gioi han do dai; markup chi la van ban (frontend render bang textContent)', async () => {
    const r = await call(Fo, 'POST', '/posts', { as: dave, body: { content: 'a\u0000b\u202ec <script>alert(1)</script>' } });
    assert.equal(r.d.content, 'abc <script>alert(1)</script>');
    const bad = await call(Fo, 'POST', '/posts', { as: dave, body: { content: 'x'.repeat(5001) } }); assert.equal(bad.s, 400); assert.equal(bad.b.field, 'content');
    assert.equal((await call(Fo, 'POST', '/posts', { as: dave, body: { content: { $ne: 1 } } })).s, 400);
    assert.equal((await call(Fo, 'GET', '/posts/:id', { params: { id: '../../etc/passwd' } })).s, 404);
    for (const f of ['forum.js']) assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8')), f + ' khong duoc dung innerHTML');
  });

  await t('xoa bai: chu bai xoa duoc, xoa kem comment; admin xoa bai/comment cua bat ky ai', async () => {
    const a = (await call(Fo, 'POST', '/posts', { as: carol, body: { content: 'to delete' } })).d;
    await call(Ad, 'POST', '/forum/posts/:id/status', { admin: true, params: { id: a.id }, body: { status: 'approved' } });
    const c = (await call(Fo, 'POST', '/posts/:id/comments', { as: bob, params: { id: a.id }, body: { content: 'c-1' } })).d;
    const c2 = (await call(Fo, 'POST', '/posts/:id/comments', { as: bob, params: { id: a.id }, body: { content: 'c-2' } })).d;
    assert.equal((await call(Ad, 'GET', '/forum/posts/:id/comments', { admin: true, params: { id: a.id } })).d.length, 2);
    assert.equal((await call(Ad, 'DELETE', '/forum/comments/:id', { as: bob, params: { id: c.id } })).s, 403);
    assert.equal((await call(Ad, 'DELETE', '/forum/comments/:id', { admin: true, params: { id: c.id } })).s, 200);
    assert.equal((await call(Fo, 'DELETE', '/posts/:id', { as: bob, params: { id: a.id } })).s, 403);
    assert.equal((await call(Fo, 'DELETE', '/posts/:id', { as: carol, params: { id: a.id } })).s, 200);
    assert.ok(!disk('comments.json').some((x) => x.postId === a.id)); assert.ok(!disk('posts.json').some((x) => x.id === a.id));
    assert.equal((await call(Ad, 'DELETE', '/forum/comments/:id', { admin: true, params: { id: c2.id } })).s, 404);
    const b = (await call(Fo, 'POST', '/posts', { as: carol, body: { content: 'admin removes' } })).d;
    assert.equal((await call(Ad, 'DELETE', '/forum/posts/:id', { admin: true, params: { id: b.id } })).s, 200);
  });

  await t('chong spam: toi da 10 bai cho duyet / user, khong dang trung, rate limit theo tai khoan', async () => {
    const e = { id: '111111111111111110', username: 'erin' };
    for (let i = 0; i < 10; i++) await forum.createPost(e, { content: 'p' + i });
    await assert.rejects(forum.createPost(e, { content: 'p-extra' }), (x) => x.status === 429);
    const f = { id: '111111111111111111', username: 'fred' };
    await forum.createPost(f, { content: 'same' });
    await assert.rejects(forum.createPost(f, { content: 'same' }), (x) => x.status === 409);
    assert.equal((await call(Fo, 'POST', '/posts', { as: alice, body: { content: 'alice khac van dang duoc' } })).s, 201); // rate limit theo tai khoan/IP/tai khoan moi: xem test/antispam.js
  });

  let fa;
  await t('fan art: authorId + username tu session Discord (khong gia mao); moi bai pending; chi approved moi public', async () => {
    fs.writeFileSync(F('fanarts.json'), JSON.stringify([{ id: 'old1', title: 'cu', author: 'Ten cu', url: 'https://x/a.jpg', deleteUrl: 'https://ibb.co/secret', createdAt: '2026-01-01' }]));
    const r = await call(Pub, 'POST', '/fanart', { as: alice, body: { image: IMG, title: 'Art', description: 'mo ta', authorId: bob.id, username: 'Bobby', status: 'approved', rejectReason: 'x' } });
    assert.equal(r.s, 201); assert.equal(r.d.status, 'pending'); fa = r.d.id;
    const row = disk('fanarts.json').find((x) => x.id === fa); assert.equal(row.authorId, alice.id); assert.equal(row.username, 'alice'); assert.equal(row.status, 'pending'); assert.equal(row.rejectReason, '');
    assert.ok(disk('fanarts.json').some((x) => x.id === 'old1' && x.status === undefined));  // ban ghi cu duoc giu nguyen
    const pubList = (await call(Pub, 'GET', '/fanart')).d; assert.deepEqual(pubList.map((x) => x.id), ['old1']);           // pending khong public
    assert.equal(pubList[0].author.username, 'Ten cu'); assert.equal(pubList[0].author.id, null); assert.ok(!JSON.stringify(pubList).includes('secret'));
    assert.equal((await call(Pub, 'GET', '/fanart/mine', { as: bob })).d.length, 0);
    const mine = (await call(Pub, 'GET', '/fanart/mine', { as: alice })).d; assert.equal(mine.length, 1); assert.equal(mine[0].status, 'pending');
    assert.equal((await call(Pub, 'GET', '/fanart/mine')).s, 401);
  });

  await t('fan art admin: chi admin duyet/tu choi(+ly do)/xoa; public hien username + avatar HIEN TAI (authorId co dinh)', async () => {
    const p = { params: { id: fa } };
    assert.equal((await call(Ad, 'POST', '/fanart/:id/status', { as: alice, ...p, body: { status: 'approved' } })).s, 403);
    assert.equal((await call(Ad, 'DELETE', '/fanart/:id', { as: alice, ...p })).s, 403);
    assert.equal((await call(Ad, 'POST', '/fanart/:id/status', { admin: true, ...p, body: { status: 'rejected' } })).s, 400);
    assert.equal((await call(Ad, 'POST', '/fanart/:id/status', { admin: true, ...p, body: { status: 'approved' } })).s, 200);
    let l = (await call(Pub, 'GET', '/fanart')).d.find((x) => x.id === fa);
    assert.ok(l); assert.equal(l.author.username, 'alice'); assert.ok(!has(l, 'status') && !has(l, 'deleteUrl') && !has(l, 'rejectReason'));
    await users.upsertFromDiscord({ id: alice.id, username: 'alice_new', avatar: 'ab'.repeat(16) });                     // doi username Discord
    l = (await call(Pub, 'GET', '/fanart')).d.find((x) => x.id === fa); assert.equal(l.author.username, 'alice_new'); assert.equal(l.author.id, alice.id); assert.ok(l.author.avatarUrl.includes('/avatars/' + alice.id + '/'));
    assert.equal(disk('fanarts.json').find((x) => x.id === fa).authorId, alice.id);
  });

  await t('fan art: chi chu so huu sua/xoa; sua approved/rejected => pending lai; nguoi khac 403/404', async () => {
    const p = { params: { id: fa } };
    assert.equal((await call(Pub, 'PUT', '/fanart/:id', { as: bob, ...p, body: { title: 'hack' } })).s, 403);
    assert.equal((await call(Pub, 'DELETE', '/fanart/:id', { as: bob, ...p })).s, 403);
    const u = await call(Pub, 'PUT', '/fanart/:id', { as: alice, ...p, body: { title: 'Moi', status: 'approved', authorId: bob.id, username: 'x' } });
    assert.equal(u.s, 200); assert.equal(u.d.status, 'pending');
    const row = disk('fanarts.json').find((x) => x.id === fa); assert.equal(row.title, 'Moi'); assert.equal(row.authorId, alice.id); assert.equal(row.username, 'alice_new');
    assert.ok(!(await call(Pub, 'GET', '/fanart')).d.some((x) => x.id === fa));
    assert.equal((await call(Pub, 'PUT', '/fanart/:id', { as: bob, ...p, body: { title: 'hack' } })).s, 404);   // chua public => khong lo ton tai
    await call(Ad, 'POST', '/fanart/:id/status', { admin: true, ...p, body: { status: 'rejected', reason: 'Thiếu nguồn' } });
    const m = (await call(Pub, 'GET', '/fanart/mine', { as: alice })).d.find((x) => x.id === fa); assert.equal(m.status, 'rejected'); assert.equal(m.rejectReason, 'Thiếu nguồn');
    assert.equal((await call(Pub, 'PUT', '/fanart/:id', { as: alice, ...p, body: { description: 'da sua' } })).d.status, 'pending');
    assert.equal(disk('fanarts.json').find((x) => x.id === fa).rejectReason, '');
    await call(Ad, 'POST', '/fanart/:id/status', { admin: true, ...p, body: { status: 'approved' } });
    assert.equal((await call(Pub, 'DELETE', '/fanart/:id', { as: alice, ...p })).s, 200);
    assert.ok(!disk('fanarts.json').some((x) => x.id === fa));
    assert.equal((await call(Pub, 'PUT', '/fanart/:id', { as: alice, params: { id: 'nope' }, body: {} })).s, 404);
    assert.equal((await call(Pub, 'PUT', '/fanart/:id', { as: alice, params: { id: '../x' }, body: {} })).s, 400);
  });

  await t('profile /api/users/:id: chi noi dung approved; khong lo role/session/du lieu quan tri; khach + user xem duoc', async () => {
    const fa2 = (await call(Pub, 'POST', '/fanart', { as: bob, body: { image: IMG, title: 'Cua bob' } })).d.id;
    const pending = (await call(Fo, 'POST', '/posts', { as: bob, body: { content: 'bob pending' } })).d;
    const okPost = (await call(Fo, 'POST', '/posts', { as: bob, body: { content: 'bob approved' } })).d;
    await call(Ad, 'POST', '/forum/posts/:id/status', { admin: true, params: { id: okPost.id }, body: { status: 'approved' } });
    const rej = (await call(Fo, 'POST', '/posts', { as: bob, body: { content: 'bob rejected' } })).d;
    await call(Ad, 'POST', '/forum/posts/:id/status', { admin: true, params: { id: rej.id }, body: { status: 'rejected', reason: 'no' } });
    const guest = await call(Us, 'GET', '/:id', { params: { id: bob.id } }); assert.equal(guest.s, 200);
    assert.deepEqual(guest.d.posts.map((x) => x.content), ['bob approved']); assert.equal(guest.d.fanarts.length, 0);   // pending/rejected khong hien
    assert.deepEqual(Object.keys(guest.d.user).sort(), ['avatarUrl', 'createdAt', 'id', 'isSelf', 'username']); assert.equal(guest.d.user.isSelf, false);
    assert.ok(!has(guest.d.posts[0], 'status') && !has(guest.d.posts[0], 'rejectReason'));
    const other = await call(Us, 'GET', '/:id', { as: carol, params: { id: bob.id } }); assert.ok(!JSON.stringify(other.b).includes('bob pending') && !JSON.stringify(other.b).includes('bob rejected'));
    const self = await call(Us, 'GET', '/:id', { as: bob, params: { id: bob.id } }); assert.equal(self.d.user.isSelf, true); assert.deepEqual(self.d.posts.map((x) => x.content), ['bob approved']); // /users van chi public
    for (const bad of [JSON.stringify(guest.b), JSON.stringify(self.b)]) assert.ok(!/csrf|session|secret|token|"role"|deleteUrl/i.test(bad), bad.slice(0, 200));
    await call(Ad, 'POST', '/fanart/:id/status', { admin: true, params: { id: fa2 }, body: { status: 'approved' } });
    const after = await call(Us, 'GET', '/:id', { params: { id: bob.id } }); assert.equal(after.d.fanarts.length, 1); assert.equal(after.d.fanartTotal, 1); assert.equal(after.d.fanarts[0].author.id, bob.id);
    assert.equal((await call(Us, 'GET', '/:id', { params: { id: '999999999999999999' } })).s, 404);
    for (const bad of ['abc', '../x', '1', 'x'.repeat(30)]) assert.equal((await call(Us, 'GET', '/:id', { params: { id: bad } })).s, 404);
    assert.ok(pending.id);
  });

  await t('admin: chi Admin xem hang cho duyet (Posts + Fan Art); user thuong 403', async () => {
    assert.equal((await call(Ad, 'GET', '/forum/summary', { as: bob })).s, 403); assert.equal((await call(Ad, 'GET', '/fanart', { as: bob })).s, 403);
    const s = await call(Ad, 'GET', '/forum/summary', { admin: true }); assert.ok(s.d.posts >= 1 && s.d.fanart >= 0);
    const all = (await call(Ad, 'GET', '/forum/posts', { admin: true })).d; assert.ok(all.every((x) => has(x, 'status')) && all.some((x) => x.status === 'pending') && all.some((x) => x.status === 'rejected'));
    assert.ok((await call(Ad, 'GET', '/fanart', { admin: true })).d.every((x) => has(x, 'status') && !has(x, 'deleteUrl')));
  });

  await t('jsonlist: doc file cu neu file moi chua co; lan ghi dau tao file moi va KHONG dong vao file cu; file hong khong bi ghi de', async () => {
    const oldF = F('legacy.json'), newF = F('newer.json'); fs.writeFileSync(oldF, JSON.stringify([{ id: 'a1' }]));
    const L = makeList(() => newF, { label: 'newer.json', legacyFile: () => oldF });
    assert.deepEqual(await L.read(), [{ id: 'a1' }]); await L.tx((a) => { a.push({ id: 'b2' }); });
    assert.equal(JSON.parse(fs.readFileSync(newF, 'utf8')).length, 2); assert.equal(JSON.parse(fs.readFileSync(oldF, 'utf8')).length, 1);
    fs.writeFileSync(newF, '{broken'); await assert.rejects(L.tx((a) => { a.push({ id: 'c3' }); }), (e) => e.status === 500); assert.equal(fs.readFileSync(newF, 'utf8'), '{broken');
  });

  await t('song song: nhieu bai / reaction cung luc khong lam hong file', async () => {
    const u = { id: '111111111111111120', username: 'par' };
    await Promise.all(Array.from({ length: 8 }, (_, i) => forum.createPost(u, { content: 'par-' + i })));
    assert.equal(disk('posts.json').filter((x) => x.authorId === u.id).length, 8);
  });
  console.log(n + ' tests passed');
})();
