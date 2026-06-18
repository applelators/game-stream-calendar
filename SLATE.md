# Editing the slate — `public/games.json`

The whole game list lives in **`public/games.json`**. Edit it, commit, and push — Workers
Builds redeploys (~30–60s) and the calendar updates everywhere. No app rebuild, no in-app
editing.

Edit fastest in the browser: **github.com/applelators/game-stream-calendar → `public/games.json` → ✏️ → Commit.**

## Shape

```json
{
  "_README": "…",
  "games": [
    {
      "title": "Star Fox (Switch 2)",
      "date": "2026-06-25",
      "kind": "game",
      "hltbHours": 6,
      "basis": "remake-original",
      "hltbNote": "Based on Star Fox 64 main (~5h).",
      "platforms": ["Switch 2"],
      "editions": [{ "name": "Standard", "price": 69.99 }],
      "earlyAccess": "Free demo available.",
      "notes": "Remake of Star Fox 64."
    }
  ]
}
```

A bare top-level array (no `_README`/`games` wrapper) also works.

## `date` — one friendly string

| Value | Meaning | Shows as |
|---|---|---|
| `"2026-06-25"` | exact day | bar on that day |
| `"2026-08"` | whole month | hatched (fuzzy) bar at month start |
| `"2026-Q3"` | quarter | hatched bar at quarter start |
| `"Holiday 2026"`, `"Spring 2027"` | season → quarter | hatched bar (label shown) |
| `"2026"` | year only | **Unscheduled rail** |
| `"TBD"`, `"TBA (late 2026?)"` | no date | **Unscheduled rail** |

Also accepts `"August 2026"`, `"Nov 2027"`, `"Jun 9, 2026"`. Anything unrecognized → rail.

- **`dateLabel`** *(optional)* — override the displayed text, e.g. `"date": "2026", "dateLabel": "2026 (date TBA)"`.
- **`endDate`** *(events only, same formats)* — the end of the event window.

## Fields

| Field | Notes |
|---|---|
| `title` | required; its slug becomes the id |
| `kind` | `game` · `dlc` · `event` (events use `date`→`endDate`, no pace math) |
| `backlog` | `true` for catalog games scheduled at a *planned start* (not a new release). Backlog games never get a midnight-launch eve. Omit/false for genuine new releases. |
| `bonus` | `true` = an optional "if there's time" game. Excluded from the committed schedule (never pushes/delays your prioritized games); listed in a **★ Bonus · if time allows** strip for its month (with a slack note). If its month has **genuine free days** (the committed plan + vacations don't use them), it auto-fills them as **faded ★ bands**; a packed month shows none. Also shown faded on the timeline. |
| `hltbHours` | hours to beat; drives bar length & "streams to finish" |
| `basis` | how `hltbHours` was derived: `self` · `remake-original` · `series-avg` · `estimate` |
| `hltbNote` | short provenance note (shown in detail card) |
| `platforms` | array of strings |
| `editions` | array of `{ "name", "price" }` (USD); first one is the headline price |
| `earlyAccess` | pre-order / early-access bonus text |
| `notes` | free text shown in the detail card |
| `icon` | optional visual: an **emoji** (`"🦑"`) or an **image URL/path** (`"https://…/art.jpg"` or `"/art/splat3.png"`). Defaults to a colour-coded **monogram** badge from the title. |

## Midnight launches

Any **new release with a specific day, dated June 2026 or later**, automatically reserves the
**night before** as a midnight-launch stream — no other game is scheduled that eve, and the new
game starts on its release day. This is skipped for `backlog` games, month/year/TBD dates, and
anything before June 2026.

## Common edits

- **Add a game** — append an object to `games`.
- **Remove a game** — delete its object.
- **Move a date** — change `date`.
- **An event (fixed window)** — `"kind": "event"`, `"date": "2026-06-09"`, `"endDate": "2026-08-30"`.

## Auto-picking a start day for month/quarter games

A game with only a month or quarter window (no set day) shows as a dashed **"Planned this
month"** chip at the top of that month in the **Month grid**. Click it and the app picks the
best **start day inside that month** — spreading all the placed no-set-day games evenly across
the month's open days (skipping specific-day releases, their launch eves, and vacations) — and
the game gets a real play band from that day. Place more games in the same month and the days
re-balance automatically. Click a placed (✓) chip again to unset it. These placements live in
⚙ Settings (KV), not the file — `games.json` stays the source of truth for the dates.

## Finish a series before the next entry drops

Add **`finishBefore`** to a game to set a deadline. The value can be:
- another game's **id/slug** (`"finishBefore": "splatoon-raiders"`) → finish **before that
  game's release**; or
- a **month** (`"2026-06"`) → finish **by the end of that month**; a quarter (`"2026-Q3"`);
  or a specific **date** (`"2026-07-23"`).

Games that share a deadline appear under a `⤿ finish before / by …` **bracket** on the Month
grid. Month/quarter games (no set day) sharing a deadline are auto-placed and **packed
back-to-back, in file order**, into the open days before it. Games that already have a real
date keep it (a deadline never moves a dated release).

**Feasibility note:** under each bracket, the app checks whether your current pace (last-90-day
h/week) can finish the group's remaining hours before the deadline. If not, it surfaces a
warning with the **optimal cadence** needed (e.g. *"aim for ~32.5h/wk (≈6 streams/wk)"*);
otherwise it shows ✓ on-track. The deadline day gets a ⚑ flag; a game-id deadline auto-follows
the target's date. Tip: list the grouped games in the order you want to play them.

## What stays in the app (not the file)

**Vacations**, **pace override**, and **auto-placed start days** live in ⚙ Settings and persist per-device in Cloudflare KV.
Stream **pace** auto-refreshes weekly from Twitch (`@nabunan`, last 90 days).
