# CLAUDE.md — Stream Slate design language

> Paste this block into the repo-root `CLAUDE.md` (or merge with the existing one).
> It's the short, always-loaded version. Full detail lives in `docs/redesign/HANDOFF.md`,
> and the reference implementation is `docs/redesign/Stream Slate Cockpit.html`.

## Design language (apply to all UI work)

Stream Slate uses a refreshed dark design language. When building or changing UI, follow it:

- **Type:** Space Grotesk (display, headings, numbers), DM Sans (body), JetBrains Mono
  (labels, dates, metrics). Keep mono for anything numeric or "system".
- **Color:** dark surfaces `#0a0d14` bg → `#10141d` / `#141a26` / `#0d1320` panels; hairlines
  `#1b2433` / `#283245`; text `#e8edf5`, muted `#8b97ab`, faint `#5c6678`. Accent is themeable
  via `--acc` (default `#a970ff`) + `--acc-ink` (`#160a2b`). Semantic: ok `#34d399`,
  warn `#f5b14c`, danger `#f87171`. **Use each game's `iconColor` for its own bands/rings/dots**,
  not the global accent.
- **Shape/depth:** radius 10–18px; soft dark shadows (`0 2px 8px #0008`); colored glow only in
  "Bold" mode.
- **Art-forward:** cover art full-bleeds days/cells/cards with a bottom gradient + overlaid
  title — never a tiny inset thumbnail.
- **Calm hierarchy:** one quiet default state; red/amber only for real problems; never stack
  competing colored alert strips. **Do not use** left-accent-stripe callout boxes
  (`border-left: 3px solid …`) — retired.
- **Layout:** flex/grid + `gap` only; fluid `clamp()` padding; breakpoints 920/700/640/560;
  responsive to 1440p, 1300×740, and iPhone.
- **Motion:** one subtle fade-up on view change; slow glow pulse for live/Bold accents only.
- **Persist UI prefs** (theme, today's pick, queue order) the same way settings already persist.

## Reusable patterns
instrument tile · cover-art cell · progress ring (conic-gradient) · pace gauge (bar + capacity
marker) · option tile (`.sel` accent ring vs `.rec` green ring) · detail modal · run-of-show modal.
Match the markup/classes in the reference HTML.

## Build order (highest value first)
1. Deadlines/catch-up **pace gauges** + **health instrument panel** — visualize the feasibility
   math already in `calc.js` / `SLATE.md`.
2. Art-forward **month grid** + **weekly strip**.
3. **What-if queue** (drag-reorder, finish dates re-chain at the live pace).
4. Detail/run-of-show modals, Browse, Season, Share (PNG + .ics), themes, live mode.

Reuse existing math — `streamsToFinish`, `weeksToFinish`, `anchorDate`, `releaseLabel`,
`isPlaceable`, `schedule`. The new UI is presentational over these. Keep changes incremental and
committed per feature so Workers Builds redeploys cleanly.
