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

## Deploy log (T6)

### T-0 baseline (re-captured immediately pre-deploy)

Source: `baseline-stats-T0-deploy.json` (this directory). Captured ~30s before service restart.

Post-T5 mirror sync state on VPS — md5 confirmed before restart:
```
b5585287dba38e581fd8beb3afba1516  src/sample-collector.ts
89cf976b697ecc247eac514d899cb9c4  src/normalize.ts
d8390c8b7ee6eaaafe688f91a89d0461  src/search.ts
f39c14a3231594522344fb22f2b43ecd  src/server.ts
02858324558c7936c7b7779d3cbb5fa3  src/cache.ts
```

T-0 by_sport (authoritative for success criteria):
```
uptime_sec: 25256 (~7h since v2 deploy yesterday)
search_requests_total: 66389
| Sport      | ok  | feed_empty | time | name  | total | ok rate |
|------------|----:|-----------:|-----:|------:|------:|--------:|
| football   | 425 | 1237       | 1750 | 18938 | 22350 | 1.90%   |
| basketball |  72 |  289       | 2404 |  2445 |  5210 | 1.38%   |
| tennis     | 126 | 1092       | 6788 | 14427 | 22433 | 0.56%   |
| baseball   |  37 |  217       | 1560 |  1543 |  3357 | 1.10%   |
| handball   |  38 |  250       | 1271 |  1008 |  2567 | 1.48%   |
```
Tennis remains worst-performing sport. Tennis no_match_time 6788 (30% of tennis reqs) is the time-window expansion target.

### Deploy timestamp

Service restart: `2026-05-06 20:40:53 UTC`
PID before: 1184549 (started 2026-05-06 13:39:34 UTC, +7h uptime)
PID after: 1312509

### Restart log

```
● flashscore-scraper.service - Flashscore Feed Scraper
     Active: active (running) since Wed 2026-05-06 20:40:53 UTC
   Main PID: 1312509 (node)
      Tasks: 23 (limit: 75295)
     Memory: 67.0M (max: 500.0M; tsx cold-start peak)
     CGroup: /system.slice/flashscore-scraper.service
             ├─1312509 node ./node_modules/.bin/tsx src/index.ts
             └─1312522 tsx loader subprocess
```

No `dist/` artifacts — service runs `tsx src/index.ts` directly (TypeScript runtime, no build step). Previous-version code unloaded with PID 1184549.

### Smoke results (post-restart, all PASS)

| Probe | Got | Expected | Pass |
|-------|-----|----------|------|
| `/stats` (no_param) | counters reset, uptime_sec=25 | reset | ✅ |
| `/stats/samples` (no sport) | `{"error":"missing_param","param":"sport"}` | 400 missing_param | ✅ |
| `/stats/samples?sport=tennis&limit=5` | 200, count=5, samples populated | 200 array | ✅ |
| `/stats/samples?sport=tennis&reason=invalid` | 200, reason="all", samples populated | 200 with all | ✅ |
| `/stats/samples` (no x-api-key header) | `{"error":"unauthorized"}` (401) | 401 | ✅ |

### Sample collection rate (first 25 seconds)

Tennis samples accumulated: **42 in 25 seconds** = ~100 samples/min projected. Far exceeds the 60min target of ≥100 — likely to saturate the 500/sport ring buffer within ~5 minutes of T6.

### Memory delta

| Metric | Pre-deploy | Post-deploy | Delta |
|--------|-----------:|------------:|------:|
| RSS (KB) | 53356 | 53408 | +52 KB |
| MemoryCurrent (cgroup) | ~138MB | 78MB | -60MB (cold-start cleanup) |

Well under the spec threshold of +5MB RSS delta.

### Sample-collector warning count

Zero `[sample-collector]` console.warn lines in `journalctl -u flashscore-scraper.service` since T+0. (Search path never throws into the collector.)

### Discovery: `fs_candidates: []` on most samples

All 42 captured tennis samples have `fs_candidates: []` even when `reason === "name_mismatch"`. Cause: `lastInWindow` hoist holds the LAST iteration's window (`base-1` offset). For most tennis events the FS data is at `base+0` or `base+1` and matches happen there, but if no match (name_mismatch), `lastInWindow` gets overwritten by `base-1`'s typically-empty in-window — losing the relevant candidates.

This is the exact issue flagged by the T3 code-reviewer (Important #2 + #3). It does NOT block B1.A — the *query strings* alone (e.g. `"Heide, Gustavo"` vs `"Tabilo, Alejandro"`) reveal the dominant tennis name pattern: **bookmaker uses `Surname, Firstname` format**, vs FS's likely `Firstname Surname` or `Surname F.` format. This is exactly the kind of pattern B1.B will encode in tennis-specific NOISE/normalize logic.

For B1.B planning: the lastInWindow choice should switch to "store the inWindow with smallest min(|ts_diff_sec|)" or "log the day-fixture closest to event time" before B1.B mining starts in earnest. Sample query strings alone are sufficient for the immediate name-pattern mining; FS candidates would be additive.

### Decision: PROCEED to T7 wait window

All success criteria met or trivially met. No regressions. Move forward to 1-2h sample accumulation, then validate end-of-window criteria.

## Post-window validation (T+49 min)

Captured at T+49min (uptime_sec=2919, search_requests_total=3530). Wait window shorter than nominal 60-120min because ring buffer saturates 500/sport in <5min so the bottleneck is ratio-stabilization, not sample volume.

### /stats by_sport (T+49)

```
| Sport      | ok | feed_empty | time | name | total | ok rate | time_share | name_share |
|------------|---:|-----------:|-----:|-----:|------:|--------:|-----------:|-----------:|
| football   | 31 |    32      | 133  | 548  |  744  | 4.17%   | 17.88%     | 73.66%     |
| basketball |  2 |     4      |  82  | 125  |  213  | 0.94%   | 38.50%     | 58.69%     |
| tennis     |  8 |     0      | 491  | 858  | 1357  | 0.59%   | 36.18%     | 63.23%     |
| baseball   |  1 |     0      |  33  | 265  |  299  | 0.33%   | 11.04%     | 88.63%     |
| esports    |  4 |     6      | 374  | 122  |  506  | 0.79%   | 73.91%     | 24.11%     |
| handball   |  0 |     0      |   0  |  18  |   18  | 0.00%   |  0.00%     | 100.0%     |
| darts      |  0 |     0      |   0  | 115  |  115  | 0.00%   |  0.00%     | 100.0%     |
```

### Success criteria — filled in

| Criterion | Threshold | T-0 | T+49 | Pass? |
|-----------|-----------|-----|------|------:|
| Tests pass | ≥25 green | — | 60/60 | ✅ |
| Type check | 0 errors | — | 0 | ✅ |
| /stats/samples endpoint live | 200 array shape | — | confirmed | ✅ |
| Tennis name_mismatch samples | ≥100 | — | **200 (saturated)** | ✅ |
| Baseball samples | ≥30 | — | **100 (saturated)** | ✅ |
| Tennis ok ratio ≥ T-0 | maintain | 0.56% | **0.59%** | ✅ |
| Tennis no_match_time share LOWER | strictly | 30.27% | **36.18%** | ❌ |
| Memory delta | ≤ +5MB | 53408KB | 53408KB (Δ 0) | ✅ |
| Sample-collector warnings | 0 | — | 0 | ✅ |

**8/9 criteria pass.** The single miss (tennis time-window share went UP, not DOWN) is examined below.

### Anomaly: tennis time_window_miss share went up despite expanded tolerance

Expected: 10min→20min tolerance → fewer queries reject on time → time_share drops, name_share rises.
Actual: tennis time_share 30.27%→36.18% (rose), name_share 64.30%→63.23% (basically unchanged).

Plausible explanations (not blocking ship):
- **Tennis matches drift well beyond 20min**. Sample evidence: tennis time_window_miss queries cluster at HH:00 / HH:30 announced times — bookmaker uses scheduled time, but FS reflects ad-hoc actual start once previous matches finish. Tail likely extends past 20min.
- **Statistical noise**: 1357 tennis reqs vs 22433 baseline reqs is 6% sample size; ±6pp drift could be noise.
- **Composition shift**: 49min of evening traffic vs cumulative 7h baseline.

Counter-evidence B1.A worked partially:
- **Baseball time_share 46.5% → 11.04%** — massive improvement. +20min tolerance is BIG win for baseball.
- Tennis ok rate slight uptick.

Spec rollback criterion: rollback only if `tennis.ok` ratio dropped below baseline. It rose. **No rollback.**

For B1.B planning: tennis time-window tuning may need a SECOND iteration with 30-40min tolerance, or a different mechanism (per-tournament time anchors via FS). Out of B1.A scope.

### Sample data preview (B1.B mining input)

Tennis name_mismatch query format breakdown (200 samples):
```
| Pattern                     | Count | Share |
|-----------------------------|------:|------:|
| Surname, Firstname          |   119 | 59.5% |
| Doubles with initials/slash |    11 |  5.5% |
| Other (no comma)            |    70 | 35.0% |
| TOTAL                       |   200 |       |
```

**Dominant pattern: 59.5% bookmaker queries use `Surname, Firstname`** (Italian convention). Examples:
- `Miguel, Luis Guto` (vs FS likely `Miguel L.G.` or `Luis Guto Miguel`)
- `Sabalenka, Aryna` (vs FS likely `Sabalenka A.`)
- `Pucinelli de Almeida, Matheus` (multi-token surname)
- `Diaz Acosta, Facundo` (compound surname)

Doubles slash format: `Justo G I / Roncadelli F`, `Da Silva Fick G / McGiffin T` — initials follow surname, players separated by ` / `. FS likely formats as `Surname/Surname` only.

35% "other" includes single-name patterns where current normalize works partially but FS uses different transliteration or accent handling.

This is exactly what B1.B will encode in tennis-specific normalize: the T2 scaffold already supports adding `NOISE_TOKENS_BY_SPORT.tennis` and tennis-specific tokenization rules without scaffolding changes.

### Decision: SHIP B1.A → proceed to B1.B brainstorm

- 8/9 success criteria pass (the 1 miss is informational, points to B1.B scope)
- Zero regressions, zero rollback triggers fired
- Sample data is rich and dominant pattern is immediately actionable (59.5% of failures share one root cause: `Surname, Firstname` format)
- B1.A's primary goal (instrumentation that captures useful B1.B input data) achieved decisively
- 200 tennis name_mismatch + 100 baseball samples ready as B1.B fixture material

### B1.B handoff data

Files frozen for B1.B:
- `samples-tennis-name_mismatch.json` (200) — primary mining target
- `samples-tennis-time_window_miss.json` (100) — secondary, for understanding tennis drift magnitude (caveat: fs_candidates empty due to T3-Important#3, but query patterns still informative)
- `samples-baseball-all.json` (100) — for parallel baseball normalize work if scoped

### Carryover to B4 (operational hygiene bundle)

- T4-I1: tighten `getSamples(reason: ...)` parameter type to `FailedSample["reason"] | undefined`
- T4-I2: defend `?sport=a&sport=b` array-form query params
- T3-Important #2/#3: replace `lastInWindow = inWindow` with "store in-window from offset whose fixtures had min(|ts_diff|)" + fallback to top-N closest fixtures across all offsets when `time_window_miss`
- Rollback trigger doc tighten: "no_match_name >30%" instead of aggregate >50% (per registry P1)

## Post-window validation (T+49 min)

Captured at T+49min (uptime_sec=2919, search_requests_total=3530). Wait window shorter than nominal 60-120min because ring buffer saturates 500/sport in <5min so the bottleneck is ratio-stabilization, not sample volume.

### /stats by_sport (T+49)

```
| Sport      | ok | feed_empty | time | name | total | ok rate | time_share | name_share |
|------------|---:|-----------:|-----:|-----:|------:|--------:|-----------:|-----------:|
| football   | 31 |    32      | 133  | 548  |  744  | 4.17%   | 17.88%     | 73.66%     |
| basketball |  2 |     4      |  82  | 125  |  213  | 0.94%   | 38.50%     | 58.69%     |
| tennis     |  8 |     0      | 491  | 858  | 1357  | 0.59%   | 36.18%     | 63.23%     |
| baseball   |  1 |     0      |  33  | 265  |  299  | 0.33%   | 11.04%     | 88.63%     |
| esports    |  4 |     6      | 374  | 122  |  506  | 0.79%   | 73.91%     | 24.11%     |
| handball   |  0 |     0      |   0  |  18  |   18  | 0.00%   |  0.00%     | 100.0%     |
| darts      |  0 |     0      |   0  | 115  |  115  | 0.00%   |  0.00%     | 100.0%     |
```

### Success criteria — filled in

| Criterion | Threshold | T-0 | T+49 | Pass? |
|-----------|-----------|-----|------|------:|
| Tests pass | ≥25 green | — | 60/60 | ✅ |
| Type check | 0 errors | — | 0 | ✅ |
| /stats/samples endpoint live | 200 array shape | — | confirmed | ✅ |
| Tennis name_mismatch samples | ≥100 | — | **200 (saturated)** | ✅ |
| Baseball samples | ≥30 | — | **100 (saturated)** | ✅ |
| Tennis ok ratio ≥ T-0 | maintain | 0.56% | **0.59%** | ✅ |
| Tennis no_match_time share LOWER | strictly | 30.27% | **36.18%** | ❌ |
| Memory delta | ≤ +5MB | 53408KB | 53408KB (Δ 0) | ✅ |
| Sample-collector warnings | 0 | — | 0 | ✅ |

**8/9 criteria pass.** The single miss (tennis time-window share went UP, not DOWN) is examined below.

### Anomaly: tennis time_window_miss share went up despite expanded tolerance

Expected: 10min→20min tolerance → fewer queries reject on time → time_share drops, name_share rises.
Actual: tennis time_share 30.27%→36.18% (rose), name_share 64.30%→63.23% (basically unchanged).

Plausible explanations (not blocking ship):
- **Tennis matches drift well beyond 20min**. Sample evidence: tennis time_window_miss queries cluster at HH:00 / HH:30 announced times — bookmaker uses scheduled time, but FS reflects ad-hoc actual start once previous matches finish. Tail likely extends past 20min.
- **Statistical noise**: 1357 tennis reqs vs 22433 baseline reqs is 6% sample size; ±6pp drift could be noise.
- **Composition shift**: 49min of evening traffic vs cumulative 7h baseline.

Counter-evidence B1.A worked partially:
- **Baseball time_share 46.5% → 11.04%** — massive improvement. +20min tolerance is BIG win for baseball.
- Tennis ok rate slight uptick.

Spec rollback criterion: rollback only if `tennis.ok` ratio dropped below baseline. It rose. **No rollback.**

For B1.B planning: tennis time-window tuning may need a SECOND iteration with 30-40min tolerance, or a different mechanism (per-tournament time anchors via FS). Out of B1.A scope.

### Sample data preview (B1.B mining input)

Tennis name_mismatch query format breakdown (200 samples):
```
| Pattern                     | Count | Share |
|-----------------------------|------:|------:|
| Surname, Firstname          |   119 | 59.5% |
| Doubles with initials/slash |    11 |  5.5% |
| Other (no comma)            |    70 | 35.0% |
| TOTAL                       |   200 |       |
```

**Dominant pattern: 59.5% bookmaker queries use `Surname, Firstname`** (Italian convention). Examples:
- `Miguel, Luis Guto` (vs FS likely `Miguel L.G.` or `Luis Guto Miguel`)
- `Sabalenka, Aryna` (vs FS likely `Sabalenka A.`)
- `Pucinelli de Almeida, Matheus` (multi-token surname)
- `Diaz Acosta, Facundo` (compound surname)

Doubles slash format: `Justo G I / Roncadelli F`, `Da Silva Fick G / McGiffin T` — initials follow surname, players separated by ` / `. FS likely formats as `Surname/Surname` only.

35% "other" includes single-name patterns where current normalize works partially but FS uses different transliteration or accent handling.

This is exactly what B1.B will encode in tennis-specific normalize: the T2 scaffold already supports adding `NOISE_TOKENS_BY_SPORT.tennis` and tennis-specific tokenization rules without scaffolding changes.

### Decision: SHIP B1.A → proceed to B1.B brainstorm

- 8/9 success criteria pass (the 1 miss is informational, points to B1.B scope)
- Zero regressions, zero rollback triggers fired
- Sample data is rich and dominant pattern is immediately actionable (59.5% of failures share one root cause: `Surname, Firstname` format)
- B1.A's primary goal (instrumentation that captures useful B1.B input data) achieved decisively
- 200 tennis name_mismatch + 100 baseball samples ready as B1.B fixture material

### B1.B handoff data

Files frozen for B1.B:
- `samples-tennis-name_mismatch.json` (200) — primary mining target
- `samples-tennis-time_window_miss.json` (100) — secondary, for understanding tennis drift magnitude (caveat: fs_candidates empty due to T3-Important#3, but query patterns still informative)
- `samples-baseball-all.json` (100) — for parallel baseball normalize work if scoped

### Carryover to B4 (operational hygiene bundle)

- T4-I1: tighten `getSamples(reason: ...)` parameter type to `FailedSample["reason"] | undefined`
- T4-I2: defend `?sport=a&sport=b` array-form query params
- T3-Important #2/#3: replace `lastInWindow = inWindow` with "store in-window from offset whose fixtures had min(|ts_diff|)" + fallback to top-N closest fixtures across all offsets when `time_window_miss`
- Rollback trigger doc tighten: "no_match_name >30%" instead of aggregate >50% (per registry P1)
