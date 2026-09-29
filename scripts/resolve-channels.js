'use strict';
/**
 * Doc data/vtubers.seed.json, doi @handle -> Channel ID (UC...) qua YouTube va ghi vao data/vtubers.json.
 * Chay:  node scripts/resolve-channels.js   (can Internet; co the chay lai, muc da co ID se bi bo qua)
 */
const fs = require('fs');
const path = require('path');
const yt = require('../services/youtube');
const SEED = path.join(__dirname, '..', 'data', 'vtubers.seed.json');
const OUT = path.join(__dirname, '..', 'data', 'vtubers.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  const out = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const bySlug = new Map(out.map((v) => [v.slug, v]));
  let ok = 0, fail = 0;
  for (const s of seed) {
    const v = bySlug.get(s.slug);
    if (!v || v.youtubeChannelId || !s.youtubeHandle) continue;
    try {
      v.youtubeChannelId = await yt.resolveChannelId(s.youtubeHandle); ok++;
      fs.writeFileSync(OUT, JSON.stringify(out, null, 2)); // luu dan de chay lai khong mat
      console.log('ok  ', s.youtubeHandle, v.youtubeChannelId);
    } catch (e) { fail++; console.warn('FAIL', s.youtubeHandle, e.message); }
    await sleep(1200); // nhe nhang voi YouTube
  }
  console.log(`Xong: ${ok} thanh cong, ${fail} loi.`);
})();
