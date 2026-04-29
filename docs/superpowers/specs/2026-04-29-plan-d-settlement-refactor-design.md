---
name: Plan D — Settlement Refactor (odds-api primary + Flashscore stats fallback, filter-at-exposure)
description: Refactor settlement engine to consume odds-api scores as primary for score-based markets, with Flashscore as stats source for corners/cards/players. Achieves 100% settlement coverage BY CONSTRUCTION via filter-at-exposure: events without flashscore_id expose only score-based markets. Includes /admin/settlement-coverage observability page and 100-bet validation gate.
type: design-spec
date: 2026-04-29
status: design-v2
revision: v2 (rewritten 2026-04-29 evening, filter-at-exposure architectural evolution)
---

# Plan D — Settlement Refactor Design (v2)

## 1. Context

Today's settlement chain (post Phase 1.D/E/F migration to odds-api):

```
events.status='finished' (set by /api/cron/scrape-fixtures or kambi/22bet legacy)
  ↓
verify-results cron (every 5 min, FS primary + BetExplorer fallback)
  ↓ fetches scores + stats from Flashscore
events.score_home/score_away/live_data populated
  ↓
settleEvent() in lib/settlement.ts (1792 LoC, 15+ market types via SETTLERS dispatch)
  ↓
bet_selections.result + bets.status updated
```

After the migration to odds-api as primary odds source (mig 138-150), we now ALSO have:
- `events_v2.status` flips to `'settled'` automatically via `mark_stale_lives_settled` RPC (mig 150)
- `events_v2.scores` populated by odds-api ingester (`scores: {home, away, periods: {fulltime, p1, ...}}`)
- `derive_legacy_from_v2()` RPC (mig 146 + translations mig 149) propagates these to legacy `events` rows for player frontend compat

The legacy settlement still relies entirely on Flashscore for both scores and stats, even though odds-api now provides scores authoritatively (the same source bookmakers use to settle). Flashscore is needed only because odds-api does **not** expose stats (corners, cards, shots) or player events (who scored).

## 2. Problem

Empirically verified against odds-api.io (2026-04-29):

| Endpoint | Settlement payload |
|---|---|
| `/v3/events/{id}` (settled) | `scores: {home, away, periods}` only |
| `/v3/odds?eventId=X` (settled) | `bookmakers: {}` (empty) |
| `/v3/historical/events`, `/v3/historical/odds` | same, no resolution data |
| `/v3/odds?markets=Player Cards` | pre-match odds only, no post-match counts |
| `/v3/participants` | id+name, no in-event data |

**odds-api is an odds aggregator, not a settlement provider.** It returns:
- ✅ `scores + period_scores` at `status='settled'`
- ❌ no per-outcome resolution flags
- ❌ no stats counts (corners/cards/shots/possession/fouls)
- ❌ no player event data (who scored, assists, cards per player)

This invalidates the naive Plan D framing in `session-2026-04-29-phase-1f-cleanup.md` ("Flashscore-scraper diventa dead code rimuovibile"). The corrected framing: **odds-api can settle ~50% of markets by type (~80% of bets by volume), Flashscore must remain for stats/player markets**.

## 3. Goals

**Primary**:
- G1. Use `events_v2.scores` (odds-api) as authoritative score source for score-based markets, replacing Flashscore for these. Score-based legs settle via odds-api **always**, even on events that ALSO have a `flashscore_id`.
- G2. Reduce Flashscore load: `verify-results` cron only fetches events with bets pending on stats/player markets.
- G3. Reduce settlement latency: score-based markets settle within 1-2 min of `events_v2.status='settled'` (vs 5-15 min current FS path).
- G4. Build `/admin/settlement-coverage` observability page that classifies every market type (score / stats / player) and surfaces real bet metrics per market — decision tool for future scope reductions (drop stats markets? buy stats provider?).
- G5. Validate the new settlement path against ≥100 historical bets covering the full market catalog before cutover. Zero regressions vs current settlement.
- **G8. Achieve 100% settlement coverage BY CONSTRUCTION via filter-at-exposure.** Events without `flashscore_id` expose ONLY score-based markets in the legacy catalog (settlable from odds-api scores). Events with `flashscore_id` expose all markets. Special markets (the `~3` catalog entries that need scorer-method or other non-modeled data) are filtered at derive time and not exposed at all in v2. By construction the player can never place a bet whose category lacks a settler with available data; settlement coverage is 100% (modulo timely arrival of source data).

**Secondary**:
- G6. Single source of truth for market classification: `MARKET_CATEGORIES` dict shared by page (D.1), engine (D.2), and the `derive_legacy_from_v2()` filter (data layer). No drift.
- G7. Backwards-compatible bet schema: no migration of existing `bet_selections` rows. Schema simplification deferred to a future plan.

## 4. Non-goals

- N1. **Killing Flashscore-scraper entirely**: remains alive as stats/player source for events that have a `flashscore_id`. Filter-at-exposure narrows FS exposure but does not eliminate the dependency. Decommission deferred until we drop stats/player markets from the offering altogether.
- N2. **Removing the 5 canonical layer admin pages all at once**: the canonical layer simplifies but doesn't fully die in Plan D — score-based markets bypass it, stats markets still use it. Page-level cleanup is incremental.
- N3. **Schema migration of `bet_selections.market_type`** to use odds-api keys. Bets continue storing the IT-translated label produced by `derive_legacy_from_v2()`. Classifier maps text → category at runtime.
- N4. **Real-time live-stats settlement** (cash-out support on stats markets during live). Existing gap; not addressed here.
- N5. **Per-market handlers for special markets** (Goal Method, First 10 Min, generic Specials). v2 filters them out entirely at derive time — they are never exposed to the player, so no settler is needed. If a future business need re-introduces special markets, a follow-up plan will add per-market handlers.
- N6. **Operator manual-settlement queue page** (`/admin/manual-settlement` with bet-by-bet review). Considered as path 1 to "100% settlement", abandoned in favor of filter-at-exposure: it's strictly cheaper to never expose an unsettleable market than to settle it later by hand. No `manual_required` verdict ever flows through the engine in v2.
- N7. **Alternative stats provider evaluation** (Sportradar/Sportmonks/etc.). Out of scope. If `/admin/settlement-coverage` data later shows a strong case (e.g. catalog shrinkage on stats markets is hurting volume), a separate plan can revisit.

## 5. Architecture overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    Plan D v2 — 3 sub-components                           │
├──────────────────────┬─────────────────────────┬─────────────────────────┤
│ D.0 Filter at        │ D.1 Settlement Coverage │ D.2 Settlement Engine    │
│   exposure           │ /admin/settlement-      │ lib/settlement.ts + cron │
│ derive_legacy_from_v2│   coverage              │                          │
├──────────────────────┼─────────────────────────┼─────────────────────────┤
│ Filter rule:         │ Observability:          │ Routing:                 │
│ - event has FS id?   │ - market catalog table  │ - score → odds-api scores│
│   → expose all       │ - 3 active categories   │ - stats → FS (scoped)    │
│ - no FS id?          │   + 'filtered' surface  │ - player → FS (scoped)   │
│   → score-only       │ - bet metrics 7d/30d    │ - (no special branch)    │
│ - 'special' always   │ - drill-down per market │                          │
│   filtered           │                         │                          │
└──────┬───────────────┴──────┬──────────────────┴───────────┬─────────────┘
       │                      │     shared core              │
       └────────►  lib/settlement/market-classification.ts  ◄┘
                  (MARKET_CATEGORIES dict, classify(),
                   isScoreOnly(), requiresStats(), requiresPlayer(),
                   isExposable(event_has_fs, market_type))
```

The classification module is the **load-bearing contract**: the derive RPC reads it (via the seed table) to decide what to expose, the page reads it for display, the engine reads it for routing. All three never disagree by construction.

**Filter-at-exposure invariant**: by the time a market reaches the bet-placement UI, the system has already verified that a settler with available data exists for it. The settlement engine is therefore the dual of the derive filter — it never encounters a leg it cannot resolve, except for transient "data not yet arrived" cases (handled via async retries).

### 5.1 Settlement triggers (after refactor)

```
┌─────────────────────────────────────────────────────────────────┐
│ Trigger A — odds-api settled events (every 1 min)                │
│ ─────────────────────────────────────────────────                │
│ /api/cron/odds-api-settle:                                       │
│   SELECT events_v2 WHERE status='settled' AND last_settled_at IS │
│     NULL ORDER BY date_iso ASC LIMIT 50                          │
│   FOR each:                                                      │
│     ev = derive scores from events_v2 → events row               │
│     legs = bet_selections WHERE event_id = ev AND result IS NULL │
│       AND classification(market_type) = 'score'                  │
│     settleLegs(legs, ev.scores)                                  │
│     mark events_v2.last_settled_at = NOW()                       │
├─────────────────────────────────────────────────────────────────┤
│ Trigger B — Flashscore stats events (every 5 min, scoped)        │
│ ─────────────────────────────────────────────────                │
│ /api/cron/verify-results (existing, refactored):                 │
│   target = events WHERE status='finished'                        │
│     AND EXISTS (bet_selections WHERE event_id=ev                 │
│       AND result IS NULL                                         │
│       AND classification(market_type) IN ('stats','player'))     │
│   ↑ skip events whose only pending legs are score-only           │
│     (already handled by Trigger A)                               │
│   FOR each: existing FS fetch + settleEvent path                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Settlement dispatch inside `settleEvent()`

```
For each leg (bet_selection):
  cat = classify(leg.market_type)         // 'score'|'stats'|'player'
                                           // ('special' filtered at derive — never reaches engine)

  if cat == 'score':
    result = buildResultFromOddsApi(events_v2.scores)
    verdict = SETTLERS[settler_key](result, outcome.name, line)
    // SETTLERS reused as-is

  elif cat == 'stats':
    if not stats_available: return null  // wait for FS
    result = buildResultFromFlashscore(events.live_data.stats)
    verdict = STATS_SETTLERS[market_type](result, outcome.name, line)

  elif cat == 'player':
    if not scorers_available: return null  // wait for FS
    result = buildPlayerEventsFromFlashscore(events.live_data.scorers)
    verdict = PLAYER_SETTLERS[market_type](result, outcome.name)

  else:
    // Defensive only — should be unreachable given the derive filter.
    // Unknown market_type → log + 'void' fail-safe (we settle to refund stake).
    log.warn('[settle] unclassified market reached engine', { market_type })
    verdict = 'void'
```

**No `manual_required` verdict, no SPECIAL_DISPATCHER, no operator queue.** The derive filter (§9 Phase 1.5) guarantees that no bet whose category lacks a settler-with-data is ever offered to the player. If the defensive branch above fires in production, it indicates a derive-filter regression — alert and fix the data layer, not the engine.

## 6. Component D.1 — `/admin/settlement-coverage`

### 6.1 Page layout

**Top KPI strip** (5 cards, 7d window default):
- 🟢 % bet on score markets (settle from odds-api)
- 🟡 % bet on stats markets (settle from FS, only on FS-mapped events)
- 🔴 % bet on player markets (settle from FS scorers, only on FS-mapped events)
- 🚫 # markets filtered at derive (catalog shrinkage — diagnostic, target ≤2%)
- ✅ % bet settled within SLA (score ≤2min, stats/player ≤24h)

The 🚫 KPI replaces the v1 ⚪ "special" card: in v2 specials are filtered out, so the more useful number is "how much catalog do we hide vs the raw odds-api offering." It surfaces if filter rules mis-classify, or if FS coverage drops below baseline.

**Catalog table** (one row per unique market_type seen in last 90d):
| Col | Type | Source |
|---|---|---|
| market_type (IT) | text | derive_legacy_from_v2 output (mig 149) |
| market_key (EN) | text | odds-api raw name |
| category | enum 🟢🟡🔴⚪ | `MARKET_CATEGORIES` |
| sport | text | from event |
| settler available | bool | `cat='score' OR market_type IN STATS_SETTLERS OR ...` |
| bet_count_7d | int | aggregation RPC |
| bet_count_30d | int | aggregation RPC |
| auto_settle_pct | % | auto-settled / total |
| pending_pct | % | pending / total |

Filters: sport multi-select, category multi-select, "has pending bets" toggle, search by name.

**Drill-down** (modal/sheet on row click):
- Last 20 bets on this market type (status, stake, placed_at, settled_at, settler used)
- Last 20 events with bets on this market (status, has_score, has_flashscore_id, has_stats)
- Sample odds payload for this market_type (from `markets_v2`)

### 6.2 Backend

**Files**:
- `lib/settlement/market-classification.ts` (NEW, ~150 LoC)
  - `MARKET_CATEGORIES: Record<string, 'score' | 'stats' | 'player' | 'special'>`
  - `classify(market_type: string): Category`
  - Helper predicates: `isScoreOnly`, `requiresStats`, `requiresPlayer`
- `app/api/admin/settlement-coverage/list/route.ts` (NEW)
  - GET → `{ kpis, markets[] }`
  - Supports filters via query params

**RPC** (NEW migration, e.g. mig 152):
- `settlement_coverage_list(window_days int)` returns `setof (market_type, sport, bet_count, auto_settled, manual, pending, void, last_seen_at)`
- `settlement_coverage_kpis(window_days int)` returns aggregated by category (bet count + stake sum)

### 6.3 Classification dict — initial seed

Categories pre-classified for football (extend per sport):

**🟢 Score-only** (settable from `scores.home/away/periods`):
- 1X2 (h2h/ML)
- Spread / Asian Handicap (all variants)
- Totals goals (Over/Under) — all lines
- Goals Over/Under, Alternative Total Goals
- BTTS (Both Teams To Score) + 2H + HT variants
- Double Chance
- Draw No Bet
- Half Time Result
- HT/FT (Half Time / Full Time)
- Exact Total Goals, Number of Goals In Match
- Team Total Goals Home/Away
- Team Goals Over/Under
- European Handicap
- Spread HT, Totals HT, 1st Half Handicap
- Goal Line, Alternative Goal Line
- Exact Score / Correct Score
- Odd/Even total goals

**🟡 Stats-required** (need corners/cards/shots count from FS):
- Corners (all variants: Corners, Corners 2-Way, Corners Race, Corners Spread, Corners Totals, Corners Totals HT, Corner Handicap, Alternative Corners)
- Total Corners, Team Corners Home/Away
- Bookings / Cards (all variants)
- Match Shots, Match Shots on Target
- Team Shots Home/Away, Team Shots on Target Home/Away
- Goalkeeper Saves (team-level)
- Match Tackles, Team Tackles Home/Away

**🔴 Player-event-required** (need who-scored/assists from FS):
- Anytime Goalscorer
- Multi Scorers
- First Goalscorer / Last Goalscorer
- Team Goalscorer
- Player Shots, Player Shots on Target
- Player Fouls Committed, Player Tackles
- Player To Be Fouled
- Player To Score or Assist
- (any market with "Player" prefix not already in stats)

**🚫 Special** (filtered at derive — NEVER exposed to player in v2):
- Goal Method (`header`/`penalty`/`own goal`/`shot`)
- First 10 Minutes (00:00 - 09:59)
- "Specials" generic catchall

These remain in the dict for traceability (so the settlement-coverage page can audit "how many special markets did we filter out today?"), but the derive-time filter removes them from `markets` regardless of whether the event has a `flashscore_id`. Settlement engine never sees them; defensive 'void' branch in §5.2 covers the impossible case.

### 6.4 KPI computation

The classifier in SQL **must not** use `LIKE`/regex pattern matching against `market_type` strings — that would diverge from the TS classifier as new markets appear. Instead, every classification query joins `market_categories_seed` directly:

```sql
-- bet count per category, last 7d
SELECT mcs.category,
  count(*) AS legs,
  sum(CASE WHEN bs.result='won' THEN 1 ELSE 0 END) AS won,
  sum(CASE WHEN bs.result='lost' THEN 1 ELSE 0 END) AS lost,
  sum(CASE WHEN bs.result IS NULL THEN 1 ELSE 0 END) AS pending
FROM bet_selections bs
JOIN bets b ON b.id = bs.bet_id
JOIN markets m ON m.id = bs.market_id
LEFT JOIN market_categories_seed mcs ON mcs.market_type = m.market_type
WHERE b.created_at > NOW() - INTERVAL '7 days'
GROUP BY mcs.category;
-- LEFT JOIN: unclassified market_type rows roll up under category=NULL → surfaced
-- in the page as "unclassified" for triage. NOTE in v2: at the data-layer (mig 154 derive
-- filter) unclassified is treated as 'special' → filtered out of the catalog. So "unclassified"
-- legs in this query come from bets placed BEFORE the dict was updated, or from edge cases
-- where the dict diverged from `markets_v2.market_type_translated` at derive time.
```

**Single source of truth contract**:
- TS constant `MARKET_CATEGORIES` in `lib/settlement/market-classification.ts` is authoritative.
- A build-time script exports it to JSON; the migration's seed step inserts the JSON into `market_categories_seed`.
- A CI test asserts equality between TS dict and seed table content.
- Updates always go: TS dict → re-export → migration row → both updated in same PR.

## 7. Component D.2 — Settlement engine refactor

### 7.1 New cron `/api/cron/odds-api-settle`

**Schedule**: every 1 min via systemd timer or platform cron.

**Auth**: header `x-cron-key: <CRON_SECRET>`.

**Logic**:
```typescript
// 1. Pull settled events_v2 with no last_settled_at (max 50, oldest first)
const { data: evs } = await supabase
  .from('events_v2')
  .select('id, scores, sport_slug, league_slug, date_iso, mapped_event_id')
  .eq('status', 'settled')
  .is('last_settled_at', null)
  .order('date_iso', { ascending: true })
  .limit(50);

// 2. For each, find pending score-only legs via mapped_event_id
for (const ev of evs) {
  if (!ev.mapped_event_id) continue; // no legacy event mapped, skip
  const { data: legs } = await supabase
    .from('bet_selections')
    .select(`id, bet_id, market_id, outcome_id,
      markets!inner(market_type, line),
      outcomes!inner(name)`)
    .eq('event_id', ev.mapped_event_id)
    .is('result', null);
  
  // 3. Filter to score-only legs
  const scoreLegs = legs.filter(l => 
    classify(l.markets.market_type) === 'score'
  );
  
  if (scoreLegs.length === 0) {
    // mark settled to prevent re-poll, but no legs settled
    await supabase.from('events_v2').update({ last_settled_at: new Date().toISOString() }).eq('id', ev.id);
    continue;
  }
  
  // 4. Build result from odds-api scores
  const result = buildResultFromOddsApi(ev.scores);
  
  // 5. Settle each leg (reuse existing SETTLERS)
  for (const leg of scoreLegs) {
    const settler = resolveSettlerKey(leg.markets.market_type, leg.markets.line);
    const verdict = SETTLERS[settler.key](result, leg.outcomes.name, settler.line);
    await persistLegResult(leg, verdict);
  }
  
  // 6. Aggregate to bet level (bets.status, payout)
  await resolveAffectedBets(scoreLegs.map(l => l.bet_id));
  
  // 7. Mark settled
  await supabase.from('events_v2').update({ last_settled_at: new Date().toISOString() }).eq('id', ev.id);
}
```

**Invariants**:
- Only score-only legs touched; stats/player legs untouched until Trigger B runs.
- `events_v2.last_settled_at` is the dedup token. Re-runs are idempotent.
- The legacy `events.settled_at` flag is set only when ALL legs across all categories are settled (current behavior unchanged).

### 7.2 `verify-results` cron refactor

Current behavior: scan `events.status='finished' AND settled_at IS NULL`, fetch FS results, settle ALL legs.

New behavior: same scan + filter `events` to only those with at least one pending leg of category `stats`, `player`, or `special`. Score-only events ignored — they're handled by Trigger A.

```typescript
// New WHERE clause via RPC (avoids client-side N+1)
const { data: evs } = await supabase.rpc('next_unsettled_with_stats_legs', { lim: 100 });
// returns events with EXISTS (bet_selections.result IS NULL AND
//   classify(market_type) IN ('stats','player','special'))
```

**Expected impact**: Flashscore call volume reduced 50-70% (most events have only score-based bets).

### 7.3 `lib/settlement.ts` changes

Minimal surface change:

1. `settleEvent()` signature unchanged. Internally it now branches per leg's category.
2. New helper `buildResultFromOddsApi(events_v2.scores)` returning the same `Result` shape that `buildResult()` returns today.
3. New `STATS_SETTLERS` and `PLAYER_SETTLERS` dispatch tables for stats/player markets (most logic lifted from existing settlement paths in `settle*Stats`).
4. **No** SPECIAL_DISPATCHER. Special markets are filtered at derive (§9 Phase 1.5) and never reach the engine. The default branch in `settleLeg` returns `'void'` (defensive) and logs a warning if an unclassified or special market somehow reaches it.

### 7.4 Bet schema — unchanged

`bet_selections` rows continue to store:
- `market_type` text (IT, e.g. "U/O 2.5")
- `outcomes.name` text (e.g. "Over", "Under", "Sì", "1")
- `markets.line` numeric (e.g. 2.5)

No DB migration. Classifier maps `market_type` text → category at runtime via `MARKET_CATEGORIES` dict.

Schema simplification (storing odds-api `market_key + outcome_key + line` directly) is deferred to a future schema-simplification plan (out of Plan D scope).

## 8. Data model changes

| Table / RPC | Change | Migration |
|---|---|---|
| `events_v2` | Add column `last_settled_at timestamptz NULL` + partial index `WHERE status='settled' AND last_settled_at IS NULL` | mig 152 |
| `market_categories_seed` | NEW: 1 row per market_type, columns `(market_type text PK, category text, notes text, created_at, updated_at)` | mig 152 |
| RPC `next_unsettled_with_stats_legs(lim int)` | NEW — Trigger B helper, returns events with pending stats/player legs only | mig 152 |
| RPC `settlement_coverage_list(window_days int)` | NEW — per-market_type KPI breakdown for the page catalog table | mig 152 |
| RPC `settlement_coverage_kpis(window_days int)` | NEW — top-strip aggregation by category | mig 152 |
| RPC `settlement_coverage_filter_kpi(window_days int)` | NEW — counts markets filtered at derive (the 🚫 KPI), broken down by reason (no-FS-id vs special) | mig 152 |
| RPC `derive_legacy_from_v2()` | **MODIFIED** — filter clause added: `WHERE classify(market_type) = 'score' OR (e.flashscore_id IS NOT NULL AND classify(market_type) IN ('stats','player'))`. Special always filtered. | mig 154 |

No changes to `bet_selections`, `bets`, `outcomes`, `markets`, `events`.

**Migration ordering**: mig 152 must precede mig 154 (the modified `derive_legacy_from_v2()` reads from `market_categories_seed`).

## 9. Migration & rollout plan

**Phase 0 — Spec + plan** (this doc + writing-plans output)

**Phase 0.5 — Baseline measurement** (prerequisite, ~30min)
Before Phase 1 starts, measure on prod over last 30d:
- % of bet legs by category (heuristic regex-based, refined post mig 152)
- Current settlement latency p50/p90 for finished events
- Current FS call volume per hour
- **% of `markets` rows on events without `flashscore_id`** (predicts catalog shrinkage post Phase 1.5)
These numbers go into the spec's success criteria (§13). Empirical pre-measured value (2026-04-29 evening): **1,520 markets out of 99,452 (1.5%)** — already captured in §13.

**Phase 1 — Classification module + page (D.1)**
- Implement `lib/settlement/market-classification.ts` + tests
- Apply mig 152 (table + RPCs incl `settlement_coverage_filter_kpi`)
- Build `/admin/settlement-coverage` page
- Validate: KPI numbers reasonable, no markets unclassified
- **Gate**: user reviews page, confirms classification accuracy

**Phase 1.5 — Filter at derive (D.0)** (NEW in v2, prerequisite to Phase 4 cutover)
Depends on Phase 1.3 (mig 152 supplies `market_categories_seed`) and Phase 1.10 (page deployed so the 🚫 KPI is observable).
- Apply mig 154 on staging in **dry-run mode**: a sibling RPC `derive_legacy_from_v2_dryrun()` returns the diff (markets that the new filter would remove) without modifying the live `derive_legacy_from_v2()`.
- Run the dry-run for 24h. Confirm:
  - Catalog shrinkage matches predicted ~2.45% (1.5% from FS rule + 0.9% specials) within ±0.5pp.
  - No score market accidentally filtered (false positive).
  - All special markets removed from output.
- Cut over staging: replace `derive_legacy_from_v2()` body with the filtered version. Observe 24h via the `/admin/settlement-coverage` 🚫 KPI.
- Cut over prod.
- **Gate**: catalog shrinkage within tolerance, zero score-market false-positives, page reports the 🚫 KPI matching predicted volume.

**Phase 2 — Engine refactor in shadow mode (D.2)**
- Implement new cron `/api/cron/odds-api-settle` but **dry-run only**: writes to `settlement_log_shadow` table, no actual `bet_selections.result` UPDATE
- Run for ≥48h alongside current FS settlement
- Compare verdicts: shadow vs real path, flag discrepancies
- **Gate**: ≤0.5% verdict mismatch on score-only legs across ≥1000 settled legs

**Phase 3 — 100-bet validation gate** (see §10)
- Synthetic bet fixture covering 3 active categories (score / stats / player; specials filtered, see §10.3), ≥100 bets total
- Run end-to-end through new path
- **Gate**: 100% expected verdicts

**Phase 4 — Cutover**
- Flip cron to live mode (actual UPDATE)
- Refactor `verify-results` to scope to stats/player legs only
- Monitor for 24h: settlement latency, pending-bet count, error rate

**Phase 5 — Cleanup**
- After 30d stable: archive `settlement_log_shadow`
- Document the classification dict as the public reference for "what each market does"
- **Verify catalog shrinkage actual vs predicted**: query `settlement_coverage_filter_kpi(30)` and compare to the baseline 1.5%/2.45%. Variance >1pp triggers an investigation memo (FS coverage shifted, or odds-api catalog changed).
- Confirm `manual_required` verdict count = 0 (sanity check on by-construction guarantee).

**Rollback plan**: at any phase, set feature flag `SETTLE_VIA_ODDS_API=false`, system falls back to current FS-only path. Toggle via env var, no code revert needed.

## 10. Testing strategy

### 10.1 Unit tests (existing patterns)

`tests/lib/settlement/market-classification.test.ts`:
- Every entry in `MARKET_CATEGORIES` covered by ≥1 test.
- Unknown market_type returns `'special'` (so derive filter excludes it from exposure).
- `isExposable(has_fs=false, market_type='1X2')` → true; `isExposable(has_fs=false, market_type='Corner')` → false; `isExposable(has_fs=true, market_type='Metodo Goal')` → false (special always filtered).

`tests/lib/settlement/odds-api-settler.test.ts`:
- Each SETTLER (1X2, OU, BTTS, DC, etc) tested with synthetic `events_v2.scores` payloads.
- Edge cases: 0-0, push on whole-number lines, void on cancelled, period scores missing.

### 10.2 Integration tests

`tests/api/cron/odds-api-settle.test.ts`:
- Seed `events_v2` row with `status='settled'`, `scores`, mapped to a legacy event with bet_selections.
- Invoke endpoint, assert legs settled, `last_settled_at` set.
- Re-invoke, assert no double-settlement.
- Mixed event (score legs + stats legs): only score legs touched.

### 10.3 100-bet validation gate (HARD GATE before Phase 4 cutover)

**Goal**: prove the new engine produces correct verdicts on a representative bet sample covering all market categories and edge cases.

**Fixture file**: `tests/fixtures/settlement/100-bets.json`

Each entry:
```json
{
  "id": "fb-1x2-home-win-001",
  "category": "score",
  "sport": "football",
  "market_type": "1X2",
  "outcome_name": "1",
  "line": null,
  "scores": { "home": 2, "away": 1, "periods": { "fulltime": {...}, "p1": {...} } },
  "expected_verdict": "won",
  "notes": "Home win 2-1, simple"
}
```

**Coverage matrix** (v2 rebalance — special category eliminated):

| Category | Markets | # cases | Edge cases included |
|---|---|---|---|
| 🟢 Score | 1X2, OU, BTTS, DC, DNB, HT, HT/FT, Spread, Asian H., Exact Score, Goal Line, Number Goals, Odd/Even | 60 | 0-0, pushes, half-line, integer line, void, 5+ goals |
| 🟡 Stats | Corners (5 lines), Cards (3 lines), Shots, Tackles, Saves, Team-Stats Home/Away | 20 | exact line, half-line, no-stats fallback returns `null` (not `manual_required`) |
| 🔴 Player | Anytime Goalscorer (5 cases), Multi Scorers (3), Player Shots (3), First/Last/Team Goalscorer (5), Marca o Assist (2), Goalkeeper Saves player-prop (2) | 20 | scored/not, OG counted/not, sub minute, no-scorer-data fallback returns `null` |
| 🚫 Special | — (filtered at derive, never bet upon) | **0** | — |
| **Total** | — | **100** | — |

**No special fixtures** in v2 — the derive filter (Phase 1.5) prevents special markets from being exposed, so a player can never place a bet on one. The contract under test is *settlement* given a leg, and the engine never sees specials. A separate **derive-filter test** (Phase 1.5) covers "specials are filtered" via SQL fixtures — that's a different test surface (data-layer, not engine).

**Test runner** (`tests/integration/100-bets-settlement.test.ts`):
```typescript
test.each(loadFixture('100-bets.json'))(
  '$id: $market_type / $outcome_name → $expected_verdict',
  async (bet) => {
    const verdict = await settleSyntheticBet(bet);
    expect(verdict).toBe(bet.expected_verdict);
  }
);
```

**Pass criteria**: 100/100 expected verdicts. Any failure blocks Phase 4 cutover.

**Authoring**: fixture entries built by combining (a) historical real bets from prod (anonymized) + (b) hand-crafted synthetic edge cases. Half from real, half synthetic.

### 10.4 Live shadow comparison (Phase 2)

`settlement_log_shadow` table records: `(leg_id, real_verdict, shadow_verdict, real_settled_at, shadow_settled_at, source_used)`.

Daily report query:
```sql
SELECT count(*) FILTER (WHERE real_verdict != shadow_verdict) AS mismatches,
       count(*) AS total
FROM settlement_log_shadow
WHERE real_settled_at > NOW() - INTERVAL '24 hours';
```

Mismatch threshold: ≤0.5% on score-only legs.

## 11. Observability

**Logs** (structured):
- `[odds-api-settle]` per cron run: `{ ts, evs_processed, legs_settled, mismatches_logged, duration_ms }`
- `[classify]` warning when unknown market_type encountered
- `[settlement] cat=stats need_fs=true` / `[settlement] cat=score from_odds_api=true`

**Metrics** (exposed via `/api/system/health`):
- `settle.odds_api.latency_p50` — time from `events_v2.status='settled'` → bet leg settled
- `settle.odds_api.legs_per_run` — throughput
- `settle.fs.calls_per_hour` — should drop ~50-70% after Phase 4
- `settle.pending.score_legs_age_hours` — alarm if >2h
- `settle.pending.stats_legs_age_hours` — alarm if >24h
- `settle.unmapped_settled_v2_count` — count of `events_v2.status='settled'` rows lacking `mapped_event_id` (Trigger A no-op pool). Tracks coverage gap between v2 and legacy events. Alarm if >5% of settled events for >1h.
- **`derive.filter.shrinkage_pct`** (NEW v2) — % of source-v2 markets removed by `derive_legacy_from_v2()` filter. Predicted ~2.45%; alarm if >3% sustained for >24h (suggests FS coverage regression or classifier drift).
- **`derive.filter.score_false_positive_count`** (NEW v2) — count of source-v2 markets classified as `score` that the filter nonetheless removed. **Always 0 by design**; any non-zero is a P1 incident.
- **`settle.manual_required.count_24h`** (NEW v2) — count of legs that received `verdict='manual_required'`. Always 0 in v2; non-zero indicates a classifier or filter regression.

**Alerts** (`/api/cron/alerts`):
- score-only leg pending >2h after `events_v2.status='settled'` → page operator
- stats/player leg pending >48h → page operator
- shadow-mode mismatch >2% in 24h → halt rollout

## 12. Risks & mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | odds-api `scores` differs from FS scores (rare cases of late goal corrections) | Low | Med | Shadow mode 48h+ surfaces these. Mismatch threshold gates cutover. Manual override RPC remains. |
| R2 | `events_v2.mapped_event_id` not populated for some events → score-only bets stuck | Med | Med | Fallback: if no v2 mapping, `verify-results` continues to handle (current path). Monitor unmapped count. |
| R3 | Classification dict misclassifies a market → bets settle wrong category | Med | High | 100-bet validation gate catches. Plus fail-safe: unknown → 'special' (manual handling, no auto-mistake). |
| R4 | Cron `odds-api-settle` race with manual settlement → double-settle | Low | High | `last_settled_at` is the dedup token. Optimistic lock pattern (existing). |
| R5 | Stats/player legs never settled because event has only score legs but FS expected | Low | Low | Counter: events with all legs score-only never trigger FS path; that's the goal. Verified via Trigger B's filter EXISTS clause. |
| R6 | Schema drift: TS dict and SQL classifier diverge | Med | Med | Single source of truth: dict exported to JSON at build time, loaded into `market_categories_seed` table. CI test asserts equality. |
| R7 | flashscore_id coverage incomplete (~50% of events lack FS mapping by league) → historically meant stats/player legs on uncovered events would never settle | High (existing) | RESOLVED in v2 | **By construction** via filter-at-exposure (Phase 1.5). Events without `flashscore_id` only expose score-based markets. The player can never place a stats/player bet on an unsettleable event. Risk eliminated. Trade-off: 1.5% catalog shrinkage on stats/player markets attached to unmapped events. Acceptable per measured impact (R8 below). |
| R8 | Filter shrinks catalog by ~1.5% (1,520 markets / 99,452 measured 2026-04-29) → potential business impact: reduced bet volume on niche-league stats/player props | Med | Low-Med | Catalog-shrinkage KPI on `/admin/settlement-coverage` tracks weekly. If shrinkage exceeds 3% of catalog or correlates with detectable revenue drop, escalate: (a) prioritize FS league coverage expansion, (b) revisit alt stats provider. Initial measurement (1.5%) is below alarm threshold. |
| R9 | FS-coverage filter has a bug → score markets accidentally hidden, or specials accidentally exposed | Low | High | Phase 1.5 dry-run gate compares old vs new derive output for 24h before live cutover. CI test: `tests/db/derive-filter.test.ts` asserts `classify(market_type)='score'` always passes filter regardless of FS state. |

## 13. Success criteria

After Phase 4 (cutover) complete and 30d in production:

- ✅ **100% of bet placements settle within 14 days** (the by-construction guarantee from filter-at-exposure). Pending bets older than 14d → 0 modulo extreme edge cases (event postponed, FS late, etc).
- ✅ ≥60% of bet legs auto-settled by the odds-api path (score-only legs). Empirical baseline from prod 2026-04-29: score legs are **89.5% of catalog by market count** (89,004/99,452); the legs % depends on player betting mix and is measured in Phase 0.5. Initial target floor: ≥60%, refined with Phase 0.5 data.
- ✅ Settlement latency p50 ≤2 min for score-only legs (vs current ~10 min)
- ✅ Flashscore call volume reduced ≥50% from baseline (Phase 0.5 measurement)
- ✅ **Zero `manual_required` verdicts in production** (sanity check — engine never emits this verdict in v2)
- ✅ Catalog shrinkage from filter ≤2.45% (predicted 1.5% from FS-rule + 0.9% from special-always-filter; alarm threshold 3% per R8)
- ✅ Zero score-market false-positives from derive filter (CI test gate)
- ✅ Settlement-coverage page used by operators (≥1 visit/day)
- ✅ 100/100 bet validation gate passed before cutover
- ✅ Shadow-mode mismatch ≤0.5% for ≥1000 legs

**Empirical baseline data (verified 2026-04-29 evening on prod, scraper-vps SSH)**:

| Categoria | Markets | % of catalog |
|---|---:|---:|
| score | 89,004 | 89.5% |
| stats | 4,962 | 5.0% |
| player | 4,570 | 4.6% |
| special | 916 | 0.9% |
| **TOTAL** | **99,452** | 100% |

Filter rule simulation: 1,520 markets hidden (489 stats no-FS + 887 player no-FS + 144 special no-FS), plus 916 specials filtered unconditionally = **2,436 markets hidden total = 2.45% catalog shrinkage**. The 1.5% headline excludes specials-with-FS (772 markets, kept-by-FS-rule but eliminated by always-filter-special rule). Both numbers below the 3% alarm threshold.

## 14. Open questions

1. **Fixture authoring** for 100-bet validation: do we generate synthetic events_v2/scores rows from existing prod data (anonymized), or hand-craft entirely? Suggest 50/50.

2. **`market_categories_seed` table editability**: should operators be able to update categories via admin UI, or is it strictly code-defined (TS source + migration)? Suggest code-only initially.

3. **What happens to bets on events with NO `events_v2` mapping** (legacy kambi niche, betfair, etc)? They never trigger Trigger A. They fall through to Trigger B (FS path) as today. **Verify**: ensure Trigger B doesn't filter them out.

4. **FS-coverage check granularity**: does the derive filter check `flashscore_id IS NOT NULL` only, or also factor in "FS has actually populated `live_data` for this event"? In v2 we use the simpler `flashscore_id IS NOT NULL` predicate (covered events are mapped by the FS matching engine — empirical data shows the binary 100%-or-0% per-league pattern). If a mapped event later fails to receive FS data (FS scraper outage, event missing from FS feed), stats/player legs go pending until the alert fires (R2 in §12).

**Resolved during v2 design** (no longer open):

5. ~~**Filter at ingestion vs exposure?**~~ **Decided: ingestion-time** (mig 154 modifies `derive_legacy_from_v2()`). Rationale: (a) DB-level filter means the legacy `markets` row never exists for filtered markets — any frontend that lists markets gets the right behavior for free. (b) Single auditable code path (one SQL function vs N frontend places). (c) Engine never receives a leg without an available settler.

6. ~~**Unknown market_type behavior?**~~ **Decided: classify as `'special'` → filtered at derive** (§5.2 + §6.3 + §10.1). A new market_type appearing in the wild without a dict entry is invisible to players until the dict is updated. This is fail-safe (no exposure of unsettleable inventory) at the cost of a small operational pause for catalog updates. Settlement-coverage page surfaces unclassified counts so they can be triaged.

## 15. Files to create / modify

**NEW**:
- `lib/settlement/market-classification.ts` (~150 LoC)
- `lib/settlement/odds-api-result.ts` (~100 LoC) — `buildResultFromOddsApi()`
- `lib/settlement/stats-settlers.ts` (~250 LoC) — `STATS_SETTLERS` dispatch
- `lib/settlement/player-settlers.ts` (~200 LoC) — `PLAYER_SETTLERS` dispatch
- `app/api/cron/odds-api-settle/route.ts` (~250 LoC)
- `app/api/admin/settlement-coverage/list/route.ts` (~80 LoC)
- `app/api/admin/settlement-coverage/drill-down/route.ts` (~80 LoC)
- `app/admin/settlement-coverage/page.tsx` (~250 LoC)
- `app/admin/settlement-coverage/components/{kpi-strip,catalog-table,drill-down-modal}.tsx`
- `supabase/migrations/152_settlement_coverage.sql` (table + 4 RPCs incl filter KPI)
- `supabase/migrations/153_settlement_log_shadow.sql`
- `supabase/migrations/154_derive_legacy_filter.sql` **(NEW in v2 — adds `is_market_exposable()` helper + `derive_legacy_from_v2_filter_diff()` dry-run sibling RPC)**
- `supabase/migrations/154b_derive_legacy_cutover.sql` **(NEW in v2 — replaces live `derive_legacy_from_v2()` body with filtered version, gated by 24h staging dry-run observation)**
- `supabase/migrations/154b_derive_legacy_cutover_rollback.sql` **(NEW in v2 — restores pre-cutover body, captured during plan authoring)**
- `tests/lib/settlement/market-classification.test.ts`
- `tests/lib/settlement/odds-api-result.test.ts`
- `tests/lib/settlement/stats-settlers.test.ts`
- `tests/lib/settlement/player-settlers.test.ts`
- `tests/api/cron/odds-api-settle.test.ts`
- `tests/integration/100-bets-settlement.test.ts`
- `tests/fixtures/settlement/100-bets.json` (60 score / 20 stats / 20 player / 0 special)
- `tests/db/derive-filter.test.ts` **(NEW in v2)** — asserts filter behavior on synthetic events

**MODIFIED**:
- `lib/settlement.ts` — branching dispatch by category, defensive `'void'` for unclassified (~+200 LoC)
- `app/api/cron/verify-results/route.ts` — scope to stats/player legs only via `next_unsettled_with_stats_legs` RPC (~30 LoC change)
- Sidebar nav: add "Settlement Coverage" entry
- ENV: add `SETTLE_VIA_ODDS_API` feature flag (default false until Phase 4)

**ELIMINATED in v2** (vs v1 plan):
- ~~`lib/settlement/special-dispatcher.ts`~~ — special markets filtered at derive, never reach engine
- ~~`/admin/manual-settlement` operator queue~~ — no `manual_required` verdict in v2

**Estimated total**: ~1700 LoC new code, ~250 LoC modified, +3 migrations (152, 153, 154).

**Effort breakdown (v2)**:
- Phase 0.5 baseline measurement: 0.5 day
- **Phase 1.5 derive filter (D.0)**: 1 day (mig 154 + dry-run test + 24h staging observation + cutover)
- D.1 backend (classification module + RPCs + APIs): 1 day
- D.1 frontend (page + filters + drill-down + 🚫 KPI): 1 day
- D.2 engine refactor (cron + shadow logger + dispatch — simpler without SPECIAL_DISPATCHER): 1 day
- D.2 verify-results scoping: 0.5 day
- Fixture authoring (100 bets — no specials, slightly faster): 0.75 day
- Shadow mode observation window: 2 calendar days (mostly waiting + 0.5 day analysis)
- 100-bet validation gate execution + iteration if mismatches: 0.5-1 day
- Phase 4 cutover + 24h monitoring: 0.5 day

**Total: 6-7 working days** end-to-end (calendar: ~10 days given Phase 1.5 + shadow observation). Net **−1.5 days** vs v1 estimate (no SPECIAL_DISPATCHER, no operator queue, no special fixtures, simpler engine).

---

End of design spec.
