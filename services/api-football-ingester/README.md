# api-football-ingester

Ingester for the api-sports / api-football REST API v3. Polls `/fixtures?live=all` every 60s for football live matches and enriches each fixture with `/statistics`, `/events` (score-delta triggered), `/players` (HT + FT), `/lineups`, `/headtohead`, `/predictions`.

## What it writes

- **`events_v2`** — timer / score / period fields. Gated behind the `API_FOOTBALL_WRITE_ENABLED` feature flag so we can ship code dark and cut over per-field once parity vs FS is verified.
- **`live_data`** sub-keys, all suffixed `_af` to avoid colliding with FS-sourced data:
  - `lineups_af`
  - `statistics_af`
  - `events_af`
  - `players_af_ht`, `players_af_ft`
  - `predictions_af`
  - `h2h_af`

## Env vars

| name | purpose |
|------|---------|
| `API_SPORTS_KEY` | api-sports Pro plan API key (header `x-apisports-key`) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key for events_v2 / live_data writes |
| `API_FOOTBALL_WRITE_ENABLED` | `true`/`false` (default `false`) — gates writes to events_v2 timer/score/period |
| `SCRAPER_AUTH_KEY` | shared secret for POST `/api/admin/api-football/stats` cycle telemetry |

## Run

```bash
npx tsx src/scheduler.ts
```

## Deploy

systemd unit `api-football-ingester.service` on `scraper-vps` (mirrors `odds-api-ingester.service` / `flashscore-scraper.service` pattern).

## References

- Spec: `docs/superpowers/specs/2026-05-18-football-api-sports-integration-design.md`
- Plan: `docs/superpowers/plans/2026-05-18-football-api-sports-integration.md`
- Sibling pattern: `services/odds-api-ingester/`
