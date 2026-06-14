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

// Parallel ("true dates"): every scheduled game sits on its real release date.
// Returns { [id]: { start: Date, end: Date } } for scheduled games only.
function scheduleParallel(games, pace, normVacs) {
  const out = {};
  for (const g of games) {
    const start = anchorDate(g.release);
    if (!start) continue;
    out[g.id] = { start, end: gameEnd(g, start, pace, normVacs) };
  }
  return out;
}

// Sequential ("my queue"): release order, but a game can't start until the
// previous one is finished — surfaces the realistic backlog.
function scheduleSequential(games, pace, normVacs) {
  const scheduled = games
    .filter((g) => isScheduled(g.release))
    .sort((a, b) => anchorDate(a.release) - anchorDate(b.release));
  const out = {};
  let cursor = null; // end of previously queued game
  for (const g of scheduled) {
    const release = anchorDate(g.release);
    const start = cursor && cursor > release ? cursor : release;
    const end = gameEnd(g, start, pace, normVacs);
    out[g.id] = { start, end };
    cursor = end;
  }
  return out;
}

function schedule(games, pace, mode /* 'parallel' | 'sequential' */, normVacs) {
  return mode === 'sequential'
    ? scheduleSequential(games, pace, normVacs)
    : scheduleParallel(games, pace, normVacs);
}
