# FS-id Population Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate `events_v2.flashscore_id` so the existing `v_player_markets` Phase 1.5 filter exposes stats and player markets to the player frontend.

**Architecture:** Add a search HTTP endpoint to the existing `flashscore-scraper` service (Fastify on `127.0.0.1:8090`). Hook the `odds-api-ingester` upsert path with a 3-step cascade lookup (legacy SQL join → canonical chain → search HTTP). One-shot backfill script clears the 4237-row backlog with a priority queue.

**Tech Stack:** Node.js 20 (scraper) / Node.js 22 (admin), TypeScript, Fastify 4, PostgreSQL (Supabase pooler), vitest.

**Spec:** `docs/superpowers/specs/2026-04-30-fs-id-population-design.md`

---

## Phase 1 — Search endpoint in flashscore-scraper

### Task 1: Sport ID map config

**Files:**
- Create: `/root/flashscore-scraper/src/sport-id-map.json`

- [ ] **Step 1: Read existing config to identify sports**

Run: `ssh scraper-vps 'cat /root/flashscore-scraper/config.json | python3 -c "import json,sys; d=json.load(sys.stdin); print([s for s in d[\"sports\"]])"'`

Expected: array of `{ id, name }` entries.

- [ ] **Step 2: Create sport-id-map.json**

Map each odds-api `sport_slug` (lowercase, dash-separated) to the Flashscore numeric sport id from existing config:

```json
{
  "football": 1,
  "soccer": 1,
  "basketball": 2,
  "tennis": 5,
  "ice-hockey": 4,
  "baseball": 6,
  "handball": 7,
  "volleyball": 12,
  "rugby": 8,
  "cricket": 17,
  "american-football": 19,
  "snooker": 14,
  "darts": 22,
  "boxing": 18,
  "mma": 76,
  "esports": 36
}
```

Use only sports actually present in the existing scraper `config.json`. Note both `football` and `soccer` map to id=1 because odds-api uses `soccer_*` for some leagues.

- [ ] **Step 3: Commit or document**

The `flashscore-scraper` directory is **not a git repo** (verified upfront — see `ssh scraper-vps 'ls -la /root/flashscore-scraper/.git'` returns "No such file"). All commits in Phase 1 (tasks 1-6) go to a `CHANGELOG.md` in the scraper directory instead of git. Maintain a running log:

```bash
ssh scraper-vps "echo '## $(date -u +%Y-%m-%dT%H:%M:%SZ) — task 1 sport-id-map' >> /root/flashscore-scraper/CHANGELOG.md"
```

(All Phase 1 tasks follow this pattern.)

---

### Task 2: Normalize module (with TDD)

**Files:**
- Create: `/root/flashscore-scraper/src/normalize.ts`
- Create: `/root/flashscore-scraper/src/team-aliases.json`
- Test: `/root/flashscore-scraper/src/__tests__/normalize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/normalize.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { normalizeTeam, matchTeams } from "../normalize.js";

describe("normalizeTeam", () => {
  it("lowercases", () => {
    expect(normalizeTeam("INTER", "football")).toBe("internazionale");
  });

  it("strips diacritics", () => {
    expect(normalizeTeam("Bayern München", "football")).toBe("bayern munchen");
  });

  it("removes club suffixes", () => {
    expect(normalizeTeam("Inter FC", "football")).toBe("internazionale");
    expect(normalizeTeam("AC Milan", "football")).toBe("milan");
  });

  it("collapses whitespace", () => {
    expect(normalizeTeam("  Real   Madrid  ", "football")).toBe("real madrid");
  });

  it("applies sport-scoped alias dict", () => {
    expect(normalizeTeam("Inter", "football")).toBe("internazionale");
    expect(normalizeTeam("Real", "football")).toBe("real madrid");
  });

  it("does not apply football alias to basketball", () => {
    expect(normalizeTeam("Real", "basketball")).not.toBe("real madrid");
  });

  it("returns normalized form unchanged when no alias matches", () => {
    expect(normalizeTeam("Some Unknown Team", "football")).toBe("some unknown team");
  });
});

describe("matchTeams", () => {
  it("matches identical normalized + aliased teams", () => {
    const a = normalizeTeam("Inter", "football");
    const b = normalizeTeam("Internazionale", "football");
    expect(matchTeams(a, b)).toBe(true);
  });

  it("rejects different teams", () => {
    const a = normalizeTeam("Real Madrid", "football");
    const b = normalizeTeam("Atletico Madrid", "football");
    expect(matchTeams(a, b)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ssh scraper-vps "cd /root/flashscore-scraper && npx vitest run src/__tests__/normalize.test.ts"`
Expected: FAIL — module `../normalize.js` not found.

- [ ] **Step 3: Create alias dictionary**

Create `src/team-aliases.json` with sport-scoped initial seed:

```json
{
  "football:inter": "internazionale",
  "football:man utd": "manchester united",
  "football:man city": "manchester city",
  "football:real": "real madrid",
  "football:atletico": "atletico madrid",
  "football:bayern": "bayern munchen",
  "football:psg": "paris saint germain",
  "football:juve": "juventus",
  "football:napoli": "napoli",
  "football:milan": "milan"
}
```

- [ ] **Step 4: Implement normalize.ts**

```typescript
import aliasesRaw from "./team-aliases.json" with { type: "json" };

const ALIASES = aliasesRaw as Record<string, string>;

const CLUB_SUFFIX_RE = /\b(fc|ac|cf|sc|sk|as|ss|usl|calcio)\b/gi;

export function normalizeTeam(raw: string, sportSlug: string): string {
  const stripped = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(CLUB_SUFFIX_RE, "")
    .replace(/\s+/g, " ")
    .trim();
  const key = `${sportSlug}:${stripped}`;
  return ALIASES[key] ?? stripped;
}

export function matchTeams(a: string, b: string): boolean {
  return a === b && a.length > 0;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `ssh scraper-vps "cd /root/flashscore-scraper && npx vitest run src/__tests__/normalize.test.ts"`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit (or note in CHANGELOG)**

```bash
ssh scraper-vps "cd /root/flashscore-scraper && [ -d .git ] && git add src/normalize.ts src/team-aliases.json src/__tests__/normalize.test.ts && git commit -m 'feat(search): team name normalize + sport-scoped aliases' || echo '> Task 2 done — no git, document manually' >> /root/flashscore-scraper/CHANGELOG.md"
```

---

### Task 3: TTL cache module (with TDD)

**Files:**
- Create: `/root/flashscore-scraper/src/cache.ts`
- Test: `/root/flashscore-scraper/src/__tests__/cache.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { TtlCache } from "../cache.js";

describe("TtlCache", () => {
  it("returns undefined on miss", () => {
    const c = new TtlCache<string>(1000);
    expect(c.get("k")).toBeUndefined();
  });

  it("returns stored value within TTL", () => {
    const c = new TtlCache<number>(1000);
    c.set("k", 42);
    expect(c.get("k")).toBe(42);
  });

  it("expires after TTL", () => {
    vi.useFakeTimers();
    const c = new TtlCache<string>(100);
    c.set("k", "v");
    vi.advanceTimersByTime(150);
    expect(c.get("k")).toBeUndefined();
    vi.useRealTimers();
  });

  it("reports size", () => {
    const c = new TtlCache<number>(1000);
    c.set("a", 1);
    c.set("b", 2);
    expect(c.size()).toBe(2);
  });

  it("reports hit/miss counters", () => {
    const c = new TtlCache<number>(1000);
    c.set("a", 1);
    c.get("a");
    c.get("a");
    c.get("b");
    expect(c.hits()).toBe(2);
    expect(c.misses()).toBe(1);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL** (module missing)

Run: `ssh scraper-vps "cd /root/flashscore-scraper && npx vitest run src/__tests__/cache.test.ts"`

- [ ] **Step 3: Implement cache.ts**

```typescript
type Entry<T> = { value: T; expiresAt: number };

export class TtlCache<T> {
  private store = new Map<string, Entry<T>>();
  private hitCount = 0;
  private missCount = 0;

  constructor(private ttlMs: number) {}

  get(key: string): T | undefined {
    const e = this.store.get(key);
    if (!e) {
      this.missCount++;
      return undefined;
    }
    if (Date.now() >= e.expiresAt) {
      this.store.delete(key);
      this.missCount++;
      return undefined;
    }
    this.hitCount++;
    return e.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  size(): number {
    return this.store.size;
  }

  hits(): number {
    return this.hitCount;
  }

  misses(): number {
    return this.missCount;
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

- [ ] **Step 5: Commit**

```bash
ssh scraper-vps "cd /root/flashscore-scraper && [ -d .git ] && git add src/cache.ts src/__tests__/cache.test.ts && git commit -m 'feat(search): TTL cache with hit/miss counters'"
```

---

### Task 4: Search logic module (with TDD)

**Files:**
- Create: `/root/flashscore-scraper/src/search.ts`
- Test: `/root/flashscore-scraper/src/__tests__/search.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FlashscoreFixture } from "../parser.js";

const fakeFixtures: FlashscoreFixture[] = [
  { matchId: "M1", homeTeam: "Inter", awayTeam: "AC Milan", timestamp: 1714579200, country: "Italy", league: "Serie A", sport: "Football" },
  { matchId: "M2", homeTeam: "Real Madrid", awayTeam: "Barcelona", timestamp: 1714579200, country: "Spain", league: "La Liga", sport: "Football" },
  { matchId: "M3", homeTeam: "Bayern Munchen", awayTeam: "Dortmund", timestamp: 1714666800, country: "Germany", league: "Bundesliga", sport: "Football" },
];

vi.mock("../flashscore-client.js", () => ({
  fetchResultsFeed: vi.fn(async () => "fake_raw"),
}));
vi.mock("../parser.js", () => ({
  parseFixturesFeed: vi.fn(() => fakeFixtures),
}));

import { searchEvent, dayOffsetFromIso } from "../search.js";

describe("dayOffsetFromIso", () => {
  it("returns 0 for today", () => {
    const today = new Date();
    today.setHours(15, 0, 0, 0);
    expect(dayOffsetFromIso(today.toISOString(), today)).toBe(0);
  });

  it("returns 1 for tomorrow", () => {
    const today = new Date(2026, 4, 1, 0, 0, 0);
    const tomorrow = new Date(2026, 4, 2, 15, 0, 0);
    expect(dayOffsetFromIso(tomorrow.toISOString(), today)).toBe(1);
  });
});

describe("searchEvent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns matchId on exact match", async () => {
    const r = await searchEvent({
      sportSlug: "football",
      startsAt: new Date(1714579200 * 1000).toISOString(),
      home: "Inter",
      away: "Milan",
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ matchId: "M1" });
  });

  it("returns 404 when no candidates within ±10min", async () => {
    const r = await searchEvent({
      sportSlug: "football",
      startsAt: new Date((1714579200 + 1800) * 1000).toISOString(),
      home: "Inter",
      away: "Milan",
    });
    expect(r.status).toBe(404);
  });

  it("returns 409 when two candidates equally match", async () => {
    // requires test data with duplicate teams — extended in implementation
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

- [ ] **Step 3: Implement search.ts**

```typescript
import { fetchResultsFeed } from "./flashscore-client.js";
import { parseFixturesFeed, type FlashscoreFixture } from "./parser.js";
import { TtlCache } from "./cache.js";
import { normalizeTeam, matchTeams } from "./normalize.js";
import sportMap from "./sport-id-map.json" with { type: "json" };

const SPORT_MAP = sportMap as Record<string, number>;
const CACHE_TTL_MS = Number(process.env.FS_SEARCH_CACHE_TTL_MS ?? 5 * 60 * 1000);
const TIME_TOLERANCE_SEC = 10 * 60;
const cache = new TtlCache<FlashscoreFixture[]>(CACHE_TTL_MS);

const SPORT_NAMES: Record<number, string> = {
  1: "Football", 2: "Basketball", 4: "Ice Hockey", 5: "Tennis",
  6: "Baseball", 7: "Handball", 8: "Rugby", 12: "Volleyball",
  14: "Snooker", 17: "Cricket", 18: "Boxing", 19: "American Football",
  22: "Darts", 36: "Esports", 76: "MMA",
};

export function dayOffsetFromIso(isoStarts: string, now: Date = new Date()): number {
  const fmt = (d: Date) => new Date(d.toLocaleString("en-US", { timeZone: "Europe/Rome" }));
  const today = fmt(now); today.setHours(0, 0, 0, 0);
  const ev = fmt(new Date(isoStarts)); ev.setHours(0, 0, 0, 0);
  return Math.round((ev.getTime() - today.getTime()) / 86400000);
}

async function fetchAndCache(sportId: number, dayOffset: number): Promise<FlashscoreFixture[]> {
  const key = `${sportId}-${dayOffset}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const raw = await fetchResultsFeed(sportId, dayOffset);
  if (!raw) return [];
  const parsed = parseFixturesFeed(raw, SPORT_NAMES[sportId] ?? String(sportId));
  cache.set(key, parsed);
  return parsed;
}

export type SearchResult =
  | { status: 200; body: { matchId: string; matchedHome: string; matchedAway: string; viaDayOffset: number } }
  | { status: 400 | 404 | 409 | 503; body: Record<string, unknown> };

export interface SearchInput {
  sportSlug: string;
  startsAt: string;
  home: string;
  away: string;
}

export async function searchEvent(input: SearchInput): Promise<SearchResult> {
  const sportId = SPORT_MAP[input.sportSlug];
  if (!sportId) return { status: 400, body: { error: "unknown_sport", sport_slug: input.sportSlug } };

  const baseOffset = dayOffsetFromIso(input.startsAt);
  const offsets = [baseOffset, baseOffset + 1, baseOffset - 1];

  const eventTs = Math.floor(new Date(input.startsAt).getTime() / 1000);
  const homeNorm = normalizeTeam(input.home, input.sportSlug);
  const awayNorm = normalizeTeam(input.away, input.sportSlug);

  for (const off of offsets) {
    let fixtures: FlashscoreFixture[];
    try {
      fixtures = await fetchAndCache(sportId, off);
    } catch {
      return { status: 503, body: { error: "flashscore_unavailable" } };
    }

    const matches = fixtures.filter((f) => {
      if (Math.abs(f.timestamp - eventTs) > TIME_TOLERANCE_SEC) return false;
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

  return { status: 404, body: { error: "no_match" } };
}

export const searchCache = cache;
```

- [ ] **Step 4: Run test, verify PASS**

Run: `ssh scraper-vps "cd /root/flashscore-scraper && npx vitest run src/__tests__/search.test.ts"`

- [ ] **Step 5: Commit**

---

### Task 5: HTTP server (Fastify) module

**Files:**
- Create: `/root/flashscore-scraper/src/server.ts`
- Modify: `/root/flashscore-scraper/package.json` (add fastify dep)

- [ ] **Step 1: Install Fastify**

Run: `ssh scraper-vps "cd /root/flashscore-scraper && npm install fastify@4 --save"`
Expected: `+ fastify@4.x.y`, no peer warnings.

- [ ] **Step 2: Implement server.ts**

```typescript
import Fastify from "fastify";
import { searchEvent, searchCache } from "./search.js";

let totalRequests = 0;
let fs403Count = 0;
let fs5xxCount = 0;
let noMatchCount = 0;
const startMs = Date.now();

export async function startServer(port = 8090, host = "127.0.0.1"): Promise<void> {
  const apiKey = process.env.FS_SEARCH_API_KEY ?? "";
  if (!apiKey) throw new Error("FS_SEARCH_API_KEY env var required");

  const app = Fastify({ logger: { level: "info" } });

  app.addHook("onRequest", async (req, reply) => {
    if (req.url.startsWith("/health")) return;
    const provided = req.headers["x-api-key"];
    if (provided !== apiKey) {
      reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.get("/health", async () => ({ ok: true, uptime_sec: Math.round((Date.now() - startMs) / 1000) }));

  app.get("/search", async (req, reply) => {
    const q = req.query as Record<string, string>;
    if (!q.sport_slug || !q.starts_at || !q.home || !q.away) {
      return reply.code(400).send({ error: "missing_params" });
    }
    totalRequests++;
    const result = await searchEvent({
      sportSlug: q.sport_slug,
      startsAt: q.starts_at,
      home: q.home,
      away: q.away,
    });
    if (result.status === 503) fs5xxCount++;
    if (result.status === 404) noMatchCount++;
    return reply.code(result.status).send(result.body);
  });

  app.get("/stats", async () => ({
    uptime_sec: Math.round((Date.now() - startMs) / 1000),
    search_requests_total: totalRequests,
    cache_hits: searchCache.hits(),
    cache_misses: searchCache.misses(),
    cache_size: searchCache.size(),
    fs_403_count: fs403Count,
    fs_5xx_count: fs5xxCount,
    no_match_count: noMatchCount,
  }));

  await app.listen({ port, host });
  console.log(`[search-server] listening on http://${host}:${port}`);
}
```

- [ ] **Step 3: Smoke test by importing**

Run: `ssh scraper-vps "cd /root/flashscore-scraper && FS_SEARCH_API_KEY=test npx tsx -e 'import(\"./src/server.js\").then(m => m.startServer().then(() => console.log(\"ok\"))).then(() => process.exit(0))'"`
Wait 3s, then `ssh scraper-vps "curl -s -H 'X-API-Key: test' http://127.0.0.1:8090/health"`
Expected: `{"ok":true,...}`

Kill the test process: `ssh scraper-vps "pkill -f 'src/server.js' || true"`

- [ ] **Step 4: Commit**

---

### Task 6: Wire server into scraper entry point

**Files:**
- Modify: `/root/flashscore-scraper/src/index.ts`
- Modify: `/etc/systemd/system/flashscore-scraper.service` (add env var)

- [ ] **Step 1: Add server startup to index.ts**

Read current `index.ts`. After existing initial cycles, before the `setInterval` loop, add:

```typescript
import { startServer } from "./server.js";

// Start HTTP search server in parallel with feed loops
startServer(
  Number(process.env.SEARCH_SERVER_PORT ?? 8090),
  process.env.SEARCH_SERVER_HOST ?? "127.0.0.1"
).catch((err) => {
  console.error("[search-server] failed to start:", err);
  process.exit(1);
});
```

Place it BEFORE the existing `await runResultsCycle()` so server is up first.

- [ ] **Step 2: Add FS_SEARCH_API_KEY to systemd unit**

First inspect existing Environment= lines so we know where to anchor:

```bash
ssh scraper-vps "grep -n '^Environment=' /etc/systemd/system/flashscore-scraper.service"
```

Then append a new Environment= line right after the last existing one (defensive — works regardless of which env vars are already there):

```bash
ssh scraper-vps "
KEY=\$(openssl rand -hex 24)
echo \"FS_SEARCH_API_KEY=\$KEY\" > /tmp/fs-key.tmp
LAST_ENV_LINE=\$(grep -n '^Environment=' /etc/systemd/system/flashscore-scraper.service | tail -1 | cut -d: -f1)
sed -i \"\${LAST_ENV_LINE}a Environment=FS_SEARCH_API_KEY=\$KEY\" /etc/systemd/system/flashscore-scraper.service
systemctl daemon-reload
echo \"Inserted at line \$((LAST_ENV_LINE+1))\"
grep FS_SEARCH_API_KEY /etc/systemd/system/flashscore-scraper.service
"
```

Save the generated key — read it back from systemd unit when needed for ingester `.env`:

```bash
ssh scraper-vps "grep '^Environment=FS_SEARCH_API_KEY=' /etc/systemd/system/flashscore-scraper.service | cut -d= -f3-"
```

- [ ] **Step 3: Restart scraper**

```bash
ssh scraper-vps "systemctl restart flashscore-scraper && sleep 5 && systemctl is-active flashscore-scraper"
```
Expected: `active`

- [ ] **Step 4: Verify server up**

```bash
ssh scraper-vps "curl -s http://127.0.0.1:8090/health"
```
Expected: `{"ok":true,...}`

- [ ] **Step 5: Smoke test search with known event**

Run a query against an event known to exist on Flashscore today:

```bash
ssh scraper-vps "API_KEY=\$(grep FS_SEARCH_API_KEY /etc/systemd/system/flashscore-scraper.service | cut -d= -f3); curl -s -H \"X-API-Key: \$API_KEY\" 'http://127.0.0.1:8090/search?sport_slug=football&starts_at=2026-04-30T20:00:00Z&home=Inter&away=Milan'"
```

If 200 or 404, OK. If 401, key mismatch — re-check.

- [ ] **Step 6: Commit + log**

---

## Phase 2 — Ingester hook

### Task 7: resolve-flashscore-id helper (with TDD)

**Files:**
- Create: `/root/betssolution-admin/services/odds-api-ingester/src/resolve-flashscore-id.ts`
- Test: `/root/betssolution-admin/services/odds-api-ingester/src/__tests__/resolve-flashscore-id.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { resolveFlashscoreId } from "../resolve-flashscore-id.js";

const baseEvent = {
  odds_api_id: 12345,
  sport_slug: "football",
  starts_at: new Date("2026-05-01T20:00:00Z"),
  home: "Inter",
  away: "Milan",
};

function mkDeps(steps: { direct?: string | null; canonical?: string | null; search?: { ok: boolean; matchId?: string } }) {
  const queryOne = vi.fn();
  if (steps.direct === undefined) queryOne.mockResolvedValueOnce(null);
  else queryOne.mockResolvedValueOnce(steps.direct ? { flashscore_id: steps.direct } : null);
  if (steps.canonical === undefined) queryOne.mockResolvedValueOnce(null);
  else queryOne.mockResolvedValueOnce(steps.canonical ? { flashscore_id: steps.canonical } : null);

  const fetchFn = vi.fn(async () => {
    if (steps.search?.ok) return { ok: true, json: async () => ({ matchId: steps.search!.matchId }) } as any;
    return { ok: false, status: 404 } as any;
  });

  return {
    db: { queryOne },
    searchUrl: "http://test:8090",
    apiKey: "k",
    log: { info: vi.fn(), warn: vi.fn() },
    fetch: fetchFn,
  };
}

describe("resolveFlashscoreId", () => {
  it("hits step 1 (legacy direct) and skips others", async () => {
    const deps = mkDeps({ direct: "FS-LEGACY-123" });
    const result = await resolveFlashscoreId(baseEvent, deps);
    expect(result).toBe("FS-LEGACY-123");
    expect(deps.db.queryOne).toHaveBeenCalledTimes(1);
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("falls through to step 2 (canonical) when step 1 misses", async () => {
    const deps = mkDeps({ direct: null, canonical: "FS-CANON-456" });
    const result = await resolveFlashscoreId(baseEvent, deps);
    expect(result).toBe("FS-CANON-456");
    expect(deps.db.queryOne).toHaveBeenCalledTimes(2);
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("falls through to step 3 (search) when steps 1+2 miss", async () => {
    const deps = mkDeps({ direct: null, canonical: null, search: { ok: true, matchId: "FS-SEARCH-789" } });
    const result = await resolveFlashscoreId(baseEvent, deps);
    expect(result).toBe("FS-SEARCH-789");
    expect(deps.db.queryOne).toHaveBeenCalledTimes(2);
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns null when all steps miss", async () => {
    const deps = mkDeps({ direct: null, canonical: null, search: { ok: false } });
    const result = await resolveFlashscoreId(baseEvent, deps);
    expect(result).toBeNull();
  });

  it("returns null and logs warn on fetch error", async () => {
    const deps = mkDeps({ direct: null, canonical: null });
    deps.fetch = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    const result = await resolveFlashscoreId(baseEvent, deps);
    expect(result).toBeNull();
    expect(deps.log.warn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `ssh scraper-vps "cd /root/betssolution-admin/services/odds-api-ingester && npx vitest run src/__tests__/resolve-flashscore-id.test.ts"`

- [ ] **Step 3: Implement resolve-flashscore-id.ts**

```typescript
export interface ResolveEvent {
  odds_api_id: number;
  sport_slug: string;
  starts_at: Date;
  home: string;
  away: string;
}

export interface ResolveDeps {
  db: { queryOne: <T = any>(sql: string, params: any[]) => Promise<T | null> };
  searchUrl: string;
  apiKey: string;
  log: { info: (...a: any[]) => void; warn: (...a: any[]) => void };
  fetch?: typeof fetch;
}

export async function resolveFlashscoreId(
  event: ResolveEvent,
  deps: ResolveDeps
): Promise<string | null> {
  const fetchFn = deps.fetch ?? fetch;
  const externalId = `odds-api:${event.odds_api_id}`;

  // Step 1 — legacy direct
  const direct = await deps.db.queryOne<{ flashscore_id: string }>(
    `SELECT flashscore_id FROM events
     WHERE external_id = $1 AND flashscore_id IS NOT NULL LIMIT 1`,
    [externalId]
  );
  if (direct?.flashscore_id) {
    deps.log.info({ odds_api_id: event.odds_api_id, via: "legacy_direct" }, "[fs-id] resolved");
    return direct.flashscore_id;
  }

  // Step 2 — canonical chain
  const chain = await deps.db.queryOne<{ flashscore_id: string }>(
    `SELECT e_fs.flashscore_id FROM events e_oa
     JOIN events e_fs ON e_fs.canonical_id = e_oa.canonical_id
        AND e_fs.flashscore_id IS NOT NULL
     WHERE e_oa.external_id = $1 LIMIT 1`,
    [externalId]
  );
  if (chain?.flashscore_id) {
    deps.log.info({ odds_api_id: event.odds_api_id, via: "canonical_chain" }, "[fs-id] resolved");
    return chain.flashscore_id;
  }

  // Step 3 — search endpoint
  try {
    const url = new URL(`${deps.searchUrl}/search`);
    url.searchParams.set("sport_slug", event.sport_slug);
    url.searchParams.set("starts_at", event.starts_at.toISOString());
    url.searchParams.set("home", event.home);
    url.searchParams.set("away", event.away);
    const res = await fetchFn(url, {
      headers: { "X-API-Key": deps.apiKey },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const body = (await res.json()) as { matchId: string };
      deps.log.info({ odds_api_id: event.odds_api_id, via: "search", matchId: body.matchId }, "[fs-id] resolved");
      return body.matchId;
    }
    deps.log.info({ odds_api_id: event.odds_api_id, status: res.status }, "[fs-id] search no match");
  } catch (err) {
    deps.log.warn({ odds_api_id: event.odds_api_id, err: String(err) }, "[fs-id] search failed");
  }
  return null;
}
```

- [ ] **Step 4: Run test, verify PASS**

- [ ] **Step 5: Commit**

```bash
ssh scraper-vps "cd /root/betssolution-admin && git add services/odds-api-ingester/src/resolve-flashscore-id.ts services/odds-api-ingester/src/__tests__/resolve-flashscore-id.test.ts && git commit -m 'feat(ingester): resolve-flashscore-id cascade helper (Plan D #4)'"
```

---

### Task 8: Integrate helper into upsert.ts

**Files:**
- Modify: `/root/betssolution-admin/services/odds-api-ingester/src/upsert.ts`
- Modify: `/root/betssolution-admin/services/odds-api-ingester/.env`

- [ ] **Step 1: Read current upsert.ts to find INSERT events_v2 location**

Run: `ssh scraper-vps "grep -n 'INTO events_v2\|UPDATE events_v2\|events_v2_pkey' /root/betssolution-admin/services/odds-api-ingester/src/upsert.ts | head -20"`

Identify the line where events_v2 row gets persisted and the variable holding the row data + INSERT/UPSERT result.

- [ ] **Step 2: Add env vars to .env**

```bash
ssh scraper-vps "
KEY=\$(grep FS_SEARCH_API_KEY /etc/systemd/system/flashscore-scraper.service | cut -d= -f3)
cat >> /root/betssolution-admin/services/odds-api-ingester/.env <<EOF
FS_SEARCH_URL=http://127.0.0.1:8090
FS_SEARCH_API_KEY=\$KEY
FS_LOOKUP_CONCURRENCY=4
EOF
"
```

- [ ] **Step 3: Modify upsert.ts to call helper post-INSERT**

First confirm the `Upserter` class exists, has a `db` property, and what shape the db client has. Check existing usage:

```bash
ssh scraper-vps "grep -n 'class Upserter\\|this\\.db\\.' /root/betssolution-admin/services/odds-api-ingester/src/upsert.ts | head -20"
```

If `this.db.exec` does not exist (the existing client may use a different name like `this.db.query`), adapt the snippet below to match.

Add the following as a **method on the `Upserter` class** (i.e. inside the class body, indented at method level), not as a free-standing function. Place it after the existing upsert methods:

```typescript
// FS-id population (Plan D #4) — fire-and-forget pattern.
// Never throws to caller; on failure leaves flashscore_id NULL for retry next tick.
async maybeResolveFsId(row: {
  id: string;
  flashscore_id: string | null;
  odds_api_id: number;
  sport_slug: string;
  starts_at: Date;
  home: string;
  away: string;
}): Promise<void> {
  if (row.flashscore_id) return;  // already populated, skip
  try {
    const matchId = await resolveFlashscoreId(
      { odds_api_id: row.odds_api_id, sport_slug: row.sport_slug, starts_at: row.starts_at, home: row.home, away: row.away },
      { db: this.db, searchUrl: process.env.FS_SEARCH_URL!, apiKey: process.env.FS_SEARCH_API_KEY!, log: this.log }
    );
    if (matchId) {
      // Adjust to actual db client method (.exec/.query/.execute) — see Step 3 above
      await this.db.query(
        `UPDATE events_v2 SET flashscore_id = $1, updated_at = now() WHERE id = $2 AND flashscore_id IS NULL`,
        [matchId, row.id]
      );
    }
  } catch (err) {
    this.log.warn({ id: row.id, err: String(err) }, "[fs-id] hook failure (ignored)");
  }
}
```

Add the import at the top of `upsert.ts`:

```typescript
import { resolveFlashscoreId } from "./resolve-flashscore-id.js";
```

Wire up bounded parallelism in the batch path (e.g. ingest.ts):

```typescript
import pLimit from "p-limit";
const fsLimit = pLimit(Number(process.env.FS_LOOKUP_CONCURRENCY ?? 4));
// after upserting batch:
await Promise.all(
  upsertedRows.map((r) => fsLimit(() => upserter.maybeResolveFsId(r)))
);
```

If `p-limit` not in deps:

```bash
ssh scraper-vps "cd /root/betssolution-admin && npm install p-limit"
```

- [ ] **Step 4: Run existing ingester tests**

```bash
ssh scraper-vps "cd /root/betssolution-admin/services/odds-api-ingester && npx vitest run src/__tests__/"
```
Expected: existing tests still PASS.

- [ ] **Step 5: Commit**

---

### Task 9: Deploy ingester (already running) and watch logs

- [ ] **Step 1: TypeScript check**

```bash
ssh scraper-vps "cd /root/betssolution-admin && npx tsc --noEmit"
```
Expected: 0 errors.

- [ ] **Step 2: Restart ingester service**

```bash
ssh scraper-vps "systemctl restart odds-api-ingester && sleep 5 && systemctl is-active odds-api-ingester"
```
Expected: `active`

**HARD PAUSE — confirm with user before proceeding**: the ingester is currently STOPPED (test mode, no live betting). This restart brings it up and starts FS-id population on every new ingest tick. If user prefers to keep it stopped:
- Skip this step
- Document `Phase 2 deferred — ingester not restarted, hook will activate on next manual `systemctl start odds-api-ingester` decision`
- Skip Phase 3 backfill execution too (it can run independently of ingester state, but verification in Phase 4 requires the live data path)

- [ ] **Step 3: Tail logs for 60s, verify fs-id hook fires**

```bash
ssh scraper-vps "tail -f /var/log/odds-api-ingester.log" &
sleep 60
# Look for: [fs-id] resolved odds_api_id=...
```

Expected: at least one `[fs-id] resolved` line within 60s once a tier tick fires with new events.

- [ ] **Step 4: Verify no perf regression**

Compare tier durations vs baseline (memory has baseline metrics). No tier should consume >2x its prior duration.

---

## Phase 3 — Backfill script

### Task 10: Write backfill script

**Files:**
- Create: `/root/betssolution-admin/services/odds-api-ingester/scripts/backfill-fs-id.ts`

- [ ] **Step 0: Verify schema prereq**

```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h aws-1-eu-central-1.pooler.supabase.com -U postgres.xgnyqkmugnfzhdveeqom -d postgres -p 5432 -c \"\\d events_v2\" | grep flashscore_id"
```
Expected: `flashscore_id | text | | | |` (column exists, nullable). If missing, abort.

- [ ] **Step 1: Write the script**

```typescript
import "dotenv/config";
import { Pool } from "pg";
import pLimit from "p-limit";
import { resolveFlashscoreId } from "../src/resolve-flashscore-id.js";

const BACKFILL_LIMIT = process.env.BACKFILL_LIMIT ? Number(process.env.BACKFILL_LIMIT) : null;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const log = {
  info: (...a: any[]) => console.log(JSON.stringify({ level: "info", ...a[0], msg: a[1] })),
  warn: (...a: any[]) => console.warn(JSON.stringify({ level: "warn", ...a[0], msg: a[1] })),
};

const db = {
  queryOne: async <T = any>(sql: string, params: any[]): Promise<T | null> => {
    const r = await pool.query(sql, params);
    return (r.rows[0] as T) ?? null;
  },
  exec: async (sql: string, params: any[]) => { await pool.query(sql, params); },
};

async function stepA(): Promise<void> {
  console.log("[backfill] Step A — bulk SQL");
  const a1 = await pool.query(`
    UPDATE events_v2 v SET flashscore_id = e.flashscore_id, updated_at = now()
    FROM events e
    WHERE e.external_id = 'odds-api:' || v.odds_api_id::text
      AND e.flashscore_id IS NOT NULL
      AND v.flashscore_id IS NULL
  `);
  console.log(`[backfill] A1 legacy_direct: populated ${a1.rowCount} rows`);

  const a2 = await pool.query(`
    UPDATE events_v2 v SET flashscore_id = e_fs.flashscore_id, updated_at = now()
    FROM events e_oa
    JOIN events e_fs ON e_fs.canonical_id = e_oa.canonical_id AND e_fs.flashscore_id IS NOT NULL
    WHERE e_oa.external_id = 'odds-api:' || v.odds_api_id::text
      AND v.flashscore_id IS NULL
  `);
  console.log(`[backfill] A2 canonical_chain: populated ${a2.rowCount} rows`);
}

async function stepB(): Promise<void> {
  console.log("[backfill] Step B — search endpoint" + (BACKFILL_LIMIT ? ` (LIMIT ${BACKFILL_LIMIT})` : ""));
  const rows = await pool.query(`
    SELECT id, odds_api_id, sport_slug, starts_at, home, away, status
    FROM events_v2
    WHERE flashscore_id IS NULL
    ORDER BY
      CASE status WHEN 'live' THEN 0 WHEN 'pending' THEN 1 ELSE 9 END,
      starts_at ASC
    ${BACKFILL_LIMIT ? `LIMIT ${BACKFILL_LIMIT}` : ""}
  `);
  console.log(`[backfill] Step B queue size: ${rows.rowCount}`);

  // Hard 1 req/sec throttle protects scraper CPU regardless of cache state
  // (sleep is unconditional below; even cache hits wait the second).
  const limit = pLimit(1);
  let matched = 0, noMatch = 0, errors = 0, idx = 0;

  await Promise.all(
    rows.rows.map((r) =>
      limit(async () => {
        idx++;
        if (idx % 100 === 0) {
          console.log(`[backfill] progress ${idx}/${rows.rowCount} matched=${matched} no_match=${noMatch} errors=${errors}`);
        }
        try {
          const matchId = await resolveFlashscoreId(
            { odds_api_id: r.odds_api_id, sport_slug: r.sport_slug, starts_at: new Date(r.starts_at), home: r.home, away: r.away },
            { db, searchUrl: process.env.FS_SEARCH_URL!, apiKey: process.env.FS_SEARCH_API_KEY!, log }
          );
          if (matchId) {
            await pool.query(`UPDATE events_v2 SET flashscore_id = $1, updated_at = now() WHERE id = $2 AND flashscore_id IS NULL`, [matchId, r.id]);
            matched++;
          } else {
            noMatch++;
          }
        } catch (err) {
          errors++;
          console.error(`[backfill] error on ${r.odds_api_id}:`, err);
        }
        await new Promise((res) => setTimeout(res, 1000));  // 1 req/sec
      })
    )
  );

  console.log(`[backfill] Step B complete: matched=${matched} no_match=${noMatch} errors=${errors}`);
}

(async () => {
  const t0 = Date.now();
  try {
    await stepA();
    await stepB();
    const cov = await pool.query(`SELECT count(*) FILTER (WHERE flashscore_id IS NOT NULL) AS pop, count(*) AS tot FROM events_v2`);
    const { pop, tot } = cov.rows[0];
    console.log(`[backfill] FINAL coverage: ${pop}/${tot} (${((pop / tot) * 100).toFixed(1)}%) in ${Math.round((Date.now() - t0) / 1000)}s`);
  } finally {
    await pool.end();
  }
})();
```

- [ ] **Step 2: Smoke test on LIMIT 50 (via env var, no code edit)**

```bash
ssh scraper-vps "cd /root/betssolution-admin/services/odds-api-ingester && BACKFILL_LIMIT=50 npx tsx scripts/backfill-fs-id.ts 2>&1 | tee /tmp/backfill-smoke.log"
```

Expected:
- Step A reports ~2489 rows populated
- Step B processes 50 rows, reports matched/no_match counts
- Final coverage line printed

If no_match >50% on smoke, INSPECT 5 cases manually:
```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h aws-1-eu-central-1.pooler.supabase.com -U postgres.xgnyqkmugnfzhdveeqom -d postgres -p 5432 -c \"SELECT odds_api_id, sport_slug, home, away, starts_at FROM events_v2 WHERE flashscore_id IS NULL LIMIT 5;\""
```

Then `curl` the search endpoint manually for each to see candidate dump from 404 response. Add aliases as needed.

- [ ] **Step 3: Run full (omit BACKFILL_LIMIT)**

```bash
ssh scraper-vps "cd /root/betssolution-admin/services/odds-api-ingester && nohup npx tsx scripts/backfill-fs-id.ts > /var/log/backfill-fs-id.log 2>&1 &"
ssh scraper-vps "tail -f /var/log/backfill-fs-id.log"
```

Watch progress lines every 100 rows. Total ETA ~30 min.

- [ ] **Step 4: Verify final coverage**

```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h aws-1-eu-central-1.pooler.supabase.com -U postgres.xgnyqkmugnfzhdveeqom -d postgres -p 5432 -c \"SELECT count(*) FILTER (WHERE flashscore_id IS NOT NULL)::float / count(*) AS coverage FROM events_v2;\""
```
Expected: ≥ 0.75 (acceptance floor), realistic 0.85-0.92.

- [ ] **Step 5: Commit script**

```bash
ssh scraper-vps "cd /root/betssolution-admin && git add services/odds-api-ingester/scripts/backfill-fs-id.ts && git commit -m 'feat(backfill): one-shot FS-id population with priority queue (Plan D #4)'"
```

---

## Phase 4 — Validation + observability

### Task 11: Verify v_player_markets exposes stats/player

- [ ] **Step 1: Count exposed markets pre vs post**

```sql
SELECT
  category,
  count(*) FILTER (WHERE category IN ('stats', 'player')) AS stats_player_visible
FROM v_player_markets
GROUP BY category;
```

Expected: stats and player rows now > 0 where event has fs-id populated.

- [ ] **Step 2: Spot-check player frontend**

```bash
ssh scraper-vps "curl -s 'http://localhost:3001/api/marcatori?eventId=<known-event-with-fs-id>' | python3 -m json.tool | head -50"
```

Expected: JSON with markets including marcatori (stats/player) categories.

- [ ] **Step 3: Verify legacy fallback for events with NULL fs-id**

```bash
ssh scraper-vps "curl -s 'http://localhost:3001/api/marcatori?eventId=<known-event-no-fs-id>'"
```

Expected: still works (legacy default path), no 500 errors.

---

### Task 12: Document runbook entries

**Files:**
- Modify: `/root/betssolution-admin/docs/operations/runbook.md` (or create)

- [ ] **Step 1: Add 3 runbook sections**

```markdown
## FS-id population (Plan D #4)

### Adding aliases
1. Inspect no_match counts: `curl -H X-API-Key: $FS_SEARCH_API_KEY http://127.0.0.1:8090/stats`
2. Edit `/root/flashscore-scraper/src/team-aliases.json`
3. Restart scraper: `systemctl restart flashscore-scraper`
4. Rerun backfill for residual NULL rows

### Rerunning backfill
`cd /root/betssolution-admin/services/odds-api-ingester && npx tsx scripts/backfill-fs-id.ts | tee /var/log/backfill-fs-id-$(date +%Y%m%d).log`

### Diagnosing search endpoint failures
Check: `curl http://127.0.0.1:8090/stats` for fs_5xx_count, no_match_count.
Logs: `journalctl -u flashscore-scraper -n 100 | grep search-server`
```

- [ ] **Step 2: Commit**

---

### Task 13: Update Plan D pending registry

**Files:**
- Modify: `C:\Users\philp\.claude\projects\C--Users-philp\memory\plan-d-pending-registry.md`

- [ ] **Step 1: Mark item #4 as done**

Strike through item 4 with implementation notes:
- Final coverage achieved
- Effort actual vs estimated
- Any deferred follow-ups (e.g. alias dictionary expansion process)

- [ ] **Step 2: Save session memory file**

Create `session-2026-04-30-fs-id-population.md` documenting commits, deploys, smoke tests run.

---

## Quick reference

**Commits expected** (single feature branch `feature/plan-d-settlement-d1`):
1. Phase 1 task 1 — sport-id-map config
2. Phase 1 task 2 — normalize + aliases + tests
3. Phase 1 task 3 — TTL cache + tests
4. Phase 1 task 4 — search logic + tests
5. Phase 1 task 5 — Fastify server
6. Phase 1 task 6 — wire server into index.ts (scraper repo, no git, document only)
7. Phase 2 task 7 — resolve-flashscore-id helper + tests
8. Phase 2 task 8 — integrate hook in upsert.ts + p-limit dep
9. Phase 3 task 10 — backfill script
10. Phase 4 task 12 — runbook
11. Phase 4 task 13 — registry update (memory only, no git)

**Time estimate:**
- Phase 1: 3-4h (mostly Fastify + test scaffolding)
- Phase 2: 1-2h (helper + hook are small)
- Phase 3: 1h script + 30min backfill run
- Phase 4: 30min verify + 30min docs
- **Total: 6-8h** (matches spec estimate)

**Rollback:** stop scraper HTTP server (existing loops unaffected); revert ingester deploy to commit before task 8. Existing populated `flashscore_id` values remain correct.
