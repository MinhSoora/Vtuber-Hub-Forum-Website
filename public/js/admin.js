/* Admin UI. Khong chua credential/secret; moi thao tac di qua /api/admin/* (kiem tra session o backend). */
const slugify = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
let app = $('#app');   // sau khi dung khung Admin (shell), app tro vao vung noi dung

function confirmModal(text, okLabel) {
  return new Promise((res) => {
    const close = (v) => { bg.remove(); res(v); };
    const bg = h('div', { class: 'modal-bg', onclick: (e) => e.target === bg && close(false) },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, h('h3', {}, 'Xác nhận'), h('p', {}, text),
        h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: () => close(false) }, 'Hủy'), h('button', { class: 'btn danger', onclick: () => close(true) }, okLabel || 'Xóa'))));
    document.body.append(bg);
  });
}
/** Hoi ly do tu choi (bat buoc, <=300 ky tu); tra ve chuoi hoac null neu huy. Ly do hien cho tac gia. */
function reasonModal(title) {
  return new Promise((res) => {
    const t = h('textarea', { rows: 3, maxlength: 300, placeholder: 'Lý do từ chối (bắt buộc, tác giả sẽ nhìn thấy)', 'aria-label': 'Lý do từ chối' }), err = h('div', { class: 'err', role: 'alert' });
    const close = (v) => { bg.remove(); res(v); };
    const bg = h('div', { class: 'modal-bg', onclick: (e) => e.target === bg && close(null) },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, h('h3', {}, title || 'Từ chối'), t, err,
        h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: () => close(null) }, 'Hủy'),
          h('button', { class: 'btn danger', onclick: () => { if (!t.value.trim()) { err.textContent = 'Cần nhập lý do từ chối'; return; } close(t.value.trim()); } }, 'Từ chối'))));
    document.body.append(bg); t.focus();
  });
}
const topbar = (title, ...extra) => h('div', { class: 'blk-h' }, h('h1', {}, title), h('div', { class: 'acts' }, ...extra));
/* ========== KHUNG ADMIN: Sidebar + Navbar (dung chung moi trang tru login) ========== */
const doLogout = async () => { await api('/api/admin/logout', { method: 'POST' }).catch(() => {}); location.href = '/admin/login'; };
const NAV = [
  { href: '/admin', label: 'Dashboard', icon: '▦', exact: true },
  { href: '/admin/users', label: 'Users', icon: '👥' },
  { group: 'Moderation', items: [{ href: '/admin/moderation/ban', label: 'Ban', icon: '⛔' }, { href: '/admin/moderation/kick', label: 'Kick', icon: '🚪' }, { href: '/admin/moderation/warn', label: 'Warn', icon: '⚠️' }] },
  { href: '/admin/forum', label: 'Forum', icon: '💬', badge: 'posts' },
  { href: '/admin/fanart', label: 'Fan Art', icon: '🎨', badge: 'fanart' },
  { href: '/admin/popups', label: 'Popup Announcements', icon: '🔔' },
  { href: '/admin/marquee', label: 'Marquee Announcements', icon: '📢' },
  { group: 'Nội dung', items: [{ href: '/admin/vtubers', label: 'VTuber & Clipper', icon: '🌸' }, { href: '/admin/news', label: 'Tin tức', icon: '📰' }] },
];
function adminShell() {
  const p = location.pathname.replace(/\/+$/, '') || '/admin';
  const on = (it) => (it.exact ? p === it.href : p === it.href || p.startsWith(it.href + '/'));
  const badges = {};
  const mkBadge = (k) => (badges[k] = h('span', { class: 'pbadge', hidden: true }));
  const link = (it) => h('a', { href: it.href, class: 'alink' + (on(it) ? ' on' : ''), 'aria-current': on(it) ? 'page' : null }, h('span', { class: 'ai', 'aria-hidden': 'true' }, it.icon), h('span', { class: 'at' }, it.label), it.badge && mkBadge(it.badge));
  const side = h('aside', { class: 'asb', id: 'asb', 'aria-label': 'Menu quản trị' },
    h('a', { href: '/admin', class: 'brand asb-brand' }, h('span', { class: 'logo' }, 'V'), 'Admin'),
    h('nav', {}, NAV.map((it) => (it.group ? h('div', { class: 'agrp' }, h('div', { class: 'agl' }, it.group), it.items.map(link)) : link(it)))));
  const root = h('div', { class: 'adm' });
  const setOpen = (v) => { root.classList.toggle('open', v); toggle.setAttribute('aria-expanded', String(v)); };
  const toggle = h('button', { class: 'atoggle', 'aria-label': 'Mở/đóng menu', 'aria-controls': 'asb', 'aria-expanded': 'false', onclick: () => setOpen(!root.classList.contains('open')) }, '☰');
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
  side.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  const who = h('span', { class: 'awho' });
  const bell = h('a', { href: '/admin/forum', class: 'abtn', title: 'Thông báo: bài chờ duyệt', 'aria-label': 'Thông báo' }, '🔔', (badges.bell = h('span', { class: 'pbadge', hidden: true })));
  const nav = h('header', { class: 'anb' }, toggle, h('span', { class: 'anb-t' }, 'Quản trị VTuber Hub'), h('div', { class: 'anb-r' }, bell, who,
    h('a', { class: 'btn ghost sm', href: '/' }, '← Website'), h('button', { class: 'btn ghost sm', onclick: doLogout }, 'Đăng xuất')));
  const content = h('div', { class: 'acont' });
  root.append(side, h('div', { class: 'abd', onclick: () => setOpen(false) }), h('div', { class: 'amain' }, nav, content));
  app.classList.add('adm-main'); app.append(root); app = content;
  const setB = (el, n) => { if (el && n > 0) { el.hidden = false; el.textContent = n > 99 ? '99+' : n; } };
  api('/api/admin/me').then((m) => { const a = m.admin; if (a) who.replaceChildren(img(a.avatarUrl, a.username, 'av sm', a.username), h('span', { class: 'un' }, a.username)); }).catch(() => {});
  api('/api/admin/forum/summary').then((c) => { setB(badges.posts, c.posts); setB(badges.fanart, c.fanart); setB(badges.bell, c.posts + c.fanart); }).catch(() => {});
}
const timeState = (x) => { const now = Date.now(); return !x.enabled ? ['pending', 'Đã tắt'] : x.startsAt && Date.parse(x.startsAt) > now ? ['pending', 'Chưa bắt đầu'] : x.endsAt && Date.parse(x.endsAt) <= now ? ['rejected', 'Hết hạn'] : ['approved', 'Đang hiển thị']; };
const window_ = (x) => (x.startsAt || x.endsAt ? (x.startsAt ? fmtDT(x.startsAt) : '…') + ' → ' + (x.endsAt ? fmtDT(x.endsAt) : 'không giới hạn') : 'Luôn hiển thị');
const toLocalInput = (iso) => { const d = new Date(iso); if (!iso || isNaN(d)) return ''; d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
const narrow = (w) => { const m = [...document.querySelectorAll('.mov .modal')].pop(); if (m) m.style.width = `min(${w}px,100%)`; };

/* LOGIN */
async function adminLogin() {
  let discordOn = false;
  try { const me = await api('/api/admin/me'); if (me.loggedIn) return (location.href = '/admin'); discordOn = !!me.discordEnabled; } catch { /* chua dang nhap */ }
  const u = h('input', { id: 'u', autocomplete: 'username', required: true }), p = h('input', { id: 'p', type: 'password', autocomplete: 'current-password', required: true });
  const msg = h('div', { class: 'err', role: 'alert' }), btn = h('button', { class: 'btn', style: 'width:100%' }, 'Đăng nhập');
  app.append(h('div', { class: 'panel narrow' }, h('h1', {}, 'Admin'), h('p', { class: 'muted' }, 'Đăng nhập để quản lý VTuber.'),
    h('form', { onsubmit: async (e) => {
      e.preventDefault(); msg.textContent = ''; btn.disabled = true;
      try { await api('/api/admin/login', { method: 'POST', body: { username: u.value, password: p.value } });
        const me = await api('/api/admin/me');  // xac nhan cookie session that su duoc trinh duyet giu lai
        if (!me.loggedIn) throw new Error('Trình duyệt không lưu cookie phiên. Kiểm tra chặn cookie / truy cập bằng http://localhost đúng cổng.');
        location.href = '/admin';
      } catch (er) { msg.textContent = er.message; btn.disabled = false; }
    } }, h('div', { class: 'field' }, h('label', { for: 'u' }, 'Tài khoản'), u), h('div', { class: 'field' }, h('label', { for: 'p' }, 'Mật khẩu'), p), msg, btn),
    discordOn && h('a', { class: 'btn ghost', style: 'width:100%;margin-top:12px;justify-content:center', href: '/auth/discord/login?next=/admin' }, 'Đăng nhập bằng Discord'),
    discordOn && h('p', { class: 'muted center', style: 'font-size:.8125rem' }, 'Đăng nhập Discord cần đồng ý ', h('a', { href: '/tos', target: '_blank', rel: 'noopener noreferrer' }, 'Terms of Service'), ' và ', h('a', { href: '/community-rules', target: '_blank', rel: 'noopener noreferrer' }, 'Community Rules'), '.'),
    h('p', { class: 'center' }, h('a', { href: '/' }, '← Về trang chủ'))));
  u.focus();
}

/* VTUBER & CLIPPER (danh sach) */
async function adminVtubers() {
  const body = h('div', {}, skels(2));
  app.append(topbar('Quản lý VTuber', h('a', { class: 'btn sm', href: '/admin/vtubers/add' }, '+ Thêm VTuber'), h('a', { class: 'btn ghost sm', href: '/', target: '_blank' }, 'Trang public')), body);
  async function load() {
    let list;
    try { list = await api('/api/admin/vtubers'); } catch (e) { body.replaceChildren(errState(e.message, load)); return; }
    if (!list.length) { body.replaceChildren(state('🌸', 'Chưa có VTuber', 'Bấm "+ Thêm VTuber" để bắt đầu.')); return; }
    const act = (fn, ok) => async () => { try { await fn(); if (ok) toast(ok, 'ok'); await load(); } catch (e) { toast(e.message, 'err'); } };
    body.replaceChildren(h('div', { class: 'panel tw' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, ['', 'Tên / slug', 'Channel ID', 'Trạng thái', 'Bật', 'Thao tác'].map((t) => h('th', {}, t)))),
      h('tbody', {}, list.map((v) => h('tr', {},
        h('td', {}, img(v.avatarUrl, v.name, 'av', v.name)),
        h('td', {}, h('b', {}, v.name), v.graduated && gradTag(), h('div', { class: 'muted' }, '@' + v.slug)),
        h('td', {}, v.youtubeChannelId ? h('a', { href: v.channelUrl, target: '_blank', rel: 'noopener noreferrer' }, v.youtubeChannelId) : h('span', { class: 'muted' }, 'không có')),
        h('td', {}, badge(v.status), v.pending && h('div', { class: 'muted' }, 'đang tải…')),
        h('td', {}, v.enabled ? 'Bật' : 'Tắt'),
        h('td', {}, h('div', { class: 'acts' },
          v.enabled && h('a', { class: 'btn ghost sm', href: '/vtuber/' + encodeURIComponent(v.slug), target: '_blank' }, 'Xem'),
          h('a', { class: 'btn ghost sm', href: '/admin/vtubers/' + encodeURIComponent(v.id) + '/edit' }, 'Sửa'),
          h('button', { class: 'btn ghost sm', onclick: act(() => api('/api/admin/vtubers/' + v.id + '/toggle', { method: 'POST' }), v.enabled ? 'Đã tắt' : 'Đã bật') }, v.enabled ? 'Tắt' : 'Bật'),
          v.youtubeChannelId && v.enabled && h('button', { class: 'btn ghost sm', onclick: act(() => api('/api/admin/vtubers/' + v.id + '/refresh', { method: 'POST' }), 'Đã làm mới dữ liệu YouTube') }, 'Làm mới'),
          h('button', { class: 'btn danger sm', onclick: async () => { if (await confirmModal(`Xóa VTuber "${v.name}"? Hành động này không thể hoàn tác.`)) act(() => api('/api/admin/vtubers/' + v.id, { method: 'DELETE' }), 'Đã xóa')(); } }, 'Xóa')))))))));
  }
  await load();
}

/* ADD / EDIT */
async function adminForm() {
  const parts = location.pathname.split('/'); const editId = parts[3] === 'add' ? null : decodeURIComponent(parts[3]);
  let cur = {};
  if (editId) { try { cur = await api('/api/admin/vtubers/' + encodeURIComponent(editId)); } catch (e) { app.append(errState(e.message)); return; } }
  const F = {}; const errs = {};
  const field = (key, label, el, hint) => { F[key] = el; const e = h('div', { class: 'err' }); errs[key] = e; return h('div', { class: 'field', 'data-k': key }, h('label', {}, label), el, hint && h('div', { class: 'muted', style: 'font-size:.8rem' }, hint), e); };
  const inp = (v, ph, type) => h('input', { value: v || '', placeholder: ph || '', type: type || 'text' });
  const prevAv = h('div', { class: 'prev' });
  const ytHint = cur.youtubeChannelId ? 'Hiện tại: ' + cur.youtubeChannelId + ' (để trống = gỡ liên kết YouTube)' : 'Channel ID (UC…), URL kênh hoặc @handle. Server tự kiểm tra và lấy avatar/video.';
  const name = inp(cur.name, 'Tên hiển thị'), slug = inp(cur.slug || cur.id, 'tu-dong-tao-tu-ten'), yt = inp(cur.youtubeChannelId, 'UCxxxx… | https://youtube.com/@ten | @ten');
  const av = inp(cur.avatar, 'https://… (để trống = dùng avatar YouTube)', 'url'), desc = h('textarea', { rows: 4, maxlength: 500 }, cur.description || '');
  const typ = h('select', {}, [['vtuber', 'VTuber'], ['clipper', 'Clipper']].map(([v, t]) => h('option', { value: v, selected: (cur.type || 'vtuber') === v }, t)));
  const en = h('input', { type: 'checkbox' }); en.checked = cur.enabled !== false;
  const grad = h('input', { type: 'checkbox' }); grad.checked = cur.graduated === true;
  let slugTouched = !!editId; slug.oninput = () => { slugTouched = true; };
  name.oninput = () => { if (!slugTouched) slug.value = slugify(name.value); };
  const drawAv = () => prevAv.replaceChildren(img(av.value, 'preview', 'av', name.value), h('span', { class: 'muted' }, av.value ? 'Xem trước avatar' : 'Không nhập → dùng avatar kênh YouTube'));
  av.onchange = drawAv; drawAv();
  const soc = {}; const socRow = h('div', { class: 'row2' });
  for (const [k, l] of Object.entries(SOCIAL)) { soc[k] = inp((cur.social || {})[k], 'https://…', 'url'); socRow.append(field('social.' + k, l, soc[k])); }
  const btn = h('button', { class: 'btn' }, editId ? 'Lưu thay đổi' : 'Thêm VTuber');
  const clear = () => { Object.values(errs).forEach((e) => { e.textContent = ''; e.parentNode.classList.remove('bad'); }); };
  const showErr = (k, m) => { const e = errs[k]; if (e) { e.textContent = m; e.parentNode.classList.add('bad'); e.parentNode.scrollIntoView({ block: 'center', behavior: 'smooth' }); } };
  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); clear();
    if (!name.value.trim()) return showErr('name', 'Tên không được để trống');
    const body = { name: name.value, type: typ.value, slug: slug.value.trim() || undefined, youtube: yt.value.trim(), avatar: av.value.trim(), description: desc.value,
      social: Object.fromEntries(Object.entries(soc).map(([k, i]) => [k, i.value.trim()])), graduated: grad.checked, enabled: en.checked };
    if (!editId && !body.youtube) delete body.youtube;
    btn.disabled = true; btn.textContent = yt.value.trim() ? 'Đang kiểm tra kênh…' : 'Đang lưu…';
    try {
      await api(editId ? '/api/admin/vtubers/' + encodeURIComponent(cur.id) : '/api/admin/vtubers', { method: editId ? 'PUT' : 'POST', body });
      toast(editId ? 'Đã lưu' : 'Đã thêm VTuber', 'ok'); setTimeout(() => { location.href = '/admin/vtubers'; }, 500);
    } catch (er) { toast(er.message, 'err'); if (er.field) showErr(er.field, er.message); btn.disabled = false; btn.textContent = editId ? 'Lưu thay đổi' : 'Thêm VTuber'; }
  } },
    field('name', 'Tên *', name), field('type', 'Loại', typ), field('slug', 'Slug (URL: /vtuber/<slug>)', slug), field('youtube', 'Kênh YouTube', yt, ytHint),
    field('avatar', 'Avatar URL', av), prevAv, field('description', 'Mô tả (≤ 500 ký tự)', desc),
    h('h3', {}, 'Social links'), socRow,
    h('div', { class: 'field' }, h('label', {}, grad, ' 🎓 Đã tốt nghiệp (hiển thị tag "Tốt nghiệp" và màu nhạt hơn)')),
    h('div', { class: 'field' }, h('label', {}, en, ' Hiển thị công khai & tự động cập nhật dữ liệu')),
    h('div', { class: 'acts' }, btn, h('a', { class: 'btn ghost', href: '/admin/vtubers' }, 'Hủy')));
  app.append(topbar(editId ? 'Sửa VTuber' : 'Thêm VTuber'), h('div', { class: 'panel wide' }, form));
  name.focus();
}

/* FAN ART: kiem duyet */
async function adminFanart() {
  const LABEL = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' };
  let tab = 'pending', all = [];
  const body = h('div', {}, skels(2)), tabs = h('div', { class: 'tabs' });
  app.append(topbar('Quản lý Fan Art', h('a', { class: 'btn ghost sm', href: '/fanart', target: '_blank' }, 'Trang public')), tabs, body);
  const set = (x, status, okMsg) => async () => {
    let reason; if (status === 'rejected') { reason = await reasonModal('Từ chối Fan Art'); if (reason === null) return; }
    try { await api('/api/admin/fanart/' + x.id + '/status', { method: 'POST', body: { status, reason } }); toast(okMsg, 'ok'); await load(); } catch (e) { toast(e.message, 'err'); }
  };
  function draw() {
    const cnt = (s) => all.filter((x) => x.status === s).length;
    tabs.replaceChildren(...['pending', 'approved', 'rejected', 'all'].map((k) => h('button', { class: 'tab' + (tab === k ? ' on' : ''), onclick: () => { tab = k; draw(); } }, (k === 'all' ? 'Tất cả' : LABEL[k]) + ` (${k === 'all' ? all.length : cnt(k)})`)));
    const rows = tab === 'all' ? all : all.filter((x) => x.status === tab);
    if (!rows.length) { body.replaceChildren(state('🎨', 'Không có ảnh', tab === 'pending' ? 'Không có ảnh nào đang chờ duyệt.' : 'Danh sách này đang trống.')); return; }
    body.replaceChildren(h('div', { class: 'panel tw' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, ['Ảnh', 'Tiêu đề / tác giả', 'Ngày đăng', 'Trạng thái', 'Thao tác'].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.map((x) => h('tr', {},
        h('td', { class: 'athumb' }, h('a', { href: safeUrl(x.url) || '#', target: '_blank', rel: 'noopener noreferrer' }, img(x.thumb || x.url, x.title, 'fath', x.title))),
        h('td', {}, h('b', {}, x.title || 'Không tên'), h('div', {}, userLink(x.author)), x.description && h('div', { class: 'muted' }, x.description)),
        h('td', {}, fmtDT(x.createdAt)),
        h('td', {}, h('span', { class: 'badge ' + x.status }, LABEL[x.status]), x.status === 'rejected' && x.rejectReason && h('div', { class: 'muted' }, 'Lý do: ' + x.rejectReason)),
        h('td', {}, h('div', { class: 'acts' },
          x.status !== 'approved' && h('button', { class: 'btn sm', onclick: set(x, 'approved', 'Đã duyệt ảnh') }, 'Duyệt'),
          x.status !== 'rejected' && h('button', { class: 'btn ghost sm', onclick: set(x, 'rejected', 'Đã từ chối ảnh') }, 'Từ chối'),
          x.status === 'approved' && h('button', { class: 'btn ghost sm', onclick: set(x, 'pending', 'Đã gỡ khỏi trang public') }, 'Gỡ'),
          h('button', { class: 'btn danger sm', onclick: async () => { if (await confirmModal('Xóa vĩnh viễn ảnh này?')) { try { await api('/api/admin/fanart/' + x.id, { method: 'DELETE' }); toast('Đã xóa', 'ok'); await load(); } catch (e) { toast(e.message, 'err'); } } } }, 'Xóa')))))))));
  }
  async function load() { try { all = await api('/api/admin/fanart'); draw(); } catch (e) { body.replaceChildren(errState(e.message, load)); } }
  await load();
}

/* FORUM: kiem duyet Bai viet + Fan Art (tab Pending / Approved / Rejected). Quyen Admin duoc backend kiem tra o moi API. */
async function adminForum() {
  const LABEL = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' };
  let kind = 'posts', tab = 'pending', data = { posts: [], fanart: [] };
  const body = h('div', {}, skels(2)), kinds = h('div', { class: 'tabs' }), tabs = h('div', { class: 'tabs' });
  app.append(topbar('Quản lý Forum & Fan Art', h('a', { class: 'btn ghost sm', href: '/forum', target: '_blank' }, 'Forum'), h('a', { class: 'btn ghost sm', href: '/fanart', target: '_blank' }, 'Fan Art')), kinds, tabs, body);
  const url = (x) => (kind === 'posts' ? '/api/admin/forum/posts/' : '/api/admin/fanart/') + x.id;
  const run = async (fn, okMsg) => { try { await fn(); toast(okMsg, 'ok'); await load(); } catch (e) { toast(e.message, 'err'); } };
  const approve = (x) => run(() => api(url(x) + '/status', { method: 'POST', body: { status: 'approved' } }), 'Đã duyệt');
  const unpublish = (x) => run(() => api(url(x) + '/status', { method: 'POST', body: { status: 'pending' } }), 'Đã đưa về chờ duyệt');
  const reject = async (x) => { const reason = await reasonModal(kind === 'posts' ? 'Từ chối bài viết' : 'Từ chối Fan Art'); if (reason === null) return; run(() => api(url(x) + '/status', { method: 'POST', body: { status: 'rejected', reason } }), 'Đã từ chối'); };
  const remove = async (x) => { if (await confirmModal(kind === 'posts' ? 'Xóa vĩnh viễn bài viết này (kèm bình luận)?' : 'Xóa vĩnh viễn Fan Art này?')) run(() => api(url(x), { method: 'DELETE' }), 'Đã xóa'); };
  const acts = (x) => h('div', { class: 'acts' },
    x.status !== 'approved' && h('button', { class: 'btn sm', onclick: () => approve(x) }, 'Duyệt'),
    x.status !== 'rejected' && h('button', { class: 'btn ghost sm', onclick: () => reject(x) }, 'Từ chối'),
    x.status === 'approved' && h('button', { class: 'btn ghost sm', onclick: () => unpublish(x) }, 'Gỡ'),
    kind === 'posts' && x.commentCount > 0 && h('button', { class: 'btn ghost sm', onclick: () => commentsModal(x) }, `Bình luận (${x.commentCount})`),
    h('button', { class: 'btn danger sm', onclick: () => remove(x) }, 'Xóa'));
  function commentsModal(x) {
    const box = h('div', {}, skels(1));
    openModal('Bình luận của bài', box);
    const draw = async () => {
      let l; try { l = await api('/api/admin/forum/posts/' + x.id + '/comments'); } catch (e) { box.replaceChildren(errState(e.message)); return; }
      box.replaceChildren(...(l.length ? l.map((c) => h('div', { class: 'cmt' }, h('div', { class: 'chd' }, userLink(c.author), h('span', { class: 'muted' }, fmtDT(c.createdAt))), h('div', { class: 'cbody' }, c.content),
        h('div', { class: 'acts' }, h('button', { class: 'btn danger sm', onclick: async () => { if (!(await confirmModal('Xóa bình luận này?'))) return; try { await api('/api/admin/forum/comments/' + c.id, { method: 'DELETE' }); toast('Đã xóa bình luận', 'ok'); x.commentCount--; await draw(); load(); } catch (e) { toast(e.message, 'err'); } } }, 'Xóa')))) : [h('p', { class: 'muted' }, 'Không còn bình luận.')]));
    };
    draw();
  }
  const status = (x) => [h('span', { class: 'badge ' + x.status }, LABEL[x.status]), x.status === 'rejected' && x.rejectReason && h('div', { class: 'muted' }, 'Lý do: ' + x.rejectReason)];
  function draw() {
    const rowsAll = data[kind], cnt = (s) => rowsAll.filter((x) => x.status === s).length;
    kinds.replaceChildren(...[['posts', 'Bài viết'], ['fanart', 'Fan Art']].map(([k, t]) => h('button', { class: 'tab' + (kind === k ? ' on' : ''), onclick: () => { kind = k; draw(); } }, `${t} (${data[k].filter((x) => x.status === 'pending').length} chờ)`)));
    tabs.replaceChildren(...['pending', 'approved', 'rejected'].map((k) => h('button', { class: 'tab' + (tab === k ? ' on' : ''), onclick: () => { tab = k; draw(); } }, `${LABEL[k]} (${cnt(k)})`)));
    const rows = rowsAll.filter((x) => x.status === tab);
    if (!rows.length) { body.replaceChildren(state(kind === 'posts' ? '💬' : '🎨', 'Không có mục nào', tab === 'pending' ? 'Không có mục nào đang chờ duyệt.' : 'Danh sách này đang trống.')); return; }
    const head = (cols) => h('thead', {}, h('tr', {}, cols.map((t) => h('th', {}, t))));
    body.replaceChildren(h('div', { class: 'panel tw' }, kind === 'posts'
      ? h('table', { class: 'tbl' }, head(['Tác giả', 'Nội dung', 'Ngày đăng', 'Trạng thái', 'Thao tác']), h('tbody', {}, rows.map((x) => h('tr', {},
        h('td', {}, userLink(x.author), h('div', { class: 'muted' }, 'ID ' + x.author.id)),
        h('td', { class: 'pcell' }, x.content && h('div', { class: 'pbody' }, x.content.length > 300 ? x.content.slice(0, 300) + '…' : x.content), x.images.length > 0 && h('div', { class: 'aimgs' }, x.images.map((u) => h('a', { class: 'aimg', href: safeUrl(u) || '#', target: '_blank', rel: 'noopener noreferrer' }, img(u, '', 'th', '')))),
          h('div', { class: 'muted' }, `👍 ${x.reactions.total} · 💬 ${x.commentCount}`)),
        h('td', {}, fmtDT(x.createdAt), x.updatedAt !== x.createdAt && h('div', { class: 'muted' }, 'Sửa: ' + fmtDT(x.updatedAt))),
        h('td', {}, status(x)), h('td', {}, acts(x))))))
      : h('table', { class: 'tbl' }, head(['Ảnh', 'Tiêu đề / tác giả', 'Ngày đăng', 'Trạng thái', 'Thao tác']), h('tbody', {}, rows.map((x) => h('tr', {},
        h('td', { class: 'athumb' }, h('a', { href: safeUrl(x.image) || '#', target: '_blank', rel: 'noopener noreferrer' }, img(x.thumb || x.image, x.title, 'fath', x.title))),
        h('td', {}, h('b', {}, x.title || 'Không tên'), h('div', {}, userLink(x.author)), x.description && h('div', { class: 'muted' }, x.description)),
        h('td', {}, fmtDT(x.createdAt)), h('td', {}, status(x)), h('td', {}, acts(x))))))));
  }
  async function load() {
    try { const [posts, fanart] = await Promise.all([api('/api/admin/forum/posts'), api('/api/admin/fanart')]); data = { posts, fanart }; draw(); }
    catch (e) { body.replaceChildren(errState(e.message, load)); }
  }
  await load();
}

/* TIN TUC */
async function adminNews() {
  const body = h('div', {}, skels(2));
  app.append(topbar('Quản lý Tin tức', h('a', { class: 'btn sm', href: '/admin/news/add' }, '+ Đăng tin'), h('a', { class: 'btn ghost sm', href: '/news', target: '_blank' }, 'Trang public')), body);
  async function load() {
    let list; try { list = await api('/api/admin/news'); } catch (e) { body.replaceChildren(errState(e.message, load)); return; }
    if (!list.length) { body.replaceChildren(state('📰', 'Chưa có tin tức', 'Bấm "+ Đăng tin" để tạo bài đầu tiên.')); return; }
    const act = (fn, okMsg) => async () => { try { await fn(); toast(okMsg, 'ok'); await load(); } catch (e) { toast(e.message, 'err'); } };
    body.replaceChildren(h('div', { class: 'panel tw' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, ['Ảnh', 'Tiêu đề', 'Ngày đăng', 'Hiển thị', 'Thao tác'].map((t) => h('th', {}, t)))),
      h('tbody', {}, list.map((n) => h('tr', {},
        h('td', { class: 'athumb' }, n.images[0] ? img(n.images[0], n.title, 'fath', n.title) : h('span', { class: 'muted' }, '—')),
        h('td', {}, h('b', {}, n.title), h('div', { class: 'muted' }, n.images.length + ' ảnh')),
        h('td', {}, fmtDT(n.createdAt)),
        h('td', {}, h('span', { class: 'badge ' + (n.published ? 'approved' : 'pending') }, n.published ? 'Đang hiển thị' : 'Đã ẩn')),
        h('td', {}, h('div', { class: 'acts' },
          n.published && h('a', { class: 'btn ghost sm', href: '/news/' + n.id, target: '_blank' }, 'Xem'),
          h('a', { class: 'btn ghost sm', href: '/admin/news/' + n.id + '/edit' }, 'Sửa'),
          h('button', { class: 'btn ghost sm', onclick: act(() => api('/api/admin/news/' + n.id, { method: 'PUT', body: { published: !n.published } }), n.published ? 'Đã ẩn bài' : 'Đã hiển thị bài') }, n.published ? 'Ẩn' : 'Hiện'),
          h('button', { class: 'btn danger sm', onclick: async () => { if (await confirmModal(`Xóa tin "${n.title}"?`)) act(() => api('/api/admin/news/' + n.id, { method: 'DELETE' }), 'Đã xóa')(); } }, 'Xóa')))))))));
  }
  await load();
}

async function adminNewsForm() {
  const parts = location.pathname.split('/'); const editId = parts[3] === 'add' ? null : decodeURIComponent(parts[3]);
  let cur = { images: [], published: true };
  if (editId) { try { cur = await api('/api/admin/news/' + encodeURIComponent(editId)); } catch (e) { app.append(errState(e.message)); return; } }
  const MAX = 4, TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  let keep = [...cur.images], fresh = []; // fresh = [{ file, url }]
  const title = h('input', { value: cur.title || '', maxlength: 150, placeholder: 'Tiêu đề tin' }), content = h('textarea', { rows: 10, maxlength: 8000, placeholder: 'Nội dung…' }, cur.content || '');
  const pub = h('input', { type: 'checkbox' }); pub.checked = cur.published !== false;
  const msg = h('div', { class: 'err', role: 'alert' }), gal = h('div', { class: 'aimgs' });
  const file = h('input', { type: 'file', accept: TYPES.join(','), multiple: true });
  const btn = h('button', { class: 'btn' }, editId ? 'Lưu thay đổi' : 'Đăng tin');
  function drawGal() {
    const x = (fn) => h('button', { type: 'button', title: 'Bỏ ảnh', onclick: fn }, '×');
    gal.replaceChildren(...keep.map((u, i) => h('div', { class: 'aimg' }, img(u, '', 'th', ''), x(() => { keep.splice(i, 1); drawGal(); }))),
      ...fresh.map((f, i) => h('div', { class: 'aimg' }, img(f.url, '', 'th', ''), x(() => { URL.revokeObjectURL(f.url); fresh.splice(i, 1); drawGal(); }))));
    file.disabled = keep.length + fresh.length >= MAX;
  }
  file.onchange = () => {
    msg.textContent = '';
    for (const f of file.files) {
      if (!TYPES.includes(f.type)) { msg.textContent = 'Chỉ nhận PNG, JPG, WebP hoặc GIF.'; continue; }
      if (f.size > 15e6) { msg.textContent = 'Mỗi ảnh tối đa 15 MB.'; continue; }
      if (keep.length + fresh.length >= MAX) { msg.textContent = `Tối đa ${MAX} ảnh mỗi bài.`; break; }
      fresh.push({ file: f, url: URL.createObjectURL(f) });
    }
    file.value = ''; drawGal();
  };
  drawGal();
  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); msg.textContent = '';
    if (!title.value.trim()) { msg.textContent = 'Tiêu đề không được để trống'; return; }
    if (!content.value.trim()) { msg.textContent = 'Nội dung không được để trống'; return; }
    btn.disabled = true; btn.textContent = fresh.length ? 'Đang tải ảnh lên…' : 'Đang lưu…';
    try {
      const newImages = await Promise.all(fresh.map((f) => toB64(f.file)));
      await api(editId ? '/api/admin/news/' + encodeURIComponent(editId) : '/api/admin/news', { method: editId ? 'PUT' : 'POST',
        body: { title: title.value, content: content.value, published: pub.checked, images: keep, newImages } });
      toast(editId ? 'Đã lưu' : 'Đã đăng tin', 'ok'); setTimeout(() => { location.href = '/admin/news'; }, 500);
    } catch (er) { msg.textContent = er.message; toast(er.message, 'err'); btn.disabled = false; btn.textContent = editId ? 'Lưu thay đổi' : 'Đăng tin'; }
  } },
    h('div', { class: 'field' }, h('label', {}, 'Tiêu đề *'), title),
    h('div', { class: 'field' }, h('label', {}, 'Nội dung *'), content),
    h('div', { class: 'field' }, h('label', {}, `Ảnh đính kèm (tối đa ${MAX})`), gal, file, h('div', { class: 'muted', style: 'font-size:.8rem' }, 'Ảnh đầu tiên là ảnh bìa. Ảnh lớn hơn 2000 px sẽ tự thu nhỏ.')),
    h('div', { class: 'field' }, h('label', {}, pub, ' Hiển thị công khai')), msg,
    h('div', { class: 'acts' }, btn, h('a', { class: 'btn ghost', href: '/admin/news' }, 'Hủy')));
  app.append(topbar(editId ? 'Sửa tin' : 'Đăng tin'), h('div', { class: 'panel wide' }, form));
  title.focus();
}

/* ========== DASHBOARD (tong quan) ========== */
async function adminDash() {
  const body = h('div', {}, skels(2));
  app.append(topbar('Dashboard'), body);
  let s; try { s = await api('/api/admin/summary'); } catch (e) { body.replaceChildren(errState(e.message, () => location.reload())); return; }
  const card = (n, label, href, warn) => h('a', { class: 'dcard' + (warn && n > 0 ? ' warn' : ''), href }, h('b', {}, n), h('span', {}, label));
  body.replaceChildren(h('div', { class: 'dcards' },
    card(s.users, 'Người dùng', '/admin/users'), card(s.activeBans, 'Đang bị ban', '/admin/moderation/ban'), card(s.warns, 'Lượt cảnh cáo', '/admin/moderation/warn'), card(s.kicks, 'Lượt kick', '/admin/moderation/kick'),
    card(s.pendingPosts, 'Bài Forum chờ duyệt', '/admin/forum', true), card(s.pendingFanart, 'Fan Art chờ duyệt', '/admin/fanart', true),
    card(s.popups.active + '/' + s.popups.total, 'Popup đang bật', '/admin/popups'), card(s.marquee.active + '/' + s.marquee.total, 'Thông báo chạy đang bật', '/admin/marquee'), card(s.vtubers, 'VTuber & Clipper', '/admin/vtubers')));
}

/* ========== USERS + MODERATION ========== */
const banText = (b) => (b ? (b.expiresAt ? 'Đến ' + fmtDT(b.expiresAt) : 'Vĩnh viễn') : '');
const banBadge = (b) => (b ? h('span', { class: 'badge rejected', title: b.reason }, '⛔ Ban · ' + banText(b)) : h('span', { class: 'badge approved' }, 'Bình thường'));
const DURATIONS = [['60', '1 giờ'], ['1440', '1 ngày'], ['10080', '7 ngày'], ['43200', '30 ngày'], ['permanent', 'Vĩnh viễn']];
const userCell = (u) => h('div', { class: 'ucell' }, img(u.avatarUrl, u.username, 'av sm', u.username), h('div', {}, h('b', {}, u.username), h('div', { class: 'muted', style: 'font-size:.8rem' }, 'ID ' + u.id)));

/** Hop thoai ban/kick/warn. Chi gui reason (+ thoi han); adminId do server lay tu session. */
function modModal(kind, u, done) {
  const T = { ban: ['Ban người dùng', 'Ban', 'danger'], kick: ['Kick người dùng', 'Kick', 'danger'], warn: ['Cảnh cáo người dùng', 'Gửi cảnh cáo', ''] }[kind];
  const reason = h('textarea', { rows: 3, maxlength: 300, placeholder: 'Lý do (bắt buộc, ≤ 300 ký tự)', 'aria-label': 'Lý do' }), err = h('div', { class: 'err', role: 'alert' });
  const dur = h('select', { 'aria-label': 'Thời hạn' }, DURATIONS.map(([v, t]) => h('option', { value: v }, t)));
  const go = h('button', { class: 'btn ' + T[2], onclick: async () => {
    err.textContent = ''; if (!reason.value.trim()) { err.textContent = 'Cần nhập lý do'; return; }
    const body = { reason: reason.value.trim() };
    if (kind === 'ban') { if (dur.value === 'permanent') body.permanent = true; else body.durationMinutes = Number(dur.value); }
    go.disabled = true;
    try { const r = await api('/api/admin/users/' + u.id + '/' + kind, { method: 'POST', body }); toast(kind === 'kick' ? `Đã kick (${r.sessionsClosed} phiên bị hủy)` : 'Đã thực hiện', 'ok'); close(); done && done(); }
    catch (e) { err.textContent = e.message; go.disabled = false; }
  } }, T[1]);
  const close = openModal(T[0] + ': ' + u.username, h('div', {}, h('p', { class: 'muted' }, 'ID ' + u.id), kind === 'ban' && h('div', { class: 'field' }, h('label', {}, 'Thời hạn'), dur), h('div', { class: 'field' }, h('label', {}, 'Lý do'), reason), err,
    kind === 'kick' && h('p', { class: 'muted' }, 'Kick hủy mọi phiên đăng nhập hiện có; người dùng vẫn đăng nhập lại được.')),
    h('div', { class: 'row', style: 'display:flex;gap:8px;justify-content:flex-end' }, h('button', { class: 'btn ghost', onclick: () => close() }, 'Hủy'), go));
  narrow(480); reason.focus();
}
async function doUnban(u, done) {
  if (!(await confirmModal(`Gỡ ban của "${u.username}"?`, 'Gỡ ban'))) return;
  try { await api('/api/admin/users/' + u.id + '/unban', { method: 'POST' }); toast('Đã gỡ ban', 'ok'); done && done(); } catch (e) { toast(e.message, 'err'); }
}
async function historyModal(u) {
  const box = h('div', {}, skels(1)); openModal('Hồ sơ xử lý: ' + u.username, box); narrow(640);
  let d; try { d = await api('/api/admin/users/' + u.id); } catch (e) { box.replaceChildren(errState(e.message)); return; }
  const H = d.history, ST = { active: 'Đang hiệu lực', expired: 'Hết hạn', revoked: 'Đã gỡ' };
  const list = (title, rows, fmt) => h('div', { class: 'hsec' }, h('h4', {}, `${title} (${rows.length})`), rows.length ? rows.map((x) => h('div', { class: 'hrow' }, fmt(x), h('div', { class: 'muted' }, 'Lý do: ' + x.reason), h('div', { class: 'muted' }, 'Admin ID ' + x.adminId))) : h('p', { class: 'muted' }, 'Không có.'));
  box.replaceChildren(h('div', { class: 'ucell' }, img(d.avatarUrl, d.username, 'av', d.username), h('div', {}, h('b', {}, d.username), h('div', { class: 'muted' }, 'ID ' + d.id + ' · ' + (d.role === 'admin' ? 'Admin' : 'User')), banBadge(d.ban))),
    list('Lịch sử ban', H.bans, (x) => h('div', {}, h('b', {}, fmtDT(x.createdAt)), ' · ', banText(x), ' · ', h('span', { class: 'badge ' + (x.state === 'active' ? 'rejected' : 'pending') }, ST[x.state]), x.revokedAt && h('span', { class: 'muted' }, ' · gỡ ' + fmtDT(x.revokedAt)))),
    list('Lịch sử cảnh cáo (warn)', H.warns, (x) => h('b', {}, fmtDT(x.createdAt))), list('Lịch sử kick', H.kicks, (x) => h('b', {}, fmtDT(x.createdAt))));
}

async function adminUsers() {
  const q = h('input', { type: 'search', placeholder: 'Tìm bằng Discord ID hoặc username…', 'aria-label': 'Tìm người dùng', maxlength: 64 }), body = h('div', {}, skels(2));
  app.append(topbar('Users'), h('div', { class: 'panel', style: 'margin-bottom:16px' }, q), body);
  let seq = 0;
  async function load() {
    const my = ++seq; let list;
    try { list = await api('/api/admin/users?q=' + encodeURIComponent(q.value.trim())); } catch (e) { if (my === seq) body.replaceChildren(errState(e.message, load)); return; }
    if (my !== seq) return;
    if (!list.length) { body.replaceChildren(state('👥', 'Không tìm thấy', 'Không có người dùng khớp từ khóa.')); return; }
    body.replaceChildren(h('div', { class: 'panel tw' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['Người dùng', 'Vai trò', 'Trạng thái', 'Warn', 'Thao tác'].map((t) => h('th', {}, t)))),
      h('tbody', {}, list.map((u) => h('tr', {}, h('td', {}, userCell(u)), h('td', {}, u.role === 'admin' ? 'Admin' : 'User'), h('td', {}, banBadge(u.ban)), h('td', {}, u.warnCount),
        h('td', {}, h('div', { class: 'acts' }, h('button', { class: 'btn ghost sm', onclick: () => historyModal(u) }, 'Chi tiết'),
          u.role !== 'admin' && [h('button', { class: 'btn ghost sm', onclick: () => modModal('warn', u, load) }, 'Warn'), h('button', { class: 'btn ghost sm', onclick: () => modModal('kick', u, load) }, 'Kick'),
            u.ban ? h('button', { class: 'btn sm', onclick: () => doUnban(u, load) }, 'Unban') : h('button', { class: 'btn danger sm', onclick: () => modModal('ban', u, load) }, 'Ban')]))))))));
  }
  let t; q.oninput = () => { clearTimeout(t); t = setTimeout(load, 300); };
  await load(); q.focus();
}

/** Trang Ban / Kick / Warn: chon user (tim theo ID/username) + nhap ly do, ben duoi la nhat ky cua loai do. */
async function adminModeration() {
  const kind = location.pathname.split('/')[3];
  if (!['ban', 'kick', 'warn'].includes(kind)) { location.replace('/admin/moderation/ban'); return; }
  const TITLE = { ban: 'Ban', kick: 'Kick', warn: 'Warn' };
  const q = h('input', { type: 'search', placeholder: 'Discord ID hoặc username…', 'aria-label': 'Tìm người dùng', maxlength: 64 }), res = h('div', { class: 'pick' }), log = h('div', {}, skels(1));
  let only = kind === 'ban';   // ban: mac dinh chi hien ban dang hieu luc
  const tabs = h('div', { class: 'tabs' });
  app.append(topbar(TITLE[kind]), h('div', { class: 'panel', style: 'margin-bottom:16px' }, h('h3', { style: 'margin-top:0' }, { ban: 'Ban người dùng', kick: 'Kick người dùng', warn: 'Cảnh cáo người dùng' }[kind]), q, res), tabs, log);
  async function loadLog() {
    let rows; try { rows = await api('/api/admin/moderation?type=' + kind + (kind === 'ban' && only ? '&active=1' : '')); } catch (e) { log.replaceChildren(errState(e.message, loadLog)); return; }
    if (kind === 'ban') tabs.replaceChildren(...[[true, 'Đang hiệu lực'], [false, 'Tất cả']].map(([v, t]) => h('button', { class: 'tab' + (only === v ? ' on' : ''), onclick: () => { only = v; loadLog(); } }, t)));
    if (!rows.length) { log.replaceChildren(state('📋', 'Chưa có bản ghi', 'Danh sách này đang trống.')); return; }
    const ST = { active: ['rejected', 'Đang hiệu lực'], expired: ['pending', 'Hết hạn'], revoked: ['pending', 'Đã gỡ'] };
    log.replaceChildren(h('div', { class: 'panel tw' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['Người dùng', 'Lý do', 'Admin ID', 'Thời điểm', ...(kind === 'ban' ? ['Hết hạn', 'Trạng thái', ''] : [])].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, userCell(r.user)), h('td', { class: 'pcell' }, r.reason), h('td', {}, h('code', {}, r.adminId)), h('td', {}, fmtDT(r.createdAt)),
        kind === 'ban' && [h('td', {}, r.expiresAt ? fmtDT(r.expiresAt) : 'Vĩnh viễn'), h('td', {}, h('span', { class: 'badge ' + ST[r.state][0] }, ST[r.state][1])),
          h('td', {}, r.state === 'active' && h('button', { class: 'btn sm', onclick: () => doUnban(r.user, loadLog) }, 'Unban'))]))))));
  }
  let seq = 0;
  async function search() {
    const my = ++seq; let list; try { list = (await api('/api/admin/users?q=' + encodeURIComponent(q.value.trim()))).filter((u) => u.role !== 'admin').slice(0, 8); } catch (e) { res.replaceChildren(h('div', { class: 'err' }, e.message)); return; }
    if (my !== seq) return;
    res.replaceChildren(...(list.length ? list.map((u) => h('div', { class: 'pickrow' }, userCell(u), banBadge(u.ban),
      kind === 'ban' && u.ban ? h('button', { class: 'btn sm', onclick: () => doUnban(u, () => { search(); loadLog(); }) }, 'Unban') : h('button', { class: 'btn sm ' + (kind === 'warn' ? '' : 'danger'), onclick: () => modModal(kind, u, () => { search(); loadLog(); }) }, TITLE[kind]))) : [h('p', { class: 'muted' }, 'Không tìm thấy người dùng phù hợp.')]));
  }
  let t; q.oninput = () => { clearTimeout(t); t = setTimeout(search, 300); };
  await Promise.all([search(), loadLog()]); q.focus();
}

/* ========== POPUP + MARQUEE (CRUD dung chung, cau hinh theo loai) ========== */
const ANN = {
  popups: { title: 'Popup Announcements', add: '+ Tạo popup', empty: 'Chưa có popup', api: '/api/admin/popups', kind: 'popup' },
  marquee: { title: 'Marquee Announcements', add: '+ Tạo thông báo chạy', empty: 'Chưa có thông báo chạy', api: '/api/admin/marquee', kind: 'marquee' },
};
const TYPE_LABEL = { info: 'Thông tin', success: 'Thành công', warning: 'Cảnh báo', danger: 'Khẩn' }, AUD_LABEL = { all: 'Mọi người', guests: 'Khách', users: 'Đã đăng nhập' };
async function adminAnn(key) {
  const C = ANN[key], body = h('div', {}, skels(2));
  app.append(topbar(C.title, h('button', { class: 'btn sm', onclick: () => edit(null) }, C.add)), body);
  const act = (fn, okMsg) => async () => { try { await fn(); toast(okMsg, 'ok'); await load(); } catch (e) { toast(e.message, 'err'); } };
  function edit(cur) {
    const isP = key === 'popups', v = cur || { enabled: true, type: 'info', audience: 'all' };
    const F = {};
    const field = (k, label, el, hint) => { F[k] = el; return h('div', { class: 'field' }, h('label', {}, label), el, hint && h('div', { class: 'muted', style: 'font-size:.8rem' }, hint)); };
    const sel = (opts, val) => h('select', {}, Object.entries(opts).map(([k, t]) => h('option', { value: k, selected: k === val }, t)));
    const en = h('input', { type: 'checkbox' }); en.checked = v.enabled !== false;
    const err = h('div', { class: 'err', role: 'alert' });
    const fields = isP
      ? [field('title', 'Tiêu đề *', h('input', { value: v.title || '', maxlength: 100 })), field('message', 'Nội dung *', h('textarea', { rows: 5, maxlength: 1000 }, v.message || ''), 'Văn bản thuần: thẻ HTML/script sẽ bị loại bỏ.'),
        h('div', { class: 'row2' }, field('type', 'Loại', sel(TYPE_LABEL, v.type)), field('audience', 'Đối tượng', sel(AUD_LABEL, v.audience)))]
      : [field('text', 'Nội dung *', h('input', { value: v.text || '', maxlength: 200 }), 'Tối đa 200 ký tự, văn bản thuần.'), field('link', 'Link (tùy chọn)', h('input', { type: 'url', value: v.link || '', placeholder: 'https://…', maxlength: 500 }), 'Chỉ nhận http:// hoặc https://')];
    const sched = h('div', { class: 'row2' }, field('startsAt', 'Bắt đầu hiển thị', h('input', { type: 'datetime-local', value: toLocalInput(v.startsAt) }), 'Để trống = hiển thị ngay'), field('endsAt', 'Kết thúc', h('input', { type: 'datetime-local', value: toLocalInput(v.endsAt) }), 'Để trống = không giới hạn'));
    const go = h('button', { class: 'btn' }, cur ? 'Lưu' : 'Tạo');
    go.onclick = async () => {
      err.textContent = ''; go.disabled = true;
      const b = { enabled: en.checked, startsAt: fromLocalInput(F.startsAt.value), endsAt: fromLocalInput(F.endsAt.value) };
      for (const k of isP ? ['title', 'message', 'type', 'audience'] : ['text', 'link']) b[k] = F[k].value;
      try { await api(cur ? C.api + '/' + cur.id : C.api, { method: cur ? 'PUT' : 'POST', body: b }); toast('Đã lưu', 'ok'); close(); await load(); } catch (e) { err.textContent = e.message; go.disabled = false; }
    };
    const close = openModal((cur ? 'Sửa' : 'Tạo') + ' ' + (isP ? 'popup' : 'thông báo chạy'), h('div', {}, ...fields, sched, h('div', { class: 'field' }, h('label', {}, en, ' Đang bật')), err),
      h('div', { style: 'display:flex;gap:8px;justify-content:flex-end' }, h('button', { class: 'btn ghost', onclick: () => close() }, 'Hủy'), go));
    narrow(560);
  }
  async function load() {
    let list; try { list = await api(C.api); } catch (e) { body.replaceChildren(errState(e.message, load)); return; }
    if (!list.length) { body.replaceChildren(state(key === 'popups' ? '🔔' : '📢', C.empty, `Bấm "${C.add}" để tạo.`)); return; }
    const isP = key === 'popups';
    body.replaceChildren(h('div', { class: 'panel tw' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, [isP ? 'Popup' : 'Nội dung', 'Thời gian hiển thị', 'Trạng thái', 'Thao tác'].map((t) => h('th', {}, t)))),
      h('tbody', {}, list.map((x) => { const [c, l] = timeState(x); return h('tr', {},
        h('td', { class: 'pcell' }, isP ? [h('b', {}, x.title), h('div', { class: 'pbody muted' }, x.message.length > 140 ? x.message.slice(0, 140) + '…' : x.message), h('div', { class: 'muted' }, TYPE_LABEL[x.type] + ' · ' + AUD_LABEL[x.audience])]
          : [h('div', {}, x.text), x.link && h('div', { class: 'muted' }, '🔗 ' + x.link)]),
        h('td', {}, window_(x)), h('td', {}, h('span', { class: 'badge ' + c }, l)),
        h('td', {}, h('div', { class: 'acts' }, h('button', { class: 'btn ghost sm', onclick: () => edit(x) }, 'Sửa'),
          h('button', { class: 'btn ghost sm', onclick: act(() => api(C.api + '/' + x.id + '/toggle', { method: 'POST' }), x.enabled ? 'Đã tắt' : 'Đã bật') }, x.enabled ? 'Tắt' : 'Bật'),
          h('button', { class: 'btn danger sm', onclick: async () => { if (await confirmModal('Xóa thông báo này?')) act(() => api(C.api + '/' + x.id, { method: 'DELETE' }), 'Đã xóa')(); } }, 'Xóa')))); })))));
  }
  await load();
}

const PAGES = { login: adminLogin, dashboard: adminDash, vtubers: adminVtubers, form: adminForm, fanart: adminFanart, forum: adminForum, news: adminNews, newsform: adminNewsForm,
  users: adminUsers, moderation: adminModeration, popups: () => adminAnn('popups'), marquee: () => adminAnn('marquee') };
const adminPage = PAGES[document.body.dataset.admin];
if (adminPage) {
  if (document.body.dataset.admin !== 'login') adminShell();   // moi trang tru login dung chung Sidebar + Navbar
  adminPage().catch((e) => { console.error(e); app.replaceChildren(errState('Đã xảy ra lỗi không mong muốn.', () => location.reload())); });
}
