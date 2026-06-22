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

      if (pathname === '/api/refresh-streams' && request.method === 'POST') {
        try {
          return json(await refreshStreams(env));
        } catch (e) {
          return json({ error: String(e.message || e) }, 502);
        }
      }

      return json({ error: 'not found' }, 404);
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
