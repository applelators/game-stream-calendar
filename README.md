# Stream Slate — Game Release & Stream-Schedule Calendar

**Live:** https://slate.nabunan.com · auto-deploys from `main` via Cloudflare Workers Builds.

A calendar of upcoming games to stream, with an estimate of how long each will take
to **finish on stream** — both as a number of streams and a real-world window — based
on @nabunan's actual rolling 90-day Twitch pace.

- **Timeline (Gantt):** every game a bar from its release date; length = HLTB hours ÷ pace.
  Toggle **True dates** (bars on real release dates) vs **My queue** (chained back-to-back
  so you see the realistic backlog).
- **Month grid:** release pills on day cells + tinted play-windows.
- **Editable + saved:** add/edit/remove games and override pace; persisted in Cloudflare KV
  (with a localStorage mirror) so it survives across devices.
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

## Data notes

Seed games are researched from announcements current to June 2026 and are fully editable.
`hltbBasis` records how each hours estimate was derived: `self` (your own replay),
`remake-original` (the original game's HLTB), `series-avg` (average of prior entries), or
`estimate`. Many pre-launch prices are estimates — edit them as details firm up.
