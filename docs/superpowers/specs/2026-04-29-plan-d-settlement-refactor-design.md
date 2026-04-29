---
name: Plan D — Settlement Refactor (odds-api primary + Flashscore stats fallback)
description: Refactor settlement engine to consume odds-api scores as primary source for score-based markets, keeping Flashscore as stats source for corners/cards/players. Includes /admin/settlement-coverage observability page and 100-bet validation gate.
type: design-spec
date: 2026-04-29
status: draft
---

# Plan D — Settlement Refactor Design

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
- G1. Use `events_v2.scores` (odds-api) as authoritative score source for score-based markets, replacing Flashscore for these.
- G2. Reduce Flashscore load: `verify-results` cron only fetches events with bets pending on stats/player markets.
- G3. Reduce settlement latency: score-based markets settle within 1-2 min of `events_v2.status='settled'` (vs 5-15 min current FS path).
- G4. Build `/admin/settlement-coverage` observability page that classifies every market type (score / stats / player / special) and surfaces real bet metrics per market — this page becomes the decision tool for future scope reductions (drop stats markets? buy stats provider?).
- G5. Validate the new settlement path against ≥100 historical bets covering the full market catalog before cutover. Zero regressions vs current settlement.

**Secondary**:
- G6. Single source of truth for market classification: `MARKET_CATEGORIES` dict shared by page (D.1) and engine (D.2). No drift.
- G7. Backwards-compatible bet schema: no migration of existing `bet_selections` rows. Schema simplification deferred to Plan E.

## 4. Non-goals

- N1. **Killing Flashscore-scraper entirely**: remains alive as stats source. Decommission deferred until either (a) we drop stats markets from offering, or (b) we adopt an alternative stats provider (Plan E).
- N2. **Removing the 5 canonical layer admin pages all at once**: the canonical layer simplifies but doesn't fully die in Plan D — score-based markets bypass it, stats markets still use it. Page-level cleanup is incremental.
- N3. **Schema migration of `bet_selections.market_type`** to use odds-api keys. Bets continue storing the IT-translated label produced by `derive_legacy_from_v2()`. Classifier maps text → category at runtime.
- N4. **New stats provider evaluation** (Sportradar/Sportmonks). Out of scope; if D.1 metrics suggest it's worth it, that's Plan E.
- N5. **Real-time live-stats settlement** (cash-out support on stats markets during live). Existing gap; not addressed here.

## 5. Architecture overview

```
┌──────────────────────────────────────────────────────────────────┐
│                    Plan D — 2 sub-components                      │
├─────────────────────────┬────────────────────────────────────────┤
│ D.1 Settlement Coverage │ D.2 Settlement Engine refactor          │
│ /admin/settlement-      │ lib/settlement.ts + cron                │
│   coverage              │                                         │
├─────────────────────────┼────────────────────────────────────────┤
│ Observability:          │ Routing:                                │
│ - market catalog table  │ - score → settle from events_v2.scores  │
│ - 4 categories          │ - stats → existing FS path (scoped)     │
│ - bet metrics 7d/30d    │ - player → existing FS path (scoped)    │
│ - drill-down            │ - special → case-by-case                │
└──────┬──────────────────┴───────────────────┬────────────────────┘
       │            shared core               │
       └────►  lib/settlement/                ◄────┘
              market-classification.ts
              (MARKET_CATEGORIES dict, classify(),
               isScoreOnly(), requiresStats(), requiresPlayer())
```

The classification module is the **load-bearing contract**: page reads it for display, engine reads it for routing. They never disagree by construction.

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
  cat = classify(leg.market_type)         // 'score'|'stats'|'player'|'special'

  if cat == 'score':
    result = buildResultFromOddsApi(events_v2.scores)
    verdict = SETTLERS[settler_key](result, outcome.name, line)
    // SETTLERS reused as-is

  elif cat == 'stats':
    result = buildResultFromFlashscore(events.live_data.stats)
    verdict = STATS_SETTLERS[market_type](result, outcome.name, line)

  elif cat == 'player':
    result = buildPlayerEventsFromFlashscore(events.live_data.scorers)
    verdict = PLAYER_SETTLERS[market_type](result, outcome.name)

  elif cat == 'special':
    verdict = SPECIAL_DISPATCHER[market_type](leg, events.live_data, events_v2)
    // mixed: some derivable from scores+periods, some need stats
```

## 6. Component D.1 — `/admin/settlement-coverage`

### 6.1 Page layout

**Top KPI strip** (4 cards, 7d window default):
- 🟢 % bet auto-settleable (score-only markets)
- 🟡 % bet require stats (Corners/Cards/Shots)
- 🔴 % bet require player events (Goalscorers/etc)
- ⚪ % bet on special markets (case-by-case)

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

**⚪ Special** (case-by-case, has sub-classifier):
- Goal Method (`header`/`penalty`/`own goal`/`shot` — needs FS scorer details)
- First 10 Minutes (00:00 - 09:59) — derivable from period scores if present
- "Specials" generic catchall — manual per-event

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
-- in the page as "unclassified" so we can add them to the dict.
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
4. `SPECIAL_DISPATCHER` for the ~5-10 special markets, with hardcoded per-market handlers.

### 7.4 Bet schema — unchanged

`bet_selections` rows continue to store:
- `market_type` text (IT, e.g. "U/O 2.5")
- `outcomes.name` text (e.g. "Over", "Under", "Sì", "1")
- `markets.line` numeric (e.g. 2.5)

No DB migration. Classifier maps `market_type` text → category at runtime via `MARKET_CATEGORIES` dict.

Schema simplification (storing odds-api `market_key + outcome_key + line` directly) is deferred to a separate Plan E.

## 8. Data model changes

| Table | Change | Migration |
|---|---|---|
| `events_v2` | Add column `last_settled_at timestamptz NULL` + partial index `WHERE status='settled' AND last_settled_at IS NULL` | mig 152 |
| `market_categories_seed` | NEW: 1 row per market_type, columns `(market_type text PK, category text, source text, notes text)` | mig 152 |
| RPC `next_unsettled_with_stats_legs(lim int)` | NEW | mig 152 |
| RPC `settlement_coverage_list(window_days int)` | NEW | mig 152 |
| RPC `settlement_coverage_kpis(window_days int)` | NEW | mig 152 |

No changes to `bet_selections`, `bets`, `outcomes`, `markets`, `events`.

## 9. Migration & rollout plan

**Phase 0 — Spec + plan** (this doc + writing-plans output)

**Phase 0.5 — Baseline measurement** (prerequisite, ~30min)
Before Phase 1 starts, measure on prod over last 30d:
- % of bet legs by category (run §6.4 SQL after seed table populated, but pre-page)
- Current settlement latency p50/p90 for finished events
- Current FS call volume per hour
These numbers go into the spec's success criteria (§13) as concrete targets, replacing the placeholder "≥80%" assertion.

**Phase 1 — Classification module + page (D.1)**
- Implement `lib/settlement/market-classification.ts` + tests
- Apply mig 152 (table + RPCs)
- Build `/admin/settlement-coverage` page
- Validate: KPI numbers reasonable, no markets unclassified
- **Gate**: user reviews page, confirms classification accuracy

**Phase 2 — Engine refactor in shadow mode (D.2)**
- Implement new cron `/api/cron/odds-api-settle` but **dry-run only**: writes to `settlement_log_shadow` table, no actual `bet_selections.result` UPDATE
- Run for ≥48h alongside current FS settlement
- Compare verdicts: shadow vs real path, flag discrepancies
- **Gate**: ≤0.5% verdict mismatch on score-only legs across ≥1000 settled legs

**Phase 3 — 100-bet validation gate** (see §10)
- Synthetic bet fixture covering all 4 categories, ≥100 bets total
- Run end-to-end through new path
- **Gate**: 100% expected verdicts

**Phase 4 — Cutover**
- Flip cron to live mode (actual UPDATE)
- Refactor `verify-results` to scope to stats/player legs only
- Monitor for 24h: settlement latency, pending-bet count, error rate

**Phase 5 — Cleanup**
- After 30d stable: archive `settlement_log_shadow`
- Document the classification dict as the public reference for "what each market does"

**Rollback plan**: at any phase, set feature flag `SETTLE_VIA_ODDS_API=false`, system falls back to current FS-only path. Toggle via env var, no code revert needed.

## 10. Testing strategy

### 10.1 Unit tests (existing patterns)

`tests/lib/settlement/market-classification.test.ts`:
- Every entry in `MARKET_CATEGORIES` covered by ≥1 test.
- Unknown market_type returns `'special'` with warning log (fail-safe).

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

**Coverage matrix**:

| Category | Markets | # cases | Edge cases included |
|---|---|---|---|
| 🟢 Score | 1X2, OU, BTTS, DC, DNB, HT, HT/FT, Spread, Asian H., Exact Score, Goal Line, Number Goals, Odd/Even | 60 | 0-0, pushes, half-line, integer line, void, 5+ goals |
| 🟡 Stats | Corners (3 lines), Cards (2 lines), Shots, Tackles | 20 | exact line, half-line, no-stats fallback |
| 🔴 Player | Anytime Goalscorer (3 cases), Multi Scorers, Player Shots | 15 | scored/not, OG counted/not, sub minute |
| ⚪ Special | Goal Method, First 10 Min | 5 | mixed (see note) |
| **Total** | — | **100** | — |

**Note on special fixtures**: in v1, `SPECIAL_DISPATCHER` does NOT auto-settle — it returns `verdict='manual_required'` for every special market and routes the leg to an operator queue. The 5 special fixture cases therefore validate the **routing behavior** (correct flag emitted, no false auto-settle), not the verdict logic. Per-market settlers for specials are out of scope for Plan D and live in a future Plan E.

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
| R7 | flashscore_id coverage 49.5% means stats/player legs on uncovered events permanently pending | High (existing) | High | Pre-existing problem (todo-live-stats-coverage-gap.md). Not solved by Plan D. Surfaced on coverage page → drives Plan E (alternate stats provider). |

## 13. Success criteria

After Phase 4 (cutover) complete and 30d in production:

- ✅ ≥**[BASELINE_FROM_PHASE_0.5]%** of bet legs auto-settled by odds-api path. Target set as `(score-only baseline %) − 5pp` to allow for genuine score/stats mix events that hit both triggers. Concrete number filled in after Phase 0.5 measurement.
- ✅ Settlement latency p50 ≤2 min for score-only legs (vs current ~10 min)
- ✅ Flashscore call volume reduced ≥50% from baseline
- ✅ Zero increase in manual-settlement cases
- ✅ Settlement-coverage page used by operators (≥1 visit/day)
- ✅ 100/100 bet validation gate passed before cutover
- ✅ Shadow-mode mismatch ≤0.5% for ≥1000 legs

## 14. Open questions

1. **Fixture authoring** for 100-bet validation: do we generate synthetic events_v2/scores rows from existing prod data (anonymized), or hand-craft entirely? Suggest 50/50.

2. **`market_categories_seed` table editability**: should operators be able to update categories via admin UI, or is it strictly code-defined (TS source + migration)? Suggest code-only initially, UI editor as Plan E if needed.

3. **What happens to bets on events with NO `events_v2` mapping** (legacy kambi niche, betfair, etc)? They never trigger Trigger A. They fall through to Trigger B (FS path) as today. **Verify**: ensure Trigger B doesn't filter them out.

4. **Specials sub-classifier**: design TBD per-market. Some specials (Goal Method) need FS scorer details — effectively they're player-event markets. Others (First 10 Min) derivable from period scores + minute markers (which odds-api doesn't expose). Plan D does NOT auto-settle specials in v1; they continue manual or via existing FS path until per-market handler written.

5. **Bet placement validation**: should we block bet placement on markets where classifier returns `'special'` and no settler is implemented? Or accept and rely on operator queue? Suggest accept + flag in `/admin/settlement-coverage` as "settler missing" so it's visible.

## 15. Files to create / modify

**NEW**:
- `lib/settlement/market-classification.ts` (~150 LoC)
- `lib/settlement/odds-api-result.ts` (~100 LoC) — `buildResultFromOddsApi()`
- `app/api/cron/odds-api-settle/route.ts` (~200 LoC)
- `app/api/admin/settlement-coverage/list/route.ts` (~80 LoC)
- `app/api/admin/settlement-coverage/drill-down/route.ts` (~80 LoC)
- `app/admin/settlement-coverage/page.tsx` (~250 LoC)
- `app/admin/settlement-coverage/components/{kpi-strip,catalog-table,drill-down-modal}.tsx`
- `supabase/migrations/152_settlement_coverage_and_v2_settled_at.sql`
- `tests/lib/settlement/market-classification.test.ts`
- `tests/lib/settlement/odds-api-settler.test.ts`
- `tests/api/cron/odds-api-settle.test.ts`
- `tests/integration/100-bets-settlement.test.ts`
- `tests/fixtures/settlement/100-bets.json`

**MODIFIED**:
- `lib/settlement.ts` — branching dispatch by category (ca. +200 LoC, no removal)
- `app/api/cron/verify-results/route.ts` — scope to stats/player legs only (~30 LoC change)
- Sidebar nav: add "Settlement Coverage" entry
- ENV: add `SETTLE_VIA_ODDS_API` feature flag (default false until Phase 4)

**Estimated total**: ~1500 LoC new code, ~250 LoC modified, +1 migration.

**Effort breakdown** (revised from initial 4-6 day estimate to include fixture work and shadow observation):
- Phase 0.5 baseline measurement: 0.5 day
- D.1 backend (classification module + RPCs + APIs): 1 day
- D.1 frontend (page + filters + drill-down): 1 day
- D.2 engine refactor (cron + shadow logger + dispatch): 1.5 days
- D.2 verify-results scoping: 0.5 day
- **Fixture authoring (100 bets, real+synthetic)**: 1 day — explicitly budgeted, often underestimated
- Shadow mode observation window: 2 calendar days (mostly waiting + 0.5 day analysis)
- 100-bet validation gate execution + iteration if mismatches: 0.5-1 day
- Phase 4 cutover + 24h monitoring: 0.5 day

**Total: 7-8 working days** end-to-end (calendar: ~2 weeks given shadow observation).

---

End of design spec.
