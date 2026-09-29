'use strict';
/**
 * YouTube adapter - KHONG dung API key. Nguon: RSS/Atom + HTML public (ytInitialData/ytInitialPlayerResponse).
 * Interface public (frontend/API khong phu thuoc nguon):
 *   fetchChannel(id) -> {id,name,avatar,url}
 *   fetchVideos(id)  -> Video[]
 *   fetchLive(id)    -> {state:true|false, live:null|{...}}
 *   fetchUpcoming(id)-> Upcoming[]
 * Neu YouTube doi cau truc => nem loi (khong tra du lieu gia).
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' };
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const MAX_VIDEOS = 15;

class YtError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

async function http(url, timeout = 10000) {
  let res;
  try {
    res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
  } catch (e) {
    throw new YtError(e.name === 'TimeoutError' ? 'Request timeout' : `Network error: ${e.message}`, 'NETWORK');
  }
  if (res.status === 404) throw new YtError('Not found', 'NOT_FOUND');
  if (!res.ok) throw new YtError(`HTTP ${res.status}`, 'HTTP');
  if (res.url.includes('consent.youtube.com')) throw new YtError('YouTube consent page', 'CONSENT');
  return { text: await res.text(), url: res.url };
}

const decode = (s = '') => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
const tag = (s, name) => {
  const m = s.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1].trim()) : null;
};

function parseFeed(xml) {
  if (!xml.includes('<feed')) throw new YtError('Feed format changed', 'PARSE');
  const first = xml.indexOf('<entry>');
  const head = first === -1 ? xml : xml.slice(0, first);
  const channelName = tag(head, 'name') || tag(head, 'title');
  const entries = [];
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = re.exec(xml)) && entries.length < MAX_VIDEOS) {
    const e = m[1];
    const id = tag(e, 'yt:videoId');
    if (!id || !/^[\w-]{11}$/.test(id)) continue;
    const href = (e.match(/<link rel="alternate" href="([^"]+)"/) || [])[1];
    const thumb = (e.match(/<media:thumbnail url="([^"]+)"/) || [])[1];
    entries.push({
      id,
      title: tag(e, 'title') || '',
      thumbnail: thumb ? decode(thumb) : null,
      publishedAt: tag(e, 'published'),
      url: href ? decode(href) : `https://www.youtube.com/watch?v=${id}`,
    });
  }
  return { channelName, entries };
}

function extractJson(html, markers) {
  for (const marker of markers) {
    const i = html.indexOf(marker);
    if (i < 0) continue;
    const s = html.indexOf('{', i);
    if (s < 0) continue;
    let depth = 0, inStr = false, esc = false;
    for (let j = s; j < html.length; j++) {
      const c = html[j];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try { return JSON.parse(html.slice(s, j + 1)); } catch { break; }
      }
    }
  }
  return null;
}

function walk(node, fn) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, fn));
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) { fn(k, v); walk(v, fn); }
  }
}

const bestThumb = (t) => (t && t.thumbnails && t.thumbnails.length ? t.thumbnails[t.thumbnails.length - 1].url : null);
const assertId = (id) => { if (!CHANNEL_ID_RE.test(id)) throw new YtError('Invalid channel id', 'INVALID'); };
const channelUrl = (id) => `https://www.youtube.com/channel/${id}`;

async function fetchFeed(id) {
  assertId(id);
  try {
    const { text } = await http(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);
    return parseFeed(text);
  } catch (e) {
    if (e.code === 'NOT_FOUND') throw new YtError('Channel không tồn tại hoặc đã bị xóa', 'NOT_FOUND');
    throw e;
  }
}

async function fetchChannel(id) {
  const feed = await fetchFeed(id);
  let avatar = null, description = '', subscribers = null;
  try {
    const { text } = await http(channelUrl(id));
    const m = text.match(/<meta property="og:image" content="([^"]+)"/) || text.match(/<meta content="([^"]+)" property="og:image"/);
    if (m) avatar = decode(m[1]);
    // Mo ta kenh: uu tien ban day du trong ytInitialData, fallback sang meta description (bi cat ngan).
    try {
      const data = extractJson(text, ['ytInitialData = ', 'ytInitialData=']);
      const d = data && data.metadata && data.metadata.channelMetadataRenderer && data.metadata.channelMetadataRenderer.description;
      if (typeof d === 'string') description = d.trim();
      if (data) walk(data, (k, v) => { // so nguoi dang ky (best-effort, dang chuoi nhu "562K subscribers")
        if (subscribers) return;
        if (k === 'subscriberCountText' && v && typeof v.simpleText === 'string') subscribers = v.simpleText;
        else if (k === 'content' && typeof v === 'string' && /^[\d.,]+\s*[KMB]?\s+subscribers?$/i.test(v.trim())) subscribers = v.trim();
      });
    } catch { /* bo qua */ }
    if (!description) {
      const dm = text.match(/<meta property="og:description" content="([^"]*)"/) || text.match(/<meta name="description" content="([^"]*)"/);
      if (dm) description = decode(dm[1]).trim();
    }
  } catch { /* avatar/mo ta la best-effort */ }
  return { id, name: feed.channelName || null, avatar, description: description.slice(0, 500), subscribers, url: channelUrl(id) };
}

async function fetchVideos(id) {
  const feed = await fetchFeed(id);
  return feed.entries.map((e) => ({
    id: e.id, title: e.title, thumbnail: e.thumbnail, publishedAt: e.publishedAt, url: e.url,
    channelId: id, channelName: feed.channelName,
    // Chi xac dinh chac chan khi URL la /shorts/; livestream duoc gan o lop state khi khop live/upcoming.
    type: e.url.includes('/shorts/') ? 'short' : 'unknown',
  }));
}

async function fetchLive(id) {
  assertId(id);
  const { text } = await http(`${channelUrl(id)}/live`);
  const canonical = (text.match(/<link rel="canonical" href="([^"]+)"/) || [])[1] || '';
  if (!canonical.includes('watch?v=')) {
    if (!text.includes('ytInitialData')) throw new YtError('Unexpected page structure', 'PARSE');
    return { state: false, live: null };
  }
  const pr = extractJson(text, ['ytInitialPlayerResponse = ', 'ytInitialPlayerResponse=']);
  if (!pr || !pr.videoDetails) throw new YtError('Unexpected page structure', 'PARSE');
  const vd = pr.videoDetails;
  const lbd = pr.microformat && pr.microformat.playerMicroformatRenderer && pr.microformat.playerMicroformatRenderer.liveBroadcastDetails;
  const isLive = vd.isLive === true || (lbd && lbd.isLiveNow === true);
  if (!isLive || (vd.channelId && vd.channelId !== id)) return { state: false, live: null };

  let viewerCount = null;
  const data = extractJson(text, ['ytInitialData = ', 'ytInitialData=']);
  if (data) {
    walk(data, (k, v) => {
      if (k === 'videoViewCountRenderer' && viewerCount === null && v && v.isLive && v.viewCount) {
        const t = v.viewCount.simpleText || (v.viewCount.runs || []).map((r) => r.text).join('');
        const n = Number(String(t).replace(/[^\d]/g, ''));
        if (t && Number.isFinite(n) && /\d/.test(t)) viewerCount = n;
      }
    });
  }
  return {
    state: true,
    live: {
      videoId: vd.videoId, title: vd.title || '', thumbnail: bestThumb(vd.thumbnail),
      startTime: (lbd && lbd.startTimestamp) || null, viewerCount,
      url: `https://www.youtube.com/watch?v=${vd.videoId}`,
      channel: { id, name: vd.author || null, url: channelUrl(id) },
    },
  };
}

async function fetchUpcoming(id) {
  assertId(id);
  const { text } = await http(`${channelUrl(id)}/streams`);
  const data = extractJson(text, ['ytInitialData = ', 'ytInitialData=']);
  if (!data) throw new YtError('Unexpected page structure', 'PARSE');
  const out = new Map();
  walk(data, (k, v) => {
    if (k !== 'videoRenderer' || !v || !v.videoId || !v.upcomingEventData) return;
    const ts = Number(v.upcomingEventData.startTime);
    if (!Number.isFinite(ts) || ts <= 0) return;
    out.set(v.videoId, {
      videoId: v.videoId,
      title: (v.title && (v.title.simpleText || (v.title.runs || []).map((r) => r.text).join(''))) || '',
      thumbnail: bestThumb(v.thumbnail),
      scheduledStartTime: new Date(ts * 1000).toISOString(),
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
      channel: { id, url: channelUrl(id) },
    });
  });
  return [...out.values()].sort((a, b) => a.scheduledStartTime.localeCompare(b.scheduledStartTime));
}


const HANDLE_RE = /^@[A-Za-z0-9._-]{3,30}$/;
/**
 * Chap nhan: Channel ID (UC...), URL youtube.com/channel/UC..., URL/handle @name.
 * Chi tao URL youtube.com do chinh server dung (khong fetch URL tuy y => tranh SSRF).
 */
async function resolveChannelId(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new YtError('Chưa nhập YouTube channel', 'INVALID');
  if (CHANNEL_ID_RE.test(raw)) return raw;
  let handle = null;
  if (HANDLE_RE.test(raw)) handle = raw;
  else {
    let u;
    try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { throw new YtError('URL/ID YouTube không hợp lệ', 'INVALID'); }
    const host = u.hostname.replace(/^(www|m)\./, '');
    if (host !== 'youtube.com') throw new YtError('Chỉ hỗ trợ URL youtube.com', 'INVALID');
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'channel' && CHANNEL_ID_RE.test(parts[1] || '')) return parts[1];
    if (parts[0] && HANDLE_RE.test(decodeURIComponent(parts[0]))) handle = decodeURIComponent(parts[0]);
    else throw new YtError('Không nhận ra URL kênh (dùng /channel/UC... hoặc /@handle)', 'INVALID');
  }
  const { text } = await http(`https://www.youtube.com/${handle}`);
  const m = text.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})"/)
    || text.match(/"externalId":"(UC[A-Za-z0-9_-]{22})"/) || text.match(/"channelId":"(UC[A-Za-z0-9_-]{22})"/);
  if (!m) throw new YtError(`Không tìm thấy channel cho ${handle}`, 'NOT_FOUND');
  return m[1];
}

module.exports = { resolveChannelId, _internal: { parseFeed, extractJson, walk }, fetchChannel, fetchVideos, fetchLive, fetchUpcoming, CHANNEL_ID_RE, YtError, channelUrl };
