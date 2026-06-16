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
| `hltbHours` | hours to beat; drives bar length & "streams to finish" |
| `basis` | how `hltbHours` was derived: `self` · `remake-original` · `series-avg` · `estimate` |
| `hltbNote` | short provenance note (shown in detail card) |
| `platforms` | array of strings |
| `editions` | array of `{ "name", "price" }` (USD); first one is the headline price |
| `earlyAccess` | pre-order / early-access bonus text |
| `notes` | free text shown in the detail card |

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

## What stays in the app (not the file)

**Vacations** and **pace override** live in ⚙ Settings and persist per-device in Cloudflare KV.
Stream **pace** auto-refreshes weekly from Twitch (`@nabunan`, last 90 days).
