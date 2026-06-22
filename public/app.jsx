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
};

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
function effectivePace(settings, pace) {
  if (settings.override) return { hoursPerStream: settings.hoursPerStream, hoursPerWeek: settings.hoursPerWeek, weekdayHps: settings.hoursPerStream, weekendHps: settings.hoursPerStream };
  return { hoursPerStream: pace.hoursPerStream, hoursPerWeek: pace.hoursPerWeek, weekdayHps: pace.weekdayHps, weekendHps: pace.weekendHps };
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
  const firstSave = useRef(true);

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
  // Auto-pick a concrete start day for each month/quarter game the user pinned,
  // then anchor those games to it so the rest of the app treats them as dated.
  const autoMap = useMemo(() => autoPlaceDays(games, settings.autoPlace, normVacs), [games, settings.autoPlace, normVacs]);
  // "finish before X" groups are packed automatically (file-driven) and win over
  // the user's loose auto-placements.
  const beforeMap = useMemo(() => finishBeforeDays(games, ep, normVacs), [games, ep, normVacs]);
  const effGames = useMemo(() => withAutoPlacement(games, { ...autoMap, ...beforeMap }), [games, autoMap, beforeMap]);
  // Register cover-derived band colours before any child renders/uses gameColor.
  effGames.forEach((g) => { if (g.iconColor) ICON_COLORS[g.id] = g.iconColor; });
  // Per-day overrides (settings store ISO dates; convert to engine day-keys):
  // longDays = days off treated as weekend-length; dayPins = force a game on a day.
  const isoToKey = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return `${y}-${m - 1}-${d}`; };
  const dayOpts = useMemo(() => ({
    longDays: new Set((settings.longDays || []).map(isoToKey)),
    dayPins: Object.fromEntries(Object.entries(settings.dayPins || {}).map(([iso, id]) => [isoToKey(iso), id])),
    restDays: new Set((settings.restDays || []).map(isoToKey)),
  }), [settings.longDays, settings.dayPins, settings.restDays]);
  // Choose what to stream today (pins it / marks rest / clears to plan default). Saved
  // to settings (KV), so the calendar cell reflects it everywhere and it persists.
  const chooseToday = useCallback((choice) => {
    const iso = new Date().toISOString().slice(0, 10);
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
  // Realistic release-priority finish per game (for the detail card).
  const seqPositions = useMemo(
    () => schedule(effGames.filter((g) => isPlaceable(g.release) && !g.bonus), ep, 'sequential', normVacs, dayOpts),
    [effGames, ep, normVacs, dayOpts]
  );

  const detailGame = detail ? effGames.find((g) => g.id === detail) : null;

  return (
    <div className="app">
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
          </div>
          {settings.view === 'timeline' && (
            <div className="seg alt">
              <button className={settings.schedMode === 'parallel' ? 'on' : ''}
                onClick={() => setSettings((s) => ({ ...s, schedMode: 'parallel' }))}>True dates</button>
              <button className={settings.schedMode === 'sequential' ? 'on' : ''}
                onClick={() => setSettings((s) => ({ ...s, schedMode: 'sequential' }))}>My queue</button>
            </div>
          )}
          <button className="btn" onClick={() => setShowSettings(true)}>⚙ Settings</button>
        </div>
        <div className="hdr-sub">
          {games.length} titles · pace {ep.hoursPerStream}h/stream · {ep.hoursPerWeek}h/week
          {settings.override ? ' (manual)' : ` (${pace.source === 'sullygnome' ? 'live 90-day' : pace.source === 'twitchtracker' ? 'TwitchTracker 30-day' : 'fallback'})`}
          {normVacs.length > 0 ? ` · ${normVacs.length} break${normVacs.length === 1 ? '' : 's'} blocked off` : ''}
          {settings.schedMode === 'sequential' && settings.view === 'timeline' ? ' · new releases first, older games split around them' : ''}
        </div>
      </header>

      {settings.view === 'timeline'
        ? <TimelineView games={effGames} pace={ep} mode={settings.schedMode} vacations={normVacs} onPick={setDetail} />
        : <MonthGridView games={effGames} pace={ep} vacations={normVacs} dayOpts={dayOpts} streams={streams} onPick={setDetail} onTogglePlan={togglePlan} onChooseToday={chooseToday} />}

      {detailGame && (
        <DetailCard game={detailGame} pace={ep} vacations={normVacs} queuedPos={seqPositions[detailGame.id]}
          onClose={() => setDetail(null)} />
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
  if (streamed && streamed.length) return { streamed, releases };
  if (inVacation(day, ctx.vacations)) {
    return { vac: true, vacRunStart: !inVacation(prev, ctx.vacations), vacLabel: vacLabelFor(day, ctx.vacations), releases };
  }
  // A day the user chose to rest (no committed stream).
  if (ctx.restDays && ctx.restDays.has(k)) return { rest: true, releases };
  const eve = ctx.eveByDay && ctx.eveByDay[k];
  if (eve && !(ctx.releaseDays && ctx.releaseDays[k])) return { launch: eve, releases };
  // Show one cell per actual stream session (a game appears on exactly its
  // "streams to finish" days, at your real cadence), not every in-progress day.
  const session = ctx.sessionByDay[k];
  if (session) return { releases, play: ctx.gameById[session.id], session };
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
function TodayPicker({ options, mobile, onPick, onChoose }) {
  if (!options || !options.length) return null;
  const pfx = mobile ? 'mg' : 'gc';
  const today = new Date();
  const label = `${MONTHS[today.getMonth()]} ${today.getDate()}`;
  return (
    <div className={`${pfx}-today`}>
      <span className={`${pfx}-today-h`}>▶ Today ({label}) · what are you streaming?</span>
      {options.map((o) => {
        if (o.def) {
          return (
            <button key="__default__" className={`${pfx}-today-chip def`} onClick={() => onChoose('__default__')}
              title="Clear your pick and use the plan's default for today">
              ↺ Use plan default
            </button>
          );
        }
        if (o.rest) {
          return (
            <button key="__rest__" className={`${pfx}-today-chip rest${o.chosen ? ' chosen' : ''}${o.recommended ? ' rec' : o.restCost > 0 ? ' risk' : ''}`}
              onClick={() => onChoose('__rest__')}
              title={o.recommended ? 'Resting today can be made up later this month — no deadline slips'
                : `Resting today can't be made up — it pushes deadlines ~${o.restCost}d further`}>
              <span className="dot" style={{ background: 'var(--muted)' }} />
              ☕ Take a break (rest day)
              <small>{o.chosen ? '● chosen' : o.recommended ? '✓ recommended · make up later' : `⚠ +${o.restCost}d slip`}</small>
            </button>
          );
        }
        const note = o.chosen ? '● chosen'
          : o.recommended ? (o.behind ? '✓ recommended · behind — limits slip' : '✓ recommended')
          : o.behind ? '⚠ behind — slips further'
          : o.danger ? '⚠ at risk'
          : o.getAhead ? 'optional · get ahead'
          : 'alternative';
        const cls = o.chosen ? ' chosen' : o.recommended ? ' rec' : (o.behind || o.danger) ? ' risk' : ' safe';
        return (
          <button key={o.id} className={`${pfx}-today-chip${cls}`}
            style={{ borderColor: gameColor(o.id).solid }}
            onClick={() => onChoose(o.id)}
            title={o.chosen ? 'You picked this for today (click another to change)'
              : o.recommended ? (o.behind ? 'Recommended — already behind; play it to limit the slip' : 'Recommended — playing today keeps you on track')
              : o.behind ? 'Already behind its deadline; not playing it slips it further'
              : o.danger ? 'Deadline is tight — at risk of slipping'
              : o.getAhead ? 'Optional — play to build a buffer' : 'An alternative committed game'}>
            <span className="dot" style={{ background: gameColor(o.id).solid }} />
            {o.title}
            <small>{note}</small>
          </button>
        );
      })}
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

function MonthGridView({ games, pace, vacations, dayOpts, streams, onPick, onTogglePlan, onChooseToday }) {
  const isMobile = useIsMobile();

  // Actual streams already done (from @nabunan's Twitch history) keyed by calendar
  // day, so past days show what really happened (✓) instead of the plan.
  const streamedByDay = useMemo(() => {
    const m = {};
    for (const s of (streams || [])) {
      const [y, mo, d] = String(s.date || '').split('-').map(Number);
      if (!y || !mo || !d) continue;
      const k = `${y}-${mo - 1}-${d}`;
      const arr = m[k] = m[k] || [];
      for (const g of (s.games || [])) if (g && g.name && !arr.some((x) => x.name === g.name)) arr.push(g);
    }
    return m;
  }, [streams]);

  const placeable = useMemo(() => games.filter((g) => isPlaceable(g.release)), [games]);
  const rail = useMemo(() => games.filter((g) => !isPlaceable(g.release)), [games]);

  // The realistic one-game-per-day plan (release-priority queue) drives the
  // calendar: each stream day maps to the game you'll actually be playing.
  const { releasesByDay, sessionByDay, gameById, plannedByMonth, bonusByMonth, bonusPlayByDay, deadlineByDay, deadlineBracketsByMonth, slippedByMonth, todayOptions, min, max } = useMemo(() => {
    // Interleaved plan: stream sessions rotate among in-progress games; bonus games
    // fill only spare slots. Drives the calendar directly.
    const plan = streamPlan(placeable, pace, vacations, undefined, dayOpts);
    const pos = plan.positions, sbd = plan.sessionByDay, bpd = plan.bonusByDay, boosts = plan.boosts || {};
    const todayD = new Date();
    const today = utc(todayD.getUTCFullYear(), todayD.getUTCMonth() + 1, todayD.getUTCDate());
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
      const cand = []; const soon = addDays(today, 10);
      for (const g of placeable) {
        if (g.kind === 'event' || g.bonus) continue;      // committed only — no bonus
        const p = pos[g.id]; const a = anchorDate(g.release);
        if (!a || a > today) continue;
        if (p && today >= p.end) continue;
        const current = p && p.start <= soon;
        if (current || g.id === recId) cand.push(g.id);
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
      const restSlip = totalSlipDays(streamPlan(placeable, pace, restVacs, undefined, dayOpts).positions, placeable, horizon);
      const restCost = Math.max(0, restSlip - baseSlip);
      // Rest is only truly free if nothing is already slipping near-term AND resting
      // adds none. If the month is over capacity (baseSlip > 0), resting just shuffles
      // which deadline slips — there's no real makeup room, so don't recommend it.
      const restFree = restCost <= 0 && baseSlip <= 0;

      let bestId = null;
      if (!restFree) {
        let bestSlip = Infinity;
        for (const id of committed) {
          const pins = { ...(dayOpts && dayOpts.dayPins), [tkey]: id };
          const s = totalSlipDays(streamPlan(placeable, pace, vacations, undefined, { longDays: dayOpts && dayOpts.longDays, dayPins: pins, restDays: dayOpts && dayOpts.restDays }).positions, placeable, horizon);
          if (s < bestSlip) { bestSlip = s; bestId = id; }
        }
      }

      const opts = [];
      for (const id of committed) {
        opts.push({ id, title: gbi[id].title, recommended: !restFree && id === bestId,
          chosen: chosen === id, behind: isBehind(id), danger: inDanger(id), getAhead: restFree });
      }
      opts.push({ rest: true, recommended: restFree, chosen: chosen === '__rest__', restCost });
      if (chosen) opts.push({ def: true }); // "use the plan's default" option
      opts.sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0)
        || ((b.behind ? 1 : 0) - (a.behind ? 1 : 0))
        || (a.rest ? 1 : 0) - (b.rest ? 1 : 0) || (a.def ? 1 : 0) - (b.def ? 1 : 0));
      todayOptions = opts;
    }
    return { releasesByDay: rbd, sessionByDay: sbd, gameById: gbi, plannedByMonth: pbm, bonusByMonth: bbm, bonusPlayByDay: bpd, deadlineByDay: dbd, deadlineBracketsByMonth: dbm, slippedByMonth: sbm, todayOptions, min: mn, max: mx };
  }, [placeable, pace, vacations, dayOpts, streamedByDay]);

  // Bonus games don't reserve midnight-launch eves (they're not committed).
  const eves = useMemo(() => launchEves(placeable.filter((g) => !g.bonus)), [placeable]);

  const now = new Date();
  const tY = now.getFullYear(), tM = now.getMonth(), tD = now.getDate();
  const ctx = { vacations, sessionByDay, bonusPlayByDay, gameById, releasesByDay, deadlineByDay, streamedByDay, eveByDay: eves.eveByDay, releaseDays: eves.releaseDays, restDays: dayOpts && dayOpts.restDays };

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
        <TodayPicker options={todayOptions} mobile={true} onPick={onPick} onChoose={onChooseToday} />
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
              const cls = 'mg-cell' + (info.vac ? ' vac' : info.streamed ? ' streamed' : '') + (isToday ? ' today' : '');
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
                    <span className="mg-strno" title={`Stream ${info.session.idx} of ${info.session.total}`}>{info.session.idx}/{info.session.total}{info.session.hours ? ` · ~${info.session.hours}h` : ''}</span>
                  )}
                  {info.streamed && info.streamed.map((s, si) => (
                    <span className="mg-pill mg-done" key={si} title={`Streamed: ${s.name}`}>
                      {s.art ? <img className="mg-done-art" src={s.art} alt="" loading="lazy" /> : null}
                      <span className="mg-done-nm">✓ {s.name}</span>
                    </span>
                  ))}
                  {info.vac && info.vacRunStart && <span className="mg-pill nowvac" title={info.vacLabel}>✈ {info.vacLabel}</span>}
                  {info.rest && <span className="mg-pill mg-rest" title="Rest day (you chose to rest)">☕ rest</span>}
                  {info.launch && (
                    <span className="mg-pill mg-launch" onClick={() => onPick(info.launch.id)}
                      title={`Midnight launch — ${info.launch.title}`}>🌙</span>
                  )}
                  {!info.vac && !info.launch && info.play && (
                    <span className="mg-pill mg-game" style={{ background: gameColor(info.play.id).solid }}
                      onClick={() => onPick(info.play.id)}
                      title={`${info.play.title}${info.session ? ` — stream ${info.session.idx}/${info.session.total}` : ''}`}>
                      {isImgIcon(info.play.icon) && <img className="mg-cellart" src={info.play.icon} alt="" loading="lazy" />}
                      <span className="mg-gt">{info.play.title}</span>
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

  return (
    <div>
      <TodayPicker options={todayOptions} mobile={false} onPick={onPick} onChoose={onChooseToday} />
      <div className="gc-bar">
        <button className="gc-today" onClick={scrollToToday}>Jump to today</button>
        <div className="gc-cnt">{totalCount} release{totalCount === 1 ? '' : 's'} · scroll for more months ↓</div>
      </div>
      <div className="cal-legend">Each game has its own colour, so a run of one colour is one game; numbers mark each stream (e.g. <b>3/6</b> = 3rd of 6) · <span className="lg-done">✓ + box art</span> = already streamed (real Twitch history) · 🌙 = midnight launch (eve reserved) · <span className="lg-vac">hatched</span> = vacation · ★ = release day · <span className="lg-planned">dashed chip</span> = planned for the month — click to auto-pick a start day · ✓ chip = placed</div>
      {/* weekday header stays pinned while you scroll through every month */}
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
            const cls = 'gc-cell' + (info.vac ? ' vac' : info.streamed ? ' streamed' : '') + (hasArt ? ' hasart' : '') + (isToday ? ' today' : '');
            const relTitles = info.releases.map((r) => r.title).join(', ');
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
                <span className="gc-dnum" title={relTitles || undefined}>{d}{info.releases.length ? <span className="gc-relstar">★</span> : null}{dl ? <span className="gc-deadflag" title={`Finish before ${dl.title}: ${dl.games.join(', ')}`}>⚑</span> : null}</span>
                {!info.vac && !info.launch && info.session && info.play && (
                  <span className="gc-strno" style={{ background: gameColor(info.play.id).solid, color: '#0c0c12' }}
                    title={`Stream ${info.session.idx} of ${info.session.total}`}>{info.session.idx}/{info.session.total}</span>
                )}
                {!info.vac && !info.launch && info.session && info.session.hours ? (
                  <span className="gc-hrs" title={`Estimated stream length this day (${(day.getUTCDay() === 0 || day.getUTCDay() === 6) ? 'weekend' : 'weekday'} pace)`}>~{info.session.hours}h</span>
                ) : null}
                {info.streamed && info.streamed.map((s, si) => (
                  <div className="gc-done" key={si} title={`Streamed: ${s.name}`}>
                    {s.art ? <img className="gc-done-art" src={s.art} alt="" loading="lazy" /> : null}
                    <span className="gc-done-nm"><span className="gc-done-chk">✓</span>{s.name}</span>
                  </div>
                ))}
                {info.vac && info.vacRunStart && <div className="gc-away">✈ {info.vacLabel}</div>}
                {info.rest && <div className="gc-away">☕ Rest day</div>}
                {info.launch && (
                  <div className="gc-ev gc-launch" onClick={() => onPick(info.launch.id)}
                    title={`Midnight launch — ${info.launch.title}`}>🌙</div>
                )}
                {!info.vac && !info.launch && info.session && info.play && (hasArt ? (
                  <div className="gc-tile" onClick={() => onPick(info.play.id)}
                    title={`${info.play.title} — stream ${info.session.idx}/${info.session.total}`}>
                    <div className="gc-tileart"><img src={info.play.icon} alt="" loading="lazy" /></div>
                    <div className="gc-tilename" style={{ background: gameColor(info.play.id).solid }}>{info.play.title}</div>
                  </div>
                ) : (
                  <div className="gc-ev" style={{ background: gameColor(info.play.id).solid }} onClick={() => onPick(info.play.id)}
                    title={`${info.play.title} — stream ${info.session.idx}/${info.session.total}`}>
                    {info.play.title}</div>
                ))}
                {info.bonusPlay && (
                  <div className="gc-ev bonus" style={{ borderColor: gameColor(info.bonusPlay.id).solid }}
                    onClick={() => onPick(info.bonusPlay.id)} title={`${info.bonusPlay.title} — bonus (free time)`}>
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
// Detail card
// ============================================================================
function DetailCard({ game: g, pace, vacations, queuedPos, onClose }) {
  const strk = streamsToFinish(g.hltbHours, pace);
  const wks = weeksToFinish(g.hltbHours, pace);
  const start = anchorDate(g.release);
  const earliest = start ? gameEnd(g, start, pace, vacations) : null;
  const queued = queuedPos ? queuedPos.end : null;
  const parts = queuedPos && queuedPos.segments ? queuedPos.segments.length : 1;
  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal detail" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <div className="modal-h-title"><GameBadge game={g} size={34} /><h3>{g.title}</h3></div>
          <button className="x" onClick={onClose}>×</button>
        </div>
        <div className="modal-b">
          <span className="dt-kind"><span className="swatch" style={{ background: KIND_COLOR[g.kind] }} />
            {KIND_LABEL[g.kind]} · {releaseLabel(g.release)}</span>

          {g.kind !== 'event' && g.hltbHours > 0 && (
            <div className="dt-stats">
              <div className="dt-stat"><div className="k">HowLongToBeat</div><div className="v">{g.hltbHours}<small> h</small></div></div>
              <div className="dt-stat"><div className="k">Streams to finish</div><div className="v">{strk}</div></div>
              {queued ? (
                <React.Fragment>
                  <div className="dt-stat"><div className="k">Earliest finish</div>
                    <div className="v" style={{ fontSize: '1rem' }}>{earliest ? fmtDate(earliest) : '—'}</div>
                    <div className="dt-sub">straight through from release</div></div>
                  <div className="dt-stat"><div className="k">Queued finish</div>
                    <div className="v" style={{ fontSize: '1rem' }}>{fmtDate(queued)}</div>
                    <div className="dt-sub">release-priority{parts > 1 ? ` · ${parts} parts` : ''}</div></div>
                </React.Fragment>
              ) : (
                <React.Fragment>
                  <div className="dt-stat"><div className="k">≈ Real time</div><div className="v">{wks < 1.05 ? Math.round(wks * 7) + 'd' : wks.toFixed(1) + 'w'}</div></div>
                  <div className="dt-stat"><div className="k">Est. finish</div><div className="v" style={{ fontSize: '1rem' }}>{earliest ? fmtDate(earliest) : '—'}</div></div>
                </React.Fragment>
              )}
            </div>
          )}

          <div className="dt-list">
            {g.platforms && g.platforms.length > 0 && (
              <div className="dt-line"><span className="k">Platforms</span>
                <span className="tags">{g.platforms.map((p) => <span className="tag" key={p}>{p}</span>)}</span></div>
            )}
            {g.editions && g.editions.length > 0 && (
              <div className="dt-line"><span className="k">Editions</span>
                <div className="ed-list">{g.editions.map((e, i) => (
                  <div className="e" key={i}><span>{e.name}</span>
                    <span className="p">{e.msrpUSD ? '$' + e.msrpUSD.toFixed(2) : 'TBA'}</span></div>
                ))}</div></div>
            )}
            {g.earlyAccess && <div className="dt-line"><span className="k">Early access / bonus</span>{g.earlyAccess}</div>}
            {g.hltbNote && <div className="dt-line"><span className="k">HLTB basis</span>{labelBasis(g.hltbBasis)} — {g.hltbNote}</div>}
            {g.partGoal && <div className="dt-line"><span className="k">Part goal</span>{renderSpoilers(g.partGoal)}</div>}
          </div>

          {g.notes && <div className="note-box">{g.notes}</div>}
        </div>
        <div className="modal-f">
          <span className="hint" style={{ marginRight: 'auto' }}>Edit in games.json</span>
          <button className="btn btn-accent" onClick={onClose}>Done</button>
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
