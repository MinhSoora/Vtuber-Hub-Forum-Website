'use strict';
/** Upload anh len imgbb (API key nam o server). Dung chung cho Fan art va Tin tuc. */
const err = (status, message) => Object.assign(new Error(message), { status });

async function upload(b64, name) {
  const key = (process.env.IMGBB_API_KEY || '').trim();
  if (!key) throw err(503, 'Chưa cấu hình IMGBB_API_KEY trên máy chủ');
  const body = new URLSearchParams({ image: b64 }); if (name) body.set('name', name);
  let r, j;
  try { r = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(key)}`, { method: 'POST', body, signal: AbortSignal.timeout(30000) }); j = await r.json(); }
  catch { throw err(502, 'Không kết nối được imgbb'); }
  if (!r.ok || !j.success) throw err(502, 'imgbb từ chối ảnh: ' + ((j && j.error && j.error.message) || r.status));
  return j.data;
}
/** Kiem tra chuoi base64 hop le va kich thuoc (ky tu base64 ~ 1.33 x byte). */
function checkB64(image, max = 7e6) {
  if (typeof image !== 'string' || !image || !/^[A-Za-z0-9+/=]+$/.test(image)) throw err(400, 'Ảnh không hợp lệ');
  if (image.length > max) throw err(413, 'Ảnh quá lớn (tối đa ~5MB)');
  return image;
}
module.exports = { upload, checkB64, err };
