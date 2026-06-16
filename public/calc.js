// calc.js — pure date-precision + stream-pace helpers.
// Loaded and concatenated ahead of app.jsx (no module system), so everything
// here is plain top-level declarations shared with the app's eval scope.

const MS_DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];

// ---- dates -----------------------------------------------------------------

function utc(y, m /*1-12*/, d) {
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

function addDays(date, n) {
  return new Date(date.getTime() + n * MS_DAY);
}

function diffDays(a, b) {
  return Math.round((b.getTime() - a.getTime()) / MS_DAY);
}

// A "scheduled" release is one we can place on the timeline.
function isScheduled(release) {
  return !!(release && release.year && release.precision !== 'tbd');
}

// Earliest plausible release instant, or null for TBD / undated.
function anchorDate(release) {
  if (!isScheduled(release)) return null;
  const { year, month, day } = release;
  if (release.precision === 'day' && day) return utc(year, month, day);
  return utc(year, month || 1, 1);
}

// Human label honouring the date's precision (raw string wins when supplied).
function releaseLabel(release) {
  if (!release) return 'TBD';
  if (release.raw) return release.raw;
  if (!isScheduled(release)) return 'TBD';
  const { year, month, day, precision, quarter } = release;
  switch (precision) {
    case 'day': return `${MONTHS[(month || 1) - 1]} ${day}, ${year}`;
    case 'month': return `${MONTHS_LONG[(month || 1) - 1]} ${year}`;
    case 'quarter': return `Q${quarter || Math.floor(((month || 1) - 1) / 3) + 1} ${year}`;
    case 'year': return String(year);
    default: return String(year);
  }
}

// Fuzzy = anything coarser than an exact day (render hatched / tentative).
function isFuzzy(release) {
  return isScheduled(release) && release.precision !== 'day';
}

// Placeable on the timeline = precise enough to anchor (day/month/quarter).
// Year-only and TBD are too vague -> they live in the Unscheduled rail.
function isPlaceable(release) {
  return (
    isScheduled(release) &&
    (release.precision === 'day' ||
      release.precision === 'month' ||
      release.precision === 'quarter')
  );
}

// ---- games.json (friendly file format) -------------------------------------

const SEASON_Q = { spring: 2, summer: 3, fall: 4, autumn: 4, winter: 1, holiday: 4 };
const QUARTER_MONTH = { 1: 1, 2: 4, 3: 7, 4: 10 };

function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Parse a friendly date string from games.json into a release object.
//   "2026-06-25" day · "2026-08" month · "2026-Q3"/"Holiday 2026"/"Spring 2027"
//   quarter · "2026" year (rail) · "TBD"/"TBA ..." or anything unrecognized (rail)
//   also accepts "August 2026", "Nov 2027", "Jun 9, 2026"
function parseDate(str) {
  const s = (str == null ? '' : String(str)).trim();
  if (!s || /^(tbd|tba)\b/i.test(s)) return { precision: 'tbd', raw: s || 'TBD' };
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)))
    return { year: +m[1], month: +m[2], day: +m[3], precision: 'day' };
  if ((m = s.match(/^(\d{4})-(\d{2})$/)))
    return { year: +m[1], month: +m[2], precision: 'month' };
  if ((m = s.match(/^(\d{4})-Q([1-4])$/i)))
    return { year: +m[1], quarter: +m[2], month: QUARTER_MONTH[+m[2]], precision: 'quarter' };
  if ((m = s.match(/^(\d{4})$/)))
    return { year: +m[1], precision: 'year' };
  if ((m = s.match(/^(spring|summer|fall|autumn|winter|holiday)\s+(\d{4})$/i))) {
    const q = SEASON_Q[m[1].toLowerCase()];
    return { year: +m[2], quarter: q, month: QUARTER_MONTH[q], precision: 'quarter', raw: s };
  }
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(?:(\d{1,2}),?\s+)?(\d{4})$/))) {
    const idx = MONTHS_LONG.findIndex((x) => x.toLowerCase().startsWith(m[1].toLowerCase().slice(0, 3)));
    if (idx >= 0) {
      const y = +m[3];
      return m[2]
        ? { year: y, month: idx + 1, day: +m[2], precision: 'day' }
        : { year: y, month: idx + 1, precision: 'month' };
    }
  }
  if ((m = s.match(/^(\d{4})\b/))) return { year: +m[1], precision: 'year', raw: s };
  return { precision: 'tbd', raw: s };
}

// Build an internal game object from a games.json entry.
function gameFromFile(e, i) {
  const release = parseDate(e.date);
  if (e.dateLabel) release.raw = e.dateLabel;
  const g = {
    id: e.id || slugify(e.title) || ('g' + i),
    title: e.title || 'Untitled',
    release,
    kind: e.kind || 'game',
    backlog: !!e.backlog,   // catalog game scheduled at a planned start (not a new release)
    hltbHours: Number(e.hltbHours) || 0,
    hltbBasis: e.basis || e.hltbBasis || 'estimate',
    hltbNote: e.hltbNote || '',
    platforms: Array.isArray(e.platforms) ? e.platforms : [],
    editions: (e.editions || []).map((x) => ({
      name: x.name, msrpUSD: Number(x.price != null ? x.price : x.msrpUSD) || 0,
    })),
    earlyAccess: e.earlyAccess || '',
    notes: e.notes || '',
  };
  if (e.endDate) g.eventEnd = parseDate(e.endDate);
  return g;
}

// Turn a parsed games.json (array, or { games: [...] }) into internal games
// with unique ids.
function gamesFromFile(data) {
  const list = Array.isArray(data) ? data : (data && Array.isArray(data.games) ? data.games : []);
  const seen = {};
  return list.map((e, i) => {
    const g = gameFromFile(e, i);
    if (seen[g.id]) g.id = `${g.id}-${i}`;
    seen[g.id] = true;
    return g;
  });
}

// ---- pace ------------------------------------------------------------------

function streamsToFinish(hltbHours, pace) {
  if (!hltbHours || !pace || !pace.hoursPerStream) return 0;
  return Math.max(1, Math.ceil(hltbHours / pace.hoursPerStream));
}

function weeksToFinish(hltbHours, pace) {
  if (!hltbHours || !pace || !pace.hoursPerWeek) return 0;
  return hltbHours / pace.hoursPerWeek;
}

function daysToFinish(hltbHours, pace) {
  return weeksToFinish(hltbHours, pace) * 7;
}

// How many calendar days a game's bar should span.
//  - events: the explicit window length (release -> eventEnd)
//  - everything else: HLTB hours converted through the current pace
function gameDurationDays(game, pace) {
  if (game.kind === 'event' && game.eventEnd) {
    const start = anchorDate(game.release);
    const end = anchorDate(game.eventEnd);
    if (start && end) return Math.max(1, diffDays(start, end));
  }
  return Math.max(1, Math.round(daysToFinish(game.hltbHours, pace)));
}

// ---- vacations / time off --------------------------------------------------

// Vacations are stored as ISO date strings; normalize to [start, end) Date pairs
// (end-exclusive). During a vacation no streaming happens, so it doesn't count
// toward finishing a game — it just pushes the finish date later.
function parseISO(s) {
  if (!s || typeof s !== 'string') return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return utc(y, m, d);
}

function normalizeVacations(vacs) {
  return (vacs || [])
    .map((v) => {
      const start = parseISO(v.start);
      const end = parseISO(v.end);
      return start && end ? { start, end: addDays(end, 1), label: v.label || '' } : null;
    })
    .filter((v) => v && v.end > v.start);
}

function inVacation(date, normVacs) {
  return !!normVacs && normVacs.some((v) => date >= v.start && date < v.end);
}

// Walk forward from `start` until `activeDays` non-vacation (streaming) days have
// elapsed, returning the calendar end date — so vacations extend the window.
function addActiveDays(start, activeDays, normVacs) {
  if (!normVacs || normVacs.length === 0) return addDays(start, activeDays);
  let d = new Date(start), counted = 0, guard = 0;
  while (counted < activeDays && guard < 100000) {
    if (!inVacation(d, normVacs)) counted += 1;
    d = addDays(d, 1);
    guard += 1;
  }
  return d;
}

// ---- bar placement ---------------------------------------------------------

// Calendar end date of a game's bar starting at `start`.
//  - events: the explicit window end (release -> eventEnd), unaffected by pace
//  - everything else: HLTB hours through the pace, spread around any vacations
function gameEnd(game, start, pace, normVacs) {
  if (game.kind === 'event' && game.eventEnd) {
    const e = anchorDate(game.eventEnd);
    if (e) return e;
  }
  const activeDays = Math.max(1, Math.round(daysToFinish(game.hltbHours, pace)));
  return addActiveDays(start, activeDays, normVacs);
}

// Streaming days needed to finish a game at the current pace.
function activeDaysFor(game, pace) {
  return Math.max(1, Math.round(daysToFinish(game.hltbHours, pace)));
}

// Private day key (app.jsx defines its own `dayKey`; avoid redeclaring it here).
function dkey(d) { return d.getUTCFullYear() + '-' + d.getUTCMonth() + '-' + d.getUTCDate(); }

// Specific-day releases get a midnight launch the night before, so the eve is
// reserved (no progress on other games) and the release day itself plays the new
// game. Events don't count as "new game" launches. Returns the eve days (with the
// launching game) and the set of release days (which are exempt from blocking).
function launchEves(games) {
  const eveByDay = {}, releaseDays = {};
  const cutoff = utc(2026, 6, 1); // midnight launches only for releases June 2026+
  for (const g of (games || [])) {
    if (g.kind === 'event') continue;
    if (!(g.release && g.release.precision === 'day')) continue;
    const a = anchorDate(g.release);
    if (!a) continue;
    releaseDays[dkey(a)] = true; // any day a game starts is exempt from being an eve
    // Only genuine new releases (not backlog catalog games) dated June 2026+ get
    // a reserved midnight-launch eve.
    if (!g.backlog && a >= cutoff) {
      eveByDay[dkey(addDays(a, -1))] = { title: g.title, kind: g.kind, id: g.id };
    }
  }
  return { eveByDay, releaseDays };
}

// Each position is { start, end, segments:[{start,end}] }. Parallel/event games
// have a single segment; a preempted game in the queue has several.
//
// Parallel ("true dates"): every scheduled game sits on its real release date.
function scheduleParallel(games, pace, normVacs) {
  const out = {};
  for (const g of games) {
    const start = anchorDate(g.release);
    if (!start) continue;
    const end = gameEnd(g, start, pace, normVacs);
    out[g.id] = { start, end, segments: [{ start, end }] };
  }
  return out;
}

// Sequential ("my queue"): NEW RELEASES TAKE PRIORITY. On a game's release day you
// drop whatever you're playing and start the new one; the interrupted game is
// paused and resumed (most-recent-first) once the newer game is finished — so a
// game can be split into several segments. Vacations make no progress; events
// keep their fixed window and don't take part in the queue.
function scheduleSequential(games, pace, normVacs) {
  const out = {};
  const playable = [];
  for (const g of games) {
    const start = anchorDate(g.release);
    if (!start) continue;
    if (g.kind === 'event') {
      const end = gameEnd(g, start, pace, normVacs);
      out[g.id] = { start, end, segments: [{ start, end }] };
    } else {
      playable.push({ id: g.id, release: start, remaining: activeDaysFor(g, pace), open: null });
    }
  }
  if (playable.length === 0) return out;
  playable.sort((a, b) => (a.release - b.release) || (a.id < b.id ? -1 : 1));

  // Eve of each specific-day release = no progress (midnight-launch night).
  const { eveByDay, releaseDays } = launchEves(games);
  const blockedEve = (d) => { const k = dkey(d); return !!eveByDay[k] && !releaseDays[k]; };

  const segs = {};
  for (const p of playable) segs[p.id] = [];
  const closeSeg = (p, end) => { if (p.open && end > p.open) segs[p.id].push({ start: p.open, end }); p.open = null; };

  let idx = 0, cur = null, guard = 0;
  const stack = [];
  let day = new Date(playable[0].release);

  while (guard++ < 200000) {
    // 1) releases today preempt the current game (priority on release day)
    while (idx < playable.length && playable[idx].release <= day) {
      const next = playable[idx++];
      if (cur) { closeSeg(cur, day); stack.push(cur); }
      cur = next; cur.open = new Date(day);
    }
    // 2) nothing active -> jump to the next release, or stop if none remain
    if (!cur) {
      if (idx < playable.length) { day = new Date(playable[idx].release); continue; }
      break;
    }
    // 3) play the current game (no progress during vacations or launch eves)
    if (!inVacation(day, normVacs) && !blockedEve(day)) {
      cur.remaining -= 1;
      if (cur.remaining <= 0) {
        const fin = addDays(day, 1);
        closeSeg(cur, fin);
        cur = stack.length ? stack.pop() : null;
        if (cur) cur.open = new Date(fin);
        day = fin;
        continue;
      }
    }
    day = addDays(day, 1);
  }
  if (cur && cur.open) closeSeg(cur, day);
  for (const p of stack) if (p.open) closeSeg(p, day);

  for (const p of playable) {
    let s = segs[p.id];
    if (s.length === 0) { const e = addDays(p.release, 1); s = [{ start: p.release, end: e }]; }
    out[p.id] = { start: s[0].start, end: s[s.length - 1].end, segments: s };
  }
  return out;
}

function schedule(games, pace, mode /* 'parallel' | 'sequential' */, normVacs) {
  return mode === 'sequential'
    ? scheduleSequential(games, pace, normVacs)
    : scheduleParallel(games, pace, normVacs);
}

// Place each game's individual streams (1..N) on specific calendar days within its
// scheduled window. A game occupies M progress days (its band minus vacations and
// launch eves); we spread its N = streamsToFinish markers evenly across them — which
// matches the real cadence (band length / streams ≈ 7 / streams-per-week).
// Returns { [dayKey]: { id, idx, total } }.
function streamSessions(games, pace, positions, normVacs) {
  const { eveByDay, releaseDays } = launchEves(games);
  const blockedEve = (d) => { const k = dkey(d); return !!eveByDay[k] && !releaseDays[k]; };
  const byDay = {};
  for (const g of (games || [])) {
    if (g.kind === 'event') continue;
    const pos = positions[g.id];
    if (!pos) continue;
    const total = streamsToFinish(g.hltbHours, pace);
    if (!total) continue;
    const days = [];
    for (const seg of pos.segments)
      for (let d = new Date(seg.start); d < seg.end; d = addDays(d, 1)) {
        if (inVacation(d, normVacs) || blockedEve(d)) continue;
        days.push(new Date(d));
      }
    const M = days.length;
    if (!M) continue;
    for (let k = 1; k <= total; k++) {
      // 1/N on the first play day, N/N on the last, evenly spaced between.
      const di = total === 1 ? 0 : Math.min(M - 1, Math.round((k - 1) * (M - 1) / (total - 1)));
      byDay[dkey(days[di])] = { id: g.id, idx: k, total };
    }
  }
  return byDay;
}
