# Consensus Fix + Event Normalization + Manual Override + Canonical Events — Design Spec

**Date**: 2026-04-22
**Status**: Draft, pending approval
**Scope**: Migrations 086 (consensus fix), 087 (event normalization), 088 (manual override core), 089 (canonical events layer). Migration 090+ (auto-suspend) deferred to Appendix A.
**Source brainstorm**: 5 design questions resolved during session 2026-04-22. See `Design Decisions` section.

## Problem

The admin page `/admin/consensus` is currently broken and read-only. Multiple cascading problems:

1. **RPC crash**. `refresh_consensus_snapshots()` raises `ON CONFLICT DO UPDATE command cannot affect row a second time`. After migration 040 introduced join via `canonical_key`, multiple 22bet `market_type` values normalize to the same canonical (e.g. `Totale 2.5` + `Goal Totali 2.5` → both `u_o_ft_2.5`). The UPSERT conflict key `(kambi_event_id, market_type, outcome_name, hour)` receives duplicate rows → PostgreSQL aborts.
2. **Duplicate UI rows**. `consensus_snapshots` is a time-series (one row per hour bucket per outlier). A persistent outlier produces 24 rows/day. `listOutliers` in `app/api/admin/consensus/route.ts` does not deduplicate by latest.
3. **Mono-sport dropdown**. Event matching uses regex fuzzy on home/away team names. Works for Italian football clubs, fails for tennis (initial names), basket (abbreviations), MMA (name order). Combined with RPC crash preventing refresh → table stale on calcio data.
4. **Missing operator control layer**. Even when outliers are visible, operator cannot suspend/override/dismiss them from the page. Any intervention requires direct DB manipulation. When a scraper bug produces `Fagiano Okayama 3-4 @ 181` odds, the outcome reaches the kiosk player unchecked.
5. **Strategic blocker**. Long-term, `events` mixes identity concerns (which match is this?) with pricing/markets concerns (what odds per source?). Cross-source operations (settlement fan-out, consensus, best-odds player views) all rebuild the identity mapping ad-hoc. Each feature that needs cross-source matching reinvents regex/trigram/LLM plumbing.

## Goals

- **086**: `/admin/consensus` no longer crashes, shows multi-sport, one row per outlier.
- **087**: Pipeline that auto-maps `events.flashscore_id` to ≥ 95% coverage across all supported sports, with human-in-the-loop admin UI for confirmation and edge cases. Pattern mirrors the existing `lib/normalize/` market-normalization engine (94% coverage as of session 2026-04-21).
- **088**: Operator can suspend, override, or dismiss any outcome directly from `/admin/consensus`, with audit trail, TTL, and protection against scraper upsert overwrites. Feedback loop from dismiss category to normalization issues queue.
- **089**: Introduce `canonical_events` identity layer, backfilled from existing `events.flashscore_id`, with fan-out trigger propagating Flashscore result updates to all linked events. Rewrite consensus RPC to JOIN on `canonical_event_id`.
- Every layer is additive — consumer-side code (player frontend, settlement, SSE) sees no breaking change at any step.

## Non-goals (for this spec)

- **Auto-suspend automation** (detection + tiered thresholds + Slack notification + kill switch). Infrastructure deferred to Appendix A + future migration 090+. Gate of activation: event-normalization coverage ≥ 99% AND outcome-normalization ≥ 80%, with ≥ 2 weeks of manual-only 088 operation to collect baseline metrics.
- **Outcome-level normalization** beyond what exists from migration 065. Covered by separate Phase 3 work.
- **Settlement engine refactoring**. `lib/settlement.ts` continues to read from `events.result`; the 089 fan-out trigger keeps `events` in sync with `canonical_events`, so settlement is unchanged.
- **Consensus pagination or performance optimization** beyond what the RPC rewrite in 089 achieves naturally. Long-term query optimization left for future work.
- **Level 4 UI/UX polish**. `/admin/canonical-events` is a functional admin tool, not a polished dashboard. Visual refinement is future work.

## Design Decisions

Resolved during brainstorming session 2026-04-22:

| Q | Decision | Rationale |
|---|---|---|
| **Q1** — DISTINCT ON strategy in consensus RPC | Order by `delta_pct DESC, twobet_outcomes_count DESC, market_type ASC` | Keep the most dramatic outlier (signal maximization). Tiebreak by liquidity (prefer stable markets over obscure ones), then deterministic for reproducibility. |
| **Q2** — LLM strategy for event-norm stage 5 | Subagent-only now. Re-evaluate Anthropic API after 14 days of metrics | Zero commitment to €15-20/month before measuring real orphan rate. Subagent pattern already validated for markets. Spec infrastructure prepared so API activation is 2-3h work if data justifies. |
| **Q3** — Scraper upsert protection for manual_* | Whitelist SET in scraper RPC + DB trigger `preserve_manual_fields` (belt & suspenders) | Explicit in scraper code (readability) + DB-enforced (impossible to bypass via future upsert paths). Admin APIs bypass trigger via `SET LOCAL app.admin_manual_override = 'on'`. |
| **Q4** — Auto-suspend in 088 | Deferred. 088 ships manual-only. Auto-suspend → Appendix A → mig 090+ | FP risk real while event/outcome normalization maturing. Testing phase (not production traffic). No urgency to automate; human-in-the-loop is appropriate until coverage matures. |
| **Q5** — Level 4 (canonical_events) scope | Full design in this spec (not separate file, not appendix-only) | User requested full treatment today. 087 design partially explained by Level 4 endgame; documenting both in one spec keeps motivation traceable. |

## Architecture

```
                         ┌──────────────────────────┐
                         │  canonical_events (089)  │ ← IDENTITY LAYER
                         │  id (uuid PK)            │
                         │  flashscore_id (UNIQUE)  │
                         │  sport, league, teams    │
                         │  starts_at, status       │
                         │  score_home/away, result │
                         └───────────▲──────────────┘
                                     │ 1:N
                                     │ canonical_event_id (FK, NULLABLE)
                         ┌───────────┴──────────────┐
                         │  events (existing)       │ ← PRICING/MARKETS LAYER
                         │  id, source, external_id │
                         │  canonical_event_id      │ ⟵ NEW in 089
                         │  flashscore_id (legacy)  │ ⟵ still populated by 087
                         └───────────▲──────────────┘
                                     │ 1:N
                     ┌───────────────┴────────────────┐
                     │  markets → outcomes            │
                     │  + manual_* (088) ─────────────┼─→ protected by trigger 088D
                     └────────────────────────────────┘

   UPSTREAM (not modified by this spec):
   ┌──────────────────┐   ┌──────────────────┐
   │ kambi-scraper    │──▶│ upsert_outcomes  │─┐
   └──────────────────┘   └──────────────────┘ │─▶ RLS + trigger + player SSE
   ┌──────────────────┐   ┌──────────────────┐ │
   │ 22bet-scraper    │──▶│ upsert_outcomes  │─┘
   └──────────────────┘   └──────────────────┘

   ORCHESTRATION:
   ┌──────────────────────────────────────┐
   │ lib/normalize/events/engine.ts (087) │ → event_normalization
   │   5-stage pipeline                   │ → team_mapping (cache)
   │   1. flashscore_native               │ → canonical_events (089 write path)
   │   2. regex                           │
   │   3. trigram + alias_dict            │
   │   4. propagation                     │
   │   5. llm (subagent)                  │
   └──────────────────────────────────────┘
```

### Temporal sequence

```
086 (1h)     │ Consensus fix — solo fix read-side. No dependencies. Ship first.
087 (1 day)  │ Event normalization — reuses events.flashscore_id. Ship parallel or after 086.
088 (1.5 d)  │ Manual override — schema + API + UI + scraper protection. Ship parallel to 087.
089 (3-5 d)  │ Canonical events — requires 087 at ≥ 95% coverage. Ship after ≥ 1 week of 087 prod data.
Future 090+  │ Auto-suspend — requires 087+088 live + 2 weeks of dismiss audit data.
```

### Read path impact

| Consumer | Reads from | Changes with this spec |
|---|---|---|
| Player frontend (betssolution-player) | `events` + `outcomes` | 088: add `manual_odds`, `manual_suspended` to SELECT |
| Admin dashboards (general) | `events`, `markets`, `outcomes` | No |
| Consensus page | via RPC + view `v_consensus_latest` | 086 view, 089 RPC rewrite |
| Settlement engine | `events.result` | No (089 trigger keeps events in sync) |
| Market normalization | `markets`, `canonical_markets` | No |
| SSE stream | `events` + `outcomes` | 088: add manual_* to serializer |
| Event normalization (new) | `events`, `team_aliases`, `team_mapping`, `be_fixtures` | 087 introduces |

**No breaking changes** for any existing consumer at any migration step.

---

## Level 1 — Migration 086: Consensus Fix

### Problem recap

- RPC crash on duplicate canonical_key mapping.
- UI shows one row per hour bucket instead of latest-only.
- Matching limited to football via regex fuzzy.
- Dropdown markets limited to numeric outcome names.

### Solution components

Three changes, one migration file + one code change in `app/api/admin/consensus/route.ts`.

### 086.1 — Rewrite `refresh_consensus_snapshots` RPC

**Pivot tmp_pairs via flashscore_id with regex fallback:**

```sql
WITH tmp_pairs AS (
  -- Priority 1: exact flashscore_id match (unlocks all sports where fs_id populated)
  SELECT k.id AS kambi_id, t.id AS twobet_id, 1 AS match_priority
  FROM events k
  JOIN events t ON k.flashscore_id = t.flashscore_id
  WHERE k.source = 'kambi' AND t.source = '22bet'
    AND k.flashscore_id IS NOT NULL

  UNION ALL

  -- Priority 2: regex fuzzy fallback (existing behavior preserved for orphans)
  SELECT k.id, t.id, 2 AS match_priority
  FROM events k
  JOIN events t ON
    lower(regexp_replace(k.home_team, '[^a-zA-Z0-9]', '', 'g')) =
    lower(regexp_replace(t.home_team, '[^a-zA-Z0-9]', '', 'g'))
    AND lower(regexp_replace(k.away_team, '[^a-zA-Z0-9]', '', 'g')) =
        lower(regexp_replace(t.away_team, '[^a-zA-Z0-9]', '', 'g'))
    AND k.starts_at BETWEEN t.starts_at - interval '2h' AND t.starts_at + interval '2h'
  WHERE k.source = 'kambi' AND t.source = '22bet'
),
pairs AS (
  -- Per kambi event, keep one twobet pair; prefer flashscore match
  SELECT DISTINCT ON (kambi_id) kambi_id, twobet_id
  FROM tmp_pairs
  ORDER BY kambi_id, match_priority ASC
)
```

**Candidates CTE with DISTINCT ON (resolves ON CONFLICT crash — Q1=B):**

**Inherited limitation (not introduced by 086):** the JOIN on `tm.canonical_key = km.canonical_key` depends on both kambi and 22bet markets having `canonical_key` populated. Post market-normalization Wave 34 (mig 085), kambi coverage is ~94% and 22bet ~67%. Markets lacking canonical_key are excluded from the outlier pipeline. This limitation pre-dates 086 (introduced by mig 040). 086 does NOT make it worse — kambi-orphan markets that had canonical_key were NOT matched cross-source pre-086 either (they had no 22bet counterpart via canonical). After 089, when `canonical_event_id` replaces the flashscore/regex pivot, this canonical_key market-level constraint remains the residual blocker to 100% outlier coverage. Addressed separately by ongoing market-normalization phases.

```sql
candidates AS (
  SELECT
    k.id AS kambi_event_id,
    km.market_type,                              -- kambi market_type (stable)
    ko.name AS outcome_name,
    ko.odds AS kambi_odds,
    to_.odds AS twobet_odds,
    abs((ko.odds - to_.odds) / to_.odds) * 100 AS delta_pct,
    COUNT(*) OVER (PARTITION BY tm.id) AS twobet_outcomes_count,
    tm.market_type AS twobet_market_type_raw      -- 22bet raw market_type (variable)
  FROM pairs p
  JOIN events k ON k.id = p.kambi_id
  JOIN markets km ON km.event_id = k.id AND km.is_active
  JOIN outcomes ko ON ko.market_id = km.id AND ko.is_active
  JOIN markets tm ON tm.event_id = p.twobet_id
                  AND tm.canonical_key = km.canonical_key
                  AND tm.is_active
  JOIN outcomes to_ ON to_.market_id = tm.id
                    AND to_.name = ko.name
                    AND to_.is_active
  WHERE abs((ko.odds - to_.odds) / to_.odds) >= :threshold / 100.0
),
dedup AS (
  SELECT DISTINCT ON (kambi_event_id, market_type, outcome_name)
    kambi_event_id, market_type, outcome_name,
    kambi_odds, twobet_odds, delta_pct,
    twobet_outcomes_count, twobet_market_type_raw
  FROM candidates
  ORDER BY kambi_event_id, market_type, outcome_name,
           delta_pct DESC,              -- Q1=B: biggest delta wins (most dramatic outlier)
           twobet_outcomes_count DESC,  -- Tiebreak 1: prefer liquid markets
           twobet_market_type_raw ASC   -- Tiebreak 2: deterministic
)
INSERT INTO consensus_snapshots (
  kambi_event_id, market_type, outcome_name,
  kambi_odds, twobet_odds, delta_pct,
  twobet_outcomes_count, twobet_market_type_raw,
  snapshot_at, hour_bucket
)
SELECT
  kambi_event_id, market_type, outcome_name,
  kambi_odds, twobet_odds, delta_pct,
  twobet_outcomes_count, twobet_market_type_raw,
  now(),
  date_trunc('hour', now() AT TIME ZONE 'UTC')
FROM dedup
ON CONFLICT (kambi_event_id, market_type, outcome_name, hour_bucket)
DO UPDATE SET
  kambi_odds = EXCLUDED.kambi_odds,
  twobet_odds = EXCLUDED.twobet_odds,
  delta_pct = EXCLUDED.delta_pct,
  twobet_outcomes_count = EXCLUDED.twobet_outcomes_count,
  twobet_market_type_raw = EXCLUDED.twobet_market_type_raw,
  snapshot_at = now();
```

**Rationale for Q1=B choice:**
- Primary sort by `delta_pct DESC` maximizes signal: the page exists to spot bugs, bigger delta = more suspicious = more useful.
- Tiebreak 1 `twobet_outcomes_count DESC` prefers liquid markets (market with 12 outcomes is more likely authoritative than one with 2 outcomes). Prevents noise on obscure market_type winning against core 1X2 on identical delta.
- Tiebreak 2 `twobet_market_type_raw ASC` makes the output deterministic across RPC refreshes — two rows with identical delta AND identical outcomes_count resolve by lexical order of 22bet market_type. Without this, two successive refreshes can produce different surviving rows from the same data.

**Requires new column on consensus_snapshots.** Add via ALTER TABLE at top of 086:

```sql
ALTER TABLE consensus_snapshots
  ADD COLUMN IF NOT EXISTS twobet_outcomes_count integer,
  ADD COLUMN IF NOT EXISTS twobet_market_type_raw text;
```

Existing rows have NULL; new RPC populates going forward.

**Lightweight dedup visibility (advisory, optional in 086):** the DISTINCT ON silently discards candidate rows when two 22bet canonicals collapse. To avoid fully hiding this signal, add a `RAISE NOTICE` at the end of the RPC with a count of discarded rows (easily reachable via PG logs):

```sql
-- After the INSERT ... ON CONFLICT ... DO UPDATE
GET DIAGNOSTICS v_final_rows = ROW_COUNT;
SELECT count(*) INTO v_candidate_rows FROM candidates
  WHERE abs((kambi_odds - twobet_odds) / twobet_odds) >= :threshold / 100.0;
IF v_candidate_rows > v_final_rows THEN
  RAISE NOTICE 'consensus dedup: % candidates collapsed to % rows (% dropped)',
    v_candidate_rows, v_final_rows, v_candidate_rows - v_final_rows;
END IF;
```

Emits to postgres logs, no table required. If the dropped count grows over time, indicates normalization mismatches worth investigating via future `consensus_candidates_debug` (Appendix B #1).

### 086.2 — View `v_consensus_latest` for UI

Eliminates UI duplicate rows (Fagiano × 3 issue):

```sql
CREATE OR REPLACE VIEW v_consensus_latest AS
SELECT DISTINCT ON (kambi_event_id, market_type, outcome_name)
  id, kambi_event_id, market_type, outcome_name,
  kambi_odds, twobet_odds, delta_pct,
  twobet_outcomes_count, twobet_market_type_raw,
  snapshot_at, hour_bucket
FROM consensus_snapshots
ORDER BY kambi_event_id, market_type, outcome_name, snapshot_at DESC;
```

Read-side only. KPI aggregates and refresh RPC still read/write `consensus_snapshots` directly (full history preserved).

### 086.3 — Code change: `listOutliers()`

File: `app/api/admin/consensus/route.ts`.

```typescript
// Before
const { data } = await supabase
  .from("consensus_snapshots")
  .select(...)
  ...;

// After
const { data } = await supabase
  .from("v_consensus_latest")
  .select(...)
  ...;
```

Other callers (refresh endpoint, KPI aggregates, dismiss operations in 088) continue to use `consensus_snapshots` directly.

### 086 — Test plan

1. **Apply 086 to staging DB** via CI/CD or manual psql. Verify migration applies cleanly.
2. **Invoke RPC synthetically**: `SELECT refresh_consensus_snapshots(30);`. Expect success (no ON CONFLICT exception). Without fix, this crashes immediately.
3. **Verify pivot preference**: identify one event with flashscore_id on both kambi and 22bet side. Query EXPLAIN on the tmp_pairs CTE to confirm flashscore join executes. Independently, pick an event with no flashscore_id and verify regex fuzzy still matches.
4. **Verify dedup**: find an event with 2 twobet market_types collapsing to one canonical_key (e.g., search for `Totale 2.5` and `Goal Totali 2.5` on same event). After RPC run, only one row in consensus_snapshots for that (kambi_event, market_type, outcome_name, hour_bucket).
5. **Verify view dedup**: query `v_consensus_latest` for an event with multiple `snapshot_at` values across hours — expect exactly 1 row per (kambi_event_id, market_type, outcome_name) tuple, with the latest `snapshot_at`.
6. **Frontend smoke**: load `/admin/consensus` on staging. Confirm: (a) page renders without error banner, (b) sport dropdown shows ≥ 3 sport categories assuming flashscore_id populated across sources, (c) no visible duplicate rows for persistent outliers.
7. **Prod deploy**: via CI/CD workflow (dual-write to admin-staging.betssolution.com still active — verify both admin endpoints show same post-deploy behavior).

### 086 — Rollback

Migration is idempotent for the RPC body and view:

```sql
-- 086_rollback.sql
DROP VIEW v_consensus_latest;
-- Restore RPC to mig 040 version (copy-paste from git history)
CREATE OR REPLACE FUNCTION refresh_consensus_snapshots(...)
-- ... pre-086 body ...

-- ALTER TABLE drops left in place — NULL columns are harmless.
-- If truly needed: ALTER TABLE consensus_snapshots DROP COLUMN twobet_outcomes_count, twobet_market_type_raw;
```

Code change: revert `app/api/admin/consensus/route.ts` via git.

### 086 — Effort estimate

- Migration SQL: 30min
- Code change: 15min
- Local test: 15min
- Staging deploy + smoke: 15min
- Prod deploy + verification: 15min
- **Total: ~1.5h**

---

## Level 2 — Migration 087: Event Normalization

### Problem recap

Only ~50-60% of events have `flashscore_id` populated today (via `/api/flashscore/fixtures/route.ts` regex fuzzy). Stages 1-4 cascading plus LLM fallback should push coverage to ≥ 95%. Without this, Level 4 (canonical_events) has 40% orphans and consensus multi-sport remains partial.

### 087.1 — Schema

**Migration 087 in 3 parts:**

**A) New `event_normalization`**

```sql
CREATE TABLE event_normalization (
  id bigserial PRIMARY KEY,
  event_id uuid UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  flashscore_id text NOT NULL,
  match_stage text NOT NULL
    CHECK (match_stage IN (
      'flashscore_native','regex','trigram','alias_dict','propagation','llm','manual'
    )),
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  llm_reason text,
  verified boolean DEFAULT false,
  verified_at timestamptz,
  verified_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_event_norm_stage ON event_normalization(match_stage);
CREATE INDEX idx_event_norm_pending ON event_normalization(confidence)
  WHERE NOT verified AND confidence BETWEEN 0.80 AND 0.94;
CREATE INDEX idx_event_norm_unverified ON event_normalization(verified, created_at)
  WHERE NOT verified;
```

**B) Extend existing `team_aliases` (from mig 013)**

Preserves existing 90+ seeded aliases. Adds optional columns:

```sql
ALTER TABLE team_aliases
  ADD COLUMN IF NOT EXISTS sport text,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS verified boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);
CREATE INDEX idx_team_aliases_sport ON team_aliases(sport) WHERE sport IS NOT NULL;
```

- `sport = NULL` means "applies to any sport" (backward compatible with existing seeds).
- `source = NULL` means "applies to any source".
- Existing UNIQUE `(canonical, alias)` constraint preserved; no duplicate conflicts.
- A post-migration script may tag seed rows with `sport = 'football'` where applicable (club names); national teams stay `sport = NULL` since national = multi-sport.

**C) New `team_mapping` (propagation cache)**

```sql
CREATE TABLE team_mapping (
  id bigserial PRIMARY KEY,
  sport text NOT NULL,
  source text NOT NULL,
  raw_name text NOT NULL,
  flashscore_team_id text,                  -- NULL = negative cache (confirmed no match)
  canonical_name text,
  verified boolean DEFAULT false,
  verified_at timestamptz,
  verified_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(sport, source, raw_name)
);
CREATE INDEX idx_team_mapping_fs ON team_mapping(flashscore_team_id);
```

Cache of confirmed `(sport, source, raw_name) → flashscore_team_id` mappings. Populated by engine on verified matches. Negative cache (flashscore_team_id NULL) prevents re-attempting known-orphan names.

### 087.2 — Pipeline `lib/normalize/events/`

Mirror of existing `lib/normalize/` structure (markets) for consistency:

```
lib/normalize/events/
├── types.ts          # Event, FlashscoreCandidate, MatchResult, MatchStage
├── regex.ts          # stage 2 — existing regex fuzzy logic ported
├── trigram.ts        # stage 3a — pg_trgm similarity via SQL call
├── alias-dict.ts     # stage 3b — team_aliases lookup with normalization
├── propagation.ts    # stage 4 — team_mapping cache lookup
├── llm-core.ts       # stage 5 — prompt builder + response parser (shared for subagent and future API)
└── engine.ts         # dispatcher 1→5
```

**Engine dispatcher pseudocode:**

```typescript
async function normalizeEvent(event: Event): Promise<MatchResult> {
  // Stage 1: already mapped?
  if (event.flashscore_id) {
    return {
      flashscore_id: event.flashscore_id,
      stage: 'flashscore_native',
      confidence: 1.0
    };
  }

  // Stages 2-4 cascade: first success (above auto-apply threshold) wins
  const stages: StageHandler[] = [stageRegex, stageTrigramAlias, stagePropagation];
  for (const stage of stages) {
    const result = await stage(event);
    if (result && result.confidence >= stage.autoApplyThreshold) {
      await persistMatch(event.id, result);
      await updatePropagationCache(event, result);  // feedback loop
      return result;
    }
  }

  // Stage 5 LLM is NOT auto-triggered (subagent-only per Q2=E decision)
  // Must be invoked explicitly via /api/admin/event-normalization/run-subagent
  return { stage: 'unmapped', confidence: 0 };
}
```

**Confidence thresholds:**

| Stage | Default confidence | Auto-apply threshold |
|-------|---|---|
| `flashscore_native` | 1.0 | auto (no threshold, already mapped) |
| `regex` | 0.8 (fixed) | ≥ 0.8 |
| `trigram + alias_dict` | similarity score (0.7-1.0 range) | ≥ 0.85 |
| `propagation` | 1.0 (cache hit from verified mapping) | auto |
| `llm` | LLM-reported | ≥ 0.95 auto-apply, 0.80-0.94 pending review, < 0.80 discard |

**Re-run semantics.** If a row already exists in `event_normalization`:
- `verified = true`: skip, do not reprocess (locked in by human confirmation).
- `verified = false`: allow stage upgrade (e.g., initial trigram 0.82 → propagation 1.0 after a confirmed sibling event populates the cache). The new row replaces the old; previous is overwritten since `event_id` is UNIQUE.

**Stage 5 subagent prompt contract:**

Input JSON:
```json
{
  "event": {
    "id": "uuid",
    "source": "kambi",
    "sport": "football",
    "home_team": "Pogon Szczecin",
    "away_team": "Lech Poznan",
    "starts_at": "2026-04-23T18:00:00Z",
    "league": "Ekstraklasa"
  },
  "candidates": [
    { "flashscore_id": "aBc123", "home": "Pogoń Szczecin", "away": "Lech Poznań", "starts_at": "2026-04-23T18:00:00Z", "league": "Ekstraklasa" },
    { "flashscore_id": "xYz789", "home": "Pogon Szczecin II", "away": "Lech Poznan II", "starts_at": "2026-04-23T14:00:00Z", "league": "II liga" }
  ]
}
```

Output JSON:
```json
{
  "flashscore_id": "aBc123",
  "confidence": 0.97,
  "reason": "exact match home/away with Polish diacritics, same league, same datetime"
}
```

Or `{"flashscore_id": null, "confidence": 0.0, "reason": "no plausible match"}` if no candidate matches.

Candidates pre-filtered via SQL:
```sql
SELECT flashscore_id, home, away, starts_at, league
FROM be_fixtures
WHERE sport = :event.sport
  AND starts_at BETWEEN :event.starts_at - interval '3h' AND :event.starts_at + interval '3h'
ORDER BY
  similarity(home, :event.home_team) + similarity(away, :event.away_team) DESC
LIMIT 5;
```

### 087.3 — API routes

| Route | Method | Purpose |
|---|---|---|
| `/api/admin/event-normalization` | GET | List with filters (`sport`, `stage`, `verified`, `confidence_min`, `confidence_max`) |
| `/api/admin/event-normalization/verify` | POST | Mark a row `verified=true`, propagate to `team_mapping` cache |
| `/api/admin/event-normalization/manual-assign` | POST | Operator override: `{event_id, flashscore_id}` — sets stage='manual', verified=true |
| `/api/admin/event-normalization/reject` | POST | Operator rejects the suggested match: DELETE the `event_normalization` row for the event. Event returns to unmapped pool; next cron cycle may re-attempt stages 1-4. To prevent re-attempt on known-unmappable events, operator uses `/manual-assign` with a sentinel `flashscore_id='UNMAPPABLE'` which is then filtered out of consensus JOIN. No schema change on `events`. |
| `/api/admin/event-normalization/run-subagent` | POST | Trigger stage 5 batch on current unmapped list |
| `/api/admin/event-normalization/backfill` | POST | One-shot batch processor (`batch_size: 500`). Idempotent. |
| `/api/cron/event-normalization` | POST | Scheduled drainage: stages 1-4 on new events |

Auth: admin session for admin/* routes. `x-scraper-key` header (reusing `SCRAPER_API_KEY`) for `/api/cron/*`.

### 087.4 — UI `/admin/event-normalization`

Pattern identical to `/admin/market-normalization`. 5 tabs:

1. **Unmapped** — events where stages 1-4 found no match. Per row: top-3 candidates from stage 3 (trigram similarity), a "Run LLM (subagent)" button for single, and bulk selection for batch subagent run.
2. **LLM Pending Review** — confidence 0.80-0.94 from stage 5. Buttons: ✅ Verify / ❌ Reject / ⚙️ Modify flashscore_id.
3. **Low Confidence** — rows from stages 3/4 with confidence < 0.85 (below auto-apply threshold). Same buttons.
4. **Verified** — read-only, filterable. Shows match_stage, confidence, verified_by, verified_at.
5. **Stats** — coverage percentage per (sport × source), distribution per stage, running cost estimate for subagent token use.

### 087.5 — Cron + backfill

**Cron** on scraper-vps:
```
*/15 * * * *  curl -X POST -H "x-scraper-key: $SCRAPER_API_KEY" \
  https://admin.betssolution.com/api/cron/event-normalization
```

Batch size 100 events/cycle. Runs stages 1-4 only. Stage 5 never auto-triggered (per Q2=E: subagent requires operator invocation).

**Backfill** for initial catchup post-deploy:
```bash
# Operator runs repeatedly until exhausted
while true; do
  RESULT=$(curl -sX POST -H "x-scraper-key: $KEY" \
    https://admin.betssolution.com/api/admin/event-normalization/backfill \
    -d '{"batch_size": 500}')
  PROCESSED=$(echo "$RESULT" | jq .processed)
  [ "$PROCESSED" -eq 0 ] && break
  echo "Processed: $PROCESSED"
done
```

Expected drain rate for a ~70k event backlog: ~500/10s = ~25min of manual invocation, or ~1.5 days of cron at 100/15min if left passive.

### 087.6 — Q2=E Deferred LLM API Decision

**Scheduled re-evaluation date**: 2026-05-06 (+14 days from 087 production deploy).

Metrics to collect:
- Count of new unmapped events per day (post stages 1-4).
- Count of operator-triggered subagent runs per week.
- Subagent success rate (confidence ≥ 0.95 auto-applied vs pending review).
- Operator time-to-review for pending review bucket.

**Decision gate:** if `new_orphans_per_day > 20 AND operator_runs_per_week > 3` → implement 087c (API cron using `lib/normalize/events/llm-core.ts`, endpoint `/api/cron/event-normalization-llm`, same cron schedule at 15min).

**If gate not met**: subagent-only pattern is sufficient; defer API indefinitely.

Estimated effort if gate triggers: **2-3h** (core prompt/parser code already exists in `llm-core.ts`; only missing pieces are the cron endpoint wrapper + rate-limiting).

### 087 — Test plan

1. Apply 087 schema to staging DB. Verify tables/indexes/constraints.
2. Post-migration cleanup on `team_aliases`: script to set `sport='football'` on club rows, `sport=NULL` on national teams. Verify seed data still queryable.
3. Run `/api/admin/event-normalization/backfill` on staging with 500-batch. Expect distribution roughly: stage_1 ~50-60% (if already matched), stage_2 ~25%, stage_3+4 ~10%, unmapped ~5-15% (depends on current `events.flashscore_id` coverage).
4. Manual assign 10 events via UI: verify `team_mapping` populated, next run of stage 4 matches sibling events from same source/sport.
5. Trigger stage 5 subagent on 20 unmapped events: verify prompt JSON correctness, parse response, auto-apply threshold behavior (≥ 0.95).
6. Deploy cron to scraper-vps. Observe first cycle, verify idempotency (no double-processing).
7. Stats page coverage check after 1 day: expect football ≥ 90%, tennis/basket/hockey ≥ 85%.

### 087 — Rollback

```sql
-- 087_rollback.sql
DROP TABLE event_normalization;
DROP TABLE team_mapping;
ALTER TABLE team_aliases
  DROP COLUMN IF EXISTS sport,
  DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS verified,
  DROP COLUMN IF EXISTS created_by;
```

Code rollback: revert `lib/normalize/events/*`, delete `/api/admin/event-normalization/*` routes, delete `/admin/event-normalization/*` pages, remove cron from scraper-vps crontab.

### 087 — Effort estimate

- Schema + indexes: 1h
- Pipeline modules (types, regex, trigram, alias-dict, propagation, llm-core, engine): 4h
- UI `/admin/event-normalization` 5 tabs: 3h
- Cron endpoint + backfill endpoint: 1h
- Subagent endpoint + prompt/parser: 2h
- Test plan execution: 2h
- **Total: ~1 full day (8-10h)**

---

## Level 3 — Migration 088: Manual Override Core

### Problem recap

`/admin/consensus` surfaces outliers but offers no way to act on them. Operator cannot suspend outcomes, override odds, or formally dismiss false positives. Scraper upsert cycles overwrite any attempted manual intervention.

### 088.1 — Schema (4 parts)

**A) `ALTER outcomes` with manual_* columns**

```sql
ALTER TABLE outcomes
  ADD COLUMN manual_suspended  boolean DEFAULT false NOT NULL,
  ADD COLUMN manual_odds       numeric,
  ADD COLUMN manual_reason     text,
  ADD COLUMN manual_expires_at timestamptz,
  ADD COLUMN manual_set_by     uuid REFERENCES auth.users(id),
  ADD COLUMN manual_set_at     timestamptz;

CREATE INDEX idx_outcomes_manual_active ON outcomes(manual_expires_at)
  WHERE manual_suspended = true OR manual_odds IS NOT NULL;

COMMENT ON COLUMN outcomes.manual_suspended IS
  'Operator suspended this outcome. NOT touched by scraper upserts. Enforced by trigger protect_manual_fields (below) AND whitelist SET in upsert_outcomes_batch RPCs. Reset by cron admin_cleanup_expired_overrides when manual_expires_at < now(). See migration 088.';
COMMENT ON COLUMN outcomes.manual_odds IS
  'Operator-overridden odds. displayOdds = manual_odds ?? odds. Same protection as manual_suspended.';
```

**Semantics**:
- `manual_expires_at = NULL` with `manual_suspended = true OR manual_odds NOT NULL` means "permanent until manual restore" — an operator choice for persistent bug patches.
- `manual_expires_at < now()` with same conditions means "expired, awaiting cleanup cron" — row still reads as suspended/overridden until cron fires.

**B) Trigger `preserve_manual_fields` (Q3=D, defense in depth)**

```sql
CREATE OR REPLACE FUNCTION preserve_manual_fields() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Session var 'app.admin_manual_override' = 'on' bypasses protection.
  -- Used only by admin RPCs: admin_suspend_outcome, admin_override_odds,
  -- admin_restore_outcome, admin_cleanup_expired_overrides.
  IF current_setting('app.admin_manual_override', true) IS DISTINCT FROM 'on' THEN
    NEW.manual_suspended  := OLD.manual_suspended;
    NEW.manual_odds       := OLD.manual_odds;
    NEW.manual_reason     := OLD.manual_reason;
    NEW.manual_expires_at := OLD.manual_expires_at;
    NEW.manual_set_by     := OLD.manual_set_by;
    NEW.manual_set_at     := OLD.manual_set_at;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER protect_manual_fields
BEFORE UPDATE ON outcomes
FOR EACH ROW
EXECUTE FUNCTION preserve_manual_fields();

COMMENT ON TRIGGER protect_manual_fields ON outcomes IS
  'Prevents any UPDATE (including scraper upserts via ON CONFLICT DO UPDATE) from overwriting manual_* fields, unless the session set app.admin_manual_override = ''on''. Only admin RPCs set that session var.';
```

**C) Audit table `outcome_manual_actions`**

```sql
CREATE TABLE outcome_manual_actions (
  id bigserial PRIMARY KEY,
  outcome_id uuid REFERENCES outcomes(id) ON DELETE CASCADE,
  action_type text NOT NULL
    CHECK (action_type IN ('suspend','override','restore','dismiss','expiry')),
  old_value jsonb,
  new_value jsonb,
  reason text,
  dismiss_category text
    CHECK (dismiss_category IS NULL OR dismiss_category IN
      ('bug_kambi','bug_22bet','mismatch_norm','value_genuine','other')),
  source text NOT NULL
    CHECK (source IN ('manual','cron_expiry')),
  consensus_id bigint REFERENCES consensus_snapshots(id),
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);
CREATE INDEX idx_outcome_actions_outcome ON outcome_manual_actions(outcome_id);
CREATE INDEX idx_outcome_actions_created ON outcome_manual_actions(created_at DESC);
CREATE INDEX idx_outcome_actions_dismiss  ON outcome_manual_actions(dismiss_category)
  WHERE dismiss_category IS NOT NULL;
```

**D) `normalization_issues` queue (feedback loop)**

```sql
CREATE TABLE normalization_issues (
  id bigserial PRIMARY KEY,
  source_table text NOT NULL,                  -- 'consensus_snapshots'
  source_id bigint NOT NULL,
  issue_type text NOT NULL
    CHECK (issue_type IN ('market_mismatch','outcome_mismatch','event_mismatch')),
  kambi_key text,
  twobet_key text,
  expected_canonical text,
  reported_by uuid REFERENCES auth.users(id),
  reported_at timestamptz DEFAULT now(),
  resolved boolean DEFAULT false,
  resolved_at timestamptz,
  resolution text
);
CREATE INDEX idx_norm_issues_unresolved ON normalization_issues(resolved)
  WHERE NOT resolved;
```

Populated automatically when an operator dismisses a consensus outlier with `dismiss_category = 'mismatch_norm'`. Visible in `/admin/market-normalization` as "reported by operator" queue.

### 088.2 — Scraper RPC whitelist modifications

**Two scrapers, three VPS deployments**:
- `kambi-scraper` on scraper-vps (prod)
- `22bet-scraper` on scraper-vps (prod)
- `22bet-scraper-staging` on staging-vps (staging)

Each has a batch upsert RPC (e.g., `upsert_outcomes_batch` in `supabase/migrations/014_scraper_batch_rpc.sql` or similar). Required modification to the `ON CONFLICT DO UPDATE` clause:

```sql
-- Modified RPC body (illustrative; match actual signature in existing migration)
INSERT INTO outcomes (...)
VALUES (...)
ON CONFLICT (market_id, name) DO UPDATE SET
  odds          = EXCLUDED.odds,
  is_active     = EXCLUDED.is_active,
  is_suspended  = EXCLUDED.is_suspended,
  updated_at    = EXCLUDED.updated_at,
  previous_odds = outcomes.odds
  -- manual_* NOT updated: protected by trigger protect_manual_fields (mig 088)
  -- AND enforced here via explicit whitelist.
;
```

Comment references both protections per Q3=D.

**Deploy order (critical):**
1. Apply migration 088 schema + trigger to **staging DB**.
2. Synthetic test on staging: with `manual_suspended=true` set on a test outcome, run `SELECT upsert_outcomes_batch(...)` with fake data; verify `manual_suspended` unchanged.
3. Apply migration 088 to **prod DB**.
4. Deploy modified `upsert_outcomes_batch` RPC to all 3 VPS environments (via CI/CD where possible, manual otherwise).
5. Monitor 1 cycle (≤ 3 minutes for live, ≤ 30 minutes for slow prematch) on a test outcome with manual_suspended set — confirm persistence.

### 088.3 — API endpoints + RPCs

All admin endpoints call through `SECURITY DEFINER` RPCs that set `app.admin_manual_override = 'on'` inside the transaction.

| Route | Method | Backend RPC | Side effects |
|---|---|---|---|
| `/api/admin/outcomes/:id/suspend` | POST | `admin_suspend_outcome(outcome_id, reason, duration_min, user_id)` | UPDATE outcomes + INSERT audit |
| `/api/admin/outcomes/:id/override` | POST | `admin_override_odds(outcome_id, new_odds, reason, duration_min, user_id)` | UPDATE outcomes + INSERT audit |
| `/api/admin/outcomes/:id/restore` | POST | `admin_restore_outcome(outcome_id, reason, user_id)` | RESET manual_* + INSERT audit |
| `/api/admin/consensus/:id/dismiss` | POST | `admin_dismiss_consensus(consensus_id, category, note, user_id)` | INSERT audit; if category='mismatch_norm' → INSERT into normalization_issues |
| `/api/cron/manual-override-cleanup` | POST | `admin_cleanup_expired_overrides()` | UPDATE expired + INSERT audit rows `action_type='expiry'` |

**RPC example for suspend:**

```sql
CREATE OR REPLACE FUNCTION admin_suspend_outcome(
  p_outcome_id uuid,
  p_reason text,
  p_duration_min int,        -- NULL = permanent until restore
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_old jsonb;
  v_expires timestamptz;
BEGIN
  SET LOCAL app.admin_manual_override = 'on';

  SELECT to_jsonb(o) INTO v_old FROM outcomes o WHERE id = p_outcome_id;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'Outcome % not found', p_outcome_id;
  END IF;

  v_expires := CASE WHEN p_duration_min IS NULL THEN NULL
                    ELSE now() + (p_duration_min || ' minutes')::interval
               END;

  UPDATE outcomes SET
    manual_suspended  = true,
    manual_reason     = p_reason,
    manual_expires_at = v_expires,
    manual_set_by     = p_user_id,
    manual_set_at     = now()
  WHERE id = p_outcome_id;

  INSERT INTO outcome_manual_actions (
    outcome_id, action_type, old_value, new_value, reason, source, created_by
  ) VALUES (
    p_outcome_id, 'suspend', v_old,
    jsonb_build_object(
      'manual_suspended', true,
      'manual_expires_at', v_expires,
      'manual_reason', p_reason
    ),
    p_reason, 'manual', p_user_id
  );

  RETURN jsonb_build_object('success', true, 'expires_at', v_expires);
END $$;
```

Similar structure for `admin_override_odds`, `admin_restore_outcome`, `admin_dismiss_consensus`, `admin_cleanup_expired_overrides`.

**Duration options in UI select**:
- `30min` → 30
- `1h` → 60
- `3h` → 180
- `until_event_end` → `floor((event.starts_at + default_duration - now())/60000)` (computed client-side, integer minutes)
- `permanent` → `null` (RPC receives NULL, `manual_expires_at` stays NULL)

**Cleanup RPC:**

```sql
CREATE OR REPLACE FUNCTION admin_cleanup_expired_overrides()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_count int;
BEGIN
  SET LOCAL app.admin_manual_override = 'on';

  -- Audit first
  INSERT INTO outcome_manual_actions (
    outcome_id, action_type, old_value, source, reason
  )
  SELECT id, 'expiry',
         jsonb_build_object(
           'manual_suspended', manual_suspended,
           'manual_odds', manual_odds,
           'manual_reason', manual_reason,
           'manual_expires_at', manual_expires_at
         ),
         'cron_expiry',
         'Auto-expiry: ' || COALESCE(manual_reason, '(no reason)')
  FROM outcomes
  WHERE manual_expires_at IS NOT NULL AND manual_expires_at < now();

  -- Reset
  WITH updated AS (
    UPDATE outcomes SET
      manual_suspended = false,
      manual_odds = NULL,
      manual_reason = NULL,
      manual_expires_at = NULL,
      manual_set_by = NULL,
      manual_set_at = NULL
    WHERE manual_expires_at IS NOT NULL AND manual_expires_at < now()
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM updated;

  RETURN jsonb_build_object('cleaned', v_count);
END $$;
```

### 088.4 — Player frontend integration

File: `betssolution-player/lib/hooks/use-event.ts`.

```typescript
// Before
const displayOdds = outcome.odds;
const isBettable = !outcome.is_suspended && outcome.is_active;

// After
const displayOdds = outcome.manual_odds ?? outcome.odds;
const isBettable = !outcome.is_suspended
                 && !outcome.manual_suspended
                 && outcome.is_active;
```

**SSE stream serialization.** In whichever route feeds the SSE (e.g., `/api/sse/events` or direct Supabase realtime subscription), ensure the outcomes SELECT includes the new columns:

```typescript
.select('id, name, odds, is_active, is_suspended, manual_odds, manual_suspended, market_id, created_at, updated_at')
```

Existing realtime subscribers may need the Supabase Realtime publication refreshed to include new columns.

**Prestige sync (gotcha from memory plan).** Some mechanism sync outcomes toward prestige agent (network). The exact integration point must be found before 088 deploys to prod. Blocks test plan step 10.

**Pre-implementation investigation task (blocking 088.4 test):**
1. Search `kambi-scraper/`, `22bet-scraper/`, `betssolution-admin/app/api/` for strings `prestige`, `agent_sync`, `push-to-vincitu`, `admin-staging` (dual-write path). Memory reference: `kambi-scraper-dual-write.md` mentions `push-to-vincitu.ts` with `shadowPush`.
2. Check scraper-vps crontab and staging-vps crontab for scheduled prestige-related jobs.
3. Check `.env` of admin + scrapers for prestige-targeting URLs or API keys.
4. If the integration is a push (scraper → prestige), modify the push payload builder to skip `manual_suspended = true OR manual_odds IS NOT NULL`.
5. If the integration is a pull (prestige reads from admin API or Supabase directly), modify the response/query to filter those rows.
6. If no integration found, mark as "not applicable" and drop test plan step 10.

Modify to skip outcomes with `manual_suspended = true OR manual_odds IS NOT NULL` once the integration point is located. These should not be pushed as bettable to agents.

**Fail-loud monitor (pragmatic fallback)**: while investigation is pending, add a logging check that flags any outbound mention of an outcome that is `manual_suspended=true`. Put it wherever the outcomes-to-external export aggregates them. Early detection beats silent leakage.

### 088.5 — UI consensus page buttons

In `app/admin/consensus/page.tsx`, per outlier row:

```tsx
<td>
  <div className="flex gap-2">
    <button onClick={() => openSuspendModal(row)} className="btn-red">🔴 Sospendi</button>
    <button onClick={() => openOverrideModal(row)} className="btn-amber">⚙️ Override</button>
    <button onClick={() => openDismissModal(row)} className="btn-green">✅ Dismiss</button>
  </div>
</td>
```

**SuspendModal fields**:
- `reason` (text, required)
- `duration` (select: `30min | 1h | 3h | until_event_end | permanent`)

On submit → `POST /api/admin/outcomes/:id/suspend` → refresh row (optimistic UI update).

**OverrideModal fields**:
- `new_odds` (number, default = row.twobet_odds)
- `reason` (text, required)
- `duration` (select: same as above)

Safeguard: disallow `new_odds < 1.01` (not legal without external communication). Flash warning if operator attempts.

**DismissModal fields**:
- `category` (radio: `bug_kambi | bug_22bet | mismatch_norm | value_genuine | other`)
- `note` (text)

If `category = 'mismatch_norm'`, show inline hint: "Verrà aggiunto alla coda in `/admin/market-normalization` per revisione".

### 088.6 — New page `/admin/manual-overrides`

Tabs:

1. **Active** — outcomes with `manual_suspended OR manual_odds NOT NULL`, optionally filtered by expiry. Columns: event, market, outcome, type (suspended/override), reason, expires_at, operator, set_at. Action: 🔄 Restore (calls `admin_restore_outcome`).
2. **Expired (last 7d)** — audit trail from `outcome_manual_actions` filtered by `action_type = 'expiry'` + `source = 'cron_expiry'`.
3. **Dismiss log** — audit trail filtered by `action_type = 'dismiss'`, filterable by category. Useful for pattern-finding (recurring `bug_kambi` by market_type indicates upstream scraper issue).
4. **Stats** — counts per category/sport/operator, time-to-resolve, etc.

### 088.7 — Cron cleanup

On scraper-vps crontab:

```
*/5 * * * * curl -X POST -H "x-scraper-key: $SCRAPER_API_KEY" \
  https://admin.betssolution.com/api/cron/manual-override-cleanup >/dev/null 2>&1
```

Runs every 5min. Cleanup RPC is idempotent and fast (indexed on `manual_expires_at`).

### 088 — Gotchas (from memory plan, preserved here)

- **Bets already placed on suspended outcomes**: DO NOT void. Settle normally at event end, using the odds at placement time. Legally correct under ADM regulation.
- **Override at 1.01 "zero risk"**: NOT legal without external communication to players. Preferred: suspend instead. UI should warn on low new_odds.
- **Prestige sync**: verify agent prestige sync mechanism respects `manual_suspended`. Suspended outcomes should not be pushed as bettable to agents.
- **TTL default 30min** OK for transient bugs, but `until_event_end` and `permanent` options must be available in UI for specific cases.

### 088 — Test plan

1. Apply mig 088 to staging DB. Verify trigger installed (`\df preserve_manual_fields`, `\d+ outcomes`).
2. **Trigger test (negative path)**: connect as normal role, attempt `UPDATE outcomes SET manual_suspended = true WHERE id = ...`. Expected: NEW.manual_suspended reverted to OLD value after trigger; row unchanged.
3. **Trigger test (positive path)**: `SET LOCAL app.admin_manual_override = 'on'; UPDATE outcomes SET manual_suspended = true WHERE id = ...; COMMIT;`. Expected: row updated.
4. **Scraper upsert test**: set `manual_suspended = true` via admin API on a test outcome. Force scraper cycle (wait 3min live or trigger fast prematch). Verify `manual_suspended` still `true` post-cycle.
5. **API suspend full flow**: POST `/suspend` with 30min duration. Verify: (a) outcomes row updated, (b) audit row inserted, (c) manual_expires_at = now + 30min, (d) player frontend displays outcome as non-bettable.
6. **API override**: POST `/override` with new_odds. Verify player frontend's displayOdds shows new_odds, not odds.
7. **Dismiss with mismatch_norm**: POST `/dismiss` with `category='mismatch_norm'`. Verify INSERT in `normalization_issues`.
8. **Cron expiry**: set `manual_expires_at = now() - 1s`. Trigger cron. Verify row reset + audit `action_type='expiry'`.
9. **Bet safety**: place a test bet on outcome X, then suspend X, wait for event to end, run settlement. Expected: bet settled on original placement odds (no void).
10. **Prestige sync**: place manual_suspended on outcome, verify prestige-bound export filter excludes it.

### 088 — Rollback

```sql
-- 088_rollback.sql
DROP TRIGGER protect_manual_fields ON outcomes;
DROP FUNCTION preserve_manual_fields;
DROP FUNCTION admin_suspend_outcome;
DROP FUNCTION admin_override_odds;
DROP FUNCTION admin_restore_outcome;
DROP FUNCTION admin_dismiss_consensus;
DROP FUNCTION admin_cleanup_expired_overrides;
DROP TABLE outcome_manual_actions;
DROP TABLE normalization_issues;
ALTER TABLE outcomes
  DROP COLUMN IF EXISTS manual_suspended,
  DROP COLUMN IF EXISTS manual_odds,
  DROP COLUMN IF EXISTS manual_reason,
  DROP COLUMN IF EXISTS manual_expires_at,
  DROP COLUMN IF EXISTS manual_set_by,
  DROP COLUMN IF EXISTS manual_set_at;
```

Scraper RPC revert via git (last commit before 088 modifications). Player frontend revert via git.

### 088 — Effort estimate

- Schema + trigger + audit + issues queue: 2h
- Scraper RPC modifications + deploy to 3 VPS + monitoring: 2h
- Admin API routes + RPCs (5 endpoints): 2h
- UI consensus modals: 2h
- Page `/admin/manual-overrides`: 3h
- Cron cleanup: 1h
- Test plan execution (synthetic + real cycle verification): 2h
- **Total: ~1.5 days (12-14h)**

---

## Level 4 — Migration 089: Canonical Events Layer

### Problem recap

`events` mixes identity (which match is this?) with pricing/markets (what odds per source?). Cross-source operations reinvent matching logic each time (consensus, settlement fan-out, best-odds views). Scaling to N sources becomes combinatorial in matching plumbing.

Canonical events provide a single identity row per match, with N events (one per source) linking to it via FK.

### 089 — Dependency

Requires 087 at ≥ 95% flashscore_id coverage. Without this, backfill produces 30-40% orphan canonical_events and the consensus RPC rewrite has poor hit rate.

### 089.1 — Schema

**A) `canonical_events` table**

```sql
CREATE TABLE canonical_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flashscore_id text UNIQUE,                  -- NULLABLE for future non-flashscore sports
  sport_id uuid REFERENCES sports(id),
  league_id uuid REFERENCES leagues(id),
  home_team text NOT NULL,
  away_team text NOT NULL,
  starts_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'prematch'
    CHECK (status IN ('prematch','live','ended','postponed','cancelled','void')),
  score_home int,
  score_away int,
  result jsonb,                                -- structured: winner, per-period scores, HT, OT, etc.
  flashscore_league_slug text,
  flashscore_country_code text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_canonical_flashscore ON canonical_events(flashscore_id)
  WHERE flashscore_id IS NOT NULL;
CREATE INDEX idx_canonical_sport_starts ON canonical_events(sport_id, starts_at);
CREATE INDEX idx_canonical_status ON canonical_events(status)
  WHERE status IN ('prematch','live');

-- updated_at auto-maintenance (assumes moddatetime extension available; else manual trigger)
CREATE TRIGGER set_canonical_updated_at
BEFORE UPDATE ON canonical_events
FOR EACH ROW
EXECUTE FUNCTION moddatetime('updated_at');
```

**B) FK on `events`**

```sql
ALTER TABLE events
  ADD COLUMN canonical_event_id uuid REFERENCES canonical_events(id) ON DELETE SET NULL;

CREATE INDEX idx_events_canonical ON events(canonical_event_id)
  WHERE canonical_event_id IS NOT NULL;
```

**C) Merge audit**

```sql
CREATE TABLE canonical_event_merges (
  id bigserial PRIMARY KEY,
  keep_id uuid REFERENCES canonical_events(id),
  merge_id uuid,                              -- deleted row, no FK
  merge_home_team text,
  merge_away_team text,
  merge_starts_at timestamptz,
  merged_by uuid REFERENCES auth.users(id),
  reason text,
  merged_at timestamptz DEFAULT now()
);
```

### 089.2 — Backfill (separate migration file)

File: `supabase/migrations/089b_canonical_backfill.sql` (separate from DDL so rollback of 089 does not undo schema AND data in the same step).

```sql
-- Create canonical rows from existing events with flashscore_id
INSERT INTO canonical_events (
  flashscore_id, sport_id, league_id, home_team, away_team, starts_at, status,
  score_home, score_away, result
)
SELECT DISTINCT ON (e.flashscore_id)
  e.flashscore_id, e.sport_id, e.league_id, e.home_team, e.away_team, e.starts_at,
  e.status, e.score_home, e.score_away, e.result
FROM events e
WHERE e.flashscore_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM canonical_events c WHERE c.flashscore_id = e.flashscore_id)
ORDER BY e.flashscore_id, e.created_at ASC
ON CONFLICT (flashscore_id) DO NOTHING;

-- Link existing events to their canonical
UPDATE events e SET canonical_event_id = c.id
FROM canonical_events c
WHERE e.flashscore_id = c.flashscore_id
  AND e.canonical_event_id IS NULL;
```

Expected result post-backfill (given 087 at ~95% coverage):
- ~95% of events with non-null `canonical_event_id`.
- ~5% orphans, to be resolved by ongoing 087 cycles.
- Number of `canonical_events` ≈ half of `events` (1 canonical per 2 events — kambi + 22bet).

### 089.3 — Write path: 087 engine integration

Post-089, the event-normalization engine's `persistMatch()` does three atomic things:

```typescript
async function persistMatch(eventId: string, result: MatchResult) {
  // Single RPC that does:
  // 1. UPSERT event_normalization row
  // 2. UPSERT canonical_events by flashscore_id
  // 3. UPDATE events.canonical_event_id
  await supabase.rpc('persist_event_normalization', {
    p_event_id: eventId,
    p_flashscore_id: result.flashscore_id,
    p_stage: result.stage,
    p_confidence: result.confidence,
    p_llm_reason: result.llm_reason,
  });
}
```

RPC (abbreviated):

```sql
CREATE OR REPLACE FUNCTION persist_event_normalization(
  p_event_id uuid, p_flashscore_id text, p_stage text,
  p_confidence numeric, p_llm_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_canonical_id uuid; v_event events%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM events WHERE id = p_event_id;

  -- Step 1: UPSERT event_normalization
  INSERT INTO event_normalization (
    event_id, flashscore_id, match_stage, confidence, llm_reason
  ) VALUES (
    p_event_id, p_flashscore_id, p_stage, p_confidence, p_llm_reason
  )
  ON CONFLICT (event_id) DO UPDATE SET
    flashscore_id = EXCLUDED.flashscore_id,
    match_stage = EXCLUDED.match_stage,
    confidence = EXCLUDED.confidence,
    llm_reason = EXCLUDED.llm_reason,
    created_at = now()
  WHERE NOT event_normalization.verified;  -- don't overwrite verified

  -- Step 2: UPSERT canonical_events
  INSERT INTO canonical_events (
    flashscore_id, sport_id, league_id, home_team, away_team, starts_at
  ) VALUES (
    p_flashscore_id, v_event.sport_id, v_event.league_id,
    v_event.home_team, v_event.away_team, v_event.starts_at
  )
  ON CONFLICT (flashscore_id) DO NOTHING
  RETURNING id INTO v_canonical_id;

  -- If already existed, fetch it
  IF v_canonical_id IS NULL THEN
    SELECT id INTO v_canonical_id FROM canonical_events WHERE flashscore_id = p_flashscore_id;
  END IF;

  -- Step 3: Link event
  UPDATE events SET
    canonical_event_id = v_canonical_id,
    flashscore_id = p_flashscore_id       -- also populate legacy column
  WHERE id = p_event_id;
END $$;
```

### 089.4 — Fan-out trigger

```sql
CREATE OR REPLACE FUNCTION propagate_canonical_result() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.result      IS DISTINCT FROM NEW.result)
     OR (OLD.status     IS DISTINCT FROM NEW.status)
     OR (OLD.score_home IS DISTINCT FROM NEW.score_home)
     OR (OLD.score_away IS DISTINCT FROM NEW.score_away)
  THEN
    UPDATE events SET
      status      = NEW.status,
      score_home  = NEW.score_home,
      score_away  = NEW.score_away,
      result      = NEW.result
    WHERE canonical_event_id = NEW.id
      AND (status      IS DISTINCT FROM NEW.status
           OR score_home IS DISTINCT FROM NEW.score_home
           OR score_away IS DISTINCT FROM NEW.score_away
           OR result      IS DISTINCT FROM NEW.result);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER propagate_canonical_on_update
AFTER UPDATE ON canonical_events
FOR EACH ROW
EXECUTE FUNCTION propagate_canonical_result();
```

**Flashscore scraper redirect** (post-089): `app/api/flashscore/results/route.ts` writes to `canonical_events` instead of `events`. The trigger propagates to all linked events. Settlement engine (unchanged, still reading from `events`) sees updated rows and fires normally.

Before 089 (current flow): flashscore results → `/api/flashscore/results` → UPDATE events → settlement trigger fires.

After 089: flashscore results → `/api/flashscore/results` → UPDATE canonical_events → trigger propagates to all linked events → settlement trigger fires per affected event.

### 089.5 — Consensus RPC rewrite (post-089)

Replaces the UNION ALL flashscore+regex pivot from 086:

```sql
-- Inside refresh_consensus_snapshots, replaces the tmp_pairs CTE
WITH pairs AS (
  SELECT k.id AS kambi_id, t.id AS twobet_id
  FROM events k
  JOIN events t ON k.canonical_event_id = t.canonical_event_id
  WHERE k.source = 'kambi' AND t.source = '22bet'
    AND k.canonical_event_id IS NOT NULL
)
-- Remainder of RPC (candidates CTE, dedup, INSERT ON CONFLICT) unchanged from 086
```

Eliminates: regex fuzzy fallback, match_priority ordering, UNION ALL.

Expected performance: 2-3x faster than 086 version (simple EQUI-JOIN on indexed column vs UNION ALL of regex-normalized strings). To be measured in test plan.

### 089.6 — Merge RPC + endpoint

```sql
CREATE OR REPLACE FUNCTION admin_merge_canonical_events(
  p_keep_id uuid, p_merge_id uuid, p_user_id uuid, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_snapshot jsonb; v_events_moved int;
BEGIN
  IF p_keep_id = p_merge_id THEN
    RAISE EXCEPTION 'Cannot merge canonical_event with itself';
  END IF;

  SELECT to_jsonb(c) INTO v_snapshot FROM canonical_events c WHERE id = p_merge_id;
  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'Merge source % not found', p_merge_id;
  END IF;

  UPDATE events SET canonical_event_id = p_keep_id
  WHERE canonical_event_id = p_merge_id;
  GET DIAGNOSTICS v_events_moved = ROW_COUNT;

  INSERT INTO canonical_event_merges (
    keep_id, merge_id, merge_home_team, merge_away_team, merge_starts_at,
    merged_by, reason
  ) VALUES (
    p_keep_id, p_merge_id,
    v_snapshot->>'home_team',
    v_snapshot->>'away_team',
    (v_snapshot->>'starts_at')::timestamptz,
    p_user_id, p_reason
  );

  DELETE FROM canonical_events WHERE id = p_merge_id;

  RETURN jsonb_build_object(
    'success', true,
    'events_moved', v_events_moved,
    'merged_snapshot', v_snapshot
  );
END $$;
```

Endpoint: `POST /api/admin/canonical-events/merge` with body `{keep_id, merge_id, reason}`.

### 089.7 — Admin UI `/admin/canonical-events`

Pages:

1. **List** — canonical events filterable by sport, status, date range. Per row: icon indicating linkage (🟢 2+ sources, 🟡 1 source, 🔴 0 sources).
2. **Detail** — click a canonical: side-by-side view of linked kambi + 22bet events (scores, market counts, last update).
3. **Merge UI** — search two canonicals → confirm dialog showing what will happen (events that move, deletion) → POST merge endpoint.
4. **Orphans** — events with `canonical_event_id IS NULL` (debug view, size should decline over time as 087 catches up).

### 089.8 — Read path impact (verify no regression)

| Consumer | Change |
|---|---|
| Player frontend | None |
| Admin dashboards (general) | None |
| Consensus page | RPC rewrite (simpler JOIN). UI unchanged. |
| Settlement engine | None (reads events.result, which trigger keeps in sync) |
| Market normalization | None |
| SSE stream | None |
| Event normalization (087) | Engine's `persistMatch()` extended to also upsert canonical + link. |

### 089 — Test plan

1. Apply 089 schema to staging DB. Verify table/indexes/trigger.
2. Apply backfill script. Verify ~95% events with `canonical_event_id` populated. Check count of unique canonical_events ≈ count(unique flashscore_id in events).
3. **Fan-out trigger test**: UPDATE `canonical_events.score_home = 1` for a canonical with 2 linked events. Verify both events' score_home updated.
4. **Settlement smoke**: simulate flashscore result update writing to canonical_events. Verify linked events updated + bets settle correctly via existing settlement path.
5. **Consensus RPC**: invoke rewritten RPC vs 086 version on same dataset. Expect identical outlier set (or slightly larger if 087 improved coverage). Compare timing — expect 2-3x speedup.
6. **Merge test**: pick 2 canonicals with linked events. POST merge. Verify all events now point to keep_id, merge_id canonical deleted, audit row inserted.
7. **Orphan flow**: event with `canonical_event_id IS NULL`. Verify consensus RPC filters it out, admin UI shows it in Orphans tab.
8. **Write path integration**: simulate new scraper event → engine normalizes → verify single transaction creates event_normalization + canonical_events (if new) + links event.
9. **Prod deploy via CI/CD**: 24h monitoring of (a) consensus RPC runtime, (b) settlement latency, (c) event_normalization queue health.

### 089 — Rollback

```sql
-- 089_rollback.sql
-- Note: rollback of 089 without rolling back 089b loses the canonical_event_id
-- references silently because of ON DELETE SET NULL. If the backfill is the
-- issue, better to roll back 089b first, leave 089 schema in place.

DROP TRIGGER propagate_canonical_on_update ON canonical_events;
DROP TRIGGER set_canonical_updated_at ON canonical_events;
DROP FUNCTION propagate_canonical_result;
DROP FUNCTION admin_merge_canonical_events;
DROP FUNCTION persist_event_normalization;
DROP TABLE canonical_event_merges;
ALTER TABLE events DROP COLUMN IF EXISTS canonical_event_id;
DROP TABLE canonical_events;

-- Revert consensus RPC to 086 version (copy from git history)
-- Revert lib/normalize/events/engine.ts persistMatch() to pre-089 shape
-- Revert app/api/flashscore/results/route.ts to write to events directly
```

**Operational watch-out**: if flashscore scraper has been writing to canonical_events for some time before rollback, the trigger-propagated updates on events are legitimate — no data loss on rollback. But new flashscore results post-rollback must go back to writing events directly → redeploy scraper accordingly.

**Rollback column-drop ordering safety**: `ALTER TABLE events DROP COLUMN canonical_event_id` is safe at any point because the FK is declared `ON DELETE SET NULL`. Dropping the table `canonical_events` first (which would null the references) before dropping the column is NOT required. Either order works; use whichever is convenient. The reverse case (nulling references manually before DROP TABLE) is also safe but unnecessary.

### 089 — Effort estimate

- Schema + indexes + audit table: 2h
- Backfill script + validation: 3h
- Fan-out trigger + test: 2h
- Consensus RPC rewrite + benchmark: 2h
- Merge RPC + endpoint + audit: 2h
- Admin UI (List + Detail + Merge + Orphans): 1 day
- 087 engine integration (persist_event_normalization 3-step RPC): 3h
- Flashscore scraper write path redirect: 3h
- Full test plan execution: 4h
- Staging + prod deploy + 24h monitoring: 1 day
- **Total: 3-5 days**

---

## Appendix A — Future Work: Auto-Suspend (Migration 090+)

### Activation gate (objective)

Auto-suspend infrastructure should NOT be built until all of the following are true:

- **Event-normalization coverage ≥ 99%** (measured via `/admin/event-normalization` Stats tab)
- **Outcome-normalization coverage ≥ 80%** (Phase 3 post-mig 065, separate workstream)
- **≥ 2 weeks of manual-only 088 operation** with audit trail data

### Metrics to collect during 088 manual operation

Before auto-suspend design, collect from `outcome_manual_actions`:

1. **Outlier rate ≥ 30% on core markets per day**. Informs threshold calibration.
2. **Dismiss rate by category `bug_kambi`**. Represents "true positive" candidates that auto-suspend would have caught.
3. **Dismiss rate by category `mismatch_norm`**. Represents "false positive" risk to auto-suspend.
4. **Delta distribution histogram** on confirmed vs dismissed outliers. Informs threshold and tiered structure.
5. **Time-to-resolve manual** (interval between `snapshot_at` of outlier and `action_type='suspend'` audit). Informs the case for automation urgency.

### Future 090+ deliverable (when gate met)

Configuration via `system_config`:

```
auto_suspend_enabled              boolean DEFAULT false
auto_suspend_threshold_pct        int     DEFAULT 50
auto_suspend_duration_minutes     int     DEFAULT 30
auto_suspend_markets              text[]  DEFAULT '{1X2,GG/NG,U/O,DC,Handicap}'
auto_suspend_min_outcomes_count   int     DEFAULT 3
auto_suspend_max_twobet_age_min   int     DEFAULT 5
auto_suspend_slack_webhook        text    DEFAULT NULL
```

Detection logic hooked into the consensus refresh cron. Confidence gate: outlier must have `twobet_outcomes_count >= min_outcomes_count` AND `age_minutes(twobet_updated_at) < max_twobet_age_min` AND consistent delta direction. Slack notification on every trigger. UI toggle in `/admin/manual-overrides` + a KPI dashboard "auto-suspend last 24h".

Estimated effort when activated: **3-4h** (detection + config integration + Slack webhook).

### Design decisions NOT taken today (deferred)

- Threshold: single value vs tiered per-market group.
- Duration: fixed vs sport-aware (e.g., live football event ends in 15min but default duration is 30min → cap).
- FP handling: auto-restore after operator dismiss, or stay suspended until explicit restore?
- Alert escalation: if auto-suspend fires > K times/hour, automatic disable with pager alert?

These decisions require baseline data from 088 manual operation. Locking them in now is premature.

---

## Appendix B — Open Questions and Future Work

Topics noted during brainstorming but not in scope of this spec:

1. **Consensus candidates debug table.** Today's DISTINCT ON in 086 silently discards duplicate rows (lower delta). A future `consensus_candidates_debug` table could retain discarded candidates for audit, surfacing normalization mismatches that are hiding behind wins. Not in scope for 086 (scope creep). Consider revisiting after 089 when consensus volume is known.

2. **Sport-aware confidence thresholds for 087.** Current thresholds (trigram ≥ 0.85 auto) are global. Some sports (MMA, esports) have more variable name conventions; may need per-sport tuning. Rewrite of confidence logic to read from `system_config` or a per-sport table should wait until operator data shows where global thresholds fail.

3. **Outcome-level normalization feedback loop.** 088 `dismiss` with `mismatch_norm` populates `normalization_issues`. Outcome-level mismatches (Phase 3 post-mig 065) currently lack this feedback loop. Future work: extend `normalization_issues.issue_type` to include `outcome_mismatch`, integrate into outcome-normalization admin UI.

4. **Canonical events read-side optimization.** 089 benefits consensus page. Other admin pages (risk, bet audit, agent sync) might also benefit from JOINing canonical. Future: evaluate materialized view `v_events_with_canonical` for hot read paths.

5. **Level 4 spec evolution.** The 089 design assumes 087 at ≥ 95% coverage. If production data reveals 92% or 97%, backfill strategy and merge UX may need tweaks. Changes go in an addendum spec (`docs/superpowers/specs/YYYY-MM-DD-canonical-events-tuning.md`), not by modifying this spec.

6. **Operator UX for bulk operations.** Consensus page lacks multi-row suspend/override. All pages inherited from 088 are row-by-row. When dismiss volume justifies, add bulk action toolbar.

7. **Prestige sync integration point.** 088 gotcha mentions prestige sync must respect `manual_suspended`. The exact integration point (scheduled export, webhook, direct DB-to-DB replication) needs investigation. If unclear by 088 deploy, add a temporary monitor to flag any outcome that exits to prestige while `manual_suspended=true` — fail-loud early detection.

---

## Migration Number Allocation

| Number | Scope | File |
|---|---|---|
| **086** | Consensus fix | `supabase/migrations/086_consensus_fix.sql` |
| **087** | Event normalization schema | `supabase/migrations/087_event_normalization.sql` |
| **088** | Manual override schema + trigger + audit + normalization_issues | `supabase/migrations/088_manual_override.sql` |
| **089** | Canonical events DDL (schema + trigger + merge audit) | `supabase/migrations/089_canonical_events.sql` |
| **089b** | Canonical events backfill (data-only) | `supabase/migrations/089b_canonical_backfill.sql` |
| **Future 090+** | Auto-suspend (when gate met) | TBD |

Next free migration number before this spec: **086** (last applied is `085_wave_34_etp_period.sql`).

## Deploy Strategy

**Phased, with operator checkpoints:**

1. **Day 1 (spec today)**: ship 086 via CI/CD to staging then prod. Quick-win operational value. The 086 effort estimate (~1.5h) already includes staging + prod deploy wall time (30min SQL + 15min code change + 15min local + 15min staging smoke + 15min prod verify).
2. **Days 2-3**: ship 087 schema + pipeline + UI to staging. Run backfill manually. Deploy cron on scraper-vps. Verify stage distribution matches expectation. Promote to prod.
3. **Days 4-5**: ship 088 schema to staging. Update scraper RPCs (kambi + 22bet prod + 22bet staging). Verify manual_* persistence through 1 full cycle. Promote to prod. Add API + UI. Add cron.
4. **Days 6-7** (post-087 production ≥ 1 week): measure 087 coverage. If ≥ 95% → green-light 089. Otherwise, iterate 087 (tune regex, add aliases, run subagent more).
5. **Days 8-12 (if gate met)**: ship 089. Backfill on staging. Fan-out trigger test. Consensus RPC benchmark. Flashscore scraper redirect. Prod deploy + 24h monitoring.
6. **+2 weeks of 088 manual ops**: evaluate auto-suspend gate metrics. Decide on 090+ scope.

**Deploy convention**: all migrations go through the project's official CI/CD pipeline (for admin on scraper-vps), with mirror-deploy to admin-staging.betssolution.com. Scraper RPC updates use scraper-specific deployment channels (git push for kambi-scraper, scp for 22bet-scraper as noted in memory).

**Rollback convention**: each migration has a companion `_rollback.sql` in git (not automatically applied). Any operational issue → identify offending migration → invoke rollback via DBA access. Code rollbacks via git revert.

## File References

**Read**:
- `app/admin/consensus/page.tsx`
- `app/api/admin/consensus/route.ts`
- `supabase/migrations/011_flashscore_columns.sql` (events.flashscore_id)
- `supabase/migrations/013_team_aliases.sql` (existing seeds, to be extended by 087)
- `supabase/migrations/037_consensus_snapshots.sql` (base schema)
- `supabase/migrations/040_consensus_canonical_key.sql` (RPC v2, target of 086 rewrite)
- `supabase/migrations/065_phase3_outcome_normalization.sql` (outcome-norm foundation)
- `app/api/flashscore/fixtures/route.ts` (populates events.flashscore_id today)
- `app/api/flashscore/results/route.ts` (will redirect to canonical_events in 089)
- `lib/flashscore.ts` (helper utilities)
- `lib/normalize/` (pattern reference: dictionary, propagation, engine, regex-patterns, period, types, llm)
- `lib/settlement.ts` (reads events.result; unchanged by this spec)

**Write / Modify**:
- `supabase/migrations/086_consensus_fix.sql` (new)
- `supabase/migrations/087_event_normalization.sql` (new)
- `supabase/migrations/088_manual_override.sql` (new)
- `supabase/migrations/089_canonical_events.sql` (new)
- `supabase/migrations/089b_canonical_backfill.sql` (new)
- `lib/normalize/events/*.ts` (new module directory)
- `app/admin/consensus/page.tsx` (add action buttons + modals)
- `app/admin/event-normalization/page.tsx` (new 5-tab page)
- `app/admin/manual-overrides/page.tsx` (new)
- `app/admin/canonical-events/page.tsx` (new)
- `app/api/admin/consensus/route.ts` (switch to v_consensus_latest)
- `app/api/admin/consensus/[id]/dismiss/route.ts` (new)
- `app/api/admin/event-normalization/*` (new, 5+ routes)
- `app/api/admin/outcomes/[id]/suspend/route.ts` (new)
- `app/api/admin/outcomes/[id]/override/route.ts` (new)
- `app/api/admin/outcomes/[id]/restore/route.ts` (new)
- `app/api/admin/canonical-events/merge/route.ts` (new)
- `app/api/cron/event-normalization/route.ts` (new)
- `app/api/cron/manual-override-cleanup/route.ts` (new)
- `app/api/flashscore/results/route.ts` (redirect to canonical_events in 089)
- `betssolution-player/lib/hooks/use-event.ts` (display manual_odds + isBettable)
- `kambi-scraper/` (RPC upsert whitelist)
- `22bet-scraper/` (RPC upsert whitelist, prod + staging)

**Cron additions** (scraper-vps crontab):
- `*/15 * * * * curl /api/cron/event-normalization` (087)
- `*/5 * * * * curl /api/cron/manual-override-cleanup` (088)
