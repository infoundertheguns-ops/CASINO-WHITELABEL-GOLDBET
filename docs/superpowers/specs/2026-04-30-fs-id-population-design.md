# Design — FS-id population (Plan D dep #4)

**Date**: 2026-04-30
**Status**: Design — pending implementation plan
**Plan D registry item**: #4
**Related**: Plan D Phase 1.5 filter (mig 156), `v_player_markets` view (mig 160b)

## Problem

Today, `events_v2.flashscore_id` is `NULL` for **0/4237** events. The
Phase 1.5 filter in `v_player_markets` excludes stats and player markets
on events without a `flashscore_id`:

```sql
WHERE best.category <> 'special'
  AND NOT (
    (best.category = ANY (ARRAY['stats', 'player']))
    AND e2.flashscore_id IS NULL
  );
```

With every `events_v2` row having NULL, **all** stats/player markets are
hidden from the player frontend — 21,495 markets currently invisible.

The filter design is correct: it ensures the system only exposes markets
it can settle (score-based via odds-api always, stats/player via
Flashscore only when FS-id is present, special never). The gap is the
population mechanism for `events_v2.flashscore_id`.

## Goal

Populate `events_v2.flashscore_id` so that stats and player markets become
visible for every event the Flashscore scraper can match to an FS match
identifier — both for the existing 4237-row backlog and for the
continuous flow of newly ingested events from odds-api.

Target coverage: **> 75%** of events_v2 rows after backfill. Remaining
gap acceptable as long as the residual events display only score-based
markets (no broken pages).

## Non-goals

- Real-time push (<500ms latency) — tracked separately as registry item 3a/3b.
- Modify the existing `v_player_markets` filter — it already encodes the right policy.
- Fuzzy distance matching with sub-1.0 threshold — strict equality after normalization is the chosen approach.
- Populate `flashscore_id` for non-odds-api events in legacy `events` — that responsibility stays with the Flashscore scraper push loop.
- Deprecate or remove flashscore-scraper service — it remains in production indefinitely (settles non-score markets).

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          flashscore.ninja                        │
│                          (HTTP feed API)                         │
└──────────────────────────────────────────────────────────────────┘
              ▲                                ▲
              │ GET feed/f_{sport}_{day}…      │ existing loops
              │ on-demand                      │ (results/fixtures/live)
              │                                │
┌─────────────┴────────────────┐  ┌────────────┴────────────────┐
│  flashscore-scraper          │  │  flashscore-scraper         │
│  NEW HTTP server :8090       │  │  EXISTING loops             │
│  GET /search?...             │  │  (push-to-vincitu)          │
│   • in-mem cache 5min TTL    │  │                             │
│   • norm + alias dict        │  │                             │
│   • return matchId or 404    │  │                             │
└──────────────┬───────────────┘  └─────────────┬───────────────┘
               │                                │
               │ sync HTTP, 10s timeout         │ POST → admin
               │                                ▼
┌──────────────┴───────────────┐  ┌─────────────────────────────┐
│  odds-api-ingester           │  │  events (legacy)            │
│  NEW hook in upsert.ts:      │  │  flashscore_id populated    │
│   • after INSERT events_v2   │  │  via push from FS scraper   │
│   • cascade lookup:          │◄─┤                             │
│       1. legacy join (DB)    │  └─────────────────────────────┘
│       2. canonical chain (DB)│
│       3. /search (HTTP)      │
│   • UPDATE events_v2.fs_id   │
└──────────────────────────────┘
               ▲
               │ one-shot
┌──────────────┴───────────────┐
│  scripts/backfill-fs-id.ts   │
│  Step A: SQL bulk join       │
│  Step B: priority queue      │
│   live > prematch > settled  │
└──────────────────────────────┘
```

### New components

1. **HTTP server in flashscore-scraper** — Fastify server bound to
   `127.0.0.1:8090`. Single endpoint `GET /search`, plus `GET /stats`
   for diagnostics. Started in parallel with existing loops from
   `src/index.ts`. ~200 LoC.

2. **Helper `lib/resolve-flashscore-id.ts`** in
   `services/odds-api-ingester/src/`. Pure function with three injected
   dependencies (db, scraperUrl, log). ~80 LoC.

3. **One-shot script `scripts/backfill-fs-id.ts`** in
   `services/odds-api-ingester/`. Runs Step A SQL then Step B priority
   queue with throttling. ~150 LoC.

### Modified components

- `flashscore-scraper/src/index.ts` — start HTTP server alongside loops.
- `services/odds-api-ingester/src/upsert.ts` — call helper post-INSERT
  events_v2 (or post-UPDATE when flashscore_id is still NULL).

### No DB schema changes

`events_v2.flashscore_id` already exists. `oddsapi_translations` and
`manual_overrides` tables already in place from mig 158/159. No new
migrations required.

## Search endpoint

### Request

```
GET http://127.0.0.1:8090/search?
    sport_slug={football|basketball|...}&
    starts_at={ISO8601}&
    home={text}&
    away={text}
Header: X-API-Key: goldbet-scraper-2026
```

### Response

| Status | Body                                                      | Meaning |
|--------|-----------------------------------------------------------|---------|
| 200    | `{matchId, matchedHome, matchedAway, viaDayOffset}`       | Match found |
| 404    | `{error: "no_match", candidates: [{home, away, time}, ...]}` | No match within tolerance |
| 409    | `{error: "ambiguous", candidates: [...]}`                 | Two or more equally-scoring candidates |
| 503    | `{error: "flashscore_unavailable"}`                       | Upstream FS feed timeout or 403 |
| 401    | `{error: "unauthorized"}`                                 | Missing or wrong X-API-Key |

### Internal flow

```
1. Auth check (X-API-Key)
2. Translate sport_slug → sportId via static config map
3. Compute dayOffset from starts_at (Europe/Rome timezone)
4. Cache lookup: key = "{sportId}-{dayOffset}", TTL 5min
   - HIT: parsed FlashscoreFixture[]
   - MISS: fetchResultsFeed(sportId, dayOffset) → parse → cache → set
5. Filter candidates by timestamp ±10 min from query starts_at
6. For each candidate, normalize and apply alias dictionary:
   normalize(s) = s.toLowerCase().normalize('NFD')
                   .replace(/[̀-ͯ]/g, '')      // strip diacritics
                   .replace(/\b(fc|ac|cf|sc|sk|as|ss|usl|calcio)\b/gi, '')
                   .replace(/\s+/g, ' ').trim()
   alias_lookup(s) = aliases[s] ?? s          // optional substitution
   compare = alias_lookup(normalize(query)) === alias_lookup(normalize(candidate))
7. If exactly one candidate matches both home and away → 200
   If zero matches → 404
   If multiple match → 409 ambiguous
8. Day fallback: if step 7 returns 404, retry with dayOffset±1 (max 2 extra fetches)
```

### Cache

- In-memory `Map<string, { fixtures: FlashscoreFixture[], expiresAt: number }>`.
- TTL: 5 minutes (configurable per env var `FS_SEARCH_CACHE_TTL_MS`).
- Eviction: lazy on access (no background timer needed for small N).
- Memory bound: ~150 sports × 14 day-offsets × ~50KB = ~100MB worst case. In practice ~20-50 entries per active hour.

### Alias dictionary

Static JSON file `flashscore-scraper/src/team-aliases.json`. Keyed by
*normalized form* of either side, mapping to a canonical normalized form.

```json
{
  "inter": "internazionale",
  "man utd": "manchester united",
  "man city": "manchester city",
  "real": "real madrid",
  "atletico": "atletico madrid",
  "bayern": "bayern munchen",
  "psg": "paris saint germain"
}
```

Initial seed: ~50-100 entries for football, expanded over time as
`no_match` cases surface in logs. Process: weekly review of top
no_match counts → add missing aliases → rerun backfill for residual.

### Sport mapping

Static file `flashscore-scraper/src/sport-id-map.json` derived from
existing `config.json`:

```json
{
  "football": 1,
  "basketball": 2,
  "tennis": 5,
  "ice-hockey": 4,
  "baseball": 6,
  "handball": 7,
  ...
}
```

Reject unknown sport_slug with 400.

### Day offset

```ts
function dayOffset(startsAt: Date): number {
  const todayRome = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
  todayRome.setHours(0, 0, 0, 0);
  const eventRome = new Date(startsAt.toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
  eventRome.setHours(0, 0, 0, 0);
  return Math.round((eventRome.getTime() - todayRome.getTime()) / 86400000);
}
```

Negative offsets allowed (settled events, results feed). Range
practical: -7 ≤ offset ≤ +21.

## Ingester hook

### Trigger

Called from `Upserter.upsertEvent()` only when:
- The row was newly inserted, OR
- The row already exists but `flashscore_id IS NULL`

For existing rows with non-null `flashscore_id`, skip entirely (idempotent
fast path for live ticks updating odds/scores).

### Cascade

```ts
async function resolveFlashscoreId(
  event: { odds_api_id: number; sport_slug: string; starts_at: Date; home: string; away: string },
  deps: { db: DbClient; searchUrl: string; apiKey: string; log: Logger }
): Promise<string | null> {
  // Step 1 — Legacy direct join
  const direct = await deps.db.queryOne(
    `SELECT flashscore_id FROM events
     WHERE external_id = $1 AND flashscore_id IS NOT NULL LIMIT 1`,
    [`odds-api:${event.odds_api_id}`]
  );
  if (direct) return direct.flashscore_id;

  // Step 2 — Canonical chain
  const chain = await deps.db.queryOne(
    `SELECT e_fs.flashscore_id FROM events e_oa
     JOIN events e_fs ON e_fs.canonical_id = e_oa.canonical_id
        AND e_fs.flashscore_id IS NOT NULL
     WHERE e_oa.external_id = $1 LIMIT 1`,
    [`odds-api:${event.odds_api_id}`]
  );
  if (chain) return chain.flashscore_id;

  // Step 3 — Search endpoint
  try {
    const url = new URL(`${deps.searchUrl}/search`);
    url.searchParams.set('sport_slug', event.sport_slug);
    url.searchParams.set('starts_at', event.starts_at.toISOString());
    url.searchParams.set('home', event.home);
    url.searchParams.set('away', event.away);
    const res = await fetch(url, {
      headers: { 'X-API-Key': deps.apiKey },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const body = await res.json() as { matchId: string };
      return body.matchId;
    }
  } catch (err) {
    deps.log.warn({ event: event.odds_api_id, err: String(err) }, '[fs-id] search failed');
  }
  return null;
}
```

### Failure mode

Any failure leaves `flashscore_id = NULL`. The next upsert of the same
event (next tick) re-triggers the lookup, so transient failures self-heal.

Persistent no-match (e.g. event not in Flashscore catalog) stays NULL
until either:
- Alias dictionary updated and lookup succeeds on retry
- Operator runs backfill manually

This is acceptable: the filter view hides stats/player markets for that
event, and score-based markets remain visible. No broken UX.

### Performance impact

| Tier      | Interval | Avg new events | FS lookup overhead |
|-----------|----------|----------------|---------------------|
| live      | 30s      | ~0 (events already in DB from earlier tier) | 0 |
| imminent  | 2min     | 0-5            | 0-25s              |
| mid       | 10min    | 5-20           | 25-100s            |
| slow      | 30min    | 20-50          | 100-250s           |
| discovery | 60min    | 50-200         | 250s-1000s         |

Lookups in mid/slow/discovery are dominated by Step 1+2 SQL hits
(microseconds), only the residual ~5-10% reach Step 3 with HTTP cost.

## Backfill script

### Step A — Bulk SQL (no scraper, ~30s)

```sql
-- A1: legacy direct
UPDATE events_v2 v
SET flashscore_id = e.flashscore_id, updated_at = now()
FROM events e
WHERE e.external_id = 'odds-api:' || v.odds_api_id::text
  AND e.flashscore_id IS NOT NULL
  AND v.flashscore_id IS NULL;

-- A2: canonical chain
UPDATE events_v2 v
SET flashscore_id = e_fs.flashscore_id, updated_at = now()
FROM events e_oa
JOIN events e_fs ON e_fs.canonical_id = e_oa.canonical_id
  AND e_fs.flashscore_id IS NOT NULL
WHERE e_oa.external_id = 'odds-api:' || v.odds_api_id::text
  AND v.flashscore_id IS NULL;
```

Expected outcome: ~2489 rows populated.

### Step B — Priority queue (~15-20 min)

```sql
SELECT id, odds_api_id, sport_slug, starts_at, home, away, status
FROM events_v2
WHERE flashscore_id IS NULL
ORDER BY
  CASE status WHEN 'live' THEN 0 WHEN 'pending' THEN 1 ELSE 9 END,
  starts_at ASC;
```

For each row:
- Throttle: max 1 request/sec to scraper (semaphore)
- Call `GET /search`
- 200 → `UPDATE events_v2 SET flashscore_id = $1 WHERE id = $2`
- 404/409 → log and skip
- 503 → backoff 30s and retry once
- Persistent 5xx → exponential backoff (5s, 10s, 30s), abort after 3 consecutive failures

### Resumability

Re-runs of the script are safe: it always re-selects rows still NULL.
After alias dictionary updates, rerun to pick up additional matches.

### Output

```
Step A: populated 2489 events via legacy/canonical join (28s)
Step B: processing 1748 events with throttle 1/sec…
        progress 100/1748 ETA 27m
        progress 500/1748 ETA 21m
        ...
        matched: 1380 (78.9%)
        no_match: 332 (19.0%)
        errors: 36 (2.1%)
Final coverage: 3869/4237 (91.3%)
```

## Failure modes summary

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Scraper search server down | Ingester HTTP timeout 10s | Lookup fails silently, NULL persisted, retry next tick |
| Flashscore.ninja 403 | Scraper receives 403 | Endpoint returns 503, ingester retries next tick |
| Flashscore.ninja 5xx/timeout | Scraper fetch fails | Cache (if hit) returns stale, miss returns 503 |
| DB lock contention on UPDATE events_v2 | SQL exception in ingester | Tier consecError++, suspends after 3 |
| Ambiguous match (≥2 equal scores) | Endpoint returns 409 | Manual review, alias dict update |
| Ingester restart mid-INSERT | Crash | ON CONFLICT DO UPDATE on odds_api_id, next tick replays |
| Scraper restart during search | HTTP timeout | Ingester logs warn, retry next tick |
| Player frontend opens event with NULL | View filter hides stats/player | Score-based markets still visible, no broken UX |

## Observability

### Ingester log lines

```
[fs-id] start odds_api_id=12345 home="Inter" away="Milan" sport=football
[fs-id] step1 legacy_direct: HIT → 'G3aZ9j5E' (8ms)
[fs-id] resolved odds_api_id=12345 via=legacy_direct ms=8
```

Or:

```
[fs-id] start odds_api_id=67890 home="Bayern Munich" away="Dortmund"
[fs-id] step1 legacy_direct: MISS
[fs-id] step2 canonical: MISS
[fs-id] step3 search: HTTP 200 matchId='K8mP2x' (1842ms)
[fs-id] resolved odds_api_id=67890 via=search ms=1857
```

### Rolling counters

Every 100 lookups, scheduler logs:

```
[fs-id-stats] last100: legacy=58 canonical=4 search=29 nomatch=8 error=1 avgMs=412
```

### Scraper diagnostic endpoint

```
GET http://127.0.0.1:8090/stats
{
  "uptime_sec": 3600,
  "search_requests_total": 480,
  "cache_hits": 421,
  "cache_misses": 59,
  "cache_size": 47,
  "fs_403_count": 0,
  "fs_5xx_count": 2,
  "no_match_count": 31
}
```

## Testing

### Unit

- `__tests__/resolve-flashscore-id.test.ts`: cascade with mocks for each step's outcome (hit at 1, hit at 2, hit at 3, all miss, error at 3).
- `flashscore-scraper/__tests__/normalize.test.ts`: normalization rules and alias dictionary.
- `flashscore-scraper/__tests__/search.test.ts`: cache TTL, day fallback, ambiguous detection.

### Integration

- Run `curl localhost:8090/search?...` against a known-live event.
- Stop scraper, verify ingester continues with NULL persistence and no crashes.
- Restart scraper, verify next tick populates the missing rows.

### Smoke

- Backfill script on `LIMIT 50` first, inspect output, confirm match rate.
- Inspect 5-10 random no_match cases manually for alias dictionary expansion.

### Regression

- Verify `/api/health` admin/player remain HTTP 200 throughout backfill.
- Watch derive cron timing — no regression vs baseline.

## Roll-out plan

```
T+0    Deploy scraper with HTTP server :8090. Verify with curl.
T+30   Deploy ingester with resolve-flashscore-id helper.
T+60   Run backfill script. Monitor /var/log/backfill-fs-id.log.
T+90   SELECT count(*) FROM events_v2 WHERE flashscore_id IS NULL;
       Expected: < 400.
T+ND   Periodic backfill rerun after alias dictionary updates.
```

Rollback: stop scraper HTTP server (existing loops unaffected), revert
ingester deploy. Existing rows with populated flashscore_id remain
correct.

## Out of scope

- Realtime push (item 3a/3b)
- Settlement engine changes
- Modifications to `v_player_*` views
- Population of legacy `events.flashscore_id` for non-odds-api sources
- Removal of flashscore-scraper service

## Open questions

None — all design decisions confirmed during brainstorming session
2026-04-30.
