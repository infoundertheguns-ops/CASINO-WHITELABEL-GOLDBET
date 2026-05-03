# Bookmaker Pickup Max-Outcomes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the priority-only pickup rule in `v_player_markets` with "max active outcomes wins, priority breaks ties" so that outcomes emitted by lower-priority bookmakers (e.g. rugby ML draw on Pamestoixima) become visible in listing and event page.

**Architecture:** Single PostgreSQL view rewrite via one forward migration (`170`) plus an explicit rollback migration (`170_pre_rollback`). No code changes outside the database. Pre-deploy gated by an audit query; post-deploy validated by smoke tests on prod.

**Tech Stack:** PostgreSQL 14+ (Supabase managed), psql via SSH, bash on VPS. Branch `feature/plan-d-settlement-d1` HEAD `9ac55f3`.

**Spec:** `/root/betssolution-admin/docs/superpowers/specs/2026-05-03-bookmaker-priority-design.md`

**Working host:** `scraper-vps` (production, test mode — no real bettors). Repo at `/root/betssolution-admin/`. Migrations folder `supabase/migrations/`.

**Environment loading pattern (use everywhere `psql` runs):**
```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" ...'
```

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `supabase/migrations/170_pre_rollback.sql` | Create | Snapshot of current `v_player_markets` definition wrapped in `CREATE OR REPLACE VIEW`. Used to revert mig 170 instantly. |
| `supabase/migrations/170_v_player_markets_max_outcomes.sql` | Create | Forward migration: drop+recreate `v_player_markets` with new pickup rule (max active_count DESC, then `_bookmaker_priority` ASC, then `bookmaker` ASC for stability). |
| `docs/superpowers/specs/2026-05-03-bookmaker-priority-design.md` | Modify (append) | Append "Audit Appendix" section with raw audit query results from prod and the affected `manual_overrides` enumeration. |
| `C:\Users\philp\.claude\projects\C--Users-philp\memory\next-session-2026-05-03.md` | Modify | Replace the rugby caveat block with post-deploy outcome (whether fix worked, coverage delta). |
| `C:\Users\philp\.claude\projects\C--Users-philp\memory\MEMORY.md` | Modify | Add one-line entry under "Sessione 2026-05-03" pointing at this plan + post-deploy result. |

No application code (TypeScript / frontend) changes.

---

## Why this plan order

The audit query is a HARD GATE: if it shows >30% pickup change, we stop and reconsider, so we run it BEFORE writing or applying the migration. Rollback dump is captured BEFORE the forward migration so a failed apply has an instant escape hatch. Smoke tests on a known-bug case (rugby NZ-Argentina) and a known-stable case (calcio Milan-Inter ML) give us a fast confidence signal before broader monitoring.

---

## Task 1: Verify branch state and dependencies

**Files:** none (verification only)

- [ ] **Step 1: Confirm branch is on expected HEAD**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git status --short && git log --oneline -3'
```

Expected: branch `feature/plan-d-settlement-d1`, HEAD `9ac55f3` (spec revision commit) or descendant. Working tree clean.

- [ ] **Step 2a: Confirm current `v_player_markets` definition matches spec assumption AND save it for rollback**

```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" -At -c "SELECT pg_get_viewdef('"'"'v_player_markets'"'"'::regclass, true);"' > /c/Users/philp/v_player_markets-current.sql
head -10 /c/Users/philp/v_player_markets-current.sql
```

Expected: contains `DISTINCT ON (m2.market_name, o2.line)` and `_bookmaker_priority(m2.bookmaker)` in `ORDER BY`. If it differs significantly, STOP and re-verify the spec is still accurate.

This file is the source of truth for the rollback migration in Task 4 — do NOT regenerate it later.

- [ ] **Step 2b: Confirm current `v_player_outcomes` definition AND save it**

```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" -At -c "SELECT pg_get_viewdef('"'"'v_player_outcomes'"'"'::regclass, true);"' > /c/Users/philp/v_player_outcomes-current.sql
head -10 /c/Users/philp/v_player_outcomes-current.sql
```

Expected: contains `_oddsapi_translate_outcome` and `manual_overrides` JOINs (per mig 160b). This file is the source of truth for the v_player_outcomes block re-created in Task 5 forward migration — copy its body verbatim, do not retype from memory.

- [ ] **Step 2c: Confirm `_migrations.name` has a unique constraint (used by `ON CONFLICT (name)` in Task 5)**

```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" -c "\d _migrations"'
```

Expected: `name` column has either PRIMARY KEY or UNIQUE constraint. If not, change Task 5 Step 1 to drop the `ON CONFLICT` clause.

- [ ] **Step 3: Confirm `_bookmaker_priority` function exists with expected signature**

```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" -c "\df _bookmaker_priority"'
```

Expected: one row, `_bookmaker_priority(text) returns integer`. If missing or different, STOP.

- [ ] **Step 4: No commit (verification step only). Mark task complete and proceed.**

---

## Task 2: Run audit query and decide gate

**Files:**
- Append to: `docs/superpowers/specs/2026-05-03-bookmaker-priority-design.md` (after task completion)

- [ ] **Step 1: Save audit script locally and scp to VPS**

Use the `Write` tool to create `C:\Users\philp\audit_170.sql` with this content (verbatim):

```sql
WITH active_counts AS (
  SELECT m.event_id,
         m.id AS market_id,
         m.market_name,
         m.bookmaker,
         o.line,
         COUNT(*) AS active_count
  FROM markets_v2 m
  JOIN outcomes_v2 o ON o.market_id = m.id
                   AND o.is_active
                   AND round(o.odds, 2) > 1.00
  GROUP BY m.event_id, m.id, m.market_name, m.bookmaker, o.line
),
ranked_old AS (
  SELECT DISTINCT ON (event_id, market_name, line)
         event_id, market_name, line,
         bookmaker  AS old_bookmaker,
         active_count AS old_count
  FROM active_counts
  ORDER BY event_id, market_name, line, _bookmaker_priority(bookmaker) ASC, bookmaker ASC
),
ranked_new AS (
  SELECT DISTINCT ON (event_id, market_name, line)
         event_id, market_name, line,
         bookmaker  AS new_bookmaker,
         active_count AS new_count
  FROM active_counts
  ORDER BY event_id, market_name, line, active_count DESC, _bookmaker_priority(bookmaker) ASC, bookmaker ASC
),
joined AS (
  SELECT o.event_id, o.market_name, o.line,
         o.old_bookmaker, n.new_bookmaker,
         o.old_count, n.new_count
  FROM ranked_old o
  JOIN ranked_new n USING (event_id, market_name, line)
)
SELECT
  COUNT(*) AS total_markets,
  COUNT(*) FILTER (WHERE old_bookmaker <> new_bookmaker) AS changed_pickup,
  ROUND(100.0 * COUNT(*) FILTER (WHERE old_bookmaker <> new_bookmaker) / COUNT(*), 2) AS changed_pct,
  COUNT(*) FILTER (WHERE old_bookmaker <> new_bookmaker AND new_count > old_count) AS gained_outcomes,
  ROUND(AVG(new_count - old_count) FILTER (WHERE old_bookmaker <> new_bookmaker), 2) AS avg_outcomes_gained
FROM joined;
```

Then upload it to VPS:

```bash
scp /c/Users/philp/audit_170.sql scraper-vps:/tmp/audit_170.sql
```

- [ ] **Step 2: Run aggregate audit**

```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" -f /tmp/audit_170.sql'
```

Expected output shape:
```
 total_markets | changed_pickup | changed_pct | gained_outcomes | avg_outcomes_gained
---------------+----------------+-------------+-----------------+---------------------
        ~89000 |          ~5000 |        ~5.6 |            ~3500 |                ~0.7
```

Save raw output to local file for spec appendix:

```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" -f /tmp/audit_170.sql' > /c/Users/philp/audit-170-aggregate.txt
```

- [ ] **Step 3: Run per-sport breakdown**

Save second SQL file `/tmp/audit_170_per_sport.sql`:

```sql
WITH active_counts AS (
  SELECT m.event_id, m.market_name, m.bookmaker, o.line, COUNT(*) AS active_count
  FROM markets_v2 m
  JOIN outcomes_v2 o ON o.market_id = m.id AND o.is_active AND round(o.odds,2) > 1.00
  GROUP BY m.event_id, m.market_name, m.bookmaker, o.line
),
ranked_old AS (
  SELECT DISTINCT ON (event_id, market_name, line)
         event_id, market_name, line, bookmaker AS old_bookmaker, active_count AS old_count
  FROM active_counts
  ORDER BY event_id, market_name, line, _bookmaker_priority(bookmaker) ASC, bookmaker ASC
),
ranked_new AS (
  SELECT DISTINCT ON (event_id, market_name, line)
         event_id, market_name, line, bookmaker AS new_bookmaker, active_count AS new_count
  FROM active_counts
  ORDER BY event_id, market_name, line, active_count DESC, _bookmaker_priority(bookmaker) ASC, bookmaker ASC
)
SELECT e.sport_slug,
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE o.old_bookmaker <> n.new_bookmaker) AS changed,
       COUNT(*) FILTER (WHERE o.old_bookmaker <> n.new_bookmaker AND n.new_count > o.old_count) AS gained
FROM ranked_old o
JOIN ranked_new n USING (event_id, market_name, line)
JOIN events_v2 e ON e.id = o.event_id
GROUP BY e.sport_slug
ORDER BY changed DESC;
```

Run and save:
```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" -f /tmp/audit_170_per_sport.sql' > /c/Users/philp/audit-170-per-sport.txt
```

- [ ] **Step 4: Run per-market_name breakdown**

Same shape as per-sport but `GROUP BY o.market_name ORDER BY changed DESC LIMIT 30`. Save to `/c/Users/philp/audit-170-per-market.txt`.

- [ ] **Step 5: Decision gate**

Read `audit-170-aggregate.txt`:
- If `changed_pct < 10%` → proceed silently to Task 3.
- If `10% <= changed_pct <= 30%` → present per-sport and per-market files to user via chat, await explicit go/no-go.
- If `changed_pct > 30%` → STOP, report to user with full breakdowns. Do not proceed without explicit approval and possibly a spec revision.

- [ ] **Step 6: Append audit results to spec doc**

Append a new H2 section "## Audit Appendix (executed 2026-05-03)" to spec containing the three text files' contents in fenced code blocks. Then scp the modified spec to VPS, commit on branch:

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git add docs/superpowers/specs/2026-05-03-bookmaker-priority-design.md && git -c user.name="philip" -c user.email="info.softvisiontechnologies@gmail.com" commit -m "spec: bookmaker pickup audit appendix from prod"'
```

---

## Task 3: Enumerate manual_overrides at risk

**Files:** none persisted to repo (just gather data for admin awareness)

- [ ] **Step 1: Run manual_overrides enumeration**

```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" -c "
SELECT mo.id, mo.scope, mo.market_id_v2, mo.outcome_id_v2,
       e.home || '"'"' vs '"'"' || e.away AS event,
       m.market_name, o.line
FROM manual_overrides mo
LEFT JOIN markets_v2 m ON m.id = COALESCE(mo.market_id_v2,
                                           (SELECT market_id FROM outcomes_v2 WHERE id = mo.outcome_id_v2))
LEFT JOIN events_v2 e ON e.id = m.event_id
LEFT JOIN outcomes_v2 o ON o.id = mo.outcome_id_v2
WHERE (mo.expires_at IS NULL OR mo.expires_at > now());
"'
```

Expected (current test mode): 0 rows or a small handful. If 0 rows → no admin re-application needed, log "0 active overrides" and continue. If rows present → save to `/c/Users/philp/audit-170-manual-overrides.txt` and surface in chat to user before Task 4.

- [ ] **Step 2: No commit. Continue.**

---

## Task 4: Capture rollback migration

**Files:**
- Create: `supabase/migrations/170_pre_rollback.sql`

- [ ] **Step 1: Construct rollback file locally from saved view definitions**

Use `/c/Users/philp/v_player_markets-current.sql` and `/c/Users/philp/v_player_outcomes-current.sql` (saved in Task 1 Steps 2a/2b) as the bodies. Use the `Write` tool to assemble `C:\Users\philp\170_pre_rollback.sql`:

```sql
-- Migration 170 ROLLBACK — restores v_player_markets and v_player_outcomes
-- to pre-mig-170 definitions captured from prod 2026-05-03.
-- Apply only if mig 170 needs to be reverted.

DROP VIEW IF EXISTS v_player_outcomes CASCADE;
DROP VIEW IF EXISTS v_player_markets CASCADE;

CREATE VIEW v_player_markets AS
<<paste exact contents of /c/Users/philp/v_player_markets-current.sql here>>;

COMMENT ON VIEW v_player_markets IS 'Restored to pre-mig-170 definition (priority-only pickup).';

CREATE VIEW v_player_outcomes AS
<<paste exact contents of /c/Users/philp/v_player_outcomes-current.sql here>>;

COMMENT ON VIEW v_player_outcomes IS 'Restored to pre-mig-170 definition (mig 160b body).';
```

CRITICAL: paste the saved files VERBATIM, including any embedded single quotes — do not retype, do not let any heredoc/echo strip them. The semicolon at the end of each `CREATE VIEW ... AS ...` is mandatory; pg_get_viewdef does NOT include it.

Upload to VPS:
```bash
scp /c/Users/philp/170_pre_rollback.sql scraper-vps:/root/betssolution-admin/supabase/migrations/170_pre_rollback.sql
ssh scraper-vps 'wc -l /root/betssolution-admin/supabase/migrations/170_pre_rollback.sql'
```

Expected: file > 50 lines. If trivially small, the paste did not include the view bodies — fix and re-scp.

- [ ] **Step 2: Verify rollback file is syntactically valid (parse-only)**

```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" -1 --set ON_ERROR_STOP=1 -c "BEGIN; $(cat /root/betssolution-admin/supabase/migrations/170_pre_rollback.sql); ROLLBACK;"'
```

Expected: `ROLLBACK` printed, no syntax errors. The transaction is rolled back so prod is unchanged. If it errors, fix the file (likely a quoting issue from the heredoc) and retry.

NOTE: `v_player_outcomes` depends on `v_player_markets` only logically, not via DDL CASCADE — the LATERAL views from mig 160b have `v_player_outcomes` independent of the markets view via CASCADE drop above. Verify by checking if `\d+ v_player_outcomes` references `v_player_markets`. If yes, add `v_player_outcomes` recreation to the rollback file too. (Inspection in Task 1 Step 2 should already clarify.)

- [ ] **Step 3: Commit rollback file**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git add supabase/migrations/170_pre_rollback.sql && git -c user.name="philip" -c user.email="info.softvisiontechnologies@gmail.com" commit -m "migration: 170_pre_rollback — captured pre-mig-170 v_player_markets snapshot"'
```

---

## Task 5: Write forward migration 170

**Files:**
- Create: `supabase/migrations/170_v_player_markets_max_outcomes.sql`

- [ ] **Step 1: Write migration locally on Windows**

Save to `C:\Users\philp\170_v_player_markets_max_outcomes.sql` with content:

```sql
-- Migration 170: v_player_markets — max-outcomes pickup with priority tiebreaker.
--
-- Problem: previous pickup rule selected ONE bookmaker per (event, market_name, line)
-- via _bookmaker_priority alone. When the top-priority bookmaker emitted a SUBSET
-- of outcomes (e.g. rugby ML on Bet365: home/away only, no draw), the missing
-- outcomes disappeared from the listing/event page even though other bookmakers
-- (Pamestoixima for rugby) emitted them.
--
-- New rule: pick the bookmaker with the MAX number of active outcomes per
-- (event, market_name, line). Use _bookmaker_priority ASC as a tiebreaker, then
-- bookmaker name ASC for full determinism (avoids non-deterministic ordering for
-- multiple unknown bookmakers tied at priority 99).
--
-- See spec docs/superpowers/specs/2026-05-03-bookmaker-priority-design.md.

DROP VIEW IF EXISTS v_player_markets CASCADE;

CREATE VIEW v_player_markets AS
SELECT
  best.id            AS id,
  e2.id              AS event_id,
  best.bookmaker,
  best.market_name   AS source_market_name,
  COALESCE(t.translated, _oddsapi_translate_market(best.market_name, e2.sport_slug)) AS market_type,
  best.line,
  best.category,
  COALESCE(o.is_suspended, false) AS is_suspended,
  o.expires_at AS suspension_expires_at,
  e2.sport_slug,
  e2.flashscore_id
FROM events_v2 e2
JOIN LATERAL (
  WITH per_market AS (
    SELECT m2.id,
           m2.market_name,
           m2.bookmaker,
           o2.line,
           classify_market_pattern(m2.market_name) AS category,
           COUNT(*) OVER (PARTITION BY m2.market_name, o2.line, m2.bookmaker) AS active_count
    FROM markets_v2 m2
    JOIN outcomes_v2 o2
      ON o2.market_id = m2.id
     AND o2.is_active = true
     AND round(o2.odds, 2) > 1.00
    WHERE m2.event_id = e2.id
  )
  SELECT DISTINCT ON (market_name, line)
    id, market_name, bookmaker, line, category
  FROM per_market
  ORDER BY market_name, line,
           active_count DESC,
           _bookmaker_priority(bookmaker) ASC,
           bookmaker ASC
) best ON true
LEFT JOIN LATERAL (
  SELECT translated FROM oddsapi_translations
  WHERE kind = 'market'
    AND source_key = best.market_name
    AND (sport_slug = e2.sport_slug OR sport_slug = '')
  ORDER BY (sport_slug <> '') DESC
  LIMIT 1
) t ON true
LEFT JOIN manual_overrides o
  ON o.scope = 'market'
 AND o.market_id_v2 = best.id
 AND (o.expires_at IS NULL OR o.expires_at > now())
WHERE best.category <> 'special'
  AND NOT (best.category IN ('stats','player') AND e2.flashscore_id IS NULL);

COMMENT ON VIEW v_player_markets IS
  'Plan D Fase 1 — pickup: max active_count, then _bookmaker_priority, then bookmaker ASC (mig 170).';

-- v_player_outcomes was dropped by CASCADE above (depends on v_player_markets via JOIN
-- only logically — but DROP VIEW ... CASCADE removes any dependent objects).
-- Re-create unchanged from mig 160b.

CREATE VIEW v_player_outcomes AS
SELECT
  o2.id,
  o2.market_id,
  o2.outcome_key AS source_outcome_key,
  COALESCE(t.translated, _oddsapi_translate_outcome(o2.outcome_key, m2.market_name)) AS name,
  COALESCE(o.manual_odds, round(o2.odds, 2)) AS odds,
  o2.odds AS raw_odds,
  o2.line,
  o2.line_norm,
  COALESCE(o.manual_odds, NULL) AS manual_odds,
  COALESCE(o.manual_suspended, false) AS manual_suspended,
  (o2.is_suspended OR COALESCE(o.is_suspended, false)) AS is_suspended,
  o2.is_active,
  o.expires_at AS override_expires_at,
  o2.updated_at
FROM outcomes_v2 o2
JOIN markets_v2 m2 ON m2.id = o2.market_id
LEFT JOIN LATERAL (
  SELECT translated FROM oddsapi_translations
  WHERE kind = 'outcome'
    AND source_key = lower(o2.outcome_key)
    AND (parent_market = m2.market_name OR parent_market = '')
  ORDER BY (parent_market <> '') DESC
  LIMIT 1
) t ON true
LEFT JOIN manual_overrides o
  ON o.scope = 'outcome'
 AND o.outcome_id_v2 = o2.id
 AND (o.expires_at IS NULL OR o.expires_at > now());

COMMENT ON VIEW v_player_outcomes IS
  'Plan D Fase 1 — outcome view (re-created from mig 160b, no logic change in mig 170).';

INSERT INTO _migrations (name, applied_at, notes)
VALUES ('170_v_player_markets_max_outcomes', now(), 'Pickup: max active_count, then priority, then bookmaker ASC')
ON CONFLICT (name) DO NOTHING;
```

CRITICAL: do NOT use the `v_player_outcomes` body inlined above as-is. Replace lines `CREATE VIEW v_player_outcomes AS ...` through the trailing `;` with the exact contents of `/c/Users/philp/v_player_outcomes-current.sql` (saved in Task 1 Step 2b). The body above is approximate and may not match prod exactly (e.g. patches applied after mig 160b). Source-of-truth is the live `pg_get_viewdef` output. Verbatim paste avoids subtle drift.

- [ ] **Step 2: scp to VPS**

```bash
scp /c/Users/philp/170_v_player_markets_max_outcomes.sql scraper-vps:/root/betssolution-admin/supabase/migrations/170_v_player_markets_max_outcomes.sql
```

- [ ] **Step 3: Dry-run apply (transaction with ROLLBACK at the end)**

```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" -1 --set ON_ERROR_STOP=1 <<SQLEOF
BEGIN;
\i /root/betssolution-admin/supabase/migrations/170_v_player_markets_max_outcomes.sql
-- Quick correctness probe inside the transaction:
SELECT bookmaker, COUNT(*) FILTER (WHERE source_market_name = '"'"'ML'"'"') AS ml_picks
FROM v_player_markets
JOIN events_v2 e ON e.id = v_player_markets.event_id
WHERE e.sport_slug = '"'"'rugby'"'"'
GROUP BY bookmaker
ORDER BY ml_picks DESC LIMIT 5;
ROLLBACK;
SQLEOF'
```

Expected: migration applies cleanly inside the transaction; the probe query shows Pamestoixima and Bet365 both as bookmakers for rugby ML (Pamestoixima now winning some events). The `ROLLBACK` at the end means prod is still on the old view.

If anything errors, fix the .sql, scp again, re-run dry-run.

- [ ] **Step 4: Commit forward migration**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git add supabase/migrations/170_v_player_markets_max_outcomes.sql && git -c user.name="philip" -c user.email="info.softvisiontechnologies@gmail.com" commit -m "migration: 170 v_player_markets — max-outcomes pickup with priority tiebreaker"'
```

---

## Task 6: Pre-deploy correctness probe (read-only)

**Files:** none

The dry-run already proved the migration parses. This task validates the new pickup rule produces expected outcomes for the test cases listed in the spec, by running the migration's view definition as an inline CTE on prod (no DDL change).

- [ ] **Step 1: Identify Rugby NZ-Argentina event UUID**

```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" -c "SELECT id, sport_slug, home, away, starts_at FROM events_v2 WHERE home ILIKE '"'"'%New Zealand%'"'"' AND away ILIKE '"'"'%Argentina%'"'"' AND sport_slug ILIKE '"'"'%rugby%'"'"' ORDER BY starts_at DESC LIMIT 3;"'
```

Expected: at least one row. Note the event UUID for Step 2.

- [ ] **Step 2: Probe new pickup result for Rugby NZ-Argentina ML**

Replace `<EVENT_UUID>` with the value from Step 1, then run:

```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" -c "
WITH per_market AS (
  SELECT m2.id, m2.market_name, m2.bookmaker, o2.line,
         COUNT(*) OVER (PARTITION BY m2.market_name, o2.line, m2.bookmaker) AS active_count
  FROM markets_v2 m2
  JOIN outcomes_v2 o2 ON o2.market_id = m2.id AND o2.is_active AND round(o2.odds,2) > 1.00
  WHERE m2.event_id = '"'"'<EVENT_UUID>'"'"' AND m2.market_name = '"'"'ML'"'"'
)
SELECT DISTINCT ON (market_name, line) market_name, bookmaker, line, active_count
FROM per_market
ORDER BY market_name, line, active_count DESC, _bookmaker_priority(bookmaker) ASC, bookmaker ASC;
"'
```

Expected: bookmaker = `Pamestoixima`, active_count = 3.
If bookmaker = Bet365 with active_count 2, STOP — the migration logic is wrong.

- [ ] **Step 3: Probe a calcio Milan-Inter ML event for regression**

Find a calcio ML event with both Bet365 and Pamestoixima emitting 3 outcomes:

```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" -c "
SELECT e.id, e.home, e.away
FROM events_v2 e
WHERE e.sport_slug = '"'"'calcio'"'"'
ORDER BY e.starts_at DESC
LIMIT 1;
"'
```

Run the same per_market probe with the calcio event id and expect bookmaker = `Bet365`, active_count = 3 (tie → priority 1 wins).

- [ ] **Step 4: Probe a basket / tennis market for no-regression check**

Pick any basket or tennis event, repeat the per_market probe for the main 1X2/Vincente market. Expected: no surprise — bookmaker should still be Bet365 if Bet365 emits the full set of outcomes.

- [ ] **Step 5: No commit. If all probes pass, proceed to Task 7.**

If any probe fails, STOP and debug the migration SQL. Re-run Task 5 Step 3 dry-run with the corrected SQL.

---

## Task 7: Apply migration 170 to prod

**Files:** none modified (DDL apply only)

- [ ] **Step 1: Confirm rollback file is in place and verified**

```bash
ssh scraper-vps 'ls -l /root/betssolution-admin/supabase/migrations/170*.sql'
```

Expected: both `170_pre_rollback.sql` and `170_v_player_markets_max_outcomes.sql` present.

- [ ] **Step 2: Apply migration 170**

```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" --set ON_ERROR_STOP=1 -f /root/betssolution-admin/supabase/migrations/170_v_player_markets_max_outcomes.sql'
```

Expected: `DROP VIEW`, `CREATE VIEW`, `COMMENT`, `CREATE VIEW`, `COMMENT`, `INSERT 0 1` (or `INSERT 0 0` if already in `_migrations`). No errors. Time: under 2 seconds.

- [ ] **Step 3: Verify the view is the new one**

```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" -c "SELECT obj_description('"'"'v_player_markets'"'"'::regclass);"'
```

Expected: contains `mig 170`.

- [ ] **Step 4: Flush Redis cache on player**

```bash
ssh scraper-vps 'redis-cli -u "$(grep ^REDIS_URL /root/betssolution-player/.env.local | cut -d= -f2-)" FLUSHALL'
```

Expected: `OK`.

- [ ] **Step 5: No commit yet (commits happen after smoke-test passes in Task 9).**

---

## Task 8: Post-deploy smoke test

**Files:** none

- [ ] **Step 1: Rugby fix active**

```bash
ssh scraper-vps 'curl -s "http://127.0.0.1:3001/api/sportsbook?sport=rugby&status=prematch&limit=10" | python3 -c "
import json, sys
data = json.load(sys.stdin)
events = data.get(\"events\", data) if isinstance(data, dict) else data
for ev in events[:10]:
    for m in ev.get(\"markets\", []):
        if \"Tempo regolamentare (1X2)\" in m.get(\"name\", \"\"):
            outs = [o[\"name\"] for o in m.get(\"outcomes\", [])]
            print(ev[\"home_team\"], \"vs\", ev[\"away_team\"], \"->\", outs)
"'
```

Expected: at least one event shows `['1', 'X', '2']` (or '2', 'X', '1' — order not guaranteed). Before fix, all events showed `['1', '2']` only.

- [ ] **Step 2: Latency cold-cache per sport**

```bash
ssh scraper-vps 'redis-cli -u "$(grep ^REDIS_URL /root/betssolution-player/.env.local | cut -d= -f2-)" FLUSHALL >/dev/null;
for sport in calcio tennis basket pallamano hockey-ghiaccio rugby baseball volley cricket; do
  curl -s "http://127.0.0.1:3001/api/sportsbook?sport=$sport&status=prematch&limit=10" -o /dev/null -w "$sport: %{time_total}s\n";
done'
```

Pass criteria: calcio ≤ 0.5s, others ≤ 0.3s. If any sport exceeds 2× target, investigate before continuing (could be query plan regression).

- [ ] **Step 3: Latency warm-cache (within 30s)**

Repeat the same loop without FLUSHALL. Expected: all sports ≤ 0.030s.

- [ ] **Step 4: /api/health probe**

```bash
ssh scraper-vps 'curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" http://127.0.0.1:3001/api/health'
```

Expected: `200 0.01-0.1s`.

- [ ] **Step 5: Detail page probe — pick the Rugby NZ-Argentina event from Task 6 Step 1**

```bash
ssh scraper-vps 'curl -s "http://127.0.0.1:3001/api/sportsbook?eventId=<EVENT_UUID>" | python3 -c "
import json, sys
data = json.load(sys.stdin)
ev = data.get(\"events\", [data])[0] if isinstance(data, dict) else data[0]
print(\"markets:\", len(ev.get(\"markets\", [])))
for m in ev[\"markets\"][:5]:
    print(\" \", m.get(\"name\"), \"->\", [o[\"name\"] for o in m.get(\"outcomes\", [])])
"'
```

Expected: `markets > 0`, the 1X2 market shows 3 outcomes.

- [ ] **Step 6: Player error log scan (last 5 min)**

```bash
ssh scraper-vps 'journalctl -u betssolution-player --since "5 minutes ago" | grep -iE "error|exception|fatal" | head -20'
```

Expected: empty or only known noise (e.g. SSE disconnects). NEW error patterns referencing v_player_markets, outcomes, or null fields → STOP and consider rollback.

- [ ] **Step 7: If all 6 probes pass, proceed to Task 9. If ANY fails, jump to Task 11 (rollback).**

---

## Task 9: Commit + push

**Files:** none new (commits already made in Tasks 4, 5; this is the push)

- [ ] **Step 1: Check for any uncommitted changes**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git status --short && git log --oneline -5'
```

Expected: clean tree, recent commits include 170_pre_rollback, 170_v_player_markets_max_outcomes, spec audit appendix.

- [ ] **Step 2: Push branch via VPS bundle pattern**

The repo lives only on VPS (no remote SSH push available); use the bundle → scp → fast-forward pattern documented in `next-session-2026-05-03.md`:

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git bundle create /tmp/branch.bundle feature/plan-d-settlement-d1'
scp scraper-vps:/tmp/branch.bundle /c/Users/philp/branch.bundle
# In the local bare clone, fast-forward and push to GitHub as infoundertheguns-ops:
cd /c/Users/philp/<bare-clone-path> && git bundle verify /c/Users/philp/branch.bundle && git fetch /c/Users/philp/branch.bundle feature/plan-d-settlement-d1:feature/plan-d-settlement-d1 && git push origin feature/plan-d-settlement-d1
```

(Replace `<bare-clone-path>` with the actual path of the bare clone on Windows. If unsure, ask user before executing — this command varies by repo layout.)

- [ ] **Step 3: Verify origin is up to date**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git log --oneline origin/feature/plan-d-settlement-d1..feature/plan-d-settlement-d1'
```

Expected: empty (no local commits ahead).

---

## Task 10: Update memory and post-deploy notes

**Files:**
- Modify: `C:\Users\philp\.claude\projects\C--Users-philp\memory\next-session-2026-05-03.md`
- Modify: `C:\Users\philp\.claude\projects\C--Users-philp\memory\MEMORY.md`

- [ ] **Step 1: Replace rugby caveat block in next-session-2026-05-03.md**

Locate the H3 "### Rugby — bookmaker priority esclude draw" section. Replace with a post-deploy note:

```markdown
### Rugby — bookmaker priority FIXED (mig 170, 2026-05-03)
Mig 170 ridefinisce v_player_markets pickup: max active_outcomes wins,
priority breaks ties. Rugby ML 1X2 ora mostra X dove esiste in DB.
Coverage 1X2 TR rugby: <pre-fix>/<events> -> <post-fix>/<events>.
Side effect: overround peggiore per alcuni eventi (es. NZ-Argentina
6.9% -> 10.7%). Manual overrides best-effort se cambia pickup.
```

Fill in `<pre-fix>` / `<post-fix>` / `<events>` from Task 8 Step 1 outputs and from the audit per-sport file.

- [ ] **Step 2: Add MEMORY.md entry**

Add one line under "## 🚀 PLAN D" or top-level under "Sessione 2026-05-03":

```markdown
## ✅ Bookmaker pickup max-outcomes mig 170 — 2026-05-03 (~1h)
- Spec [bookmaker priority](specs/2026-05-03-bookmaker-priority-design.md) + plan [170 plan](plans/2026-05-03-bookmaker-priority.md). Pickup ora: max active_count, priority tiebreaker, bookmaker ASC. Audit prod: <changed_pct>% markets cambiato bookmaker, +<avg_outcomes_gained> outcomes medi guadagnati. Rugby NZ-Argentina ML ora mostra draw (Pamestoixima). Caveat overround documentato. Branch HEAD <SHA_post_push>.
```

- [ ] **Step 3: No git commit (memory files are local-only).**

---

## Task 11: Rollback procedure (use ONLY if Task 8 fails)

**Files:** none modified (DDL revert only)

- [ ] **Step 1: Apply rollback migration**

```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" --set ON_ERROR_STOP=1 -f /root/betssolution-admin/supabase/migrations/170_pre_rollback.sql'
```

- [ ] **Step 2: Flush Redis cache**

```bash
ssh scraper-vps 'redis-cli -u "$(grep ^REDIS_URL /root/betssolution-player/.env.local | cut -d= -f2-)" FLUSHALL'
```

- [ ] **Step 3: Re-run Task 8 Step 1 — confirm rugby returns to pre-fix state**

If returns to pre-fix state, document the failure mode in chat to user, leave migration files on disk (do not delete), and return to design board.

If rollback also fails, escalate immediately — DO NOT improvise further DDL on prod.

- [ ] **Step 4: Optional — record rollback in `_migrations`**

```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" -c "INSERT INTO _migrations (name, applied_at, notes) VALUES ('"'"'170_rolled_back'"'"', now(), '"'"'mig 170 reverted via 170_pre_rollback.sql'"'"');"'
```

---

## Acceptance criteria (DONE = all true)

- [ ] Audit query results saved as appendix in spec, committed.
- [ ] `170_pre_rollback.sql` committed, dry-run validated (parse + transactional rollback).
- [ ] `170_v_player_markets_max_outcomes.sql` committed, dry-run validated.
- [ ] Mig 170 applied to prod, view comment confirms "mig 170".
- [ ] Redis cache flushed.
- [ ] Rugby `/api/sportsbook?sport=rugby` shows ≥1 event with 3-column 1X2.
- [ ] Calcio listing latency ≤ 0.5s cold, ≤ 0.030s warm.
- [ ] No new error patterns in `journalctl -u betssolution-player` post-apply.
- [ ] Branch pushed to origin `feature/plan-d-settlement-d1`.
- [ ] Memory files updated with post-deploy facts.
