/* app.jsx — Stream Slate. Loaded after calc.js (shared eval scope), so it uses
   calc helpers (anchorDate, releaseLabel, isPlaceable, schedule, streamsToFinish,
   weeksToFinish, gameDurationDays, addDays, diffDays, MONTHS, MONTHS_LONG) directly. */

const { useState, useEffect, useMemo, useRef, useCallback } = React;

// ----------------------------------------------------------------------------
// Seed data — researched from announcements current to June 2026. The app is
// fully editable; this is just the starting slate. `hltbBasis` records how the
// hours estimate was derived (self = the user's own replay of a game they know,
// remake-original = original game's HLTB, series-avg = average of prior entries,
// estimate = no strong anchor). All prices USD; many are pre-launch estimates.
// ----------------------------------------------------------------------------
// The slate now lives in public/games.json (loaded at runtime).

const DEFAULT_SETTINGS = {
  override: false,
  hoursPerStream: 5.11,
  hoursPerWeek: 11.52,
  view: 'grid',
  schedMode: 'parallel',
  vacations: [],   // [{ id, label, start:'YYYY-MM-DD', end:'YYYY-MM-DD' }] — no streaming
  autoPlace: [],   // ids of month/quarter games the user pinned to an auto-picked start day
  longDays: [],    // ISO dates (days off) to treat as weekend-length stream days
  dayPins: {},     // { 'YYYY-MM-DD': gameId } — force a specific game on a specific day
  restDays: [],    // ISO dates the user chose to rest (no committed stream)
  sessionGoals: {},// { 'gameId#streamOrdinal': 'goal note' } — per-stream goals (hover)
  queue: [],       // what-if queue play order (game ids); empty = default release order
  theme: 'purple', // accent preset (sets --acc / --acc-ink); persists in settings
  finDismiss: '',  // id of the last dismissed "recently wrapped" celebration
  hoursAdjust: {}, // { gameId: deltaHours } — manual time-to-beat bumps when a game runs over/under
};

// Accent presets — swap --acc / --acc-ink on the app wrapper. Per-game colours
// (iconColor) are unaffected; only the global accent themes.
const THEMES = [
  { id: 'purple', acc: '#a970ff', ink: '#160a2b' },
  { id: 'teal', acc: '#2bd4c0', ink: '#04201c' },
  { id: 'amber', acc: '#f5a142', ink: '#241402' },
  { id: 'mono', acc: '#cdd3df', ink: '#0d1118' },
];

const FALLBACK_PACE = { hoursPerStream: 5.11, hoursPerWeek: 11.52, weekdayHps: 4.0, weekendHps: 8.0, weekdayStreams: 0, weekendStreams: 0, source: 'fallback', fetchedAt: null, numStreams: 29, totalHours: 148.1, windowDays: 90 };

const KIND_LABEL = { game: 'Game', replay: 'Replay', dlc: 'DLC / Chapter', event: 'Event' };
const KIND_COLOR = { game: 'var(--accent)', replay: 'var(--accent-2)', dlc: 'var(--good)', event: 'var(--warn)' };

// Give every game its own stable colour (hashed from its id into a curated palette)
// so a run of the same game on the calendar reads as one contiguous block and
// different games never look alike — much easier to trace "which game is which"
// than a single per-kind colour. The palette is chosen to be mutually distinct and
// light enough for dark text; `tint` is the same colour at low alpha for the cell.
const GAME_PALETTE = [
  '#f7768e', '#ff9e64', '#e0af68', '#9ece6a', '#73daca', '#7dcfff', '#7aa2f7', '#bb9af7',
  '#f7c8e0', '#e6db74', '#fca7ea', '#a6e22e', '#fd971f', '#66d9ef', '#c3e88d', '#ff757f',
];
// Games with cover art register a band colour derived from the art (games.json
// `iconColor`), so the band complements the cover; everything else falls back to
// the curated palette hashed from the id.
const ICON_COLORS = {};
function gameColor(id) {
  const ov = ICON_COLORS[id];
  if (ov) return { solid: ov, tint: ov + '2e' };
  let h = 0;
  const s = id || '';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const c = GAME_PALETTE[h % GAME_PALETTE.length];
  return { solid: c, tint: c + '2e' /* ~18% alpha */ };
}

// A short monogram for a game's title — first letters of its first two real words,
// keeping standalone numbers ("Splatoon 3" -> "S3", "Pokémon HeartGold" -> "PH").
function gameInitials(title) {
  const toks = ((title || '').match(/[\p{L}\p{N}]+/gu) || []);
  let out = '';
  for (const t of toks) {
    out += /^\d+$/.test(t) ? t : t[0].toUpperCase();
    if (out.replace(/\d/g, '').length >= 2 || out.length >= 3) break;
  }
  return (out || '?').slice(0, 3);
}

// Per-game visual: an <img> if `icon` is an image URL/path, the emoji if `icon` is
// short text, else a colour-coded monogram badge. One asset per game, used in the
// detail card, timeline labels, and chips.
function isImgIcon(icon) { return !!icon && /^(https?:\/\/|\/|data:)/.test(icon); }
function GameBadge({ game, size = 20 }) {
  const px = size + 'px';
  const icon = game.icon;
  if (isImgIcon(icon)) return <img className="gbadge gbadge-img" src={icon} alt="" loading="lazy" decoding="async" style={{ width: px, height: px }} />;
  const col = gameColor(game.id);
  return (
    <span className="gbadge" style={{ width: px, height: px, background: col.solid,
      fontSize: Math.round(size * (icon ? 0.62 : 0.44)) + 'px', color: icon ? undefined : '#0c0c12' }}>
      {icon || gameInitials(game.title)}
    </span>
  );
}
const PX_PER_DAY = 4.2;

// ----------------------------------------------------------------------------
// Persistence
// ----------------------------------------------------------------------------
const LS_KEY = 'stream-slate-state';

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { return null; }
}
function saveLocal(state) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {}
}

// ----------------------------------------------------------------------------
// Small helpers
// ----------------------------------------------------------------------------
function uid() { return 'g' + Math.random().toString(36).slice(2, 9); }
const fmtDate = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
const shortDate = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
const fmtMins = (m) => { const h = Math.floor((m || 0) / 60), mm = (m || 0) % 60; return h ? `${h}h${mm ? ' ' + mm + 'm' : ''}` : `${mm}m`; };

// Build the content for the in-app hover popup from a day's info. Returns null for
// days with nothing to show (empty/vacation).
function cellPopData(info, day) {
  if (!info || info.vac) return null;
  if (info.streamed) {
    const items = [];
    for (const st of info.streamed) {
      const names = st.games.map((g) => g.name).join(' + ');
      const g0 = st.games[0] || {};
      items.push({ name: names, art: g0.art, ord: g0.ord, total: g0.total, length: fmtMins(st.minutes), combined: st.games.length > 1 });
    }
    return { kind: 'streamed', items };
  }
  if (info.launch) return { kind: 'launch', title: info.launch.title, art: info.launch.icon };
  if (info.rest) return { kind: 'rest' };
  if (info.session && info.play) {
    const dow = day.getUTCDay();
    return {
      kind: 'planned', title: info.play.title, art: info.play.icon,
      ord: info.streamOrd, total: info.streamTotal, midnight: info.midnight,
      length: info.session.hours ? `~${info.session.hours}h ${info.midnight ? 'midnight launch' : 'planned (' + (dow === 0 || dow === 6 ? 'weekend' : 'weekday') + ')'}` : null,
      goal: info.goal,
    };
  }
  if (info.bonusPlay) return { kind: 'bonus', title: info.bonusPlay.title, art: info.bonusPlay.icon };
  return null;
}

// Map real streamed history onto slate games. Stream game NAMES (from SullyGnome) are
// matched to slate titles by a normalized key (part suffix / parens / punctuation
// stripped, fuzzy contains). Each matching past stream's hours are allocated across
// the game's parts in date order; we also count how many streams touched each part.
// Returns { hours:{id:h}, counts:{id:n} }. Events/bonus games are ignored.
// Normalize a game title/category for matching. Keep parenthetical content (e.g.
// "(Switch 2)") — it distinguishes "Star Fox (Switch 2)" from "Star Fox Zero" — and
// expand the NS2 abbreviation so it lines up with "Nintendo Switch 2" in real data.
// Only the "— Pt. N" part suffix is dropped (so parts share a base).
const stripGameName = (s) => String(s || '').toLowerCase()
  .replace(/—\s*pt\.?\s*\d+.*$/, '')
  .replace(/\bns2\b/g, 'nintendo switch 2')
  .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
function computeDoneInfo(games, streams) {
  const hours = {}, counts = {}, streamMap = {}, last = {}; // last: {id: 'YYYY-MM-DD'} latest credited stream
  if (!streams || !streams.length || !games || !games.length) return { hours, counts, streamMap, last };
  const groups = {}; // base key -> [{id, hltb}] in file/part order
  const startMs = {}; // base key -> earliest scheduled start (ms); streams before it are
  //                     pre-existing progress already baked into hltbHours, so not credited.
  for (const g of games) {
    if (g.kind === 'event' || g.bonus) continue;
    const base = stripGameName(g.title); if (!base) continue;
    (groups[base] = groups[base] || []).push({ id: g.id, hltb: Number(g.hltbHours) || 0 });
    const a = anchorDate(g.release);
    if (a) {
      // A midnight-launch game streams its first (midnight) session on the EVE — by
      // late-night attribution that lands the day BEFORE release — so credit from the eve.
      const isLaunch = g.release && g.release.precision === 'day' && g.newRelease !== false && !g.backlog && (g.kind === 'game' || g.kind === 'dlc');
      const ms = a.getTime() - (isLaunch ? 86400000 : 0);
      if (startMs[base] == null || ms < startMs[base]) startMs[base] = ms;
    }
  }
  const baseFor = (k) => Object.keys(groups).find((b) => k === b || ((k.includes(b) || b.includes(k)) && Math.min(k.length, b.length) >= 8));
  const dateMs = (s) => { const [y, m, d] = String(s || '').split('-').map(Number); return (y && m && d) ? Date.UTC(y, m - 1, d) : null; };
  // per base: chronological list of { hrs, key } from matching past streams, only those
  // on/after the game's scheduled start (older streams = progress already in the estimate).
  const perBase = {};
  const sorted = [...streams].sort((a, b) => String(a.date) < String(b.date) ? -1 : 1);
  for (const s of sorted) {
    const gs = s.games || [];
    if (!gs.length) continue;
    const sMs = dateMs(s.date);
    const per = (Number(s.minutes) || 0) / 60 / gs.length;
    const [yy, mm, dd] = String(s.date || '').split('-').map(Number);
    const dayKey = (yy && mm && dd) ? `${yy}-${mm - 1}-${dd}` : null;
    for (const g of gs) {
      const norm = stripGameName(g.name);
      const b = baseFor(norm);
      if (!b) continue;
      if (startMs[b] != null && sMs != null && sMs < startMs[b]) continue; // pre-start progress
      (perBase[b] = perBase[b] || []).push({ hrs: per, key: dayKey ? `${dayKey}|${norm}` : null, date: s.date });
    }
  }
  for (const base in perBase) {
    const parts = groups[base];
    let pi = 0, filled = 0;
    const ordByPart = {};
    for (const ev of perBase[base]) {
      const hrs = ev.hrs;
      const startId = parts[Math.min(pi, parts.length - 1)].id; // part this stream begins on
      ordByPart[startId] = (ordByPart[startId] || 0) + 1;
      if (ev.key) streamMap[ev.key] = { id: startId, ord: ordByPart[startId] };
      let h = hrs;
      while (h > 0.001 && pi < parts.length) {
        const cap = Math.max(0, parts[pi].hltb - filled);
        const take = Math.min(h, cap || h); // if part has 0 cap left, still count once
        hours[parts[pi].id] = (hours[parts[pi].id] || 0) + take;
        counts[parts[pi].id] = (counts[parts[pi].id] || 0) + 1;
        if (ev.date && (!last[parts[pi].id] || ev.date > last[parts[pi].id])) last[parts[pi].id] = ev.date;
        filled += take; h -= take;
        if (filled >= parts[pi].hltb - 0.001) { pi++; filled = 0; }
      }
    }
  }
  return { hours, counts, streamMap, last };
}
function effectivePace(settings, pace) {
  if (settings.override) return { hoursPerStream: settings.hoursPerStream, hoursPerWeek: settings.hoursPerWeek, weekdayHps: settings.hoursPerStream, weekendHps: settings.hoursPerStream };
  return { hoursPerStream: pace.hoursPerStream, hoursPerWeek: pace.hoursPerWeek, weekdayHps: pace.weekdayHps, weekendHps: pace.weekendHps };
}

// Strip a "— Pt. N" multi-part suffix to the shared base title.
function baseTitle(t) { return String(t || '').replace(/\s*—\s*pt\.?\s*\d+.*$/i, '').trim(); }

// ============================================================================
// Health instruments + deadline / catch-up gauges (redesign step 1)
// The gauges are a presentational layer over calc's feasibility math:
// group by finishBefore, resolve the deadline, compare needed h/wk to the pace.
// ============================================================================
function dlLabelFor(fb, dl, byId) {
  const g = byId[fb];
  if (g && g.title) return 'before ' + baseTitle(String(g.title).split(':')[0]);
  if (/^\d{4}-\d{2}$/.test(fb)) return 'by end of ' + MONTHS[dl.getUTCMonth()];
  return 'by ' + MONTHS[dl.getUTCMonth()] + ' ' + dl.getUTCDate();
}
function buildDeadlines(games, pace, doneHours, today) {
  const byId = {}; games.forEach((g) => { byId[g.id] = g; });
  const groups = {};
  for (const g of games) {
    if (!g.finishBefore || g.kind === 'event' || g.bonus) continue;
    (groups[g.finishBefore] = groups[g.finishBefore] || []).push(g);
  }
  const hpw = (pace && pace.hoursPerWeek) || 11.52;
  const out = [];
  for (const fb in groups) {
    const items = groups[fb];
    const dl = finishBeforeDeadline(items[0], byId);
    if (!dl || dl.getTime() <= today.getTime()) continue;       // already passed
    let hours = 0;
    for (const g of items) hours += Math.max(0, (Number(g.hltbHours) || 0) - ((doneHours && doneHours[g.id]) || 0));
    if (hours <= 0.5) continue;                                  // group already done
    const weeksLeft = Math.max(0.3, (dl.getTime() - today.getTime()) / 6048e5);
    const needed = hours / weeksLeft;
    const onTrack = needed <= hpw;
    const tone = needed <= hpw ? 'var(--good)' : needed <= hpw * 1.4 ? 'var(--warn)' : 'var(--danger)';
    out.push({
      id: items[0].id, label: baseTitle(items[0].title), count: items.length,
      hours: Math.round(hours), needed, onTrack, tone,
      fill: Math.min(100, (needed / hpw) * 60), dlText: dlLabelFor(fb, dl, byId),
    });
  }
  return out.sort((a, b) => b.needed - a.needed);
}

function NextLaunchTile({ launch }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!launch) return (
    <div className="instr-tile"><div className="it-k">NEXT LAUNCH</div>
      <div className="it-v">—</div><div className="it-s">no dated releases ahead</div></div>
  );
  let diff = Math.max(0, launch.ms - now);
  const d = Math.floor(diff / 864e5); diff -= d * 864e5;
  const h = Math.floor(diff / 36e5); diff -= h * 36e5;
  const m = Math.floor(diff / 6e4);
  return (
    <div className="instr-tile"><div className="it-k">NEXT LAUNCH</div>
      <div className="it-v">{d}<small> d</small> {h}<small> h</small> {m}<small> m</small></div>
      <div className="it-s" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{launch.title}</div></div>
  );
}
function InstrumentPanel({ pace, source, inFlight, atRisk, launch }) {
  const spw = pace.hoursPerStream ? pace.hoursPerWeek / pace.hoursPerStream : 0;
  return (
    <div className="instr">
      <div className="instr-tile">
        <div className="it-k">STATUS</div>
        <div className="it-v" style={{ color: atRisk ? 'var(--warn)' : 'var(--good)' }}>{atRisk ? 'Tight' : 'On track'}</div>
        <div className="it-s">{atRisk ? atRisk + ' deadline' + (atRisk > 1 ? 's' : '') + ' need a faster week' : 'every deadline is reachable'}</div>
      </div>
      <div className="instr-tile">
        <div className="it-k">PACE</div>
        <div className="it-v">{Number(pace.hoursPerWeek || 0).toFixed(1)}<small> h/wk</small></div>
        <div className="it-s">{pace.hoursPerStream}h × ~{spw.toFixed(1)} streams · {source}</div>
      </div>
      <div className="instr-tile">
        <div className="it-k">IN FLIGHT</div>
        <div className="it-v">{inFlight.count}<small> game{inFlight.count === 1 ? '' : 's'}</small></div>
        <div className="it-s" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{inFlight.names || 'nothing started yet'}</div>
      </div>
      <NextLaunchTile launch={launch} />
    </div>
  );
}
function DeadlinePanel({ deadlines, onPick }) {
  if (!deadlines.length) return null;
  return (
    <div className="dl-panel">
      <div className="dl-head"><span className="dl-h">Deadlines &amp; catch-up</span>
        <span className="dl-sub">finish each before the next drops · bar = needed pace vs your weekly hours</span></div>
      {deadlines.slice(0, 6).map((d, i) => (
        <div className="dl-row" key={i} onClick={() => onPick(d.id)}>
          <div style={{ minWidth: 0 }}>
            <div className="dl-name">{d.label}</div>
            <div className="dl-when">{d.dlText} · {d.count > 1 ? d.count + ' games · ' : ''}{d.hours}h to play</div>
          </div>
          <div className="dl-gauge"><div className="dl-bar"><span className="cap" /><i style={{ width: d.fill + '%', background: d.tone }} /></div></div>
          <div className="dl-need" style={{ color: d.tone }}>{d.needed.toFixed(1)}<small> h/wk</small></div>
          <div className="dl-flag">{d.onTrack ? '✓' : '⚠'}</div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// What-if queue (redesign step 3): drag to reorder; finish dates re-chain at the
// live pace; each game flagged against its finishBefore deadline. Order persists.
// ============================================================================
// Default play order: in-progress games first (by date), then every committed dated
// game from today on, in release order. Events/bonus/finished excluded.
function defaultQueueIds(games, today, doneHours) {
  const inProg = [], upcoming = [];
  for (const g of games) {
    if (g.kind === 'event' || g.bonus) continue;
    const done = (doneHours && doneHours[g.id]) || 0;
    const remaining = (Number(g.hltbHours) || 0) - done;
    if (remaining <= 0.5) continue;
    if (done > 0) { inProg.push(g); continue; }
    if (!isPlaceable(g.release)) continue;
    const a = anchorDate(g.release);
    if (a && a.getTime() >= today.getTime()) upcoming.push({ g, a });
  }
  const byDate = (a, b) => { const x = anchorDate(a.release), y = anchorDate(b.release); return (x && y) ? x - y : 0; };
  inProg.sort(byDate);
  upcoming.sort((p, q) => p.a - q.a);
  return [...inProg.map((g) => g.id), ...upcoming.map((o) => o.g.id)];
}
function QueueView({ games, pace, ids, today, doneHours, onReorder, onPick }) {
  const byId = {}; games.forEach((g) => { byId[g.id] = g; });
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const hpw = (pace && pace.hoursPerWeek) || 11.52;
  let cursor = today.getTime();
  const rows = [];
  for (const id of ids) {
    const g = byId[id]; if (!g) continue;
    const remaining = Math.max(0, (Number(g.hltbHours) || 0) - ((doneHours && doneHours[id]) || 0));
    cursor += (remaining / hpw) * 6048e5;
    const fin = new Date(cursor);
    const dl = g.finishBefore ? finishBeforeDeadline(g, byId) : null;
    let flag = '', tone = 'var(--faint)';
    if (dl) {
      if (fin.getTime() > dl.getTime()) { flag = '⚠ ' + Math.ceil((fin.getTime() - dl.getTime()) / 864e5) + 'd late'; tone = 'var(--danger)'; }
      else { flag = '✓ in time'; tone = 'var(--good)'; }
    }
    rows.push({ id, g, remaining: Math.round(remaining), streams: streamsToFinish(remaining, pace), fin, flag, tone });
  }
  const lastFin = rows.length ? rows[rows.length - 1].fin : null;
  const lateCount = rows.filter((r) => r.flag.startsWith('⚠')).length;
  const drop = () => {
    if (dragIdx == null || overIdx == null || dragIdx === overIdx) { setDragIdx(null); setOverIdx(null); return; }
    const q = ids.slice(); const [m] = q.splice(dragIdx, 1); q.splice(overIdx, 0, m);
    onReorder(q); setDragIdx(null); setOverIdx(null);
  };
  return (
    <div className="anim">
      <div className="q-head">
        <div>
          <div className="q-h">What-if queue</div>
          <div className="q-desc">drag to reorder · finish dates re-chain at your {hpw.toFixed(1)}h/wk pace (breaks not counted)</div>
        </div>
        <button className="btn btn-sm" onClick={() => onReorder([])}>Reset to release order</button>
      </div>
      <div className="q-list">
        {rows.map((r, i) => (
          <div key={r.id} className={'q-row' + (dragIdx === i ? ' drag' : '') + (overIdx === i ? ' over' : '')}
            draggable onDragStart={() => setDragIdx(i)} onDragEnter={() => setOverIdx(i)}
            onDragOver={(e) => e.preventDefault()} onDragEnd={drop}>
            <div className="q-handle">⠿</div>
            <div className="q-art" onClick={() => onPick(r.id)}
              style={isImgIcon(r.g.icon) ? { backgroundImage: `url(${r.g.icon})` } : { background: gameColor(r.id).solid }} />
            <div style={{ minWidth: 0 }}>
              <div className="q-name">{r.g.title}</div>
              <div className="q-sub">{r.remaining}h · {r.streams} stream{r.streams === 1 ? '' : 's'}{r.g.finishBefore ? ' · has deadline' : ''}</div>
            </div>
            <div className="q-fin">{fmtDate(r.fin)}<small>est. finish</small></div>
            <div className="q-flag" style={{ color: r.tone }}>{r.flag}</div>
          </div>
        ))}
      </div>
      <div className="q-summary">In this order, the last game wraps <b>{lastFin ? fmtDate(lastFin) : '—'}</b>{lateCount ? ` · ${lateCount} game${lateCount > 1 ? 's' : ''} miss a deadline` : ' · every deadline holds ✓'}.</div>
    </div>
  );
}

// ============================================================================
// Browse (redesign step 4c): searchable / filterable full catalog.
// ============================================================================
function BrowseView({ games, onPick }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const filtered = games.filter((g) => {
    if (kind !== 'all') { if (kind === 'bonus') { if (!g.bonus) return false; } else if (g.kind !== kind) return false; }
    if (q) { const s = q.toLowerCase(); if (!(g.title.toLowerCase().includes(s) || (g.platforms || []).join(' ').toLowerCase().includes(s))) return false; }
    return true;
  }).slice().sort((a, b) => { const ta = anchorDate(a.release), tb = anchorDate(b.release); if (ta && tb) return ta - tb; if (ta) return -1; if (tb) return 1; return 0; });
  return (
    <div className="anim">
      <div className="browse-bar">
        <div className="browse-search"><span className="ic">⌕</span>
          <input placeholder="Search games, platforms…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="browse-filters">
          {[['all', 'All'], ['game', 'Games'], ['dlc', 'DLC'], ['event', 'Events'], ['bonus', 'Bonus']].map(([k, l]) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>
          ))}
        </div>
        <span className="browse-cnt">{filtered.length} of {games.length}</span>
      </div>
      <div className="browse-list">
        {filtered.length === 0 ? <div className="brow-empty">No titles match your search.</div>
          : filtered.map((g) => (
            <div className="brow" key={g.id} onClick={() => onPick(g.id)}>
              <div className="brow-art" style={isImgIcon(g.icon) ? { backgroundImage: `url(${g.icon})` } : { background: gameColor(g.id).solid }} />
              <div className="brow-title"><div className="brow-name">{g.title}</div>
                <div className="brow-meta">{KIND_LABEL[g.kind]}{g.bonus ? ' · Bonus' : ''}{g.backlog ? ' · Backlog' : ''}{g.newRelease === false ? ' · Replay' : ''}</div></div>
              <div className="brow-plat">{(g.platforms || []).join(', ') || '—'}</div>
              <div className="brow-date">{releaseLabel(g.release)}</div>
              <div className="brow-hltb">{g.hltbHours ? g.hltbHours + 'h' : '—'}</div>
            </div>
          ))}
      </div>
    </div>
  );
}

// ============================================================================
// Season / Wrapped (redesign step 4d): aggregate stats over the slate.
// ============================================================================
const PALETTE = ['#a970ff', '#3b6fe0', '#34d399', '#f5b14c', '#5ed3de', '#eb51b8'];
function SeasonView({ games, pace, onPick }) {
  const hpw = pace.hoursPerWeek || 11.52, hps = pace.hoursPerStream || 5.11;
  const playable = games.filter((g) => g.kind !== 'event');
  const totalHours = playable.reduce((a, g) => a + (Number(g.hltbHours) || 0), 0);
  const totalStreams = playable.reduce((a, g) => a + (g.hltbHours ? streamsToFinish(g.hltbHours, pace) : 0), 0);
  const weeks = totalHours / hpw, years = weeks / 52;
  const big = [
    { value: String(playable.length), label: 'titles on the slate', sub: 'games, remakes, DLC & marathons', color: 'var(--acc)' },
    { value: Math.round(totalHours).toLocaleString() + 'h', label: 'to finish everything', sub: 'summed HowLongToBeat hours', color: '#5ed3de' },
    { value: String(totalStreams), label: 'streams to clear it', sub: `at ${hps}h per stream`, color: 'var(--accent-2)' },
    { value: Math.round(weeks / 4.345) + ' mo', label: 'of streaming', sub: `at ${hpw}h per week`, color: 'var(--good)' },
  ];
  const top = playable.filter((g) => g.hltbHours > 0).slice().sort((a, b) => b.hltbHours - a.hltbHours).slice(0, 6);
  const maxH = top.length ? top[0].hltbHours : 1;
  const groups = [
    { name: 'Kingdom Hearts', re: /kingdom hearts/i },
    { name: 'Final Fantasy VII', re: /final fantasy vii/i },
    { name: 'Pokémon', re: /pok[eé]mon/i },
    { name: 'Xenoblade', re: /xenoblade/i },
  ];
  const marathons = groups.map((gr) => {
    const items = playable.filter((g) => gr.re.test(g.title));
    if (items.length < 2) return null;
    const hrs = items.reduce((a, g) => a + (g.hltbHours || 0), 0);
    const str = items.reduce((a, g) => a + (g.hltbHours ? streamsToFinish(g.hltbHours, pace) : 0), 0);
    const lead = items.find((g) => isImgIcon(g.icon)) || items[0];
    return { name: gr.name, count: items.length, sub: `${hrs}h · ${str} streams`, id: lead.id, art: isImgIcon(lead.icon) ? lead.icon : null, color: gameColor(lead.id).solid };
  }).filter(Boolean).sort((a, b) => b.count - a.count);
  const pc = {}; playable.forEach((g) => (g.platforms || []).forEach((p) => { pc[p] = (pc[p] || 0) + 1; }));
  const plats = Object.keys(pc).map((k) => ({ name: k, count: pc[k] })).sort((a, b) => b.count - a.count).slice(0, 6);
  const maxP = plats.length ? plats[0].count : 1;
  const bc = {}; playable.forEach((g) => { if (g.hltbBasis) bc[g.hltbBasis] = (bc[g.hltbBasis] || 0) + 1; });
  const basis = Object.keys(bc).map((k) => ({ name: labelBasis(k), count: bc[k] })).sort((a, b) => b.count - a.count);
  return (
    <div className="anim">
      <div className="w-head"><h1>The slate in numbers</h1><span>everything queued across the next 18 months</span></div>
      <div className="w-stats">
        {big.map((s, i) => (
          <div className="w-stat" key={i}><div className="big" style={{ color: s.color }}>{s.value}</div>
            <div className="lbl">{s.label}</div><div className="sub">{s.sub}</div></div>
        ))}
      </div>
      <div className="s-grid">
        <div className="w-panel">
          <h3>Longest hauls</h3><div className="desc">biggest playthroughs on the slate, by hours</div>
          {top.map((g, i) => (
            <div className="w-row" key={g.id} onClick={() => onPick(g.id)} style={{ cursor: 'pointer' }}>
              <div className="w-rowart" style={isImgIcon(g.icon) ? { backgroundImage: `url(${g.icon})` } : { background: gameColor(g.id).solid }} />
              <div style={{ minWidth: 0, flex: 1 }}><div className="w-rowtitle">{g.title}</div>
                <div className="w-bar"><div style={{ width: Math.round((g.hltbHours / maxH) * 100) + '%', background: gameColor(g.id).solid }} /></div></div>
              <div className="w-hours" style={{ color: gameColor(g.id).solid }}>{g.hltbHours}h</div>
            </div>
          ))}
        </div>
        <div className="w-panel">
          <h3>Marathons</h3><div className="desc">multi-part series in the queue</div>
          {marathons.map((m, i) => (
            <div className="w-mara" key={i} onClick={() => onPick(m.id)} style={{ cursor: 'pointer' }}>
              <div className="w-maraart" style={m.art ? { backgroundImage: `url(${m.art})` } : { background: m.color }} />
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: '.84rem', fontWeight: 600 }}>{m.name}</div><div className="un-meta">{m.sub}</div></div>
              <div style={{ textAlign: 'right', flex: 'none' }}><div className="w-maracount" style={{ color: m.color }}>{m.count}</div>
                <div style={{ fontSize: '.58rem', color: 'var(--faint)', fontFamily: 'var(--mono)', marginTop: 2 }}>PARTS</div></div>
            </div>
          ))}
        </div>
      </div>
      <div className="s-grid" style={{ marginTop: 14 }}>
        <div className="w-panel">
          <h3 style={{ marginBottom: 16 }}>Platforms in rotation</h3>
          {plats.map((p, i) => (
            <div className="w-platrow" key={i}><div className="w-platname">{p.name}</div>
              <div className="w-platbar"><div style={{ height: '100%', borderRadius: 99, width: Math.round((p.count / maxP) * 100) + '%', background: PALETTE[i % PALETTE.length] }} /></div>
              <div className="w-platcount">{p.count}</div></div>
          ))}
        </div>
        <div className="w-panel">
          <h3>How hours are estimated</h3><div className="desc">provenance of every HLTB figure</div>
          {basis.map((b, i) => (
            <div className="w-basisrow" key={i}><span style={{ width: 10, height: 10, borderRadius: 3, flex: 'none', background: PALETTE[i % PALETTE.length] }} />
              <div style={{ flex: 1, fontSize: '.78rem', color: '#c9d2e0' }}>{b.name}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.74rem', fontWeight: 700, color: 'var(--muted)' }}>{b.count}</div></div>
          ))}
          <div className="w-note">At <b>{hpw} h/week</b>, clearing the whole slate end-to-end would take <b style={{ color: 'var(--acc)' }}>{Math.round(weeks)} weeks</b> — about <b>{years >= 1 ? years.toFixed(1) + ' years' : Math.round(weeks / 4.345) + ' months'}</b> of streaming.</div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Share (redesign step 4e): shareable cards (PNG via html2canvas) + .ics export.
// ============================================================================
function buildICS(items) {
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate());
  let s = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Stream Slate//nabunan//EN\r\nCALSCALE:GREGORIAN\r\n';
  items.forEach((it, i) => {
    const nd = new Date(it.date.getTime() + 864e5);
    s += 'BEGIN:VEVENT\r\nUID:slate-' + i + '-' + fmt(it.date) + '@nabunan\r\nDTSTART;VALUE=DATE:' + fmt(it.date) +
      '\r\nDTEND;VALUE=DATE:' + fmt(nd) + '\r\nSUMMARY:' + String(it.title).replace(/[,;\\]/g, ' ') + '\r\nEND:VEVENT\r\n';
  });
  return s + 'END:VCALENDAR';
}
function downloadICS(items) {
  const blob = new Blob([buildICS(items)], { type: 'text/calendar' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'stream-slate.ics';
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function savePNG(id, name) {
  const el = document.getElementById(id);
  if (!el || !window.html2canvas) { alert('Export still loading — try again in a second.'); return; }
  window.html2canvas(el, { backgroundColor: '#0a0d14', scale: 2, useCORS: true, logging: false })
    .then((c) => { const a = document.createElement('a'); a.download = name + '.png'; a.href = c.toDataURL('image/png'); a.click(); })
    .catch(() => alert('Cover art is served from an external CDN, which can block PNG export in some browsers. The .ics export always works; or screenshot the card directly.'));
}
function ShareView({ games, today, pace }) {
  const upcoming = games
    .filter((g) => (g.kind === 'game' || g.kind === 'dlc') && g.newRelease !== false && isPlaceable(g.release) && anchorDate(g.release) && anchorDate(g.release).getTime() > today.getTime())
    .sort((a, b) => anchorDate(a.release) - anchorDate(b.release));
  if (!upcoming.length) return <div className="anim"><div className="w-head"><h1>Share your schedule</h1><span>no upcoming dated releases to feature</span></div></div>;
  const hero = upcoming.find((g) => g.release.precision === 'day') || upcoming[0];
  const nextUp = upcoming.slice(0, 5);
  const dated = upcoming.filter((g) => g.release.precision === 'day');
  const heroArt = isImgIcon(hero.icon) ? hero.icon : null;
  const row = (g) => ({ id: g.id, title: g.title, art: isImgIcon(g.icon) ? g.icon : null, color: gameColor(g.id).solid,
    date: g.release.precision === 'day' ? shortDate(anchorDate(g.release)) : releaseLabel(g.release),
    streams: g.hltbHours ? streamsToFinish(g.hltbHours, pace) : 0 });
  return (
    <div className="anim">
      <div className="w-head"><h1>Share your schedule</h1><span>auto-built from your next streams — screenshot or export to post</span>
        <button className="savebtn" style={{ marginLeft: 'auto' }}
          onClick={() => downloadICS(dated.map((g) => ({ date: anchorDate(g.release), title: '🎮 ' + g.title })))}>⤓ Add to Calendar (.ics)</button></div>
      <div className="share-stage">
        <div className="share-col">
          <div className="share-cap">Twitch panel · 340px <button className="savebtn ghost" onClick={() => savePNG('cardV', 'stream-slate-panel')}>↓ Save PNG</button></div>
          <div className="card-v" id="cardV">
            <div className="cardv-top">
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <div className="logo" style={{ width: 30, height: 30, fontSize: '.95rem', boxShadow: 'none', background: '#ffffff22' }}>S</div>
                <div><div className="cardv-brandname">STREAM SLATE</div><div className="cardv-brandsub">@nabunan</div></div>
              </div>
              <div className="cardv-tag">UPCOMING</div>
            </div>
            <div className="cardv-next">
              <div className="cardv-nextart" style={heroArt ? { backgroundImage: `url(${heroArt})` } : { background: gameColor(hero.id).solid }} />
              <div style={{ minWidth: 0 }}>
                <div className="cardv-eyebrow">NEXT UP</div>
                <div className="cardv-title">{hero.title}</div>
                <div className="cardv-date">{hero.release.precision === 'day' ? shortDate(anchorDate(hero.release)) : releaseLabel(hero.release)}</div>
              </div>
            </div>
            <div className="cardv-list">
              {nextUp.map((g) => { const r = row(g); return (
                <div className="cardv-row" key={r.id}>
                  <span className="cardv-chip">{r.date}</span>
                  <div className="cardv-rowart" style={r.art ? { backgroundImage: `url(${r.art})` } : { background: r.color }} />
                  <div className="cardv-rowtitle">{r.title}</div>
                  <span className="cardv-rowstr">{r.streams ? r.streams + ' str' : ''}</span>
                </div>); })}
            </div>
            <div className="cardv-foot">slate.nabunan.com</div>
          </div>
        </div>
        <div className="share-col">
          <div className="share-cap">Social / Discord banner · 680px <button className="savebtn ghost" onClick={() => savePNG('cardW', 'stream-slate-banner')}>↓ Save PNG</button></div>
          <div className="card-w" id="cardW">
            <div className="cardw-left">
              <div className="cardw-leftart" style={heroArt ? { backgroundImage: `url(${heroArt})` } : { background: gameColor(hero.id).solid }} />
              <div className="cardw-leftveil" />
              <div className="cardw-leftbody">
                <div className="cardw-eyebrow">NEXT STREAM</div>
                <div className="cardw-title">{hero.title}</div>
                <div className="cardw-date">{hero.release.precision === 'day' ? shortDate(anchorDate(hero.release)) : releaseLabel(hero.release)}</div>
              </div>
            </div>
            <div className="cardw-right">
              <div className="cardw-brand"><div className="logo" style={{ width: 28, height: 28, fontSize: '.9rem', boxShadow: 'none' }}>S</div>
                <div><div className="cardv-brandname">STREAM SLATE</div><div className="cardv-brandsub">@nabunan · on deck</div></div></div>
              {nextUp.map((g) => { const r = row(g); return (
                <div className="cardv-row" key={r.id}>
                  <span className="cardv-chip">{r.date}</span>
                  <div className="cardv-rowart" style={r.art ? { backgroundImage: `url(${r.art})` } : { background: r.color }} />
                  <div className="cardv-rowtitle">{r.title}</div>
                  <span className="cardv-rowstr">{r.streams ? r.streams + ' str' : ''}</span>
                </div>); })}
              <div className="cardw-foot">slate.nabunan.com · paced to my live 90-day cadence</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Live "on-air" hero (redesign step 4g): driven by /api/live (Twitch Helix), with
// a manual preview fallback. Self-ticking uptime.
// ============================================================================
function LiveHero({ state, manualStart, games }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const live = state && state.live;
  const startMs = live && state.startedAt ? new Date(state.startedAt).getTime() : (manualStart || now);
  let s = Math.max(0, Math.floor((now - startMs) / 1000));
  const h = Math.floor(s / 3600); s %= 3600; const mm = Math.floor(s / 60); s %= 60;
  const uptime = (h > 0 ? h + ':' : '') + String(mm).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  const gname = live ? state.gameName : null;
  let g = null;
  if (gname) { const k = gname.toLowerCase(); g = games.find((x) => x.title.toLowerCase().includes(k) || k.includes(stripGameName(x.title))) || null; }
  const art = g && isImgIcon(g.icon) ? g.icon : null;
  const title = (live && state.title) || (g && g.title) || gname || 'Live preview';
  return (
    <div className="live-hero">
      {art && <div className="live-bg" style={{ backgroundImage: `url(${art})` }} />}
      <div className="live-veil" />
      <div className="live-body">
        <div className="live-tag"><span className="live-dot2" />{live ? 'LIVE NOW' : 'PREVIEW'}</div>
        <div className="live-title">{title}</div>
        <div className="live-meta">{gname ? gname + ' · ' : ''}{live && state.viewers != null ? state.viewers.toLocaleString() + ' watching' : 'on @nabunan'}</div>
      </div>
      <div className="live-elapsed"><div className="le-num">{uptime}</div><div className="le-lbl">UPTIME</div></div>
    </div>
  );
}

// Recently-wrapped celebration. A game counts as wrapped if it's flagged finished in
// games.json OR its real streamed hours have met/exceeded its HLTB estimate.
function FinishedBanner({ game, doneHours, doneCounts, onAddStream, onClose, onPick }) {
  const streams = doneCounts[game.id] || 0;
  const hrs = Math.round(doneHours[game.id] || game.hltbHours || 0);
  return (
    <div className="fin-banner">
      <span className="fin-emoji">🎉</span>
      <div className="fin-txt"><b style={{ cursor: 'pointer' }} onClick={() => onPick(game.id)}>Wrapped {game.title}</b>{game.wrapNote ? ` — ${game.wrapNote}` : ` — ${streams ? streams + ' stream' + (streams === 1 ? '' : 's') + ' · ' : ''}${hrs}h · hit its estimate`}</div>
      {onAddStream && <button className="fin-add" onClick={onAddStream} title="Not actually done — add another stream and keep it scheduled">↺ Not done · +1 stream</button>}
      <button className="fin-x" onClick={onClose}>×</button>
    </div>
  );
}

// ============================================================================
// Now/Next cockpit hero + progress rings (redesign port). Progress % is derived
// from real streamed history (doneCounts / streamsToFinish), not a sample.
// ============================================================================
function ProgressRing({ pct, tone }) {
  const deg = Math.max(0, Math.min(100, pct)) * 3.6;
  return (
    <div className="ring" style={{ background: `conic-gradient(${tone} ${deg}deg, rgba(255,255,255,.08) 0)` }}>
      <div className="ring-inner">{pct}%</div>
    </div>
  );
}
function LaunchCountdown({ launch }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!launch) return <div className="cd-none">No dated launch on the horizon.</div>;
  let diff = Math.max(0, launch.ms - now);
  const d = Math.floor(diff / 864e5); diff -= d * 864e5;
  const h = Math.floor(diff / 36e5); diff -= h * 36e5;
  const m = Math.floor(diff / 6e4); diff -= m * 6e4;
  const s = Math.floor(diff / 1e3);
  const cell = (n, l) => <div className="cd-cell"><div className="cd-num">{n}</div><div className="cd-lbl">{l}</div></div>;
  return <div className="cd-grid">{cell(d, 'DAYS')}{cell(h, 'HRS')}{cell(m, 'MIN')}{cell(s, 'SEC')}</div>;
}
function NowNextHero({ games, pace, doneHours, doneCounts, today, onPick }) {
  const inProgress = games.filter((g) => g.kind !== 'event' && (doneHours[g.id] || 0) > 0 && (Number(g.hltbHours) || 0) - (doneHours[g.id] || 0) > 0.5)
    .map((g) => {
      const total = Math.max(1, streamsToFinish(g.hltbHours, pace));
      const done = doneCounts[g.id] || 0;
      const remaining = Math.max(0, Math.round((Number(g.hltbHours) || 0) - (doneHours[g.id] || 0)));
      return { g, total, done, remaining, pct: Math.min(100, Math.round((done / total) * 100)) };
    }).slice(0, 2);
  const upcoming = games
    .filter((g) => (g.kind === 'game' || g.kind === 'dlc') && g.newRelease !== false && isPlaceable(g.release) && anchorDate(g.release) && anchorDate(g.release).getTime() > today.getTime())
    .sort((a, b) => anchorDate(a.release) - anchorDate(b.release));
  const launchG = upcoming.find((g) => g.release.precision === 'day') || null;
  const launchMs = launchG ? new Date(launchG.release.year, (launchG.release.month || 1) - 1, launchG.release.day || 1).getTime() : null;
  const upNext = upcoming.filter((g) => !launchG || g.id !== launchG.id).slice(0, 4);
  const launchArt = launchG && isImgIcon(launchG.icon) ? launchG.icon : null;
  return (
    <div className="hero-grid">
      <div className="panel">
        <div className="eyebrow" style={{ color: '#cdb6ff' }}><span className="live-dot" />NOW STREAMING</div>
        {inProgress.length ? (
          <div className="np-cards">
            {inProgress.map((p) => {
              const art = isImgIcon(p.g.icon) ? p.g.icon : null;
              const tone = gameColor(p.g.id).solid;
              const gp = p.g.partGoal;
              return (
                <div className="np-card" key={p.g.id} onClick={() => onPick(p.g.id)} style={{ borderColor: tone + '44', cursor: 'pointer' }}>
                  <div className="np-top">
                    <div className="np-art" style={art ? { backgroundImage: `url(${art})` } : { background: tone }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="np-title">{p.g.title}</div>
                      <div className="np-status" style={{ background: '#13201a', color: 'var(--good)' }}>In progress</div>
                    </div>
                  </div>
                  <div className="np-prog">
                    <ProgressRing pct={p.pct} tone={tone} />
                    <div><div className="np-done">Stream {p.done} of {p.total}</div>
                      <div className="np-left">{Math.max(0, p.total - p.done)} left · ~{p.remaining}h to go</div></div>
                  </div>
                  {gp && <div className="goal"><span className="lbl">GOAL · </span>{renderSpoilers(gp)}</div>}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="np-empty">Between games — nothing in progress right now. Your next pick is in <b>Tonight</b> below, and the next release is on the right.</div>
        )}
      </div>
      <div className="panel">
        <div className="cd-head"><b>NEXT LAUNCH</b></div>
        {launchG ? (
          <div className="cd-game">
            <div className="cd-gameart" style={launchArt ? { backgroundImage: `url(${launchArt})` } : { background: gameColor(launchG.id).solid }} />
            <div><div className="cd-gametitle">{launchG.title}</div><div className="cd-gamedate">{releaseLabel(launchG.release)}</div></div>
          </div>
        ) : null}
        <LaunchCountdown launch={launchMs ? { ms: launchMs } : null} />
        {upNext.length > 0 && <div className="upnext-h">UP NEXT</div>}
        {upNext.map((g) => (
          <div className="un-row" key={g.id} onClick={() => onPick(g.id)} style={{ cursor: 'pointer' }}>
            <div className="un-art" style={isImgIcon(g.icon) ? { backgroundImage: `url(${g.icon})` } : { background: gameColor(g.id).solid }} />
            <div style={{ minWidth: 0, flex: 1 }}><div className="un-title">{g.title}</div>
              <div className="un-meta">{releaseLabel(g.release)}{g.hltbHours ? ` · ${streamsToFinish(g.hltbHours, pace)} streams` : ''}</div></div>
            <span className="un-dot" style={{ background: gameColor(g.id).solid }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// App
// ============================================================================
function App() {
  const [games, setGames] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [pace, setPace] = useState(FALLBACK_PACE);
  const [streams, setStreams] = useState([]);   // actual completed streams (Twitch history)
  const [loaded, setLoaded] = useState(false);
  const [detail, setDetail] = useState(null);      // game id
  const [showSettings, setShowSettings] = useState(false);
  const [liveState, setLiveState] = useState(null); // /api/live (Twitch Helix)
  const [manualLive, setManualLive] = useState(false);
  const [manualStart, setManualStart] = useState(0);
  const firstSave = useRef(true);
  // Poll real on-air state every 60s (graceful if Twitch creds aren't configured).
  useEffect(() => {
    let on = true;
    const load = () => fetch('/api/live').then((r) => r.json()).then((j) => { if (on) setLiveState(j); }).catch(() => {});
    load(); const t = setInterval(load, 60000);
    return () => { on = false; clearInterval(t); };
  }, []);

  // Slate comes from games.json (source of truth); settings from KV; pace cached.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const gr = await fetch('games.json', { cache: 'no-cache' });
        if (gr.ok) { const data = await gr.json(); if (!cancelled) setGames(gamesFromFile(data)); }
      } catch (e) { /* leave empty */ }
      try {
        const r = await fetch('/api/state');
        let state = r.ok ? await r.json() : null;
        if (!state) state = loadLocal();
        // Always open on the calendar (Month grid); the chosen view is a per-session
        // preference, not restored from KV.
        if (!cancelled && state && state.settings) setSettings({ ...DEFAULT_SETTINGS, ...state.settings, view: DEFAULT_SETTINGS.view });
      } catch (e) {
        const ls = loadLocal();
        if (!cancelled && ls && ls.settings) setSettings({ ...DEFAULT_SETTINGS, ...ls.settings, view: DEFAULT_SETTINGS.view });
      }
      try {
        const pr = await fetch('/api/pace');
        if (pr.ok) { const p = await pr.json(); if (!cancelled && p) setPace(p); }
      } catch (e) { /* keep fallback */ }
      try {
        const sr = await fetch('/api/streams');
        if (sr.ok) { const s = await sr.json(); if (!cancelled && s && Array.isArray(s.streams)) setStreams(s.streams); }
      } catch (e) { /* no history overlay */ }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist settings only (debounced) — the slate is edited in games.json.
  useEffect(() => {
    if (!loaded) return;
    if (firstSave.current) { firstSave.current = false; return; }
    const state = { settings, savedAt: new Date().toISOString() };
    saveLocal(state);
    const t = setTimeout(() => {
      fetch('/api/state', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      }).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [settings, loaded]);

  const ep = useMemo(() => effectivePace(settings, pace), [settings, pace]);
  const normVacs = useMemo(() => normalizeVacations(settings.vacations), [settings.vacations]);
  // Per-game time-to-beat adjustments (when a game runs longer/shorter than estimated):
  // bump hltbHours so streams-to-finish, the schedule, and deadline gauges all recalc.
  const adjGames = useMemo(() => {
    const adj = settings.hoursAdjust || {};
    return games.map((g) => { const d = adj[g.id]; return d ? { ...g, hltbHours: Math.max(0.5, (Number(g.hltbHours) || 0) + d) } : g; });
  }, [games, settings.hoursAdjust]);
  // Auto-pick a concrete start day for each month/quarter game the user pinned,
  // then anchor those games to it so the rest of the app treats them as dated.
  const autoMap = useMemo(() => autoPlaceDays(adjGames, settings.autoPlace, normVacs), [adjGames, settings.autoPlace, normVacs]);
  // "finish before X" groups are packed automatically (file-driven) and win over
  // the user's loose auto-placements.
  const beforeMap = useMemo(() => finishBeforeDays(adjGames, ep, normVacs), [adjGames, ep, normVacs]);
  const effGames = useMemo(() => withAutoPlacement(adjGames, { ...autoMap, ...beforeMap }), [adjGames, autoMap, beforeMap]);
  // Register cover-derived band colours before any child renders/uses gameColor.
  effGames.forEach((g) => { if (g.iconColor) ICON_COLORS[g.id] = g.iconColor; });
  // Per-day overrides (settings store ISO dates; convert to engine day-keys):
  // longDays = days off treated as weekend-length; dayPins = force a game on a day.
  const isoToKey = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return `${y}-${m - 1}-${d}`; };
  // Real streamed history mapped onto games: hours (so the plan continues in-progress
  // games) + per-part completed-stream counts (for per-session goal numbering).
  const doneInfo = useMemo(() => computeDoneInfo(adjGames, streams), [adjGames, streams]);
  const dayOpts = useMemo(() => ({
    longDays: new Set((settings.longDays || []).map(isoToKey)),
    dayPins: Object.fromEntries(Object.entries(settings.dayPins || {}).map(([iso, id]) => [isoToKey(iso), id])),
    restDays: new Set((settings.restDays || []).map(isoToKey)),
    doneHours: doneInfo.hours,
  }), [settings.longDays, settings.dayPins, settings.restDays, doneInfo]);
  // Choose what to stream today (pins it / marks rest / clears to plan default). Saved
  // to settings (KV), so the calendar cell reflects it everywhere and it persists.
  const chooseToday = useCallback((choice) => {
    const d = new Date(); // local calendar day, matching the app's "today"
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    setSettings((s) => {
      const dayPins = { ...(s.dayPins || {}) };
      const restDays = (s.restDays || []).filter((d) => d !== iso);
      delete dayPins[iso];
      if (choice === '__rest__') restDays.push(iso);
      else if (choice && choice !== '__default__') dayPins[iso] = choice;
      return { ...s, dayPins, restDays };
    });
  }, []);
  const togglePlan = useCallback((id) => {
    setSettings((s) => {
      const cur = s.autoPlace || [];
      return { ...s, autoPlace: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
    });
  }, []);
  // Mark/unmark a day (ISO 'YYYY-MM-DD') as a day off → streamed at weekend length.
  const toggleLongDay = useCallback((iso) => {
    setSettings((s) => {
      const cur = s.longDays || [];
      return { ...s, longDays: cur.includes(iso) ? cur.filter((x) => x !== iso) : [...cur, iso] };
    });
  }, []);
  // Mark/unmark a day as a rest day (no committed stream).
  const toggleRestDay = useCallback((iso) => {
    setSettings((s) => {
      const cur = s.restDays || [];
      return { ...s, restDays: cur.includes(iso) ? cur.filter((x) => x !== iso) : [...cur, iso] };
    });
  }, []);
  // Adjust a game's time-to-beat by deltaHours (e.g., +1 stream when it runs longer).
  // null delta clears the adjustment. Persists; the whole schedule recalculates.
  const adjustHours = useCallback((id, delta) => {
    setSettings((s) => {
      const cur = { ...(s.hoursAdjust || {}) };
      if (delta == null) { delete cur[id]; return { ...s, hoursAdjust: cur }; }
      const v = Math.round(((cur[id] || 0) + delta) * 10) / 10;
      if (Math.abs(v) < 0.05) delete cur[id]; else cur[id] = v;
      return { ...s, hoursAdjust: cur };
    });
  }, []);
  // Realistic release-priority finish per game (for the detail card).
  const seqPositions = useMemo(
    () => schedule(effGames.filter((g) => isPlaceable(g.release) && !g.bonus), ep, 'sequential', normVacs, dayOpts),
    [effGames, ep, normVacs, dayOpts]
  );

  const detailGame = detail ? effGames.find((g) => g.id === detail) : null;

  // ---- health instruments + deadline gauges (redesign step 1) ----
  const today = useMemo(() => { const n = new Date(); return utc(n.getFullYear(), n.getMonth() + 1, n.getDate()); }, []);
  const deadlines = useMemo(() => buildDeadlines(effGames, ep, doneInfo.hours, today), [effGames, ep, doneInfo.hours, today]);
  const atRisk = deadlines.filter((d) => !d.onTrack).length;
  const inFlight = useMemo(() => {
    const dh = doneInfo.hours || {};
    const bases = new Map(); // base title -> true (dedupe multi-part)
    for (const g of effGames) {
      if (g.kind === 'event') continue;
      const done = dh[g.id] || 0;
      if (done > 0 && (Number(g.hltbHours) || 0) - done > 0.5) bases.set(baseTitle(g.title), true);
    }
    const names = [...bases.keys()];
    return { count: names.length, names: names.slice(0, 2).join(' · ') };
  }, [effGames, doneInfo.hours]);
  const launch = useMemo(() => {
    const n = new Date(); const todayLocalMs = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    let best = null;
    for (const g of effGames) {
      if (!((g.kind === 'game' || g.kind === 'dlc') && g.newRelease !== false)) continue; // genuine new releases only (matches Releases tab)
      if (!g.release || g.release.precision !== 'day') continue;
      const a = new Date(g.release.year, (g.release.month || 1) - 1, g.release.day || 1).getTime();
      if (a <= todayLocalMs) continue; // today's midnight launch already happened — roll to the next
      if (!best || a < best.ms) best = { ms: a, title: g.title };
    }
    return best;
  }, [effGames]);
  const paceSource = settings.override ? 'manual'
    : pace.source === 'sullygnome' ? 'live 90-day'
    : pace.source === 'twitchtracker' ? 'TwitchTracker 30-day' : 'fallback';
  // What-if queue order: saved order (still-existing ids) + any new games appended.
  const queueIds = useMemo(() => {
    const def = defaultQueueIds(effGames, today, doneInfo.hours);
    const live = new Set(def);
    const saved = (settings.queue || []).filter((id) => live.has(id));
    const merged = [...saved];
    for (const id of def) if (!merged.includes(id)) merged.push(id);
    return merged;
  }, [effGames, settings.queue, today, doneInfo.hours]);
  const reorderQueue = useCallback((ids) => setSettings((s) => ({ ...s, queue: ids })), []);
  const themeObj = THEMES.find((t) => t.id === settings.theme) || THEMES[0];
  // Most-recently-wrapped game (explicit finished flag, else inferred from history).
  const wrapped = useMemo(() => {
    const list = effGames.filter((g) => g.kind !== 'event' &&
      (g.finished || ((doneInfo.hours[g.id] || 0) > 0 && (Number(g.hltbHours) || 0) - (doneInfo.hours[g.id] || 0) <= 0.5)));
    list.sort((a, b) => { const da = a.finishedDate || doneInfo.last[a.id] || ''; const db = b.finishedDate || doneInfo.last[b.id] || ''; return da < db ? 1 : -1; });
    return list[0] || null;
  }, [effGames, doneInfo]);

  return (
    <div className="app" style={{ '--acc': themeObj.acc, '--acc-ink': themeObj.ink }}>
      <header>
        <div className="hdr">
          <div>
            <div className="hdr-title">Stream Slate<span className="dot">.</span></div>
          </div>
          <div className="hdr-spacer" />
          <div className="seg">
            <button className={settings.view === 'timeline' ? 'on' : ''}
              onClick={() => setSettings((s) => ({ ...s, view: 'timeline' }))}>Timeline</button>
            <button className={settings.view === 'grid' ? 'on' : ''}
              onClick={() => setSettings((s) => ({ ...s, view: 'grid' }))}>Month grid</button>
            <button className={settings.view === 'calendar' ? 'on' : ''}
              onClick={() => setSettings((s) => ({ ...s, view: 'calendar' }))}>Calendar</button>
            <button className={settings.view === 'queue' ? 'on' : ''}
              onClick={() => setSettings((s) => ({ ...s, view: 'queue' }))}>Queue</button>
            <button className={settings.view === 'browse' ? 'on' : ''}
              onClick={() => setSettings((s) => ({ ...s, view: 'browse' }))}>Browse</button>
            <button className={settings.view === 'season' ? 'on' : ''}
              onClick={() => setSettings((s) => ({ ...s, view: 'season' }))}>Season</button>
            <button className={settings.view === 'share' ? 'on' : ''}
              onClick={() => setSettings((s) => ({ ...s, view: 'share' }))}>Share</button>
            <button className={settings.view === 'releases' ? 'on' : ''}
              onClick={() => setSettings((s) => ({ ...s, view: 'releases' }))}>Releases</button>
          </div>
          {settings.view === 'timeline' && (
            <div className="seg alt">
              <button className={settings.schedMode === 'parallel' ? 'on' : ''}
                onClick={() => setSettings((s) => ({ ...s, schedMode: 'parallel' }))}>True dates</button>
              <button className={settings.schedMode === 'sequential' ? 'on' : ''}
                onClick={() => setSettings((s) => ({ ...s, schedMode: 'sequential' }))}>My queue</button>
            </div>
          )}
          <div className="theme-sw" title="Accent theme">
            {THEMES.map((t) => (
              <button key={t.id} className={'sw' + (settings.theme === t.id ? ' on' : '')}
                style={{ background: t.acc }} title={t.id}
                onClick={() => setSettings((s) => ({ ...s, theme: t.id }))} />
            ))}
          </div>
          <button className={'btn livebtn' + ((liveState && liveState.live) || manualLive ? ' on' : '')}
            onClick={() => { if (manualLive) { setManualLive(false); } else { setManualLive(true); setManualStart(Date.now()); } }}
            title={liveState && liveState.live ? 'On air now (Twitch)' : liveState && liveState.configured === false ? 'Preview the on-air hero (connect Twitch creds for the real signal)' : 'Preview the on-air hero'}>
            <span className="dot" />{(liveState && liveState.live) ? 'On air' : manualLive ? 'End preview' : 'Go live'}</button>
          <button className="btn" onClick={() => setShowSettings(true)}>⚙ Settings</button>
        </div>
      </header>

      {wrapped && settings.finDismiss !== wrapped.id && (
        <FinishedBanner game={wrapped} doneHours={doneInfo.hours} doneCounts={doneInfo.counts}
          onPick={setDetail} onAddStream={() => adjustHours(wrapped.id, Math.max(2, Math.round(ep.hoursPerStream || 5)))}
          onClose={() => setSettings((s) => ({ ...s, finDismiss: wrapped.id }))} />
      )}
      {((liveState && liveState.live) || manualLive) && <LiveHero state={liveState && liveState.live ? liveState : null} manualStart={manualStart} games={effGames} />}
      <InstrumentPanel pace={ep} source={paceSource} inFlight={inFlight} atRisk={atRisk} launch={launch} />
      {settings.view === 'grid' && <NowNextHero games={effGames} pace={ep} doneHours={doneInfo.hours} doneCounts={doneInfo.counts} today={today} onPick={setDetail} />}
      {settings.view === 'grid' && <DeadlinePanel deadlines={deadlines} onPick={setDetail} />}

      {settings.view === 'timeline'
        ? <TimelineView games={effGames} pace={ep} mode={settings.schedMode} vacations={normVacs} onPick={setDetail} />
        : settings.view === 'queue'
        ? <QueueView games={effGames} pace={ep} ids={queueIds} today={today} doneHours={doneInfo.hours} onReorder={reorderQueue} onPick={setDetail} />
        : settings.view === 'browse'
        ? <BrowseView games={effGames} onPick={setDetail} />
        : settings.view === 'season'
        ? <SeasonView games={effGames} pace={ep} onPick={setDetail} />
        : settings.view === 'share'
        ? <ShareView games={effGames} today={today} pace={ep} />
        : settings.view === 'calendar'
        ? <MonthGridView games={effGames} pace={ep} vacations={normVacs} dayOpts={dayOpts} doneCounts={doneInfo.counts} streamMap={doneInfo.streamMap} sessionGoals={settings.sessionGoals || {}} streams={streams} longDayISOs={settings.longDays || []} restDayISOs={settings.restDays || []} paginated onPick={setDetail} onTogglePlan={togglePlan} onChooseToday={chooseToday} onToggleLongDay={toggleLongDay} onToggleRest={toggleRestDay} />
        : settings.view === 'releases'
        ? <ReleasesView games={effGames} pace={ep} onPick={setDetail} />
        : <MonthGridView games={effGames} pace={ep} vacations={normVacs} dayOpts={dayOpts} doneCounts={doneInfo.counts} streamMap={doneInfo.streamMap} sessionGoals={settings.sessionGoals || {}} streams={streams} longDayISOs={settings.longDays || []} restDayISOs={settings.restDays || []} onPick={setDetail} onTogglePlan={togglePlan} onChooseToday={chooseToday} onToggleLongDay={toggleLongDay} onToggleRest={toggleRestDay} />}

      {detailGame && (
        <DetailCard game={detailGame} pace={ep} vacations={normVacs} queuedPos={seqPositions[detailGame.id]}
          games={effGames} adjust={(settings.hoursAdjust || {})[detailGame.id] || 0} onAdjust={adjustHours}
          doneHours={doneInfo.hours} onClose={() => setDetail(null)} />
      )}
      {showSettings && (
        <SettingsPanel settings={settings} pace={pace} setSettings={setSettings} setPace={setPace}
          onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

// ============================================================================
// Timeline (Gantt)
// ============================================================================
function TimelineView({ games, pace, mode, vacations, onPick }) {
  const placeable = useMemo(() => games.filter((g) => isPlaceable(g.release)), [games]);
  const rail = useMemo(() => games.filter((g) => !isPlaceable(g.release)), [games]);
  // "My queue" uses the interleaved plan; "True dates" places each game on its date.
  const positions = useMemo(
    () => (mode === 'sequential' ? streamPlan(placeable, pace, vacations).positions : schedule(placeable, pace, 'parallel', vacations)),
    [placeable, pace, mode, vacations]
  );

  const rows = useMemo(() => {
    return placeable.map((g) => ({ g, pos: positions[g.id], bonus: g.bonus }))
      .filter((r) => r.pos)
      .sort((a, b) => a.pos.start - b.pos.start);
  }, [placeable, positions]);

  if (rows.length === 0 && rail.length === 0) {
    return <div className="tl-wrap"><div className="mg-empty">No games yet — add one to get started.</div></div>;
  }

  // Domain: pad a little on each side, snap to month boundaries.
  let min = null, max = null;
  for (const r of rows) {
    if (!min || r.pos.start < min) min = r.pos.start;
    if (!max || r.pos.end > max) max = r.pos.end;
  }
  if (!min) { min = new Date(); max = addDays(min, 30); }
  const domStart = new Date(Date.UTC(min.getUTCFullYear(), min.getUTCMonth(), 1));
  const domEnd = new Date(Date.UTC(max.getUTCFullYear(), max.getUTCMonth() + 1, 1));
  const totalDays = Math.max(1, diffDays(domStart, domEnd));
  const trackW = totalDays * PX_PER_DAY;
  const xOf = (d) => diffDays(domStart, d) * PX_PER_DAY;

  // Month ticks
  const months = [];
  let m = new Date(domStart);
  while (m < domEnd) {
    months.push(new Date(m));
    m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
  }
  const today = new Date();

  return (
    <div>
      <div className="tl-wrap">
        <div className="tl-scroll" style={{ '--label-w': '200px' }}>
          <div className="tl-inner" style={{ minWidth: 200 + trackW }}>
            <div className="tl-axis">
              <div className="tl-corner">Title</div>
              <div className="tl-months" style={{ width: trackW }}>
                {months.map((mo, i) => (
                  <div key={i} className={'tl-month' + (mo.getUTCMonth() === 0 ? ' yr' : '')}
                    style={{ left: xOf(mo), width: PX_PER_DAY * daysInMonth(mo) }}>
                    {MONTHS[mo.getUTCMonth()]}{mo.getUTCMonth() === 0 ? ` ’${String(mo.getUTCFullYear()).slice(2)}` : ''}
                  </div>
                ))}
              </div>
            </div>

            {rows.map(({ g, pos, bonus }) => {
              const segs = pos.segments && pos.segments.length ? pos.segments : [{ start: pos.start, end: pos.end }];
              const fuzzy = isFuzzy(g.release);
              const strk = streamsToFinish(g.hltbHours, pace);
              const firstLeft = xOf(segs[0].start);
              const firstW = xOf(segs[0].end) - firstLeft;
              const lastRight = xOf(segs[segs.length - 1].end);
              const labelInside = firstW > 90;
              return (
                <div className={`tl-row${bonus ? ' bonus' : ''}`} key={g.id}>
                  <div className="tl-label">
                    <GameBadge game={g} size={22} />
                    <span className="tl-label-txt">
                      <span className="nm">{g.title}</span>
                      <span className="meta">{releaseLabel(g.release)}{g.kind !== 'game' ? ' · ' + KIND_LABEL[g.kind] : ''}{bonus ? ' · ★ bonus' : ''}</span>
                    </span>
                  </div>
                  <div className="tl-track" style={{ width: trackW }}>
                    {months.map((mo, i) => (
                      <div key={i} className="tl-gridline" style={{ left: xOf(mo) }} />
                    ))}
                    {(vacations || []).map((v, i) => {
                      const vl = xOf(v.start < domStart ? domStart : v.start);
                      const vr = xOf(v.end > domEnd ? domEnd : v.end);
                      return vr > vl
                        ? <div key={'v' + i} className="tl-vac" style={{ left: vl, width: vr - vl }}
                            title={v.label || 'Time off'} />
                        : null;
                    })}
                    {today >= domStart && today < domEnd &&
                      <div className="tl-today" style={{ left: xOf(today) }} />}
                    {/* dotted connectors across the pauses between split segments */}
                    {segs.slice(1).map((s, i) => {
                      const a = xOf(segs[i].end), bx = xOf(s.start);
                      return bx > a ? <div key={'lk' + i} className="bar-link" style={{ left: a, width: bx - a }} /> : null;
                    })}
                    {segs.map((s, si) => {
                      const l = xOf(s.start);
                      const w = Math.max(6, xOf(s.end) - l);
                      return (
                        <div key={si} className={`bar k-${g.kind}${fuzzy ? ' fuzzy' : ''}${si > 0 ? ' cont' : ''}${bonus ? ' bonus' : ''}`}
                          style={{ left: l, width: w }} onClick={() => onPick(g.id)}
                          title={`${g.title} — ${releaseLabel(g.release)}${segs.length > 1 ? ` (part ${si + 1} of ${segs.length})` : ''}`}>
                          {si === 0 && labelInside && <span className="bt">{g.title}</span>}
                          {si === 0 && labelInside && g.kind !== 'event' && strk > 0 &&
                            <span className="strk">{strk} strm</span>}
                        </div>
                      );
                    })}
                    {!labelInside && g.kind !== 'event' && strk > 0 &&
                      <div className="bar-out" style={{ left: lastRight + 6 }}>{strk} strm</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {rail.length > 0 && (
        <div className="rail">
          <div className="rail-h">Unscheduled · year-only / TBD ({rail.length})</div>
          <div className="rail-chips">
            {rail.map((g) => (
              <div className="chip" key={g.id} onClick={() => onPick(g.id)}>
                <GameBadge game={g} size={16} />
                {g.title}
                <span className="when">{releaseLabel(g.release)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function daysInMonth(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

// ============================================================================
// Month grid
// ============================================================================
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DOW_FULL = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

// Re-render when crossing the mobile breakpoint so we can swap layouts.
function useIsMobile() {
  const q = '(max-width: 640px)';
  const has = typeof window !== 'undefined' && window.matchMedia;
  const [m, setM] = useState(() => (has ? window.matchMedia(q).matches : false));
  useEffect(() => {
    if (!has) return;
    const mq = window.matchMedia(q);
    const on = (e) => setM(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}

const dayKey = (d) => `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
const firstOfMonth = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

function vacLabelFor(day, vacs) {
  const v = (vacs || []).find((x) => day >= x.start && day < x.end);
  return v && v.label ? v.label : 'Away';
}

// What's happening on a given calendar day: vacation, the game being streamed,
// and whether this cell is the start of a stretch (so we label it once).
function dayInfo(day, ctx) {
  const k = dayKey(day);
  const prev = addDays(day, -1);
  const releases = ctx.releasesByDay[k] || [];
  // Actual history wins: a day you already streamed shows what you really played.
  const streamed = ctx.streamedByDay && ctx.streamedByDay[k];
  if (streamed && streamed.length) {
    // Attach each game's playthrough placement (X of N: completed + planned).
    let primaryOrd = null, primaryTotal = null;
    const enriched = streamed.map((st) => ({
      minutes: st.minutes,
      games: st.games.map((g) => {
        const m = ctx.streamMap[`${k}|${stripGameName(g.name)}`];
        let ord = null, total = null;
        if (m) { ord = m.ord; total = (ctx.doneCounts[m.id] || 0) + (ctx.plannedTotal[m.id] || 0); if (primaryOrd == null) { primaryOrd = ord; primaryTotal = total; } }
        return { ...g, ord, total };
      }),
    }));
    return { streamed: enriched, streamOrd: primaryOrd, streamTotal: primaryTotal, releases };
  }
  if (inVacation(day, ctx.vacations)) {
    return { vac: true, vacRunStart: !inVacation(prev, ctx.vacations), vacLabel: vacLabelFor(day, ctx.vacations), releases };
  }
  // A day the user chose to rest (no committed stream).
  if (ctx.restDays && ctx.restDays.has(k)) return { rest: true, releases };
  // Show one cell per actual stream session (a game appears on exactly its
  // "streams to finish" days, at your real cadence), not every in-progress day.
  // A midnight-launch game's eve carries its short ~4h midnight session here.
  const session = ctx.sessionByDay[k];
  if (session) {
    // Per-session goal, numbered by ABSOLUTE stream ordinal (completed streams of this
    // game + this session's index), so "2nd stream" counts ones already streamed.
    const doneN = ctx.doneCounts[session.id] || 0;
    const ord = doneN + session.idx;                 // absolute stream number
    const ordTotal = doneN + session.total;          // total streams incl. completed
    const goal = ctx.sessionGoals[`${session.id}#${ord}`] || null;
    return { releases, play: ctx.gameById[session.id], session, goal, midnight: !!session.midnight, streamOrd: ord, streamTotal: ordTotal };
  }
  // bonus game filling a spare slot (faded).
  const bonusId = ctx.bonusPlayByDay && ctx.bonusPlayByDay[k];
  if (bonusId) {
    return { releases, bonusPlay: ctx.gameById[bonusId], bonusFirst: ctx.bonusPlayByDay[dayKey(prev)] !== bonusId };
  }
  return { releases, play: null };
}

// A "finish before / by" deadline bracket: the grouped games + a feasibility note
// that suggests an optimal cadence when the current pace won't make it in time.
function DeadlineBracket({ br, onPick, mobile }) {
  const pfx = mobile ? 'mg' : 'gc';
  const label = br.isGameRef
    ? <span>⤿ finish before <b>{br.targetTitle}</b> · by {shortDate(addDays(br.deadline, -1))}</span>
    : (br.precision === 'month' || br.precision === 'quarter' || br.precision === 'year')
      ? <span>⤿ finish by <b>end of {br.periodLabel}</b></span>
      : <span>⤿ finish by <b>{br.periodLabel}</b></span>;
  return (
    <div className={`${pfx}-bracket`}>
      <span className={`${pfx}-bracket-h`}>{label}</span>
      {br.games.map((g) => (
        <button key={g.id} className={`${pfx}-planned-chip placed`}
          style={{ background: gameColor(g.id).solid, borderColor: gameColor(g.id).solid }}
          onClick={() => onPick(g.id)}
          title={`${g.title}${g.placedDay ? ` — starts ${fmtDate(g.placedDay)}` : ''}`}>
          {g.title}{g.placedDay ? (mobile ? ` · ${shortDate(g.placedDay)}` : <small>▸ {shortDate(g.placedDay)}</small>) : null}</button>
      ))}
      {!br.past && br.boost && (
        <div className={`${pfx}-deadnote ${br.boost.fits ? 'warn' : 'warn'}`}>
          {br.boost.fits
            ? <>⏱ Intensive: to finish these <b>{br.neededHours}h</b> on time the plan below runs
              ~<b>{br.boost.days} stream days</b> (vs your usual ~{br.boost.usualDays}) at ~<b>{br.boost.hps}h each</b> —
              about <b>{br.boost.hpw}h/wk</b>. It does fit.</>
            : <>⚠ These <b>{br.neededHours}h</b> won’t finish by the deadline even streaming every available day
              (~{br.boost.days} days at ~{br.boost.hps}h each). Move the deadline or shorten the games.</>}
        </div>
      )}
      {!br.past && !br.boost && (
        <div className={`${pfx}-deadnote ok`}>✓ On track at your current ~{br.hpw}h/wk.</div>
      )}
    </div>
  );
}

// Tap-to-reveal spoiler. Hidden until clicked, so plot details stay covered.
function Spoiler({ children }) {
  const [shown, setShown] = React.useState(false);
  return (
    <span className={`spoiler${shown ? ' shown' : ''}`}
      onClick={(e) => { e.stopPropagation(); if (!shown) setShown(true); }}
      title={shown ? '' : 'Tap to reveal spoiler'}>{children}</span>
  );
}

// Render text with Discord-style ||spoiler|| segments as tap-to-reveal spans.
function renderSpoilers(text) {
  const segs = String(text || '').split('||');
  return segs.map((s, i) => (i % 2 === 1 ? <Spoiler key={i}>{s}</Spoiler> : <span key={i}>{s}</span>));
}

// "What can I stream today" — committed games + a rest option. Clicking one PICKS
// it for today (pins it; reflected in the calendar cell and saved). The plan's
// recommendation is marked; an already-behind game is surfaced. No bonus games.
function TodayPicker({ options, gameById, onChoose }) {
  if (!options || !options.length) return null;
  const today = new Date();
  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dateLabel = `${dows[today.getDay()]} · ${MONTHS[today.getMonth()]} ${today.getDate()}`;
  const meta = (o) => {
    if (o.def) return { tag: 'Plan default', tone: 'var(--muted)' };
    if (o.midnight) return { tag: '🌙 Midnight launch', tone: '#cdb6ff' };
    if (o.rest) return o.recommended ? { tag: 'Rest day', tone: 'var(--good)' }
      : o.restCost > 0 ? { tag: `Costs ${o.restCost}d`, tone: 'var(--warn)' } : { tag: 'Rest day', tone: 'var(--muted)' };
    if (o.recommended) return o.behind ? { tag: 'Catch-up', tone: 'var(--warn)' } : { tag: 'On pace', tone: 'var(--good)' };
    if (o.behind) return { tag: 'Catch-up', tone: 'var(--warn)' };
    if (o.danger) return { tag: 'At risk', tone: 'var(--warn)' };
    if (o.getAhead) return { tag: 'Get ahead', tone: 'var(--muted)' };
    return { tag: 'Alternative', tone: 'var(--muted)' };
  };
  const noteFor = (o) => {
    if (o.def) return "clears your pick and uses the plan's choice.";
    if (o.midnight) return 'midnight launch tonight — go live at 12 AM for the new release (short ~4h binge).';
    if (o.rest) return o.recommended ? 'a clean rest — your plan still finishes on time.'
      : o.restCost > 0 ? `resting pushes deadlines ~${o.restCost}d further.` : 'a rest day.';
    if (o.recommended) return o.behind ? 'already behind — playing it limits the slip.' : 'keeps you on track this month.';
    if (o.behind) return 'already behind its deadline — slips further if skipped.';
    if (o.danger) return 'deadline is tight — at risk of slipping.';
    if (o.getAhead) return 'optional — play it to build a buffer.';
    return 'an alternative committed game.';
  };
  const active = options.find((o) => o.chosen) || options.find((o) => o.recommended) || options.find((o) => !o.def) || options[0];
  const am = meta(active);
  const click = (o) => { if (o.def) return onChoose('__default__'); if (o.rest) return onChoose(o.chosen ? '__default__' : '__rest__'); return onChoose(o.chosen ? '__default__' : o.id); };
  return (
    <div className="tonight">
      <div className="tonight-head">
        <span className="tonight-h">Tonight</span>
        <span className="tonight-date">{dateLabel}</span>
        <span className="tonight-note">what are you streaming? · ranked by your pace</span>
      </div>
      <div className="tonight-grid">
        {options.map((o) => {
          const m = meta(o);
          const chosen = !!o.chosen;
          const rec = !chosen && !!o.recommended;
          const g = (!o.rest && !o.def) ? gameById[o.id] : null;
          const art = g && isImgIcon(g.icon) ? g.icon : null;
          return (
            <button key={o.def ? '__def' : o.rest ? '__rest' : o.id} className={'opt' + (chosen ? ' sel' : '') + (rec ? ' rec' : '')} onClick={() => click(o)}>
              {(chosen || rec) && <span className="opt-check" style={{ background: chosen ? 'var(--acc)' : 'var(--good)', color: chosen ? 'var(--acc-ink)' : '#06160e' }}>✓</span>}
              <div className="opt-top">
                {o.rest ? <div className="opt-art rest">☾</div>
                  : o.def ? <div className="opt-art rest">↺</div>
                  : <div className="opt-art" style={art ? { backgroundImage: `url(${art})` } : { background: gameColor(o.id).solid }} />}
                <div className="opt-name">{o.def ? 'Use plan default' : o.rest ? 'Take a break' : o.title}</div>
              </div>
              <span className="opt-tag" style={{ color: m.tone }}>{m.tag}</span>
            </button>
          );
        })}
      </div>
      <div className="tonight-foot">
        <span className="tonight-foot-pill" style={{ color: am.tone }}>{options.find((o) => o.chosen) ? 'PICKED' : 'SUGGESTED'}</span>
        <span className="tonight-foot-txt"><b>{active.def ? 'Plan default' : active.rest ? 'Take a break' : active.title}</b> — {noteFor(active)}</span>
      </div>
    </div>
  );
}

// Games that miss their deadline this month — surfaced as a prominent strip at the
// top of the month so a slip is never silent.
function SlipStrip({ items, mobile, onPick }) {
  const pfx = mobile ? 'mg' : 'gc';
  return (
    <div className={`${pfx}-slip`}>
      <span className={`${pfx}-slip-h`}>⚠ Won’t finish on time — {items.length} game{items.length === 1 ? '' : 's'} slipping past deadline</span>
      {items.map((s) => (
        <button key={s.id} className={`${pfx}-slip-chip`} style={{ borderColor: gameColor(s.id).solid }}
          onClick={() => onPick(s.id)}
          title={`${s.title} — finishes ${fmtDate(s.finish)}, ~${s.daysLate} day${s.daysLate === 1 ? '' : 's'} after its deadline (${s.deadlineLabel})`}>
          {s.title}<small>+{s.daysLate}d late</small></button>
      ))}
    </div>
  );
}

// Bonus games for a month — optional "stream if there's time" extras, shown apart
// from the committed plan with a slack note read off that month's priorities.
function BonusStrip({ games, note, tight, mobile, onPick }) {
  const pfx = mobile ? 'mg' : 'gc';
  return (
    <div className={`${pfx}-bonus`}>
      <span className={`${pfx}-bonus-h`}>★ Bonus · if time allows</span>
      {games.map((g) => (
        <button key={g.id} className={`${pfx}-planned-chip`} style={{ borderColor: gameColor(g.id).solid }}
          onClick={() => onPick(g.id)} title={`${g.title} — bonus (stream only if you're ahead)`}>
          {g.title}<small>{releaseLabel(g.release)}</small></button>
      ))}
      {note && <div className={`${pfx}-deadnote ${tight ? 'warn' : 'ok'}`}>{tight ? '⚠ ' : ''}{note}</div>}
    </div>
  );
}

// Bonus slack note for a month, based on whether that month's deadlines need a boost.
function bonusNoteFor(dbrackets) {
  if (!dbrackets || !dbrackets.length) return { note: 'Stream if you have spare time after your other games.', tight: false };
  const tight = dbrackets.some((b) => b.boost);
  return {
    note: tight ? 'Packed month — only stream these if you get ahead of the plan.'
                : 'Some slack this month — fit these in if you stay on pace.',
    tight,
  };
}

// Art-forward Mon–Sun strip for the current week (redesign step 2). Reuses dayInfo
// output: each day is either a planned art cell, a streamed "done" card, or empty.
function WeekStrip({ days, onOpenDay }) {
  return (
    <div className="week">
      <div className="week-head"><span className="week-h">This week</span>
        <span className="week-sub">Mon–Sun · tap a day for its run-of-show</span></div>
      <div className="week-row">
        {days.map((wd, i) => {
          const info = wd.info;
          const play = (!info.vac && !info.launch && info.session && info.play) ? info.play : null;
          const art = play && isImgIcon(play.icon) ? play.icon : null;
          const doneArt = info.streamed && info.streamed[0] && info.streamed[0].games[0] && info.streamed[0].games[0].art;
          return (
            <div className={'wday' + (wd.isToday ? ' today' : '')} key={i} onClick={() => onOpenDay(wd)} style={{ cursor: 'pointer' }}>
              <div className="wday-top"><span className="wday-dow">{wd.dow}</span><span className="wday-num">{wd.num}</span></div>
              {info.streamed ? (
                <div className="wdone">
                  {doneArt ? <div className="wdone-art" style={{ backgroundImage: `url(${doneArt})` }} /> : null}
                  <small>✓ streamed</small>
                </div>
              ) : play ? (
                <div className="wstream" style={art ? null : { background: gameColor(play.id).solid }}>
                  {art && <div className="wstream-art" style={{ backgroundImage: `url(${art})` }} />}
                  {art && <div className="wstream-grad" />}
                  {info.streamOrd != null && <span className="wstream-no" style={{ background: gameColor(play.id).solid }}>{info.streamOrd}/{info.streamTotal}</span>}
                  <div className="wstream-title">{info.midnight ? '🌙 ' : ''}{play.title}</div>
                  {info.session && info.session.hours ? <div className="wstream-hrs">~{info.session.hours}h</div> : null}
                </div>
              ) : (
                <div className="wempty">
                  <span className="big">{info.launch ? '🌙' : info.vac ? '✈' : info.rest ? '☕' : '·'}</span>
                  <small>{info.launch ? 'launch eve' : info.vac ? 'away' : info.rest ? 'rest' : 'open'}</small>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// A single day's run-of-show: pre-show → game → goal → wrap, or the day's state.
function DayModal({ day, isLong, isRest, onToggleLongDay, onToggleRest, onClose, onPick }) {
  if (!day) return null;
  const info = day.info;
  const play = (!info.vac && !info.launch && info.session && info.play) ? info.play : null;
  let tag = { t: 'Open day', c: 'var(--faint)' };
  if (info.streamed) tag = { t: 'Streamed', c: 'var(--good)' };
  else if (info.launch) tag = { t: 'Launch eve', c: '#9fb4d8' };
  else if (info.vac) tag = { t: 'Time off', c: 'var(--warn)' };
  else if (info.rest) tag = { t: 'Rest day', c: 'var(--muted)' };
  else if (play && info.midnight) tag = { t: '🌙 Midnight launch', c: '#cdb6ff' };
  else if (play) tag = { t: day.isToday ? 'Today · streaming' : 'Stream day', c: 'var(--good)' };
  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal mros" onClick={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}>×</button>
        <div className="ros-head"><div className="ros-date">{day.dateLabel}</div><div className="ros-tag" style={{ color: tag.c }}>{tag.t}</div></div>
        <div className="ros-body">
          {play ? (
            <div className="ros-game" onClick={() => onPick(play.id)} style={{ cursor: 'pointer' }}>
              <div className="ros-art" style={isImgIcon(play.icon) ? { backgroundImage: `url(${play.icon})` } : { background: gameColor(play.id).solid }} />
              <div><div className="ros-title">{play.title}</div>
                <div className="ros-sub">Stream {info.streamOrd} of {info.streamTotal}{info.session.hours ? ` · ~${info.session.hours}h${info.midnight ? ' midnight' : isLong ? ' (day off)' : ''} planned` : ''}</div></div>
            </div>
          ) : info.launch ? (
            <div className="ros-note">🌙 <b>Midnight launch</b> — {info.launch.title} drops. Be ready to go live at 12:00 AM.</div>
          ) : info.streamed ? (
            info.streamed.map((st, i) => (
              <div className="ros-game" key={i}>
                <div className="ros-art" style={st.games[0] && st.games[0].art ? { backgroundImage: `url(${st.games[0].art})` } : { background: 'var(--panel-3)' }} />
                <div><div className="ros-title">{st.games.map((g) => g.name).join(' + ')}</div>
                  <div className="ros-sub" style={{ color: 'var(--good)' }}>✓ streamed · {fmtMins(st.minutes)}</div></div>
              </div>
            ))
          ) : info.vac ? (
            <div className="ros-note">✈ <b>Time off.</b> {info.vacLabel || 'On a break'} — no stream scheduled.</div>
          ) : (
            <div className="ros-note">{info.rest ? <React.Fragment>☕ <b>Rest day</b> — you marked this off; no committed stream.</React.Fragment> : 'No stream scheduled here yet. Use the actions below to plan this day.'}</div>
          )}
          {play && info.goal && <div className="ros-goal"><span className="ros-goal-k">🎯 Goal</span>{renderSpoilers(info.goal)}</div>}
          {!info.vac && day.iso && (
            <div className="ros-actions">
              {onToggleLongDay && (
                <button className={'ros-act' + (isLong ? ' on' : '')} onClick={() => onToggleLongDay(day.iso)}>
                  <span className="ros-act-ic">☀</span>
                  <span className="ros-act-tx"><b>Day off</b><small>{isLong ? 'on · weekend-length stream' : 'stream a longer session'}</small></span>
                  <span className="ros-act-sw">{isLong ? '✓' : '+'}</span>
                </button>
              )}
              {onToggleRest && !info.streamed && (
                <button className={'ros-act rest' + (isRest ? ' on' : '')} onClick={() => onToggleRest(day.iso)}>
                  <span className="ros-act-ic">☕</span>
                  <span className="ros-act-tx"><b>Rest day</b><small>{isRest ? 'on · no stream this day' : 'skip streaming this day'}</small></span>
                  <span className="ros-act-sw">{isRest ? '✓' : '+'}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MonthGridView({ games, pace, vacations, dayOpts, doneCounts, streamMap, sessionGoals, streams, longDayISOs, restDayISOs, paginated, onPick, onTogglePlan, onChooseToday, onToggleLongDay, onToggleRest }) {
  const isMobile = useIsMobile();
  const [pop, setPop] = useState(null); // in-app hover popup over a cell
  const [dayShow, setDayShow] = useState(null); // run-of-show day modal
  const [calIdx, setCalIdx] = useState(null); // paginated-calendar month index (null = current)

  // Actual streams already done (from @nabunan's Twitch history) keyed by calendar
  // day, so past days show what really happened (✓) instead of the plan.
  // Per day, keep each stream separately with its length, so we can show the length
  // of each category. A single-game stream → that game's exact length; a day with
  // several separate streams → each category's exact length; only one stream that
  // mixed categories can't be split (SullyGnome doesn't expose the per-game split),
  // so its games share the stream's combined length.
  const streamedByDay = useMemo(() => {
    const m = {};
    for (const s of (streams || [])) {
      const [y, mo, d] = String(s.date || '').split('-').map(Number);
      if (!y || !mo || !d) continue;
      const k = `${y}-${mo - 1}-${d}`;
      (m[k] = m[k] || []).push({ minutes: Number(s.minutes) || 0, games: (s.games || []).filter((g) => g && g.name) });
    }
    return m;
  }, [streams]);

  const placeable = useMemo(() => games.filter((g) => isPlaceable(g.release)), [games]);
  const rail = useMemo(() => games.filter((g) => !isPlaceable(g.release)), [games]);

  // The realistic one-game-per-day plan (release-priority queue) drives the
  // calendar: each stream day maps to the game you'll actually be playing.
  const { releasesByDay, sessionByDay, gameById, plannedByMonth, bonusByMonth, bonusPlayByDay, deadlineByDay, deadlineBracketsByMonth, slippedByMonth, plannedTotal, todayOptions, min, max } = useMemo(() => {
    // Interleaved plan: stream sessions rotate among in-progress games; bonus games
    // fill only spare slots. Drives the calendar directly.
    // "Today" = the user's LOCAL calendar day (not UTC) so the picker, cell highlight,
    // and engine all agree — otherwise an ET evening (UTC already next day) pins the
    // wrong cell. Represented as a UTC-midnight Date for the app's internal date math.
    const todayD = new Date();
    const today = utc(todayD.getFullYear(), todayD.getMonth() + 1, todayD.getDate());
    const plan = streamPlan(placeable, pace, vacations, today, dayOpts);
    const pos = plan.positions, sbd = plan.sessionByDay, bpd = plan.bonusByDay, boosts = plan.boosts || {};
    const rbd = {}, gbi = {}, pbm = {}, bbm = {}, dbd = {};
    let mn = null, mx = null;
    for (const id in pos) { const p = pos[id]; if (!mn || p.start < mn) mn = p.start; if (!mx || p.end > mx) mx = p.end; }
    for (const g of placeable) {
      gbi[g.id] = g;
      if (g.bonus) { // optional — listed in a bonus strip; only fills spare calendar slots
        const ab = anchorDate(g.release);
        const mk = ab ? `${ab.getUTCFullYear()}-${ab.getUTCMonth()}` : null;
        if (mk) (bbm[mk] = bbm[mk] || []).push(g);
        continue;
      }
      const a = anchorDate(g.release);
      if (a) { const k = dayKey(a); (rbd[k] = rbd[k] || []).push(g); }
      // Month/quarter (no set day) games are listed under their planned month.
      if (g.kind !== 'event' && !g.finishBefore && (g.placedDay || isFuzzy(g.release))) {
        const mk = g.placedDay ? g.plannedMonthKey : (a ? `${a.getUTCFullYear()}-${a.getUTCMonth()}` : null);
        if (mk) (pbm[mk] = pbm[mk] || []).push(g);
      }
    }
    const prior = placeable.filter((g) => !g.bonus);
    // Finish-before deadline groups → a bracket per month with a feasibility note.
    const dbm = {}; // displayMonthKey -> [bracket]
    const sbm = {}; // displayMonthKey -> [{ slipped game }] (finishes after its deadline)
    const groupsByKey = {};
    for (const g of prior) {
      if (!g.finishBefore) continue;
      (groupsByKey[g.finishBefore] = groupsByKey[g.finishBefore] || []).push(g);
    }
    const hpw = (pace && pace.hoursPerWeek) || 0;
    for (const key in groupsByKey) {
      const grp = groupsByKey[key];
      const t = gbi[key];
      const pr = t ? null : parseDate(key);
      const deadline = t ? anchorDate(t.release) : periodEndExclusive(pr);
      if (!deadline) continue;
      const flagDay = t ? deadline : addDays(deadline, -1); // last day to have it done
      const fk = dayKey(flagDay);
      (dbd[fk] = dbd[fk] || { title: t ? t.title : 'deadline', games: [] }).games.push(...grp.map((x) => x.title));
      const neededHours = grp.reduce((s, x) => s + (Number(x.hltbHours) || 0), 0);
      // The plan itself tells us if this group needs a boosted cadence to finish in time.
      const boost = boosts[key] || null;
      const dmk = `${flagDay.getUTCFullYear()}-${flagDay.getUTCMonth()}`;
      (dbm[dmk] = dbm[dmk] || []).push({
        key, deadline, games: grp, isGameRef: !!t, targetTitle: t ? t.title : null,
        precision: pr ? pr.precision : 'day', periodLabel: pr ? releaseLabel(pr) : null,
        neededHours, hpw, feasible: !boost, boost, past: deadline <= today,
      });
      // Per-game slip: a member whose scheduled finish lands after the deadline.
      for (const g of grp) {
        const p = pos[g.id];
        if (p && p.end > deadline) {
          const daysLate = Math.max(1, Math.round((p.end - deadline) / 86400000));
          (sbm[dmk] = sbm[dmk] || []).push({
            id: g.id, title: g.title, daysLate, finish: addDays(p.end, -1),
            deadlineLabel: t ? `before ${t.title}` : (pr ? releaseLabel(pr) : 'deadline'),
          });
        }
      }
    }
    // ---- "what can I stream today" options ----------------------------------
    // Committed games only (no bonus). Rest is allowed whenever resting today can be
    // made up later this month (blocking it adds no near-term slip); otherwise the
    // committed game that minimises slip is recommended. Picking an option pins it for
    // today (reflected in the cell + saved). A past day locked to its real stream is
    // not offered. Already-behind / in-danger games are surfaced.
    const tkey = dayKey(today);
    let todayOptions = [];
    const lockedToday = streamedByDay[tkey] && streamedByDay[tkey].length; // real stream recorded
    if (!inVacation(today, vacations) && !lockedToday) {
      const recId = sbd[tkey] ? sbd[tkey].id : null;
      const chosen = (dayOpts && dayOpts.dayPins && dayOpts.dayPins[tkey])
        || (dayOpts && dayOpts.restDays && dayOpts.restDays.has(tkey) ? '__rest__' : null);
      const cand = [];
      // Only games the plan has actually STARTED by today are streamable today. Gate on
      // the position start (not the release anchor) so a midnight-launch game — whose
      // position begins on its eve (the 12am session) — is offered on the night you
      // binge it, while future releases (not yet started) stay out of the picker.
      for (const g of placeable) {
        if (g.kind === 'event' || g.bonus) continue;      // committed only — no bonus
        const p = pos[g.id];
        if (!p || today >= p.end) continue;               // unscheduled or already finished by today
        if (p.start <= today || g.id === recId) cand.push(g.id); // started (incl. launch eve) or today's pick
      }
      const committed = []; const seen = {};
      for (const id of cand) { if (!seen[id]) { seen[id] = 1; committed.push(id); } }
      const isBehind = (id) => { const dl = finishBeforeDeadline(gbi[id], gbi); const p = pos[id]; return !!(dl && p && p.end > dl); };
      const inDanger = (id) => { const k = gbi[id].finishBefore; return !!(k && boosts[k]); };

      // Scope the makeup test to THIS month's deadlines ("make it up later this month").
      // utc() is 1-based, so +2 from a 0-based getUTCMonth() = first day of next month.
      const horizon = utc(today.getUTCFullYear(), today.getUTCMonth() + 2, 1).getTime();
      const baseSlip = totalSlipDays(pos, placeable, horizon);
      const restVacs = vacations.concat([{ start: today, end: addDays(today, 1) }]);
      const restSlip = totalSlipDays(streamPlan(placeable, pace, restVacs, today, dayOpts).positions, placeable, horizon);
      const restCost = Math.max(0, restSlip - baseSlip);
      // Rest is only truly free if nothing is already slipping near-term AND resting
      // adds none. If the month is over capacity (baseSlip > 0), resting just shuffles
      // which deadline slips — there's no real makeup room, so don't recommend it.
      const restFree = restCost <= 0 && baseSlip <= 0;

      // The recommendation is the PLAN's default for today (what the calendar cell
      // shows) — the scheduled game (recId), or the most-behind committed game if the
      // plan didn't schedule one. When today is genuinely free, rest is recommended.
      let recommendedId = null;
      if (!restFree) {
        recommendedId = (recId && committed.includes(recId)) ? recId
          : committed.find(isBehind) || committed[0] || null;
      }

      const midnightId = (sbd[tkey] && sbd[tkey].midnight) ? recId : null; // today is a launch eve
      const opts = [];
      for (const id of committed) {
        opts.push({ id, title: gbi[id].title, recommended: id === recommendedId,
          chosen: chosen === id, behind: isBehind(id), danger: inDanger(id), getAhead: restFree,
          midnight: id === midnightId });
      }
      opts.push({ rest: true, recommended: restFree, chosen: chosen === '__rest__', restCost });
      if (chosen) opts.push({ def: true }); // "use the plan's default" option
      opts.sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0)
        || ((b.behind ? 1 : 0) - (a.behind ? 1 : 0))
        || (a.rest ? 1 : 0) - (b.rest ? 1 : 0) || (a.def ? 1 : 0) - (b.def ? 1 : 0));
      todayOptions = opts;
    }
    // remaining planned sessions per game (for total = completed + planned).
    const plannedTotal = {};
    for (const key in sbd) { const s = sbd[key]; plannedTotal[s.id] = s.total; }
    return { releasesByDay: rbd, sessionByDay: sbd, gameById: gbi, plannedByMonth: pbm, bonusByMonth: bbm, bonusPlayByDay: bpd, deadlineByDay: dbd, deadlineBracketsByMonth: dbm, slippedByMonth: sbm, plannedTotal, todayOptions, min: mn, max: mx };
  }, [placeable, pace, vacations, dayOpts, streamedByDay]);

  // Bonus games don't reserve midnight-launch eves (they're not committed).
  const eves = useMemo(() => launchEves(placeable.filter((g) => !g.bonus)), [placeable]);

  const now = new Date();
  const tY = now.getFullYear(), tM = now.getMonth(), tD = now.getDate();
  const ctx = { vacations, sessionByDay, bonusPlayByDay, gameById, releasesByDay, deadlineByDay, streamedByDay, eveByDay: eves.eveByDay, releaseDays: eves.releaseDays, restDays: dayOpts && dayOpts.restDays, doneCounts: doneCounts || {}, sessionGoals: sessionGoals || {}, streamMap: streamMap || {}, plannedTotal: plannedTotal || {} };

  if (!min) {
    return (
      <div>
        <div className="tl-wrap"><div className="mg-empty">No dated games to show on the grid.</div></div>
        {rail.length > 0 && <RailBlock rail={rail} onPick={onPick} />}
      </div>
    );
  }

  // ---- mobile: full-width months stacked, continuous vertical scroll ----
  if (isMobile) {
    const months = [];
    let m = firstOfMonth(min);
    const end = firstOfMonth(max);
    while (m <= end) { months.push(m); m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1)); }
    return (
      <div>
        <TodayPicker options={todayOptions} gameById={gameById} onChoose={onChooseToday} />
        <div className="cal-legend">Each game has its own colour; numbers = each stream (3/6) · ✓ + box art = already streamed · 🌙 = launch · hatched = vacation · ★ = release · dashed chip = planned (tap to auto-pick a day) · ✓ chip = placed</div>
        <div className="mg-wrap">
          {months.map((mo, i) => {
            const y = mo.getUTCFullYear(), mon = mo.getUTCMonth();
            const first = new Date(Date.UTC(y, mon, 1)).getUTCDay();
            const dim = daysInMonth(mo);
            const cells = [];
            for (let p = 0; p < first; p++) cells.push(<div className="mg-cell pad" key={'p' + p} />);
            let monthCount = 0;
            for (let d = 1; d <= dim; d++) {
              const day = new Date(Date.UTC(y, mon, d));
              const info = dayInfo(day, ctx);
              monthCount += info.releases.length;
              const isToday = y === tY && mon === tM && d === tD;
              const isWknd = day.getUTCDay() === 0 || day.getUTCDay() === 6;
              const cls = 'mg-cell' + (info.vac ? ' vac' : info.streamed ? ' streamed' : '') + (isWknd ? ' weekend' : '') + (isToday ? ' today' : '');
              let cellStyle;
              if (!info.vac && !info.streamed) {
                if (info.launch) cellStyle = { backgroundColor: gameColor(info.launch.id).solid + '12' };
                else if (info.play) cellStyle = { backgroundColor: gameColor(info.play.id).tint };
                else if (info.span) cellStyle = { backgroundColor: gameColor(info.span.id).solid + '12' };
                else if (info.bonusPlay) cellStyle = { backgroundColor: gameColor(info.bonusPlay.id).solid + '14' };
              }
              const dl = deadlineByDay[`${y}-${mon}-${d}`];
              cells.push(
                <div key={d} className={cls} style={cellStyle}>
                  <span className="dnum">{d}{info.releases.length ? <span className="relstar">★</span> : null}{dl ? <span className="mg-deadflag" title={`Finish before ${dl.title}`}>⚑</span> : null}</span>
                  {!info.vac && !info.launch && info.session && info.play && (
                    <span className="mg-strno" title={`Stream ${info.streamOrd} of ${info.streamTotal}`}>{info.streamOrd}/{info.streamTotal}{info.session.hours ? ` · ~${info.session.hours}h` : ''}</span>
                  )}
                  {info.streamed && info.streamed.reduce((n, st) => n + st.games.length, 0) > 1 && (
                    <span className="mg-multi" title={`Multiple categories: ${info.streamed.flatMap((st) => st.games.map((g) => g.name)).join(', ')}`}>⊞ {info.streamed.reduce((n, st) => n + st.games.length, 0)}</span>
                  )}
                  {info.streamed && info.streamed.map((st, si) => {
                    const names = st.games.map((g) => g.name).join(' + ');
                    return (
                      <span className="mg-pill mg-done" key={si} title={`Streamed: ${names} — ${fmtMins(st.minutes)}`}>
                        {st.games[0] && st.games[0].art ? <img className="mg-done-art" src={st.games[0].art} alt="" loading="lazy" /> : null}
                        <span className="mg-done-nm">✓ {names} · {fmtMins(st.minutes)}</span>
                      </span>
                    );
                  })}
                  {info.vac && info.vacRunStart && <span className="mg-pill nowvac" title={info.vacLabel}>✈ {info.vacLabel}</span>}
                  {info.rest && <span className="mg-pill mg-rest" title="Rest day (you chose to rest)">☕ rest</span>}
                  {info.launch && (
                    <span className="mg-pill mg-launch" onClick={() => onPick(info.launch.id)}
                      title={`Midnight launch — ${info.launch.title}`}>🌙</span>
                  )}
                  {!info.vac && !info.launch && info.session && info.goal && (
                    <span className="mg-goal" title={`Goal for stream #${info.streamOrd}: ${info.goal}`}>🎯</span>
                  )}
                  {!info.vac && !info.launch && info.play && (
                    <span className="mg-pill mg-game" style={{ background: gameColor(info.play.id).solid }}
                      onClick={() => onPick(info.play.id)}
                      title={`${info.play.title}${info.session ? ` — stream ${info.session.idx}/${info.session.total}` : ''}${info.goal ? `\n🎯 Goal: ${info.goal}` : ''}`}>
                      {isImgIcon(info.play.icon) && <img className="mg-cellart" src={info.play.icon} alt="" loading="lazy" />}
                      <span className="mg-gt">{info.midnight ? '🌙 ' : ''}{info.play.title}</span>
                    </span>
                  )}
                  {info.bonusPlay && (
                    <span className="mg-pill mg-bonusband" style={{ borderColor: gameColor(info.bonusPlay.id).solid }}
                      onClick={() => onPick(info.bonusPlay.id)} title={`${info.bonusPlay.title} — bonus`}>
                      <span className="mg-gt">★ {info.bonusPlay.title}</span>
                    </span>
                  )}
                </div>
              );
            }
            const loose = plannedByMonth[`${y}-${mon}`] || [];
            const dbrackets = deadlineBracketsByMonth[`${y}-${mon}`] || [];
            const mbonus = bonusByMonth[`${y}-${mon}`] || [];
            const mbn = bonusNoteFor(dbrackets);
            return (
              <div className="mg-card" key={i}>
                <div className="mg-head">{MONTHS_LONG[mon]} {y}<span className="cnt">{monthCount} release{monthCount === 1 ? '' : 's'}</span></div>
                {(slippedByMonth[`${y}-${mon}`] || []).length > 0 && <SlipStrip items={slippedByMonth[`${y}-${mon}`]} mobile={true} onPick={onPick} />}
                {dbrackets.map((br) => <DeadlineBracket key={br.key} br={br} onPick={onPick} mobile={true} />)}
                {loose.length > 0 && (
                  <div className="mg-planned">
                    <span className="mg-planned-h">Planned · tap to auto-pick a day</span>
                    {loose.map((g) => (
                      <button key={g.id} className={`mg-planned-chip${g.placedDay ? ' placed' : ''}`}
                        style={g.placedDay
                          ? { background: gameColor(g.id).solid, borderColor: gameColor(g.id).solid }
                          : { borderColor: gameColor(g.id).solid }}
                        onClick={() => onTogglePlan(g.id)}
                        title={g.placedDay ? `${g.title} — starts ${fmtDate(g.placedDay)} · tap to unset` : `${g.title} — ${g.plannedLabel || releaseLabel(g.release)}`}>
                        {g.placedDay ? '✓ ' : ''}{g.title}{g.placedDay ? ` · ${shortDate(g.placedDay)}` : ''}</button>
                    ))}
                  </div>
                )}
                {mbonus.length > 0 && <BonusStrip games={mbonus} note={mbn.note} tight={mbn.tight} mobile={true} onPick={onPick} />}
                <div className="mg-dow">{DOW.map((d) => <span key={d}>{d}</span>)}</div>
                <div className="mg-grid">{cells}</div>
              </div>
            );
          })}
        </div>
        {rail.length > 0 && <RailBlock rail={rail} onPick={onPick} />}
      </div>
    );
  }

  // ---- desktop: continuous vertical stack of large Google-Calendar months ----
  const months = [];
  {
    let m = firstOfMonth(min);
    const end = firstOfMonth(max);
    while (m <= end) { months.push(m); m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1)); }
  }
  let totalCount = 0;
  for (const k in releasesByDay) totalCount += releasesByDay[k].length;
  const scrollToToday = () => {
    const el = document.getElementById(`gcm-${tY}-${tM}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ---- paginated "Calendar" tab: one month at a time with ‹ › nav ----
  if (paginated) {
    const todayIdx = months.findIndex((mo) => mo.getUTCFullYear() === tY && mo.getUTCMonth() === tM);
    const idx = calIdx == null ? Math.max(0, todayIdx) : Math.min(Math.max(0, calIdx), months.length - 1);
    const mo = months[idx]; const y = mo.getUTCFullYear(), mon = mo.getUTCMonth();
    const first = new Date(Date.UTC(y, mon, 1)).getUTCDay();
    const dim = daysInMonth(mo);
    const dows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const pad2 = (n) => String(n).padStart(2, '0');
    const cells = [];
    let relCount = 0;
    for (let p = 0; p < first; p++) cells.push(<div className="cal-cell pad" key={'p' + p} />);
    for (let d = 1; d <= dim; d++) {
      const day = new Date(Date.UTC(y, mon, d));
      const info = dayInfo(day, ctx);
      relCount += info.releases.length;
      const isToday = y === tY && mon === tM && d === tD;
      const dowI = (day.getUTCDay() + 6) % 7;
      const dayObj = { num: d, iso: `${y}-${pad2(mon + 1)}-${pad2(d)}`, isToday, dateLabel: `${dows[dowI]} · ${MONTHS[mon]} ${d}`, info };
      cells.push(
        <div className={'cal-cell' + ((day.getUTCDay() === 0 || day.getUTCDay() === 6) ? ' weekend' : '') + ((longDayISOs || []).includes(dayObj.iso) ? ' dayoff' : '') + (isToday ? ' today' : '') + (info.vac ? ' vac' : '')} key={d}>
          <span className="cal-dnum gc-dnum-btn" title="Open this day's run-of-show" onClick={() => setDayShow(dayObj)}>{d}</span>
          {info.launch && <span className="cal-moon">🌙</span>}
          {info.releases.map((r, j) => (
            <div className="cal-rel" key={j} onClick={() => onPick(r.id)} style={{ background: gameColor(r.id).solid }}>
              {isImgIcon(r.icon) && <span className="cal-relart" style={{ backgroundImage: `url(${r.icon})` }} />}
              <span className="cal-reltitle">{r.title}</span>
            </div>
          ))}
          {!info.vac && info.play && (
            <div className="cal-play" onClick={() => onPick(info.play.id)}>
              <div className="cal-playart" style={isImgIcon(info.play.icon) ? { backgroundImage: `url(${info.play.icon})` } : { background: gameColor(info.play.id).solid }} />
              <div className="cal-playgrad" />
              <span className="cal-playtitle">{info.midnight ? '🌙 ' : ''}{info.play.title}</span>
              {info.streamOrd != null && <span className="cal-playno" style={{ background: gameColor(info.play.id).solid }}>{info.streamOrd}/{info.streamTotal}</span>}
            </div>
          )}
          {info.streamed && (
            <div className="cal-play">
              {info.streamed[0].games[0] && info.streamed[0].games[0].art && <div className="cal-playart" style={{ backgroundImage: `url(${info.streamed[0].games[0].art})` }} />}
              <div className="cal-playgrad" />
              <span className="cal-playtitle">✓ {info.streamed.map((st) => st.games.map((g) => g.name).join(' + ')).join(', ')}</span>
            </div>
          )}
          {info.vac && info.vacRunStart && <span className="cal-vaclbl">✈ {info.vacLabel}</span>}
        </div>
      );
    }
    const planned = plannedByMonth[`${y}-${mon}`] || [];
    return (
      <div>
        <div className="cal">
          <div className="cal-bar">
            <div className="cal-nav">
              <button disabled={idx <= 0} onClick={() => setCalIdx(Math.max(0, idx - 1))}>‹</button>
              <button disabled={idx >= months.length - 1} onClick={() => setCalIdx(Math.min(months.length - 1, idx + 1))}>›</button>
            </div>
            <div className="cal-title">{MONTHS_LONG[mon]} {y}</div>
            <button className="cal-todaybtn" onClick={() => setCalIdx(todayIdx < 0 ? 0 : todayIdx)}>Today</button>
            <span className="cal-cnt">{relCount} release{relCount === 1 ? '' : 's'}</span>
          </div>
          {planned.length > 0 && (
            <div className="cal-planned">
              <span className="cal-planned-h">Planned this month</span>
              {planned.map((g) => (
                <span className="cal-pchip" key={g.id} onClick={() => onTogglePlan(g.id)} style={{ cursor: 'pointer' }}>
                  <span className="cal-pdot" style={{ background: gameColor(g.id).solid }} />{g.title}</span>
              ))}
            </div>
          )}
          <div className="cal-week">{DOW_FULL.map((w) => <span key={w}>{w}</span>)}</div>
          <div className="cal-grid">{cells}</div>
        </div>
        {rail.length > 0 && <RailBlock rail={rail} onPick={onPick} />}
        {dayShow && <DayModal day={dayShow} isLong={(longDayISOs || []).includes(dayShow.iso)} isRest={(restDayISOs || []).includes(dayShow.iso)} onToggleLongDay={onToggleLongDay} onToggleRest={onToggleRest} onClose={() => setDayShow(null)} onPick={(id) => { setDayShow(null); onPick(id); }} />}
      </div>
    );
  }

  // Current Mon–Sun window (art-forward weekly strip), reusing dayInfo for each day.
  const weekDays = (() => {
    const dow = new Date(Date.UTC(tY, tM, tD)).getUTCDay(); // 0 Sun..6 Sat
    const offset = (dow + 6) % 7;                            // days back to Monday
    const labels = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    const full = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const out = [];
    const pad = (n) => String(n).padStart(2, '0');
    for (let i = 0; i < 7; i++) {
      const day = new Date(Date.UTC(tY, tM, tD - offset + i));
      out.push({
        dow: labels[i], num: day.getUTCDate(),
        iso: `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`,
        dateLabel: `${full[i]} · ${MONTHS[day.getUTCMonth()]} ${day.getUTCDate()}`,
        isToday: day.getUTCFullYear() === tY && day.getUTCMonth() === tM && day.getUTCDate() === tD,
        info: dayInfo(day, ctx),
      });
    }
    return out;
  })();

  return (
    <div>
      <TodayPicker options={todayOptions} gameById={gameById} onChoose={onChooseToday} />
      <WeekStrip days={weekDays} onOpenDay={setDayShow} />
      {dayShow && <DayModal day={dayShow} isLong={(longDayISOs || []).includes(dayShow.iso)} isRest={(restDayISOs || []).includes(dayShow.iso)} onToggleLongDay={onToggleLongDay} onToggleRest={onToggleRest} onClose={() => setDayShow(null)} onPick={(id) => { setDayShow(null); onPick(id); }} />}
      <div className="gc-bar">
        <button className="gc-today" onClick={scrollToToday}>Jump to today</button>
        <div className="gc-cnt">{totalCount} release{totalCount === 1 ? '' : 's'} · scroll for more months ↓</div>
      </div>
      <div className="cal-legend">Each game has its own colour, so a run of one colour is one game; numbers mark each stream (e.g. <b>3/6</b> = 3rd of 6) · <span className="lg-done">✓ + box art</span> = already streamed (real Twitch history) · 🌙 = midnight launch (eve reserved) · <span className="lg-vac">hatched</span> = vacation · ★ = release day · <span className="lg-planned">dashed chip</span> = planned for the month — click to auto-pick a start day · ✓ chip = placed</div>
      {/* weekday header stays pinned while you scroll through every month */}
      <div className="daytype-legend">
        <span><i className="wd" />weekday (~{Math.round(pace.weekdayHps || 4)}h)</span>
        <span><i className="we" />weekend (~{Math.round(pace.weekendHps || 8)}h)</span>
        <span><i className="off" />day off (weekend-length)</span>
        <span>🌙 midnight launch</span>
      </div>
      <div className="gc-weekbar">{DOW_FULL.map((d) => <span key={d}>{d}</span>)}</div>
      <div className="gc-stack">
        {months.map((mo, idx) => {
          const y = mo.getUTCFullYear(), mon = mo.getUTCMonth();
          const first = new Date(Date.UTC(y, mon, 1)).getUTCDay();
          const dim = daysInMonth(mo);
          let monthCount = 0;
          const cells = [];
          for (let p = 0; p < first; p++) cells.push(<div className="gc-cell pad" key={'p' + p} />);
          for (let d = 1; d <= dim; d++) {
            const day = new Date(Date.UTC(y, mon, d));
            const info = dayInfo(day, ctx);
            monthCount += info.releases.length;
            const isToday = y === tY && mon === tM && d === tD;
            const hasArt = !info.vac && !info.launch && info.session && info.play && isImgIcon(info.play.icon);
            const pad2 = (n) => String(n).padStart(2, '0');
            const iso = `${y}-${pad2(mon + 1)}-${pad2(d)}`;
            const isOff = (longDayISOs || []).includes(iso);
            const isWknd = day.getUTCDay() === 0 || day.getUTCDay() === 6;
            const cls = 'gc-cell' + (info.vac ? ' vac' : info.streamed ? ' streamed' : '') + (hasArt ? ' hasart' : '') + (isWknd ? ' weekend' : '') + (isToday ? ' today' : '') + (isOff ? ' dayoff' : '');
            const relTitles = info.releases.map((r) => r.title).join(', ');
            let cellStyle;
            if (!info.vac && !info.streamed) {
              if (info.launch) cellStyle = { backgroundColor: gameColor(info.launch.id).solid + '12' };
              else if (info.play) cellStyle = { backgroundColor: gameColor(info.play.id).tint };
              else if (info.span) cellStyle = { backgroundColor: gameColor(info.span.id).solid + '12' };
              else if (info.bonusPlay) cellStyle = { backgroundColor: gameColor(info.bonusPlay.id).solid + '14' };
            }
            const dl = deadlineByDay[`${y}-${mon}-${d}`];
            const popData = cellPopData(info, day);
            const dowI = (day.getUTCDay() + 6) % 7;
            const dayObj = { num: d, iso, isToday,
              dateLabel: `${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][dowI]} · ${MONTHS[mon]} ${d}`, info };
            cells.push(
              <div key={d} className={cls} style={cellStyle}
                onMouseEnter={popData ? (e) => setPop({ rect: e.currentTarget.getBoundingClientRect(), data: popData }) : undefined}
                onMouseLeave={popData ? () => setPop(null) : undefined}>
                <span className="gc-dnum gc-dnum-btn" title="Open day options"
                  onClick={(e) => { e.stopPropagation(); setPop(null); setDayShow(dayObj); }}>{d}{info.releases.length ? <span className="gc-relstar">★</span> : null}{info.midnight ? <span className="gc-goal-inline" title="Midnight launch">🌙</span> : null}{dl ? <span className="gc-deadflag">⚑</span> : null}{!info.vac && !info.launch && info.session && info.goal ? <span className="gc-goal-inline">🎯</span> : null}</span>
                {!info.vac && (
                  <button className="gc-offbtn" title={isOff ? 'Day off — click to remove (normal length)' : 'Mark a day off → longer weekend-length stream'}
                    onClick={(e) => { e.stopPropagation(); setPop(null); onToggleLongDay(iso); }}>☀ {isOff ? 'Day off ✓' : 'Day off'}</button>
                )}
                {(() => {
                  // Two stacked, color-coded badges (top-right): placement X/N and hours.
                  let xn = null, xnStyle, hrs = null;
                  if (!info.vac && !info.launch && info.session && info.play) {
                    xn = `${info.streamOrd}/${info.streamTotal}`;
                    xnStyle = { background: gameColor(info.play.id).solid, color: '#0c0c12' };
                    if (info.session.hours) hrs = `~${info.session.hours}h`;
                  } else if (info.streamed) {
                    if (info.streamOrd != null) xn = `${info.streamOrd}/${info.streamTotal}`;
                    const mins = info.streamed.reduce((n, st) => n + (st.minutes || 0), 0);
                    if (mins) hrs = fmtMins(mins);
                  }
                  if (!xn && !hrs) return null;
                  return (
                    <div className="gc-badges">
                      {xn && <span className={'gc-strno' + (info.streamed ? ' gc-strno-done' : '')} style={xnStyle}>{xn}</span>}
                      {hrs && <span className="gc-hrsb">{hrs}</span>}
                    </div>
                  );
                })()}
                {info.streamed && info.streamed.reduce((n, st) => n + st.games.length, 0) > 1 && (
                  <span className="gc-multi">⊞ {info.streamed.reduce((n, st) => n + st.games.length, 0)} games</span>
                )}
                {info.streamed && info.streamed.map((st, si) => {
                  const names = st.games.map((g) => g.name).join(' + ');
                  return (
                    <div className="gc-done" key={si}>
                      {st.games[0] && st.games[0].art ? <img className="gc-done-art" src={st.games[0].art} alt="" loading="lazy" /> : null}
                      <span className="gc-done-nm"><span className="gc-done-chk">✓</span>{names}</span>
                    </div>
                  );
                })}
                {info.vac && info.vacRunStart && <div className="gc-away">✈ {info.vacLabel}</div>}
                {info.rest && <div className="gc-away">☕ Rest day</div>}
                {info.launch && (
                  <div className="gc-ev gc-launch" onClick={() => onPick(info.launch.id)}>🌙</div>
                )}
                {!info.vac && !info.launch && info.session && info.play && (hasArt ? (
                  <React.Fragment>
                    <div className="gc-art" style={{ backgroundImage: `url(${info.play.icon})` }} onClick={() => onPick(info.play.id)} />
                    <div className="gc-grad" />
                    <div className="gc-foot"><span className="gc-ftitle">{info.play.title}</span></div>
                  </React.Fragment>
                ) : (
                  <div className="gc-ev" style={{ background: gameColor(info.play.id).solid }} onClick={() => onPick(info.play.id)}>
                    {info.play.title}</div>
                ))}
                {info.bonusPlay && (
                  <div className="gc-ev bonus" style={{ borderColor: gameColor(info.bonusPlay.id).solid }}
                    onClick={() => onPick(info.bonusPlay.id)}>
                    <span className="bstar">★</span>{info.bonusFirst ? ' ' + info.bonusPlay.title : ' bonus'}</div>
                )}
              </div>
            );
          }
          const loose = plannedByMonth[`${y}-${mon}`] || [];
          const dbrackets = deadlineBracketsByMonth[`${y}-${mon}`] || [];
          const gbonus = bonusByMonth[`${y}-${mon}`] || [];
          const gbn = bonusNoteFor(dbrackets);
          return (
            <div className="gc-month" id={`gcm-${y}-${mon}`} key={idx}>
              <div className="gc-mhead">{MONTHS_LONG[mon]} {y}
                <span className="gc-headcnt">{monthCount} release{monthCount === 1 ? '' : 's'}</span></div>
              {(slippedByMonth[`${y}-${mon}`] || []).length > 0 && <SlipStrip items={slippedByMonth[`${y}-${mon}`]} mobile={false} onPick={onPick} />}
              {dbrackets.map((br) => <DeadlineBracket key={br.key} br={br} onPick={onPick} mobile={false} />)}
              {loose.length > 0 && (
                <div className="gc-planned">
                  <span className="gc-planned-h">Planned this month · click to auto-pick a start day</span>
                  {loose.map((g) => (
                    <button key={g.id} className={`gc-planned-chip${g.placedDay ? ' placed' : ''}`}
                      style={g.placedDay
                        ? { background: gameColor(g.id).solid, borderColor: gameColor(g.id).solid }
                        : { borderColor: gameColor(g.id).solid }}
                      onClick={() => onTogglePlan(g.id)}
                      title={g.placedDay
                        ? `${g.title} — auto-placed to start ${fmtDate(g.placedDay)} · click to unset`
                        : `${g.title} — ${g.plannedLabel || releaseLabel(g.release)} · click to auto-pick a start day`}>
                      {g.placedDay ? '✓ ' : ''}{g.title}
                      <small>{g.placedDay ? '▸ ' + shortDate(g.placedDay) : (g.plannedLabel || releaseLabel(g.release))}</small></button>
                  ))}
                </div>
              )}
              {gbonus.length > 0 && <BonusStrip games={gbonus} note={gbn.note} tight={gbn.tight} mobile={false} onPick={onPick} />}
              <div className="gc-grid">{cells}</div>
            </div>
          );
        })}
      </div>
      {rail.length > 0 && <RailBlock rail={rail} onPick={onPick} />}
      {pop && pop.data && <CellPopup pop={pop} />}
    </div>
  );
}

// In-app hover popup that floats above the hovered calendar cell.
function CellPopup({ pop }) {
  const r = pop.rect, d = pop.data;
  const style = { left: r.left + r.width / 2, top: r.top - 8 };
  return (
    <div className="cell-pop" style={style}>
      {d.kind === 'streamed' && d.items.map((it, i) => (
        <div className="cell-pop-row" key={i}>
          {it.art ? <img className="cell-pop-art" src={it.art} alt="" /> : null}
          <div className="cell-pop-txt">
            <div className="cell-pop-title">✓ {it.name}{it.combined ? ' (combined)' : ''}</div>
            <div className="cell-pop-sub">{it.ord != null ? `Stream ${it.ord} of ${it.total} · ` : ''}{it.length} streamed</div>
          </div>
        </div>
      ))}
      {d.kind === 'planned' && (
        <div className="cell-pop-row">
          {isImgIcon(d.art) ? <img className="cell-pop-art" src={d.art} alt="" /> : null}
          <div className="cell-pop-txt">
            <div className="cell-pop-title">{d.midnight ? '🌙 ' : ''}{d.title}</div>
            <div className="cell-pop-sub">Stream {d.ord} of {d.total}{d.length ? ` · ${d.length}` : ''}</div>
            {d.goal && <div className="cell-pop-goal">🎯 {d.goal}</div>}
          </div>
        </div>
      )}
      {d.kind === 'launch' && <div className="cell-pop-title">🌙 Midnight launch — {d.title}</div>}
      {d.kind === 'rest' && <div className="cell-pop-title">☕ Rest day</div>}
      {d.kind === 'bonus' && <div className="cell-pop-title">★ {d.title} (bonus)</div>}
    </div>
  );
}

function RailBlock({ rail, onPick }) {
  return (
    <div className="rail" style={{ borderRadius: 'var(--radius)', borderTop: '1px solid var(--border-solid)', marginTop: 16 }}>
      <div className="rail-h">Unscheduled · year-only / TBD ({rail.length})</div>
      <div className="rail-chips">
        {rail.map((g) => (
          <div className="chip" key={g.id} onClick={() => onPick(g.id)}>
            <GameBadge game={g} size={16} />
            {g.title}<span className="when">{releaseLabel(g.release)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Releases appendix — every title the calendar knows about, grouped by year
// ============================================================================
function ReleasesView({ games, pace, onPick }) {
  // Actual new releases only: real new games/DLC newly launching (incl. remasters,
  // collections, Switch 2 editions). Exclude events, and older games you already own
  // that are just being started on stream now (newRelease:false in games.json).
  const releases = useMemo(
    () => games.filter((g) => (g.kind === 'game' || g.kind === 'dlc') && g.newRelease !== false),
    [games]
  );
  // Collapse multi-part games ("— Pt. N") and named collections into ONE entry, shown
  // with the full title on the day the whole thing first releases. Hours are summed
  // across parts so the row reflects the full game/collection's time to finish.
  const entries = useMemo(() => {
    const m = {};
    for (const g of releases) {
      const key = g.collection ? 'c:' + g.collection : 'b:' + baseTitle(g.title);
      const title = g.collection || baseTitle(g.title);
      const d = anchorDate(g.release);
      let e = m[key];
      if (!e) { e = m[key] = { key, title, rep: g, d, hours: 0, parts: 0 }; }
      e.parts += 1;
      e.hours += Number(g.hltbHours) || 0;
      // Representative = earliest-dated member (its date/badge/platforms drive the row).
      if (d && (!e.d || d < e.d)) { e.d = d; e.rep = g; }
    }
    return Object.values(m);
  }, [releases]);
  // Dated entries (day/month/quarter) group under their year. Anything without a real
  // date — year-only OR fully TBD — is "unscheduled" and drops to the bottom section,
  // sorted by year, then TBA/TBD (no year) last.
  const groups = useMemo(() => {
    const m = {};
    for (const e of entries) {
      if (!isPlaceable(e.rep.release)) continue;
      const yr = String(e.rep.release.year);
      (m[yr] = m[yr] || []).push(e);
    }
    const keys = Object.keys(m).sort((a, b) => Number(a) - Number(b));
    for (const k of keys) {
      m[k].sort((x, y) => (x.d - y.d) || (x.title < y.title ? -1 : 1));
    }
    return keys.map((k) => ({ year: k, items: m[k] }));
  }, [entries]);
  const unscheduled = useMemo(() => {
    const items = entries.filter((e) => !isPlaceable(e.rep.release));
    return items.sort((x, y) => {
      const xy = x.rep.release && x.rep.release.year, yy = y.rep.release && y.rep.release.year;
      if (xy && yy && xy !== yy) return xy - yy;
      if (xy && !yy) return -1;     // year-only before fully-TBD
      if (!xy && yy) return 1;
      return x.title < y.title ? -1 : 1;
    });
  }, [entries]);

  const relRow = (e) => {
    const g = e.rep;
    const strk = e.hours > 0 ? streamsToFinish(e.hours, pace) : null;
    const base = g.editions && g.editions.length ? g.editions[0] : null;
    return (
      <div className="rel-row" key={e.key} onClick={() => onPick(g.id)}>
        <span className="rel-date">{releaseLabel(g.release)}</span>
        <span className="rel-kind" style={{ background: KIND_COLOR[g.kind] }}>{KIND_LABEL[g.kind]}</span>
        <span className="rel-title"><GameBadge game={g} size={18} />{e.title}
          {e.parts > 1 ? <span className="rel-parts">{e.parts} parts</span> : null}
          {g.bonus ? <span className="rel-bonus">★ bonus</span> : null}</span>
        <span className="rel-plat">{(g.platforms || []).join(', ')}</span>
        <span className="rel-price">{base && base.msrpUSD ? '$' + base.msrpUSD.toFixed(2) : ''}</span>
        <span className="rel-hltb">{e.hours ? <React.Fragment>{e.hours}h<small> · {strk} str</small></React.Fragment> : ''}</span>
      </div>
    );
  };

  return (
    <div className="releases">
      <div className="rel-intro">
        <strong>{entries.length}</strong> new releases on the slate — release date, type,
        platforms, price, and time to finish on stream. Multi-part games and collections are
        shown once, on the day the full thing releases. (Replays of older games and events are
        excluded.) Tap any row for full details.
      </div>
      {groups.map(({ year, items }) => (
        <div className="rel-yr" key={year}>
          <div className="rel-yr-h">{year}
            <span className="rel-yr-cnt">{items.length} title{items.length === 1 ? '' : 's'}</span></div>
          <div className="rel-tbl">{items.map(relRow)}</div>
        </div>
      ))}
      {unscheduled.length > 0 && (
        <div className="rel-yr" key="unscheduled">
          <div className="rel-yr-h">Unscheduled / TBA
            <span className="rel-yr-cnt">{unscheduled.length} title{unscheduled.length === 1 ? '' : 's'}</span></div>
          <div className="rel-tbl">{unscheduled.map(relRow)}</div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Detail card
// ============================================================================
function DetailCard({ game: g, pace, vacations, queuedPos, games, adjust, onAdjust, doneHours, onClose }) {
  const strk = streamsToFinish(g.hltbHours, pace);
  const wks = weeksToFinish(g.hltbHours, pace);
  const start = anchorDate(g.release);
  const earliest = start ? gameEnd(g, start, pace, vacations) : null;
  const queued = queuedPos ? queuedPos.end : null;
  const parts = queuedPos && queuedPos.segments ? queuedPos.segments.length : 1;
  const art = isImgIcon(g.icon) ? g.icon : null;
  // Catch-up note vs this game's finish-before deadline.
  let paceNote = null;
  if (g.finishBefore && g.kind !== 'event' && g.hltbHours > 0) {
    const byId = {}; (games || []).forEach((x) => { byId[x.id] = x; });
    const dl = finishBeforeDeadline(g, byId);
    const n = new Date(); const today = utc(n.getFullYear(), n.getMonth() + 1, n.getDate());
    if (dl && dl.getTime() > today.getTime()) {
      const wl = Math.max(0.3, (dl.getTime() - today.getTime()) / 6048e5);
      const need = g.hltbHours / wl;
      paceNote = { need, ok: need <= (pace.hoursPerWeek || 11.52), dlText: dlLabelFor(g.finishBefore, dl, byId) };
    }
  }
  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal mdetail" onClick={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}>×</button>
        <div className="modal-hero">
          {art && <div className="modal-heroart" style={{ backgroundImage: `url(${art})` }} />}
          <div className="modal-herofade" />
        </div>
        <div className="modal-body">
          {art
            ? <div className="modal-cover" style={{ backgroundImage: `url(${art})` }} />
            : <div className="modal-cover modal-cover-mono" style={{ background: gameColor(g.id).solid }}><GameBadge game={g} size={38} /></div>}
          <div className="modal-kind"><span className="swatch" style={{ background: gameColor(g.id).solid }} />
            {KIND_LABEL[g.kind]}{g.bonus ? ' · Bonus' : ''}{g.backlog ? ' · Backlog' : ''} · {releaseLabel(g.release)}</div>
          <div className="modal-title">{g.title}</div>

          {g.kind !== 'event' && g.hltbHours > 0 && (
            <div className="modal-stats">
              <div className="modal-stat"><div className="k">Time to beat</div><div className="v">{g.hltbHours}<small> h</small></div></div>
              <div className="modal-stat"><div className="k">Streams to finish</div><div className="v">{strk}<small> · {wks < 1.05 ? Math.round(wks * 7) + 'd' : wks.toFixed(1) + 'w'}</small></div></div>
              {queued ? (
                <div className="modal-stat"><div className="k">Queued finish</div><div className="v" style={{ fontSize: '1.05rem' }}>{fmtDate(queued)}</div><div className="dt-sub">{parts > 1 ? parts + ' parts' : 'release-priority'}</div></div>
              ) : earliest ? (
                <div className="modal-stat"><div className="k">Est. finish</div><div className="v" style={{ fontSize: '1.05rem' }}>{fmtDate(earliest)}</div></div>
              ) : null}
            </div>
          )}

          {paceNote && (
            <div className={'modal-note ' + (paceNote.ok ? 'ok' : 'bad')}>
              <b>{paceNote.ok ? 'On pace ✓' : 'Behind ⚠'}</b> — needs <b className="hl">{paceNote.need.toFixed(1)} h/wk</b> to finish {paceNote.dlText}; you average {Number(pace.hoursPerWeek || 0).toFixed(1)}h/wk.
            </div>
          )}

          {g.kind !== 'event' && g.hltbHours > 0 && onAdjust && (() => {
            const step = Math.max(2, Math.round(pace.hoursPerStream || 5));
            const done = (doneHours && doneHours[g.id]) || 0;
            const remaining = Math.max(0, g.hltbHours - done);
            const remStreams = streamsToFinish(remaining, pace);
            return (
              <div className="adj">
                <div className="adj-k">Running longer (or shorter) than expected?</div>
                <div className="adj-sub">
                  {adjust ? <b>{adjust > 0 ? '+' : ''}{adjust}h vs HLTB estimate · </b> : null}
                  {remStreams} stream{remStreams === 1 ? '' : 's'} left{done > 0 ? ` · ~${Math.round(remaining)}h to go` : ''}
                </div>
                <div className="adj-btns">
                  <button className="btn btn-sm" onClick={() => onAdjust(g.id, -step)}>− a stream</button>
                  <button className="btn btn-sm btn-accent" onClick={() => onAdjust(g.id, step)}>＋ a stream</button>
                  {adjust ? <button className="btn btn-sm" onClick={() => onAdjust(g.id, null)}>reset</button> : null}
                </div>
              </div>
            );
          })()}

          {g.platforms && g.platforms.length > 0 && (
            <div className="modal-line"><span className="k">Platforms</span>
              <div className="modal-tags">{g.platforms.map((p, i) => <span className="modal-tag" key={i}>{p}</span>)}</div></div>
          )}
          {g.editions && g.editions.length > 0 && (
            <div className="modal-line"><span className="k">Editions</span>
              <div className="modal-tags">{g.editions.map((e, i) => <span className="modal-tag" key={i}>{e.name}{e.msrpUSD ? ' · $' + e.msrpUSD.toFixed(2) : ''}</span>)}</div></div>
          )}
          {g.earlyAccess && <div className="modal-line"><span className="k">Early access</span><span>{g.earlyAccess}</span></div>}
          {g.hltbNote && <div className="modal-line"><span className="k">Estimate</span><span>{labelBasis(g.hltbBasis)} — {g.hltbNote}</span></div>}
          {g.partGoal && <div className="modal-note goal"><b className="goalk">Part goal · </b>{renderSpoilers(g.partGoal)}</div>}
          {g.notes && <div className="modal-note blue">{g.notes}</div>}

          <div className="modal-foot"><span className="hint">Edit in games.json</span><button className="btn btn-accent" onClick={onClose}>Done</button></div>
        </div>
      </div>
    </div>
  );
}
function labelBasis(b) {
  return { self: 'Own playthrough', 'remake-original': 'Original game', 'series-avg': 'Series average', estimate: 'Estimate' }[b] || 'Estimate';
}


// ============================================================================
// Settings (pace)
// ============================================================================
function SettingsPanel({ settings, pace, setSettings, setPace, onClose }) {
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await fetch('/api/refresh-pace', { method: 'POST' });
      if (r.ok) setPace(await r.json());
    } catch (e) { /* ignore */ }
    setRefreshing(false);
  };
  const setVacs = (updater) => setSettings((s) => ({ ...s, vacations: updater(s.vacations || []) }));
  const addVac = () => setVacs((vs) => [...vs, { id: uid(), label: '', start: '', end: '' }]);
  const updateVac = (i, patch) => setVacs((vs) => vs.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const removeVac = (i) => setVacs((vs) => vs.filter((_, j) => j !== i));
  const vacs = settings.vacations || [];
  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal detail" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h"><h3>Settings</h3><button className="x" onClick={onClose}>×</button></div>
        <div className="modal-b">
          <div className="set-pace">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div className="big">{pace.hoursPerStream}h<span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}> / stream</span></div>
              <span className="src-pill">{pace.source === 'sullygnome' ? 'live · 90-day' : pace.source === 'twitchtracker' ? 'TwitchTracker · 30-day' : pace.source || 'fallback'}</span>
            </div>
            <div style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: 4 }}>
              {pace.hoursPerWeek}h / week · {pace.numStreams || '–'} streams · {pace.totalHours || '–'}h over last {pace.windowDays || 90} days
            </div>
            {!settings.override && (pace.weekdayHps || pace.weekendHps) && (
              <div style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: 2 }}>
                weekday ~{pace.weekdayHps}h/stream · weekend ~{pace.weekendHps}h/stream
                {pace.weekendStreams ? ` (${pace.weekdayStreams}wd / ${pace.weekendStreams}we)` : ''}
              </div>
            )}
            <div className="hint" style={{ marginTop: 6 }}>
              {pace.fetchedAt ? 'Updated ' + new Date(pace.fetchedAt).toLocaleString() : 'Auto-refreshes weekly (Mondays).'}
              {pace.error ? ' · source unreachable, using fallback' : ''}
            </div>
            <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={refresh} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : '↻ Refresh now'}</button>
          </div>

          <label className="toggle-line">
            <input type="checkbox" checked={settings.override}
              onChange={(e) => setSettings((s) => ({ ...s, override: e.target.checked }))} />
            Manually override pace
          </label>
          {settings.override && (
            <div className="row">
              <div className="field"><label>Hours / stream</label>
                <input type="number" step="0.1" value={settings.hoursPerStream}
                  onChange={(e) => setSettings((s) => ({ ...s, hoursPerStream: Number(e.target.value) }))} /></div>
              <div className="field"><label>Hours / week</label>
                <input type="number" step="0.1" value={settings.hoursPerWeek}
                  onChange={(e) => setSettings((s) => ({ ...s, hoursPerWeek: Number(e.target.value) }))} /></div>
            </div>
          )}
          <div className="hint">Pace comes from your last 90 days on Twitch (@nabunan). Streams-to-finish = HLTB hours ÷ hours-per-stream; the bar length = HLTB hours ÷ hours-per-week.</div>

          <div className="set-divider" />
          <div className="set-h">Time off · no streaming</div>
          {vacs.length === 0 && <div className="hint">No breaks yet. Add vacations and the calendar will pause progress during them.</div>}
          <div className="vac-list">
            {vacs.map((v, i) => (
              <div className="vac-row" key={v.id || i}>
                <input className="vac-label" placeholder="Label (e.g. Japan trip)" value={v.label || ''}
                  onChange={(e) => updateVac(i, { label: e.target.value })} />
                <input type="date" value={v.start || ''} onChange={(e) => updateVac(i, { start: e.target.value })} />
                <span className="vac-to">→</span>
                <input type="date" value={v.end || ''} onChange={(e) => updateVac(i, { end: e.target.value })} />
                <button className="btn btn-sm" title="Remove" onClick={() => removeVac(i)}>✕</button>
              </div>
            ))}
          </div>
          <button className="btn btn-sm" onClick={addVac}>+ Add time off</button>
          <div className="hint">Breaks push out game finish dates and the “My queue” timeline (no streaming = no progress), and show as shaded days on the calendar. Dates are inclusive.</div>
        </div>
        <div className="modal-f"><button className="btn btn-accent" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}
