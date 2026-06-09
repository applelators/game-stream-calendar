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
  app.jsx      # SEED_GAMES + all components (views, CRUD modal, settings)
  calc.js      # pure date-precision + pace math (NO React)
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
- Editing in-app persists the whole `{games, settings}` doc to KV (`/api/state`) + a
  localStorage mirror. `SEED_GAMES` in `app.jsx` is only the first-load default.

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
| (scheduled) | cron | weekly pace refresh into KV |

---

## Running locally

```bash
npx wrangler dev --local --test-scheduled     # http://127.0.0.1:8787
curl "http://127.0.0.1:8787/__scheduled?cron=0+12+*+*+1"   # fire the cron manually
```
Opening `public/index.html` as a `file://` URL fails (it fetches `.jsx`); always serve it.

## Deploy

```bash
npx wrangler deploy      # provisions slate.nabunan.com + registers the cron
```
**Deploy is manual** — pushing to GitHub does NOT auto-deploy this repo (unlike
pokemon-pack-tracker). Git is version control; `wrangler deploy` is what ships.

---

## Conventions

- No build step; keep it that way. Match the dark CSS-variable theme + font pairing.
- KV namespace id and the custom-domain route live in `wrangler.toml` (not secrets — fine to
  commit). Never commit `.dev.vars` (gitignored).
- Commits: end messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Seed data is researched to a point in time; prices/dates are often pre-launch estimates —
  prefer editing in-app (persists to KV) over editing `SEED_GAMES` unless changing defaults.
