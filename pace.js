// pace.js — rolling 90-day stream-pace fetch + compute.
//
// Source is isolated here so it can be swapped without touching the rest of the
// app. Primary source: SullyGnome's channel streams table (public JSON), which
// retains long-range history (Twitch's own Helix `videos` archives expire after
// ~14 days for affiliates, so they can't cover a 90-day window).
//
// Endpoint shape (verified):
//   https://sullygnome.com/api/tables/channeltables/streams/{days}/{channelId}/%20/1/1/desc/0/{pageSize}
//   -> { recordsTotal, data: [ { length /* minutes */, starttime, ... }, ... ] }

export const WINDOW_DAYS = 90;

// Used until the first successful fetch (or when the source is unreachable).
// Snapshot of @nabunan's real last-90-days figures at build time.
export const FALLBACK_PACE = {
  hoursPerStream: 5.11,
  hoursPerWeek: 11.52,
  streamsPerWeek: 2.26,
  totalHours: 148.1,
  numStreams: 29,
  windowDays: WINDOW_DAYS,
  source: 'fallback',
};

// SullyGnome numeric channel id for @nabunan. Overridable via env for reuse.
const DEFAULT_SG_CHANNEL_ID = '41050006';

function round(n, p = 2) {
  const f = 10 ** p;
  return Math.round(n * f) / f;
}

// Pure: turn an array of stream rows ({ length: minutes }) into a pace object.
export function computePace(rows, windowDays = WINDOW_DAYS) {
  const numStreams = rows.length;
  const totalMinutes = rows.reduce((s, r) => s + (Number(r.length) || 0), 0);
  const totalHours = totalMinutes / 60;
  const weeks = windowDays / 7;
  if (numStreams === 0 || totalHours === 0) {
    return { ...FALLBACK_PACE, source: 'fallback-empty' };
  }
  return {
    hoursPerStream: round(totalHours / numStreams),
    hoursPerWeek: round(totalHours / weeks),
    streamsPerWeek: round(numStreams / weeks),
    totalHours: round(totalHours, 1),
    numStreams,
    windowDays,
    source: 'sullygnome',
  };
}

// Fetch + compute. Never throws — returns FALLBACK_PACE on any failure so the
// caller (scheduled handler / API route) can always write something to KV.
export async function fetchPace(env) {
  const channelId =
    (env && env.SULLYGNOME_CHANNEL_ID) || DEFAULT_SG_CHANNEL_ID;
  const login = (env && env.TWITCH_CHANNEL) || 'nabunan';
  const url =
    `https://sullygnome.com/api/tables/channeltables/streams/${WINDOW_DAYS}/` +
    `${channelId}/%20/1/1/desc/0/100`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; game-stream-calendar/1.0; +pace-refresh)',
        Referer: `https://sullygnome.com/channel/${login}/90`,
        Accept: 'application/json, text/javascript, */*; q=0.01',
      },
    });
    if (!res.ok) throw new Error(`sullygnome HTTP ${res.status}`);
    const json = await res.json();
    const rows = Array.isArray(json.data) ? json.data : [];
    const pace = computePace(rows);
    return { ...pace, fetchedAt: new Date().toISOString() };
  } catch (err) {
    return {
      ...FALLBACK_PACE,
      fetchedAt: new Date().toISOString(),
      error: String(err && err.message ? err.message : err),
    };
  }
}
