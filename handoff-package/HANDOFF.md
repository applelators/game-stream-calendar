# Stream Slate — Redesign Hand-off

This maps the concept in **`Stream Slate Cockpit.html`** onto the live app
(`game-stream-calendar`) and tells Claude Code how to build in the new design language.

The concept is **one self-contained React file** (React + Babel via CDN, data inlined from
`games.json`). It's a *design target*, not a drop-in — the real pace/scheduling math stays in
your `public/calc.js`; progress %, "streamed" days, the live state, and the finished banner are
plausible **samples** to be wired to real data.

---

## 1. The design language (read this first)

The system is an evolution of your existing dark theme — same bones, sharper hierarchy.

**Type** — unchanged: `Space Grotesk` (display/headings/numbers), `DM Sans` (body),
`JetBrains Mono` (labels, dates, metrics). Keep mono for anything numeric or "system".

**Color** — your `:root` tokens still apply. The concept uses a few extra surface shades and a
themeable accent:
- Background `#0a0d14`; surfaces `#10141d` / `#141a26` / `#0d1320`; hairlines `#1b2433` / `#283245`.
- Text `#e8edf5`, muted `#8b97ab`, faint `#5c6678`.
- Accent is a **CSS variable** `--acc` (default `#a970ff`) with `--acc-ink` (`#160a2b`) for text on
  accent. Theme presets just swap those two on a root wrapper.
- Semantic: good `#34d399`, warn `#f5b14c`, danger `#f87171`, replay-blue `#3b6fe0`.
- **Per-game color** comes from `games.json` `iconColor` — used for bands, rings, glows, dots.
  Always prefer the game's own color over the accent for game-specific UI.

**Shape & depth** — radius 10–18px (tiles 13–14, panels 18, modals 18–20). Shadows are soft and
dark (`0 2px 8px #0008`), never colored except an optional `--acc` glow in **Bold** mode.

**Layout** — max width ~1480px; fluid padding `clamp(14px,2.2vw,30px)`; grids use
`repeat(N,1fr)` collapsing to fewer columns via the breakpoints `920 / 700 / 640 / 560`.
Everything uses flex/grid + `gap`, never margin-hacked inline rows.

**Two big principles:**
1. **Art-forward.** Cover art is the hero of any day/cell/card — full-bleed with a bottom gradient
   and overlaid title, not a tiny inset thumbnail.
2. **Calm hierarchy.** One quiet default state; loud (red/amber) is reserved for genuine problems.
   Don't stack competing colored alert strips.

**Retire:** the left-accent-stripe bar (`border-left: 3px solid …` callout boxes). Replaced by
clean cards with internal state cues.

**Motion** — one subtle `fadeUp` on view change; a slow glow pulse for live/Bold accents. Nothing
bouncy.

### Component inventory (new vocabulary)
| Pattern | What it is |
|---|---|
| **Instrument tile** | label (mono caps) · big value · sub. Used in the cockpit health row. |
| **Cover-art cell** | art bg + `linear-gradient(180deg,#0a0d1420 28%,#0a0d14e8)` + title/badges on top. Calendar, month, week. |
| **Progress ring** | `conic-gradient(tone deg, rgba(255,255,255,.08))` with a dark inner disc showing %. |
| **Pace gauge** | thin bar with a capacity marker line at 60%; fill = `needed/11.52*60`, colored green/amber/red. |
| **Option tile** | art + name + pace-impact tag; `.sel` (accent ring) vs `.rec` (green ring). The "Tonight" picker. |
| **Detail modal** | art hero → cover → kind → stats → lines → pace note → goal/notes. |
| **Run-of-show modal** | a day's agenda (pre-show → game → goal → wrap / launch / streamed / rest). |
| **Theme swatches** | 4 dots that set `--acc`/`--acc-ink`. |

---

## 2. Feature → repo port map

All UI lands in **`public/app.jsx`**; styles in **`public/styles.css`**; data shape changes in
**`public/games.json`**; math reuses **`public/calc.js`**.

| Concept feature | Where it goes | Notes / data it needs |
|---|---|---|
| **Now/Next hero + live countdown** | new components in `app.jsx`, above the view switch | countdown ticks to the next specific-day release ≥ today (you already compute `anchorDate`). |
| **Progress rings** ("stream X of Y / %") | hero + week + queue | needs **real progress** — add a `streamsDone` per in-progress game (KV/settings) or derive from your Twitch history overlay (`/api/streams`). |
| **Calmer month grid** (art cells) | replace the `.gc-*` month render in `app.jsx` | reuse existing schedule output; restyle cells, demote warning strips. |
| **Weekly strip** | new component; current Mon–Sun window | reuse the same per-day schedule you build for the month. |
| **Health instrument panel** | replace the `.hdr-sub` line | values: pace (from `/api/pace`), in-flight count, at-risk count (see below), next launch. |
| **Deadlines & catch-up gauges** | new panel + a line in the detail card | **already yours** — this is `SLATE.md`'s feasibility note made visual. Group by `finishBefore`, resolve deadline (id/month/quarter/date), `needed = remainingHours / weeksLeft`, compare to `pace.hoursPerWeek`. |
| **What-if queue (drag-reorder)** | new "Queue" view | chain `weeksToFinish(hours)` from today; flag against each game's `finishBefore`. Persist order in KV (settings), like vacations/placements. |
| **Detail popover** | one modal, opened from every game ref | pure presentation over an existing game object. |
| **Browse (search/filter)** | new view, or fold into your Releases appendix | client-side filter on the in-memory `games`. |
| **Season / Wrapped stats** | new view | aggregates over `games` (+ real totals from `/api/streams` if you want true "hours streamed"). |
| **Share cards + PNG + .ics** | new "Share" view | `html2canvas` for PNG; build an `.ics` string from upcoming dated releases. Could also be a Worker route that serves a live `.ics` feed for true subscribe. |
| **Live "on-air" mode** | hero variant | drive from a real signal — Twitch Helix `streams` endpoint (is `@nabunan` live?) via a Worker route, instead of a manual toggle. |
| **Theme presets** | `--acc` / `--acc-ink` on `:root`; persist in settings | convert the ~10 accent rules in `styles.css` to `var(--acc)`. |
| **Finished state** | celebration when a playthrough hits 100% | needs a real "done" signal — a `finished:true` in `games.json`, or completion inferred from history. |

### Suggested `games.json` additions
- `streamsDone` (number) — progress for in-progress titles (or compute from history).
- `finished` (bool) / `finishedDate` — drives the finished celebration + "recently wrapped".
- everything else (`iconColor`, `finishBefore`, `partGoal`, `binge`, `bonus`, `backlog`) already exists.

### Math you already have (reuse, don't reinvent)
`streamsToFinish(hours, pace)`, `weeksToFinish(hours, pace)`, `anchorDate`, `releaseLabel`,
`isPlaceable`, `schedule`. The gauges/queue are thin presentational wrappers over these.

---

## 3. What to tell Claude Code

Paste this as the brief:

> We're adopting a refreshed design language for Stream Slate (see `Stream Slate Cockpit.html` for
> the reference implementation). Work inside the existing stack: `public/app.jsx` (UI),
> `public/styles.css` (theme), `public/calc.js` (pace math — reuse it, don't duplicate),
> `public/games.json` (data). No build step; keep the CDN React + Babel setup.
>
> **Design language to follow:**
> - Type: Space Grotesk (display + numbers), DM Sans (body), JetBrains Mono (labels/dates/metrics).
> - Color: keep the dark `:root` tokens. Make the accent themeable — introduce `--acc` (default
>   `#a970ff`) and `--acc-ink` (`#160a2b`) and convert accent rules to `var(--acc)`. Use each game's
>   `iconColor` for game-specific bands/rings/dots, not the global accent.
> - Surfaces `#10141d`/`#141a26`/`#0d1320`, hairlines `#1b2433`/`#283245`; radius 10–18px; soft dark
>   shadows; accent glow only in "Bold" mode.
> - **Art-forward**: cover art full-bleeds day/cells/cards with a bottom gradient + overlaid title.
> - **Calm hierarchy**: one quiet default; red/amber only for real problems; never stack colored
>   alert strips. Retire the `border-left` accent-stripe callouts.
> - Reusable patterns to build as components: instrument tile, cover-art cell, progress ring
>   (conic-gradient), pace gauge (bar + capacity marker), option tile, detail modal, run-of-show
>   modal. Match the markup/classes in the reference file.
> - Layout: flex/grid + `gap` only; fluid `clamp()` padding; breakpoints 920/700/640/560; responsive
>   to 1440p, 1300×740, and iPhone.
> - Persist UI prefs (theme, today's pick, queue order) the way settings already persist (KV +
>   localStorage fallback).
>
> **Do first (highest value):** the deadlines/catch-up pace gauges and the health instrument panel —
> they visualize the feasibility math already in `calc.js`/`SLATE.md`. Then the art-forward month +
> weekly strip, then the what-if queue.
>
> Keep changes incremental and committed per feature so Cloudflare Workers Builds redeploys cleanly.

---

*Reference file:* `Stream Slate Cockpit.html` — open it, toggle **Refined ⇄ Bold**, switch themes,
and click into days/games to see every pattern in context.
