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
const SEED_GAMES = [
  { id: 'dk-challenge', title: 'DK Challenge', kind: 'event',
    release: { year: 2026, month: 6, day: 9, precision: 'day', raw: 'Jun 9 – Aug 30, 2026' },
    eventEnd: { year: 2026, month: 8, day: 30, precision: 'day' },
    hltbHours: 0, hltbBasis: 'estimate', hltbNote: 'Fixed personal stream-challenge window, not an HLTB playthrough.',
    platforms: [], editions: [], earlyAccess: '', notes: 'Self-set challenge running through the summer.' },

  { id: 'xeno1-s2', title: 'Xenoblade Chronicles 1 — S2', kind: 'replay',
    release: { year: 2026, month: 6, day: 9, precision: 'day' },
    hltbHours: 55, hltbBasis: 'self', hltbNote: 'Xenoblade Chronicles: Definitive Edition main story.',
    platforms: ['Switch'], editions: [], earlyAccess: '', notes: 'Stream "Season 2" replay of XC1.' },

  { id: 'deltarune-ch5', title: 'Deltarune — Chapter 5', kind: 'dlc',
    release: { year: 2026, month: 6, day: 24, precision: 'day' },
    hltbHours: 4, hltbBasis: 'series-avg', hltbNote: 'Avg of Deltarune Chapters 1–4 (~3–4h each).',
    platforms: ['Switch', 'Switch 2', 'PS4', 'PS5', 'PC'],
    editions: [{ name: 'Free update (owners)', msrpUSD: 0 }],
    earlyAccess: '', notes: 'Free chapter update for existing owners.' },

  { id: 'star-fox', title: 'Star Fox (Switch 2)', kind: 'game',
    release: { year: 2026, month: 6, day: 25, precision: 'day' },
    hltbHours: 6, hltbBasis: 'remake-original', hltbNote: 'Based on Star Fox 64 main (~5h) + new prologue.',
    platforms: ['Switch 2'],
    editions: [{ name: 'Standard (est.)', msrpUSD: 69.99 }],
    earlyAccess: 'Free demo available.', notes: 'Velan Studios remake of Star Fox 64 with mouse aiming + online dogfights.' },

  { id: 'rhythm-heaven-groove', title: 'Rhythm Heaven Groove', kind: 'game',
    release: { year: 2026, month: 7, day: 2, precision: 'day' },
    hltbHours: 12, hltbBasis: 'series-avg', hltbNote: 'Based on Rhythm Heaven Megamix completion (~10–12h).',
    platforms: ['Switch'],
    editions: [{ name: 'Standard (est.)', msrpUSD: 49.99 }],
    earlyAccess: '', notes: 'First new Rhythm Heaven in over a decade.' },

  { id: 'splatoon-raiders', title: 'Splatoon Raiders', kind: 'game',
    release: { year: 2026, month: 7, day: 23, precision: 'day' },
    hltbHours: 12, hltbBasis: 'series-avg', hltbNote: 'Est. from Splatoon single-player campaigns (~8h) scaled up for a full spin-off.',
    platforms: ['Switch 2'],
    editions: [{ name: 'Standard (est.)', msrpUSD: 59.99 }],
    earlyAccess: '', notes: 'Single-player-focused spin-off; up to 4-player co-op raids.' },

  { id: 'halo-campaign-evolved', title: 'Halo: Campaign Evolved', kind: 'game',
    release: { year: 2026, month: 7, day: 28, precision: 'day' },
    hltbHours: 11, hltbBasis: 'remake-original', hltbNote: 'Based on Halo: Combat Evolved campaign (~10h) + added content.',
    platforms: ['PS5', 'Xbox Series', 'PC', 'Game Pass'],
    editions: [
      { name: 'Standard', msrpUSD: 49.99 },
      { name: 'Premium', msrpUSD: 69.99 },
      { name: "Collector's", msrpUSD: 199.99 },
    ],
    earlyAccess: 'Premium & Collector’s get up to 5 days early access (from Jul 23) + Alpha Halo Armory Pack.',
    notes: 'Day one on Game Pass. Collector’s adds a 12" Master Chief statue, LED Cortana chip, Steelbook.' },

  { id: 'xeno2-s2', title: 'Xenoblade Chronicles 2 — S2', kind: 'replay',
    release: { year: 2026, month: 7, day: 30, precision: 'day' },
    hltbHours: 62, hltbBasis: 'self', hltbNote: 'Xenoblade Chronicles 2 main story.',
    platforms: ['Switch'], editions: [], earlyAccess: '', notes: 'Stream "Season 2" replay of XC2.' },

  { id: 'pokopia-dlc', title: 'Pokémon Pokopia — DLC', kind: 'dlc',
    release: { year: 2026, month: 8, precision: 'month', raw: 'August 2026' },
    hltbHours: 15, hltbBasis: 'estimate', hltbNote: 'Estimate for a sizeable Pokémon DLC.',
    platforms: ['Switch 2'],
    editions: [{ name: 'DLC (est.)', msrpUSD: 24.99 }],
    earlyAccess: '', notes: 'Date per your note (August); some reports peg the DLC to Q1 2027 — verify.' },

  { id: 'ffxiv', title: 'Final Fantasy XIV', kind: 'replay',
    release: { year: 2026, month: 8, precision: 'month', raw: 'August 2026' },
    hltbHours: 40, hltbBasis: 'estimate', hltbNote: 'MMO — no fixed length; estimate covers a content patch/return arc.',
    platforms: ['PS5', 'PC', 'Xbox Series'],
    editions: [], earlyAccess: '', notes: 'Live-service MMO; "finish" is open-ended — adjust hours to the content you plan to stream.' },

  { id: 'orbitals', title: 'Orbitals', kind: 'game',
    release: { year: 2026, month: 9, day: 3, precision: 'day' },
    hltbHours: 10, hltbBasis: 'estimate', hltbNote: 'New IP — rough estimate for a co-op adventure.',
    platforms: ['Switch 2'],
    editions: [{ name: 'Standard (est.)', msrpUSD: 39.99 }, { name: 'Deluxe', msrpUSD: 0 }],
    earlyAccess: 'Deluxe Edition adds extra in-game content.', notes: 'Two-player co-op sci-fi adventure (anime aesthetic).' },

  { id: 'marvels-wolverine', title: "Marvel's Wolverine", kind: 'game',
    release: { year: 2026, month: 9, day: 15, precision: 'day' },
    hltbHours: 18, hltbBasis: 'series-avg', hltbNote: "Based on Insomniac's Marvel's Spider-Man games (~17h main).",
    platforms: ['PS5'],
    editions: [
      { name: 'Standard', msrpUSD: 69.99 },
      { name: 'Digital Deluxe', msrpUSD: 79.99 },
    ],
    earlyAccess: 'Pre-order: Classic Brown suit + Reflective Claws (early unlock), 1 Technique Point, 4 avatars.',
    notes: 'PS5 exclusive, Insomniac Games.' },

  { id: 'fe-fortunes-weave', title: "Fire Emblem: Fortune's Weave", kind: 'game',
    release: { year: 2026, month: 9, day: 17, precision: 'day' },
    hltbHours: 45, hltbBasis: 'series-avg', hltbNote: 'Between Engage (~35h) and Three Houses (~50h/route).',
    platforms: ['Switch 2'],
    editions: [
      { name: 'Digital', msrpUSD: 69.99 },
      { name: 'Physical', msrpUSD: 79.99 },
      { name: 'Dagdan Collection', msrpUSD: 0 },
    ],
    earlyAccess: '', notes: 'Switch 2 exclusive. Pre-orders opened Jun 9, 2026.' },

  { id: 'kh-collection', title: 'Kingdom Hearts Collection [I–III]', kind: 'game',
    release: { year: 2026, month: 10, day: 8, precision: 'day' },
    hltbHours: 90, hltbBasis: 'series-avg', hltbNote: 'Headline trilogy main stories combined (KH1 ~25h, KH2 ~33h, KH3 ~30h); full set incl. 2.8 is longer.',
    platforms: ['Switch 2', 'PS5', 'Xbox Series'],
    editions: [{ name: 'Standard', msrpUSD: 79.99 }],
    earlyAccess: '', notes: 'Includes HD 1.5+2.5 ReMIX, 2.8 Final Chapter Prologue, KH3 + ReMind. First native on Nintendo.' },

  { id: 'gta-vi', title: 'Grand Theft Auto VI', kind: 'game',
    release: { year: 2026, month: 11, day: 19, precision: 'day' },
    hltbHours: 40, hltbBasis: 'series-avg', hltbNote: 'Estimate from GTA V story (~31h), scaled up.',
    platforms: ['PS5', 'Xbox Series'],
    editions: [
      { name: 'Standard (est.)', msrpUSD: 79.99 },
      { name: 'Special/Deluxe (est.)', msrpUSD: 109.99 },
    ],
    earlyAccess: '', notes: 'Editions/pricing not fully confirmed; Take-Two signalled $70–80 standard.' },

  { id: 'xeno3-s2', title: 'Xenoblade Chronicles 3 — S2', kind: 'replay',
    release: { year: 2026, month: 12, day: 3, precision: 'day' },
    hltbHours: 62, hltbBasis: 'self', hltbNote: 'Xenoblade Chronicles 3 main story.',
    platforms: ['Switch'], editions: [], earlyAccess: '', notes: 'Stream "Season 2" replay of XC3.' },

  { id: 'zelda-oot', title: 'Zelda: Ocarina of Time (remake)', kind: 'game',
    release: { year: 2026, precision: 'year', raw: '2026 (date TBA)' },
    hltbHours: 27, hltbBasis: 'remake-original', hltbNote: 'Based on Ocarina of Time main (~27h).',
    platforms: ['Switch 2'],
    editions: [{ name: 'Standard (est.)', msrpUSD: 69.99 }],
    earlyAccess: '', notes: 'Announced for later 2026, no firm date yet.' },

  { id: 'twau-remaster', title: 'The Wolf Among Us (Remastered)', kind: 'game',
    release: { year: 2026, month: 11, quarter: 4, precision: 'quarter', raw: 'Holiday 2026' },
    hltbHours: 8, hltbBasis: 'remake-original', hltbNote: 'Based on the original The Wolf Among Us (~8h).',
    platforms: ['PC', 'PS5', 'Xbox Series'],
    editions: [{ name: 'Standard (est.)', msrpUSD: 24.99 }],
    earlyAccess: '', notes: 'Remaster with 1h+ bonus content. Holiday 2026 window.' },

  { id: 'among-us-on-guard', title: 'Among Us Story: On Guard', kind: 'game',
    release: { year: 2026, precision: 'year', raw: '2026 (date TBA)' },
    hltbHours: 5, hltbBasis: 'estimate', hltbNote: 'Estimate for a standalone narrative experience.',
    platforms: ['PC', 'Switch', 'Switch 2'],
    editions: [], earlyAccess: '', notes: 'Standalone narrative spin-off; no firm date.' },

  { id: 'duskbloods', title: 'The Duskbloods', kind: 'game',
    release: { year: 2026, precision: 'tbd', raw: 'TBA (late 2026?)' },
    hltbHours: 30, hltbBasis: 'estimate', hltbNote: 'FromSoftware multiplayer — no campaign length; rough estimate.',
    platforms: ['Switch 2'],
    editions: [], earlyAccess: 'Closed Network Test this summer.', notes: 'FromSoftware Switch 2 exclusive, up to 8 players PvPvE. No date.' },

  { id: 'stranger-than-heaven', title: 'Stranger Than Heaven', kind: 'game',
    release: { year: 2027, month: 1, day: 15, precision: 'day' },
    hltbHours: 40, hltbBasis: 'series-avg', hltbNote: 'Based on RGG / Like a Dragon main stories (~35–45h).',
    platforms: ['PS5', 'Xbox Series', 'PC', 'Game Pass'],
    editions: [{ name: 'Standard (est.)', msrpUSD: 69.99 }],
    earlyAccess: '', notes: 'RGG Studio (Project Century). Day one on Game Pass.' },

  { id: 'tomb-raider-loa', title: 'Tomb Raider: Legacy of Atlantis', kind: 'game',
    release: { year: 2027, month: 2, day: 12, precision: 'day' },
    hltbHours: 12, hltbBasis: 'remake-original', hltbNote: 'Based on the original Tomb Raider (1996) (~12h).',
    platforms: ['PC', 'Xbox Series', 'PS5', 'Switch 2'],
    editions: [{ name: 'Standard (est.)', msrpUSD: 69.99 }],
    earlyAccess: '', notes: 'Unreal Engine 5 full remake of Tomb Raider (1996) by Crystal Dynamics.' },

  { id: 'persona-4-revival', title: 'Persona 4 Revival', kind: 'game',
    release: { year: 2027, month: 2, day: 18, precision: 'day' },
    hltbHours: 55, hltbBasis: 'remake-original', hltbNote: 'Based on Persona 4 Golden main (~55h).',
    platforms: ['PS5', 'Xbox Series', 'PC', 'Game Pass'],
    editions: [
      { name: 'Digital Standard', msrpUSD: 69.99 },
      { name: 'Limited Box', msrpUSD: 119.99 },
    ],
    earlyAccess: '', notes: 'Eight editions; physical PS5 only. Day one on Game Pass.' },

  { id: 'ff7-revelation', title: 'Final Fantasy VII Revelation', kind: 'game',
    release: { year: 2027, month: 4, quarter: 2, precision: 'quarter', raw: 'Spring 2027' },
    hltbHours: 55, hltbBasis: 'series-avg', hltbNote: 'Estimate from FF7 Remake (~33h) & Rebirth (~73h) main stories.',
    platforms: ['Switch 2', 'PS5', 'Xbox Series', 'PC'],
    editions: [{ name: 'Standard (est.)', msrpUSD: 69.99 }],
    earlyAccess: '', notes: 'Final part of the FF7 remake trilogy, simultaneous all-platform.' },

  { id: 'pokemon-winds-waves', title: 'Pokémon Winds and Waves', kind: 'game',
    release: { year: 2027, month: 11, precision: 'month', raw: 'Nov 2027 (window)' },
    hltbHours: 30, hltbBasis: 'series-avg', hltbNote: 'Estimate from recent mainline Pokémon (~30h main).',
    platforms: ['Switch 2'],
    editions: [{ name: 'Standard (est.)', msrpUSD: 69.99 }],
    earlyAccess: '', notes: 'Gen 10. Official window is "2027"; you noted November.' },

  { id: 'pikuniku-2', title: 'Pikuniku 2', kind: 'game',
    release: { year: 2027, precision: 'year', raw: '2027' },
    hltbHours: 5, hltbBasis: 'remake-original', hltbNote: 'Based on Pikuniku (~3–4h), now 3D.',
    platforms: ['PC', 'Switch 2'],
    editions: [], earlyAccess: '', notes: 'Devolver Digital; quirky exploration sequel in 3D.' },

  { id: 'xenoblade-genesis', title: 'Xenoblade Genesis', kind: 'game',
    release: { year: 2027, precision: 'year', raw: '2027' },
    hltbHours: 60, hltbBasis: 'series-avg', hltbNote: 'Estimate from prior Xenoblade main stories (~55–62h).',
    platforms: ['Switch 2'],
    editions: [], earlyAccess: '', notes: 'New Monolith Soft Xenoblade entry; school-setting vibe.' },

  { id: 'kingdom-hearts-4', title: 'Kingdom Hearts IV', kind: 'game',
    release: { year: 2026, precision: 'tbd', raw: 'TBA' },
    hltbHours: 35, hltbBasis: 'series-avg', hltbNote: 'Estimate from Kingdom Hearts III (~30h main).',
    platforms: ['Switch 2', 'PS5', 'Xbox Series'],
    editions: [], earlyAccess: '', notes: 'No firm date; reported coming to Switch 2 (possibly at the Oct 8 launch).' },

  { id: 'ff7-trilogy-backlog', title: 'Final Fantasy VII Remake / Rebirth / Reunion', kind: 'replay',
    release: { year: 2026, precision: 'tbd', raw: 'Backlog (no date)' },
    hltbHours: 120, hltbBasis: 'self', hltbNote: 'Remake (~33h) + Rebirth (~73h) + Crisis Core Reunion (~14h).',
    platforms: ['Switch 2', 'PS5', 'PC'],
    editions: [], earlyAccess: '', notes: 'Replay/backlog of the existing FF7 titles (Rebirth now on Switch 2).' },

  { id: 'virtua-fighter-crossroads', title: 'Virtua Fighter Crossroads', kind: 'game',
    release: { year: 2027, precision: 'year', raw: '2027' },
    hltbHours: 10, hltbBasis: 'estimate', hltbNote: 'Estimate for a fighting game with a single-player campaign.',
    platforms: ['PS5', 'Xbox Series', 'PC'],
    editions: [], earlyAccess: '', notes: 'Anthology blending a narrative campaign with fighting (UE5).' },
];

const DEFAULT_SETTINGS = {
  override: false,
  hoursPerStream: 5.11,
  hoursPerWeek: 11.52,
  view: 'timeline',
  schedMode: 'parallel',
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
  const [games, setGames] = useState(SEED_GAMES);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [pace, setPace] = useState(FALLBACK_PACE);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(null);   // game obj or {new:true}
  const [detail, setDetail] = useState(null);      // game id
  const [showSettings, setShowSettings] = useState(false);
  const firstSave = useRef(true);

  // Initial load: server state -> else localStorage -> else seed. Plus pace.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let state = null;
      try {
        const r = await fetch('/api/state');
        if (r.ok) state = await r.json();
      } catch (e) { /* offline / static host */ }
      if (!state) state = loadLocal();
      if (!cancelled && state) {
        if (Array.isArray(state.games)) setGames(state.games);
        if (state.settings) setSettings({ ...DEFAULT_SETTINGS, ...state.settings });
      }
      try {
        const pr = await fetch('/api/pace');
        if (pr.ok) { const p = await pr.json(); if (!cancelled && p) setPace(p); }
      } catch (e) { /* keep fallback */ }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist on change (debounced), after initial load.
  useEffect(() => {
    if (!loaded) return;
    if (firstSave.current) { firstSave.current = false; return; }
    const state = { games, settings, savedAt: new Date().toISOString() };
    saveLocal(state);
    const t = setTimeout(() => {
      fetch('/api/state', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      }).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [games, settings, loaded]);

  const ep = effectivePace(settings, pace);

  const upsertGame = useCallback((g) => {
    setGames((gs) => {
      const i = gs.findIndex((x) => x.id === g.id);
      if (i === -1) return [...gs, g];
      const next = gs.slice(); next[i] = g; return next;
    });
  }, []);
  const removeGame = useCallback((id) => setGames((gs) => gs.filter((g) => g.id !== id)), []);

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
          <button className="btn" onClick={() => setShowSettings(true)}>⚙ Pace</button>
          <button className="btn btn-accent" onClick={() => setEditing({ __new: true })}>+ Add game</button>
        </div>
        <div className="hdr-sub">
          {games.length} titles · pace {ep.hoursPerStream}h/stream · {ep.hoursPerWeek}h/week
          {settings.override ? ' (manual)' : ` (${pace.source === 'sullygnome' ? 'live 90-day' : 'fallback'})`}
          {settings.schedMode === 'sequential' && settings.view === 'timeline' ? ' · queued back-to-back' : ''}
        </div>
      </header>

      {settings.view === 'timeline'
        ? <TimelineView games={games} pace={ep} mode={settings.schedMode} onPick={setDetail} />
        : <MonthGridView games={games} pace={ep} onPick={setDetail} />}

      {editing && (
        <GameModal game={editing.__new ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(g) => { upsertGame(g); setEditing(null); }}
          onDelete={(id) => { removeGame(id); setEditing(null); }} />
      )}
      {detailGame && (
        <DetailCard game={detailGame} pace={ep}
          onClose={() => setDetail(null)}
          onEdit={() => { setEditing(detailGame); setDetail(null); }} />
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
function TimelineView({ games, pace, mode, onPick }) {
  const placeable = useMemo(() => games.filter((g) => isPlaceable(g.release)), [games]);
  const rail = useMemo(() => games.filter((g) => !isPlaceable(g.release)), [games]);
  const positions = useMemo(() => schedule(placeable, pace, mode), [placeable, pace, mode]);

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
              const left = xOf(pos.start);
              const w = Math.max(8, xOf(pos.end) - left);
              const fuzzy = isFuzzy(g.release);
              const strk = streamsToFinish(g.hltbHours, pace);
              const labelInside = w > 90;
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
                    {today >= domStart && today < domEnd &&
                      <div className="tl-today" style={{ left: xOf(today) }} />}
                    <div className={`bar k-${g.kind}${fuzzy ? ' fuzzy' : ''}`}
                      style={{ left, width: w }} onClick={() => onPick(g.id)}
                      title={`${g.title} — ${releaseLabel(g.release)}`}>
                      {labelInside && <span className="bt">{g.title}</span>}
                      {labelInside && g.kind !== 'event' && strk > 0 &&
                        <span className="strk">{strk} strm</span>}
                    </div>
                    {!labelInside && g.kind !== 'event' && strk > 0 &&
                      <div className="bar-out" style={{ left: left + w + 6 }}>{strk} strm</div>}
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

function MonthGridView({ games, pace, onPick }) {
  const isMobile = useIsMobile();

  const placeable = useMemo(() => games.filter((g) => isPlaceable(g.release)), [games]);
  const rail = useMemo(() => games.filter((g) => !isPlaceable(g.release)), [games]);
  const positions = useMemo(() => schedule(placeable, pace, 'parallel'), [placeable, pace]);

  // releasesByDay + the set of days inside any play-window + the overall span.
  const { releasesByDay, winDays, min, max } = useMemo(() => {
    const rbd = {}, wd = new Set();
    let mn = null, mx = null;
    for (const g of placeable) {
      const a = anchorDate(g.release);
      if (a) { const k = dayKey(a); (rbd[k] = rbd[k] || []).push(g); }
      const p = positions[g.id];
      if (p) {
        if (!mn || p.start < mn) mn = p.start;
        if (!mx || p.end > mx) mx = p.end;
        for (let d = new Date(p.start); d < p.end; d = addDays(d, 1)) wd.add(dayKey(d));
      }
    }
    return { releasesByDay: rbd, winDays: wd, min: mn, max: mx };
  }, [placeable, positions]);

  const now = new Date();
  const tY = now.getFullYear(), tM = now.getMonth(), tD = now.getDate();

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
              const rel = releasesByDay[`${y}-${mon}-${d}`] || [];
              monthCount += rel.length;
              const isToday = y === tY && mon === tM && d === tD;
              cells.push(
                <div key={d} className={'mg-cell' + (winDays.has(dayKey(day)) ? ' win' : '') + (isToday ? ' today' : '')}>
                  <span className="dnum">{d}</span>
                  {rel.length > 0 && (
                    <div className="mg-rel">
                      {rel.slice(0, 2).map((g) => (
                        <span key={g.id} className="mg-pill" style={{ background: KIND_COLOR[g.kind] }}
                          onClick={() => onPick(g.id)} title={g.title}>{g.title}</span>
                      ))}
                      {rel.length > 2 && <span className="mg-pill" style={{ background: 'var(--panel-3)', color: 'var(--muted)' }}>+{rel.length - 2}</span>}
                    </div>
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
            const rel = releasesByDay[`${y}-${mon}-${d}`] || [];
            monthCount += rel.length;
            const isToday = y === tY && mon === tM && d === tD;
            cells.push(
              <div key={d} className={'gc-cell' + (winDays.has(dayKey(day)) ? ' win' : '') + (isToday ? ' today' : '')}>
                <span className="gc-dnum">{d}</span>
                {rel.slice(0, 4).map((g) => (
                  <div key={g.id} className={`gc-ev k-${g.kind}`} onClick={() => onPick(g.id)}
                    title={`${g.title} — ${releaseLabel(g.release)}`}>{g.title}</div>
                ))}
                {rel.length > 4 && <div className="gc-more">+{rel.length - 4} more</div>}
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
function DetailCard({ game: g, pace, onClose, onEdit }) {
  const strk = streamsToFinish(g.hltbHours, pace);
  const wks = weeksToFinish(g.hltbHours, pace);
  const start = anchorDate(g.release);
  const finish = start ? addDays(start, gameDurationDays(g, pace)) : null;
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
              <div className="dt-stat"><div className="k">≈ Real time</div><div className="v">{wks < 1.05 ? Math.round(wks * 7) + 'd' : wks.toFixed(1) + 'w'}</div></div>
              <div className="dt-stat"><div className="k">Est. finish</div><div className="v" style={{ fontSize: '1rem' }}>{finish ? fmtDate(finish) : '—'}</div></div>
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
          <button className="btn" onClick={onEdit}>Edit</button>
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
// Add / edit modal
// ============================================================================
function GameModal({ game, onClose, onSave, onDelete }) {
  const isNew = !game;
  const [f, setF] = useState(() => game ? deepCopy(game) : blankGame());
  const r = f.release;
  const set = (patch) => setF((p) => ({ ...p, ...patch }));
  const setR = (patch) => setF((p) => ({ ...p, release: { ...p.release, ...patch } }));

  const save = () => {
    const g = deepCopy(f);
    g.title = (g.title || '').trim() || 'Untitled';
    g.hltbHours = Number(g.hltbHours) || 0;
    g.platforms = (typeof g._platforms === 'string')
      ? g._platforms.split(',').map((s) => s.trim()).filter(Boolean)
      : (g.platforms || []);
    delete g._platforms;
    g.editions = (g.editions || []).filter((e) => e.name && e.name.trim())
      .map((e) => ({ name: e.name.trim(), msrpUSD: Number(e.msrpUSD) || 0 }));
    // derive raw label for fuzzy precisions if left blank
    if (!g.release.raw && (g.release.precision === 'month' || g.release.precision === 'quarter' || g.release.precision === 'year' || g.release.precision === 'tbd')) {
      g.release.raw = releaseLabel(g.release);
    }
    onSave(g);
  };

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h"><h3>{isNew ? 'Add game' : 'Edit game'}</h3>
          <button className="x" onClick={onClose}>×</button></div>
        <div className="modal-b">
          <div className="field"><label>Title</label>
            <input value={f.title} onChange={(e) => set({ title: e.target.value })} autoFocus /></div>

          <div className="row">
            <div className="field"><label>Type</label>
              <select value={f.kind} onChange={(e) => set({ kind: e.target.value })}>
                <option value="game">Game</option><option value="replay">Replay</option>
                <option value="dlc">DLC / Chapter</option><option value="event">Event</option>
              </select></div>
            <div className="field"><label>Date precision</label>
              <select value={r.precision} onChange={(e) => setR({ precision: e.target.value })}>
                <option value="day">Exact day</option><option value="month">Month</option>
                <option value="quarter">Quarter / season</option><option value="year">Year only</option>
                <option value="tbd">TBD / no date</option>
              </select></div>
          </div>

          <div className="row">
            <div className="field"><label>Year</label>
              <input type="number" value={r.year || ''} onChange={(e) => setR({ year: Number(e.target.value) })} /></div>
            <div className="field"><label>Month (1–12)</label>
              <input type="number" min="1" max="12" value={r.month || ''} disabled={r.precision === 'year' || r.precision === 'tbd'}
                onChange={(e) => setR({ month: Number(e.target.value) })} /></div>
            <div className="field"><label>Day</label>
              <input type="number" min="1" max="31" value={r.day || ''} disabled={r.precision !== 'day'}
                onChange={(e) => setR({ day: Number(e.target.value) })} /></div>
          </div>
          <div className="field"><label>Date label (optional override)</label>
            <input value={r.raw || ''} placeholder={releaseLabel({ ...r, raw: '' })}
              onChange={(e) => setR({ raw: e.target.value })} />
            <span className="hint">Shown as-is, e.g. "Holiday 2026" or "Spring 2027". Year-only & TBD go to the Unscheduled rail.</span></div>

          {f.kind === 'event' && (
            <div className="row">
              <div className="field"><label>Event end — year</label>
                <input type="number" value={(f.eventEnd && f.eventEnd.year) || ''} onChange={(e) => set({ eventEnd: { ...(f.eventEnd || { precision: 'day' }), year: Number(e.target.value) } })} /></div>
              <div className="field"><label>Month</label>
                <input type="number" value={(f.eventEnd && f.eventEnd.month) || ''} onChange={(e) => set({ eventEnd: { ...(f.eventEnd || { precision: 'day' }), month: Number(e.target.value), precision: 'day' } })} /></div>
              <div className="field"><label>Day</label>
                <input type="number" value={(f.eventEnd && f.eventEnd.day) || ''} onChange={(e) => set({ eventEnd: { ...(f.eventEnd || { precision: 'day' }), day: Number(e.target.value), precision: 'day' } })} /></div>
            </div>
          )}

          {f.kind !== 'event' && (
            <div className="row">
              <div className="field"><label>HowLongToBeat (hours)</label>
                <input type="number" value={f.hltbHours} onChange={(e) => set({ hltbHours: e.target.value })} /></div>
              <div className="field"><label>HLTB basis</label>
                <select value={f.hltbBasis} onChange={(e) => set({ hltbBasis: e.target.value })}>
                  <option value="self">Own playthrough</option><option value="remake-original">Original game</option>
                  <option value="series-avg">Series average</option><option value="estimate">Estimate</option>
                </select></div>
            </div>
          )}
          {f.kind !== 'event' && (
            <div className="field"><label>HLTB note</label>
              <input value={f.hltbNote || ''} onChange={(e) => set({ hltbNote: e.target.value })} /></div>
          )}

          <div className="field"><label>Platforms (comma-separated)</label>
            <input value={f._platforms !== undefined ? f._platforms : (f.platforms || []).join(', ')}
              onChange={(e) => set({ _platforms: e.target.value })} /></div>

          <div className="field"><label>Editions</label>
            <div className="ed-list">
              {(f.editions || []).map((e, i) => (
                <div className="ed-row" key={i}>
                  <input className="nm" placeholder="Edition name" value={e.name}
                    onChange={(ev) => { const ed = f.editions.slice(); ed[i] = { ...ed[i], name: ev.target.value }; set({ editions: ed }); }} />
                  <input className="pr" type="number" placeholder="USD" value={e.msrpUSD}
                    onChange={(ev) => { const ed = f.editions.slice(); ed[i] = { ...ed[i], msrpUSD: ev.target.value }; set({ editions: ed }); }} />
                  <button className="btn btn-sm" onClick={() => set({ editions: f.editions.filter((_, j) => j !== i) })}>✕</button>
                </div>
              ))}
              <button className="btn btn-sm" onClick={() => set({ editions: [...(f.editions || []), { name: '', msrpUSD: '' }] })}>+ edition</button>
            </div></div>

          <div className="field"><label>Early access / pre-order bonus</label>
            <input value={f.earlyAccess || ''} onChange={(e) => set({ earlyAccess: e.target.value })} /></div>
          <div className="field"><label>Notes</label>
            <textarea rows="2" value={f.notes || ''} onChange={(e) => set({ notes: e.target.value })} /></div>
        </div>
        <div className="modal-f">
          {!isNew && <button className="btn" style={{ marginRight: 'auto', color: 'var(--danger)' }}
            onClick={() => onDelete(f.id)}>Delete</button>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-accent" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}
function blankGame() {
  return { id: uid(), title: '', kind: 'game',
    release: { year: new Date().getUTCFullYear(), month: new Date().getUTCMonth() + 1, day: 1, precision: 'day', raw: '' },
    hltbHours: 20, hltbBasis: 'estimate', hltbNote: '', platforms: [], editions: [], earlyAccess: '', notes: '' };
}
function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

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
  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal detail" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h"><h3>Stream pace</h3><button className="x" onClick={onClose}>×</button></div>
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
        </div>
        <div className="modal-f"><button className="btn btn-accent" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}
