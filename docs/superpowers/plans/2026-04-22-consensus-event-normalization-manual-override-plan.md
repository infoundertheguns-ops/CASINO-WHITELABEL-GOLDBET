# Consensus Fix + Event Normalization + Manual Override + Canonical Events — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken `/admin/consensus` page (migration 086), build a 5-stage event-normalization pipeline mirroring `lib/normalize/` markets pattern (migration 087), add manual override core with scraper-upsert protection (migration 088), and introduce a canonical_events identity layer with fan-out trigger and merge RPC (migration 089).

**Architecture:** Four sequentially deployed migrations, each shippable independently. 086 is a quick read-side fix. 087 populates `events.flashscore_id` to ≥ 95% via cascading deterministic stages + LLM subagent fallback. 088 adds `manual_*` columns to outcomes, guarded by a DB trigger against scraper upsert overwrites, with admin RPCs that bypass the trigger via session variable. 089 introduces `canonical_events` identity table with FK on events, a fan-out trigger that propagates Flashscore result updates, and a rewritten consensus RPC that joins on `canonical_event_id`.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (PostgreSQL), vitest, @supabase/supabase-js admin client (`createAdminClient()` from `lib/supabase/server.ts`), psql for migrations, inline-styled admin UI (no component library).

**Spec reference:** `docs/superpowers/specs/2026-04-22-consensus-event-normalization-manual-override-design.md`

**Branch:** Work on `master` (per project convention per memory — no feature branches for admin).

---

## Pre-flight

- **Working directory**: `C:\Users\philp\Downloads\betssolution\betssolution-admin`
- **Tests**: `pnpm test` (or `npm test`) runs vitest. Pattern: `tests/<mirror-source-path>/<file>.test.ts`. Proxy-based fake Supabase (see `tests/api/bets-list-query.test.ts` for reference).
- **Migrations** applied by **direct psql** (not `supabase db push`):
  ```bash
  PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co \
    -U postgres -d postgres -f supabase/migrations/<file>.sql
  ```
  Files live in `supabase/migrations/` for version control.
- **Dev server**: port 3001 local. Admin prod on scraper-vps (port 3000 tunneled via `ssh -f -N -L 3000:localhost:3000 scraper-vps`).
- **CI/CD**: prod admin deploys via GitHub Actions on `master`. Scraper-vps auto-pulls. Staging deploys via manual workflow trigger.
- **Kambi dual-write active**: modifications to admin RPCs must be tested on both prod and `admin-staging.betssolution.com`.
- **Scraper RPC deploy**: The RPC `upsert_prematch_batch` lives in `supabase/migrations/014_scraper_batch_rpc.sql`. Modifications are new migrations (e.g., 088b) — the RPC is `CREATE OR REPLACE`, applied via psql.
- **Cron** on scraper-vps at `/etc/crontab` or `crontab -e`. Scheduled HTTP calls with `x-scraper-key` header (env var `SCRAPER_API_KEY` on VPS).

### Git flow

After each task that produces working code, commit with conventional message:
- `feat(consensus)`: new feature on consensus
- `fix(consensus)`: bug fix
- `refactor(normalize)`: restructuring without behavior change
- `chore(db)`: migrations or DB changes
- `test(normalize)`: test-only changes
- `docs(plan)`: plan/spec updates

Always `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.

---

## Pre-Implementation Investigation Tasks

Three discovery tasks block phases 3 and 4. Do them before starting respective phases (ideally upfront so phases aren't blocked midway).

### Task 0.1: Locate flashscore results ingestion path (blocks Phase 4)

**Context**: Spec assumes `/api/flashscore/results/route.ts` exists and writes to `events.result`. Explore mapping revealed no such route. The flashscore-scraper (separate repo at `C:\Users\philp\Downloads\flashscore-scraper\`) must be ingesting results somehow.

- [ ] **Step 1: Search admin codebase for flashscore result write paths**

```bash
grep -rn "flashscore" app/api/ --include="*.ts" | head -30
grep -rn "UPDATE events.*result" app/api/ lib/ --include="*.ts" | head -10
```

- [ ] **Step 2: Check flashscore-scraper repo for DB write logic**

```bash
ls /c/Users/philp/Downloads/flashscore-scraper/
grep -rn "supabase\|createClient\|rpc(" /c/Users/philp/Downloads/flashscore-scraper/src/ | head -20
```

Look for: direct Supabase client calls to `rpc()` or `from('events').update()`, any HTTP POST to admin endpoints.

- [ ] **Step 3: Document findings in pre-Phase 4 note**

Write findings to `docs/superpowers/notes/flashscore-ingestion-path.md` (create file, brief notes). Options:
- If direct Supabase writes from scraper-vps → Phase 4 will require modifying flashscore-scraper source (not admin).
- If HTTP POST to an admin endpoint → Phase 4 modifies that endpoint.
- If writes via an admin RPC → Phase 4 modifies the RPC.

- [ ] **Step 4: Commit the note**

```bash
git add docs/superpowers/notes/flashscore-ingestion-path.md
git commit -m "docs(notes): flashscore ingestion path discovery for phase 4"
```

### Task 0.2: Locate prestige sync integration point (blocks Phase 3)

**Context**: Spec section 088.4 requires modifying prestige sync to skip `manual_suspended=true` outcomes. Integration point not documented.

- [ ] **Step 1: Search for prestige references**

```bash
grep -rn "prestige\|agent_sync\|push-to-vincitu\|push_to" \
  app/api/ lib/ scripts/ --include="*.ts" 2>/dev/null | head -30
```

- [ ] **Step 2: Check kambi-scraper repo**

```bash
ls /c/Users/philp/Downloads/kambi-scraper/src/ 2>/dev/null
grep -rn "prestige\|vincitu\|push" /c/Users/philp/Downloads/kambi-scraper/src/ | head -20
```

Memory mentions `kambi-scraper/push-to-vincitu.ts` with `shadowPush`. Confirm path and content.

- [ ] **Step 3: Check scraper-vps crontab remotely**

```bash
ssh scraper-vps 'crontab -l | grep -i "prestige\|vincitu\|sync" || echo "none"'
```

- [ ] **Step 4: Document findings**

Write to `docs/superpowers/notes/prestige-sync-integration.md`. Include:
- File paths where outcomes are aggregated for prestige push.
- Query/filter currently applied (so we know what to add `manual_suspended = false` to).
- Schedule (every N minutes?) so we know retry cadence.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/notes/prestige-sync-integration.md
git commit -m "docs(notes): prestige sync integration point for phase 3"
```

### Task 0.3: Locate player frontend integration (blocks Phase 3)

**Context**: Spec section 088.4 references `betssolution-player/lib/hooks/use-event.ts`. Need to verify path and current structure.

- [ ] **Step 1: Check kiosk-stanleybet (active frontend per memory)**

```bash
ls /c/Users/philp/Downloads/kiosk-stanleybet/web/
find /c/Users/philp/Downloads/kiosk-stanleybet/web/lib -name "use-event*" -type f 2>/dev/null
find /c/Users/philp/Downloads/kiosk-stanleybet/web -name "use-*outcome*" -type f 2>/dev/null
```

- [ ] **Step 2: Check betssolution-player clone**

```bash
ls /c/Users/philp/Downloads/betssolution/betssolution-player/ 2>/dev/null
find /c/Users/philp/Downloads/betssolution/betssolution-player -name "use-event*" -type f 2>/dev/null
```

- [ ] **Step 3: Identify consumer pattern**

Read the file(s) found. Locate:
- Where `outcome.odds` is read for display.
- Where `outcome.is_suspended` is checked for bettability.
- SSE stream endpoint (search `new EventSource` or `'/api/sse'`).

- [ ] **Step 4: Document findings**

Write to `docs/superpowers/notes/player-frontend-integration.md`:
- Exact file path(s) to modify in Phase 3 Task 3.17.
- Current shape of outcome object (key names — `price`? `odds`?).
- SSE route that needs serializer update.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/notes/player-frontend-integration.md
git commit -m "docs(notes): player frontend integration point for phase 3"
```

---

# Phase 1: Migration 086 — Consensus Fix

**Target**: `/admin/consensus` no longer crashes, shows multi-sport, dedupes rows. ~1.5h of work.

## Phase 1 File Structure

### New files
| Path | Purpose |
|---|---|
| `supabase/migrations/086_consensus_fix.sql` | Rewrite `refresh_consensus_snapshots` + create `v_consensus_latest` + ALTER `consensus_snapshots` |
| `tests/api/consensus/list-outliers.test.ts` | Test listOutliers reads from view (fake Supabase) |

### Modified files
| Path | What changes |
|---|---|
| `app/api/admin/consensus/route.ts` | `listOutliers()` switched from `consensus_snapshots` to `v_consensus_latest` |

---

## Task 1.1: Write migration 086 SQL

**Files:**
- Create: `supabase/migrations/086_consensus_fix.sql`

- [ ] **Step 1: Create the migration file with schema additions + RPC rewrite + view**

Create `supabase/migrations/086_consensus_fix.sql`:

```sql
-- ═══════════════════════════════════════════════════
-- Migration 086: Consensus Fix
--
-- Fixes 4 bugs on /admin/consensus:
-- 1. RPC crash (ON CONFLICT duplicate) after mig 040 via canonical_key collapse.
-- 2. Duplicate UI rows (time-series without latest-dedup).
-- 3. Mono-sport dropdown (regex fuzzy only worked on football).
-- 4. Prepares ground for future canonical_event_id migration (089).
--
-- Q1=B: DISTINCT ON ordering = delta_pct DESC, twobet_outcomes_count DESC, market_type_raw ASC.
-- See docs/superpowers/specs/2026-04-22-consensus-event-normalization-manual-override-design.md
-- ═══════════════════════════════════════════════════

-- -----------------------------------------------------
-- 086.1 — Add metadata columns for dedup visibility
-- -----------------------------------------------------

ALTER TABLE consensus_snapshots
  ADD COLUMN IF NOT EXISTS twobet_outcomes_count integer,
  ADD COLUMN IF NOT EXISTS twobet_market_type_raw text;

-- -----------------------------------------------------
-- 086.2 — Rewrite refresh_consensus_snapshots RPC
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION refresh_consensus_snapshots(
  threshold_pct numeric DEFAULT 15
)
RETURNS TABLE(
  upserted integer,
  scanned_pairs integer,
  candidate_deltas integer,
  dropped_dedup integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '300s'
AS $$
DECLARE
  v_upserted integer := 0;
  v_scanned_pairs integer := 0;
  v_candidate_deltas integer := 0;
  v_dropped_dedup integer := 0;
  v_hour_bucket timestamptz;
BEGIN
  v_hour_bucket := date_trunc('hour', now() AT TIME ZONE 'UTC');

  -- Build tmp_pairs using flashscore_id pivot (priority 1) with regex fallback (priority 2)
  CREATE TEMP TABLE IF NOT EXISTS tmp_pairs_raw ON COMMIT DROP AS
    SELECT k.id AS kambi_id, t.id AS twobet_id, 1 AS match_priority
    FROM events k
    JOIN events t ON k.flashscore_id = t.flashscore_id
    WHERE k.source = 'kambi' AND t.source = '22bet'
      AND k.flashscore_id IS NOT NULL
      AND k.status IN ('prematch','live')
      AND t.status IN ('prematch','live')
    UNION ALL
    SELECT k.id, t.id, 2 AS match_priority
    FROM events k
    JOIN events t ON
      lower(regexp_replace(k.home_team, '[^a-zA-Z0-9]', '', 'g')) =
      lower(regexp_replace(t.home_team, '[^a-zA-Z0-9]', '', 'g'))
      AND lower(regexp_replace(k.away_team, '[^a-zA-Z0-9]', '', 'g')) =
          lower(regexp_replace(t.away_team, '[^a-zA-Z0-9]', '', 'g'))
      AND k.starts_at BETWEEN t.starts_at - interval '2h' AND t.starts_at + interval '2h'
    WHERE k.source = 'kambi' AND t.source = '22bet'
      AND k.status IN ('prematch','live')
      AND t.status IN ('prematch','live');

  CREATE TEMP TABLE tmp_pairs ON COMMIT DROP AS
    SELECT DISTINCT ON (kambi_id) kambi_id, twobet_id
    FROM tmp_pairs_raw
    ORDER BY kambi_id, match_priority ASC;

  SELECT count(*) INTO v_scanned_pairs FROM tmp_pairs;

  -- Build candidates from all matched markets × outcomes with delta above threshold
  CREATE TEMP TABLE tmp_candidates ON COMMIT DROP AS
    SELECT
      k.id AS kambi_event_id,
      e_sport.name AS sport,
      k.home_team,
      k.away_team,
      k.starts_at AS event_starts_at,
      km.market_type,
      ko.name AS outcome_name,
      ko.odds AS kambi_odds,
      to_.odds AS twobet_odds,
      ((ko.odds - to_.odds) / to_.odds) * 100 AS delta_pct,
      COUNT(*) OVER (PARTITION BY tm.id) AS twobet_outcomes_count,
      tm.market_type AS twobet_market_type_raw,
      k.id AS _k_event_id,
      p.twobet_id AS _t_event_id
    FROM tmp_pairs p
    JOIN events k ON k.id = p.kambi_id
    JOIN sports e_sport ON e_sport.id = k.sport_id
    JOIN markets km ON km.event_id = k.id AND km.is_active
    JOIN outcomes ko ON ko.market_id = km.id AND ko.is_active AND ko.odds >= 1.10
    JOIN markets tm ON tm.event_id = p.twobet_id
                    AND tm.is_active
                    AND COALESCE(tm.canonical_key, tm.market_type) = COALESCE(km.canonical_key, km.market_type)
    JOIN outcomes to_ ON to_.market_id = tm.id
                      AND to_.is_active
                      AND to_.odds >= 1.10
                      AND to_.name = ko.name
    WHERE abs((ko.odds - to_.odds) / to_.odds) * 100 >= threshold_pct;

  SELECT count(*) INTO v_candidate_deltas FROM tmp_candidates;

  -- DISTINCT ON dedup: per (kambi_event_id, market_type, outcome_name), keep biggest delta
  CREATE TEMP TABLE tmp_dedup ON COMMIT DROP AS
    SELECT DISTINCT ON (kambi_event_id, market_type, outcome_name)
      kambi_event_id, sport, home_team, away_team, event_starts_at,
      market_type, outcome_name, kambi_odds, twobet_odds, delta_pct,
      twobet_outcomes_count, twobet_market_type_raw, _t_event_id
    FROM tmp_candidates
    ORDER BY kambi_event_id, market_type, outcome_name,
             abs(delta_pct) DESC,
             twobet_outcomes_count DESC,
             twobet_market_type_raw ASC;

  v_dropped_dedup := v_candidate_deltas - (SELECT count(*) FROM tmp_dedup);

  -- Upsert into consensus_snapshots
  INSERT INTO consensus_snapshots (
    kambi_event_id, twobet_event_id, sport, home_team, away_team, event_starts_at,
    market_type, outcome_name, kambi_odds, twobet_odds, delta_pct,
    twobet_outcomes_count, twobet_market_type_raw, snapshot_at
  )
  SELECT
    kambi_event_id, _t_event_id, sport, home_team, away_team, event_starts_at,
    market_type, outcome_name, kambi_odds, twobet_odds, delta_pct,
    twobet_outcomes_count, twobet_market_type_raw, now()
  FROM tmp_dedup
  ON CONFLICT (kambi_event_id, market_type, outcome_name,
               (date_trunc('hour', snapshot_at AT TIME ZONE 'UTC')))
  DO UPDATE SET
    kambi_odds = EXCLUDED.kambi_odds,
    twobet_odds = EXCLUDED.twobet_odds,
    delta_pct = EXCLUDED.delta_pct,
    twobet_outcomes_count = EXCLUDED.twobet_outcomes_count,
    twobet_market_type_raw = EXCLUDED.twobet_market_type_raw,
    snapshot_at = now();

  GET DIAGNOSTICS v_upserted = ROW_COUNT;

  -- Emit a NOTICE for observability (appears in PG logs)
  IF v_dropped_dedup > 0 THEN
    RAISE NOTICE 'consensus dedup: % candidates collapsed (% upserted, % dropped)',
      v_candidate_deltas, v_upserted, v_dropped_dedup;
  END IF;

  RETURN QUERY SELECT v_upserted, v_scanned_pairs, v_candidate_deltas, v_dropped_dedup;
END;
$$;

-- -----------------------------------------------------
-- 086.3 — View v_consensus_latest for UI
-- -----------------------------------------------------

CREATE OR REPLACE VIEW v_consensus_latest AS
SELECT DISTINCT ON (kambi_event_id, market_type, outcome_name)
  id, kambi_event_id, twobet_event_id, sport, home_team, away_team, event_starts_at,
  market_type, outcome_name, kambi_odds, twobet_odds, delta_pct, abs_delta_pct,
  twobet_outcomes_count, twobet_market_type_raw,
  snapshot_at, reviewed, reviewed_at, reviewed_by, notes
FROM consensus_snapshots
ORDER BY kambi_event_id, market_type, outcome_name, snapshot_at DESC;

COMMENT ON VIEW v_consensus_latest IS
  'Per-outlier latest snapshot for UI. Read by /admin/consensus listOutliers. KPIs + refresh still use consensus_snapshots base.';
```

- [ ] **Step 2: Commit the migration file**

```bash
git add supabase/migrations/086_consensus_fix.sql
git commit -m "chore(db): add migration 086 consensus fix (RPC rewrite + view)"
```

## Task 1.2: Test migration against staging DB

**Files:**
- Apply: `supabase/migrations/086_consensus_fix.sql`

- [ ] **Step 1: Apply migration to staging DB**

Staging DB creds are in `.env.staging`. Fetch them once:

```bash
STAGING_PG_HOST=$(grep -E '^SUPABASE_STAGING_DB_HOST=' .env.staging | cut -d= -f2)
STAGING_PG_PASS=$(grep -E '^SUPABASE_STAGING_DB_PASS=' .env.staging | cut -d= -f2)
```

Apply:

```bash
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres \
  -f supabase/migrations/086_consensus_fix.sql
```

Expected output: `CREATE FUNCTION`, `CREATE VIEW`, `ALTER TABLE`.

- [ ] **Step 2: Invoke RPC synthetically**

```bash
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres \
  -c "SELECT * FROM refresh_consensus_snapshots(15);"
```

Expected: 4 columns returned (upserted, scanned_pairs, candidate_deltas, dropped_dedup). No `ON CONFLICT DO UPDATE command cannot affect row a second time` error.

- [ ] **Step 3: Verify view dedups**

```bash
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres \
  -c "SELECT kambi_event_id, market_type, outcome_name, count(*)
      FROM v_consensus_latest
      GROUP BY 1, 2, 3
      HAVING count(*) > 1
      LIMIT 5;"
```

Expected: 0 rows. The view MUST produce exactly one row per (kambi_event_id, market_type, outcome_name).

- [ ] **Step 4: Verify multi-sport enrichment**

```bash
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres \
  -c "SELECT sport, count(*) FROM v_consensus_latest GROUP BY sport ORDER BY 2 DESC;"
```

Expected: ≥ 2 distinct sports (football + at least one other where flashscore_id populated on both sources).

- [ ] **Step 5: Write observation to git commit note (informal)**

No code change. Just ensure the staging verification documented in PR description when deploying to prod.

## Task 1.3: Modify listOutliers to read from view

**Files:**
- Modify: `app/api/admin/consensus/route.ts`

- [ ] **Step 1: Read current listOutliers implementation**

```bash
sed -n '1,120p' app/api/admin/consensus/route.ts
```

Identify the `.from('consensus_snapshots')` call inside listOutliers.

- [ ] **Step 2: Write the failing test**

Create `tests/api/consensus/list-outliers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

// Minimal fake Supabase tracking the last .from() call
function fakeSupabase() {
  const calls: string[] = [];
  const chain: any = {};
  ['eq', 'gte', 'lte', 'order', 'limit', 'range', 'select'].forEach((m) => {
    chain[m] = (...args: any[]) => {
      calls.push(`${m}(${JSON.stringify(args)})`);
      return chain;
    };
  });
  return {
    _calls: calls,
    _lastFrom: '',
    from(table: string) {
      (this as any)._lastFrom = table;
      calls.push(`from(${JSON.stringify(table)})`);
      return chain;
    },
  } as any;
}

describe('listOutliers', () => {
  it('reads from v_consensus_latest view, not consensus_snapshots base table', async () => {
    // Import the handler — exact path depends on how route.ts exports its logic.
    // If listOutliers is not exported, we test via the route handler GET with action=list.
    const { listOutliers } = await import('@/app/api/admin/consensus/route');
    const sb = fakeSupabase();
    await listOutliers(sb, { sport: null, minDelta: 15, limit: 50, offset: 0 }).catch(() => {});
    expect(sb._lastFrom).toBe('v_consensus_latest');
  });
});
```

- [ ] **Step 3: Run to confirm failure**

```bash
pnpm test tests/api/consensus/list-outliers.test.ts
```

Expected: FAIL — the test expects `v_consensus_latest` but current implementation uses `consensus_snapshots`.

If `listOutliers` is not exported, first add `export` to it (small refactor).

- [ ] **Step 4: Modify listOutliers**

Edit `app/api/admin/consensus/route.ts`. Find:

```typescript
const { data, error } = await supabase
  .from("consensus_snapshots")
  ...
```

Replace with:

```typescript
const { data, error } = await supabase
  .from("v_consensus_latest")
  ...
```

Leave `refresh` handler and KPI aggregates pointing to `consensus_snapshots` (unchanged).

- [ ] **Step 5: Run test to verify pass**

```bash
pnpm test tests/api/consensus/list-outliers.test.ts
```

Expected: PASS.

- [ ] **Step 6: Smoke-test frontend locally**

```bash
pnpm dev
# Open http://localhost:3001/admin/consensus
# Verify page loads, no console errors, deduplicated rows visible.
```

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/consensus/route.ts tests/api/consensus/list-outliers.test.ts
git commit -m "fix(consensus): read listOutliers from v_consensus_latest (mig 086)"
```

## Task 1.4: Apply 086 to prod

**Files:**
- Apply: `supabase/migrations/086_consensus_fix.sql` (prod DB)

- [ ] **Step 1: Apply to prod DB**

```bash
PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co \
  -U postgres -d postgres -f supabase/migrations/086_consensus_fix.sql
```

Expected: `CREATE FUNCTION`, `CREATE VIEW`, `ALTER TABLE` (no errors).

- [ ] **Step 2: Invoke RPC in prod**

```bash
PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co \
  -U postgres -d postgres \
  -c "SELECT * FROM refresh_consensus_snapshots(15);"
```

Expected: 4 columns returned. No crash.

- [ ] **Step 3: Push code change to GitHub**

CI/CD will deploy admin to scraper-vps on push to master.

```bash
git push origin master
```

- [ ] **Step 4: Monitor deployment**

```bash
# Wait ~2min for GitHub Actions, then:
ssh scraper-vps 'systemctl status betssolution-admin | head -5'
ssh scraper-vps 'journalctl -u betssolution-admin -n 20 --no-pager'
```

- [ ] **Step 5: Verify /admin/consensus in prod**

```bash
# Tunnel if needed:
ssh -f -N -L 3000:localhost:3000 scraper-vps
# Open http://localhost:3000/admin/consensus
```

Expected: page loads, dedup visible, multi-sport dropdown populated.

- [ ] **Step 6: Close mirror-deploy to admin-staging**

The Kambi dual-write path means admin-staging must match prod schema. Apply 086 to staging DB:

```bash
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres \
  -f supabase/migrations/086_consensus_fix.sql
```

---

## ✅ GATE 1 — Phase 1 complete

Verify all of:
- [ ] `/admin/consensus` prod loads without error.
- [ ] `refresh_consensus_snapshots` prod invocation returns 4-column tuple with no exception.
- [ ] `v_consensus_latest` dedup query returns 0 duplicate (kambi_event_id, market_type, outcome_name) tuples.
- [ ] Sport dropdown shows ≥ 2 sports.
- [ ] `tests/api/consensus/list-outliers.test.ts` passes in CI.

**Merge decision point**: If any check fails, investigate before proceeding to Phase 2. Safe to proceed when all green.

---

# Phase 2: Migration 087 — Event Normalization

**Target**: `events.flashscore_id` coverage ≥ 95% via 5-stage cascading pipeline. ~1 day of work.

## Phase 2 File Structure

### New files

| Path | Purpose |
|---|---|
| `supabase/migrations/087_event_normalization.sql` | `event_normalization` + ALTER `team_aliases` + `team_mapping` |
| `supabase/migrations/087b_team_aliases_tag_sport.sql` | One-off: tag existing seed rows with sport='football' where applicable |
| `lib/normalize/events/types.ts` | Shared types for event normalization pipeline |
| `lib/normalize/events/regex.ts` | Stage 2: regex fuzzy matcher (port from existing flashscore matching) |
| `lib/normalize/events/trigram.ts` | Stage 3a: pg_trgm similarity query |
| `lib/normalize/events/alias-dict.ts` | Stage 3b: team_aliases lookup + normalization |
| `lib/normalize/events/propagation.ts` | Stage 4: team_mapping cache lookup |
| `lib/normalize/events/llm-core.ts` | Stage 5 prompt builder + response parser (subagent + future API) |
| `lib/normalize/events/engine.ts` | 5-stage dispatcher |
| `app/api/admin/event-normalization/route.ts` | GET list + POST actions (verify, manual-assign, reject) |
| `app/api/admin/event-normalization/run-subagent/route.ts` | POST: trigger stage 5 batch via Claude Code Task |
| `app/api/admin/event-normalization/backfill/route.ts` | POST: one-shot batch processor |
| `app/api/cron/event-normalization/route.ts` | POST: scheduled drainage |
| `app/admin/event-normalization/page.tsx` | 5-tab admin UI |
| `tests/lib/normalize/events/regex.test.ts` | Regex stage unit tests |
| `tests/lib/normalize/events/trigram.test.ts` | Trigram + alias tests (fake supabase) |
| `tests/lib/normalize/events/propagation.test.ts` | Propagation tests |
| `tests/lib/normalize/events/engine.test.ts` | Engine dispatcher tests |

### Modified files

| Path | What changes |
|---|---|
| `app/admin/layout.tsx` | Add sidebar entry `event-normalization` |

---

## Task 2.1: Write migration 087 SQL

**Files:**
- Create: `supabase/migrations/087_event_normalization.sql`

- [ ] **Step 1: Create migration file**

```sql
-- ═══════════════════════════════════════════════════
-- Migration 087: Event Normalization
--
-- New tables: event_normalization, team_mapping
-- Extended: team_aliases (ALTER to add sport, source, verified, created_by)
--
-- Pipeline staged in lib/normalize/events/.
-- See docs/superpowers/specs/2026-04-22-consensus-event-normalization-manual-override-design.md
-- ═══════════════════════════════════════════════════

-- Enable pg_trgm if not already enabled (for stage 3 similarity)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -----------------------------------------------------
-- 087.1 — event_normalization (new table)
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS event_normalization (
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

-- -----------------------------------------------------
-- 087.2 — Extend team_aliases (from mig 013)
-- -----------------------------------------------------

ALTER TABLE team_aliases
  ADD COLUMN IF NOT EXISTS sport text,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS verified boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_team_aliases_sport ON team_aliases(sport)
  WHERE sport IS NOT NULL;

-- -----------------------------------------------------
-- 087.3 — team_mapping (propagation cache)
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS team_mapping (
  id bigserial PRIMARY KEY,
  sport text NOT NULL,
  source text NOT NULL,
  raw_name text NOT NULL,
  flashscore_team_id text,
  canonical_name text,
  verified boolean DEFAULT false,
  verified_at timestamptz,
  verified_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(sport, source, raw_name)
);

CREATE INDEX IF NOT EXISTS idx_team_mapping_fs ON team_mapping(flashscore_team_id);

COMMENT ON TABLE team_mapping IS
  'Propagation cache: (sport, source, raw_name) -> flashscore_team_id. NULL flashscore_team_id = negative cache (confirmed no match). Populated by event-normalization engine stage 4.';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/087_event_normalization.sql
git commit -m "chore(db): add migration 087 event normalization schema"
```

## Task 2.2: Write migration 087b (tag existing aliases with sport)

**Files:**
- Create: `supabase/migrations/087b_team_aliases_tag_sport.sql`

- [ ] **Step 1: Create file**

```sql
-- ═══════════════════════════════════════════════════
-- Migration 087b: Tag existing team_aliases seeds with sport
-- Based on observation: all seeds in mig 013 are football
-- (club names + national teams used for football). Tag all as
-- 'football' where sport is currently NULL. National teams
-- stay flexible via this conservative assignment since the
-- vast majority of team_aliases usage is football.
-- ═══════════════════════════════════════════════════

UPDATE team_aliases
SET sport = 'football'
WHERE sport IS NULL;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/087b_team_aliases_tag_sport.sql
git commit -m "chore(db): tag mig 013 team_aliases seeds as football (mig 087b)"
```

## Task 2.3: Write types.ts for event normalization

**Files:**
- Create: `lib/normalize/events/types.ts`

- [ ] **Step 1: Create file**

```typescript
// lib/normalize/events/types.ts

export type EventSource = 'kambi' | '22bet';

export type MatchStage =
  | 'flashscore_native'
  | 'regex'
  | 'trigram'
  | 'alias_dict'
  | 'propagation'
  | 'llm'
  | 'manual';

export interface EventToNormalize {
  id: string;
  source: EventSource;
  sport: string;
  league: string | null;
  home_team: string;
  away_team: string;
  starts_at: string; // ISO 8601
  flashscore_id: string | null; // null = needs mapping
}

export interface FlashscoreCandidate {
  flashscore_id: string;
  home_team: string;
  away_team: string;
  starts_at: string;
  sport: string;
  league: string | null;
}

export interface MatchResult {
  flashscore_id: string | null;
  stage: MatchStage | 'unmapped';
  confidence: number; // 0.0 - 1.0
  llm_reason?: string;
}

export const AUTO_APPLY_THRESHOLDS: Record<MatchStage, number> = {
  flashscore_native: 1.0,
  regex: 0.8,
  trigram: 0.85,
  alias_dict: 0.85,
  propagation: 1.0,
  llm: 0.95,
  manual: 1.0,
};

export interface StageHandler {
  name: MatchStage;
  autoApplyThreshold: number;
  (event: EventToNormalize): Promise<MatchResult | null>;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/normalize/events/types.ts
git commit -m "feat(normalize): add types for event normalization pipeline"
```

## Task 2.4: Write regex stage with tests

**Files:**
- Create: `lib/normalize/events/regex.ts`
- Create: `tests/lib/normalize/events/regex.test.ts`

- [ ] **Step 1: Write the failing test first**

Create `tests/lib/normalize/events/regex.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { matchByRegex } from '@/lib/normalize/events/regex';

describe('matchByRegex', () => {
  it('matches identical team names case-insensitively', async () => {
    const event = {
      id: 'e1', source: 'kambi' as const, sport: 'football', league: 'Serie A',
      home_team: 'Milan', away_team: 'Inter', starts_at: '2026-04-22T20:00:00Z',
      flashscore_id: null,
    };
    const candidates = [
      { flashscore_id: 'fs1', home_team: 'MILAN', away_team: 'Inter',
        starts_at: '2026-04-22T20:00:00Z', sport: 'football', league: 'Serie A' },
    ];
    const result = await matchByRegex(event, candidates);
    expect(result?.flashscore_id).toBe('fs1');
    expect(result?.stage).toBe('regex');
    expect(result?.confidence).toBeCloseTo(0.8);
  });

  it('strips non-alphanumerics before comparing', async () => {
    const event = {
      id: 'e1', source: 'kambi' as const, sport: 'football', league: 'Eredivisie',
      home_team: 'PSV Eindhoven', away_team: 'Ajax', starts_at: '2026-04-22T20:00:00Z',
      flashscore_id: null,
    };
    const candidates = [
      { flashscore_id: 'fs2', home_team: 'PSV-Eindhoven', away_team: 'Ajax!',
        starts_at: '2026-04-22T20:00:00Z', sport: 'football', league: 'Eredivisie' },
    ];
    const result = await matchByRegex(event, candidates);
    expect(result?.flashscore_id).toBe('fs2');
  });

  it('requires starts_at within 2h', async () => {
    const event = {
      id: 'e1', source: 'kambi' as const, sport: 'football', league: null,
      home_team: 'Milan', away_team: 'Inter', starts_at: '2026-04-22T20:00:00Z',
      flashscore_id: null,
    };
    const candidates = [
      { flashscore_id: 'fs3', home_team: 'Milan', away_team: 'Inter',
        starts_at: '2026-04-23T05:00:00Z', sport: 'football', league: null },
    ];
    const result = await matchByRegex(event, candidates);
    expect(result).toBeNull();
  });

  it('returns null when no candidate matches', async () => {
    const event = {
      id: 'e1', source: 'kambi' as const, sport: 'football', league: null,
      home_team: 'Milan', away_team: 'Inter', starts_at: '2026-04-22T20:00:00Z',
      flashscore_id: null,
    };
    const candidates = [
      { flashscore_id: 'fs4', home_team: 'Roma', away_team: 'Lazio',
        starts_at: '2026-04-22T20:00:00Z', sport: 'football', league: null },
    ];
    const result = await matchByRegex(event, candidates);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm test tests/lib/normalize/events/regex.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Create `lib/normalize/events/regex.ts`**

```typescript
// lib/normalize/events/regex.ts
// Stage 2: regex fuzzy matching ported from lib/flashscore.ts matchFixtures.

import type { EventToNormalize, FlashscoreCandidate, MatchResult } from './types';

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function hoursBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / (1000 * 60 * 60);
}

export async function matchByRegex(
  event: EventToNormalize,
  candidates: FlashscoreCandidate[],
): Promise<MatchResult | null> {
  const eh = normalize(event.home_team);
  const ea = normalize(event.away_team);
  for (const c of candidates) {
    const ch = normalize(c.home_team);
    const ca = normalize(c.away_team);
    if (eh === ch && ea === ca && hoursBetween(event.starts_at, c.starts_at) <= 2) {
      return {
        flashscore_id: c.flashscore_id,
        stage: 'regex',
        confidence: 0.8,
      };
    }
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm test tests/lib/normalize/events/regex.test.ts
```

Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/normalize/events/regex.ts tests/lib/normalize/events/regex.test.ts
git commit -m "feat(normalize/events): add regex matcher stage with tests"
```

## Task 2.5: Write trigram stage

**Files:**
- Create: `lib/normalize/events/trigram.ts`
- Create: `tests/lib/normalize/events/trigram.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/normalize/events/trigram.test.ts
import { describe, it, expect } from 'vitest';
import { matchByTrigram } from '@/lib/normalize/events/trigram';

function fakeSupabase(trigramResults: any[]) {
  return {
    rpc: async (fn: string, _params: any) => {
      if (fn === 'match_event_by_trigram') return { data: trigramResults, error: null };
      return { data: null, error: new Error('unexpected rpc') };
    },
  } as any;
}

describe('matchByTrigram', () => {
  it('returns top trigram candidate above threshold', async () => {
    const sb = fakeSupabase([
      { flashscore_id: 'fs1', similarity: 0.92 },
      { flashscore_id: 'fs2', similarity: 0.65 },
    ]);
    const event = {
      id: 'e1', source: 'kambi' as const, sport: 'tennis', league: null,
      home_team: 'Djokovic N', away_team: 'Alcaraz C',
      starts_at: '2026-04-22T15:00:00Z', flashscore_id: null,
    };
    const result = await matchByTrigram(sb, event);
    expect(result?.flashscore_id).toBe('fs1');
    expect(result?.stage).toBe('trigram');
    expect(result?.confidence).toBeCloseTo(0.92);
  });

  it('returns null when no candidate above 0.7', async () => {
    const sb = fakeSupabase([{ flashscore_id: 'fs1', similarity: 0.5 }]);
    const event = {
      id: 'e1', source: 'kambi' as const, sport: 'tennis', league: null,
      home_team: 'Random Player', away_team: 'Another One',
      starts_at: '2026-04-22T15:00:00Z', flashscore_id: null,
    };
    const result = await matchByTrigram(sb, event);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm test tests/lib/normalize/events/trigram.test.ts
```

- [ ] **Step 3: Create `lib/normalize/events/trigram.ts`**

```typescript
// lib/normalize/events/trigram.ts
// Stage 3a: pg_trgm similarity via RPC

import type { EventToNormalize, MatchResult } from './types';

const TRIGRAM_THRESHOLD = 0.7;

export async function matchByTrigram(
  supabase: any,
  event: EventToNormalize,
): Promise<MatchResult | null> {
  const { data, error } = await supabase.rpc('match_event_by_trigram', {
    p_sport: event.sport,
    p_home: event.home_team,
    p_away: event.away_team,
    p_starts_at: event.starts_at,
    p_window_hours: 3,
    p_limit: 5,
  });
  if (error || !data || !Array.isArray(data)) return null;
  const top = data[0];
  if (!top || top.similarity < TRIGRAM_THRESHOLD) return null;
  return {
    flashscore_id: top.flashscore_id,
    stage: 'trigram',
    confidence: Math.min(1, top.similarity),
  };
}
```

- [ ] **Step 4: Add SQL RPC to migration 087 (append to file)**

Append to `supabase/migrations/087_event_normalization.sql`:

```sql
-- -----------------------------------------------------
-- 087.4 — match_event_by_trigram RPC (stage 3a)
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION match_event_by_trigram(
  p_sport text,
  p_home text,
  p_away text,
  p_starts_at timestamptz,
  p_window_hours int DEFAULT 3,
  p_limit int DEFAULT 5
)
RETURNS TABLE(
  flashscore_id text,
  home_team text,
  away_team text,
  starts_at timestamptz,
  similarity numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    flashscore_id, home_team, away_team, starts_at,
    ((similarity(home_team, p_home) + similarity(away_team, p_away)) / 2)::numeric AS similarity
  FROM be_fixtures
  WHERE sport = p_sport
    AND starts_at BETWEEN p_starts_at - (p_window_hours || ' hours')::interval
                      AND p_starts_at + (p_window_hours || ' hours')::interval
  ORDER BY similarity DESC
  LIMIT p_limit;
$$;
```

Note: assumes a `be_fixtures` table exists with flashscore data. If named differently, adapt.

- [ ] **Step 5: Run tests to verify pass**

```bash
pnpm test tests/lib/normalize/events/trigram.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add lib/normalize/events/trigram.ts tests/lib/normalize/events/trigram.test.ts \
  supabase/migrations/087_event_normalization.sql
git commit -m "feat(normalize/events): add trigram stage with match_event_by_trigram RPC"
```

## Task 2.6: Write alias-dict stage

**Files:**
- Create: `lib/normalize/events/alias-dict.ts`
- Create: `tests/lib/normalize/events/alias-dict.test.ts`

- [ ] **Step 1: Test first**

```typescript
// tests/lib/normalize/events/alias-dict.test.ts
import { describe, it, expect } from 'vitest';
import { matchByAliasDict } from '@/lib/normalize/events/alias-dict';

function fakeSupabase(aliases: any[], fixtures: any[]) {
  return {
    from: (t: string) => {
      const chain = {
        select: () => chain,
        or: () => chain,
        eq: () => chain,
        gte: () => chain,
        lte: () => chain,
        limit: () => chain,
        then: (fn: any) => {
          if (t === 'team_aliases') return fn({ data: aliases, error: null });
          if (t === 'be_fixtures') return fn({ data: fixtures, error: null });
          return fn({ data: [], error: null });
        },
      } as any;
      return chain;
    },
  } as any;
}

describe('matchByAliasDict', () => {
  it('matches via canonical lookup', async () => {
    const sb = fakeSupabase(
      [{ canonical: 'inter', alias: 'internazionale' }],
      [{ flashscore_id: 'fs1', home_team: 'Inter', away_team: 'Milan',
         starts_at: '2026-04-22T20:00:00Z', sport: 'football' }],
    );
    const event = {
      id: 'e1', source: 'kambi' as const, sport: 'football', league: null,
      home_team: 'Internazionale', away_team: 'Milan',
      starts_at: '2026-04-22T20:00:00Z', flashscore_id: null,
    };
    const result = await matchByAliasDict(sb, event);
    expect(result?.flashscore_id).toBe('fs1');
    expect(result?.stage).toBe('alias_dict');
  });
});
```

- [ ] **Step 2: Implementation**

```typescript
// lib/normalize/events/alias-dict.ts
import type { EventToNormalize, MatchResult } from './types';

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

async function resolveAlias(supabase: any, name: string, sport: string): Promise<string> {
  const normed = normalize(name);
  const { data } = await supabase.from('team_aliases')
    .select('canonical')
    .eq('alias', normed)
    .or(`sport.eq.${sport},sport.is.null`)
    .limit(1);
  return data && data.length ? normalize(data[0].canonical) : normed;
}

export async function matchByAliasDict(
  supabase: any,
  event: EventToNormalize,
): Promise<MatchResult | null> {
  const [rh, ra] = await Promise.all([
    resolveAlias(supabase, event.home_team, event.sport),
    resolveAlias(supabase, event.away_team, event.sport),
  ]);

  const { data: candidates } = await supabase.from('be_fixtures')
    .select('flashscore_id, home_team, away_team, starts_at')
    .eq('sport', event.sport)
    .gte('starts_at', new Date(new Date(event.starts_at).getTime() - 3 * 60 * 60 * 1000).toISOString())
    .lte('starts_at', new Date(new Date(event.starts_at).getTime() + 3 * 60 * 60 * 1000).toISOString())
    .limit(50);

  if (!candidates) return null;

  for (const c of candidates) {
    const ch = await resolveAlias(supabase, c.home_team, event.sport);
    const ca = await resolveAlias(supabase, c.away_team, event.sport);
    if (rh === ch && ra === ca) {
      return {
        flashscore_id: c.flashscore_id,
        stage: 'alias_dict',
        confidence: 0.9,
      };
    }
  }
  return null;
}
```

- [ ] **Step 3: Run test, commit**

```bash
pnpm test tests/lib/normalize/events/alias-dict.test.ts
git add lib/normalize/events/alias-dict.ts tests/lib/normalize/events/alias-dict.test.ts
git commit -m "feat(normalize/events): add alias-dict stage"
```

## Task 2.7: Write propagation stage

**Files:**
- Create: `lib/normalize/events/propagation.ts`
- Create: `tests/lib/normalize/events/propagation.test.ts`

- [ ] **Step 1: Test**

```typescript
// tests/lib/normalize/events/propagation.test.ts
import { describe, it, expect } from 'vitest';
import { matchByPropagation } from '@/lib/normalize/events/propagation';

function fakeSupabase(mappings: any[], fixtures: any[]) {
  return {
    from: (t: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        limit: () => chain,
        then: (fn: any) => {
          if (t === 'team_mapping') return fn({ data: mappings, error: null });
          if (t === 'be_fixtures') return fn({ data: fixtures, error: null });
          return fn({ data: [], error: null });
        },
      };
      return chain;
    },
  } as any;
}

describe('matchByPropagation', () => {
  it('resolves both home and away via cache then finds fixture', async () => {
    const sb = fakeSupabase(
      [
        { raw_name: 'Milan', flashscore_team_id: 'fst-milan' },
        { raw_name: 'Inter', flashscore_team_id: 'fst-inter' },
      ],
      [{ flashscore_id: 'fs1', home_team_id: 'fst-milan', away_team_id: 'fst-inter',
         starts_at: '2026-04-22T20:00:00Z' }],
    );
    const event = {
      id: 'e1', source: 'kambi' as const, sport: 'football', league: null,
      home_team: 'Milan', away_team: 'Inter',
      starts_at: '2026-04-22T20:00:00Z', flashscore_id: null,
    };
    const result = await matchByPropagation(sb, event);
    expect(result?.flashscore_id).toBe('fs1');
    expect(result?.stage).toBe('propagation');
    expect(result?.confidence).toBe(1.0);
  });
});
```

- [ ] **Step 2: Implementation**

```typescript
// lib/normalize/events/propagation.ts
import type { EventToNormalize, MatchResult } from './types';

export async function matchByPropagation(
  supabase: any,
  event: EventToNormalize,
): Promise<MatchResult | null> {
  const { data: mappings } = await supabase.from('team_mapping')
    .select('raw_name, flashscore_team_id')
    .eq('sport', event.sport)
    .eq('source', event.source)
    .in('raw_name', [event.home_team, event.away_team]);

  if (!mappings || mappings.length < 2) return null;

  const homeMap = mappings.find((m: any) => m.raw_name === event.home_team);
  const awayMap = mappings.find((m: any) => m.raw_name === event.away_team);
  if (!homeMap?.flashscore_team_id || !awayMap?.flashscore_team_id) return null;

  const { data: fixtures } = await supabase.from('be_fixtures')
    .select('flashscore_id, home_team_id, away_team_id, starts_at')
    .eq('home_team_id', homeMap.flashscore_team_id)
    .eq('away_team_id', awayMap.flashscore_team_id)
    .limit(5);

  if (!fixtures || fixtures.length === 0) return null;

  const windowMs = 3 * 60 * 60 * 1000;
  const eventTs = new Date(event.starts_at).getTime();
  const match = fixtures.find((f: any) =>
    Math.abs(new Date(f.starts_at).getTime() - eventTs) < windowMs
  );
  if (!match) return null;

  return {
    flashscore_id: match.flashscore_id,
    stage: 'propagation',
    confidence: 1.0,
  };
}
```

- [ ] **Step 3: Run test, commit**

```bash
pnpm test tests/lib/normalize/events/propagation.test.ts
git add lib/normalize/events/propagation.ts tests/lib/normalize/events/propagation.test.ts
git commit -m "feat(normalize/events): add propagation stage (team_mapping cache)"
```

## Task 2.8: Write llm-core

**Files:**
- Create: `lib/normalize/events/llm-core.ts`

- [ ] **Step 1: Implementation (prompt builder + parser)**

```typescript
// lib/normalize/events/llm-core.ts
// Stage 5 prompt builder + response parser.
// Shared between subagent (Task tool) and future API (claude-haiku) paths.

import type { EventToNormalize, FlashscoreCandidate, MatchResult } from './types';

export interface LLMInput {
  event: EventToNormalize;
  candidates: FlashscoreCandidate[];
}

export interface LLMResponse {
  flashscore_id: string | null;
  confidence: number;
  reason: string;
}

export function buildPrompt(input: LLMInput): string {
  return `You are an expert sports event matcher. Given a source event and candidates from Flashscore, identify which candidate (if any) represents the same real-world match.

## Source event
- Source: ${input.event.source}
- Sport: ${input.event.sport}
- Home: ${input.event.home_team}
- Away: ${input.event.away_team}
- Starts at: ${input.event.starts_at}
- League: ${input.event.league ?? 'unknown'}

## Candidates (Flashscore)
${input.candidates.map((c, i) => `${i+1}. id=${c.flashscore_id} | ${c.home_team} vs ${c.away_team} | ${c.starts_at} | ${c.league ?? 'unknown'}`).join('\n')}

## Instructions
Return ONLY a JSON object, no prose outside the JSON block:

\`\`\`json
{
  "flashscore_id": "<id of matching candidate, or null if no plausible match>",
  "confidence": <float 0.0 to 1.0>,
  "reason": "<one-line rationale>"
}
\`\`\`

- Account for diacritics, translation (e.g., "Germany"↔"Germania"), nicknames, abbreviations.
- Return null flashscore_id if candidates are clearly different (different sport, different teams, >6h time drift).
- Confidence 0.95+ = certain. 0.80-0.94 = probable. < 0.80 = uncertain.`;
}

export function parseResponse(raw: string): LLMResponse | null {
  // Extract JSON block
  const match = raw.match(/```json\s*([\s\S]*?)\s*```/) ?? raw.match(/(\{[\s\S]*\})/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (typeof parsed.confidence !== 'number') return null;
    return {
      flashscore_id: parsed.flashscore_id ?? null,
      confidence: Math.max(0, Math.min(1, parsed.confidence)),
      reason: String(parsed.reason ?? ''),
    };
  } catch {
    return null;
  }
}

export function toMatchResult(resp: LLMResponse | null): MatchResult | null {
  if (!resp || !resp.flashscore_id) return null;
  return {
    flashscore_id: resp.flashscore_id,
    stage: 'llm',
    confidence: resp.confidence,
    llm_reason: resp.reason,
  };
}
```

- [ ] **Step 2: Simple tests**

Create `tests/lib/normalize/events/llm-core.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildPrompt, parseResponse, toMatchResult } from '@/lib/normalize/events/llm-core';

describe('llm-core', () => {
  const event = {
    id: 'e1', source: 'kambi' as const, sport: 'tennis', league: 'ATP',
    home_team: 'Djokovic', away_team: 'Alcaraz',
    starts_at: '2026-04-22T15:00:00Z', flashscore_id: null,
  };

  it('buildPrompt includes source event fields', () => {
    const p = buildPrompt({ event, candidates: [] });
    expect(p).toContain('Djokovic');
    expect(p).toContain('tennis');
    expect(p).toContain('```json');
  });

  it('parseResponse extracts JSON from markdown block', () => {
    const r = parseResponse('```json\n{"flashscore_id":"fs1","confidence":0.97,"reason":"exact"}\n```');
    expect(r?.flashscore_id).toBe('fs1');
    expect(r?.confidence).toBe(0.97);
  });

  it('parseResponse handles bare JSON', () => {
    const r = parseResponse('{"flashscore_id":"fs2","confidence":0.85,"reason":"probable"}');
    expect(r?.flashscore_id).toBe('fs2');
  });

  it('toMatchResult returns null for unmatched response', () => {
    expect(toMatchResult({ flashscore_id: null, confidence: 0.3, reason: 'no match' })).toBeNull();
  });
});
```

- [ ] **Step 3: Run, commit**

```bash
pnpm test tests/lib/normalize/events/llm-core.test.ts
git add lib/normalize/events/llm-core.ts tests/lib/normalize/events/llm-core.test.ts
git commit -m "feat(normalize/events): add llm-core prompt builder + parser"
```

## Task 2.9: Write engine dispatcher

**Files:**
- Create: `lib/normalize/events/engine.ts`
- Create: `tests/lib/normalize/events/engine.test.ts`

- [ ] **Step 1: Test**

```typescript
// tests/lib/normalize/events/engine.test.ts
import { describe, it, expect, vi } from 'vitest';
import { normalizeEvent } from '@/lib/normalize/events/engine';

describe('normalizeEvent', () => {
  it('returns flashscore_native immediately if event has flashscore_id', async () => {
    const r = await normalizeEvent({} as any, {
      id: 'e1', source: 'kambi', sport: 'football', league: null,
      home_team: 'A', away_team: 'B', starts_at: '2026-01-01T00:00:00Z',
      flashscore_id: 'fs-existing',
    });
    expect(r.stage).toBe('flashscore_native');
    expect(r.flashscore_id).toBe('fs-existing');
  });
});
```

- [ ] **Step 2: Implementation**

```typescript
// lib/normalize/events/engine.ts
import type { EventToNormalize, MatchResult, FlashscoreCandidate } from './types';
import { AUTO_APPLY_THRESHOLDS } from './types';
import { matchByRegex } from './regex';
import { matchByTrigram } from './trigram';
import { matchByAliasDict } from './alias-dict';
import { matchByPropagation } from './propagation';

async function fetchCandidates(
  supabase: any, event: EventToNormalize,
): Promise<FlashscoreCandidate[]> {
  const win = 3 * 60 * 60 * 1000;
  const ts = new Date(event.starts_at).getTime();
  const { data } = await supabase.from('be_fixtures')
    .select('flashscore_id, home_team, away_team, starts_at, sport, league')
    .eq('sport', event.sport)
    .gte('starts_at', new Date(ts - win).toISOString())
    .lte('starts_at', new Date(ts + win).toISOString())
    .limit(50);
  return (data ?? []) as FlashscoreCandidate[];
}

export async function normalizeEvent(
  supabase: any, event: EventToNormalize,
): Promise<MatchResult> {
  if (event.flashscore_id) {
    return {
      flashscore_id: event.flashscore_id,
      stage: 'flashscore_native',
      confidence: 1.0,
    };
  }

  const candidates = await fetchCandidates(supabase, event);

  // Stage 2: regex
  const r2 = await matchByRegex(event, candidates);
  if (r2 && r2.confidence >= AUTO_APPLY_THRESHOLDS.regex) {
    await persistMatch(supabase, event, r2);
    return r2;
  }

  // Stage 3a: trigram
  const r3a = await matchByTrigram(supabase, event);
  if (r3a && r3a.confidence >= AUTO_APPLY_THRESHOLDS.trigram) {
    await persistMatch(supabase, event, r3a);
    return r3a;
  }

  // Stage 3b: alias-dict
  const r3b = await matchByAliasDict(supabase, event);
  if (r3b && r3b.confidence >= AUTO_APPLY_THRESHOLDS.alias_dict) {
    await persistMatch(supabase, event, r3b);
    return r3b;
  }

  // Stage 4: propagation
  const r4 = await matchByPropagation(supabase, event);
  if (r4 && r4.confidence >= AUTO_APPLY_THRESHOLDS.propagation) {
    await persistMatch(supabase, event, r4);
    return r4;
  }

  // Best partial result for pending review (if any above 0.5)
  const partials = [r2, r3a, r3b, r4].filter((r): r is MatchResult => !!r && r.confidence >= 0.5);
  if (partials.length) {
    const best = partials.sort((a, b) => b.confidence - a.confidence)[0];
    await persistMatch(supabase, event, { ...best, stage: best.stage });
    return best;
  }

  // Stage 5 (LLM) not auto-triggered; remain unmapped.
  return { flashscore_id: null, stage: 'unmapped', confidence: 0 };
}

async function persistMatch(supabase: any, event: EventToNormalize, r: MatchResult) {
  if (!r.flashscore_id) return;
  await supabase.from('event_normalization').upsert(
    {
      event_id: event.id,
      flashscore_id: r.flashscore_id,
      match_stage: r.stage,
      confidence: r.confidence,
      llm_reason: r.llm_reason ?? null,
      created_at: new Date().toISOString(),
    },
    { onConflict: 'event_id' },
  );
  // Propagate to events.flashscore_id for backward compat
  await supabase.from('events')
    .update({ flashscore_id: r.flashscore_id })
    .eq('id', event.id);
}
```

- [ ] **Step 3: Run, commit**

```bash
pnpm test tests/lib/normalize/events/engine.test.ts
git add lib/normalize/events/engine.ts tests/lib/normalize/events/engine.test.ts
git commit -m "feat(normalize/events): add 5-stage engine dispatcher"
```

## Task 2.10: Write list/verify/reject API route

**Files:**
- Create: `app/api/admin/event-normalization/route.ts`

- [ ] **Step 1: Implementation**

```typescript
// app/api/admin/event-normalization/route.ts
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = url.searchParams.get('sport');
  const stage = url.searchParams.get('stage');
  const verified = url.searchParams.get('verified');
  const limit = parseInt(url.searchParams.get('limit') ?? '100', 10);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

  const sb = createAdminClient();
  let q = sb.from('event_normalization')
    .select('id, event_id, flashscore_id, match_stage, confidence, llm_reason, verified, verified_at, created_at, events!inner(sport_id, home_team, away_team, starts_at, source, sports!inner(name))')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (stage) q = q.eq('match_stage', stage);
  if (verified === 'true') q = q.eq('verified', true);
  if (verified === 'false') q = q.eq('verified', false);
  if (sport) q = q.eq('events.sports.name', sport);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}

export async function POST(request: Request) {
  const body = await request.json();
  const sb = createAdminClient();

  switch (body.action) {
    case 'verify': {
      const { data, error } = await sb.from('event_normalization')
        .update({ verified: true, verified_at: new Date().toISOString() })
        .eq('id', body.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      // Propagate to team_mapping cache
      const { data: row } = await sb.from('event_normalization')
        .select('event_id, flashscore_id, events!inner(home_team, away_team, sport_id, source, sports!inner(name))')
        .eq('id', body.id).single();
      if (row) {
        const sport = (row as any).events.sports.name;
        const source = (row as any).events.source;
        await sb.from('team_mapping').upsert([
          { sport, source, raw_name: (row as any).events.home_team,
            flashscore_team_id: null, verified: true, verified_at: new Date().toISOString() },
          { sport, source, raw_name: (row as any).events.away_team,
            flashscore_team_id: null, verified: true, verified_at: new Date().toISOString() },
        ], { onConflict: 'sport,source,raw_name' });
      }
      return NextResponse.json({ success: true });
    }
    case 'manual-assign': {
      const { error } = await sb.from('event_normalization').upsert({
        event_id: body.event_id,
        flashscore_id: body.flashscore_id,
        match_stage: 'manual',
        confidence: 1.0,
        verified: true,
        verified_at: new Date().toISOString(),
      }, { onConflict: 'event_id' });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await sb.from('events').update({ flashscore_id: body.flashscore_id }).eq('id', body.event_id);
      return NextResponse.json({ success: true });
    }
    case 'reject': {
      const { error } = await sb.from('event_normalization').delete().eq('event_id', body.event_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }
    default:
      return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/admin/event-normalization/route.ts
git commit -m "feat(api): add event-normalization list/verify/manual-assign/reject"
```

## Task 2.11: Write subagent endpoint

**Files:**
- Create: `app/api/admin/event-normalization/run-subagent/route.ts`

- [ ] **Step 1: Implementation**

```typescript
// app/api/admin/event-normalization/run-subagent/route.ts
// Endpoint that returns a prepared prompt + candidates payload for
// a human operator to paste into Claude Code / Task subagent.
//
// The subagent responds with JSON per batch entry; operator submits
// back to POST /api/admin/event-normalization with action=manual-assign
// (or a future batch action).

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { buildPrompt } from '@/lib/normalize/events/llm-core';

export async function POST(request: Request) {
  const { batch_size = 20, sport = null } = await request.json().catch(() => ({}));
  const sb = createAdminClient();

  // Find unmapped events (events with no event_normalization row)
  let q = sb.from('events')
    .select('id, home_team, away_team, starts_at, source, sport_id, sports!inner(name)')
    .is('flashscore_id', null)
    .eq('status', 'prematch')
    .order('starts_at', { ascending: true })
    .limit(batch_size);
  if (sport) q = q.eq('sports.name', sport);

  const { data: events, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!events || events.length === 0) {
    return NextResponse.json({ prompts: [], message: 'no unmapped events' });
  }

  const prompts = await Promise.all(events.map(async (e: any) => {
    const ts = new Date(e.starts_at).getTime();
    const { data: cands } = await sb.from('be_fixtures')
      .select('flashscore_id, home_team, away_team, starts_at, sport, league')
      .eq('sport', e.sports.name)
      .gte('starts_at', new Date(ts - 3 * 60 * 60 * 1000).toISOString())
      .lte('starts_at', new Date(ts + 3 * 60 * 60 * 1000).toISOString())
      .limit(5);

    return {
      event_id: e.id,
      prompt: buildPrompt({
        event: {
          id: e.id, source: e.source, sport: e.sports.name, league: null,
          home_team: e.home_team, away_team: e.away_team,
          starts_at: e.starts_at, flashscore_id: null,
        },
        candidates: (cands ?? []) as any,
      }),
    };
  }));

  return NextResponse.json({
    count: prompts.length,
    prompts,
    instructions: 'Send each prompt to a Claude Code Task. Collect JSON responses. POST to /api/admin/event-normalization with action=manual-assign per matched event.',
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/admin/event-normalization/run-subagent/route.ts
git commit -m "feat(api): add run-subagent endpoint for stage 5 event normalization"
```

## Task 2.12: Write backfill endpoint

**Files:**
- Create: `app/api/admin/event-normalization/backfill/route.ts`

- [ ] **Step 1: Implementation**

```typescript
// app/api/admin/event-normalization/backfill/route.ts
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { normalizeEvent } from '@/lib/normalize/events/engine';

export async function POST(request: Request) {
  const { batch_size = 500 } = await request.json().catch(() => ({}));
  const sb = createAdminClient();

  const { data: events, error } = await sb.from('events')
    .select('id, home_team, away_team, starts_at, source, flashscore_id, sport_id, sports!inner(name), leagues(name)')
    .is('flashscore_id', null)
    .eq('status', 'prematch')
    .order('starts_at', { ascending: true })
    .limit(batch_size);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!events || events.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  const stats = { stage_1: 0, stage_2: 0, stage_3: 0, stage_4: 0, unmapped: 0 };

  for (const e of events) {
    const r = await normalizeEvent(sb, {
      id: e.id, source: e.source as any,
      sport: (e as any).sports.name,
      league: (e as any).leagues?.name ?? null,
      home_team: e.home_team,
      away_team: e.away_team,
      starts_at: e.starts_at,
      flashscore_id: null,
    });
    const key = r.stage === 'regex' ? 'stage_2'
      : ['trigram', 'alias_dict'].includes(r.stage) ? 'stage_3'
      : r.stage === 'propagation' ? 'stage_4'
      : r.stage === 'unmapped' ? 'unmapped'
      : 'stage_1';
    stats[key as keyof typeof stats]++;
  }

  return NextResponse.json({ processed: events.length, stats });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/admin/event-normalization/backfill/route.ts
git commit -m "feat(api): add backfill endpoint for event normalization"
```

## Task 2.13: Write cron endpoint

**Files:**
- Create: `app/api/cron/event-normalization/route.ts`

- [ ] **Step 1: Implementation**

```typescript
// app/api/cron/event-normalization/route.ts
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { normalizeEvent } from '@/lib/normalize/events/engine';

export async function POST(request: Request) {
  const key = request.headers.get('x-scraper-key');
  if (key !== process.env.SCRAPER_API_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = createAdminClient();
  const BATCH = 100;

  const { data: events } = await sb.from('events')
    .select('id, home_team, away_team, starts_at, source, flashscore_id, sport_id, sports!inner(name), leagues(name)')
    .is('flashscore_id', null)
    .eq('status', 'prematch')
    .order('starts_at', { ascending: true })
    .limit(BATCH);

  if (!events || events.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  let matched = 0;
  for (const e of events) {
    const r = await normalizeEvent(sb, {
      id: e.id, source: e.source as any,
      sport: (e as any).sports.name,
      league: (e as any).leagues?.name ?? null,
      home_team: e.home_team, away_team: e.away_team,
      starts_at: e.starts_at, flashscore_id: null,
    });
    if (r.stage !== 'unmapped') matched++;
  }

  return NextResponse.json({ processed: events.length, matched });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/cron/event-normalization/route.ts
git commit -m "feat(api): add cron endpoint for event normalization drainage"
```

## Task 2.14: Write /admin/event-normalization UI

**Files:**
- Create: `app/admin/event-normalization/page.tsx`
- Modify: `app/admin/layout.tsx` (add sidebar entry)

- [ ] **Step 1: Read existing market-normalization page for pattern reference**

```bash
cat app/admin/market-normalization/page.tsx | head -80
```

- [ ] **Step 2: Create page file with 5 tabs**

```typescript
// app/admin/event-normalization/page.tsx
'use client';

import { useEffect, useState } from 'react';

type Tab = 'unmapped' | 'llm_pending' | 'low_confidence' | 'verified' | 'stats';

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: '8px 16px',
  borderBottom: active ? '2px solid #8b5cf6' : '2px solid transparent',
  cursor: 'pointer',
  fontWeight: active ? 600 : 400,
});

export default function EventNormalizationPage() {
  const [tab, setTab] = useState<Tab>('unmapped');
  const [rows, setRows] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});

  useEffect(() => {
    const loadData = async () => {
      if (tab === 'stats') {
        const res = await fetch('/api/admin/event-normalization/stats').catch(() => null);
        if (res?.ok) setStats(await res.json());
      } else {
        const params = new URLSearchParams();
        if (tab === 'unmapped') { /* fetch events without event_normalization row */ }
        if (tab === 'llm_pending') { params.set('stage', 'llm'); params.set('verified', 'false'); }
        if (tab === 'low_confidence') { /* handled client-side */ }
        if (tab === 'verified') { params.set('verified', 'true'); }
        const res = await fetch(`/api/admin/event-normalization?${params}`);
        const data = await res.json();
        setRows(data.rows ?? []);
      }
    };
    loadData();
  }, [tab]);

  const verify = async (id: number) => {
    await fetch('/api/admin/event-normalization', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify', id }),
    });
    setRows(rows.filter(r => r.id !== id));
  };

  const runSubagent = async () => {
    const res = await fetch('/api/admin/event-normalization/run-subagent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch_size: 20 }),
    });
    const data = await res.json();
    // Display the prompts for operator to paste into Claude Code
    alert(`Prepared ${data.count} prompts. Check console for full payload.`);
    console.log(data);
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>Event Normalization</h1>
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #333', marginBottom: 16 }}>
        {(['unmapped', 'llm_pending', 'low_confidence', 'verified', 'stats'] as Tab[]).map(t => (
          <div key={t} style={tabStyle(tab === t)} onClick={() => setTab(t)}>
            {t.replace('_', ' ')}
          </div>
        ))}
      </div>
      {tab === 'unmapped' && (
        <div>
          <button onClick={runSubagent}>Run LLM subagent batch (20)</button>
          <table style={{ marginTop: 16, width: '100%' }}>
            <thead>
              <tr>
                <th>Event</th><th>Starts</th><th>Source</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td>{r.events?.home_team} vs {r.events?.away_team}</td>
                  <td>{r.events?.starts_at}</td>
                  <td>{r.events?.source}</td>
                  <td>
                    <button onClick={() => {
                      const fsid = prompt('Flashscore ID?');
                      if (fsid) fetch('/api/admin/event-normalization', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'manual-assign', event_id: r.events.id, flashscore_id: fsid }),
                      });
                    }}>Manual assign</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tab === 'llm_pending' && (
        <table style={{ width: '100%' }}>
          <thead><tr><th>Event</th><th>Proposed</th><th>Conf</th><th>Reason</th><th>Action</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td>{r.events?.home_team} vs {r.events?.away_team}</td>
                <td>{r.flashscore_id}</td>
                <td>{(r.confidence * 100).toFixed(0)}%</td>
                <td>{r.llm_reason}</td>
                <td>
                  <button onClick={() => verify(r.id)}>✅ Verify</button>
                  <button onClick={() => fetch('/api/admin/event-normalization', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'reject', event_id: r.event_id }),
                  }).then(() => setRows(rows.filter(x => x.id !== r.id)))}>❌ Reject</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tab === 'stats' && <pre>{JSON.stringify(stats, null, 2)}</pre>}
    </div>
  );
}
```

- [ ] **Step 3: Add sidebar entry in admin layout**

Read `app/admin/layout.tsx` and add link to `/admin/event-normalization` near `/admin/market-normalization` entry (pattern match how market-normalization is listed).

- [ ] **Step 4: Commit**

```bash
git add app/admin/event-normalization/page.tsx app/admin/layout.tsx
git commit -m "feat(admin): add event-normalization UI with 5 tabs"
```

## Task 2.15: Apply 087 to staging DB + backfill

**Files:**
- Apply: `supabase/migrations/087_event_normalization.sql`
- Apply: `supabase/migrations/087b_team_aliases_tag_sport.sql`

- [ ] **Step 1: Apply to staging DB**

```bash
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres \
  -f supabase/migrations/087_event_normalization.sql
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres \
  -f supabase/migrations/087b_team_aliases_tag_sport.sql
```

- [ ] **Step 2: Push code to master (triggers CI/CD staging deploy if configured)**

```bash
git push origin master
```

- [ ] **Step 3: Run backfill on staging**

```bash
STAGING_KEY=$(ssh staging-vps 'grep SCRAPER_API_KEY /root/betssolution-admin/.env.local | cut -d= -f2')
curl -X POST -H "x-scraper-key: $STAGING_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 500}' \
  https://admin-staging.betssolution.com/api/admin/event-normalization/backfill
```

Repeat until `processed: 0`.

- [ ] **Step 4: Verify stats on staging**

```bash
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres \
  -c "SELECT match_stage, count(*), avg(confidence) FROM event_normalization GROUP BY match_stage;"
```

Expected: rows distributed across stages. stage_2 (regex) should be largest bucket for football; stage_3 (trigram/alias) for other sports.

## Task 2.16: Apply 087 to prod + setup cron

- [ ] **Step 1: Apply 087 to prod DB**

```bash
PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co \
  -U postgres -d postgres -f supabase/migrations/087_event_normalization.sql
PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co \
  -U postgres -d postgres -f supabase/migrations/087b_team_aliases_tag_sport.sql
```

- [ ] **Step 2: Run backfill on prod**

```bash
PROD_KEY=$(ssh scraper-vps 'grep SCRAPER_API_KEY /root/betssolution-admin/.env.local | cut -d= -f2')
for i in 1 2 3 4 5 6 7 8 9 10; do
  RESP=$(curl -sX POST -H "x-scraper-key: $PROD_KEY" \
    -H "Content-Type: application/json" \
    -d '{"batch_size": 500}' \
    http://localhost:3000/api/admin/event-normalization/backfill)
  echo "$RESP"
  PROCESSED=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('processed',0))")
  [ "$PROCESSED" -eq 0 ] && break
done
```

(Run via SSH port forward.)

- [ ] **Step 3: Setup cron on scraper-vps**

```bash
ssh scraper-vps 'crontab -l > /tmp/crontab.bak && (crontab -l; echo "*/15 * * * * curl -sX POST -H \"x-scraper-key: $(grep SCRAPER_API_KEY /root/betssolution-admin/.env.local | cut -d= -f2)\" http://localhost:3000/api/cron/event-normalization > /dev/null 2>&1") | crontab -'
```

- [ ] **Step 4: Verify first cron cycle**

```bash
sleep 900  # wait 15min
ssh scraper-vps 'journalctl -u cron -n 10 --since "20 minutes ago"'
```

---

## ✅ GATE 2 — Phase 2 complete

Verify:
- [ ] `event_normalization` table populated (> 1000 rows on prod).
- [ ] Coverage on football ≥ 90% (measure: `count(*) where stage != 'unmapped' / total events`).
- [ ] Cron running every 15min on scraper-vps.
- [ ] Tests passing in CI.

**Decision gate for Phase 4**: Measure event-normalization coverage after 1 week. If ≥ 95% for all sports with meaningful volume → proceed to Phase 4. Otherwise, iterate 087 (subagent runs, alias additions) before 089.

---

# Phase 3: Migration 088 — Manual Override Core

**Target**: Operator can suspend/override/dismiss outcomes from `/admin/consensus`. Scraper upserts cannot overwrite manual_*. ~1.5 days of work.

## Phase 3 File Structure

### New files

| Path | Purpose |
|---|---|
| `supabase/migrations/088_manual_override.sql` | ALTER outcomes + trigger + audit + normalization_issues |
| `supabase/migrations/088b_scraper_rpc_manual_safe.sql` | CREATE OR REPLACE upsert_prematch_batch / upsert_live_batch with manual_* protection |
| `supabase/migrations/088c_admin_override_rpcs.sql` | admin_suspend_outcome, admin_override_odds, admin_restore_outcome, admin_dismiss_consensus, admin_cleanup_expired_overrides |
| `app/api/admin/outcomes/[id]/suspend/route.ts` | POST suspend |
| `app/api/admin/outcomes/[id]/override/route.ts` | POST override |
| `app/api/admin/outcomes/[id]/restore/route.ts` | POST restore |
| `app/api/admin/consensus/[id]/dismiss/route.ts` | POST dismiss |
| `app/api/cron/manual-override-cleanup/route.ts` | POST cron cleanup |
| `app/admin/manual-overrides/page.tsx` | Dedicated page with 4 tabs |
| `components/admin/SuspendModal.tsx` | Modal component |
| `components/admin/OverrideModal.tsx` | Modal component |
| `components/admin/DismissModal.tsx` | Modal component |
| `tests/lib/supabase/manual-override-rpc.test.ts` | RPC integration tests (fake Supabase) |

### Modified files

| Path | What changes |
|---|---|
| `app/admin/consensus/page.tsx` | Add 🔴 Sospendi, ⚙️ Override, ✅ Dismiss buttons per row + state for active modal |

---

## Task 3.1: Write migration 088 (schema + trigger + audit + issues queue)

**Files:**
- Create: `supabase/migrations/088_manual_override.sql`

- [ ] **Step 1: Create migration file**

```sql
-- ═══════════════════════════════════════════════════
-- Migration 088: Manual Override Core
--
-- ALTER outcomes: manual_* columns (suspended, odds, reason, expires, set_by/at)
-- Trigger protect_manual_fields: prevents scraper upserts from overwriting manual_*
-- outcome_manual_actions: audit trail
-- normalization_issues: feedback queue from dismiss "mismatch_norm"
-- ═══════════════════════════════════════════════════

-- -----------------------------------------------------
-- 088.1 — ALTER outcomes
-- -----------------------------------------------------

ALTER TABLE outcomes
  ADD COLUMN IF NOT EXISTS manual_suspended  boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS manual_odds       numeric,
  ADD COLUMN IF NOT EXISTS manual_reason     text,
  ADD COLUMN IF NOT EXISTS manual_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_set_by     uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS manual_set_at     timestamptz;

CREATE INDEX IF NOT EXISTS idx_outcomes_manual_active ON outcomes(manual_expires_at)
  WHERE manual_suspended = true OR manual_odds IS NOT NULL;

COMMENT ON COLUMN outcomes.manual_suspended IS
  'Operator suspended this outcome. NOT touched by scraper upserts. Enforced by trigger protect_manual_fields + whitelist SET in upsert_prematch_batch/upsert_live_batch. Reset by cron admin_cleanup_expired_overrides when manual_expires_at < now(). See migration 088.';

-- -----------------------------------------------------
-- 088.2 — Trigger protect_manual_fields
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION preserve_manual_fields() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
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

DROP TRIGGER IF EXISTS protect_manual_fields ON outcomes;
CREATE TRIGGER protect_manual_fields
BEFORE UPDATE ON outcomes
FOR EACH ROW
EXECUTE FUNCTION preserve_manual_fields();

COMMENT ON TRIGGER protect_manual_fields ON outcomes IS
  'Prevents any UPDATE from overwriting manual_* fields unless session sets app.admin_manual_override = on. Only admin RPCs set this.';

-- -----------------------------------------------------
-- 088.3 — outcome_manual_actions (audit)
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS outcome_manual_actions (
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

CREATE INDEX IF NOT EXISTS idx_outcome_actions_outcome ON outcome_manual_actions(outcome_id);
CREATE INDEX IF NOT EXISTS idx_outcome_actions_created ON outcome_manual_actions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outcome_actions_dismiss ON outcome_manual_actions(dismiss_category)
  WHERE dismiss_category IS NOT NULL;

-- -----------------------------------------------------
-- 088.4 — normalization_issues (feedback queue)
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS normalization_issues (
  id bigserial PRIMARY KEY,
  source_table text NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_norm_issues_unresolved ON normalization_issues(resolved)
  WHERE NOT resolved;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/088_manual_override.sql
git commit -m "chore(db): add migration 088 manual override schema + trigger"
```

## Task 3.2: Test trigger against staging synthetic UPDATEs

**Files:**
- Apply: `supabase/migrations/088_manual_override.sql` (staging)

- [ ] **Step 1: Apply to staging**

```bash
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres \
  -f supabase/migrations/088_manual_override.sql
```

- [ ] **Step 2: Pick a test outcome_id**

```bash
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres \
  -c "SELECT id FROM outcomes WHERE is_active LIMIT 1;"
# Note the uuid, call it TEST_OUTCOME
```

- [ ] **Step 3: Test negative path (trigger blocks)**

```bash
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres <<SQL
UPDATE outcomes SET manual_suspended = true WHERE id = 'TEST_OUTCOME';
SELECT manual_suspended FROM outcomes WHERE id = 'TEST_OUTCOME';
SQL
```

Expected: `manual_suspended = false` (trigger reverted the UPDATE).

- [ ] **Step 4: Test positive path (session var allows)**

```bash
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres <<SQL
BEGIN;
SET LOCAL app.admin_manual_override = 'on';
UPDATE outcomes SET manual_suspended = true WHERE id = 'TEST_OUTCOME';
SELECT manual_suspended FROM outcomes WHERE id = 'TEST_OUTCOME';
COMMIT;
SQL
```

Expected: `manual_suspended = true`.

- [ ] **Step 5: Cleanup test row**

```bash
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres <<SQL
BEGIN;
SET LOCAL app.admin_manual_override = 'on';
UPDATE outcomes SET manual_suspended = false WHERE id = 'TEST_OUTCOME';
COMMIT;
SQL
```

## Task 3.3: Write migration 088b (scraper RPC whitelist)

**Files:**
- Create: `supabase/migrations/088b_scraper_rpc_manual_safe.sql`

- [ ] **Step 1: Read current RPCs**

```bash
grep -A 5 "ON CONFLICT (market_id, name)" supabase/migrations/014_scraper_batch_rpc.sql
```

- [ ] **Step 2: Create migration that CREATE OR REPLACE the RPCs**

Copy the entire `upsert_prematch_batch` function definition from mig 014 into 088b. Modify the ON CONFLICT clause on outcomes to explicitly NOT touch manual_*. The rest of the body unchanged.

Create `supabase/migrations/088b_scraper_rpc_manual_safe.sql`:

```sql
-- ═══════════════════════════════════════════════════
-- Migration 088b: Scraper RPC whitelist for manual_* protection
--
-- Copy upsert_prematch_batch + upsert_live_batch from mig 014,
-- with explicit SET list on outcomes ON CONFLICT that does NOT
-- include manual_* fields.
--
-- Belt-and-suspenders with trigger protect_manual_fields (088.2).
-- ═══════════════════════════════════════════════════

-- NOTE: This migration replaces the RPC bodies wholesale. See mig 014
-- for the full original. Below is ONLY the critical ON CONFLICT DO UPDATE
-- change for outcomes. The rest of the function body must be copied from 014.

-- ⚠️ EXECUTION NOTE FOR HUMAN OPERATOR:
-- Open supabase/migrations/014_scraper_batch_rpc.sql, copy the entire
-- CREATE FUNCTION upsert_prematch_batch(...) definition, paste below,
-- then change ONLY the ON CONFLICT DO UPDATE on outcomes to:
--
--   ON CONFLICT (market_id, name) DO UPDATE SET
--     odds = EXCLUDED.odds,
--     is_active = TRUE,
--     is_suspended = FALSE;
--     -- manual_* NOT updated. Protected by trigger protect_manual_fields (mig 088).
--
-- Do the same for upsert_live_batch (which also upserts outcomes).

-- PLACEHOLDER: see instruction above. Below is the expected structure.
-- [Copy full body from mig 014 here, with single change to outcomes ON CONFLICT]
```

- [ ] **Step 3: Execute the copy-and-modify**

Run:

```bash
cat supabase/migrations/014_scraper_batch_rpc.sql
```

Identify the two `CREATE OR REPLACE FUNCTION` blocks for `upsert_prematch_batch` and `upsert_live_batch`. Copy them into `088b_scraper_rpc_manual_safe.sql`, replacing the ON CONFLICT outcomes clause. Keep the rest of each function body byte-identical.

- [ ] **Step 4: Verify the diff is ONLY on outcomes ON CONFLICT**

```bash
diff <(sed -n '/CREATE OR REPLACE FUNCTION upsert_prematch_batch/,/^$/p' supabase/migrations/014_scraper_batch_rpc.sql) \
     <(sed -n '/CREATE OR REPLACE FUNCTION upsert_prematch_batch/,/^$/p' supabase/migrations/088b_scraper_rpc_manual_safe.sql)
```

Expected: diff shows ONLY the outcomes ON CONFLICT changes, nothing else.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/088b_scraper_rpc_manual_safe.sql
git commit -m "chore(db): add migration 088b scraper RPC whitelist for manual_*"
```

## Task 3.4: Apply 088 + 088b to staging + verify manual_* persistence

- [ ] **Step 1: Apply 088b to staging**

```bash
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres \
  -f supabase/migrations/088b_scraper_rpc_manual_safe.sql
```

- [ ] **Step 2: Set test outcome to manual_suspended=true via session var**

```bash
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres <<SQL
BEGIN;
SET LOCAL app.admin_manual_override = 'on';
UPDATE outcomes SET
  manual_suspended = true,
  manual_reason = 'test persistence',
  manual_expires_at = now() + interval '1 hour',
  manual_set_by = (SELECT id FROM auth.users LIMIT 1),
  manual_set_at = now()
WHERE id = 'TEST_OUTCOME';
COMMIT;
SQL
```

- [ ] **Step 3: Force scraper cycle on staging**

```bash
ssh staging-vps 'sudo systemctl restart twobet-scraper-staging'
sleep 30  # let one cycle complete
```

- [ ] **Step 4: Verify manual_suspended still true**

```bash
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres \
  -c "SELECT manual_suspended, manual_reason FROM outcomes WHERE id = 'TEST_OUTCOME';"
```

Expected: `manual_suspended = true`, `manual_reason = 'test persistence'`.

If false: trigger or RPC modification failed. Debug before proceeding.

## Task 3.5: Write admin RPCs migration (088c)

**Files:**
- Create: `supabase/migrations/088c_admin_override_rpcs.sql`

- [ ] **Step 1: Create file**

```sql
-- ═══════════════════════════════════════════════════
-- Migration 088c: Admin override RPCs
-- ═══════════════════════════════════════════════════

-- -----------------------------------------------------
-- admin_suspend_outcome
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION admin_suspend_outcome(
  p_outcome_id uuid,
  p_reason text,
  p_duration_min int,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_old jsonb; v_expires timestamptz;
BEGIN
  SET LOCAL app.admin_manual_override = 'on';

  SELECT to_jsonb(o) INTO v_old FROM outcomes o WHERE id = p_outcome_id;
  IF v_old IS NULL THEN RAISE EXCEPTION 'Outcome % not found', p_outcome_id; END IF;

  v_expires := CASE WHEN p_duration_min IS NULL THEN NULL
                    ELSE now() + (p_duration_min || ' minutes')::interval END;

  UPDATE outcomes SET
    manual_suspended = true,
    manual_reason = p_reason,
    manual_expires_at = v_expires,
    manual_set_by = p_user_id,
    manual_set_at = now()
  WHERE id = p_outcome_id;

  INSERT INTO outcome_manual_actions (
    outcome_id, action_type, old_value, new_value, reason, source, created_by
  ) VALUES (
    p_outcome_id, 'suspend', v_old,
    jsonb_build_object('manual_suspended', true,
                       'manual_expires_at', v_expires,
                       'manual_reason', p_reason),
    p_reason, 'manual', p_user_id
  );

  RETURN jsonb_build_object('success', true, 'expires_at', v_expires);
END $$;

-- -----------------------------------------------------
-- admin_override_odds
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION admin_override_odds(
  p_outcome_id uuid,
  p_new_odds numeric,
  p_reason text,
  p_duration_min int,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_old jsonb; v_expires timestamptz;
BEGIN
  IF p_new_odds < 1.01 THEN
    RAISE EXCEPTION 'new_odds must be >= 1.01 (legal requirement)';
  END IF;
  SET LOCAL app.admin_manual_override = 'on';

  SELECT to_jsonb(o) INTO v_old FROM outcomes o WHERE id = p_outcome_id;
  IF v_old IS NULL THEN RAISE EXCEPTION 'Outcome % not found', p_outcome_id; END IF;

  v_expires := CASE WHEN p_duration_min IS NULL THEN NULL
                    ELSE now() + (p_duration_min || ' minutes')::interval END;

  UPDATE outcomes SET
    manual_odds = p_new_odds,
    manual_reason = p_reason,
    manual_expires_at = v_expires,
    manual_set_by = p_user_id,
    manual_set_at = now()
  WHERE id = p_outcome_id;

  INSERT INTO outcome_manual_actions (
    outcome_id, action_type, old_value, new_value, reason, source, created_by
  ) VALUES (
    p_outcome_id, 'override', v_old,
    jsonb_build_object('manual_odds', p_new_odds,
                       'manual_expires_at', v_expires,
                       'manual_reason', p_reason),
    p_reason, 'manual', p_user_id
  );

  RETURN jsonb_build_object('success', true, 'expires_at', v_expires);
END $$;

-- -----------------------------------------------------
-- admin_restore_outcome
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION admin_restore_outcome(
  p_outcome_id uuid,
  p_reason text,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_old jsonb;
BEGIN
  SET LOCAL app.admin_manual_override = 'on';
  SELECT to_jsonb(o) INTO v_old FROM outcomes o WHERE id = p_outcome_id;
  IF v_old IS NULL THEN RAISE EXCEPTION 'Outcome % not found', p_outcome_id; END IF;

  UPDATE outcomes SET
    manual_suspended = false,
    manual_odds = NULL,
    manual_reason = NULL,
    manual_expires_at = NULL,
    manual_set_by = NULL,
    manual_set_at = NULL
  WHERE id = p_outcome_id;

  INSERT INTO outcome_manual_actions (
    outcome_id, action_type, old_value, new_value, reason, source, created_by
  ) VALUES (
    p_outcome_id, 'restore', v_old, '{}'::jsonb, p_reason, 'manual', p_user_id
  );

  RETURN jsonb_build_object('success', true);
END $$;

-- -----------------------------------------------------
-- admin_dismiss_consensus
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION admin_dismiss_consensus(
  p_consensus_id bigint,
  p_category text,
  p_note text,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_row record;
BEGIN
  IF p_category NOT IN ('bug_kambi','bug_22bet','mismatch_norm','value_genuine','other') THEN
    RAISE EXCEPTION 'Invalid dismiss_category: %', p_category;
  END IF;

  SELECT * INTO v_row FROM consensus_snapshots WHERE id = p_consensus_id;
  IF v_row IS NULL THEN RAISE EXCEPTION 'Consensus row % not found', p_consensus_id; END IF;

  INSERT INTO outcome_manual_actions (
    outcome_id, action_type, reason, dismiss_category, source, consensus_id, created_by
  ) VALUES (
    NULL, 'dismiss', p_note, p_category, 'manual', p_consensus_id, p_user_id
  );

  -- Mark consensus row as reviewed
  UPDATE consensus_snapshots
  SET reviewed = true, reviewed_at = now(), reviewed_by = p_user_id, notes = p_note
  WHERE id = p_consensus_id;

  -- Feedback loop to normalization queue
  IF p_category = 'mismatch_norm' THEN
    INSERT INTO normalization_issues (
      source_table, source_id, issue_type, kambi_key, twobet_key, reported_by
    ) VALUES (
      'consensus_snapshots', p_consensus_id, 'market_mismatch',
      v_row.market_type, v_row.twobet_market_type_raw, p_user_id
    );
  END IF;

  RETURN jsonb_build_object('success', true);
END $$;

-- -----------------------------------------------------
-- admin_cleanup_expired_overrides
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION admin_cleanup_expired_overrides()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_count int;
BEGIN
  SET LOCAL app.admin_manual_override = 'on';

  INSERT INTO outcome_manual_actions (
    outcome_id, action_type, old_value, source, reason
  )
  SELECT id, 'expiry',
         jsonb_build_object('manual_suspended', manual_suspended,
                            'manual_odds', manual_odds,
                            'manual_reason', manual_reason,
                            'manual_expires_at', manual_expires_at),
         'cron_expiry',
         'Auto-expiry: ' || COALESCE(manual_reason, '(no reason)')
  FROM outcomes
  WHERE manual_expires_at IS NOT NULL AND manual_expires_at < now();

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

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/088c_admin_override_rpcs.sql
git commit -m "chore(db): add migration 088c admin override RPCs"
```

## Task 3.6: Apply 088c to staging + smoke test

- [ ] **Step 1: Apply**

```bash
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres \
  -f supabase/migrations/088c_admin_override_rpcs.sql
```

- [ ] **Step 2: Invoke admin_suspend_outcome**

```bash
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres \
  -c "SELECT admin_suspend_outcome('TEST_OUTCOME'::uuid, 'staging smoke test', 30, NULL);"
```

Expected: `{"success": true, "expires_at": "..."}`.

- [ ] **Step 3: Verify DB state**

```bash
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres \
  -c "SELECT manual_suspended, manual_reason, manual_expires_at FROM outcomes WHERE id = 'TEST_OUTCOME';"
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres \
  -c "SELECT * FROM outcome_manual_actions WHERE outcome_id = 'TEST_OUTCOME' ORDER BY created_at DESC LIMIT 1;"
```

- [ ] **Step 4: Restore (cleanup test)**

```bash
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres \
  -c "SELECT admin_restore_outcome('TEST_OUTCOME'::uuid, 'cleanup', NULL);"
```

## Task 3.7: Write API routes for suspend/override/restore/dismiss/cleanup

**Files:**
- Create: 5 route files under `app/api/admin/` and `app/api/cron/`

- [ ] **Step 1: suspend route**

Create `app/api/admin/outcomes/[id]/suspend/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST(request: Request, ctx: { params: { id: string } }) {
  const { reason, duration_min } = await request.json();
  const sb = createAdminClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await sb.rpc('admin_suspend_outcome', {
    p_outcome_id: ctx.params.id,
    p_reason: reason,
    p_duration_min: duration_min,
    p_user_id: user.id,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
```

- [ ] **Step 2: override, restore, dismiss, cleanup**

Follow the same pattern. dismiss takes `consensus_id` param from `ctx.params.id` (route path is `/api/admin/consensus/[id]/dismiss`). cleanup is `x-scraper-key` protected, no auth user.

Create each: `app/api/admin/outcomes/[id]/override/route.ts`, `app/api/admin/outcomes/[id]/restore/route.ts`, `app/api/admin/consensus/[id]/dismiss/route.ts`, `app/api/cron/manual-override-cleanup/route.ts`.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/outcomes app/api/admin/consensus app/api/cron/manual-override-cleanup
git commit -m "feat(api): add manual override endpoints (suspend, override, restore, dismiss, cleanup)"
```

## Task 3.8: Write modal components

**Files:**
- Create: 3 modal components

- [ ] **Step 1: SuspendModal**

Create `components/admin/SuspendModal.tsx`:

```typescript
'use client';
import { useState } from 'react';

interface Props {
  outcomeId: string;
  onClose: () => void;
  onSuccess: () => void;
}

const DURATIONS = [
  { label: '30 min', value: 30 },
  { label: '1 ora', value: 60 },
  { label: '3 ore', value: 180 },
  { label: 'Fine evento', value: 'until_event_end' as const },
  { label: 'Permanente', value: null },
];

export function SuspendModal({ outcomeId, onClose, onSuccess }: Props) {
  const [reason, setReason] = useState('');
  const [durationMin, setDurationMin] = useState<number | null>(30);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    const res = await fetch(`/api/admin/outcomes/${outcomeId}/suspend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, duration_min: durationMin }),
    });
    setSubmitting(false);
    if (res.ok) onSuccess();
    else alert('Errore: ' + (await res.text()));
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100 }}>
      <div style={{ position: 'absolute', top: '30%', left: '50%', transform: 'translateX(-50%)',
                    background: '#1a1a1a', padding: 24, borderRadius: 8, minWidth: 400 }}>
        <h3>Sospendi outcome</h3>
        <label>Motivo:</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)}
                  style={{ width: '100%', height: 60 }} />
        <label>Durata:</label>
        <select value={String(durationMin)}
                onChange={e => setDurationMin(e.target.value === 'null' ? null : Number(e.target.value))}
                style={{ width: '100%' }}>
          {DURATIONS.map(d => (
            <option key={String(d.value)} value={String(d.value)}>{d.label}</option>
          ))}
        </select>
        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose}>Annulla</button>
          <button onClick={submit} disabled={submitting || !reason.trim()}>🔴 Sospendi</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: OverrideModal, DismissModal — similar pattern**

Override asks for `new_odds` (number) with warning if < 1.01. Dismiss has radio for category + text for note.

- [ ] **Step 3: Commit**

```bash
git add components/admin/SuspendModal.tsx components/admin/OverrideModal.tsx components/admin/DismissModal.tsx
git commit -m "feat(admin): add suspend/override/dismiss modals"
```

## Task 3.9: Modify /admin/consensus/page.tsx

**Files:**
- Modify: `app/admin/consensus/page.tsx`

- [ ] **Step 1: Read current file**

```bash
cat app/admin/consensus/page.tsx | head -100
```

- [ ] **Step 2: Add action column + modal state**

In the row render, add a new `<td>` with 3 buttons. Top of component: `const [activeModal, setActiveModal] = useState<{type: 'suspend'|'override'|'dismiss', row: any} | null>(null);`

Render modals conditionally based on `activeModal`.

- [ ] **Step 3: Commit**

```bash
git add app/admin/consensus/page.tsx
git commit -m "feat(consensus): add action buttons + modals on outlier rows"
```

## Task 3.10: Write /admin/manual-overrides page

**Files:**
- Create: `app/admin/manual-overrides/page.tsx`
- Modify: `app/admin/layout.tsx` (sidebar entry)

- [ ] **Step 1: Create page with 4 tabs**

Tabs: Attivi | Scaduti (7d) | Dismiss log | Stats.

For each tab, call respective query on `outcome_manual_actions` or `outcomes`.

- [ ] **Step 2: Commit**

```bash
git add app/admin/manual-overrides/page.tsx app/admin/layout.tsx
git commit -m "feat(admin): add manual-overrides page with 4 tabs"
```

## Task 3.11: Player frontend integration (depends on Task 0.3 output)

**Files:**
- Modify: (path from Task 0.3 investigation)

- [ ] **Step 1: Read investigation note**

```bash
cat docs/superpowers/notes/player-frontend-integration.md
```

- [ ] **Step 2: Modify the outcome consumer per note findings**

Apply changes per the spec section 088.4:
```typescript
const displayOdds = outcome.manual_odds ?? outcome.odds;
const isBettable = !outcome.is_suspended && !outcome.manual_suspended && outcome.is_active;
```

- [ ] **Step 3: Verify SSE serializer includes new fields**

Locate the SSE route. Ensure the outcomes SELECT includes `manual_odds, manual_suspended`.

- [ ] **Step 4: Commit (in the player repo if separate)**

## Task 3.12: Prestige sync integration (depends on Task 0.2 output)

**Files:**
- Modify: (path from Task 0.2 investigation)

- [ ] **Step 1: Read investigation note**

- [ ] **Step 2: Apply filter**

Modify the aggregation to skip outcomes where `manual_suspended = true OR manual_odds IS NOT NULL`.

- [ ] **Step 3: Commit** (in scraper repo if separate)

## Task 3.13: Apply all 088 migrations to prod + deploy code + setup cron

- [ ] **Step 1: Apply 088, 088b, 088c to prod DB**

```bash
for f in 088 088b 088c; do
  PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co \
    -U postgres -d postgres -f supabase/migrations/${f}_*.sql
done
```

- [ ] **Step 2: Push master**

```bash
git push origin master
```

- [ ] **Step 3: Setup cron on scraper-vps**

```bash
ssh scraper-vps '(crontab -l; echo "*/5 * * * * curl -sX POST -H \"x-scraper-key: $(grep SCRAPER_API_KEY /root/betssolution-admin/.env.local | cut -d= -f2)\" http://localhost:3000/api/cron/manual-override-cleanup > /dev/null 2>&1") | crontab -'
```

- [ ] **Step 4: Smoke test in prod**

On `/admin/consensus`:
- Click Suspend on an outlier row → modal opens.
- Submit with reason + duration 30min → row updates to show suspended.
- Check `/admin/manual-overrides` → new row appears in Attivi tab.
- Wait 30min → row moves to Scaduti (or check immediately by setting manual_expires_at to now()-1s and waiting 5min for cron).

---

## ✅ GATE 3 — Phase 3 complete

Verify:
- [ ] Trigger `protect_manual_fields` installed in prod (check via `\dt` / `\df`).
- [ ] Admin RPCs callable from API (suspend/override/restore/dismiss respond 200).
- [ ] `/admin/consensus` buttons work end-to-end.
- [ ] Player frontend respects `manual_suspended` (outcome renders non-bettable).
- [ ] Cron cleanup runs every 5min.
- [ ] Scraper upsert cycle does not overwrite manual_* (verified by 3.4 test + 48h observation).

---

# Phase 4: Migration 089 — Canonical Events Layer

**Target**: Introduce `canonical_events` identity layer with FK on events, fan-out trigger, merge RPC. ~3-5 days.

**Deploy gate**: event-normalization coverage ≥ 95% (measure via `/admin/event-normalization` Stats tab). If not met, iterate 087 first.

## Phase 4 File Structure

### New files
| Path | Purpose |
|---|---|
| `supabase/migrations/089_canonical_events.sql` | canonical_events schema + FK on events + fan-out trigger + merge RPC + merges audit |
| `supabase/migrations/089b_canonical_backfill.sql` | Backfill from events.flashscore_id |
| `supabase/migrations/089c_persist_event_normalization.sql` | RPC for engine 3-step atomic persist |
| `supabase/migrations/089d_consensus_rpc_canonical.sql` | Rewrite refresh_consensus_snapshots via canonical JOIN |
| `app/api/admin/canonical-events/route.ts` | List + Detail |
| `app/api/admin/canonical-events/merge/route.ts` | POST merge |
| `app/admin/canonical-events/page.tsx` | List + Detail + Merge + Orphans tabs |

### Modified files
| Path | What changes |
|---|---|
| `lib/normalize/events/engine.ts` | persistMatch uses persist_event_normalization RPC |
| `app/api/flashscore/results/route.ts` or discovered flashscore ingestion | Redirect to canonical_events |

---

## Task 4.1: Measure 087 coverage (gate check)

- [ ] **Step 1: Query coverage on prod**

```bash
PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co \
  -U postgres -d postgres <<SQL
SELECT
  s.name AS sport,
  count(*) AS total,
  count(*) FILTER (WHERE e.flashscore_id IS NOT NULL) AS mapped,
  round(100.0 * count(*) FILTER (WHERE e.flashscore_id IS NOT NULL) / count(*), 1) AS pct
FROM events e JOIN sports s ON s.id = e.sport_id
WHERE e.status IN ('prematch','live') AND e.starts_at > now() - interval '7 days'
GROUP BY s.name ORDER BY total DESC;
SQL
```

- [ ] **Step 2: Decision**

If overall pct ≥ 95% AND top-5 sports each ≥ 90% → proceed. Else: iterate 087 (run subagent batches, add team_aliases, tune trigram threshold) and re-measure in N days.

## Task 4.2: Write migration 089 schema

**Files:**
- Create: `supabase/migrations/089_canonical_events.sql`

- [ ] **Step 1: Create file**

```sql
-- ═══════════════════════════════════════════════════
-- Migration 089: Canonical Events Layer
-- ═══════════════════════════════════════════════════

-- 089.1 canonical_events
CREATE TABLE canonical_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flashscore_id text UNIQUE,
  sport_id uuid REFERENCES sports(id),
  league_id uuid REFERENCES leagues(id),
  home_team text NOT NULL,
  away_team text NOT NULL,
  starts_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'prematch'
    CHECK (status IN ('prematch','live','ended','postponed','cancelled','void')),
  score_home int,
  score_away int,
  result jsonb,
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

CREATE OR REPLACE FUNCTION touch_canonical_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS set_canonical_updated_at ON canonical_events;
CREATE TRIGGER set_canonical_updated_at
BEFORE UPDATE ON canonical_events
FOR EACH ROW EXECUTE FUNCTION touch_canonical_updated_at();

-- 089.2 FK on events
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS canonical_event_id uuid REFERENCES canonical_events(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_events_canonical ON events(canonical_event_id)
  WHERE canonical_event_id IS NOT NULL;

-- 089.3 Fan-out trigger
CREATE OR REPLACE FUNCTION propagate_canonical_result() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.result IS DISTINCT FROM NEW.result)
     OR (OLD.status IS DISTINCT FROM NEW.status)
     OR (OLD.score_home IS DISTINCT FROM NEW.score_home)
     OR (OLD.score_away IS DISTINCT FROM NEW.score_away)
  THEN
    UPDATE events SET
      status = NEW.status,
      score_home = NEW.score_home,
      score_away = NEW.score_away,
      result = NEW.result
    WHERE canonical_event_id = NEW.id
      AND (status IS DISTINCT FROM NEW.status
           OR score_home IS DISTINCT FROM NEW.score_home
           OR score_away IS DISTINCT FROM NEW.score_away
           OR result IS DISTINCT FROM NEW.result);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS propagate_canonical_on_update ON canonical_events;
CREATE TRIGGER propagate_canonical_on_update
AFTER UPDATE ON canonical_events
FOR EACH ROW EXECUTE FUNCTION propagate_canonical_result();

-- 089.4 Merge audit
CREATE TABLE canonical_event_merges (
  id bigserial PRIMARY KEY,
  keep_id uuid REFERENCES canonical_events(id),
  merge_id uuid,
  merge_home_team text,
  merge_away_team text,
  merge_starts_at timestamptz,
  merged_by uuid REFERENCES auth.users(id),
  reason text,
  merged_at timestamptz DEFAULT now()
);

-- 089.5 Merge RPC
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
  IF v_snapshot IS NULL THEN RAISE EXCEPTION 'Merge source % not found', p_merge_id; END IF;

  UPDATE events SET canonical_event_id = p_keep_id WHERE canonical_event_id = p_merge_id;
  GET DIAGNOSTICS v_events_moved = ROW_COUNT;

  INSERT INTO canonical_event_merges (
    keep_id, merge_id, merge_home_team, merge_away_team, merge_starts_at, merged_by, reason
  ) VALUES (
    p_keep_id, p_merge_id,
    v_snapshot->>'home_team', v_snapshot->>'away_team',
    (v_snapshot->>'starts_at')::timestamptz, p_user_id, p_reason
  );

  DELETE FROM canonical_events WHERE id = p_merge_id;
  RETURN jsonb_build_object('success', true, 'events_moved', v_events_moved);
END $$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/089_canonical_events.sql
git commit -m "chore(db): add migration 089 canonical events layer"
```

## Task 4.3: Write backfill 089b

**Files:**
- Create: `supabase/migrations/089b_canonical_backfill.sql`

- [ ] **Step 1: Create file**

```sql
-- ═══════════════════════════════════════════════════
-- Migration 089b: Backfill canonical_events from events
-- ═══════════════════════════════════════════════════

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

UPDATE events e SET canonical_event_id = c.id
FROM canonical_events c
WHERE e.flashscore_id = c.flashscore_id
  AND e.canonical_event_id IS NULL;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/089b_canonical_backfill.sql
git commit -m "chore(db): add migration 089b canonical events backfill"
```

## Task 4.4: Write persist_event_normalization RPC (089c)

**Files:**
- Create: `supabase/migrations/089c_persist_event_normalization.sql`

- [ ] **Step 1: Create file**

```sql
-- ═══════════════════════════════════════════════════
-- Migration 089c: 3-step atomic persist for engine
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION persist_event_normalization(
  p_event_id uuid, p_flashscore_id text, p_stage text,
  p_confidence numeric, p_llm_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_canonical_id uuid; v_event events%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM events WHERE id = p_event_id;
  IF v_event.id IS NULL THEN RAISE EXCEPTION 'Event % not found', p_event_id; END IF;

  -- Step 1: UPSERT event_normalization (respect verified)
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
  WHERE NOT event_normalization.verified;

  -- Step 2: UPSERT canonical_events
  INSERT INTO canonical_events (
    flashscore_id, sport_id, league_id, home_team, away_team, starts_at
  ) VALUES (
    p_flashscore_id, v_event.sport_id, v_event.league_id,
    v_event.home_team, v_event.away_team, v_event.starts_at
  )
  ON CONFLICT (flashscore_id) DO NOTHING;

  SELECT id INTO v_canonical_id FROM canonical_events WHERE flashscore_id = p_flashscore_id;

  -- Step 3: Link event
  UPDATE events SET
    canonical_event_id = v_canonical_id,
    flashscore_id = p_flashscore_id
  WHERE id = p_event_id;

  RETURN jsonb_build_object('success', true, 'canonical_event_id', v_canonical_id);
END $$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/089c_persist_event_normalization.sql
git commit -m "chore(db): add migration 089c persist_event_normalization RPC"
```

## Task 4.5: Modify engine to use new RPC

**Files:**
- Modify: `lib/normalize/events/engine.ts`

- [ ] **Step 1: Replace persistMatch body**

```typescript
async function persistMatch(supabase: any, event: EventToNormalize, r: MatchResult) {
  if (!r.flashscore_id) return;
  const { error } = await supabase.rpc('persist_event_normalization', {
    p_event_id: event.id,
    p_flashscore_id: r.flashscore_id,
    p_stage: r.stage,
    p_confidence: r.confidence,
    p_llm_reason: r.llm_reason ?? null,
  });
  if (error) console.error('persist_event_normalization failed', error);
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/normalize/events/engine.ts
git commit -m "refactor(normalize/events): use persist_event_normalization RPC"
```

## Task 4.6: Apply 089 + 089b + 089c to staging; verify backfill

- [ ] **Step 1: Apply**

```bash
for f in 089 089b 089c; do
  PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres \
    -f supabase/migrations/${f}_*.sql
done
```

- [ ] **Step 2: Verify counts**

```bash
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres <<SQL
SELECT count(*) AS total_events FROM events;
SELECT count(*) AS mapped_events FROM events WHERE canonical_event_id IS NOT NULL;
SELECT count(*) AS canonical_rows FROM canonical_events;
SELECT count(*) AS orphan_events FROM events WHERE canonical_event_id IS NULL;
SQL
```

Expected: mapped_events ≈ 95% of total_events. canonical_rows ≈ mapped_events / 2.

## Task 4.7: Fan-out trigger synthetic test

- [ ] **Step 1: Pick a canonical with 2 linked events**

```bash
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres \
  -c "SELECT c.id, count(e.id) FROM canonical_events c JOIN events e ON e.canonical_event_id = c.id GROUP BY c.id HAVING count(e.id) = 2 LIMIT 1;"
```

- [ ] **Step 2: Update canonical.score_home**

```bash
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres <<SQL
UPDATE canonical_events SET score_home = 7, score_away = 3 WHERE id = 'CANONICAL_ID';
SQL
```

- [ ] **Step 3: Verify both linked events updated**

```bash
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres \
  -c "SELECT id, source, score_home, score_away FROM events WHERE canonical_event_id = 'CANONICAL_ID';"
```

Expected: both rows show score_home=7, score_away=3.

- [ ] **Step 4: Cleanup**

```bash
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres \
  -c "UPDATE canonical_events SET score_home = NULL, score_away = NULL WHERE id = 'CANONICAL_ID';"
```

## Task 4.8: Rewrite consensus RPC via canonical JOIN

**Files:**
- Create: `supabase/migrations/089d_consensus_rpc_canonical.sql`

- [ ] **Step 1: Create the migration**

Copy the 086 RPC body into 089d, but replace the tmp_pairs CTE with:

```sql
CREATE TEMP TABLE tmp_pairs ON COMMIT DROP AS
  SELECT k.id AS kambi_id, t.id AS twobet_id
  FROM events k
  JOIN events t ON k.canonical_event_id = t.canonical_event_id
  WHERE k.source = 'kambi' AND t.source = '22bet'
    AND k.canonical_event_id IS NOT NULL
    AND k.status IN ('prematch','live')
    AND t.status IN ('prematch','live');
```

Remove the regex fallback. Rest of RPC body unchanged.

- [ ] **Step 2: Benchmark pre vs post**

```bash
# Baseline (086 version still active)
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres \
  -c "\\timing on" -c "SELECT * FROM refresh_consensus_snapshots(15);"

# Apply 089d
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres \
  -f supabase/migrations/089d_consensus_rpc_canonical.sql

# New version
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres \
  -c "\\timing on" -c "SELECT * FROM refresh_consensus_snapshots(15);"
```

Expected: 2-3x speedup.

- [ ] **Step 3: Verify outlier set matches pre-089**

```bash
PGPASSWORD="$STAGING_PG_PASS" psql -h "$STAGING_PG_HOST" -U postgres -d postgres \
  -c "SELECT count(*) FROM v_consensus_latest WHERE snapshot_at > now() - interval '5min';"
```

Should be within 5% of the pre-089d count (small drift from the regex fallback removed).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/089d_consensus_rpc_canonical.sql
git commit -m "chore(db): rewrite refresh_consensus_snapshots via canonical_event_id JOIN"
```

## Task 4.9: Merge endpoint + UI

**Files:**
- Create: `app/api/admin/canonical-events/merge/route.ts`
- Create: `app/admin/canonical-events/page.tsx`

- [ ] **Step 1: merge route**

```typescript
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const { keep_id, merge_id, reason } = await request.json();
  const sb = createAdminClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await sb.rpc('admin_merge_canonical_events', {
    p_keep_id: keep_id, p_merge_id: merge_id,
    p_user_id: user.id, p_reason: reason,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
```

- [ ] **Step 2: Canonical events UI with List + Detail + Merge + Orphans tabs**

Create `app/admin/canonical-events/page.tsx` (similar pattern to event-normalization UI but with canonical-specific tables).

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/canonical-events app/admin/canonical-events
git commit -m "feat(admin): add canonical-events UI + merge endpoint"
```

## Task 4.10: Flashscore ingestion redirect (depends on Task 0.1)

**Files:**
- Modify: (path from Task 0.1 investigation)

- [ ] **Step 1: Read investigation note**

```bash
cat docs/superpowers/notes/flashscore-ingestion-path.md
```

- [ ] **Step 2: Redirect writes to canonical_events**

Replace `UPDATE events SET ...` (where Flashscore result is received) with `UPDATE canonical_events SET ...`. The fan-out trigger propagates.

- [ ] **Step 3: Commit in appropriate repo**

## Task 4.11: Deploy 089 to prod + 24h monitoring

- [ ] **Step 1: Apply all 089 migrations to prod**

```bash
for f in 089 089b 089c 089d; do
  PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co \
    -U postgres -d postgres -f supabase/migrations/${f}_*.sql
done
```

- [ ] **Step 2: Push admin code**

```bash
git push origin master
```

- [ ] **Step 3: Deploy flashscore redirect (if separate scraper)**

Update flashscore-scraper repo, push, restart service.

- [ ] **Step 4: 24h monitoring checklist**

Over 24h, monitor:
- Consensus RPC runtime (expect 2-3x faster than pre-089)
- Settlement correctness (spot-check 5 settled bets; ensure trigger propagation did not skip events)
- No read-side errors in admin or player
- Scraper cycles continue normally (no breakage from canonical_event_id FK additions)

---

## ✅ GATE 4 — Phase 4 complete

Verify:
- [ ] `canonical_events` populated at ≥ 95% of events.
- [ ] Consensus RPC runs in < 50% of 086 time.
- [ ] Settlement engine unchanged; bets settle correctly.
- [ ] `/admin/canonical-events` UI usable (list, merge, orphans visible).
- [ ] Flashscore writes redirected; linked events get fan-out updates.
- [ ] No regression on player frontend or admin dashboards.

---

# Post-Implementation Checklist

## Immediate (within 1 day of last deploy)

- [ ] All 4 migrations (086, 087, 088, 089) applied to staging AND prod DBs.
- [ ] Admin on scraper-vps restarted and showing all new UI pages:
  - `/admin/consensus` (with action buttons)
  - `/admin/event-normalization` (5 tabs)
  - `/admin/manual-overrides` (4 tabs)
  - `/admin/canonical-events` (4 tabs)
- [ ] Crontab on scraper-vps has 2 new entries (event-normalization 15min, manual-override-cleanup 5min).
- [ ] Player frontend respects manual_* fields.
- [ ] Prestige sync respects manual_*.
- [ ] Tests passing in CI.

## Scheduled evaluations

- [ ] **2026-05-06**: re-evaluate 087 LLM API decision (Q2=E). Query metrics, decide 087c.
- [ ] **2026-05-06**: re-evaluate 088 auto-suspend readiness (spec Appendix A). Decide future 090+.
- [ ] **~2026-05-13** (after ~3 weeks of 087 ops): re-measure event-normalization coverage. If still < 99%, plan 087 tuning iterations.

## Documentation updates

- [ ] Update `MEMORY.md` with new project status entry.
- [ ] Update `CLAUDE.md` in admin repo if architecture docs are stale.
- [ ] Create runbook in `docs/runbooks/consensus-operations.md` describing:
  - How to interpret outliers
  - When to suspend vs override vs dismiss
  - Common false positives and their dismiss_category

## Risk register (items to watch)

- **Canonical event merges**: an erroneous merge cannot be un-done by rollback (events.canonical_event_id permanently moved). Operator training + confirmation dialogs essential.
- **Trigger bypass via direct SQL**: any superuser with DB access can bypass `protect_manual_fields` by setting `app.admin_manual_override = 'on'`. Only developer access to DB is controlled by Supabase team membership.
- **Subagent stage 5 cost**: operator's Claude Code context usage scales with batch size. Monitor for context exhaustion; chunk batches to 10-20 events max.
- **Consensus RPC timeout**: prod has `statement_timeout = 300s`. Large dataset with new JOIN should fit. If timeout triggers, consider materialized view or chunked refresh.

---
