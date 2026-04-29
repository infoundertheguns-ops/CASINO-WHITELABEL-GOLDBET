# Market Normalization Phase 1 MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the schema, deterministic auto-mapping engine (regex + dictionary + cross-source propagation), and unified admin UI to canonicalize Kambi + 22bet market_type strings so consensus snapshots can compare apples-to-apples cross-source.

**Architecture:** Three-layer system. **Schema**: new `canonical_markets` catalog table + extended `market_normalization` with `canonical_line`, `extracted_by`, `confidence`. **Engine**: TypeScript pipeline in `lib/normalize/` with three pure modules (regex, dictionary, propagation) orchestrated by `engine.ts`, invokable via CLI script, HTTP endpoint (chunked), or cron (deferred). **UI**: single unified table replacing the 5-tab page, bulk-confirm controls, new CRUD page for the canonical catalog.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (PostgreSQL), vitest, @supabase/supabase-js server admin client, psql for migrations.

**Spec reference:** `docs/superpowers/specs/2026-04-20-market-normalization-design.md`

**Branch:** `spec/market-normalization` (already exists with spec committed).

---

## Pre-flight

- Working directory: `C:\Users\philp\Downloads\betssolution\betssolution-admin`
- Branch: `spec/market-normalization` (created during brainstorming)
- Tests: `pnpm test` runs vitest (already configured). Pattern: `tests/<mirror-source-path>/<file>.test.ts`.
- Migrations are applied by **direct psql** against Supabase DB (per project memory), not via `supabase db push`. Files live in `supabase/migrations/` for version control only.
- Remote DB creds (already in env): `PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres`. Staging uses a different host (staging Supabase project) — exact host will be fetched from `.env.staging` before apply.

---

## File Structure

### New files
| Path | Purpose |
|---|---|
| `supabase/migrations/042_canonical_markets.sql` | Create `canonical_markets` table + insert ~50 seed rows |
| `supabase/migrations/043_market_normalization_ext.sql` | ALTER `market_normalization`: add `canonical_line`, `extracted_by`, `confidence`; tighten CHECK to kambi/22bet only; add FK to canonical_markets |
| `lib/normalize/types.ts` | Shared types: `NormalizationRow`, `StageResult`, `Period`, etc. |
| `lib/normalize/period.ts` | Period normalizer helper: `"1T"` \| `"1° Tempo"` \| `"- 1T"` → `"1h"` |
| `lib/normalize/regex-patterns.ts` | Stage 1: regex definitions + `parseMarketType()` pure function |
| `lib/normalize/dictionary.ts` | Stage 2: twobet + Kambi dictionary-lookup logic |
| `lib/normalize/propagation.ts` | Stage 3: literal-match + tuple-match cross-source propagation |
| `lib/normalize/engine.ts` | Orchestrator: reads unmapped rows, runs stages in order, upserts results |
| `scripts/normalize-markets.ts` | CLI wrapper: calls engine, prints summary |
| `app/api/admin/canonical-markets/route.ts` | CRUD for `canonical_markets` |
| `app/admin/canonical-markets/page.tsx` | Catalog management UI |
| `tests/lib/normalize/period.test.ts` | Unit tests for period normalizer |
| `tests/lib/normalize/regex-patterns.test.ts` | Unit tests for regex patterns |
| `tests/lib/normalize/dictionary.test.ts` | Unit tests for dictionary lookups (in-memory fakes) |
| `tests/lib/normalize/propagation.test.ts` | Unit tests for propagation logic |
| `tests/lib/normalize/engine.test.ts` | Integration: fake supabase + full pipeline |

### Modified files
| Path | What changes |
|---|---|
| `app/admin/market-normalization/page.tsx` | Remove 5-tab navigation → unified flat table with `source` column, pagination, bulk-confirm, filter by confidence/extracted_by, engine trigger button |
| `app/api/admin/market-normalization/route.ts` | Add `action=run-engine` (chunked), `action=bulk-confirm`, update list to paginate + filter by confidence/extracted_by, tighten VALID_SOURCES |
| `app/admin/layout.tsx` | Add sidebar entry `canonical-markets` + title + route mapping |
| `package.json` | Add `normalize:markets` script |

---

## Task 1: Migration 042 — canonical_markets catalog + seed

**Files:**
- Create: `supabase/migrations/042_canonical_markets.sql`

The seed below contains **30 canonicals** (not 50 as in spec's aspirational text). This is intentional: 30 covers the observed top-25 market_types per source from prod DB sampling, hitting ~80% of active markets by `market_count`. Remaining ~20 "aspirational" canonicals can be added via the `/admin/canonical-markets` CRUD after observation from first engine run.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/042_canonical_markets.sql`:

```sql
-- 042_canonical_markets.sql
-- Catalog of canonical market identities. Seed covers football basics; expand via /admin/canonical-markets CRUD.

CREATE TABLE IF NOT EXISTS canonical_markets (
  canonical_key     TEXT PRIMARY KEY,
  base_key          TEXT NOT NULL,
  period            TEXT NOT NULL CHECK (period IN ('ft','1h','2h','et','regular_time')),
  canonical_name_it TEXT NOT NULL,
  has_line          BOOLEAN NOT NULL DEFAULT false,
  outcomes          JSONB NOT NULL,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canonical_markets_base ON canonical_markets(base_key);

-- Seed: core football canonicals
INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  ('1x2_ft',     '1x2',          'ft', '1X2',                          false, '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb),
  ('1x2_1h',     '1x2',          '1h', '1X2 1° Tempo',                 false, '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb),
  ('1x2_2h',     '1x2',          '2h', '1X2 2° Tempo',                 false, '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb),
  ('u_o_ft',     'u_o',          'ft', 'Under/Over',                   true,  '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('u_o_1h',     'u_o',          '1h', 'Under/Over 1° Tempo',          true,  '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('u_o_2h',     'u_o',          '2h', 'Under/Over 2° Tempo',          true,  '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('gg_ng_ft',   'gg_ng',        'ft', 'Goal/No Goal',                 false, '[{"key":"yes","name_it":"Goal"},{"key":"no","name_it":"No Goal"}]'::jsonb),
  ('gg_ng_1h',   'gg_ng',        '1h', 'Goal/No Goal 1° Tempo',        false, '[{"key":"yes","name_it":"Goal"},{"key":"no","name_it":"No Goal"}]'::jsonb),
  ('gg_ng_2h',   'gg_ng',        '2h', 'Goal/No Goal 2° Tempo',        false, '[{"key":"yes","name_it":"Goal"},{"key":"no","name_it":"No Goal"}]'::jsonb),
  ('dc_ft',      'dc',           'ft', 'Doppia Chance',                false, '[{"key":"1X","name_it":"1X"},{"key":"12","name_it":"12"},{"key":"X2","name_it":"X2"}]'::jsonb),
  ('dc_1h',      'dc',           '1h', 'Doppia Chance 1° Tempo',       false, '[{"key":"1X","name_it":"1X"},{"key":"12","name_it":"12"},{"key":"X2","name_it":"X2"}]'::jsonb),
  ('dc_2h',      'dc',           '2h', 'Doppia Chance 2° Tempo',       false, '[{"key":"1X","name_it":"1X"},{"key":"12","name_it":"12"},{"key":"X2","name_it":"X2"}]'::jsonb),
  ('1x2_h_ft',   '1x2_handicap', 'ft', '1X2 Handicap',                 true,  '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb),
  ('1x2_h_1h',   '1x2_handicap', '1h', '1X2 Handicap 1° Tempo',        true,  '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb),
  ('dnb_ft',     'dnb',          'ft', 'Draw No Bet',                  false, '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('dnb_1h',     'dnb',          '1h', 'Draw No Bet 1° Tempo',         false, '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('cs_ft',      'correct_score','ft', 'Risultato Esatto',             false, '[{"key":"grid","name_it":"Griglia N-M"}]'::jsonb),
  ('cs_1h',      'correct_score','1h', 'Risultato Esatto 1° Tempo',    false, '[{"key":"grid","name_it":"Griglia N-M"}]'::jsonb),
  ('htft',       'htft',         'ft', 'Esito 1T/Finale',              false, '[{"key":"1_1","name_it":"1/1"},{"key":"1_X","name_it":"1/X"},{"key":"1_2","name_it":"1/2"},{"key":"X_1","name_it":"X/1"},{"key":"X_X","name_it":"X/X"},{"key":"X_2","name_it":"X/2"},{"key":"2_1","name_it":"2/1"},{"key":"2_X","name_it":"2/X"},{"key":"2_2","name_it":"2/2"}]'::jsonb),
  ('oe_ft',      'odd_even',     'ft', 'Pari/Dispari',                 false, '[{"key":"odd","name_it":"Dispari"},{"key":"even","name_it":"Pari"}]'::jsonb),
  ('oe_1h',      'odd_even',     '1h', 'Pari/Dispari 1° Tempo',        false, '[{"key":"odd","name_it":"Dispari"},{"key":"even","name_it":"Pari"}]'::jsonb),
  ('team_score_ft','team_scores','ft', 'Squadra Segna',                false, '[{"key":"home","name_it":"Casa Segna"},{"key":"away","name_it":"Ospite Segna"}]'::jsonb),
  ('total_team_ft','total_team', 'ft', 'Totale Squadra',               true,  '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('clean_sheet_ft','clean_sheet','ft','Clean Sheet',                   false, '[{"key":"home","name_it":"Casa Clean Sheet"},{"key":"away","name_it":"Ospite Clean Sheet"}]'::jsonb),
  ('win_to_nil_ft','win_to_nil','ft', 'Vince e Non Subisce Goal',      false, '[{"key":"home","name_it":"1 Non Subisce"},{"key":"away","name_it":"2 Non Subisce"}]'::jsonb),
  ('both_halves_score','both_halves_score','ft','Segna Entrambi i Tempi',false,'[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('anytime_scorer','anytime_scorer','ft','Marcatore Qualsiasi Momento',false,'[{"key":"yes","name_it":"Sì"}]'::jsonb),
  ('first_scorer','first_scorer','ft','Primo Marcatore',                false, '[{"key":"player","name_it":"Giocatore"},{"key":"no_goal","name_it":"No Goal"}]'::jsonb),
  ('last_scorer','last_scorer',  'ft', 'Ultimo Marcatore',              false, '[{"key":"player","name_it":"Giocatore"},{"key":"no_goal","name_it":"No Goal"}]'::jsonb),
  ('h2h_ft',     'h2h',          'ft', 'Testa a Testa',                 false, '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('qualification','qualification','ft','Qualificazione',               false, '[{"key":"home","name_it":"1 Si Qualifica"},{"key":"away","name_it":"2 Si Qualifica"}]'::jsonb);
```

- [ ] **Step 2: Verify SQL syntax locally**

Run: `sqlfluff lint supabase/migrations/042_canonical_markets.sql --dialect postgres 2>&1 | head -20` (if sqlfluff available). Otherwise skip — the apply step below will surface syntax errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/042_canonical_markets.sql
git commit -m "feat(db): migration 042 canonical_markets catalog + seed"
```

---

## Task 2: Migration 043 — extend market_normalization

**Files:**
- Create: `supabase/migrations/043_market_normalization_ext.sql`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/043_market_normalization_ext.sql`:

```sql
-- 043_market_normalization_ext.sql
-- Extend market_normalization with line/provenance columns, tighten source whitelist, add FK to canonical_markets.

ALTER TABLE market_normalization
  ADD COLUMN IF NOT EXISTS canonical_line NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS extracted_by   TEXT,
  ADD COLUMN IF NOT EXISTS confidence     SMALLINT;

ALTER TABLE market_normalization
  DROP CONSTRAINT IF EXISTS market_normalization_source_check;

ALTER TABLE market_normalization
  ADD CONSTRAINT market_normalization_source_check
    CHECK (source IN ('kambi','22bet'));

ALTER TABLE market_normalization
  DROP CONSTRAINT IF EXISTS market_norm_canonical_fk;

ALTER TABLE market_normalization
  ADD CONSTRAINT market_norm_canonical_fk
    FOREIGN KEY (canonical_key)
    REFERENCES canonical_markets(canonical_key)
    ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE market_normalization
  ADD CONSTRAINT market_normalization_extracted_by_check
    CHECK (extracted_by IS NULL OR extracted_by IN ('manual','regex','dictionary','propagation','fuzzy','llm'));

ALTER TABLE market_normalization
  ADD CONSTRAINT market_normalization_confidence_check
    CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 100));

CREATE INDEX IF NOT EXISTS idx_market_norm_unverified
  ON market_normalization(source, extracted_by)
  WHERE verified = false AND canonical_key IS NOT NULL;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/043_market_normalization_ext.sql
git commit -m "feat(db): migration 043 extend market_normalization (line + provenance + FK)"
```

---

## Task 3: Apply migrations to STAGING DB

**Files:**
- Apply via psql

- [ ] **Step 1: Fetch staging DB host + password from env**

Source of truth (in order of priority):

1. `.env.staging` in repo root:
   ```bash
   grep -E "SUPABASE_URL|SUPABASE_DB|STAGING_DB" .env.staging 2>&1 | head -5
   ```
2. staging-vps filesystem:
   ```bash
   ssh staging-vps "cat /root/betssolution-admin/.env.local 2>/dev/null | grep -E 'SUPABASE_URL|DB_PASSWORD'"
   ```
3. Memory reference: `memory/betssolution-staging-cicd.md` — documents staging setup.

The Supabase DB host for staging follows pattern `db.<PROJECT_REF>.supabase.co` where PROJECT_REF is extractable from `NEXT_PUBLIC_SUPABASE_URL`. If none of these three sources yield the password, STOP and surface to human — do not proceed with migrations.

- [ ] **Step 2: Apply migration 042 on STAGING**

Run (substitute staging host):
```bash
ssh scraper-vps "PGPASSWORD=<STAGING_DB_PASSWORD> psql -h <STAGING_DB_HOST> -U postgres -d postgres -f -" < supabase/migrations/042_canonical_markets.sql
```

Expected output: `CREATE TABLE`, `CREATE INDEX`, `INSERT 0 30`.

- [ ] **Step 3: Verify 042 on STAGING**

Run:
```bash
ssh scraper-vps "PGPASSWORD=<PWD> psql -h <HOST> -U postgres -d postgres -c 'SELECT COUNT(*) FROM canonical_markets;'"
```

Expected: `count >= 30`.

- [ ] **Step 4: Apply migration 043 on STAGING**

```bash
ssh scraper-vps "PGPASSWORD=<PWD> psql -h <HOST> -U postgres -d postgres -f -" < supabase/migrations/043_market_normalization_ext.sql
```

Expected: `ALTER TABLE` several times.

- [ ] **Step 5: Verify 043 on STAGING**

```bash
ssh scraper-vps "PGPASSWORD=<PWD> psql -h <HOST> -U postgres -d postgres -c '\\d market_normalization' | head -30"
```

Expected: new columns `canonical_line`, `extracted_by`, `confidence` visible; CHECK constraint on source now lists only kambi + 22bet.

---

## Task 4: Types + period helper

**Files:**
- Create: `lib/normalize/types.ts`
- Create: `lib/normalize/period.ts`
- Create: `tests/lib/normalize/period.test.ts`

- [ ] **Step 1: Create types**

Create `lib/normalize/types.ts`:

```typescript
export type Source = 'kambi' | '22bet';
export type Period = 'ft' | '1h' | '2h' | 'et' | 'regular_time';
export type ExtractedBy = 'manual' | 'regex' | 'dictionary' | 'propagation' | 'fuzzy' | 'llm';

export interface NormalizationRow {
  source: Source;
  source_market_type: string;
  canonical_key: string | null;
  canonical_line: number | null;
  canonical_name_it: string | null;
  verified: boolean;
  extracted_by: ExtractedBy | null;
  confidence: number | null;
  notes: string | null;
}

export interface ParsedMarketType {
  base_key: string;
  period: Period;
  line: number | null;
}

export interface StageResult {
  canonical_key: string;
  canonical_line: number | null;
  canonical_name_it: string | null;
  confidence: number;
  extracted_by: ExtractedBy;
}

export interface CanonicalMarket {
  canonical_key: string;
  base_key: string;
  period: Period;
  canonical_name_it: string;
  has_line: boolean;
  outcomes: Array<{ key: string; name_it: string }>;
}

export interface EngineSummary {
  processed: number;
  matched: { regex: number; dictionary: number; propagation: number };
  unmatched: number;
  remaining: number;
  took_ms: number;
}
```

- [ ] **Step 2: Write failing test for period helper**

Create `tests/lib/normalize/period.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { normalizePeriod } from "@/lib/normalize/period";

describe("normalizePeriod", () => {
  it("returns 'ft' for empty, null, or full-time strings", () => {
    expect(normalizePeriod("")).toBe("ft");
    expect(normalizePeriod(null)).toBe("ft");
    expect(normalizePeriod(undefined)).toBe("ft");
  });

  it("recognises Italian first-half forms", () => {
    expect(normalizePeriod("1T")).toBe("1h");
    expect(normalizePeriod("1° Tempo")).toBe("1h");
    expect(normalizePeriod("1° tempo")).toBe("1h");
    expect(normalizePeriod("- 1T")).toBe("1h");
    expect(normalizePeriod("1T 1.5")).toBe("1h"); // with trailing line
  });

  it("recognises Italian second-half forms", () => {
    expect(normalizePeriod("2T")).toBe("2h");
    expect(normalizePeriod("2° Tempo")).toBe("2h");
    expect(normalizePeriod("- 2T")).toBe("2h");
  });

  it("falls through to 'ft' on unknown fragments", () => {
    expect(normalizePeriod("Regolamentari")).toBe("ft");
    expect(normalizePeriod("Supplementari")).toBe("ft");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm test tests/lib/normalize/period.test.ts
```

Expected: FAIL with "Cannot find module @/lib/normalize/period".

- [ ] **Step 4: Implement period helper**

Create `lib/normalize/period.ts`:

```typescript
import type { Period } from "./types";

// Word boundaries to avoid matching "21T" or "1Tempo" inside longer tokens.
const HALF_1 = /\b1\s*T\b|\b1°\s*tempo\b|\bprimo\s*tempo\b/i;
const HALF_2 = /\b2\s*T\b|\b2°\s*tempo\b|\bsecondo\s*tempo\b/i;

export function normalizePeriod(fragment: string | null | undefined): Period {
  if (!fragment) return "ft";
  if (HALF_1.test(fragment)) return "1h";
  if (HALF_2.test(fragment)) return "2h";
  return "ft";
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm test tests/lib/normalize/period.test.ts
```

Expected: PASS (6 passes).

- [ ] **Step 6: Commit**

```bash
git add lib/normalize/types.ts lib/normalize/period.ts tests/lib/normalize/period.test.ts
git commit -m "feat(normalize): types + period helper with tests"
```

---

## Task 5: Stage 1 — regex patterns

**Files:**
- Create: `lib/normalize/regex-patterns.ts`
- Create: `tests/lib/normalize/regex-patterns.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/normalize/regex-patterns.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseMarketType } from "@/lib/normalize/regex-patterns";

describe("parseMarketType — base markets", () => {
  it("parses 1X2 full time", () => {
    expect(parseMarketType("1X2")).toEqual({ base_key: "1x2", period: "ft", line: null });
  });

  it("parses 1X2 first half (Kambi '1X2 1T' form)", () => {
    expect(parseMarketType("1X2 1T")).toEqual({ base_key: "1x2", period: "1h", line: null });
  });

  it("parses 1X2 second half (22bet '1X2 - 2T' form)", () => {
    expect(parseMarketType("1X2 - 2T")).toEqual({ base_key: "1x2", period: "2h", line: null });
  });

  it("parses DC with Italian period name", () => {
    expect(parseMarketType("DC 1° Tempo")).toEqual({ base_key: "dc", period: "1h", line: null });
  });

  it("parses GG/NG", () => {
    expect(parseMarketType("GG/NG")).toEqual({ base_key: "gg_ng", period: "ft", line: null });
  });

  it("parses Pari/Dispari", () => {
    expect(parseMarketType("Pari/Dispari")).toEqual({ base_key: "odd_even", period: "ft", line: null });
  });
});

describe("parseMarketType — U/O parametric", () => {
  it("parses Kambi 'U/O 2.5'", () => {
    expect(parseMarketType("U/O 2.5")).toEqual({ base_key: "u_o", period: "ft", line: 2.5 });
  });

  it("parses Kambi 'U/O 1T 1.5'", () => {
    expect(parseMarketType("U/O 1T 1.5")).toEqual({ base_key: "u_o", period: "1h", line: 1.5 });
  });

  it("parses 22bet 'U/O 1.5 - 1T'", () => {
    expect(parseMarketType("U/O 1.5 - 1T")).toEqual({ base_key: "u_o", period: "1h", line: 1.5 });
  });

  it("parses integer lines ('U/O 3')", () => {
    expect(parseMarketType("U/O 3")).toEqual({ base_key: "u_o", period: "ft", line: 3 });
  });
});

describe("parseMarketType — handicap parametric", () => {
  it("parses '1X2 H (-1)'", () => {
    expect(parseMarketType("1X2 H (-1)")).toEqual({ base_key: "1x2_handicap", period: "ft", line: -1 });
  });

  it("parses '1X2 H (+1.5)'", () => {
    expect(parseMarketType("1X2 H (+1.5)")).toEqual({ base_key: "1x2_handicap", period: "ft", line: 1.5 });
  });

  it("parses '1X2 H (0)' (pickem)", () => {
    expect(parseMarketType("1X2 H (0)")).toEqual({ base_key: "1x2_handicap", period: "ft", line: 0 });
  });
});

describe("parseMarketType — special", () => {
  it("parses 'Risultato Esatto'", () => {
    expect(parseMarketType("Risultato Esatto")).toEqual({ base_key: "correct_score", period: "ft", line: null });
  });

  it("parses 'Risultato Esatto 1° Tempo'", () => {
    expect(parseMarketType("Risultato Esatto 1° Tempo")).toEqual({ base_key: "correct_score", period: "1h", line: null });
  });

  it("parses 'Draw No Bet'", () => {
    expect(parseMarketType("Draw No Bet")).toEqual({ base_key: "dnb", period: "ft", line: null });
  });

  it("parses 'Draw No Bet 1T'", () => {
    expect(parseMarketType("Draw No Bet 1T")).toEqual({ base_key: "dnb", period: "1h", line: null });
  });

  it("parses 'Esito 1T/Finale'", () => {
    expect(parseMarketType("Esito 1T/Finale")).toEqual({ base_key: "htft", period: "ft", line: null });
  });
});

describe("parseMarketType — unknown", () => {
  it("returns null for unrecognised strings", () => {
    expect(parseMarketType("Qualche Mercato Esotico")).toBeNull();
    expect(parseMarketType("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/lib/normalize/regex-patterns.test.ts
```

Expected: FAIL with missing module.

- [ ] **Step 3: Implement regex patterns**

Create `lib/normalize/regex-patterns.ts`:

```typescript
import type { ParsedMarketType } from "./types";
import { normalizePeriod } from "./period";

// Rule: each entry has a regex. First capture group is the period fragment (optional),
// second capture group (if present) is a numeric line. base_key is fixed per rule.
// Rules are tried top-to-bottom; first match wins.
const RULES: Array<{
  base_key: string;
  pattern: RegExp;
  linePos?: number;
  periodPos?: number;
}> = [
  // --- U/O (explicit: period can come before or after line) ---
  // Kambi form: "U/O 2.5", "U/O 1T 1.5"
  { base_key: "u_o",          pattern: /^U\/O(?:\s+(\d\s*T|\d°\s*Tempo))?\s+([\d.]+)$/i, periodPos: 1, linePos: 2 },
  // 22bet form: "U/O 1.5 - 1T"
  { base_key: "u_o",          pattern: /^U\/O\s+([\d.]+)(?:\s+-\s+(\d\s*T))?$/i,         linePos: 1, periodPos: 2 },

  // --- 1X2 Handicap: "1X2 H (-1.5)" ---
  { base_key: "1x2_handicap", pattern: /^1X2\s+H\s+\(([+-]?[\d.]+)\)$/i, linePos: 1 },

  // --- Totale Asiatico / Asian handicap forms ---
  { base_key: "asian_handicap",pattern:/^Handicap\s+Asiatico\s+\(([+-]?[\d.]+)\)$/i,    linePos: 1 },

  // --- Totale Squadra home/away ---
  { base_key: "total_team",   pattern: /^Totale\s+Squadra\s+([\d.]+)$/i, linePos: 1 },

  // --- DC with optional period suffix ---
  { base_key: "dc",           pattern: /^DC(?:\s+(.+))?$/i, periodPos: 1 },

  // --- 1X2 with optional period suffix ---
  { base_key: "1x2",          pattern: /^1X2(?:\s+(.+))?$/i, periodPos: 1 },

  // --- GG/NG with optional period suffix ---
  { base_key: "gg_ng",        pattern: /^GG\/NG(?:\s+(.+))?$/i, periodPos: 1 },

  // --- Pari/Dispari ---
  { base_key: "odd_even",     pattern: /^Pari\/Dispari(?:\s+(.+))?$/i, periodPos: 1 },

  // --- Risultato Esatto ---
  { base_key: "correct_score",pattern: /^Risultato\s+Esatto(?:\s+(.+))?$/i, periodPos: 1 },

  // --- Draw No Bet ---
  { base_key: "dnb",          pattern: /^Draw\s+No\s+Bet(?:\s+(.+))?$/i, periodPos: 1 },

  // --- Esito 1T/Finale ---
  { base_key: "htft",         pattern: /^Esito\s+1T\/Finale$/i },
];

export function parseMarketType(input: string): ParsedMarketType | null {
  if (!input) return null;
  const s = input.trim();

  for (const rule of RULES) {
    const match = s.match(rule.pattern);
    if (!match) continue;
    const periodFragment = rule.periodPos != null ? match[rule.periodPos] : null;
    const lineStr = rule.linePos != null ? match[rule.linePos] : null;
    return {
      base_key: rule.base_key,
      period: normalizePeriod(periodFragment),
      line: lineStr != null ? parseFloat(lineStr) : null,
    };
  }
  return null;
}

/**
 * Given a parsed market type, look up the canonical_key by joining
 * base_key + period. Used by stage 1 to build the final StageResult.
 */
export function canonicalKeyFor(parsed: ParsedMarketType): string {
  return `${parsed.base_key}_${parsed.period}`.replace("_handicap_", "_h_");
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test tests/lib/normalize/regex-patterns.test.ts
```

Expected: PASS (all). Any failures mean regex needs iteration — fix and rerun.

- [ ] **Step 5: Commit**

```bash
git add lib/normalize/regex-patterns.ts tests/lib/normalize/regex-patterns.test.ts
git commit -m "feat(normalize): stage 1 regex patterns with exhaustive tests"
```

---

## Task 6: Stage 2 — dictionary lookups

**Files:**
- Create: `lib/normalize/dictionary.ts`
- Create: `tests/lib/normalize/dictionary.test.ts`

- [ ] **Step 1: Write failing test (in-memory fake for 22bet dictionary)**

Create `tests/lib/normalize/dictionary.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { lookupDictionary } from "@/lib/normalize/dictionary";
import type { CanonicalMarket } from "@/lib/normalize/types";

const CANONICALS: CanonicalMarket[] = [
  { canonical_key: "1x2_ft",   base_key: "1x2",   period: "ft", canonical_name_it: "1X2", has_line: false, outcomes: [] },
  { canonical_key: "dnb_ft",   base_key: "dnb",   period: "ft", canonical_name_it: "Draw No Bet", has_line: false, outcomes: [] },
  { canonical_key: "gg_ng_ft", base_key: "gg_ng", period: "ft", canonical_name_it: "Goal/No Goal", has_line: false, outcomes: [] },
];

describe("lookupDictionary — 22bet", () => {
  it("returns canonical_key when twobet_market_groups exact-matches name_it", () => {
    const twobetGroups = [{ twobet_g: 1, name_it: "1x2" }];
    const result = lookupDictionary({
      source: "22bet",
      source_market_type: "1X2",
      canonicals: CANONICALS,
      twobetGroups,
    });
    expect(result).toEqual({
      canonical_key: "1x2_ft",
      canonical_line: null,
      canonical_name_it: "1X2",
      confidence: 90,
      extracted_by: "dictionary",
    });
  });

  it("returns null when no dictionary match", () => {
    const result = lookupDictionary({
      source: "22bet",
      source_market_type: "Mercato Esotico",
      canonicals: CANONICALS,
      twobetGroups: [],
    });
    expect(result).toBeNull();
  });
});

describe("lookupDictionary — kambi", () => {
  it("maps italianized Kambi string 'Draw No Bet' to dnb_ft", () => {
    const result = lookupDictionary({
      source: "kambi",
      source_market_type: "Draw No Bet",
      canonicals: CANONICALS,
      twobetGroups: [],
    });
    expect(result).toEqual({
      canonical_key: "dnb_ft",
      canonical_line: null,
      canonical_name_it: "Draw No Bet",
      confidence: 90,
      extracted_by: "dictionary",
    });
  });

  it("returns null for unknown Kambi string", () => {
    const result = lookupDictionary({
      source: "kambi",
      source_market_type: "Unknown Market",
      canonicals: CANONICALS,
      twobetGroups: [],
    });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/lib/normalize/dictionary.test.ts
```

Expected: FAIL (module missing).

- [ ] **Step 3: Implement dictionary lookups**

Create `lib/normalize/dictionary.ts`:

```typescript
import type { CanonicalMarket, Source, StageResult } from "./types";

// Kambi-specific: italian form → base_key. Period is detected from trailing fragment via caller.
// Entries must be lowercased for matching.
const KAMBI_ITALIAN_MAP: Record<string, string> = {
  "1x2": "1x2",
  "dc": "dc",
  "gg/ng": "gg_ng",
  "pari/dispari": "odd_even",
  "risultato esatto": "correct_score",
  "draw no bet": "dnb",
  "esito 1t/finale": "htft",
  "testa a testa": "h2h",
};

// 22bet twobet_g code → base_key map (from Kambi API documentation + 22bet twobet_market_groups).
// These are the most common mappings; the DB table is authoritative for lookup.
const TWOBET_G_MAP: Record<number, string> = {
  1: "1x2",
  8: "dc",
  14: "odd_even",
  15: "total_team",
  27: "asian_handicap",
  62: "total_team",
  99: "asian_total",
  136: "correct_score",
  2854: "asian_handicap",
};

export interface LookupArgs {
  source: Source;
  source_market_type: string;
  canonicals: CanonicalMarket[];
  twobetGroups: Array<{ twobet_g: number; name_it: string }>;
}

export function lookupDictionary(args: LookupArgs): StageResult | null {
  const { source, source_market_type, canonicals, twobetGroups } = args;
  const needle = source_market_type.trim().toLowerCase();

  let base_key: string | undefined;

  if (source === "22bet") {
    // Exact match on name_it (case-insensitive)
    const group = twobetGroups.find((g) => g.name_it.toLowerCase() === needle);
    if (group) base_key = TWOBET_G_MAP[group.twobet_g];
  } else if (source === "kambi") {
    base_key = KAMBI_ITALIAN_MAP[needle];
  }

  if (!base_key) return null;

  // Default period = ft. Dictionary stage does NOT attempt to parse period suffixes —
  // that's stage 1's job. Dictionary matches only when the full string matches a known base.
  const canonical = canonicals.find((c) => c.base_key === base_key && c.period === "ft");
  if (!canonical) return null;

  return {
    canonical_key: canonical.canonical_key,
    canonical_line: null,
    canonical_name_it: canonical.canonical_name_it,
    confidence: 90,
    extracted_by: "dictionary",
  };
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test tests/lib/normalize/dictionary.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/normalize/dictionary.ts tests/lib/normalize/dictionary.test.ts
git commit -m "feat(normalize): stage 2 dictionary lookup for kambi + 22bet"
```

---

## Task 7: Stage 3 — cross-source propagation

**Files:**
- Create: `lib/normalize/propagation.ts`
- Create: `tests/lib/normalize/propagation.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/normalize/propagation.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { propagate } from "@/lib/normalize/propagation";
import type { NormalizationRow } from "@/lib/normalize/types";

const KAMBI_VERIFIED: NormalizationRow = {
  source: "kambi",
  source_market_type: "Triple Chance",
  canonical_key: "triple_chance_ft",
  canonical_line: null,
  canonical_name_it: "Triple Chance",
  verified: true,
  extracted_by: "manual",
  confidence: 100,
  notes: null,
};

describe("propagate — literal-string strategy", () => {
  it("propagates from verified kambi row to unmapped 22bet row with same string", () => {
    const result = propagate({
      source: "22bet",
      source_market_type: "Triple Chance",
      verifiedRows: [KAMBI_VERIFIED],
    });
    expect(result).toEqual({
      canonical_key: "triple_chance_ft",
      canonical_line: null,
      canonical_name_it: "Triple Chance",
      confidence: 85,
      extracted_by: "propagation",
    });
  });

  it("returns null when no verified row matches literally", () => {
    const result = propagate({
      source: "22bet",
      source_market_type: "Another Market",
      verifiedRows: [KAMBI_VERIFIED],
    });
    expect(result).toBeNull();
  });

  it("does not propagate from unverified rows", () => {
    const unverified: NormalizationRow = { ...KAMBI_VERIFIED, verified: false };
    const result = propagate({
      source: "22bet",
      source_market_type: "Triple Chance",
      verifiedRows: [unverified],
    });
    expect(result).toBeNull();
  });

  it("skips self-source (would only match literally on itself)", () => {
    const result = propagate({
      source: "kambi",
      source_market_type: "Triple Chance",
      verifiedRows: [KAMBI_VERIFIED],
    });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/lib/normalize/propagation.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement propagation**

Create `lib/normalize/propagation.ts`:

```typescript
import type { NormalizationRow, Source, StageResult } from "./types";

export interface PropagateArgs {
  source: Source;
  source_market_type: string;
  verifiedRows: NormalizationRow[];
}

/**
 * Stage 3 — literal-string cross-source propagation.
 * If the exact same source_market_type string is already verified on ANOTHER source,
 * copy canonical_key + canonical_line with confidence=85.
 *
 * Tuple-match (parsed base/period/line equality) is handled upstream in the engine
 * by feeding parsed tuples into this function via a separate call path (see engine.ts).
 */
export function propagate(args: PropagateArgs): StageResult | null {
  const { source, source_market_type, verifiedRows } = args;

  const match = verifiedRows.find(
    (r) =>
      r.verified &&
      r.canonical_key &&
      r.source !== source &&
      r.source_market_type === source_market_type,
  );

  if (!match) return null;

  return {
    canonical_key: match.canonical_key!,
    canonical_line: match.canonical_line,
    canonical_name_it: match.canonical_name_it,
    confidence: 85,
    extracted_by: "propagation",
  };
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test tests/lib/normalize/propagation.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/normalize/propagation.ts tests/lib/normalize/propagation.test.ts
git commit -m "feat(normalize): stage 3 literal-string cross-source propagation"
```

---

## Task 8: Engine orchestrator

**Files:**
- Create: `lib/normalize/engine.ts`
- Create: `tests/lib/normalize/engine.test.ts`

- [ ] **Step 1: Write failing integration test with fake supabase**

Create `tests/lib/normalize/engine.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { runEngine } from "@/lib/normalize/engine";
import type { CanonicalMarket, NormalizationRow } from "@/lib/normalize/types";

const CANONICALS: CanonicalMarket[] = [
  { canonical_key: "1x2_ft",   base_key: "1x2",   period: "ft", canonical_name_it: "1X2",             has_line: false, outcomes: [] },
  { canonical_key: "u_o_ft",   base_key: "u_o",   period: "ft", canonical_name_it: "Under/Over",      has_line: true,  outcomes: [] },
  { canonical_key: "gg_ng_ft", base_key: "gg_ng", period: "ft", canonical_name_it: "Goal/No Goal",    has_line: false, outcomes: [] },
];

function makeFakeClient(opts: {
  unmapped: Array<{ source: string; market_type: string }>;
  verified: NormalizationRow[];
  twobetGroups: Array<{ twobet_g: number; name_it: string }>;
  chunkSize?: number;
}) {
  const upserts: any[] = [];
  const totalUnmapped = opts.unmapped.length;
  const effectiveChunk = opts.chunkSize ?? totalUnmapped;
  return {
    upserts,
    client: {
      rpc: vi.fn(async (name: string, params?: any) => {
        if (name === "list_unmapped_market_types") {
          const limit = params?.p_limit ?? effectiveChunk;
          return { data: opts.unmapped.slice(0, limit), error: null };
        }
        if (name === "count_unmapped_market_types") {
          // Engine calls this AFTER processing a chunk. Return remaining-after-chunk.
          const remaining = Math.max(0, totalUnmapped - Math.min(effectiveChunk, totalUnmapped));
          return { data: remaining, error: null };
        }
        return { data: [], error: null };
      }),
      from: vi.fn((table: string) => ({
        select: () => ({
          eq: () => ({ data: [] as any[], error: null }),
          ... (table === "market_normalization"
            ? { data: opts.verified as any, error: null }
            : table === "canonical_markets"
            ? { data: CANONICALS as any, error: null }
            : table === "twobet_market_groups"
            ? { data: opts.twobetGroups as any, error: null }
            : { data: [] as any, error: null }),
        }),
        upsert: (row: any) => {
          upserts.push(row);
          return { select: () => ({ single: () => ({ data: row, error: null }) }) };
        },
      })),
    },
  };
}

describe("runEngine", () => {
  it("matches U/O via regex and upserts canonical_key + line", async () => {
    const { client, upserts } = makeFakeClient({
      unmapped: [{ source: "kambi", market_type: "U/O 2.5" }],
      verified: [],
      twobetGroups: [],
    });
    const summary = await runEngine({ client: client as any, chunkSize: 100 });
    expect(summary.matched.regex).toBe(1);
    expect(upserts[0]).toMatchObject({
      source: "kambi",
      source_market_type: "U/O 2.5",
      canonical_key: "u_o_ft",
      canonical_line: 2.5,
      extracted_by: "regex",
      confidence: 95,
      verified: false,
    });
  });

  it("falls through to dictionary when regex fails", async () => {
    const { client, upserts } = makeFakeClient({
      unmapped: [{ source: "22bet", market_type: "1X2" }],
      verified: [],
      twobetGroups: [{ twobet_g: 1, name_it: "1x2" }],
    });
    const summary = await runEngine({ client: client as any, chunkSize: 100 });
    // regex ALSO matches 1X2, so this tests that regex takes priority when both could match
    expect(summary.matched.regex).toBe(1);
    expect(summary.matched.dictionary).toBe(0);
    expect(upserts[0].canonical_key).toBe("1x2_ft");
  });

  it("respects chunk size and reports remaining", async () => {
    const unmapped = Array.from({ length: 10 }, (_, i) => ({ source: "kambi", market_type: `U/O ${i}.5` }));
    const { client } = makeFakeClient({ unmapped, verified: [], twobetGroups: [], chunkSize: 3 });
    const summary = await runEngine({ client: client as any, chunkSize: 3 });
    expect(summary.processed).toBe(3);
    expect(summary.remaining).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/lib/normalize/engine.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Add RPCs to migration 043 — list_unmapped + count_unmapped**

Edit `supabase/migrations/043_market_normalization_ext.sql` — append at end (keep migration focused):

```sql
-- Helper RPC 1: list distinct (source, market_type) pairs with counts NOT yet in market_normalization.
-- Returns up to p_limit rows ordered by market_count DESC (prioritize high-impact mappings).
CREATE OR REPLACE FUNCTION list_unmapped_market_types(p_limit INT DEFAULT 500)
RETURNS TABLE (source TEXT, market_type TEXT, event_count BIGINT, market_count BIGINT)
LANGUAGE sql STABLE AS $$
  SELECT e.source::text, m.market_type::text, COUNT(DISTINCT e.id), COUNT(*)
  FROM markets m
  JOIN events e ON e.id = m.event_id
  WHERE m.is_active
    AND e.source IN ('kambi','22bet')
    AND NOT EXISTS (
      SELECT 1 FROM market_normalization mn
      WHERE mn.source = e.source
        AND mn.source_market_type = m.market_type
        AND mn.canonical_key IS NOT NULL
    )
  GROUP BY e.source, m.market_type
  ORDER BY COUNT(*) DESC
  LIMIT p_limit;
$$;

-- Helper RPC 2: cheap count of remaining unmapped rows (used by engine to report `remaining`).
CREATE OR REPLACE FUNCTION count_unmapped_market_types()
RETURNS INT
LANGUAGE sql STABLE AS $$
  SELECT COUNT(DISTINCT (e.source, m.market_type))::int
  FROM markets m
  JOIN events e ON e.id = m.event_id
  WHERE m.is_active
    AND e.source IN ('kambi','22bet')
    AND NOT EXISTS (
      SELECT 1 FROM market_normalization mn
      WHERE mn.source = e.source
        AND mn.source_market_type = m.market_type
        AND mn.canonical_key IS NOT NULL
    );
$$;

ALTER FUNCTION list_unmapped_market_types(INT) SET statement_timeout = '300s';
ALTER FUNCTION count_unmapped_market_types()   SET statement_timeout = '300s';
```

Note: re-apply 043 on staging after this change (task 3 step 4 is repeatable — ALTER ADD IF NOT EXISTS and CREATE OR REPLACE FUNCTION are both idempotent).

- [ ] **Step 3.5: Re-apply migration 043 on staging**

Ordering note: Task 3 applied the initial 043 before the RPCs were appended. After appending them in Step 3 above, re-run:

```bash
ssh scraper-vps "PGPASSWORD=<STAGING_PWD> psql -h <STAGING_HOST> -U postgres -d postgres -f -" < supabase/migrations/043_market_normalization_ext.sql
```

Expected output includes `CREATE FUNCTION` (x2) and `ALTER FUNCTION` (x2). Verify:

```bash
ssh scraper-vps "PGPASSWORD=<PWD> psql -h <HOST> -U postgres -d postgres -c 'SELECT count_unmapped_market_types();'"
```

Expected: integer result (the current prod-staging unmapped count).

- [ ] **Step 4: Implement engine**

Create `lib/normalize/engine.ts`:

```typescript
import type { CanonicalMarket, EngineSummary, NormalizationRow, Source, StageResult } from "./types";
import { parseMarketType, canonicalKeyFor } from "./regex-patterns";
import { lookupDictionary } from "./dictionary";
import { propagate } from "./propagation";

export interface RunEngineArgs {
  client: any;          // SupabaseClient (admin)
  chunkSize?: number;   // default 500
}

export async function runEngine(args: RunEngineArgs): Promise<EngineSummary> {
  const client = args.client;
  const chunkSize = args.chunkSize ?? 500;
  const start = Date.now();

  // Fetch catalog + dictionary + verified rows once per run.
  const { data: canonicals } = await client.from("canonical_markets").select("*");
  const { data: twobetGroups } = await client.from("twobet_market_groups").select("twobet_g, name_it");
  const { data: verifiedRows } = await client
    .from("market_normalization")
    .select("source, source_market_type, canonical_key, canonical_line, canonical_name_it, verified, extracted_by, confidence, notes")
    .eq("verified", true);

  const catalog: CanonicalMarket[] = (canonicals ?? []) as CanonicalMarket[];
  const verified: NormalizationRow[] = (verifiedRows ?? []) as NormalizationRow[];
  const groups = (twobetGroups ?? []) as Array<{ twobet_g: number; name_it: string }>;

  // Fetch unmapped batch
  const { data: unmapped } = await client.rpc("list_unmapped_market_types", { p_limit: chunkSize });
  const rows: Array<{ source: string; market_type: string }> = (unmapped ?? []) as any;

  const matched = { regex: 0, dictionary: 0, propagation: 0 };
  let unmatchedCount = 0;

  for (const row of rows) {
    const source = row.source as Source;
    const smt = row.market_type;

    // Stage 1: regex
    let result: StageResult | null = null;
    const parsed = parseMarketType(smt);
    if (parsed) {
      const ck = canonicalKeyFor(parsed);
      const canon = catalog.find((c) => c.canonical_key === ck);
      if (canon) {
        result = {
          canonical_key: canon.canonical_key,
          canonical_line: parsed.line,
          canonical_name_it: canon.canonical_name_it,
          confidence: 95,
          extracted_by: "regex",
        };
        matched.regex++;
      }
    }

    // Stage 2: dictionary
    if (!result) {
      result = lookupDictionary({
        source,
        source_market_type: smt,
        canonicals: catalog,
        twobetGroups: groups,
      });
      if (result) matched.dictionary++;
    }

    // Stage 3: propagation
    if (!result) {
      result = propagate({ source, source_market_type: smt, verifiedRows: verified });
      if (result) matched.propagation++;
    }

    if (!result) {
      unmatchedCount++;
      continue;
    }

    await client.from("market_normalization").upsert(
      {
        source,
        source_market_type: smt,
        canonical_key: result.canonical_key,
        canonical_line: result.canonical_line,
        canonical_name_it: result.canonical_name_it,
        verified: false,
        extracted_by: result.extracted_by,
        confidence: result.confidence,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "source,source_market_type" },
    );
  }

  // Remaining count via cheap RPC (does NOT fetch 10K rows).
  const { data: remainingData } = await client.rpc("count_unmapped_market_types");
  const remaining = typeof remainingData === "number" ? remainingData : 0;

  return {
    processed: rows.length,
    matched,
    unmatched: unmatchedCount,
    remaining,
    took_ms: Date.now() - start,
  };
}
```

- [ ] **Step 5: Run tests**

```bash
pnpm test tests/lib/normalize/engine.test.ts
```

Expected: PASS. If failing, inspect — fake-client shape may need adjustment.

- [ ] **Step 6: Commit**

```bash
git add lib/normalize/engine.ts tests/lib/normalize/engine.test.ts supabase/migrations/043_market_normalization_ext.sql
git commit -m "feat(normalize): engine orchestrator + list_unmapped_market_types RPC"
```

---

## Task 9: CLI script + npm command

**Files:**
- Create: `scripts/normalize-markets.ts`
- Modify: `package.json`

- [ ] **Step 1: Create CLI wrapper**

Create `scripts/normalize-markets.ts`:

```typescript
#!/usr/bin/env tsx
/**
 * CLI entrypoint: runs the normalization engine against Supabase.
 * Usage:  pnpm normalize:markets [--chunk 500]
 */
import { createClient } from "@supabase/supabase-js";
import { runEngine } from "../lib/normalize/engine";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const chunkArg = process.argv.indexOf("--chunk");
  const chunkSize = chunkArg >= 0 ? parseInt(process.argv[chunkArg + 1], 10) : 500;

  const client = createClient(url, key, { auth: { persistSession: false } });

  console.log(`[normalize-markets] starting with chunkSize=${chunkSize}`);
  const summary = await runEngine({ client, chunkSize });
  console.log("[normalize-markets] done:", JSON.stringify(summary, null, 2));

  if (summary.remaining > 0) {
    console.log(`[normalize-markets] ${summary.remaining} rows still unmapped. Re-run to continue.`);
  }
}

main().catch((e) => {
  console.error("[normalize-markets] FATAL", e);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script**

Edit `package.json` — add under `"scripts"`:

```json
"normalize:markets": "tsx scripts/normalize-markets.ts"
```

- [ ] **Step 3: Verify tsx is available**

```bash
grep -E '"tsx"|"ts-node"' package.json
```

If tsx missing: `pnpm add -D tsx`.

- [ ] **Step 4: Test locally against staging DB (dry mode)**

Skip for now — deferred to task 17 after UI is ready and we can inspect results via the page.

- [ ] **Step 5: Commit**

```bash
git add scripts/normalize-markets.ts package.json
git commit -m "feat(normalize): CLI entrypoint + pnpm normalize:markets"
```

---

## Task 10: API — run-engine + bulk-confirm actions

**Files:**
- Modify: `app/api/admin/market-normalization/route.ts`

- [ ] **Step 1: Read current route**

```bash
cat app/api/admin/market-normalization/route.ts | head -80
```

Verify the existing `GET` + `POST` (upsert single row) + `DELETE` handlers stay intact — the plan ADDS new functionality but does not remove existing:
- `GET ?action=list` — rewritten (pagination + new filters)
- `GET ?action=canonical-keys` — unchanged
- `GET ?action=suggest` — unchanged
- `GET ?action=run-engine` — NEW
- `POST` (existing single upsert) — unchanged
- `PATCH` (bulk-confirm) — NEW
- `DELETE` — unchanged

- [ ] **Step 2: Update VALID_SOURCES + add handlers**

Edit `app/api/admin/market-normalization/route.ts`:

Change `VALID_SOURCES` at top:
```typescript
const VALID_SOURCES = ["kambi", "22bet"];  // was: [..., "leon", "goldbet", "ippica"]
```

Add to the GET switch:
```typescript
if (action === "run-engine") {
  return await runEngineChunk(supabase, sp);
}
```

Add at end of file:

```typescript
import { runEngine } from "@/lib/normalize/engine";

async function runEngineChunk(supabase: any, sp: URLSearchParams) {
  const chunk = parseInt(sp.get("chunk") || "500", 10);
  const summary = await runEngine({ client: supabase, chunkSize: Math.min(chunk, 1000) });
  return NextResponse.json(summary);
}

// ═══ POST — bulk confirm (sets verified=true for listed (source, source_market_type) pairs) ═══
export async function PATCH(req: NextRequest) {
  const supabase = createAdminClient();
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const action = body.action;
  if (action !== "bulk-confirm") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const items: Array<{ source: string; source_market_type: string }> = body.items ?? [];
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "items[] required" }, { status: 400 });
  }
  if (items.length > 500) {
    return NextResponse.json({ error: "max 500 items per call" }, { status: 400 });
  }

  // Bulk-confirm is a confirmation action, NOT a manual edit — we preserve
  // the existing extracted_by (regex/dictionary/propagation) so provenance is retained.
  // Only `verified` and `updated_at` are touched.
  let confirmed = 0;
  for (const it of items) {
    if (!VALID_SOURCES.includes(it.source)) continue;
    const { error } = await supabase
      .from("market_normalization")
      .update({ verified: true, updated_at: new Date().toISOString() })
      .eq("source", it.source)
      .eq("source_market_type", it.source_market_type);
    if (!error) confirmed++;
  }
  return NextResponse.json({ confirmed });
}
```

Update the `list` function to support pagination + new filters:

```typescript
async function list(supabase: any, source: string, sp: URLSearchParams) {
  const onlyUnmapped   = sp.get("only_unmapped") === "1";
  const onlyUnverified = sp.get("only_unverified") === "1";
  const q              = (sp.get("q") || "").trim();
  const confBucket     = sp.get("conf") || "all";     // all | high | med | low
  const extractedBy    = sp.get("extracted_by") || "";
  const page           = Math.max(1, parseInt(sp.get("page") || "1", 10));
  const perPage        = Math.min(500, parseInt(sp.get("per_page") || "100", 10));

  // Keep existing rpc call, then filter + paginate in-memory.
  // (For MVP: acceptable — max 21K+52K ~= 74K rows; slicing is cheap. Move to DB-side later if needed.)
  const { data: rows, error } = await supabase.rpc("list_source_market_types", {
    p_source: source,
    p_min_count: 1,
  });
  if (error) throw error;

  // Fetch ALL existing mappings for this source in one query (no .in() with 50K URL).
  // Build a Map<source_market_type, row> for O(1) lookup during the merge.
  const mapByType = new Map<string, any>();
  {
    const { data: norms } = await supabase
      .from("market_normalization")
      .select("source_market_type, canonical_key, canonical_line, canonical_name_it, verified, extracted_by, confidence, notes, updated_at")
      .eq("source", source);
    for (const n of norms ?? []) mapByType.set(n.source_market_type, n);
  }

  let merged: any[] = (rows ?? []).map((r: any) => {
    const norm = mapByType.get(r.market_type);
    return {
      source_market_type: r.market_type,
      event_count:  Number(r.event_count || 0),
      market_count: Number(r.market_count || 0),
      canonical_key:      norm?.canonical_key     ?? null,
      canonical_line:     norm?.canonical_line    ?? null,
      canonical_name_it:  norm?.canonical_name_it ?? null,
      verified:           !!norm?.verified,
      extracted_by:       norm?.extracted_by      ?? null,
      confidence:         norm?.confidence        ?? null,
      notes:              norm?.notes             ?? null,
      last_mapped_at:     norm?.updated_at        ?? null,
    };
  });

  if (onlyUnmapped)   merged = merged.filter((r) => !r.canonical_key);
  if (onlyUnverified) merged = merged.filter((r) => r.canonical_key && !r.verified);
  if (extractedBy)    merged = merged.filter((r) => r.extracted_by === extractedBy);
  if (confBucket === "high") merged = merged.filter((r) => (r.confidence ?? 0) > 85);
  if (confBucket === "med")  merged = merged.filter((r) => (r.confidence ?? 0) >= 50 && (r.confidence ?? 0) <= 85);
  if (confBucket === "low")  merged = merged.filter((r) => (r.confidence ?? 101) < 50);
  if (q) {
    const needle = q.toLowerCase();
    merged = merged.filter((r) =>
      r.source_market_type.toLowerCase().includes(needle) ||
      (r.canonical_key ?? "").toLowerCase().includes(needle) ||
      (r.canonical_name_it ?? "").toLowerCase().includes(needle),
    );
  }

  const total    = merged.length;
  const mapped   = merged.filter((r) => !!r.canonical_key).length;
  const verified = merged.filter((r) => r.verified).length;

  // Paginate
  const paged = merged.slice((page - 1) * perPage, page * perPage);

  return NextResponse.json({
    rows: paged,
    page,
    per_page: perPage,
    total_rows: total,
    kpis: {
      total,
      mapped,
      unmapped: total - mapped,
      verified,
      coverage_pct: total > 0 ? Math.round((mapped / total) * 1000) / 10 : 0,
    },
  });
}
```

- [ ] **Step 3: Build + typecheck**

```bash
pnpm run build 2>&1 | tail -30
```

Expected: no errors. If errors: read, fix, retry.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/market-normalization/route.ts
git commit -m "feat(api): run-engine (chunked) + bulk-confirm (PATCH) + pagination + filters"
```

---

## Task 11: API — canonical-markets CRUD

**Files:**
- Create: `app/api/admin/canonical-markets/route.ts`

- [ ] **Step 1: Create the route**

Create `app/api/admin/canonical-markets/route.ts`:

```typescript
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("canonical_markets")
    .select("*")
    .order("base_key");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Enrich each with count of mapped rows in market_normalization
  const { data: counts } = await supabase
    .from("market_normalization")
    .select("canonical_key");
  const countMap = new Map<string, number>();
  for (const r of counts ?? []) {
    if (!r.canonical_key) continue;
    countMap.set(r.canonical_key, (countMap.get(r.canonical_key) ?? 0) + 1);
  }
  const rows = (data ?? []).map((c: any) => ({
    ...c,
    mapped_count: countMap.get(c.canonical_key) ?? 0,
  }));
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const supabase = createAdminClient();
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const required = ["canonical_key", "base_key", "period", "canonical_name_it", "outcomes"];
  for (const k of required) {
    if (body[k] == null) return NextResponse.json({ error: `${k} required` }, { status: 400 });
  }
  const payload = {
    canonical_key: String(body.canonical_key),
    base_key: String(body.base_key),
    period: String(body.period),
    canonical_name_it: String(body.canonical_name_it),
    has_line: !!body.has_line,
    outcomes: body.outcomes,
    notes: body.notes ?? null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("canonical_markets")
    .upsert(payload, { onConflict: "canonical_key" })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ row: data });
}

export async function DELETE(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const key = sp.get("canonical_key");
  if (!key) return NextResponse.json({ error: "canonical_key required" }, { status: 400 });

  const supabase = createAdminClient();
  // Guard: cannot delete if any market_normalization row references it
  const { count } = await supabase
    .from("market_normalization")
    .select("*", { count: "exact", head: true })
    .eq("canonical_key", key);
  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: `Cannot delete: ${count} market_normalization rows reference this canonical.` }, { status: 409 });
  }
  const { error } = await supabase
    .from("canonical_markets")
    .delete()
    .eq("canonical_key", key);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Build**

```bash
pnpm run build 2>&1 | tail -15
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/canonical-markets/route.ts
git commit -m "feat(api): canonical-markets CRUD with FK-guard delete"
```

---

## Task 12: UI — `/admin/market-normalization` rewrite

**Files:**
- Modify: `app/admin/market-normalization/page.tsx` (full rewrite)

- [ ] **Step 1: Rewrite the page**

Replace the entire contents of `app/admin/market-normalization/page.tsx` with:

```typescript
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface Row {
  source_market_type: string;
  event_count: number;
  market_count: number;
  canonical_key: string | null;
  canonical_line: number | null;
  canonical_name_it: string | null;
  verified: boolean;
  extracted_by: string | null;
  confidence: number | null;
  notes: string | null;
  last_mapped_at: string | null;
}
interface Kpis { total: number; mapped: number; unmapped: number; verified: number; coverage_pct: number; }
interface CanonicalKey { canonical_key: string; canonical_name_it: string; count: number; }
interface EngineSummary { processed: number; matched: { regex: number; dictionary: number; propagation: number }; unmatched: number; remaining: number; took_ms: number; }

const SOURCES: Array<{ value: "kambi" | "22bet"; label: string; color: string }> = [
  { value: "kambi", label: "Kambi", color: "#8b5cf6" },
  { value: "22bet", label: "22bet", color: "#f97316" },
];

const CONF_OPTS = [
  { value: "all",  label: "Tutte" },
  { value: "high", label: "Alta (>85)" },
  { value: "med",  label: "Media (50-85)" },
  { value: "low",  label: "Bassa (<50)" },
];

const EXTRACTED_BY_OPTS = [
  { value: "",            label: "Tutti" },
  { value: "regex",       label: "Regex (rx)" },
  { value: "dictionary",  label: "Dictionary (dc)" },
  { value: "propagation", label: "Cross-source (xs)" },
  { value: "manual",      label: "Manuale" },
];

export default function MarketNormalizationPage() {
  const [source, setSource]           = useState<"kambi" | "22bet">("kambi");
  const [rows, setRows]               = useState<Row[]>([]);
  const [kpis, setKpis]               = useState<Kpis | null>(null);
  const [keys, setKeys]               = useState<CanonicalKey[]>([]);
  const [q, setQ]                     = useState("");
  const [onlyUnmapped, setOnlyUnmapped]     = useState(false);
  const [onlyUnverified, setOnlyUnverified] = useState(false);
  const [confBucket, setConfBucket]   = useState("all");
  const [extractedBy, setExtractedBy] = useState("");
  const [page, setPage]               = useState(1);
  const [perPage]                     = useState(100);
  const [totalRows, setTotalRows]     = useState(0);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState("");
  const [savingRow, setSavingRow]     = useState<string | null>(null);
  const [editing, setEditing]         = useState<Record<string, Partial<Row>>>({});
  const [selected, setSelected]       = useState<Set<string>>(new Set());
  const [running, setRunning]         = useState(false);
  const [lastSummary, setLastSummary] = useState<EngineSummary | null>(null);

  const sourceColor = SOURCES.find((s) => s.value === source)?.color ?? "#334155";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        action: "list", source,
        page: String(page), per_page: String(perPage),
        conf: confBucket,
      });
      if (q)              params.set("q", q);
      if (onlyUnmapped)   params.set("only_unmapped", "1");
      if (onlyUnverified) params.set("only_unverified", "1");
      if (extractedBy)    params.set("extracted_by", extractedBy);

      const [listRes, keysRes] = await Promise.all([
        fetch(`/api/admin/market-normalization?${params}`).then((r) => r.json()),
        fetch(`/api/admin/market-normalization?action=canonical-keys`).then((r) => r.json()),
      ]);

      if (listRes.error) throw new Error(listRes.error);
      setRows(listRes.rows ?? []);
      setKpis(listRes.kpis ?? null);
      setTotalRows(listRes.total_rows ?? 0);
      setKeys(keysRes.keys ?? []);
      setEditing({});
      setSelected(new Set());
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [source, q, onlyUnmapped, onlyUnverified, confBucket, extractedBy, page, perPage]);

  useEffect(() => { load(); }, [load]);

  const save = async (row: Row) => {
    const edit = editing[row.source_market_type] ?? {};
    const body = {
      source,
      source_market_type: row.source_market_type,
      canonical_key:     edit.canonical_key     ?? row.canonical_key,
      canonical_name_it: edit.canonical_name_it ?? row.canonical_name_it,
      canonical_line:    edit.canonical_line    ?? row.canonical_line,
      verified:          edit.verified          ?? row.verified,
      notes:             edit.notes             ?? row.notes,
    };
    setSavingRow(row.source_market_type);
    try {
      const r = await fetch(`/api/admin/market-normalization`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      setRows((prev) => prev.map((x) => x.source_market_type === row.source_market_type
        ? ({ ...x, ...body, extracted_by: "manual", confidence: 100, last_mapped_at: new Date().toISOString() } as Row)
        : x));
      setEditing((prev) => { const cp = { ...prev }; delete cp[row.source_market_type]; return cp; });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingRow(null);
    }
  };

  const clearMapping = async (row: Row) => {
    if (!confirm(`Rimuovere mappatura per "${row.source_market_type}"?`)) return;
    setSavingRow(row.source_market_type);
    try {
      const params = new URLSearchParams({ source, source_market_type: row.source_market_type });
      const r = await fetch(`/api/admin/market-normalization?${params}`, { method: "DELETE" }).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      await load();
    } catch (err: any) { setError(err.message); }
    finally { setSavingRow(null); }
  };

  const bulkConfirm = async () => {
    if (selected.size === 0) return;
    const items = Array.from(selected).map((smt) => ({ source, source_market_type: smt }));
    const r = await fetch(`/api/admin/market-normalization`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "bulk-confirm", items }),
    }).then((r) => r.json());
    if (r.error) setError(r.error);
    await load();
  };

  const runEngine = async () => {
    setRunning(true); setLastSummary(null);
    try {
      const r = await fetch(`/api/admin/market-normalization?action=run-engine&chunk=500`).then((r) => r.json());
      setLastSummary(r);
      await load();
    } catch (err: any) { setError(err.message); }
    finally { setRunning(false); }
  };

  const update = (smt: string, patch: Partial<Row>) => setEditing((prev) => ({ ...prev, [smt]: { ...(prev[smt] ?? {}), ...patch } }));
  const isDirty = (smt: string) => !!editing[smt] && Object.keys(editing[smt]!).length > 0;
  const toggleSelect = (smt: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(smt)) next.delete(smt); else next.add(smt);
    return next;
  });
  const toggleSelectAll = () => {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.filter((r) => r.canonical_key && !r.verified).map((r) => r.source_market_type)));
  };

  const confColor = (c: number | null) => {
    if (c == null) return "transparent";
    if (c > 85)  return "#10b98130";
    if (c >= 50) return "#eab30830";
    return "#ef444430";
  };
  const extractedBadge = (eb: string | null) => {
    if (!eb) return "—";
    const map: Record<string, string> = { regex: "rx", dictionary: "dc", propagation: "xs", fuzzy: "fz", llm: "ai", manual: "MAN" };
    return map[eb] ?? eb;
  };

  const totalPages = Math.max(1, Math.ceil(totalRows / perPage));

  return (
    <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Source switch — pill buttons, NOT tabs */}
      <div style={{ display: "flex", gap: 8 }}>
        {SOURCES.map((s) => (
          <button key={s.value}
            onClick={() => { setSource(s.value); setPage(1); }}
            style={{
              padding: "6px 14px", borderRadius: 999,
              background: source === s.value ? s.color : "transparent",
              color: source === s.value ? "#fff" : "var(--admin-text-muted)",
              border: `1px solid ${source === s.value ? s.color : "var(--admin-border)"}`,
              fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, cursor: "pointer",
            }}>{s.label}</button>
        ))}
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        <Kpi label="Mercati distinti" value={kpis?.total ?? "—"} accent={sourceColor} />
        <Kpi label="Mappati (auto+manual)" value={`${kpis?.mapped ?? 0} / ${kpis?.total ?? 0}`} accent="#3b82f6" sub={`${kpis?.coverage_pct ?? 0}%`} />
        <Kpi label="Verificati" value={kpis?.verified ?? "—"} accent="#10b981" />
        <Kpi label="Da mappare" value={kpis?.unmapped ?? "—"} accent={kpis && kpis.unmapped > 0 ? "#ef4444" : "#64748b"} />
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", padding: 12, border: "1px solid var(--admin-border)", borderRadius: 10, background: "var(--admin-card)", flexWrap: "wrap" }}>
        <input placeholder="Cerca market / canonical..." value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
          style={{ flex: 1, minWidth: 240, padding: "8px 12px", border: "1px solid var(--admin-border)", borderRadius: 6, background: "var(--admin-bg)", color: "var(--admin-text)", fontSize: 13 }} />
        <select value={confBucket} onChange={(e) => { setConfBucket(e.target.value); setPage(1); }} style={selectStyle}>
          {CONF_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={extractedBy} onChange={(e) => { setExtractedBy(e.target.value); setPage(1); }} style={selectStyle}>
          {EXTRACTED_BY_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <label style={checkLabelStyle}>
          <input type="checkbox" checked={onlyUnmapped}   onChange={(e) => { setOnlyUnmapped(e.target.checked); setPage(1); }} /> Solo non-mappati
        </label>
        <label style={checkLabelStyle}>
          <input type="checkbox" checked={onlyUnverified} onChange={(e) => { setOnlyUnverified(e.target.checked); setPage(1); }} /> Solo non-verificati
        </label>
        <button onClick={runEngine} disabled={running} style={btnStyle("#8b5cf6")}>{running ? "Engine in corso…" : "▶ Run engine"}</button>
        <button onClick={load} disabled={loading} style={btnStyle("#334155")}>{loading ? "…" : "Ricarica"}</button>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 14px", background: "rgba(16,185,129,0.08)", border: "1px solid #10b981", borderRadius: 8 }}>
          <span style={{ fontWeight: 700, color: "#10b981" }}>{selected.size} selezionati</span>
          <button onClick={bulkConfirm} style={btnStyle("#10b981")}>✓ Conferma selezionati (verified=true)</button>
          <button onClick={() => setSelected(new Set())} style={btnStyle("#334155")}>Annulla selezione</button>
        </div>
      )}

      {lastSummary && (
        <div style={{ padding: 10, background: "rgba(139,92,246,0.08)", border: "1px solid #8b5cf6", borderRadius: 8, color: "var(--admin-text)", fontSize: 12 }}>
          Engine: processed={lastSummary.processed}, regex={lastSummary.matched.regex}, dict={lastSummary.matched.dictionary}, prop={lastSummary.matched.propagation}, unmatched={lastSummary.unmatched}, remaining={lastSummary.remaining} ({lastSummary.took_ms}ms)
        </div>
      )}

      {error && (
        <div style={{ padding: 12, background: "#ef444420", border: "1px solid #ef4444", borderRadius: 8, color: "#fca5a5" }}>{error}</div>
      )}

      {/* Table */}
      <div style={{ border: "1px solid var(--admin-border)", borderRadius: 10, overflow: "auto", background: "var(--admin-card)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.04)", textAlign: "left" }}>
              <Th style={{ width: 32 }}>
                <input type="checkbox" checked={selected.size > 0 && selected.size === rows.filter((r) => r.canonical_key && !r.verified).length} onChange={toggleSelectAll} />
              </Th>
              <Th>Market type</Th>
              <Th align="right" style={{ width: 70 }}>Ev</Th>
              <Th align="right" style={{ width: 80 }}>Mkt</Th>
              <Th style={{ width: 180 }}>Canonical</Th>
              <Th align="right" style={{ width: 60 }}>Line</Th>
              <Th align="center" style={{ width: 70 }}>Conf</Th>
              <Th align="center" style={{ width: 50 }}>By</Th>
              <Th align="center" style={{ width: 60 }}>✓</Th>
              <Th align="right" style={{ width: 160 }}>Azioni</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const edit = editing[r.source_market_type] ?? {};
              const ck  = edit.canonical_key ?? r.canonical_key ?? "";
              const cl  = edit.canonical_line ?? r.canonical_line ?? null;
              const cn  = edit.canonical_name_it ?? r.canonical_name_it ?? "";
              const vr  = edit.verified ?? r.verified;
              const dirty = isDirty(r.source_market_type);
              const isSaving = savingRow === r.source_market_type;
              const canSelect = !!r.canonical_key && !r.verified;
              return (
                <tr key={r.source_market_type} style={{ borderTop: "1px solid var(--admin-border)", background: dirty ? "rgba(249,115,22,0.04)" : undefined }}>
                  <td style={tdStyle}>
                    <input type="checkbox" disabled={!canSelect} checked={selected.has(r.source_market_type)} onChange={() => toggleSelect(r.source_market_type)} />
                  </td>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 500, color: "var(--admin-text)" }}>{r.source_market_type}</div>
                    {r.last_mapped_at && <div style={{ fontSize: 10, color: "var(--admin-text-muted)", marginTop: 2 }}>aggiornato {timeAgo(r.last_mapped_at)}</div>}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--admin-text-muted)" }}>{r.event_count}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--admin-text-muted)" }}>{r.market_count}</td>
                  <td style={tdStyle}>
                    <input list="canonical-keys" value={ck} onChange={(e) => update(r.source_market_type, { canonical_key: e.target.value })}
                      placeholder="canonical_key" style={inputStyle} />
                  </td>
                  <td style={tdStyle}>
                    <input type="number" step="0.5" value={cl ?? ""} onChange={(e) => update(r.source_market_type, { canonical_line: e.target.value === "" ? null : parseFloat(e.target.value) })}
                      placeholder="—" style={{ ...inputStyle, textAlign: "right" }} />
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center", background: confColor(r.confidence), fontWeight: 700 }}>{r.confidence ?? "—"}</td>
                  <td style={{ ...tdStyle, textAlign: "center", color: "var(--admin-text-muted)", fontSize: 10, fontFamily: "monospace" }}>{extractedBadge(r.extracted_by)}</td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    <input type="checkbox" checked={vr} onChange={(e) => update(r.source_market_type, { verified: e.target.checked })} />
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                      <button onClick={() => save(r)} disabled={!dirty || isSaving} style={{ ...btnStyle(dirty ? "#10b981" : "#334155"), padding: "4px 8px", opacity: dirty ? 1 : 0.5 }}>{isSaving ? "…" : "Salva"}</button>
                      {r.canonical_key && <button onClick={() => clearMapping(r)} disabled={isSaving} style={{ ...btnStyle("#64748b"), padding: "4px 8px" }} title="Rimuovi mapping">✕</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={10} style={{ padding: 32, textAlign: "center", color: "var(--admin-text-muted)" }}>Nessun market type con i filtri correnti.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", color: "var(--admin-text-muted)", fontSize: 12 }}>
        <span>Pagina {page} di {totalPages} · {totalRows} righe filtrate</span>
        <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} style={btnStyle("#334155")}>«</button>
        <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} style={btnStyle("#334155")}>»</button>
      </div>

      <datalist id="canonical-keys">
        {keys.map((k) => <option key={k.canonical_key} value={k.canonical_key}>{k.canonical_name_it || k.canonical_key} ({k.count})</option>)}
      </datalist>
    </div>
  );
}

// UI primitives
const tdStyle: React.CSSProperties = { padding: "6px 8px", verticalAlign: "middle" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "4px 8px", border: "1px solid var(--admin-border)", borderRadius: 4, background: "var(--admin-bg)", color: "var(--admin-text)", fontSize: 12 };
const selectStyle: React.CSSProperties = { padding: "6px 10px", border: "1px solid var(--admin-border)", borderRadius: 6, background: "var(--admin-bg)", color: "var(--admin-text)", fontSize: 12 };
const checkLabelStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, color: "var(--admin-text-muted)", fontSize: 12 };

function Th({ children, align = "left", style }: { children: React.ReactNode; align?: "left"|"right"|"center"; style?: React.CSSProperties }) {
  return <th style={{ padding: "8px 10px", textAlign: align, fontSize: 10, textTransform: "uppercase", color: "var(--admin-text-muted)", fontWeight: 700, letterSpacing: 0.5, ...style }}>{children}</th>;
}
function Kpi({ label, value, accent, sub }: { label: string; value: React.ReactNode; accent?: string; sub?: string }) {
  return (
    <div style={{ padding: "12px 16px", border: "1px solid var(--admin-border)", borderRadius: 10, background: "var(--admin-card)", borderLeft: `3px solid ${accent || "#334155"}` }}>
      <div style={{ fontSize: 10, color: "var(--admin-text-muted)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent || "var(--admin-text)", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--admin-text-muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
function btnStyle(bg: string): React.CSSProperties {
  return { padding: "5px 10px", borderRadius: 5, border: "none", background: bg, color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" };
}
function timeAgo(iso: string): string {
  const diff = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${Math.floor(diff)}s fa`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m fa`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h fa`;
  return `${Math.floor(diff / 86400)}g fa`;
}
```

- [ ] **Step 2: Build to typecheck**

```bash
pnpm run build 2>&1 | tail -20
```

Expected: no TS errors.

- [ ] **Step 3: Commit**

```bash
git add app/admin/market-normalization/page.tsx
git commit -m "feat(ui): market-normalization unified table with bulk-confirm + engine trigger"
```

---

## Task 13: UI — `/admin/canonical-markets` CRUD page

**Files:**
- Create: `app/admin/canonical-markets/page.tsx`

- [ ] **Step 1: Create the page**

Create `app/admin/canonical-markets/page.tsx`:

```typescript
"use client";

import { useCallback, useEffect, useState } from "react";

interface Outcome { key: string; name_it: string; }
interface CanonicalMarket {
  canonical_key: string;
  base_key: string;
  period: string;
  canonical_name_it: string;
  has_line: boolean;
  outcomes: Outcome[];
  notes: string | null;
  mapped_count: number;
}

const PERIODS = ["ft", "1h", "2h", "et", "regular_time"];

export default function CanonicalMarketsPage() {
  const [rows, setRows] = useState<CanonicalMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CanonicalMarket>({
    canonical_key: "", base_key: "", period: "ft", canonical_name_it: "",
    has_line: false, outcomes: [], notes: null, mapped_count: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/canonical-markets`).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      setRows(r.rows ?? []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    try {
      const r = await fetch(`/api/admin/canonical-markets`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      }).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      setShowForm(false);
      setForm({ canonical_key: "", base_key: "", period: "ft", canonical_name_it: "", has_line: false, outcomes: [], notes: null, mapped_count: 0 });
      await load();
    } catch (e: any) { setError(e.message); }
  };

  const del = async (key: string) => {
    if (!confirm(`Cancellare canonical ${key}?`)) return;
    const r = await fetch(`/api/admin/canonical-markets?canonical_key=${encodeURIComponent(key)}`, { method: "DELETE" }).then((r) => r.json());
    if (r.error) setError(r.error);
    await load();
  };

  const filtered = rows.filter((r) => !filter || r.canonical_key.includes(filter) || r.base_key.includes(filter) || r.canonical_name_it.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <input placeholder="Filtra..." value={filter} onChange={(e) => setFilter(e.target.value)} style={{ flex: 1, padding: "8px 12px", border: "1px solid var(--admin-border)", borderRadius: 6, background: "var(--admin-bg)", color: "var(--admin-text)" }} />
        <button onClick={() => setShowForm(true)} style={{ padding: "8px 16px", borderRadius: 6, background: "#10b981", color: "#fff", border: "none", fontWeight: 700, cursor: "pointer" }}>+ Nuovo canonical</button>
      </div>

      {error && <div style={{ padding: 12, background: "#ef444420", border: "1px solid #ef4444", borderRadius: 8, color: "#fca5a5" }}>{error}</div>}

      {showForm && (
        <div style={{ padding: 16, border: "1px solid var(--admin-border)", borderRadius: 10, background: "var(--admin-card)", display: "grid", gap: 8 }}>
          <input placeholder="canonical_key (es. u_o_ft)" value={form.canonical_key} onChange={(e) => setForm((f) => ({ ...f, canonical_key: e.target.value }))} />
          <input placeholder="base_key (es. u_o)" value={form.base_key} onChange={(e) => setForm((f) => ({ ...f, base_key: e.target.value }))} />
          <select value={form.period} onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))}>{PERIODS.map((p) => <option key={p}>{p}</option>)}</select>
          <input placeholder="Nome canonico IT" value={form.canonical_name_it} onChange={(e) => setForm((f) => ({ ...f, canonical_name_it: e.target.value }))} />
          <label><input type="checkbox" checked={form.has_line} onChange={(e) => setForm((f) => ({ ...f, has_line: e.target.checked }))} /> has_line</label>
          <textarea placeholder='outcomes JSON: [{"key":"over","name_it":"Over"}, ...]' value={JSON.stringify(form.outcomes)} onChange={(e) => {
            try { setForm((f) => ({ ...f, outcomes: JSON.parse(e.target.value) })); } catch { /* wait for valid */ }
          }} rows={4} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={submit} style={{ padding: "8px 16px", borderRadius: 6, background: "#10b981", color: "#fff", border: "none", fontWeight: 700 }}>Salva</button>
            <button onClick={() => setShowForm(false)} style={{ padding: "8px 16px", borderRadius: 6, background: "#64748b", color: "#fff", border: "none" }}>Annulla</button>
          </div>
        </div>
      )}

      <div style={{ border: "1px solid var(--admin-border)", borderRadius: 10, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead style={{ background: "rgba(255,255,255,0.04)", textAlign: "left" }}>
            <tr>
              <th style={thS}>canonical_key</th>
              <th style={thS}>base_key</th>
              <th style={thS}>period</th>
              <th style={thS}>name_it</th>
              <th style={thS}>line?</th>
              <th style={thS}>outcomes</th>
              <th style={thS}>mapped</th>
              <th style={thS}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.canonical_key} style={{ borderTop: "1px solid var(--admin-border)" }}>
                <td style={tdS}><code>{r.canonical_key}</code></td>
                <td style={tdS}>{r.base_key}</td>
                <td style={tdS}>{r.period}</td>
                <td style={tdS}>{r.canonical_name_it}</td>
                <td style={tdS}>{r.has_line ? "yes" : "—"}</td>
                <td style={{ ...tdS, fontFamily: "monospace", fontSize: 10 }}>{r.outcomes.map((o) => o.key).join(", ")}</td>
                <td style={{ ...tdS, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.mapped_count}</td>
                <td style={{ ...tdS, textAlign: "right" }}>
                  <button onClick={() => del(r.canonical_key)} disabled={r.mapped_count > 0} title={r.mapped_count > 0 ? "Cannot delete: has mapped rows" : ""} style={{ padding: "4px 8px", borderRadius: 4, background: r.mapped_count > 0 ? "#334155" : "#ef4444", color: "#fff", border: "none", cursor: r.mapped_count > 0 ? "not-allowed" : "pointer" }}>🗑</button>
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && <tr><td colSpan={8} style={{ padding: 32, textAlign: "center", color: "var(--admin-text-muted)" }}>Nessun canonical.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const thS: React.CSSProperties = { padding: "8px 10px", fontSize: 10, textTransform: "uppercase", color: "var(--admin-text-muted)", fontWeight: 700, letterSpacing: 0.5 };
const tdS: React.CSSProperties = { padding: "6px 10px" };
```

- [ ] **Step 2: Build**

```bash
pnpm run build 2>&1 | tail -15
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/admin/canonical-markets/page.tsx
git commit -m "feat(ui): canonical-markets CRUD page"
```

---

## Task 14: Sidebar entry for canonical-markets

**Files:**
- Modify: `app/admin/layout.tsx`

- [ ] **Step 1: Add sidebar item**

In `app/admin/layout.tsx`, find the NAVIGATION items array and add after line containing `"market-normalization"`:

```typescript
{ id: "canonical-markets", icon: "📦", label: "Catalogo Canonical" },
```

Add to `TITLES` map:
```typescript
"canonical-markets": "Catalogo Canonical Markets",
```

Add to `activeId` useMemo:
```typescript
if (parts[1] === "canonical-markets") return "canonical-markets";
```

Add to `routeMap` inside `handleNavigate`:
```typescript
"canonical-markets": "/admin/canonical-markets",
```

- [ ] **Step 2: Build**

```bash
pnpm run build 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/admin/layout.tsx
git commit -m "feat(ui): sidebar entry for canonical-markets CRUD"
```

---

## Task 15: Run full test suite

- [ ] **Step 1: Run all tests**

```bash
pnpm test 2>&1 | tail -20
```

Expected: all passing (existing + new normalization tests).

- [ ] **Step 2: If any fail, fix and re-run**

- [ ] **Step 3: Commit any fixes** (if applicable)

---

## Task 16: Deploy to staging + end-to-end verification

**Files:**
- Git: push to `staging` branch

- [ ] **Step 1: Merge feature branch into staging**

```bash
git checkout staging
git pull
git merge --no-ff spec/market-normalization
git push origin staging
```

- [ ] **Step 2: Wait for GH Actions staging deploy**

```bash
gh run watch $(gh run list --workflow=deploy-staging.yml --limit 1 --json databaseId -q '.[0].databaseId')
```

Expected: success.

- [ ] **Step 3: Smoke-test staging UI**

Verify staging hostname first (memory says `staging.betssolution.com` but admin may be on a subpath or subdomain):
```bash
grep -E "STAGING|staging.*URL" .env.staging 2>&1 | head -3
```
Then open the correct URL in browser — typical candidates: `https://staging.betssolution.com/admin/market-normalization`, `https://admin-staging.betssolution.com/admin/market-normalization`, or `https://staging-admin.betssolution.com/admin/market-normalization`.
- KPI row shows totals
- Table renders with pagination (default ~100 rows)
- Only 2 source pills: Kambi + 22bet
- "Run engine" button present
- Open `/admin/canonical-markets` — see seeded ~30 canonicals

- [ ] **Step 4: Run engine from UI**

Click "▶ Run engine" on staging. Watch summary:
- `processed` should be 500 (chunk size)
- `matched.regex` + `matched.dictionary` + `matched.propagation` sum ≈ 400+ (most match)
- `remaining` shows how many still unmapped

Click repeatedly until `remaining=0`.

- [ ] **Step 5: Inspect results in DB**

```bash
ssh scraper-vps "PGPASSWORD=<STAGING_PWD> psql -h <STAGING_HOST> -U postgres -d postgres -c \"SELECT extracted_by, confidence, COUNT(*) FROM market_normalization WHERE source IN ('kambi','22bet') GROUP BY 1,2 ORDER BY 3 DESC;\""
```

Expected: see counts per extraction stage.

- [ ] **Step 6: Sanity-check a few rows by hand**

```bash
ssh scraper-vps "PGPASSWORD=<PWD> psql -h <HOST> -U postgres -d postgres -c \"SELECT source, source_market_type, canonical_key, canonical_line, confidence, extracted_by FROM market_normalization WHERE canonical_key IS NOT NULL ORDER BY confidence DESC LIMIT 20;\""
```

Expected: mappings make sense — U/O 2.5 → u_o_ft line=2.5, 1X2 → 1x2_ft, etc.

- [ ] **Step 7: Bulk-confirm high-confidence rows on staging**

In UI: filter `Conf = Alta (>85)`, `Solo non-verificati`. Click "select all" at top, then "Conferma selezionati". Repeat.

- [ ] **Step 8: Document findings in session memory**

(To be done by the human operator after running, not in this plan.)

---

## Task 17: Deploy to prod

**Prereq:** Task 16 must pass — engine results must be manually validated on staging.

- [ ] **Step 1: Apply migrations on PROD DB**

```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -f -" < supabase/migrations/042_canonical_markets.sql
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -f -" < supabase/migrations/043_market_normalization_ext.sql
```

- [ ] **Step 2: Verify on prod**

```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -c 'SELECT COUNT(*) FROM canonical_markets;'"
```

Expected: count ≥ 30.

- [ ] **Step 3: Merge staging → master**

```bash
git checkout master
git pull
git merge --no-ff staging
git push origin master
```

- [ ] **Step 4: Trigger prod deploy**

```bash
gh workflow run deploy-production.yml -f branch=master
gh run watch $(gh run list --workflow=deploy-production.yml --limit 1 --json databaseId -q '.[0].databaseId')
```

Expected: success.

- [ ] **Step 5: Smoke-test prod**

Open `https://admin.betssolution.com/admin/market-normalization`. Verify KPI loads, table renders.

- [ ] **Step 6: Run engine on prod (repeatedly until remaining=0)**

Click "▶ Run engine". Watch chunks complete.

- [ ] **Step 7: Update MEMORY.md**

Add session entry to `C:\Users\philp\.claude\projects\C--Users-philp\memory\` reflecting Phase 1 shipment + engine coverage numbers.

---

## Deferred for Phase 2 (not in this plan)

- LLM stage (Claude Haiku) for long-tail unmatched strings
- `outcome_normalization` table + UI expandable outcomes per market
- Cron-based daily engine run

## Deferred for Phase 3

- `refresh_consensus_snapshots` RPC refactor to use `(canonical_key, canonical_line, canonical_outcome_key)` for cross-source join
