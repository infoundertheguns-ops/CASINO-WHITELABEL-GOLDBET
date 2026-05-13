# Classify Gap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate bet-settlement gaps for OddsAPI markets by (a) routing `settle-leg.ts` to read per-period scores from FS-populated `live_data` JSONB instead of the always-NULL `period_scores` column, and (b) adding 12 missing classifier branches (4 full-match + 8 per-period) to `classify.ts`.

**Architecture:** Two-bucket data model — `period_scores` column kept as legacy fallback, `live_data` (`halfScoreHome[]`, `halfScoreAway[]`, `periods[]`) read as primary source in `buildScores()`. `ScoreResult` interface extended with `period_scores_home/away[]` arrays + `sport_slug`. Classifier dispatcher gets 12 new `if` branches reusing existing primitive settlers (`settleOU`, `settle1X2`, `settleCorrectScore`, `settleHandicap2Way`).

**Tech Stack:** TypeScript, Vitest (`tests/**/*.test.ts`), Supabase JS client (read-only in this plan — no DB migrations).

**Spec:** `docs/superpowers/specs/2026-05-13-classify-gap-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `lib/settlement/odds-api/classify.ts` | MODIFY | Add 3 new `ScoreResult` fields, 2 helpers (`getPeriodScores`, `getTotalGames`), 1 player helper (`settleFirstTeamToScore`), and 12 dispatcher branches. |
| `lib/settlement/odds-api/settle-leg.ts` | MODIFY | Extend `SELECT_LEG_FIELDS` with `live_data`, extend `buildScores()` to read `live_data.periods` (football) and `live_data.halfScoreHome/Away[]` (other sports) as primary HT source; populate new `ScoreResult` arrays. |
| `tests/lib/settlement/odds-api/build-scores.test.ts` | CREATE | Unit tests for `buildScores()` covering all four source-priority paths and sport-specific extraction. |
| `tests/fixtures/settlement/gap-coverage.json` | CREATE | ≥20 fixture cases covering all 12 new branches + HT-via-live-data integration cases. |
| `tests/lib/settlement/odds-api/classify-fixtures.test.ts` | MODIFY | Import + iterate `gap-coverage.json` alongside `score-only-60.json`. |

No DB migrations. No ingester changes. No `lib/settlement.ts` (legacy 2307 LOC) changes.

---

## Pre-flight

- [ ] **Confirm branch is `feature/plan-d-settlement-d1`**

```bash
cd C:/Users/philp/Documents/Project/betssolution-admin-plan-d
git branch --show-current
```

Expected: `feature/plan-d-settlement-d1`

- [ ] **Confirm clean working tree before starting**

```bash
git status
```

Expected: `nothing to commit, working tree clean` (spec commits `1e353c5` + `3eed318` are already merged).

- [ ] **Confirm test suite green at baseline**

```bash
npm test -- classify
```

Expected: all existing fixtures (60+) pass.

---

## Phase A — Data routing (Bug X)

### Task 1: Extend `ScoreResult` interface in `classify.ts`

**Files:**
- Modify: `lib/settlement/odds-api/classify.ts:20-44`

- [ ] **Step 1: Read current `ScoreResult` interface**

Open `lib/settlement/odds-api/classify.ts` lines 20-44 to confirm exact shape.

- [ ] **Step 2: Add three new optional fields**

Insert after the `player_shots` field (around line 43), before the closing brace:

```ts
  // Per-period scores (array indexed by period: 0 = 1st half / 1st set / Q1).
  // Populated by settle-leg.ts buildScores() from events_v2.live_data when present.
  // null/undefined when source data is missing — branches must guard with explicit check.
  period_scores_home?: number[] | null;
  period_scores_away?: number[] | null;
  // Sport hint to drive sport-aware extraction logic in buildScores.
  // Not consumed by classify branches today but reserved for future sport-specific aliases.
  sport_slug?: string | null;
```

- [ ] **Step 3: Run typecheck to verify no consumer breaks**

```bash
npx tsc --noEmit
```

Expected: PASS (new fields are optional → no caller change required).

- [ ] **Step 4: Run existing tests to verify no regression**

```bash
npm test -- classify
```

Expected: all existing fixtures still pass.

- [ ] **Step 5: Commit**

```bash
git add lib/settlement/odds-api/classify.ts
git commit -m "feat(classify): extend ScoreResult with period_scores_home/away + sport_slug

Optional fields, zero behavior change. Consumed in upcoming buildScores
and per-period branches.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add `buildScores` unit-test scaffold (TDD red phase)

**Files:**
- Create: `tests/lib/settlement/odds-api/build-scores.test.ts`

- [ ] **Step 1: Write failing tests for buildScores**

Create the file with five cases. Note: `buildScores` is currently a private function inside `settle-leg.ts`. Task 4 will export it. For now the tests reference the export so they fail at import time.

```ts
import { describe, expect, test } from "vitest";
import { buildScores } from "@/lib/settlement/odds-api/settle-leg";

describe("buildScores — period-source priority", () => {
  test("legacy period_scores column wins when populated", () => {
    const result = buildScores({
      score_home: 2,
      score_away: 1,
      period_scores: { "1H": { home: 1, away: 0 } },
      live_data: { halfScoreHome: [9, 9], halfScoreAway: [9, 9] },
      sport_slug: "football",
      period: null,
    });
    expect(result?.ht_home).toBe(1);
    expect(result?.ht_away).toBe(0);
  });

  test("football falls back to live_data.periods name='1 Tempo'", () => {
    const result = buildScores({
      score_home: 2,
      score_away: 0,
      period_scores: null,
      live_data: {
        periods: [
          { name: "1 Tempo", homeScore: 1, awayScore: 0 },
          { name: "2 Tempo", homeScore: 1, awayScore: 0 },
        ],
      },
      sport_slug: "football",
      period: null,
    });
    expect(result?.ht_home).toBe(1);
    expect(result?.ht_away).toBe(0);
  });

  test("tennis uses live_data.halfScoreHome[0] for first set", () => {
    const result = buildScores({
      score_home: 2,
      score_away: 0,
      period_scores: null,
      live_data: { halfScoreHome: [6, 7], halfScoreAway: [4, 6] },
      sport_slug: "tennis",
      period: null,
    });
    expect(result?.ht_home).toBe(6);
    expect(result?.ht_away).toBe(4);
    expect(result?.period_scores_home).toEqual([6, 7]);
    expect(result?.period_scores_away).toEqual([4, 6]);
  });

  test("returns null when score_home or score_away missing", () => {
    expect(buildScores({
      score_home: null,
      score_away: 1,
      period_scores: null,
      live_data: null,
      sport_slug: "football",
      period: null,
    })).toBeNull();
  });

  test("no period data anywhere → ht_home/away null but result valid", () => {
    const result = buildScores({
      score_home: 1,
      score_away: 1,
      period_scores: null,
      live_data: null,
      sport_slug: "football",
      period: null,
    });
    expect(result).not.toBeNull();
    expect(result?.ht_home).toBeNull();
    expect(result?.ht_away).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- build-scores
```

Expected: FAIL — `buildScores` is not exported from `settle-leg.ts` yet.

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/lib/settlement/odds-api/build-scores.test.ts
git commit -m "test(settle-leg): add failing tests for buildScores period-source priority

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Implement extended `buildScores` in `settle-leg.ts`

**Files:**
- Modify: `lib/settlement/odds-api/settle-leg.ts`

- [ ] **Step 1: Extend `RawScoreRow` and `SELECT_LEG_FIELDS`**

Locate `SELECT_LEG_FIELDS` (lines 22-27) and add `live_data` to the events_v2 selection. Locate `RawScoreRow` (lines 29-35) and add `live_data: any | null`.

Replace:

```ts
const SELECT_LEG_FIELDS = [
  "id", "bet_id", "event_id", "market_id", "outcome_id", "odds_at_placement",
  "markets_v2!bet_selections_market_id_fkey(market_name)",
  "outcomes_v2!bet_selections_outcome_id_fkey(outcome_key, line)",
  "events_v2!bet_selections_event_id_fkey(score_home, score_away, period_scores, sport_slug, period)",
].join(", ");
```

With:

```ts
const SELECT_LEG_FIELDS = [
  "id", "bet_id", "event_id", "market_id", "outcome_id", "odds_at_placement",
  "markets_v2!bet_selections_market_id_fkey(market_name)",
  "outcomes_v2!bet_selections_outcome_id_fkey(outcome_key, line)",
  "events_v2!bet_selections_event_id_fkey(score_home, score_away, period_scores, sport_slug, period, live_data)",
].join(", ");
```

And replace:

```ts
interface RawScoreRow {
  score_home: number | null;
  score_away: number | null;
  period_scores: Record<string, { home?: number; away?: number }> | null;
  sport_slug: string | null;
  period: string | null;
}
```

With:

```ts
interface RawScoreRow {
  score_home: number | null;
  score_away: number | null;
  period_scores: Record<string, { home?: number; away?: number }> | null;
  sport_slug: string | null;
  period: string | null;
  // FS-scraped JSONB blob, contains halfScoreHome[]/halfScoreAway[] and periods[].
  // Shape varies by sport — see spec §2 for the two-bucket data model.
  live_data: {
    halfScoreHome?: number[] | null;
    halfScoreAway?: number[] | null;
    periods?: Array<{ name?: string; homeScore?: number; awayScore?: number }> | null;
  } | null;
}
```

- [ ] **Step 2: Replace `buildScores` with extended version**

Replace lines 37-56 (the entire current `buildScores`) with:

```ts
export function buildScores(row: RawScoreRow): ScoreResult | null {
  if (row.score_home == null) return null;
  if (row.score_away == null) return null;

  let ht_home: number | null = null;
  let ht_away: number | null = null;

  // Priority 1 — legacy period_scores column (currently always NULL in prod,
  // kept as future-proof fallback if OddsAPI starts emitting periods).
  const ps = row.period_scores;
  if (ps && typeof ps === "object") {
    const first = ps["1H"] || ps["1Q"] || ps["P1"] || ps["S1"];
    if (first && first.home != null && first.away != null) {
      ht_home = first.home;
      ht_away = first.away;
    }
  }

  // Priority 2 — live_data (FS source, primary today).
  const ld = row.live_data;
  if (ht_home == null && ld != null) {
    // 2a — football prefers named periods.
    if (row.sport_slug === "football" && Array.isArray(ld.periods)) {
      const p1 = ld.periods.find(
        (p) =>
          typeof p?.name === "string" &&
          /(^|\s)1[°\s]*tempo|1st\s*half|1H\b/i.test(p.name),
      );
      if (p1 && p1.homeScore != null && p1.awayScore != null) {
        ht_home = p1.homeScore;
        ht_away = p1.awayScore;
      }
    }
    // 2b — generic halfScoreHome/Away[0] for any sport.
    if (
      ht_home == null &&
      Array.isArray(ld.halfScoreHome) &&
      Array.isArray(ld.halfScoreAway) &&
      ld.halfScoreHome.length > 0 &&
      ld.halfScoreAway.length > 0
    ) {
      ht_home = ld.halfScoreHome[0];
      ht_away = ld.halfScoreAway[0];
    }
  }

  // Populate per-period arrays — prefer halfScoreHome/Away (explicit per-period),
  // fall back to periods[].homeScore/awayScore extraction.
  let period_scores_home: number[] | null = null;
  let period_scores_away: number[] | null = null;
  if (ld != null) {
    if (Array.isArray(ld.halfScoreHome) && Array.isArray(ld.halfScoreAway)) {
      period_scores_home = ld.halfScoreHome.slice();
      period_scores_away = ld.halfScoreAway.slice();
    } else if (Array.isArray(ld.periods) && ld.periods.length > 0) {
      const h = ld.periods.map((p) => (p?.homeScore ?? null)).filter((x): x is number => x != null);
      const a = ld.periods.map((p) => (p?.awayScore ?? null)).filter((x): x is number => x != null);
      if (h.length === ld.periods.length && a.length === ld.periods.length) {
        period_scores_home = h;
        period_scores_away = a;
      }
    }
  }

  const scores: ScoreResult = {
    home: row.score_home,
    away: row.score_away,
    ht_home,
    ht_away,
    period_scores_home,
    period_scores_away,
    sport_slug: row.sport_slug,
  };
  return scores;
}
```

Note: `buildScores` is now `export`ed (was private). Drop the existing escape-hatch block (lines 51-55 with `extra.halfScores`, `extra.sport`, `extra.period`) — those untyped fields were never consumed by any classifier. If a search shows otherwise, surface and stop.

- [ ] **Step 3: Run search to confirm no consumer of legacy escape fields**

```bash
git grep -E "halfScores|\.sport\b|\.period\b" lib/settlement/odds-api/
```

Expected: no consumer of these names on `ScoreResult`. (Plain `.period` on other types is fine.)

- [ ] **Step 4: Run unit tests — should now pass**

```bash
npm test -- build-scores
```

Expected: all 5 tests pass.

- [ ] **Step 5: Run full classifier test suite — should not regress**

```bash
npm test -- classify
```

Expected: all existing fixtures still pass.

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add lib/settlement/odds-api/settle-leg.ts
git commit -m "feat(settle-leg): buildScores reads live_data periods as primary HT source

Bug X fix — period_scores column is NULL across 100% of prod events.
buildScores now extracts ht_home/away and period_scores_home/away[]
from events_v2.live_data (FS-scraper-populated JSONB).

Priority chain:
  1. period_scores column (legacy, kept as future-proof)
  2a. football: live_data.periods[name~/1 Tempo|1st half/]
  2b. all sports: live_data.halfScoreHome[0]/halfScoreAway[0]

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase B — Full-match branches (Bug Y, 4 markets)

### Task 4: Team Total Home / Away branches

**Files:**
- Modify: `lib/settlement/odds-api/classify.ts:391` (just after the "u/o" / totals family)
- Modify: `tests/fixtures/settlement/gap-coverage.json` (create new file with first 6 fixtures)

- [ ] **Step 1: Create `gap-coverage.json` with Team Total fixtures (failing)**

```json
[
  {
    "id": "team-total-home-001",
    "description": "Team Total Home over 1.5 — home scored 2, won",
    "leg": { "market_type": "Team Total Home", "outcome_name": "over", "line": 1.5 },
    "result": { "home": 2, "away": 0 },
    "expected_verdict": "won"
  },
  {
    "id": "team-total-home-002",
    "description": "Team Total Home over 1.5 — home scored 1, lost",
    "leg": { "market_type": "Team Total Home", "outcome_name": "over", "line": 1.5 },
    "result": { "home": 1, "away": 3 },
    "expected_verdict": "lost"
  },
  {
    "id": "team-total-home-003",
    "description": "Team Total Home over 2 — home scored 2 exact, void (push)",
    "leg": { "market_type": "Team Total Home", "outcome_name": "over", "line": 2 },
    "result": { "home": 2, "away": 1 },
    "expected_verdict": "void"
  },
  {
    "id": "team-total-away-001",
    "description": "Team Total Away under 2.5 — away scored 1, won",
    "leg": { "market_type": "Team Total Away", "outcome_name": "under", "line": 2.5 },
    "result": { "home": 3, "away": 1 },
    "expected_verdict": "won"
  },
  {
    "id": "team-total-away-002",
    "description": "Team Total Away over 0.5 — away scored 0, lost",
    "leg": { "market_type": "Team Total Away", "outcome_name": "over", "line": 0.5 },
    "result": { "home": 1, "away": 0 },
    "expected_verdict": "lost"
  },
  {
    "id": "team-total-goals-home-001",
    "description": "Team Total Goals Home alias — over 1.5, home 2, won",
    "leg": { "market_type": "Team Total Goals Home", "outcome_name": "over", "line": 1.5 },
    "result": { "home": 2, "away": 0 },
    "expected_verdict": "won"
  }
]
```

- [ ] **Step 2: Wire the fixture into the test runner**

Open `tests/lib/settlement/odds-api/classify-fixtures.test.ts`. Locate the line:

```ts
import fixtures from "@/tests/fixtures/settlement/score-only-60.json";
```

Add directly below it:

```ts
import gapFixtures from "@/tests/fixtures/settlement/gap-coverage.json";
```

Locate the line:

```ts
const typedFixtures = fixtures as Fixture[];
```

Replace with:

```ts
const typedFixtures = [...fixtures, ...gapFixtures] as Fixture[];
```

- [ ] **Step 3: Run — confirm Team Total fixtures fail**

```bash
npm test -- classify-fixtures
```

Expected: 6 new tests fail with `expected 'won' to be null` (no branch yet).

- [ ] **Step 4: Add Team Total branches in `classify.ts`**

In `classifyLeg`, find the U/O Goals family block (lines 390-401) and insert immediately after it:

```ts
  // ─── Team Total (single-team over/under) ───
  if (mt === "team total home" || mt === "team total goals home") {
    return { verdict: settleOU(result.home, leg.line, leg.outcome_name) };
  }
  if (mt === "team total away" || mt === "team total goals away") {
    return { verdict: settleOU(result.away, leg.line, leg.outcome_name) };
  }
```

- [ ] **Step 5: Run — confirm pass**

```bash
npm test -- classify-fixtures
```

Expected: all fixtures (60 + 6 new) pass.

- [ ] **Step 6: Commit**

```bash
git add lib/settlement/odds-api/classify.ts tests/fixtures/settlement/gap-coverage.json tests/lib/settlement/odds-api/classify-fixtures.test.ts
git commit -m "feat(classify): Team Total Home/Away branches + gap-coverage fixtures

Two new branches reusing settleOU on score_home / score_away.
Aliases: 'Team Total Home/Away' (primary) + 'Team Total Goals Home/Away'.

Volume impact: ~88k markets in prod.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 3-Way Result alias

**Files:**
- Modify: `lib/settlement/odds-api/classify.ts:370` (1X2 family)
- Modify: `tests/fixtures/settlement/gap-coverage.json` (add 3 fixtures)

- [ ] **Step 1: Add 3 failing fixtures**

Append to `gap-coverage.json` (before the closing `]`):

```json
,
  {
    "id": "3way-result-001",
    "description": "3-Way Result hockey home win 3-2",
    "leg": { "market_type": "3-Way Result", "outcome_name": "home", "line": null },
    "result": { "home": 3, "away": 2 },
    "expected_verdict": "won"
  },
  {
    "id": "3way-result-002",
    "description": "3-Way Result handball draw 26-26 outcome=draw",
    "leg": { "market_type": "3-Way Result", "outcome_name": "draw", "line": null },
    "result": { "home": 26, "away": 26 },
    "expected_verdict": "won"
  },
  {
    "id": "3way-result-003",
    "description": "3 Way Result (no hyphen) basket away win 88-95",
    "leg": { "market_type": "3 Way Result", "outcome_name": "2", "line": null },
    "result": { "home": 88, "away": 95 },
    "expected_verdict": "won"
  }
```

- [ ] **Step 2: Run — fail**

```bash
npm test -- classify-fixtures
```

Expected: 3 new fails.

- [ ] **Step 3: Add alias to 1X2 branch**

In `classify.ts` line 370 replace:

```ts
  if (mt === "1x2" || mt === "vincente incontro" || mt === "ml" || mt === "tempo regolamentare") {
```

With:

```ts
  if (
    mt === "1x2" || mt === "vincente incontro" || mt === "ml" || mt === "tempo regolamentare" ||
    mt === "3-way result" || mt === "3 way result"
  ) {
```

- [ ] **Step 4: Run — pass**

```bash
npm test -- classify-fixtures
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add lib/settlement/odds-api/classify.ts tests/fixtures/settlement/gap-coverage.json
git commit -m "feat(classify): 3-Way Result as 1X2 alias

Hockey/handball/basket/baseball use '3-Way Result' name for the same
home/draw/away market. Adding the alias to the existing 1X2 branch.

Volume: ~6k markets.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: ML 2H alias

**Files:**
- Modify: `lib/settlement/odds-api/classify.ts:377` (1X2 2H branch)
- Modify: `tests/fixtures/settlement/gap-coverage.json` (add 2 fixtures)

- [ ] **Step 1: Add 2 failing fixtures**

Append to `gap-coverage.json`:

```json
,
  {
    "id": "ml-2h-001",
    "description": "ML 2H — HT 1-1 FT 2-1 → 2H 1-0 home wins",
    "leg": { "market_type": "ML 2H", "outcome_name": "home", "line": null },
    "result": { "home": 2, "away": 1, "ht_home": 1, "ht_away": 1 },
    "expected_verdict": "won"
  },
  {
    "id": "ml-2h-002",
    "description": "Second Half Result — HT 0-0 FT 0-2 → 2H 0-2 away wins, outcome=draw lost",
    "leg": { "market_type": "Second Half Result", "outcome_name": "draw", "line": null },
    "result": { "home": 0, "away": 2, "ht_home": 0, "ht_away": 0 },
    "expected_verdict": "lost"
  }
```

- [ ] **Step 2: Run — fail**

```bash
npm test -- classify-fixtures
```

- [ ] **Step 3: Add aliases in `classify.ts`**

Replace line 377:

```ts
  if (mt === "1x2 - 2t" || mt === "1x2 2° tempo") {
```

With:

```ts
  if (mt === "1x2 - 2t" || mt === "1x2 2° tempo" || mt === "ml 2h" || mt === "second half result") {
```

- [ ] **Step 4: Run — pass**

```bash
npm test -- classify-fixtures
```

- [ ] **Step 5: Commit**

```bash
git add lib/settlement/odds-api/classify.ts tests/fixtures/settlement/gap-coverage.json
git commit -m "feat(classify): ML 2H + Second Half Result aliases for 1X2 2H

Volume: ~15k markets (ML 2H alone).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: First Team To Score branch + helper

**Files:**
- Modify: `lib/settlement/odds-api/classify.ts` (add helper near other player helpers ~ line 280, add branch in dispatcher)
- Modify: `tests/fixtures/settlement/gap-coverage.json` (add 4 fixtures)

- [ ] **Step 1: Add 4 failing fixtures**

Append to `gap-coverage.json`:

```json
,
  {
    "id": "first-score-001",
    "description": "First Team To Score — home scored first",
    "leg": { "market_type": "First Team To Score", "outcome_name": "home", "line": null },
    "result": { "home": 2, "away": 1, "scorers": [{ "name": "Bob", "team": "home" }, { "name": "Sue", "team": "away" }, { "name": "Bob", "team": "home" }] },
    "expected_verdict": "won"
  },
  {
    "id": "first-score-002",
    "description": "First Team To Score — away scored first, bet on home → lost",
    "leg": { "market_type": "First Team To Score", "outcome_name": "home", "line": null },
    "result": { "home": 1, "away": 2, "scorers": [{ "name": "Sue", "team": "away" }, { "name": "Bob", "team": "home" }] },
    "expected_verdict": "lost"
  },
  {
    "id": "first-score-003",
    "description": "First Team To Score — 0-0 outcome=home → void (refund)",
    "leg": { "market_type": "First Team To Score", "outcome_name": "home", "line": null },
    "result": { "home": 0, "away": 0, "scorers": [] },
    "expected_verdict": "void"
  },
  {
    "id": "first-score-004",
    "description": "First Team To Score — 0-0 outcome=none → won",
    "leg": { "market_type": "First Team To Score", "outcome_name": "none", "line": null },
    "result": { "home": 0, "away": 0, "scorers": [] },
    "expected_verdict": "won"
  }
```

- [ ] **Step 2: Run — fail**

```bash
npm test -- classify-fixtures
```

Expected: 4 new fails.

- [ ] **Step 3: Add helper `settleFirstTeamToScore` near other player helpers**

In `classify.ts`, insert just before the `// ═══ Market-type dispatcher ═══` comment (around line 358):

```ts
function settleFirstTeamToScore(
  scorers: Scorer[] | null | undefined,
  totalGoals: number,
  outcome: string,
): { verdict: Verdict | null; reason?: string } {
  if (scorers == null) return { verdict: null, reason: "scorers_missing" };
  const o = norm(outcome);
  // 0-0 game: no team scored.
  if (scorers.length === 0 || totalGoals === 0) {
    if (o === "none" || o === "nessuna" || o === "no goal") return { verdict: "won" };
    if (
      o === "home" || o === "casa" || o === "1" ||
      o === "away" || o === "trasferta" || o === "2"
    ) {
      return { verdict: "void" }; // refund
    }
    return { verdict: null, reason: "unknown_outcome" };
  }
  const firstTeam = scorers[0].team;
  if (firstTeam == null) return { verdict: null, reason: "first_scorer_team_missing" };
  if (o === "home" || o === "casa" || o === "1") return { verdict: firstTeam === "home" ? "won" : "lost" };
  if (o === "away" || o === "trasferta" || o === "2") return { verdict: firstTeam === "away" ? "won" : "lost" };
  if (o === "none" || o === "nessuna" || o === "no goal") return { verdict: "lost" };
  return { verdict: null, reason: "unknown_outcome" };
}
```

- [ ] **Step 4: Add dispatcher branch**

In `classifyLeg`, after the "Player markets" block (around line 526, just before `// Unsupported`), insert:

```ts
  // ─── First Team To Score ───
  if (mt === "first team to score" || mt === "prima squadra a segnare") {
    return settleFirstTeamToScore(result.scorers, result.home + result.away, leg.outcome_name);
  }
```

- [ ] **Step 5: Run — pass**

```bash
npm test -- classify-fixtures
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add lib/settlement/odds-api/classify.ts tests/fixtures/settlement/gap-coverage.json
git commit -m "feat(classify): First Team To Score branch

New helper settleFirstTeamToScore reads scorers[0].team.
Handles 0-0 refund (home/away void, none wins) and unknown outcomes
return null+reason rather than silent void.

Football/rugby only (other sports lack scorers.team population).
Volume: ~10k markets.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Corners Totals Home / Away branches

**Files:**
- Modify: `lib/settlement/odds-api/classify.ts` (after existing corners family ~ line 477)
- Modify: `tests/fixtures/settlement/gap-coverage.json` (add 3 fixtures)

- [ ] **Step 1: Add 3 failing fixtures**

Append to `gap-coverage.json`:

```json
,
  {
    "id": "corners-home-001",
    "description": "Corners Totals Home over 4.5 — home got 6, won",
    "leg": { "market_type": "Corners Totals Home", "outcome_name": "over", "line": 4.5 },
    "result": { "home": 2, "away": 1, "corners_home": 6, "corners_away": 3 },
    "expected_verdict": "won"
  },
  {
    "id": "corners-home-002",
    "description": "Corners Totals Home under 5.5 — corners_home null → null verdict",
    "leg": { "market_type": "Corners Totals Home", "outcome_name": "under", "line": 5.5 },
    "result": { "home": 1, "away": 1 },
    "expected_verdict": null
  },
  {
    "id": "corners-away-001",
    "description": "Corners Totals Away over 3.5 — away got 4, won",
    "leg": { "market_type": "Corners Totals Away", "outcome_name": "over", "line": 3.5 },
    "result": { "home": 0, "away": 1, "corners_home": 5, "corners_away": 4 },
    "expected_verdict": "won"
  }
```

- [ ] **Step 2: Run — fail**

```bash
npm test -- classify-fixtures
```

- [ ] **Step 3: Add branches**

After the existing `corners handicap` branch (around line 477) in `classify.ts`, insert:

```ts
  // ─── Corners Totals per-team ───
  if (mt === "corners totals home" || mt === "totale angoli casa") {
    if (result.corners_home == null) return { verdict: null, reason: "corners_home_missing" };
    return { verdict: settleOU(result.corners_home, leg.line, leg.outcome_name) };
  }
  if (mt === "corners totals away" || mt === "totale angoli trasferta") {
    if (result.corners_away == null) return { verdict: null, reason: "corners_away_missing" };
    return { verdict: settleOU(result.corners_away, leg.line, leg.outcome_name) };
  }
```

- [ ] **Step 4: Run — pass**

```bash
npm test -- classify-fixtures
```

- [ ] **Step 5: Commit**

```bash
git add lib/settlement/odds-api/classify.ts tests/fixtures/settlement/gap-coverage.json
git commit -m "feat(classify): Corners Totals Home/Away branches

Single-team corners over/under. Reuses settleOU on corners_home/away.
Returns null+reason when stat missing (existing pattern).

Volume: ~14k markets (combined).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase C — Per-period branches (8 markets)

### Task 9: Add helpers `getPeriodScores` + `getTotalGames`

**Files:**
- Modify: `lib/settlement/odds-api/classify.ts` (insert near top of player helpers section ~line 357)

- [ ] **Step 1: Add the two helpers**

In `classify.ts`, insert just before the `// ═══ Market-type dispatcher ═══` comment:

```ts
// ═══════════════════════════════════════════════════
// Per-period extraction helpers (tennis sets, basket quarters, etc.)
// ═══════════════════════════════════════════════════

function getPeriodScores(
  result: ScoreResult,
  periodIdx: number,
): [number | null, number | null] {
  const h = result.period_scores_home?.[periodIdx];
  const a = result.period_scores_away?.[periodIdx];
  return [h ?? null, a ?? null];
}

function getTotalGames(result: ScoreResult): [number | null, number | null] {
  const h = result.period_scores_home;
  const a = result.period_scores_away;
  if (!h || !a || h.length === 0 || a.length === 0) return [null, null];
  return [h.reduce((s, x) => s + x, 0), a.reduce((s, x) => s + x, 0)];
}
```

- [ ] **Step 2: Typecheck + run existing tests**

```bash
npx tsc --noEmit && npm test -- classify
```

Expected: clean + all green (helpers unused yet so no behavior change).

- [ ] **Step 3: Commit**

```bash
git add lib/settlement/odds-api/classify.ts
git commit -m "feat(classify): add getPeriodScores + getTotalGames helpers

Pure helpers for per-period extraction (tennis sets, basket quarters)
and total games aggregation. Consumed by upcoming per-period branches.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: ML 1st Set / 2nd Set + Totals 1st Set branches

**Files:**
- Modify: `lib/settlement/odds-api/classify.ts` (insert in dispatcher after 1X2 family)
- Modify: `tests/fixtures/settlement/gap-coverage.json` (add 4 fixtures)

- [ ] **Step 1: Add 4 failing fixtures**

Append to `gap-coverage.json`:

```json
,
  {
    "id": "ml-set1-001",
    "description": "Tennis ML 1st Set — home won set 1 6-4",
    "leg": { "market_type": "ML 1st Set", "outcome_name": "home", "line": null },
    "result": { "home": 2, "away": 0, "period_scores_home": [6, 6], "period_scores_away": [4, 3] },
    "expected_verdict": "won"
  },
  {
    "id": "ml-set2-001",
    "description": "Tennis ML 2nd Set — away won set 2 7-5",
    "leg": { "market_type": "ML 2nd Set", "outcome_name": "away", "line": null },
    "result": { "home": 1, "away": 2, "period_scores_home": [6, 5, 4], "period_scores_away": [4, 7, 6] },
    "expected_verdict": "won"
  },
  {
    "id": "totals-set1-001",
    "description": "Totals 1st Set — 6-4 = 10 games over 9.5 → won",
    "leg": { "market_type": "Totals 1st Set", "outcome_name": "over", "line": 9.5 },
    "result": { "home": 2, "away": 0, "period_scores_home": [6, 6], "period_scores_away": [4, 3] },
    "expected_verdict": "won"
  },
  {
    "id": "ml-set1-002",
    "description": "ML 1st Set — period data missing → null",
    "leg": { "market_type": "ML 1st Set", "outcome_name": "home", "line": null },
    "result": { "home": 2, "away": 0 },
    "expected_verdict": null
  }
```

- [ ] **Step 2: Run — fail**

```bash
npm test -- classify-fixtures
```

- [ ] **Step 3: Add 3 branches in dispatcher**

In `classifyLeg`, find the existing "1X2 family" section (lines 370-380). Insert immediately after the 1X2 2T branch:

```ts
  // ─── Per-set / per-period 1X2 ───
  if (mt === "ml 1st set") {
    const [h, a] = getPeriodScores(result, 0);
    if (h == null || a == null) return { verdict: null, reason: "set1_missing" };
    return { verdict: settle1X2(h, a, leg.outcome_name) };
  }
  if (mt === "ml 2nd set") {
    const [h, a] = getPeriodScores(result, 1);
    if (h == null || a == null) return { verdict: null, reason: "set2_missing" };
    return { verdict: settle1X2(h, a, leg.outcome_name) };
  }
  if (mt === "totals 1st set") {
    const [h, a] = getPeriodScores(result, 0);
    if (h == null || a == null) return { verdict: null, reason: "set1_missing" };
    return { verdict: settleOU(h + a, leg.line, leg.outcome_name) };
  }
```

- [ ] **Step 4: Run — pass**

```bash
npm test -- classify-fixtures
```

- [ ] **Step 5: Commit**

```bash
git add lib/settlement/odds-api/classify.ts tests/fixtures/settlement/gap-coverage.json
git commit -m "feat(classify): ML 1st/2nd Set + Totals 1st Set branches

Tennis + volleyball per-set classifiers via getPeriodScores helper.
Reuse settle1X2 and settleOU on set-level home/away scores.

Volume: ML 1st Set ~1k + ML 2nd Set ~1k + Totals 1st Set ~1.7k.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Totals (Games) + Spread (Games) branches

**Files:**
- Modify: `lib/settlement/odds-api/classify.ts`
- Modify: `tests/fixtures/settlement/gap-coverage.json` (add 3 fixtures)

- [ ] **Step 1: Add 3 failing fixtures**

```json
,
  {
    "id": "totals-games-001",
    "description": "Totals (Games) — sets 6-4 7-5 = 13+9 = 22 games over 21.5 → won",
    "leg": { "market_type": "Totals (Games)", "outcome_name": "over", "line": 21.5 },
    "result": { "home": 2, "away": 0, "period_scores_home": [6, 7], "period_scores_away": [4, 5] },
    "expected_verdict": "won"
  },
  {
    "id": "spread-games-001",
    "description": "Spread (Games) — home +1.5, total home 13 away 9, home 13-9+1.5=14.5 vs 9 → home wins",
    "leg": { "market_type": "Spread (Games)", "outcome_name": "home", "line": 1.5 },
    "result": { "home": 2, "away": 0, "period_scores_home": [6, 7], "period_scores_away": [4, 5] },
    "expected_verdict": "won"
  },
  {
    "id": "totals-games-002",
    "description": "Totals (Games) — period data missing → null",
    "leg": { "market_type": "Totals (Games)", "outcome_name": "over", "line": 21.5 },
    "result": { "home": 2, "away": 0 },
    "expected_verdict": null
  }
```

- [ ] **Step 2: Run — fail**

```bash
npm test -- classify-fixtures
```

- [ ] **Step 3: Add branches**

After the ML/Totals 1st Set branches added in Task 10:

```ts
  // ─── Tennis Totals (Games) / Spread (Games) — sum across all sets ───
  if (mt === "totals (games)" || mt === "totale giochi") {
    const [h, a] = getTotalGames(result);
    if (h == null || a == null) return { verdict: null, reason: "period_scores_missing" };
    return { verdict: settleOU(h + a, leg.line, leg.outcome_name) };
  }
  if (mt === "spread (games)" || mt === "spread giochi") {
    const [h, a] = getTotalGames(result);
    if (h == null || a == null) return { verdict: null, reason: "period_scores_missing" };
    return { verdict: settleHandicap2Way(h, a, leg.line, leg.outcome_name) };
  }
```

- [ ] **Step 4: Run — pass**

```bash
npm test -- classify-fixtures
```

- [ ] **Step 5: Commit**

```bash
git add lib/settlement/odds-api/classify.ts tests/fixtures/settlement/gap-coverage.json
git commit -m "feat(classify): Totals (Games) + Spread (Games) — tennis full-match games

Sum games across all sets via getTotalGames helper, then reuse
settleOU / settleHandicap2Way.

Volume: ~15k markets combined.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Set Betting + 3-Way Result HT + Totals 1Q branches

**Files:**
- Modify: `lib/settlement/odds-api/classify.ts`
- Modify: `tests/fixtures/settlement/gap-coverage.json` (add 4 fixtures)

- [ ] **Step 1: Add 4 failing fixtures**

```json
,
  {
    "id": "set-betting-001",
    "description": "Set Betting — tennis 2-0 outcome=2-0 → won",
    "leg": { "market_type": "Set Betting", "outcome_name": "2-0", "line": null },
    "result": { "home": 2, "away": 0 },
    "expected_verdict": "won"
  },
  {
    "id": "set-betting-002",
    "description": "Set Betting — tennis 2-1 outcome=2-0 → lost",
    "leg": { "market_type": "Set Betting", "outcome_name": "2-0", "line": null },
    "result": { "home": 2, "away": 1 },
    "expected_verdict": "lost"
  },
  {
    "id": "3way-ht-001",
    "description": "3-Way Result HT — basket Q1 21-14 home wins",
    "leg": { "market_type": "3-Way Result HT", "outcome_name": "home", "line": null },
    "result": { "home": 92, "away": 88, "period_scores_home": [21, 25, 22, 24], "period_scores_away": [14, 26, 25, 23] },
    "expected_verdict": "won"
  },
  {
    "id": "totals-1q-001",
    "description": "Totals 1Q — basket Q1 home 21 away 14 = 35 under 40.5 → won",
    "leg": { "market_type": "Totals 1Q", "outcome_name": "under", "line": 40.5 },
    "result": { "home": 92, "away": 88, "period_scores_home": [21, 25, 22, 24], "period_scores_away": [14, 26, 25, 23] },
    "expected_verdict": "won"
  }
```

- [ ] **Step 2: Run — fail**

```bash
npm test -- classify-fixtures
```

- [ ] **Step 3: Add branches**

After the previous per-period branches in `classifyLeg`:

```ts
  // ─── Set Betting (tennis correct-score on sets won).
  // Tennis-specific: result.home/away are sets won (per spec §2 data model),
  // so settleCorrectScore treats outcome "2-0" as "home 2 sets, away 0 sets".
  if (mt === "set betting") {
    return { verdict: settleCorrectScore(result.home, result.away, leg.outcome_name) };
  }

  // ─── Basket Totals 1Q ───
  if (mt === "totals 1q" || mt === "totale 1q") {
    const [h, a] = getPeriodScores(result, 0);
    if (h == null || a == null) return { verdict: null, reason: "q1_missing" };
    return { verdict: settleOU(h + a, leg.line, leg.outcome_name) };
  }

  // ─── 3-Way Result HT (basket/handball 1X2 on first period) ───
  if (mt === "3-way result ht" || mt === "3 way result ht") {
    const [h, a] = getPeriodScores(result, 0);
    if (h == null || a == null) return { verdict: null, reason: "ht_scores_missing" };
    return { verdict: settle1X2(h, a, leg.outcome_name) };
  }
```

- [ ] **Step 4: Run — pass**

```bash
npm test -- classify-fixtures
```

- [ ] **Step 5: Commit**

```bash
git add lib/settlement/odds-api/classify.ts tests/fixtures/settlement/gap-coverage.json
git commit -m "feat(classify): Set Betting + 3-Way Result HT + Totals 1Q branches

Last three per-period branches. Volume: Set Betting ~919 + 3-Way HT ~722
+ Totals 1Q ~2k.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase D — Integration & validation

### Task 13: Add HT-via-live-data integration fixtures

**Files:**
- Modify: `tests/lib/settlement/odds-api/build-scores.test.ts` (extend)

Note: These verify the end-to-end path from `live_data` JSONB through `buildScores` into the existing HT classifier branches (which are unchanged code-wise).

- [ ] **Step 1: Append integration test cases**

Add to `build-scores.test.ts` a new `describe` block:

```ts
import { classifyLeg } from "@/lib/settlement/odds-api/classify";

describe("buildScores → classifyLeg integration (HT markets via live_data)", () => {
  test("Half Time Result from football live_data.periods", () => {
    const scores = buildScores({
      score_home: 2,
      score_away: 1,
      period_scores: null,
      live_data: {
        periods: [
          { name: "1 Tempo", homeScore: 1, awayScore: 0 },
          { name: "2 Tempo", homeScore: 1, awayScore: 1 },
        ],
      },
      sport_slug: "football",
      period: null,
    })!;
    const v = classifyLeg(
      { market_type: "Half Time Result", outcome_name: "home", line: null },
      scores,
    );
    expect(v.verdict).toBe("won");
  });

  test("Totals HT from football live_data.periods", () => {
    const scores = buildScores({
      score_home: 3,
      score_away: 1,
      period_scores: null,
      live_data: {
        periods: [
          { name: "1 Tempo", homeScore: 1, awayScore: 1 },
          { name: "2 Tempo", homeScore: 2, awayScore: 0 },
        ],
      },
      sport_slug: "football",
      period: null,
    })!;
    const v = classifyLeg(
      { market_type: "Totals HT", outcome_name: "over", line: 1.5 },
      scores,
    );
    expect(v.verdict).toBe("won"); // HT total 1+1=2 > 1.5
  });

  test("BTTS HT from football live_data.periods", () => {
    const scores = buildScores({
      score_home: 1,
      score_away: 0,
      period_scores: null,
      live_data: {
        periods: [{ name: "1 Tempo", homeScore: 1, awayScore: 0 }],
      },
      sport_slug: "football",
      period: null,
    })!;
    const v = classifyLeg(
      { market_type: "Both Teams To Score HT", outcome_name: "no", line: null },
      scores,
    );
    expect(v.verdict).toBe("won"); // HT 1-0, no BTTS
  });

  test("Half Time Result returns null when live_data missing periods + halfScore", () => {
    const scores = buildScores({
      score_home: 1,
      score_away: 1,
      period_scores: null,
      live_data: null,
      sport_slug: "football",
      period: null,
    })!;
    const v = classifyLeg(
      { market_type: "Half Time Result", outcome_name: "home", line: null },
      scores,
    );
    expect(v.verdict).toBeNull();
    expect(v.reason).toBe("ht_scores_missing");
  });
});
```

- [ ] **Step 2: Run**

```bash
npm test -- build-scores
```

Expected: all (5 unit + 4 integration) pass.

- [ ] **Step 3: Commit**

```bash
git add tests/lib/settlement/odds-api/build-scores.test.ts
git commit -m "test(settle-leg): integration tests buildScores → classifyLeg for HT markets

Verifies the end-to-end Bug X fix path: live_data.periods extraction
populates ht_home/away, then existing classifier branches consume them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Full test suite + typecheck

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: all tests pass. Notable counts: ≥60 fixtures from `score-only-60.json` + 22 from `gap-coverage.json` + 9 from `build-scores.test.ts` + all other existing tests.

If failures appear in unrelated test files, surface to the user — do not fix or skip.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Run admin lint if present**

```bash
npm run lint 2>/dev/null || echo "no lint script"
```

If `npm run lint` exists and fails, fix lint errors in changed files only.

- [ ] **Step 4: Snapshot status**

```bash
git log --oneline feature/plan-d-settlement-d1 -20
```

Confirm one commit per task (~13 commits in this plan) since the spec commits.

---

### Task 15: Staging probe + deploy

**Files:** None (operational task)

- [ ] **Step 1: Capture pre-deploy baseline**

```bash
ssh scraper-vps "PGPASSWORD='Veronihina2020@' psql -h db.bnabvfalytivjsrwqydo.supabase.co -U postgres -d postgres -c \"
  SELECT m.market_name, COUNT(*) stuck
  FROM bet_selections bs
  JOIN markets_v2 m ON m.id=bs.market_id
  JOIN events_v2 e ON e.id=bs.event_id
  WHERE bs.result IS NULL AND e.status='settled'
    AND m.market_name IN ('Team Total Home','Team Total Away','First Team To Score','3-Way Result',
                          'Corners Totals Home','Corners Totals Away','Half Time Result','Totals HT',
                          'ML HT','Spread HT','Both Teams To Score HT','Half Time / Full Time',
                          'ML 2H','Second Half Result','Totals 2H','Both Teams To Score 2H',
                          'ML 1st Set','ML 2nd Set','Totals 1st Set','Set Betting',
                          'Totals (Games)','Spread (Games)','Totals 1Q','3-Way Result HT')
  GROUP BY m.market_name ORDER BY stuck DESC;\""
```

Save the output. (Staging may already be near-zero per memo finding "7 bet_selections in dev/staging.")

- [ ] **Step 2: Deploy admin to staging**

Use the existing admin deploy pipeline. From memory: build tarball locally + scp + remote-apply.sh on scraper-vps. Coordinate with user — exact command depends on current pipeline state. If unclear, ask.

- [ ] **Step 3: Re-run probe + invoke `runSettlementPass(720)` via temp script**

Either ssh into staging admin and trigger via API route (if exposed under admin), or write a one-shot script at `scripts/db/probe-classify-gap-staging.mjs` that imports `runSettlementPass` and runs with 720h window. Capture before/after counts.

- [ ] **Step 4: Acceptance check**

Per spec §9 criterion 4: ≥ 80% reduction in stuck `result IS NULL` for the in-scope market_names listed in Step 1.

If criterion fails:
- Inspect which market_names did not improve.
- Likely cause: aliasing miss (market_name string variant not in our dispatcher) → add alias + redeploy.
- If FS data is just absent for the event → acceptable, document in `pending-fs-matcher-coverage-gaps.md`.

---

### Task 16: Prod deploy + 24h monitoring

**Files:** None

- [ ] **Step 1: Deploy admin to prod**

Standard pipeline. Confirm BUILD_ID present and health 200 after deploy.

- [ ] **Step 2: Smoke `/api/admin/settlement-health`**

```bash
curl https://<prod-admin-host>/api/admin/settlement-health
```

Verify subsystems still report normally. No new red flags.

- [ ] **Step 3: 24h monitor — re-run prod probe SQL from Task 15 Step 1**

After 24h, re-run the SQL. Expected: stuck counts dropping as `runSettlementPass` fires through normal settlement loop.

- [ ] **Step 4: Optional backfill**

If desired (with user approval), invoke `runSettlementPass(720)` once against prod (via admin API or temp script) to retroactively settle old stuck bets.

- [ ] **Step 5: Update memory**

Record session result in `memory/`:
- Mark `s4-classify-gap` as ✅ shipped in `MEMORY.md` pending table
- Create `session-2026-MM-DD-classify-gap-shipped.md` with deltas + acceptance check numbers

---

## Out-of-scope reminder

This plan does NOT cover:
- Esports map markets (0% live_data — separate provider needed)
- Darts / ice-hockey period markets (0% live_data)
- Player props beyond existing scorer markets
- OddsAPI `period_scores` column revival (investigation only)

These are listed in spec §10 as follow-up pendings.

---

## Effort summary

| Phase | Tasks | Estimate |
|---|---|---|
| A — buildScores extension | 1, 2, 3 | 1.5h |
| B — 4 full-match branches | 4, 5, 6, 7, 8 | 1.5h |
| C — 8 per-period branches | 9, 10, 11, 12 | 1.5h |
| D — integration + deploy | 13, 14, 15, 16 | 1.5-2h |
| **Total** | 16 tasks | **6-6.5h** |
