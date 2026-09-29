'use strict';
/** Dong gop / chinh sua noi dung: kiem tra du lieu roi gui ve Discord webhook (URL nam trong .env, KHONG bao gio gui ra client). */
const { err } = require('./imgbb');

const KINDS = {
  add:    { label: 'Thêm VTuber / Clipper mới', color: 0x12a66b },
  edit:   { label: 'Chỉnh sửa thông tin',        color: 0x3355ff },
  remove: { label: 'Báo sai / đề nghị gỡ',       color: 0xe5324b },
  other:  { label: 'Góp ý khác',                 color: 0x5d647b },
};
// Chi chap nhan webhook that su cua Discord (chong SSRF neu .env bi sua nham)
const HOOK_RE = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+$/;

const hookUrl = () => (process.env.DISCORD_WEBHOOK_URL || '').trim();
const enabled = () => HOOK_RE.test(hookUrl());

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max) : '');
const isUrl = (u) => { try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:'; } catch { return false; } };
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
/** Vo hieu hoa @everyone / @here / <@id> trong noi dung nguoi dung nhap (allowed_mentions cung chan them mot lop). */
const defang = (s) => s.replace(/@/g, '@\u200b');

/** Chuan hoa + kiem tra. Nem loi 400 (co `field`) neu sai. */
function validate(b = {}) {
  const bad = (field, message) => Object.assign(err(400, message), { field });
  const kind = clean(b.kind, 10);
  if (!KINDS[kind]) throw bad('kind', 'Loại đóng góp không hợp lệ');
  const o = {
    kind,
    targetType: clean(b.targetType, 10) === 'clipper' ? 'Clipper' : 'VTuber',
    target: clean(b.target, 80),
    name: clean(b.name, 80),
    channel: clean(b.channel, 200),
    link: clean(b.link, 300),
    content: clean(b.content, 1500),
    sender: clean(b.sender, 60),
    contact: clean(b.contact, 100),
  };
  if ((kind === 'edit' || kind === 'remove') && !o.target) throw bad('target', 'Hãy chọn VTuber / Clipper cần chỉnh sửa');
  if (kind === 'add' && o.name.length < 2) throw bad('name', 'Hãy nhập tên VTuber / Clipper (ít nhất 2 ký tự)');
  if (o.content.length < 10) throw bad('content', 'Nội dung quá ngắn (ít nhất 10 ký tự)');
  if (o.link && !isUrl(o.link)) throw bad('link', 'Liên kết tham khảo phải bắt đầu bằng http:// hoặc https://');
  return o;
}

function embed(o, ip) {
  const f = (name, value, inline = false) => (value ? { name, value: cut(defang(value), 1024), inline } : null);
  const fields = [
    f('Loại', KINDS[o.kind].label, true),
    o.kind === 'add' ? f('Phân loại', o.targetType, true) : null,
    o.kind === 'add' ? f('Tên', o.name, true) : f('Đối tượng', o.target, true),
    o.kind === 'add' ? f('Kênh YouTube', o.channel) : null,
    f('Nội dung', o.content),
    f('Liên kết tham khảo', o.link),
    f('Người gửi', o.sender, true),
    f('Liên hệ', o.contact, true),
  ].filter(Boolean);
  return {
    title: cut('📝 ' + KINDS[o.kind].label, 256),
    color: KINDS[o.kind].color,
    fields,
    footer: { text: 'VTuber Hub · IP ' + (ip || 'không rõ') },
    timestamp: new Date().toISOString(),
  };
}

async function send(o, ip) {
  if (!enabled()) throw err(503, 'Chức năng đóng góp chưa được cấu hình (DISCORD_WEBHOOK_URL)');
  let r;
  try {
    r = await fetch(hookUrl(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'VTuber Hub', embeds: [embed(o, ip)], allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(10000),
    });
  } catch { throw err(502, 'Không gửi được tới Discord lúc này, thử lại sau'); }
  if (!r.ok) { console.error('[contribute] Discord trả về', r.status); throw err(502, 'Discord từ chối tin nhắn, hãy thử lại sau'); }
  return true;
}
module.exports = { validate, send, enabled, KINDS, embed };
