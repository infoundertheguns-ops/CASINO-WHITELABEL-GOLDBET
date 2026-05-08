# SofaScore Matcher Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 3 orthogonal bugs in `/api/sofascore/fixtures` pool filter so football and basketball events get matched against `events_v2` rows (currently 0 matches; spec is at `docs/superpowers/specs/2026-05-08-sofascore-matcher-fix-design.md`).

**Architecture:** Align SofaScore matcher with the Flashscore matcher convention. DB queries always use English slugs (`football`/`tennis`/`basketball`), status filter uses `pending` (the actual constraint value, not the non-existent `prematch`), and `mapSofaSport` is removed entirely because the Python scraper already sends EN-native slugs. Extract a tiny `buildPoolQuery` helper from `_lib.ts` so unit tests can assert the slug+status arrays without mocking Supabase.

**Tech Stack:** Next.js 14 App Router (admin route handlers), TypeScript, Supabase JS v2, Vitest. Code lives on the VPS at `/root/betssolution-admin` (no local clone — all work via SSH). Branch `feature/plan-d-settlement-d1`, current HEAD `2e0b298` on origin.

---

## Operating Environment

All file edits happen on the VPS. From the local Windows box:

- Read VPS files: `ssh scraper-vps "cat /root/betssolution-admin/<path>"`
- Edit VPS files: scp from local temp, OR use heredoc-via-stdin with `ssh scraper-vps 'sh -c "cat > path"' < /local/temp/file`
- Run tests: `ssh scraper-vps "cd /root/betssolution-admin && npm test -- <pattern>"`
- Build admin: `ssh scraper-vps "cd /root/betssolution-admin && npm run build"`
- Restart services: `ssh scraper-vps "systemctl restart <name>"`
- Push origin (PowerShell only, because `gh auth token` is local): `$t = gh auth token; ssh scraper-vps "cd /root/betssolution-admin && git push https://oauth2:$t@github.com/infoundertheguns-ops/betssolution-admin.git feature/plan-d-settlement-d1"`

**Critical context for everyone touching this code:**
- `events_v2.status` allowed values: `pending|live|settled|cancelled|postponed`. **`prematch` does not exist** — that's literally bug #2.
- `events_v2.sport_slug` values are EN: `football`, `tennis`, `basketball`, `baseball`, `ice-hockey`, etc. Set by the odds-api ingester.
- The IT slugs (`calcio`, `basket`) live only in UI views via the `_sport_slug_en_to_it` mapping (mig 175). Do not introduce IT slugs anywhere in scraper-facing code paths.
- Existing tests in `tests/api/sofascore/{fixtures,stats,enrichment}.test.ts` currently assert IT slugs. Updating them is mandatory — they will not pass against the fixed code unless updated first.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `app/api/sofascore/fixtures/_lib.ts` | Modify | Pure types + helpers: `SofaFixture`, `Candidate`, `MatchResult`, `matchSofaToCandidate`, `SOFA_VALID_SPORTS` Set, `buildPoolQuery` helper returning `{slugs, statuses}` for the route to feed into Supabase query builder. `mapSofaSport` removed. |
| `app/api/sofascore/fixtures/route.ts` | Modify | HTTP handler. Imports `buildPoolQuery` from `_lib.ts`, applies returned slugs/statuses to the Supabase chain, no inline magic strings. |
| `app/api/sofascore/stats/route.ts` | Modify | Stats handler. Filter on EN slugs, `by_sport` keys are EN, type-safe. |
| `app/api/sofascore/enrichment/route.ts` | Modify | Single line: TypeScript union for `Body.sport_slug` becomes `"football"\|"tennis"\|"basketball"`. |
| `tests/api/sofascore/fixtures.test.ts` | Modify | Drop `mapSofaSport` describe (function removed). Update `matchSofaToCandidate` test fixtures (`sport_slug` → EN). Update integration test pool rows (`sport_slug` + `status`). Add new `buildPoolQuery` describe block. |
| `tests/api/sofascore/stats.test.ts` | Modify | Update `by_sport` empty + populated assertions to use EN keys. Update mock data `sport_slug` to EN. |

No new files. No DB migrations. No frontend coupling.

---

## Task 0: Verify Workspace State

**Files:** none (verification only)

- [ ] **Step 1: Confirm VPS branch and HEAD**

Run from local PowerShell:
```powershell
ssh scraper-vps "cd /root/betssolution-admin && git rev-parse --abbrev-ref HEAD && git log --oneline -3 && git status -s"
```
Expected: branch `feature/plan-d-settlement-d1`, HEAD includes `2e0b298 docs(spec): apply spec-reviewer recommendations`, working tree clean.

- [ ] **Step 2: Confirm test runner works on a known-passing test**

```powershell
ssh scraper-vps "cd /root/betssolution-admin && npm test -- tests/api/sofascore/enrichment.test.ts 2>&1 | tail -10"
```
Expected: vitest reports `Test Files  1 passed`, `Tests  N passed`, exit 0. If it fails, stop and surface to human — environment is broken before we even start.

- [ ] **Step 3: Confirm starting test count for the suite**

```powershell
ssh scraper-vps "cd /root/betssolution-admin && npm test -- 2>&1 | tail -5"
```
Record the total. Spec mentions ~18/18; capture the actual number for later regression check.

---

## Task 1: Update fixtures.test.ts to expected post-fix behavior (TDD red)

**Files:**
- Modify: `tests/api/sofascore/fixtures.test.ts`

This task writes the new expectations FIRST. After this task, vitest will fail until Task 3+4 land. That is the intended TDD red state.

- [ ] **Step 1: Read current test file**

```powershell
ssh scraper-vps "cat /root/betssolution-admin/tests/api/sofascore/fixtures.test.ts"
```

- [ ] **Step 2: Replace the file with the new test content**

Write locally to `C:/Users/philp/AppData/Local/Temp/sofa-fixtures-test.ts`, then scp:

```typescript
import { describe, it, expect } from "vitest";
import {
  matchSofaToCandidate,
  buildPoolQuery,
  SOFA_VALID_SPORTS,
  type SofaFixture,
  type Candidate,
} from "@/app/api/sofascore/fixtures/_lib";

describe("SOFA_VALID_SPORTS", () => {
  it("contains exactly the three EN slugs", () => {
    expect(SOFA_VALID_SPORTS.has("football")).toBe(true);
    expect(SOFA_VALID_SPORTS.has("tennis")).toBe(true);
    expect(SOFA_VALID_SPORTS.has("basketball")).toBe(true);
    expect(SOFA_VALID_SPORTS.size).toBe(3);
  });
  it("does NOT contain Italian slugs (regression guard)", () => {
    expect(SOFA_VALID_SPORTS.has("calcio")).toBe(false);
    expect(SOFA_VALID_SPORTS.has("basket")).toBe(false);
  });
});

describe("buildPoolQuery", () => {
  it("returns EN slug array (regression guard for bug #1)", () => {
    const q = buildPoolQuery();
    expect(q.slugs).toEqual(["football", "tennis", "basketball"]);
  });
  it("returns valid status values matching events_v2 constraint (regression guard for bug #2)", () => {
    const q = buildPoolQuery();
    // pending+live cover prematch+inplay; route.ts adds settled-recent via .or()
    expect(q.statuses).toContain("pending");
    expect(q.statuses).toContain("live");
    expect(q.statuses).not.toContain("prematch");
  });
});

describe("matchSofaToCandidate", () => {
  const baseFx: SofaFixture = {
    sofa_event_id: 1,
    sofa_sport: "football",
    home: "FC Bayern München",
    away: "Paris Saint-Germain",
    kickoff_at: "2026-05-07T19:00:00Z",
    sofa_status: "finished",
    tournament_name: "UEFA Champions League",
    category_name: "Europe",
  };
  const baseC: Candidate = {
    id: "uuid-1",
    sport_slug: "football",
    home: "Bayern Munich",
    away: "PSG",
    starts_at: "2026-05-07T19:05:00Z",
    status: "pending",
    sofascore_id: null,
  };

  it("returns matched_fuzzy on close name + kickoff with EN slug", () => {
    const r = matchSofaToCandidate(baseFx, [baseC]);
    expect(r.kind).toBe("matched_fuzzy");
    if (r.kind === "matched_fuzzy") expect(r.candidate.id).toBe("uuid-1");
  });

  it("returns matched_direct when candidate already has sofascore_id matching fixture", () => {
    const r = matchSofaToCandidate(baseFx, [{ ...baseC, sofascore_id: 1 }]);
    expect(r.kind).toBe("matched_direct");
  });

  it("returns no_time_window when kickoff diff > 20min", () => {
    const r = matchSofaToCandidate(baseFx, [{ ...baseC, starts_at: "2026-05-07T20:30:00Z" }]);
    expect(r.kind).toBe("no_time_window");
  });

  it("returns no_match_name when names too different", () => {
    const r = matchSofaToCandidate(baseFx, [{ ...baseC, home: "Inter Milan", away: "AC Milan" }]);
    expect(r.kind).toBe("no_match_name");
  });

  it("does NOT match across sports (basketball candidate vs football fixture)", () => {
    const r = matchSofaToCandidate(baseFx, [{ ...baseC, sport_slug: "basketball" }]);
    expect(r.kind).toBe("no_time_window");
  });

  it("ignores already-mapped candidates with different sofa_event_id", () => {
    const r = matchSofaToCandidate(baseFx, [{ ...baseC, sofascore_id: 99 }]);
    expect(r.kind).toBe("no_time_window");
  });

  it("returns skipped_unknown_sport for unsupported sofa_sport", () => {
    const r = matchSofaToCandidate({ ...baseFx, sofa_sport: "rugby" }, [baseC]);
    expect(r.kind).toBe("skipped_unknown_sport");
  });

  it("EN slug pool match — regression guard against re-introducing IT slugs", () => {
    // candidate has EN slug, fixture has EN sport — must match (this is the bug we're fixing)
    const fxBasket: SofaFixture = { ...baseFx, sofa_sport: "basketball", sofa_event_id: 2 };
    const cBasket: Candidate = { ...baseC, sport_slug: "basketball", id: "uuid-b" };
    const r = matchSofaToCandidate(fxBasket, [cBasket]);
    expect(r.kind).toBe("matched_fuzzy");
  });
});

// =====================================================================
// Integration tests for POST /api/sofascore/fixtures
// =====================================================================
import { vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

type SupabaseQueryResult = { data: unknown; error: unknown };

interface MockHandlers {
  poolResult?: SupabaseQueryResult;
  updateResult?: SupabaseQueryResult;
  upsertResult?: SupabaseQueryResult;
  capturedUpdates?: Array<Record<string, unknown>>;
  capturedUpserts?: Array<Record<string, unknown>>;
}

function makeSupabaseMock(handlers: MockHandlers) {
  const captured = {
    updates: handlers.capturedUpdates ?? [],
    upserts: handlers.capturedUpserts ?? [],
  };
  return {
    from: vi.fn((table: string) => {
      const builder: any = {};
      builder.select = vi.fn(() => builder);
      builder.in = vi.fn(() => builder);
      builder.or = vi.fn(() => builder);
      builder.limit = vi.fn(() => Promise.resolve(handlers.poolResult ?? { data: [], error: null }));
      builder.update = vi.fn((payload: Record<string, unknown>) => {
        captured.updates.push({ table, ...payload });
        const eqBuilder: any = {};
        eqBuilder.eq = vi.fn(() => Promise.resolve(handlers.updateResult ?? { error: null }));
        return eqBuilder;
      });
      builder.upsert = vi.fn((payload: Record<string, unknown>) => {
        captured.upserts.push({ table, ...payload });
        return Promise.resolve(handlers.upsertResult ?? { error: null });
      });
      return builder;
    }),
    _captured: captured,
  };
}

let _activeMock: ReturnType<typeof makeSupabaseMock> | null = null;
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => _activeMock,
}));

beforeEach(() => {
  process.env.SCRAPER_API_KEY = "test-key";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  _activeMock = null;
});

async function callRoute(body: unknown, key: string | null = "test-key") {
  const { POST } = await import("@/app/api/sofascore/fixtures/route");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key !== null) headers["x-scraper-key"] = key;
  const req = new NextRequest("http://localhost/api/sofascore/fixtures", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return POST(req);
}

describe("POST /api/sofascore/fixtures", () => {
  it("rejects requests without scraper key (401)", async () => {
    _activeMock = makeSupabaseMock({});
    const res = await callRoute({ fixtures: [] }, null);
    expect(res.status).toBe(401);
  });

  it("rejects requests where fixtures is not an array (400)", async () => {
    _activeMock = makeSupabaseMock({});
    const res = await callRoute({ fixtures: "not-an-array" });
    expect(res.status).toBe(400);
  });

  it("processes fixtures and returns stats + matched array (EN slugs)", async () => {
    const futureIso = "2026-05-07T19:05:00Z";
    const poolRows = [
      {
        id: "uuid-football",
        sport_slug: "football",
        home: "Bayern Munich",
        away: "PSG",
        starts_at: futureIso,
        status: "pending",
        sofascore_id: null,
      },
      {
        id: "uuid-basketball",
        sport_slug: "basketball",
        home: "Lakers",
        away: "Celtics",
        starts_at: futureIso,
        status: "pending",
        sofascore_id: null,
      },
    ];
    _activeMock = makeSupabaseMock({ poolResult: { data: poolRows, error: null } });

    const fixtures = [
      {
        sofa_event_id: 1001,
        sofa_sport: "football",
        home: "FC Bayern München",
        away: "Paris Saint-Germain",
        kickoff_at: "2026-05-07T19:00:00Z",
        sofa_status: "finished",
        tournament_name: "UCL",
        category_name: "Europe",
      },
      {
        sofa_event_id: 1002,
        sofa_sport: "football",
        home: "Random FC",
        away: "Other United",
        kickoff_at: "2026-05-07T19:00:00Z",
        sofa_status: "finished",
        tournament_name: "X",
        category_name: null,
      },
      {
        sofa_event_id: 1003,
        sofa_sport: "rugby",
        home: "All Blacks",
        away: "Springboks",
        kickoff_at: "2026-05-07T19:00:00Z",
        sofa_status: "finished",
        tournament_name: "X",
        category_name: null,
      },
    ];
    const res = await callRoute({ fixtures });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.matched_fuzzy).toBe(1);
    expect(json.skipped_unknown_sport).toBe(1);
    expect((json.no_match_name ?? 0) + (json.no_time_window ?? 0)).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(json.matched)).toBe(true);
    expect(json.matched).toHaveLength(1);
    expect(json.matched[0]).toMatchObject({
      sofa_event_id: 1001,
      event_v2_id: "uuid-football",
      sport_slug: "football",
    });
  });

  it("includes recently-finished events in candidate pool (status=settled within 6h)", async () => {
    const recentSettledIso = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    const fxIso = recentSettledIso;
    const poolRows = [
      {
        id: "uuid-recent",
        sport_slug: "football",
        home: "Bayern Munich",
        away: "PSG",
        starts_at: recentSettledIso,
        status: "settled",
        sofascore_id: null,
      },
    ];
    _activeMock = makeSupabaseMock({ poolResult: { data: poolRows, error: null } });

    const fixtures = [
      {
        sofa_event_id: 2001,
        sofa_sport: "football",
        home: "FC Bayern München",
        away: "Paris Saint-Germain",
        kickoff_at: fxIso,
        sofa_status: "finished",
        tournament_name: "UCL",
        category_name: "Europe",
      },
    ];
    const res = await callRoute({ fixtures });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.matched_fuzzy).toBe(1);
    expect(json.matched[0].event_v2_id).toBe("uuid-recent");
  });
});
```

scp it:
```powershell
scp C:/Users/philp/AppData/Local/Temp/sofa-fixtures-test.ts scraper-vps:/root/betssolution-admin/tests/api/sofascore/fixtures.test.ts
```

- [ ] **Step 3: Confirm test file runs and FAILS as expected (TDD red)**

```powershell
ssh scraper-vps "cd /root/betssolution-admin && npm test -- tests/api/sofascore/fixtures.test.ts 2>&1 | tail -30"
```
Expected: failures because `SOFA_VALID_SPORTS`, `buildPoolQuery` don't exist yet, plus `matchSofaToCandidate` rejects EN-slug candidates (existing logic compares against IT). Note the failure messages — they confirm we're testing the right thing.

- [ ] **Step 4: Commit the test changes**

```powershell
ssh scraper-vps "cd /root/betssolution-admin && git add tests/api/sofascore/fixtures.test.ts && git -c user.email='info.softvisiontechnologies@gmail.com' -c user.name='philp' commit -m 'test(sofascore): update fixtures tests for EN slug + pending status (TDD red)'"
```

---

## Task 2: Update stats.test.ts to expected post-fix behavior (TDD red)

**Files:**
- Modify: `tests/api/sofascore/stats.test.ts`

This task can run in parallel with Task 1 (different file, different responsibility).

- [ ] **Step 1: Verify exact strings before sed (whitespace check)**

Before applying replacements, confirm the file uses the exact whitespace the sed patterns assume:

```powershell
ssh scraper-vps "grep -nE '\{ calcio: 0, tennis: 0, basket: 0 \}|sport_slug: \"calcio\"' /root/betssolution-admin/tests/api/sofascore/stats.test.ts"
```
Expected: at least 3 matches. If zero, `cat` the file and adjust the sed patterns to match the actual formatting before proceeding.

- [ ] **Step 2: Use Edit tool semantics — change two test bodies**

The only changes needed are inside the existing tests. Patches:

Replace in `tests/api/sofascore/stats.test.ts`:

```ts
expect(json.by_sport).toEqual({ calcio: 0, tennis: 0, basket: 0 });
```
with
```ts
expect(json.by_sport).toEqual({ football: 0, tennis: 0, basketball: 0 });
```

Replace data array in "counts matched_total and by_sport" test:
```ts
data: [
  { sport_slug: "calcio" },
  { sport_slug: "calcio" },
  { sport_slug: "calcio" },
  { sport_slug: "tennis" },
  { sport_slug: "tennis" },
],
```
with
```ts
data: [
  { sport_slug: "football" },
  { sport_slug: "football" },
  { sport_slug: "football" },
  { sport_slug: "tennis" },
  { sport_slug: "tennis" },
],
```

Replace assertion:
```ts
expect(json.by_sport).toEqual({ calcio: 3, tennis: 2, basket: 0 });
```
with
```ts
expect(json.by_sport).toEqual({ football: 3, tennis: 2, basketball: 0 });
```

Apply via `ssh scraper-vps` + `sed -i` (idempotent, exact string replace) is safe here because the strings are unique. Use one sed per replacement:

```powershell
ssh scraper-vps "cd /root/betssolution-admin && sed -i 's/{ calcio: 0, tennis: 0, basket: 0 }/{ football: 0, tennis: 0, basketball: 0 }/g' tests/api/sofascore/stats.test.ts"
ssh scraper-vps "cd /root/betssolution-admin && sed -i 's/{ calcio: 3, tennis: 2, basket: 0 }/{ football: 3, tennis: 2, basketball: 0 }/g' tests/api/sofascore/stats.test.ts"
ssh scraper-vps "cd /root/betssolution-admin && sed -i 's/sport_slug: \"calcio\"/sport_slug: \"football\"/g' tests/api/sofascore/stats.test.ts"
```

- [ ] **Step 3: Verify the changes look correct**

```powershell
ssh scraper-vps "grep -nE 'calcio|basket' /root/betssolution-admin/tests/api/sofascore/stats.test.ts"
```
Expected: zero matches.

- [ ] **Step 4: Run test, confirm RED**

```powershell
ssh scraper-vps "cd /root/betssolution-admin && npm test -- tests/api/sofascore/stats.test.ts 2>&1 | tail -20"
```
Expected: failures because the production code still returns IT keys.

- [ ] **Step 5: Commit**

```powershell
ssh scraper-vps "cd /root/betssolution-admin && git add tests/api/sofascore/stats.test.ts && git -c user.email='info.softvisiontechnologies@gmail.com' -c user.name='philp' commit -m 'test(sofascore): update stats tests for EN by_sport keys (TDD red)'"
```

---

## Task 3: Refactor `_lib.ts` (the foundation)

**Files:**
- Modify: `app/api/sofascore/fixtures/_lib.ts`

This is the critical task. Other route changes import from here.

- [ ] **Step 1: Write new `_lib.ts` content locally**

Save to `C:/Users/philp/AppData/Local/Temp/sofa-lib.ts`:

```ts
import { teamMatchScore } from "@/lib/betexplorer";

const TIME_TOLERANCE_SEC = 20 * 60;

export const SOFA_VALID_SPORTS = new Set(["football", "tennis", "basketball"]);
export type SofaSport = "football" | "tennis" | "basketball";

export interface SofaFixture {
  sofa_event_id: number;
  sofa_sport: string;
  home: string;
  away: string;
  kickoff_at: string;
  sofa_status: string;
  tournament_name: string;
  category_name: string | null;
}

export interface Candidate {
  id: string;
  sport_slug: string;
  home: string;
  away: string;
  starts_at: string;
  status: string;
  sofascore_id: number | null;
}

export type MatchResult =
  | { kind: "matched_direct"; candidate: Candidate }
  | { kind: "matched_fuzzy"; candidate: Candidate; score: number }
  | { kind: "no_time_window" }
  | { kind: "no_match_name" }
  | { kind: "skipped_unknown_sport" };

/**
 * Returns the slug + status arrays the route handler will feed into the
 * Supabase query. Extracted so unit tests can pin them down without
 * mocking Supabase.
 *
 * statuses covers prematch+inplay states; the route additionally OR-s in
 * recently-settled rows via .or() (those need a starts_at>=NOW()-6h check
 * that does not belong here).
 */
export function buildPoolQuery(): { slugs: SofaSport[]; statuses: string[] } {
  return {
    slugs: ["football", "tennis", "basketball"],
    statuses: ["pending", "live"],
  };
}

export function matchSofaToCandidate(fx: SofaFixture, pool: Candidate[]): MatchResult {
  if (!SOFA_VALID_SPORTS.has(fx.sofa_sport)) {
    return { kind: "skipped_unknown_sport" };
  }

  // 1. Direct lookup by existing sofascore_id
  const direct = pool.find((c) => c.sofascore_id === fx.sofa_event_id);
  if (direct) return { kind: "matched_direct", candidate: direct };

  // 2. Time-window filter (and exclude already-mapped to OTHER sofa events)
  const fxTime = new Date(fx.kickoff_at).getTime() / 1000;
  const inWindow = pool.filter(
    (c) =>
      c.sport_slug === fx.sofa_sport &&
      c.sofascore_id == null &&
      Math.abs(new Date(c.starts_at).getTime() / 1000 - fxTime) <= TIME_TOLERANCE_SEC,
  );
  if (inWindow.length === 0) return { kind: "no_time_window" };

  // 3. Token-based name match
  let best: { c: Candidate; score: number } | null = null;
  for (const c of inWindow) {
    const hScore = teamMatchScore(c.home, fx.home);
    const aScore = teamMatchScore(c.away, fx.away);
    if (hScore < 0.5 || aScore < 0.5) continue;
    const combined = hScore + aScore;
    if (!best || combined > best.score) best = { c, score: combined };
  }
  if (!best || best.score <= 1.0) return { kind: "no_match_name" };

  return { kind: "matched_fuzzy", candidate: best.c, score: best.score };
}
```

scp:
```powershell
scp C:/Users/philp/AppData/Local/Temp/sofa-lib.ts scraper-vps:/root/betssolution-admin/app/api/sofascore/fixtures/_lib.ts
```

- [ ] **Step 2: Verify imports are still consistent**

```powershell
ssh scraper-vps "grep -rn 'mapSofaSport' /root/betssolution-admin/app /root/betssolution-admin/tests"
```
Expected: zero matches (the test file from Task 1 already removed the import; route.ts will be fixed in Task 4).

If route.ts still imports `mapSofaSport`, that's expected — Task 4 will remove it. The TS compiler will complain, but we're not building yet.

- [ ] **Step 3: Run vitest on the unit-only describes (no route loading)**

```powershell
ssh scraper-vps "cd /root/betssolution-admin && npm test -- tests/api/sofascore/fixtures.test.ts -t 'SOFA_VALID_SPORTS|buildPoolQuery|matchSofaToCandidate' 2>&1 | tail -25"
```
Expected: the three describes (`SOFA_VALID_SPORTS`, `buildPoolQuery`, `matchSofaToCandidate`) — about 11 tests — should all pass. The `POST /api/sofascore/fixtures` integration tests will still fail because `route.ts` is unfixed.

---

## Task 4: Update `fixtures/route.ts` to use `buildPoolQuery`

**Files:**
- Modify: `app/api/sofascore/fixtures/route.ts`

- [ ] **Step 1: Apply the patch**

Two edits inside the route. Original lines:

```ts
import { matchSofaToCandidate, type SofaFixture, type Candidate } from "./_lib";
```
becomes:
```ts
import { matchSofaToCandidate, buildPoolQuery, type SofaFixture, type Candidate } from "./_lib";
```

Original block:
```ts
  const sixHoursAgoIso = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const { data: rows, error: poolErr } = await supabase
    .from("events_v2")
    .select("id, sport_slug, home, away, starts_at, status, sofascore_id")
    .in("sport_slug", ["calcio", "tennis", "basket"])
    .or(
      `status.in.(prematch,live),and(status.eq.settled,starts_at.gte.${sixHoursAgoIso})`,
    )
    .limit(5000);
```
becomes:
```ts
  const sixHoursAgoIso = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const { slugs, statuses } = buildPoolQuery();
  const { data: rows, error: poolErr } = await supabase
    .from("events_v2")
    .select("id, sport_slug, home, away, starts_at, status, sofascore_id")
    .in("sport_slug", slugs)
    .or(
      `status.in.(${statuses.join(",")}),and(status.eq.settled,starts_at.gte.${sixHoursAgoIso})`,
    )
    .limit(5000);
```

Use Edit-tool-style sed (the original strings are unique in the file):

```powershell
ssh scraper-vps "cd /root/betssolution-admin && sed -i 's|import { matchSofaToCandidate, type SofaFixture, type Candidate } from \"./_lib\";|import { matchSofaToCandidate, buildPoolQuery, type SofaFixture, type Candidate } from \"./_lib\";|' app/api/sofascore/fixtures/route.ts"
```

For the multi-line block, **use the scp-a-script approach** (preferred — avoids 4 layers of quote escaping through PowerShell→ssh→bash→python3).

Write locally to `C:/Users/philp/AppData/Local/Temp/patch-route.py`:

```python
import sys
p='/root/betssolution-admin/app/api/sofascore/fixtures/route.ts'
s=open(p).read()
old='''  const sixHoursAgoIso = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const { data: rows, error: poolErr } = await supabase
    .from("events_v2")
    .select("id, sport_slug, home, away, starts_at, status, sofascore_id")
    .in("sport_slug", ["calcio", "tennis", "basket"])
    .or(
      `status.in.(prematch,live),and(status.eq.settled,starts_at.gte.${sixHoursAgoIso})`,
    )
    .limit(5000);'''
new='''  const sixHoursAgoIso = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const { slugs, statuses } = buildPoolQuery();
  const { data: rows, error: poolErr } = await supabase
    .from("events_v2")
    .select("id, sport_slug, home, away, starts_at, status, sofascore_id")
    .in("sport_slug", slugs)
    .or(
      `status.in.(${statuses.join(",")}),and(status.eq.settled,starts_at.gte.${sixHoursAgoIso})`,
    )
    .limit(5000);'''
if old not in s:
    print('ERROR: old block not found', file=sys.stderr); sys.exit(1)
open(p,'w').write(s.replace(old,new))
print('OK')
```

scp + run + cleanup:

```powershell
scp C:/Users/philp/AppData/Local/Temp/patch-route.py scraper-vps:/tmp/patch-route.py
ssh scraper-vps "python3 /tmp/patch-route.py && rm /tmp/patch-route.py"
```
Expected stdout: `OK`. If `ERROR: old block not found`, the file already drifted — `cat` it and adjust the `old` literal.

- [ ] **Step 2: Verify the patch landed correctly**

```powershell
ssh scraper-vps "grep -A 2 'buildPoolQuery' /root/betssolution-admin/app/api/sofascore/fixtures/route.ts | head -10"
```
Expected: shows `import { ..., buildPoolQuery, ... }` and `const { slugs, statuses } = buildPoolQuery();`.

```powershell
ssh scraper-vps "grep -E 'calcio|basket|prematch' /root/betssolution-admin/app/api/sofascore/fixtures/route.ts"
```
Expected: zero matches.

- [ ] **Step 3: Run full fixtures test file**

```powershell
ssh scraper-vps "cd /root/betssolution-admin && npm test -- tests/api/sofascore/fixtures.test.ts 2>&1 | tail -25"
```
Expected: all tests pass (both unit and integration).

---

## Task 5: Update `stats/route.ts` to EN slugs

**Files:**
- Modify: `app/api/sofascore/stats/route.ts`

Independent of Tasks 3 and 4 — can run in parallel with Task 4.

- [ ] **Step 1: Apply two single-line replacements**

```powershell
ssh scraper-vps "cd /root/betssolution-admin && sed -i 's|.in(\"sport_slug\", \[\"calcio\", \"tennis\", \"basket\"\])|.in(\"sport_slug\", [\"football\", \"tennis\", \"basketball\"])|' app/api/sofascore/stats/route.ts"
ssh scraper-vps "cd /root/betssolution-admin && sed -i 's|const by_sport = { calcio: 0, tennis: 0, basket: 0 };|const by_sport = { football: 0, tennis: 0, basketball: 0 };|' app/api/sofascore/stats/route.ts"
```

- [ ] **Step 2: Verify**

```powershell
ssh scraper-vps "grep -nE 'sport_slug|by_sport' /root/betssolution-admin/app/api/sofascore/stats/route.ts | head -10"
```
Expected: only EN slug names (`football`, `basketball`, `tennis`).

- [ ] **Step 3: Run stats tests**

```powershell
ssh scraper-vps "cd /root/betssolution-admin && npm test -- tests/api/sofascore/stats.test.ts 2>&1 | tail -15"
```
Expected: all 4 tests pass.

---

## Task 6: Update `enrichment/route.ts` TypeScript type

**Files:**
- Modify: `app/api/sofascore/enrichment/route.ts`

Independent of all other tasks. Trivial single-line change.

- [ ] **Step 1: Replace the union type via scp-a-script (preferred — `|` is also a shell pipe character, easier to dodge entirely)**

Write locally to `C:/Users/philp/AppData/Local/Temp/patch-enrich.py`:

```python
import sys
p='/root/betssolution-admin/app/api/sofascore/enrichment/route.ts'
s=open(p).read()
old='sport_slug: "calcio" | "tennis" | "basket";'
new='sport_slug: "football" | "tennis" | "basketball";'
if old not in s:
    print('ERROR: old line not found', file=sys.stderr); sys.exit(1)
open(p,'w').write(s.replace(old,new))
print('OK')
```

scp + run + cleanup:

```powershell
scp C:/Users/philp/AppData/Local/Temp/patch-enrich.py scraper-vps:/tmp/patch-enrich.py
ssh scraper-vps "python3 /tmp/patch-enrich.py && rm /tmp/patch-enrich.py"
```
Expected stdout: `OK`.

- [ ] **Step 2: Verify**

```powershell
ssh scraper-vps "grep -n 'sport_slug:' /root/betssolution-admin/app/api/sofascore/enrichment/route.ts"
```
Expected: one line showing `sport_slug: "football" | "tennis" | "basketball";`.

- [ ] **Step 3: Verify enrichment test file still passes (no behavior change expected)**

```powershell
ssh scraper-vps "cd /root/betssolution-admin && npm test -- tests/api/sofascore/enrichment.test.ts 2>&1 | tail -10"
```
Expected: all tests still green.

---

## Task 7: Full test suite + tsc

**Files:** none (verification only)

- [ ] **Step 1: Run the full vitest suite**

```powershell
ssh scraper-vps "cd /root/betssolution-admin && npm test 2>&1 | tail -10"
```
Expected: all green. The new test file adds ~5-6 tests (SOFA_VALID_SPORTS x2, buildPoolQuery x2, matched_fuzzy basketball regression-guard, possibly minor adjustments) on top of the baseline; the absolute count matters less than "all passing, no non-sofascore tests regressed."

If any test fails: stop, diagnose, fix the regression. Do not proceed.

- [ ] **Step 2: TypeScript check**

```powershell
ssh scraper-vps "cd /root/betssolution-admin && npx tsc --noEmit 2>&1 | tail -20"
```
Expected: clean exit (zero errors). If `mapSofaSport` references remain anywhere, they'll error here — fix and re-run.

- [ ] **Step 3: Stage 1 commit**

```powershell
ssh scraper-vps "cd /root/betssolution-admin && git add -A app/api/sofascore && git -c user.email='info.softvisiontechnologies@gmail.com' -c user.name='philp' commit -m 'fix(sofascore): align matcher with EN slugs + pending status (closes calcio+basket 0 matched)

events_v2 uses EN slugs and status \`pending\`; the route filtered IT slugs and
non-existent \`prematch\` status, leaving the candidate pool nearly empty (28 vs
~1500 rows). Tennis matched only because slug is identical EN/IT.

- _lib.ts: remove mapSofaSport, add SOFA_VALID_SPORTS Set, add buildPoolQuery
  helper returning {slugs:EN[], statuses:[pending,live]}
- fixtures/route.ts: use buildPoolQuery, no inline magic strings
- stats/route.ts: EN slug filter + by_sport keys EN
- enrichment/route.ts: TypeScript union → EN

Pattern matches Flashscore matcher (DB always EN slug, status use-case-specific,
scraper sends native slug at boundary). SofaScore Python scraper already EN-native.

No DB migration. No schema change. No frontend coupling.

Spec: docs/superpowers/specs/2026-05-08-sofascore-matcher-fix-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>'"
```

---

## Task 8: Build admin

**Files:** none (build artifact only)

- [ ] **Step 1: Run prebuild + build**

```powershell
ssh scraper-vps "cd /root/betssolution-admin && npm run build 2>&1 | tail -30"
```
Expected: success message, new BUILD_ID printed. Capture the BUILD_ID for the deploy log.

If the build fails: diagnose the TypeScript or compilation error. Common gotchas: leftover `mapSofaSport` references, missing import.

- [ ] **Step 2: Confirm build output exists**

```powershell
ssh scraper-vps "ls -la /root/betssolution-admin/.next/server/app/api/sofascore/"
```
Expected: directory contains the three sofascore route compiled outputs.

---

## Task 9: Restart admin service

**Files:** none

- [ ] **Step 1: Restart and verify health**

```powershell
ssh scraper-vps "systemctl restart betssolution-admin.service && sleep 5 && systemctl status betssolution-admin.service --no-pager | head -15"
```
Expected: `active (running)`. If it's `failed`, check `journalctl -u betssolution-admin --since '1 min ago'` and roll back.

- [ ] **Step 2: Health check**

```powershell
ssh scraper-vps "curl -s -o /dev/null -w '%{http_code} %{time_total}s\n' http://127.0.0.1:3000/api/health"
```
Expected: `200 <under 1s>`.

---

## Task 10: Restart sofascore-scraper service (triggers startup discovery)

**Files:** none

- [ ] **Step 1: Restart**

```powershell
ssh scraper-vps "systemctl restart sofascore-scraper.service && sleep 3 && systemctl status sofascore-scraper.service --no-pager | head -15"
```
Expected: `active (running)`.

- [ ] **Step 2: Wait for startup discovery + match cycle**

The Python scraper runs discovery on startup, then begins prematch/live cycles. Allow 5-10 minutes for the discovery payload to land in `/api/sofascore/fixtures`.

```powershell
ssh scraper-vps "journalctl -u sofascore-scraper --since '2 min ago' --no-pager | grep -iE 'discovery|matched' | tail -10"
```
Expected: log line `[discovery] N matched events` where N is much larger than 45 (target: hundreds across calcio+basket+tennis).

- [ ] **Step 3: Confirm admin received the call**

```powershell
ssh scraper-vps "journalctl -u betssolution-admin --since '5 min ago' --no-pager | grep 'sofascore/fixtures' | tail -3"
```
Expected: a line showing `[sofascore/fixtures] {\"received\":NNNN,...,\"matched_fuzzy\":NN,...,\"no_time_window\":XX,...}` where:
- `matched_fuzzy` is in the hundreds (was 45)
- `no_time_window / received < 0.30` (was 1313/1435 = 0.91)

---

## Task 11: Smoke E2E + acceptance criteria verification

**Files:** none

- [ ] **Step 1: Stats endpoint shows by_sport football+basketball > 0**

```powershell
ssh scraper-vps "curl -s http://127.0.0.1:3000/api/sofascore/stats | python3 -m json.tool | head -20"
```
Expected JSON includes:
```json
{
  "matched_total": <larger than 45>,
  "by_sport": { "football": >0, "tennis": >=45, "basketball": >0 },
  ...
}
```

If `football` or `basketball` is still 0, check service logs for errors. Common cause: discovery cycle hasn't completed yet — wait another 5 min and re-check.

- [ ] **Step 2: Acceptance criterion #2 — ratio check**

```powershell
ssh scraper-vps "journalctl -u betssolution-admin --since '15 min ago' --no-pager | grep 'sofascore/fixtures' | tail -1"
```
Parse the JSON. Compute `no_time_window / received`. Must be `< 0.30`.

- [ ] **Step 3: Acceptance criterion #5 — enrichment populating for new sports**

Wait ~30-60 minutes after Task 10, then write `scripts/db/check-sofa-enrichment-by-sport.mjs` on the VPS (heredoc inline — DB credentials from the diagnosis session memory):

```powershell
ssh scraper-vps "cat > /root/betssolution-admin/scripts/db/check-sofa-enrichment-by-sport.mjs << 'EOF'
import pg from 'pg';
const c = new pg.Client({ host:'aws-1-eu-central-1.pooler.supabase.com', port:6543, user:'postgres.xgnyqkmugnfzhdveeqom', password:'2MQhskawT3I6XVKW', database:'postgres', ssl:{rejectUnauthorized:false} });
await c.connect();
const r = await c.query(\`
  SELECT e.sport_slug,
         COUNT(*) FILTER (WHERE en.statistics IS NOT NULL) populated,
         COUNT(*) total
  FROM events_v2 e
  JOIN event_enrichment en ON en.event_v2_id = e.id
  WHERE e.sport_slug IN ('football','tennis','basketball')
  GROUP BY e.sport_slug
  ORDER BY e.sport_slug
\`);
console.table(r.rows);
await c.end();
EOF
/root/.nvm/versions/node/v22.22.1/bin/node /root/betssolution-admin/scripts/db/check-sofa-enrichment-by-sport.mjs && rm /root/betssolution-admin/scripts/db/check-sofa-enrichment-by-sport.mjs"
```

Expected: football populated > 0, basketball populated > 0, tennis populated >= 45 (existing matches preserved).

- [ ] **Step 4: Production curl smoke (3 sample fixtures, one per sport)**

If you want a deterministic check independent of the discovery cycle, post 3 hand-crafted fixtures:

```powershell
$headers = @{ "x-scraper-key" = "goldbet-scraper-2026"; "content-type" = "application/json" }
$body = '{"fixtures":[{"sofa_event_id":99000001,"sofa_sport":"football","home":"Bayern Munich","away":"PSG","kickoff_at":"2099-01-01T00:00:00Z","sofa_status":"prematch","tournament_name":"X","category_name":null}]}'
ssh scraper-vps "curl -s -X POST -H 'x-scraper-key: goldbet-scraper-2026' -H 'content-type: application/json' -d '$body' http://127.0.0.1:3000/api/sofascore/fixtures"
```

(Use future date so this doesn't accidentally match real events. The response should show `received:1`, `no_match_name:1` or `no_time_window:1` — both fine, this confirms the route is alive and parsing.)

---

## Task 12: Push origin

**Files:** none (deploy artifact)

- [ ] **Step 1: Push via gh-token-pipe (PowerShell)**

```powershell
$t = gh auth token; ssh scraper-vps "cd /root/betssolution-admin && git push https://oauth2:$t@github.com/infoundertheguns-ops/betssolution-admin.git feature/plan-d-settlement-d1 2>&1 | tail -5"
```
Expected: `<old-sha>..<new-sha>  feature/plan-d-settlement-d1 -> feature/plan-d-settlement-d1`.

- [ ] **Step 2: Confirm origin HEAD**

```powershell
gh api repos/infoundertheguns-ops/betssolution-admin/branches/feature%2Fplan-d-settlement-d1 --jq '.commit.sha'
```
Compare to local-on-VPS HEAD:
```powershell
ssh scraper-vps "cd /root/betssolution-admin && git rev-parse HEAD"
```
They must match.

---

## Done When

- All 5 acceptance criteria from the spec satisfied (stats by_sport football+basketball > 0; no_time_window/received < 0.30; vitest green; tsc clean; enrichment populating for both sports within 60 min)
- HEAD of `feature/plan-d-settlement-d1` on origin matches HEAD on VPS
- Memory updated with deploy commit SHA + BUILD_ID
