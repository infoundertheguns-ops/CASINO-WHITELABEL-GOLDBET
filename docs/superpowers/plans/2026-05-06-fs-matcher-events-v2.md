# FS Matcher → events_v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repoint the FS push-to-vincitu matcher (`app/api/flashscore/live/route.ts`) from legacy `events` (dead since 2026-04-28 post Plan D S6) to `events_v2`, restoring period/minute/live_data flow into `v_player_events` for the kiosk live Scoreboard.

**Architecture:** Two-phase migration. Phase A: ALTER TABLE adds period/minute/live_data to events_v2 (additive, idempotent). Phase B: route.ts switches read+write from events to events_v2 with a small TS slug helper (IT→EN). Phase C: drop the legacy LATERAL JOIN in v_player_events.

**Tech Stack:** Next.js 15 (admin), Supabase JS client, vitest (`tests/**/*.test.ts`), postgres migrations under `supabase/migrations/`, systemd `betssolution-admin` service.

**Spec:** `docs/superpowers/specs/2026-05-06-fs-matcher-events-v2-design.md`

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `supabase/migrations/177_events_v2_live_columns.sql` | Create | additive ALTER TABLE for period/minute/live_data |
| `lib/sport-slug-it-to-en.ts` | Create | TS-side IT→EN slug map (mirror of `_sport_slug_en_to_it`) |
| `tests/lib/sport-slug-it-to-en.test.ts` | Create | unit tests for slug map |
| `app/api/flashscore/live/route.ts` | Modify | swap query/update target events→events_v2, integrate slug helper, extend stats response |
| `app/api/flashscore/live/_lib.ts` | Create | extract pure helper(s) (`buildUpdate`, `matchEventsToFs`) for unit testability — mirrors pattern in `app/api/flashscore/results/_lib.ts` |
| `tests/api/flashscore/live-matcher.test.ts` | Create | unit tests on extracted helpers |
| `supabase/migrations/178_v_player_events_drop_legacy_join.sql` | Create | drop legacy events LATERAL JOIN, read live fields from events_v2 |

---

## Task 0: Commit dangling mig 176 + spec + plan

**Files:**
- Stage: `supabase/migrations/176_v_player_events_live_data_join.sql`, `docs/superpowers/specs/2026-05-06-fs-matcher-events-v2-design.md`, `docs/superpowers/plans/2026-05-06-fs-matcher-events-v2.md`

- [ ] **Step 1: Commit untracked mig 176**

```bash
git add supabase/migrations/176_v_player_events_live_data_join.sql
git commit -m "feat(db): mig 176 — v_player_events JOIN legacy events on flashscore_id (deployed 2026-05-06)"
```

- [ ] **Step 2: Commit spec + plan**

```bash
git add docs/superpowers/specs/2026-05-06-fs-matcher-events-v2-design.md \
        docs/superpowers/plans/2026-05-06-fs-matcher-events-v2.md
git commit -m "docs(spec+plan): FS matcher → events_v2 (T10)"
```

---

## Task 1: Mig 177 — additive ALTER events_v2

**Files:**
- Create: `supabase/migrations/177_events_v2_live_columns.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- Migration 177 — events_v2 live columns (period, minute, live_data)
--
-- Context:
--   Plan D S6 cutover moved live event ingestion to events_v2, but the
--   table never had columns for FS-scraper-supplied period / minute /
--   live_data (halfScores, stats.clock). The FS push-to-vincitu matcher
--   (mig 178 follow-up) needs these columns to write live UX state.
--
-- Behaviour:
--   Pure additive ALTER, three nullable columns. Zero impact on existing
--   readers/writers. Mig 176's LATERAL JOIN against legacy events still
--   functions identically; only adds new write target for mig 178 cutover.
--
-- Rollback:
--   ALTER TABLE events_v2
--     DROP COLUMN IF EXISTS period,
--     DROP COLUMN IF EXISTS minute,
--     DROP COLUMN IF EXISTS live_data;

BEGIN;

ALTER TABLE events_v2
  ADD COLUMN IF NOT EXISTS period    text,
  ADD COLUMN IF NOT EXISTS minute    int,
  ADD COLUMN IF NOT EXISTS live_data jsonb;

COMMENT ON COLUMN events_v2.period    IS 'Live period label (e.g. "2T", "Set 3"). Populated by FS-scraper push matcher.';
COMMENT ON COLUMN events_v2.minute    IS 'Live minute (football). NULL for non-football sports.';
COMMENT ON COLUMN events_v2.live_data IS 'Live merged state (halfScoreHome/Away, stats.clock, ...). Populated by FS-scraper push matcher.';

INSERT INTO _migrations (name, applied_at)
VALUES ('177_events_v2_live_columns', now())
ON CONFLICT (name) DO NOTHING;

COMMIT;
```

- [ ] **Step 2: Apply to prod**

```bash
set -a; source services/odds-api-ingester/.env; set +a
psql "$DATABASE_URL" -f supabase/migrations/177_events_v2_live_columns.sql
```

Expected: `BEGIN`, `ALTER TABLE`, `COMMENT` × 3, `INSERT 0 1`, `COMMIT`.

- [ ] **Step 3: Verify columns exist**

```bash
psql "$DATABASE_URL" -c "\d events_v2" | grep -E '(period|minute|live_data)'
```

Expected: three rows, all `nullable`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/177_events_v2_live_columns.sql
git commit -m "feat(db): mig 177 — ALTER events_v2 ADD period/minute/live_data (additive)"
```

---

## Task 2: TS slug helper IT→EN (TDD)

**Files:**
- Create: `lib/sport-slug-it-to-en.ts`
- Test: `tests/lib/sport-slug-it-to-en.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/lib/sport-slug-it-to-en.test.ts
import { describe, it, expect } from "vitest";
import { getSportSlugsEn } from "@/lib/sport-slug-it-to-en";

describe("getSportSlugsEn", () => {
  it("maps calcio → ['football']", () => {
    expect(getSportSlugsEn("calcio")).toEqual(["football"]);
  });

  it("maps basket → ['basketball']", () => {
    expect(getSportSlugsEn("basket")).toEqual(["basketball"]);
  });

  it("maps both 'hockey ghiaccio' (space) and 'hockey-ghiaccio' (kebab) → ['ice-hockey']", () => {
    expect(getSportSlugsEn("hockey ghiaccio")).toEqual(["ice-hockey"]);
    expect(getSportSlugsEn("hockey-ghiaccio")).toEqual(["ice-hockey"]);
  });

  it("maps boxe and pugilato (aliases) → ['boxing']", () => {
    expect(getSportSlugsEn("boxe")).toEqual(["boxing"]);
    expect(getSportSlugsEn("pugilato")).toEqual(["boxing"]);
  });

  it("maps mma and 'arti marziali' → ['mma']", () => {
    expect(getSportSlugsEn("mma")).toEqual(["mma"]);
    expect(getSportSlugsEn("arti marziali")).toEqual(["mma"]);
    expect(getSportSlugsEn("arti-marziali")).toEqual(["mma"]);
  });

  it("maps freccette → ['darts']", () => {
    expect(getSportSlugsEn("freccette")).toEqual(["darts"]);
  });

  it("maps 'football americano' / 'football-americano' → ['american-football']", () => {
    expect(getSportSlugsEn("football americano")).toEqual(["american-football"]);
    expect(getSportSlugsEn("football-americano")).toEqual(["american-football"]);
  });

  it("maps esports aliases → ['esports']", () => {
    expect(getSportSlugsEn("esports")).toEqual(["esports"]);
    expect(getSportSlugsEn("counter_strike")).toEqual(["esports"]);
    expect(getSportSlugsEn("league of legends")).toEqual(["esports"]);
    expect(getSportSlugsEn("valorant")).toEqual(["esports"]);
    expect(getSportSlugsEn("dota 2")).toEqual(["esports"]);
    expect(getSportSlugsEn("dota")).toEqual(["esports"]);
  });

  it("returns [] for sports not in events_v2 (no odds-api ingestion)", () => {
    // FS-scraper SPORT_MAP keys with no events_v2.sport_slug equivalent.
    // Caller short-circuits with reason='unknown_sport' → 0 matched, no error.
    expect(getSportSlugsEn("australian rules")).toEqual([]);
    expect(getSportSlugsEn("rugby league")).toEqual([]);
    expect(getSportSlugsEn("badminton")).toEqual([]);
    expect(getSportSlugsEn("golf")).toEqual([]);
    expect(getSportSlugsEn("tennis tavolo")).toEqual([]);
    expect(getSportSlugsEn("automobilismo")).toEqual([]);
    expect(getSportSlugsEn("formula 1")).toEqual([]);
    expect(getSportSlugsEn("ciclismo")).toEqual([]);
    expect(getSportSlugsEn("quidditch")).toEqual([]); // truly unknown
  });

  it("is case-insensitive", () => {
    expect(getSportSlugsEn("CALCIO")).toEqual(["football"]);
    expect(getSportSlugsEn("Tennis")).toEqual(["tennis"]);
  });

  it("trims whitespace", () => {
    expect(getSportSlugsEn("  calcio  ")).toEqual(["football"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/lib/sport-slug-it-to-en.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement helper**

```ts
// lib/sport-slug-it-to-en.ts
//
// Mirror (inverse) of postgres _sport_slug_en_to_it (mig 175).
// Used by /api/flashscore/live to translate the FS-scraper-supplied
// Italian sport name to events_v2.sport_slug (English).
//
// Returns array because Italian aliases collapse to a single English slug
// (e.g. "boxe" / "pugilato" → "boxing"). Returns [] for unknown sports.

// Coverage = full intersection of FS-scraper SPORT_MAP keys (lib/flashscore.ts)
// AND events_v2.sport_slug values (15 distinct slugs as of 2026-05-06).
// IT keys not present here (australian rules, rugby league, badminton, golf,
// tennis tavolo, automobilismo / formula 1 / ..., ciclismo) have no odds-api
// equivalent in events_v2 → caller returns reason='unknown_sport'.
const IT_TO_EN: Record<string, string> = {
  // football family
  "calcio":              "football",
  // basketball
  "basket":              "basketball",
  // handball
  "pallamano":           "handball",
  // volleyball
  "volley":              "volleyball",
  // ice hockey (both space and kebab forms)
  "hockey ghiaccio":     "ice-hockey",
  "hockey-ghiaccio":     "ice-hockey",
  // tennis
  "tennis":              "tennis",
  // baseball
  "baseball":            "baseball",
  // rugby
  "rugby":               "rugby",
  // cricket
  "cricket":             "cricket",
  // american football (both space and kebab forms)
  "football americano":  "american-football",
  "football-americano":  "american-football",
  // darts
  "freccette":           "darts",
  // boxing (boxe + alias pugilato)
  "boxe":                "boxing",
  "pugilato":            "boxing",
  // mma (mma + alias arti marziali, both space and kebab)
  "mma":                 "mma",
  "arti marziali":       "mma",
  "arti-marziali":       "mma",
  // snooker
  "snooker":             "snooker",
  // esports umbrella (FS-scraper sends specific game names; odds-api collapses to esports)
  "esports":             "esports",
  "counter_strike":      "esports",
  "league of legends":   "esports",
  "valorant":            "esports",
  "dota 2":              "esports",
  "dota":                "esports",
};

export function getSportSlugsEn(sportIt: string): string[] {
  const norm = sportIt.trim().toLowerCase();
  const en = IT_TO_EN[norm];
  return en ? [en] : [];
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/lib/sport-slug-it-to-en.test.ts
```

Expected: PASS — 10/10.

- [ ] **Step 5: Commit**

```bash
git add lib/sport-slug-it-to-en.ts tests/lib/sport-slug-it-to-en.test.ts
git commit -m "feat(lib): IT→EN sport slug helper (mirror postgres _sport_slug_en_to_it)"
```

---

## Task 3: Extract pure helpers from route.ts (TDD)

**Files:**
- Create: `app/api/flashscore/live/_lib.ts`
- Test: `tests/api/flashscore/live-matcher.test.ts`

The current route.ts has two pieces of logic worth extracting:
1. `applyEnrichment` (already a function — make it pure by removing the supabase update side-effect, return `{ update: Record<string, unknown> | null, didUpdate: boolean }`)
2. `findFuzzyMatch` (currently inlined in the loop) — given `(ev, fsCandidates, usedFs)` returns `{ idx, score }`

- [ ] **Step 1: Write failing tests**

```ts
// tests/api/flashscore/live-matcher.test.ts
import { describe, it, expect } from "vitest";
import { computeEnrichmentUpdate, findFuzzyMatch } from "@/app/api/flashscore/live/_lib";
import type { FlashscoreLive } from "@/lib/flashscore";

const baseEv = {
  id: "evt-1",
  home: "Inter",
  away: "Milan",
  score_home: null,
  score_away: null,
  starts_at: "2026-05-06T20:00:00Z",
  period: null,
  minute: null,
  live_data: null,
  flashscore_id: null,
};

const baseFs: FlashscoreLive = {
  matchId: "fs-1",
  homeTeam: "Inter",
  awayTeam: "Milan",
  scoreHome: 1,
  scoreAway: 0,
  periods: [[1, 0]],
  timestamp: 0,
  stageCode: "2",
};

describe("computeEnrichmentUpdate", () => {
  it("returns null update when nothing has changed", () => {
    const { update } = computeEnrichmentUpdate({
      ev: { ...baseEv, score_home: 1, score_away: 0, period: "1T", live_data: { halfScoreHome: [1], halfScoreAway: [0] } },
      fs: baseFs,
      sport: "calcio",
    });
    expect(update).toBeNull();
  });

  it("sets period from periods.length when DB has none", () => {
    const { update } = computeEnrichmentUpdate({
      ev: baseEv,
      fs: { ...baseFs, periods: [[1, 0]] },
      sport: "calcio",
    });
    expect(update?.period).toBe("1T");
  });

  it("merges halfScoreHome/Away into live_data", () => {
    const { update } = computeEnrichmentUpdate({
      ev: baseEv,
      fs: { ...baseFs, periods: [[1, 0], [2, 1]] },
      sport: "calcio",
    });
    const ld = update?.live_data as Record<string, unknown>;
    expect(ld.halfScoreHome).toEqual([1, 2]);
    expect(ld.halfScoreAway).toEqual([0, 1]);
  });

  it("preserves existing live_data keys not touched by FS", () => {
    const { update } = computeEnrichmentUpdate({
      ev: { ...baseEv, live_data: { stats: [{ name: "Corners", home: 5, away: 3 }] } },
      fs: { ...baseFs, periods: [[1, 0]] },
      sport: "calcio",
    });
    const ld = update?.live_data as Record<string, unknown>;
    expect(ld.stats).toEqual([{ name: "Corners", home: 5, away: 3 }]);
    expect(ld.halfScoreHome).toEqual([1]);
  });

  it("overwrites score when DB null", () => {
    const { update } = computeEnrichmentUpdate({
      ev: baseEv,
      fs: { ...baseFs, scoreHome: 2, scoreAway: 1 },
      sport: "calcio",
    });
    expect(update?.score_home).toBe(2);
    expect(update?.score_away).toBe(1);
  });

  it("does NOT overwrite score when DB already has values (non-tennis)", () => {
    const { update } = computeEnrichmentUpdate({
      ev: { ...baseEv, score_home: 3, score_away: 2 },
      fs: { ...baseFs, scoreHome: 9, scoreAway: 9 },
      sport: "calcio",
    });
    expect(update?.score_home).toBeUndefined();
    expect(update?.score_away).toBeUndefined();
  });

  it("DOES overwrite tennis score when DB looks like game-points (>=15)", () => {
    const { update } = computeEnrichmentUpdate({
      ev: { ...baseEv, score_home: 30, score_away: 15 },
      fs: { ...baseFs, scoreHome: 1, scoreAway: 0 },
      sport: "tennis",
    });
    expect(update?.score_home).toBe(1);
    expect(update?.score_away).toBe(0);
  });

  it("derives Frame N for snooker from score sum", () => {
    const { update } = computeEnrichmentUpdate({
      ev: baseEv,
      fs: { ...baseFs, periods: [], scoreHome: 2, scoreAway: 1 },
      sport: "snooker",
    });
    expect(update?.period).toBe("Frame 4");
  });

  it("derives Leg N for darts from score sum", () => {
    const { update } = computeEnrichmentUpdate({
      ev: baseEv,
      fs: { ...baseFs, periods: [], scoreHome: 1, scoreAway: 2 },
      sport: "freccette",
    });
    expect(update?.period).toBe("Leg 4");
  });
});

describe("findFuzzyMatch", () => {
  const liveCandidates: FlashscoreLive[] = [
    { ...baseFs, matchId: "fs-a", homeTeam: "Inter Milano", awayTeam: "AC Milan", timestamp: new Date(baseEv.starts_at).getTime() / 1000 },
    { ...baseFs, matchId: "fs-b", homeTeam: "Roma", awayTeam: "Lazio", timestamp: new Date(baseEv.starts_at).getTime() / 1000 },
  ];

  it("returns best-scoring fuzzy match within window", () => {
    const result = findFuzzyMatch(baseEv, liveCandidates, new Set());
    expect(result.idx).toBe(0);
    expect(result.score).toBeGreaterThan(1.0);
  });

  it("skips already-used candidates", () => {
    const result = findFuzzyMatch(baseEv, liveCandidates, new Set([0]));
    expect(result.idx).toBe(-1);
  });

  it("rejects matches outside ±4h window", () => {
    const farPast = liveCandidates.map((c) => ({ ...c, timestamp: 0 }));
    const result = findFuzzyMatch(baseEv, farPast, new Set());
    expect(result.idx).toBe(-1);
  });

  it("rejects when team-name score below threshold", () => {
    const wrong = [{ ...baseFs, matchId: "fs-c", homeTeam: "Bayern", awayTeam: "Dortmund", timestamp: new Date(baseEv.starts_at).getTime() / 1000 }];
    const result = findFuzzyMatch(baseEv, wrong, new Set());
    expect(result.idx).toBe(-1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/api/flashscore/live-matcher.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `_lib.ts`**

```ts
// app/api/flashscore/live/_lib.ts
//
// Pure helpers extracted from route.ts for unit testability.
// No supabase / fetch / NextResponse — only data transforms.

import type { FlashscoreLive } from "@/lib/flashscore";
import { derivePeriodLabel, teamMatchScore } from "@/lib/flashscore";

export interface V2LiveEvent {
  id: string;
  home: string;
  away: string;
  score_home: number | null;
  score_away: number | null;
  starts_at: string;
  period: string | null;
  minute: number | null;
  live_data: Record<string, unknown> | null;
  flashscore_id: string | null;
}

export function computeEnrichmentUpdate(args: {
  ev: V2LiveEvent;
  fs: FlashscoreLive;
  sport: string;
}): { update: Record<string, unknown> | null } {
  const { ev, fs, sport } = args;
  const update: Record<string, unknown> = {};

  // period label
  let derivedPeriod = derivePeriodLabel(sport, fs.periods.length);
  if (!derivedPeriod) {
    const s = sport.toLowerCase();
    const homeS = fs.scoreHome ?? ev.score_home ?? 0;
    const awayS = fs.scoreAway ?? ev.score_away ?? 0;
    const unitIdx = homeS + awayS + 1;
    if (unitIdx > 0) {
      if (s === "snooker") derivedPeriod = `Frame ${unitIdx}`;
      else if (s === "freccette" || s === "darts") derivedPeriod = `Leg ${unitIdx}`;
    }
  }
  if (derivedPeriod && derivedPeriod !== ev.period) {
    update.period = derivedPeriod;
  }

  // live_data merge
  const halfScoreHome = fs.periods.map((p) => p[0]);
  const halfScoreAway = fs.periods.map((p) => p[1]);
  const existingLd = (ev.live_data || {}) as Record<string, unknown>;
  const mergedLd = { ...existingLd };
  let ldChanged = false;
  if (halfScoreHome.length > 0) {
    if (!arraysEqual(existingLd.halfScoreHome as number[] | undefined, halfScoreHome)) {
      mergedLd.halfScoreHome = halfScoreHome;
      ldChanged = true;
    }
    if (!arraysEqual(existingLd.halfScoreAway as number[] | undefined, halfScoreAway)) {
      mergedLd.halfScoreAway = halfScoreAway;
      ldChanged = true;
    }
  }
  if (ldChanged) update.live_data = mergedLd;

  // score overwrite
  const isTennisLike = ["tennis", "tennis_tavolo", "tennis tavolo", "volley", "volleyball", "badminton"]
    .includes(sport.toLowerCase());
  const upstreamLikelyWrong =
    isTennisLike && ev.score_home != null && (ev.score_home >= 15 || (ev.score_away ?? 0) >= 15);
  if (fs.scoreHome != null && fs.scoreAway != null) {
    if (ev.score_home == null || ev.score_away == null || upstreamLikelyWrong) {
      if (fs.scoreHome !== ev.score_home) update.score_home = fs.scoreHome;
      if (fs.scoreAway !== ev.score_away) update.score_away = fs.scoreAway;
    }
  }

  return { update: Object.keys(update).length === 0 ? null : update };
}

export function findFuzzyMatch(
  ev: V2LiveEvent,
  candidates: FlashscoreLive[],
  used: Set<number>,
): { idx: number; score: number } {
  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < candidates.length; i++) {
    if (used.has(i)) continue;
    const fs = candidates[i];
    if (fs.timestamp && ev.starts_at) {
      const dbTime = new Date(ev.starts_at).getTime() / 1000;
      if (Math.abs(dbTime - fs.timestamp) > 4 * 3600) continue;
    }
    const hs = teamMatchScore(ev.home, fs.homeTeam);
    const as = teamMatchScore(ev.away, fs.awayTeam);
    if (hs < 0.5 || as < 0.5) continue;
    const combined = hs + as;
    if (combined > bestScore) {
      bestScore = combined;
      bestIdx = i;
    }
  }
  if (bestScore <= 1.0) return { idx: -1, score: bestScore };
  return { idx: bestIdx, score: bestScore };
}

function arraysEqual(a: number[] | undefined, b: number[] | undefined): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/api/flashscore/live-matcher.test.ts
```

Expected: PASS — 13/13.

- [ ] **Step 5: Commit**

```bash
git add app/api/flashscore/live/_lib.ts tests/api/flashscore/live-matcher.test.ts
git commit -m "refactor(flashscore/live): extract pure helpers (computeEnrichmentUpdate, findFuzzyMatch) for unit tests"
```

---

## Task 4: Repoint route.ts to events_v2

**Files:**
- Modify: `app/api/flashscore/live/route.ts`

- [ ] **Step 1: Rewrite route.ts**

The diff is large enough to be worth a full rewrite. Key changes:
1. Drop `getSportGroup` import; add `getSportSlugsEn`
2. `DbLiveEvent` → `V2LiveEvent` (use type from `_lib.ts`)
3. Query: `.from("events_v2")` + `.in("sport_slug", slugsEn)` + drop `is_live`/`source`/`sports!inner`
4. Inline `applyEnrichment` body replaced with call to `computeEnrichmentUpdate(...)` from `_lib.ts`, then a direct supabase.from("events_v2").update(update).eq("id", ev.id)
5. Inline `findFuzzyMatch` body replaced with call to `_lib.ts` helper
6. Stats response: add `matched_direct`, `matched_fuzzy`
7. Persist `flashscore_id` writes to events_v2 not events
8. Short-circuit with `{matched: 0, reason: "unknown_sport"}` when `slugsEn.length === 0`

Full file content:

```ts
export const dynamic = "force-dynamic";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getSportSlugsEn } from "@/lib/sport-slug-it-to-en";
import type { FlashscoreLive } from "@/lib/flashscore";
import {
  computeEnrichmentUpdate,
  findFuzzyMatch,
  type V2LiveEvent,
} from "./_lib";

// ═══════════════════════════════════════════════════
// Flashscore Live Enrichment Endpoint (events_v2 path)
// Receives live events from flashscore-scraper live-loop
// Matches with events_v2 live rows and fills period /
// minute / live_data / score gaps from FS data.
// (Plan D S6 cutover: legacy `events` is no longer the
// live-event source; we read+write events_v2 directly.)
// ═══════════════════════════════════════════════════

interface V2RowFromDb extends V2LiveEvent {
  odds_api_id: number;
  sport_slug: string;
}

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-scraper-key");
  if (!key || key !== process.env.SCRAPER_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { live, sport } = body as { live: FlashscoreLive[]; sport: string };

  if (!live || !Array.isArray(live) || live.length === 0) {
    return NextResponse.json({ error: "No live events provided" }, { status: 400 });
  }

  const slugsEn = getSportSlugsEn(sport);
  if (slugsEn.length === 0) {
    return NextResponse.json({
      received: live.length,
      matched: 0,
      matched_direct: 0,
      matched_fuzzy: 0,
      updated: 0,
      errors: [],
      reason: "unknown_sport",
    });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const stats = {
    received: live.length,
    matched: 0,
    matched_direct: 0,
    matched_fuzzy: 0,
    updated: 0,
    errors: [] as string[],
  };

  const { data: eventsRaw, error: evErr } = await supabase
    .from("events_v2")
    .select(
      "id, odds_api_id, home, away, score_home, score_away, starts_at, period, minute, live_data, flashscore_id, sport_slug"
    )
    .eq("status", "live")
    .in("sport_slug", slugsEn)
    .limit(500);

  if (evErr || !eventsRaw) {
    return NextResponse.json({ ...stats, error: evErr?.message || "No live events" });
  }

  const events = eventsRaw as V2RowFromDb[];
  const liveById = new Map(live.map((l) => [l.matchId, l]));

  // Direct lookups via flashscore_id
  const directSet = new Set<string>();
  for (const ev of events) {
    if (!ev.flashscore_id) continue;
    const fs = liveById.get(ev.flashscore_id);
    if (!fs) continue;
    directSet.add(ev.id);
    try {
      const didUpdate = await applyAndPersist(supabase, ev, fs, sport);
      stats.matched++;
      stats.matched_direct++;
      if (didUpdate) stats.updated++;
    } catch (err) {
      stats.errors.push(`${ev.home}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Fuzzy fallback for the rest
  const fuzzyEvents = events.filter((ev) => !directSet.has(ev.id));
  const usedFs = new Set<number>();
  for (const ev of fuzzyEvents) {
    const { idx } = findFuzzyMatch(ev, live, usedFs);
    if (idx < 0) continue;
    usedFs.add(idx);
    const fs = live[idx];
    try {
      const didUpdate = await applyAndPersist(supabase, ev, fs, sport);
      stats.matched++;
      stats.matched_fuzzy++;
      if (didUpdate) stats.updated++;

      if (!ev.flashscore_id) {
        await supabase
          .from("events_v2")
          .update({ flashscore_id: fs.matchId })
          .eq("id", ev.id);
      }
    } catch (err) {
      stats.errors.push(`${ev.home}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Telemetry: one structured log per push for journalctl/log-aggregator.
  console.log(`[flashscore/live] ${JSON.stringify({ sport, ...stats })}`);

  return NextResponse.json(stats);
}

async function applyAndPersist(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  ev: V2LiveEvent,
  fs: FlashscoreLive,
  sport: string,
): Promise<boolean> {
  const { update } = computeEnrichmentUpdate({ ev, fs, sport });
  if (!update) return false;
  const { error } = await supabase.from("events_v2").update(update).eq("id", ev.id);
  if (error) throw new Error(error.message);
  return true;
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit -p .
```

Expected: 0 errors.

- [ ] **Step 3: Run all tests**

```bash
npx vitest run
```

Expected: all green (existing + new live-matcher.test.ts + sport-slug.test.ts).

- [ ] **Step 4: Commit**

```bash
git add app/api/flashscore/live/route.ts
git commit -m "feat(flashscore/live): repoint matcher to events_v2 + IT→EN slug + telemetry direct/fuzzy split"
```

---

## Task 5: Build + deploy admin + smoke

- [ ] **Step 1: Build admin**

```bash
cd /root/betssolution-admin
npm run build
```

Expected: `✓ Compiled successfully` (no failures).

- [ ] **Step 2: Restart admin service**

```bash
systemctl restart betssolution-admin
sleep 3
systemctl status betssolution-admin --no-pager | head -15
```

Expected: `Active: active (running)`.

- [ ] **Step 3: Smoke health endpoint**

```bash
curl -sS http://127.0.0.1:3000/api/health
```

Expected: `200`, `{"status":"ok"}` or similar.

- [ ] **Step 4: Tail logs while FS-scraper pushes**

```bash
journalctl -u betssolution-admin -n 80 --no-pager | grep '\[flashscore/live\]'
```

Wait ~60 s for FS-scraper next cycle.

Expected: at least one line of the form `[flashscore/live] {"sport":"calcio","received":N,"matched":M,"matched_direct":...,"matched_fuzzy":...,"updated":...,"errors":[]}` with `matched > 0` for sports with currently-live events (calcio is the most reliable; midweek may be 0 if no calcio matches in flight — fall back to whatever sport has live rows in the spot-check below).

- [ ] **Step 5: Spot-check one live event in DB**

```bash
psql "$DATABASE_URL" -c "SELECT id, home, away, score_home, score_away, period, minute, live_data->'halfScoreHome' AS hsh FROM events_v2 WHERE status='live' AND sport_slug='football' AND period IS NOT NULL LIMIT 5;"
```

Expected: rows with non-null `period`, `live_data` populated with halfScoreHome/Away.

If `matched > 0` and the spot-check returns rows → proceed to Task 6.
If `matched == 0` → debug:
- check FS-scraper is pushing (`journalctl -u flashscore-scraper -n 50`)
- check `events_v2` actually has `status='live'` rows in the relevant sport_slug
- check `getSportSlugsEn` returns the right slugs for the incoming `sport` field

---

## Task 6: Mig 178 — drop legacy JOIN in v_player_events

**Files:**
- Create: `supabase/migrations/178_v_player_events_drop_legacy_join.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- Migration 178 — v_player_events drop legacy events JOIN
--
-- Context:
--   Mig 176 introduced a LATERAL JOIN against legacy `events` to surface
--   live data (score / period / live_data) on v_player_events. Post FS
--   matcher repoint to events_v2 (T10), the same fields are now populated
--   directly on events_v2.{period, minute, live_data, score_home, score_away}.
--   Legacy `events` has been frozen since 2026-04-28 and is read-only
--   pending S7 cleanup. The LATERAL JOIN is now dead weight.
--
-- Behaviour:
--   - score_home / score_away: read directly from e2 (no COALESCE)
--   - live_data: COALESCE(e2.live_data, e2.period_scores) — period_scores
--     is the settlement-only payload; live_data is the running live state.
--     Falling through to period_scores keeps a graceful display for the
--     few-seconds window between live and settled.
--   - minute / period: read directly from e2
--
-- Performance:
--   Drops one LATERAL subquery per row → fewer plan nodes, faster cold path.
--
-- Rollback:
--   Re-apply mig 176 (file kept in repo).

BEGIN;

DROP VIEW IF EXISTS v_player_events CASCADE;

CREATE VIEW v_player_events AS
SELECT
  e2.id,
  e2.odds_api_id,
  s.id              AS sport_id,
  s.slug            AS sport_slug,
  s.name            AS sport_name,
  s.icon            AS sport_icon,
  s.sort_order      AS sport_sort_order,
  l.id              AS league_id,
  l.slug            AS league_slug,
  l.name            AS league_name,
  l.country         AS league_country,
  l.logo_url        AS league_logo_url,
  l.sort_order      AS league_sort_order,
  e2.home           AS home_team,
  e2.away           AS away_team,
  e2.home_id,
  e2.away_id,
  e2.starts_at,
  CASE e2.status
    WHEN 'pending'   THEN 'prematch'
    WHEN 'live'      THEN 'live'
    WHEN 'settled'   THEN 'ended'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'postponed' THEN 'postponed'
    ELSE e2.status
  END AS status,
  e2.score_home,
  e2.score_away,
  COALESCE(e2.live_data, e2.period_scores) AS live_data,
  e2.minute,
  e2.period,
  (e2.status = 'live') AS is_live,
  e2.flashscore_id,
  e2.urls,
  e2.updated_at,
  e2.last_settled_at
FROM events_v2 e2
LEFT JOIN sports s
  ON s.slug = _sport_slug_en_to_it(e2.sport_slug)
LEFT JOIN leagues l
  ON l.sport_id = s.id
 AND l.slug = e2.league_slug;

COMMENT ON VIEW v_player_events IS
  'Plan D Fase 1 — player-facing event view, reads live data directly from events_v2 (mig 178, replaces mig 176).';

INSERT INTO _migrations (name, applied_at)
VALUES ('178_v_player_events_drop_legacy_join', now())
ON CONFLICT (name) DO NOTHING;

COMMIT;
```

- [ ] **Step 2: Apply to prod**

```bash
psql "$DATABASE_URL" -f supabase/migrations/178_v_player_events_drop_legacy_join.sql
```

Expected: `BEGIN`, `DROP VIEW`, `CREATE VIEW`, `COMMENT`, `INSERT 0 1`, `COMMIT`.

- [ ] **Step 3: Verify view shape**

```bash
psql "$DATABASE_URL" -c "\d v_player_events" | grep -E '(period|minute|live_data|score_home)'
```

Expected: 4+ rows.

- [ ] **Step 4: Verify a live event surfaces correctly**

```bash
psql "$DATABASE_URL" -c "SELECT id, home_team, score_home, score_away, period, minute, live_data->'halfScoreHome' FROM v_player_events WHERE is_live=true AND sport_slug='calcio' AND period IS NOT NULL LIMIT 3;"
```

Expected: rows with non-null period, score, halfScoreHome.

- [ ] **Step 5: Check query latency**

```bash
psql "$DATABASE_URL" -c "EXPLAIN ANALYZE SELECT * FROM v_player_events WHERE is_live=true AND sport_slug='calcio';" | tail -10
```

Expected: planning + execution ≤ pre-mig-178 timing (cold ≤300 ms).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/178_v_player_events_drop_legacy_join.sql
git commit -m "feat(db): mig 178 — drop legacy events JOIN in v_player_events, read live fields from events_v2"
```

---

## Task 7: Player kiosk smoke

- [ ] **Step 1: Flush Redis cache for v_player_events (avoid 30 s TTL stale read)**

`lib/queries/player-event-v2.ts` reads through Redis with 30 s TTL. Either wait 30 s after mig 178 finishes, or flush the relevant keys:

```bash
# pattern depends on cache key naming; safest is bounce the player service which evicts on restart, or use a targeted scan-delete:
redis-cli --scan --pattern 'event:v2:*' | xargs -r redis-cli del
redis-cli --scan --pattern 'live:*' | xargs -r redis-cli del
```

If unsure, bounce the player service: `systemctl restart betssolution-player`. Faster than guessing key patterns and idempotent.

- [ ] **Step 2: Force kiosk re-init**

Reference memory: `reference-kiosk-session-cycle.md`. DB-only procedure to bounce the active kiosk.

```bash
psql "$DATABASE_URL" -c "UPDATE kiosk_sessions SET is_active=false WHERE is_active=true RETURNING id;"
psql "$DATABASE_URL" -c "UPDATE kiosk_sessions SET is_active=true, expires_at=now()+interval '24 hours' WHERE id='<id from above>';"
```

- [ ] **Step 3: Open kiosk live page on terminal 51**

User-facing smoke: pick one currently-live football event in v_player_events, navigate kiosk to `/live/<event_id>`. Verify Scoreboard renders:
- period label visible (e.g. "1T", "2T", "HT")
- per-period score table rows when periods.length > 1
- live_data flowing into UI (no NULL/empty placeholders for currently-live events)

- [ ] **Step 4: Document smoke result in memory file**

If smoke OK, write a session memory file (`session-2026-05-06-fs-matcher-events-v2.md`) summarizing:
- HEAD commit
- migs applied
- matched/matched_direct/matched_fuzzy/updated rates measured
- any open follow-ups (e.g. low coverage sports → resolver v2 P1 follow-ups)

- [ ] **Step 5: Update MEMORY.md index**

Add one-line entry under a clear heading, ≤200 chars.

---

## Task 8: Final review

- [ ] **Step 1: Dispatch code-reviewer subagent**

Review scope: T1–T7 commits (range = `git log --oneline 4692203..HEAD`), spec + plan adherence, schema migration safety, route.ts swap correctness.

- [ ] **Step 2: Address review findings or document disagreement**

- [ ] **Step 3: Push to origin**

```bash
git push origin feature/plan-d-settlement-d1
```

(Per memory `feedback-vps-bundle-pattern.md` if it exists — bundle pattern via VPS push as `infoundertheguns-ops`.)
