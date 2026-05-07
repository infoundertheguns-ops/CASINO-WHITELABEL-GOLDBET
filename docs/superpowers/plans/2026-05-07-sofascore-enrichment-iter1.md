# SofaScore enrichment iter 1 — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data pipeline (scraper + storage + matching) that ingests SofaScore enrichment for calcio/tennis/basket and persists it 1:1 with `events_v2`. No UI in this iter.

**Architecture:** Python scraper service on the existing flashscore-scraper VPS pulls SofaScore via curl_cffi (Chrome131 TLS fingerprint), pushes to two new admin endpoints (`/api/sofascore/fixtures` for daily match-resolution, `/api/sofascore/enrichment` for per-event payload upsert). Storage: new `event_enrichment` table with one jsonb column per SofaScore endpoint + `events_v2.sofascore_id` FK column.

**Tech Stack:** TypeScript (Next.js 14 admin), Python 3.12 (scraper), Supabase Postgres, curl_cffi, vitest, pytest, systemd.

**Spec reference:** `C:\Users\philp\research\sofascore-vs-flashscore\spec.md`

---

## File Structure

### betssolution-admin (existing repo, branch `feature/sofascore-enrichment-iter1` from `feature/plan-d-settlement-d1` HEAD `2314175`)

| Path | Purpose | Type |
|---|---|---|
| `supabase/migrations/180_events_v2_add_sofascore_id.sql` | Add `sofascore_id` BIGINT col + index | Create |
| `supabase/migrations/181_create_event_enrichment.sql` | New table 1:1 events_v2 | Create |
| `app/api/sofascore/fixtures/route.ts` | POST endpoint: match + persist sofascore_id | Create |
| `app/api/sofascore/fixtures/_lib.ts` | Pure helpers: matchSofa, sport mapping | Create |
| `app/api/sofascore/enrichment/route.ts` | POST endpoint: upsert event_enrichment | Create |
| `app/api/sofascore/enrichment/_lib.ts` | Pure helpers: mergeEndpointStatus, partial-payload upsert builder | Create |
| `app/api/sofascore/stats/route.ts` | GET endpoint: ops dashboard JSON | Create |
| `app/api/sofascore/__tests__/fixtures.test.ts` | vitest for match logic | Create |
| `app/api/sofascore/__tests__/enrichment.test.ts` | vitest for upsert logic | Create |
| `app/api/sofascore/__tests__/stats.test.ts` | vitest for stats endpoint | Create |
| `lib/normalize.ts` | Existing tokenizer; add 1 regression test for tennis b/c | Modify |
| `lib/__tests__/normalize.test.ts` | Add regression fixture | Modify |

### sofascore-scraper (NEW Python repo at `/root/sofascore-scraper` on VPS, mirror of flashscore-scraper layout)

| Path | Purpose | Type |
|---|---|---|
| `pyproject.toml` | Project meta + deps (curl_cffi, aiohttp, pytest) | Create |
| `sofascore_scraper/__init__.py` | Package init | Create |
| `sofascore_scraper/config.py` | Env loading + dataclass `Config` | Create |
| `sofascore_scraper/client.py` | curl_cffi wrapper, rate-limit, jitter, backoff | Create |
| `sofascore_scraper/admin_api.py` | POST helpers to `/api/sofascore/*` (auth header) | Create |
| `sofascore_scraper/discovery.py` | Daily scheduled-events pull + push to admin | Create |
| `sofascore_scraper/scheduler.py` | Tier classification, due-event selection | Create |
| `sofascore_scraper/worker.py` | Fetch all 10 endpoints for an event, push enrichment | Create |
| `sofascore_scraper/health.py` | :9090/health endpoint via aiohttp | Create |
| `sofascore_scraper/main.py` | Entry point, asyncio orchestrator | Create |
| `tests/test_client.py` | client unit tests | Create |
| `tests/test_scheduler.py` | tier + due-event logic | Create |
| `tests/test_worker.py` | worker fetch loop | Create |
| `tests/test_discovery.py` | discovery payload shape | Create |
| `.env.example` | Documented env contract | Create |
| `systemd/sofascore-scraper.service` | systemd unit for VPS | Create |
| `README.md` | Deploy + ops runbook | Create |

---

## Task overview

| # | Task | Owner area | Est min |
|---|---|---|---:|
| T0 | Worktree + branch setup | infra | 10 |
| T1 | Migration 180: add `events_v2.sofascore_id` | DB | 15 |
| T2 | Migration 181: create `event_enrichment` table | DB | 15 |
| T3 | normalize.ts regression test (tennis b/c) | admin lib | 10 |
| T4 | `_lib.ts` for fixtures (sport mapping + matchSofa) | admin | 25 |
| T5 | `/api/sofascore/fixtures` route + tests | admin | 35 |
| T6 | `_lib.ts` for enrichment (mergeEndpointStatus) | admin | 20 |
| T7 | `/api/sofascore/enrichment` route + tests | admin | 35 |
| T8 | `/api/sofascore/stats` route + tests | admin | 20 |
| T9 | scraper Python skeleton (pyproject, config, .env.example) | scraper | 20 |
| T10 | scraper `client.py` (rate-limit + curl_cffi wrapper) + tests | scraper | 35 |
| T11 | scraper `admin_api.py` + tests | scraper | 20 |
| T12 | scraper `discovery.py` + tests | scraper | 25 |
| T13 | scraper `scheduler.py` (tier classification + due-events) + tests | scraper | 30 |
| T14 | scraper `worker.py` (fetch+push loop) + tests | scraper | 35 |
| T15 | scraper `health.py` + `main.py` orchestrator | scraper | 25 |
| T16 | systemd unit + README deploy runbook | scraper | 15 |
| T17 | Phase-0 measurement gate config (24h dry-run mode) | scraper | 15 |
| T18 | Smoke test post-deploy + monitoring runbook | docs | 15 |

Stimato totale: ~7h focused work. Suggerito subagent-driven con checkpoint a T2/T8/T15.

---

## Task 0 — Worktree + branch setup

**Files:**
- Modify: working tree (branch creation)
- Create: `/root/sofascore-scraper/` directory on VPS (later T9)

- [ ] **Step 1: Create worktree branch**

```bash
cd /path/to/betssolution-admin
git fetch origin
git worktree add ../bes-admin-sofa-iter1 -b feature/sofascore-enrichment-iter1 feature/plan-d-settlement-d1
cd ../bes-admin-sofa-iter1
```

Expected: new worktree at `../bes-admin-sofa-iter1` on fresh branch `feature/sofascore-enrichment-iter1`.

- [ ] **Step 2: Verify HEAD**

```bash
git log -1 --oneline
```

Expected: HEAD at `2314175` (or whatever current head of `feature/plan-d-settlement-d1` is).

- [ ] **Step 3: Confirm tooling**

```bash
pnpm install
pnpm tsc --noEmit
pnpm vitest --run
```

Expected: install succeeds, tsc 0 errors, all tests pass (baseline ~75/75 from MEMORY).

- [ ] **Step 4: Initial commit (empty marker)**

```bash
git commit --allow-empty -m "chore: open sofascore enrichment iter 1 branch

Spec: docs/superpowers/specs/2026-05-07-sofascore-enrichment-iter1-design.md
Plan: docs/superpowers/plans/2026-05-07-sofascore-enrichment-iter1.md"
```

- [ ] **Step 5: Copy spec + plan to repo docs**

```bash
cp /c/Users/philp/research/sofascore-vs-flashscore/spec.md docs/superpowers/specs/2026-05-07-sofascore-enrichment-iter1-design.md
cp /c/Users/philp/research/sofascore-vs-flashscore/plan.md docs/superpowers/plans/2026-05-07-sofascore-enrichment-iter1.md
git add docs/superpowers/
git commit -m "docs: add sofascore enrichment spec + plan"
```

---

## Task 1 — Migration 180: add `events_v2.sofascore_id`

**Files:**
- Create: `supabase/migrations/180_events_v2_add_sofascore_id.sql`
- Test: manual psql check + idempotent re-apply

- [ ] **Step 1: Verify next free migration number**

```bash
ls supabase/migrations/ | sort -n | tail -5
```

Expected: latest is `179_*.sql` (per MEMORY ghost-live cleanup); next free = 180.

- [ ] **Step 2: Write migration**

```sql
-- supabase/migrations/180_events_v2_add_sofascore_id.sql
-- Add SofaScore foreign-id column to events_v2.
-- Mirror of flashscore_id pattern. Nullable, no FK, indexed for direct lookup.

ALTER TABLE events_v2 ADD COLUMN IF NOT EXISTS sofascore_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_events_v2_sofascore_id
  ON events_v2 (sofascore_id) WHERE sofascore_id IS NOT NULL;

-- Rollback (manual):
--   DROP INDEX IF EXISTS idx_events_v2_sofascore_id;
--   ALTER TABLE events_v2 DROP COLUMN IF EXISTS sofascore_id;
```

- [ ] **Step 3: Apply locally (dev DB)**

```bash
psql $DATABASE_URL_DEV -f supabase/migrations/180_events_v2_add_sofascore_id.sql
```

Expected: `ALTER TABLE` + `CREATE INDEX` both succeed.

- [ ] **Step 4: Verify shape**

```bash
psql $DATABASE_URL_DEV -c "\d events_v2" | grep sofascore
psql $DATABASE_URL_DEV -c "\di events_v2*" | grep sofascore
```

Expected: column exists, index exists.

- [ ] **Step 5: Verify idempotency (re-apply)**

```bash
psql $DATABASE_URL_DEV -f supabase/migrations/180_events_v2_add_sofascore_id.sql
```

Expected: NOTICE messages about column/index already existing, no error.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/180_events_v2_add_sofascore_id.sql
git commit -m "feat(db): mig 180 add events_v2.sofascore_id"
```

---

## Task 2 — Migration 181: create `event_enrichment` table

**Files:**
- Create: `supabase/migrations/181_create_event_enrichment.sql`

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/181_create_event_enrichment.sql
-- New table for SofaScore enrichment payloads, 1:1 with events_v2.

CREATE TABLE IF NOT EXISTS event_enrichment (
  event_v2_id          UUID PRIMARY KEY REFERENCES events_v2(id) ON DELETE CASCADE,
  sofa_event_id        BIGINT NOT NULL UNIQUE,
  sport_slug           TEXT NOT NULL,

  -- 10 endpoint payloads (jsonb, nullable, independently populated)
  stats                JSONB,
  lineups              JSONB,
  incidents            JSONB,
  momentum             JSONB,
  shotmap              JSONB,
  best_players         JSONB,
  highlights           JSONB,
  comments             JSONB,
  votes                JSONB,
  featured_players     JSONB,

  -- telemetry
  last_synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_endpoint_status JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_enrichment_last_synced
  ON event_enrichment (last_synced_at);

CREATE INDEX IF NOT EXISTS idx_event_enrichment_sport_slug
  ON event_enrichment (sport_slug);

-- Rollback: DROP TABLE event_enrichment;
```

- [ ] **Step 2: Apply locally**

```bash
psql $DATABASE_URL_DEV -f supabase/migrations/181_create_event_enrichment.sql
psql $DATABASE_URL_DEV -c "\d event_enrichment"
```

Expected: table exists with all 10 jsonb cols + telemetry cols + 2 indexes.

- [ ] **Step 3: Verify cascade delete**

```bash
psql $DATABASE_URL_DEV <<EOF
INSERT INTO events_v2 (id, sport_slug, home, away, starts_at, status)
  VALUES ('00000000-0000-0000-0000-000000000001', 'calcio', 'A', 'B', now(), 'prematch');
INSERT INTO event_enrichment (event_v2_id, sofa_event_id, sport_slug)
  VALUES ('00000000-0000-0000-0000-000000000001', 99999999, 'calcio');
DELETE FROM events_v2 WHERE id = '00000000-0000-0000-0000-000000000001';
SELECT count(*) FROM event_enrichment WHERE sofa_event_id = 99999999;
EOF
```

Expected: final count = 0 (cascade worked).

- [ ] **Step 4: Verify UNIQUE on sofa_event_id**

```bash
psql $DATABASE_URL_DEV <<EOF
INSERT INTO events_v2 (id, sport_slug, home, away, starts_at, status) VALUES
  ('00000000-0000-0000-0000-000000000002', 'calcio', 'A', 'B', now(), 'prematch'),
  ('00000000-0000-0000-0000-000000000003', 'calcio', 'C', 'D', now(), 'prematch');
INSERT INTO event_enrichment (event_v2_id, sofa_event_id, sport_slug)
  VALUES ('00000000-0000-0000-0000-000000000002', 88888888, 'calcio');
INSERT INTO event_enrichment (event_v2_id, sofa_event_id, sport_slug)
  VALUES ('00000000-0000-0000-0000-000000000003', 88888888, 'calcio');
EOF
```

Expected: second INSERT fails with `duplicate key value violates unique constraint`. Cleanup test rows after.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/181_create_event_enrichment.sql
git commit -m "feat(db): mig 181 create event_enrichment table"
```

---

## Task 3 — normalize.ts regression test (tennis b/c initials)

**Files:**
- Modify: `lib/__tests__/normalize.test.ts:end-of-file`
- Reference: existing `lib/normalize.ts` (already has _TENNIS_NOISE post-B1.B per MEMORY)

- [ ] **Step 1: Add regression fixture**

Append to `lib/__tests__/normalize.test.ts`:

```typescript
describe("regression: tennis b/c initials don't collide with RESERVE_MARKERS", () => {
  it("matches 'Bayldon B / Veldheer M' against itself with score >= 0.9", () => {
    expect(matchTeams("Bayldon B / Veldheer M", "Bayldon B / Veldheer M", "tennis")).toBeGreaterThanOrEqual(0.9);
  });

  it("does NOT match 'Bayldon B' against unrelated 'Squadra B'", () => {
    expect(matchTeams("Bayldon B", "Squadra B", "tennis")).toBeLessThan(0.5);
  });

  it("matches 'Reymond A / Sanchez L' across formatting variants", () => {
    expect(matchTeams("Reymond A / Sanchez L", "Reymond A/Sanchez L", "tennis")).toBeGreaterThanOrEqual(0.9);
  });
});
```

- [ ] **Step 2: Run test to verify it passes (regression — should already work post-B1.B)**

```bash
pnpm vitest run lib/__tests__/normalize.test.ts
```

Expected: all 3 new tests PASS. If any fails, that's a real regression in the existing `normalize.ts` — STOP and surface to user before continuing.

- [ ] **Step 3: Commit**

```bash
git add lib/__tests__/normalize.test.ts
git commit -m "test(normalize): regression guard tennis b/c initials"
```

---

## Task 4 — `app/api/sofascore/fixtures/_lib.ts`

**Files:**
- Create: `app/api/sofascore/fixtures/_lib.ts`
- Test: `app/api/sofascore/__tests__/fixtures.test.ts` (created in T5)

This task implements the pure logic for sport mapping + match selection. No HTTP, no DB. Easy to unit-test.

- [ ] **Step 1: Write the failing test (in advance, save to test file)**

Create `app/api/sofascore/__tests__/fixtures.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mapSofaSport, matchSofaToCandidate, type SofaFixture, type Candidate } from "../fixtures/_lib";

describe("mapSofaSport", () => {
  it("maps known sports", () => {
    expect(mapSofaSport("football")).toBe("calcio");
    expect(mapSofaSport("tennis")).toBe("tennis");
    expect(mapSofaSport("basketball")).toBe("basket");
  });
  it("returns null for unknown", () => {
    expect(mapSofaSport("snooker")).toBeNull();
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
    sport_slug: "calcio",
    home: "Bayern Munich",
    away: "PSG",
    starts_at: "2026-05-07T19:05:00Z",  // 5min off
    status: "live",
    sofascore_id: null,
  };

  it("returns 'matched_fuzzy' on close name + kickoff", () => {
    const r = matchSofaToCandidate(baseFx, [baseC]);
    expect(r.kind).toBe("matched_fuzzy");
    if (r.kind === "matched_fuzzy") expect(r.candidate.id).toBe("uuid-1");
  });

  it("returns 'matched_direct' when candidate already has sofascore_id", () => {
    const r = matchSofaToCandidate(baseFx, [{ ...baseC, sofascore_id: 1 }]);
    expect(r.kind).toBe("matched_direct");
  });

  it("returns 'no_time_window' when kickoff diff > 20min", () => {
    const r = matchSofaToCandidate(baseFx, [{ ...baseC, starts_at: "2026-05-07T20:30:00Z" }]);
    expect(r.kind).toBe("no_time_window");
  });

  it("returns 'no_match_name' when names too different", () => {
    const r = matchSofaToCandidate(baseFx, [{ ...baseC, home: "Inter Milan", away: "AC Milan" }]);
    expect(r.kind).toBe("no_match_name");
  });

  it("does NOT match across sports (calcio vs basket)", () => {
    const r = matchSofaToCandidate(baseFx, [{ ...baseC, sport_slug: "basket" }]);
    expect(r.kind).toBe("no_time_window");  // filtered before name match
  });

  it("ignores already-mapped candidates with different sofa_event_id", () => {
    const r = matchSofaToCandidate(baseFx, [{ ...baseC, sofascore_id: 99 }]);
    expect(r.kind).toBe("no_time_window");  // sofascore_id != fx.sofa_event_id and not null → filtered
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run app/api/sofascore/__tests__/fixtures.test.ts
```

Expected: FAIL — module `../fixtures/_lib` not found.

- [ ] **Step 3: Implement `_lib.ts`**

Create `app/api/sofascore/fixtures/_lib.ts`:

```typescript
import { matchTeams } from "@/lib/normalize";

export const TIME_TOLERANCE_SEC = 20 * 60;

const SOFA_TO_VINCITU: Record<string, "calcio" | "tennis" | "basket"> = {
  football: "calcio",
  tennis: "tennis",
  basketball: "basket",
};

export function mapSofaSport(s: string): "calcio" | "tennis" | "basket" | null {
  return SOFA_TO_VINCITU[s] ?? null;
}

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

export function matchSofaToCandidate(fx: SofaFixture, pool: Candidate[]): MatchResult {
  const vincituSport = mapSofaSport(fx.sofa_sport);
  if (!vincituSport) return { kind: "skipped_unknown_sport" };

  // 1. direct lookup
  const direct = pool.find(c => c.sofascore_id === fx.sofa_event_id);
  if (direct) return { kind: "matched_direct", candidate: direct };

  // 2. time window filter (and exclude already-mapped to OTHER sofa events)
  const fxTime = new Date(fx.kickoff_at).getTime() / 1000;
  const inWindow = pool.filter(c =>
    c.sport_slug === vincituSport &&
    c.sofascore_id == null &&
    Math.abs(new Date(c.starts_at).getTime() / 1000 - fxTime) <= TIME_TOLERANCE_SEC
  );
  if (inWindow.length === 0) return { kind: "no_time_window" };

  // 3. token-based name match
  let best: { c: Candidate; score: number } | null = null;
  for (const c of inWindow) {
    const hScore = matchTeams(c.home, fx.home, vincituSport);
    const aScore = matchTeams(c.away, fx.away, vincituSport);
    if (hScore < 0.5 || aScore < 0.5) continue;
    const combined = hScore + aScore;
    if (!best || combined > best.score) best = { c, score: combined };
  }
  if (!best || best.score <= 1.0) return { kind: "no_match_name" };

  return { kind: "matched_fuzzy", candidate: best.c, score: best.score };
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm vitest run app/api/sofascore/__tests__/fixtures.test.ts
```

Expected: 6/6 PASS.

- [ ] **Step 5: tsc check**

```bash
pnpm tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/sofascore/fixtures/_lib.ts app/api/sofascore/__tests__/fixtures.test.ts
git commit -m "feat(sofascore): fixtures match logic + tests"
```

---

## Task 5 — `/api/sofascore/fixtures` route

**Files:**
- Create: `app/api/sofascore/fixtures/route.ts`
- Modify: `app/api/sofascore/__tests__/fixtures.test.ts:append integration test`

- [ ] **Step 0: Verify `system_config` table exists (used by route + /stats endpoint)**

```bash
psql $DATABASE_URL_DEV -c "\d system_config"
```

Expected: table exists with `key text PK, value jsonb` shape (created by prior FS scraper / Plan D migration). If missing, add `CREATE TABLE IF NOT EXISTS system_config (key TEXT PRIMARY KEY, value JSONB)` to migration 180 before applying.

- [ ] **Step 1: Add integration test (mocked supabase)**

Append to `app/api/sofascore/__tests__/fixtures.test.ts`:

```typescript
import { POST } from "../fixtures/route";
// + mock supabase client per project conventions (see app/api/flashscore/fixtures/__tests__/ for pattern)

describe("POST /api/sofascore/fixtures", () => {
  it("rejects without scraper key", async () => {
    const req = new Request("http://localhost/api/sofascore/fixtures", { method: "POST", body: "{}" });
    const res = await POST(req as any);
    expect(res.status).toBe(401);
  });

  it("processes fixtures and returns stats + matched array", async () => {
    // mock: 2 candidates in events_v2 (1 calcio, 1 basket)
    // input: 3 fixtures (1 matches calcio, 1 unmatched, 1 unknown sport)
    // assert: response.matched_fuzzy=1, no_match_name or no_time_window=1, skipped_unknown_sport=1
  });

  it("includes recently-finished events in candidate pool", async () => {
    // mock: candidate with status='settled' starts_at=NOW()-3h
    // input: matching fixture
    // assert: matched_fuzzy=1
  });
});
```

(Detailed mocks follow the pattern in `app/api/flashscore/fixtures/__tests__/`.)

- [ ] **Step 2: Run integration tests, verify FAIL**

```bash
pnpm vitest run app/api/sofascore/__tests__/fixtures.test.ts
```

Expected: integration tests FAIL (route module missing).

- [ ] **Step 3: Implement route**

Create `app/api/sofascore/fixtures/route.ts`:

```typescript
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { matchSofaToCandidate, type SofaFixture, type Candidate } from "./_lib";

interface MatchedRow {
  sofa_event_id: number;
  event_v2_id: string;
  sport_slug: string;
  kickoff_at: string;
  sofa_status: string;
}

export async function POST(req: NextRequest) {
  if (req.headers.get("x-scraper-key") !== process.env.SCRAPER_API_KEY) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { fixtures } = (await req.json()) as { fixtures: SofaFixture[] };
  if (!Array.isArray(fixtures)) {
    return NextResponse.json({ error: "fixtures must be array" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // candidate pool: prematch + live + recently-finished (≤6h)
  const sixHoursAgoIso = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const { data: rows, error: poolErr } = await supabase
    .from("events_v2")
    .select("id, sport_slug, home, away, starts_at, status, sofascore_id")
    .in("sport_slug", ["calcio", "tennis", "basket"])
    .or(
      `status.in.(prematch,live),and(status.eq.settled,starts_at.gte.${sixHoursAgoIso})`
    )
    .limit(5000);
  if (poolErr || !rows) {
    return NextResponse.json({ error: poolErr?.message ?? "pool fetch failed" }, { status: 500 });
  }
  const pool = rows as Candidate[];

  const stats = {
    received: fixtures.length,
    matched_direct: 0,
    matched_fuzzy: 0,
    no_time_window: 0,
    no_match_name: 0,
    skipped_unknown_sport: 0,
  };
  const matched: MatchedRow[] = [];
  const persistUpdates: Array<{ id: string; sofascore_id: number }> = [];

  for (const fx of fixtures) {
    const r = matchSofaToCandidate(fx, pool);
    switch (r.kind) {
      case "matched_direct":
        stats.matched_direct++;
        matched.push({
          sofa_event_id: fx.sofa_event_id,
          event_v2_id: r.candidate.id,
          sport_slug: r.candidate.sport_slug,
          kickoff_at: r.candidate.starts_at,
          sofa_status: fx.sofa_status,
        });
        break;
      case "matched_fuzzy":
        stats.matched_fuzzy++;
        persistUpdates.push({ id: r.candidate.id, sofascore_id: fx.sofa_event_id });
        matched.push({
          sofa_event_id: fx.sofa_event_id,
          event_v2_id: r.candidate.id,
          sport_slug: r.candidate.sport_slug,
          kickoff_at: r.candidate.starts_at,
          sofa_status: fx.sofa_status,
        });
        // mutate pool entry so subsequent fixtures don't re-match same candidate
        r.candidate.sofascore_id = fx.sofa_event_id;
        break;
      case "no_time_window":
        stats.no_time_window++;
        break;
      case "no_match_name":
        stats.no_match_name++;
        break;
      case "skipped_unknown_sport":
        stats.skipped_unknown_sport++;
        break;
    }
  }

  // Bulk persist
  for (const u of persistUpdates) {
    await supabase.from("events_v2").update({ sofascore_id: u.sofascore_id }).eq("id", u.id);
  }
  await supabase
    .from("system_config")
    .upsert(
      { key: "last_run_sofascore_fixtures", value: JSON.stringify(new Date().toISOString()) },
      { onConflict: "key" }
    );

  console.log(`[sofascore/fixtures] ${JSON.stringify(stats)}`);
  return NextResponse.json({ ...stats, matched });
}
```

- [ ] **Step 4: Run tests until pass**

```bash
pnpm vitest run app/api/sofascore/__tests__/fixtures.test.ts
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add app/api/sofascore/fixtures/route.ts app/api/sofascore/__tests__/fixtures.test.ts
git commit -m "feat(sofascore): /api/sofascore/fixtures route"
```

---

## Task 6 — `app/api/sofascore/enrichment/_lib.ts`

**Files:**
- Create: `app/api/sofascore/enrichment/_lib.ts`
- Test: `app/api/sofascore/__tests__/enrichment.test.ts` (created here)

- [ ] **Step 1: Write failing tests**

Create `app/api/sofascore/__tests__/enrichment.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  buildPartialUpsert,
  mergeEndpointStatus,
  type EnrichmentPayload,
  type EndpointStatus,
} from "../enrichment/_lib";

describe("buildPartialUpsert", () => {
  it("includes only payloads keys explicitly provided (incl. null)", () => {
    const input: EnrichmentPayload = {
      stats: { foo: 1 },
      lineups: null,
      // incidents intentionally undefined
    };
    const result = buildPartialUpsert(input);
    expect(result).toHaveProperty("stats", { foo: 1 });
    expect(result).toHaveProperty("lineups", null);
    expect(result).not.toHaveProperty("incidents");
  });

  it("returns empty object when payloads empty", () => {
    expect(buildPartialUpsert({})).toEqual({});
  });
});

describe("mergeEndpointStatus", () => {
  it("preserves untouched endpoint status keys (shallow merge)", () => {
    const prior: Record<string, EndpointStatus> = {
      stats: { ok: true, http: 200, size: 100, ts: "T1" },
      lineups: { ok: false, http: 404, size: 0, ts: "T1" },
    };
    const next: Record<string, EndpointStatus> = {
      stats: { ok: true, http: 200, size: 200, ts: "T2" },
    };
    const merged = mergeEndpointStatus(prior, next);
    expect(merged.stats.ts).toBe("T2");
    expect(merged.stats.size).toBe(200);
    expect(merged.lineups.ts).toBe("T1");  // untouched
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
pnpm vitest run app/api/sofascore/__tests__/enrichment.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `_lib.ts`**

Create `app/api/sofascore/enrichment/_lib.ts`:

```typescript
export const ENRICHMENT_KEYS = [
  "stats", "lineups", "incidents", "momentum", "shotmap",
  "best_players", "highlights", "comments", "votes", "featured_players",
] as const;

export type EnrichmentKey = typeof ENRICHMENT_KEYS[number];

export type EnrichmentPayload = Partial<Record<EnrichmentKey, unknown | null>>;

export interface EndpointStatus {
  ok: boolean;
  http: number;
  size: number;
  ts: string;
}

/**
 * Build the SQL UPDATE/INSERT column set from an enrichment payload.
 * - keys explicitly present in input (including null) → include in output
 * - keys absent (undefined) → omit (preserve existing column value on update)
 */
export function buildPartialUpsert(payload: EnrichmentPayload): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ENRICHMENT_KEYS) {
    if (k in payload) out[k] = payload[k] ?? null;
  }
  return out;
}

/**
 * Merge new endpoint status onto prior, key-by-key. Untouched endpoints retain their prior status.
 */
export function mergeEndpointStatus(
  prior: Record<string, EndpointStatus>,
  next: Record<string, EndpointStatus>
): Record<string, EndpointStatus> {
  return { ...prior, ...next };
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm vitest run app/api/sofascore/__tests__/enrichment.test.ts
```

Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/sofascore/enrichment/_lib.ts app/api/sofascore/__tests__/enrichment.test.ts
git commit -m "feat(sofascore): enrichment partial-upsert helpers"
```

---

## Task 7 — `/api/sofascore/enrichment` route

**Files:**
- Create: `app/api/sofascore/enrichment/route.ts`
- Modify: `app/api/sofascore/__tests__/enrichment.test.ts:append integration tests`

- [ ] **Step 1: Add integration test cases**

Append to `app/api/sofascore/__tests__/enrichment.test.ts`:

```typescript
import { POST } from "../enrichment/route";

describe("POST /api/sofascore/enrichment", () => {
  it("rejects without scraper key", async () => {
    const req = new Request("http://localhost/api/sofascore/enrichment", { method: "POST", body: "{}" });
    const res = await POST(req as any);
    expect(res.status).toBe(401);
  });

  it("inserts new event_enrichment row when sofa_event_id matches events_v2.sofascore_id", async () => {
    // mock supabase: events_v2 has row with sofascore_id=1; event_enrichment empty
    // POST {sofa_event_id:1, sport_slug:'calcio', payloads:{stats:{x:1}}, endpoint_status:{stats:{ok:true,...}}}
    // assert: 200, single insert, stats column populated
  });

  it("returns 404 when sofa_event_id has no matching events_v2 row", async () => {
    // mock: no events_v2 with sofascore_id=999
    // POST {sofa_event_id:999, ...}
    // assert: 404
  });

  it("partial update preserves untouched columns", async () => {
    // mock: existing row with stats={x:1}, lineups={y:2}
    // POST {sofa_event_id:..., payloads:{stats:{x:99}}}  // lineups undefined
    // assert: stats={x:99}, lineups still {y:2}
  });

  it("merges last_endpoint_status preserving prior keys", async () => {
    // mock: existing row with last_endpoint_status={stats:{ts:T1},lineups:{ts:T1}}
    // POST {endpoint_status:{stats:{ts:T2}}}
    // assert: lineups.ts still T1, stats.ts now T2
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
pnpm vitest run app/api/sofascore/__tests__/enrichment.test.ts
```

Expected: integration tests FAIL.

- [ ] **Step 3: Implement route**

Create `app/api/sofascore/enrichment/route.ts`:

```typescript
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  buildPartialUpsert,
  mergeEndpointStatus,
  type EnrichmentPayload,
  type EndpointStatus,
} from "./_lib";

interface Body {
  sofa_event_id: number;
  sport_slug: "calcio" | "tennis" | "basket";
  payloads: EnrichmentPayload;
  endpoint_status: Record<string, EndpointStatus>;
}

export async function POST(req: NextRequest) {
  if (req.headers.get("x-scraper-key") !== process.env.SCRAPER_API_KEY) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json()) as Body;
  if (!body.sofa_event_id || !body.sport_slug) {
    return NextResponse.json({ error: "missing required fields" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // resolve event_v2_id
  const { data: ev2, error: ev2Err } = await supabase
    .from("events_v2")
    .select("id")
    .eq("sofascore_id", body.sofa_event_id)
    .maybeSingle();
  if (ev2Err) return NextResponse.json({ error: ev2Err.message }, { status: 500 });
  if (!ev2) return NextResponse.json({ error: "no events_v2 row for sofa_event_id" }, { status: 404 });

  const partialCols = buildPartialUpsert(body.payloads);
  const now = new Date().toISOString();

  // fetch prior endpoint_status to merge
  const { data: prior } = await supabase
    .from("event_enrichment")
    .select("last_endpoint_status")
    .eq("event_v2_id", ev2.id)
    .maybeSingle();
  const merged = mergeEndpointStatus(
    (prior?.last_endpoint_status as Record<string, EndpointStatus>) ?? {},
    body.endpoint_status ?? {}
  );

  const { error: upErr } = await supabase
    .from("event_enrichment")
    .upsert(
      {
        event_v2_id: ev2.id,
        sofa_event_id: body.sofa_event_id,
        sport_slug: body.sport_slug,
        ...partialCols,
        last_synced_at: now,
        last_endpoint_status: merged,
      },
      { onConflict: "event_v2_id" }
    );
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // record last run timestamp (cheap, used by /stats)
  await supabase.from("system_config").upsert(
    { key: "last_run_sofascore_enrichment", value: JSON.stringify(now) },
    { onConflict: "key" }
  );

  return NextResponse.json({ ok: true, event_v2_id: ev2.id });
}
```

- [ ] **Step 4: Run tests until pass**

```bash
pnpm vitest run app/api/sofascore/__tests__/enrichment.test.ts
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add app/api/sofascore/enrichment/route.ts app/api/sofascore/__tests__/enrichment.test.ts
git commit -m "feat(sofascore): /api/sofascore/enrichment route"
```

---

## Task 8 — `/api/sofascore/stats` route

**Files:**
- Create: `app/api/sofascore/stats/route.ts`
- Test: `app/api/sofascore/__tests__/stats.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// app/api/sofascore/__tests__/stats.test.ts
import { describe, it, expect } from "vitest";
import { GET } from "../stats/route";

describe("GET /api/sofascore/stats", () => {
  it("returns matched_total + by_sport + by_endpoint_freshness shape", async () => {
    // mock: 5 events_v2 with sofascore_id (3 calcio, 2 tennis)
    //       3 event_enrichment rows (stats populated 3/3, lineups 1/3)
    const req = new Request("http://localhost/api/sofascore/stats");
    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.matched_total).toBe(5);
    expect(j.by_sport.calcio).toBe(3);
    expect(j.by_sport.tennis).toBe(2);
    expect(j.by_endpoint_freshness.stats.populated_pct).toBeCloseTo(100);
    expect(j.by_endpoint_freshness.lineups.populated_pct).toBeCloseTo(33.3, 0);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
pnpm vitest run app/api/sofascore/__tests__/stats.test.ts
```

- [ ] **Step 3: Implement**

Create `app/api/sofascore/stats/route.ts`:

```typescript
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ENRICHMENT_KEYS } from "../enrichment/_lib";

export async function GET(_req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // matched_total + by_sport
  const { data: matched } = await supabase
    .from("events_v2")
    .select("sport_slug")
    .not("sofascore_id", "is", null)
    .in("sport_slug", ["calcio", "tennis", "basket"]);
  const by_sport = { calcio: 0, tennis: 0, basket: 0 };
  for (const r of matched ?? []) {
    by_sport[r.sport_slug as keyof typeof by_sport]++;
  }

  // by_endpoint_freshness: % of event_enrichment rows where each col is non-null + median age
  const { data: rows } = await supabase
    .from("event_enrichment")
    .select(`event_v2_id, last_synced_at, ${ENRICHMENT_KEYS.join(", ")}`);

  const total = rows?.length ?? 0;
  const by_endpoint_freshness: Record<string, { populated_pct: number; median_age_s: number }> = {};
  const now = Date.now();
  for (const k of ENRICHMENT_KEYS) {
    let populated = 0;
    const ages: number[] = [];
    for (const r of rows ?? []) {
      if ((r as any)[k] != null) {
        populated++;
        ages.push((now - new Date(r.last_synced_at).getTime()) / 1000);
      }
    }
    ages.sort((a, b) => a - b);
    const median = ages.length ? ages[Math.floor(ages.length / 2)] : 0;
    by_endpoint_freshness[k] = {
      populated_pct: total ? (100 * populated) / total : 0,
      median_age_s: Math.round(median),
    };
  }

  // last_run timestamps
  const { data: lastRunsRaw } = await supabase
    .from("system_config")
    .select("key, value")
    .in("key", ["last_run_sofascore_fixtures", "last_run_sofascore_enrichment"]);
  const last_run_at: Record<string, string | null> = {};
  for (const r of lastRunsRaw ?? []) last_run_at[r.key] = JSON.parse(r.value as string);

  return NextResponse.json({
    matched_total: matched?.length ?? 0,
    by_sport,
    by_endpoint_freshness,
    last_run_at,
  });
}
```

- [ ] **Step 4: Tests pass**

```bash
pnpm vitest run app/api/sofascore/__tests__/stats.test.ts
pnpm tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add app/api/sofascore/stats/route.ts app/api/sofascore/__tests__/stats.test.ts
git commit -m "feat(sofascore): /api/sofascore/stats endpoint"
```

---

## Task 9 — Python scraper skeleton

**Files:**
- Create: `/root/sofascore-scraper/pyproject.toml`
- Create: `/root/sofascore-scraper/sofascore_scraper/__init__.py`
- Create: `/root/sofascore-scraper/sofascore_scraper/config.py`
- Create: `/root/sofascore-scraper/.env.example`
- Create: `/root/sofascore-scraper/tests/__init__.py`
- Create: `/root/sofascore-scraper/tests/test_config.py`

This task creates a NEW git repo on the same VPS (or initially in a new local worktree, then pushed).

- [ ] **Step 1: Create directory + git init**

```bash
mkdir -p /root/sofascore-scraper/sofascore_scraper
mkdir -p /root/sofascore-scraper/tests
mkdir -p /root/sofascore-scraper/systemd
cd /root/sofascore-scraper
git init -b main
```

- [ ] **Step 2: pyproject.toml**

```toml
[project]
name = "sofascore-scraper"
version = "0.1.0"
description = "SofaScore enrichment scraper for vincitu (sister of flashscore-scraper)"
requires-python = ">=3.11"
dependencies = [
  "curl_cffi>=0.7.0",
  "aiohttp>=3.9.0",
  "python-dotenv>=1.0.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "pytest-asyncio>=0.23", "pytest-mock>=3.12"]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

- [ ] **Step 3: .env.example**

```
SOFA_SCRAPER_ENABLED=true
SOFA_ENRICHMENT_SPORTS=calcio,tennis,basket
SOFA_LIVE_INTERVAL_S=60
SOFA_PREMATCH_INTERVAL_S=1800
SOFA_RATE_LIMIT_RPS=2.5
SOFA_BACKOFF_MAX_S=600
SOFA_WORKER_POOL_SIZE=4
SOFA_DISCOVERY_HOUR_UTC=4
SOFA_PHASE_0_MEASURE_MODE=false   # if true, only stats+incidents endpoints fetched
ADMIN_API_BASE=https://admin.vincitu.it
SCRAPER_API_KEY=replace-me
SOFA_HEALTH_PORT=9090
```

- [ ] **Step 4: Write failing test for config loader**

`tests/test_config.py`:

```python
import os
import pytest
from sofascore_scraper.config import Config

def test_load_from_env(monkeypatch):
    monkeypatch.setenv("SOFA_SCRAPER_ENABLED", "true")
    monkeypatch.setenv("SOFA_ENRICHMENT_SPORTS", "calcio,tennis")
    monkeypatch.setenv("SOFA_LIVE_INTERVAL_S", "60")
    monkeypatch.setenv("SOFA_PREMATCH_INTERVAL_S", "1800")
    monkeypatch.setenv("SOFA_RATE_LIMIT_RPS", "2.5")
    monkeypatch.setenv("SOFA_BACKOFF_MAX_S", "600")
    monkeypatch.setenv("SOFA_WORKER_POOL_SIZE", "4")
    monkeypatch.setenv("SOFA_DISCOVERY_HOUR_UTC", "4")
    monkeypatch.setenv("SOFA_PHASE_0_MEASURE_MODE", "false")
    monkeypatch.setenv("ADMIN_API_BASE", "https://admin.test")
    monkeypatch.setenv("SCRAPER_API_KEY", "key")
    monkeypatch.setenv("SOFA_HEALTH_PORT", "9090")
    c = Config.from_env()
    assert c.enabled is True
    assert c.sports == ["calcio", "tennis"]
    assert c.live_interval_s == 60
    assert c.rate_limit_rps == 2.5
    assert c.phase_0_measure_mode is False
    assert c.admin_api_base == "https://admin.test"

def test_phase_0_mode_endpoint_subset():
    c = Config(enabled=True, sports=["calcio"], live_interval_s=60, prematch_interval_s=1800,
               rate_limit_rps=2.5, backoff_max_s=600, worker_pool_size=4, discovery_hour_utc=4,
               phase_0_measure_mode=True, admin_api_base="x", scraper_api_key="x", health_port=9090)
    assert c.live_endpoints() == ["statistics", "incidents"]
    assert c.prematch_endpoints() == []
```

- [ ] **Step 5: Run, verify FAIL**

```bash
cd /root/sofascore-scraper
pip install -e ".[dev]"
pytest tests/test_config.py -v
```

Expected: ImportError — `sofascore_scraper.config` not found.

- [ ] **Step 6: Implement Config**

`sofascore_scraper/__init__.py`: empty file.

`sofascore_scraper/config.py`:

```python
from __future__ import annotations
import os
from dataclasses import dataclass

ALL_ENDPOINTS = [
    "statistics", "lineups", "incidents", "graph", "shotmap",
    "best-players/summary", "highlights", "comments", "votes", "featured-players",
]

@dataclass(frozen=True)
class Config:
    enabled: bool
    sports: list[str]
    live_interval_s: int
    prematch_interval_s: int
    rate_limit_rps: float
    backoff_max_s: int
    worker_pool_size: int
    discovery_hour_utc: int
    phase_0_measure_mode: bool
    admin_api_base: str
    scraper_api_key: str
    health_port: int

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            enabled=os.environ["SOFA_SCRAPER_ENABLED"].lower() == "true",
            sports=[s.strip() for s in os.environ["SOFA_ENRICHMENT_SPORTS"].split(",") if s.strip()],
            live_interval_s=int(os.environ["SOFA_LIVE_INTERVAL_S"]),
            prematch_interval_s=int(os.environ["SOFA_PREMATCH_INTERVAL_S"]),
            rate_limit_rps=float(os.environ["SOFA_RATE_LIMIT_RPS"]),
            backoff_max_s=int(os.environ["SOFA_BACKOFF_MAX_S"]),
            worker_pool_size=int(os.environ["SOFA_WORKER_POOL_SIZE"]),
            discovery_hour_utc=int(os.environ["SOFA_DISCOVERY_HOUR_UTC"]),
            phase_0_measure_mode=os.environ["SOFA_PHASE_0_MEASURE_MODE"].lower() == "true",
            admin_api_base=os.environ["ADMIN_API_BASE"],
            scraper_api_key=os.environ["SCRAPER_API_KEY"],
            health_port=int(os.environ["SOFA_HEALTH_PORT"]),
        )

    def live_endpoints(self) -> list[str]:
        if self.phase_0_measure_mode:
            return ["statistics", "incidents"]
        return list(ALL_ENDPOINTS)

    def prematch_endpoints(self) -> list[str]:
        if self.phase_0_measure_mode:
            return []
        return list(ALL_ENDPOINTS)

    def finished_endpoints(self) -> list[str]:
        if self.phase_0_measure_mode:
            return []
        return list(ALL_ENDPOINTS)
```

- [ ] **Step 7: Tests pass**

```bash
pytest tests/test_config.py -v
```

Expected: 2/2 PASS.

- [ ] **Step 8: Commit**

```bash
cd /root/sofascore-scraper
git add .
git commit -m "feat: scaffold sofascore-scraper Python project + Config"
```

---

## Task 10 — `client.py` (curl_cffi wrapper, rate-limit, backoff)

**Files:**
- Create: `sofascore_scraper/client.py`
- Test: `tests/test_client.py`

- [ ] **Step 1: Write failing tests**

`tests/test_client.py`:

```python
import pytest
import asyncio
from unittest.mock import patch, MagicMock
from sofascore_scraper.client import SofaClient, RateLimiter, BackoffState

@pytest.mark.asyncio
async def test_rate_limiter_blocks_when_burst_exhausted():
    rl = RateLimiter(rps=2.5, burst=5)
    # consume 5 tokens immediately
    for _ in range(5): await rl.acquire()
    # 6th should wait ~0.4s
    import time
    t0 = time.monotonic()
    await rl.acquire()
    assert time.monotonic() - t0 >= 0.35  # 1/2.5 ≈ 0.4

def test_backoff_exponential():
    bs = BackoffState(max_s=600)
    assert bs.next_delay_s() == 30
    assert bs.next_delay_s() == 60
    assert bs.next_delay_s() == 120
    assert bs.next_delay_s() == 240
    assert bs.next_delay_s() == 480
    assert bs.next_delay_s() == 600  # capped
    bs.reset()
    assert bs.next_delay_s() == 30

@pytest.mark.asyncio
async def test_client_get_returns_payload(monkeypatch):
    from unittest.mock import AsyncMock
    fake_response = MagicMock()
    fake_response.status_code = 200
    fake_response.json = lambda: {"hello": "world"}
    fake_response.content = b'{"hello": "world"}'
    fake_session = MagicMock()
    fake_session.get = AsyncMock(return_value=fake_response)  # AsyncMock so `await session.get(...)` works
    monkeypatch.setattr("sofascore_scraper.client.cr.AsyncSession", MagicMock(return_value=fake_session))
    c = SofaClient(rps=2.5, backoff_max_s=600)
    ok, payload, status = await c.get("/sport/football/scheduled-events/2026-05-07")
    assert ok and payload["hello"] == "world" and status.http == 200
```

- [ ] **Step 2: Verify FAIL**

```bash
pytest tests/test_client.py -v
```

- [ ] **Step 3: Implement client.py**

```python
from __future__ import annotations
import asyncio
import random
import time
from dataclasses import dataclass, field
from curl_cffi import requests as cr

BASE_URL = "https://api.sofascore.com/api/v1"

@dataclass
class FetchStatus:
    ok: bool
    http: int
    size: int
    ts: str

class RateLimiter:
    def __init__(self, rps: float, burst: int = 5):
        self.rps = rps
        self.burst = burst
        self.tokens = float(burst)
        self.last = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            self.tokens = min(self.burst, self.tokens + (now - self.last) * self.rps)
            self.last = now
            if self.tokens >= 1:
                self.tokens -= 1
                return
            wait = (1 - self.tokens) / self.rps
        await asyncio.sleep(wait)
        await self.acquire()

@dataclass
class BackoffState:
    max_s: int = 600
    _attempt: int = 0

    def next_delay_s(self) -> int:
        delay = min(self.max_s, 30 * (2 ** self._attempt))
        self._attempt += 1
        return delay

    def reset(self) -> None:
        self._attempt = 0

class SofaClient:
    def __init__(self, rps: float, backoff_max_s: int):
        self.rl = RateLimiter(rps=rps)
        self.backoff = BackoffState(max_s=backoff_max_s)
        self._session = cr.AsyncSession(impersonate="chrome131", timeout=20)

    async def get(self, path: str) -> tuple[bool, dict | None, FetchStatus]:
        await self.rl.acquire()
        await asyncio.sleep(random.uniform(0.05, 0.25))  # jitter
        url = f"{BASE_URL}{path}"
        try:
            r = await self._session.get(url)
        except Exception as e:
            return False, None, FetchStatus(ok=False, http=0, size=0, ts=_now())
        size = len(r.content or b"")
        if r.status_code == 200:
            self.backoff.reset()
            try:
                return True, r.json(), FetchStatus(ok=True, http=200, size=size, ts=_now())
            except Exception:
                return False, None, FetchStatus(ok=False, http=200, size=size, ts=_now())
        return False, None, FetchStatus(ok=False, http=r.status_code, size=size, ts=_now())

def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
```

- [ ] **Step 4: Tests pass**

```bash
pytest tests/test_client.py -v
```

- [ ] **Step 5: Commit**

```bash
git add sofascore_scraper/client.py tests/test_client.py
git commit -m "feat(scraper): client with rate-limit + backoff + jitter"
```

---

## Task 11 — `admin_api.py` (push helpers)

**Files:**
- Create: `sofascore_scraper/admin_api.py`
- Test: `tests/test_admin_api.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_admin_api.py
import pytest
from unittest.mock import AsyncMock, patch
from sofascore_scraper.admin_api import AdminAPI

@pytest.mark.asyncio
async def test_post_fixtures_sends_correct_headers_and_body():
    api = AdminAPI(base="https://admin.test", key="my-key")
    fixtures = [{"sofa_event_id": 1, "sofa_sport": "football", "home": "A", "away": "B",
                 "kickoff_at": "2026-05-07T19:00:00Z", "sofa_status": "finished",
                 "tournament_name": "T", "category_name": "C"}]
    with patch.object(api, "_session") as mock_sess:
        mock_sess.post = AsyncMock(return_value=AsyncMock(status=200, json=AsyncMock(return_value={"matched_fuzzy": 1, "matched": []})))
        result = await api.post_fixtures(fixtures)
        assert "matched_fuzzy" in result
        mock_sess.post.assert_called_once()
        args, kwargs = mock_sess.post.call_args
        assert kwargs["headers"]["x-scraper-key"] == "my-key"
        assert kwargs["json"]["fixtures"][0]["sofa_event_id"] == 1
```

- [ ] **Step 2: Verify FAIL**

- [ ] **Step 3: Implement**

```python
# sofascore_scraper/admin_api.py
import aiohttp

class AdminAPI:
    def __init__(self, base: str, key: str):
        self.base = base.rstrip("/")
        self.key = key
        self._session = aiohttp.ClientSession()

    async def post_fixtures(self, fixtures: list[dict]) -> dict:
        async with self._session.post(
            f"{self.base}/api/sofascore/fixtures",
            headers={"x-scraper-key": self.key, "content-type": "application/json"},
            json={"fixtures": fixtures},
            timeout=aiohttp.ClientTimeout(total=30),
        ) as r:
            return await r.json()

    async def post_enrichment(self, sofa_event_id: int, sport_slug: str,
                              payloads: dict, endpoint_status: dict) -> dict:
        async with self._session.post(
            f"{self.base}/api/sofascore/enrichment",
            headers={"x-scraper-key": self.key, "content-type": "application/json"},
            json={"sofa_event_id": sofa_event_id, "sport_slug": sport_slug,
                  "payloads": payloads, "endpoint_status": endpoint_status},
            timeout=aiohttp.ClientTimeout(total=30),
        ) as r:
            return await r.json()

    async def close(self):
        await self._session.close()
```

- [ ] **Step 4: Tests pass; commit**

```bash
pytest tests/test_admin_api.py -v
git add sofascore_scraper/admin_api.py tests/test_admin_api.py
git commit -m "feat(scraper): admin api push client"
```

---

## Task 12 — `discovery.py`

**Files:**
- Create: `sofascore_scraper/discovery.py`
- Test: `tests/test_discovery.py`

- [ ] **Step 1: Failing test**

```python
# tests/test_discovery.py
import pytest
from sofascore_scraper.discovery import sofa_event_to_fixture

def test_sofa_event_to_fixture_mapping():
    sofa_event = {
        "id": 12345,
        "homeTeam": {"name": "Bayern"},
        "awayTeam": {"name": "PSG"},
        "startTimestamp": 1746640800,  # 2026-05-07T19:00 UTC ish
        "status": {"type": "finished"},
        "tournament": {"name": "UCL", "category": {"name": "Europe"}},
    }
    fx = sofa_event_to_fixture(sofa_event, sofa_sport="football")
    assert fx["sofa_event_id"] == 12345
    assert fx["sofa_sport"] == "football"
    assert fx["home"] == "Bayern"
    assert fx["away"] == "PSG"
    assert fx["sofa_status"] == "finished"
    assert fx["tournament_name"] == "UCL"
    assert fx["category_name"] == "Europe"
    assert fx["kickoff_at"].startswith("2026-05-07")
```

- [ ] **Step 2: Verify FAIL**

- [ ] **Step 3: Implement**

```python
# sofascore_scraper/discovery.py
from datetime import datetime, timezone
from .client import SofaClient
from .admin_api import AdminAPI

SOFA_SPORTS = ["football", "tennis", "basketball"]

def sofa_event_to_fixture(ev: dict, sofa_sport: str) -> dict:
    ts = ev.get("startTimestamp")
    kickoff_iso = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat() if ts else ""
    return {
        "sofa_event_id": ev["id"],
        "sofa_sport": sofa_sport,
        "home": (ev.get("homeTeam") or {}).get("name", ""),
        "away": (ev.get("awayTeam") or {}).get("name", ""),
        "kickoff_at": kickoff_iso,
        "sofa_status": (ev.get("status") or {}).get("type", "unknown"),
        "tournament_name": (ev.get("tournament") or {}).get("name", ""),
        "category_name": ((ev.get("tournament") or {}).get("category") or {}).get("name"),
    }

async def run_discovery(client: SofaClient, admin: AdminAPI, date_str: str) -> dict:
    """Pull scheduled events for all 3 sports, push to admin, return matched list."""
    all_fixtures: list[dict] = []
    for sofa_sport in SOFA_SPORTS:
        ok, payload, _ = await client.get(f"/sport/{sofa_sport}/scheduled-events/{date_str}")
        if not ok or not payload:
            continue
        for ev in payload.get("events", []):
            all_fixtures.append(sofa_event_to_fixture(ev, sofa_sport))
    response = await admin.post_fixtures(all_fixtures)
    return response  # contains matched: [...]
```

- [ ] **Step 4: Tests pass; commit**

```bash
pytest tests/test_discovery.py -v
git add sofascore_scraper/discovery.py tests/test_discovery.py
git commit -m "feat(scraper): daily discovery"
```

---

## Task 13 — `scheduler.py` (tier classification + due-events)

**Files:**
- Create: `sofascore_scraper/scheduler.py`
- Test: `tests/test_scheduler.py`

- [ ] **Step 1: Failing tests**

```python
# tests/test_scheduler.py
import pytest
from datetime import datetime, timezone, timedelta
from sofascore_scraper.scheduler import (
    classify_tier, EventState, Scheduler
)

def test_classify_tier():
    assert classify_tier("inprogress") == "live"
    assert classify_tier("notstarted") == "prematch"
    assert classify_tier("finished") == "finished"
    assert classify_tier("postponed") == "skip"
    assert classify_tier("canceled") == "skip"

def test_scheduler_due_event_for_live():
    sch = Scheduler(live_interval_s=60, prematch_interval_s=1800)
    now = datetime.now(timezone.utc)
    state = EventState(sofa_event_id=1, vincitu_id="u1", sport_slug="calcio",
                       tier="live", last_synced_at=now - timedelta(seconds=70),
                       last_observed_status="inprogress", finished_one_shot_done=False)
    assert sch.is_due(state, now) is True

def test_scheduler_not_due_when_recent():
    sch = Scheduler(live_interval_s=60, prematch_interval_s=1800)
    now = datetime.now(timezone.utc)
    state = EventState(sofa_event_id=1, vincitu_id="u1", sport_slug="calcio",
                       tier="live", last_synced_at=now - timedelta(seconds=20),
                       last_observed_status="inprogress", finished_one_shot_done=False)
    assert sch.is_due(state, now) is False

def test_scheduler_finished_one_shot():
    sch = Scheduler(live_interval_s=60, prematch_interval_s=1800)
    now = datetime.now(timezone.utc)
    s = EventState(sofa_event_id=1, vincitu_id="u1", sport_slug="calcio",
                   tier="finished", last_synced_at=None,
                   last_observed_status="finished", finished_one_shot_done=False)
    assert sch.is_due(s, now) is True
    s.finished_one_shot_done = True
    assert sch.is_due(s, now) is False
```

- [ ] **Step 2: Verify FAIL**

- [ ] **Step 3: Implement**

```python
# sofascore_scraper/scheduler.py
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal

Tier = Literal["live", "prematch", "finished", "skip"]

def classify_tier(sofa_status: str) -> Tier:
    if sofa_status == "inprogress": return "live"
    if sofa_status == "notstarted": return "prematch"
    if sofa_status == "finished":   return "finished"
    return "skip"

@dataclass
class EventState:
    sofa_event_id: int
    vincitu_id: str
    sport_slug: str
    tier: Tier
    last_synced_at: datetime | None
    last_observed_status: str
    finished_one_shot_done: bool = False

class Scheduler:
    def __init__(self, live_interval_s: int, prematch_interval_s: int):
        self.live_interval_s = live_interval_s
        self.prematch_interval_s = prematch_interval_s

    def is_due(self, state: EventState, now: datetime) -> bool:
        if state.tier == "skip": return False
        if state.tier == "finished":
            return not state.finished_one_shot_done
        interval = self.live_interval_s if state.tier == "live" else self.prematch_interval_s
        if state.last_synced_at is None: return True
        return (now - state.last_synced_at).total_seconds() >= interval

    def reclassify(self, state: EventState, observed_status: str) -> None:
        new_tier = classify_tier(observed_status)
        if new_tier != state.tier:
            state.tier = new_tier
            state.last_observed_status = observed_status
            if new_tier == "finished":
                state.finished_one_shot_done = False  # one final pull
```

- [ ] **Step 4: Tests pass; commit**

```bash
pytest tests/test_scheduler.py -v
git add sofascore_scraper/scheduler.py tests/test_scheduler.py
git commit -m "feat(scraper): scheduler + tier classification"
```

---

## Task 14 — `worker.py` (fetch+push loop)

**Files:**
- Create: `sofascore_scraper/worker.py`
- Test: `tests/test_worker.py`

- [ ] **Step 1: Failing tests**

```python
# tests/test_worker.py
import pytest
from unittest.mock import AsyncMock
from sofascore_scraper.worker import Worker
from sofascore_scraper.scheduler import EventState
from datetime import datetime, timezone

@pytest.mark.asyncio
async def test_worker_fetches_all_endpoints_and_pushes():
    client = AsyncMock()
    client.get = AsyncMock(return_value=(True, {"fake": "payload"}, AsyncMock(http=200, size=100, ts="t", ok=True)))
    admin = AsyncMock()
    admin.post_enrichment = AsyncMock(return_value={"ok": True})

    state = EventState(sofa_event_id=1, vincitu_id="u1", sport_slug="calcio",
                       tier="live", last_synced_at=None, last_observed_status="inprogress")
    w = Worker(client=client, admin=admin, endpoints=["statistics", "lineups"])
    await w.process(state)
    assert client.get.call_count == 2
    admin.post_enrichment.assert_awaited_once()
    args, kwargs = admin.post_enrichment.call_args
    assert kwargs.get("payloads", {}).get("statistics") == {"fake": "payload"}

@pytest.mark.asyncio
async def test_worker_partial_failure_still_pushes():
    client = AsyncMock()
    # first endpoint succeeds, second 404s
    client.get.side_effect = [
        (True, {"a": 1}, AsyncMock(http=200, size=10, ts="t1", ok=True)),
        (False, None, AsyncMock(http=404, size=0, ts="t2", ok=False)),
    ]
    admin = AsyncMock(post_enrichment=AsyncMock(return_value={"ok": True}))
    state = EventState(1, "u1", "calcio", "live", None, "inprogress")
    w = Worker(client=client, admin=admin, endpoints=["statistics", "lineups"])
    await w.process(state)
    args, kwargs = admin.post_enrichment.call_args
    assert kwargs["payloads"]["statistics"] == {"a": 1}
    assert kwargs["payloads"].get("lineups") is None  # 404 → null sent
```

- [ ] **Step 2: Verify FAIL**

- [ ] **Step 3: Implement**

```python
# sofascore_scraper/worker.py
from datetime import datetime, timezone
from .scheduler import EventState
from .client import SofaClient
from .admin_api import AdminAPI

# Map endpoint path → DB column name
ENDPOINT_TO_COL = {
    "statistics": "stats",
    "lineups": "lineups",
    "incidents": "incidents",
    "graph": "momentum",
    "shotmap": "shotmap",
    "best-players/summary": "best_players",
    "highlights": "highlights",
    "comments": "comments",
    "votes": "votes",
    "featured-players": "featured_players",
}

class Worker:
    def __init__(self, client: SofaClient, admin: AdminAPI, endpoints: list[str]):
        self.client = client
        self.admin = admin
        self.endpoints = endpoints

    async def process(self, state: EventState) -> None:
        payloads: dict = {}
        endpoint_status: dict = {}
        for ep in self.endpoints:
            ok, payload, status = await self.client.get(f"/event/{state.sofa_event_id}/{ep}")
            col = ENDPOINT_TO_COL[ep]
            payloads[col] = payload if ok else None
            endpoint_status[col] = {
                "ok": status.ok, "http": status.http, "size": status.size, "ts": status.ts,
            }
        await self.admin.post_enrichment(
            sofa_event_id=state.sofa_event_id,
            sport_slug=state.sport_slug,
            payloads=payloads,
            endpoint_status=endpoint_status,
        )
        state.last_synced_at = datetime.now(timezone.utc)
        if state.tier == "finished":
            state.finished_one_shot_done = True
```

- [ ] **Step 4: Tests pass; commit**

```bash
pytest tests/test_worker.py -v
git add sofascore_scraper/worker.py tests/test_worker.py
git commit -m "feat(scraper): worker fetch+push loop"
```

---

## Task 15 — `health.py` + `main.py` orchestrator

**Files:**
- Create: `sofascore_scraper/health.py`
- Create: `sofascore_scraper/main.py`

- [ ] **Step 1: Implement health server**

```python
# sofascore_scraper/health.py
from aiohttp import web
import asyncio

class HealthServer:
    def __init__(self, port: int):
        self.port = port
        self.last_tick_at: str | None = None
        self.queue_depth: int = 0
        self.backoff_state: dict = {}

    async def _handler(self, _req):
        return web.json_response({
            "status": "ok",
            "last_tick_at": self.last_tick_at,
            "queue_depth": self.queue_depth,
            "backoff_state": self.backoff_state,
        })

    async def start(self):
        app = web.Application()
        app.router.add_get("/health", self._handler)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "0.0.0.0", self.port)
        await site.start()
```

- [ ] **Step 2: Implement main orchestrator**

```python
# sofascore_scraper/main.py
import asyncio
import logging
import json
from datetime import datetime, timezone, time as dt_time
from .config import Config
from .client import SofaClient
from .admin_api import AdminAPI
from .discovery import run_discovery
from .scheduler import Scheduler, EventState, classify_tier
from .worker import Worker
from .health import HealthServer

log = logging.getLogger("sofa")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

TICK_INTERVAL_S = 30

async def main():
    cfg = Config.from_env()
    if not cfg.enabled:
        log.warning("SOFA_SCRAPER_ENABLED=false — exiting")
        return
    log.info(f"starting sofascore-scraper, sports={cfg.sports}, phase0={cfg.phase_0_measure_mode}")

    client = SofaClient(rps=cfg.rate_limit_rps, backoff_max_s=cfg.backoff_max_s)
    admin = AdminAPI(base=cfg.admin_api_base, key=cfg.scraper_api_key)
    sched = Scheduler(live_interval_s=cfg.live_interval_s, prematch_interval_s=cfg.prematch_interval_s)
    health = HealthServer(port=cfg.health_port)
    await health.start()

    states: dict[int, EventState] = {}      # sofa_event_id → state
    queue: asyncio.Queue[EventState] = asyncio.Queue()
    last_discovery_date: str | None = None

    async def worker_loop():
        endpoints_for_tier = {
            "live": cfg.live_endpoints(),
            "prematch": cfg.prematch_endpoints(),
            "finished": cfg.finished_endpoints(),
        }
        while True:
            state = await queue.get()
            try:
                eps = endpoints_for_tier.get(state.tier, [])
                if not eps: continue
                w = Worker(client=client, admin=admin, endpoints=eps)
                await w.process(state)
            except Exception as e:
                log.error(f"worker error for {state.sofa_event_id}: {e}")
            finally:
                queue.task_done()

    workers = [asyncio.create_task(worker_loop()) for _ in range(cfg.worker_pool_size)]

    while True:
        # discovery once a day at configured hour
        now = datetime.now(timezone.utc)
        today = now.date().isoformat()
        if (last_discovery_date != today
            and now.time() >= dt_time(hour=cfg.discovery_hour_utc)):
            try:
                resp = await run_discovery(client, admin, today)
                matched = resp.get("matched", [])
                # rebuild states from matched
                new_states: dict[int, EventState] = {}
                for m in matched:
                    sid = m["sofa_event_id"]
                    tier = classify_tier(m["sofa_status"])
                    prev = states.get(sid)
                    new_states[sid] = EventState(
                        sofa_event_id=sid, vincitu_id=m["event_v2_id"],
                        sport_slug=m["sport_slug"], tier=tier,
                        last_synced_at=prev.last_synced_at if prev else None,
                        last_observed_status=m["sofa_status"],
                        finished_one_shot_done=prev.finished_one_shot_done if prev and tier == prev.tier else False,
                    )
                states = new_states
                last_discovery_date = today
                log.info(f"[discovery] {len(states)} matched events")
            except Exception as e:
                log.error(f"discovery error: {e}")

        # enqueue due events
        polled_this_tick = 0
        for state in states.values():
            if sched.is_due(state, now):
                queue.put_nowait(state)
                polled_this_tick += 1

        health.last_tick_at = now.isoformat()
        health.queue_depth = queue.qsize()
        log.info(json.dumps({"tick": now.isoformat(), "states": len(states),
                             "queued_now": polled_this_tick, "queue_depth": queue.qsize()}))
        await asyncio.sleep(TICK_INTERVAL_S)

if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 3: Smoke test locally**

```bash
cp .env.example .env  # edit values for dev
SOFA_SCRAPER_ENABLED=true python -m sofascore_scraper
# in another shell:
curl http://localhost:9090/health
```

Expected: server starts, /health returns 200 with `last_tick_at` populated after first 30s tick.

- [ ] **Step 4: Commit**

```bash
git add sofascore_scraper/health.py sofascore_scraper/main.py
git commit -m "feat(scraper): main orchestrator + health endpoint"
```

---

## Task 16 — Systemd unit + README runbook

**Files:**
- Create: `systemd/sofascore-scraper.service`
- Create: `README.md`

- [ ] **Step 1: Create systemd unit**

```ini
# systemd/sofascore-scraper.service
[Unit]
Description=SofaScore enrichment scraper
After=network.target

[Service]
Type=simple
WorkingDirectory=/root/sofascore-scraper
EnvironmentFile=/root/sofascore-scraper/.env
ExecStart=/root/sofascore-scraper/.venv/bin/python -m sofascore_scraper
Restart=on-failure
RestartSec=10
MemoryMax=1G
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Create README**

```markdown
# sofascore-scraper

Sister of flashscore-scraper. Pulls SofaScore enrichment for vincitu (calcio/tennis/basket) and pushes to betssolution-admin.

## Deploy (VPS)

1. `cd /root && git clone <repo> sofascore-scraper && cd sofascore-scraper`
2. `python3 -m venv .venv && source .venv/bin/activate && pip install -e .`
3. `cp .env.example .env && nano .env`  ← set ADMIN_API_BASE + SCRAPER_API_KEY
4. `cp systemd/sofascore-scraper.service /etc/systemd/system/`
5. `systemctl daemon-reload && systemctl enable --now sofascore-scraper`
6. `journalctl -u sofascore-scraper -f`  ← verify ticks

## Phase 0 measurement gate

For first 24h, set `SOFA_PHASE_0_MEASURE_MODE=true` in `.env`. Polling is reduced to 2 endpoints (statistics, incidents) on live tier, prematch and finished disabled. After 24h:
- Tail logs: `journalctl -u sofascore-scraper --since "24 hours ago" | grep http_status`
- If 403/429 ratio < 5%: set false, restart
- 5–20%: set false, edit endpoints in scheduler manually (TBD iter 1.5)
- > 20%: keep true, plan proxy pool

## Rollback

`systemctl stop sofascore-scraper && systemctl disable sofascore-scraper` — admin tables stay populated, drop separately if needed.

## Health check

`curl http://localhost:9090/health` — JSON status.
```

- [ ] **Step 3: Commit**

```bash
git add systemd/ README.md
git commit -m "docs: deploy runbook + systemd unit"
```

---

## Task 17 — Phase-0 measurement gate validation

**Files:**
- No new files (config flag already in T9)
- Verify behavior end-to-end

- [ ] **Step 1: Force phase-0 mode locally**

```bash
SOFA_PHASE_0_MEASURE_MODE=true python -m sofascore_scraper
```

- [ ] **Step 2: Inspect log for first tick**

Expected log line: `{"tick": "...", "states": N, ...}`. Then for each polled live event, only `statistics` + `incidents` endpoints fetched (verify via journalctl + admin /api/sofascore/stats showing `by_endpoint_freshness.lineups.populated_pct=0`).

- [ ] **Step 3: Document decision criteria**

Append to README:

```markdown
## Phase 0 → Full ingestion decision tree

| 403/429 ratio (24h) | Action |
|---|---|
| < 5% | `SOFA_PHASE_0_MEASURE_MODE=false`, restart, full 10 endpoints |
| 5–20% | Reduce live tier to 5 endpoints (statistics, incidents, graph, shotmap, lineups). Code change required iter 1.5. |
| > 20% | Stay phase-0; plan proxy pool iter 1.5. |
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: phase-0 measurement decision tree"
```

---

## Task 18 — Smoke test post-deploy

**Files:**
- Modify: `README.md` (add smoke test section)

- [ ] **Step 1: Run admin migrations on prod (Supabase)**

```bash
# from admin worktree
psql $DATABASE_URL_PROD -f supabase/migrations/180_events_v2_add_sofascore_id.sql
psql $DATABASE_URL_PROD -f supabase/migrations/181_create_event_enrichment.sql
```

- [ ] **Step 2: Build + deploy admin**

Per existing deploy procedure (referenced in MEMORY: BUILD_ID, .env.local symlink, etc).

- [ ] **Step 3: Deploy scraper to VPS**

Per Task 16 README steps. `SOFA_PHASE_0_MEASURE_MODE=true`.

- [ ] **Step 4: Verify discovery cycle (after 04:00 UTC next day)**

```bash
journalctl -u sofascore-scraper --since "1 hour ago" | grep -E "discovery|matched"
curl https://admin.vincitu.it/api/sofascore/stats -H "x-scraper-key: ..."
```

Expected:
- `matched_total > 0`
- `by_sport.calcio + by_sport.tennis + by_sport.basket = matched_total`
- log shows `[discovery] N matched events` with N > 0

- [ ] **Step 5: Verify enrichment populating**

```bash
psql $DATABASE_URL_PROD -c "
SELECT sport_slug, count(*),
       count(stats) AS stats_pop,
       count(incidents) AS inc_pop
FROM event_enrichment
WHERE last_synced_at > now() - interval '15 minutes'
GROUP BY sport_slug;"
```

Expected: rows present, stats/incidents columns populated.

- [ ] **Step 6: Commit final docs**

```bash
git add README.md
git commit -m "docs: smoke test runbook"
```

- [ ] **Step 7: Open PR**

```bash
gh pr create --title "feat: SofaScore enrichment iter 1 (data pipeline)" --body "$(cat docs/superpowers/specs/2026-05-07-sofascore-enrichment-iter1-design.md)"
```

---

## Done criteria iter 1

- [ ] Migrations 180 + 181 applied on prod, verified schema
- [ ] All 3 admin endpoints (`fixtures`, `enrichment`, `stats`) deployed, vitest 100% pass
- [ ] sofascore-scraper service running on VPS, systemd Active
- [ ] Discovery cycle ran at least once, matched_total > 50% of expected fixture count for the day (calcio+tennis+basket)
- [ ] event_enrichment populated for matched events (at least stats + incidents)
- [ ] Phase-0 measurement gate config validated in production
- [ ] No regression in flashscore-scraper or settlement (admin /api/health 200, vitest baseline 75/75)
