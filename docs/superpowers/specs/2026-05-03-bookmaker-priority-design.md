# Bookmaker Pickup — Max-Outcomes Coverage — Design Spec

**Date**: 2026-05-03
**Branch target**: `feature/plan-d-settlement-d1`
**Scope**: Fix outcome invisibility caused by hardcoded bookmaker priority in `v_player_markets`. Replace single-priority pickup with max-active-outcomes coverage, priority as tiebreaker.

## Problem

The view `v_player_markets` selects ONE bookmaker per `(event, market_name, line)` tuple via the LATERAL:

```sql
SELECT DISTINCT ON (m2.market_name, o2.line)
       m2.id, m2.market_name, m2.bookmaker, o2.line, ...
FROM markets_v2 m2
JOIN outcomes_v2 o2 ON o2.market_id = m2.id AND o2.is_active AND round(o2.odds,2) > 1.00
WHERE m2.event_id = e2.id
ORDER BY m2.market_name, o2.line, _bookmaker_priority(m2.bookmaker)
```

`_bookmaker_priority` is a hardcoded SQL CASE: Bet365=1, BetUK=2, LeoVegas=3, Unibet=4, paf=5, BetWinner=6, Pamestoixima=7, Stake=8, DraftKings=9, 1xbet=10, Coral=11, Ladbrokes=12, Stoiximan=13, 888Sport=14, 18bet=15, Paddy Power=16, William Hill=17, ELSE 99. Identical for all sports and all market types.

When the top-priority bookmaker emits a SUBSET of outcomes that downstream bookmakers offer, the missing outcomes disappear from the listing/event page completely. They exist in `markets_v2`+`outcomes_v2`, but the view never exposes them.

### Bug case verified 2026-05-03 — Rugby New Zealand vs Argentina, ML market

| Bookmaker | Priority | Active outcomes | Quotes |
|---|---|---|---|
| Bet365 | 1 | 2 (home, away) | 1.06 / 8.00 |
| BetUK | 2 | 2 (home, away) | 1.12 / 6.00 |
| Unibet | 4 | 2 (home, away) | 1.12 / 6.00 |
| Pamestoixima | 7 | **3 (home, draw, away)** | 1.06 / 19.00 / 8.75 |

Today: Bet365 wins by priority → only 2 outcomes exposed → "Tempo regolamentare (1X2)" column X empty in listing.

DB-level evidence: 117 draw outcomes exist on rugby ML across 55 events (~60-70% of rugby events). The data is there; the view is hiding it.

### Other suspected sports/markets affected by the same pattern

- Basketball / Vincente Tempo Regolamentare (regular time vs OT inclusion variance)
- Ice-hockey / 1X2 TR (history of 3-Way Result vs 3-Way name confusion, mig 167-169)
- Tennis / 5-set match outcomes
- Handball / Tempo Regolamentare

To be quantified by the audit query (Section 5).

## What is already in place

- `markets_v2` and `outcomes_v2` schemas store full multi-bookmaker data (verified: 4237 events, 89931 markets, 1.39M outcomes).
- `v_player_markets` LATERAL filters outcomes by `is_active AND round(odds,2) > 1.00` — this filter is correct and stays.
- `oddsapi_translations` table (mig 159) handles market/outcome name translation independently of pickup logic — no impact.
- `manual_overrides` schema (mig 158) joins via `market_id_v2` UUID — see caveat (a) below.
- `v_player_outcomes` reads `outcomes_v2.market_id` directly — once `v_player_markets` selects the right `market_id`, outcomes flow correctly.
- The fix is contained to ONE view definition. No code changes in `sportsbook-listing-v2.ts`, `sportsbook-detail-v2.ts`, `bet-outcome-dual-resolver.ts`, frontend `categorizeMarketsToTabs`, or anywhere else.

## What is missing

A SQL rule that picks the bookmaker with the MOST active outcomes per `(event, market_name, line)`, falling back to current `_bookmaker_priority` order only when bookmakers tie on outcome count.

## Proposed change

### Single migration: `170_v_player_markets_max_outcomes.sql`

Replace the inner LATERAL of `v_player_markets`. New pickup rule:

```sql
JOIN LATERAL (
  WITH per_market AS (
    SELECT m2.id, m2.market_name, m2.bookmaker, o2.line,
           classify_market_pattern(m2.market_name) AS category,
           COUNT(*) OVER (PARTITION BY m2.market_name, o2.line, m2.bookmaker) AS active_count
    FROM markets_v2 m2
    JOIN outcomes_v2 o2 ON o2.market_id = m2.id
                       AND o2.is_active
                       AND round(o2.odds,2) > 1.00
    WHERE m2.event_id = e2.id
  )
  SELECT DISTINCT ON (market_name, line)
         id, market_name, bookmaker, line, category
  FROM per_market
  ORDER BY market_name, line,
           active_count DESC,
           _bookmaker_priority(bookmaker) ASC,
           bookmaker ASC  -- final stable tiebreaker for unknown bookmakers (priority 99)
) best ON true
```

All other parts of the view definition stay unchanged: outer joins on `oddsapi_translations` and `manual_overrides`, filter `WHERE best.category <> 'special' AND NOT (...)`.

## Decisions taken (brainstorm 2026-05-03)

1. **Pickup rule**: max active outcomes wins; priority breaks ties. Choice (a) of three-way semantic exploration.
2. **Outcome counting**: only `is_active=true AND odds>1.00` count. Choice (i) — suspended outcomes do NOT inflate count for a bookmaker.
3. **Manual overrides drift**: accepted as best-effort. If pickup changes, override may stop applying. Documented in admin runbook. Choice (alpha).
4. **Rollout**: big-bang after pre-deploy audit query. Choice (1) of three-way rollout exploration.
5. **Implementation pattern**: inline rewrite of existing view (Option C of three implementation candidates) — single migration, no new DB objects.

## Caveats and trade-offs

### (a) Manual overrides may "drift" when pickup changes

Manual overrides (mig 158) bind to `outcome_id_v2` UUID of the bookmaker selected AT THE TIME the override was set. If the pickup later switches to a different bookmaker (due to outcome count fluctuation), the new exposed outcomes have different UUIDs, so the override does not apply.

**Mitigation**:
- Documented in commit message and admin runbook. Admin must re-apply override if pickup changes. In test mode (current state) this is harmless. Real-money admin tooling can be hardened later via logical-key overrides (mig refactor — out of scope here).
- **Pre-deploy check**: before applying mig 170, run a query to enumerate all rows in `manual_overrides` whose `outcome_id_v2` (or `market_id_v2`) belongs to a `(event, market_name, line)` tuple where the audit query indicates a pickup change. Surface the list to admin so they can re-apply post-deploy if needed. Sample query:

```sql
SELECT mo.id, mo.scope, mo.market_id_v2, mo.outcome_id_v2,
       e.home || ' vs ' || e.away AS event, m.market_name, o.line
FROM manual_overrides mo
LEFT JOIN markets_v2 m ON m.id = COALESCE(mo.market_id_v2,
                                          (SELECT market_id FROM outcomes_v2 WHERE id = mo.outcome_id_v2))
LEFT JOIN events_v2 e ON e.id = m.event_id
LEFT JOIN outcomes_v2 o ON o.id = mo.outcome_id_v2
WHERE (mo.expires_at IS NULL OR mo.expires_at > now());
-- Then cross-reference with audit query output to see which rows reference a tuple with a pickup change.
```

### (b) Overround can worsen for the player

When a higher-priority bookmaker is replaced by a lower-priority one for outcome coverage, the lower-priority bookmaker often has wider margin.

Example rugby NZ-Argentina ML:
- Today (Bet365): overround = 1/1.06 + 1/8.00 = 1.069 → 6.9% margin
- After fix (Pamestoixima): overround = 1/1.06 + 1/19 + 1/8.75 = 1.107 → 10.7% margin

This is the intrinsic cost of choice (a). User accepted explicitly.

### (c) Pickup stability over time

Active outcome count for a bookmaker can fluctuate (live suspensions, bookmaker removing strikes). The pickup rule re-evaluates on every query → bookmaker may switch between minutes. Frontend receives new prices via SSE/polling.

This is no worse than today: today, Bet365 suspending all outcomes already triggers fallback to BetUK by priority. Now the same fluctuation can swap pickup based on count instead of suspension. Behavior is similar in shape, different in trigger condition.

## Out of scope (deferred to follow-up sessions)

- **Event page market group redesign**: comprehensive review of every sub-tab in event page now that we have a single source (odds-api). Tracked as separate Project B — own brainstorm session, multi-day scope.
- **Logical-key manual overrides**: schema refactor to bind overrides to `(event, market_name, line, outcome_key)` instead of UUID. Hardens admin tooling for real money but unnecessary in test mode.
- **Per-sport bookmaker priority overrides**: data-driven priority table per sport/market_type. Considered but rejected for this fix because max-outcomes already addresses the rugby case without table maintenance burden.

## Audit query (pre-deploy gate)

Executed before applying migration 170. Read-only on prod. Measures impact:

```sql
WITH active_counts AS (
  SELECT m.event_id, m.id AS market_id, m.market_name, m.bookmaker, o.line,
         COUNT(*) AS active_count
  FROM markets_v2 m
  JOIN outcomes_v2 o ON o.market_id = m.id AND o.is_active AND round(o.odds,2) > 1.00
  GROUP BY m.event_id, m.id, m.market_name, m.bookmaker, o.line
),
ranked_old AS (
  SELECT DISTINCT ON (event_id, market_name, line)
         event_id, market_name, line, bookmaker AS old_bookmaker, active_count AS old_count
  FROM active_counts
  ORDER BY event_id, market_name, line, _bookmaker_priority(bookmaker) ASC
),
ranked_new AS (
  SELECT DISTINCT ON (event_id, market_name, line)
         event_id, market_name, line, bookmaker AS new_bookmaker, active_count AS new_count
  FROM active_counts
  ORDER BY event_id, market_name, line, active_count DESC, _bookmaker_priority(bookmaker) ASC
)
SELECT
  COUNT(*) AS total_markets,
  COUNT(*) FILTER (WHERE old_bookmaker <> new_bookmaker) AS changed_pickup,
  COUNT(*) FILTER (WHERE old_bookmaker <> new_bookmaker AND new_count > old_count) AS gained_outcomes,
  AVG(new_count - old_count) FILTER (WHERE old_bookmaker <> new_bookmaker) AS avg_outcomes_gained
FROM ranked_old o
JOIN ranked_new n USING (event_id, market_name, line);
```

Per-sport and per-market_name breakdown queries also executed.

### Decision gate thresholds

- **`changed_pickup` < 10% of total**: proceed without further pause.
- **10% <= changed_pickup <= 30%**: present breakdown to user, await confirmation.
- **changed_pickup > 30%**: stop and reconsider — may indicate the rule has unintended scope.

## Rollout plan

| Step | Action | Time |
|---|---|---|
| 1 | Backup current `v_player_markets` definition via `pg_get_viewdef('v_player_markets'::regclass, true)`, wrap in `CREATE OR REPLACE VIEW v_player_markets AS ...`, save as `170_pre_rollback.sql` | ~1 min |
| 2 | Run audit query, save results into design doc as appendix | ~2 min |
| 3 | Decision gate (apply thresholds above) | ~5 min |
| 4 | `psql -f 170_v_player_markets_max_outcomes.sql` on prod | ~30 sec |
| 5 | Redis FLUSHALL on player to invalidate 30s cache | ~5 sec |
| 6 | Smoke test: rugby fix verified, calcio regression check, latency per sport, /api/health 200 | ~10 min |
| 7 | Monitor `journalctl -u betssolution-player -f` for 30 min, browser test optional | ~30 min |
| 8 | Commit + push branch via VPS bundle pattern | ~5 min |

**Total estimated time**: ~1 hour end-to-end.

### Rollback procedure

```bash
ssh scraper-vps 'psql "$DATABASE_URL" -f /root/betssolution-admin/migrations/170_pre_rollback.sql'
ssh scraper-vps 'redis-cli -u "$(grep ^REDIS_URL /root/betssolution-player/.env.local | cut -d= -f2-)" FLUSHALL'
```

Rollback time: ~30 seconds.

## Testing strategy

### Pre-deploy verification (read-only on prod)

| Test case | Expected outcome |
|---|---|
| Rugby NZ-Argentina ML | bookmaker=Pamestoixima, 3 outcomes (home/draw/away) |
| Calcio Milan-Inter ML | bookmaker=Bet365 (tie 3 vs 3, priority wins), 3 outcomes |
| Tennis Vincente Incontro 2-way | bookmaker=Bet365, 2 outcomes (no regression) |
| Basket Spread .5 | invariato, no regression |
| Mercato dove SOLO Pamestoixima copre (event identified during audit query) | bookmaker=Pamestoixima (correct fallback) |

If any pre-deploy test fails, block rollout and debug.

### Post-deploy smoke test

| Test | Pass criteria |
|---|---|
| Rugby fix active | `/api/sportsbook?sport=rugby&limit=5` shows >=1 event with 3-column 1X2 |
| Listing latency cold | calcio <=500ms, others <=300ms |
| Listing latency warm (within 30s) | all <=30ms |
| Payload size | calcio <=1.5MB, others <=500KB |
| Detail page | `/api/sportsbook?eventId=...` returns 200 OK with markets > 0 |

### Coverage measurement (post-deploy)

Compare per-sport tile listing coverage from memory baseline:
- Rugby `1X2 TR`: expected 17/49 -> ~55/49 events with non-empty 1X2.
- Other sports: same or better. No regression.

## Open follow-ups (not blocking this design)

- (d) Audit may reveal markets where bookmakers add "exotic" outcomes not desired (e.g. variations with OT included). If signal emerges, follow-up with whitelist of expected outcome_keys per market_name. Out of scope here.
- (e) Project B — Event page market group redesign. Separate brainstorm session.

## Verification of dependencies

- **Plan D shadow engine** (`/api/cron/settlement-shadow`): reads `events_v2`/`markets_v2`/`outcomes_v2` directly, bypasses `v_player_markets`. NO impact.
- **Bet/place dual-resolver** (`bet-outcome-dual-resolver.ts`): reads `v_player_outcomes`. View unchanged. Outcomes selected via `market_id`. Once new `v_player_markets` picks the right `market_id`, outcomes flow consistently. Bet integrity preserved.
- **Real-money settlement adapter** (`SETTLE_VIA_ODDS_API` flag): unaffected, settlement uses score data from `events_v2` not market views.

## Deliverables

1. Migration `170_v_player_markets_max_outcomes.sql` (view rewrite)
2. Migration `170_pre_rollback.sql` (rollback dump)
3. Pre-deploy audit query result saved as appendix to this spec
4. Smoke test outcomes documented in commit message
5. Memory update in `next-session-2026-05-03.md` correcting rugby caveat (already partially done, will be finalized post-deploy)
