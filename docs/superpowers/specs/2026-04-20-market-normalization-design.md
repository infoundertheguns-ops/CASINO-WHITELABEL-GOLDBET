# Market Normalization — Design Spec

**Date**: 2026-04-20
**Status**: Draft, pending approval
**Scope**: Phase 1 MVP (schema + seed + engine stages 1-3 + UI upgrade). Phases 2 and 3 listed but out of scope for this spec.

## Problem

The admin page `/admin/market-normalization` exists but has zero populated rows. The `market_normalization` table contains a single mapping axis (`source_market_type → canonical_key`), which is insufficient to support cross-source consensus because:

1. Events on prod DB come from two sources (`kambi` 16.767 events, `22bet` 41.749 events). `leon`, `goldbet`, `ippica` are either dead or handled in separate tables (`ippica_*`), but the UI still shows 5 tabs.
2. Distinct `market_type` strings per source: Kambi 21.368, 22bet 52.003. Manual mapping at this scale is impossible.
3. `market_type` strings encode parametric info inline: `U/O 2.5`, `U/O 3.5`, `1X2 H (-1)`, `U/O 1T 1.5`. Without parameter extraction, every line/period variant becomes a separate canonical_key, exploding combinatorially.
4. Within a single source, the same market_type has inconsistent outcome naming. Example from prod: `22bet | GG/NG | GG` (477 rows) vs `22bet | GG/NG | Si` (1595 rows) — two naming schemes for the same thing. No outcome normalization exists today.
5. Consensus snapshots currently match on raw `market_type` strings via `COALESCE(canonical_key, market_type)`, which produces meaningless cross-source comparisons until canonicals are populated.

## Goals

- Single canonical identity per `(market, outcome)` across all active sources.
- Pipeline that auto-proposes mappings from regex, dictionary, and cross-source propagation. Human operator confirms with one-click bulk actions.
- Schema is line-aware and period-aware so that `U/O 2.5` and `U/O 1T 1.5` share a `base_key=u_o` but split on `period` and carry `line` as a separate dimension.
- Zero auto-mappings enter the consensus pipeline without `verified=true`.

## Non-goals (for Phase 1)

- LLM-based mapping (Phase 2).
- Outcome-level normalization (Phase 2).
- Refactoring `refresh_consensus_snapshots` RPC to use canonical_key + canonical_line + canonical_outcome_key (Phase 3).
- Ippica markets (separate schema, 4 market types only, handled independently).

## Schema

Three SQL migrations, applied to staging first then prod.

### Migration 042 — `canonical_markets` (new table)

Catalog of canonical market identities. Seeded with ~50 football canonicals.

```sql
CREATE TABLE canonical_markets (
  canonical_key     TEXT PRIMARY KEY,           -- e.g. 'u_o_ft', '1x2_ft', 'dc_1h'
  base_key          TEXT NOT NULL,              -- e.g. 'u_o', '1x2', 'dc'
  period            TEXT NOT NULL,              -- 'ft' | '1h' | '2h' | 'et' | 'regular_time'
  canonical_name_it TEXT NOT NULL,              -- e.g. 'Under/Over'
  has_line          BOOLEAN NOT NULL DEFAULT false,
  outcomes          JSONB NOT NULL,             -- [{key:'over', name_it:'Over'}, {key:'under', name_it:'Under'}]
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_canonical_markets_base ON canonical_markets(base_key);
```

Seed list (initial 50, not exhaustive):

| canonical_key | base_key | period | has_line | outcomes |
|---|---|---|---|---|
| `1x2_ft` | `1x2` | ft | no | `[home, draw, away]` |
| `1x2_1h` | `1x2` | 1h | no | `[home, draw, away]` |
| `1x2_2h` | `1x2` | 2h | no | `[home, draw, away]` |
| `u_o_ft` | `u_o` | ft | yes | `[over, under]` |
| `u_o_1h` | `u_o` | 1h | yes | `[over, under]` |
| `u_o_2h` | `u_o` | 2h | yes | `[over, under]` |
| `gg_ng_ft` | `gg_ng` | ft | no | `[yes, no]` |
| `gg_ng_1h` | `gg_ng` | 1h | no | `[yes, no]` |
| `gg_ng_2h` | `gg_ng` | 2h | no | `[yes, no]` |
| `dc_ft` | `dc` | ft | no | `[1X, 12, X2]` |
| `dc_1h` | `dc` | 1h | no | `[1X, 12, X2]` |
| `dc_2h` | `dc` | 2h | no | `[1X, 12, X2]` |
| `1x2_h_ft` | `1x2_handicap` | ft | yes | `[home, draw, away]` |
| `1x2_h_1h` | `1x2_handicap` | 1h | yes | `[home, draw, away]` |
| `dnb_ft` | `dnb` | ft | no | `[home, away]` |
| `dnb_1h` | `dnb` | 1h | no | `[home, away]` |
| `cs_ft` | `correct_score` | ft | no | grid 0-0..5-5 |
| `cs_1h` | `correct_score` | 1h | no | grid 0-0..3-3 |
| `htft` | `htft` | ft | no | 9 combos 1/1..2/2 |
| `oe_ft` | `odd_even` | ft | no | `[odd, even]` |

The full ~50-entry seed (covering all football base markets + period variants + common specials like `anytime_scorer`, `first_scorer`, `btts_and_result`) will be enumerated during the plan stage and written inline into `supabase/migrations/042_canonical_markets.sql`. The 20 entries in the table above are the non-negotiable core; the rest expand base coverage.

### Migration 043 — Extend `market_normalization`

Add line + provenance columns. Constraint update to drop dead sources (`leon`, `goldbet`, `ippica`).

```sql
ALTER TABLE market_normalization
  ADD COLUMN canonical_line  NUMERIC(10,3),
  ADD COLUMN extracted_by    TEXT CHECK (extracted_by IN ('manual','regex','dictionary','propagation','fuzzy','llm')),
  ADD COLUMN confidence      SMALLINT CHECK (confidence BETWEEN 0 AND 100);

ALTER TABLE market_normalization
  DROP CONSTRAINT market_normalization_source_check;

ALTER TABLE market_normalization
  ADD CONSTRAINT market_normalization_source_check
    CHECK (source IN ('kambi', '22bet'));

-- FK to canonical_markets catalog (nullable when unmapped)
ALTER TABLE market_normalization
  ADD CONSTRAINT market_norm_canonical_fk
    FOREIGN KEY (canonical_key)
    REFERENCES canonical_markets(canonical_key)
    ON UPDATE CASCADE ON DELETE SET NULL;
```

### Deferred schema (Phase 2) — `outcome_normalization`

Listed for forward compatibility only. NOT part of Phase 1 deliverables. Migration number TBD at Phase 2 spec time.

```sql
-- Phase 2 migration (not applied in Phase 1)
CREATE TABLE outcome_normalization (
  id                    BIGSERIAL PRIMARY KEY,
  source                TEXT NOT NULL CHECK (source IN ('kambi', '22bet')),
  source_market_type    TEXT NOT NULL,
  source_outcome_name   TEXT NOT NULL,
  canonical_outcome_key TEXT NOT NULL,   -- matches canonical_markets.outcomes[].key
  verified              BOOLEAN NOT NULL DEFAULT false,
  extracted_by          TEXT,
  confidence            SMALLINT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_market_type, source_outcome_name)
);
```

## Engine

Script `scripts/normalize-markets.ts` in `betssolution-admin` repo. Runs pipeline stages 1-3 in Phase 1. Invoked manually (npm script) or via cron (Phase 1 defers cron until engine is stable).

### Input
- `DISTINCT e.source, m.market_type` from `markets m JOIN events e ON e.id=m.event_id WHERE m.is_active` not present in `market_normalization` (or present but `verified=false AND extracted_by IN ('regex','dictionary','propagation')`).

### Pipeline

```
Stage 1 — Regex (confidence=95)
  Patterns cover parametric strings with (base, period, line) extraction.
  Example patterns:
    /^U\/O(?:\s+(\d?T|\d°\s*Tempo))?\s+([\d.]+)$/i         → Kambi U/O
    /^U\/O\s+([\d.]+)(?:\s+-\s+(\d?T))?$/i                  → 22bet U/O
    /^(1X2|GG\/NG|DC)(?:\s+(1T|2T|1°\s*Tempo|2°\s*Tempo|-\s*1T|-\s*2T))?$/i
    /^1X2\s+H\s+\(([+-]?\d+(?:\.\d+)?)\)$/                  → 1x2 handicap with line
    /^Pari\/Dispari(?:\s+(1T|2T))?$/                        → odd/even
  Period normalization: 1T | 1° Tempo | - 1T → "1h", analogous for 2T → "2h", no suffix → "ft".

Stage 2 — Dictionary (confidence=90)
  22bet: ILIKE match on twobet_market_groups.name_it (table already populated by 22bet scraper).
         Maps twobet_g code → base_key via hardcoded map in script.
  Kambi: hardcoded betOfferType code → base_key map (from Kambi API documentation).
         Note: market_type on Kambi is already italianized, not raw code; dictionary uses
         italianized lookups (e.g. "Draw No Bet" → dnb, "Esito 1T/Finale" → htft).

Stage 3 — Cross-source propagation (confidence=85)
  Two sub-strategies:
  (a) Literal-string match:
      For each (source, source_market_type) unmapped, if the SAME literal string exists
      mapped and verified on the other source, copy canonical_key and canonical_line.
      Effective for non-parametric types that happen to share Italian wording between
      Kambi and 22bet: "1X2", "GG/NG", "DC", "Risultato Esatto", "U/O 2.5", etc.
  (b) Tuple match (applied only if stage 1 regex extracted a partial tuple):
      For rows where stage 1 regex extracted (base_key, period, line) but couldn't map
      to a canonical_key (e.g. unusual period), look up any verified row on any source
      with the same (base_key, period, line) tuple and copy its canonical_key.
  Requires verified=true on source row to prevent propagation of unvetted mappings.
  Never overwrites an already-mapped row.
```

### Output

Upserts into `market_normalization` with:
- `canonical_key` and `canonical_line` set. `canonical_line` is **stored** on the row, written by stage 1 regex; stages 2-3 copy it from catalog/source row. Never derived at query time.
- `verified=false` (always — never auto-verify)
- `extracted_by` = stage name (`regex` | `dictionary` | `propagation`)
- `confidence` = stage confidence

Existing verified rows are never overwritten.

### Manual edits (UI inline edit or save)

When an operator saves a row through the UI:
- `extracted_by` = `'manual'`
- `confidence` = `100`
- `verified` defaults to the UI checkbox state (can save as unverified draft).

### Budget and limits

- Stages 1-3 are deterministic and cheap. No throttling.
- Script logs per-stage counts: matched, skipped, failed.

### Invocation paths

Three paths, same underlying code in `scripts/normalize-markets.ts` exporting a pure function:

1. **CLI / npm script** (`pnpm normalize:markets`) — runs the full pipeline synchronously, prints summary. Used for dev and first bootstrap on staging/prod.
2. **HTTP endpoint** `POST /api/admin/market-normalization?action=run-engine` — Vercel/Nginx request timeout is 60s. The endpoint **must chunk**: process at most N=500 unmapped rows per call, return a `{ processed, remaining, summary }` JSON. The UI polls or re-invokes until `remaining=0`. This avoids a long-running handler and keeps the operator in control.
3. **Cron (Phase 1 deferred)** — once the engine is stable, add a cron on `scraper-vps` that hits the HTTP endpoint daily. Not part of Phase 1 deliverables.

The chunking contract is part of Phase 1 and must be implemented even if the first run is via CLI.

## UI changes

Page `/admin/market-normalization` rewrite:

### Removed
- 5-tab navigation (`kambi`, `22bet`, `ippica`, `leon`, `goldbet`).
- Hardcoded `SOURCES` array in `page.tsx` with dead sources.

### Added
- Unified flat table, `source` is a column (colored pill: #8b5cf6 kambi, #f97316 22bet).
- Pagination (100/page, sortable by `market_count DESC` default).
- Columns: `☐ | Source | Market type | Events | Markets | Canonical | Line | Confidence | ExtractedBy | Verified | Actions`.
- Confidence column with color bg (green >85, yellow 50-85, red <50, gray null).
- ExtractedBy as short badge (`rx`, `dc`, `xs`, `fz`, `ai`, `—`).
- Verified as green check (verified) vs empty circle (suggested only).
- Filter controls: source dropdown (All / Kambi / 22bet), confidence dropdown, extracted_by dropdown, only-unmapped checkbox, only-unverified checkbox.
- Bulk selection: checkbox per row + "Conferma selezionati" action.
- "Re-run engine" button (invokes `/api/admin/market-normalization?action=run-engine`) — admin-triggered, runs stages 1-3 asynchronously.

### Unchanged
- Inline edit for manual override of canonical_key, canonical_name_it, notes.
- DELETE to clear mapping.
- KPI row (but updated to reflect 2 sources only).

### New API actions

Extend `/api/admin/market-normalization/route.ts`:

- `GET ?action=list&source=…&page=…&per_page=100&conf=high|med|low&extracted=…&q=…`
- `POST ?action=bulk-confirm` — body: `{ ids: [...] }` — sets `verified=true` for selected rows.
- `POST ?action=run-engine` — triggers `scripts/normalize-markets.ts` logic inline (not spawn), runs stages 1-3, returns summary.

## New page `/admin/canonical-markets`

CRUD for `canonical_markets` catalog.

- Table of all canonicals with: canonical_key, base_key, period, has_line, outcomes (JSON inline), count of mapped source_market_types.
- Inline edit for canonical_name_it, notes, outcomes (JSON editor).
- "Add new canonical" dialog (form: base_key, period dropdown, has_line checkbox, outcomes array builder).
- Delete guarded by FK from market_normalization (cannot delete if rows point to it).

## Phased rollout

| Phase | Spec | Output |
|------:|------|--------|
| **1 — MVP** | THIS spec | Schema migrations 042+043, seed 50 canonicals, engine stages 1-3, UI rewrite + canonical-markets CRUD. Expected coverage 70-80% of active markets by market_count. |
| 2 — LLM + outcomes | Separate spec | Engine stage 5 (Claude Haiku), migration 044 outcome_normalization, UI inline expandable outcomes. Target 95%+ coverage. |
| 3 — Consensus refactor | Separate spec | `refresh_consensus_snapshots` RPC uses `(canonical_key, canonical_line, canonical_outcome_key)` for cross-source join. Consensus becomes meaningful. |

## Migration / rollout plan for Phase 1

1. Apply migration 042 (canonical_markets + seed) on staging DB. Verify seed rows present.
2. Apply migration 043 (extend market_normalization) on staging DB.
3. Deploy admin branch with engine script + updated page + canonical-markets CRUD to staging.
4. Run engine manually on staging. Inspect results. Tune regex patterns if needed.
5. Bulk-confirm high-confidence rows on staging. Validate UX.
6. Apply 042+043 on prod DB. Deploy admin master. Run engine on prod.
7. Operator (user) does first-pass bulk-confirm on prod.

Rollback: drop migrations in reverse order. Engine script has no destructive effects (only upserts with verified=false).

## Risks

- **Regex false positives** on exotic market_types containing "U/O" in name but not meaning under/over. Mitigated by verified=false gate.
- **Dictionary drift**: `twobet_market_groups` is populated by 22bet scraper and may lag. Mitigated by stage 1 regex covering most parametric cases first.
- **Bootstrap catalog incompleteness**: seed lists ~50 canonicals, all football-centric. Non-football sports (basket, tennis, hockey) will have many unmapped market_types. Mitigated by Phase 2 LLM or incremental catalog growth via `/admin/canonical-markets` CRUD.
- **UI performance**: 74K rows unpaginated crashes the browser. Phase 1 pagination fixes this.

## Open questions

None at spec-writing time. All design decisions taken during brainstorm.
