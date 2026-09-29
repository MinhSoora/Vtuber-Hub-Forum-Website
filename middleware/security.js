'use strict';
/**
 * Security headers bo sung (thay the vai tro cua "helmet" nhung khong can them dependency
 * moi - phu hop khi may build khong co mang de `npm install`).
 *
 * CSP duoc thiet ke khop voi code hien tai:
 *  - Khong co <script>/<style> inline nao trong public/*.html hay views/admin/*.html
 *    (da grep kiem tra) => script-src/style-src co the strict.
 *  - public/js/app.js nap them 1 script ngoai: challenges.cloudflare.com (Turnstile captcha).
 *  - public/js/app.js dung h() de set `el.style.cssText = ...` truc tiep bang JS (khong qua
 *    the <style> hay attribute HTML) => can 'unsafe-inline' trong style-src de khong vo giao dien.
 *  - Font Be Vietnam Pro nap tu Google Fonts (@import trong style.css) => style-src can fonts.googleapis.com, font-src can fonts.gstatic.com
 *    (thieu 2 dong nay trinh duyet chan CSS/font => trang admin mat font va vo giao dien).
 *  - Anh avatar/fanart/news lay tu YouTube & imgbb (nhieu domain khac nhau) => img-src https:.
 *  - public/js/app.js co 1 <iframe> toi livecounts.io (thong ke subscriber, nguoi dung tu bam
 *    moi hien) => can whitelist rieng trong frame-src.
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' https: data: blob:", // blob: = anh xem truoc truoc khi upload (URL.createObjectURL)
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self' https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com https://livecounts.io",
  "worker-src 'self'",
].join('; ');

function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-site',
  });
  // HSTS chi co y nghia tren HTTPS that su; bat sai tren HTTP (vd may dev) se gay loi truy cap.
  // req.secure phan anh dung ket noi thuc te khi 'trust proxy' duoc cau hinh dung sau reverse proxy.
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
}

module.exports = { securityHeaders, CSP };
