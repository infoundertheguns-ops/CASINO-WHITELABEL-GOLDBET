# Kambi + 22bet Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-04-24-kambi-22bet-integration-design.md`

**Goal:** Maximize markets available to the bettor by extending the settlement engine to resolve 22bet long-tail markets without VOID-ing, then exposing 22bet markets alongside Kambi in the player API.

**Architecture:** Five incremental phases — (0) foundation fix a latent extractor bug + extend `SettlementResult` with per-team stats; (1) add Family A team-split settlers; (2) add Family B corner/cards extended settlers; (3) add Family C exotic combo settlers; (4) fix Kambi live operator-merge for betOffers (discovered during probe); (5) expose merged Kambi+22bet markets in player API. Phases 0–3 are purely backend+settlement; Phase 4 is scraper-side; Phase 5 is player-facing.

**Tech Stack:** TypeScript, Next.js API routes, Supabase (Postgres + service role), vitest, flashscore feed (italian), Kambi API v2018.

## Probe findings (2026-04-24)

Before planning, the three spec open questions were probed (see `scripts/probe-flashscore-stats.ts`, `scripts/probe-kambi-live.ts`):

| Question | Answer | Source |
|---|---|---|
| Q1: flashscore exposes shots per team? | **YES** — `Partita/1 Tempo/2 Tempo: Tiri totali|Tiri in porta|Tiri fuori` per team | `fetchMatchDetail()` probe on 2 real calcio matches |
| Q2: flashscore exposes HT cards per team? | **YES** — `1 Tempo: Cartellini gialli` per team. Red cards likely as `Cartellini rossi` when present (not observed in sample, probe another match if doubt). | Same probe |
| Q3: Kambi alternate live endpoint? | **NO** — `/event/{id}/live.json` returns 404. But discovered: `live-loop.ts` pins each event to first-seen operator; fetching betOffers from ALL operators that see the event (and merging by criterion+line) yields +40-60% markets (event 1027429203: 888it=12, ub=17; event 1026317884: 888it=16, ub=18). | `scripts/probe-kambi-live.ts` |

**Latent bug discovered:** `buildResult()` in `lib/settlement.ts:123-149` calls `extractStat("Match", "Corner Kicks")` with English section+stat names, but `live_data.stats` is populated (via `app/api/cron/verify-results/route.ts:292-295`) from `fetchMatchDetail().stats` which returns **Italian** names (`Partita: Calci d'angolo`). Result: `extractStat` never matches → `corners_*`, `cards_*`, `shots_on_target_*` are always undefined in settlement. Every corner/cards/shots market currently VOID-s or skips-no-scores silently. Phase 0 Task 0.1 fixes this.

---

## File structure

**New files:**
- `tests/lib/settlement/extract-stats.test.ts` — TDD for Italian-name extractor
- `tests/lib/settlement/team-splits.test.ts` — TDD for Family A settlers
- `tests/lib/settlement/corner-cards-extended.test.ts` — TDD for Family B
- `tests/lib/settlement/exotic-combos.test.ts` — TDD for Family C
- `tests/lib/settlement/live-merge.test.ts` — TDD for Kambi live multi-operator merge
- `lib/settlement/stats-extractor.ts` — extracted `extractStat` logic, i18n-safe
- `lib/settlement/combo-settlers.ts` — compositional settler for exotic combos
- `scripts/probe-flashscore-stats.ts` — **already exists** (probe tool)
- `scripts/probe-kambi-live.ts` — **already exists** (probe tool)
- `docs/superpowers/notes/2026-04-24-kambi-live-operator-merge-finding.md` — probe write-up

**Modified files:**
- `lib/settlement.ts` — `buildResult()` rewired via new `stats-extractor.ts`; `SettlementResult` interface extended; new entries in `SETTLERS`, `MARKET_PATTERNS`; removals from `VOID_PATTERNS`
- `app/api/cron/verify-results/route.ts` — persist a **broader** set of flashscore stats (today only extracts the 3 we use; Family A needs more)
- `kambi-scraper/src/live-loop.ts` (in separate repo `C:/Users/philp/Downloads/kambi-scraper/`) — multi-operator betOffer merge
- `app/api/sportsbook/route.ts` — merge Kambi+22bet events/markets for player consumption (Phase 5)
- `supabase/migrations/104_bet_selections_source.sql` — add `source` column to `bet_selections` (Phase 5)
- `lib/settlement.ts` — settler dispatch uses `selection.source` to switch name patterns (Phase 5)

---

## Phase 0 — Foundation: i18n stat extractor + extended per-team stats

**Why first:** The latent extractor bug means Phase 1/2 settlers would still get undefined stats. Fix the foundation once and every subsequent phase builds on working data.

### Task 0.1: Fix `extractStat` for Italian section/stat names

**Files:**
- Create: `lib/settlement/stats-extractor.ts`
- Create: `tests/lib/settlement/extract-stats.test.ts`
- Modify: `lib/settlement.ts:111-150` (replace inline extraction with call into new module)

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/settlement/extract-stats.test.ts
import { describe, it, expect } from "vitest";
import { extractStat, extractTeamStat, type FlashscoreStat } from "@/lib/settlement/stats-extractor";

const sampleStats: FlashscoreStat[] = [
  { name: "Partita: Calci d'angolo", home: "5", away: "6" },
  { name: "Partita: Cartellini gialli", home: "4", away: "2" },
  { name: "Partita: Tiri totali", home: "11", away: "2" },
  { name: "Partita: Tiri in porta", home: "5", away: "1" },
  { name: "1 Tempo: Calci d'angolo", home: "2", away: "0" },
  { name: "1 Tempo: Cartellini gialli", home: "1", away: "0" },
  { name: "2 Tempo: Calci d'angolo", home: "3", away: "6" },
  // Intentional duplicate (flashscore emits dupes — parser must dedupe)
  { name: "Partita: Calci d'angolo", home: "5", away: "6" },
];

describe("extractStat (Italian names)", () => {
  it("extracts FT corners as totals", () => {
    expect(extractStat(sampleStats, "ft", "corners")).toEqual({ home: 5, away: 6, total: 11 });
  });
  it("extracts HT corners", () => {
    expect(extractStat(sampleStats, "ht", "corners")).toEqual({ home: 2, away: 0, total: 2 });
  });
  it("extracts FT yellow cards", () => {
    expect(extractStat(sampleStats, "ft", "cards_yellow")).toEqual({ home: 4, away: 2, total: 6 });
  });
  it("extracts FT shots-on-target", () => {
    expect(extractStat(sampleStats, "ft", "shots_on_target")).toEqual({ home: 5, away: 1, total: 6 });
  });
  it("extracts FT total shots (tiri totali)", () => {
    expect(extractStat(sampleStats, "ft", "shots_total")).toEqual({ home: 11, away: 2, total: 13 });
  });
  it("returns null if stat missing (HT shots)", () => {
    expect(extractStat(sampleStats, "ht", "shots_total")).toBeNull();
  });
  it("dedupes duplicate entries (uses first)", () => {
    const result = extractStat(sampleStats, "ft", "corners");
    expect(result).toEqual({ home: 5, away: 6, total: 11 });
  });
  it("is case-insensitive for section", () => {
    const withUpper: FlashscoreStat[] = [{ name: "PARTITA: Calci d'angolo", home: "1", away: "2" }];
    expect(extractStat(withUpper, "ft", "corners")).toEqual({ home: 1, away: 2, total: 3 });
  });
  it("handles red cards separately", () => {
    const withRed: FlashscoreStat[] = [
      { name: "Partita: Cartellini gialli", home: "2", away: "1" },
      { name: "Partita: Cartellini rossi", home: "1", away: "0" },
    ];
    expect(extractStat(withRed, "ft", "cards_yellow")).toEqual({ home: 2, away: 1, total: 3 });
    expect(extractStat(withRed, "ft", "cards_red")).toEqual({ home: 1, away: 0, total: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/settlement/extract-stats.test.ts`
Expected: all tests fail (module does not exist).

- [ ] **Step 3: Implement `lib/settlement/stats-extractor.ts`**

```typescript
export interface FlashscoreStat {
  name: string;
  home: string | number;
  away: string | number;
}

export type Period = "ft" | "ht" | "sh";
export type StatKind =
  | "corners"
  | "cards_yellow"
  | "cards_red"
  | "shots_total"
  | "shots_on_target"
  | "shots_off_target"
  | "possession";

const SECTION_LABELS: Record<Period, string> = {
  ft: "partita",
  ht: "1 tempo",
  sh: "2 tempo",
};

const STAT_LABELS: Record<StatKind, string> = {
  corners: "calci d'angolo",
  cards_yellow: "cartellini gialli",
  cards_red: "cartellini rossi",
  shots_total: "tiri totali",
  shots_on_target: "tiri in porta",
  shots_off_target: "tiri fuori",
  possession: "possesso palla",
};

function toNum(v: string | number): number | null {
  if (typeof v === "number") return v;
  const s = String(v).replace("%", "").trim();
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

export function extractStat(
  stats: FlashscoreStat[],
  period: Period,
  kind: StatKind
): { home: number; away: number; total: number } | null {
  const section = SECTION_LABELS[period];
  const stat = STAT_LABELS[kind];
  const target = `${section}: ${stat}`;
  const match = stats.find((s) => s.name.toLowerCase() === target);
  if (!match) return null;
  const h = toNum(match.home);
  const a = toNum(match.away);
  if (h == null || a == null) return null;
  return { home: h, away: a, total: h + a };
}

export function extractTeamStat(
  stats: FlashscoreStat[],
  period: Period,
  kind: StatKind,
  team: "home" | "away"
): number | null {
  const r = extractStat(stats, period, kind);
  return r ? r[team] : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lib/settlement/extract-stats.test.ts`
Expected: 9/9 pass.

- [ ] **Step 5: Wire into `buildResult()` in `lib/settlement.ts:111-150`**

Replace lines 111-150 with:

```typescript
  // Match statistics from Flashscore (persisted in live_data.stats, Italian names)
  const statsArr = ld.stats as import("@/lib/settlement/stats-extractor").FlashscoreStat[] | undefined;
  if (statsArr?.length) {
    const { extractStat } = await import("@/lib/settlement/stats-extractor");
    // (Note: buildResult is sync — remove `await` by refactoring to top-level import.
    // See step 5b below.)
  }
```

Actually use a top-level import to keep `buildResult` sync:

```typescript
// Top of file, after existing imports:
import {
  extractStat as extractFsStat,
  type FlashscoreStat,
} from "@/lib/settlement/stats-extractor";

// Then in buildResult, replace the old block 111-150 with:
  const statsArr = ld.stats as FlashscoreStat[] | undefined;
  if (statsArr?.length) {
    const cornersFt = extractFsStat(statsArr, "ft", "corners");
    if (cornersFt) {
      sr.corners_home = cornersFt.home;
      sr.corners_away = cornersFt.away;
      sr.corners_total = cornersFt.total;
    }
    const cornersHt = extractFsStat(statsArr, "ht", "corners");
    if (cornersHt) {
      sr.ht_corners_home = cornersHt.home;
      sr.ht_corners_away = cornersHt.away;
      sr.ht_corners_total = cornersHt.total;
    }
    const yellowFt = extractFsStat(statsArr, "ft", "cards_yellow");
    const redFt = extractFsStat(statsArr, "ft", "cards_red");
    if (yellowFt) {
      sr.cards_home = yellowFt.home + (redFt?.home ?? 0);
      sr.cards_away = yellowFt.away + (redFt?.away ?? 0);
      sr.cards_total = sr.cards_home + sr.cards_away;
    }
    const shotsOn = extractFsStat(statsArr, "ft", "shots_on_target");
    if (shotsOn) {
      sr.shots_on_target_home = shotsOn.home;
      sr.shots_on_target_away = shotsOn.away;
    }
  }
```

- [ ] **Step 6: Type-check and regression test**

Run:
```
npx tsc --noEmit
npm test
```
Expected: no type errors; all existing tests still pass + 9 new ones.

- [ ] **Step 7: Commit**

```bash
git add lib/settlement/stats-extractor.ts tests/lib/settlement/extract-stats.test.ts lib/settlement.ts
git commit -m "fix(settlement): extract flashscore stats via Italian names"
```

### Task 0.2: Extend `SettlementResult` with per-team + per-period stats

**Files:**
- Modify: `lib/settlement.ts:4-37` (SettlementResult interface)
- Modify: `lib/settlement.ts` (buildResult population)
- Modify: `tests/lib/settlement/extract-stats.test.ts` (add buildResult-level test)

- [ ] **Step 1: Extend interface**

Edit `lib/settlement.ts:4-37`, add after `shots_on_target_away`:

```typescript
  // Second-half corners
  sh_corners_home?: number;
  sh_corners_away?: number;
  sh_corners_total?: number;
  // Half-time yellow/red (Phase 2 consumers)
  ht_cards_home?: number;
  ht_cards_away?: number;
  ht_cards_total?: number;
  sh_cards_home?: number;
  sh_cards_away?: number;
  sh_cards_total?: number;
  // Total shots (tiri totali) FT/HT/SH
  shots_total_home?: number;
  shots_total_away?: number;
  ht_shots_total_home?: number;
  ht_shots_total_away?: number;
  sh_shots_total_home?: number;
  sh_shots_total_away?: number;
  // Shots on target HT/SH (shots_on_target_home/away FT already exist)
  ht_shots_on_target_home?: number;
  ht_shots_on_target_away?: number;
  sh_shots_on_target_home?: number;
  sh_shots_on_target_away?: number;
```

- [ ] **Step 2: Populate in buildResult**

After the existing extraction block added in Task 0.1, append:

```typescript
    const cornersSh = extractFsStat(statsArr, "sh", "corners");
    if (cornersSh) {
      sr.sh_corners_home = cornersSh.home;
      sr.sh_corners_away = cornersSh.away;
      sr.sh_corners_total = cornersSh.total;
    }
    const yellowHt = extractFsStat(statsArr, "ht", "cards_yellow");
    const redHt = extractFsStat(statsArr, "ht", "cards_red");
    if (yellowHt) {
      sr.ht_cards_home = yellowHt.home + (redHt?.home ?? 0);
      sr.ht_cards_away = yellowHt.away + (redHt?.away ?? 0);
      sr.ht_cards_total = sr.ht_cards_home + sr.ht_cards_away;
    }
    const yellowSh = extractFsStat(statsArr, "sh", "cards_yellow");
    const redSh = extractFsStat(statsArr, "sh", "cards_red");
    if (yellowSh) {
      sr.sh_cards_home = yellowSh.home + (redSh?.home ?? 0);
      sr.sh_cards_away = yellowSh.away + (redSh?.away ?? 0);
      sr.sh_cards_total = sr.sh_cards_home + sr.sh_cards_away;
    }
    const shotsFt = extractFsStat(statsArr, "ft", "shots_total");
    if (shotsFt) {
      sr.shots_total_home = shotsFt.home;
      sr.shots_total_away = shotsFt.away;
    }
    const shotsHt = extractFsStat(statsArr, "ht", "shots_total");
    if (shotsHt) {
      sr.ht_shots_total_home = shotsHt.home;
      sr.ht_shots_total_away = shotsHt.away;
    }
    const shotsSh = extractFsStat(statsArr, "sh", "shots_total");
    if (shotsSh) {
      sr.sh_shots_total_home = shotsSh.home;
      sr.sh_shots_total_away = shotsSh.away;
    }
    const shotsOnHt = extractFsStat(statsArr, "ht", "shots_on_target");
    if (shotsOnHt) {
      sr.ht_shots_on_target_home = shotsOnHt.home;
      sr.ht_shots_on_target_away = shotsOnHt.away;
    }
    const shotsOnSh = extractFsStat(statsArr, "sh", "shots_on_target");
    if (shotsOnSh) {
      sr.sh_shots_on_target_home = shotsOnSh.home;
      sr.sh_shots_on_target_away = shotsOnSh.away;
    }
```

- [ ] **Step 3: Add regression test**

Append to `tests/lib/settlement/extract-stats.test.ts`:

```typescript
import { __test__buildResult } from "@/lib/settlement"; // Add named export for testing

describe("buildResult integration", () => {
  it("populates all per-team per-period stats from Italian feed", () => {
    const event = {
      score_home: 2, score_away: 1,
      live_data: {
        halfScoreHome: [1, 1], halfScoreAway: [0, 1],
        stats: [
          { name: "Partita: Calci d'angolo", home: 5, away: 6 },
          { name: "1 Tempo: Calci d'angolo", home: 2, away: 0 },
          { name: "2 Tempo: Calci d'angolo", home: 3, away: 6 },
          { name: "Partita: Cartellini gialli", home: 4, away: 2 },
          { name: "1 Tempo: Cartellini gialli", home: 2, away: 0 },
          { name: "Partita: Tiri totali", home: 11, away: 2 },
        ],
      },
    };
    const sr = __test__buildResult(event, undefined, "calcio");
    expect(sr?.corners_home).toBe(5);
    expect(sr?.ht_corners_home).toBe(2);
    expect(sr?.sh_corners_away).toBe(6);
    expect(sr?.cards_total).toBe(6);
    expect(sr?.ht_cards_total).toBe(2);
    expect(sr?.shots_total_home).toBe(11);
  });
});
```

Export `__test__buildResult` in `lib/settlement.ts`:

```typescript
export const __test__buildResult = buildResult;
```

- [ ] **Step 4: Run tests and verify all green**

Run: `npm test -- tests/lib/settlement/`
Expected: all pass (9 original + 1 integration).

- [ ] **Step 5: Commit**

```bash
git add lib/settlement.ts tests/lib/settlement/extract-stats.test.ts
git commit -m "feat(settlement): extract per-team per-period flashscore stats"
```

### Task 0.3: Verify production stat ingestion pipeline

**Files:**
- Read only (verification task, no code change)

- [ ] **Step 1: Inspect the verify-results cron to confirm we persist all stat types**

Read `app/api/cron/verify-results/route.ts` lines 240-310 — verify `detail.stats` is stored as-is in `live_data.stats` (YES per current code, line 292-295). No change needed because feed already returns all sections+stats we need.

- [ ] **Step 2: Smoke test on 3 recent finished matches in prod DB (read-only)**

Run via Supabase SQL editor (or psql):

```sql
SELECT
  e.id, e.home_team, e.away_team,
  jsonb_array_length(COALESCE(e.live_data->'stats', '[]'::jsonb)) AS n_stats,
  e.live_data->'stats'->0->>'name' AS first_stat_name,
  e.flashscore_id
FROM events e
WHERE e.status = 'ended'
  AND e.sport_id IN (SELECT id FROM sports WHERE name ILIKE 'Calcio')
  AND e.live_data ? 'stats'
  AND e.updated_at > NOW() - INTERVAL '48 hours'
ORDER BY e.updated_at DESC
LIMIT 5;
```

Expected: 5 rows, `n_stats >= 10`, `first_stat_name` starts with `"Partita:"` or `"1 Tempo:"`. Document the actual counts as a sanity baseline in commit message.

- [ ] **Step 3: Commit note**

If probe confirms data is there: commit message can be added to Task 0.2 commit (no separate commit for this task).

If probe finds gaps (e.g., matches with no stats): add `docs/superpowers/notes/2026-04-24-stats-coverage-baseline.md` documenting %-coverage per league and open a follow-up note.

---

## Phase 1 — Stream 1 Family A: Team splits

**Goal:** Settle markets that split a match stat by team (corners/shots/goals per home or away team).

**Prereq:** Phase 0 complete — `sr.corners_home`, `sr.shots_total_home`, etc. now populated.

### Task 1.1: O/U corners per team (FT)

**Target markets (22bet names):**
- `O/U Corner Casa 4.5` → home corners over/under 4.5
- `O/U Corner Ospite 3.5` → away corners over/under 3.5

**Files:**
- Create: `tests/lib/settlement/team-splits.test.ts`
- Modify: `lib/settlement.ts` (add settler + patterns; remove from VOID_PATTERNS if present)

- [ ] **Step 1: Failing test**

```typescript
// tests/lib/settlement/team-splits.test.ts
import { describe, it, expect } from "vitest";
import { __test__settle as settle } from "@/lib/settlement"; // add named export

describe("Family A: team-split corners O/U", () => {
  const baseEvent = {
    score_home: 1, score_away: 1,
    live_data: {
      halfScoreHome: [0, 1], halfScoreAway: [1, 0],
      stats: [
        { name: "Partita: Calci d'angolo", home: 7, away: 4 },
      ],
    },
  };

  it("O/U Corner Casa 4.5 Over → won when home=7", () => {
    expect(settle(baseEvent, "O/U Corner Casa 4.5", "Over", 4.5, "calcio")).toBe("won");
  });
  it("O/U Corner Casa 4.5 Under → lost when home=7", () => {
    expect(settle(baseEvent, "O/U Corner Casa 4.5", "Under", 4.5, "calcio")).toBe("lost");
  });
  it("O/U Corner Ospite 3.5 Under → lost when away=4", () => {
    expect(settle(baseEvent, "O/U Corner Ospite 3.5", "Under", 3.5, "calcio")).toBe("lost");
  });
  it("returns null if stats not yet persisted", () => {
    const noStats = { score_home: 1, score_away: 1, live_data: { halfScoreHome: [0], halfScoreAway: [0] } };
    expect(settle(noStats, "O/U Corner Casa 4.5", "Over", 4.5, "calcio")).toBeNull();
  });
  it("returns push when corners exactly match a whole line", () => {
    const ev = { ...baseEvent, live_data: { ...baseEvent.live_data, stats: [{ name: "Partita: Calci d'angolo", home: 4, away: 4 }] } };
    expect(settle(ev, "O/U Corner Casa 4.0", "Over", 4.0, "calcio")).toBe("push");
  });
});
```

Add test helper export in `lib/settlement.ts`:

```typescript
export const __test__settle = (event: any, marketType: string, outcomeName: string, line: number | undefined, sport: string) => {
  const sr = buildResult(event, undefined, sport);
  if (!sr) return null;
  // Resolve pattern → key manually for tests:
  for (const mp of MARKET_PATTERNS) {
    const m = marketType.match(mp.pattern);
    if (m) {
      const settler = SETTLERS[mp.key];
      const resolvedLine = mp.lineGroup ? parseFloat(m[mp.lineGroup]) : line;
      return settler ? settler(sr, outcomeName, resolvedLine) : null;
    }
  }
  return null;
};
```

- [ ] **Step 2: Run test to verify fail**

Run: `npm test -- tests/lib/settlement/team-splits.test.ts`
Expected: all fail — no pattern matches `O/U Corner Casa 4.5`.

- [ ] **Step 3: Implement settlers + patterns**

In `lib/settlement.ts` add around the existing corner-related settlers:

```typescript
// ─── Family A: team-split corners ───
SETTLERS["O/U_CORNER_HOME"] = (sr, outcomeName, line) => {
  if (sr.corners_home == null || line == null) return null;
  const n = outcomeName.trim().toLowerCase();
  if (n.startsWith("over") || n === "over") {
    if (sr.corners_home > line) return "won";
    if (sr.corners_home < line) return "lost";
    return "push";
  }
  if (n.startsWith("under") || n === "under") {
    if (sr.corners_home < line) return "won";
    if (sr.corners_home > line) return "lost";
    return "push";
  }
  return null;
};
SETTLERS["O/U_CORNER_AWAY"] = (sr, outcomeName, line) => {
  if (sr.corners_away == null || line == null) return null;
  const n = outcomeName.trim().toLowerCase();
  if (n.startsWith("over") || n === "over") {
    if (sr.corners_away > line) return "won";
    if (sr.corners_away < line) return "lost";
    return "push";
  }
  if (n.startsWith("under") || n === "under") {
    if (sr.corners_away < line) return "won";
    if (sr.corners_away > line) return "lost";
    return "push";
  }
  return null;
};
```

Add patterns in `MARKET_PATTERNS` (place near existing corner patterns, before catch-alls):

```typescript
  // ─── Family A: team-split corners ───
  { pattern: /^O\/U\s+Corner\s+Casa\s+([\d.]+)$/i, key: "O/U_CORNER_HOME", lineGroup: 1 },
  { pattern: /^O\/U\s+Corner\s+Ospite\s+([\d.]+)$/i, key: "O/U_CORNER_AWAY", lineGroup: 1 },
  { pattern: /^Calci d'angolo\s+-\s+Totale\s+Casa\s+([\d.]+)$/i, key: "O/U_CORNER_HOME", lineGroup: 1 },
  { pattern: /^Calci d'angolo\s+-\s+Totale\s+Ospite\s+([\d.]+)$/i, key: "O/U_CORNER_AWAY", lineGroup: 1 },
```

Check whether `/^Calci d'angolo\s+-\s+(?!1X2 con Handicap|Totale|Più|1X2)/i` in VOID_PATTERNS (line 180) already whitelists `Totale` — YES. No VOID_PATTERNS change needed.

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -- tests/lib/settlement/team-splits.test.ts`
Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add lib/settlement.ts tests/lib/settlement/team-splits.test.ts
git commit -m "feat(settlement): O/U corners per team (Family A)"
```

### Task 1.2: O/U shots per team (FT)

**Target markets:**
- `O/U Tiri Casa 11.5` / `O/U Tiri Ospite 8.5`
- `O/U Tiri Porta Casa 4.5` / `O/U Tiri Porta Ospite 3.5` (shots on target)

**Files:**
- Modify: `tests/lib/settlement/team-splits.test.ts`
- Modify: `lib/settlement.ts`

- [ ] **Step 1: Failing test**

Append to `team-splits.test.ts`:

```typescript
describe("Family A: team-split shots O/U", () => {
  const ev = {
    score_home: 1, score_away: 0,
    live_data: {
      halfScoreHome: [1], halfScoreAway: [0],
      stats: [
        { name: "Partita: Tiri totali", home: 11, away: 2 },
        { name: "Partita: Tiri in porta", home: 5, away: 1 },
      ],
    },
  };
  it("O/U Tiri Casa 10.5 Over won", () => {
    expect(settle(ev, "O/U Tiri Casa 10.5", "Over", 10.5, "calcio")).toBe("won");
  });
  it("O/U Tiri Porta Ospite 1.5 Under won", () => {
    expect(settle(ev, "O/U Tiri Porta Ospite 1.5", "Under", 1.5, "calcio")).toBe("won");
  });
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Implement**

Add settlers:

```typescript
SETTLERS["O/U_SHOTS_HOME"] = makeTeamOU((sr) => sr.shots_total_home);
SETTLERS["O/U_SHOTS_AWAY"] = makeTeamOU((sr) => sr.shots_total_away);
SETTLERS["O/U_SHOTS_ON_TARGET_HOME"] = makeTeamOU((sr) => sr.shots_on_target_home);
SETTLERS["O/U_SHOTS_ON_TARGET_AWAY"] = makeTeamOU((sr) => sr.shots_on_target_away);
```

Extract the common pattern into a helper earlier in the file:

```typescript
function makeTeamOU(getter: (sr: SettlementResult) => number | undefined): SettlerFn {
  return (sr, outcomeName, line) => {
    const v = getter(sr);
    if (v == null || line == null) return null;
    const n = outcomeName.trim().toLowerCase();
    const isOver = n.startsWith("over") || n === "over";
    const isUnder = n.startsWith("under") || n === "under";
    if (!isOver && !isUnder) return null;
    if (v === line) return "push";
    const won = isOver ? v > line : v < line;
    return won ? "won" : "lost";
  };
}
```

Refactor `O/U_CORNER_HOME` and `O/U_CORNER_AWAY` to use `makeTeamOU` too. Patterns:

```typescript
  { pattern: /^O\/U\s+Tiri\s+Casa\s+([\d.]+)$/i, key: "O/U_SHOTS_HOME", lineGroup: 1 },
  { pattern: /^O\/U\s+Tiri\s+Ospite\s+([\d.]+)$/i, key: "O/U_SHOTS_AWAY", lineGroup: 1 },
  { pattern: /^O\/U\s+Tiri\s+Porta\s+Casa\s+([\d.]+)$/i, key: "O/U_SHOTS_ON_TARGET_HOME", lineGroup: 1 },
  { pattern: /^O\/U\s+Tiri\s+Porta\s+Ospite\s+([\d.]+)$/i, key: "O/U_SHOTS_ON_TARGET_AWAY", lineGroup: 1 },
```

**Important**: line 268 of VOID_PATTERNS has `/\bTiri Totali\b/i` which will incorrectly VOID these. Reorder so MARKET_PATTERNS is checked BEFORE VOID_PATTERNS, or narrow the void pattern:

Replace `/\bTiri Totali\b/i` with `/\|\s*Tiri Totali\b/i` (the original intent was player-prop "Player Name | Tiri Totali" — note the pipe separator).

- [ ] **Step 4: Run → pass**

- [ ] **Step 5: Commit**

```bash
git add lib/settlement.ts tests/lib/settlement/team-splits.test.ts
git commit -m "feat(settlement): O/U shots per team (Family A)"
```

### Task 1.3: O/U goals per team (FT)

**Target markets:**
- `O/U Gol Casa 1.5` / `O/U Gol Ospite 1.5`
- Kambi variant: `Gol totali - <home team name>` / `Gol totali - <away team name>` (per-team named)

**Files:**
- Modify: `tests/lib/settlement/team-splits.test.ts`
- Modify: `lib/settlement.ts`

- [ ] **Step 1: Failing test**

```typescript
describe("Family A: team-split goals O/U", () => {
  const ev = { score_home: 2, score_away: 1, live_data: { halfScoreHome: [1,1], halfScoreAway: [0,1] } };
  it("O/U Gol Casa 1.5 Over won", () => {
    expect(settle(ev, "O/U Gol Casa 1.5", "Over", 1.5, "calcio")).toBe("won");
  });
  it("O/U Gol Ospite 1.5 Under won", () => {
    expect(settle(ev, "O/U Gol Ospite 1.5", "Under", 1.5, "calcio")).toBe("won");
  });
  it("push on exact line", () => {
    expect(settle(ev, "O/U Gol Casa 2", "Over", 2, "calcio")).toBe("push");
  });
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Implement**

Settlers use `makeTeamOU`:

```typescript
SETTLERS["O/U_GOALS_HOME"] = makeTeamOU((sr) => sr.home);
SETTLERS["O/U_GOALS_AWAY"] = makeTeamOU((sr) => sr.away);
```

Patterns:

```typescript
  { pattern: /^O\/U\s+Gol\s+Casa\s+([\d.]+)$/i, key: "O/U_GOALS_HOME", lineGroup: 1 },
  { pattern: /^O\/U\s+Gol\s+Ospite\s+([\d.]+)$/i, key: "O/U_GOALS_AWAY", lineGroup: 1 },
```

**Kambi named variants**: already partially handled at lines noted in existing code (search `Gol totali -` patterns). They currently fall through to `O/U` without line group — leave for Phase 3 normalization work if mapping shows the names conflict.

- [ ] **Step 4: Run → pass**

- [ ] **Step 5: Commit**

```bash
git add lib/settlement.ts tests/lib/settlement/team-splits.test.ts
git commit -m "feat(settlement): O/U goals per team (Family A)"
```

### Task 1.4: 1X2 + Handicap per-team corners

**Target markets:**
- `1X2 Corner Casa` — who wins the home-team corners count (trivially always "home wins" since it's their own; this market in 22bet actually is `1X2 Corner` = who wins corner count total)
- Wait: clarify. 22bet: `1X2 Corner` = totale home vs totale away, winner by corner count. This is already a market without team split — it's `1X2` flavor on corners. NOT a per-team market. Drop from Family A and handle in Family B instead.

**Decision:** Remove `1X2 Corner Casa` from Family A scope. Move `Handicap Corner Casa (+1.5)` (handicap applied to home-team corner count vs a threshold) to Family B if it exists as a distinct market. Keep Family A as strict "one-team stat" markets only.

- [ ] **Step 1:** No code. Document in a commit note:

```bash
git commit --allow-empty -m "docs(plan): clarify Family A scope excludes cross-team corner derivatives"
```

### Task 1.5: Integration test with 3 real finished events

**Files:**
- Create: `scripts/test-family-a-real.ts`

- [ ] **Step 1: Write ad-hoc verification script**

```typescript
#!/usr/bin/env tsx
// Runs buildResult + settle on the last 10 finished calcio matches
// that have complete flashscore stats, verifies verdicts exist for
// synthetic Family A markets.

import { createClient } from "@supabase/supabase-js";
import { __test__buildResult, __test__settle } from "@/lib/settlement";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: events } = await supabase
    .from("events")
    .select("id, home_team, away_team, score_home, score_away, live_data, sport_id, sports!inner(name)")
    .eq("status", "ended")
    .not("live_data->stats", "is", null)
    .order("updated_at", { ascending: false })
    .limit(10);

  if (!events) return;

  for (const e of events) {
    const stats = (e.live_data as any)?.stats || [];
    const hasCorners = stats.some((s: any) => s.name === "Partita: Calci d'angolo");
    if (!hasCorners) { console.log(`SKIP ${e.home_team} - no corner stats`); continue; }

    const sr = __test__buildResult(e, undefined, "calcio");
    if (!sr) { console.log(`SKIP ${e.home_team} - no result`); continue; }
    const ch = sr.corners_home ?? -1;
    const ca = sr.corners_away ?? -1;

    // Verify synthetic Family A market settles as expected
    const line = Math.floor(ch) + 0.5; // below home count
    const verdict = __test__settle(e, `O/U Corner Casa ${line}`, "Over", line, "calcio");
    console.log(`${e.home_team.padEnd(20)} vs ${e.away_team.padEnd(20)} corners=${ch}-${ca} | Over ${line} → ${verdict}`);
  }
}

main();
```

- [ ] **Step 2: Run on prod data**

Run: `npx tsx scripts/test-family-a-real.ts`
Expected: 10 lines, most showing `won` on synthetic over-the-line market, proving end-to-end pipeline works on real data.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-family-a-real.ts
git commit -m "chore: add Family A integration test script"
```

### Task 1.6: Deploy + canary

- [ ] **Step 1: Push to staging via CI**

```bash
git push origin staging
```

Wait for GH Actions deploy to complete (check `gh run watch`).

- [ ] **Step 2: Canary 24h on staging — observe settlement metrics**

Read `/admin/settlement` page OR run:

```sql
SELECT
  DATE_TRUNC('hour', settled_at) AS hour,
  COUNT(*) FILTER (WHERE status = 'won') AS won,
  COUNT(*) FILTER (WHERE status = 'lost') AS lost,
  COUNT(*) FILTER (WHERE status = 'void') AS voided,
  COUNT(*) FILTER (WHERE market_type ILIKE 'O/U Corner %') AS corner_settled,
  COUNT(*) FILTER (WHERE market_type ILIKE 'O/U Tiri %') AS shots_settled
FROM bet_selections
WHERE settled_at > NOW() - INTERVAL '24 hours'
GROUP BY 1
ORDER BY 1 DESC;
```

Expected: `void` rate does NOT spike; `corner_settled` / `shots_settled` > 0.

- [ ] **Step 3: Promote to prod via CI/CD merge**

```bash
git checkout master
git merge staging
git push origin master
```

---

## Phase 2 — Stream 2 Family B: Corner/Cards extended

**Goal:** Settle per-half and handicap variants of corner/cards markets.

**Prereq:** Phase 1 shipped (depends on stats infrastructure + helper `makeTeamOU`).

### Task 2.1: Handicap corners HT/SH

**Target markets:**
- `Handicap Corner 1°T (-1)`, `Handicap Corner 2°T (+1.5)`

**Files:**
- Create: `tests/lib/settlement/corner-cards-extended.test.ts`
- Modify: `lib/settlement.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from "vitest";
import { __test__settle as settle } from "@/lib/settlement";

describe("Family B: handicap corners HT/SH", () => {
  const ev = {
    score_home: 1, score_away: 0,
    live_data: {
      halfScoreHome: [1, 0], halfScoreAway: [0, 0],
      stats: [
        { name: "Partita: Calci d'angolo", home: 7, away: 5 },
        { name: "1 Tempo: Calci d'angolo", home: 4, away: 2 },
        { name: "2 Tempo: Calci d'angolo", home: 3, away: 3 },
      ],
    },
  };
  it("Handicap Corner 1°T (-1) → home won (4-2+(-1)=1>0)", () => {
    expect(settle(ev, "Handicap Corner 1°T (-1)", "1", -1, "calcio")).toBe("won");
  });
  it("Handicap Corner 2°T (+0.5) Away → won (3 vs 3-0.5=2.5; away+0.5=3.5>3)", () => {
    expect(settle(ev, "Handicap Corner 2°T (+0.5)", "2", 0.5, "calcio")).toBe("won");
  });
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Implement**

```typescript
function makeHandicap(
  getHome: (sr: SettlementResult) => number | undefined,
  getAway: (sr: SettlementResult) => number | undefined
): SettlerFn {
  return (sr, outcomeName, line) => {
    const h = getHome(sr);
    const a = getAway(sr);
    if (h == null || a == null || line == null) return null;
    const n = outcomeName.trim();
    // Kambi-style: outcome is "1" (home), "X" (draw), "2" (away)
    // Some variants use team name; for simplicity we accept "1" | "X" | "2" | "Casa" | "Ospite" | "Pareggio"
    const isHome = n === "1" || /casa/i.test(n);
    const isAway = n === "2" || /ospite/i.test(n);
    const isDraw = n === "X" || /pareggio/i.test(n);
    const adjHome = h + line; // line applies to home (negative = handicap against home)
    if (adjHome > a && isHome) return "won";
    if (adjHome < a && isAway) return "won";
    if (adjHome === a && isDraw) return "won";
    if ((isHome || isAway || isDraw) && !(isHome ? adjHome > a : isAway ? adjHome < a : adjHome === a)) return "lost";
    return null;
  };
}

SETTLERS["HANDICAP_CORNERS_HT"] = makeHandicap((sr) => sr.ht_corners_home, (sr) => sr.ht_corners_away);
SETTLERS["HANDICAP_CORNERS_SH"] = makeHandicap((sr) => sr.sh_corners_home, (sr) => sr.sh_corners_away);
```

Patterns:

```typescript
  { pattern: /^Handicap Corner\s+1°?\s*T\s+\(?([+-]?[\d.]+)\)?$/i, key: "HANDICAP_CORNERS_HT", lineGroup: 1 },
  { pattern: /^Handicap Corner\s+2°?\s*T\s+\(?([+-]?[\d.]+)\)?$/i, key: "HANDICAP_CORNERS_SH", lineGroup: 1 },
  { pattern: /^Calci d'angolo\s+-\s+Handicap\s+1°?\s*Tempo\s+\(?([+-]?[\d.]+)\)?$/i, key: "HANDICAP_CORNERS_HT", lineGroup: 1 },
  { pattern: /^Calci d'angolo\s+-\s+Handicap\s+2°?\s*Tempo\s+\(?([+-]?[\d.]+)\)?$/i, key: "HANDICAP_CORNERS_SH", lineGroup: 1 },
```

- [ ] **Step 4: Run → pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(settlement): handicap corners HT/SH (Family B)"
```

### Task 2.2: DC corners HT/SH

**Target markets:**
- `DC Corner 1°T` (12/1X/X2), `DC Corner 2°T`

- [ ] **Step 1: Failing test**

```typescript
describe("Family B: DC corners HT/SH", () => {
  const ev = { /* same as 2.1 */ };
  it("DC Corner 1°T 1X → won (home 4 > away 2, tie or win)", () => {
    expect(settle(ev, "DC Corner 1°T", "1X", undefined, "calcio")).toBe("won");
  });
  it("DC Corner 1°T 12 → won", () => {
    expect(settle(ev, "DC Corner 1°T", "12", undefined, "calcio")).toBe("won");
  });
  it("DC Corner 1°T X2 → lost (home wins corners)", () => {
    expect(settle(ev, "DC Corner 1°T", "X2", undefined, "calcio")).toBe("lost");
  });
});
```

- [ ] **Step 2-5: Implement `makeDC`, register, commit**

```typescript
function makeDC(getHome, getAway): SettlerFn {
  return (sr, outcomeName) => {
    const h = getHome(sr), a = getAway(sr);
    if (h == null || a == null) return null;
    const n = outcomeName.trim().replace(/\s/g, "").toUpperCase();
    const home_wins = h > a, draw = h === a, away_wins = h < a;
    if (n === "1X") return home_wins || draw ? "won" : "lost";
    if (n === "12") return home_wins || away_wins ? "won" : "lost";
    if (n === "X2") return draw || away_wins ? "won" : "lost";
    return null;
  };
}
SETTLERS["DC_CORNERS_HT"] = makeDC((sr) => sr.ht_corners_home, (sr) => sr.ht_corners_away);
SETTLERS["DC_CORNERS_SH"] = makeDC((sr) => sr.sh_corners_home, (sr) => sr.sh_corners_away);
```

Patterns:

```typescript
  { pattern: /^DC\s+Corner\s+1°?\s*T$/i, key: "DC_CORNERS_HT" },
  { pattern: /^DC\s+Corner\s+2°?\s*T$/i, key: "DC_CORNERS_SH" },
```

```bash
git commit -m "feat(settlement): DC corners HT/SH (Family B)"
```

### Task 2.3: HT cards markets

**Target markets:**
- `O/U Cartellini 1°T 2.5` — total yellow+red HT cards over/under
- `Handicap Cartellini 1°T (-1)` — handicap HT cards

**Prereq validated by probe:** `1 Tempo: Cartellini gialli` IS in flashscore feed. Red cards appear separately as `1 Tempo: Cartellini rossi` when present. Phase 0 already populates `sr.ht_cards_home/away/total`.

- [ ] **Step 1-5:** Test → implement → commit. Reuse `makeTeamOU` on `sr.ht_cards_total` (for O/U) and `makeHandicap` on `(ht_cards_home, ht_cards_away)` for handicap.

```typescript
SETTLERS["O/U_CARDS_HT"] = makeTotalOU((sr) => sr.ht_cards_total);
SETTLERS["HANDICAP_CARDS_HT"] = makeHandicap((sr) => sr.ht_cards_home, (sr) => sr.ht_cards_away);

  { pattern: /^O\/U\s+Cartellini\s+1°?\s*T\s+([\d.]+)$/i, key: "O/U_CARDS_HT", lineGroup: 1 },
  { pattern: /^Handicap\s+Cartellini\s+1°?\s*T\s+\(?([+-]?[\d.]+)\)?$/i, key: "HANDICAP_CARDS_HT", lineGroup: 1 },
```

Add `makeTotalOU`:

```typescript
function makeTotalOU(getter: (sr: SettlementResult) => number | undefined): SettlerFn {
  return (sr, outcomeName, line) => {
    const v = getter(sr);
    if (v == null || line == null) return null;
    const n = outcomeName.trim().toLowerCase();
    const isOver = n.startsWith("over") || n === "over";
    const isUnder = n.startsWith("under") || n === "under";
    if (!isOver && !isUnder) return null;
    if (v === line) return "push";
    return (isOver ? v > line : v < line) ? "won" : "lost";
  };
}
```

```bash
git commit -m "feat(settlement): HT cards markets (Family B)"
```

### Task 2.4: Document out-of-scope markets

**Goal:** Explicitly mark non-settleable markets as VOID with documentation.

- [ ] **Step 1:** In `lib/settlement.ts` VOID_PATTERNS, add comments for why these stay VOID:

```typescript
  // Family B out-of-scope: require minute-level timeline data
  /^Primo\s+Corner\s+Squadra/i,       // Which team takes first corner — not in flashscore stats
  /^Gara\s+A\s+\d+\s+Corner/i,        // (already present) — race to N corners
  /^1X2\s+Corner\s+-\s+Prima\s+Mett[aà]/i,  // half-specific 1X2 corner — timeline data needed
```

- [ ] **Step 2: Commit**

```bash
git commit -m "docs(settlement): mark Family B out-of-scope markets as VOID by design"
```

### Task 2.5: Deploy + canary (same as 1.6)

---

## Phase 3 — Stream 3 Family C: Exotic combos

**Goal:** Settle combo markets (1X2+GG, DC+O/U, etc.) by composing existing settlers.

**Prereq:** Phases 0-2 (no new data needed — purely compositional).

### Task 3.1: Combo settler helper

**Files:**
- Create: `lib/settlement/combo-settlers.ts`
- Create: `tests/lib/settlement/exotic-combos.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// tests/lib/settlement/exotic-combos.test.ts
import { describe, it, expect } from "vitest";
import { __test__settle as settle } from "@/lib/settlement";

describe("Family C: 1X2+GG", () => {
  const ev = { score_home: 2, score_away: 1, live_data: { halfScoreHome: [1], halfScoreAway: [0] } };
  it("1+GG won when home wins and both score", () => {
    expect(settle(ev, "1X2+GG", "1+GG", undefined, "calcio")).toBe("won");
  });
  it("1+NG lost when both scored", () => {
    expect(settle(ev, "1X2+GG", "1+NG", undefined, "calcio")).toBe("lost");
  });
  it("X+GG lost when not draw", () => {
    expect(settle(ev, "1X2+GG", "X+GG", undefined, "calcio")).toBe("lost");
  });
  it("2+GG lost when away lost", () => {
    expect(settle(ev, "1X2+GG", "2+GG", undefined, "calcio")).toBe("lost");
  });
});

describe("Family C: 1X2+O/U 2.5", () => {
  const ev = { score_home: 2, score_away: 1 };
  it("1+Over 2.5 won (home wins AND total 3 > 2.5)", () => {
    expect(settle(ev, "1X2+O/U 2.5", "1+Over", 2.5, "calcio")).toBe("won");
  });
  it("1+Under 2.5 lost", () => {
    expect(settle(ev, "1X2+O/U 2.5", "1+Under", 2.5, "calcio")).toBe("lost");
  });
});

describe("Family C: DC+O/U", () => {
  const ev = { score_home: 1, score_away: 1 };
  it("1X+Over 1.5 won (draw AND total 2 > 1.5)", () => {
    expect(settle(ev, "DC+O/U 1.5", "1X+Over", 1.5, "calcio")).toBe("won");
  });
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Implement combo module**

```typescript
// lib/settlement/combo-settlers.ts
import type { SettlementResult } from "../settlement";

export type Verdict = "won" | "lost" | "void" | "push";
type SingleSettler = (sr: SettlementResult, line?: number) => Verdict | null;

// Primitive settlers (pure, stateless — extracted from main settlement for reuse)
export function settle1X2(sr: SettlementResult, side: "1" | "X" | "2"): Verdict {
  if (sr.home > sr.away) return side === "1" ? "won" : "lost";
  if (sr.home < sr.away) return side === "2" ? "won" : "lost";
  return side === "X" ? "won" : "lost";
}

export function settleGG(sr: SettlementResult, gg: boolean): Verdict {
  const both = sr.home > 0 && sr.away > 0;
  return (gg === both) ? "won" : "lost";
}

export function settleOU(sr: SettlementResult, line: number, over: boolean): Verdict {
  const t = sr.total;
  if (t === line) return "push";
  return (over ? t > line : t < line) ? "won" : "lost";
}

export function settleDC(sr: SettlementResult, side: "1X" | "12" | "X2"): Verdict {
  const home = sr.home > sr.away, draw = sr.home === sr.away, away = sr.home < sr.away;
  if (side === "1X") return home || draw ? "won" : "lost";
  if (side === "12") return home || away ? "won" : "lost";
  if (side === "X2") return draw || away ? "won" : "lost";
  return "lost";
}

// Combo: AND verdicts — won only if both legs won
export function comboAND(...verdicts: Verdict[]): Verdict {
  if (verdicts.some((v) => v === "lost")) return "lost";
  if (verdicts.every((v) => v === "won")) return "won";
  if (verdicts.some((v) => v === "push")) return "push"; // push propagates if no loss
  return "void";
}

// 1X2+GG combo: outcome like "1+GG" / "X+NG" / "2+GG" / "2+NG"
export function settle1X2PlusGG(sr: SettlementResult, outcomeName: string): Verdict | null {
  const m = outcomeName.match(/^(1|X|2)\+(GG|NG)$/i);
  if (!m) return null;
  const side = m[1].toUpperCase() as "1" | "X" | "2";
  const gg = m[2].toUpperCase() === "GG";
  return comboAND(settle1X2(sr, side), settleGG(sr, gg));
}

// 1X2+O/U combo: outcome like "1+Over" / "X+Under" / "2+Over"
export function settle1X2PlusOU(sr: SettlementResult, outcomeName: string, line: number): Verdict | null {
  const m = outcomeName.match(/^(1|X|2)\+(Over|Under)$/i);
  if (!m) return null;
  const side = m[1].toUpperCase() as "1" | "X" | "2";
  const over = m[2].toLowerCase() === "over";
  return comboAND(settle1X2(sr, side), settleOU(sr, line, over));
}

// DC+O/U combo: outcome like "1X+Over" / "12+Under" / "X2+Over"
export function settleDCPlusOU(sr: SettlementResult, outcomeName: string, line: number): Verdict | null {
  const m = outcomeName.match(/^(1X|12|X2)\+(Over|Under)$/i);
  if (!m) return null;
  const side = m[1].toUpperCase() as "1X" | "12" | "X2";
  const over = m[2].toLowerCase() === "over";
  return comboAND(settleDC(sr, side), settleOU(sr, line, over));
}
```

Register in `lib/settlement.ts`:

```typescript
import {
  settle1X2PlusGG,
  settle1X2PlusOU,
  settleDCPlusOU,
} from "@/lib/settlement/combo-settlers";

SETTLERS["1X2_PLUS_GG"] = (sr, outcomeName) => settle1X2PlusGG(sr, outcomeName);
SETTLERS["1X2_PLUS_OU"] = (sr, outcomeName, line) => line != null ? settle1X2PlusOU(sr, outcomeName, line) : null;
SETTLERS["DC_PLUS_OU"] = (sr, outcomeName, line) => line != null ? settleDCPlusOU(sr, outcomeName, line) : null;

  // Patterns (MARKET_PATTERNS — after core 1X2 so 1X2 wins for bare outcomes)
  { pattern: /^1X2\s*\+\s*GG$/i, key: "1X2_PLUS_GG" },
  { pattern: /^1X2\s*\+\s*Gol\/No\s*Gol$/i, key: "1X2_PLUS_GG" },
  { pattern: /^1X2\s*\+\s*O\/U\s+([\d.]+)$/i, key: "1X2_PLUS_OU", lineGroup: 1 },
  { pattern: /^1X2\s*\+\s*Under\/Over\s+([\d.]+)$/i, key: "1X2_PLUS_OU", lineGroup: 1 },
  { pattern: /^DC\s*\+\s*O\/U\s+([\d.]+)$/i, key: "DC_PLUS_OU", lineGroup: 1 },
```

- [ ] **Step 4: Run → pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(settlement): exotic combos 1X2+GG, 1X2+O/U, DC+O/U (Family C)"
```

### Task 3.2: Vincente+GG variant (Kambi-style naming)

**Target:** `Vincente+entrambe segnano` equivalent to `1X2+GG` but with different outcome labels. Example outcomes: `"Casa+Sì"`, `"Pareggio+No"`, `"Ospite+Sì"`.

- [ ] **Step 1-5: Test → implement → commit**

Expand the regex in `settle1X2PlusGG` to accept Italian labels:

```typescript
export function settle1X2PlusGG(sr: SettlementResult, outcomeName: string): Verdict | null {
  // Match "1+GG" / "X+NG" / "Casa+Sì" / "Pareggio+No" / "Ospite+No"
  const m = outcomeName.match(/^(1|X|2|Casa|Pareggio|Ospite)\s*\+\s*(GG|NG|S[iì]|No)$/i);
  if (!m) return null;
  const sideRaw = m[1].toLowerCase();
  const side = sideRaw === "1" || sideRaw === "casa" ? "1"
             : sideRaw === "2" || sideRaw === "ospite" ? "2"
             : "X";
  const ggRaw = m[2].toLowerCase();
  const gg = ggRaw === "gg" || ggRaw === "sì" || ggRaw === "si";
  return comboAND(settle1X2(sr, side as "1"|"X"|"2"), settleGG(sr, gg));
}
```

Add pattern:

```typescript
  { pattern: /^Vincente\s*\+\s*Entrambe\s+Segnano$/i, key: "1X2_PLUS_GG" },
```

```bash
git commit -m "feat(settlement): Vincente+GG Italian naming variant"
```

### Task 3.3: Deploy + canary

Same as 1.6/2.5 — canary on staging, check `void` rate, promote.

---

## Phase 4 — Stream 4: Kambi live multi-operator betOffer merge

**Goal:** Fix the finding from Q3 probe — `live-loop.ts` pins each event to first-seen operator. Change to fetch betOffers from ALL operators that saw the event and merge by `(criterion.id, outcomes signature)`.

**Repo:** `C:/Users/philp/Downloads/kambi-scraper/` (separate git repo)

**Expected uplift:** +40-60% live markets per event. Zero new data source.

### Task 4.1: Probe-based baseline measurement

- [ ] **Step 1:** Run `scripts/probe-kambi-live.ts` during peak hours (UTC 17-22, when top-league matches are live). Save output to `docs/superpowers/notes/2026-04-24-kambi-live-operator-merge-finding.md` with the measured uplift numbers for 5 top matches.

### Task 4.2: Write failing test in kambi-scraper

**Files:**
- In `kambi-scraper/`: Create `tests/live-merge.test.ts`
- Modify: `kambi-scraper/src/live-loop.ts`

(Note: kambi-scraper test framework TBD — check `package.json`. If no framework, add `vitest` and `npm test` script first as a one-commit prereq.)

- [ ] **Step 1: Write test** — mock `getLiveEvents` and `getEventBetOffers` to simulate 2 operators seeing the same event, each with a different betOffer set. Assert merged output has union of unique (criterion.id, outcomes[0].id) tuples.

- [ ] **Step 2-5: Implement merge logic**

In `kambi-scraper/src/live-loop.ts`, change Step 2 of `runLiveCycle`:

**Before** (current behavior — pin to first operator):
```typescript
for (const op of operators) {
  // ... if event not yet seen, add it and pin operator
}
// Then fetchDetailsBatch uses eventOperatorMap (single operator per event)
```

**After** (multi-operator merge):
```typescript
const eventSeenByOps = new Map<number, string[]>(); // eventId → [op1, op2, ...]

for (const op of operators) {
  const liveResp = await getLiveEvents(op);
  if (!liveResp?.liveEvents) continue;
  for (const entry of liveResp.liveEvents) {
    if (!mergedEntries.has(entry.event.id)) mergedEntries.set(entry.event.id, entry);
    const existing = eventSeenByOps.get(entry.event.id) || [];
    existing.push(op);
    eventSeenByOps.set(entry.event.id, existing);
  }
}

// Then fetch betOffers from ALL operators that saw each event
async function fetchDetailsMultiOp(
  eventIds: number[],
  eventSeenByOps: Map<number, string[]>
): Promise<Map<number, KambiBetOffer[]>> {
  const results = new Map<number, KambiBetOffer[]>();
  for (let i = 0; i < eventIds.length; i += DETAIL_CONCURRENCY) {
    const batch = eventIds.slice(i, i + DETAIL_CONCURRENCY);
    const promises = batch.map(async (id) => {
      const ops = eventSeenByOps.get(id) || [DEFAULT_OPERATOR];
      const merged = new Map<string, KambiBetOffer>();
      for (const op of ops) {
        const resp = await getEventBetOffers(id, op);
        if (!resp?.betOffers) continue;
        for (const bo of resp.betOffers) {
          // Dedup key: criterion + outcome signature (ordered ids)
          const outcomeSig = (bo.outcomes || []).map((o) => o.id).sort().join(",");
          const key = `${bo.criterion.id}:${outcomeSig}`;
          if (!merged.has(key)) merged.set(key, bo);
          // Tie-break: prefer betOffer with more outcomes
          else if ((bo.outcomes?.length || 0) > (merged.get(key)!.outcomes?.length || 0)) {
            merged.set(key, bo);
          }
        }
      }
      if (merged.size > 0) results.set(id, [...merged.values()]);
    });
    await Promise.all(promises);
    if (i + DETAIL_CONCURRENCY < eventIds.length) await sleep(DETAIL_BATCH_DELAY);
  }
  return results;
}
```

- [ ] **Step 3: Run tests → pass**

- [ ] **Step 4: Deploy on staging-vps first**

```bash
# On staging-vps
cd /opt/kambi-scraper-staging
git pull
npm run build
systemctl restart kambi-scraper-staging.service
```

- [ ] **Step 5: Measure uplift**

Query on staging DB:

```sql
SELECT
  DATE_TRUNC('hour', created_at) AS hour,
  COUNT(*) AS markets,
  COUNT(DISTINCT event_id) AS events,
  COUNT(*)::float / NULLIF(COUNT(DISTINCT event_id), 0) AS avg_markets_per_event
FROM markets
WHERE event_id IN (SELECT id FROM events WHERE status = 'live')
  AND created_at > NOW() - INTERVAL '2 hours'
GROUP BY 1 ORDER BY 1 DESC;
```

Compare to baseline (prod): expected ~+40-60% markets/event.

- [ ] **Step 6: Deploy to prod scraper-vps**

```bash
# On scraper-vps
cd /opt/kambi-scraper
git pull
npm run build
systemctl restart kambi-scraper.service
```

- [ ] **Step 7: Commit (in kambi-scraper repo)**

```bash
git commit -m "feat(live): multi-operator betOffer merge for +40-60% market surface"
```

### Task 4.3: Add unibet rate-limit handling

**Discovery from probe:** unibet returned 429 repeatedly. Merge logic should tolerate missing operator responses gracefully (already does — `if (!resp?.betOffers) continue`). But we should add a circuit breaker so unibet doesn't add latency on every cycle when it's consistently rate-limited.

- [ ] **Step 1: Track failure rate per operator** — keep a rolling window `Map<operator, {failures: number, total: number, cooldownUntil?: Date}>`. If failure rate > 50% over last 10 calls, skip operator for next 5 minutes.

- [ ] **Step 2-5: Implement + test + commit**

---

## Phase 5 — Player-side: expose merged Kambi+22bet markets

**Goal:** Surface 22bet-exclusive markets to the bettor in `/api/sportsbook` responses, with routing info so bet placement knows which source the outcome came from.

**Prereq:** Phases 0-3 shipped (settlement can handle 22bet names).

### Task 5.1: Add `source` column to `bet_selections`

**Files:**
- Create: `supabase/migrations/104_bet_selections_source.sql`

- [ ] **Step 1: Write migration**

```sql
-- 104_bet_selections_source.sql
-- Track which sportsbook source (kambi|22bet|consensus) a selection came from
-- so settlement and bet-placement flows can route correctly.

ALTER TABLE bet_selections
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'kambi'
  CHECK (source IN ('kambi', '22bet', 'betfair', 'consensus'));

CREATE INDEX IF NOT EXISTS idx_bet_selections_source ON bet_selections(source);

COMMENT ON COLUMN bet_selections.source IS
  'Sportsbook source for this selection. Used by settlement to dispatch name-pattern matching (kambi vs 22bet naming differs).';
```

- [ ] **Step 2: Apply to staging DB**

```bash
# Using deploy script or Supabase dashboard
npx supabase db push --db-url "$STAGING_DB_URL"
```

Verify:

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'bet_selections' AND column_name = 'source';
```

- [ ] **Step 3: Apply to prod DB (after staging 24h green)**

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/104_bet_selections_source.sql
git commit -m "feat(db): add bet_selections.source for multi-source routing"
```

### Task 5.2: Merge Kambi+22bet markets in `/api/sportsbook`

**Files:**
- Modify: `app/api/sportsbook/route.ts`
- Create: `tests/api/sportsbook-merge.test.ts`

- [ ] **Step 1: Read current /api/sportsbook** — it filters by `NEXT_PUBLIC_SCRAPER_SOURCE` env. Change to return markets from ALL sources for events that have a matched `flashscore_id`.

- [ ] **Step 2: Write failing test** — fixture with 1 kambi event (id=A), 1 22bet event with same flashscore_id (id=B), different market sets. Assert merged response has 1 event with UNION of markets, Kambi-origin markets labeled `source:"kambi"` and 22bet-only markets labeled `source:"22bet"`.

- [ ] **Step 3: Implement merge logic**

```typescript
// Pseudocode:
// 1. Query events: all kambi events AND all 22bet events with non-null flashscore_id in date window
// 2. Group by flashscore_id into clusters
// 3. For each cluster: pick Kambi event as "primary" (for settlement continuity), attach all markets+outcomes from all events, tagged with source
// 4. Deduplicate markets across sources by (canonical_market, line)
// 5. When duplicate: prefer Kambi outcome (for settlement), but include 22bet outcome only if Kambi doesn't have that (market_type, line) tuple
```

- [ ] **Step 4: Run test → pass**

- [ ] **Step 5: Smoke test on staging**

Visit a merged event in `/sport/{eventId}` UI and confirm 22bet-exclusive markets appear.

- [ ] **Step 6: Commit**

```bash
git add app/api/sportsbook/route.ts tests/api/sportsbook-merge.test.ts
git commit -m "feat(api): merge Kambi+22bet markets in sportsbook response"
```

### Task 5.3: Route bet placement to source-aware settlement

**Files:**
- Modify: `app/api/bet/place/route.ts` — populate `bet_selections.source` from outcome's source tag
- Modify: `lib/settlement.ts` — settler dispatch may differ by source (not immediately, but stub the hook)

- [ ] **Step 1-5: Test → implement → commit**

For now, both kambi and 22bet names are handled by the same unified `MARKET_PATTERNS` list (patterns accept both sources' naming). No conditional dispatch needed yet. But PERSIST `source` so future divergence is supported without a DB migration.

### Task 5.4: Deploy player-side + canary

48h on staging minimum (per spec rollout plan). Monitor:
- `void` rate doesn't spike on `22bet`-source selections
- User-visible market count per event increases (spot-check 10 matches)
- No schema cache errors

### Task 5.5: Prod rollout

```bash
git checkout master && git merge staging && git push
```

---

## Post-rollout: decommission unused VOID_PATTERNS

After 7 days in prod with the new settlers working, remove now-obsolete VOID_PATTERNS entries that Family A/B/C settlers cover. This is cleanup, not urgent — track in `todo-family-abc-void-cleanup.md`.

---

## Open questions answered by probe (recap)

1. ✅ **`shots_home/away` in flashscore feed?** Yes — `Partita/1 Tempo/2 Tempo: Tiri totali` + `Tiri in porta` + `Tiri fuori` per team.
2. ✅ **HT cards per team?** Yes — `1 Tempo: Cartellini gialli` / `Cartellini rossi` (when present).
3. ✅ **Alternate Kambi live endpoint?** No — but discovered multi-operator betOffer merge opportunity (+40-60% markets, Phase 4).
4. ⏸ **Betfair Exchange as 3rd source for live?** Deferred — Phase 4 merge may close the gap enough to skip.

## Non-goals preserved from spec

- Player props (per-player stats) — out of scope, need Opta feed
- Minute-timeline markets (first corner minute, etc.) — out of scope
- Live long-tail to 200 mkt/ev — not feasible; Kambi suspends for risk
- Settlement source-of-truth change — Kambi remains primary

## References

- Spec: `docs/superpowers/specs/2026-04-24-kambi-22bet-integration-design.md`
- Settlement engine: `lib/settlement.ts` (VOID_PATTERNS:167, MARKET_PATTERNS:314, SETTLERS:778)
- Flashscore client: `lib/flashscore.ts` (`fetchMatchDetail`:583)
- Verify cron: `app/api/cron/verify-results/route.ts:240-310`
- Kambi scraper: `C:/Users/philp/Downloads/kambi-scraper/src/live-loop.ts`
- 22bet scraper: `C:/Users/philp/Downloads/22bet-scraper/src/transform.ts`
- Consensus flashscore_id pivot: migration 086 `v_consensus_latest`
- Probe scripts: `scripts/probe-flashscore-stats.ts`, `scripts/probe-kambi-live.ts`

## Rollout sequencing summary

```
Phase 0 (foundation)     ─┐
Phase 1 (Family A)       ─┤── can ship incrementally, each phase is a PR
Phase 2 (Family B)       ─┤
Phase 3 (Family C)       ─┤
Phase 4 (live merge)     ─┘ (kambi-scraper repo, parallel to others)

Phase 5 (player merge)   ← 48h after Phase 3 in prod
```

Estimated calendar time: **~5-7 working days** end-to-end if each phase canaries 24h on staging before prod promote.
