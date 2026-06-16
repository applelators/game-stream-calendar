# Stream Slate — Game Release & Stream-Schedule Calendar

**Live:** https://slate.nabunan.com · auto-deploys from `main` via Cloudflare Workers Builds.

A calendar of upcoming games to stream, with an estimate of how long each will take
to **finish on stream** — both as a number of streams and a real-world window — based
on @nabunan's actual rolling 90-day Twitch pace.

- **Timeline (Gantt):** every game a bar from its release date; length = HLTB hours ÷ pace.
  Toggle **True dates** (bars on real release dates) vs **My queue** (chained back-to-back
  so you see the realistic backlog).
- **Month grid:** release pills on day cells + tinted play-windows.
- **Slate in a file:** the whole game list lives in [`public/games.json`](public/games.json) —
  edit it and push (auto-deploys) to update the calendar. Settings (vacations, pace override)
  persist per-device in Cloudflare KV.
- **Auto pace:** a weekly cron refetches the last-90-days stream stats and recomputes
  `hours/stream` and `hours/week`. Manual "refresh now" + override available in ⚙ Pace.

No build step — React 18 + Babel run from CDN; `public/calc.js` + `public/app.jsx` are
fetched, concatenated, and transformed in the browser.

## Layout

```
public/        # static assets (served)
  index.html   # CDN React/Babel loader
  app.jsx      # UI: seed data, both views, CRUD, settings
  calc.js      # pure date-precision + pace math
  styles.css   # dark theme
_worker.js     # API routes + scheduled() weekly pace refresh (NOT served)
pace.js        # 90-day SullyGnome fetch + pace compute (NOT served)
wrangler.toml  # KV binding, assets dir, weekly cron
```

## Run locally

```bash
npx wrangler dev --local --test-scheduled
# open http://127.0.0.1:8787
# trigger the weekly cron manually:
curl "http://127.0.0.1:8787/__scheduled?cron=0+12+*+*+1"
```

## Deploy (Cloudflare, applelators account)

1. Create the KV namespace and paste its id into `wrangler.toml`:
   ```bash
   npx wrangler kv namespace create CALENDAR_KV
   ```
2. `npx wrangler deploy` — the weekly cron (`0 12 * * 1`, Mondays) is registered automatically.

## Pace source

`pace.js` reads @nabunan's last-90-days streams from SullyGnome's public table API
(channel id `41050006`) and sums each stream's length. If the source is unreachable it
falls back to the last snapshot (5.11 h/stream, 11.52 h/week). The source is isolated in
`pace.js` so it can be swapped without touching the app. Override the channel via the
`SULLYGNOME_CHANNEL_ID` / `TWITCH_CHANNEL` env vars in `wrangler.toml`.

## Editing the slate (`public/games.json`)

Each game is one entry. The `date` field is a single friendly string:

| `date` value | meaning |
|---|---|
| `"2026-06-25"` | exact day |
| `"2026-08"` | month |
| `"2026-Q3"`, `"Holiday 2026"`, `"Spring 2027"` | quarter / season |
| `"2026"` | year only → Unscheduled rail |
| `"TBD"` / `"TBA (late 2026?)"` | no date → rail |

Also accepts `"August 2026"`, `"Nov 2027"`, `"Jun 9, 2026"`. Optional `dateLabel` overrides the
displayed text; `endDate` (same formats) sets an `event`'s window. `basis` is how the hours
estimate was derived: `self` (your own replay), `remake-original`, `series-avg`, or `estimate`.

Edit the file, commit, and push — Workers Builds redeploys and the calendar updates everywhere.
Games are researched to a point in time; many pre-launch dates/prices are estimates.
