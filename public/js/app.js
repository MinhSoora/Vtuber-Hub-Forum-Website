/* Shared helpers + public pages. Chi goi API cua Node.js (khong goi YouTube truc tiep). */
const $ = (s, r = document) => r.querySelector(s);
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'href') { if (/^(https?:\/\/|\/)/.test(v)) e.setAttribute('href', v); }
    else if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
const _c = new Map();
/** Trang thai dang nhap (1 request/trang, dung chung) + goi API ghi kem X-CSRF-Token cua session. */
let _me = null;
const getMe = () => (_me = _me || api('/api/auth/me').catch((e) => { _me = null; throw e; }));
async function apiw(url, method, body) {
  const me = await getMe();
  if (!me.loggedIn) { location.href = '/auth/discord/login?next=' + encodeURIComponent(location.pathname + location.search); throw new Error('Bạn cần đăng nhập'); }
  try { return await api(url, { method, body, headers: { 'X-CSRF-Token': me.csrfToken } }); }
  catch (e) { // server bao chua dong y TOS/Rules (phien ban moi) => sang man hinh xac nhan, xong quay lai trang nay
    if (e.code === 'consent_required') location.href = '/login?reconsent=1&next=' + encodeURIComponent(location.pathname + location.search);
    throw e;
  }
}
/* Cloudflare Turnstile dung chung cho Feed (bai viet, binh luan). Chi hoat dong khi server da cau hinh TURNSTILE_*.
 * Che do "interaction-only": thuong chay ngam, chi hien khung xac minh khi Cloudflare nghi ngo => it lam phien nguoi dung that. */
let _cfCfg = null, _cfScript = null;
const cfConfig = () => (_cfCfg = _cfCfg || api('/api/config').catch(() => ({})));
const loadTurnstile = () => (window.turnstile ? Promise.resolve() : (_cfScript = _cfScript || new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true;
  s.onload = res; s.onerror = () => { _cfScript = null; rej(new Error('Không tải được Cloudflare captcha. Kiểm tra mạng / tắt trình chặn quảng cáo rồi tải lại trang.')); };
  document.head.append(s);
})));
function captchaBox() {
  const el = h('div', { class: 'cfbox' }); let token = '', wid = null, waiters = [], enabled = false, initErr = null;
  const flush = (t, e) => { const w = waiters; waiters = []; w.forEach((f) => f(t, e)); };
  const ready = cfConfig().then(async (cfg) => {
    if (!cfg.turnstileSiteKey) return;
    enabled = true; await loadTurnstile();
    await new Promise((r) => { const go = () => (el.isConnected ? r() : requestAnimationFrame(go)); go(); });   // widget chi render duoc khi da nam trong DOM
    wid = window.turnstile.render(el, { sitekey: cfg.turnstileSiteKey, appearance: 'interaction-only',
      callback: (t) => { token = t; flush(t); }, 'expired-callback': () => { token = ''; },
      'error-callback': () => { token = ''; flush('', new Error('Xác minh captcha thất bại, hãy thử lại.')); } });
  }).catch((e) => { initErr = e; });
  return {
    el,
    /** Lay token (doi toi da 25s neu Cloudflare dang xac minh). Tra '' neu server khong bat captcha. */
    async get() {
      await ready; if (!enabled) return ''; if (initErr) throw initErr; if (token) return token;
      return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('Xác minh captcha quá lâu, hãy thử lại.')), 25000); waiters.push((tok, e) => { clearTimeout(t); e ? rej(e) : res(tok); }); });
    },
    reset() { token = ''; try { if (wid !== null) window.turnstile.reset(wid); } catch { /* bo qua */ } },
  };
}
/** Avatar + ten tac gia (lay tu account Discord hien tai) - bam vao mo profile /users/:id. */
function userLink(a, { avatar = true, cls = '' } = {}) {
  const name = (a && a.username) || 'Ẩn danh';
  const inner = [avatar && img(a && a.avatarUrl, name, 'av sm', name), h('span', { class: 'un' }, name)];
  return a && a.id ? h('a', { class: 'ulink ' + cls, href: '/users/' + encodeURIComponent(a.id), title: 'Xem hồ sơ ' + name }, inner) : h('span', { class: 'ulink ' + cls }, inner);
}
async function api(url, opts = {}) {
  if (!opts.method && opts.ttl) { const c = _c.get(url); if (c && Date.now() - c.t < opts.ttl) return c.v; } // tranh request lap
  const init = { credentials: 'same-origin', method: opts.method || 'GET', headers: {} };
  if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  if (opts.headers) Object.assign(init.headers, opts.headers);
  let res, json;
  try { res = await fetch(url, init); json = await res.json(); } catch { throw new Error('Không kết nối được máy chủ'); }
  if (res.status === 401 && location.pathname.startsWith('/admin') && !location.pathname.endsWith('/login')) { location.href = '/admin/login'; throw new Error('Session hết hạn'); }
  if (!json.success) { const e = new Error(json.error || 'Lỗi'); e.field = json.field; e.status = res.status; e.code = json.code; throw e; }
  if (opts.ttl) _c.set(url, { t: Date.now(), v: json.data });
  return json.data;
}
function toast(msg, type = '') {
  let box = $('#toasts'); if (!box) { box = h('div', { id: 'toasts' }); document.body.append(box); }
  const t = h('div', { class: 'toast ' + type, role: 'status' }, msg); box.append(t);
  setTimeout(() => { t.style.opacity = 0; t.style.transition = '.3s'; setTimeout(() => t.remove(), 300); }, 3500);
}
const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);
const initials = (n) => (String(n || '?').trim()[0] || '?').toUpperCase();
/** Anh co placeholder + fade-in + khong bao gio hien broken icon. */
function img(src, alt, cls, label) {
  const w = h('span', { class: 'img ' + cls }, h('span', { class: 'ph' }, cls.includes('av') ? initials(label) : ''));
  if (safeUrl(src)) {
    const i = new Image(); i.alt = alt || ''; i.loading = 'lazy'; i.decoding = 'async'; i.referrerPolicy = 'no-referrer';
    i.onload = () => w.classList.add('loaded'); i.onerror = () => i.remove(); i.src = src; w.append(i);
  }
  return w;
}
const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }); };
const fmtDT = (iso) => { const d = new Date(iso); return isNaN(d) ? 'chưa rõ' : d.toLocaleString('vi-VN'); };
function ago(iso) {
  const d = new Date(iso); if (isNaN(d)) return '';
  const s = (d - Date.now()) / 1000, r = new Intl.RelativeTimeFormat('vi', { numeric: 'auto' });
  for (const [u, n] of [['year', 31536e3], ['month', 2592e3], ['day', 86400], ['hour', 3600], ['minute', 60]]) if (Math.abs(s) >= n) return r.format(Math.round(s / n), u);
  return 'vừa xong';
}
const STATUS = { live: 'Đang live', upcoming: 'Sắp live', offline: 'Offline', unknown: 'Chưa rõ', disabled: 'Đã tắt' };
const badge = (s) => h('span', { class: 'badge ' + s }, STATUS[s] || STATUS.unknown);
const state = (em, title, text, action) => h('div', { class: 'state' }, h('span', { class: 'em' }, em), h('h3', {}, title), h('p', {}, text), action);
const errState = (msg, retry) => state('⚠️', 'Không thể tải dữ liệu', msg, retry && h('button', { class: 'btn', onclick: retry }, 'Thử lại'));
const skels = (n, big) => h('div', { class: 'grid' + (big ? ' big' : '') }, Array.from({ length: n }, () => h('div', { class: 'skel' })));

/* navbar + footer */
const ico = (d) => { const t = document.createElement('template'); t.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`; return t.content.firstChild; };
const I_PLUS = '<path d="M12 5v14M5 12h14"/>', I_UP = '<path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>';
/** Thong bao ket qua dang nhap Discord (server chuyen ve /?login_error=<ma>); xoa tham so khoi URL sau khi hien. */
function loginNotice() {
  const code = new URLSearchParams(location.search).get('login_error'); if (!code) return;
  const M = { banned: 'Tài khoản của bạn đang bị cấm truy cập.', denied: 'Bạn đã hủy đăng nhập Discord.', state: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Hãy thử lại (truy cập đúng tên miền đã cấu hình).', invalid: 'Yêu cầu đăng nhập không hợp lệ.', rate: 'Thử quá nhiều lần, vui lòng đợi 15 phút.', disabled: 'Đăng nhập Discord chưa được bật trên máy chủ này.', failed: 'Đăng nhập Discord thất bại. Vui lòng thử lại.' };
  toast(M[code] || M.failed, code === 'denied' ? '' : 'err');
  const u = new URL(location.href); u.searchParams.delete('login_error'); history.replaceState(null, '', u.pathname + u.search + u.hash);
}
/** Thong bao do Admin quan ly: Marquee (ngay duoi navbar chinh) + Popup. Noi dung chi render bang textContent (h()), link chi http(s). */
function announcements(header) {
  api('/api/announcements', { ttl: 30000 }).then((d) => {
    if (d.marquee && d.marquee.length) {
      const set = (hidden) => h('div', { class: 'mq-set', 'aria-hidden': hidden ? 'true' : null }, d.marquee.map((m) => (safeUrl(m.link)
        ? h('a', { class: 'mq-item', href: m.link, target: '_blank', rel: 'noopener noreferrer', tabindex: hidden ? '-1' : null }, m.text)
        : h('span', { class: 'mq-item' }, m.text))));
      const total = d.marquee.reduce((n, m) => n + m.text.length + 8, 0);
      header.after(h('div', { class: 'mq', role: 'region', 'aria-label': 'Thông báo', style: `--mq-dur:${Math.max(15, Math.round(total * 0.25))}s` }, h('div', { class: 'mq-track' }, set(false), set(true))));
    }
    const key = (p) => 'vth.pop.' + p.id + '.' + p.updatedAt;
    const seen = (p) => { try { return !!localStorage.getItem(key(p)); } catch { return false; } };
    const queue = (d.popups || []).filter((p) => !seen(p));
    const next = () => {
      const p = queue.shift(); if (!p) return;
      const done = () => { try { localStorage.setItem(key(p), '1'); } catch { /* bo qua */ } ov.remove(); document.removeEventListener('keydown', onKey); next(); };
      const onKey = (e) => { if (e.key === 'Escape') done(); };
      const ov = h('div', { class: 'mov pop ' + p.type, role: 'dialog', 'aria-modal': 'true', 'aria-label': p.title, onclick: (e) => { if (e.target === ov) done(); } },
        h('div', { class: 'modal' }, h('div', { class: 'mh' }, h('h3', {}, p.title), h('button', { class: 'mx', 'aria-label': 'Đóng', onclick: done }, '×')), h('div', { class: 'mb' }, h('p', { class: 'pmsg' }, p.message)),
          h('div', { class: 'mf' }, h('button', { class: 'btn', onclick: done }, 'Đóng'))));
      document.body.append(ov); document.addEventListener('keydown', onKey); ov.querySelector('.btn').focus();
    };
    next();
  }).catch(() => {});
}
function chrome() {
  const p = location.pathname, link = (href, t, on) => h('a', { href, class: on ? 'on' : '', 'aria-current': on ? 'page' : null }, t);
  const liveNav = h('a', { href: '/vtubers', class: 'livechip', hidden: true });
  api('/api/stats', { ttl: 30000 }).then((st) => { if (st.live) { liveNav.hidden = false; liveNav.textContent = '● ' + st.live + ' đang live'; } }).catch(() => {});
  const links = h('nav', { class: 'nav-links', id: 'nl', 'aria-label': 'Điều hướng chính' }, link('/', 'Trang chủ', p === '/'), link('/vtubers', 'VTuber', p.startsWith('/vtuber')), link('/clippers', 'Clipper', p === '/clippers'), link('/forum', 'Forum', p.startsWith('/forum')), link('/fanart', 'Fan Art', p.startsWith('/fanart')), link('/news', 'Tin tức', p.startsWith('/news')), link('/contribute', 'Đóng góp', p === '/contribute'));
  const acc = h('span', { class: 'nav-acc' }); // Dang nhap Discord / avatar tai khoan (an neu server chua cau hinh Discord)
  getMe().then((me) => {
    if (me.loggedIn) acc.replaceChildren(h('a', { href: '/users/' + me.user.id, class: 'nav-user', title: 'Hồ sơ của tôi: ' + me.user.username }, img(me.user.avatarUrl, '', 'av sm', me.user.username), h('span', { class: 't' }, me.user.username)), h('a', { href: '/account', class: 'ic ghost', title: 'Quản lý tài khoản', 'aria-label': 'Quản lý tài khoản' }, '⚙'));
    else if (me.discordEnabled) acc.replaceChildren(h('a', { class: 'btn ghost sm', href: '/auth/discord/login?next=' + encodeURIComponent(location.pathname + location.search) }, 'Đăng nhập'));
  }).catch(() => {});
  loginNotice();
  const burger = h('button', { class: 'burger', 'aria-label': 'Mở menu', 'aria-controls': 'nl', onclick: () => links.classList.toggle('open') }, '☰');
  const brand = () => h('a', { href: '/', class: 'brand' }, h('span', { class: 'logo' }, 'V'), 'VTuber Hub');
  const hdr = h('header', { class: 'nav' }, h('div', { class: 'nav-in' }, brand(), links,
    h('div', { class: 'nav-r' }, liveNav, acc, h('a', { class: 'btn nav-cta', href: '/fanart/upload', 'aria-label': 'Đăng Fan Art' }, ico(I_PLUS), h('span', { class: 't' }, 'Đăng Fan Art')), burger)));
  $('#nav').replaceWith(hdr); announcements(hdr);
  const col = (t, items) => h('div', {}, h('h4', {}, t), h('ul', {}, items.map(([href, x]) => h('li', {}, h('a', { href }, x)))));
  $('#foot').replaceWith(h('footer', { class: 'foot' },
    h('div', { class: 'foot-in' }, h('div', {}, brand(), h('p', { class: 'about' }, 'Theo dõi VTuber, Clipper và Fan Art: trạng thái live, video mới và tác phẩm của cộng đồng trong một trang.')),
      col('Khám phá', [['/vtubers', 'VTuber'], ['/clippers', 'Clipper'], ['/forum', 'Forum'], ['/fanart', 'Fan Art'], ['/news', 'Tin tức']]),
      col('Cộng đồng', [['/contribute', 'Đóng góp / chỉnh sửa'], ['/fanart/upload', 'Đăng Fan Art'], ['/fanart', 'Thư viện Fan Art'], ['/community-rules', 'Luật cộng đồng'], ['/tos', 'Điều khoản dịch vụ (TOS)']]),
      col('Quản lý', [['/account', 'Tài khoản'], ['/admin/login', 'Đăng nhập quản trị']])),
    h('div', { class: 'foot-b' }, h('span', {}, '© ' + new Date().getFullYear() + ' VTuber Hub'), h('span', {}, 'Dữ liệu công khai từ YouTube. ', h('a', { href: '/tos' }, 'TOS'), ' · ', h('a', { href: '/community-rules' }, 'Luật cộng đồng')))));
}

/* cards */
const stat = (n, label) => h('div', { class: 'stat' }, h('b', {}, n), h('span', {}, label));
/* helpers luu local: yeu thich / chan */
const lsGet = (k) => { try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')); } catch { return new Set(); } };
const lsSet = (k, s) => { try { localStorage.setItem(k, JSON.stringify([...s])); } catch { /* bo qua */ } };
const subsNum = (t) => { const m = String(t || '').match(/([\d.,]+)\s*([KMB])?/i); return m ? (parseFloat(m[1].replace(',', '.')) || 0) * ({ K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1) : 0; };
const fmtSubs = (t) => { const m = String(t || '').match(/([\d.,]+)\s*([KMB])?/i); return m ? m[1].replace('.', ',') + ({ K: ' N', M: ' Tr', B: ' T' }[(m[2] || '').toUpperCase()] || '') + ' người đăng kí' : ''; };
const GLYPH = { twitter: '𝕏', facebook: 'f', instagram: '◎', tiktok: '♪', twitch: 'T', discord: 'D', website: '🌐' };
const icon = (cls, txt, href, title) => h('a', { class: 'ic ' + cls, href, target: '_blank', rel: 'noopener noreferrer', title, 'aria-label': title }, txt);

const gradTag = () => h('span', { class: 'gtag' }, '🎓 Tốt nghiệp');
/** VTuber dang hoat dong xep truoc, da tot nghiep xep sau (giu nguyen thu tu con lai). */
const gradLast = (a) => [...a.filter((v) => !v.graduated), ...a.filter((v) => v.graduated)];

/** Card dang hang (avatar vuong ben trai) - dung cho VTuber & Clipper. */
function rowCard(v, i = 0, onChange) {
  const url = '/vtuber/' + encodeURIComponent(v.slug);
  const soc = Object.entries(v.social || {}).filter(([k, u]) => SOCIAL[k] && safeUrl(u));
  const toggle = (key, btn, on, off) => (e) => {
    e.preventDefault(); const s = lsGet(key); const has = s.has(v.slug); has ? s.delete(v.slug) : s.add(v.slug); lsSet(key, s);
    if (onChange) return onChange(); btn.textContent = has ? off : on; btn.classList.toggle('on');
  };
  const fav = lsGet('vth.fav').has(v.slug), blk = lsGet('vth.block').has(v.slug);
  const heart = h('button', { class: 'ic ghost' + (fav ? ' on' : ''), title: 'Yêu thích' }, fav ? '♥' : '♡');
  const block = h('button', { class: 'ic ghost' + (blk ? ' on' : ''), title: blk ? 'Bỏ chặn' : 'Chặn' }, '⊘');
  heart.onclick = toggle('vth.fav', heart, '♥', '♡'); block.onclick = toggle('vth.block', block, '⊘', '⊘');
  return h('article', { class: 'row' + (v.status === 'live' ? ' islive' : '') + (v.graduated ? ' grad' : ''), style: `--i:${i}` },
    h('a', { class: 'rav', href: url }, img(v.avatar, v.name, 'sq', v.name), v.status === 'live' && h('span', { class: 'livepill' }, 'LIVE')),
    h('div', { class: 'rbody' },
      h('a', { class: 'rname', href: url }, v.name, v.graduated && gradTag()),
      h('div', { class: 'rsub' }, '@' + v.slug + ' • ' + (v.type === 'clipper' ? 'Clipper' : 'Tự do')),
      v.subscribers && h('div', { class: 'rsub' }, fmtSubs(v.subscribers)),
      h('div', { class: 'icons' }, v.channel && icon('yt', '▶', v.channel.url, 'YouTube'),
        soc.map(([k, u]) => icon(k, GLYPH[k], u, SOCIAL[k])), heart, block)));
}
const fanCard = (x, i = 0, extra) => h('article', { class: 'fa', style: `--i:${i}` },
  h('a', { href: safeUrl(x.image || x.url) || '#', target: '_blank', rel: 'noopener noreferrer' }, img(x.thumb || x.image || x.url, x.title, 'fath', x.title)),
  h('div', { class: 'fmeta' }, h('b', {}, x.title || 'Không tên'), userLink(x.author && typeof x.author === 'object' ? x.author : { username: x.author }), h('span', {}, fmtDate(x.createdAt)),
    x.description && h('span', { class: 'fdesc' }, x.description), extra));
function videoCard(x, i = 0, owner) {
  return h('article', { class: 'card vid', style: `--i:${i}` },
    h('div', { class: 'th img', style: 'position:relative' }, img(x.thumbnail, x.title, 'th', x.title),
      x.type && x.type !== 'unknown' && h('span', { class: 'tag' }, x.type === 'short' ? 'Short' : 'Livestream')),
    h('h4', {}, h('a', { class: 'stretch', href: x.url, target: '_blank', rel: 'noopener noreferrer' }, x.title || '(không tiêu đề)')),
    h('div', { class: 'meta' }, h('span', {}, owner || (x.vtuber && x.vtuber.name) || ''), h('span', {}, x.publishedAt ? fmtDate(x.publishedAt) : '')));
}

/* HOME */
async function pageHome() {
  const el = $('#app');
  el.append(h('section', { class: 'hero' }, h('h1', {}, 'Theo dõi VTuber yêu thích, không bỏ lỡ buổi live nào'),
    h('p', { class: 'lead' }, 'Trạng thái live, video mới, Clipper và Fan Art của cộng đồng, cập nhật tự động từ YouTube.'),
    h('form', { class: 'hsearch', onsubmit: (e) => { e.preventDefault(); location.href = '/vtubers?q=' + encodeURIComponent($('#hq').value); } },
      h('input', { id: 'hq', type: 'search', placeholder: 'Tìm VTuber theo tên…', 'aria-label': 'Tìm VTuber' }), h('button', { class: 'btn' }, 'Tìm kiếm')),
    h('div', { class: 'hcta' }, h('a', { class: 'btn ghost', href: '/vtubers' }, 'Khám phá VTuber'), h('a', { class: 'btn ghost', href: '/fanart/upload' }, 'Đăng Fan Art'))));
  const body = h('div', {}, skels(4)); el.append(body);
  async function load() {
    try {
      const [list, st, vids, fans, nws] = await Promise.all([api('/api/vtubers'), api('/api/stats'), api('/api/videos/latest?limit=8'), api('/api/fanart?limit=8').catch(() => []), api('/api/news?limit=3').catch(() => [])]);
      body.replaceChildren();
      if (!list.length) { body.append(state('🌸', 'Chưa có VTuber', 'Admin chưa thêm VTuber nào.', h('a', { class: 'btn', href: '/admin' }, 'Vào Admin'))); return; }
      const bl = lsGet('vth.block'), shown = list.filter((v) => !bl.has(v.slug));
      const by = (t) => gradLast(shown.filter((v) => (v.type || 'vtuber') === t));
      const live = shown.filter((v) => v.status === 'live');
      const rows = (a) => h('div', { class: 'grid rows' }, a.map((v, i) => rowCard(v, i)));
      const sec = (title, node, more) => h('section', { class: 'blk' }, h('div', { class: 'blk-h' }, h('h2', {}, title), more), node);
      const none = (t) => h('p', { class: 'muted' }, t);
      body.append(h('div', { class: 'stats' }, stat(st.totalVtubers, 'VTuber & Clipper'), stat(st.live, 'Đang live'), stat(st.upcoming, 'Lịch live sắp tới'), stat(st.videos, 'Video đã tải')));
      body.append(sec(`Đang phát trực tiếp (${live.length})`, live.length ? rows(live) : none('Hiện chưa có ai phát trực tiếp.')));
      body.append(sec('VTuber', by('vtuber').length ? rows(by('vtuber').slice(0, 8)) : none('Chưa có VTuber nào.'), h('a', { href: '/vtubers' }, 'Xem tất cả →')));
      body.append(sec('Clipper', by('clipper').length ? rows(by('clipper').slice(0, 8)) : none('Chưa có Clipper nào.'), h('a', { href: '/clippers' }, 'Xem tất cả →')));
      if (nws.length) body.append(sec('Tin tức', h('div', { class: 'grid big' }, nws.map((x, i) => newsCard(x, i))), h('a', { href: '/news' }, 'Xem tất cả tin →')));
      body.append(sec('Video mới nhất', vids.length ? h('div', { class: 'grid big' }, vids.map((x, i) => videoCard(x, i))) : state('🎞️', 'Chưa có video', st.pending ? 'Dữ liệu YouTube đang được tải, thử lại sau ít phút.' : 'Chưa lấy được video nào.')));
      body.append(sec('Fan Art mới', fans.length ? h('div', { class: 'grid fans' }, fans.map((x, i) => fanCard(x, i))) : none('Chưa có Fan Art nào — hãy là người đầu tiên!'), h('a', { href: '/fanart' }, 'Xem tất cả Fan Art →')));
    } catch (e) { body.replaceChildren(errState(e.message, load)); }
  }
  await load(); setInterval(() => { if (!document.hidden) load(); }, 60000);
}

/** Thanh phan trang: « 1 … 4 [5] 6 … 20 ». go(n) duoc goi khi bam. */
function pager(page, pages, go) {
  if (pages <= 1) return null;
  const nums = [...new Set([1, 2, page - 1, page, page + 1, pages - 1, pages].filter((n) => n >= 1 && n <= pages))].sort((a, b) => a - b);
  const btn = (n, t, dis, on) => h('button', { class: 'pg' + (on ? ' on' : ''), disabled: dis, 'aria-label': typeof t === 'number' ? 'Trang ' + t : t, 'aria-current': on ? 'page' : null, onclick: () => go(n) }, typeof t === 'number' ? String(t) : t);
  const items = [btn(page - 1, '‹', page <= 1)];
  nums.forEach((n, i) => { if (i && n - nums[i - 1] > 1) items.push(h('span', { class: 'pgdots' }, '…')); items.push(btn(n, n, false, n === page)); });
  items.push(btn(page + 1, '›', page >= pages));
  return h('nav', { class: 'pager', 'aria-label': 'Phân trang' }, items);
}

/* LIST (VTuber / Clipper) */
async function pageList() {
  const type = document.body.dataset.type || 'vtuber', label = type === 'clipper' ? 'Clipper' : 'VTuber';
  const el = $('#app'); el.append(h('section', { class: 'phd' }, h('div', {}, h('h1', {}, 'Danh sách ' + label), h('p', { class: 'lead' }, 'Tìm kiếm, lọc và theo dõi trạng thái live theo thời gian thực.'))));
  const q = h('input', { type: 'search', placeholder: `Tìm kiếm ${label}…`, value: new URLSearchParams(location.search).get('q') || '' });
  const s = h('select', {}, [['live', 'Ưu tiên đang live'], ['subs', 'Nhiều đăng ký nhất'], ['name', 'Tên A-Z'], ['new', 'Mới thêm'], ['video', 'Video mới nhất']].map(([v, t]) => h('option', { value: v }, t)));
  let tab = 'all'; const KEYS = ['all', 'grad', 'fav', 'block'];
  const tabs = [['all', 'Tất cả'], ['grad', 'Tốt nghiệp'], ['fav', 'Yêu thích'], ['block', 'Chặn']].map(([k, t]) => h('button', { class: 'tab', onclick: () => { tab = k; page = 1; draw(); } }, t));
  const liveChip = h('span', { class: 'livechip', hidden: true });
  const out = h('div', {}, skels(8)); el.append(h('div', { class: 'tabs' }, tabs, liveChip), h('div', { class: 'bar' }, q, s), out);
  const PER = 24; let page = Math.max(parseInt(new URLSearchParams(location.search).get('page'), 10) || 1, 1);
  let list = [];
  const rank = { live: 0, upcoming: 1, offline: 2, unknown: 3 };
  const vt = (v) => (v.videos[0] ? +new Date(v.videos[0].publishedAt) || 0 : 0);
  function draw() {
    const t = q.value.trim().toLowerCase(), fav = lsGet('vth.fav'), bl = lsGet('vth.block');
    tabs.forEach((b, i) => b.classList.toggle('on', KEYS[i] === tab));
    const nLive = list.filter((v) => v.status === 'live' && !bl.has(v.slug)).length; liveChip.hidden = !nLive; liveChip.textContent = `● ${nLive} LIVE`;
    const r = list.filter((v) => (tab === 'block' ? bl.has(v.slug) : !bl.has(v.slug) && (tab !== 'fav' || fav.has(v.slug)) && (tab !== 'grad' || v.graduated)) && (!t || (v.name + ' ' + v.slug + ' ' + v.description).toLowerCase().includes(t)));
    const g = (a, b) => (a.graduated ? 1 : 0) - (b.graduated ? 1 : 0); // da tot nghiep luon xuong cuoi (tru tab Tot nghiep)
    r.sort({ live: (a, b) => (tab === 'grad' ? 0 : g(a, b)) || rank[a.status] - rank[b.status] || subsNum(b.subscribers) - subsNum(a.subscribers) || a.name.localeCompare(b.name), subs: (a, b) => subsNum(b.subscribers) - subsNum(a.subscribers),
      name: (a, b) => a.name.localeCompare(b.name), new: (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')), video: (a, b) => vt(b) - vt(a) }[s.value]);
    const pages = Math.max(1, Math.ceil(r.length / PER)); page = Math.min(page, pages);
    const u = new URL(location.href); page > 1 ? u.searchParams.set('page', page) : u.searchParams.delete('page'); history.replaceState(null, '', u);
    const from = (page - 1) * PER, part = r.slice(from, from + PER);
    const go = (n) => { page = n; draw(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    out.replaceChildren(...(r.length ? [h('p', { class: 'muted pginfo' }, `Hiển thị ${from + 1}–${from + part.length} / ${r.length} ${label}` + (pages > 1 ? ` · Trang ${page}/${pages}` : '')), h('div', { class: 'grid rows' }, part.map((v, i) => rowCard(v, i, draw))), pager(page, pages, go)] : [list.length ? state('🔍', 'Không có kết quả', tab === 'all' ? 'Thử từ khóa khác.' : 'Danh sách này đang trống.') : state('🌸', `Chưa có ${label}`, 'Admin chưa thêm mục nào.')]).filter(Boolean));
  }
  let tm; q.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { page = 1; draw(); }, 150); }; s.onchange = () => { page = 1; draw(); };
  async function load() { try { list = (await api('/api/vtubers')).filter((v) => (v.type || 'vtuber') === type); draw(); } catch (e) { out.replaceChildren(errState(e.message, load)); } }
  await load();
}

/* FAN ART */
async function toB64(f) { // thu nho <= 2000px va nen JPEG de upload nhanh; GIF giu nguyen
  if (f.type === 'image/gif') return new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(f); });
  const bm = await createImageBitmap(f), k = Math.min(1, 2000 / Math.max(bm.width, bm.height)), c = document.createElement('canvas');
  c.width = Math.round(bm.width * k); c.height = Math.round(bm.height * k); c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.88).split(',')[1];
}
const POST_STATUS = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Bị từ chối' };
/** Nhan trang thai + ly do tu choi (chi chu bai thay - server khong tra cho nguoi khac). */
const statusNote = (x) => x.status && h('div', { class: 'stnote' }, h('span', { class: 'badge ' + x.status }, POST_STATUS[x.status] || x.status),
  x.status === 'rejected' && x.rejectReason && h('div', { class: 'why' }, 'Lý do: ', x.rejectReason),
  x.status === 'pending' && h('div', { class: 'muted' }, 'Chỉ mình bạn thấy cho tới khi admin duyệt.'));
async function pageFanart() {
  const el = $('#app');
  let isAdmin = false; try { isAdmin = (await api('/api/admin/me')).loggedIn; } catch { /* khach */ }
  let me = null; try { me = await getMe(); } catch { /* khach */ }
  el.append(h('section', { class: 'phd' }, h('div', {}, h('h1', {}, 'Fan Art'), h('p', { class: 'lead' }, 'Tác phẩm do cộng đồng sáng tạo cho các VTuber yêu thích.')),
    h('a', { class: 'btn lg', href: '/fanart/upload' }, ico(I_PLUS), 'Đăng Fan Art')));
  const mineBox = h('div', {}); el.append(mineBox);
  const grid = h('div', { class: 'grid fans' }); el.append(grid);
  const del = (x, node) => h('button', { class: 'btn sm danger', onclick: async () => { if (!confirm('Xóa ảnh này?')) return; try { await api('/api/admin/fanart/' + x.id, { method: 'DELETE' }); node.remove(); } catch (e) { toast(e.message, 'err'); } } }, 'Xóa');
  if (me && me.loggedIn) {
    const loadMine = async () => {
      let l; try { l = await api('/api/fanart/mine'); } catch { return; }
      if (!l.length) { mineBox.replaceChildren(); return; }
      mineBox.replaceChildren(h('section', { class: 'blk' }, h('div', { class: 'blk-h' }, h('h2', {}, `Fan Art của tôi (${l.length})`)), h('div', { class: 'grid fans' }, l.map((x, i) => {
        const own = h('div', { class: 'acts' },
          h('a', { class: 'btn ghost sm', href: '/fanart/upload?edit=' + encodeURIComponent(x.id) }, 'Sửa'),
          h('button', { class: 'btn danger sm', onclick: async () => { if (!confirm('Xóa Fan Art này?')) return; try { await apiw('/api/fanart/' + encodeURIComponent(x.id), 'DELETE'); toast('Đã xóa', 'ok'); loadMine(); } catch (e) { toast(e.message, 'err'); } } }, 'Xóa'));
        return fanCard(x, i, [statusNote(x), own]);
      }))));
    };
    loadMine();
  }
  try {
    const items = await api('/api/fanart');
    if (!items.length) return grid.replaceWith(state('🎨', 'Chưa có Fan Art', 'Hãy là người đầu tiên chia sẻ tác phẩm của bạn.', h('a', { class: 'btn', href: '/fanart/upload' }, 'Đăng Fan Art')));
    items.forEach((x, i) => { const n = fanCard(x, i); if (isAdmin) n.querySelector('.fmeta').append(del(x, n)); grid.append(n); });
  } catch (e) { grid.replaceWith(errState(e.message, () => location.reload())); }
}

/** Dang moi / sua (?edit=<id>) Fan Art. Danh tinh tac gia lay tu session Discord o backend - form khong co o nhap ten. */
async function pageFanartUpload() {
  const el = $('#app'), TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']; let chosen = null;
  const editId = new URLSearchParams(location.search).get('edit');
  let me; try { me = await getMe(); } catch { me = { loggedIn: false }; }
  if (!me.loggedIn) { el.append(state('🔒', 'Cần đăng nhập', 'Đăng nhập bằng Discord để đăng Fan Art.', h('a', { class: 'btn', href: '/auth/discord/login?next=' + encodeURIComponent(location.pathname + location.search) }, 'Đăng nhập Discord'))); return; }
  let cur = null;
  if (editId) {
    try { cur = (await api('/api/fanart/mine')).find((x) => x.id === editId); } catch { /* xu ly ben duoi */ }
    if (!cur) { el.append(state('🔎', 'Không tìm thấy Fan Art', 'Fan Art này không tồn tại hoặc không phải của bạn.', h('a', { class: 'btn', href: '/fanart' }, 'Về Fan Art'))); return; }
  }
  const file = h('input', { type: 'file', id: 'ff', class: 'sr', accept: TYPES.join(',') });
  const title = h('input', { id: 'ft', maxlength: 80, placeholder: 'Ví dụ: Chân dung dưới ánh trăng', value: cur ? cur.title : '' });
  const desc = h('textarea', { id: 'fd', rows: 4, maxlength: 500, placeholder: 'Mô tả ngắn (không bắt buộc)' }, cur ? cur.description : '');
  const agree = h('input', { type: 'checkbox', id: 'fok' }), msg = h('div', { class: 'err', role: 'alert' });
  const prev = h('img', { class: 'dprev', alt: 'Ảnh xem trước', hidden: !cur, src: cur && safeUrl(cur.image) ? cur.image : null, referrerpolicy: 'no-referrer' }), hintT = h('b', {}, cur ? 'Nhấn để đổi ảnh (không bắt buộc)' : 'Chọn ảnh hoặc kéo thả vào đây');
  const drop = h('label', { class: 'drop' + (cur ? ' has' : ''), for: 'ff' }, prev, h('span', { class: 'dhint' }, ico(I_UP), hintT, h('small', {}, 'PNG, JPG, WebP hoặc GIF · tối đa 15 MB')), file);
  const label = cur ? 'Lưu & gửi duyệt lại' : 'Đăng Fan Art';
  const btn = h('button', { class: 'btn lg', type: 'submit' }, ico(I_UP), label);
  // Cloudflare Turnstile: chi bat khi server da cau hinh (lop chong spam bo sung; da co dang nhap Discord + gioi han theo tai khoan)
  let cfToken = '', cfId = null, cfOn = false; const cfBox = h('div', { class: 'cf' });
  api('/api/config').then((cfg) => {
    if (!cfg.turnstileSiteKey) return; cfOn = true;
    const s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true;
    s.onload = () => { cfId = window.turnstile.render(cfBox, { sitekey: cfg.turnstileSiteKey, callback: (t) => { cfToken = t; }, 'expired-callback': () => { cfToken = ''; }, 'error-callback': () => { cfToken = ''; } }); };
    s.onerror = () => { msg.textContent = 'Không tải được Cloudflare captcha. Kiểm tra mạng / tắt trình chặn quảng cáo rồi tải lại trang.'; };
    document.head.append(s);
  }).catch(() => { /* khong co captcha */ });
  const resetCf = () => { cfToken = ''; try { if (cfId !== null) window.turnstile.reset(cfId); } catch { /* bo qua */ } };
  function pick(f) {
    msg.textContent = ''; if (!f) return;
    if (!TYPES.includes(f.type)) { msg.textContent = 'Định dạng không hỗ trợ. Hãy chọn PNG, JPG, WebP hoặc GIF.'; return; }
    if (f.size > 15e6) { msg.textContent = 'Ảnh quá lớn. Kích thước tối đa là 15 MB.'; return; }
    chosen = f; prev.src = URL.createObjectURL(f); prev.hidden = false; drop.classList.add('has'); hintT.textContent = 'Nhấn để đổi ảnh';
  }
  file.onchange = () => pick(file.files[0]);
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => pick(e.dataTransfer.files[0]));
  const form = h('form', { class: 'upf', novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); msg.textContent = '';
    if (!cur && !chosen) { msg.textContent = 'Hãy chọn một ảnh để đăng.'; return; }
    if (!agree.checked) { msg.textContent = 'Hãy xác nhận bạn có quyền đăng tác phẩm này.'; return; }
    if (cfOn && !cfToken) { msg.textContent = 'Vui lòng hoàn thành captcha.'; return; }
    btn.disabled = true; btn.lastChild.textContent = 'Đang gửi…';
    try {
      const body = { title: title.value, description: desc.value }; if (chosen) body.image = await toB64(chosen); if (cfOn) body.captcha = cfToken;
      await apiw(cur ? '/api/fanart/' + encodeURIComponent(cur.id) : '/api/fanart', cur ? 'PUT' : 'POST', body);
      toast('Đã gửi! Fan Art sẽ hiển thị sau khi admin duyệt.', 'ok'); setTimeout(() => { location.href = '/fanart'; }, 1500);
    } catch (er) { msg.textContent = er.message; btn.disabled = false; btn.lastChild.textContent = label; resetCf(); }
  } }, drop,
    h('div', { class: 'field' }, h('label', { for: 'ft' }, 'Tiêu đề (không bắt buộc)'), title),
    h('div', { class: 'field' }, h('label', { for: 'fd' }, 'Mô tả (không bắt buộc)'), desc),
    h('div', { class: 'field' }, h('label', {}, 'Tác giả'), h('div', {}, userLink({ id: me.user.id, username: me.user.username, avatarUrl: me.user.avatarUrl }, { cls: 'self' })), h('small', { class: 'muted' }, 'Lấy tự động từ tài khoản Discord của bạn.')),
    cfBox,
    h('label', { class: 'agree', for: 'fok' }, agree, 'Tôi là tác giả hoặc đã được phép đăng tác phẩm này.'), msg,
    h('div', { class: 'acts' }, btn, h('a', { class: 'btn ghost lg', href: '/fanart' }, 'Hủy')));
  el.append(h('section', { class: 'phd' }, h('div', {}, h('h1', {}, cur ? 'Sửa Fan Art' : 'Đăng Fan Art'), h('p', { class: 'lead' }, cur ? 'Sau khi sửa, Fan Art sẽ quay lại trạng thái chờ duyệt.' : 'Chia sẻ tác phẩm của bạn với cộng đồng VTuber. Đăng nhập bằng Discord, tên và avatar của bạn sẽ hiển thị cùng tác phẩm.')),
    cur && statusNote(cur)),
    h('div', { class: 'up' }, form, h('aside', { class: 'panel rules' }, h('h3', {}, 'Trước khi đăng'),
      h('ul', {}, h('li', {}, 'Chỉ đăng tranh do bạn vẽ hoặc được tác giả cho phép.'), h('li', {}, 'Không đăng nội dung phản cảm, bạo lực hoặc vi phạm bản quyền.'), h('li', {}, 'Ảnh sẽ được admin kiểm duyệt trước khi hiển thị công khai.'), h('li', {}, 'Ảnh lớn hơn 2000 px sẽ được tự động thu nhỏ.'), h('li', {}, 'Tối đa 5 lần đăng/sửa mỗi giờ và 10 ảnh đang chờ duyệt.')))));
}

/* CONTRIBUTE -> Discord webhook */
async function pageContribute() {
  const el = $('#app'), qs = new URLSearchParams(location.search);
  const KINDS = [['add', 'Thêm VTuber / Clipper mới'], ['edit', 'Chỉnh sửa thông tin'], ['remove', 'Báo sai / đề nghị gỡ'], ['other', 'Góp ý khác']];
  const fld = (id, label, ctl, hint) => h('div', { class: 'field', id: 'f-' + id }, h('label', { for: id }, label), ctl, hint && h('small', { class: 'muted' }, hint));
  const kind = h('select', { id: 'kind' }, KINDS.map(([v, t]) => h('option', { value: v }, t)));
  if (KINDS.some(([v]) => v === qs.get('type'))) kind.value = qs.get('type');
  const ttype = h('select', { id: 'ttype' }, h('option', { value: 'vtuber' }, 'VTuber'), h('option', { value: 'clipper' }, 'Clipper'));
  const target = h('select', { id: 'target' }, h('option', { value: '' }, 'Đang tải danh sách…'));
  const name = h('input', { id: 'name', maxlength: 80, placeholder: 'Tên VTuber / Clipper' });
  const channel = h('input', { id: 'channel', maxlength: 200, placeholder: 'https://youtube.com/@handle hoặc Channel ID (UC…)' });
  const content = h('textarea', { id: 'content', rows: 6, maxlength: 1500, placeholder: 'Mô tả nội dung cần thêm / sửa (ví dụ: đổi mô tả, thêm link Twitter, báo đã tốt nghiệp…)' });
  const count = h('small', { class: 'muted' }, '0/1500');
  content.oninput = () => { count.textContent = content.value.length + '/1500'; };
  const link = h('input', { id: 'link', type: 'url', maxlength: 300, placeholder: 'https://… (nguồn / bằng chứng, không bắt buộc)' });
  const sender = h('input', { id: 'sender', maxlength: 60, placeholder: 'Tên hoặc nickname (không bắt buộc)' });
  const contact = h('input', { id: 'contact', maxlength: 100, placeholder: 'Discord / email để admin phản hồi (không bắt buộc)' });
  const msg = h('div', { class: 'err', role: 'alert' });
  const btn = h('button', { class: 'btn lg', type: 'submit' }, 'Gửi đóng góp');
  const rows = { ttype: fld('ttype', 'Phân loại', ttype), name: fld('name', 'Tên', name), channel: fld('channel', 'Kênh YouTube', channel), target: fld('target', 'VTuber / Clipper cần chỉnh sửa', target) };
  const sync = () => { const k = kind.value; rows.ttype.hidden = rows.name.hidden = rows.channel.hidden = k !== 'add'; rows.target.hidden = !(k === 'edit' || k === 'remove'); };
  kind.onchange = sync; sync();

  // Turnstile (dung chung khoa voi Fan Art)
  let cfToken = '', cfId = null; const cfBox = h('div', { class: 'cf' });
  api('/api/config').then((cfg) => {
    if (!cfg.turnstileSiteKey || !cfg.contribute) { msg.textContent = 'Chức năng đóng góp chưa được bật (thiếu cấu hình captcha hoặc Discord webhook).'; btn.disabled = true; return; }
    const sc = document.createElement('script'); sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; sc.async = true;
    sc.onload = () => { cfId = window.turnstile.render(cfBox, { sitekey: cfg.turnstileSiteKey, callback: (t) => { cfToken = t; }, 'expired-callback': () => { cfToken = ''; }, 'error-callback': () => { cfToken = ''; } }); };
    sc.onerror = () => { msg.textContent = 'Không tải được Cloudflare captcha. Kiểm tra mạng / tắt trình chặn quảng cáo rồi tải lại trang.'; };
    document.head.append(sc);
  }).catch(() => { msg.textContent = 'Không tải được cấu hình captcha.'; });
  const resetCf = () => { cfToken = ''; try { if (cfId !== null) window.turnstile.reset(cfId); } catch { /* bo qua */ } };

  api('/api/vtubers', { ttl: 30000 }).then((l) => {
    const sorted = [...l].sort((a, b) => a.name.localeCompare(b.name));
    target.replaceChildren(h('option', { value: '' }, '— Chọn —'), ...sorted.map((v) => h('option', { value: v.slug }, v.name + ' (@' + v.slug + ')')));
    if (sorted.some((v) => v.slug === qs.get('vtuber'))) target.value = qs.get('vtuber');
  }).catch(() => target.replaceChildren(h('option', { value: '' }, 'Không tải được danh sách')));

  const form = h('form', { class: 'upf', novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); msg.textContent = '';
    if (!cfToken) { msg.textContent = 'Vui lòng hoàn thành captcha.'; return; }
    const tv = target.value ? (target.options[target.selectedIndex].text) : '';
    btn.disabled = true; btn.textContent = 'Đang gửi…';
    try {
      await api('/api/contribute', { method: 'POST', body: { kind: kind.value, targetType: ttype.value, target: tv, name: name.value, channel: channel.value, content: content.value, link: link.value, sender: sender.value, contact: contact.value, captcha: cfToken } });
      form.replaceWith(state('✅', 'Đã gửi đóng góp!', 'Cảm ơn bạn. Admin sẽ xem xét và cập nhật sớm nhất có thể.', h('a', { class: 'btn', href: '/' }, 'Về trang chủ')));
    } catch (er) {
      msg.textContent = er.message; btn.disabled = false; btn.textContent = 'Gửi đóng góp'; resetCf();
      if (er.field && $('#' + er.field)) $('#' + er.field).focus();
    }
  } }, fld('kind', 'Bạn muốn làm gì?', kind), rows.ttype, rows.name, rows.channel, rows.target,
    fld('content', 'Nội dung', content, count), fld('link', 'Liên kết tham khảo', link), fld('sender', 'Người gửi', sender), fld('contact', 'Liên hệ', contact),
    cfBox, msg, h('div', { class: 'acts' }, btn, h('a', { class: 'btn ghost lg', href: '/' }, 'Hủy')));
  el.append(h('section', { class: 'phd' }, h('div', {}, h('h1', {}, 'Đóng góp / Chỉnh sửa nội dung'), h('p', { class: 'lead' }, 'Thiếu VTuber, sai thông tin hay muốn góp ý? Gửi cho admin — không cần tài khoản.'))),
    h('div', { class: 'up' }, form, h('aside', { class: 'panel rules' }, h('h3', {}, 'Lưu ý'),
      h('ul', {}, h('li', {}, 'Đóng góp được gửi thẳng tới đội ngũ quản trị để xem xét thủ công.'), h('li', {}, 'Cung cấp liên kết nguồn nếu có để duyệt nhanh hơn.'), h('li', {}, 'Thông tin liên hệ chỉ dùng để phản hồi, không hiển thị công khai.'), h('li', {}, 'Mỗi địa chỉ IP gửi tối đa 5 đóng góp mỗi giờ.')))));
}

/* NEWS */
const newsCard = (x, i = 0) => h('article', { class: 'card ncard', style: `--i:${i}` },
  x.images && x.images[0] ? h('div', { class: 'th img', style: 'position:relative' }, img(x.images[0], x.title, 'th', x.title)) : h('div', { class: 'nnoimg' }, '📰'),
  h('h4', {}, h('a', { class: 'stretch', href: '/news/' + encodeURIComponent(x.id) }, x.title)),
  h('p', { class: 'nsum' }, x.content.length > 140 ? x.content.slice(0, 140).trim() + '…' : x.content),
  h('div', { class: 'meta' }, h('span', {}, fmtDate(x.createdAt)), x.images && x.images.length > 1 && h('span', {}, '🖼 ' + x.images.length)));
async function pageNews() {
  const el = $('#app');
  el.append(h('section', { class: 'phd' }, h('div', {}, h('h1', {}, 'Tin tức'), h('p', { class: 'lead' }, 'Thông báo và cập nhật mới nhất từ VTuber Hub.'))));
  const out = h('div', {}, skels(6, true)); el.append(out);
  async function load() {
    try { const l = await api('/api/news?limit=50'); out.replaceChildren(l.length ? h('div', { class: 'grid big' }, l.map((x, i) => newsCard(x, i))) : state('📰', 'Chưa có tin tức', 'Hãy quay lại sau nhé.')); }
    catch (e) { out.replaceChildren(errState(e.message, load)); }
  }
  await load();
}
async function pageNewsItem() {
  const el = $('#app'), id = decodeURIComponent(location.pathname.split('/')[2] || '');
  const nf = () => { document.title = 'Không tìm thấy - VTuber Hub'; el.replaceChildren(state('🔎', '404 - Không tìm thấy tin', 'Tin này không tồn tại hoặc đã bị ẩn.', h('a', { class: 'btn', href: '/news' }, 'Xem tất cả tin'))); };
  el.append(skels(1, true));
  async function load() {
    let n; try { n = await api('/api/news/' + encodeURIComponent(id)); } catch (e) { if (e.status === 404) return nf(); el.replaceChildren(errState(e.message, load)); return; }
    document.title = n.title + ' - VTuber Hub';
    el.replaceChildren(h('article', { class: 'article' }, h('a', { href: '/news', class: 'muted' }, '← Tất cả tin'), h('h1', {}, n.title),
      h('div', { class: 'muted' }, fmtDate(n.createdAt)), h('div', { class: 'abody' }, n.content),
      n.images.length > 0 && h('div', { class: 'agal' }, n.images.map((u) => h('a', { href: safeUrl(u) || '#', target: '_blank', rel: 'noopener noreferrer' }, img(u, n.title, 'nimg', n.title))))));
  }
  await load();
}

/** Popup dung chung (ESC / bam nen / nut dong de dong; tra focus ve nut mo). */
function openModal(title, body, foot) {
  const prev = document.activeElement;
  const close = () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('nomodal'); ov.remove(); if (prev && prev.focus) prev.focus(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const x = h('button', { class: 'mx', 'aria-label': 'Đóng', onclick: close }, '×');
  const ov = h('div', { class: 'mov', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, onclick: (e) => { if (e.target === ov) close(); } },
    h('div', { class: 'modal' }, h('div', { class: 'mh' }, h('h3', {}, title), x), h('div', { class: 'mb' }, body), foot && h('div', { class: 'mf' }, foot)));
  document.body.append(ov); document.body.classList.add('nomodal'); document.addEventListener('keydown', onKey); x.focus();
  return close;
}
/** Thong tin them tu ben thu ba (livecounts.io) - chi nhung khi nguoi dung chu dong bam. */
function openExtraInfo(v) {
  const id = v.channel.id, src = 'https://livecounts.io/youtube-live-subscriber-counter/' + encodeURIComponent(id);
  const frame = h('iframe', { class: 'mframe', src, title: 'Số liệu ' + v.name + ' (livecounts.io)', loading: 'lazy', referrerpolicy: 'no-referrer', sandbox: 'allow-scripts allow-same-origin allow-popups' });
  const body = h('div', {}, h('div', { class: 'tp' }, 'ℹ️ Số liệu bên dưới do ', h('a', { href: 'https://livecounts.io', target: '_blank', rel: 'noopener noreferrer' }, 'livecounts.io'),
    ' (bên thứ ba) cung cấp. VTuber Hub không kiểm soát, không đảm bảo độ chính xác hay nội dung của trang này.'), frame,
    h('p', { class: 'muted tpf' }, 'Nếu khung trống hoặc báo lỗi, trang nguồn có thể chặn hiển thị nhúng — hãy mở trực tiếp bằng nút bên dưới.'));
  openModal('Thông tin thêm · ' + v.name, body, [h('span', { class: 'muted' }, 'Nguồn: livecounts.io (bên thứ ba)'),
    h('a', { class: 'btn ghost', href: src, target: '_blank', rel: 'noopener noreferrer' }, 'Mở trong tab mới ↗')]);
}

/* PROFILE */
const SOCIAL = { twitter: 'X / Twitter', facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', twitch: 'Twitch', discord: 'Discord', website: 'Website' };
async function pageProfile() {
  const el = $('#app'); const slug = decodeURIComponent(location.pathname.split('/')[2] || '');
  el.append(skels(2));
  const notFound = () => { document.title = 'Không tìm thấy - VTuber Hub'; el.replaceChildren(state('🔎', '404 - Không tìm thấy VTuber', 'VTuber này không tồn tại hoặc đã bị ẩn.', h('a', { class: 'btn', href: '/vtubers' }, 'Xem danh sách'))); };
  async function load() {
    let v;
    try { v = await api('/api/vtubers/' + encodeURIComponent(slug)); }
    catch (e) { if (e.status === 404) return notFound(); el.replaceChildren(errState(e.message, load)); return; }
    document.title = v.name + ' - VTuber Hub';
    const links = [v.channel && h('a', { href: v.channel.url, target: '_blank', rel: 'noopener noreferrer' }, '▶ YouTube'),
      ...Object.entries(v.social || {}).filter(([k, u]) => SOCIAL[k] && safeUrl(u)).map(([k, u]) => h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, SOCIAL[k]))].filter(Boolean);
    const vidBox = h('div', {});
    el.replaceChildren(...[
      h('div', { class: 'pbanner' }),
      h('div', { class: 'phead' + (v.graduated ? ' grad' : '') }, img(v.avatar, v.name, 'av xl', v.name),
        h('div', { class: 'info' }, h('h1', {}, v.name, v.graduated && gradTag()), h('div', { class: 'muted' }, '@' + v.slug + ' ', h('a', { class: 'suggest', href: '/contribute?type=edit&vtuber=' + encodeURIComponent(v.slug) }, '✎ Đề xuất chỉnh sửa')), v.description && h('p', { class: 'pdesc' }, v.description), badge(v.status), links.length > 0 && h('div', { class: 'links' }, links),
          v.channel && h('div', { class: 'links' }, h('button', { class: 'btn ghost sm', type: 'button', onclick: () => openExtraInfo(v) }, '📊 Thông tin thêm')))),
      h('div', { class: 'chips' }, v.subscribers && h('div', { class: 'chip' }, 'Người đăng ký: ', h('b', {}, fmtSubs(v.subscribers).replace(' người đăng kí', ''))), h('div', { class: 'chip' }, 'Video đã tải: ', h('b', {}, v.videosKnown ? v.videoCount : 'chưa rõ')), h('div', { class: 'chip' }, 'Lịch live: ', h('b', {}, v.upcoming.length)),
        v.meta.updatedAt && h('div', { class: 'chip' }, 'Cập nhật ', h('b', {}, ago(v.meta.updatedAt)))),
      v.meta.stale && h('div', { class: 'notice' }, 'YouTube tạm thời không phản hồi — đang hiển thị dữ liệu đã lưu trước đó.'),
      v.live && h('div', { class: 'livebox' }, h('div', { class: 'th img', style: 'position:relative' }, img(v.live.thumbnail, v.live.title, 'th', v.live.title)),
        h('div', {}, badge('live'), h('h3', { style: 'margin-top:8px' }, v.live.title), h('p', { class: 'muted' }, 'Bắt đầu: ' + (v.live.startTime ? fmtDT(v.live.startTime) : 'chưa rõ') + ' · Người xem: ' + (v.live.viewerCount ?? 'chưa rõ')),
          h('a', { class: 'btn', href: v.live.url, target: '_blank', rel: 'noopener noreferrer' }, 'Xem live ↗'))),
      v.upcoming.length ? h('section', { class: 'blk' }, h('h2', {}, 'Lịch live sắp tới'), h('div', { class: 'grid big' }, v.upcoming.map((u, i) =>
        h('article', { class: 'card vid', style: `--i:${i}` }, h('div', { class: 'th img', style: 'position:relative' }, img(u.thumbnail, u.title, 'th', u.title)),
          h('h4', {}, h('a', { class: 'stretch', href: u.url, target: '_blank', rel: 'noopener noreferrer' }, u.title)), h('div', { class: 'meta' }, h('span', {}, '🕒 ' + fmtDT(u.scheduledStartTime))))))) : null,
      h('section', { class: 'blk' }, h('h2', {}, 'Video'), vidBox)].filter((n) => n != null && n !== false));
    const PAGE = 6; let shown = 0;
    const grid = h('div', { class: 'grid big' }); const more = h('button', { class: 'btn ghost', onclick: () => draw() }, 'Xem thêm');
    function draw() { v.videos.slice(shown, shown + PAGE).forEach((x, i) => grid.append(videoCard(x, i, v.name))); shown += PAGE; more.style.display = shown < v.videos.length ? '' : 'none'; }
    if (v.videos.length) { vidBox.append(grid, h('p', { class: 'center' }, more)); draw(); }
    else if (v.meta.noYoutube) vidBox.append(state('🔗', 'Chưa liên kết YouTube', 'VTuber này chưa có kênh YouTube.'));
    else if (v.meta.errors.videos) vidBox.append(errState('Không thể tải dữ liệu YouTube lúc này.', load));
    else vidBox.append(state('🎞️', 'Chưa có video', 'Kênh này chưa đăng video công khai nào.'));
  }
  await load();
}

/* ACCOUNT: thong tin tai khoan Discord (du lieu lay tu session o backend) */
async function pageAccount() {
  const root = $('#app'); root.replaceChildren(skels(1));
  let d;
  try { d = await api('/api/auth/account'); }
  catch (e) { if (e.status === 401) { location.href = '/auth/discord/login?next=/account'; return; } root.replaceChildren(errState(e.message, () => location.reload())); return; }
  const u = d.user, ROLE = { admin: 'Quản trị viên', user: 'Thành viên' };
  const row = (k, v) => h('div', { class: 'acct-row' }, h('dt', {}, k), h('dd', {}, v));
  const out = h('button', { class: 'btn ghost', onclick: async (ev) => {
    ev.target.disabled = true;
    try { await api('/api/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': d.csrfToken } }); location.href = '/'; }
    catch (er) { toast(er.message, 'err'); ev.target.disabled = false; }
  } }, 'Đăng xuất');
  root.replaceChildren(h('div', { class: 'panel wide' },
    h('div', { class: 'acct-head' }, img(u.avatarUrl, u.username, 'av xl', u.username),
      h('div', {}, h('h1', { style: 'margin:0' }, u.username), h('span', { class: 'badge ' + (u.role === 'admin' ? 'approved' : 'offline') }, ROLE[u.role] || u.role))),
    h('dl', { class: 'acct' }, row('Tên Discord', u.username), row('Discord ID', h('code', {}, u.id)), row('Vai trò', ROLE[u.role] || u.role),
      row('Tham gia lần đầu', fmtDT(u.createdAt)), row('Cập nhật gần nhất', fmtDT(u.updatedAt)),
      row('Đồng ý TOS & Luật cộng đồng', u.termsVersion ? fmtDT(u.tosAcceptedAt) + ' (phiên bản ' + u.termsVersion + ')' : 'Chưa xác nhận')),
    h('p', { class: 'muted' }, 'Thông tin lấy từ Discord (scope identify) mỗi lần đăng nhập. Máy chủ không lưu email hay token Discord.'),
    h('div', { class: 'acts' }, h('a', { class: 'btn', href: '/users/' + encodeURIComponent(u.id) }, 'Xem hồ sơ công khai'), u.role === 'admin' && h('a', { class: 'btn', href: '/admin' }, 'Trang quản trị'), h('a', { class: 'btn ghost', href: '/tos' }, 'TOS'), h('a', { class: 'btn ghost', href: '/community-rules' }, 'Luật cộng đồng'), h('a', { class: 'btn ghost', href: '/' }, '← Trang chủ'), out)));
}

document.addEventListener('DOMContentLoaded', () => {
  if (!document.body.dataset.page) return; // trang admin tu quan ly
  chrome();
  const pg = { home: pageHome, list: pageList, profile: pageProfile, fanart: pageFanart, upload: pageFanartUpload, contribute: pageContribute, news: pageNews, newsitem: pageNewsItem, account: pageAccount }[document.body.dataset.page];
  if (pg) pg().catch((e) => { console.error(e); $('#app').replaceChildren(errState('Đã xảy ra lỗi không mong muốn.', () => location.reload())); });
});
