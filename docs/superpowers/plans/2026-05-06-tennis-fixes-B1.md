# Tennis fixes B1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship instrumentation deploy (B1.A) for the FS-id resolver: per-sport time-window expansion (tennis/baseball ±20min), failed-sample ring-buffer telemetry, and per-sport NOISE/RESERVE scaffolding (default-only, behavior-parity). Followed by 1-2h sample collection on prod, then B1.B (tennis NOISE tuning) on a separate cycle.

**Architecture:** Two new helpers + per-sport config maps in `flashscore-scraper`:
- `sample-collector.ts` (NEW) — singleton ring buffer, 500/sport cap, exposes `record()` and `getSamples()`. Records `{ts, sport_slug, query_home, query_away, starts_at, reason, fs_candidates[]}` only for `name_mismatch` and `time_window_miss`; never for `feed_empty` (no candidates to diagnose).
- `normalize.ts` (modify) — `NOISE_TOKENS_BY_SPORT` and `RESERVE_MARKERS_BY_SPORT` maps with `_default` fallback. Pre-existing 30 NOISE tokens and 11 RESERVE markers move into `_default`. Helper functions `noiseFor(slug)`/`reserveFor(slug)`. `tokenize` accepts `sportSlug`. **No tennis/baseball overrides shipped in B1.A — they fall back to `_default` → byte-identical token output to v2 ship.**
- `search.ts` (modify) — `TIME_TOLERANCE_BY_SPORT` map (tennis/baseball 20min, `_default` 10min). `lastInWindow` declared once before day-offset loop, reassigned per iteration. Trailing 404 branch hooks `sampleCollector.record(...)` for diagnosable reasons.
- `server.ts` (modify) — new `GET /stats/samples` endpoint behind existing `x-api-key` auth.

**Tech Stack:** TypeScript, Node 20, Vitest, Fastify (server), tsc strict, pnpm workspace. Deploy via scp + systemctl on `scraper-vps` (`flashscore-scraper.service`). `flashscore-scraper` is **non-git on the VPS**; source-of-truth lives in `docs/superpowers/artifacts/<date>-<topic>/scraper/` mirrors.

**Reference docs:**
- Spec: `docs/superpowers/specs/2026-05-06-tennis-fixes-B1-design.md`
- Predecessor RUNBOOK: `docs/superpowers/artifacts/2026-05-06-fs-id-resolver-v2/RUNBOOK.md`
- Source-of-truth scraper mirror (current): `docs/superpowers/artifacts/2026-05-06-fs-id-resolver-v2/scraper/`

---

## Working environment (READ FIRST)

`flashscore-scraper` is **NOT a local directory**. The actual source lives on `scraper-vps` at `~/flashscore-scraper/`. The local repo only contains a *partial* mirror at `docs/superpowers/artifacts/<date>-<topic>/scraper/` (just `src/` + `config.json` — no `package.json`, `node_modules`, `parser.ts`, etc).

**SSH config**: `scraper-vps` is configured in `~/.ssh/config` (HostName 46.225.222.33, User root, IdentityFile ~/.ssh/id_ed25519, ForwardAgent yes). Tested working without password prompt.

**Local toolchain**: `node v24` is available; `pnpm` is NOT installed locally. All `pnpm vitest`, `pnpm tsc`, `pnpm build` commands MUST run on `scraper-vps` via ssh.

**Working environment setup (T1 first step)**:

```bash
# Sync remote source to a local working directory (excludes node_modules/dist)
mkdir -p /tmp/flashscore-scraper-work
rsync -avz --delete \
  --exclude node_modules --exclude dist --exclude '.git' --exclude 'src/*.bak*' \
  scraper-vps:~/flashscore-scraper/ /tmp/flashscore-scraper-work/

# This local working copy gives you read access to all transitive files (parser.ts,
# cache.ts, types.ts, package.json, tsconfig.json) so you can write tests that
# reference real exports. You edit ONLY files within `src/` and `src/__tests__/`
# in this working dir.
```

**Per-task edit/test cycle**:

```bash
# 1. Edit locally in /tmp/flashscore-scraper-work/src/...
# 2. Push the modified files to VPS:
scp /tmp/flashscore-scraper-work/src/<changed-files> \
    scraper-vps:~/flashscore-scraper/src/
# 3. Run tests on VPS:
ssh scraper-vps "cd ~/flashscore-scraper && pnpm vitest run src/__tests__/<test-file> 2>&1"
# 4. On green, copy the final files into the artifacts mirror and commit (mirror
#    is what lives in git; the local /tmp/ working copy is throwaway):
cp /tmp/flashscore-scraper-work/src/<changed-files> \
   docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/src/
git add docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/
git commit -m "..."
```

**Plan-text path convention**: when the plan says "modify `flashscore-scraper/src/normalize.ts`", interpret as **`/tmp/flashscore-scraper-work/src/normalize.ts`** (your local working file) and **mirror to `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/src/normalize.ts`** for git history. The test paths (`flashscore-scraper/src/__tests__/...`) map identically.

**T6 deploy step** (later): the scp at deploy is from the **mirror**, not from `/tmp/` — the mirror is the source-of-truth committed to git.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `flashscore-scraper/src/sample-collector.ts` | CREATE | Ring buffer + record/getSamples API |
| `flashscore-scraper/src/normalize.ts` | MODIFY | Add per-sport NOISE/RESERVE maps + helpers; thread `sportSlug` into `tokenize` |
| `flashscore-scraper/src/search.ts` | MODIFY | `TIME_TOLERANCE_BY_SPORT` lookup, sample collector hook in 404 branch, `lastInWindow` hoist |
| `flashscore-scraper/src/server.ts` | MODIFY | `GET /stats/samples` endpoint |
| `flashscore-scraper/src/__tests__/sample-collector.test.ts` | CREATE | 6 tests |
| `flashscore-scraper/src/__tests__/normalize.test.ts` | EXTEND | +1 regression test (tennis falls back to _default) |
| `flashscore-scraper/src/__tests__/search.test.ts` | EXTEND | +3 tests (tennis 20min window, sample logged on name_mismatch, no log on feed_empty) |
| `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/src/**` | CREATE (mirror) | Post-build snapshot for git history + rollback reference |
| `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/RUNBOOK.md` | CREATE | T-0 baseline, deploy log, post-deploy validation, B1.B handoff |

**Branch:** `feature/plan-d-settlement-d1` (current)

---

## Task 0: T-0 baseline capture (pre-deploy reference)

**Files:**
- Create: `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/RUNBOOK.md` (header + baseline section only)
- Create: `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/src/__tests__/` directory tree (empty, for mirrors in T1+)

**Note on duplicate baselines**: T0 captures a *sanity-check* baseline now (early sighting of by_sport ratios in case anything looks dramatically off). T6 captures the *authoritative* baseline immediately before service restart, used for success-criteria comparison. The T0 capture is intentionally *not* the comparison reference — production traffic between T0 and deploy will shift the numbers slightly.

- [ ] **Step 1: Capture /stats baseline from VPS**

```bash
ssh scraper-vps "curl -s -H 'x-api-key: $FS_SEARCH_API_KEY' http://127.0.0.1:8090/stats" \
  | tee docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/baseline-stats.json
```
Expected: JSON with `uptime_sec`, `search_requests_total`, `by_sport.tennis.{ok, no_match_*}`, etc.

- [ ] **Step 2: Capture event counts baseline (DB side)**

Run the same DB queries used in the v2 RUNBOOK (events_v2 by sport, hidden markets) — see `docs/superpowers/artifacts/2026-05-06-fs-id-resolver-v2/RUNBOOK.md` lines 23-65. Save results into baseline section of new RUNBOOK.

- [ ] **Step 3: Write RUNBOOK header + baseline section**

```markdown
# Tennis fixes B1.A — Deployment Runbook

Implementation plan: `docs/superpowers/plans/2026-05-06-tennis-fixes-B1.md`
Spec: `docs/superpowers/specs/2026-05-06-tennis-fixes-B1-design.md`
Branch: `feature/plan-d-settlement-d1`

## T-0 Baseline (pre-deploy)

Captured immediately before B1.A deploy, used as the comparison reference for success criteria.

### Search /stats by_sport (T-0)

[paste baseline-stats.json contents]

### DB coverage (T-0)

[paste table from sport coverage query]

### Hidden markets (T-0)

[paste table from hidden markets query]
```

- [ ] **Step 4: Create mirror directory tree (so subsequent commits don't fail)**

```bash
mkdir -p docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/src/__tests__
touch docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/.gitkeep
```

- [ ] **Step 5: Commit baseline + skeleton**

```bash
git add docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/
git commit -m "fs-id B1.A T0: baseline stats + RUNBOOK skeleton + mirror dir"
```

---

## Task 1: SampleCollector — TDD

**Files:**
- Create: `flashscore-scraper/src/sample-collector.ts`
- Test: `flashscore-scraper/src/__tests__/sample-collector.test.ts`

- [ ] **Step 1: Write failing tests**

Write `flashscore-scraper/src/__tests__/sample-collector.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { SampleCollector, type FailedSample } from "../sample-collector.js";

function mk(overrides: Partial<FailedSample> = {}): FailedSample {
  return {
    ts: Date.now(),
    sport_slug: "tennis",
    query_home: "Sinner J.",
    query_away: "Alcaraz C.",
    starts_at: "2026-05-07T14:00:00Z",
    reason: "name_mismatch",
    fs_candidates: [],
    ...overrides,
  };
}

describe("SampleCollector", () => {
  let c: SampleCollector;
  beforeEach(() => { c = new SampleCollector(); });

  it("records a sample under its sport slug", () => {
    c.record(mk({ sport_slug: "tennis" }));
    expect(c.getSamples("tennis", undefined, 10)).toHaveLength(1);
  });

  it("FIFO-shifts past cap (500)", () => {
    for (let i = 0; i < 502; i++) c.record(mk({ query_home: `H${i}` }));
    const got = c.getSamples("tennis", undefined, 1000);
    expect(got).toHaveLength(500);
    // most-recent first → first element is H501, last is H2 (H0/H1 shifted out)
    expect(got[0].query_home).toBe("H501");
    expect(got[got.length - 1].query_home).toBe("H2");
  });

  it("filters by reason when provided", () => {
    c.record(mk({ reason: "name_mismatch", query_home: "A" }));
    c.record(mk({ reason: "time_window_miss", query_home: "B" }));
    c.record(mk({ reason: "name_mismatch", query_home: "C" }));
    const nm = c.getSamples("tennis", "name_mismatch", 10);
    expect(nm.map(s => s.query_home)).toEqual(["C", "A"]);
  });

  it("clamps limit to [1, 500]", () => {
    for (let i = 0; i < 50; i++) c.record(mk({ query_home: `H${i}` }));
    expect(c.getSamples("tennis", undefined, 0)).toHaveLength(1);
    expect(c.getSamples("tennis", undefined, -5)).toHaveLength(1);
    expect(c.getSamples("tennis", undefined, 9999)).toHaveLength(50);
  });

  it("returns most-recent first", () => {
    c.record(mk({ query_home: "first" }));
    c.record(mk({ query_home: "second" }));
    c.record(mk({ query_home: "third" }));
    const got = c.getSamples("tennis", undefined, 10);
    expect(got.map(s => s.query_home)).toEqual(["third", "second", "first"]);
  });

  it("returns empty array for unknown sport_slug", () => {
    expect(c.getSamples("cricket", undefined, 10)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd flashscore-scraper && pnpm vitest run src/__tests__/sample-collector.test.ts
```
Expected: 6 FAIL with "Cannot find module ../sample-collector.js"

- [ ] **Step 3: Implement SampleCollector**

Write `flashscore-scraper/src/sample-collector.ts`:

```ts
export interface FsCandidate {
  home: string;
  away: string;
  ts_diff_sec: number;
}

export interface FailedSample {
  ts: number;
  sport_slug: string;
  query_home: string;
  query_away: string;
  starts_at: string;
  reason: "name_mismatch" | "time_window_miss";
  fs_candidates: FsCandidate[];
}

const CAP = 500;

export class SampleCollector {
  private buffers = new Map<string, FailedSample[]>();

  record(sample: FailedSample): void {
    try {
      let buf = this.buffers.get(sample.sport_slug);
      if (!buf) { buf = []; this.buffers.set(sample.sport_slug, buf); }
      buf.push(sample);
      if (buf.length > CAP) buf.shift();
    } catch (err) {
      console.warn("[sample-collector] record failed:", (err as Error)?.message);
    }
  }

  getSamples(sportSlug: string, reason: string | undefined, limit: number): FailedSample[] {
    const buf = this.buffers.get(sportSlug) ?? [];
    const filtered = reason ? buf.filter((s) => s.reason === reason) : buf;
    const clamped = Math.max(1, Math.min(CAP, Math.floor(Number.isFinite(limit) ? limit : 1)));
    // most-recent first: take last `clamped`, then reverse
    return filtered.slice(-clamped).reverse();
  }

  /** Test-only helper. Not exposed in production paths. */
  clear(): void {
    this.buffers.clear();
  }
}

export const sampleCollector = new SampleCollector();
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd flashscore-scraper && pnpm vitest run src/__tests__/sample-collector.test.ts
```
Expected: 6 PASS

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/src/sample-collector.ts \
        docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/src/__tests__/sample-collector.test.ts
# (mirror only — actual scraper source is on VPS / non-git workspace)
git commit -m "fs-id B1.A T1: SampleCollector ring buffer 500/sport + 6 tests"
```

**Note**: `flashscore-scraper` workspace is not git-tracked, so the commit is to the artifacts mirror. The implementer should keep both in sync (working source for tests; mirror for git history). T6 will deploy from mirror to VPS.

---

## Task 2: Per-sport NOISE/RESERVE scaffold (normalize.ts)

**Files:**
- Modify: `flashscore-scraper/src/normalize.ts` (current source: `docs/superpowers/artifacts/2026-05-06-fs-id-resolver-v2/scraper/src/normalize.ts`)
- Modify (extend): `flashscore-scraper/src/__tests__/normalize.test.ts`

- [ ] **Step 1: Write failing regression test**

Append to `__tests__/normalize.test.ts` (new describe block at end of file):

```ts
describe("normalizeTeam — per-sport scaffold (B1.A)", () => {
  it("tennis falls back to _default NOISE when no override defined", () => {
    // FC is in _default NOISE; tennis override doesn't exist yet → tokens identical
    const tennis = normalizeTeam("FC Barcelona", "tennis");
    const football = normalizeTeam("FC Barcelona", "football");
    expect(tennis.key).toBe(football.key);
    expect(tennis.tokens).toEqual(football.tokens);
  });
});
```

- [ ] **Step 2: Run tests to verify state**

```bash
cd flashscore-scraper && pnpm vitest run src/__tests__/normalize.test.ts
```
Expected: All existing tests PASS, the new test ALSO already PASS (because today both tennis and football collapse to the same single NOISE list — the test guards against future regressions when we DO add tennis overrides). This is a *guard test*, not a TDD-driven failure. Note in the RUNBOOK that this is intentional — it locks in behavior parity for B1.A.

- [ ] **Step 3: Refactor normalize.ts to per-sport scaffold**

Replace the file with this updated version. Behavior MUST be byte-identical for any input that uses `_default` (i.e. all inputs in B1.A since no overrides are populated):

```ts
import aliasesRaw from "./team-aliases.json" with { type: "json" };

const ALIASES = aliasesRaw as Record<string, string>;
const DIACRITIC_RE = /[̀-ͯ]/g;

const _DEFAULT_NOISE = new Set([
  "fc", "ac", "cf", "sc", "sk", "ss", "ssc", "usl", "calcio", "afc", "cfc", "usd",
  "gks", "kkp", "kf", "fk", "mfk", "ks", "bk", "ofk", "zsk",
  "nk", "hnk", "gnk", "ffk", "fck", "rfk",
  "d",
  "club", "team", "sport", "sports",
]);

const _DEFAULT_RESERVE = new Set([
  "ii", "iii", "b", "c",
  "u17", "u19", "u20", "u21", "u23",
  "2", "3",
  "youth", "academy", "reserves",
]);

const NOISE_TOKENS_BY_SPORT: Record<string, Set<string>> = {
  _default: _DEFAULT_NOISE,
  // tennis, baseball populated in B1.B based on captured samples
};

const RESERVE_MARKERS_BY_SPORT: Record<string, Set<string>> = {
  _default: _DEFAULT_RESERVE,
  // tennis, baseball populated in B1.B if needed
};

function noiseFor(slug: string): Set<string> {
  return NOISE_TOKENS_BY_SPORT[slug] ?? NOISE_TOKENS_BY_SPORT._default;
}
function reserveFor(slug: string): Set<string> {
  return RESERVE_MARKERS_BY_SPORT[slug] ?? RESERVE_MARKERS_BY_SPORT._default;
}

const DISCRIMINATING_MIN_LEN = 4;

export interface NormalizedTeam {
  tokens: string[];
  key: string;
  reserveMarkers: Set<string>;
}

function tokenize(raw: string, sportSlug: string): string[] {
  const noise = noiseFor(sportSlug);
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITIC_RE, "")
    .replace(/[.']/g, "")
    .split(/[\s\-/&]+/)
    .filter((t) => t.length > 0 && !noise.has(t));
}

export function normalizeTeam(raw: string, sportSlug: string): NormalizedTeam {
  const tokens = tokenize(raw, sportSlug);
  const reserve = reserveFor(sportSlug);
  const reserveMarkers = new Set(tokens.filter((t) => reserve.has(t)));
  const nonReserve = tokens.filter((t) => !reserve.has(t));
  const baseKey = nonReserve.join(" ");

  const aliased = ALIASES[`${sportSlug}:${baseKey}`];
  if (aliased) {
    return { tokens: aliased.split(" "), key: aliased, reserveMarkers };
  }
  return { tokens: nonReserve, key: baseKey, reserveMarkers };
}

export function matchTeams(a: NormalizedTeam, b: NormalizedTeam): boolean {
  if (a.key.length === 0 || b.key.length === 0) return false;
  if (!setsEqual(a.reserveMarkers, b.reserveMarkers)) return false;
  if (a.key === b.key) return true;
  // Stage 3: subset on discriminating tokens. We use a.reserveMarkers (== b.reserveMarkers
  // by Stage 1 gate) instead of a module-level RESERVE_MARKERS set. Behavior equivalence
  // depends on the constraint that any sport-specific RESERVE_MARKERS_BY_SPORT[X] entries
  // ≥ DISCRIMINATING_MIN_LEN (4 chars) must always also appear in normalizeTeam's tokens
  // when the team string contains them — which is true since reserveMarkers are populated
  // from `tokens` in normalizeTeam itself. If B1.B adds tennis reserve markers with len≥4,
  // ensure they pass through tokenize (i.e. are not on the per-sport NOISE list).
  const reserve = a.reserveMarkers;
  const aDisc = new Set(a.tokens.filter((t) => t.length >= DISCRIMINATING_MIN_LEN && !reserve.has(t)));
  const bDisc = new Set(b.tokens.filter((t) => t.length >= DISCRIMINATING_MIN_LEN && !reserve.has(t)));
  if (aDisc.size === 0 || bDisc.size === 0) return false;
  return isSubset(aDisc, bDisc) || isSubset(bDisc, aDisc);
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function isSubset<T>(a: Set<T>, b: Set<T>): boolean {
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
```

**Diff vs v2**: original `tokenize` did not take `sportSlug` and used a module-level `NOISE_TOKENS` const directly. `matchTeams` Stage 3 used the module-level `RESERVE_MARKERS` const for the filter. Now both are sport-scoped via helpers. The original `RESERVE_MARKERS` reference inside `matchTeams` Stage 3 has been replaced by `a.reserveMarkers` (the team's own reserve set, which is identical to `b.reserveMarkers` after Stage 1's `setsEqual` gate). This preserves semantics exactly (Stage 3 filters out reserve tokens — using `a.reserveMarkers` instead of the per-sport reserve set is a *stricter* filter that drops only the markers actually present, but in practice produces identical results since reserve markers are short tokens (`b`, `c`, `2`, `3`) below the discriminating-len threshold of 4 anyway, except for `youth`/`academy`/`reserves`/`u17-u23` which are correctly excluded by both approaches).

**Sanity check** the implementer should run mentally: under `_default`, the tokens produced for "FC Barcelona U21 B" should be `["barcelona", "u21", "b"]`, reserveMarkers `{u21, b}`, key `"barcelona"`. Same as v2.

- [ ] **Step 4: Run all normalize tests**

```bash
cd flashscore-scraper && pnpm vitest run src/__tests__/normalize.test.ts
```
Expected: All existing tests + 1 new regression test PASS. The current `normalize.test.ts` mirror contains ~36 individual `it(...)` cases across 8 describe blocks (basic + Eastern European + alias + reserve markers + Stage 2 strict eq loop + Stage 3 + Stage 1 mismatch + edge cases). Exact count varies — anything ≥ pre-refactor count + 1 is acceptable; what matters is **zero regressions** on existing cases.

- [ ] **Step 5: Commit**

```bash
# update mirror
cp flashscore-scraper/src/normalize.ts \
   docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/src/normalize.ts
cp flashscore-scraper/src/__tests__/normalize.test.ts \
   docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/src/__tests__/normalize.test.ts
git add docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/
git commit -m "fs-id B1.A T2: normalize.ts per-sport NOISE/RESERVE scaffold (default-only, byte-identical to v2)"
```

---

## Task 3: Per-sport time tolerance + sample collector hook (search.ts)

**Files:**
- Modify: `flashscore-scraper/src/search.ts`
- Modify (extend): `flashscore-scraper/src/__tests__/search.test.ts`

- [ ] **Step 1: Write 3 failing tests**

Append to `__tests__/search.test.ts`:

```ts
describe("searchEvent — per-sport time tolerance (B1.A)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tennis: matches at +15min from event timestamp (within 20min tolerance)", async () => {
    const TS = 1730000000;
    const PLUS_15M = TS + 15 * 60;
    vi.mocked(parseFixturesFeed).mockReturnValue([
      { matchId: "T1", homeTeam: "Sinner", awayTeam: "Alcaraz", timestamp: TS, country: "Italy", league: "ATP", sport: "Tennis" },
    ]);
    const r = await searchEvent({
      sportSlug: "tennis",
      startsAt: new Date(PLUS_15M * 1000).toISOString(),
      home: "Sinner",
      away: "Alcaraz",
    });
    expect(r.status).toBe(200);
    expect((r.body as any).matchId).toBe("T1");
  });

  it("football: still rejects at +15min (10min tolerance unchanged)", async () => {
    const TS = 1730100000;
    const PLUS_15M = TS + 15 * 60;
    vi.mocked(parseFixturesFeed).mockReturnValue([
      { matchId: "F1", homeTeam: "Inter", awayTeam: "Milan", timestamp: TS, country: "Italy", league: "Serie A", sport: "Football" },
    ]);
    const r = await searchEvent({
      sportSlug: "football",
      startsAt: new Date(PLUS_15M * 1000).toISOString(),
      home: "Inter",
      away: "Milan",
    });
    expect(r.status).toBe(404);
    expect((r.body as any).reason).toBe("time_window_miss");
  });
});

describe("searchEvent — sample collector telemetry (B1.A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // import lazily to ensure clear() is called before each test
  });

  it("records a sample on name_mismatch with fs_candidates", async () => {
    const { sampleCollector } = await import("../sample-collector.js");
    sampleCollector.clear();
    const TS = 1730200000;
    vi.mocked(parseFixturesFeed).mockReturnValue([
      { matchId: "X1", homeTeam: "Aaaa", awayTeam: "Bbbb", timestamp: TS, country: "X", league: "Y", sport: "Football" },
    ]);
    const r = await searchEvent({
      sportSlug: "football",
      startsAt: new Date(TS * 1000).toISOString(),
      home: "Cccc",
      away: "Dddd",
    });
    expect(r.status).toBe(404);
    expect((r.body as any).reason).toBe("name_mismatch");
    const got = sampleCollector.getSamples("football", "name_mismatch", 10);
    expect(got).toHaveLength(1);
    expect(got[0].query_home).toBe("Cccc");
    expect(got[0].fs_candidates).toHaveLength(1);
    expect(got[0].fs_candidates[0].home).toBe("Aaaa");
    expect(got[0].fs_candidates[0].ts_diff_sec).toBe(0);
  });

  it("does NOT record a sample on feed_empty", async () => {
    const { sampleCollector } = await import("../sample-collector.js");
    sampleCollector.clear();
    vi.mocked(fetchResultsFeed).mockResolvedValue(null);
    vi.mocked(parseFixturesFeed).mockReturnValue([]);
    const TS = 1730300000;
    const r = await searchEvent({
      sportSlug: "football",
      startsAt: new Date(TS * 1000).toISOString(),
      home: "Eeee",
      away: "Ffff",
    });
    expect(r.status).toBe(404);
    expect((r.body as any).reason).toBe("feed_empty");
    expect(sampleCollector.getSamples("football", undefined, 10)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd flashscore-scraper && pnpm vitest run src/__tests__/search.test.ts
```
Expected: 3 new tests FAIL (tennis test → 404 because 10min applied; sample tests → collector empty because no hook yet).

- [ ] **Step 3: Modify search.ts**

Apply this diff to `flashscore-scraper/src/search.ts`. **Preserve all existing exports**: `searchEvent` (this is the rewrite below), `searchCache` (unchanged), `dayOffsetFromIso` (unchanged — used by tests), `SearchResult` and `SearchInput` types (unchanged). The `// ... unchanged ...` comments below are guidelines for the reader; the implementer must keep the actual code in those gaps verbatim from v2.

```ts
import { fetchResultsFeed } from "./flashscore-client.js";
import { parseFixturesFeed, type FlashscoreFixture } from "./parser.js";
import { TtlCache } from "./cache.js";
import { normalizeTeam, matchTeams } from "./normalize.js";
import sportMap from "./sport-id-map.json" with { type: "json" };
import { sampleCollector } from "./sample-collector.js";

const SPORT_MAP = sportMap as Record<string, number>;
const CACHE_TTL_MS = Number(process.env.FS_SEARCH_CACHE_TTL_MS ?? 5 * 60 * 1000);
const cache = new TtlCache<FlashscoreFixture[]>(CACHE_TTL_MS);

const TIME_TOLERANCE_BY_SPORT: Record<string, number> = {
  _default: 10 * 60,
  tennis:    20 * 60,
  baseball:  20 * 60,
};
function tolFor(slug: string): number {
  return TIME_TOLERANCE_BY_SPORT[slug] ?? TIME_TOLERANCE_BY_SPORT._default;
}

const SPORT_NAMES: Record<number, string> = {
  // ... unchanged ...
};

// ... fetchAndCache, dayOffsetFromIso, types unchanged ...

export async function searchEvent(input: SearchInput): Promise<SearchResult> {
  const sportId = SPORT_MAP[input.sportSlug];
  if (!sportId) return { status: 400, body: { error: "unknown_sport", sport_slug: input.sportSlug } };

  const baseOffset = dayOffsetFromIso(input.startsAt);
  const offsets = [baseOffset, baseOffset + 1, baseOffset - 1];

  const eventTs = Math.floor(new Date(input.startsAt).getTime() / 1000);
  const homeNorm = normalizeTeam(input.home, input.sportSlug);
  const awayNorm = normalizeTeam(input.away, input.sportSlug);
  const tolSec = tolFor(input.sportSlug);

  let anyFixturesLoaded = false;
  let anyInTimeWindow = false;
  let lastInWindow: FlashscoreFixture[] = [];   // hoisted out of loop for sample logging

  for (const off of offsets) {
    let fixtures: FlashscoreFixture[];
    try {
      fixtures = await fetchAndCache(sportId, off);
    } catch {
      return { status: 503, body: { error: "flashscore_unavailable" } };
    }
    if (fixtures.length > 0) anyFixturesLoaded = true;

    const inWindow = fixtures.filter((f) => Math.abs(f.timestamp - eventTs) <= tolSec);
    lastInWindow = inWindow;   // overwrite each iteration (intentional; see spec)
    if (inWindow.length > 0) anyInTimeWindow = true;

    const matches = inWindow.filter((f) => {
      const hN = normalizeTeam(f.homeTeam, input.sportSlug);
      const aN = normalizeTeam(f.awayTeam, input.sportSlug);
      return matchTeams(homeNorm, hN) && matchTeams(awayNorm, aN);
    });

    if (matches.length === 1) {
      return {
        status: 200,
        body: {
          matchId: matches[0].matchId,
          matchedHome: matches[0].homeTeam,
          matchedAway: matches[0].awayTeam,
          viaDayOffset: off,
        },
      };
    }
    if (matches.length > 1) {
      return {
        status: 409,
        body: {
          error: "ambiguous",
          candidates: matches.slice(0, 5).map((m) => ({ matchId: m.matchId, home: m.homeTeam, away: m.awayTeam })),
        },
      };
    }
  }

  const reason: "feed_empty" | "time_window_miss" | "name_mismatch" =
    !anyFixturesLoaded ? "feed_empty"
    : !anyInTimeWindow ? "time_window_miss"
    : "name_mismatch";

  if (reason !== "feed_empty") {
    sampleCollector.record({
      ts: Date.now(),
      sport_slug: input.sportSlug,
      query_home: input.home,
      query_away: input.away,
      starts_at: input.startsAt,
      reason,
      fs_candidates: lastInWindow.slice(0, 5).map((f) => ({
        home: f.homeTeam,
        away: f.awayTeam,
        ts_diff_sec: f.timestamp - eventTs,
      })),
    });
  }

  return { status: 404, body: { error: "no_match", reason } };
}

export const searchCache = cache;
```

- [ ] **Step 4: Run search tests to verify they pass**

```bash
cd flashscore-scraper && pnpm vitest run src/__tests__/search.test.ts
```
Expected: All existing + 3 new = ALL PASS.

- [ ] **Step 5: Run full test suite + typecheck**

```bash
cd flashscore-scraper && pnpm vitest run && pnpm tsc --noEmit
```
Expected: 23+ tests PASS, 0 TS errors.

- [ ] **Step 6: Commit**

```bash
cp flashscore-scraper/src/search.ts \
   docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/src/search.ts
cp flashscore-scraper/src/__tests__/search.test.ts \
   docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/src/__tests__/search.test.ts
git add docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/
git commit -m "fs-id B1.A T3: per-sport time tolerance (tennis/baseball ±20min) + sample collector hook"
```

---

## Task 4: GET /stats/samples endpoint (server.ts)

**Files:**
- Modify: `flashscore-scraper/src/server.ts`

No unit test added: `server.ts` has no existing test infra (no fastify-test setup). Validation is via local manual smoke + post-deploy curl in T6/T7.

- [ ] **Step 1: Modify server.ts**

Apply this patch (insertion only — no existing routes change):

```ts
import Fastify from "fastify";
import { searchEvent, searchCache } from "./search.js";
import { sampleCollector } from "./sample-collector.js";

// ... SportCounters, bySport, startMs, totalRequests, bump unchanged ...

export async function startServer(port = 8090, host = "127.0.0.1"): Promise<void> {
  // ... existing setup unchanged through /search route ...

  // NEW endpoint: GET /stats/samples
  app.get("/stats/samples", async (req, reply) => {
    const q = req.query as Record<string, string>;
    if (!q.sport) return reply.code(400).send({ error: "missing_param", param: "sport" });
    const reasonParam = q.reason;
    const reason = (reasonParam === "name_mismatch" || reasonParam === "time_window_miss")
      ? reasonParam
      : undefined;
    const limitNum = q.limit ? Number(q.limit) : 100;
    const samples = sampleCollector.getSamples(q.sport, reason, isFinite(limitNum) ? limitNum : 100);
    return reply.code(200).send({
      sport: q.sport,
      reason: reason ?? "all",
      count: samples.length,
      samples,
    });
  });

  // ... existing /stats route unchanged ...

  await app.listen({ port, host });
  console.log(`[search-server] listening on http://${host}:${port}`);
}
```

- [ ] **Step 2: Local smoke test**

```bash
cd flashscore-scraper && pnpm build && \
  FS_SEARCH_API_KEY=local-test node dist/server.js &
SERVER_PID=$!
sleep 2
curl -s -H "x-api-key: local-test" "http://127.0.0.1:8090/stats/samples?sport=tennis&limit=5"
# Expected: {"sport":"tennis","reason":"all","count":0,"samples":[]}
curl -s -H "x-api-key: local-test" "http://127.0.0.1:8090/stats/samples"
# Expected: {"error":"missing_param","param":"sport"}
curl -s -H "x-api-key: local-test" "http://127.0.0.1:8090/stats/samples?sport=tennis&reason=invalid"
# Expected: {"sport":"tennis","reason":"all","count":0,"samples":[]}  (invalid reason silently ignored)
kill $SERVER_PID
```

- [ ] **Step 3: Run full test suite**

```bash
cd flashscore-scraper && pnpm vitest run && pnpm tsc --noEmit
```
Expected: All tests PASS, 0 errors.

- [ ] **Step 4: Commit**

```bash
cp flashscore-scraper/src/server.ts \
   docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/src/server.ts
git add docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/src/server.ts
git commit -m "fs-id B1.A T4: GET /stats/samples endpoint behind x-api-key"
```

---

## Task 5: Mirror complete + RUNBOOK pre-deploy section

**Files:**
- Update: `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/RUNBOOK.md`
- Verify mirror complete: `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/`

- [ ] **Step 1: Verify mirror has all changed files**

```bash
ls docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/src/
# Expected: normalize.ts, search.ts, server.ts, sample-collector.ts, __tests__/
ls docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/src/__tests__/
# Expected: normalize.test.ts, search.test.ts, sample-collector.test.ts
```

If any file missing, copy from `flashscore-scraper/src/...` to mirror.

- [ ] **Step 2: Append "Pre-deploy validation" section to RUNBOOK**

Append to `RUNBOOK.md`:

```markdown
## Pre-deploy validation (local)

- Tests: `pnpm vitest run` → 25 PASS (16 existing + 6 sample-collector + 3 search-extension + 1 normalize-regression — adjust if final count differs)
- Typecheck: `pnpm tsc --noEmit` → 0 errors
- Build: `pnpm build` → success, dist/ populated
- Manual smoke /stats/samples: 200 with `{sport, reason: "all", count: 0, samples: []}` shape verified

## Pre-deploy file inventory (mirror → scraper-vps)

Files to scp to `scraper-vps:~/flashscore-scraper/src/`:

- `sample-collector.ts` (NEW)
- `normalize.ts` (modified)
- `search.ts` (modified)
- `server.ts` (modified)

Files to scp to `scraper-vps:~/flashscore-scraper/src/__tests__/`:

- `sample-collector.test.ts` (NEW)
- `normalize.test.ts` (extended)
- `search.test.ts` (extended)
```

- [ ] **Step 3: Commit RUNBOOK update**

```bash
git add docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/RUNBOOK.md
git commit -m "fs-id B1.A T5: RUNBOOK pre-deploy validation + file inventory"
```

---

## Task 6: VPS deploy + smoke

**Files:**
- Update: `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/RUNBOOK.md`

- [ ] **Step 1: Re-capture T-0 baseline immediately before deploy**

```bash
ssh scraper-vps "curl -s -H 'x-api-key: $FS_SEARCH_API_KEY' http://127.0.0.1:8090/stats" \
  | tee docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/baseline-stats-T0-deploy.json
```

This is the *authoritative* T-0 baseline used for success-criteria comparison. It will differ from the T0 captured in Task 0 because of accumulated traffic between then and now.

- [ ] **Step 2: scp source files to VPS**

```bash
SCRAPER_MIRROR=docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper
scp $SCRAPER_MIRROR/src/sample-collector.ts \
    $SCRAPER_MIRROR/src/normalize.ts \
    $SCRAPER_MIRROR/src/search.ts \
    $SCRAPER_MIRROR/src/server.ts \
    scraper-vps:~/flashscore-scraper/src/
scp $SCRAPER_MIRROR/src/__tests__/sample-collector.test.ts \
    $SCRAPER_MIRROR/src/__tests__/normalize.test.ts \
    $SCRAPER_MIRROR/src/__tests__/search.test.ts \
    scraper-vps:~/flashscore-scraper/src/__tests__/
```

- [ ] **Step 3: Build + restart on VPS**

```bash
ssh scraper-vps "cd ~/flashscore-scraper && pnpm vitest run && pnpm tsc --noEmit && pnpm build && systemctl restart flashscore-scraper.service && sleep 3 && systemctl status flashscore-scraper.service --no-pager"
```
Expected: tests PASS on VPS, build OK, service active (running).

- [ ] **Step 4: Smoke /stats endpoint**

```bash
ssh scraper-vps "curl -s -H 'x-api-key: \$FS_SEARCH_API_KEY' http://127.0.0.1:8090/stats" \
  | jq '{uptime_sec, search_requests_total, by_sport_keys: (.by_sport | keys)}'
```
Expected: `uptime_sec` ≤ 30 (counters reset by restart), `by_sport_keys: []` initially or one entry as soon as first /search call hits.

- [ ] **Step 5: Smoke /stats/samples endpoint**

```bash
ssh scraper-vps "curl -s -H 'x-api-key: \$FS_SEARCH_API_KEY' 'http://127.0.0.1:8090/stats/samples?sport=tennis&limit=5'" | jq .
ssh scraper-vps "curl -s -H 'x-api-key: \$FS_SEARCH_API_KEY' 'http://127.0.0.1:8090/stats/samples'"
```
Expected:
- First curl: `{"sport":"tennis","reason":"all","count":0,"samples":[]}`
- Second curl: `{"error":"missing_param","param":"sport"}`

- [ ] **Step 6: Provoke a real failed search and verify it gets recorded**

Pick one tennis event with NULL fs_id from the DB, then issue a search. The ingester will do this naturally on its next tick (every ~30s for live tier), but to verify quickly we can curl manually:

```bash
ssh scraper-vps "curl -s -H 'x-api-key: \$FS_SEARCH_API_KEY' \
  'http://127.0.0.1:8090/search?sport_slug=tennis&starts_at=$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)&home=NonExistentPlayerA&away=NonExistentPlayerB'"
# Expected: {"error":"no_match","reason":"name_mismatch" OR "feed_empty" OR "time_window_miss"}

# Then re-curl /stats/samples to verify accumulation:
ssh scraper-vps "curl -s -H 'x-api-key: \$FS_SEARCH_API_KEY' 'http://127.0.0.1:8090/stats/samples?sport=tennis&limit=5'" | jq '.count, .samples[0]'
# Expected: count >= 1 if reason was name_mismatch or time_window_miss
# (if feed was empty for tennis at that time, count stays 0 — try a different starts_at)
```

- [ ] **Step 7: Memory delta check**

```bash
ssh scraper-vps "ps -o rss,cmd -p \$(pgrep -f flashscore-scraper) | tail -1"
```
Compare against pre-deploy RSS (record this in RUNBOOK). Threshold: ≤ +5MB.

- [ ] **Step 8: Append "Deploy log" section to RUNBOOK**

```markdown
## Deploy log

### T-0 baseline (re-captured at deploy time)

[paste baseline-stats-T0-deploy.json]

### Deploy timestamp

[date -u]

### Build/test on VPS

- pnpm vitest run: PASS [N tests]
- pnpm tsc: 0 errors
- pnpm build: success
- systemctl restart: success
- systemctl status: active (running) since [time], [N]ms

### Smoke results

- /stats post-restart: counters reset (uptime_sec=[N])
- /stats/samples?sport=tennis: 200 with empty array [confirmed]
- /stats/samples (no sport): 400 missing_param [confirmed]
- /stats/samples?sport=tennis&reason=invalid: silent ignore, returns "all" [confirmed]
- Forced bad-name search → record appeared in /stats/samples within the same response cycle: [confirmed/issue]
- RSS pre-deploy: [N]MB; post-deploy: [N]MB; delta: [N]MB (threshold +5MB)
```

- [ ] **Step 9: Commit deploy log**

```bash
git add docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/{RUNBOOK.md,baseline-stats-T0-deploy.json}
git commit -m "fs-id B1.A T6: deploy + smoke — instrumentation live on scraper-vps"
```

- [ ] **Step 10: Decide rollback vs proceed**

Rollback trigger (per spec): if step 4-7 fail OR `systemctl status` shows non-active OR memory delta > +5MB OR sample endpoint returns 5xx — revert immediately.

```bash
# ROLLBACK ONLY (skip if all smoke green):
SCRAPER_OLD=docs/superpowers/artifacts/2026-05-06-fs-id-resolver-v2/scraper
scp $SCRAPER_OLD/src/normalize.ts \
    $SCRAPER_OLD/src/search.ts \
    $SCRAPER_OLD/src/server.ts \
    scraper-vps:~/flashscore-scraper/src/
ssh scraper-vps "rm -f ~/flashscore-scraper/src/sample-collector.ts \
                       ~/flashscore-scraper/src/__tests__/sample-collector.test.ts && \
                cd ~/flashscore-scraper && pnpm build && systemctl restart flashscore-scraper.service"
```

If rollback executed: append "ROLLBACK" subsection to RUNBOOK with reason, abort plan, surface to user.

If smoke green: proceed to T7.

---

## Task 7: 1-2h sample accumulation + success criteria validation

**Files:**
- Update: `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/RUNBOOK.md`

**Executor handoff guidance**: Task 7 has a long wait window (60-120 min) that should NOT block a subagent or executor session. After T6 deploy completes successfully, the executor should:
1. Record T6 commit + push,
2. Tell the orchestrator "B1.A deployed, exiting for wait window — resume T7 after ≥60 min",
3. Exit cleanly without polling.

The orchestrator (or a `ScheduleWakeup`-driven follow-up session) re-enters the workflow at T7 Step 1 onwards. The wait is *real wall-clock time for production traffic accumulation*, not a polling gap to fill.

- [ ] **Step 1: Wait 60-120 minutes**

The ingester's tier scheduler (live 30s + imminent 2min + mid 10min + slow 30min + discovery 1h) generates roughly 100-500 /search calls per minute across all sports. After 60min, expect:

- football: ~150-300 samples (all reasons, mostly feed_empty which won't be recorded → ~50-100 recorded)
- tennis: ~80-150 recorded samples (high churn, low ok rate)
- baseball: ~30-50 recorded samples
- others: ≤30 each

- [ ] **Step 2: Capture post-window /stats and /stats/samples**

```bash
ssh scraper-vps "curl -s -H 'x-api-key: \$FS_SEARCH_API_KEY' http://127.0.0.1:8090/stats" \
  | tee docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/post-window-stats.json
ssh scraper-vps "curl -s -H 'x-api-key: \$FS_SEARCH_API_KEY' 'http://127.0.0.1:8090/stats/samples?sport=tennis&reason=name_mismatch&limit=200'" \
  | tee docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/samples-tennis-name_mismatch.json
ssh scraper-vps "curl -s -H 'x-api-key: \$FS_SEARCH_API_KEY' 'http://127.0.0.1:8090/stats/samples?sport=baseball&limit=100'" \
  | tee docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/samples-baseball-all.json
```

- [ ] **Step 3: Verify success criteria**

Compute deltas vs baseline-stats-T0-deploy.json:

| Criterion | Source | Result |
|-----------|--------|--------|
| `tennis.no_match_time / tennis.total` strictly LOWER vs T-0 | post-window-stats.json | [fill] |
| `tennis.ok / tennis.total` ≥ T-0 ratio | post-window-stats.json | [fill] |
| `samples-tennis-name_mismatch.json` count ≥ 100 | jq `.count` | [fill] |
| `samples-baseball-all.json` count ≥ 30 | jq `.count` | [fill] |
| Memory delta ≤ +5MB | ps post / ps pre | [fill] |
| 0 `[sample-collector]` warnings in 1h logs | `journalctl -u flashscore-scraper --since '1 hour ago' \| grep sample-collector` | [fill] |

- [ ] **Step 4: Append "Post-window validation" section to RUNBOOK**

```markdown
## Post-window validation (T+60 to T+120 min)

[paste success criteria table with results]

### Tennis name_mismatch sample preview (first 5 of [N])

[paste 5 tennis samples — gives a flavor of patterns to be mined in B1.B]

### Decision

[ENTER B1.B / EXTEND WAIT WINDOW / INVESTIGATE REGRESSION]

### B1.B handoff

If sample count ≥ 100 and no regressions:
- Spec next: `docs/superpowers/specs/2026-05-07-tennis-fixes-B1B-design.md`
- Input data: `samples-tennis-name_mismatch.json` (frozen snapshot for B1.B fixture data)
- Brainstorm with user on observed patterns (country codes, qualifier markers, doubles separator, etc).
```

- [ ] **Step 5: Commit final RUNBOOK + sample artifacts**

```bash
git add docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/{RUNBOOK.md,post-window-stats.json,samples-*.json}
git commit -m "fs-id B1.A T7: post-window validation + B1.B handoff data captured"
```

- [ ] **Step 6: Push origin**

```bash
git push origin feature/plan-d-settlement-d1
```

Confirm push success. RUNBOOK and all 7 commits live on origin.

---

## Success criteria (B1.A — overall)

All seven criteria from spec § "Success criteria — B1.A":

- [ ] Tests: ≥25 green, 0 typecheck errors
- [ ] /stats/samples endpoint live (200, correct shape)
- [ ] Tennis name_mismatch samples ≥ 100 in 1-2h window
- [ ] Baseball samples ≥ 30 in 1-2h window
- [ ] Tennis no_match_time share strictly LOWER vs T-0
- [ ] Tennis ok ratio ≥ T-0 ratio
- [ ] Memory delta ≤ +5MB
- [ ] 0 sample-collector warnings in 1h logs

If all met: ✅ B1.A SHIPPED. Trigger B1.B brainstorm with `samples-tennis-name_mismatch.json` as input data.

If any fail: investigate, possibly extend wait window, possibly rollback. Surface to user before proceeding to B1.B.

---

## Out-of-scope (deferred to B1.B / B2 / B3 / B4)

- **B1.B**: tennis NOISE_TOKENS_BY_SPORT.tennis + RESERVE_MARKERS_BY_SPORT.tennis populated based on captured samples. Separate brainstorm + spec + plan + impl cycle.
- **B2**: sport_id mapping for darts/boxing/mma/snooker. Independent.
- **B3**: alias mining via /stats/samples (same telemetry endpoint, different consumer). Independent.
- **B4**: rollback trigger doc tighten + resolver helper type tightening. Pure ops/docs.
