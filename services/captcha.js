'use strict';
/** Cloudflare Turnstile: xac minh token o server (secret KHONG bao gio gui ra client). */
const { err } = require('./imgbb');
const URL_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const siteKey = () => (process.env.TURNSTILE_SITE_KEY || '').trim();
const secret = () => (process.env.TURNSTILE_SECRET_KEY || '').trim();
const enabled = () => !!(siteKey() && secret());

async function verify(token, ip) {
  if (!enabled()) throw err(503, 'Chưa cấu hình Cloudflare Turnstile (TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY)');
  if (typeof token !== 'string' || !token || token.length > 2048) throw err(400, 'Vui lòng hoàn thành captcha');
  const body = new URLSearchParams({ secret: secret(), response: token }); if (ip) body.set('remoteip', ip);
  let j;
  try { j = await (await fetch(URL_VERIFY, { method: 'POST', body, signal: AbortSignal.timeout(10000) })).json(); }
  catch { throw err(502, 'Không kiểm tra được captcha lúc này, thử lại sau'); }
  if (!j || j.success !== true) throw err(400, 'Captcha không hợp lệ hoặc đã hết hạn, hãy thử lại');
  return true;
}
module.exports = { verify, enabled, siteKey };
