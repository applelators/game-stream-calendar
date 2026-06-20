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
  weekdayHps: 4.0,
  weekendHps: 8.0,
  weekdayStreams: 0,
  weekendStreams: 0,
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
  // Weekday vs weekend split: bucket each stream by the day of week it started on,
  // so the scheduler can credit longer weekend sessions (Sat/Sun) differently from
  // weekday sessions. Empty buckets fall back to the overall average.
  let wdH = 0, wdN = 0, weH = 0, weN = 0;
  for (const r of rows) {
    const h = (Number(r.length) || 0) / 60;
    const dt = String(r.startDateTime || r.starttime || '').slice(0, 10);
    const dd = dt ? new Date(dt + 'T00:00:00Z') : null;
    const dow = dd && !isNaN(dd.getTime()) ? dd.getUTCDay() : null; // 0 Sun .. 6 Sat
    if (dow === 0 || dow === 6) { weH += h; weN += 1; } else { wdH += h; wdN += 1; }
  }
  const overall = totalHours / numStreams;
  return {
    hoursPerStream: round(overall),
    hoursPerWeek: round(totalHours / weeks),
    streamsPerWeek: round(numStreams / weeks),
    weekdayHps: wdN ? round(wdH / wdN) : round(overall),
    weekendHps: weN ? round(weH / weN) : round(overall * 1.5),
    weekdayStreams: wdN,
    weekendStreams: weN,
    totalHours: round(totalHours, 1),
    numStreams,
    windowDays,
    source: 'sullygnome',
  };
}

// Fetch the channel's recent completed streams, normalized for the calendar:
//   { streams: [ { date:'YYYY-MM-DD', minutes, games:[{name, art}] } ], fetchedAt }
// `gamesplayed` is comma-separated "Name|Slug|boxartUrl" chunks; we keep the name
// and a small box-art URL per game. Never throws — returns an empty list on failure.
export async function fetchStreams(env, days = 45) {
  const channelId = (env && env.SULLYGNOME_CHANNEL_ID) || DEFAULT_SG_CHANNEL_ID;
  const login = (env && env.TWITCH_CHANNEL) || 'nabunan';
  const url =
    `https://sullygnome.com/api/tables/channeltables/streams/${days}/` +
    `${channelId}/%20/1/1/desc/0/100`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; game-stream-calendar/1.0; +stream-history)',
        Referer: `https://sullygnome.com/channel/${login}/${days}`,
        Accept: 'application/json, text/javascript, */*; q=0.01',
      },
    });
    if (!res.ok) throw new Error(`sullygnome HTTP ${res.status}`);
    const j = await res.json();
    const rows = Array.isArray(j.data) ? j.data : [];
    const streams = rows
      .map((r) => {
        const date = String(r.startDateTime || '').slice(0, 10);
        const games = String(r.gamesplayed || '')
          .split(',')
          .map((chunk) => {
            const p = chunk.split('|');
            if (!p[0]) return null;
            const art = (p[2] || '').replace(/-\d+x\d+\.jpg.*$/, '-72x96.jpg');
            return { name: p[0], art };
          })
          .filter(Boolean);
        return { date, minutes: Number(r.length) || 0, games };
      })
      .filter((s) => s.date);
    return { streams, fetchedAt: new Date().toISOString(), source: 'sullygnome' };
  } catch (err) {
    return { streams: [], fetchedAt: new Date().toISOString(), error: String(err && err.message ? err.message : err) };
  }
}

// TwitchTracker fallback. Its per-stream table is Cloudflare-protected, but the
// summary endpoint (aggregate minutes over a rolling ~30-day window) is fetchable.
// It can't give a stream count or a per-day breakdown, so it only refreshes
// hoursPerWeek — hoursPerStream and the weekday/weekend split are carried forward
// from the last good SullyGnome fetch (prevPace).
export const TT_WINDOW_DAYS = 30;

export function paceFromTwitchTracker(summary, prevPace) {
  const minutes = Number(summary && summary.minutes_streamed) || 0;
  if (!minutes) return null;
  const totalHours = minutes / 60;
  const hoursPerWeek = round(totalHours / (TT_WINDOW_DAYS / 7));
  const prev = prevPace || FALLBACK_PACE;
  const hoursPerStream = prev.hoursPerStream || FALLBACK_PACE.hoursPerStream;
  return {
    hoursPerStream,
    hoursPerWeek,
    streamsPerWeek: hoursPerStream ? round(hoursPerWeek / hoursPerStream) : prev.streamsPerWeek,
    weekdayHps: prev.weekdayHps || null,
    weekendHps: prev.weekendHps || null,
    weekdayStreams: prev.weekdayStreams || 0,
    weekendStreams: prev.weekendStreams || 0,
    totalHours: round(totalHours, 1),
    numStreams: null,
    windowDays: TT_WINDOW_DAYS,
    source: 'twitchtracker',
    note: 'TwitchTracker fallback: weekly hours from ~30-day summary; hours/stream + weekend split carried from the last SullyGnome fetch.',
  };
}

async function fetchTwitchTrackerSummary(env) {
  const login = (env && env.TWITCH_CHANNEL) || 'nabunan';
  const res = await fetch(`https://twitchtracker.com/api/channels/summary/${login}`, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
    },
  });
  if (!res.ok) throw new Error(`twitchtracker HTTP ${res.status}`);
  return res.json();
}

// Fetch + compute. Never throws. Source order: SullyGnome (per-stream, full
// weekday/weekend split) -> TwitchTracker (weekly hours only) -> last-known pace
// (prevPace) so a transient outage never wipes good data with a bare fallback.
export async function fetchPace(env, prevPace) {
  const channelId =
    (env && env.SULLYGNOME_CHANNEL_ID) || DEFAULT_SG_CHANNEL_ID;
  const login = (env && env.TWITCH_CHANNEL) || 'nabunan';
  const url =
    `https://sullygnome.com/api/tables/channeltables/streams/${WINDOW_DAYS}/` +
    `${channelId}/%20/1/1/desc/0/100`;
  // 1) SullyGnome (primary) — full per-stream data incl. weekend split.
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
    if (rows.length > 0) {
      return { ...computePace(rows), fetchedAt: new Date().toISOString() };
    }
    // empty payload -> fall through to TwitchTracker
  } catch (err) { /* fall through */ }
  // 2) TwitchTracker (fallback) — weekly hours; keep last-known stream length/split.
  try {
    const tt = paceFromTwitchTracker(await fetchTwitchTrackerSummary(env), prevPace);
    if (tt) return { ...tt, fetchedAt: new Date().toISOString() };
  } catch (err) { /* fall through */ }
  // 3) Last-known pace, else hardcoded fallback — never wipe good data.
  const base = prevPace && prevPace.hoursPerStream ? prevPace : FALLBACK_PACE;
  return {
    ...base,
    fetchedAt: new Date().toISOString(),
    error: 'sullygnome + twitchtracker unavailable',
  };
}
