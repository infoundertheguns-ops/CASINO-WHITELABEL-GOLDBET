# Tennis fixes B1.A — Deployment Runbook

Implementation plan: `docs/superpowers/plans/2026-05-06-tennis-fixes-B1.md`
Spec: `docs/superpowers/specs/2026-05-06-tennis-fixes-B1-design.md`
Branch: `feature/plan-d-settlement-d1`

## T-0 Baseline (sanity-check, pre-deploy)

Captured at start of B1.A execution as a sanity check on traffic patterns. The *authoritative* T-0 baseline used for success-criteria comparison is captured immediately before service restart in T6 (separate file `baseline-stats-T0-deploy.json`).

### Search /stats by_sport (T-0 sanity check)

Source: `baseline-stats.json` (this directory). Captured 2026-05-06 (post v2 ship + ~24h prod traffic).

```text
uptime_sec: 21517 (~6h since last restart)
search_requests_total: 59993
cache_hits: 170178
cache_misses: 8443
cache_size: 250

by_sport (selected, full data in baseline-stats.json):
| Sport      | ok  | feed_empty | time   | name   | ok rate |
|------------|----:|-----------:|-------:|-------:|--------:|
| football   | 419 |       1205 |   1368 |  17596 |   2.0%  |
| basketball |  62 |        285 |   2109 |   2179 |   1.4%  |
| tennis     |  85 |       1092 |   6070 |  13027 |   0.42% |
| baseball   |  33 |        217 |   1359 |   1305 |   1.1%  |
| handball   |  38 |        250 |   1235 |    972 |   1.5%  |
| esports    |  11 |        394 |   2362 |   1783 |   0.24% |
| volleyball |   8 |         89 |    892 |    525 |   0.53% |
| cricket    |   1 |         81 |    911 |     60 |   0.10% |
| ice-hockey |   6 |        134 |    267 |    265 |   0.89% |
| rugby      |  16 |        110 |    121 |    120 |   4.4%  |
| darts      |   0 |        125 |     17 |    271 |   0%    |
| mma        |   0 |         96 |      0 |    169 |   0%    |
| boxing     |   0 |        116 |     61 |     73 |   0%    |
| snooker    |   0 |          3 |      0 |      0 |   0%    |
```

**Key signals**:
- **Tennis `no_match_time=6070`** is the largest bucket of any sport (vs name=13027, but name was already a known target). Confirms B1's hypothesis that time-window expansion has high leverage.
- **Tennis ok rate 0.42%** has degraded vs v2 ship snapshot (1.0%) — coverage erosion ongoing as new tennis events hit the queue without FS-id resolution.
- **Baseball `no_match_time=1359 > no_match_name=1305`** confirms time-window expansion is even more critical for baseball than for tennis name normalization.
- **Football no_match_name=17596** is huge but proportionally smaller (football has many more searches). Most likely lower-division/friendlies that FS doesn't cover at all (will surface as `feed_empty` after future fixes).
- darts/boxing/mma have name_mismatch but baseline 0 ok — sport_id mappings missing (B2 scope).

## Pre-deploy validation (T5)

All implementation work complete via subagent-driven-development. Per-task summary:

| Task | Action | Commit | Tests | Notes |
|------|--------|--------|------:|-------|
| T0 | Baseline + RUNBOOK skeleton + mirror dir | `4c87fce` | — | Tennis ok rate degraded 1.0%→0.42% since v2; tennis no_match_time=6070 dominates |
| T1 | SampleCollector ring buffer 500/sport + 6 tests | `1c3f5fc` | 6/6 | Approved 1st iter on both reviews |
| T2 | normalize.ts per-sport NOISE/RESERVE scaffold | `1477551` | 37/37 (incl regression) | Byte-identical behavior verified |
| T3 | search.ts time tolerance + sample hook + lastInWindow hoist | `b113e44` | 60/60 | +cache.ts `clear()` for test isolation |
| T3.fu | TtlCache.clear() resets hit/miss counters | `baf553e` | 60/60 | Reviewer Important #1 fix |
| T4 | GET /stats/samples endpoint behind x-api-key | `9785d7d` | 60/60 | Smoke verified all 4 endpoint branches |

Final state: **4 test files, 60 tests passing on VPS, tsc --noEmit 0 errors.**

```
✓ src/__tests__/cache.test.ts (5 tests) 4ms
✓ src/__tests__/sample-collector.test.ts (6 tests) 6ms
✓ src/__tests__/normalize.test.ts (37 tests) 9ms
✓ src/__tests__/search.test.ts (12 tests) 25ms
Test Files  4 passed (4)
     Tests  60 passed (60)
```

### Reviewer concerns deferred to B1.B planning
- T3 Important #2: `lastInWindow` logs "most-recent" offset, not "most-relevant". Spec choice — flag B1.B brainstorm whether to switch to closest-by-`|ts_diff|`.
- T3 Important #3: `fs_candidates: []` on `time_window_miss` (no FS in window by definition). Flag B1.B whether to fall back to top-N closest fixtures across the day for tolerance-mining purposes.

### Reviewer concerns deferred to Bundle B4 (operational hygiene)
- T4 Important I1: tighten `getSamples(reason: string | undefined)` to `getSamples(reason: FailedSample["reason"] | undefined)` for compile-time safety at call sites.
- T4 Important I2: defend against array-form repeated query params (`?sport=a&sport=b`) — current code returns 200 with `sport: [...]` echo.

## Pre-deploy file inventory (mirror → scraper-vps)

Files to scp from mirror to `scraper-vps:~/flashscore-scraper/src/`:

| Source | Destination | Type |
|--------|-------------|------|
| `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/src/sample-collector.ts` | `~/flashscore-scraper/src/sample-collector.ts` | NEW |
| `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/src/normalize.ts` | `~/flashscore-scraper/src/normalize.ts` | MODIFY |
| `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/src/search.ts` | `~/flashscore-scraper/src/search.ts` | MODIFY |
| `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/src/server.ts` | `~/flashscore-scraper/src/server.ts` | MODIFY |
| `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/src/cache.ts` | `~/flashscore-scraper/src/cache.ts` | MODIFY (test infra: `clear()` method) |

Files to scp to `~/flashscore-scraper/src/__tests__/`:

| Source | Destination | Type |
|--------|-------------|------|
| `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/src/__tests__/sample-collector.test.ts` | `~/flashscore-scraper/src/__tests__/sample-collector.test.ts` | NEW |
| `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/src/__tests__/normalize.test.ts` | `~/flashscore-scraper/src/__tests__/normalize.test.ts` | MODIFY (+1 regression test) |
| `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/src/__tests__/search.test.ts` | `~/flashscore-scraper/src/__tests__/search.test.ts` | MODIFY (+4 tests) |

NOTE: all VPS files have already been scp'd during the subagent dev cycle (each subagent test-on-VPS step kept VPS in sync). T6 will re-confirm + run authoritative deploy build/restart.

**Backup of pre-B1.A v2 state**: VPS has `~/flashscore-scraper/src/normalize.ts.bak-T3-1778073900` (preserved from FS-id v2 deploy) — additional rollback safety beyond the artifact mirror at `docs/superpowers/artifacts/2026-05-06-fs-id-resolver-v2/scraper/`.

## Deploy log

[populated by T6]

## Post-window validation (T+60 to T+120 min)

[populated by T7]
