# Realtime Producer (Plan D #3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-establish sub-second live odds push from `services/odds-api-ingester` to kiosk browsers via Redis `odds:live` (channel) + `odds:cache` (hash). Producer-only refactor; SSE consumer and browser hook unchanged.

**Architecture:** New module `realtime-publisher.ts` is called by `ingest.ts` after `upserter.upsertBatch(...)`. Status routes `'live'` → diff+publish, `'settled'` → terminal+evict, else skip. In-memory `Map<number, OddsState>` keeps prior odds per event; restart is self-healing (`previous_odds=null` first-seen). Fire-and-forget on Redis errors — Postgres upsert remains source of truth.

**Tech Stack:** Node.js + TypeScript + ESM, vitest, `redis@^4` npm package, Redis 6+ at `127.0.0.1:6379`, runs as `systemctl odds-api-ingester` on `scraper-vps`. Branch `feature/plan-d-settlement-d1` (HEAD `63635d4` after spec commits).

**Spec reference:** `docs/superpowers/specs/2026-05-01-realtime-producer-design.md`

**Working environment:** All code lives on `scraper-vps` at `/root/betssolution-admin/`. Local Windows machine has no clone. Operations are via `ssh scraper-vps '<cmd>'` + `scp` for file transfer. The push-to-GitHub workflow uses the bundle-on-VPS → scp → push-from-Windows-as-`infoundertheguns-ops` pattern documented in memory `project-betssolution-admin-git-desync.md`.

---

## File Structure

| Path | Status | Purpose |
|---|---|---|
| `services/odds-api-ingester/package.json` | Modify | Add `redis@^4` direct dependency |
| `services/odds-api-ingester/src/realtime-publisher.ts` | Create (~180 LoC) | Core publisher: status routing, diff, HSET/PUBLISH, state Map, GC pass |
| `services/odds-api-ingester/src/redis-client.ts` | Create (~40 LoC) | Singleton Redis client + auto-reconnect |
| `services/odds-api-ingester/src/types.ts` | Modify (+~25 LoC) | Add `LiveOddsMessage` and `CachedEvent` wire-contract types |
| `services/odds-api-ingester/src/ingest.ts` | Modify (+~25 LoC) | Build `PublishContext` per event after upsert, call `publisher.publish()`, log errors |
| `services/odds-api-ingester/src/__tests__/realtime-publisher.test.ts` | Create | Unit tests: `computeDiff`, `statusRoute`, `buildCachedEvent`, `publish`, GC pass |
| `services/odds-api-ingester/src/__tests__/redis-client.test.ts` | Create | Singleton + connect-retry behavior |

**Why this structure:**
- `redis-client.ts` is split out (not inlined into publisher) so the publisher's tests can mock the Redis client cleanly via dependency injection. It also makes a future second consumer (e.g., admin dashboard) reuse trivial.
- `realtime-publisher.ts` exposes a small typed surface (`createRealtimePublisher` factory + `RealtimePublisher` interface), keeping internals (state Map, helpers) private.
- Wire contract types live in `types.ts` next to existing `ApiEvent` etc., not in publisher — they describe the SSE consumer side, are reused by tests, and shouldn't be coupled to publisher internals.

---

## Task 1: Add `redis` dependency

**Files:**
- Modify: `services/odds-api-ingester/package.json`
- Modify: lockfile (auto-generated)

- [ ] **Step 1: Verify current state**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && grep -E "\"redis\"" services/odds-api-ingester/package.json || echo "NOT PRESENT"'
```
Expected: `NOT PRESENT`

- [ ] **Step 2: Add dependency**

```bash
ssh scraper-vps 'cd /root/betssolution-admin/services/odds-api-ingester && npm install redis@^4 --save'
```
Expected: completes without error, `package.json` and `package-lock.json` updated.

- [ ] **Step 3: Verify version landed**

```bash
ssh scraper-vps 'cd /root/betssolution-admin/services/odds-api-ingester && node -e "console.log(require(\"./package.json\").dependencies.redis)"'
```
Expected: prints something like `^4.7.0` (any 4.x).

- [ ] **Step 4: Smoke import**

```bash
ssh scraper-vps 'cd /root/betssolution-admin/services/odds-api-ingester && npx tsx -e "import(\"redis\").then(m => console.log(typeof m.createClient))"'
```
Expected: prints `function`.

- [ ] **Step 5: Commit**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git add services/odds-api-ingester/package.json services/odds-api-ingester/package-lock.json && git commit -m "build(ingester): add redis@^4 for realtime publisher (3a)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

## Task 2: Wire-contract types in `types.ts`

These types mirror the SSE consumer (`betssolution-player/lib/hooks/use-live-odds.ts`). They are shared between `realtime-publisher.ts` and its tests, hence in `types.ts`.

**Files:**
- Modify: `services/odds-api-ingester/src/types.ts`

- [ ] **Step 1: Append types to `types.ts`**

```typescript
// === Realtime publisher wire contract (Plan D #3a) ===
// These shapes MUST match the consumer at:
//   betssolution-player/lib/hooks/use-live-odds.ts
//   betssolution-player/app/api/odds/stream/route.ts
// Do not reshape without coordinating with the consumer.

export interface LiveOddsChange {
  market_type: string;
  outcome_name: string;
  odds: number;
  previous_odds: number | null;
}

export interface LiveOddsMessage {
  event_id: string; // String(ApiEvent.id) — Redis wire is string-keyed
  ts: number;
  type: 'update' | 'finished';
  changes: LiveOddsChange[];
  scores?: { home: number; away: number };
  minute?: number;
  period?: string;
}

export interface CachedEventMarket {
  type: string;
  outcomes: Array<{ name: string; odds: number }>;
}

export interface CachedEvent {
  external_id: string;
  home_team: string;
  away_team: string;
  sport: string;
  league: string;
  minute?: number;
  period?: string;
  scores?: { home: number; away: number };
  markets: CachedEventMarket[];
  updated_at: number;
}
```

Place these at the end of `types.ts`, after the existing exports.

- [ ] **Step 2: Type-check**

```bash
ssh scraper-vps 'cd /root/betssolution-admin/services/odds-api-ingester && npx tsc --noEmit'
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git add services/odds-api-ingester/src/types.ts && git commit -m "feat(ingester): add LiveOddsMessage + CachedEvent wire types (3a)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

## Task 3: `redis-client.ts` singleton + tests

**Files:**
- Create: `services/odds-api-ingester/src/redis-client.ts`
- Create: `services/odds-api-ingester/src/__tests__/redis-client.test.ts`

- [ ] **Step 1: Write failing tests**

Create `services/odds-api-ingester/src/__tests__/redis-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createClientMock = vi.fn();

vi.mock('redis', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

describe('redis-client', () => {
  beforeEach(() => {
    vi.resetModules();
    createClientMock.mockReset();
  });

  it('lazily creates a client on first getRedisClient() call and reuses it', async () => {
    const fakeClient = {
      isOpen: true,
      connect: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      quit: vi.fn().mockResolvedValue(undefined),
    };
    createClientMock.mockReturnValue(fakeClient);

    const mod = await import('../redis-client.js');
    const c1 = await mod.getRedisClient();
    const c2 = await mod.getRedisClient();

    expect(c1).toBe(c2);
    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(fakeClient.connect).toHaveBeenCalledTimes(1);
  });

  it('uses REDIS_URL env when provided', async () => {
    const fakeClient = { isOpen: true, connect: vi.fn(), on: vi.fn(), quit: vi.fn() };
    createClientMock.mockReturnValue(fakeClient);
    const orig = process.env.REDIS_URL;
    process.env.REDIS_URL = 'redis://example.test:9999';

    const mod = await import('../redis-client.js');
    await mod.getRedisClient();

    expect(createClientMock).toHaveBeenCalledWith({ url: 'redis://example.test:9999' });

    process.env.REDIS_URL = orig;
  });

  it('falls back to redis://127.0.0.1:6379 when REDIS_URL unset', async () => {
    const fakeClient = { isOpen: true, connect: vi.fn(), on: vi.fn(), quit: vi.fn() };
    createClientMock.mockReturnValue(fakeClient);
    const orig = process.env.REDIS_URL;
    delete process.env.REDIS_URL;

    const mod = await import('../redis-client.js');
    await mod.getRedisClient();

    expect(createClientMock).toHaveBeenCalledWith({ url: 'redis://127.0.0.1:6379' });

    if (orig !== undefined) process.env.REDIS_URL = orig;
  });

  it('reconnects when isOpen becomes false', async () => {
    const closedClient = { isOpen: false, connect: vi.fn(), on: vi.fn(), quit: vi.fn() };
    const freshClient = { isOpen: true, connect: vi.fn().mockResolvedValue(undefined), on: vi.fn(), quit: vi.fn() };
    createClientMock.mockReturnValueOnce(closedClient).mockReturnValueOnce(freshClient);

    const mod = await import('../redis-client.js');
    const first = await mod.getRedisClient();
    expect(first).toBe(closedClient);
    // simulate disconnect: closedClient.isOpen is already false
    const second = await mod.getRedisClient();
    expect(second).toBe(freshClient);
    expect(createClientMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
ssh scraper-vps 'cd /root/betssolution-admin/services/odds-api-ingester && npm test -- redis-client'
```
Expected: 4 tests fail with import error or "Cannot find module '../redis-client.js'".

- [ ] **Step 3: Implement `redis-client.ts`**

Create `services/odds-api-ingester/src/redis-client.ts`:

```typescript
import { createClient } from 'redis';

export type RedisClient = ReturnType<typeof createClient>;

const REDIS_URL = (): string => process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const g = globalThis as unknown as { __ingesterRedisClient?: RedisClient };

async function ensureClient(): Promise<RedisClient> {
  const existing = g.__ingesterRedisClient;
  if (existing && existing.isOpen) return existing;

  const client = createClient({ url: REDIS_URL() });
  client.on('error', (err: Error) => {
    console.error(`[redis-client] ${err.message}`);
  });
  await client.connect();
  g.__ingesterRedisClient = client;
  return client;
}

export async function getRedisClient(): Promise<RedisClient> {
  return ensureClient();
}

export async function disposeRedisClient(): Promise<void> {
  const c = g.__ingesterRedisClient;
  if (c && c.isOpen) {
    try { await c.quit(); } catch { /* ignore */ }
  }
  g.__ingesterRedisClient = undefined;
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
ssh scraper-vps 'cd /root/betssolution-admin/services/odds-api-ingester && npm test -- redis-client'
```
Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git add services/odds-api-ingester/src/redis-client.ts services/odds-api-ingester/src/__tests__/redis-client.test.ts && git commit -m "feat(ingester): add redis-client singleton helper (3a)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

## Task 4: `computeDiff` pure function (TDD)

**Files:**
- Create (test placeholder): `services/odds-api-ingester/src/__tests__/realtime-publisher.test.ts`
- Create (impl placeholder): `services/odds-api-ingester/src/realtime-publisher.ts`

- [ ] **Step 1: Create the test file with failing `computeDiff` tests**

Create `services/odds-api-ingester/src/__tests__/realtime-publisher.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeDiff } from '../realtime-publisher.js';

describe('computeDiff', () => {
  it('returns all outcomes with previous_odds=null on first sight (empty prior state)', () => {
    const prior = new Map<string, number>();
    const next = [
      { market_type: '1X2', outcome_name: 'home', odds: 2.10 },
      { market_type: '1X2', outcome_name: 'draw', odds: 3.30 },
    ];
    const diff = computeDiff(prior, next);
    expect(diff).toEqual([
      { market_type: '1X2', outcome_name: 'home', odds: 2.10, previous_odds: null },
      { market_type: '1X2', outcome_name: 'draw', odds: 3.30, previous_odds: null },
    ]);
  });

  it('returns empty array when nothing changed', () => {
    const prior = new Map([['1X2|home', 2.10], ['1X2|draw', 3.30]]);
    const next = [
      { market_type: '1X2', outcome_name: 'home', odds: 2.10 },
      { market_type: '1X2', outcome_name: 'draw', odds: 3.30 },
    ];
    expect(computeDiff(prior, next)).toEqual([]);
  });

  it('returns only the changed outcome', () => {
    const prior = new Map([['1X2|home', 2.10], ['1X2|draw', 3.30]]);
    const next = [
      { market_type: '1X2', outcome_name: 'home', odds: 2.05 },
      { market_type: '1X2', outcome_name: 'draw', odds: 3.30 },
    ];
    expect(computeDiff(prior, next)).toEqual([
      { market_type: '1X2', outcome_name: 'home', odds: 2.05, previous_odds: 2.10 },
    ]);
  });

  it('treats new outcome (key not in prior) as previous_odds=null', () => {
    const prior = new Map([['1X2|home', 2.10]]);
    const next = [
      { market_type: '1X2', outcome_name: 'home', odds: 2.10 },
      { market_type: 'OU', outcome_name: 'over_2.5', odds: 1.85 },
    ];
    expect(computeDiff(prior, next)).toEqual([
      { market_type: 'OU', outcome_name: 'over_2.5', odds: 1.85, previous_odds: null },
    ]);
  });

  it('does not emit a delete entry for outcome that disappeared from payload', () => {
    const prior = new Map([['1X2|home', 2.10], ['1X2|draw', 3.30]]);
    const next = [
      { market_type: '1X2', outcome_name: 'home', odds: 2.10 },
      // draw disappeared
    ];
    expect(computeDiff(prior, next)).toEqual([]);
  });

  it('uses literal numeric equality (small float diffs do count as change)', () => {
    const prior = new Map([['1X2|home', 2.10]]);
    const next = [{ market_type: '1X2', outcome_name: 'home', odds: 2.1000001 }];
    const diff = computeDiff(prior, next);
    expect(diff).toHaveLength(1);
    expect(diff[0].previous_odds).toBe(2.10);
  });
});
```

- [ ] **Step 2: Create skeleton `realtime-publisher.ts` with all imports pre-declared**

Create `services/odds-api-ingester/src/realtime-publisher.ts`. Pre-declare all imports up front so subsequent tasks (5, 6, 7) only append implementation bodies and don't scatter imports through the file:

```typescript
// Plan D #3a — realtime publisher.
// See docs/superpowers/specs/2026-05-01-realtime-producer-design.md

import type {
  ApiEvent,
  CachedEvent,
  CachedEventMarket,
  LiveOddsMessage,
} from './types.js';
import type { RedisClient } from './redis-client.js';

export interface NewOddsEntry {
  market_type: string;
  outcome_name: string;
  odds: number;
}

export interface DiffEntry extends NewOddsEntry {
  previous_odds: number | null;
}

const stateKey = (e: { market_type: string; outcome_name: string }): string =>
  `${e.market_type}|${e.outcome_name}`;

export function computeDiff(
  priorOutcomes: Map<string, number>,
  next: NewOddsEntry[],
): DiffEntry[] {
  const out: DiffEntry[] = [];
  for (const entry of next) {
    const k = stateKey(entry);
    const prev = priorOutcomes.get(k);
    if (prev === undefined) {
      out.push({ ...entry, previous_odds: null });
    } else if (prev !== entry.odds) {
      out.push({ ...entry, previous_odds: prev });
    }
  }
  return out;
}
```

In Tasks 5, 6, 7 below, the "Append" steps add ONLY new exports/functions to the bottom of this file. Do NOT add new `import` statements per-task — the imports above already cover all task needs.

- [ ] **Step 3: Run tests, verify pass**

```bash
ssh scraper-vps 'cd /root/betssolution-admin/services/odds-api-ingester && npm test -- realtime-publisher'
```
Expected: 6/6 pass.

- [ ] **Step 4: Commit**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git add services/odds-api-ingester/src/realtime-publisher.ts services/odds-api-ingester/src/__tests__/realtime-publisher.test.ts && git commit -m "feat(ingester): computeDiff pure function (3a)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

## Task 5: `statusRoute` filter (TDD)

**Files:**
- Modify: `services/odds-api-ingester/src/__tests__/realtime-publisher.test.ts` (append tests)
- Modify: `services/odds-api-ingester/src/realtime-publisher.ts` (add function)

- [ ] **Step 1: Append failing tests**

Append to `realtime-publisher.test.ts`:

```typescript
import { statusRoute } from '../realtime-publisher.js';
import type { ApiEvent } from '../types.js';

describe('statusRoute', () => {
  it('routes live to "live"', () => {
    expect(statusRoute('live')).toBe('live');
  });
  it('routes settled to "settled"', () => {
    expect(statusRoute('settled')).toBe('settled');
  });
  it('routes pending to "skip"', () => {
    expect(statusRoute('pending')).toBe('skip');
  });
  it('routes cancelled to "skip"', () => {
    expect(statusRoute('cancelled')).toBe('skip');
  });
  it('routes postponed to "skip"', () => {
    expect(statusRoute('postponed')).toBe('skip');
  });
  it('is exhaustive on ApiEvent[\"status\"]', () => {
    // type-level check: this test exists to assert compile-time exhaustiveness.
    // If a new variant is added to ApiEvent['status'], the switch in
    // realtime-publisher.ts will fail to compile. This test documents intent.
    const all: Array<ApiEvent['status']> = ['pending', 'live', 'settled', 'cancelled', 'postponed'];
    for (const s of all) {
      expect(['live', 'settled', 'skip']).toContain(statusRoute(s));
    }
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
ssh scraper-vps 'cd /root/betssolution-admin/services/odds-api-ingester && npm test -- realtime-publisher'
```
Expected: 6 fail with "statusRoute is not a function" / "not exported".

- [ ] **Step 3: Implement `statusRoute`**

Append to `realtime-publisher.ts` (imports already declared in Task 4 Step 2):

```typescript
export type StatusRoute = 'live' | 'settled' | 'skip';

export function statusRoute(status: ApiEvent['status']): StatusRoute {
  switch (status) {
    case 'live':
      return 'live';
    case 'settled':
      return 'settled';
    case 'pending':
    case 'cancelled':
    case 'postponed':
      return 'skip';
    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      return 'skip';
    }
  }
}
```

The `default` branch with `_exhaustive: never` is the TypeScript exhaustiveness pattern — adding a new variant to `ApiEvent['status']` causes a compile error here.

- [ ] **Step 4: Run tests, verify pass**

```bash
ssh scraper-vps 'cd /root/betssolution-admin/services/odds-api-ingester && npm test -- realtime-publisher'
```
Expected: 12/12 pass (6 prior + 6 new).

- [ ] **Step 5: Commit**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git add services/odds-api-ingester/src/realtime-publisher.ts services/odds-api-ingester/src/__tests__/realtime-publisher.test.ts && git commit -m "feat(ingester): statusRoute filter for realtime publisher (3a)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

## Task 6: `buildCachedEvent` snapshot builder (TDD)

This builds the `CachedEvent` shape from an `ApiEvent` for HSET to `odds:cache`.

**Files:**
- Modify: `services/odds-api-ingester/src/__tests__/realtime-publisher.test.ts` (append tests)
- Modify: `services/odds-api-ingester/src/realtime-publisher.ts` (add function)

- [ ] **Step 1: Append failing tests**

Append to `realtime-publisher.test.ts`:

```typescript
import { buildCachedEvent } from '../realtime-publisher.js';
import type { CachedEvent } from '../types.js';

const baseApiEvent = {
  id: 12345,
  home: 'Inter',
  away: 'Milan',
  date: '2026-05-01T20:00:00Z',
  status: 'live' as const,
  sport: { name: 'Football', slug: 'football' },
  league: { name: 'Serie A', slug: 'italy-serie-a' },
};

describe('buildCachedEvent', () => {
  it('produces required fields with empty markets when no odds', () => {
    const c = buildCachedEvent(baseApiEvent, []);
    expect(c.external_id).toBe('12345');
    expect(c.home_team).toBe('Inter');
    expect(c.away_team).toBe('Milan');
    expect(c.sport).toBe('football');
    expect(c.league).toBe('italy-serie-a');
    expect(c.markets).toEqual([]);
    expect(typeof c.updated_at).toBe('number');
    expect(c.scores).toBeUndefined();
    expect(c.minute).toBeUndefined();
    expect(c.period).toBeUndefined();
  });

  it('includes scores when present', () => {
    const ev = { ...baseApiEvent, scores: { home: 1, away: 0 } };
    const c = buildCachedEvent(ev, []);
    expect(c.scores).toEqual({ home: 1, away: 0 });
  });

  it('omits scores when home/away missing', () => {
    const ev = { ...baseApiEvent, scores: { periods: { '1H': { home: 0, away: 0 } } } };
    const c = buildCachedEvent(ev, []);
    expect(c.scores).toBeUndefined();
  });

  it('groups outcomes by market_type', () => {
    const odds = [
      { market_type: '1X2', outcome_name: 'home', odds: 2.10 },
      { market_type: '1X2', outcome_name: 'draw', odds: 3.30 },
      { market_type: '1X2', outcome_name: 'away', odds: 3.50 },
      { market_type: 'OU 2.5', outcome_name: 'over', odds: 1.85 },
      { market_type: 'OU 2.5', outcome_name: 'under', odds: 1.95 },
    ];
    const c = buildCachedEvent(baseApiEvent, odds);
    expect(c.markets).toEqual<CachedEvent['markets']>([
      { type: '1X2', outcomes: [
        { name: 'home', odds: 2.10 },
        { name: 'draw', odds: 3.30 },
        { name: 'away', odds: 3.50 },
      ]},
      { type: 'OU 2.5', outcomes: [
        { name: 'over', odds: 1.85 },
        { name: 'under', odds: 1.95 },
      ]},
    ]);
  });

  it('preserves outcome insertion order within a market', () => {
    const odds = [
      { market_type: 'OU 0.5', outcome_name: 'over', odds: 1.05 },
      { market_type: 'OU 0.5', outcome_name: 'under', odds: 8.00 },
    ];
    const c = buildCachedEvent(baseApiEvent, odds);
    expect(c.markets[0].outcomes.map(o => o.name)).toEqual(['over', 'under']);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
ssh scraper-vps 'cd /root/betssolution-admin/services/odds-api-ingester && npm test -- realtime-publisher'
```
Expected: 5 new fail with "buildCachedEvent is not a function".

- [ ] **Step 3: Implement `buildCachedEvent`**

Append to `realtime-publisher.ts` (imports already declared in Task 4 Step 2):

```typescript
export type BuildCachedEventInput = Pick<
  ApiEvent,
  'id' | 'home' | 'away' | 'sport' | 'league' | 'scores'
> & {
  minute?: number;
  period?: string;
};

export function buildCachedEvent(
  ev: BuildCachedEventInput,
  newOdds: NewOddsEntry[],
): CachedEvent {
  const grouped = new Map<string, CachedEventMarket>();
  for (const o of newOdds) {
    let m = grouped.get(o.market_type);
    if (!m) {
      m = { type: o.market_type, outcomes: [] };
      grouped.set(o.market_type, m);
    }
    m.outcomes.push({ name: o.outcome_name, odds: o.odds });
  }

  const cached: CachedEvent = {
    external_id: String(ev.id),
    home_team: ev.home,
    away_team: ev.away,
    sport: ev.sport.slug,
    league: ev.league.slug,
    markets: [...grouped.values()],
    updated_at: Date.now(),
  };

  if (ev.scores && typeof ev.scores.home === 'number' && typeof ev.scores.away === 'number') {
    cached.scores = { home: ev.scores.home, away: ev.scores.away };
  }
  if (typeof ev.minute === 'number') cached.minute = ev.minute;
  if (typeof ev.period === 'string') cached.period = ev.period;

  return cached;
}
```

Note: `minute` and `period` are not present on `ApiEvent` directly (verified in `types.ts`). They are accepted as optional input for future enrichment but currently always undefined — kept on the input shape so the publisher signature is stable.

- [ ] **Step 4: Run tests, verify pass**

```bash
ssh scraper-vps 'cd /root/betssolution-admin/services/odds-api-ingester && npm test -- realtime-publisher'
```
Expected: 17/17 pass (12 prior + 5 new).

- [ ] **Step 5: Commit**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git add services/odds-api-ingester/src/realtime-publisher.ts services/odds-api-ingester/src/__tests__/realtime-publisher.test.ts && git commit -m "feat(ingester): buildCachedEvent snapshot builder (3a)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

## Task 7: `RealtimePublisher` factory + `publish()` end-to-end (TDD)

This is the core integration: `createRealtimePublisher(redisClient)` returns an object with `publish(ctx)`, `getStateSize()`, `evictEvent(id)`, `dispose()`.

**Files:**
- Modify: `services/odds-api-ingester/src/__tests__/realtime-publisher.test.ts` (append tests)
- Modify: `services/odds-api-ingester/src/realtime-publisher.ts` (add factory)

- [ ] **Step 1: Append failing tests**

Append to `realtime-publisher.test.ts`:

```typescript
import { createRealtimePublisher } from '../realtime-publisher.js';

function makeRedisMock() {
  return {
    hSet: vi.fn().mockResolvedValue(1),
    hDel: vi.fn().mockResolvedValue(1),
    publish: vi.fn().mockResolvedValue(1),
    isOpen: true,
  };
}

const liveBase = {
  id: 999,
  status: 'live' as const,
  home: 'A',
  away: 'B',
  sport: { name: 'Football', slug: 'football' },
  league: { name: 'L', slug: 'l' },
};

describe('publish — live path', () => {
  it('writes HSET odds:cache and PUBLISH on first sight (full diff)', async () => {
    const redis = makeRedisMock();
    const pub = createRealtimePublisher(redis as any);
    const r = await pub.publish({
      event: liveBase,
      newOdds: [{ market_type: '1X2', outcome_name: 'home', odds: 2.10 }],
    });
    expect(r).toEqual({ published: true, changesCount: 1 });
    expect(redis.hSet).toHaveBeenCalledWith('odds:cache', '999', expect.any(String));
    expect(redis.publish).toHaveBeenCalledWith('odds:live', expect.any(String));
    const msg = JSON.parse(redis.publish.mock.calls[0][1] as string);
    expect(msg.event_id).toBe('999');
    expect(msg.type).toBe('update');
    expect(msg.changes).toEqual([
      { market_type: '1X2', outcome_name: 'home', odds: 2.10, previous_odds: null },
    ]);
    expect(typeof msg.ts).toBe('number');
  });

  it('refreshes HSET but does NOT PUBLISH when diff is empty', async () => {
    const redis = makeRedisMock();
    const pub = createRealtimePublisher(redis as any);
    await pub.publish({ event: liveBase, newOdds: [{ market_type: '1X2', outcome_name: 'home', odds: 2.10 }] });
    redis.hSet.mockClear();
    redis.publish.mockClear();
    const r = await pub.publish({ event: liveBase, newOdds: [{ market_type: '1X2', outcome_name: 'home', odds: 2.10 }] });
    expect(r).toEqual({ published: false, reason: 'no_changes', changesCount: 0 });
    expect(redis.hSet).toHaveBeenCalledTimes(1);
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('updates state map after a successful publish', async () => {
    const redis = makeRedisMock();
    const pub = createRealtimePublisher(redis as any);
    await pub.publish({ event: liveBase, newOdds: [{ market_type: '1X2', outcome_name: 'home', odds: 2.10 }] });
    expect(pub.getStateSize()).toBe(1);
  });
});

describe('publish — non-live skip path', () => {
  it.each([['pending'], ['cancelled'], ['postponed']] as const)('skips %s without any redis op', async (status) => {
    const redis = makeRedisMock();
    const pub = createRealtimePublisher(redis as any);
    const r = await pub.publish({
      event: { ...liveBase, status },
      newOdds: [{ market_type: '1X2', outcome_name: 'home', odds: 2.10 }],
    });
    expect(r).toEqual({ published: false, reason: 'not_live', changesCount: 0 });
    expect(redis.hSet).not.toHaveBeenCalled();
    expect(redis.publish).not.toHaveBeenCalled();
  });
});

describe('publish — settled path', () => {
  it('publishes finished + HDEL + evicts state', async () => {
    const redis = makeRedisMock();
    const pub = createRealtimePublisher(redis as any);
    // first put the event in state
    await pub.publish({ event: liveBase, newOdds: [{ market_type: '1X2', outcome_name: 'home', odds: 2.10 }] });
    expect(pub.getStateSize()).toBe(1);
    redis.hSet.mockClear();
    redis.publish.mockClear();

    const r = await pub.publish({ event: { ...liveBase, status: 'settled' }, newOdds: [] });
    expect(r).toEqual({ published: true, reason: 'finished', changesCount: 0 });
    expect(redis.publish).toHaveBeenCalledWith('odds:live', expect.any(String));
    const msg = JSON.parse(redis.publish.mock.calls[0][1] as string);
    expect(msg.type).toBe('finished');
    expect(msg.event_id).toBe('999');
    expect(msg.changes).toEqual([]);
    expect(redis.hDel).toHaveBeenCalledWith('odds:cache', '999');
    expect(pub.getStateSize()).toBe(0);
  });

  it('is idempotent when called for an already-evicted event', async () => {
    const redis = makeRedisMock();
    const pub = createRealtimePublisher(redis as any);
    const r1 = await pub.publish({ event: { ...liveBase, status: 'settled' }, newOdds: [] });
    expect(r1).toEqual({ published: true, reason: 'finished', changesCount: 0 });
    const r2 = await pub.publish({ event: { ...liveBase, status: 'settled' }, newOdds: [] });
    expect(r2).toEqual({ published: true, reason: 'finished', changesCount: 0 });
    expect(redis.publish).toHaveBeenCalledTimes(2);
    expect(redis.hDel).toHaveBeenCalledTimes(2);
  });
});

describe('publish — failure modes', () => {
  it('catches redis errors and returns redis_unavailable, does not propagate', async () => {
    const redis = makeRedisMock();
    redis.hSet.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const pub = createRealtimePublisher(redis as any);
    const r = await pub.publish({ event: liveBase, newOdds: [{ market_type: '1X2', outcome_name: 'home', odds: 2.10 }] });
    expect(r).toEqual({ published: false, reason: 'redis_unavailable', changesCount: 0 });
  });

  it('returns skipped when REALTIME_PUBLISHER_ENABLED=false', async () => {
    const orig = process.env.REALTIME_PUBLISHER_ENABLED;
    process.env.REALTIME_PUBLISHER_ENABLED = 'false';
    const redis = makeRedisMock();
    const pub = createRealtimePublisher(redis as any);
    const r = await pub.publish({ event: liveBase, newOdds: [{ market_type: '1X2', outcome_name: 'home', odds: 2.10 }] });
    expect(r).toEqual({ published: false, reason: 'skipped', changesCount: 0 });
    expect(redis.hSet).not.toHaveBeenCalled();
    expect(redis.publish).not.toHaveBeenCalled();
    if (orig === undefined) delete process.env.REALTIME_PUBLISHER_ENABLED;
    else process.env.REALTIME_PUBLISHER_ENABLED = orig;
  });
});

describe('evictEvent / getStateSize', () => {
  it('evictEvent removes from state map', async () => {
    const redis = makeRedisMock();
    const pub = createRealtimePublisher(redis as any);
    await pub.publish({ event: liveBase, newOdds: [{ market_type: '1X2', outcome_name: 'home', odds: 2.10 }] });
    expect(pub.getStateSize()).toBe(1);
    pub.evictEvent(999);
    expect(pub.getStateSize()).toBe(0);
  });
});
```

Update the existing vitest import line at the top of `realtime-publisher.test.ts` to include `vi`:

```typescript
import { describe, it, expect, vi } from 'vitest';
```

(The prior tasks imported only `describe, it, expect` — `vi` is needed from this task onward for mocks.)

- [ ] **Step 2: Run tests, verify they fail**

```bash
ssh scraper-vps 'cd /root/betssolution-admin/services/odds-api-ingester && npm test -- realtime-publisher'
```
Expected: ~10 new fails with "createRealtimePublisher is not a function".

- [ ] **Step 3: Implement `createRealtimePublisher`**

Append to `realtime-publisher.ts` (imports already declared in Task 4 Step 2):

```typescript
export interface PublishContext {
  event: BuildCachedEventInput & {
    id: number;
    status: ApiEvent['status'];
  };
  newOdds: NewOddsEntry[];
}

export type PublishReason =
  | 'not_live'
  | 'no_changes'
  | 'redis_unavailable'
  | 'finished'
  | 'skipped';

export interface PublishResult {
  published: boolean;
  reason?: PublishReason;
  changesCount: number;
}

export interface RealtimePublisher {
  publish(ctx: PublishContext): Promise<PublishResult>;
  getStateSize(): number;
  evictEvent(eventId: number): void;
  dispose(): void;
}

interface OddsState {
  outcomes: Map<string, number>;
  lastTouched: number;
}

const CHANNEL = 'odds:live';
const CACHE_HASH = 'odds:cache';

export function createRealtimePublisher(redis: RedisClient): RealtimePublisher {
  const stateByEvent = new Map<number, OddsState>();

  async function publish(ctx: PublishContext): Promise<PublishResult> {
    if (process.env.REALTIME_PUBLISHER_ENABLED === 'false') {
      return { published: false, reason: 'skipped', changesCount: 0 };
    }

    const route = statusRoute(ctx.event.status);
    if (route === 'skip') {
      return { published: false, reason: 'not_live', changesCount: 0 };
    }

    const eventId = ctx.event.id;
    const eventIdStr = String(eventId);

    if (route === 'settled') {
      try {
        const msg: LiveOddsMessage = {
          event_id: eventIdStr,
          ts: Date.now(),
          type: 'finished',
          changes: [],
        };
        await redis.publish(CHANNEL, JSON.stringify(msg));
        await redis.hDel(CACHE_HASH, eventIdStr);
        stateByEvent.delete(eventId);
        return { published: true, reason: 'finished', changesCount: 0 };
      } catch (err) {
        console.error(`[realtime] settled-path redis op failed for ${eventId}:`, (err as Error).message);
        return { published: false, reason: 'redis_unavailable', changesCount: 0 };
      }
    }

    // route === 'live'
    try {
      const cached = buildCachedEvent(ctx.event, ctx.newOdds);
      await redis.hSet(CACHE_HASH, eventIdStr, JSON.stringify(cached));

      const prior = stateByEvent.get(eventId)?.outcomes ?? new Map<string, number>();
      const diff = computeDiff(prior, ctx.newOdds);

      if (diff.length === 0) {
        // refresh lastTouched only
        const existing = stateByEvent.get(eventId);
        if (existing) existing.lastTouched = Date.now();
        return { published: false, reason: 'no_changes', changesCount: 0 };
      }

      // update state with new odds
      const nextOutcomes = new Map<string, number>(prior);
      for (const o of ctx.newOdds) {
        nextOutcomes.set(`${o.market_type}|${o.outcome_name}`, o.odds);
      }
      stateByEvent.set(eventId, { outcomes: nextOutcomes, lastTouched: Date.now() });

      const msg: LiveOddsMessage = {
        event_id: eventIdStr,
        ts: Date.now(),
        type: 'update',
        changes: diff,
        ...(cached.scores ? { scores: cached.scores } : {}),
        ...(cached.minute !== undefined ? { minute: cached.minute } : {}),
        ...(cached.period !== undefined ? { period: cached.period } : {}),
      };
      await redis.publish(CHANNEL, JSON.stringify(msg));
      console.log(`[realtime] published ${eventId} changes=${diff.length}`);
      return { published: true, changesCount: diff.length };
    } catch (err) {
      console.error(`[realtime] live-path redis op failed for ${eventId}:`, (err as Error).message);
      return { published: false, reason: 'redis_unavailable', changesCount: 0 };
    }
  }

  function getStateSize(): number {
    return stateByEvent.size;
  }

  function evictEvent(eventId: number): void {
    stateByEvent.delete(eventId);
  }

  // GC pass: drop entries older than 30min, runs every 5min.
  // Belt-and-suspenders: handles events that disappear from odds-api before reaching 'settled'.
  const STALE_MS = 30 * 60_000;
  const gcInterval = setInterval(() => {
    const cutoff = Date.now() - STALE_MS;
    for (const [id, state] of stateByEvent.entries()) {
      if (state.lastTouched < cutoff) stateByEvent.delete(id);
    }
  }, 5 * 60_000);
  // Don't keep process alive just for GC.
  if (typeof gcInterval.unref === 'function') gcInterval.unref();

  function dispose(): void {
    clearInterval(gcInterval);
  }

  return { publish, getStateSize, evictEvent, dispose };
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
ssh scraper-vps 'cd /root/betssolution-admin/services/odds-api-ingester && npm test -- realtime-publisher'
```
Expected: all pass (~27 tests).

- [ ] **Step 5: Type-check whole package**

```bash
ssh scraper-vps 'cd /root/betssolution-admin/services/odds-api-ingester && npx tsc --noEmit'
```
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git add services/odds-api-ingester/src/realtime-publisher.ts services/odds-api-ingester/src/__tests__/realtime-publisher.test.ts && git commit -m "feat(ingester): RealtimePublisher factory with status routing (3a)

Implements:
- live path: HSET odds:cache + PUBLISH odds:live with diff
- settled path: PUBLISH finished + HDEL + evict (idempotent)
- skip for pending/cancelled/postponed
- fire-and-forget on redis errors
- REALTIME_PUBLISHER_ENABLED=false kill switch
- GC pass every 5min for stale state entries

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

## Task 8: GC pass tests with fake timers

**Files:**
- Modify: `services/odds-api-ingester/src/__tests__/realtime-publisher.test.ts`

- [ ] **Step 1: Append GC tests using vi.useFakeTimers**

Append to `realtime-publisher.test.ts`:

```typescript
describe('GC pass for stale entries', () => {
  it('removes entries not touched in 30+ minutes', async () => {
    vi.useFakeTimers();
    const redis = makeRedisMock();
    const pub = createRealtimePublisher(redis as any);
    await pub.publish({ event: liveBase, newOdds: [{ market_type: '1X2', outcome_name: 'home', odds: 2.10 }] });
    expect(pub.getStateSize()).toBe(1);

    // Advance 35 min → > 30 min stale threshold.
    vi.advanceTimersByTime(35 * 60_000);
    // GC runs every 5min, so multiple ticks fire — at least one after 30min.
    expect(pub.getStateSize()).toBe(0);
    pub.dispose();
    vi.useRealTimers();
  });

  it('does NOT remove entries touched within 30 minutes', async () => {
    vi.useFakeTimers();
    const redis = makeRedisMock();
    const pub = createRealtimePublisher(redis as any);
    await pub.publish({ event: liveBase, newOdds: [{ market_type: '1X2', outcome_name: 'home', odds: 2.10 }] });

    // Advance 20 min, then touch via no-change publish.
    vi.advanceTimersByTime(20 * 60_000);
    await pub.publish({ event: liveBase, newOdds: [{ market_type: '1X2', outcome_name: 'home', odds: 2.10 }] });

    // Advance another 20 min (total 40), GC fires, but lastTouched is only 20 min stale.
    vi.advanceTimersByTime(20 * 60_000);
    expect(pub.getStateSize()).toBe(1);
    pub.dispose();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run tests, verify pass**

```bash
ssh scraper-vps 'cd /root/betssolution-admin/services/odds-api-ingester && npm test -- realtime-publisher'
```
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git add services/odds-api-ingester/src/__tests__/realtime-publisher.test.ts && git commit -m "test(ingester): cover GC pass for stale state entries (3a)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

## Task 9: Wire publisher into `ingest.ts`

After `upserter.upsertBatch(...)`, build `PublishContext` for each event and call `publisher.publish(ctx)` with errors swallowed.

**Files:**
- Modify: `services/odds-api-ingester/src/ingest.ts`

- [ ] **Step 1: Read the current call site**

```bash
ssh scraper-vps 'grep -n "upsertBatch\|maybeResolveFsId\|results: TransformResult" /root/betssolution-admin/services/odds-api-ingester/src/ingest.ts'
```
Identify the line number where `upsertBatch` returns and where the per-event loop iterates.

- [ ] **Step 2: Add imports + dependency wiring**

Add to top of `ingest.ts`:

```typescript
import { createRealtimePublisher, type RealtimePublisher } from './realtime-publisher.js';
import { getRedisClient } from './redis-client.js';
```

Verify `ApiEvent` and `TransformResult` are already imported (they are: existing line `import type { ApiEvent, TransformResult } from './types.js';` near top). If for any reason they aren't in scope at your call site, add them — Step 3 below uses both type names in the `enrichedPairs` typing.

Extend `IngesterDeps`:

```typescript
export type IngesterDeps = {
  client: OddsApiClient;
  upserter: Upserter;
  bookmakers: string[];
  publisher?: RealtimePublisher;  // optional — undefined means publishing disabled
};
```

- [ ] **Step 3: Wire the publish call after upsert**

In `runSportTier` (the function that calls `upsertBatch`), after a successful upsert, add a per-event publish loop. The publisher needs the original `ApiEvent` objects (with status + scores) plus the flat outcome list — both come from the per-chunk `enrichedList`.

Find the existing block:

```typescript
for (const enriched of enrichedList) {
  results.push(transformEvent(enriched));
  summary.odds_fetched++;
}
```

Change to capture the `(enriched, transformResult)` pairs:

```typescript
const enrichedPairs: Array<{ enriched: ApiEvent; result: TransformResult }> = [];
for (const enriched of enrichedList) {
  const result = transformEvent(enriched);
  results.push(result);
  enrichedPairs.push({ enriched, result });
  summary.odds_fetched++;
}
```

Then **after** `upserter.upsertBatch(...)` succeeds (inside the `if (results.length > 0) { try { ... } }` block, after the FS-id resolution `Promise.all`), add:

```typescript
if (deps.publisher) {
  for (const { enriched, result } of enrichedPairs) {
    const newOdds = result.outcomes.map(o => ({
      market_type: o.market_key.market_name,
      outcome_name: o.outcome_key,
      odds: o.odds,
    }));
    try {
      await deps.publisher.publish({
        event: {
          id: enriched.id,
          status: enriched.status,
          home: enriched.home,
          away: enriched.away,
          sport: enriched.sport,
          league: enriched.league,
          scores: enriched.scores,
        },
        newOdds,
      });
    } catch (err) {
      // Belt-and-suspenders: publisher already handles its own errors,
      // but if anything escapes (e.g., bad input), we never want to fail ingest.
      console.error(`[realtime] unexpected error for event ${enriched.id}:`, (err as Error).message);
    }
  }
}
```

- [ ] **Step 4: Wire `publisher` into `main()`**

In the `main()` function near the bottom of `ingest.ts`, after `upserter` is constructed, add:

```typescript
const redisClient = await getRedisClient();
const publisher = createRealtimePublisher(redisClient);
```

And include it in the `deps` object:

```typescript
const deps: IngesterDeps = {
  client: new OddsApiClient({ apiKey, baseUrl }),
  upserter: new Upserter({ supabaseUrl, serviceRoleKey: serviceRole }),
  bookmakers: ENABLED_BOOKMAKERS,
  publisher,
};
```

- [ ] **Step 5: Mirror the wiring in `scheduler.ts` (production entry point — REQUIRED)**

`scheduler.ts` is the production entry point invoked by `systemctl odds-api-ingester` (it runs `tsx src/scheduler.ts`, not `ingest.ts`). It has its own `main()` that constructs `IngesterDeps` independently. **Without this step the production cron-driven path runs without a publisher — silent feature failure.**

Verified file shape: `scheduler.ts` imports `{ runTier, type IngesterDeps, ... } from './ingest.js'`, defines `async function main()` around line 181, and constructs `const deps: IngesterDeps = { client, upserter, bookmakers }` around line 187.

Edit `services/odds-api-ingester/src/scheduler.ts`:

a) Add to top imports:

```typescript
import { createRealtimePublisher } from './realtime-publisher.js';
import { getRedisClient } from './redis-client.js';
```

b) In `main()`, after `const serviceRole = requireEnv('SUPABASE_SERVICE_ROLE');` and before the `const deps: IngesterDeps = { ... }` block, add:

```typescript
const redisClient = await getRedisClient();
const publisher = createRealtimePublisher(redisClient);
```

c) Change the `deps` literal to include `publisher`:

```typescript
const deps: IngesterDeps = {
  client: new OddsApiClient({ apiKey, baseUrl }),
  upserter: new Upserter({ supabaseUrl, serviceRoleKey: serviceRole }),
  bookmakers: ENABLED_BOOKMAKERS,
  publisher,
};
```

- [ ] **Step 6: Type-check**

```bash
ssh scraper-vps 'cd /root/betssolution-admin/services/odds-api-ingester && npx tsc --noEmit'
```
Expected: 0 errors.

- [ ] **Step 7: Run all tests**

```bash
ssh scraper-vps 'cd /root/betssolution-admin/services/odds-api-ingester && npm test'
```
Expected: all green (existing + new realtime-publisher + redis-client tests).

- [ ] **Step 8: Commit**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git add services/odds-api-ingester/src/ingest.ts services/odds-api-ingester/src/scheduler.ts && git commit -m "feat(ingester): wire RealtimePublisher into ingest + scheduler (3a)

Per-event publish call after upsert succeeds. Errors caught at boundary,
never propagated. Publisher constructed with shared redis client singleton.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

## Task 10: Build and integration smoke test on VPS

- [ ] **Step 1: Verify branch state and clean working tree**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git status --short && git log --oneline -10'
```
Expected: clean working tree. Last 7-9 commits should be the realtime publisher series. Note the new HEAD SHA.

- [ ] **Step 2: Run the full test suite once more**

```bash
ssh scraper-vps 'cd /root/betssolution-admin/services/odds-api-ingester && npm test'
```
Expected: 100% green.

- [ ] **Step 3: Build (if applicable) — confirm tsx run works**

Per the spec the ingester runs via `tsx`, no compile step. Smoke-run the entry point with a dry signal.

```bash
ssh scraper-vps 'cd /root/betssolution-admin/services/odds-api-ingester && timeout 5 npx tsx -e "import { getRedisClient } from \"./src/redis-client.js\"; const c = await getRedisClient(); console.log(\"redis up:\", c.isOpen); await c.quit();"'
```
Expected: `redis up: true`. Confirms the new module imports clean and Redis is reachable.

- [ ] **Step 4: Restart ingester service**

```bash
ssh scraper-vps 'systemctl restart odds-api-ingester && sleep 2 && systemctl is-active odds-api-ingester'
```
Expected: `active`.

- [ ] **Step 5: Integration smoke — watch for live publishes (single-shell sequential)**

Run each command sequentially in the agent shell. Use `run_in_background` for the long-running subscribe/tail and Read its output later, or use timeboxed one-shot commands.

```bash
# (a) Sample log for last 5 min of realtime activity
ssh scraper-vps 'tail -2000 /var/log/odds-api-ingester.log | grep "\[realtime\]" | tail -50'

# (b) Snapshot the cache size (one-shot, no loop)
ssh scraper-vps 'redis-cli HLEN odds:cache'

# (c) Capture 30s of channel traffic (timeboxed; produces output even with zero messages)
ssh scraper-vps 'timeout 30 redis-cli SUBSCRIBE odds:live || true'

# (d) Inspect one cached event payload (sanity-check shape)
ssh scraper-vps 'redis-cli HRANDFIELD odds:cache 1 | head -1 | xargs -I{} redis-cli HGET odds:cache {} | head -c 500'
```

Pass criteria:
- (a) shows ≥1 `[realtime] published <id> changes=<N>` line in recent log
- (b) returns >0 (at least one live event cached)
- (c) prints ≥1 JSON message with `"type":"update"` and non-empty `changes` array (only if live events exist; zero messages is acceptable if no live event window is active)
- (d) prints valid JSON matching `CachedEvent` shape (external_id, home_team, away_team, markets[])

If no live events are running right now (off-hours), mark (c) as deferred and re-run during a known live window. Document in Task 12 session memory.

- [ ] **Step 6: Optional — kiosk visual check (best-effort)**

Open a kiosk on a live event. Observe odds movement with up/down arrow indicators that respond within ~1s of the redis-cli SUBSCRIBE messages. This validates the full producer→Redis→SSE→browser path.

Note: if `NEXT_PUBLIC_READ_FROM_V2=false` (current default), the kiosk loads via legacy path. Live odds push still functions because the SSE endpoint is path-agnostic; but the event_id naming may differ — for full v2 validation, defer until S6 cutover or temporarily flip the flag for one kiosk.

- [ ] **Step 7: 24h cutover-gate observation (asynchronous)**

Schedule a follow-up check 24h after deploy. Verify the spec's cutover-gate metrics:

```bash
# Latency: temporary; sample by adding tx-side ts and rx-side timestamp diff
# Coverage: count published vs total upserts on live events
ssh scraper-vps 'tail -100000 /var/log/odds-api-ingester.log | grep -c "\[realtime\] published"'
ssh scraper-vps 'tail -100000 /var/log/odds-api-ingester.log | grep -c "redis_unavailable"'

# Memory RSS stability
ssh scraper-vps 'systemctl show odds-api-ingester | grep MemoryCurrent'

# Redis op rate
ssh scraper-vps 'redis-cli INFO commandstats | grep -E "cmdstat_publish|cmdstat_hset|cmdstat_hdel"'
```

Document results in a follow-up comment / memory entry. This step does not block the immediate ship-and-merge — it informs the S6 cutover go/no-go.

---

## Task 11: Push to GitHub via VPS bundle pattern

The branch is `feature/plan-d-settlement-d1`. The local Windows machine has `gh auth` for `infoundertheguns-ops`; the VPS does not. Use the documented bundle pattern (see memory `project-betssolution-admin-git-desync.md`).

- [ ] **Step 1: Verify VPS is ahead of origin**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git log --oneline origin/feature/plan-d-settlement-d1..HEAD'
```
Expected: lists the realtime-producer commits (Tasks 1-9).

- [ ] **Step 2: Bundle on VPS**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git bundle create /tmp/3a-realtime.bundle origin/feature/plan-d-settlement-d1..HEAD'
```
Expected: `Total <N> (delta <M>), reused <K> (delta <L>)`.

- [ ] **Step 3: scp bundle to Windows**

```bash
scp scraper-vps:/tmp/3a-realtime.bundle "C:\Users\philp\plan-d-3a-realtime-spec\3a-realtime.bundle"
```

- [ ] **Step 4: Apply bundle in a local clone (or temp clone) and push**

If a local clone exists at `C:\Users\philp\betssolution-admin\`, use it. Otherwise:

```bash
git clone https://github.com/infoundertheguns/betssolution-admin.git "C:\Users\philp\plan-d-3a-realtime-spec\admin-temp"
cd "C:\Users\philp\plan-d-3a-realtime-spec\admin-temp"
git fetch origin feature/plan-d-settlement-d1
git checkout feature/plan-d-settlement-d1
git bundle verify "C:\Users\philp\plan-d-3a-realtime-spec\3a-realtime.bundle"
git fetch "C:\Users\philp\plan-d-3a-realtime-spec\3a-realtime.bundle" feature/plan-d-settlement-d1:bundle-tip
git merge --ff-only bundle-tip
git push origin feature/plan-d-settlement-d1
```

Expected: push succeeds, output shows the new HEAD SHA upstream.

- [ ] **Step 5: Sync VPS origin ref**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git fetch origin feature/plan-d-settlement-d1 && git update-ref refs/remotes/origin/feature/plan-d-settlement-d1 $(git rev-parse HEAD) && git status -sb'
```
Expected: clean, branch up-to-date with origin.

- [ ] **Step 6: Confirm GitHub got the commits**

```bash
gh api repos/infoundertheguns/betssolution-admin/commits/feature/plan-d-settlement-d1 -q '.sha'
```
Expected: matches the VPS HEAD SHA from Task 10 Step 1.

---

## Task 12: Update memory and registry

- [ ] **Step 1: Update plan-d-pending-registry.md**

The pending registry lives in user auto-memory at `C:\Users\philp\.claude\projects\C--Users-philp\memory\plan-d-pending-registry.md` (local Windows path, not on VPS). Read it via the `Read` tool, then `Edit` to mark item #3a as **DONE** with date + HEAD SHA + commit count. Move to a "Completed" section if one exists, otherwise add a status badge inline.

If a session-end memory file pattern is used (e.g., `session-2026-05-01-3a-realtime.md`), create one summarizing:
- What shipped (file paths, LoC counts, test counts)
- Branch HEAD SHA before/after
- Open follow-ups (24h observation results, kiosk visual confirm pending)
- Bloccanti S6 residui ridotti da 4 a 3

- [ ] **Step 2: Update MEMORY.md index**

Add a one-line entry at the top of `MEMORY.md` linking the new session file. Keep under 200 chars.

---

## Definition of Done

- [ ] All 12 tasks above checked off
- [ ] `npm test` shows 100% green for the ingester
- [ ] `npx tsc --noEmit` shows 0 errors
- [ ] Service `odds-api-ingester` is `active` and producing `[realtime] published` log lines
- [ ] `redis-cli SUBSCRIBE odds:live` receives JSON messages during a live event window
- [ ] `redis-cli HKEYS odds:cache` returns >0 entries
- [ ] Branch `feature/plan-d-settlement-d1` pushed to origin
- [ ] Memory updated; registry item #3a marked done

## Anticipated Pitfalls

- **`scheduler.ts` is a separate entry point.** Step 9.5 must cover it. If skipped, the production cron-driven path will run without a publisher — silent failure.
- **Per-event publish inside chunked upsert loop.** The wire-up in Task 9 happens after `upsertBatch` succeeds. If an upsert error throws, we skip publishing for the whole batch — correct behavior (Postgres is source of truth) but worth confirming the catch block doesn't unexpectedly silence publish errors only.
- **`outcome_key` and `market_key.market_name` translation.** Already handled in Task 9 Step 3 — the wire-up code maps `o.outcome_key → outcome_name` and `o.market_key.market_name → market_type`. Note `market_name` is **nested** under `market_key` on `OutcomeV2Row`, not at the top level. Don't be tempted to write `o.market_name` (compile error). The wire field names (`market_type`, `outcome_name`) come from the consumer types in `betssolution-player/lib/hooks/use-live-odds.ts`.
- **`scores.home`/`scores.away` undefined for live events without score yet.** `buildCachedEvent` already guards. Just ensure the test fixture covers this.
- **Browser hook `onSnapshot`'s shape.** The hook expects a `Record<string, CachedEvent>` from `HGETALL odds:cache`. The publisher writes one event at a time via `HSET`. The endpoint composes the snapshot from the hash on connect — no producer-side fan-out needed.
- **VPS push pattern.** Task 11 assumes the documented `infoundertheguns-ops` flow. If the local clone is stale, `git fetch origin` first; if there are upstream commits not on VPS, fast-forward will fail and you'll need to coordinate.
