# Stream Slate — Redesign Hand-off Package

Drop this folder into your repo (suggested: `docs/redesign/`). Contents:

| File | What it is |
|---|---|
| **`Stream Slate Cockpit.html`** | The reference implementation. Open it in any browser. Toggle **Refined ⇄ Bold**, switch the 4 theme swatches, click days/games. Self-contained (CDN React + Babel, data inlined from `games.json`). |
| **`HANDOFF.md`** | Full hand-off: the design language, a feature-by-feature port map to `app.jsx` / `styles.css` / `games.json` / `calc.js`, and a paste-ready Claude Code brief. |
| **`CLAUDE.snippet.md`** | Short, always-loaded version of the design language. Paste into your repo-root `CLAUDE.md`. |
| **`screenshots/`** | Each pattern in context (see below). |

## Screenshot index
- `01-cockpit.png` — full cockpit: header, instrument panel, Tonight picker.
- `02-tonight-deadlines.png` — Tonight picker + Now Streaming rings.
- `03-deadlines-gauges.png` — Deadlines & catch-up pace gauges (needed h/wk vs capacity line).
- `04-week-strip.png` — weekly strip (art day-cards, today ringed).
- `05-month-grid.png` — calmer art-forward month grid.
- `06-detail-modal.png` — game detail modal with the pace note.
- `07-queue.png` — what-if queue with re-chained finish dates + late/in-time flags.
- `08-live-mode.png` — live "on-air" hero with uptime + finished banner.
- `09-season.png` — Season / Wrapped stats.
- `10-bold-mode.png` — Bold aesthetic variant.

> Note: cover-art images are blank in these screenshots because the capture sandbox blocks the
> art CDNs (dekudeals / steamgriddb). On your deployed site the art is same-origin and fills every
> cell/card/ring — that's the intended look.

## Two things to wire to real data
The concept layers over your real `games.json`, but a few states are **samples**:
- **Progress** (stream X of Y / ring %) — needs a real `streamsDone` (or derive from Twitch history).
- **Live mode** — drive from Twitch Helix `streams` (is @nabunan live?) instead of the manual toggle.
- **Finished celebration** — needs a real `finished` signal (a field, or inferred completion).

The pace/scheduling math itself stays in `calc.js` — the new UI just visualizes it.
