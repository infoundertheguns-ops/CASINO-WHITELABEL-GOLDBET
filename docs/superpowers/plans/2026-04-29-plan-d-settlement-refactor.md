# Plan D — Settlement Refactor Implementation Plan (v1 — superseded)

> ⚠️ **PLAN v2 PENDING REWRITE — DO NOT EXECUTE v1**
>
> This plan implements design v1 of Plan D. End-of-session 2026-04-29 the user proposed a structural design evolution that supersedes parts of this plan:
> - Add filter at `derive_legacy_from_v2()` to hide stats/player/special markets on events without `flashscore_id`
> - Remove Task 2.1c (SPECIAL_DISPATCHER), simplify settleLeg to drop `manual_required` path
> - Rebalance 100-bet fixture from 60/20/15/5 to 60/20/20/0
> - Confirm score-based legs ALWAYS settle via odds-api, never FS (already in v1 but worth being explicit)
>
> **Authoritative source until rewrite**: `session-2026-04-29-plan-d-spec-and-plan.md` memory file ("Spec/Plan rewrite required next session" section has the full diff list).
>
> Next session first task: rewrite this plan to v2 (~2h via Edit tool), then re-dispatch plan-document-reviewer.

---

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor settlement engine to consume odds-api `events_v2.scores` as authoritative source for score-based markets while preserving Flashscore as stats source for corners/cards/players. Ship `/admin/settlement-coverage` page that classifies every market type and surfaces real bet metrics. Validate against ≥100 bet fixtures before cutover.

**Architecture:** Two coupled sub-components sharing a single source of truth. (1) `lib/settlement/market-classification.ts` is a TS dict (`MARKET_CATEGORIES`) exported to JSON and seeded into `market_categories_seed` table — used by both the page (for display) and the engine (for routing). (2) Settlement runs via two cooperating cron triggers: Trigger A (new, every 1 min) settles score-only legs from `events_v2.status='settled' + scores`; Trigger B (existing `verify-results`, scoped) settles stats/player legs from Flashscore. Cutover gated by 48h shadow observation + 100/100 fixture pass + env flag.

**Tech Stack:** TypeScript / Next.js 14 App Router / Supabase (PostgreSQL + RLS) / vitest / systemd timers on scraper-vps.

**Spec reference:** `docs/superpowers/specs/2026-04-29-plan-d-settlement-refactor-design.md`

---

## Prerequisites

Before starting Phase 1, confirm:

1. **Working tree synced to current production state** — local repo `master` HEAD is `6946f77` (pre-mig-028) but production runs migrations through 150 with `events_v2`/`markets_v2`/`outcomes_v2` schema. Execution must happen against scraper-vps `/root/betssolution-admin/` or a worktree synced from there. The dev workspace pointed to in this plan is the conceptual one; concrete paths assume current prod state.

2. **Worktree** — create one for this work to isolate from any other in-flight branches:
   ```bash
   git worktree add ../betssolution-admin-plan-d -b feature/plan-d-settlement
   cd ../betssolution-admin-plan-d
   ```

3. **DB credentials available** for staging+prod (per memory: in `scripts/db/apply-mig.mjs` hardcoded, NOT in env files).

4. **vitest configured** — confirm by running `npx vitest --version` (memory says "30/30 vitest pass" in odds-api-ingester, so it's installed).

5. **Branch from `master`** (current prod-deployed branch).

---

## File Structure

### New files

| Path | Responsibility | LoC |
|---|---|---|
| `lib/settlement/market-classification.ts` | TS dict `MARKET_CATEGORIES` + helpers `classify()`, `isScoreOnly()`, `requiresStats()`, `requiresPlayer()` | ~150 |
| `lib/settlement/market-categories-seed.json` | Generated artifact — JSON dump of `MARKET_CATEGORIES`, committed to git for reproducibility | ~auto |
| `lib/settlement/odds-api-result.ts` | `buildResultFromOddsApi(events_v2.scores)` returning the same `Result` shape `buildResult()` produces today | ~100 |
| `lib/settlement/stats-settlers.ts` | `STATS_SETTLERS` dispatch (corners, cards, shots, tackles), reading from `events.live_data.stats` | ~250 |
| `lib/settlement/player-settlers.ts` | `PLAYER_SETTLERS` dispatch (anytime/multi/team goalscorer, player props), reading from `events.live_data.scorers` | ~200 |
| `lib/settlement/special-dispatcher.ts` | `SPECIAL_DISPATCHER` that returns `verdict='manual_required'` for v1 — no auto-settle | ~50 |
| `app/api/cron/odds-api-settle/route.ts` | New cron endpoint, every 1 min via systemd timer | ~250 |
| `app/api/admin/settlement-coverage/list/route.ts` | GET → `{ kpis, markets[] }` with filter query params | ~100 |
| `app/api/admin/settlement-coverage/drill-down/route.ts` | GET ?market_type=X → recent bets + events with that market | ~80 |
| `app/admin/settlement-coverage/page.tsx` | Server component, top-level page | ~80 |
| `app/admin/settlement-coverage/components/kpi-strip.tsx` | 4-card KPI display | ~80 |
| `app/admin/settlement-coverage/components/catalog-table.tsx` | Sortable + filterable market catalog | ~250 |
| `app/admin/settlement-coverage/components/drill-down-modal.tsx` | Modal showing bets + events per market | ~150 |
| `scripts/build/export-market-categories.mjs` | Build-time script: TS dict → `market-categories-seed.json` + check vs DB seed | ~80 |
| `supabase/migrations/152_settlement_coverage.sql` | `events_v2.last_settled_at` column + index, `market_categories_seed` table, 3 RPCs | ~200 |
| `supabase/migrations/153_settlement_log_shadow.sql` | `settlement_log_shadow` table for Phase 2 shadow comparison | ~50 |
| `tests/lib/settlement/market-classification.test.ts` | Every dict entry covered, unknown-market fallback | ~200 |
| `tests/lib/settlement/odds-api-result.test.ts` | All sport/period combos | ~150 |
| `tests/lib/settlement/stats-settlers.test.ts` | Each stats market, edge cases (no stats → null verdict) | ~200 |
| `tests/lib/settlement/player-settlers.test.ts` | Each player market, edge cases (own goal, sub minute) | ~150 |
| `tests/lib/settlement/special-dispatcher.test.ts` | All specials return `manual_required` | ~50 |
| `tests/api/cron/odds-api-settle.test.ts` | Shadow + live mode, dedup, mixed events | ~250 |
| `tests/integration/100-bets-settlement.test.ts` | Loops over fixture, asserts verdict per bet | ~80 |
| `tests/fixtures/settlement/100-bets.json` | 60 score / 20 stats / 15 player / 5 special fixture entries | ~auto |
| `tests/fixtures/settlement/100-bets.schema.json` | JSON Schema for fixture validation | ~50 |

### Modified files

| Path | Change | LoC delta |
|---|---|---|
| `lib/settlement.ts` | Add category-based dispatch in `settleEvent()` leg loop. Wire env flag `SETTLE_VIA_ODDS_API`. | +200, -0 |
| `app/api/cron/verify-results/route.ts` | Filter target events to those with stats/player pending legs only (skip pure-score events). | +30, -10 |
| `lib/sidebar-config.ts` (or wherever nav is defined) | Add "Settlement Coverage" nav entry under SISTEMA section. | +5 |
| `package.json` | Add `build:market-categories` script invoked pre-build. | +1 |
| `next.config.mjs` | Add env passthrough for `SETTLE_VIA_ODDS_API` if not already there. | +1 |

---

## Phase 0.5 — Baseline Measurement

> **Why first**: Spec §13 success criteria currently say `[BASELINE_FROM_PHASE_0.5]`. Concrete numbers needed before we know what "good" looks like.

### Task 0.5.1: Measure current settlement metrics

**Files:**
- Create: `scripts/diagnostic/baseline-settlement-metrics.sql` (one-shot query bundle)

- [ ] **Step 1: Write the diagnostic SQL**

```sql
-- scripts/diagnostic/baseline-settlement-metrics.sql

-- Query 1: bet legs by likely-category, last 30d
-- (uses LIKE pattern as a temporary heuristic; replaced by seed-table JOIN post-mig 152)
WITH classified AS (
  SELECT bs.id, bs.result, m.market_type, b.created_at,
    CASE
      WHEN m.market_type ~* '(corner|cartellin|card|tiri|shot|tackle|fall|foul)' THEN 'stats'
      WHEN m.market_type ~* '(marcator|player|scorer|assist)' THEN 'player'
      WHEN m.market_type ~* '(method|metodo|first 10|primi 10|specials?)' THEN 'special'
      ELSE 'score'  -- default; refined later
    END AS heuristic_category
  FROM bet_selections bs
  JOIN bets b ON b.id = bs.bet_id
  JOIN markets m ON m.id = bs.market_id
  WHERE b.created_at > NOW() - INTERVAL '30 days'
)
SELECT heuristic_category,
  count(*) AS legs,
  round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct,
  count(*) FILTER (WHERE result = 'won') AS won,
  count(*) FILTER (WHERE result = 'lost') AS lost,
  count(*) FILTER (WHERE result = 'void') AS void,
  count(*) FILTER (WHERE result IS NULL) AS pending
FROM classified
GROUP BY heuristic_category
ORDER BY legs DESC;

-- Query 2: settlement latency p50/p90 (last 7d)
SELECT
  percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (e.settled_at - e.starts_at))/60) AS p50_min,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (e.settled_at - e.starts_at))/60) AS p90_min,
  count(*) AS settled_events
FROM events e
WHERE e.settled_at > NOW() - INTERVAL '7 days'
  AND e.status IN ('finished', 'ended');

-- Query 3: Flashscore call volume (proxy: events with FS-fetched stats in last 24h)
SELECT count(*) AS events_with_fs_stats_24h
FROM events
WHERE updated_at > NOW() - INTERVAL '24 hours'
  AND live_data ? 'stats';

-- Query 4: % events_v2 with mapped_event_id (predicts Trigger A coverage)
SELECT 
  count(*) FILTER (WHERE mapped_event_id IS NOT NULL) AS mapped,
  count(*) AS total,
  round(100.0 * count(*) FILTER (WHERE mapped_event_id IS NOT NULL) / count(*), 1) AS pct_mapped
FROM events_v2
WHERE date_iso > NOW() - INTERVAL '30 days';
```

- [ ] **Step 2: Run on prod via apply-mig.mjs read-only mode (or psql)**

Run:
```bash
PGPASSWORD=2MQhskawT3I6XVKW psql \
  "postgresql://postgres@aws-1-eu-central-1.pooler.supabase.com:5432/postgres" \
  -f scripts/diagnostic/baseline-settlement-metrics.sql > /tmp/baseline-output.txt
```

Expected: 4 query result blocks, no errors.

- [ ] **Step 3: Update spec §13 with concrete numbers**

Open `docs/superpowers/specs/2026-04-29-plan-d-settlement-refactor-design.md`, replace `[BASELINE_FROM_PHASE_0.5]` placeholder in §13 with actual measured value. Compute target as `(score-only baseline %) − 5pp`.

Also note baseline latency p50/p90 + FS call volume in §13 for Phase 4 success comparison.

- [ ] **Step 4: Commit baseline + spec update**

```bash
git add scripts/diagnostic/baseline-settlement-metrics.sql \
        docs/superpowers/specs/2026-04-29-plan-d-settlement-refactor-design.md
git commit -m "chore(plan-d): baseline measurement + spec target refinement"
```

---

## Phase 1 — Classification module + Admin page (D.1)

### Task 1.1: Classification module + tests (TDD)

**Files:**
- Create: `lib/settlement/market-classification.ts`
- Create: `tests/lib/settlement/market-classification.test.ts`

- [ ] **Step 1: Write failing tests first**

```typescript
// tests/lib/settlement/market-classification.test.ts
import { describe, expect, it } from 'vitest';
import {
  classify,
  MARKET_CATEGORIES,
  isScoreOnly,
  requiresStats,
  requiresPlayer,
  type Category,
} from '@/lib/settlement/market-classification';

describe('market-classification', () => {
  describe('score-only markets', () => {
    const scoreMarkets = [
      '1X2', 'U/O 2.5', 'GG/NG', 'Doppia Chance',
      'Vincente Incontro', 'Esatto', 'Risultato Esatto',
      'Pari/Dispari Goal', 'Numero Goal', 'Handicap Asiatico',
      'HT/FT', 'Spread', 'U/O 2.5 1T', 'GG/NG 1T',
    ];
    it.each(scoreMarkets)('classifies "%s" as score', (mt) => {
      expect(classify(mt)).toBe('score');
      expect(isScoreOnly(mt)).toBe(true);
    });
  });

  describe('stats markets', () => {
    const statsMarkets = [
      'Corner', 'Totale Corner', 'U/O Corner 9.5',
      'Cartellini', 'Totale Cartellini', 'U/O Cartellini 4.5',
      'Tiri Totali', 'Tiri in Porta', 'Salvataggi Portiere',
      'Tackles Totali',
    ];
    it.each(statsMarkets)('classifies "%s" as stats', (mt) => {
      expect(classify(mt)).toBe('stats');
      expect(requiresStats(mt)).toBe(true);
    });
  });

  describe('player markets', () => {
    const playerMarkets = [
      'Marcatore', 'Multi Marcatori', 'Marcatore Squadra Casa',
      'Tiri Giocatore', 'Falli Subiti Giocatore',
      'Marca o Assist',
    ];
    it.each(playerMarkets)('classifies "%s" as player', (mt) => {
      expect(classify(mt)).toBe('player');
      expect(requiresPlayer(mt)).toBe(true);
    });
  });

  describe('special markets', () => {
    it('classifies "Metodo Goal" as special', () => {
      expect(classify('Metodo Goal')).toBe('special');
    });
    it('classifies "Primi 10 Minuti" as special', () => {
      expect(classify('Primi 10 Minuti')).toBe('special');
    });
  });

  describe('fail-safe', () => {
    it('classifies unknown market as "special" with no error', () => {
      expect(classify('Some Future Brand New Market')).toBe('special');
    });
    it('exposes the dict as a frozen const', () => {
      expect(() => {
        // @ts-expect-error - runtime mutation should fail
        MARKET_CATEGORIES['1X2'] = 'stats';
      }).toThrow();
    });
  });

  describe('coverage completeness', () => {
    it('every market in dict has valid category', () => {
      const validCategories: Category[] = ['score', 'stats', 'player', 'special'];
      for (const [mt, cat] of Object.entries(MARKET_CATEGORIES)) {
        expect(validCategories).toContain(cat);
      }
    });
    it('dict has at least 50 entries (full catalog)', () => {
      expect(Object.keys(MARKET_CATEGORIES).length).toBeGreaterThanOrEqual(50);
    });
  });
});
```

- [ ] **Step 2: Run tests, verify they FAIL**

Run: `npx vitest run tests/lib/settlement/market-classification.test.ts`
Expected: FAIL with "Cannot find module '@/lib/settlement/market-classification'".

- [ ] **Step 3: Implement classification module**

```typescript
// lib/settlement/market-classification.ts

export type Category = 'score' | 'stats' | 'player' | 'special';

/**
 * MARKET_CATEGORIES — single source of truth for market → category mapping.
 *
 * Keys are Italian market_type strings as produced by derive_legacy_from_v2()
 * RPC (mig 146 + translations mig 149). Values are categories that drive
 * settlement routing and admin page display.
 *
 * NEVER mutate at runtime. Updates require:
 *   1. edit this dict
 *   2. run `npm run build:market-categories` to regenerate seed JSON
 *   3. include the regenerated JSON + a migration row insert in the same PR
 */
export const MARKET_CATEGORIES: Readonly<Record<string, Category>> = Object.freeze({
  // ========== 🟢 SCORE-ONLY (settable from events_v2.scores + periods) ==========
  '1X2': 'score',
  '1X2 1T': 'score',
  '1X2 2T': 'score',
  'Vincente Incontro': 'score',  // ML alias
  'Doppia Chance': 'score',
  'Doppia Chance 1T': 'score',
  'Doppia Chance 2T': 'score',
  'Pareggio Escluso': 'score',  // DNB
  'Handicap Asiatico': 'score',
  'Handicap Europeo': 'score',
  'Spread': 'score',
  'Spread 1T': 'score',
  'Spread 2T': 'score',
  'U/O 0.5': 'score', 'U/O 1.5': 'score', 'U/O 2.5': 'score',
  'U/O 3.5': 'score', 'U/O 4.5': 'score', 'U/O 5.5': 'score',
  'U/O 0.5 1T': 'score', 'U/O 1.5 1T': 'score', 'U/O 2.5 1T': 'score',
  'U/O 0.5 2T': 'score', 'U/O 1.5 2T': 'score',
  'GG/NG': 'score',
  'GG/NG 1T': 'score',
  'GG/NG 2T': 'score',
  'HT/FT': 'score',
  'Risultato Esatto': 'score',
  'Risultato Esatto 1T': 'score',
  'Esatto': 'score',  // alias
  'Numero Goal': 'score',
  'Pari/Dispari Goal': 'score',
  'Pari/Dispari': 'score',
  'Goal/No Goal Squadra Casa': 'score',
  'Goal/No Goal Squadra Trasferta': 'score',
  'Totale Goal Squadra Casa': 'score',
  'Totale Goal Squadra Trasferta': 'score',
  'Risultato Finale': 'score',  // 1X2 alias
  'Linea Goal': 'score',  // alternative goal line

  // ========== 🟡 STATS (need corners/cards/shots/tackles count from FS) ==========
  'Corner': 'stats',
  'Totale Corner': 'stats',
  'Corner 2-Way': 'stats',
  'Corner Race': 'stats',
  'Corner Spread': 'stats',
  'Corner Handicap': 'stats',
  'U/O Corner 7.5': 'stats', 'U/O Corner 8.5': 'stats', 'U/O Corner 9.5': 'stats',
  'U/O Corner 10.5': 'stats', 'U/O Corner 11.5': 'stats', 'U/O Corner 12.5': 'stats',
  'Corner 1T': 'stats',
  'Totale Corner 1T': 'stats',
  'Corner Squadra Casa': 'stats',
  'Corner Squadra Trasferta': 'stats',
  'Cartellini': 'stats',
  'Totale Cartellini': 'stats',
  'U/O Cartellini 3.5': 'stats', 'U/O Cartellini 4.5': 'stats', 'U/O Cartellini 5.5': 'stats',
  'Tiri Totali': 'stats',
  'Tiri in Porta': 'stats',
  'Tiri Squadra Casa': 'stats', 'Tiri Squadra Trasferta': 'stats',
  'Tiri in Porta Casa': 'stats', 'Tiri in Porta Trasferta': 'stats',
  'Salvataggi Portiere': 'stats',
  'Tackles Totali': 'stats',
  'Tackles Squadra Casa': 'stats', 'Tackles Squadra Trasferta': 'stats',

  // ========== 🔴 PLAYER (need who-scored/assists/cards-per-player from FS) ==========
  'Marcatore': 'player',  // Anytime Goalscorer
  'Primo Marcatore': 'player',
  'Ultimo Marcatore': 'player',
  'Multi Marcatori': 'player',
  'Marcatore Squadra Casa': 'player',
  'Marcatore Squadra Trasferta': 'player',
  'Marca o Assist': 'player',
  'Tiri Giocatore': 'player',
  'Tiri in Porta Giocatore': 'player',
  'Falli Commessi Giocatore': 'player',
  'Falli Subiti Giocatore': 'player',
  'Tackles Giocatore': 'player',

  // ========== ⚪ SPECIAL (case-by-case, v1 = manual_required) ==========
  'Metodo Goal': 'special',
  'Primi 10 Minuti': 'special',
  'Specials': 'special',
});

export function classify(market_type: string): Category {
  // Trimmed lookup with fail-safe fallback to 'special' (manual handling)
  const trimmed = market_type.trim();
  return MARKET_CATEGORIES[trimmed] ?? 'special';
}

export function isScoreOnly(market_type: string): boolean {
  return classify(market_type) === 'score';
}

export function requiresStats(market_type: string): boolean {
  return classify(market_type) === 'stats';
}

export function requiresPlayer(market_type: string): boolean {
  return classify(market_type) === 'player';
}

/** Returns true when settlement requires Flashscore (or any external stats source). */
export function requiresExternalStats(market_type: string): boolean {
  const cat = classify(market_type);
  return cat === 'stats' || cat === 'player';
}
```

- [ ] **Step 4: Run tests, verify they PASS**

Run: `npx vitest run tests/lib/settlement/market-classification.test.ts`
Expected: PASS, all describe blocks green, ≥50 dict entries asserted.

- [ ] **Step 5: Commit**

```bash
git add lib/settlement/market-classification.ts \
        tests/lib/settlement/market-classification.test.ts
git commit -m "feat(settlement): market classification dict + helpers (Plan D.1 step 1)"
```

---

### Task 1.2: Build script — TS dict → JSON seed artifact

**Files:**
- Create: `scripts/build/export-market-categories.mjs`
- Modify: `package.json` (add `build:market-categories` script)
- Generated: `lib/settlement/market-categories-seed.json` (committed)

- [ ] **Step 1: Write the export script**

```javascript
// scripts/build/export-market-categories.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Use tsx to import TS file directly
const { MARKET_CATEGORIES } = await import('../../lib/settlement/market-classification.ts');

const output = {
  __generated__: new Date().toISOString(),
  __source__: 'lib/settlement/market-classification.ts',
  categories: MARKET_CATEGORIES,
  count: Object.keys(MARKET_CATEGORIES).length,
};

const dest = resolve(import.meta.dirname, '../../lib/settlement/market-categories-seed.json');
writeFileSync(dest, JSON.stringify(output, null, 2) + '\n');

console.log(`✔ exported ${output.count} categories to ${dest}`);
```

- [ ] **Step 2: Add npm script to package.json**

Modify `package.json`:
```json
{
  "scripts": {
    "build:market-categories": "tsx scripts/build/export-market-categories.mjs",
    "prebuild": "npm run build:market-categories"
  }
}
```

- [ ] **Step 3: Run script, verify output file**

Run: `npm run build:market-categories`
Expected: `✔ exported 70 categories to .../market-categories-seed.json` (count may differ — assert ≥50).

Run: `cat lib/settlement/market-categories-seed.json | head -20`
Expected: JSON with `__generated__`, `categories: {...}`, `count: 70`.

- [ ] **Step 4: Commit**

```bash
git add scripts/build/export-market-categories.mjs \
        lib/settlement/market-categories-seed.json \
        package.json
git commit -m "build(settlement): export MARKET_CATEGORIES to seed JSON (Plan D.1 step 2)"
```

---

### Task 1.3: Migration 152 — `events_v2.last_settled_at` + `market_categories_seed` table + RPCs (single atomic file)

> **Important**: this is one migration file authored once, applied once. Earlier draft of this plan split it across 3 incremental tasks — that was rejected by review (mid-build `_migrations` desync risk). Author the full SQL below in one task.

**Files:**
- Create: `supabase/migrations/152_settlement_coverage.sql` (full file authored here)
- Create: `supabase/migrations/152_settlement_coverage_rollback.sql` (rollback SQL, for ops use)

- [ ] **Step 1: Author full migration SQL (single atomic transaction)**

```sql
-- supabase/migrations/152_settlement_coverage.sql
-- Plan D — Settlement Coverage observability + Trigger A dedup
-- Author once, apply once. Rollback via 152_settlement_coverage_rollback.sql.

BEGIN;

-- ========== Part A: events_v2.last_settled_at (Trigger A dedup token) ==========

ALTER TABLE events_v2
  ADD COLUMN IF NOT EXISTS last_settled_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_events_v2_settled_pending
  ON events_v2 (date_iso ASC)
  WHERE status = 'settled' AND last_settled_at IS NULL;

COMMENT ON COLUMN events_v2.last_settled_at IS
  'Plan D Trigger A dedup: set when odds-api-settle cron has processed this event.';

-- ========== Part B: market_categories_seed table + initial seed ==========

CREATE TABLE IF NOT EXISTS market_categories_seed (
  market_type TEXT PRIMARY KEY,
  category    TEXT NOT NULL CHECK (category IN ('score','stats','player','special')),
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE market_categories_seed IS
  'Plan D — mirror of lib/settlement/market-classification.ts MARKET_CATEGORIES dict. Updates: regenerate from TS, insert via migration. Never edited directly in prod.';

-- Seed data (copy-paste from lib/settlement/market-categories-seed.json)
-- IMPORTANT: this list MUST match the TS dict exactly. CI test enforces equality.
INSERT INTO market_categories_seed (market_type, category) VALUES
  -- score-only
  ('1X2', 'score'),
  ('1X2 1T', 'score'),
  ('1X2 2T', 'score'),
  ('Vincente Incontro', 'score'),
  ('Doppia Chance', 'score'),
  ('Doppia Chance 1T', 'score'),
  ('Doppia Chance 2T', 'score'),
  ('Pareggio Escluso', 'score'),
  ('Handicap Asiatico', 'score'),
  ('Handicap Europeo', 'score'),
  ('Spread', 'score'),
  ('Spread 1T', 'score'),
  ('Spread 2T', 'score'),
  ('U/O 0.5', 'score'), ('U/O 1.5', 'score'), ('U/O 2.5', 'score'),
  ('U/O 3.5', 'score'), ('U/O 4.5', 'score'), ('U/O 5.5', 'score'),
  ('U/O 0.5 1T', 'score'), ('U/O 1.5 1T', 'score'), ('U/O 2.5 1T', 'score'),
  ('U/O 0.5 2T', 'score'), ('U/O 1.5 2T', 'score'),
  ('GG/NG', 'score'),
  ('GG/NG 1T', 'score'),
  ('GG/NG 2T', 'score'),
  ('HT/FT', 'score'),
  ('Risultato Esatto', 'score'),
  ('Risultato Esatto 1T', 'score'),
  ('Esatto', 'score'),
  ('Numero Goal', 'score'),
  ('Pari/Dispari Goal', 'score'),
  ('Pari/Dispari', 'score'),
  ('Goal/No Goal Squadra Casa', 'score'),
  ('Goal/No Goal Squadra Trasferta', 'score'),
  ('Totale Goal Squadra Casa', 'score'),
  ('Totale Goal Squadra Trasferta', 'score'),
  ('Risultato Finale', 'score'),
  ('Linea Goal', 'score'),
  -- stats
  ('Corner', 'stats'),
  ('Totale Corner', 'stats'),
  ('Corner 2-Way', 'stats'),
  ('Corner Race', 'stats'),
  ('Corner Spread', 'stats'),
  ('Corner Handicap', 'stats'),
  ('U/O Corner 7.5', 'stats'), ('U/O Corner 8.5', 'stats'), ('U/O Corner 9.5', 'stats'),
  ('U/O Corner 10.5', 'stats'), ('U/O Corner 11.5', 'stats'), ('U/O Corner 12.5', 'stats'),
  ('Corner 1T', 'stats'),
  ('Totale Corner 1T', 'stats'),
  ('Corner Squadra Casa', 'stats'),
  ('Corner Squadra Trasferta', 'stats'),
  ('Cartellini', 'stats'),
  ('Totale Cartellini', 'stats'),
  ('U/O Cartellini 3.5', 'stats'), ('U/O Cartellini 4.5', 'stats'), ('U/O Cartellini 5.5', 'stats'),
  ('Tiri Totali', 'stats'),
  ('Tiri in Porta', 'stats'),
  ('Tiri Squadra Casa', 'stats'), ('Tiri Squadra Trasferta', 'stats'),
  ('Tiri in Porta Casa', 'stats'), ('Tiri in Porta Trasferta', 'stats'),
  ('Salvataggi Portiere', 'stats'),
  ('Tackles Totali', 'stats'),
  ('Tackles Squadra Casa', 'stats'), ('Tackles Squadra Trasferta', 'stats'),
  -- player
  ('Marcatore', 'player'),
  ('Primo Marcatore', 'player'),
  ('Ultimo Marcatore', 'player'),
  ('Multi Marcatori', 'player'),
  ('Marcatore Squadra Casa', 'player'),
  ('Marcatore Squadra Trasferta', 'player'),
  ('Marca o Assist', 'player'),
  ('Tiri Giocatore', 'player'),
  ('Tiri in Porta Giocatore', 'player'),
  ('Falli Commessi Giocatore', 'player'),
  ('Falli Subiti Giocatore', 'player'),
  ('Tackles Giocatore', 'player'),
  -- special
  ('Metodo Goal', 'special'),
  ('Primi 10 Minuti', 'special'),
  ('Specials', 'special')
ON CONFLICT (market_type) DO UPDATE SET
  category = EXCLUDED.category,
  updated_at = NOW();

-- ========== Part C: RPCs (settlement_coverage_kpis, settlement_coverage_list, next_unsettled_with_stats_legs) ==========
-- (Full RPC bodies inlined here — see Task 1.3 Step 2 below for the SQL)

COMMIT;
```

The RPC SQL (full body of `settlement_coverage_kpis`, `settlement_coverage_list`, `next_unsettled_with_stats_legs`) is shown in **Step 2** below. Concatenate it INSIDE the same `BEGIN...COMMIT` block at the position marked `-- ========== Part C ==========`. Do NOT split into separate transactions.

- [ ] **Step 2: Append RPC bodies to the same migration file (before COMMIT)**

```sql
-- ========== Part C: RPCs ==========

-- settlement_coverage_kpis(window_days int)
DROP FUNCTION IF EXISTS settlement_coverage_kpis(int);
CREATE FUNCTION settlement_coverage_kpis(window_days int DEFAULT 7)
RETURNS TABLE(
  category TEXT, legs_total BIGINT, legs_won BIGINT, legs_lost BIGINT,
  legs_void BIGINT, legs_pending BIGINT, stake_total NUMERIC
)
LANGUAGE sql STABLE
AS $$
  SELECT
    COALESCE(mcs.category, 'unclassified') AS category,
    count(*) AS legs_total,
    count(*) FILTER (WHERE bs.result = 'won') AS legs_won,
    count(*) FILTER (WHERE bs.result = 'lost') AS legs_lost,
    count(*) FILTER (WHERE bs.result = 'void') AS legs_void,
    count(*) FILTER (WHERE bs.result IS NULL) AS legs_pending,
    COALESCE(sum(b.stake), 0) AS stake_total
  FROM bet_selections bs
  JOIN bets b ON b.id = bs.bet_id
  JOIN markets m ON m.id = bs.market_id
  LEFT JOIN market_categories_seed mcs ON mcs.market_type = m.market_type
  WHERE b.created_at > NOW() - (window_days || ' days')::interval
  GROUP BY COALESCE(mcs.category, 'unclassified');
$$;

GRANT EXECUTE ON FUNCTION settlement_coverage_kpis(int) TO anon, authenticated, service_role;

-- settlement_coverage_list(window_days int)
DROP FUNCTION IF EXISTS settlement_coverage_list(int);
CREATE FUNCTION settlement_coverage_list(window_days int DEFAULT 30)
RETURNS TABLE(
  market_type TEXT, category TEXT, sport TEXT, bet_count BIGINT,
  auto_settled BIGINT, manual_settled BIGINT, void_settled BIGINT,
  pending BIGINT, last_seen_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
  SELECT
    m.market_type,
    COALESCE(mcs.category, 'unclassified') AS category,
    s.name AS sport,
    count(*) AS bet_count,
    count(*) FILTER (WHERE bs.result IN ('won','lost')) AS auto_settled,
    0::BIGINT AS manual_settled,
    count(*) FILTER (WHERE bs.result = 'void') AS void_settled,
    count(*) FILTER (WHERE bs.result IS NULL) AS pending,
    max(b.created_at) AS last_seen_at
  FROM bet_selections bs
  JOIN bets b ON b.id = bs.bet_id
  JOIN markets m ON m.id = bs.market_id
  JOIN events e ON e.id = m.event_id
  JOIN sports s ON s.id = e.sport_id
  LEFT JOIN market_categories_seed mcs ON mcs.market_type = m.market_type
  WHERE b.created_at > NOW() - (window_days || ' days')::interval
  GROUP BY m.market_type, COALESCE(mcs.category, 'unclassified'), s.name
  ORDER BY count(*) DESC;
$$;

GRANT EXECUTE ON FUNCTION settlement_coverage_list(int) TO anon, authenticated, service_role;

-- next_unsettled_with_stats_legs(lim int) — Trigger B helper
DROP FUNCTION IF EXISTS next_unsettled_with_stats_legs(int);
CREATE FUNCTION next_unsettled_with_stats_legs(lim int DEFAULT 100)
RETURNS TABLE(
  event_id UUID, external_id TEXT, flashscore_id TEXT,
  starts_at TIMESTAMPTZ, sport_name TEXT
)
LANGUAGE sql STABLE
AS $$
  SELECT DISTINCT ON (e.id)
    e.id, e.external_id, e.flashscore_id, e.starts_at, s.name AS sport_name
  FROM events e
  JOIN sports s ON s.id = e.sport_id
  JOIN markets m ON m.event_id = e.id
  JOIN bet_selections bs ON bs.market_id = m.id
  LEFT JOIN market_categories_seed mcs ON mcs.market_type = m.market_type
  WHERE e.status IN ('finished', 'ended')
    AND e.settled_at IS NULL
    AND bs.result IS NULL
    AND COALESCE(mcs.category, 'unclassified') IN ('stats', 'player', 'special', 'unclassified')
  ORDER BY e.id, e.updated_at ASC
  LIMIT lim;
$$;

GRANT EXECUTE ON FUNCTION next_unsettled_with_stats_legs(int) TO anon, authenticated, service_role;
```

- [ ] **Step 3: Author rollback file**

```sql
-- supabase/migrations/152_settlement_coverage_rollback.sql
-- Use ONLY if 152 partially applied or needs unwind. Manual ops, not auto-run.
BEGIN;
DROP FUNCTION IF EXISTS next_unsettled_with_stats_legs(int);
DROP FUNCTION IF EXISTS settlement_coverage_list(int);
DROP FUNCTION IF EXISTS settlement_coverage_kpis(int);
DROP TABLE IF EXISTS market_categories_seed;
DROP INDEX IF EXISTS idx_events_v2_settled_pending;
ALTER TABLE events_v2 DROP COLUMN IF EXISTS last_settled_at;
DELETE FROM _migrations WHERE filename = '152_settlement_coverage.sql';
COMMIT;
```

- [ ] **Step 4: Apply on staging (atomic, single shot)**

Run:
```bash
node scripts/db/apply-mig.mjs --target staging --file supabase/migrations/152_settlement_coverage.sql
```

Expected: `✔ Applied 152_settlement_coverage.sql to staging` + `_migrations` row inserted. Single transaction → all parts succeed or none.

- [ ] **Step 5: Verify on staging**

Run each:
```bash
node scripts/db/apply-mig.mjs --target staging --query "SELECT count(*) FROM market_categories_seed;"
node scripts/db/apply-mig.mjs --target staging --query "SELECT category, count(*) FROM settlement_coverage_kpis(30) ORDER BY 1;"
node scripts/db/apply-mig.mjs --target staging --query "SELECT count(*) FROM next_unsettled_with_stats_legs(1000);"
```
Expected: ~80 seed rows; KPI returns 4 rows (score/stats/player/special) + maybe 'unclassified'; stats-leg count ≤ events.finished-with-pending-legs.

- [ ] **Step 6: Apply on prod**

Run: `node scripts/db/apply-mig.mjs --target prod --file supabase/migrations/152_settlement_coverage.sql`
Expected: same success on prod.

- [ ] **Step 7: CI test — TS dict ↔ seed table equality**

Add test `tests/lib/settlement/market-categories-seed.equality.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import seedJson from '@/lib/settlement/market-categories-seed.json';
import { MARKET_CATEGORIES } from '@/lib/settlement/market-classification';

describe('market-categories-seed.json equality', () => {
  it('has same key count as TS dict', () => {
    expect(Object.keys(seedJson.categories).length).toBe(Object.keys(MARKET_CATEGORIES).length);
  });
  it('every TS entry is in seed JSON with same category', () => {
    for (const [mt, cat] of Object.entries(MARKET_CATEGORIES)) {
      expect(seedJson.categories[mt]).toBe(cat);
    }
  });
  it('every seed entry is in TS dict', () => {
    for (const mt of Object.keys(seedJson.categories)) {
      expect(MARKET_CATEGORIES[mt as keyof typeof MARKET_CATEGORIES]).toBeDefined();
    }
  });
});
```

Run: `npx vitest run tests/lib/settlement/market-categories-seed.equality.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit (single migration + tests + rollback)**

```bash
git add supabase/migrations/152_settlement_coverage.sql \
        supabase/migrations/152_settlement_coverage_rollback.sql \
        tests/lib/settlement/market-categories-seed.equality.test.ts
git commit -m "feat(db): mig 152 — settlement coverage schema + RPCs + rollback (Plan D.1)"
```

---

### Task 1.4: API endpoint — `/api/admin/settlement-coverage/list`

**Files:**
- Create: `app/api/admin/settlement-coverage/list/route.ts`
- Create: `tests/api/admin/settlement-coverage/list.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/api/admin/settlement-coverage/list.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/admin/settlement-coverage/list/route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    rpc: vi.fn((fn, args) => {
      if (fn === 'settlement_coverage_kpis') {
        return Promise.resolve({
          data: [
            { category: 'score', legs_total: 800, legs_won: 400, legs_lost: 350, legs_void: 50, legs_pending: 0, stake_total: 8000 },
            { category: 'stats', legs_total: 100, legs_won: 40, legs_lost: 50, legs_void: 5, legs_pending: 5, stake_total: 1000 },
            { category: 'player', legs_total: 80, legs_won: 10, legs_lost: 60, legs_void: 5, legs_pending: 5, stake_total: 800 },
            { category: 'special', legs_total: 20, legs_won: 0, legs_lost: 0, legs_void: 0, legs_pending: 20, stake_total: 200 },
          ],
          error: null,
        });
      }
      if (fn === 'settlement_coverage_list') {
        return Promise.resolve({
          data: [
            { market_type: '1X2', category: 'score', sport: 'Calcio', bet_count: 500, auto_settled: 480, manual_settled: 0, void_settled: 20, pending: 0, last_seen_at: '2026-04-29T12:00:00Z' },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    }),
  }),
}));

describe('GET /api/admin/settlement-coverage/list', () => {
  it('returns kpis + markets shape with default 7-day window', async () => {
    const req = new NextRequest('http://localhost/api/admin/settlement-coverage/list');
    const res = await GET(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toHaveProperty('kpis');
    expect(json).toHaveProperty('markets');
    expect(json.kpis.score.legs_total).toBe(800);
    expect(json.kpis.score.pct_of_total).toBeCloseTo(80, 0);  // 800/1000
    expect(json.markets[0].market_type).toBe('1X2');
  });

  it('honours window query param', async () => {
    const req = new NextRequest('http://localhost/api/admin/settlement-coverage/list?window=30');
    const res = await GET(req);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL** (route module doesn't exist)

Run: `npx vitest run tests/api/admin/settlement-coverage/list.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement route**

```typescript
// app/api/admin/settlement-coverage/list/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type KpiRow = {
  category: string;
  legs_total: number;
  legs_won: number;
  legs_lost: number;
  legs_void: number;
  legs_pending: number;
  stake_total: number;
};

type MarketRow = {
  market_type: string;
  category: string;
  sport: string;
  bet_count: number;
  auto_settled: number;
  manual_settled: number;
  void_settled: number;
  pending: number;
  last_seen_at: string;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const window = Math.max(1, Math.min(90, parseInt(url.searchParams.get('window') ?? '7', 10)));

  const supa = createServerClient();
  const [kpiRes, listRes] = await Promise.all([
    supa.rpc('settlement_coverage_kpis', { window_days: window }),
    supa.rpc('settlement_coverage_list', { window_days: window }),
  ]);

  if (kpiRes.error || listRes.error) {
    return NextResponse.json(
      { error: kpiRes.error?.message ?? listRes.error?.message },
      { status: 500 }
    );
  }

  const kpiRows = (kpiRes.data ?? []) as KpiRow[];
  const total = kpiRows.reduce((acc, r) => acc + Number(r.legs_total), 0);
  const kpis: Record<string, KpiRow & { pct_of_total: number }> = {};
  for (const r of kpiRows) {
    kpis[r.category] = {
      ...r,
      legs_total: Number(r.legs_total),
      legs_won: Number(r.legs_won),
      legs_lost: Number(r.legs_lost),
      legs_void: Number(r.legs_void),
      legs_pending: Number(r.legs_pending),
      stake_total: Number(r.stake_total),
      pct_of_total: total === 0 ? 0 : Math.round((Number(r.legs_total) / total) * 1000) / 10,
    };
  }

  return NextResponse.json({
    window_days: window,
    kpis,
    markets: (listRes.data ?? []) as MarketRow[],
    generated_at: new Date().toISOString(),
  });
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npx vitest run tests/api/admin/settlement-coverage/list.test.ts`
Expected: PASS, both `it` blocks green.

- [ ] **Step 5: Smoke against staging DB**

Run: `npm run dev` then `curl http://localhost:3000/api/admin/settlement-coverage/list?window=7`
Expected: HTTP 200, JSON with `kpis` (4 categories) + `markets[]`.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/settlement-coverage/list/route.ts \
        tests/api/admin/settlement-coverage/list.test.ts
git commit -m "feat(api): settlement-coverage list endpoint (Plan D.1)"
```

---

### Task 1.5: API endpoint — `/api/admin/settlement-coverage/drill-down`

**Files:**
- Create: `app/api/admin/settlement-coverage/drill-down/route.ts`
- Create: `tests/api/admin/settlement-coverage/drill-down.test.ts`

Per-task structure same as Task 1.4: failing test → implement → verify → commit.

Endpoint contract: `GET /api/admin/settlement-coverage/drill-down?market_type=1X2&limit=20` → returns `{ recent_bets: [...], events_with_market: [...] }`.

Query: 2 parallel queries:
- `bet_selections` last 20 with `markets.market_type = ?`, joined with `bets`, ordered by `created_at desc`
- `events` last 20 with this market type that have ≥1 pending leg, joined with sport name, with `flashscore_id`/`has_score` flags

Code structure mirrors 1.6. Commit message: `feat(api): settlement-coverage drill-down endpoint (Plan D.1)`.

---

### Task 1.6: KPI strip component

**Files:**
- Create: `app/admin/settlement-coverage/components/kpi-strip.tsx`
- Create: `tests/components/admin/settlement-coverage/kpi-strip.test.tsx`

- [ ] **Step 1: Write failing component test**

```typescript
// tests/components/admin/settlement-coverage/kpi-strip.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KpiStrip } from '@/app/admin/settlement-coverage/components/kpi-strip';

describe('<KpiStrip>', () => {
  const sampleKpis = {
    score: { legs_total: 800, pct_of_total: 80, legs_pending: 0, stake_total: 8000 },
    stats: { legs_total: 100, pct_of_total: 10, legs_pending: 5, stake_total: 1000 },
    player: { legs_total: 80, pct_of_total: 8, legs_pending: 5, stake_total: 800 },
    special: { legs_total: 20, pct_of_total: 2, legs_pending: 20, stake_total: 200 },
  } as any;

  it('renders 4 cards', () => {
    render(<KpiStrip kpis={sampleKpis} window={7} />);
    expect(screen.getByText(/Score/i)).toBeInTheDocument();
    expect(screen.getByText(/Stats/i)).toBeInTheDocument();
    expect(screen.getByText(/Player/i)).toBeInTheDocument();
    expect(screen.getByText(/Special/i)).toBeInTheDocument();
  });

  it('shows pct_of_total prominently', () => {
    render(<KpiStrip kpis={sampleKpis} window={7} />);
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('shows pending count badge', () => {
    render(<KpiStrip kpis={sampleKpis} window={7} />);
    // special has 20 pending, should be most prominent
    expect(screen.getByText(/20 pending/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, FAIL** — `npx vitest run tests/components/admin/settlement-coverage/kpi-strip.test.tsx`

- [ ] **Step 3: Implement**

```tsx
// app/admin/settlement-coverage/components/kpi-strip.tsx
'use client';

type Kpi = {
  legs_total: number;
  pct_of_total: number;
  legs_pending: number;
  stake_total: number;
};

type Props = {
  kpis: Record<'score' | 'stats' | 'player' | 'special', Kpi | undefined>;
  window: number;
};

const CARDS: Array<{ key: keyof Props['kpis']; label: string; emoji: string; color: string }> = [
  { key: 'score', label: 'Score-only', emoji: '🟢', color: 'border-green-500' },
  { key: 'stats', label: 'Stats', emoji: '🟡', color: 'border-yellow-500' },
  { key: 'player', label: 'Player events', emoji: '🔴', color: 'border-red-500' },
  { key: 'special', label: 'Special', emoji: '⚪', color: 'border-gray-400' },
];

export function KpiStrip({ kpis, window }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
      {CARDS.map(({ key, label, emoji, color }) => {
        const k = kpis[key];
        const pct = k?.pct_of_total ?? 0;
        const pending = k?.legs_pending ?? 0;
        return (
          <div key={key} className={`border-l-4 ${color} bg-card rounded p-3`}>
            <div className="text-xs text-muted-foreground">{emoji} {label}</div>
            <div className="text-2xl font-semibold">{pct}%</div>
            <div className="text-xs">
              {k?.legs_total ?? 0} legs / {pending} pending
            </div>
            <div className="text-xs text-muted-foreground">
              €{((k?.stake_total ?? 0) / 1).toFixed(0)} staked / {window}d
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test, PASS**

- [ ] **Step 5: Commit**

```bash
git add app/admin/settlement-coverage/components/kpi-strip.tsx \
        tests/components/admin/settlement-coverage/kpi-strip.test.tsx
git commit -m "feat(ui): kpi-strip component for settlement-coverage page (Plan D.1)"
```

---

### Task 1.7: Catalog table component

**Files:**
- Create: `app/admin/settlement-coverage/components/catalog-table.tsx`
- Create: `tests/components/admin/settlement-coverage/catalog-table.test.tsx`

Same TDD structure. Component contract:
- Props: `markets: MarketRow[]`, `onRowClick: (market_type: string) => void`
- Columns: market_type, category badge (🟢🟡🔴⚪), sport, bet_count, auto_settled %, pending count, last_seen
- Filters: sport multi-select, category multi-select, "has pending" toggle, search by name
- Sortable by bet_count desc default

Implementation: ~250 LoC. Use existing `lib/admin/ui` primitives (`<Table>`, `<Badge>`, `<FilterPills>`) per Phase 1.F sidebar cleanup conventions.

Commit: `feat(ui): catalog-table component (Plan D.1)`

---

### Task 1.8: Drill-down modal

**Files:**
- Create: `app/admin/settlement-coverage/components/drill-down-modal.tsx`
- Create: `tests/components/admin/settlement-coverage/drill-down-modal.test.tsx`

Component contract:
- Open state controlled by parent
- Loads `/api/admin/settlement-coverage/drill-down?market_type=...` on open
- Two tabs: "Recent bets" (last 20) and "Events with market" (last 20)
- Each row in events tab shows flashscore_id presence + score availability flags

Implementation: ~150 LoC.

Commit: `feat(ui): drill-down modal (Plan D.1)`

---

### Task 1.9: Page assembly + nav entry

**Files:**
- Create: `app/admin/settlement-coverage/page.tsx`
- Modify: sidebar config (locate via `grep -r "label.*Risk.*Trading" app/admin/_components/`)

- [ ] **Step 1: Page**

```tsx
// app/admin/settlement-coverage/page.tsx
import { Suspense } from 'react';
import { KpiStrip } from './components/kpi-strip';
import { CatalogTable } from './components/catalog-table';
import { CoverageDataLoader } from './coverage-data-loader';

export const dynamic = 'force-dynamic';

export default function SettlementCoveragePage() {
  return (
    <div className="container py-6 max-w-screen-2xl">
      <h1 className="text-2xl font-bold mb-1">Settlement Coverage</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Classifica ogni market in 4 categorie. Verde = settlable da odds-api scores.
        Giallo/Rosso = richiede stats Flashscore. Bianco = manuale.
      </p>
      <Suspense fallback={<div>Caricamento…</div>}>
        <CoverageDataLoader />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 2: Data loader (client component)** — `app/admin/settlement-coverage/coverage-data-loader.tsx`

Fetches `/api/admin/settlement-coverage/list?window=7` on mount, manages window selector, passes data to KPI + Table. Uses `useSWR` if already in stack, else `useState + useEffect`.

- [ ] **Step 3: Sidebar nav entry**

Locate sidebar config — per Phase 1.F memory the post-cleanup sidebar has 12 entries grouped under OVERVIEW/SPORTSBOOK/SISTEMA/GESTIONE. Find via:
```bash
Grep -rn "Risk\&Trading\|SISTEMA\|GESTIONE" app/admin lib/ components/ --include="*.tsx" --include="*.ts"
```
Expected: locates one config file (likely `components/admin/sidebar/nav-config.ts` or similar). Add under SISTEMA section:
```typescript
{ label: 'Settlement Coverage', href: '/admin/settlement-coverage', icon: 'Activity' }
```

- [ ] **Step 4: E2E smoke**

Run `npm run dev`, visit `http://localhost:3000/admin/settlement-coverage`. Expected: page loads, KPI strip shows 4 cards, catalog table shows ≥10 rows, click row → modal opens.

- [ ] **Step 5: Commit**

```bash
git add app/admin/settlement-coverage/ <sidebar-file>
git commit -m "feat(ui): /admin/settlement-coverage page wired up (Plan D.1)"
```

---

### Task 1.10: Deploy D.1 to staging + prod

- [ ] **Step 1: Verify TS + tests + build**

Run: `npx tsc --noEmit && npx vitest run tests/lib/settlement tests/api/admin/settlement-coverage tests/components/admin/settlement-coverage && npm run build`
Expected: 0 errors.

- [ ] **Step 2: Push branch + open PR (if git desync resolved) or deploy direct via gh workflow**

Per memory, prod deploy is via `gh workflow run` not via merge. Confirm path before push.

- [ ] **Step 3: Smoke prod**

Visit `https://admin.betssolution.com/admin/settlement-coverage`. Expected: HTTP 200, KPI populated with real prod data, identifies any unclassified markets.

- [ ] **Step 4: User review gate**

Operator reviews the page. Confirm classification accuracy on top 20 most-bet markets. If any market misclassified, fix `MARKET_CATEGORIES` + re-run mig 152 ON CONFLICT update + re-deploy.

- [ ] **Step 5: Lock D.1 baseline + update spec §13 success criteria with measured numbers from prod**

Commit: `chore(plan-d): D.1 deployed prod, baseline numbers locked in spec`

---

## Phase 2 — Settlement engine refactor in shadow mode (D.2)

### Task 2.0: Extract `settleLeg` from `settleEvent` + add category branching

> **Why first**: Task 2.3's cron imports `settleLeg` as a pure function. Currently `lib/settlement.ts::settleEvent` mixes orchestration + DB I/O + leg verdict logic in one 1792-LoC file. Refactor to expose `settleLeg(result, leg) → verdict` as importable. Also wire the `SETTLE_VIA_ODDS_API` env flag toggle inside the dispatch.

**Files:**
- Modify: `lib/settlement.ts` (extract pure function, ~+200 / ~-0 LoC)
- Create: `tests/lib/settlement/settle-leg.test.ts` (test the extracted pure fn directly)

- [ ] **Step 1: Read the current settlement.ts to locate the leg loop**

Run: `Grep -n "for (const leg of legs)" lib/settlement.ts`
Expected: line ~1428 (per memory `2026-04-24-phase-b-canonical-settlement.md`).

- [ ] **Step 2: Write failing test for extracted `settleLeg`**

```typescript
// tests/lib/settlement/settle-leg.test.ts
import { describe, expect, it } from 'vitest';
import { settleLeg, type Result, type Leg } from '@/lib/settlement';

describe('settleLeg (pure)', () => {
  const r: Result = {
    home: 2, away: 1, ft: { home: 2, away: 1 }, ht: { home: 1, away: 0 },
    total: 3, periods: { fulltime: { home: 2, away: 1 }, p1: { home: 1, away: 0 } }
  };

  it('1X2 home win → won', () => {
    const leg: Leg = { id: 'l1', markets: { market_type: '1X2', line: null }, outcomes: { name: '1' } } as any;
    expect(settleLeg(r, leg)).toBe('won');
  });
  it('U/O 2.5 over with total 3 → won', () => {
    const leg: Leg = { id: 'l2', markets: { market_type: 'U/O 2.5', line: 2.5 }, outcomes: { name: 'Over' } } as any;
    expect(settleLeg(r, leg)).toBe('won');
  });
  it('unknown market_type → void', () => {
    const leg: Leg = { id: 'l3', markets: { market_type: 'Brand New Market', line: null }, outcomes: { name: 'X' } } as any;
    expect(settleLeg(r, leg)).toBe('void');
  });
});
```

- [ ] **Step 3: FAIL** (`settleLeg` not yet exported)

- [ ] **Step 4: Refactor — extract `settleLeg` from inside `settleEvent`'s for-loop**

In `lib/settlement.ts`:
1. Add export at top of file: `export type Leg = { id: string; markets: { market_type: string; line: number | null }; outcomes: { name: string } };`
2. Extract function (place above `settleEvent`):
```typescript
export function settleLeg(result: Result, leg: Leg): Verdict {
  const market = leg.markets;
  const outcome = leg.outcomes;
  const resolved = resolveSettlerKey(market.market_type, market.line);
  if (!resolved) return 'void';
  const settler = SETTLERS[resolved.key];
  if (!settler) return 'void';
  const line = resolved.line ?? market.line ?? undefined;
  return settler(result, outcome.name, line, resolved.setIdx);
}
```
3. In `settleEvent`'s leg loop, replace inline logic with `settleLeg(result, leg)`.

- [ ] **Step 5: PASS** (test green, also re-run existing settlement tests to confirm no regression)

Run: `npx vitest run tests/lib/settlement/`
Expected: all green, no behavior change for existing paths.

- [ ] **Step 6: Commit**

```bash
git add lib/settlement.ts tests/lib/settlement/settle-leg.test.ts
git commit -m "refactor(settlement): extract settleLeg as pure function (Plan D.2 prep)"
```

---

### Task 2.1: `buildResultFromOddsApi()` + tests

**Files:**
- Create: `lib/settlement/odds-api-result.ts`
- Create: `tests/lib/settlement/odds-api-result.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/settlement/odds-api-result.test.ts
import { describe, expect, it } from 'vitest';
import { buildResultFromOddsApi } from '@/lib/settlement/odds-api-result';

describe('buildResultFromOddsApi', () => {
  it('builds Result for football fulltime + p1', () => {
    const scores = {
      home: 3, away: 1,
      periods: { fulltime: { home: 3, away: 1 }, p1: { home: 1, away: 0 } },
    };
    const r = buildResultFromOddsApi(scores, 'football');
    expect(r).toEqual({
      home: 3, away: 1,
      ht: { home: 1, away: 0 },
      ft: { home: 3, away: 1 },
      total: 4,
      periods: { p1: { home: 1, away: 0 }, fulltime: { home: 3, away: 1 } },
    });
  });

  it('returns null when scores missing', () => {
    expect(buildResultFromOddsApi(null as any, 'football')).toBeNull();
  });

  it('handles tennis sets (p1..p5)', () => {
    const scores = {
      home: 2, away: 1,
      periods: { p1: { home: 6, away: 4 }, p2: { home: 4, away: 6 }, p3: { home: 7, away: 5 } },
    };
    const r = buildResultFromOddsApi(scores, 'tennis');
    expect(r?.home).toBe(2);
    expect(r?.periods?.p3?.home).toBe(7);
  });

  it('handles missing fulltime, falls back to root home/away', () => {
    const scores = { home: 2, away: 0, periods: { p1: { home: 1, away: 0 } } };
    const r = buildResultFromOddsApi(scores, 'football');
    expect(r?.ft).toEqual({ home: 2, away: 0 });
  });
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement**

```typescript
// lib/settlement/odds-api-result.ts
export type OddsApiScores = {
  home: number;
  away: number;
  periods?: Record<string, { home: number; away: number }>;
};

export type Result = {
  home: number;
  away: number;
  ht?: { home: number; away: number };
  ft: { home: number; away: number };
  total: number;
  periods?: Record<string, { home: number; away: number }>;
};

export function buildResultFromOddsApi(
  scores: OddsApiScores | null | undefined,
  sport: string
): Result | null {
  if (!scores || typeof scores.home !== 'number' || typeof scores.away !== 'number') {
    return null;
  }
  const periods = scores.periods ?? {};
  const fulltime = periods.fulltime ?? { home: scores.home, away: scores.away };
  const ht = periods.p1; // football half-time. Tennis: p1=set1, etc.

  return {
    home: scores.home,
    away: scores.away,
    ht,
    ft: fulltime,
    total: scores.home + scores.away,
    periods,
  };
}
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/settlement/odds-api-result.ts tests/lib/settlement/odds-api-result.test.ts
git commit -m "feat(settlement): buildResultFromOddsApi (Plan D.2)"
```

---

### Task 2.1a: `STATS_SETTLERS` dispatch table

**Files:**
- Create: `lib/settlement/stats-settlers.ts`
- Create: `tests/lib/settlement/stats-settlers.test.ts`

Pure functions that take `(stats: StatsPayload, outcome_name: string, line: number) → Verdict`. `StatsPayload` shape mirrors `events.live_data.stats` JSONB array `[{name, home, away}, ...]`.

- [ ] **Step 1: Failing test**

```typescript
// tests/lib/settlement/stats-settlers.test.ts
import { describe, expect, it } from 'vitest';
import { STATS_SETTLERS, type StatsPayload } from '@/lib/settlement/stats-settlers';

describe('STATS_SETTLERS', () => {
  const stats: StatsPayload = {
    corners: { home: 6, away: 5 },
    cards: { home: 2, away: 3 },
    shots: { home: 12, away: 8 },
    shots_on_target: { home: 5, away: 3 },
  };

  it('Totale Corner Over 9.5 (total=11) → won', () => {
    expect(STATS_SETTLERS['Totale Corner'](stats, 'Over', 9.5)).toBe('won');
  });
  it('Totale Corner Under 12.5 (total=11) → won', () => {
    expect(STATS_SETTLERS['Totale Corner'](stats, 'Under', 12.5)).toBe('won');
  });
  it('Totale Corner integer line push (total=11, line=11) → push', () => {
    expect(STATS_SETTLERS['Totale Corner'](stats, 'Over', 11)).toBe('push');
  });
  it('Totale Cartellini total=5 over 4.5 → won', () => {
    expect(STATS_SETTLERS['Totale Cartellini'](stats, 'Over', 4.5)).toBe('won');
  });
  it('Tiri Totali home=12 vs Under 11.5 → lost', () => {
    expect(STATS_SETTLERS['Tiri Squadra Casa'](stats, 'Under', 11.5)).toBe('lost');
  });
  it('returns null when stats payload missing the relevant key', () => {
    const empty = {} as StatsPayload;
    expect(STATS_SETTLERS['Totale Corner'](empty, 'Over', 9.5)).toBeNull();
  });
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement**

```typescript
// lib/settlement/stats-settlers.ts
export type StatsPayload = {
  corners?: { home: number; away: number };
  cards?: { home: number; away: number };
  shots?: { home: number; away: number };
  shots_on_target?: { home: number; away: number };
  tackles?: { home: number; away: number };
  saves?: { home: number; away: number };
};

export type Verdict = 'won' | 'lost' | 'push' | 'void' | null;

function totalsVerdict(total: number | undefined, sel: string, line: number): Verdict {
  if (total === undefined) return null;
  if (Math.abs(total - line) < 1e-9) return 'push';
  const isOver = sel.toLowerCase().includes('over') || sel === 'Over';
  if (isOver) return total > line ? 'won' : 'lost';
  return total < line ? 'won' : 'lost';
}

export const STATS_SETTLERS: Record<string, (s: StatsPayload, sel: string, line: number) => Verdict> = {
  'Totale Corner': (s, sel, line) => {
    if (!s.corners) return null;
    return totalsVerdict(s.corners.home + s.corners.away, sel, line);
  },
  'Corner Squadra Casa': (s, sel, line) => totalsVerdict(s.corners?.home, sel, line),
  'Corner Squadra Trasferta': (s, sel, line) => totalsVerdict(s.corners?.away, sel, line),
  'Totale Cartellini': (s, sel, line) => {
    if (!s.cards) return null;
    return totalsVerdict(s.cards.home + s.cards.away, sel, line);
  },
  'Tiri Totali': (s, sel, line) => {
    if (!s.shots) return null;
    return totalsVerdict(s.shots.home + s.shots.away, sel, line);
  },
  'Tiri Squadra Casa': (s, sel, line) => totalsVerdict(s.shots?.home, sel, line),
  'Tiri Squadra Trasferta': (s, sel, line) => totalsVerdict(s.shots?.away, sel, line),
  'Tiri in Porta': (s, sel, line) => {
    if (!s.shots_on_target) return null;
    return totalsVerdict(s.shots_on_target.home + s.shots_on_target.away, sel, line);
  },
  'Tackles Totali': (s, sel, line) => {
    if (!s.tackles) return null;
    return totalsVerdict(s.tackles.home + s.tackles.away, sel, line);
  },
  // U/O Corner X.5 lines: each is a separate market_type entry pointing to same handler
  ...Object.fromEntries(
    [7.5, 8.5, 9.5, 10.5, 11.5, 12.5].map(L => [
      `U/O Corner ${L}`,
      (s: StatsPayload, sel: string, _l: number) =>
        s.corners ? totalsVerdict(s.corners.home + s.corners.away, sel, L) : null
    ])
  ),
  ...Object.fromEntries(
    [3.5, 4.5, 5.5].map(L => [
      `U/O Cartellini ${L}`,
      (s: StatsPayload, sel: string, _l: number) =>
        s.cards ? totalsVerdict(s.cards.home + s.cards.away, sel, L) : null
    ])
  ),
};
```

- [ ] **Step 4: PASS**, commit

```bash
git add lib/settlement/stats-settlers.ts tests/lib/settlement/stats-settlers.test.ts
git commit -m "feat(settlement): STATS_SETTLERS dispatch (Plan D.2)"
```

---

### Task 2.1b: `PLAYER_SETTLERS` dispatch table

**Files:**
- Create: `lib/settlement/player-settlers.ts`
- Create: `tests/lib/settlement/player-settlers.test.ts`

Settles markets where the outcome's `outcomes.name` is a player name (Anytime Goalscorer, Multi Scorers, Marca o Assist) by looking up scorer events in `events.live_data.scorers` JSONB.

- [ ] **Step 1: Failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { PLAYER_SETTLERS, type ScorerEvents } from '@/lib/settlement/player-settlers';

describe('PLAYER_SETTLERS', () => {
  const scorers: ScorerEvents = {
    goals: [
      { player: 'Lautaro Martinez', minute: 23, team: 'home', type: 'shot' },
      { player: 'Federico Dimarco', minute: 67, team: 'home', type: 'header' },
      { player: 'Olivier Giroud', minute: 89, team: 'away', type: 'penalty' },
    ],
    assists: [{ player: 'Hakan Calhanoglu', goal_minute: 23 }],
  };

  it('Marcatore — Lautaro scored → won', () => {
    expect(PLAYER_SETTLERS['Marcatore'](scorers, 'Lautaro Martinez')).toBe('won');
  });
  it('Marcatore — player did not score → lost', () => {
    expect(PLAYER_SETTLERS['Marcatore'](scorers, 'Marcus Thuram')).toBe('lost');
  });
  it('Multi Marcatori — 2+ goals required, Dimarco only scored 1 → lost', () => {
    expect(PLAYER_SETTLERS['Multi Marcatori'](scorers, 'Federico Dimarco')).toBe('lost');
  });
  it('Marca o Assist — Calhanoglu assisted, did not score → won', () => {
    expect(PLAYER_SETTLERS['Marca o Assist'](scorers, 'Hakan Calhanoglu')).toBe('won');
  });
  it('Primo Marcatore — first goal was Lautaro at 23min → won for Lautaro', () => {
    expect(PLAYER_SETTLERS['Primo Marcatore'](scorers, 'Lautaro Martinez')).toBe('won');
    expect(PLAYER_SETTLERS['Primo Marcatore'](scorers, 'Olivier Giroud')).toBe('lost');
  });
  it('returns null when scorers payload missing', () => {
    expect(PLAYER_SETTLERS['Marcatore']({} as any, 'Anyone')).toBeNull();
  });
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement** (~150 LoC) — same dispatch pattern as STATS_SETTLERS. Each handler takes `(scorers: ScorerEvents, outcome_name: string) → Verdict`. Multi Marcatori counts goals by player; First/Last Goalscorer compare minutes.

- [ ] **Step 4: PASS**, commit `feat(settlement): PLAYER_SETTLERS dispatch (Plan D.2)`

---

### Task 2.1c: `SPECIAL_DISPATCHER` (v1 = manual_required)

**Files:**
- Create: `lib/settlement/special-dispatcher.ts`
- Create: `tests/lib/settlement/special-dispatcher.test.ts`

Per spec §10.3 note: v1 returns `'manual_required'` for every special market, no auto-settle. Future versions can add per-market handlers (Plan E).

- [ ] **Step 1: Test**

```typescript
import { describe, expect, it } from 'vitest';
import { SPECIAL_DISPATCHER } from '@/lib/settlement/special-dispatcher';

describe('SPECIAL_DISPATCHER', () => {
  it.each(['Metodo Goal', 'Primi 10 Minuti', 'Specials'])(
    '%s returns manual_required',
    (mt) => {
      expect(SPECIAL_DISPATCHER(mt, {} as any, 'Header')).toBe('manual_required');
    }
  );
});
```

- [ ] **Step 2: FAIL → implement → PASS**

```typescript
// lib/settlement/special-dispatcher.ts
import type { Verdict } from './stats-settlers';

export function SPECIAL_DISPATCHER(
  market_type: string,
  payload: any,
  outcome_name: string
): Verdict | 'manual_required' {
  // v1: every special routed to operator queue. v2 (Plan E) adds per-market handlers.
  return 'manual_required';
}
```

- [ ] **Step 3: Commit** `feat(settlement): SPECIAL_DISPATCHER v1 manual-required (Plan D.2)`

---

### Task 2.1d: Wire category branching in `settleLeg`

**Files:**
- Modify: `lib/settlement.ts` (`settleLeg` extracted in Task 2.0; add category dispatch)
- Modify: `tests/lib/settlement/settle-leg.test.ts` (add stats/player/special cases)

- [ ] **Step 1: Add category branching to `settleLeg`**

```typescript
import { classify } from '@/lib/settlement/market-classification';
import { STATS_SETTLERS } from '@/lib/settlement/stats-settlers';
import { PLAYER_SETTLERS } from '@/lib/settlement/player-settlers';
import { SPECIAL_DISPATCHER } from '@/lib/settlement/special-dispatcher';

export function settleLeg(
  result: Result,
  leg: Leg,
  context: { stats?: StatsPayload; scorers?: ScorerEvents } = {}
): Verdict | 'manual_required' | null {
  const cat = classify(leg.markets.market_type);

  if (cat === 'score') {
    const resolved = resolveSettlerKey(leg.markets.market_type, leg.markets.line);
    if (!resolved) return 'void';
    const settler = SETTLERS[resolved.key];
    if (!settler) return 'void';
    return settler(result, leg.outcomes.name, resolved.line ?? leg.markets.line ?? undefined, resolved.setIdx);
  }

  if (cat === 'stats') {
    if (!context.stats) return null;  // skip until stats arrive
    const handler = STATS_SETTLERS[leg.markets.market_type];
    if (!handler) return 'void';
    return handler(context.stats, leg.outcomes.name, leg.markets.line ?? 0);
  }

  if (cat === 'player') {
    if (!context.scorers) return null;
    const handler = PLAYER_SETTLERS[leg.markets.market_type];
    if (!handler) return 'void';
    return handler(context.scorers, leg.outcomes.name);
  }

  // category === 'special'
  return SPECIAL_DISPATCHER(leg.markets.market_type, context, leg.outcomes.name);
}
```

- [ ] **Step 2: Update tests for stats/player/special branches**

- [ ] **Step 3: PASS, commit** `feat(settlement): settleLeg category dispatch (Plan D.2)`

---

### Task 2.2: Migration 153 — `settlement_log_shadow` table

**Files:**
- Create: `supabase/migrations/153_settlement_log_shadow.sql`

- [ ] **Step 1: SQL**

```sql
-- supabase/migrations/153_settlement_log_shadow.sql
BEGIN;

CREATE TABLE IF NOT EXISTS settlement_log_shadow (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_selection_id UUID NOT NULL REFERENCES bet_selections(id),
  event_id UUID NOT NULL,
  market_type TEXT NOT NULL,
  category TEXT NOT NULL,
  
  -- The verdict the existing FS path produced (or NULL if not yet)
  real_verdict TEXT,
  real_settled_at TIMESTAMPTZ,
  
  -- The verdict the new odds-api path WOULD have produced
  shadow_verdict TEXT NOT NULL,
  shadow_settled_at TIMESTAMPTZ DEFAULT NOW(),
  shadow_source TEXT NOT NULL,  -- 'odds-api' | 'flashscore' | 'mixed' | 'manual_required'
  shadow_payload JSONB,  -- the source data used
  
  -- Mismatch flag (computed when both real & shadow set)
  mismatch BOOLEAN GENERATED ALWAYS AS (
    real_verdict IS NOT NULL AND real_verdict != shadow_verdict
  ) STORED,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shadow_log_bet_selection ON settlement_log_shadow(bet_selection_id);
CREATE INDEX IF NOT EXISTS idx_shadow_log_mismatch ON settlement_log_shadow(mismatch) WHERE mismatch = true;
CREATE INDEX IF NOT EXISTS idx_shadow_log_created ON settlement_log_shadow(created_at DESC);

COMMENT ON TABLE settlement_log_shadow IS
  'Plan D Phase 2 — shadow comparison between current FS settlement and new odds-api path. Archived after 30d post-cutover.';

COMMIT;
```

- [ ] **Step 2: Apply staging + prod**

Run twice: `node scripts/db/apply-mig.mjs --target staging --file supabase/migrations/153_settlement_log_shadow.sql` then `--target prod`.
Expected: table created, row count `0`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/153_settlement_log_shadow.sql
git commit -m "feat(db): mig 153 — settlement_log_shadow table (Plan D.2)"
```

---

### Task 2.3: New cron `/api/cron/odds-api-settle` in shadow mode

**Files:**
- Create: `app/api/cron/odds-api-settle/route.ts`
- Create: `tests/api/cron/odds-api-settle.test.ts`

- [ ] **Step 1: Failing test (mocked supabase client)**

```typescript
// tests/api/cron/odds-api-settle.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/cron/odds-api-settle/route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => mockSupabase,
}));

let mockSupabase: any;
beforeEach(() => {
  mockSupabase = createMockSupabaseWithEventsAndLegs();
});

describe('POST /api/cron/odds-api-settle', () => {
  it('rejects without x-cron-key', async () => {
    const req = new NextRequest('http://localhost/api/cron/odds-api-settle', { method: 'POST' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('settles score-only legs in shadow mode (no DB UPDATE on bet_selections)', async () => {
    const req = makeAuthedReq();
    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.shadow_logged).toBeGreaterThan(0);
    expect(mockSupabase._update_bet_selections_called).toBe(false);
    expect(mockSupabase._insert_shadow_log_called).toBe(true);
  });

  it('marks events_v2.last_settled_at after processing', async () => {
    const req = makeAuthedReq();
    await POST(req);
    expect(mockSupabase._marked_settled).toContain('event-v2-id-1');
  });

  it('skips events with last_settled_at set (idempotent)', async () => {
    mockSupabase._setEventsAlreadyProcessed(['event-v2-id-1']);
    const req = makeAuthedReq();
    const res = await POST(req);
    const json = await res.json();
    expect(json.evs_processed).toBe(0);
  });

  it('only touches score-only legs, leaves stats/player legs untouched', async () => {
    mockSupabase._setMixedEvent({ score_legs: 3, stats_legs: 2 });
    const req = makeAuthedReq();
    const res = await POST(req);
    const json = await res.json();
    expect(json.score_legs_logged).toBe(3);
    expect(json.stats_legs_skipped).toBe(2);
  });
});
```

(`createMockSupabaseWithEventsAndLegs` and `makeAuthedReq` helpers go in `tests/_helpers/`.)

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement**

```typescript
// app/api/cron/odds-api-settle/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { classify } from '@/lib/settlement/market-classification';
import { buildResultFromOddsApi } from '@/lib/settlement/odds-api-result';
import { settleLeg } from '@/lib/settlement';  // existing helper, exported

export const dynamic = 'force-dynamic';

const SHADOW_MODE = process.env.SETTLE_VIA_ODDS_API !== 'true';

export async function POST(req: NextRequest) {
  const auth = req.headers.get('x-cron-key');
  if (!auth || auth !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supa = createServiceClient();
  const stats = {
    mode: SHADOW_MODE ? 'shadow' : 'live',
    evs_processed: 0,
    score_legs_logged: 0,
    stats_legs_skipped: 0,
    real_verdicts_overwritten: 0,
    errors: [] as string[],
  };

  // 1. Pull settled events_v2 with no last_settled_at
  const { data: evs, error: evsErr } = await supa
    .from('events_v2')
    .select('id, scores, sport_slug, mapped_event_id, date_iso')
    .eq('status', 'settled')
    .is('last_settled_at', null)
    .not('mapped_event_id', 'is', null)
    .order('date_iso', { ascending: true })
    .limit(50);

  if (evsErr) {
    return NextResponse.json({ error: evsErr.message, ...stats }, { status: 500 });
  }
  if (!evs || evs.length === 0) {
    return NextResponse.json({ ...stats, message: 'No settled events pending' });
  }

  for (const ev of evs) {
    try {
      const result = buildResultFromOddsApi(ev.scores, ev.sport_slug);
      if (!result) {
        stats.errors.push(`event ${ev.id}: scores unparseable`);
        continue;
      }

      // Fetch all pending legs for the legacy mapped event
      const { data: legs } = await supa
        .from('bet_selections')
        .select(`
          id, bet_id, event_id, market_id, outcome_id, result,
          markets!inner(market_type, line),
          outcomes!inner(name)
        `)
        .eq('event_id', ev.mapped_event_id);

      const scoreLegs = (legs ?? []).filter(l => classify((l.markets as any).market_type) === 'score');
      const otherLegs = (legs ?? []).filter(l => classify((l.markets as any).market_type) !== 'score');

      stats.stats_legs_skipped += otherLegs.length;

      for (const leg of scoreLegs) {
        const verdict = settleLeg(result, leg);  // pure function, no DB write

        if (SHADOW_MODE) {
          await supa.from('settlement_log_shadow').insert({
            bet_selection_id: leg.id,
            event_id: leg.event_id,
            market_type: (leg.markets as any).market_type,
            category: 'score',
            real_verdict: leg.result,  // current state — may be NULL if not yet settled by FS
            shadow_verdict: verdict,
            shadow_source: 'odds-api',
            shadow_payload: { scores: ev.scores },
          });
          stats.score_legs_logged++;
        } else {
          // LIVE mode: actual UPDATE
          if (leg.result && leg.result !== verdict) stats.real_verdicts_overwritten++;
          await supa.from('bet_selections').update({ result: verdict, settled_at: new Date().toISOString() }).eq('id', leg.id).is('result', null);
          stats.score_legs_logged++;
        }
      }

      // Mark v2 event processed (only after successful loop)
      await supa.from('events_v2').update({ last_settled_at: new Date().toISOString() }).eq('id', ev.id);
      stats.evs_processed++;

      // In LIVE mode, aggregate to bet level
      if (!SHADOW_MODE) {
        const betIds = Array.from(new Set(scoreLegs.map(l => l.bet_id)));
        for (const bid of betIds) await supa.rpc('resolve_bet', { bet_id: bid });
      }

    } catch (e: any) {
      stats.errors.push(`event ${ev.id}: ${e.message}`);
    }
  }

  return NextResponse.json(stats);
}
```

- [ ] **Step 4: PASS** (`npx vitest run tests/api/cron/odds-api-settle.test.ts`)

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/odds-api-settle/route.ts tests/api/cron/odds-api-settle.test.ts
git commit -m "feat(cron): /api/cron/odds-api-settle in shadow mode (Plan D.2)"
```

---

### Task 2.4: Wire env flag + deploy + install systemd timer

- [ ] **Step 1: Add env flag default**

Edit `.env.local.example`:
```
# Plan D — Settlement via odds-api. false = shadow mode (logs only). true = live UPDATE.
SETTLE_VIA_ODDS_API=false
```

- [ ] **Step 2: Deploy to scraper-vps**

Per memory, deploys go via `gh workflow run` or direct rsync. Use existing path. Confirm `betssolution-admin.service` restarts cleanly.

- [ ] **Step 3: Install systemd timer on scraper-vps**

```ini
# /etc/systemd/system/oa-settle.timer
[Unit]
Description=Plan D — odds-api-settle cron timer

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
Unit=oa-settle.service

[Install]
WantedBy=timers.target
```

```ini
# /etc/systemd/system/oa-settle.service
[Unit]
Description=Plan D — odds-api-settle invoker

[Service]
Type=oneshot
EnvironmentFile=/root/betssolution-admin/.env.local
# Shell-wrap so $CRON_SECRET expands at runtime (systemd ExecStart does NOT
# expand env vars in arguments by default — only via shell).
ExecStart=/bin/bash -c '/usr/bin/curl -fsS -X POST -H "x-cron-key: $CRON_SECRET" http://localhost:3000/api/cron/odds-api-settle'
```

Run: `systemctl daemon-reload && systemctl enable --now oa-settle.timer`
Expected: `systemctl status oa-settle.timer` → active (waiting).

- [ ] **Step 4: Verify env var loaded by service**

Run: `systemctl show oa-settle.service -p Environment`
Expected: output contains `CRON_SECRET=<some-value>` (not empty/missing). If `Environment=` line is empty, check that `.env.local` exists and contains `CRON_SECRET=` without quotes.

- [ ] **Step 5: Verify first invocations**

Wait 2 min. Run: `journalctl -u oa-settle.service --since "5 min ago"`
Expected: HTTP 200 responses, JSON output with `mode: 'shadow'`, `evs_processed >= 0`. If you see HTTP 401, the env var didn't expand — go back to Step 4.

- [ ] **Step 6: Commit env example**

```bash
git add .env.local.example
git commit -m "ops(plan-d): SETTLE_VIA_ODDS_API env flag + systemd timer (Plan D.2)"
```

---

### Task 2.5: 48h shadow observation + daily mismatch report

- [ ] **Step 1: Mismatch report query**

Save `scripts/diagnostic/shadow-mismatch-daily.sql`:
```sql
-- Settlement shadow daily comparison
SELECT
  date_trunc('day', shadow_settled_at) AS day,
  count(*) FILTER (WHERE real_verdict IS NULL) AS only_shadow_settled,
  count(*) FILTER (WHERE real_verdict IS NOT NULL) AS both_settled,
  count(*) FILTER (WHERE mismatch = true) AS mismatches,
  count(*) AS total,
  round(100.0 * count(*) FILTER (WHERE mismatch = true) / NULLIF(count(*) FILTER (WHERE real_verdict IS NOT NULL), 0), 2) AS mismatch_pct
FROM settlement_log_shadow
WHERE shadow_settled_at > NOW() - INTERVAL '48 hours'
GROUP BY day ORDER BY day;
```

- [ ] **Step 2: Daily monitoring**

Run query at 24h, 36h, 48h. Record mismatch_pct. **Gate**: ≤0.5% on score-only legs across ≥1000 entries.

- [ ] **Step 3: If mismatches >0.5%, drill down**

```sql
SELECT s.market_type, s.real_verdict, s.shadow_verdict, count(*),
  array_agg(DISTINCT (s.shadow_payload->>'scores')) AS sample_scores
FROM settlement_log_shadow s
WHERE s.mismatch = true
  AND s.shadow_settled_at > NOW() - INTERVAL '48 hours'
GROUP BY s.market_type, s.real_verdict, s.shadow_verdict
ORDER BY count(*) DESC;
```

Patterns:
- score discrepancy (FS late goal) → R1 from spec, expected; manual verification
- classification miss → fix `MARKET_CATEGORIES`
- settler bug → fix in `lib/settlement/odds-api-result.ts` or downstream SETTLERS

- [ ] **Step 4: Iterate until ≤0.5% gate met**, commit fixes incrementally.

---

## Phase 3 — 100-bet validation gate

### Task 3.1: Fixture authoring infrastructure

**Files:**
- Create: `tests/fixtures/settlement/100-bets.schema.json`
- Create: `tests/fixtures/settlement/100-bets.json` (initially empty array)
- Create: `tests/integration/100-bets-settlement.test.ts`

- [ ] **Step 1: JSON Schema for fixture validation**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "array",
  "items": {
    "type": "object",
    "required": ["id", "category", "sport", "market_type", "outcome_name", "expected_verdict", "notes"],
    "properties": {
      "id": { "type": "string", "pattern": "^(fb|bk|tn|bb|hk|am|rg|hb|vb|cr|es|dt|mma|bx|tt)-[a-z0-9-]+$" },
      "category": { "enum": ["score", "stats", "player", "special"] },
      "sport": { "type": "string" },
      "market_type": { "type": "string" },
      "outcome_name": { "type": "string" },
      "line": { "type": ["number", "null"] },
      "scores": {
        "type": "object",
        "properties": {
          "home": { "type": "number" },
          "away": { "type": "number" },
          "periods": { "type": "object" }
        }
      },
      "stats": { "type": "object" },
      "scorers": { "type": "array" },
      "expected_verdict": { "enum": ["won", "lost", "void", "push", "manual_required", "skipped"] },
      "notes": { "type": "string" }
    }
  }
}
```

- [ ] **Step 2: Empty fixture file**

```json
// tests/fixtures/settlement/100-bets.json
[]
```

- [ ] **Step 3: Test runner**

```typescript
// tests/integration/100-bets-settlement.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { settleSyntheticBet } from '@/tests/_helpers/settle-synthetic';

// Use JSON.parse(readFileSync) to avoid Node import-attribute compatibility
// issues across versions (`assert { type: 'json' }` deprecated → `with { type: 'json' }`).
const fixturesPath = resolve(__dirname, '../fixtures/settlement/100-bets.json');
const fixtures = JSON.parse(readFileSync(fixturesPath, 'utf8')) as Array<any>;

const grouped = {
  score: fixtures.filter(f => f.category === 'score'),
  stats: fixtures.filter(f => f.category === 'stats'),
  player: fixtures.filter(f => f.category === 'player'),
  special: fixtures.filter(f => f.category === 'special'),
};

describe('100-bet settlement validation gate', () => {
  it.each(grouped.score)('🟢 score: $id $market_type / $outcome_name → $expected_verdict', async (bet) => {
    const verdict = await settleSyntheticBet(bet);
    expect(verdict, bet.notes).toBe(bet.expected_verdict);
  });

  it.each(grouped.stats)('🟡 stats: $id $market_type / $outcome_name → $expected_verdict', async (bet) => {
    const verdict = await settleSyntheticBet(bet);
    expect(verdict, bet.notes).toBe(bet.expected_verdict);
  });

  it.each(grouped.player)('🔴 player: $id $market_type / $outcome_name → $expected_verdict', async (bet) => {
    const verdict = await settleSyntheticBet(bet);
    expect(verdict, bet.notes).toBe(bet.expected_verdict);
  });

  it.each(grouped.special)('⚪ special: $id $market_type / $outcome_name → $expected_verdict', async (bet) => {
    const verdict = await settleSyntheticBet(bet);
    expect(verdict, bet.notes).toBe(bet.expected_verdict);
  });

  it('FIXTURE COMPLETENESS: ≥60 score / ≥20 stats / ≥15 player / ≥5 special / total ≥100', () => {
    expect(grouped.score.length).toBeGreaterThanOrEqual(60);
    expect(grouped.stats.length).toBeGreaterThanOrEqual(20);
    expect(grouped.player.length).toBeGreaterThanOrEqual(15);
    expect(grouped.special.length).toBeGreaterThanOrEqual(5);
    expect(fixtures.length).toBeGreaterThanOrEqual(100);
  });
});
```

- [ ] **Step 4: Helper `settleSyntheticBet`**

```typescript
// tests/_helpers/settle-synthetic.ts
import { classify } from '@/lib/settlement/market-classification';
import { buildResultFromOddsApi } from '@/lib/settlement/odds-api-result';
import { SETTLERS, resolveSettlerKey } from '@/lib/settlement';
// + STATS_SETTLERS, PLAYER_SETTLERS, SPECIAL_DISPATCHER imports (Tasks 2.x)

export async function settleSyntheticBet(bet: any): Promise<string> {
  const cat = classify(bet.market_type);
  if (cat === 'score') {
    const result = buildResultFromOddsApi(bet.scores, bet.sport);
    if (!result) return 'skipped';
    const settler = resolveSettlerKey(bet.market_type, bet.line);
    if (!settler) return 'void';
    return SETTLERS[settler.key](result, bet.outcome_name, settler.line ?? bet.line);
  }
  if (cat === 'stats') {
    // STATS_SETTLERS dispatcher (Task 2.x)
    return STATS_SETTLERS[bet.market_type]?.(bet.stats, bet.outcome_name, bet.line) ?? 'skipped';
  }
  if (cat === 'player') {
    return PLAYER_SETTLERS[bet.market_type]?.(bet.scorers, bet.outcome_name) ?? 'skipped';
  }
  return 'manual_required';  // special
}
```

- [ ] **Step 5: Initial run (expect 1 failing test = completeness check)**

Run: `npx vitest run tests/integration/100-bets-settlement.test.ts`
Expected: 1 failing test (completeness fails with empty fixture). Use this as TODO marker.

Commit: `test(plan-d): 100-bet validation gate harness, fixture empty (Plan D.3)`

---

### Task 3.2: Author 60 score-only fixture entries

Iteratively author entries by category. Each entry small commit.

- [ ] **Step 1: 1X2 cases (15 entries)**

Add to `100-bets.json`:
```json
{
  "id": "fb-1x2-home-001",
  "category": "score",
  "sport": "football",
  "market_type": "1X2",
  "outcome_name": "1",
  "scores": { "home": 2, "away": 1, "periods": { "fulltime": {"home": 2, "away": 1} } },
  "expected_verdict": "won",
  "notes": "Home win 2-1, simple"
},
{
  "id": "fb-1x2-draw-002",
  "category": "score",
  "sport": "football",
  "market_type": "1X2",
  "outcome_name": "X",
  "scores": { "home": 1, "away": 1, "periods": { "fulltime": {"home": 1, "away": 1} } },
  "expected_verdict": "won",
  "notes": "Draw 1-1"
},
// ... 13 more covering: away win, 0-0 draw, all 3 outcomes losing, edge case high-scoring
```

Run: `npx vitest run tests/integration/100-bets-settlement.test.ts`
Expected: 15 score tests pass + completeness still fails (need ≥60 score).

Commit: `test(plan-d): fixture +15 1X2 cases`

- [ ] **Step 2: U/O cases (15 entries)** — lines 0.5/1.5/2.5/3.5/4.5; over/under wins/losses; pushes on integer lines.

Commit: `test(plan-d): fixture +15 U/O cases`

- [ ] **Step 3: BTTS, DC, DNB cases (10 entries)**

Commit: `test(plan-d): fixture +10 BTTS/DC/DNB cases`

- [ ] **Step 4: HT, HT/FT, Spread, AsianHandicap cases (10 entries)** — including pushes on whole numbers.

Commit: `test(plan-d): fixture +10 HT/HTFT/Spread cases`

- [ ] **Step 5: Exact Score, Number Goals, Pari/Dispari, Linea Goal (10 entries)**

Commit: `test(plan-d): fixture +10 Exact/NumGoals/OddEven/Line cases`

After 5 iterations: 60 score entries total. Run `npx vitest run tests/integration/100-bets-settlement.test.ts` — expect 60 score passing, completeness still failing.

---

### Task 3.3: Author 20 stats fixture entries

Same pattern: 5-entry batches for Corners (8), Cards (4), Shots (4), Tackles (4). Each entry includes `stats` object:
```json
"stats": { "corners": { "home": 6, "away": 5 }, "total_corners": 11 }
```

5 commits, 20 entries total. After this: 80 fixture entries.

---

### Task 3.4: Author 15 player fixture entries

3-entry batches for Anytime Goalscorer, Multi Scorers, Player Shots, Marca o Assist, Goalkeeper Saves player-prop. Each entry:
```json
"scorers": [
  { "player_id": "p123", "name": "Lautaro Martinez", "minute": 23, "type": "goal" },
  ...
]
```

5 commits. After: 95 entries.

---

### Task 3.5: Author 5 special fixture entries

All `expected_verdict: "manual_required"` per spec §10.3 note. 1 commit.

After: 100 entries → completeness test passes.

---

### Task 3.6: Run full 100-bet validation, iterate to 100/100

- [ ] **Step 1: Full run**

Run: `npx vitest run tests/integration/100-bets-settlement.test.ts -t "100-bet"`
Expected: ideally 100/100 pass.

- [ ] **Step 2: For each failure**:
  - if fixture wrong → fix fixture, commit
  - if settler wrong → fix `lib/settlement/*.ts`, commit
  - if classification wrong → fix `MARKET_CATEGORIES`, regen JSON, mig 152 ON CONFLICT update

- [ ] **Step 3: Repeat until 100/100**

- [ ] **Step 4: Lock the gate**

Add to CI:
```yaml
# .github/workflows/test.yml step
- name: 100-bet validation gate
  run: npx vitest run tests/integration/100-bets-settlement.test.ts
```

Commit: `ci(plan-d): require 100-bet gate on every PR (Plan D.3 done)`

---

## Phase 4 — Cutover

### Task 4.1: Refactor `verify-results` to scope stats/player legs

**Files:**
- Modify: `app/api/cron/verify-results/route.ts`

- [ ] **Step 1: Replace event query with `next_unsettled_with_stats_legs` RPC**

Find line ~50-70 of current route.ts (the `from('events').select(...)` block) and replace:
```typescript
const { data: events } = await supabase.rpc('next_unsettled_with_stats_legs', { lim: 100 });
```

- [ ] **Step 2: Add test that verifies pure-score events are skipped**

```typescript
it('skips events with only score-only pending legs', async () => {
  // seed: event A (only 1X2 leg), event B (corners leg)
  await invokeVerifyResults();
  expect(processedEvents).toContain(eventBId);
  expect(processedEvents).not.toContain(eventAId);
});
```

- [ ] **Step 3: Verify staging behavior** — observe call volume drop in `journalctl -u verify-results`.

Expected: ~50% reduction in events processed per run.

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/verify-results/route.ts tests/api/cron/verify-results.test.ts
git commit -m "refactor(cron): verify-results scoped to stats/player legs only (Plan D.4)"
```

---

### Task 4.2: Flip env flag staging

- [ ] **Step 1**: Set `SETTLE_VIA_ODDS_API=true` in staging `.env.local`

- [ ] **Step 2**: Restart staging service

- [ ] **Step 3**: Monitor for 24h:
  - `settlement_log_shadow.real_verdict` continues populating from FS path (only stats/player) but now actual `bet_selections.result` updates from odds-api path on score legs
  - mismatch_pct query (Phase 2 §3.1) on settled legs now compares the new live behavior vs historical

- [ ] **Step 4**: Smoke `/admin/settlement-coverage` — expect Score category `auto_settled %` jump.

- [ ] **Step 5**: Decide go/no-go for prod

---

### Task 4.3: Flip env flag prod + 24h monitoring

Same as 4.2 but on prod. **Explicit go/no-go thresholds** (mirror Phase 2 §10.4 shadow gate):

| Metric | 24h target | Failure → action |
|---|---|---|
| score-only mismatch vs shadow log | ≤0.5% | revert env flag, root-cause |
| settlement latency p50 (score legs) | ≤2 min from `events_v2.status='settled'` | investigate cron timer/lag |
| FS call volume reduction vs Phase 0.5 baseline | ≥40% | check verify-results scoping logic |
| pending leg backlog age p99 | ≤24h | normal (some events lack flashscore_id, expected) |
| alert fires (`/api/cron/alerts`) | 0 net new | investigate alert source |
| settlement_log_shadow.mismatch=true count for stats/player legs | unchanged from Phase 2 | confirms scoping didn't break FS path |

Run: every 6h during the 24h window:
```bash
curl -fsS https://admin.betssolution.com/api/admin/settlement-coverage/list?window=1 | jq '.kpis'
```
Expected progression: `kpis.score.legs_pending` decreases steadily; `kpis.stats.legs_pending` stable; `kpis.player.legs_pending` stable.

If all 6 metrics green at 24h: declare Phase 4 complete.
If any metric red: `ssh scraper-vps 'sed -i s/SETTLE_VIA_ODDS_API=true/SETTLE_VIA_ODDS_API=false/ /root/betssolution-admin/.env.local && systemctl restart betssolution-admin'` — rollback in <1 min, root-cause separately.

Commit: `ops(plan-d): SETTLE_VIA_ODDS_API=true on prod, cutover complete (Plan D.4)`

---

## Phase 5 — Cleanup (T+30 days)

### Task 5.1: Archive `settlement_log_shadow`

After 30 days:
```sql
ALTER TABLE settlement_log_shadow RENAME TO _archived_settlement_log_shadow_2026_05;
```
Or `DROP` if disk space matters.

### Task 5.2: Documentation update

- Update spec `docs/superpowers/specs/2026-04-29-plan-d-settlement-refactor-design.md` with actual measured success criteria values.
- Add note in `CLAUDE.md` if needed describing settlement architecture for future sessions.

### Task 5.3: Memory note

Save memory `feedback-plan-d-outcome.md` documenting: actual mismatch %, latency, FS reduction, any gotchas, decision-driver for future Plan E (alternate stats provider) based on coverage page data.

Commit: `docs(plan-d): cleanup post-cutover, success metrics locked (Plan D done)`

---

## Risk index — what can go wrong during execution

(Cross-reference spec §12 risks. Plan-specific concerns:)

- **R1 plan-execution-specific**: `apply-mig.mjs` may not be in current local repo state. If missing, fall back to direct `psql` invocation per memory note `MEMORY.md`.
- **R2 plan-execution-specific**: tests reference `@/lib/supabase/server` `createServerClient` / `createServiceClient` — confirm exact export name in current codebase before writing test mocks.
- **R3 plan-execution-specific**: sidebar config location may have moved post-Phase 1.F sidebar lean. Run `Grep -rn "Risk\&Trading\|SISTEMA\|GESTIONE" app/admin lib/ components/` to locate (these are existing post-cleanup labels).
- **R4 plan-execution-specific**: `settleLeg` helper may not exist as exported in current `lib/settlement.ts`. Refactor to extract pure function + commit before Task 2.3.

---

## Effort budget recap (calendar)

| Phase | Task count | Working days | Calendar days |
|---|---:|---:|---:|
| 0.5 — Baseline | 1 | 0.5 | 0.5 |
| 1 — D.1 page | 12 | 2.0 | 2-3 |
| 2 — D.2 engine + shadow | 5 | 1.5 + 2 obs | 3-4 |
| 3 — Fixture authoring | 6 | 1.0 | 1 |
| 4 — Cutover | 3 | 1.0 | 2 (24h staging + 24h prod) |
| 5 — Cleanup | 3 | 0.5 (T+30d) | — |
| **Total** | **30** | **6.5 + 2 obs** | **~10 calendar days** |

---

End of implementation plan.
