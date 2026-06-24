// Cloudflare Worker: persistence + weekly stream-pace refresh + static assets.
//
//   GET  /api/state         -> stored games+settings doc (null if unset)
//   PUT  /api/state         -> overwrite the doc
//   GET  /api/pace          -> cached rolling-90-day pace { ...pace, fetchedAt }
//   POST /api/refresh-pace  -> refetch pace now, store, return it
//   (scheduled)             -> weekly cron refetches pace into KV
//   everything else         -> static assets

import { fetchPace, fetchStreams, FALLBACK_PACE } from './pace.js';

const STATE_KEY = 'state';
const PACE_KEY = 'pace';
const STREAMS_KEY = 'streams';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

async function refreshPace(env) {
  // Pass the last-known pace so a TwitchTracker fallback (weekly hours only) or a
  // total outage carries forward hours/stream + the weekday/weekend split.
  let prevPace = null;
  try { const raw = await env.CALENDAR_KV.get(PACE_KEY); prevPace = raw ? JSON.parse(raw) : null; } catch (e) { /* ignore */ }
  const pace = await fetchPace(env, prevPace);
  await env.CALENDAR_KV.put(PACE_KEY, JSON.stringify(pace));
  return pace;
}

async function refreshStreams(env) {
  const data = await fetchStreams(env);
  await env.CALENDAR_KV.put(STREAMS_KEY, JSON.stringify(data));
  return data;
}

// Live "on-air" state from Twitch Helix. Needs TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET
// (app access token via client-credentials). No creds -> { live:false, configured:false }
// so the frontend just falls back to its manual preview toggle. Token cached per isolate.
let _ttToken = null; // { token, exp }
async function twitchToken(env) {
  if (_ttToken && _ttToken.exp > Date.now() + 60000) return _ttToken.token;
  const url = 'https://id.twitch.tv/oauth2/token?client_id=' + encodeURIComponent(env.TWITCH_CLIENT_ID) +
    '&client_secret=' + encodeURIComponent(env.TWITCH_CLIENT_SECRET) + '&grant_type=client_credentials';
  const r = await fetch(url, { method: 'POST' });
  if (!r.ok) throw new Error('twitch token HTTP ' + r.status);
  const j = await r.json();
  _ttToken = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return _ttToken.token;
}
async function fetchLive(env) {
  const login = (env && env.TWITCH_CHANNEL) || 'nabunan';
  if (!env || !env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) {
    return { live: false, configured: false, login, fetchedAt: new Date().toISOString() };
  }
  try {
    const token = await twitchToken(env);
    const r = await fetch('https://api.twitch.tv/helix/streams?user_login=' + encodeURIComponent(login),
      { headers: { 'Client-ID': env.TWITCH_CLIENT_ID, Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error('helix HTTP ' + r.status);
    const j = await r.json();
    const s = (j.data && j.data[0]) || null;
    return s
      ? { live: true, configured: true, login, title: s.title, gameName: s.game_name, viewers: s.viewer_count, startedAt: s.started_at, fetchedAt: new Date().toISOString() }
      : { live: false, configured: true, login, fetchedAt: new Date().toISOString() };
  } catch (e) {
    return { live: false, configured: true, error: String(e.message || e), login, fetchedAt: new Date().toISOString() };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname.startsWith('/api/')) {
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: CORS });
      }

      if (pathname === '/api/state') {
        if (request.method === 'GET') {
          const state = await env.CALENDAR_KV.get(STATE_KEY);
          return new Response(state ?? 'null', {
            headers: { ...CORS, 'Content-Type': 'application/json' },
          });
        }
        if (request.method === 'PUT' || request.method === 'POST') {
          try {
            const body = await request.json();
            await env.CALENDAR_KV.put(STATE_KEY, JSON.stringify(body));
            return json({ ok: true });
          } catch (e) {
            return json({ error: String(e.message || e) }, 400);
          }
        }
      }

      if (pathname === '/api/pace' && request.method === 'GET') {
        const cached = await env.CALENDAR_KV.get(PACE_KEY);
        if (cached) {
          return new Response(cached, {
            headers: { ...CORS, 'Content-Type': 'application/json' },
          });
        }
        // Nothing cached yet — return the fallback without blocking on a fetch.
        return json({ ...FALLBACK_PACE, fetchedAt: null });
      }

      if (pathname === '/api/refresh-pace' && request.method === 'POST') {
        try {
          const pace = await refreshPace(env);
          return json(pace);
        } catch (e) {
          return json({ error: String(e.message || e) }, 502);
        }
      }

      // Recent completed streams (date + games + box art), for the "already
      // streamed" overlay on past calendar days. Cached in KV; refreshed weekly.
      if (pathname === '/api/streams' && request.method === 'GET') {
        const cached = await env.CALENDAR_KV.get(STREAMS_KEY);
        if (cached) {
          return new Response(cached, {
            headers: { ...CORS, 'Content-Type': 'application/json' },
          });
        }
        // Cold cache — fetch once so the first visit still shows history.
        try {
          return json(await refreshStreams(env));
        } catch (e) {
          return json({ streams: [], fetchedAt: null, error: String(e.message || e) });
        }
      }

      // Live on-air state (Twitch Helix). Cached ~45s in KV to avoid hammering the API.
      if (pathname === '/api/live' && request.method === 'GET') {
        try {
          const raw = await env.CALENDAR_KV.get('live');
          if (raw) { const c = JSON.parse(raw); if (c && c.fetchedAt && Date.now() - new Date(c.fetchedAt).getTime() < 45000) return json(c); }
        } catch (e) { /* ignore */ }
        const data = await fetchLive(env);
        try { await env.CALENDAR_KV.put('live', JSON.stringify(data)); } catch (e) { /* ignore */ }
        return json(data);
      }

      if (pathname === '/api/refresh-streams' && request.method === 'POST') {
        try {
          return json(await refreshStreams(env));
        } catch (e) {
          return json({ error: String(e.message || e) }, 502);
        }
      }

      return json({ error: 'not found' }, 404);
    }

    // Short cover-art links: /c/<slug> -> 302 to the game's square cover CDN url.
    // Slug = slugified collection or base title (parts consolidated), matching covers.html.
    if (pathname.startsWith('/c/')) {
      const slug = decodeURIComponent(pathname.slice(3)).replace(/\/+$/, '');
      try {
        const res = await env.ASSETS.fetch(new URL('/games.json', request.url));
        const data = await res.json();
        const arr = Array.isArray(data) ? data : (data && data.games) || [];
        const sl = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const base = (t) => String(t || '').replace(/\s*—\s*pt\.?\s*\d+.*$/i, '').trim();
        const map = {};
        for (const g of arr) {
          if (!g.icon) continue;
          const key = sl(g.collection || base(g.title));
          if (!map[key]) map[key] = g.icon; // first part with art wins (consolidated)
        }
        const icon = map[slug];
        if (icon) return Response.redirect(icon, 302);
        return new Response('Cover not found', { status: 404 });
      } catch (e) {
        return new Response('Error: ' + String(e.message || e), { status: 500 });
      }
    }

    // Everything else -> static assets
    return env.ASSETS.fetch(request);
  },

  // Daily cron (~5am ET) — re-pull SullyGnome so past days lock in to what was
  // actually streamed, and keep the rolling pace fresh.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshStreams(env));
    ctx.waitUntil(refreshPace(env));
  },
};
