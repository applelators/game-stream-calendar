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
  view: 'timeline',
  schedMode: 'parallel',
  vacations: [],   // [{ id, label, start:'YYYY-MM-DD', end:'YYYY-MM-DD' }] — no streaming
};

const FALLBACK_PACE = { hoursPerStream: 5.11, hoursPerWeek: 11.52, source: 'fallback', fetchedAt: null, numStreams: 29, totalHours: 148.1, windowDays: 90 };

const KIND_LABEL = { game: 'Game', replay: 'Replay', dlc: 'DLC / Chapter', event: 'Event' };
const KIND_COLOR = { game: 'var(--accent)', replay: 'var(--accent-2)', dlc: 'var(--good)', event: 'var(--warn)' };
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
function effectivePace(settings, pace) {
  if (settings.override) return { hoursPerStream: settings.hoursPerStream, hoursPerWeek: settings.hoursPerWeek };
  return { hoursPerStream: pace.hoursPerStream, hoursPerWeek: pace.hoursPerWeek };
}

// ============================================================================
// App
// ============================================================================
function App() {
  const [games, setGames] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [pace, setPace] = useState(FALLBACK_PACE);
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
        if (!cancelled && state && state.settings) setSettings({ ...DEFAULT_SETTINGS, ...state.settings });
      } catch (e) {
        const ls = loadLocal();
        if (!cancelled && ls && ls.settings) setSettings({ ...DEFAULT_SETTINGS, ...ls.settings });
      }
      try {
        const pr = await fetch('/api/pace');
        if (pr.ok) { const p = await pr.json(); if (!cancelled && p) setPace(p); }
      } catch (e) { /* keep fallback */ }
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
  // Realistic release-priority finish per game (for the detail card).
  const seqPositions = useMemo(
    () => schedule(games.filter((g) => isPlaceable(g.release)), ep, 'sequential', normVacs),
    [games, ep, normVacs]
  );

  const detailGame = detail ? games.find((g) => g.id === detail) : null;

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
          {settings.override ? ' (manual)' : ` (${pace.source === 'sullygnome' ? 'live 90-day' : 'fallback'})`}
          {normVacs.length > 0 ? ` · ${normVacs.length} break${normVacs.length === 1 ? '' : 's'} blocked off` : ''}
          {settings.schedMode === 'sequential' && settings.view === 'timeline' ? ' · new releases first, older games split around them' : ''}
        </div>
      </header>

      {settings.view === 'timeline'
        ? <TimelineView games={games} pace={ep} mode={settings.schedMode} vacations={normVacs} onPick={setDetail} />
        : <MonthGridView games={games} pace={ep} vacations={normVacs} onPick={setDetail} />}

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
  const positions = useMemo(() => schedule(placeable, pace, mode, vacations), [placeable, pace, mode, vacations]);

  const rows = useMemo(() => {
    return placeable
      .map((g) => ({ g, pos: positions[g.id] }))
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

            {rows.map(({ g, pos }) => {
              const segs = pos.segments && pos.segments.length ? pos.segments : [{ start: pos.start, end: pos.end }];
              const fuzzy = isFuzzy(g.release);
              const strk = streamsToFinish(g.hltbHours, pace);
              const firstLeft = xOf(segs[0].start);
              const firstW = xOf(segs[0].end) - firstLeft;
              const lastRight = xOf(segs[segs.length - 1].end);
              const labelInside = firstW > 90;
              return (
                <div className="tl-row" key={g.id}>
                  <div className="tl-label">
                    <span className="nm">{g.title}</span>
                    <span className="meta">{releaseLabel(g.release)}{g.kind !== 'game' ? ' · ' + KIND_LABEL[g.kind] : ''}</span>
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
                        <div key={si} className={`bar k-${g.kind}${fuzzy ? ' fuzzy' : ''}${si > 0 ? ' cont' : ''}`}
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
                <span className="swatch" style={{ background: KIND_COLOR[g.kind] }} />
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
  if (inVacation(day, ctx.vacations)) {
    return { vac: true, vacRunStart: !inVacation(prev, ctx.vacations), vacLabel: vacLabelFor(day, ctx.vacations), releases };
  }
  const eve = ctx.eveByDay && ctx.eveByDay[k];
  if (eve && !(ctx.releaseDays && ctx.releaseDays[k])) return { launch: eve, releases };
  const playId = ctx.playByDay[k];
  if (!playId) return { releases, play: null };
  const play = ctx.gameById[playId];
  const session = ctx.sessionByDay[k] || null; // { id, idx, total } on actual stream days
  return { releases, play, session };
}

function MonthGridView({ games, pace, vacations, onPick }) {
  const isMobile = useIsMobile();

  const placeable = useMemo(() => games.filter((g) => isPlaceable(g.release)), [games]);
  const rail = useMemo(() => games.filter((g) => !isPlaceable(g.release)), [games]);

  // The realistic one-game-per-day plan (release-priority queue) drives the
  // calendar: each stream day maps to the game you'll actually be playing.
  const { releasesByDay, playByDay, sessionByDay, gameById, min, max } = useMemo(() => {
    const pos = schedule(placeable, pace, 'sequential', vacations);
    const rbd = {}, pbd = {}, gbi = {};
    let mn = null, mx = null;
    for (const g of placeable) {
      gbi[g.id] = g;
      const a = anchorDate(g.release);
      if (a) { const k = dayKey(a); (rbd[k] = rbd[k] || []).push(g); }
      const p = pos[g.id];
      if (!p) continue;
      if (!mn || p.start < mn) mn = p.start;
      if (!mx || p.end > mx) mx = p.end;
      if (g.kind === 'event') continue; // events are background, not the daily game
      for (const seg of p.segments)
        for (let d = new Date(seg.start); d < seg.end; d = addDays(d, 1)) pbd[dayKey(d)] = g.id;
    }
    const sbd = streamSessions(placeable, pace, pos, vacations);
    return { releasesByDay: rbd, playByDay: pbd, sessionByDay: sbd, gameById: gbi, min: mn, max: mx };
  }, [placeable, pace, vacations]);

  const eves = useMemo(() => launchEves(placeable), [placeable]);

  const now = new Date();
  const tY = now.getFullYear(), tM = now.getMonth(), tD = now.getDate();
  const ctx = { vacations, playByDay, sessionByDay, gameById, releasesByDay, eveByDay: eves.eveByDay, releaseDays: eves.releaseDays };

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
        <div className="cal-legend">Band = the game; numbers = each stream (3/6) · 🌙 = launch · hatched = vacation · ★ = release</div>
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
              const cls = 'mg-cell' + (info.vac ? ' vac' : info.launch ? ` play-${info.launch.kind}` : info.play ? ` play-${info.play.kind}` : '') + (isToday ? ' today' : '');
              cells.push(
                <div key={d} className={cls}>
                  <span className="dnum">{d}{info.releases.length ? <span className="relstar">★</span> : null}</span>
                  {info.vac && info.vacRunStart && <span className="mg-pill nowvac" title={info.vacLabel}>✈ {info.vacLabel}</span>}
                  {info.launch && (
                    <span className="mg-pill" style={{ background: KIND_COLOR[info.launch.kind] }}
                      onClick={() => onPick(info.launch.id)} title={`Midnight launch: ${info.launch.title}`}>
                      🌙 {info.launch.title}</span>
                  )}
                  {!info.vac && !info.launch && info.session && info.play && (
                    <span className="mg-pill" style={{ background: KIND_COLOR[info.play.kind] }}
                      onClick={() => onPick(info.play.id)} title={`${info.play.title} — stream ${info.session.idx}/${info.session.total}`}>
                      {info.session.idx}/{info.session.total}</span>
                  )}
                </div>
              );
            }
            return (
              <div className="mg-card" key={i}>
                <div className="mg-head">{MONTHS_LONG[mon]} {y}<span className="cnt">{monthCount} release{monthCount === 1 ? '' : 's'}</span></div>
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
      <div className="gc-bar">
        <button className="gc-today" onClick={scrollToToday}>Jump to today</button>
        <div className="gc-cnt">{totalCount} release{totalCount === 1 ? '' : 's'} · scroll for more months ↓</div>
      </div>
      <div className="cal-legend">Tinted band = the game you’ll be streaming; numbers mark each stream (e.g. <b>3/6</b> = 3rd of 6) · 🌙 = midnight launch (eve reserved) · <span className="lg-vac">hatched</span> = vacation · ★ = release day</div>
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
            const cls = 'gc-cell' + (info.vac ? ' vac' : info.launch ? ` play-${info.launch.kind}` : info.play ? ` play-${info.play.kind}` : '') + (isToday ? ' today' : '');
            const relTitles = info.releases.map((r) => r.title).join(', ');
            cells.push(
              <div key={d} className={cls}>
                <span className="gc-dnum" title={relTitles || undefined}>{d}{info.releases.length ? <span className="gc-relstar">★</span> : null}</span>
                {info.vac && info.vacRunStart && <div className="gc-away">✈ {info.vacLabel}</div>}
                {info.launch && (
                  <div className={`gc-ev k-${info.launch.kind}`} onClick={() => onPick(info.launch.id)}
                    title={`Midnight launch: ${info.launch.title}`}>🌙 {info.launch.title}</div>
                )}
                {!info.vac && !info.launch && info.session && info.play && (
                  <div className={`gc-ev k-${info.play.kind}`} onClick={() => onPick(info.play.id)}
                    title={`${info.play.title} — stream ${info.session.idx}/${info.session.total}`}>
                    {info.play.title} {info.session.idx}/{info.session.total}</div>
                )}
              </div>
            );
          }
          return (
            <div className="gc-month" id={`gcm-${y}-${mon}`} key={idx}>
              <div className="gc-mhead">{MONTHS_LONG[mon]} {y}
                <span className="gc-headcnt">{monthCount} release{monthCount === 1 ? '' : 's'}</span></div>
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
            <span className="swatch" style={{ background: KIND_COLOR[g.kind] }} />
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
          <h3>{g.title}</h3>
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
              <span className="src-pill">{pace.source === 'sullygnome' ? 'live · 90-day' : pace.source || 'fallback'}</span>
            </div>
            <div style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: 4 }}>
              {pace.hoursPerWeek}h / week · {pace.numStreams || '–'} streams · {pace.totalHours || '–'}h over last {pace.windowDays || 90} days
            </div>
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
