'use strict';
// Kiem thu logic khong can mang / express:  npm test
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vth-'));
process.env.VTUBER_DATA_FILE = path.join(tmp, 'vtubers.json');
process.env.VTUBER_CACHE_DIR = tmp;
process.env.FANART_FILE = path.join(tmp, 'fanart.json'); process.env.NEWS_FILE = path.join(tmp, 'news.json'); process.env.USERS_FILE = path.join(tmp, 'users.json');
process.env.IMGBB_API_KEY = 'k'; delete process.env.TURNSTILE_SITE_KEY; delete process.env.TURNSTILE_SECRET_KEY;
process.env.ADMIN_USERNAME = 'admin'; process.env.ADMIN_PASSWORD = 'pw123';
const store = require('../services/store'), yt = require('../services/youtube'), cache = require('../services/cache');
const { getState } = require('../services/state'), auth = require('../middleware/auth');
const fanart = require('../services/fanart'), news = require('../services/news'), captcha = require('../services/captcha');
const realFetch = global.fetch; let imgN = 0;
// mock imgbb + Turnstile (khong can mang)
global.fetch = async (url, opts) => {
  const j = (o) => ({ ok: true, json: async () => o });
  if (String(url).includes('imgbb.com')) { imgN++; return j({ success: true, data: { display_url: `https://i.ibb.co/${imgN}/a.jpg`, thumb: { url: `https://i.ibb.co/${imgN}/t.jpg` }, delete_url: 'https://ibb.co/del' } }); }
  if (String(url).includes('turnstile')) return j({ success: String(opts.body).includes('response=good') });
  return realFetch(url, opts);
};
const CID = 'UC' + 'a'.repeat(22), CID2 = 'UC' + 'b'.repeat(22);
let n = 0; const t = async (name, fn) => { try { await fn(); n++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n', e); process.exitCode = 1; } };

(async () => {
  // du lieu cu (schema giai doan 1) + ban ghi hong phai duoc giu nguyen
  fs.writeFileSync(process.env.VTUBER_DATA_FILE, JSON.stringify([{ id: 'old', name: 'Old', youtubeChannelId: CID2, enabled: true }, { weird: 1 }]));
  await t('legacy entry normalized (slug=id)', async () => { const l = await store.list(); assert.equal(l.length, 1); assert.equal(l[0].slug, 'old'); assert.equal(l[0].social && typeof l[0].social, 'object'); });
  await t('create: slug auto + unique + timestamps', async () => {
    const a = await store.create({ name: 'Thử Đặt Tên', youtubeChannelId: CID });
    const b = await store.create({ name: 'Thử Đặt Tên' });
    assert.equal(a.slug, 'thu-dat-ten'); assert.equal(b.slug, 'thu-dat-ten-2'); assert.ok(a.createdAt && b.youtubeChannelId === '');
  });
  await t('create: parallel requests do not corrupt file', async () => {
    const r = await Promise.allSettled([1, 2, 3, 4].map((i) => store.create({ name: 'p' + i })));
    assert.ok(r.every((x) => x.status === 'fulfilled')); JSON.parse(fs.readFileSync(process.env.VTUBER_DATA_FILE, 'utf8'));
  });
  await t('validation errors carry field + 400', async () => {
    for (const [inp, field] of [[{ name: '' }, 'name'], [{ name: 'x', slug: 'Bad Slug' }, 'slug'], [{ name: 'x', avatar: 'javascript:alert(1)' }, 'avatar'],
      [{ name: 'x', social: { twitter: 'nope' } }, 'social.twitter'], [{ name: 'x', youtubeChannelId: 'bad' }, 'youtube'], [{ name: 'x', description: 'a'.repeat(501) }, 'description']]) {
      await assert.rejects(store.create(inp), (e) => e.status === 400 && e.field === field, JSON.stringify(inp));
    }
  });
  await t('duplicate channel / slug => 409', async () => {
    await assert.rejects(store.create({ name: 'dup', youtubeChannelId: CID }), (e) => e.status === 409);
    await assert.rejects(store.create({ name: 'dup', slug: 'old' }), (e) => e.status === 409);
  });
  await t('update partial keeps other fields, id stable, slug change', async () => {
    const { after } = await store.update('old', { slug: 'renamed', description: 'hi', social: { twitter: 'https://x.com/a' } });
    assert.equal(after.id, 'old'); assert.equal(after.slug, 'renamed'); assert.equal(after.youtubeChannelId, CID2);
    assert.equal((await store.getBySlug('renamed')).id, 'old'); assert.equal(await store.getBySlug('nope'), null);
  });
  await t('toggle + remove; malformed entry preserved on disk', async () => {
    assert.equal((await store.toggle('old')).enabled, false); await store.remove('old');
    assert.ok(JSON.parse(fs.readFileSync(process.env.VTUBER_DATA_FILE, 'utf8')).some((x) => x.weird === 1));
    await assert.rejects(store.remove('../../etc/passwd'), (e) => e.status === 400);
  });
  await t('corrupt JSON => error, file NOT overwritten', async () => {
    fs.writeFileSync(process.env.VTUBER_DATA_FILE, '{oops'); await assert.rejects(store.create({ name: 'z' }));
    assert.equal(fs.readFileSync(process.env.VTUBER_DATA_FILE, 'utf8'), '{oops'); fs.writeFileSync(process.env.VTUBER_DATA_FILE, '[]');
  });

  const xml = `<?xml version="1.0"?><feed xmlns:yt="y" xmlns:media="m"><title>Chan &amp; Co</title><author><name>Chan &amp; Co</name></author>
  <entry><yt:videoId>abcdefghijk</yt:videoId><title>Hi &quot;x&quot;</title><link rel="alternate" href="https://www.youtube.com/watch?v=abcdefghijk"/><published>2026-01-02T03:04:05+00:00</published><media:group><media:thumbnail url="https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg" width="480"/></media:group></entry>
  <entry><yt:videoId>zzzzzzzzzzz</yt:videoId><title>S</title><link rel="alternate" href="https://www.youtube.com/shorts/zzzzzzzzzzz"/><published>2026-01-01T00:00:00+00:00</published></entry></feed>`;
  await t('parseFeed', () => { const f = yt._internal.parseFeed(xml); assert.equal(f.channelName, 'Chan & Co'); assert.equal(f.entries.length, 2); assert.equal(f.entries[0].title, 'Hi "x"'); assert.ok(f.entries[0].thumbnail.includes('ytimg')); assert.throws(() => yt._internal.parseFeed('<html>')); });
  await t('extractJson handles braces in strings', () => { const j = yt._internal.extractJson('var ytInitialData = {"a":"}{","b":{"c":[1,2]}};</script>', ['ytInitialData = ']); assert.deepEqual(j, { a: '}{', b: { c: [1, 2] } }); });
  await t('resolveChannelId (offline cases)', async () => {
    assert.equal(await yt.resolveChannelId(CID), CID);
    assert.equal(await yt.resolveChannelId('https://www.youtube.com/channel/' + CID + '?x=1'), CID);
    for (const bad of ['', 'https://evil.com/channel/' + CID, 'http://169.254.169.254/', 'youtube.com/watch?v=1']) await assert.rejects(yt.resolveChannelId(bad), (e) => e.code === 'INVALID', bad);
  });

  const orig = { ...yt }; const V = { id: 'v', slug: 'v', name: 'V', youtubeChannelId: CID, description: 'd', social: {}, avatar: '' };
  await t('state: cacheOnly before fetch => pending, no crash', async () => { const s = await getState(V, { cacheOnly: true }); assert.equal(s.status, 'unknown'); assert.equal(s.meta.pending, true); assert.deepEqual(s.meta.errors, {}); });
  await t('state: live/upcoming/offline derived, livestream type tagged', async () => {
    yt.fetchChannel = async () => ({ id: CID, name: 'Chan', avatar: 'https://x/a.jpg', url: yt.channelUrl(CID) });
    yt.fetchVideos = async () => [{ id: 'LIVE1234567', title: 't', type: 'unknown' }, { id: 'other123456', title: 'u', type: 'unknown' }];
    yt.fetchLive = async () => ({ state: true, live: { videoId: 'LIVE1234567', title: 't' } });
    yt.fetchUpcoming = async () => [];
    let s = await getState(V); assert.equal(s.status, 'live'); assert.equal(s.videos[0].type, 'livestream'); assert.equal(s.avatar, 'https://x/a.jpg'); assert.equal(s.videoCount, 2);
    await cache.set('live', CID, { state: false, live: null }); s = await getState(V, { cacheOnly: true }); assert.equal(s.status, 'offline');
    await cache.set('upcoming', CID, [{ videoId: 'UP123456789', scheduledStartTime: '2026-10-01T00:00:00Z' }]); s = await getState(V, { cacheOnly: true }); assert.equal(s.status, 'upcoming');
    s = await getState({ ...V, avatar: 'https://custom/a.png' }, { cacheOnly: true }); assert.equal(s.avatar, 'https://custom/a.png');
  });
  await t('state: YouTube down => stale cache served; one source failing does not fail others', async () => {
    const boom = async () => { throw new Error('boom'); };
    Object.assign(yt, { fetchChannel: boom, fetchVideos: boom, fetchLive: boom, fetchUpcoming: boom });
    const s = await getState(V, { force: true }); assert.equal(s.meta.stale, true); assert.equal(s.status, 'upcoming'); assert.equal(s.videos.length, 2);
  });
  await t('state: no cache + YouTube down => unknown with errors, never throws', async () => {
    const s = await getState({ ...V, youtubeChannelId: CID2 }, { force: true }); assert.equal(s.status, 'unknown'); assert.equal(s.isLive, 'unknown'); assert.ok(s.meta.errors.videos); assert.deepEqual(s.videos, []);
  });
  await t('state: VTuber without YouTube', async () => { const s = await getState({ ...V, youtubeChannelId: '' }); assert.equal(s.meta.noYoutube, true); assert.equal(s.channel, null); });
  Object.assign(yt, orig);
  await t('cache: clearChannel removes memory+files; path-unsafe key rejected', async () => {
    await cache.clearChannel(CID); assert.equal(await cache.peek('live', CID), null); assert.ok(!fs.readdirSync(tmp).some((f) => f.includes(CID)));
    await assert.rejects(cache.get('live', '../x', async () => 1));
  });
  await t('auth.checkCredentials', () => { assert.ok(auth.checkCredentials('admin', 'pw123')); assert.ok(auth.checkCredentials(' admin ', 'pw123')); assert.ok(!auth.checkCredentials('admin', 'nope')); assert.ok(!auth.checkCredentials('x', 'pw123')); });
  await t('graduated: default false, create/validate/update/legacy', async () => {
    const g = await store.create({ name: 'Grad One', graduated: true }); const ng = await store.create({ name: 'Not Grad' });
    assert.equal(g.graduated, true); assert.equal(ng.graduated, false);
    await assert.rejects(store.create({ name: 'x', graduated: 'maybe' }), (e) => e.status === 400 && e.field === 'graduated');
    const { after } = await store.update(g.id, { graduated: false }); assert.equal(after.graduated, false);
    const { after: a2 } = await store.update(g.id, { graduated: 'true' }); assert.equal(a2.graduated, true);
    assert.equal((await getState(g, { cacheOnly: true })).graduated, true);
    assert.equal((await store.getBySlug(g.slug)).graduated, true);
  });
  const IMG = 'aGVsbG8=';
  const U1 = { id: '333333333333333333', username: 'fan1' };
  await t('fanart: moi dang = pending + authorId/username tu session; public khong thay; duyet moi hien', async () => {
    const it = await fanart.add(U1, { image: IMG, title: 'T<b>', authorId: '999999999999999999', username: 'fake', status: 'approved' });
    assert.equal(it.status, 'pending'); assert.equal(it.title, 'T<b>'); assert.equal(it.authorId, U1.id); assert.equal(it.username, 'fan1'); assert.equal((await fanart.list()).length, 0);
    assert.equal((await fanart.list({ all: true })).length, 1); assert.equal((await fanart.list({ status: 'pending' })).length, 1);
    await fanart.setStatus(it.id, 'approved'); assert.equal((await fanart.list()).length, 1);
    await assert.rejects(fanart.setStatus(it.id, 'rejected'), (e) => e.status === 400 && e.field === 'reason'); // tu choi bat buoc co ly do
    const r = await fanart.setStatus(it.id, 'rejected', 'Sai chu de'); assert.equal(r.rejectReason, 'Sai chu de'); assert.equal((await fanart.list()).length, 0);
    await assert.rejects(fanart.setStatus(it.id, 'hack'), (e) => e.status === 400); await assert.rejects(fanart.setStatus('nope', 'approved'), (e) => e.status === 404);
    await assert.rejects(fanart.add(null, { image: IMG }), (e) => e.status === 401); // khong dang nhap => khong dang duoc
    await fanart.remove(it.id); assert.equal((await fanart.list({ all: true })).length, 0);
  });
  await t('fanart: ban ghi cu khong co status van hien (da duyet); anh loi bi tu choi', async () => {
    fs.writeFileSync(process.env.FANART_FILE, JSON.stringify([{ id: 'old1', title: 'cu', author: 'Ten cu', url: 'https://x/a.jpg', createdAt: '2026-01-01' }]));
    const l = await fanart.list(); assert.equal(l.length, 1); assert.equal(l[0].status, 'approved'); assert.equal(l[0].image, 'https://x/a.jpg'); assert.equal(l[0].authorId, null);
    await assert.rejects(fanart.add(U1, { image: 'not base64!!' }), (e) => e.status === 400);
    await assert.rejects(fanart.add(U1, { image: 'A'.repeat(7e6 + 1) }), (e) => e.status === 413);
  });
  await t('captcha: chua cau hinh => 503; token sai => 400; dung => ok', async () => {
    await assert.rejects(captcha.verify('good', '1.1.1.1'), (e) => e.status === 503);
    process.env.TURNSTILE_SITE_KEY = 'site'; process.env.TURNSTILE_SECRET_KEY = 'sec';
    assert.equal(captcha.enabled(), true);
    await assert.rejects(captcha.verify('', '1.1.1.1'), (e) => e.status === 400);
    await assert.rejects(captcha.verify(undefined, '1.1.1.1'), (e) => e.status === 400);
    await assert.rejects(captcha.verify('bad', '1.1.1.1'), (e) => e.status === 400);
    assert.equal(await captcha.verify('good', '1.1.1.1'), true);
  });
  await t('news: tao co anh, gioi han 4 anh, an/hien, sua, xoa', async () => {
    const a = await news.create({ title: ' Tin 1 ', content: 'Noi dung', newImages: [IMG, IMG] });
    assert.equal(a.title, 'Tin 1'); assert.equal(a.images.length, 2); assert.ok(news.isValidId(a.id)); assert.equal(a.published, true);
    await assert.rejects(news.create({ title: 'x', content: 'y', newImages: [IMG, IMG, IMG, IMG, IMG] }), (e) => e.status === 400 && e.field === 'images');
    await assert.rejects(news.create({ title: '', content: 'y' }), (e) => e.field === 'title');
    await assert.rejects(news.create({ title: 'x', content: '' }), (e) => e.field === 'content');
    const u = await news.update(a.id, { images: [a.images[0]], newImages: [IMG], published: false }); assert.equal(u.images.length, 2); assert.equal(u.images[0], a.images[0]);
    assert.equal((await news.list()).length, 0); assert.equal((await news.list({ all: true })).length, 1);
    assert.equal(await news.get(a.id), null); assert.ok(await news.get(a.id, { all: true }));
    const k = await news.update(a.id, { title: 'Moi', images: ['javascript:alert(1)', 'https://ok/x.jpg'] }); assert.deepEqual(k.images, ['https://ok/x.jpg']); assert.equal(k.content, 'Noi dung');
    assert.equal(await news.get('../../etc'), null); await news.remove(a.id); assert.equal((await news.list({ all: true })).length, 0);
    await assert.rejects(news.remove(a.id), (e) => e.status === 404);
  });
  global.fetch = realFetch;
  console.log(`\n${n} tests passed${process.exitCode ? ' (co test FAIL)' : ''}`); fs.rmSync(tmp, { recursive: true, force: true });
})();
