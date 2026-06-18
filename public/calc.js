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
    bonus: !!e.bonus,       // optional "if there's time" game — excluded from the committed schedule
    binge: !!e.binge,       // play start-to-finish without interleaving (default: interleave)
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
  // Optional visual: an emoji, or an image URL/path. Falls back to a colour monogram.
  if (e.icon) g.icon = String(e.icon);
  // Optional band colour (hex) derived from the cover art, so the band complements it.
  if (e.iconColor) g.iconColor = String(e.iconColor);
  // Optional deadline: finish this game before another game's release (by id/slug)
  // or before a date string. Grouped games are packed to finish before the target.
  if (e.finishBefore) g.finishBefore = String(e.finishBefore);
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

// Sequential ("my queue"): an INTERLEAVED stream plan. Each game needs N streams
// (streamsToFinish); streams happen at the real ~streamsPerWeek cadence and are
// shared round-robin among all games that are concurrently in progress, so you
// alternate between active games instead of bingeing one to completion. A game
// flagged `binge` holds the rotation once started until it's finished. New specific-
// day releases still get their midnight-launch session on release day. Bonus games
// only take a slot when no committed game needs it. Vacations/eves make no progress.
// When a finish-before group can't fit at the base cadence, the plan BOOSTS that
// window: it streams every available day and (if even daily isn't enough) lengthens
// the streams, so those games finish by the deadline — still following the rules
// (interleave non-binge, binge games hold, launch on release day). Returns
// { positions, sessionByDay, bonusByDay, boosts } where boosts[key] describes the
// extra cadence needed (days, hours/stream, hours/week, whether it fits).
function streamPlan(games, pace, normVacs, today) {
  const out = {};                  // positions {start,end,segments}
  const sessionByDay = {};         // dayKey -> {id, idx, total} (committed)
  const bonusByDay = {};           // dayKey -> id (bonus fills spare slots)
  const boosts = {};               // finishBefore key -> { days, usualDays, hps, hpw, fits }
  const byId = {};
  for (const g of (games || [])) byId[g.id] = g;
  const committed = [], bonusList = [];
  for (const g of (games || [])) {
    const start = anchorDate(g.release);
    if (!start) continue;
    if (g.kind === 'event') {
      const end = gameEnd(g, start, pace, normVacs);
      out[g.id] = { start, end, segments: [{ start, end }] };
      continue;
    }
    const streams = streamsToFinish(g.hltbHours, pace);
    if (!streams) continue;
    (g.bonus ? bonusList : committed).push({ id: g.id, start, streams, done: 0, binge: !!g.binge,
      hltb: Number(g.hltbHours) || 0, finishBefore: g.finishBefore, lastSlot: -Infinity, slots: [] });
  }
  const all = committed.concat(bonusList);
  if (all.length === 0) return { positions: out, sessionByDay, bonusByDay, boosts };

  const baseHps = (pace && pace.hoursPerStream) || 5;
  const spw = (pace && pace.hoursPerStream && pace.hoursPerWeek) ? pace.hoursPerWeek / pace.hoursPerStream : 2;
  const perDay = Math.max(0.01, spw / 7);
  const { eveByDay, releaseDays } = launchEves(games);
  const blockedEve = (d) => { const k = dkey(d); return !!eveByDay[k] && !releaseDays[k]; };
  const launchOnDay = {};
  for (const p of committed) {
    const ev = eveByDay[dkey(addDays(p.start, -1))];
    if (ev && ev.id === p.id) launchOnDay[dkey(p.start)] = p.id;
  }
  const nowD = today || new Date();
  const t0 = utc(nowD.getUTCFullYear(), nowD.getUTCMonth() + 1, nowD.getUTCDate());

  // ---- boost windows from infeasible finish-before groups ----
  const groups = {};
  for (const p of committed) {
    if (!p.finishBefore) continue;
    const dl = finishBeforeDeadline(byId[p.id], byId);
    if (!dl) continue;
    (groups[p.finishBefore] = groups[p.finishBefore] || { deadline: dl, members: [] }).members.push(p);
  }
  const boostWindows = [];
  for (const key in groups) {
    const { deadline, members } = groups[key];
    let earliest = null; for (const m of members) if (!earliest || m.start < earliest) earliest = m.start;
    const winStart = earliest && earliest > t0 ? earliest : t0;
    if (winStart >= deadline) continue;
    let availDays = 0;
    for (let d = new Date(winStart); d < deadline; d = addDays(d, 1)) if (!inVacation(d, normVacs) && !blockedEve(d)) availDays++;
    if (availDays <= 0) continue;
    const baseTotal = members.reduce((s, m) => s + m.streams, 0);
    // only boost when the base cadence genuinely can't make it (15% margin avoids noise)
    if (baseTotal <= availDays * perDay * 1.15 + 0.001) continue;
    // lengthen streams only if even one-per-day wouldn't fit
    let hps = baseHps, guard = 0;
    const sumCeil = (h) => members.reduce((s, m) => s + Math.max(1, Math.ceil(m.hltb / h)), 0);
    while (sumCeil(hps) > availDays && hps < 24 && guard++ < 400) hps += 0.1;
    const boostedStreams = sumCeil(hps);
    const fits = boostedStreams <= availDays;
    const reqPerDay = Math.min(1, boostedStreams / availDays); // spread evenly across the window
    const ids = new Set();
    for (const m of members) { m.streams = Math.max(1, Math.ceil(m.hltb / hps)); ids.add(m.id); }
    boostWindows.push({ start: winStart, deadline, ids, key, reqPerDay });
    boosts[key] = { days: availDays, usualDays: Math.max(1, Math.round(availDays / 7 * spw)),
      hps: Math.round(hps * 10) / 10, hpw: Math.round(reqPerDay * 7 * hps * 10) / 10, fits };
  }

  let earliest = null;
  for (const p of all) if (!earliest || p.start < earliest) earliest = p.start;
  let day = new Date(Math.max(earliest.getTime(), t0.getTime())), acc = 0, guard = 0;
  let remaining = all.reduce((s, p) => s + p.streams, 0);
  const pickRR = (pool) => { pool.sort((a, b) => (a.lastSlot - b.lastSlot) || (a.done - b.done) || (a.start - b.start) || (a.id < b.id ? -1 : 1)); return pool[0]; };

  while (remaining > 0 && guard++ < 400000) {
    if (inVacation(day, normVacs) || blockedEve(day)) { day = addDays(day, 1); continue; }
    const k = dkey(day);
    const forcedId = launchOnDay[k];
    // active boost window today = earliest-deadline window with unfinished members;
    // raise the day's stream rate to the boosted rate so the group finishes in time.
    let boostWin = null, rate = perDay;
    for (const w of boostWindows) {
      if (day >= w.start && day < w.deadline && committed.some((p) => w.ids.has(p.id) && p.done < p.streams)) {
        rate = Math.max(rate, w.reqPerDay);
        if (!boostWin || w.deadline < boostWin.deadline) boostWin = w;
      }
    }
    let isSlot = false;
    if (forcedId) isSlot = true;
    else { acc += rate; if (acc >= 1) { acc -= 1; isSlot = true; } }
    if (!isSlot) { day = addDays(day, 1); continue; }

    let pick = null;
    if (forcedId) pick = committed.find((p) => p.id === forcedId && p.done < p.streams) || null;
    if (!pick && boostWin) {
      const pool = committed.filter((p) => boostWin.ids.has(p.id) && p.start <= day && p.done < p.streams);
      const hold = pool.filter((p) => p.binge && p.done > 0);
      pick = hold.length ? pickRR(hold) : (pool.length ? pickRR(pool) : null);
    }
    if (!pick) {
      const activeC = committed.filter((p) => p.start <= day && p.done < p.streams);
      const hold = activeC.filter((p) => p.binge && p.done > 0);
      if (hold.length) pick = pickRR(hold); else if (activeC.length) pick = pickRR(activeC);
    }
    if (!pick) {
      const activeB = bonusList.filter((p) => p.start <= day && p.done < p.streams);
      if (activeB.length) { const bp = pickRR(activeB); bp.done++; bp.lastSlot = day.getTime(); bp.slots.push(new Date(day)); bonusByDay[dkey(day)] = bp.id; remaining--; }
      day = addDays(day, 1); continue;
    }
    pick.done++; pick.lastSlot = day.getTime(); pick.slots.push(new Date(day)); remaining--;
    day = addDays(day, 1);
  }

  for (const p of committed) {
    if (!p.slots.length) { const e = addDays(p.start, 1); out[p.id] = { start: p.start, end: e, segments: [{ start: p.start, end: e }] }; continue; }
    const first = p.slots[0], last = addDays(p.slots[p.slots.length - 1], 1);
    out[p.id] = { start: first, end: last, segments: [{ start: first, end: last }] };
    p.slots.forEach((d, i) => { sessionByDay[dkey(d)] = { id: p.id, idx: i + 1, total: p.streams }; });
  }
  for (const p of bonusList) {
    if (p.slots.length) { const first = p.slots[0], last = addDays(p.slots[p.slots.length - 1], 1); out[p.id] = { start: first, end: last, segments: [{ start: first, end: last }] }; }
  }
  return { positions: out, sessionByDay, bonusByDay, boosts };
}

function scheduleSequential(games, pace, normVacs) {
  return streamPlan(games, pace, normVacs).positions;
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

// ---- auto-placement of month/quarter games ---------------------------------

// For each "promoted" month/quarter game (the user clicked its planned chip),
// choose a concrete start DAY inside its planned month. Promoted games in the
// same month are spread evenly across that month's OPEN days — days not already
// taken by a specific-day release, its launch eve, or a vacation. Because this is
// recomputed from the promoted set + the month's fixed dates, the chosen day for
// each game shifts to stay evenly spaced as games are added/removed.
// Returns { [gameId]: { year, month/*1-12*/, day } }.
function autoPlaceDays(games, promotedIds, normVacs) {
  const promoted = {};
  (promotedIds || []).forEach((id) => { promoted[id] = true; });

  // Group promoted month/quarter games by their planned month (anchor year-month).
  const byMonth = {};
  for (const g of (games || [])) {
    if (!promoted[g.id] || g.kind === 'event' || !isFuzzy(g.release)) continue;
    const a = anchorDate(g.release);
    if (!a) continue;
    const mk = a.getUTCFullYear() + '-' + a.getUTCMonth();
    (byMonth[mk] = byMonth[mk] || []).push(g);
  }

  // Days already spoken for: specific-day releases and their reserved eves.
  const { eveByDay, releaseDays } = launchEves(games);
  const out = {};
  for (const mk in byMonth) {
    const [y, mon0] = mk.split('-').map(Number); // mon0 = 0-based month
    const dim = new Date(Date.UTC(y, mon0 + 1, 0)).getUTCDate();
    const free = [];
    for (let d = 1; d <= dim; d++) {
      const day = utc(y, mon0 + 1, d);
      const k = dkey(day);
      if (releaseDays[k] || eveByDay[k] || inVacation(day, normVacs)) continue;
      free.push(d);
    }
    const list = byMonth[mk]; // games.json order (stable)
    const n = list.length, L = free.length;
    list.forEach((g, i) => {
      // Evenly spaced slot in the month's open days (mid-bucket so we avoid the
      // very edges); fall back to the 1st if the month is fully booked.
      const dayNum = L === 0 ? 1 : free[Math.min(L - 1, Math.floor((i + 0.5) * L / n))];
      out[g.id] = { year: y, month: mon0 + 1, day: dayNum };
    });
  }
  return out;
}

// Return a games list where each auto-placed game is anchored to its computed day
// (so the scheduler treats it like any dated backlog game), tagged with `placedDay`
// and its original `plannedLabel` / `plannedMonthKey` so the UI can show the chip's
// placed state and still group it under its planned month.
function withAutoPlacement(games, autoMap) {
  return (games || []).map((g) => {
    const a = autoMap && autoMap[g.id];
    if (!a) return g;
    const anchor = anchorDate(g.release);
    return {
      ...g,
      placedDay: utc(a.year, a.month, a.day),
      plannedLabel: releaseLabel(g.release),
      plannedMonthKey: anchor ? anchor.getUTCFullYear() + '-' + anchor.getUTCMonth() : null,
      release: { year: a.year, month: a.month, day: a.day, precision: 'day' },
    };
  });
}

// ---- "finish before" deadlines ---------------------------------------------

// Exclusive end of a release period — the first instant AFTER it. Used for date
// deadlines: "by end of June" (a "2026-06" month) -> July 1, so all of June counts.
function periodEndExclusive(r) {
  if (!r) return null;
  if (r.precision === 'day') return addDays(anchorDate(r), 1); // "by Aug 15" includes the 15th
  if (r.precision === 'month') return utc(r.year, (r.month || 1) + 1, 1);
  if (r.precision === 'quarter') return utc(r.year, (r.month || 1) + 3, 1);
  if (r.precision === 'year') return utc(r.year + 1, 1, 1);
  return anchorDate(r);
}

// Resolve a game's finish-before deadline (an exclusive Date): the referenced game's
// release day (by id/slug), or the end of a date/month/quarter string. null if absent.
function finishBeforeDeadline(game, gamesById) {
  if (!game || !game.finishBefore) return null;
  const t = gamesById && gamesById[game.finishBefore];
  if (t) return anchorDate(t.release);
  return periodEndExclusive(parseDate(game.finishBefore));
}

// Pack each finish-before group back-to-back from the earliest open day in its
// planned window, so the whole group finishes before the deadline. Open days skip
// specific-day releases, their launch eves, and vacations. Games keep games.json
// order (= series order). Returns { [gameId]: { year, month, day } } like autoPlaceDays.
function finishBeforeDays(games, pace, normVacs) {
  const byId = {};
  for (const g of (games || [])) byId[g.id] = g;
  const groups = {}; // targetKey -> { deadline, games: [] }
  for (const g of (games || [])) {
    if (!g.finishBefore || g.kind === 'event') continue;
    // Only auto-place games without a set day (month/quarter). Games that already
    // have a real date keep it — a deadline never moves a dated release.
    if (!isFuzzy(g.release)) continue;
    const deadline = finishBeforeDeadline(g, byId);
    if (!deadline) continue;
    (groups[g.finishBefore] = groups[g.finishBefore] || { deadline, games: [] }).games.push(g);
  }
  const { eveByDay, releaseDays } = launchEves(games);
  const out = {};
  for (const key in groups) {
    const { deadline, games: grp } = groups[key];
    let windowStart = null;
    for (const g of grp) { const a = anchorDate(g.release); if (a && (!windowStart || a < windowStart)) windowStart = a; }
    if (!windowStart || windowStart >= deadline) windowStart = addDays(deadline, -180);
    const avail = [];
    for (let d = new Date(windowStart); d < deadline; d = addDays(d, 1)) {
      const k = dkey(d);
      if (inVacation(d, normVacs) || releaseDays[k] || eveByDay[k]) continue;
      avail.push(new Date(d));
    }
    if (avail.length === 0) continue;
    // Pack in start-month order; each game begins no earlier than its own anchor
    // month (so "start in August" is honoured even within a shared deadline) and
    // after the previous game in the group.
    grp.sort((a, b) => (anchorDate(a.release) - anchorDate(b.release)));
    let cursor = 0;
    for (const g of grp) {
      const ga = anchorDate(g.release);
      let startIdx = cursor;
      while (startIdx < avail.length && ga && avail[startIdx] < ga) startIdx++;
      if (startIdx >= avail.length) startIdx = avail.length - 1;
      const s = avail[startIdx];
      out[g.id] = { year: s.getUTCFullYear(), month: s.getUTCMonth() + 1, day: s.getUTCDate() };
      cursor = startIdx + Math.max(1, activeDaysFor(g, pace));
    }
  }
  return out;
}
