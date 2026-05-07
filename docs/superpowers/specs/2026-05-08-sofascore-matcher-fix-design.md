# SofaScore Matcher Fix — Calcio + Basket 0 Matched

**Date**: 2026-05-08
**Branch**: feature/plan-d-settlement-d1
**Author**: brainstorm session 2026-05-08
**Status**: design approved, awaiting plan

## Context

SofaScore enrichment scraper deployed 2026-05-07 ~15:30 UTC (commits admin `82c9da3`, scraper `868b265`). After T+24h:

- **Tennis**: 45/706 events matched (6.4%)
- **Football**: 0 matched
- **Basketball**: 0 matched

`/api/sofascore/fixtures` log from last discovery run (2026-05-07 15:18 UTC):

```
{"received":1435,"matched_direct":0,"matched_fuzzy":45,
 "no_time_window":1313,"no_match_name":77,"skipped_unknown_sport":0}
```

1313/1435 (91%) classified as `no_time_window`. Investigation revealed the events_v2 candidate pool was nearly empty (28 rows) when the actual sport-filtered pool should be ~1500 rows.

## Root Cause: Three Orthogonal Bugs in Pool Filter

### Bug #1 — sport_slug values use wrong language

`app/api/sofascore/fixtures/route.ts:34`:

```ts
.in("sport_slug", ["calcio", "tennis", "basket"])
```

But events_v2.sport_slug uses **English** slugs (set by odds-api ingester):
`football`, `tennis`, `basketball`.

Only `tennis` matches by coincidence (same in EN/IT). Football and basketball candidates are filtered out completely.

### Bug #2 — Status `prematch` does not exist

`app/api/sofascore/fixtures/route.ts:35`:

```ts
`status.in.(prematch,live),and(status.eq.settled,starts_at.gte.${sixHoursAgoIso})`
```

But the events_v2 status check constraint allows only:

```sql
CHECK (status = ANY (ARRAY['pending', 'live', 'settled', 'cancelled', 'postponed']))
```

`prematch` was never a valid value. Approximately 1000+ football, 266 basketball, 218 tennis rows in `pending` status are filtered out.

### Bug #3 — mapSofaSport returns IT slugs

`app/api/sofascore/fixtures/_lib.ts:33-43`:

```ts
export function mapSofaSport(s: string): "calcio" | "tennis" | "basket" | null {
  switch (s) {
    case "football":     return "calcio";
    case "tennis":       return "tennis";
    case "basketball":   return "basket";
    default:              return null;
  }
}
```

Even if the pool query returned the right rows, the inner candidate filter
`c.sport_slug === vincituSport` would reject everything — events_v2 has
`sport_slug="football"` but mapSofaSport returns `"calcio"`.

### Bug propagation to /api/sofascore/stats

`app/api/sofascore/stats/route.ts:18-19`:

```ts
.in("sport_slug", ["calcio", "tennis", "basket"]);
const by_sport = { calcio: 0, tennis: 0, basket: 0 };
```

Same wrong slugs. Reports 0 even when matches exist for `football`/`basketball` sport_slug.

### Bug propagation to /api/sofascore/enrichment

`app/api/sofascore/enrichment/route.ts:13`:

```ts
sport_slug: "calcio" | "tennis" | "basket";
```

TypeScript type wrong. Runtime impact deferred (route uses sofascore_id lookup, not sport_slug filter), but future contributors would copy the wrong type.

## Why Tennis Got 45 Matches

Pure coincidence: `tennis` is identical in EN/IT, and at 15:18 UTC there were
13 `live` + 15 `settled-within-6h` tennis events_v2 rows that satisfied even the broken pool query (status filter still rejected the 218 `pending`, but live/settled-recent slipped through). The token-based name match did the rest.

## Design

### Pattern: align with Flashscore matcher

Flashscore (`app/api/flashscore/{fixtures,results,live}/route.ts`) follows a clear convention:

1. **DB query always uses EN slugs** via `getSportSlugsEn(sportIt)` helper
2. **Status filter is use-case-specific**: `pending` for fixtures, `[live, settled]` for results, `live` for live updates
3. **Scraper sends its own native slug**, admin converts at the boundary

SofaScore Python scraper natively uses EN (`football`/`tennis`/`basketball`),
matching events_v2 directly. **No conversion layer needed** — `mapSofaSport` becomes identity and is removed.

### File-by-file changes

| File | Change |
|---|---|
| `app/api/sofascore/fixtures/route.ts` | `.in("sport_slug", ["football","tennis","basketball"])` + status filter `pending` instead of `prematch` |
| `app/api/sofascore/fixtures/_lib.ts` | Remove `mapSofaSport`. `matchSofaToCandidate` validates `fx.sofa_sport` against `{football,tennis,basketball}` directly. Inner candidate filter compares sport_slug to fx.sofa_sport |
| `app/api/sofascore/stats/route.ts` | `.in("sport_slug", ["football","tennis","basketball"])` + `by_sport = { football:0, tennis:0, basketball:0 }` |
| `app/api/sofascore/enrichment/route.ts` | Update `sport_slug` TypeScript union type to `"football"\|"tennis"\|"basketball"` |

### Component boundaries unchanged

Scraper Python (`/root/sofascore-scraper`): no change. Already sends EN slugs in fixtures payload.

events_v2 schema: no change. Already EN slug.

UI views (`v_player_events`, admin event-v2): no change. They use IT slugs via `_sport_slug_en_to_it` mapping (mig 175). The SofaScore matcher does not interact with these.

### Stats output keys

`by_sport` keys change from `{calcio,tennis,basket}` → `{football,tennis,basketball}`. **No frontend consumer exists** (verified via grep across `app/`, `components/`, `lib/` — only stats route itself references the keys). Safe to break.

### Test coverage

New file: `__tests__/sofascore-fixtures.test.ts` (vitest). Tests for `matchSofaToCandidate`:

1. **skipped_unknown_sport**: sofa_sport="hockey" → returns kind="skipped_unknown_sport"
2. **no_time_window**: |startTime − fxTime| > 20min → returns kind="no_time_window"
3. **matched_direct**: candidate has sofascore_id matching fx.sofa_event_id → returns kind="matched_direct"
4. **matched_fuzzy**: name token-overlap above threshold + within window → returns kind="matched_fuzzy"
5. **status pending in pool**: regression guard — fixture pool builder includes pending rows (uses dependency injection or direct fixture construction)

Smoke E2E: post-deploy curl POST to `/api/sofascore/fixtures` with 3 sample fixtures (one per sport), verify response `matched_*` > 0 for the three sports.

### Discovery rerun strategy

Post-deploy: do not wait for next 04:00 UTC discovery. Trigger an on-demand discovery cycle (Python scraper exposes startup-discovery; restart `sofascore-scraper.service` or call internal trigger). Verify within 5-10 min via `/api/sofascore/stats` showing `by_sport.football > 0` and `by_sport.basketball > 0`.

## Risk and Rollback

**Blast radius**: scoped to `/api/sofascore/*` routes. No DB migration. No schema change. No frontend coupling.

**Rollback**: `git revert` of fix commit. Stats endpoint goes back to `{calcio:0,tennis:N,basket:0}` until next deploy. SofaScore enrichment for football+basketball keeps writing to `event_enrichment` regardless (route uses sofascore_id lookup, not sport_slug filter), so already-matched rows continue to enrich until ttl.

**No data corruption risk**: `events_v2.sofascore_id` is BIGINT; mismatched matches would persist a foreign sofa_event_id. Mitigated by token-overlap threshold ≥ 1.0 combined h+a (proven on tennis: 0 false positives in 45/45). Re-running matcher with corrected sport_slug filter only adds new matches, never overwrites or breaks existing tennis matches.

## Acceptance Criteria

1. `/api/sofascore/stats` returns `by_sport.football > 0` and `by_sport.basketball > 0` within 30 min of deploy
2. `/api/sofascore/fixtures` log shows `no_time_window < 200` (down from 1313)
3. All 5 vitest unit tests pass + existing 18/18 admin test suite still green
4. `tsc --noEmit` clean
5. enrichment endpoint continues to populate `event_enrichment.statistics` for both football and basketball within 60 min

## Open Items (deferred)

- Tennis match rate is 6.4% (45/706). Likely name-normalize gap on player names with accents/qualifiers (Slam tennis tournaments). Out of scope for this fix.
- Phase-0 measure mode (`SOFA_PHASE_0_MEASURE_MODE=true`) gate decision is independent. To be re-evaluated after this fix lands and football+basket actually populate.
