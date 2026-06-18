# Stream Slate — Claude Guidelines

This file is loaded automatically by Claude Code. It captures the conventions, data model,
and pitfalls for this project. **Keep it current** when the structure or data format changes.

---

## Project Overview

**Stream Slate** is a single-page React 18 calendar of upcoming games to stream, with an
estimate of how long each takes to *finish on stream* — both as a number of streams and a
real-world window — paced to @nabunan's actual rolling 90-day Twitch cadence.

No build tools: in-browser Babel transpilation via CDN. Cloudflare Worker + KV backend.

- **Live:** https://slate.nabunan.com (also game-stream-calendar.applelators.workers.dev)
- **GitHub:** applelators/game-stream-calendar (public)
- **Account:** Cloudflare `applelators`; nabunan.com zone (see global cloudflare-hosting memory)

---

## Architecture / no-build pipeline

`public/index.html` loads React + ReactDOM + Babel from CDN, then **fetches `calc.js` and
`app.jsx`, concatenates them (calc first), Babel-transforms the combined source once, and
`eval`s it**, then renders `App`.

This concatenation is load-bearing:
- `calc.js` and `app.jsx` share one eval scope, so `app.jsx` calls calc helpers directly
  (no module system, no imports in browser code).
- In indirect `eval`, **only `function` declarations become global** (reachable after eval).
  `App` MUST stay a `function App() {}` declaration so `index.html` can render it.
- `const`/`let` (e.g. `SEED_GAMES`, `MONTHS`, `KIND_COLOR`) are NOT global — they work
  because every component/ helper is defined in the same eval and closes over them. Don't
  try to reference these from outside the eval.

## File layout

```
public/        # static assets — SERVED to the browser
  index.html   # CDN React/Babel loader (fetch+concat+transform calc.js & app.jsx)
  games.json   # THE SLATE — source of truth for the game list (edit this!)
  app.jsx      # all components (views, detail card, settings) — no game CRUD
  calc.js      # pure date-precision + pace math + games.json parser (NO React)
  styles.css   # dark theme, CSS variables, Space Grotesk + DM Sans
_worker.js     # API routes + scheduled() weekly pace refresh — NOT served
pace.js        # 90-day SullyGnome fetch + pace compute — NOT served (imported by _worker.js)
wrangler.toml  # KV binding, [assets] directory="public", custom domain, weekly cron
```

**`[assets] directory` MUST be `"public"`, never `"."`.** Root-as-assets makes `wrangler dev`
loop forever (its `.wrangler/` writes retrigger the file watcher) and exposes `_worker.js` /
`pace.js` as public assets.

---

## Data model (a game)

```js
{
  id, title,
  release: { year, month?(1-12), day?(1-31), quarter?(1-4),
             precision: 'day'|'month'|'quarter'|'year'|'tbd', raw? },
  eventEnd: {…release…},        // only for kind:'event' (fixed window)
  kind: 'game'|'replay'|'dlc'|'event',
  hltbHours: number,
  hltbBasis: 'self'|'remake-original'|'series-avg'|'estimate',   // provenance
  hltbNote, platforms:[], editions:[{name, msrpUSD}], earlyAccess, notes
}
```

- **Placement (calc `isPlaceable`):** `day`/`month`/`quarter` get a timeline bar;
  `year`/`tbd` go to the **Unscheduled rail**. `month`/`quarter` render as hatched (fuzzy).
- **kinds:** `event` uses its explicit `release→eventEnd` window (no pace math); everything
  else derives bar length from `hltbHours` via the current pace.

### The slate lives in `public/games.json` (source of truth)

The app fetches `games.json` on load and builds games via `gamesFromFile`/`parseDate`
(calc.js). **There is no in-app game editing** — edit the file and push (auto-deploys).
Only **settings** (vacations, pace override, view) persist to KV via `/api/state`.

File entry (friendly format):
```json
{ "title": "Star Fox (Switch 2)", "date": "2026-06-25", "kind": "game",
  "hltbHours": 6, "basis": "remake-original", "hltbNote": "...",
  "platforms": ["Switch 2"], "editions": [{ "name": "Standard", "price": 69.99 }],
  "earlyAccess": "...", "notes": "..." }
```
- **`date`** string → precision: `YYYY-MM-DD` day · `YYYY-MM` month · `YYYY-Qn` /
  `Holiday 2026` / `Spring 2027` quarter · `YYYY` year (rail) · `TBD`/`TBA …` rail. Also
  accepts `August 2026`, `Nov 2027`, `Jun 9, 2026`. **`dateLabel`** optionally overrides the
  displayed text. **`endDate`** (same formats) sets an `event`'s window end.
- `basis` → `hltbBasis`; edition `price` → `msrpUSD`. `id` is the title slug (auto).
- `games.json` may be a bare array or `{ "_README": "...", "games": [...] }`.

### Scheduling (calc `schedule(games, pace, mode, normVacs)`)

Positions are `{ start, end, segments:[{start,end}] }` — multiple segments only for a
split game in the queue.
- **`parallel`** ("True dates"): each game sits on its real release date; one segment.
- **`sequential`** ("My queue"): a **preemptive** day-by-day simulation. New releases take
  priority — on a game's release day you drop the current game and start the new one; the
  interrupted game resumes (LIFO) once the newer one finishes, so a long game splits into
  several segments (rendered as separate bars joined by dotted `.bar-link` connectors).
  Played time is conserved; `event`s stay at their fixed window and don't join the queue.
- **Vacations** (`settings.vacations`, ISO date ranges): `normalizeVacations` →
  `addActiveDays`/`gameEnd` skip vacation days so breaks push finish dates later. Managed in
  ⚙ Settings → "Time off"; shown hatched on the calendar (`.vac`) and timeline (`.tl-vac`).
- **Finish-before deadlines** (`finishBefore` field in games.json — a target game id/slug, a
  month/quarter `"2026-06"`, or a date): `finishBeforeDeadline` resolves an exclusive deadline
  (referenced game's release, or `periodEndExclusive` of a date/month/quarter so "2026-06" =
  end of June). `finishBeforeDays` packs only the **month/quarter** (no-set-day) members
  back-to-back before the deadline (dated games keep their date); merged into placement (wins
  over `autoPlace`). The Month grid renders a `DeadlineBracket` per group (in the deadline's
  month) with member chips + a **feasibility note**: it compares the group's remaining hours to
  available non-vacation weeks × current h/week and, when short, suggests the optimal cadence
  (h/wk + streams/wk); else shows ✓ on-track. The deadline day also gets a ⚑ flag.
- **Bonus games** (`bonus: true` in games.json): optional "if there's time" extras. Excluded
  from the committed sequential schedule everywhere (Month grid bands, `seqPositions`, timeline
  queue) so they never push priorities. The Month grid lists them per month in a `BonusStrip`
  (★ Bonus · if time allows) with a slack note from `bonusNoteFor(dbrackets)` — over-capacity →
  warn, else "≈Nh slack". The timeline shows them as faded true-date bars (`.bar.bonus`).
- **Auto-placed month games** (`settings.autoPlace`, array of game ids): a month/quarter
  ("no set day") game the user clicked its **"Planned this month"** chip for. `autoPlaceDays`
  spreads all placed games in a month evenly across that month's OPEN days (excluding
  specific-day releases, their launch eves, and vacations) and `withAutoPlacement` re-anchors
  each to its computed day (`precision:'day'`, tagged `placedDay`/`plannedLabel`/`plannedMonthKey`)
  so the queue plays it in its month instead of burying it. Recomputed from the set + fixed
  dates, so days re-balance as placements change. Persists in KV settings; `games.json` stays
  the source of truth. App passes `withAutoPlacement(games, autoMap)` (`effGames`) to all views.

---

## Pace pipeline

`pace.js` reads @nabunan's last-90-days streams from SullyGnome's public table API
(channel id **41050006**) and sums each stream's `length` (minutes):
- `hoursPerStream = totalHours / numStreams`, `hoursPerWeek = totalHours / (90/7)`.
- Unreachable source → `FALLBACK_PACE` snapshot (currently 5.11 h/stream, 11.52 h/week).
- Source is isolated in `pace.js` so it can be swapped (e.g. Twitch Helix) without touching
  the app. Channel overridable via `SULLYGNOME_CHANNEL_ID` / `TWITCH_CHANNEL` env vars.

Refresh paths: weekly **cron** `0 12 * * 1` → `scheduled()` → writes pace to KV; on-demand
`POST /api/refresh-pace`; `GET /api/pace` reads cache (falls back if cold). The ⚙ Pace panel
shows the live value + a manual override that wins when enabled.

**Formulas (calc.js):** `streamsToFinish = ceil(hltbHours / hoursPerStream)`;
`weeksToFinish = hltbHours / hoursPerWeek`; bar length = days of `weeksToFinish`.

---

## API (`_worker.js`)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/state` | GET / PUT | read / overwrite the `{games, settings}` doc in KV |
| `/api/pace` | GET | cached 90-day pace (`+ fetchedAt`); fallback if cold |
| `/api/refresh-pace` | POST | refetch pace now, store, return it |
| `/api/streams` | GET | cached recent completed streams `{ streams:[{date,minutes,games:[{name,art}]}], fetchedAt }` (SullyGnome `gamesplayed` + box art); fetches once if cold |
| `/api/refresh-streams` | POST | refetch stream history now, store, return it |
| (scheduled) | cron | weekly pace **and** stream-history refresh into KV |

**Already-streamed overlay:** the Month grid fetches `/api/streams` and, for any past day
you actually streamed, shows the real game(s) with a ✓ and Twitch box art (`streamedByDay`,
prioritised in `dayInfo` over the plan/vacation). `fetchStreams` (pace.js) normalises the
SullyGnome streams table; box-art URLs are rewritten to a small size.

---

## Running locally

```bash
npx wrangler dev --local --test-scheduled     # http://127.0.0.1:8787
curl "http://127.0.0.1:8787/__scheduled?cron=0+12+*+*+1"   # fire the cron manually
```
Opening `public/index.html` as a `file://` URL fails (it fetches `.jsx`); always serve it.

## Deploy

**Auto-deploys via Cloudflare Workers Builds**: pushing to `main` triggers Cloudflare to run
`npx wrangler deploy` (Git integration configured in the dashboard — no CI file in-repo, same
pattern as pokemon-pack-tracker). So normal workflow is just commit + push to main.

Manual deploy (first-time, or to ship without a push):
```bash
npm run deploy           # = wrangler deploy; provisions slate.nabunan.com + registers the cron
```

---

## Conventions

- No build step; keep it that way. Match the dark CSS-variable theme + font pairing.
- KV namespace id and the custom-domain route live in `wrangler.toml` (not secrets — fine to
  commit). Never commit `.dev.vars` (gitignored).
- Commits: end messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Seed data is researched to a point in time; prices/dates are often pre-launch estimates —
  prefer editing in-app (persists to KV) over editing `SEED_GAMES` unless changing defaults.
