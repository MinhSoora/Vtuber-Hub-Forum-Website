'use strict';
/**
 * Lop chong spam dung chung cho Feed (bai viet, binh luan) va Fan Art:
 *   requireCaptcha() : xac minh Cloudflare Turnstile (token o body.captcha) tren server.
 *   honeypot()       : o an "hp" - nguoi that khong dien, bot thuong dien => tu choi.
 * Thu tu goi trong route: rate limit -> honeypot -> captcha -> nghiep vu (de ke tan cong khong "dot" duoc luot goi Cloudflare).
 */
const captcha = require('../services/captcha');
const { clientIp } = require('./rateLimit');

const fail = (res, status, error, code) => res.status(status).json({ success: false, error, ...(code ? { code } : {}) });

function requireCaptcha() {
  return async function captchaGuard(req, res, next) {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const token = body.captcha; delete body.captcha;   // khong de token lot xuong tang nghiep vu
    if (!captcha.enabled()) {
      // CAPTCHA_REQUIRED=true => fail-closed: chua cau hinh Turnstile thi khong cho ghi (khuyen nghi khi chay that).
      return process.env.CAPTCHA_REQUIRED === 'true' ? fail(res, 503, 'Máy chủ chưa cấu hình captcha, tạm thời không thể đăng.', 'captcha_unavailable') : next();
    }
    try { await captcha.verify(token, clientIp(req)); next(); }
    catch (e) {
      const st = e.status || 500;
      if (st >= 500 && st !== 502 && st !== 503) console.error('[captcha]', e.stack || e.message);
      fail(res, st, st >= 500 && st !== 502 && st !== 503 ? 'Lỗi máy chủ' : e.message, 'captcha_failed');
    }
  };
}

function honeypot(field = 'hp') {
  return function honeypotGuard(req, res, next) {
    const v = req.body && req.body[field];
    if (v !== undefined && v !== null && String(v).trim() !== '') return fail(res, 400, 'Yêu cầu không hợp lệ.', 'bad_request');
    if (req.body) delete req.body[field];
    next();
  };
}

module.exports = { requireCaptcha, honeypot };
