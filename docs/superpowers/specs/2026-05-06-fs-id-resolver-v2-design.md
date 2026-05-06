# Design — FS-id resolver v2 (sport_id fix + normalize rewrite + telemetry + backfill)

**Status**: Design — pending implementation plan
**Date**: 2026-05-06
**Author**: pair (user + Claude)
**Branch**: `feature/plan-d-settlement-d1`
**Predecessors**:
- `2026-04-30-fs-id-population-design.md` (Plan D #4 — original FS-id population, shipped 2026-05-01 with 3-step cascade resolver)
- Plan D registry follow-up T11 / B1 ("FS search 99.86% no_match rate" — flagged as non-blocking, now addressed)
**Related**: `v_player_markets` Phase 1.5 filter (mig 156); resolver helper `services/odds-api-ingester/src/resolve-flashscore-id.ts`

## Problem

Today `events_v2.flashscore_id` is NULL for **49.7%** of events (5.674 of 11.288). The Phase 1.5 filter in `v_player_markets` excludes stats and player markets on these events. Concrete impact (post-dedupe market_name × line × event):

| Sport | Stats hidden | Player hidden | Events affected |
|---|---:|---:|---|
| football | 30.415 / 116.141 (26%) | 3.424 / 11.399 (30%) | 880+286 / 758-2402 |
| baseball | 976 / 976 (100%) | 580 / 580 (100%) | 125+50 |
| basketball | — | 397 / 2.706 (15%) | 20 |
| ice-hockey, rugby, cricket | small (≤30 each) | small | small |
| **TOTAL** | **31.391 / 117.117 (27%)** | **4.431 / 14.999 (30%)** | **~7.346 events** |

**Total markets hidden by the filter: 35.822** (of which 33.839 = 95% are football, 1.556 are baseball).

### Two distinct root causes (discovered 2026-05-06)

**Root cause #1 — Sport ID mapping bug (baseball, handball, futsal)**

Both `flashscore-scraper/config.json` (push-loop) and `flashscore-scraper/src/sport-id-map.json` (search HTTP endpoint) have wrong FS sport IDs:

| Slug | Map says | FS reality | Symptom |
|---|---:|---:|---|
| baseball | 11 | 6 | sport_id=11 returns futsal feed → all baseball searches no_match 100% |
| handball / pallamano | 6 | 7 | sport_id=6 returns baseball feed → all handball searches mismatched |

Verified by direct probe: `GET https://local-global.flashscore.ninja/6/x/feed/f_11_1_3_it-it_1` returns futsal fixtures (Brasile LNF, Romania Liga I futsal, Russia Superliga futsal). `f_6_*` returns MLB. `f_7_*` returns handball.

Side effect: the push-loop has been fetching futsal under "baseball" and baseball under "pallamano" since deploy. Legacy `events` records with `flashscore_id` for sport_slug ∈ {baseball, handball} point to fixtures of other sports. They don't surface as false positives because the canonical-chain join (step 2 of resolver) requires team-name canonical match, and team names diverge entirely → step 2 never returns these records → no incorrect FS-id is written downstream.

**Root cause #2 — Name matching is woefully incomplete (football ~25% miss + others)**

Current `flashscore-scraper/src/normalize.ts` (22 LoC):
- `CLUB_SUFFIX_RE` only strips `fc|ac|cf|sc|sk|as|ss|usl|calcio`
- No prefix stripping (Eastern European: GKS, KKP, KF, FK, MFK, KS, BK, OFK, ZSK, NK, HNK, GNK, FFK, FCK, RFK)
- No women's marker handling (FS feed appends `" D"` to women's team names; odds-api lacks the signal entirely → guaranteed mismatch on every women's match)
- ALIAS dict has 10 entries — de facto unused
- `matchTeams(a, b)` is strict `===` — zero fuzzy / token-overlap

Empirical evidence (12-sample probe of unresolved football events, 2026-05-06):

| odds-api home / away | FS feed actual | Pattern |
|---|---|---|
| GKS Katowice / KKP Stomilanki Olsztyn | Katowice D / Stomilanki Olsztyn D | prefix + women's `" D"` |
| FC Prishtina / KF Prishtina E Re | Prishtina / Prishtina e Re | FC/KF prefix + case |
| AS Muhanga / Rayon Sports FC | Muhanga / Rayon Sport | AS prefix + plural |
| KF Shkendija Haracine / Shkendija Tetovo | Shkendija Haracine / Shkendija | KF prefix + city qualifier |

All 12 samples returned 404 `no_match` despite teams being present in the feed.

### Search endpoint health

`GET /search/stats` since deploy (~5 days uptime):
- `search_requests_total`: 949.334
- `no_match_count`: 948.812 → **99.94% failure rate**
- The "55% global resolve rate" cited in prior memory was step 1+2 (legacy_direct + canonical_chain) only. Step 3 (search HTTP) has been a no-op.

## Goal

Recover ~70-85% of the 35.822 hidden markets. Concretely:

| Metric | Current | Target |
|---|---:|---:|
| `events_v2.flashscore_id NOT NULL` rate (global) | 50.3% | ≥ 75% |
| Markets hidden by Phase 1.5 filter | 35.822 | ≤ 8.000 (-78%) |
| Football coverage | ~75% | ≥ 90% |
| Baseball coverage | 0% | ≥ 85% |
| `/stats by_sport.baseball.ok` | 0 | > 0 (sanity) |

## Non-goals

- Modify the `v_player_markets` filter — policy is correct, not the gap
- Alternative settlement source (sportradar/betradar) — out of scope
- Real-time push <500ms FS-id (registry 3a/3b — separate)
- ML / external fuzzy library — token-based subset rule is sufficient
- Active cleanup of legacy `events` corrupted FS-ids — they are dormant (don't match canonical chain), auto-recover as new push-loop pulls correct sport
- Modify legacy `events` table schema — only `events_v2.flashscore_id` is updated by backfill

## Architecture

Four orthogonal modifications, each rollback-able independently:

```
┌─────────────────────────────────────────────────────────────────┐
│ flashscore-scraper                                              │
│                                                                 │
│ ① config.json          ② src/sport-id-map.json                  │
│   {push-loop config}     {search endpoint config}              │
│   baseball: 11 → 6       baseball: 11 → 6                      │
│   pallamano: 6 → 7       handball: 6 → 7  (+ pallamano alias)  │
│   + futsal: 11           + futsal: 11                          │
│   + SPORT_NAMES fix in src/search.ts (cosmetic)                │
│                                                                 │
│ ③ src/normalize.ts (rewrite ~80 LoC)                            │
│   • Token-based + NOISE_TOKENS (~30 prefixes incl. " D")        │
│   • RESERVE_MARKERS preserved (II, B, U21, "2", ...)            │
│   • matchTeams: strict eq → subset-on-discriminating-tokens     │
│                                                                 │
│ ④ src/search.ts + src/server.ts (telemetry, ~30 LoC total)      │
│   • Reason tag on 404: feed_empty/time_window_miss/name_mismatch│
│   • /stats breakdown: by_sport[slug][ok|404_*|409|503]          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ services/odds-api-ingester                                      │
│                                                                 │
│ ⑤ scripts/backfill-fs-id-v2.ts (NEW, ~120 LoC)                  │
│   • Query events_v2 WHERE flashscore_id IS NULL                 │
│   • Priority: live > pending in-window > pending future         │
│   • p-limit(4); reuse resolveFlashscoreId() helper              │
│   • Summary log: by_sport, by_step (legacy/canonical/search)    │
└─────────────────────────────────────────────────────────────────┘
```

### Deploy ordering

1. ① + ② (sport_id fix) → restart `flashscore-scraper` → push-loop fetches correct sports; search endpoint corrects baseball/handball
2. ③ (normalize) → restart `flashscore-scraper` → search starts matching prefixes/qualifiers/women's
3. ④ (telemetry) — orthogonal, can be in any commit
4. ⑤ (backfill) — run one-shot after ②+③ deployed and verified via /stats

The four components are independent: any single rollback (git revert + restart) leaves the others functional.

## Component design

### ① + ②: Sport-ID corrections

`config.json` (`flashscore-scraper/`):
```diff
- { "name": "pallamano", "id": 6 },
+ { "name": "pallamano", "id": 7 },
+ { "name": "baseball",  "id": 6 },
- { "name": "baseball",  "id": 11 },
+ { "name": "futsal",    "id": 11 },
```

`sport-id-map.json` (`flashscore-scraper/src/`):
```diff
- "handball": 6,
+ "handball": 7, "pallamano": 7,
- "baseball": 11,
+ "baseball": 6,
+ "futsal": 11,
```

`SPORT_NAMES` in `search.ts` (cosmetic — only affects log output of feed parser):
```diff
- 6: "Handball",
+ 6: "Baseball",
+ 7: "Handball",
- 11: "Baseball",
+ 11: "Futsal",
```

### Pre-deploy audit (read-only)

Before applying ①+② run this query and log result in the implementation runbook:
```sql
SELECT sport_slug,
       COUNT(*) FILTER (WHERE flashscore_id IS NOT NULL) AS with_fs,
       COUNT(*) AS total
FROM events
WHERE sport_slug IN ('baseball','pallamano','handball')
  AND starts_at > now() - interval '90 days'
GROUP BY 1;
```
Expected: most/all `with_fs` records are corrupt (FS-id points to wrong sport's fixture). Decision rule: **no cleanup** if these records don't surface via canonical-chain join (verify with: `SELECT count(*) FROM events e_oa JOIN events e_fs USING (canonical_id) WHERE e_oa.sport_slug='baseball' AND e_fs.flashscore_id IS NOT NULL`). Only if cross-canonical false positives exist do we add a cleanup migration to NULL them.

### ③: `normalize.ts` rewrite

```ts
import aliasesRaw from "./team-aliases.json" with { type: "json" };

const ALIASES = aliasesRaw as Record<string, string>;
const DIACRITIC_RE = /[̀-ͯ]/g;

const NOISE_TOKENS = new Set([
  // Generic club affixes
  "fc","ac","cf","sc","sk","ss","ssc","usl","calcio","afc","cfc","usd",
  // Eastern European prefixes (from discovery + common others)
  "gks","kkp","kf","fk","mfk","ks","bk","ofk","zsk","nk","hnk","gnk","ffk","fck","rfk",
  // Women's-team marker (FS-side)
  "d",
  // Filler
  "club","team","sport","sports",
]);

const RESERVE_MARKERS = new Set([
  "ii","iii","b","c",
  "u17","u19","u20","u21","u23",
  "2","3",
  "youth","academy","reserves",
]);

export interface NormalizedTeam {
  tokens: string[];          // all non-noise tokens (including reserve markers)
  key: string;                // join(" ") of non-reserve tokens, post-alias
  reserveMarkers: Set<string>;
}

function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITIC_RE, "")
    .replace(/[.']/g, "")
    .split(/[\s\-/&]+/)
    .filter(t => t.length > 0 && !NOISE_TOKENS.has(t));
}

export function normalizeTeam(raw: string, sportSlug: string): NormalizedTeam {
  const tokens = tokenize(raw);
  const reserveMarkers = new Set(tokens.filter(t => RESERVE_MARKERS.has(t)));
  const nonReserve = tokens.filter(t => !RESERVE_MARKERS.has(t));
  const baseKey = nonReserve.join(" ");
  const aliased = ALIASES[`${sportSlug}:${baseKey}`];
  if (aliased) {
    return { tokens: aliased.split(" "), key: aliased, reserveMarkers };
  }
  return { tokens: nonReserve, key: baseKey, reserveMarkers };
}

const DISCRIMINATING_MIN_LEN = 4;

export function matchTeams(a: NormalizedTeam, b: NormalizedTeam): boolean {
  if (a.key.length === 0 || b.key.length === 0) return false;

  // Stage 1: reserve marker mismatch is always a hard fail
  if (!setsEqual(a.reserveMarkers, b.reserveMarkers)) return false;

  // Stage 2: strict eq on canonical key
  if (a.key === b.key) return true;

  // Stage 3: subset on discriminating tokens (length ≥ 4, non-reserve)
  const aDisc = new Set(a.tokens.filter(t => t.length >= DISCRIMINATING_MIN_LEN && !RESERVE_MARKERS.has(t)));
  const bDisc = new Set(b.tokens.filter(t => t.length >= DISCRIMINATING_MIN_LEN && !RESERVE_MARKERS.has(t)));
  if (aDisc.size === 0 || bDisc.size === 0) return false;
  return isSubset(aDisc, bDisc) || isSubset(bDisc, aDisc);
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function isSubset<T>(a: Set<T>, b: Set<T>): boolean {
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
```

#### Behavior on real cases (test fixtures)

| odds-api | FS feed | Stage that matches | Result |
|---|---|---|---|
| GKS Katowice / KKP Stomilanki Olsztyn | Katowice D / Stomilanki Olsztyn D | Stage 2 | match ✓ |
| FC Prishtina | Prishtina | Stage 2 | match ✓ |
| Shkendija Tetovo | Shkendija | Stage 3 (bDisc ⊆ aDisc) | match ✓ |
| AS Muhanga / Rayon Sports FC | Muhanga / Rayon Sport | Stage 2 | match ✓ |
| Roma | Roma B | Stage 1 fail (reserve diverge) | NO match ✓ |
| Noah Yerevan 2 | Noah Yerevan | Stage 1 fail ("2" reserve) | NO match ✓ |

#### Caller contract change

`searchEvent` in `search.ts` already calls `normalizeTeam` then `matchTeams`. It uses the return as opaque values, so the only change is the type signature: `string` → `NormalizedTeam`. No external API change.

### ④: Telemetry

`SearchResult.body` for 404 extended:
```ts
| { status: 404; body: { error: "no_match"; reason: "feed_empty" | "time_window_miss" | "name_mismatch" } }
```

Logic in `searchEvent`:
- After all 3 day-offsets exhausted: tally if any fixture loaded ever (else `feed_empty`); else if any fixture passed time-tolerance ever (else `time_window_miss`); else `name_mismatch`.

`server.ts` extends `/stats`:
```ts
const bySport: Record<string, {
  ok: number;
  no_match_feed_empty: number;
  no_match_time: number;
  no_match_name: number;
  ambiguous: number;
  unavailable: number;
}> = {};
// updated per request after searchEvent returns
```

Cost: ~30 LoC, 2 counters per request branch. No DB writes.

### ⑤: Backfill script

`services/odds-api-ingester/scripts/backfill-fs-id-v2.ts`:
```ts
import pLimit from "p-limit";
import { Pool } from "pg";
import { resolveFlashscoreId } from "../src/resolve-flashscore-id.js";

const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
const limit = pLimit(4);
const stats = {
  resolved: 0, failed: 0,
  by_sport: {} as Record<string, { ok: number; fail: number }>,
  by_step:  { legacy_direct: 0, canonical_chain: 0, search: 0 },
};

const events = await pool.query(`
  SELECT id, odds_api_id, sport_slug, starts_at, home_team AS home, away_team AS away, status
  FROM events_v2
  WHERE flashscore_id IS NULL
  ORDER BY
    (status = 'live') DESC,
    (status = 'pending' AND starts_at < now() + interval '6 hours') DESC,
    starts_at ASC
`);

await Promise.all(events.rows.map(ev => limit(async () => {
  const fsId = await resolveFlashscoreId(ev, deps);
  if (fsId) {
    await pool.query(`UPDATE events_v2 SET flashscore_id=$1 WHERE id=$2`, [fsId, ev.id]);
    stats.resolved++;
    bumpBySport(ev.sport_slug, true);
    // by_step bumped via deps.log capture
  } else {
    stats.failed++;
    bumpBySport(ev.sport_slug, false);
  }
})));

console.log(JSON.stringify(stats, null, 2));
process.exit(0);
```

Properties:
- **Idempotent**: `WHERE flashscore_id IS NULL` filter — re-runnable safely
- **Throttled**: `pLimit(4)` × cache TTL 5min ammortizes load
- **Priority**: live first → pending imminent → pending future → settled (older)
- **Estimate**: ~7.346 events × ~0.5s avg with cache hits → ~15-30 min total

### Testing strategy

**TDD upfront**, fixture-driven:

`flashscore-scraper/src/__tests__/normalize.test.ts` (extension, ~25 cases):
- 12 real cases from discovery (Katowice/Stomilanki/Prishtina/Muhanga/Shkendija/Rayon/etc) → expect match via Stage 2 or Stage 3
- 5 reserve cases (Roma vs Roma B, Yerevan 2 vs Yerevan, U21 mismatches) → expect NO match
- 4 alias dict (Inter, Bayern, PSG, Real) → expect canonical
- 4 edge: empty string, only NOISE, only reserve, mixed diacritics

`flashscore-scraper/src/__tests__/search.test.ts` (extension, ~8 cases):
- mock fixtures + verify 404 reason tag (feed_empty/time_window_miss/name_mismatch)
- ambiguous 409 with 2 candidates → returns candidate list
- known sport vs unknown sport → 200 vs 400

**Smoke post-deploy**:
- 5 manual /search calls per sport (calcio, baseball, handball, tennis, basket) using events from `events_v2 WHERE flashscore_id IS NULL ORDER BY starts_at ASC LIMIT 5` per sport
- After 1h of normal ingester traffic: `/stats by_sport.baseball.ok > 0` MUST be true
- After backfill: re-query the original "hidden markets" count — expected drop from 35.822 to ≤ 8.000

## Risks + mitigation

| Risk | Mitigation |
|---|---|
| Token-overlap false positive (Atletico ↔ Atletico Mineiro) | 409 ambiguous when 2 candidates in time-window; alias dict as override; ±10min time tolerance limits exposure |
| Sport_id fix breaks legacy `events` push-loop | Push-loop restarts on correct sport; legacy records dormant (no canonical-chain match); zero data corruption forward |
| Backfill saturates search HTTP | pLimit(4) + 5min cache TTL; idempotent re-run if 503 |
| Restart `flashscore-scraper` mid-loop | Loops resume on next tick (1m intervals); idempotent feed parsing |
| Reserve marker false negative (e.g., "FC Schalke 04" ≠ Schalke) | "04" is a year, not in RESERVE_MARKERS; only standalone "2"/"3" are reserve; alias dict can override edge cases |

## Rollback per component

- ① + ②: `git revert` of 2 JSON files + 1 TS const → restart `flashscore-scraper` → state pre-fix (broken as before, zero net regression)
- ③: `git revert` of `normalize.ts` + tests → restart → search reverts to 99.94% no_match (steps 1+2 unaffected)
- ④: cosmetic; no rollback needed
- ⑤: idempotent script; if results wrong, manual SQL `UPDATE events_v2 SET flashscore_id=NULL WHERE id IN (...)` then re-run

## Success criteria (post-deploy + post-backfill)

- `/stats by_sport.baseball.ok > 0` (baseline 0)
- `events_v2.flashscore_id NOT NULL` ≥ 75% (baseline 50.3%)
- Markets hidden by Phase 1.5 filter ≤ 8.000 (baseline 35.822 → -78%)
- Football coverage ≥ 90% (baseline ~75%)
- Baseball coverage ≥ 85% (baseline 0%)
- Zero regression on already-working sports (basket/tennis canonical resolution rate not degraded)

## Open questions

1. **Telemetry persistence**: `/stats` is in-process counters reset on restart. Is that sufficient, or do we want to push counters to Prometheus / a DB table for dashboards? Default: in-process only (YAGNI).
2. **Backfill schedule**: one-shot now, or also wire as nightly cron? Default: one-shot now; the live ingester hook covers ongoing flow. Reconsider if monthly drift > 5%.
3. **Alias dict expansion**: ship only the 10 existing entries, or seed from cluster of known false-positive risks (Atletico, Real, Dynamo, Spartak, etc.)? Default: ship as-is; expand reactively when telemetry shows ambiguous spikes.
