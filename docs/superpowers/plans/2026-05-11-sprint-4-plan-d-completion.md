# Sprint 4: Plan D Completion + Sofa Residuals + Legacy Drop

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan phase-by-phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Plan D Sprint 4 — migrate ~30 admin/player routes from legacy `events`/`markets`/`outcomes` tables to `events_v2`/`markets_v2`/`outcomes_v2`, remove Sofa residuals (deprecated 2026-05-11), drop legacy tables for **14 GB reclaim**. Final state: OddsAPI (`*_v2` tables) is single source for events+markets+outcomes, Flashscore drives settlement + scoreboard.

**Architecture:** OddsAPI ingester writes `*_v2` (single source). Flashscore scraper populates `events_v2.live_data` JSONB for live scoreboard + settles bets via FS incidents. Legacy `events`/`markets`/`outcomes` were the pre-Plan-D multi-bookmaker (Kambi+22bet+Betfair) tables, frozen since 2026-05-02 cutover. Sprint 4 was rinviato e mai eseguito — 30+ route admin/player ancora puntano a legacy.

**Tech Stack:**
- TypeScript Next.js admin app on `feature/plan-d-settlement-d1` branch (port 3000, /root/betssolution-admin, git tracked)
- TypeScript Next.js player app (port 3001, /root/betssolution-player, FILESYSTEM-ONLY, no git)
- Supabase Postgres prod (`xgnyqkmugnfzhdveeqom`) + staging (`bnabvfalytivjsrwqydo`)
- gh-token-pipe push pattern (reference-gh-token-pipe.md)

**Schema cheat sheet legacy → v2:**

| Legacy | v2 | Note |
|---|---|---|
| `events.home_team` | `events_v2.home` | rename |
| `events.away_team` | `events_v2.away` | rename |
| `events.external_id` | `events_v2.odds_api_id` | rename |
| `events.settled_at` | `events_v2.last_settled_at` | rename |
| `events.sport_id` | `events_v2.sport_slug` + `sport_name` | refactor |
| `events.league_id` | `events_v2.league_slug` + `league_name` | refactor |
| `events.home_logo`/`away_logo`/`is_featured`/`is_live`/`source_markets_count`/`source`/`canonical_id`/`result` | MISSING | drop refs or derive |
| `markets.market_type` | `markets_v2.market_name` | rename |
| `markets.line` | `outcomes_v2.line` | moved table |
| `markets.name`/`slug`/`sort_order`/`is_active`/`is_suspended`/`result`/`max_liability`/`line_sig`/`category` | MISSING | drop |
| `markets_v2.bookmaker` | NEW | filter or aggregate |
| `outcomes.name` | `outcomes_v2.outcome_key` | rename + canonical |
| `outcomes.manual_*` | `outcome_manual_actions` table | query rewrite |
| `outcomes.previous_odds`/`probability`/`result`/`max_liability` | MISSING | drop |
| `outcomes_v2.line_norm` | NEW | use for canonical match |

---

## Phase 0 — Sofa residuals cleanup (~30 min)

Sofa è deprecato dal 2026-05-11 (Sofa enrichment ABBANDONATO + FS-only pivot). Codice ancora presente:

**Files:**
- Delete: `/root/betssolution-admin/app/api/sofascore/fixtures/route.ts`
- Delete: `/root/betssolution-admin/app/api/sofascore/fixtures/_lib.ts`
- Delete: `/root/betssolution-admin/app/api/sofascore/stats/route.ts`
- Delete: `/root/betssolution-admin/app/api/sofascore/enrichment/route.ts`
- Delete: `/root/betssolution-admin/app/api/sofascore/enrichment/_lib.ts`
- Delete: `/root/betssolution-admin/tests/api/sofascore/fixtures.test.ts`
- Delete: `/root/betssolution-admin/tests/api/sofascore/stats.test.ts`
- Delete: `/root/betssolution-admin/tests/api/sofascore/enrichment.test.ts`

- [ ] **Step 0.1**: `rm -rf app/api/sofascore tests/api/sofascore` su VPS admin repo
- [ ] **Step 0.2**: grep residual sofascore refs in admin code (commenti ok, imports no)
- [ ] **Step 0.3**: `npm run build` → verde
- [ ] **Step 0.4**: `systemctl restart betssolution-admin`
- [ ] **Step 0.5**: Smoke test: `curl /api/sofascore/fixtures` → 404
- [ ] **Step 0.6**: Commit `chore(admin): remove sofascore residuals (#23.1 Sprint 4 / Phase 0)` + push

---

## Phase 1 — Admin events 1:1 column rename (~3-4h)

Routes che fanno query SOLO su `events` con colonne 1:1-compatibili con `events_v2`.

**Files (admin app):**
- `app/api/admin/liability/route.ts` (2 reads events)
- `app/api/admin/settlement-health/route.ts` (10 reads events)
- `app/api/admin/settlement-coverage/drill-down/route.ts` (1 read)
- `app/api/admin/sportsbook/route.ts` (3 reads)
- `app/api/cron/risk-scan/route.ts` (1 read)
- `app/api/cron/alerts/route.ts` (1 read)
- `app/admin/sportsbook/page.tsx` (1 read, Server Component)

**Standard transformation per file:**
```ts
// PRIMA
.from("events")
.select("id, home_team, away_team, external_id, settled_at, is_live, ...")
.eq("sport_id", x)

// DOPO
.from("events_v2")
.select("id, home as home_team, away as away_team, odds_api_id as external_id, last_settled_at as settled_at, ...")
.eq("sport_slug", sportSlug(x))
```

**Alias columns** preserva downstream typing senza refactor; `is_live` deriva da `status === 'live'` o `(minute IS NOT NULL AND status NOT IN ('settled','cancelled'))`.

### Task 1.A: liability + settlement-health (~1h)

- [ ] **Step 1.A.1**: Read `app/api/admin/liability/route.ts` completo, mappa ogni `.from("events")` query
- [ ] **Step 1.A.2**: Rewrite con `events_v2` + column aliases + `sport_slug` mapping
- [ ] **Step 1.A.3**: Read + rewrite `app/api/admin/settlement-health/route.ts` (10 query)
- [ ] **Step 1.A.4**: `npm run build` → verde
- [ ] **Step 1.A.5**: Smoke: `curl /api/admin/liability` + `curl /api/admin/settlement-health` → 200 con dati v2
- [ ] **Step 1.A.6**: Commit `feat(admin): migrate liability + settlement-health to events_v2 (Sprint 4 / Phase 1.A)`

### Task 1.B: sportsbook + drill-down (~1h)

- [ ] **Step 1.B.1**: Rewrite `app/api/admin/settlement-coverage/drill-down/route.ts`
- [ ] **Step 1.B.2**: Rewrite `app/api/admin/sportsbook/route.ts` (3 query)
- [ ] **Step 1.B.3**: Rewrite `app/admin/sportsbook/page.tsx` Server Component
- [ ] **Step 1.B.4**: Build verde, smoke 3 endpoint
- [ ] **Step 1.B.5**: Commit `feat(admin): migrate sportsbook routes to events_v2 (Sprint 4 / Phase 1.B)`

### Task 1.C: cron risk-scan + alerts (~30min)

- [ ] **Step 1.C.1**: Rewrite cron risk-scan (1h cadence)
- [ ] **Step 1.C.2**: Rewrite cron alerts (2min cadence — high frequency, verify no perf regression)
- [ ] **Step 1.C.3**: Build verde
- [ ] **Step 1.C.4**: Force-run cron via curl con x-cron-key, verify exit 0 + log expected counts
- [ ] **Step 1.C.5**: Commit `feat(cron): migrate risk-scan + alerts to events_v2 (Sprint 4 / Phase 1.C)`

### Task 1.D: push + verify cycle (~15min)

- [ ] **Step 1.D.1**: `git push origin feature/plan-d-settlement-d1` via gh-token-pipe
- [ ] **Step 1.D.2**: Verify cron actually fires post-deploy senza errori (journalctl -u betssolution-admin --since "10 min ago")

---

## Phase 2 — Admin markets/outcomes migration (~4-6h)

Routes che JOIN markets/outcomes — richiede schema-aware rewrite.

**Files:**
- `app/api/admin/market-catalog/route.ts` (events + markets)
- `app/api/admin/market-coverage/route.ts` (events + markets, multi-bookmaker compare LOGIC)
- `app/api/admin/manual-overrides/route.ts` (outcomes.manual_*)
- `app/api/admin/cleanup/route.ts` (events + markets + outcomes — full chain)

### Task 2.A: manual-overrides (~1h, simpler)

`outcomes.manual_suspended` + `outcomes.manual_odds` → query `outcome_manual_actions` table (storia + state).

- [ ] **Step 2.A.1**: Read `outcome_manual_actions` schema (action_type, outcome_id, created_at, expires_at)
- [ ] **Step 2.A.2**: Rewrite count queries (was: `outcomes WHERE manual_suspended=true` → now: aggregate from outcome_manual_actions WHERE action_type='suspend' AND active state)
- [ ] **Step 2.A.3**: Rewrite list query
- [ ] **Step 2.A.4**: Build verde + smoke `curl /api/admin/manual-overrides`
- [ ] **Step 2.A.5**: Commit `feat(admin): migrate manual-overrides to outcome_manual_actions table (Sprint 4 / Phase 2.A)`

### Task 2.B: market-catalog (~1.5h)

Lista mercati per evento. Aggregare per `market_name` (since markets_v2 è per-bookmaker, multi-rows).

- [ ] **Step 2.B.1**: Design GROUP BY market_name aggregation strategy (`COUNT(*) AS bookmaker_count`)
- [ ] **Step 2.B.2**: Rewrite 2 events queries + 1 markets query con aggregation
- [ ] **Step 2.B.3**: Build + smoke
- [ ] **Step 2.B.4**: Commit

### Task 2.C: market-coverage CONCEPTUAL DECISION (~2-3h)

Era confronto Kambi vs 22bet vs Betfair (multi-bookmaker drift detection). Nella nuova architettura OddsAPI-only, **questo concetto non esiste più** — c'è solo bookmaker `'odds-api'` o aggregate. 

**Decision gate**:
- Opzione A: **Delete route** (concetto morto in OddsAPI single source). Cancella `market-coverage/route.ts` + nav link admin. Migrazione = elimination.
- Opzione B: **Re-purpose** come coverage per-`market_name` per `events_v2` (quanti markets ha l'evento, vs target N tipi).

User decide prima di scrivere code per .B.

- [ ] **Step 2.C.1**: Decision con user
- [ ] **Step 2.C.2A**: Se delete: rm route + edit layout.tsx nav + build + commit
- [ ] **Step 2.C.2B**: Se re-purpose: full rewrite con nuova semantica + commit

### Task 2.D: cleanup admin route (~1h)

`/api/admin/cleanup/route.ts` legge events+markets+outcomes per pulizia. Legacy intent: cancellare orphan da multi-bookmaker. Nuova realtà: events_v2 retention è gestita da #23.5 cron già installato → questa route è probabilmente **redundant**.

- [ ] **Step 2.D.1**: Audit cosa fa la route: usa case manuale di delete admin?
- [ ] **Step 2.D.2**: Decision: drop o migrate
- [ ] **Step 2.D.3**: Execute decision + build + commit

---

## Phase 3 — Place-bet sport path (CRITICAL, ~2-3h)

`app/api/player/place-bet/route.ts` linee 232-310. Sport bet validation rewrite con outcomes_v2.

**Files:**
- Modify: `app/api/player/place-bet/route.ts:232-310`

**Pattern target** (basato su player /api/bet/place dual resolver):
```ts
const { data: outcome } = await supabase
  .from("outcomes_v2")
  .select("id, odds, is_active, is_suspended, market_id, outcome_key, line, markets_v2!inner(event_id, market_name, bookmaker)")
  .eq("id", sel.outcomeId)
  .single();

// + manual override check via outcome_manual_actions
const { data: manual } = await supabase
  .from("outcome_manual_actions")
  .select("action_type, new_value, expires_at")
  .eq("outcome_id", sel.outcomeId)
  .eq("action_type", "suspend")
  .gte("expires_at", new Date().toISOString())
  .maybeSingle();
if (manual) return suspendedError;
```

- [ ] **Step 3.1**: Read place-bet route.ts full sport path context (linee 200-330)
- [ ] **Step 3.2**: Mappa ogni reference legacy nel branch sport
- [ ] **Step 3.3**: Rewrite con outcomes_v2 + outcome_manual_actions lookup
- [ ] **Step 3.4**: events lookup → events_v2
- [ ] **Step 3.5**: Build verde
- [ ] **Step 3.6**: End-to-end smoke: simulate sport bet placement via curl con dati v2 reali (find live outcome_v2.id + post place-bet payload)
- [ ] **Step 3.7**: Verify bet inserted in bets+bet_selections con references corrette
- [ ] **Step 3.8**: Commit `feat(player-api): migrate place-bet sport path to outcomes_v2 + outcome_manual_actions (Sprint 4 / Phase 3)`

---

## Phase 4 — Player kiosk + dual resolver simplification (~1-2h, filesystem-only)

**Files (no git, filesystem-only on VPS):**
- `/root/betssolution-player/app/(kiosk)/event/[eventId]/page.tsx` (1 read events)
- `/root/betssolution-player/app/(kiosk)/live/[eventId]/page.tsx` (1 read events)
- `/root/betssolution-player/lib/queries/bet-outcome-dual-resolver.ts` (remove legacy half)
- `/root/betssolution-player/app/api/bet/place/route.ts:339` (events legacy lookup)
- `/root/betssolution-player/app/api/sportsbook/route.ts:245,286` (2 markets reads)

- [ ] **Step 4.1**: Rewrite (kiosk)/event + (kiosk)/live page events → events_v2
- [ ] **Step 4.2**: Simplify dual-resolver: solo v_player_outcomes branch (cancella legacy half + ResolvedOutcome.source field)
- [ ] **Step 4.3**: Rewrite bet/place events legacy lookup → events_v2
- [ ] **Step 4.4**: Rewrite sportsbook markets reads → markets_v2 / v_player_markets
- [ ] **Step 4.5**: `npm run build` betssolution-player → verde
- [ ] **Step 4.6**: systemctl restart betssolution-player
- [ ] **Step 4.7**: Smoke: kiosk event page + sportsbook list + bet/place
- [ ] **Step 4.8**: NO commit (filesystem-only no git). Document state in session memory.

---

## Phase 5 — pg_dump + DROP + final verify (~30min)

**DB ops prod + staging.**

- [ ] **Step 5.1**: `pg_dump` markets legacy prod (4.7 GB → ~1 GB gz) → `/root/db-backups/markets_prod_20260511.sql.gz`
- [ ] **Step 5.2**: `pg_dump` outcomes legacy prod (9.3 GB → ~2 GB gz) → `/root/db-backups/outcomes_prod_20260511.sql.gz`
- [ ] **Step 5.3**: `pg_dump` events legacy prod (72 MB → ~20 MB gz) → `/root/db-backups/events_prod_20260511.sql.gz`
- [ ] **Step 5.4**: Same 3 dumps staging
- [ ] **Step 5.5**: Verify all 6 backup files exist + non-zero size
- [ ] **Step 5.6**: Audit residual FK constraints from bet_selections (NOT VALID → safe), team_aliases.proposed_for_event_id, normalization_issues, odds_adjustments, settlement_log, event_normalization, market_normalization
- [ ] **Step 5.7**: SQL transaction prod: `BEGIN; ALTER TABLE ... DROP CONSTRAINT ... ; DROP TABLE outcomes CASCADE; DROP TABLE markets CASCADE; DROP TABLE events CASCADE; SELECT ...; COMMIT;`
- [ ] **Step 5.8**: Same transaction staging
- [ ] **Step 5.9**: Verify legacy tables gone, db_size reduced
- [ ] **Step 5.10**: Smoke ALL admin routes + player routes + cron — expect 200 everywhere (no 500 from missing tables)
- [ ] **Step 5.11**: Commit `feat(db): drop legacy markets+outcomes+events tables (Sprint 4 / Phase 5 — 14 GB reclaim)` + push
- [ ] **Step 5.12**: Update MEMORY.md + pending-23-db-cleanup.md: #23.1 DONE
- [ ] **Step 5.13**: Write session note `session-2026-05-11-23.1-sprint-4-completion.md`

---

## Phase ordering + estimated time

| Phase | Effort | Cumulative | Notes |
|---|---|---|---|
| 0 — Sofa residuals | 30 min | 0:30 | Quick win |
| 1.A — liability+settlement-health | 1h | 1:30 | Admin observability dashboards |
| 1.B — sportsbook+drill-down | 1h | 2:30 | |
| 1.C — cron risk-scan+alerts | 30min | 3:00 | High frequency, verify perf |
| 1.D — push+verify | 15min | 3:15 | |
| 2.A — manual-overrides | 1h | 4:15 | Different table query |
| 2.B — market-catalog | 1.5h | 5:45 | Aggregation logic |
| 2.C — market-coverage | 2-3h | 8:45 | Decision gate user |
| 2.D — cleanup route | 1h | 9:45 | Decision gate user |
| 3 — place-bet | 2-3h | 12:45 | CRITICAL end-to-end test |
| 4 — player kiosk + resolver | 1-2h | 14:45 | Filesystem-only |
| 5 — DROP + verify + commit | 30min | 15:15 | Reclaim 14 GB |

**Realistic effort**: 12-16h across 3-4 sessioni.

**Session 1 today** (~2-4h): Phase 0 + Phase 1 (A, B, C, D)  
**Session 2** (~3-5h): Phase 2 (A, B, C, D) with 2 user decision gates  
**Session 3** (~3-4h): Phase 3 (place-bet critical, end-to-end test)  
**Session 4** (~1-2h): Phase 4 + Phase 5 final drop

## Commit cadence
- 1 commit per Phase/Task completata (NOT per step)
- Format: `feat(scope): description (Sprint 4 / Phase X.Y)` — convention per facile tracking nel git log
- Push at end of each session via gh-token-pipe pattern (reference-gh-token-pipe.md)

## Rollback strategy
- DB: backup pg_dump in /root/db-backups, zcat | psql to restore (~10-30 min per table)
- Code: git revert sui commit Sprint 4 (singolo branch feature/plan-d-settlement-d1)
- Player code: filesystem-only, backup manuale pre-edit (`cp -r /root/betssolution-player /root/betssolution-player.backup-pre-sprint4-20260511`)

## Risk register
- **RISK 1**: Schema diff legacy→v2 incompleta — alcuni columns potrebbero avere semantic shift, non solo rename. Mitigazione: per ogni route, run side-by-side query SELECT su legacy vs v2 prima e dopo migration, confronta output shape.
- **RISK 2**: events_v2.live_data JSONB contiene FS payload — alcune query legacy che usano `events.minute` o `events.score_home` standalone potrebbero perdere accuratezza se v2 versione è populated solo via FS. Verifica con live event sample.
- **RISK 3**: cron alerts (every 2 min) — se migration introduce slowdown, accumula backlog. Mitigazione: run cron manualmente post-migration con time, accept solo se <2x baseline.
- **RISK 4**: place-bet sport path è critical — bug = bet rejection o accept con wrong odds = liability. Mitigazione: TDD con vitest test prima di deploy, sample bet end-to-end con confronto pre/post quotes.
- **RISK 5**: market-coverage decision potrebbe richiedere ulteriore brainstorming con product — possibile blocker fase 2.C.

## Out of scope
- Migration di codice scraper (FS + odds-api-ingester già su v2)
- ws-print-server.js (verifica se ha refs legacy — atteso no, perché è layer di printing post-bet)
- Test automation (vitest suite full) — TDD selettivo solo su place-bet
- Cleanup script: `/root/betssolution-admin/scripts/test-*.ts`, `backfill-fs-stats.ts` (utility script run on demand, OK se 500 dopo drop, possono essere puliti incrementale)
