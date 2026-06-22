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

// Parse a day-of-week (name or 0..6, Sun=0) to a number, or null.
const DOW_MAP = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
function parseDow(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return ((Math.trunc(v) % 7) + 7) % 7;
  const k = String(v).trim().toLowerCase();
  return DOW_MAP[k] != null ? DOW_MAP[k] : null;
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
  // Optional cadence override: 'weekly' = stream this game once a week until done
  // (instead of the default ~streamsPerWeek interleaved cadence).
  if (e.cadence) g.cadence = String(e.cadence);
  // Optional fixed day-of-week for a weekly-cadence game (e.g. "Fri").
  if (e.weeklyDay != null) { const dw = parseDow(e.weeklyDay); if (dw != null) g.weeklyDow = dw; }
  // Optional release-day session length (hours) for a midnight launch — overrides the
  // default binge-launch ~6h (e.g. a one-go finish: set to the game's full length).
  if (e.launchHours != null) g.launchHours = Number(e.launchHours);
  // Optional: pin this game to start on its exact day without it being a midnight
  // launch (no eve, no ~6h) — e.g. starting a game some time after its release.
  if (e.pinStart) g.pinStart = true;
  // Optional milestone: what chapter/badge/region marks this part "done".
  if (e.partGoal) g.partGoal = String(e.partGoal);
  // Optional scheduling priority within a shared deadline (higher = scheduled
  // sooner): Pokémon (+1) beats long-running franchises (-1) when they contend.
  if (e.priority != null) g.priority = Number(e.priority);
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

// Hours a single stream delivers on a given calendar day. Weekends (Sat/Sun) run
// longer than weekdays, so the plan credits a weekend session more hours. Falls
// back to the flat hoursPerStream when the weekday/weekend split isn't available.
function hoursOnDay(date, pace, longDays) {
  const dow = date.getUTCDay(); // 0 Sun .. 6 Sat
  // longDays = a Set of day-keys the user flagged as long (days off) — treated as
  // weekend-length even on a weekday.
  const wknd = dow === 0 || dow === 6 || (longDays && longDays.has(dkey(date)));
  if (wknd && pace && pace.weekendHps) return pace.weekendHps;
  if (!wknd && pace && pace.weekdayHps) return pace.weekdayHps;
  return (pace && pace.hoursPerStream) || 5;
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
function streamPlan(games, pace, normVacs, today, opts) {
  // Per-day overrides: longDays = Set of day-keys to treat as weekend-length;
  // dayPins = { dayKey: gameId } to force a specific game on a specific day.
  const longDays = (opts && opts.longDays) || null;
  const dayPins = (opts && opts.dayPins) || null;
  const out = {};
  const byId = {};
  for (const g of (games || [])) byId[g.id] = g;
  const baseHps = (pace && pace.hoursPerStream) || 5;
  const spw = (pace && pace.hoursPerStream && pace.hoursPerWeek) ? pace.hoursPerWeek / pace.hoursPerStream : 2;
  const perDay = Math.max(0.01, spw / 7);
  const { eveByDay, releaseDays } = launchEves((games || []).filter((g) => !g.bonus));
  const blockedEve = (d) => { const k = dkey(d); return !!eveByDay[k] && !releaseDays[k]; };
  const nowD = today || new Date();
  const t0 = utc(nowD.getUTCFullYear(), nowD.getUTCMonth() + 1, nowD.getUTCDate());

  // Immutable specs (events emit a position immediately and don't take slots).
  const cSpec = [], bSpec = [];
  for (const g of (games || [])) {
    const start = anchorDate(g.release);
    if (!start) continue;
    if (g.kind === 'event') { const end = gameEnd(g, start, pace, normVacs); out[g.id] = { start, end, segments: [{ start, end }] }; continue; }
    const baseStreams = streamsToFinish(g.hltbHours, pace);
    if (!baseStreams) continue;
    const dl = g.finishBefore ? finishBeforeDeadline(g, byId) : null;
    (g.bonus ? bSpec : cSpec).push({ id: g.id, start, baseStreams, binge: !!g.binge,
      cadence: g.cadence || null, weeklyDow: (g.weeklyDow != null ? g.weeklyDow : null),
      launchHours: (g.launchHours != null ? g.launchHours : null), pinStart: !!g.pinStart, priority: Number(g.priority) || 0,
      hltb: Number(g.hltbHours) || 0, key: g.finishBefore || null, deadlineMs: dl ? dl.getTime() : Infinity });
  }
  if (cSpec.length === 0 && bSpec.length === 0) return { positions: out, sessionByDay: {}, bonusByDay: {}, boosts: {} };
  const launchOnDay = {};
  for (const s of cSpec) { const ev = eveByDay[dkey(addDays(s.start, -1))]; if (ev && ev.id === s.id) launchOnDay[dkey(s.start)] = s.id; }
  // Force-start = a game pinned to begin on its exact day. Genuine launches (above)
  // qualify; `pinStart` games also do (e.g. Splatoon Raiders starting post-vacation,
  // not a midnight launch). Force-start drives the start day only — the midnight eve
  // and binge-launch ~6h stay tied to launchOnDay (real launches).
  const forceStartDay = { ...launchOnDay };
  for (const s of cSpec) { if (s.pinStart) forceStartDay[dkey(s.start)] = s.id; }

  // finish-before groups (committed) + per-group window + boosted stream counts.
  const groups = {};
  for (const s of cSpec) { if (!s.key) continue; const dl = byId[s.key] ? finishBeforeDeadline(byId[s.id], byId) : finishBeforeDeadline(byId[s.id], byId); if (!dl) continue; (groups[s.key] = groups[s.key] || { deadline: dl, members: [], ids: new Set() }); groups[s.key].members.push(s); groups[s.key].ids.add(s.id); }
  for (const key in groups) {
    const gr = groups[key];
    let earliest = null; for (const m of gr.members) if (!earliest || m.start < earliest) earliest = m.start;
    gr.winStart = earliest && earliest > t0 ? earliest : t0;
    // available stream HOURS in the window — every non-vacation, non-eve day, with
    // weekend days worth more (hoursOnDay).
    gr.availDays = 0; gr.availHours = 0;
    for (let d = new Date(gr.winStart); d < gr.deadline; d = addDays(d, 1)) if (!inVacation(d, normVacs) && !blockedEve(d)) { gr.availDays++; gr.availHours += hoursOnDay(d, pace, longDays); }
    gr.neededH = gr.members.reduce((s, m) => s + m.hltb, 0);
    // If even streaming every available day isn't enough, sessions must run longer:
    // the lengthen factor scales each session's hours so the group fits the window.
    gr.lengthen = (gr.availHours > 0 && gr.neededH > gr.availHours) ? gr.neededH / gr.availHours : 1;
    gr.fits = gr.availHours > 0 && gr.neededH <= gr.availHours + 0.001;
    // Local feasibility: the group's hours must fit the window's base-cadence hours
    // AFTER higher-priority work that contends in the same window (launches, binge
    // games, and earlier/equal-deadline groups). Local — so a far month isn't falsely
    // boosted by the global backlog.
    let contentionH = 0;
    for (const s of cSpec) {
      if (gr.ids.has(s.id)) continue;
      if (s.start >= gr.deadline) continue;
      const hasDl = s.deadlineMs !== Infinity;
      // only count games whose work actually overlaps this window: a deadline game
      // whose deadline is after our window opens, or any game that starts within it.
      const overlaps = (hasDl && s.deadlineMs > gr.winStart.getTime()) || (s.start >= gr.winStart);
      if (!overlaps) continue;
      const launches = launchOnDay[dkey(s.start)] === s.id && s.start >= gr.winStart && s.start < gr.deadline;
      const priority = s.binge || launches || (hasDl && s.deadlineMs <= gr.deadline.getTime());
      if (priority) contentionH += s.hltb;
    }
    const baseCapH = gr.availHours * perDay; // hours deliverable at base cadence in window
    gr.boost = gr.availDays > 0 && gr.neededH > (baseCapH - contentionH) + 0.001;
  }
  const boostKeys = new Set(Object.keys(groups).filter((k) => groups[k].boost));

  // One scheduling pass. boostKeys = groups that stream every available day (and use
  // their boosted, possibly-lengthened stream counts) to make their deadline.
  function simulate(boostKeys) {
    const work = cSpec.map((s) => ({ ...s, target: s.hltb, hoursDone: 0, lastSlot: -Infinity, slots: [], slotHours: [], lengthen: boostKeys.has(s.key) && groups[s.key] ? groups[s.key].lengthen : 1 }));
    const bwork = bSpec.map((s) => ({ ...s, target: s.hltb, hoursDone: 0, lastSlot: -Infinity, slots: [], slotHours: [], lengthen: 1 }));
    const boostW = [...boostKeys].filter((k) => groups[k]).map((k) => ({ start: groups[k].winStart, deadline: groups[k].deadline, ids: groups[k].ids }));
    let earliest = null; for (const p of work.concat(bwork)) if (!earliest || p.start < earliest) earliest = p.start;
    let day = new Date(Math.max(earliest.getTime(), t0.getTime())), acc = 0, guard = 0;
    const undone = (p) => p.hoursDone < p.target - 0.001;
    let remaining = work.concat(bwork).filter(undone).length;
    // Each stream day delivers hoursOnDay (weekends longer); a game finishes when its
    // accumulated hours reach its HLTB target. Boosted groups lengthen each session.
    // Binge-launch: on a binge game's release day the user does a midnight stream
    // + another session after work (~6h total), so the launch day credits more than
    // a normal weekday. A per-game `launchHours` overrides this (e.g. a one-go finish).
    const LAUNCH_HOURS = 6;
    // Weekday cap: weekday sessions realistically max ~6h even under deadline pressure
    // (the user goes ~4h on a normal weekday, ~6h if pushing). Weekends and explicit
    // days-off (longDays) can run their full length. So a deadline boost can stretch a
    // weekday up to 6h but no further — if that's not enough the deadline slips honestly.
    const WEEKDAY_MAX = 6;
    const isLongDay = (d) => { const w = d.getUTCDay(); return w === 0 || w === 6 || (longDays && longDays.has(dkey(d))); };
    const take = (p) => {
      const was = undone(p);
      let dayH = hoursOnDay(day, pace, longDays);
      if (launchOnDay[dkey(day)] === p.id) {
        if (p.launchHours != null) dayH = Math.max(dayH, p.launchHours);
        else if (p.binge) dayH = Math.max(dayH, LAUNCH_HOURS);
      }
      let h = dayH * (p.lengthen || 1);
      if (!isLongDay(day)) h = Math.min(h, WEEKDAY_MAX); // cap weekday sessions at ~6h
      p.hoursDone += h; p.lastSlot = day.getTime(); p.slots.push(new Date(day)); p.slotHours.push(h);
      if (was && !undone(p)) remaining--;
    };
    while (remaining > 0 && guard++ < 500000) {
      if (inVacation(day, normVacs) || blockedEve(day)) { day = addDays(day, 1); continue; }
      const k = dkey(day);
      const forcedId = forceStartDay[k] || (dayPins && dayPins[k]) || undefined;
      // weekly-cadence games are eligible at most once per 7 days; when one is "due"
      // it forces a stream day (like a launch) so it reliably gets its weekly slot.
      const WEEK = 7 * 86400000;
      const weeklyDue = (p) => p.cadence === 'weekly' && undone(p) && p.start <= day
        && (p.weeklyDow == null || day.getUTCDay() === p.weeklyDow) // pinned to a day-of-week
        && (p.lastSlot === -Infinity || (day.getTime() - p.lastSlot) >= WEEK - 3600000);
      const anyWeeklyDue = work.some(weeklyDue);
      const boostActive = boostW.some((w) => day >= w.start && day < w.deadline && work.some((p) => w.ids.has(p.id) && undone(p)));
      let isSlot = false;
      if (forcedId) isSlot = true;
      else if (boostActive) isSlot = true;
      else if (anyWeeklyDue) isSlot = true;
      else { acc += perDay; if (acc >= 1) { acc -= 1; isSlot = true; } }
      if (!isSlot) { day = addDays(day, 1); continue; }
      const active = work.filter((p) => p.start <= day && undone(p) && (p.cadence !== 'weekly' || weeklyDue(p)));
      // Priority-weighted recency: time-since-last-played scaled by 2^priority, so a
      // higher-priority game (Pokémon, +1) comes "due" sooner and plays a larger share.
      const nowMs = day.getTime();
      const wgap = (p) => (nowMs - (p.lastSlot === -Infinity ? p.start.getTime() - 7 * 86400000 : p.lastSlot)) * Math.pow(2, p.priority || 0);
      let pick = null;
      if (forcedId) pick = active.find((p) => p.id === forcedId) || null;
      // A due weekly game wins its one day even mid-binge, then the binge resumes.
      if (!pick) { const due = active.filter((p) => p.cadence === 'weekly'); if (due.length) { due.sort((a, b) => (a.deadlineMs - b.deadlineMs) || (a.lastSlot - b.lastSlot) || (a.start - b.start) || (a.id < b.id ? -1 : 1)); pick = due[0]; } }
      if (!pick) {
        const hold = active.filter((p) => p.binge && p.hoursDone > 0);
        if (hold.length) {
          hold.sort((a, b) => (a.start - b.start) || (a.id < b.id ? -1 : 1));
          const h = hold[0];
          // A LONG-RUNNING binge (priority < 0, e.g. FF7 Revelation) can be interrupted
          // by a higher-priority game (Pokémon): share this slot between the binge and
          // its challengers via weighted rotation so the prioritized game stays on
          // track, then the binge resumes. A neutral binge (priority >= 0, e.g.
          // Persona 4 Revival) is never interrupted — it holds against everything.
          const challengers = h.priority < 0 ? active.filter((p) => p.priority > h.priority) : [];
          if (challengers.length) {
            const pool = [h, ...challengers];
            pool.sort((a, b) => (wgap(b) - wgap(a)) || (a.deadlineMs - b.deadlineMs) || (a.id < b.id ? -1 : 1));
            pick = pool[0];
          } else { pick = h; }
        }
      }
      if (!pick && active.length) {
        // Earliest deadline first (deadline-pressured games win), then weighted rotation
        // (higher priority plays a larger share but still interleaves, doesn't binge).
        active.sort((a, b) => (a.deadlineMs - b.deadlineMs) || (wgap(b) - wgap(a)) || (a.hoursDone - b.hoursDone) || (a.start - b.start) || (a.id < b.id ? -1 : 1));
        pick = active[0];
      }
      if (!pick) {
        const ab = bwork.filter((p) => p.start <= day && undone(p));
        if (ab.length) { ab.sort((a, b) => (a.lastSlot - b.lastSlot) || (a.start - b.start) || (a.id < b.id ? -1 : 1)); take(ab[0]); }
        day = addDays(day, 1); continue;
      }
      take(pick);
      day = addDays(day, 1);
    }
    return { work, bwork };
  }

  // Single pass: deadline-priority scheduling; locally-contended groups stream every
  // available day in their window so they finish on time.
  const fin = simulate(boostKeys);

  const sessionByDay = {}, bonusByDay = {};
  for (const p of fin.work) {
    if (!p.slots.length) { const e = addDays(p.start, 1); out[p.id] = { start: p.start, end: e, segments: [{ start: p.start, end: e }] }; continue; }
    const first = p.slots[0], last = addDays(p.slots[p.slots.length - 1], 1);
    out[p.id] = { start: first, end: last, segments: [{ start: first, end: last }] };
    const total = p.slots.length;
    p.slots.forEach((d, i) => { sessionByDay[dkey(d)] = { id: p.id, idx: i + 1, total, hours: Math.round((p.slotHours[i] || 0) * 10) / 10 }; });
  }
  for (const p of fin.bwork) {
    if (p.slots.length) { const first = p.slots[0], last = addDays(p.slots[p.slots.length - 1], 1); out[p.id] = { start: first, end: last, segments: [{ start: first, end: last }] }; }
  }
  // Boost notes describe the ACTUAL catch-up plan the simulation drew (real stream
  // days, real session length, real intensity over the active stretch) — not an
  // abstract spread — so the note matches the calendar grid below it.
  const boosts = {};
  for (const key of boostKeys) {
    const gr = groups[key];
    const members = fin.work.filter((p) => gr.ids.has(p.id) && p.slots.length);
    let dayCount = 0, firstSlot = null, lastSlot = null, fitsAll = members.length > 0;
    for (const p of members) {
      dayCount += p.slots.length;
      const s0 = p.slots[0], s1 = p.slots[p.slots.length - 1];
      if (!firstSlot || s0 < firstSlot) firstSlot = s0;
      if (!lastSlot || s1 > lastSlot) lastSlot = s1;
      if (s1 >= gr.deadline) fitsAll = false; // a member runs past the deadline
    }
    const spanWeeks = (firstSlot && lastSlot)
      ? Math.max(0.5, (diffDays(firstSlot, lastSlot) + 1) / 7)
      : Math.max(0.5, (gr.deadline - gr.winStart) / (7 * 86400000));
    const sessionH = dayCount > 0 ? gr.neededH / dayCount : baseHps;
    boosts[key] = {
      days: dayCount || gr.availDays,
      usualDays: Math.max(1, Math.round(gr.availDays * perDay)), // your normal-cadence days in this window
      hps: Math.round(sessionH * 10) / 10,
      hpw: Math.round((gr.neededH / spanWeeks) * 10) / 10,
      fits: fitsAll && gr.fits,
    };
  }
  return { positions: out, sessionByDay, bonusByDay, boosts };
}

// Total deadline lateness (sum of days every finish-before game runs past its
// deadline) in a positions map. Days, not just count — so a change that pushes an
// already-late game even later is still detected. Optional `horizonMs` limits it to
// deadlines on/before that instant (near-term), which keeps a "rest today?" test
// stable — the far-future cascade reshuffles noisily and would otherwise dominate.
function totalSlipDays(positions, games, horizonMs) {
  const byId = {};
  for (const g of (games || [])) byId[g.id] = g;
  let n = 0;
  for (const g of (games || [])) {
    if (!g.finishBefore || g.kind === 'event' || g.bonus) continue;
    const dl = finishBeforeDeadline(g, byId);
    if (!dl) continue;
    if (horizonMs && dl.getTime() > horizonMs) continue;
    const p = positions[g.id];
    if (p && p.end > dl) n += Math.round((p.end - dl) / 86400000);
  }
  return n;
}

function scheduleSequential(games, pace, normVacs, opts) {
  return streamPlan(games, pace, normVacs, undefined, opts).positions;
}

function schedule(games, pace, mode /* 'parallel' | 'sequential' */, normVacs, opts) {
  return mode === 'sequential'
    ? scheduleSequential(games, pace, normVacs, opts)
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
    // Anchor each group game to the first open day on/after its own anchor month
    // (so "start in August" is honoured within a shared deadline), then let
    // streamPlan interleave + deadline-prioritise + boost them across the window.
    // (Earlier this packed games sequentially — cursor += each game's full length —
    // which assumed non-interleaved play and could shove the last game so late it
    // couldn't finish before the deadline/a vacation. streamPlan already handles
    // ordering, so sequential pre-packing only hurt.)
    grp.sort((a, b) => (anchorDate(a.release) - anchorDate(b.release)));
    for (const g of grp) {
      const ga = anchorDate(g.release);
      let startIdx = 0;
      while (startIdx < avail.length && ga && avail[startIdx] < ga) startIdx++;
      if (startIdx >= avail.length) startIdx = avail.length - 1;
      const s = avail[startIdx];
      out[g.id] = { year: s.getUTCFullYear(), month: s.getUTCMonth() + 1, day: s.getUTCDate() };
    }
  }
  return out;
}
