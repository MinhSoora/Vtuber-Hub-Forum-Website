/* TOS + Community Rules + man hinh consent truoc Discord OAuth. Dung helper chung cua app.js (h, api, getMe, state, errState, toast, fmtDT).
 * Noi dung lay tu /api/legal (data/legal.json) va chi render bang text node => khong co XSS. Consent that su do SERVER ghi, trang nay chi la giao dien. */
const LEGAL_LINKS = () => h('span', {}, h('a', { href: '/tos', target: '_blank', rel: 'noopener noreferrer' }, 'Terms of Service'), ' và ', h('a', { href: '/community-rules', target: '_blank', rel: 'noopener noreferrer' }, 'Community Rules'));

function renderLegalDoc(data, key) {
  const d = data[key], other = key === 'tos' ? ['/community-rules', 'Xem Luật cộng đồng →'] : ['/tos', 'Xem Điều khoản dịch vụ →'];
  document.title = d.title + ' - VTuber Hub';
  $('#app').replaceChildren(h('article', { class: 'panel wide legal' },
    h('h1', {}, d.title),
    h('p', { class: 'muted' }, 'Phiên bản ' + data.termsVersion + (data.updatedAt ? ' · Cập nhật ' + data.updatedAt : '')),
    d.intro && h('p', { class: 'lead', style: 'max-width:none' }, d.intro),
    h('nav', { class: 'toc', 'aria-label': 'Mục lục' }, d.sections.map((s, i) => h('a', { href: location.pathname + '#s' + (i + 1) }, s.heading))),
    d.sections.map((s, i) => h('section', { class: 'lsec' }, h('h2', { id: 's' + (i + 1) }, s.heading),
      s.paragraphs.map((p) => h('p', {}, p)), s.items.length > 0 && h('ul', {}, s.items.map((x) => h('li', {}, x))))),
    h('div', { class: 'acts' }, h('a', { class: 'btn ghost', href: other[0] }, other[1]), h('a', { class: 'btn ghost', href: '/' }, '← Trang chủ'))));
  if (location.hash) { const el = document.getElementById(location.hash.slice(1)); if (el) el.scrollIntoView(); }
}
async function pageLegal(key) {
  const root = $('#app'); root.replaceChildren(skels(1));
  try { renderLegalDoc(await api('/api/legal'), key); } catch (e) { root.replaceChildren(errState(e.message, () => location.reload())); }
}

/** /login?next=... : khach => consent + nut Discord; da dang nhap nhung TOS/Rules doi version => xac nhan lai. */
async function pageLogin() {
  const root = $('#app'), q = new URLSearchParams(location.search);
  const raw = q.get('next') || '/account';
  const next = /^\/(?![\/\\])/.test(raw) && !/[\u0000-\u001f\\]/.test(raw) && !raw.startsWith('/login') && !raw.startsWith('/auth/') ? raw : '/account'; // server con kiem tra lai
  root.replaceChildren(skels(1));
  let d; try { d = await api('/api/auth/login-intent'); } catch (e) { root.replaceChildren(errState(e.message, () => location.reload())); return; }
  if (d.loggedIn && !d.consentRequired) { location.replace(next); return; }
  const msg = h('div', { class: 'err', role: 'alert' });
  const card = (title, ...kids) => root.replaceChildren(h('div', { class: 'panel narrow consent' }, h('h1', {}, title), ...kids));
  const links = h('p', { class: 'tnote' }, 'Trang mở trong tab mới. Xem thêm ', h('a', { href: '/tos', target: '_blank', rel: 'noopener noreferrer' }, 'TOS'), ' · ', h('a', { href: '/community-rules', target: '_blank', rel: 'noopener noreferrer' }, 'Luật cộng đồng'), '.');

  if (d.loggedIn) { // xac nhan lai phien ban moi
    const me = await getMe(), btn = h('button', { class: 'btn', style: 'width:100%', type: 'button' }, 'Tôi đồng ý và tiếp tục');
    btn.onclick = async () => {
      btn.disabled = true; msg.textContent = '';
      try { await api('/api/auth/consent', { method: 'POST', body: { agree: true }, headers: { 'X-CSRF-Token': me.csrfToken } }); location.replace(next); }
      catch (e) { msg.textContent = e.message; btn.disabled = false; }
    };
    card('Cập nhật điều khoản', h('p', {}, 'Terms of Service và Community Rules đã được cập nhật (phiên bản ' + d.termsVersion + '). Bằng cách tiếp tục, bạn xác nhận rằng bạn đã đọc và đồng ý với ', LEGAL_LINKS(), ' của website.'), msg, btn,
      h('p', { class: 'center' }, h('a', { href: '/' }, '← Về trang chủ')));
    return;
  }
  if (!d.discordEnabled || !d.token) { card('Đăng nhập bằng Discord', h('p', { class: 'muted' }, 'Đăng nhập Discord chưa được bật trên máy chủ này.'), h('p', { class: 'center' }, h('a', { href: '/' }, '← Về trang chủ'))); return; }

  const btn = h('button', { class: 'btn', style: 'width:100%', type: 'button' }, 'Đăng nhập bằng Discord');
  btn.onclick = async () => { // hanh dong dang nhap = bam nut nay; server ghi consent, khong nhan gi tu client ngoai token + next
    btn.disabled = true; msg.textContent = '';
    try {
      const r = await api('/api/auth/login', { method: 'POST', body: { token: d.token, next } });
      if (typeof r.redirect !== 'string' || !/^(https:\/\/discord\.com\/oauth2\/authorize\?|\/(?![\/\\]))/.test(r.redirect)) throw new Error('Phản hồi không hợp lệ');
      location.href = r.redirect;
    } catch (e) { msg.textContent = e.status === 403 ? 'Phiên đăng nhập hết hạn, đang tải lại…' : e.message; if (e.status === 403) setTimeout(() => location.reload(), 1200); else btn.disabled = false; }
  };
  card('Đăng nhập bằng Discord', h('p', {}, 'Bằng cách đăng nhập, bạn xác nhận rằng bạn đã đọc và đồng ý với ', h('a', { href: '/tos', target: '_blank', rel: 'noopener noreferrer' }, 'Terms of Service'), ' (TOS) và ', h('a', { href: '/community-rules', target: '_blank', rel: 'noopener noreferrer' }, 'Community Rules'), ' của website.'),
    msg, btn, links, h('p', { class: 'center' }, h('a', { href: '/' }, '← Về trang chủ')));
}

document.addEventListener('DOMContentLoaded', () => {
  const pg = { tos: () => pageLegal('tos'), rules: () => pageLegal('rules'), login: pageLogin }[document.body.dataset.page];
  if (pg) pg().catch((e) => { console.error(e); $('#app').replaceChildren(errState('Đã xảy ra lỗi không mong muốn.', () => location.reload())); });
});
