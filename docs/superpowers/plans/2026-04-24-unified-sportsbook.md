# Unified Sportsbook — implementation plan

**Spec:** `docs/superpowers/specs/2026-04-24-unified-sportsbook.md`

## Phase A — Player API merge (target: 2-3h)

Repo: `C:/Users/philp/Downloads/betssolution/betssolution-player`

### Task A.1 — Audit current query shapes

- [ ] Read `app/api/sportsbook/route.ts` completely — note joins, filters, pagination
- [ ] Read `app/api/sport-counts/route.ts`, `app/api/antepost/route.ts`
- [ ] Read `app/(kiosk)/search/page.tsx` — identify which queries need updating
- [ ] Read `lib/hooks/use-results.ts`

### Task A.2 — Create dedup helpers

- [ ] Create `lib/sportsbook/dedup.ts` exporting:
  - `dedupEventsQuery(supabase, filters)` returning deduplicated events array
  - `dedupMarketsByEvent(supabase, eventIds)` returning markets per-event-id map, deduplicated
- [ ] Implement via RPC if single-trip is cleaner, otherwise inline
- [ ] Unit test against staging DB: given fsid X with 2 events (kambi + 22bet), return 1 (kambi).

### Task A.3 — Migration for helper RPC (optional)

- [ ] If RPC cleaner than client-side: create `supabase/migrations/105_sportsbook_dedup_rpc.sql`
- [ ] Test migration on staging first
- [ ] Deploy to prod via CI

### Task A.4 — Replace filters in 5 endpoints

- [ ] `app/api/sportsbook/route.ts`: `.eq("source", SCRAPER_SOURCE)` → dedupEventsQuery call
- [ ] `app/api/sport-counts/route.ts`: same
- [ ] `app/api/antepost/route.ts`: same
- [ ] `app/(kiosk)/search/page.tsx`: 3 query sites → same
- [ ] `lib/hooks/use-results.ts`: results query — may keep source filter since results are per-source historically

### Task A.5 — Deprecate SCRAPER_SOURCE gradually

- [ ] Mark `lib/scraper-source.ts` as deprecated via JSDoc
- [ ] Keep export for backward compat (kiosk scripts may use it)
- [ ] Don't remove env var from workflow yet — gate after A.8 verification

### Task A.6 — Source badge in UI

- [ ] Add `source` field to event/market render types
- [ ] Add small badge (🟦 K / 🟧 22) on `components/sport/event-card.tsx` or equivalent
- [ ] Verify mobile layout not broken

### Task A.7 — Deploy staging

- [ ] Push to `staging` branch in player repo (or equivalent)
- [ ] `gh workflow run "Deploy Staging"` in player repo
- [ ] Visit staging URL, verify: Kambi event appears once; 22bet-only event appears; no duplicates

### Task A.8 — Canary prod

- [ ] Deploy prod via manual workflow
- [ ] Spot check 10 events visible only on 22bet (long-tail leagues) appear
- [ ] Spot check 10 top Kambi events (Premier/Serie A) appear only once
- [ ] Monitor `/api/sportsbook` latency (p50, p95) via Grafana or logs first 30 min

## Phase B — Settlement canonical-driven (target: 3-4h)

Repo: `C:/Users/philp/Downloads/betssolution/betssolution-admin`

### Task B.1 — CANONICAL_TO_SETTLER dictionary

- [ ] Script `scripts/audit-canonical-settler-gap.ts`: query distinct canonical_keys from market_normalization, cross-ref with SETTLERS in settlement.ts, emit mapping proposals
- [ ] Manual review proposals, commit as `lib/settlement/canonical-dispatch.ts` exporting:
  ```typescript
  export const CANONICAL_TO_SETTLER: Record<string, string> = { ... };
  ```

### Task B.2 — In-memory cache loader

- [ ] `lib/settlement/normalization-cache.ts`:
  - `loadMarketNormalization()` → `Map<`${source}::${marketType}`, {canonical_key, canonical_line}>`
  - `loadOutcomeNormalization()` → `Map<`${canonicalKey}::${source}::${outcomeName}`, canonicalOutcomeKey>`
  - `refresh()` callable, TTL 15min
- [ ] Initial load on settlement batch start
- [ ] Unit test with mock Supabase

### Task B.3 — Refactor resolveSettlerKey

- [ ] Modify `lib/settlement.ts::resolveSettlerKey` to accept optional `source` param
- [ ] Add fallback step after MARKET_PATTERNS loop: if no regex match, call cache lookup
- [ ] Pre-dispatch outcome canonicalization in settleBet or equivalent
- [ ] Keep backward-compat signature (source optional)

### Task B.4 — Settlement pipeline integration

- [ ] `/api/settlement/route.ts`: load caches before loop, pass source to resolveSettlerKey
- [ ] `/api/cron/verify-results`: same

### Task B.5 — Integration test

- [ ] Create `tests/lib/settlement/canonical-dispatch.test.ts`
- [ ] Test case: source='22bet', marketType='U/O 2.5' → should resolve to `O/U` settler via canonical_key `goal_ou`
- [ ] Test case: source='kambi', marketType='Gol totali - Esiti: pari/dispari' → should resolve to `ODD_EVEN`
- [ ] Negative: unknown marketType returns null

### Task B.6 — Deploy staging + prod

- [ ] Push + manual workflow staging
- [ ] Run settlement cron on staging canary 24h
- [ ] If auto-void rate drops significantly, ship prod
- [ ] Monitor `settlement_log` for unexpected verdict changes

## Phase C — Gap-fill (target: 2-3h)

### Task C.1 — Coverage audit

- [ ] Script `scripts/canonical-settlement-coverage.ts`: per canonical_key, show volume (`mv_source_market_types`) vs settler presence
- [ ] Output CSV: canonical_key, volume, has_settler, suggested_action
- [ ] Rank by volume descending, focus top 20

### Task C.2 — Family C combos (1X2+GG, DC+O/U, ecc)

- [ ] Create `lib/settlement/combo-settlers.ts`
- [ ] Implement 5 combo settlers (1X2+GG, 1X2+O/U, DC+O/U, Vincente+GG, X2+O/U)
- [ ] Register in CANONICAL_TO_SETTLER
- [ ] Tests in `tests/lib/settlement/exotic-combos.test.ts` (spec was in old Phase 3 plan, reuse content)

### Task C.3 — Void-by-design table

- [ ] Migration 106: `CREATE TABLE canonical_void_by_design (canonical_key TEXT PRIMARY KEY, reason TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`
- [ ] Insert entries for known-unsettlable canonicals (race markets, minute-based, player props without data)
- [ ] Modify resolveSettlerKey to check this table (cache included)
- [ ] `lib/settlement.ts` VOID_PATTERNS becomes secondary (keeps existing behavior for un-normalized markets)

### Task C.4 — Deploy

- [ ] Combined deploy staging + prod

## Phase 4 — Kambi live operator-merge (target: 1-2h)

Repo: `C:/Users/philp/Downloads/kambi-scraper`

### Task 4.1 — Change operator pinning

- [ ] `src/live-loop.ts`: identify event-to-operator pinning logic (first-seen)
- [ ] Change to: maintain set of operators seeing each event, fetch betOffers from all, merge by betOfferId, dedup outcomes
- [ ] Stats: log per-cycle "events with >1 operator coverage" count

### Task 4.2 — Deploy scraper-vps

- [ ] Build + scp
- [ ] `systemctl restart kambi-scraper.service`
- [ ] Monitor first 2 cycles

### Task 4.3 — Verify

- [ ] Check admin `/admin/scraper-monitor` → live markets per event should increase avg
- [ ] Pick sample U20/minor event, confirm new betOffers appear

## Rollback plan per phase

- **Phase A**: `git revert` commits + redeploy player. Events/markets filter falls back to Kambi-only.
- **Phase B**: resolveSettlerKey change is additive (regex fast path unchanged); revert canonical-dispatch.ts is sufficient.
- **Phase C**: new settlers are purely additive; revert disables them.
- **Phase 4**: revert live-loop.ts on scraper-vps (git + build + restart).

## Sequencing rules

1. Phase A must ship first (user-visible priority)
2. Phase B depends on nothing (orthogonal to A)
3. Phase C depends on B being shipped (uses canonical cache)
4. Phase 4 is independent, can run in parallel with anything

Preferred order: A → B → C → 4, one session each.
