/* Feed kieu Facebook + trang profile cong khai. Dung helper chung cua app.js (h, api, apiw, getMe, img, captchaBox, ...).
 * Moi noi dung nguoi dung di qua h() => chi tao text node (khong chen HTML) nen khong co XSS; anh chi nhan URL http(s) qua safeUrl. */
const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡'];
const RLABEL = { '👍': 'Thích', '❤️': 'Yêu thích', '😂': 'Haha', '😮': 'Wow', '😢': 'Buồn', '😡': 'Phẫn nộ' };
const IMG_MAX = 4, IMG_OK = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const finePointer = () => !!(window.matchMedia && matchMedia('(pointer:fine)').matches);
const grow = (t) => { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 220) + 'px'; };
const hpField = () => h('input', { class: 'hpf', name: 'hp', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' });   // o an chong bot
const fitModal = (w) => { const m = [...document.querySelectorAll('.mov .modal')].pop(); if (m) m.style.width = `min(${w}px,100%)`; };
document.addEventListener('click', () => document.querySelectorAll('.fb-menu:not([hidden]),.fb-tray.open').forEach((m) => { if (m.classList.contains('open')) m.classList.remove('open'); else m.hidden = true; }));

const avatar = (a, cls = 'av md') => {
  const name = (a && a.username) || 'Ẩn danh', im = img(a && a.avatarUrl, name, cls, name);
  return a && a.id ? h('a', { class: 'fb-av', href: '/users/' + encodeURIComponent(a.id), 'aria-label': 'Hồ sơ ' + name }, im) : h('span', { class: 'fb-av' }, im);
};
const nameLink = (a) => { const n = (a && a.username) || 'Ẩn danh'; return a && a.id ? h('a', { class: 'fb-name', href: '/users/' + encodeURIComponent(a.id) }, n) : h('span', { class: 'fb-name' }, n); };
const loginPrompt = (text) => h('div', { class: 'fb-card fb-login' }, h('span', {}, text), h('a', { class: 'btn sm', href: '/auth/discord/login?next=' + encodeURIComponent(location.pathname + location.search) }, 'Đăng nhập Discord'));
const feedSkel = (n = 2) => h('div', { class: 'fb-col' }, Array.from({ length: n }, () => h('div', { class: 'skel fb-skelcard' })));

/** Luoi anh kieu Facebook: 1 anh lon / 2 anh song song / 3 anh (1 lon + 2 nho) / 4 anh (2x2). */
function photos(urls) {
  if (!urls || !urls.length) return null;
  const n = Math.min(urls.length, 4);
  return h('div', { class: 'fb-imgs n' + n }, urls.slice(0, 4).map((u) => {
    const a = h('a', { href: safeUrl(u) || '#', target: '_blank', rel: 'noopener noreferrer' });
    if (safeUrl(u)) { const i = new Image(); i.alt = 'Ảnh bài viết'; i.loading = 'lazy'; i.decoding = 'async'; i.referrerPolicy = 'no-referrer'; i.src = u; a.append(i); }
    return a;
  }));
}
function moreMenu(items) {
  const pop = h('div', { class: 'fb-menu', role: 'menu', hidden: true }, items.map(([label, fn, cls]) => h('button', { type: 'button', role: 'menuitem', class: cls || '', onclick: () => { pop.hidden = true; fn(); } }, label)));
  const btn = h('button', { type: 'button', class: 'fb-more', 'aria-label': 'Tùy chọn bài viết', 'aria-haspopup': 'menu', onclick: (e) => { e.stopPropagation(); const wasHidden = pop.hidden; document.querySelectorAll('.fb-menu').forEach((m) => { m.hidden = true; }); pop.hidden = !wasHidden; } }, '⋯');
  return h('div', { class: 'fb-menuwrap' }, btn, pop);
}

/** Khung soan bai (dang moi hoac sua: truyen post). Server luon dat bai o "pending"; sua bai da duyet/tu choi => duyet lai.
 *  Dang bai MOI di kem Cloudflare Turnstile (neu server bat) + o an chong bot. */
function composer({ post, me, onDone } = {}) {
  const editing = !!post, who = editing ? post.author : (me && me.user);
  let keep = post ? [...post.images] : [], fresh = [];
  const cf = editing ? null : captchaBox(), hp = hpField();
  const ta = h('textarea', { class: 'fb-ta', rows: 4, maxlength: 5000, placeholder: editing ? 'Chỉnh sửa bài viết' : 'Bạn đang nghĩ gì?', 'aria-label': 'Nội dung bài viết' }, editing ? post.content : '');
  const gal = h('div', { class: 'aimgs' }), msg = h('div', { class: 'err', role: 'alert' });
  const file = h('input', { type: 'file', class: 'sr', id: 'pf-' + (post ? post.id : 'new'), accept: IMG_OK.join(','), multiple: true });
  const label = editing ? 'Lưu & gửi duyệt lại' : 'Đăng';
  const btn = h('button', { class: 'btn fb-submit', type: 'submit', disabled: true }, label);
  const sync = () => { btn.disabled = !(ta.value.trim() || keep.length || fresh.length); };
  function drawGal() {
    const x = (fn) => h('button', { type: 'button', title: 'Bỏ ảnh', onclick: fn }, '×');
    gal.replaceChildren(...keep.map((u, i) => h('div', { class: 'aimg' }, img(u, '', 'th', ''), x(() => { keep.splice(i, 1); drawGal(); }))),
      ...fresh.map((f, i) => h('div', { class: 'aimg' }, img(f.url, '', 'th', ''), x(() => { URL.revokeObjectURL(f.url); fresh.splice(i, 1); drawGal(); }))));
    file.disabled = keep.length + fresh.length >= IMG_MAX; sync();
  }
  file.onchange = () => {
    msg.textContent = '';
    for (const f of file.files) {
      if (!IMG_OK.includes(f.type)) { msg.textContent = 'Chỉ nhận PNG, JPG, WebP hoặc GIF.'; continue; }
      if (f.size > 15e6) { msg.textContent = 'Mỗi ảnh tối đa 15 MB.'; continue; }
      if (keep.length + fresh.length >= IMG_MAX) { msg.textContent = `Tối đa ${IMG_MAX} ảnh mỗi bài.`; break; }
      fresh.push({ file: f, url: URL.createObjectURL(f) });
    }
    file.value = ''; drawGal();
  };
  ta.oninput = () => { grow(ta); sync(); };
  drawGal();
  const form = h('form', { class: 'fb-comp', novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); msg.textContent = '';
    if (!ta.value.trim() && !keep.length && !fresh.length) { msg.textContent = 'Hãy nhập nội dung hoặc thêm ảnh.'; return; }
    btn.disabled = true; btn.textContent = 'Đang gửi…';
    try {
      const newImages = await Promise.all(fresh.map((f) => toB64(f.file)));
      // Chi gui noi dung + anh (+ captcha, o an). Khong co authorId/status/rejectReason: backend tu quyet dinh (va bo qua neu bi chen).
      if (editing) await apiw('/api/forum/posts/' + encodeURIComponent(post.id), 'PUT', { content: ta.value, images: keep, newImages });
      else await apiw('/api/forum/posts', 'POST', { content: ta.value, newImages, captcha: await cf.get(), hp: hp.value });
      toast('Đã gửi! Bài viết sẽ hiển thị công khai sau khi admin duyệt.', 'ok');
      if (!editing) { ta.value = ''; fresh.forEach((f) => URL.revokeObjectURL(f.url)); fresh = []; drawGal(); cf.reset(); }
      if (onDone) onDone();
    } catch (er) { msg.textContent = er.message; if (cf && er.code === 'captcha_failed') cf.reset(); }
    btn.textContent = label; sync();
  } },
  h('div', { class: 'fb-comp-who' }, avatar(who), h('div', {}, nameLink(who), h('div', { class: 'muted fb-hint' }, 'Bài viết cần admin duyệt trước khi hiển thị'))),
  ta, gal, msg,
  h('div', { class: 'fb-addbar' }, h('span', {}, 'Thêm vào bài viết'), h('label', { class: 'fb-addbtn', for: file.id, title: 'Thêm ảnh' }, '🖼 Ảnh'), file),
  cf && cf.el, hp, btn);
  form.focusText = () => ta.focus();
  return form;
}

/** Binh luan cua 1 bai (chi bai approved): bong bong kieu Facebook, o nhap dang vien thuoc, Enter de gui (may co chuot). */
function commentsBox(post, me, onCount) {
  const list = h('div', { class: 'fb-clist' }); let items = [], expanded = false;
  const cf = me && me.loggedIn ? captchaBox() : null;
  const draw = () => {
    const hid = !expanded && items.length > 4 ? items.length - 3 : 0, shown = hid ? items.slice(-3) : items;
    list.replaceChildren(...[hid > 0 && h('button', { class: 'fb-morec', type: 'button', onclick: () => { expanded = true; draw(); } }, `Xem ${hid} bình luận trước đó`),
      ...(shown.length ? shown.map(item) : [h('p', { class: 'fb-empty' }, 'Chưa có bình luận nào. Hãy là người đầu tiên!')])].filter(Boolean));
    onCount(items.length);
  };
  function item(c) {
    const bubble = h('div', { class: 'fb-bubble' }, nameLink(c.author), h('div', { class: 'fb-bt' }, c.content));
    const meta = h('div', { class: 'fb-cmeta' }, h('span', { title: fmtDT(c.createdAt) }, ago(c.createdAt) + (c.updatedAt && c.updatedAt !== c.createdAt ? ' · đã sửa' : '')),
      c.mine && h('button', { class: 'linkbtn', type: 'button', onclick: () => {
        const t = h('textarea', { class: 'fb-cta', rows: 2, maxlength: 1000 }, c.content);
        const save = h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { Object.assign(c, await apiw('/api/forum/comments/' + encodeURIComponent(c.id), 'PUT', { content: t.value })); draw(); } catch (er) { toast(er.message, 'err'); } } }, 'Lưu');
        bubble.replaceChildren(t, h('div', { class: 'acts' }, save, h('button', { class: 'btn ghost sm', type: 'button', onclick: draw }, 'Hủy'))); meta.hidden = true;
      } }, 'Sửa'),
      c.mine && h('button', { class: 'linkbtn', type: 'button', onclick: async () => {
        if (!confirm('Xóa bình luận này?')) return;
        try { await apiw('/api/forum/comments/' + encodeURIComponent(c.id), 'DELETE'); items = items.filter((x) => x.id !== c.id); draw(); } catch (er) { toast(er.message, 'err'); }
      } }, 'Xóa'));
    return h('div', { class: 'fb-cmt' }, avatar(c.author, 'av sm'), h('div', { class: 'fb-cmain' }, bubble, meta));
  }
  const box = h('div', { class: 'fb-cbox' }, list);
  let focusInput = () => {};
  if (me && me.loggedIn) {
    const t = h('textarea', { class: 'fb-cta', rows: 1, maxlength: 1000, placeholder: 'Viết bình luận…', 'aria-label': 'Viết bình luận' }), hp = hpField(), err = h('div', { class: 'err', role: 'alert' });
    const send = h('button', { class: 'fb-send', type: 'submit', 'aria-label': 'Gửi bình luận', disabled: true }, '➤');
    t.oninput = () => { grow(t); send.disabled = !t.value.trim(); };
    t.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && finePointer()) { e.preventDefault(); form.requestSubmit(); } };
    const form = h('form', { class: 'fb-cform', onsubmit: async (e) => {
      e.preventDefault(); err.textContent = ''; if (!t.value.trim()) return; send.disabled = true;
      try {
        const c = await apiw('/api/forum/posts/' + encodeURIComponent(post.id) + '/comments', 'POST', { content: t.value, captcha: await cf.get(), hp: hp.value });
        items.push(c); t.value = ''; grow(t); expanded = true; draw(); cf.reset();
      } catch (er) { err.textContent = er.message; if (er.code === 'captcha_failed') cf.reset(); }
      send.disabled = !t.value.trim();
    } }, avatar(me.user, 'av sm'), h('div', { class: 'fb-cinput' }, t, send), hp);
    box.append(form, cf.el, err); focusInput = () => t.focus();
  } else box.append(loginPrompt('Đăng nhập để bình luận.'));
  api('/api/forum/posts/' + encodeURIComponent(post.id) + '/comments').then((l) => { items = l; draw(); }).catch((e) => list.replaceChildren(h('p', { class: 'err' }, e.message)));
  box.focusInput = focusInput;
  return box;
}

/** 1 bai trong feed: tac gia, noi dung, anh, tom tat reaction, nut Thich (re chuot/nhan giu de chon cam xuc), Binh luan, Chia se, menu Sua/Xoa cua minh. */
function postCard(post, me, reload, { open = false } = {}) {
  const mine = !!(me && me.loggedIn && post.author.id === me.user.id);
  const isPublic = !post.status || post.status === 'approved';   // status chi co khi la bai cua minh
  const statsL = h('span', { class: 'fb-rsum' }), cbtn = h('button', { type: 'button', class: 'fb-ccount' });
  const like = h('button', { type: 'button', class: 'fb-act fb-like' });
  const tray = h('div', { class: 'fb-tray', role: 'group', 'aria-label': 'Chọn cảm xúc' });
  const url = '/api/forum/posts/' + encodeURIComponent(post.id) + '/reaction';
  const react = async (fn) => { try { const u = await fn(); post.reactions = u.reactions; post.myReaction = u.myReaction; drawReact(); } catch (er) { toast(er.message, 'err'); } };
  const setEmoji = (e) => react(() => (post.myReaction === e ? apiw(url, 'DELETE') : apiw(url, 'POST', { emoji: e })));
  tray.append(...EMOJIS.map((e) => h('button', { type: 'button', class: 'fb-em', title: RLABEL[e], 'aria-label': RLABEL[e], onclick: (ev) => { ev.stopPropagation(); tray.classList.remove('open'); setEmoji(e); } }, e)));
  like.onclick = () => setEmoji(post.myReaction || '👍');
  let pressT; like.addEventListener('touchstart', () => { pressT = setTimeout(() => tray.classList.add('open'), 420); }, { passive: true });
  ['touchend', 'touchmove', 'touchcancel'].forEach((ev) => like.addEventListener(ev, () => clearTimeout(pressT), { passive: true }));
  like.addEventListener('contextmenu', (e) => { if (e.pointerType === 'touch' || !finePointer()) { e.preventDefault(); tray.classList.add('open'); } });
  function drawReact() {
    const c = (post.reactions && post.reactions.counts) || {}, total = (post.reactions && post.reactions.total) || 0;
    const top = Object.entries(c).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([e]) => e);
    statsL.replaceChildren(...(total > 0 ? [h('span', { class: 'fb-ricons' }, top.map((e) => h('span', {}, e))), h('span', {}, String(total))] : []));
    like.className = 'fb-act fb-like' + (post.myReaction ? ' on' : '');
    like.setAttribute('aria-pressed', post.myReaction ? 'true' : 'false');
    like.replaceChildren(h('span', { class: 'fb-ai' }, post.myReaction || '👍'), post.myReaction ? RLABEL[post.myReaction] : 'Thích');
  }
  drawReact();
  const setCount = (n) => { post.commentCount = n; cbtn.textContent = n > 0 ? `${n} bình luận` : 'Bình luận'; }; setCount(post.commentCount);
  const cslot = h('div', {}); let box = null;
  const toggle = (focus) => {
    if (box) { if (focus) box.focusInput(); else { box = null; cslot.replaceChildren(); } return; }
    box = commentsBox(post, me, setCount); cslot.replaceChildren(box); if (focus) setTimeout(() => box.focusInput(), 0);
  };
  cbtn.onclick = () => toggle(false);
  const share = async () => {
    const link = location.origin + '/forum/' + encodeURIComponent(post.id);
    try { await navigator.clipboard.writeText(link); toast('Đã sao chép liên kết bài viết', 'ok'); } catch { prompt('Sao chép liên kết:', link); }
  };
  const edit = () => { let close; const f = composer({ post, onDone: () => { close(); reload(); } }); close = openModal('Sửa bài viết', f); fitModal(560); f.focusText(); };
  const del = async () => { if (!confirm('Xóa bài viết này (kèm bình luận)?')) return; try { await apiw('/api/forum/posts/' + encodeURIComponent(post.id), 'DELETE'); toast('Đã xóa bài viết', 'ok'); reload(); } catch (er) { toast(er.message, 'err'); } };
  const long = !!post.content && post.content.length > 420;
  const text = post.content && h('div', { class: 'fb-text' + (long ? ' clamp' : '') + (!long && post.content.length <= 110 && !post.images.length && !post.content.includes('\n') ? ' big' : '') }, post.content);
  const seeMore = long && h('button', { class: 'linkbtn fb-seemore', type: 'button', onclick: (e) => { text.classList.remove('clamp'); e.target.remove(); } }, 'Xem thêm');
  const card = h('article', { class: 'fb-post' },
    h('header', { class: 'fb-ph' }, avatar(post.author), h('div', { class: 'fb-who' }, nameLink(post.author),
      h('div', { class: 'fb-sub' }, h('a', { href: '/forum/' + encodeURIComponent(post.id), title: fmtDT(post.createdAt) }, ago(post.createdAt) + (post.updatedAt && post.updatedAt !== post.createdAt ? ' · đã sửa' : '')), ' · 🌐')),
      mine && moreMenu([['✏️ Sửa bài viết', edit], ['🗑️ Xóa bài viết', del, 'danger']])),
    statusNote(post), text, seeMore, photos(post.images),
    isPublic ? h('div', { class: 'fb-stats' }, statsL, cbtn) : null,
    isPublic ? h('div', { class: 'fb-actions' }, h('div', { class: 'fb-likewrap' }, like, tray), h('button', { type: 'button', class: 'fb-act', onclick: () => toggle(true) }, h('span', { class: 'fb-ai' }, '💬'), 'Bình luận'), h('button', { type: 'button', class: 'fb-act', onclick: share }, h('span', { class: 'fb-ai' }, '↗'), 'Chia sẻ')) : null,
    cslot);
  if (open && isPublic) toggle(false);
  return card;
}

/* ============ /forum, /forum/:id ============ */
async function pageForum() {
  const el = $('#app'), pathId = location.pathname.split('/')[2];
  let me = { loggedIn: false }; try { me = await getMe(); } catch { /* khach */ }
  if (pathId) return pageForumPost(el, decodeURIComponent(pathId), me);
  const col = h('div', { class: 'fb-col' }), out = h('div', { class: 'fb-feed' }), tabs = h('div', { class: 'fb-tabs' });
  let tab = 'feed', page = 1, posts = [], total = 0, busy = false;
  const more = h('button', { class: 'btn ghost', type: 'button', onclick: () => load(false) }, 'Xem thêm bài viết');
  const moreWrap = h('p', { class: 'center' }, more);
  function drawTabs() {
    if (!me.loggedIn) { tabs.hidden = true; return; }
    tabs.hidden = false;
    tabs.replaceChildren(...[['feed', 'Bảng tin'], ['mine', 'Bài của tôi']].map(([k, t]) => h('button', { class: 'fb-tab' + (tab === k ? ' on' : ''), type: 'button', onclick: () => { tab = k; drawTabs(); load(true); } }, t)));
  }
  const reload = () => load(true);
  function draw() {
    out.replaceChildren(...(posts.length ? posts.map((p) => postCard(p, me, reload))
      : [state(tab === 'mine' ? '📝' : '💬', tab === 'mine' ? 'Bạn chưa có bài viết nào' : 'Chưa có bài viết nào', tab === 'mine' ? 'Bài bạn đăng sẽ hiện ở đây kèm trạng thái duyệt.' : 'Hãy là người đầu tiên đăng bài!')]));
    moreWrap.hidden = tab !== 'feed' || posts.length >= total;
  }
  async function load(reset) {
    if (busy) return; busy = true;
    try {
      if (reset) { page = 1; posts = []; out.replaceChildren(feedSkel(2)); } else page++;
      if (tab === 'mine') { posts = await api('/api/forum/posts/mine'); total = posts.length; }
      else { const r = await api('/api/forum/posts?limit=10&page=' + page); posts = posts.concat(r.items); total = r.total; }
      draw();
    } catch (e) { out.replaceChildren(errState(e.message, () => { busy = false; load(true); })); }
    busy = false;
  }
  let create;
  if (me.loggedIn) {
    const openComposer = (pickPhoto) => {
      let close; const f = composer({ me, onDone: () => { close(); tab = 'mine'; drawTabs(); load(true); } });
      close = openModal('Tạo bài viết', f); fitModal(560); f.focusText();
      if (pickPhoto) f.querySelector('input[type=file]').click();
    };
    create = h('div', { class: 'fb-card fb-create' },
      h('div', { class: 'fb-create-row' }, avatar(me.user), h('button', { class: 'fb-pill', type: 'button', onclick: () => openComposer(false) }, `${me.user.username} ơi, bạn đang nghĩ gì?`)),
      h('div', { class: 'fb-create-acts' }, h('button', { class: 'fb-act', type: 'button', onclick: () => openComposer(true) }, h('span', { class: 'fb-ai' }, '🖼️'), 'Ảnh'), h('button', { class: 'fb-act', type: 'button', onclick: () => openComposer(false) }, h('span', { class: 'fb-ai' }, '✍️'), 'Viết bài')));
  } else create = loginPrompt('Đăng nhập bằng Discord để đăng bài, thả cảm xúc và bình luận. Khách chỉ xem được bài đã duyệt.');
  col.append(create, tabs, out, moreWrap); el.append(col); drawTabs(); await load(true);
}

async function pageForumPost(el, id, me) {
  const col = h('div', { class: 'fb-col' }, h('p', { class: 'fb-back' }, h('a', { href: '/forum' }, '← Quay lại bảng tin')));
  const out = h('div', {}, feedSkel(1)); col.append(out); el.append(col);
  try {
    const p = await api('/api/forum/posts/' + encodeURIComponent(id));
    document.title = 'Bài viết của ' + p.author.username + ' - VTuber Hub';
    out.replaceChildren(postCard(p, me, () => { location.href = '/forum'; }, { open: true }));
  } catch (e) {
    if (e.status === 404) { document.title = 'Không tìm thấy - VTuber Hub'; out.replaceChildren(state('🔎', '404 - Không tìm thấy bài viết', 'Bài viết không tồn tại, đã bị xóa hoặc chưa được duyệt.', h('a', { class: 'btn', href: '/forum' }, 'Về Forum'))); }
    else out.replaceChildren(errState(e.message, () => location.reload()));
  }
}

/* ============ /users/:id (profile cong khai; /account van la trang quan ly tai khoan) ============ */
async function pageUser() {
  const el = $('#app'), id = decodeURIComponent(location.pathname.split('/')[2] || '');
  let me = { loggedIn: false }; try { me = await getMe(); } catch { /* khach */ }
  el.append(skels(1));
  let d;
  try { d = await api('/api/users/' + encodeURIComponent(id)); }
  catch (e) {
    if (e.status === 404) { document.title = 'Không tìm thấy - VTuber Hub'; el.replaceChildren(state('🔎', '404 - Không tìm thấy người dùng', 'Người dùng này không tồn tại.', h('a', { class: 'btn', href: '/forum' }, 'Về Forum'))); }
    else el.replaceChildren(errState(e.message, () => location.reload()));
    return;
  }
  const u = d.user; document.title = u.username + ' - VTuber Hub';
  let tab = 'posts';
  const body = h('div', {}), tabs = h('div', { class: 'tabs' });
  const draw = () => {
    tabs.replaceChildren(...[['posts', `Bài viết (${d.postTotal})`], ['fanart', `Fan Art (${d.fanartTotal})`]].map(([k, t]) => h('button', { class: 'tab' + (tab === k ? ' on' : ''), type: 'button', onclick: () => { tab = k; draw(); } }, t)));
    if (tab === 'posts') body.replaceChildren(...(d.posts.length ? [h('div', { class: 'fb-col' }, d.posts.map((p) => postCard(p, me, reload)))] : [state('💬', 'Chưa có bài viết công khai', u.isSelf ? 'Bài đang chờ duyệt xem ở Forum → "Bài của tôi".' : 'Người dùng này chưa có bài viết nào được duyệt.')]));
    else body.replaceChildren(d.fanarts.length ? h('div', { class: 'grid fans' }, d.fanarts.map((x, i) => fanCard(x, i))) : state('🎨', 'Chưa có Fan Art công khai', u.isSelf ? 'Fan Art đang chờ duyệt xem ở trang Fan Art.' : 'Người dùng này chưa có Fan Art nào được duyệt.'));
  };
  async function reload() { try { d = await api('/api/users/' + encodeURIComponent(id)); draw(); } catch (e) { toast(e.message, 'err'); } }
  el.replaceChildren(
    h('div', { class: 'pbanner' }),
    h('div', { class: 'phead' }, img(u.avatarUrl, u.username, 'av xl', u.username),
      h('div', { class: 'info' }, h('h1', {}, u.username), h('div', { class: 'muted' }, 'Thành viên từ ' + fmtDate(u.createdAt)),
        h('div', { class: 'chips' }, h('div', { class: 'chip' }, 'Bài viết: ', h('b', {}, d.postTotal)), h('div', { class: 'chip' }, 'Fan Art: ', h('b', {}, d.fanartTotal))),
        u.isSelf && h('div', { class: 'acts' }, h('a', { class: 'btn ghost sm', href: '/account' }, 'Quản lý tài khoản'), h('a', { class: 'btn ghost sm', href: '/forum' }, 'Viết bài'), h('a', { class: 'btn ghost sm', href: '/fanart/upload' }, 'Đăng Fan Art')))),
    tabs, body);
  draw();
}

document.addEventListener('DOMContentLoaded', () => {
  const pg = { forum: pageForum, user: pageUser }[document.body.dataset.page];
  if (pg) pg().catch((e) => { console.error(e); $('#app').replaceChildren(errState('Đã xảy ra lỗi không mong muốn.', () => location.reload())); });
});
