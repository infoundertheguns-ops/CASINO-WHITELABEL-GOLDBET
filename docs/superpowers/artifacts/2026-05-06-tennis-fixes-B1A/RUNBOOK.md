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

## Pre-deploy validation (local)

[populated by T5]

## Pre-deploy file inventory (mirror → scraper-vps)

[populated by T5]

## Deploy log

[populated by T6]

## Post-window validation (T+60 to T+120 min)

[populated by T7]
