'use strict';
const store = require('./store');
const { getState } = require('./state');

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const list = (await store.list()).filter((v) => v.enabled === true); // disabled: khong fetch
    const queue = list.slice();
    const worker = async () => {
      for (let v; (v = queue.shift());) {
        try { await getState(v); } catch (e) { console.warn(`[refresh] ${v.id}:`, e.message); }
      }
    };
    await Promise.all([worker(), worker()]);
  } catch (e) { console.warn('[refresh] tick error:', e.message); }
  finally { running = false; }
}
function start(intervalMs) {
  tick();
  return setInterval(tick, Math.max(15000, intervalMs));
}
module.exports = { start, tick };
