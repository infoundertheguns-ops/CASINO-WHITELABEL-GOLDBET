# Ippica Scraper — Design Spec

**Date**: 2026-03-21
**Status**: Approved

## Overview

HTTP-only scraper for horse racing data from MST Channel (Media System Technologies), the centralized provider used by BetFlag, GoldBet, Sisal, Eurobet, and most Italian ADM operators. Single TypeScript process with 3 polling loops, writing directly to Supabase via dedicated ippica tables.

## Data Source

**Provider**: MST Channel
**Base URL**: `https://fe-proxyhts-online-mst-int.mstchannel.com`
**Auth**: None (completely open API, no rate limits)
**Coverage**: ~74 meetings, 14 countries, ~200+ races/day

### API Endpoints

| Endpoint | Purpose | Loop |
|----------|---------|------|
| `GET /rest/program/channels` | Meeting/track discovery | program (30min) |
| `GET /rest/program/next` | Upcoming races list | program (30min) |
| `GET /rest/program/race/{id}` | Full race detail: runners, odds, results | odds (2min) |
| `GET /rest/program/last` | Recently completed races with results | results (1min) |

### Alternative Proxies (same data)

- `fe-proxyhts-gamenet-mst-int.mstchannel.com` (GoldBet/Lottomatica)
- `fe-proxyhts-sisal-mst-int.mstchannel.com` (Sisal)

## Architecture

### Project Structure

```
ippica-scraper/
├── src/
│   ├── index.ts              # Entry point, starts 3 loops
│   ├── mst-client.ts         # HTTP client for MST API
│   ├── transform.ts          # MST JSON → DB format
│   ├── supabase.ts           # Supabase client + upsert functions
│   ├── program-loop.ts       # Meeting/race discovery (30min)
│   ├── odds-loop.ts          # Odds/runners update (2min)
│   └── results-loop.ts       # Results + settlement (1min)
├── config.json
├── package.json
├── tsconfig.json
└── .env
```

### Data Flow

```
MST API                    Scraper                      Supabase
───────                    ───────                      ────────
/rest/program/channels  →  program-loop (30min)     →  ippica_meetings
/rest/program/next      →  program-loop             →  ippica_races (discover)
/rest/program/race/{id} →  odds-loop (2min)         →  ippica_runners + ippica_markets + ippica_odds
/rest/program/last      →  results-loop (1min)      →  ippica_races (status) + ippica_runners (position)
```

### Dependencies

- `@supabase/supabase-js` — direct DB access
- `tsx` — TypeScript execution (no build step)
- `typescript`, `@types/node` — dev

### Config

```json
{
  "baseUrl": "https://fe-proxyhts-online-mst-int.mstchannel.com",
  "fallbackUrls": [
    "https://fe-proxyhts-gamenet-mst-int.mstchannel.com",
    "https://fe-proxyhts-sisal-mst-int.mstchannel.com"
  ],
  "programIntervalMs": 1800000,
  "oddsIntervalMs": 120000,
  "resultsIntervalMs": 60000,
  "oddsConcurrency": 5,
  "oddsBatchDelay": 300,
  "oddsWindowHours": 3,
  "maxConsecutiveFailures": 5
}
```

## Database Schema

### Indexes

In addition to UNIQUE constraints (which create indexes), add explicit indexes for FK columns and common query patterns:

- `ippica_races(meeting_id)` — FK lookups
- `ippica_races(status, scheduled_at)` — composite for odds-loop bootstrap query
- `ippica_runners(race_id)` — FK lookups + CASCADE performance
- `ippica_markets(race_id)` — FK lookups + CASCADE performance
- `ippica_odds(market_id)` — FK lookups + CASCADE performance
- `ippica_odds(result)` — unsettled check query

### `ippica_meetings`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | auto |
| external_id | TEXT UNIQUE | `"mst:{mid}"` |
| name | TEXT NOT NULL | "Newbury", "FIRENZE" |
| country | TEXT NOT NULL | "United Kingdom", "Italy" |
| country_id | TEXT NOT NULL | "171", "112" |
| race_type | TEXT NOT NULL | "GL" (galoppo) / "TR" (trotto) |
| meeting_date | DATE NOT NULL | |
| race_count | INT | default 0 |
| status | TEXT | scheduled / active / completed |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

### `ippica_races`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | auto |
| external_id | TEXT UNIQUE | `"mst:{raceId}"` |
| meeting_id | UUID FK | → ippica_meetings |
| title | TEXT NOT NULL | race name |
| race_number | INT NOT NULL | |
| scheduled_at | TIMESTAMPTZ NOT NULL | |
| off_time | TIMESTAMPTZ | actual start |
| status | TEXT | scheduled / open / closed / running / finished / abandoned |
| race_class | TEXT | "1", "2", etc. |
| distance | DECIMAL(8,2) | stored in original units (no precision loss) |
| distance_units | TEXT | original units |
| track | TEXT | "Turf", "All Weather" |
| race_kind | TEXT | "Hurdle", "Flat", "Chase" |
| going | TEXT | "Good to Soft" |
| weather | TEXT | |
| handicap | BOOLEAN | default false |
| eligibility | TEXT | "4YO plus" |
| prize_amount | INT | in centesimi raw from MST |
| prize_currency | TEXT | "GBP", "EUR" |
| runners_count | INT | default 0 |
| source_data | JSONB | raw MST response |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

### `ippica_runners`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | auto |
| race_id | UUID FK | → ippica_races ON DELETE CASCADE |
| external_id | TEXT NOT NULL | `"mst:{runnerId}"` |
| name | TEXT NOT NULL | "Charisma Cat" |
| runner_number | INT NOT NULL | saddle number |
| drawn | TEXT | starting position |
| age | INT | |
| sex | TEXT | "m", "g", "f", "c", "h" |
| weight_text | TEXT | "11st 12lbs" |
| weight_value | INT | in lbs |
| jockey | TEXT | |
| trainer | TEXT | |
| trainer_location | TEXT | |
| owner | TEXT | |
| breeder | TEXT | |
| bred | TEXT | "GB", "IRE" |
| color | TEXT | "Bay", "Brown" |
| silk | TEXT | silk description |
| form | TEXT | "10-2212" |
| rating | INT | official rating |
| comment_it | TEXT | Italian comment from MST |
| breeding | JSONB | {sire, dam, damSire} |
| tackle | JSONB | [{type, count}] |
| is_non_runner | BOOLEAN | default false |
| finish_position | INT | 1, 2, 3... (after result) |
| disqualified | BOOLEAN | default false |
| disqualify_reason | TEXT | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |
| **UNIQUE** | (race_id, runner_number) | |

### `ippica_markets`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | auto |
| race_id | UUID FK | → ippica_races ON DELETE CASCADE |
| market_type | TEXT NOT NULL | "Winner", "Place (2)", "Head to head", "Even and odd" |
| market_label | TEXT NOT NULL DEFAULT '' | for H2H: "Horse A VS Horse B" |
| is_active | BOOLEAN | default true |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |
| **UNIQUE** | (race_id, market_type, market_label) | |

### `ippica_odds`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | auto |
| market_id | UUID FK | → ippica_markets ON DELETE CASCADE |
| runner_number | INT | NULL for Even/Odd |
| selection_name | TEXT NOT NULL | horse name or "Even"/"Odd" |
| odds | DECIMAL(8,2) | decimal odds (8.20) |
| previous_odds | DECIMAL(8,2) | |
| trend | TEXT | "down", "stable", "up" (mapped from MST -2/0/2) |
| status | TEXT | active / suspended / resulted |
| result | TEXT | won / lost / void |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |
| **UNIQUE** | (market_id, selection_name) | |

## Loop Logic

### program-loop (every 30 min)

1. `GET /rest/program/channels` → upsert `ippica_meetings` (today + tomorrow)
2. `GET /rest/program/next` → discover new races, upsert `ippica_races` with base info
3. Populate `raceCache` (Map of active race IDs) for odds-loop
4. Update meeting status: if all races in a meeting are `finished`/`abandoned` → meeting `completed`; if any race is `open`/`running` → meeting `active`

### Startup bootstrap

On process start (before first odds cycle), bootstrap `raceCache` from DB:
```sql
SELECT external_id FROM ippica_races
WHERE status IN ('scheduled', 'open', 'closed')
AND scheduled_at >= NOW() - INTERVAL '2 hours'
AND scheduled_at <= NOW() + INTERVAL '24 hours'
```
This ensures no gap after restart — the odds-loop doesn't depend on program-loop running first.

### odds-loop (every 2 min)

1. Filter `raceCache`: only races with `scheduled_at` within next `oddsWindowHours` (default 3h). Races further out only get program-loop discovery.
2. `GET /rest/program/race/{id}` for each (concurrency 5, delay 300ms)
3. Upsert `ippica_runners` — **exclude `finish_position` from upsert** (never overwrite results data)
4. Upsert `ippica_markets` + `ippica_odds` (updated quotes)
5. Remove from cache races with `ss=FI` (finished) or DB status `finished`/`abandoned`
6. Skip any race already `finished` or `abandoned` in DB (prevent race condition with results-loop)

### results-loop (every 1 min)

1. `GET /rest/program/last` → recently finished races
2. For each finished race in DB: update `ippica_races.status = 'finished'`, set `off_time`
3. Update `ippica_runners.finish_position` from `result[]`
4. Settle `ippica_odds.result`:
   - **Winner**: finish_position = 1 → won, rest → lost
   - **Place (N)**: finish_position <= N → won, rest → lost
   - **Even/Odd**: winner's saddle number parity
   - **Head to Head**: compare finish_positions
   - Disqualified runners → void
   - **Abandoned races**: all odds → void
5. **Unsettled check**: query races with `status = 'finished'` and any `ippica_odds.result IS NULL` (excluding non-runners). Re-run settlement for those. Catches partial settlement from prior crashes.

## Data Transformations

### Status Mapping

| MST `ss` | MST `st` | DB status |
|-----------|----------|-----------|
| `AP` | 1 | `scheduled` |
| `AP` | 5, 9 | `open` |
| `CH` | - | `closed` |
| `RU` | - | `running` |
| `FI` | 13, 14 | `finished` |
| `AB` | - | `abandoned` |

### Conversions

- **Odds**: MST `820` → DB `8.20` (÷ 100)
- **Distance**: stored in original units as DECIMAL, converted for display only
- **Prize**: raw centesimi from MST + currency
- **Trend**: MST `-2` → `"down"`, `0` → `"stable"`, `2` → `"up"`
- **Selection names**: normalized to consistent casing before upsert (prevent duplicate key on name variations)

### Non-Runner Handling

When `hstatus != "1"`:
- `ippica_runners.is_non_runner = true`
- All runner's `ippica_odds` → `status = 'void'`, `result = 'void'`
- `ippica_races.runners_count` recalculated

## Anti-Overlap Guards

Same pattern as Kambi: `_programRunning`, `_oddsRunning`, `_resultsRunning` flags. Each loop skips if already running.

## Deploy

- **Server**: scraper-vps (46.225.222.33)
- **Path**: `/root/ippica-scraper/`
- **Service**: `ippica-scraper.service` (systemd)
- **Execution**: `tsx src/index.ts` (no build step)
- **Env**: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`

### Deploy Command

```bash
tar czf /tmp/ippica.tar.gz --exclude=node_modules --exclude=.git . && \
scp /tmp/ippica.tar.gz scraper-vps:/tmp/ && \
ssh scraper-vps "systemctl stop ippica-scraper && cd /root/ippica-scraper && tar xzf /tmp/ippica.tar.gz && npm install && systemctl start ippica-scraper"
```

### Resource Estimates

- **CPU**: minimal (~200 races/day)
- **RAM**: ~30-50MB
- **Network**: ~500 req/hour to MST
- **DB**: ~5-10K rows/day

## Data Retention

Cleanup job runs daily (can be a simple cron or integrated into Vincitu's existing cleanup):
- Delete races with `status IN ('finished', 'abandoned') AND scheduled_at < NOW() - INTERVAL '7 days'`
- CASCADE deletes runners, markets, odds automatically
- Delete meetings with `meeting_date < NOW() - INTERVAL '7 days'`

## Logging

Each loop logs to stdout (captured by systemd):
- Cycle start/end with duration in ms
- Races fetched, runners upserted, odds updated counts
- Results settled count
- Errors with context (race ID, HTTP status)
- On startup: bootstrap cache size

## Proxy Failover

Config includes `fallbackUrls`. On `maxConsecutiveFailures` reached:
1. Log warning with current URL
2. Rotate to next URL in `fallbackUrls`
3. Reset failure counter
4. If all URLs exhausted, cycle back to primary

## Known Limitations

- **Dead heats**: treated as simple win (no stake reduction). Document for future improvement.
- **Forecast/Tricast**: combination markets, not settleable with simple outcomes. Skipped.
- **Ante-post**: long-term futures markets. Out of scope.

## Out of Scope (for now)

- Frontend integration in Vincitu
- Redis real-time pipeline
- Watchdog/alerts integration
- Forecast/Tricast market settlement (combinations)
- Ante-post markets (long-term futures)
- Dead-heat reduction on Place markets
