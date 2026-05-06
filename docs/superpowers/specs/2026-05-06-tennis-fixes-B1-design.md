# Design — Tennis fixes B1 (sample logging + per-sport time-window + tennis normalize)

**Status**: Design — pending implementation plan
**Date**: 2026-05-06
**Author**: pair (user + Claude)
**Branch**: `feature/plan-d-settlement-d1`
**Predecessors**:
- `2026-05-06-fs-id-resolver-v2-design.md` (FS-id resolver v2, shipped 2026-05-06 — moved global fs-id 34.1%→41.3%, recovered 6.120 hidden markets)
- Plan D follow-up registry items #1 (P0 tennis normalize) + #4 (P2 time-window per-sport)
**Related**:
- `flashscore-scraper/src/normalize.ts` (rewritten 2026-05-06, 86 LoC token-based)
- `flashscore-scraper/src/search.ts` (telemetry rich endpoint shipped 2026-05-06)
- `services/odds-api-ingester/src/resolve-flashscore-id.ts` (caller, untouched here)

## Problem

After the FS-id resolver v2 ship (2026-05-06), telemetry by_sport reveals tennis is the worst-performing sport:

| Sport      | ok    | feed_empty | no_match_time | no_match_name | Total reqs | ok rate |
|------------|------:|-----------:|--------------:|--------------:|-----------:|--------:|
| football   |   386 |       1061 |           394 |           985 |       2826 |   13.7% |
| basketball |    42 |        261 |           118 |            99 |        520 |    8.1% |
| **tennis** |   **29** |    **1092** |        **812** |        **962** |   **2895** |  **1.0%** |
| baseball   |    19 |        217 |           602 |            42 |        880 |    2.2% |
| handball   |    36 |        250 |            23 |            30 |        339 |   10.6% |

Tennis has **3 failure modes balanced** (~1000 each), unlike football where `feed_empty` dominates. Two are addressable by us:
- `no_match_time=812` (28% of tennis reqs vs football 14%) — tennis matches start when previous match ends; ±10min window is too tight
- `no_match_name=962` (33% of tennis reqs) — current `NOISE_TOKENS` are football-derived (fc, ac, gks, hnk, …); zero tennis-specific patterns (player initials, country codes, qualifier markers)

`feed_empty=1092` is a genuine FS upstream gap and out of scope.

## Why this matters

Tennis: 495/2.764 events have fs_id (17.9%, lowest non-zero sport). 2.269 tennis events with NULL fs_id → all stats+player markets hidden by `v_player_markets` Phase 1.5 filter. This is the largest residual cluster after football.

Cascading benefit on baseball: `no_match_time=602` (68% of all baseball failures!). Baseball innings drift — a +20min tolerance likely recovers more baseball than tennis name fixes recover tennis.

## What we are NOT doing here

- Modify `v_player_markets` filter — policy is correct.
- Modify resolver helper `resolve-flashscore-id.ts` — caller side untouched.
- Change feed_empty handling — genuine FS gap, no normalize fix possible.
- Mine team-aliases.json — separate Bundle (B3) with same instrumentation.
- Address darts/boxing/mma/snooker baselines — separate Bundle (B2).
- Add new sport_id mappings — out of scope (B2).

## Design rationale: instrument-then-fix

Memory lesson from 2026-05-06: T4 telemetry deployed *same session* as T3 normalize rewrite revealed `feed_empty` dominance, not name issues. Without telemetry first, we'd have shipped guesswork. Same risk here for tennis name patterns: we have **zero ground-truth samples** of failed tennis name strings.

We split B1 into two phases:

**B1.A — Instrumentation deploy** (this spec, concrete)
- Add sample collector ring buffer (500/sport) capturing rich records of `name_mismatch` + `time_window_miss` failures with FS candidates that almost matched.
- Expose `GET /stats/samples` endpoint.
- Add per-sport time-window map (tennis +20min, baseball +20min, football unchanged).
- Add per-sport NOISE/RESERVE *scaffolding* with `_default` populated as today (no behavior change for the name filter).
- Deploy. Wait 1-2h prod traffic.

**B1.B — Tennis normalize fix** (deferred, principled)
- Read `/stats/samples?sport=tennis&reason=name_mismatch&limit=200`.
- Categorize patterns (country codes, qualifier markers, doubles separator handling, etc).
- Populate `NOISE_TOKENS_BY_SPORT.tennis` and `RESERVE_MARKERS_BY_SPORT.tennis` with concrete additions.
- TDD with real samples as fixtures.
- Deploy.

## B1.A architecture

### File changes

```
flashscore-scraper/src/
├── normalize.ts          (modified: per-sport NOISE/RESERVE maps with _default)
├── search.ts             (modified: TIME_TOLERANCE_BY_SPORT, sample collector hook)
├── server.ts             (modified: GET /stats/samples endpoint)
├── sample-collector.ts   (NEW: ring buffer, ~80 LoC)
└── __tests__/
    ├── sample-collector.test.ts   (NEW: 6 tests)
    ├── search.test.ts             (extended: 3 new tests)
    └── normalize.test.ts          (extended: 1 regression test)
```

All other files (parser, cache, flashscore-client, types) untouched.

### Sample record shape

```ts
interface FailedSample {
  ts: number;                    // unix ms
  sport_slug: string;
  query_home: string;            // raw bookmaker string, pre-normalize
  query_away: string;
  starts_at: string;             // ISO from query
  reason: "name_mismatch" | "time_window_miss";
  fs_candidates: Array<{
    home: string;                // raw FS string, pre-normalize
    away: string;
    ts_diff_sec: number;         // delta from query starts_at (sign indicates direction)
  }>;                            // up to 5, taken from inWindow before name filter
}
```

`feed_empty` failures are *not* recorded (no FS candidates to compare → nothing to diagnose).

For `time_window_miss` records, `fs_candidates` is `[]` by definition (nothing was in window). We still record the sample to expose temporal drift patterns per sport.

### Ring buffer (sample-collector.ts)

```ts
class SampleCollector {
  private buffers = new Map<string, FailedSample[]>();
  private readonly cap = 500;

  record(sample: FailedSample): void {
    let buf = this.buffers.get(sample.sport_slug);
    if (!buf) { buf = []; this.buffers.set(sample.sport_slug, buf); }
    buf.push(sample);
    if (buf.length > this.cap) buf.shift();
  }

  getSamples(sportSlug: string, reason: string | undefined, limit: number): FailedSample[] {
    const buf = this.buffers.get(sportSlug) ?? [];
    const filtered = reason ? buf.filter(s => s.reason === reason) : buf;
    const clamped = Math.max(1, Math.min(500, limit));
    return filtered.slice(-clamped).reverse();   // most-recent first
  }
}
export const sampleCollector = new SampleCollector();
```

- FIFO via `push`+`shift` (O(n) shift acceptable at cap=500, n=1 push/req).
- Process-wide singleton, lifetime tied to scraper process. Reset on restart (same as search cache).
- Internal `try/catch` in `record()` — never throws upward; degrades to no-op on allocation failure.

### Endpoint (server.ts)

```ts
app.get("/stats/samples", async (req, reply) => {
  const q = req.query as Record<string, string>;
  if (!q.sport) return reply.code(400).send({ error: "missing_param", param: "sport" });
  const limit = q.limit ? Number(q.limit) : 100;
  const reason = q.reason && (q.reason === "name_mismatch" || q.reason === "time_window_miss")
    ? q.reason : undefined;
  const samples = sampleCollector.getSamples(q.sport, reason, isFinite(limit) ? limit : 100);
  return reply.code(200).send({
    sport: q.sport,
    reason: reason ?? "all",
    count: samples.length,
    samples,
  });
});
```

Auth via existing `x-api-key` middleware (same as `/search`). No new auth required.

Invalid `reason` → silently ignored (filter pass-through). Out-of-range `limit` → silently clamped. No 500s.

### Per-sport time tolerance (search.ts)

```ts
const TIME_TOLERANCE_BY_SPORT: Record<string, number> = {
  _default: 10 * 60,
  tennis:    20 * 60,
  baseball:  20 * 60,
};
function tolFor(slug: string): number {
  return TIME_TOLERANCE_BY_SPORT[slug] ?? TIME_TOLERANCE_BY_SPORT._default;
}
```

Replace single constant `TIME_TOLERANCE_SEC` lookups inside `searchEvent` with `tolFor(input.sportSlug)`.

**Symmetric expansion**: tolerance applies as `Math.abs(f.timestamp - eventTs) <= tolFor(slug)` — same predicate as today, only the threshold is sport-aware. ±20min for tennis/baseball means events scheduled up to 20min before *or* after the bookmaker's announced start are accepted candidates. Asymmetric expansion is *not* part of this design.

### Per-sport NOISE/RESERVE scaffold (normalize.ts)

```ts
const _DEFAULT_NOISE = new Set([...current 30 tokens...]);
const _DEFAULT_RESERVE = new Set([...current 11 markers...]);

const NOISE_TOKENS_BY_SPORT: Record<string, Set<string>> = {
  _default: _DEFAULT_NOISE,
  // tennis, baseball populated in B1.B
};
const RESERVE_MARKERS_BY_SPORT: Record<string, Set<string>> = {
  _default: _DEFAULT_RESERVE,
  // tennis, baseball populated in B1.B
};

function noiseFor(slug: string): Set<string> {
  return NOISE_TOKENS_BY_SPORT[slug] ?? NOISE_TOKENS_BY_SPORT._default;
}
function reserveFor(slug: string): Set<string> {
  return RESERVE_MARKERS_BY_SPORT[slug] ?? RESERVE_MARKERS_BY_SPORT._default;
}
```

`tokenize` and `normalizeTeam` accept `sportSlug` and look up via these helpers. **Behavior parity with current code: B1.A ships with no sport overrides → `_default` always wins → identical token output to the v2 normalize.** Only time-window and sample logging change runtime behavior.

### Search.ts integration point

Modify only the trailing branch of `searchEvent` (where we currently return 404):

```ts
const reason = !anyFixturesLoaded ? "feed_empty"
             : !anyInTimeWindow ? "time_window_miss"
             : "name_mismatch";

if (reason !== "feed_empty") {
  sampleCollector.record({
    ts: Date.now(),
    sport_slug: input.sportSlug,
    query_home: input.home,
    query_away: input.away,
    starts_at: input.startsAt,
    reason,
    fs_candidates: lastInWindow.slice(0, 5).map(f => ({
      home: f.homeTeam,
      away: f.awayTeam,
      ts_diff_sec: f.timestamp - eventTs,
    })),
  });
}

return { status: 404, body: { error: "no_match", reason } };
```

`lastInWindow` mechanism — explicit choice: **declare a `let lastInWindow: FlashscoreFixture[] = []` before the day-offset loop and reassign each iteration with the current iteration's `inWindow` array (overwrite, not accumulate)**. Rationale: the existing loop returns `200` from inside the loop on first match, so we only reach the trailing 404 branch when all offsets exhausted. The "last" iteration's window is the most temporally relevant for sample diagnosis (closest to query date). Accumulating across offsets would inflate `fs_candidates` with day±1 fixtures that the matcher already considered and rejected by `time_window_miss`. Zero impact on the success path.

## Error handling

| Failure mode | Behavior |
|--------------|----------|
| Sample collector allocation OOM | `try/catch` in `record()` → `console.warn`, no rethrow. Search path returns normally. |
| `/stats/samples` invalid `sport` param | 400 with `{error: "missing_param"}`. |
| `/stats/samples` invalid `reason` | Silent ignore (filter pass-through). |
| `/stats/samples` invalid `limit` | Silent clamp to [1, 500]. |
| Concurrent `record()` from multiple `searchEvent` calls | Node.js is single-threaded; `push`/`shift` are atomic relative to event loop. No locks needed. |
| Process restart | Buffers reset to empty (acceptable; we expect 1-2h windows of capture). |

## Testing strategy

**TDD ordering**: write failing tests first, then implementation. Already proven workflow from FS-id v2 T2/T3.

### sample-collector.test.ts (NEW, 6 tests)

1. `record` adds to buffer keyed by sport_slug
2. `record` shifts FIFO when buffer exceeds cap (501st push removes oldest)
3. `getSamples(slug, reason, limit)` filters by reason
4. `getSamples` clamps limit to [1, 500]
5. `getSamples` returns most-recent first
6. `getSamples` returns `[]` for unknown sport_slug (no error)

### search.test.ts (extended, 3 new tests)

7. Tennis fixture in window at `+15min` → match found (would miss with 10min default; fixture verifies 20min tolerance)
8. `name_mismatch` outcome triggers `sampleCollector.record(...)` with rich record (mock collector, assert payload shape)
9. `feed_empty` outcome does NOT trigger `sampleCollector.record` (mock collector, assert zero calls)

### normalize.test.ts (extended, 1 regression test)

10. `normalizeTeam("Manchester United FC", "tennis")` → identical output to `normalizeTeam("Manchester United FC", "football")` because tennis NOISE/RESERVE not populated yet → `_default` fallback. Guards against accidental B1.B regression.

Total new+extended: 10 tests. With existing 5 tests from v2: 15 unit tests in scraper.

## Deploy plan (B1.A)

1. **Local validation**:
   - `pnpm --filter flashscore-scraper test` → 15/15 green
   - `pnpm --filter flashscore-scraper run typecheck` → 0 errors
2. **Mirror to artifacts**: `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/src/{normalize.ts,search.ts,server.ts,sample-collector.ts,__tests__/...}` (`flashscore-scraper` is non-git, mirror pattern from FS-id v2 RUNBOOK).
3. **Commit mirror + spec + plan + RUNBOOK** to `feature/plan-d-settlement-d1`.
4. **VPS deploy**:
   - `scp` source files to `scraper-vps:~/flashscore-scraper/src/`
   - `ssh scraper-vps "cd ~/flashscore-scraper && pnpm build && systemctl restart flashscore-scraper.service"`
5. **Smoke tests** (on VPS):
   - `curl -H "x-api-key: $K" localhost:8090/stats` → 200, by_sport counters reset (uptime_sec ≤ 30)
   - `curl -H "x-api-key: $K" "localhost:8090/stats/samples?sport=tennis&limit=5"` → 200 with `samples: []` initially
   - `curl -H "x-api-key: $K" "localhost:8090/search?sport_slug=tennis&starts_at=...&home=...&away=..."` → triggers a real query, then re-curl `/stats/samples` to confirm record appearance.
6. **Wait window**: 1-2h prod traffic accumulation. Target acceptance:
   - `/stats/samples?sport=tennis&reason=name_mismatch` → ≥100 records
   - `/stats by_sport.tennis.no_match_time` → strictly lower share than baseline (proves time-window 20min works)
   - `/stats by_sport.tennis.ok` → equal or higher (no regression from time-window expansion)

## Rollback

Hard trigger: `/stats by_sport.tennis.ok` strictly *lower* than baseline snapshot. **Baseline is sampled immediately pre-deploy** by curling `/stats` on the running scraper — not the table values in this spec, which were taken during the v2 deploy and may have drifted as traffic continued. The plan must include a "T-0 baseline capture" step before the restart.

Allowing a failed deploy to run risks producing reclassified misses that pollute samples we'll later mine in B1.B.

Steps (`flashscore-scraper` is **non-git** on the VPS — git stash is inapplicable):
```bash
# Reverse-scp from prior-good mirror back into ~/flashscore-scraper/src/
scp docs/superpowers/artifacts/2026-05-06-fs-id-resolver-v2/scraper/src/normalize.ts \
    docs/superpowers/artifacts/2026-05-06-fs-id-resolver-v2/scraper/src/search.ts \
    docs/superpowers/artifacts/2026-05-06-fs-id-resolver-v2/scraper/src/server.ts \
    scraper-vps:~/flashscore-scraper/src/
ssh scraper-vps "rm -f ~/flashscore-scraper/src/sample-collector.ts \
                       ~/flashscore-scraper/src/__tests__/sample-collector.test.ts && \
                cd ~/flashscore-scraper && pnpm build && systemctl restart flashscore-scraper.service"
```

The "previous-good" state is the v2 mirror at `docs/superpowers/artifacts/2026-05-06-fs-id-resolver-v2/scraper/`. Post-rollback verification: `curl /stats` should show no `samples` endpoint (404) and pre-B1.A by_sport counters resuming.

## Success criteria — B1.A

**T-0 baseline capture** required before deploy: `curl -H "x-api-key: $K" localhost:8090/stats > baseline.json` on scraper-vps. All "vs baseline" comparisons below use this captured snapshot, not the table numbers in the Problem section.

| Criterion | Threshold | Source |
|-----------|-----------|--------|
| Tests pass | 15/15 green | `pnpm test` |
| Type check | 0 errors | `pnpm typecheck` |
| `/stats/samples` endpoint live | 200 with array shape | curl post-deploy |
| Sample accumulation tennis (1-2h) | ≥100 `name_mismatch` records | `/stats/samples?sport=tennis&reason=name_mismatch&limit=200` |
| Sample accumulation baseball (1-2h) | ≥30 records (any reason) | `/stats/samples?sport=baseball&limit=100` |
| Tennis time-window improvement | `tennis.no_match_time / tennis.total` strictly lower vs T-0 baseline | `/stats by_sport.tennis` compared to baseline.json |
| No `ok` regression | `tennis.ok / tennis.total` ≥ T-0 baseline ratio | idem |
| Memory delta | scraper RSS ≤ +5MB post-deploy | `ps aux \| grep flashscore` |
| Sample collector no-throw | 0 `console.warn` from collector in 1h logs | `journalctl -u flashscore-scraper` |

If criteria 4 and 5 met → enter B1.B. Otherwise extend wait window or investigate why traffic is low.

## B1.B — pending sample analysis

After B1.A success criteria met, B1.B becomes a small follow-up spec:

1. Pull samples: `curl /stats/samples?sport=tennis&reason=name_mismatch&limit=200 > tennis-samples.jsonl`
2. Analyze patterns offline (manual review or quick script). Categorize:
   - Country code suffixes `(USA)`, `(ITA)` etc — strip via regex `\([A-Z]{2,3}\)`
   - Qualifier markers `(Q)`, `Q1`, `Q2`, `LL`, `WC`
   - Player surname-first vs first-name-first variants
   - Doubles separator inconsistency (`/`, ` & `, `,`, ` and `)
   - Other tournament-specific patterns
3. Populate `NOISE_TOKENS_BY_SPORT.tennis` and (if needed) `RESERVE_MARKERS_BY_SPORT.tennis` based on observed frequency.
4. Add tennis-specific test fixtures pulled from real samples.
5. Deploy. Smoke check: `/stats by_sport.tennis.no_match_name` strictly decreased.

This will be its own brainstorm + spec + plan + impl cycle, but scoped much smaller (no scaffolding to design — the data shape is the spec).

## Open questions

None at this writing — sample data shape and time-window thresholds are conservative best guesses; we'll validate B1.A telemetry empirically before committing to B1.B.

## File inventory summary

| File | Action | LoC delta |
|------|--------|-----------|
| `flashscore-scraper/src/sample-collector.ts` | NEW | +80 |
| `flashscore-scraper/src/normalize.ts` | modify | +20 (scaffold maps + helpers) |
| `flashscore-scraper/src/search.ts` | modify | +15 (TIME_TOLERANCE_BY_SPORT + collector hook + lastInWindow ref) |
| `flashscore-scraper/src/server.ts` | modify | +20 (/stats/samples endpoint) |
| `flashscore-scraper/src/__tests__/sample-collector.test.ts` | NEW | +120 |
| `flashscore-scraper/src/__tests__/search.test.ts` | extend | +60 |
| `flashscore-scraper/src/__tests__/normalize.test.ts` | extend | +15 |
| `docs/superpowers/specs/2026-05-06-tennis-fixes-B1-design.md` | NEW (this file) | — |
| `docs/superpowers/plans/2026-05-06-tennis-fixes-B1.md` | NEW (next step) | — |
| `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/RUNBOOK.md` | NEW (during impl) | — |
| `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/**` | NEW mirror | — |

Total LoC change in scraper source: **~330** (180 prod + 195 test).
