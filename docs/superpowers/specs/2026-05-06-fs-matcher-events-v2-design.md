# Spec — FS push-to-vincitu matcher → events_v2

**Date**: 2026-05-06
**Author**: superpowers session
**Status**: Approved

## Goal

Restore live-data flow (period / minute / score / halfScores) from the Flashscore-scraper push pipeline into `v_player_events`, after the Plan D S6 cutover moved live event ingest from legacy `events` to `events_v2`. Today the matcher in `app/api/flashscore/live/route.ts` reads from legacy `events` filtered on `source='odds-api'` — that source path is dead since 2026-04-28, so 0 events match every cycle and the kiosk live Scoreboard renders empty (no period, no clock, no per-period table).

## Architecture

The matcher continues to receive the same payload `{ live: FlashscoreLive[], sport }` from the FS-scraper, but:

- queries `events_v2` instead of `events`
- updates `events_v2` instead of `events`
- filters by denormalized `events_v2.sport_slug` (English) instead of joining `sports!inner(name)` (Italian)
- direct-matches predominantly via `events_v2.flashscore_id`, populated by the FS-id resolver v2 shipped 2026-05-06 (~41% global, ~62% calcio coverage)
- fuzzy fallback (team name + ±4 h window) is unchanged

A two-phase migration handles the schema delta and view simplification, additive first then cleanup.

## Decisions

### 1. events_v2 schema — additive ALTER (mig 177)

```sql
ALTER TABLE events_v2
  ADD COLUMN IF NOT EXISTS period   text,
  ADD COLUMN IF NOT EXISTS minute   int,
  ADD COLUMN IF NOT EXISTS live_data jsonb;
```

**Rationale**: column names and shapes match the legacy `events` table verbatim, so:
- existing helpers `derivePeriodLabel(sport, periodCount)` and `applyEnrichment(...)` keep working with minimal churn
- `v_player_events` SELECT projection (mig 178) becomes a 1:1 column copy (no transformation)
- the page-v2 client mapper (`lib/queries/player-event-v2.ts`) already reads `evRaw.period`, `evRaw.minute`, `evRaw.live_data` — no client changes required

We do **not** reuse the existing `events_v2.period_scores jsonb` because it has a different shape (odds-api settlement payload `[{home, away}, ...]`) and is read by settlement code paths. Mixing live FS halfScoreHome/Away into it would risk polluting settlement.

### 2. Sport slug mapping IT → EN (TS-side helper)

The FS-scraper sends `sport: "calcio"` (Italian, matching legacy `sports.name`). `events_v2.sport_slug` is English (`"football"`, `"ice-hockey"`, ...). We add `lib/sport-slug-it-to-en.ts`:

```ts
export function getSportSlugsEn(sportIt: string): string[] {
  // Mirror of postgres _sport_slug_en_to_it (mig 175), inverted.
  // Returns possible English slugs that the FS-scraper-reported Italian sport could map to.
  // Returns array because multiple Italian aliases (e.g. "boxe" / "pugilato") collapse to a single English slug.
}
```

The function returns `[]` for unknown sports — caller short-circuits with `{matched: 0, reason: "unknown_sport"}`.

### 3. Read query

```ts
supabase
  .from("events_v2")
  .select("id, odds_api_id, home, away, score_home, score_away, starts_at, period, minute, live_data, flashscore_id, sport_slug")
  .eq("status", "live")
  .in("sport_slug", slugsEn)
  .limit(500)
```

No more `source='odds-api'` (events_v2 is single-source post Plan D), no more `is_live=true` (collapsed into `status='live'`), no more `sports!inner` join.

Caveat: the limit-500 cap matches current behaviour; live event count today is well under 500 globally.

### 4. Update target → events_v2

`applyEnrichment` retains its current logic but writes to `events_v2.id` instead of `events.id`. The `flashscore_id` persistence path on fuzzy match writes to `events_v2.flashscore_id`.

The DbLiveEvent interface is renamed and trimmed to events_v2 shape:

```ts
interface V2LiveEvent {
  id: string;
  odds_api_id: number;
  home: string;
  away: string;
  score_home: number | null;
  score_away: number | null;
  starts_at: string;
  period: string | null;
  minute: number | null;
  live_data: Record<string, unknown> | null;
  flashscore_id: string | null;
  sport_slug: string;
}
```

The `home_team`/`away_team` field names in the legacy interface become `home`/`away`. Inside `applyEnrichment` we rename the field-access accordingly.

### 5. mig 178 — simplify v_player_events (drop legacy JOIN)

After the new route ships and a smoke cycle confirms `matched > 0`:

```sql
DROP VIEW v_player_events CASCADE;

CREATE VIEW v_player_events AS
SELECT
  e2.id, e2.odds_api_id,
  s.id AS sport_id, s.slug AS sport_slug, s.name AS sport_name,
  s.icon AS sport_icon, s.sort_order AS sport_sort_order,
  l.id AS league_id, l.slug AS league_slug, l.name AS league_name,
  l.country AS league_country, l.logo_url AS league_logo_url, l.sort_order AS league_sort_order,
  e2.home AS home_team, e2.away AS away_team, e2.home_id, e2.away_id,
  e2.starts_at,
  CASE e2.status
    WHEN 'pending'   THEN 'prematch'
    WHEN 'live'      THEN 'live'
    WHEN 'settled'   THEN 'ended'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'postponed' THEN 'postponed'
    ELSE e2.status
  END AS status,
  e2.score_home,
  e2.score_away,
  COALESCE(e2.live_data, e2.period_scores) AS live_data,
  e2.minute,
  e2.period,
  (e2.status = 'live') AS is_live,
  e2.flashscore_id, e2.urls, e2.updated_at, e2.last_settled_at
FROM events_v2 e2
LEFT JOIN sports s ON s.slug = _sport_slug_en_to_it(e2.sport_slug)
LEFT JOIN leagues l ON l.sport_id = s.id AND l.slug = e2.league_slug;
```

Notes:
- `COALESCE(e2.live_data, e2.period_scores)` keeps a graceful fallback to settled period_scores when live_data is null
- legacy events JOIN is removed entirely

### 6. Telemetry

Stats response extended:

```json
{
  "received": 12,
  "matched": 9,
  "matched_direct": 7,
  "matched_fuzzy": 2,
  "updated": 5,
  "errors": []
}
```

### 7. Test mode safety / rollout

Sequencing:

1. **mig 177** (additive, instant) — adds three nullable columns
2. **route.ts deploy** — starts populating `events_v2.period/minute/live_data`. Mig 176 still in place: its LATERAL JOIN against legacy `events` returns NULL (legacy is dead) and the COALESCE in mig 176 falls through to `e2.live_data` … actually the current mig 176 has `COALESCE(elg.live_data, e2.period_scores)` — legacy-first, settled-period_scores second. After our route ships, legacy stays NULL forever and `e2.period_scores` is also typically NULL for live events, so the view returns NULL until mig 178. **This is the gap**: mig 178 must run promptly after route deploy or the kiosk still sees no live data.
3. **mig 178** — drops legacy JOIN, simplifies view; reads e2.live_data directly

Each step is independently rollback-able:
- mig 177 rollback: `ALTER TABLE events_v2 DROP COLUMN period, DROP COLUMN minute, DROP COLUMN live_data;`
- route.ts rollback: `git revert` + redeploy admin
- mig 178 rollback: re-apply mig 176 SQL

## Out of scope

- Extending odds-api ingester with `/v4/sports/{sport}/scores` (Option C)
- Cleanup of legacy `events` table — Plan D S7
- LIVE_*_BY_SPORT DB audit (T10 master plan)
- Header-gap polish (T11 master plan)

## Success criteria

- POST `/api/flashscore/live` with a real calcio payload → `matched > 0` (target ≥ 60% of currently-live events_v2 calcio rows)
- Kiosk live page calcio → Scoreboard shows period label, minute, per-period table, halfScoreHome/Away rows
- `journalctl -u betssolution-admin` clean for ≥10 push cycles after deploy
- `v_player_events` query latency post-mig-178 ≤ pre-mig latency (cold ≤300 ms, warm ≤7 ms with Redis cache)

## Open questions

None as of spec sign-off.
