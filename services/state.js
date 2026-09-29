'use strict';
const yt = require('./youtube');
const cache = require('./cache');

/**
 * Chuan hoa 1 VTuber -> trang thai. Khong bao gio throw; moi nguon loi doc lap.
 * opts.cacheOnly: chi doc cache (khong goi mang) - dung cho request public danh sach.
 * opts.force: bo qua TTL (admin refresh).
 */
async function getState(v, opts = {}) {
  const id = v.youtubeChannelId || '';
  const base = {
    id: v.id, slug: v.slug, name: v.name, type: v.type === 'clipper' ? 'clipper' : 'vtuber', graduated: v.graduated === true, description: v.description || '', social: v.social || {},
    createdAt: v.createdAt || null, updatedAt: v.updatedAt || null,
  };
  if (!id) {
    return { ...base, channel: null, subscribers: null, avatar: v.avatar || null, status: 'unknown', isLive: 'unknown', live: null,
      upcoming: [], videos: [], videoCount: 0, videosKnown: false,
      meta: { noYoutube: true, stale: false, pending: false, errors: {}, updatedAt: null } };
  }
  const o = { force: !!opts.force, cacheOnly: !!opts.cacheOnly };
  const [ch, vids, live, up] = await Promise.allSettled([
    cache.get('channel', id, () => yt.fetchChannel(id), o),
    cache.get('videos', id, () => yt.fetchVideos(id), o),
    cache.get('live', id, () => yt.fetchLive(id), o),
    cache.get('upcoming', id, () => yt.fetchUpcoming(id), o),
  ]);
  const errors = {}; let pending = false;
  const val = (r, name) => {
    if (r.status === 'fulfilled') return r.value;
    if (r.reason && r.reason.code === 'NO_CACHE') pending = true; else errors[name] = r.reason.message;
    return null;
  };
  const c = val(ch, 'channel'), vd = val(vids, 'videos'), lv = val(live, 'live'), u = val(up, 'upcoming');

  const channel = {
    id,
    name: (c && c.data && c.data.name) || v.name,
    avatar: (c && c.data && c.data.avatar) || null,
    description: (c && c.data && c.data.description) || '',
    subscribers: (c && c.data && c.data.subscribers) || null,
    url: (c && c.data && c.data.url) || yt.channelUrl(id),
  };
  const isLive = lv ? lv.data.state : 'unknown';
  const liveObj = lv && lv.data.state ? lv.data.live : null;
  const upcoming = u ? u.data : [];
  let status = 'unknown';
  if (isLive === true) status = 'live';
  else if (isLive === false && u) status = upcoming.length ? 'upcoming' : 'offline';

  const liveIds = new Set([liveObj && liveObj.videoId, ...upcoming.map((x) => x.videoId)].filter(Boolean));
  const videos = vd ? vd.data.map((x) => (liveIds.has(x.id) ? { ...x, type: 'livestream' } : x)) : [];
  const got = [c, vd, lv, u].filter(Boolean);
  return {
    ...base, channel,
    subscribers: channel.subscribers,
    avatar: v.avatar || channel.avatar || null,   // avatar admin dat > avatar YouTube
    description: v.description || channel.description || '', // mo ta admin dat > mo ta kenh YouTube
    status, isLive, live: liveObj, upcoming, videos, videoCount: videos.length, videosKnown: !!vd,
    meta: { noYoutube: false, pending, stale: got.some((x) => x.stale), errors,
      updatedAt: Math.max(0, ...got.map((x) => x.fetchedAt)) || null },
  };
}
const summarize = (s, n = 4) => ({ ...s, videos: s.videos.slice(0, n) });
module.exports = { getState, summarize };
