# Football api-sports Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate api-sports/api-football as canonical source for football timer/score/period + main markets settlement, add ~40 new bettable markets (Tier C), maintain FS as canonical for player attribution incidents. Hybrid per-market ownership.

**Architecture:** New standalone ingester service `services/api-football-ingester/` mirror pattern `odds-api-ingester`. Field-level ownership: api-football writes `events_v2.{minute,period,score_*,period_scores}`; FS keeps `live_data.{incidents,stats,matchMeta}`. New sub-keys `live_data.*_af` (lineups_af, statistics_af, events_af, players_af_*, predictions_af, h2h_af) namespace-separated. Score-delta event-driven trigger (L3) baked-in mandatory. External ID matching via new `external_id_mapping` table with fuzzy match confidence threshold. Settlement worker routing via `pickCanonicalSource(market_type, sport)`.

**Tech Stack:** Next.js 14 App Router (admin), TypeScript, Supabase JS v2, Vitest, tsx (no build for service). api-sports REST v3 (key `x-apisports-key`, Pro 7500 req/day). Admin code on VPS `/root/betssolution-admin/`. Spec reference: `docs/superpowers/specs/2026-05-18-football-api-sports-integration-design.md`.

---

## Operating Environment

All file edits via SSH (`mac-stream` alias = Apple M4 dev env). From local PowerShell/Bash:
- Read admin files: `ssh mac-stream "cat ~/work/betssolution-admin/<path>"`
- Edit admin files: scp local temp → ssh overwrite, OR Edit tool on Windows + scp back. **scp-a-script preferred** (avoids quote-escape hell).
- Run admin tests: `ssh mac-stream "cd ~/work/betssolution-admin && npm test -- <pattern>"`
- Run service tests: `ssh mac-stream "cd ~/work/betssolution-admin && npm test -- services/api-football-ingester"`
- Build admin: `ssh mac-stream "cd ~/work/betssolution-admin && npm run build"` (NOTE: pre-existing build failure on services/odds-api-ingester per memory `project-admin-build-types-pg.md` — non-blocking)
- Push to origin: see `reference-gh-token-pipe.md` for pattern push from local PowerShell via gh auth token pipe
- Deploy to scraper-vps: see `reference-player-deploy.md` analogous pattern for admin

**Branch**: `spec/football-api-sports-integration` already created on Mac. Continue work there. Merge target: `feature/plan-d-settlement-d1` after M1 ship verification.

**Critical context:**
- Pre-existing working tree drift: `lib/settlement/market-categories-seed.json` (modified, not in scope, leave untouched)
- Admin Node version: `~/.nvm/versions/node/v22.22.1/bin` (Mac side, Homebrew or nvm — verify before npm)
- DB credentials: `.env.local` has `SUPABASE_SERVICE_ROLE_KEY` per probe scripts pattern (`scripts/db/probe-*.mjs`)
- api-sports Pro key + endpoint in `memory/reference-api-sports.md`
- FS scraper repo on scraper-vps `/root/flashscore-scraper/`, NOT on Mac dev env — M2 step needs cross-repo coordination via gh-token-pipe
- Existing fuzzy match helper `app/api/flashscore/live/_lib.ts::findFuzzyMatch` to REUSE (do not reinvent)
- Settlement test baseline: ~290 tests pass, target +80 = 370 post-plan

---

## File Structure

### Service (M1)

| File | Status | Responsibility |
|---|---|---|
| `services/api-football-ingester/package.json` | Create | Service deps: pg, undici, dotenv |
| `services/api-football-ingester/tsconfig.json` | Create | TS config mirror odds-api-ingester |
| `services/api-football-ingester/README.md` | Create | Service overview, run instructions, env vars |
| `services/api-football-ingester/src/types.ts` | Create | api-sports response types (Fixture, Statistics, Player, Event, Lineup) |
| `services/api-football-ingester/src/api-client.ts` | Create | HTTP client + rate-limit header tracking + 429 backoff |
| `services/api-football-ingester/src/state.ts` | Create | In-process Map<fixtureId, {lastScore, lastEventsFetchAt}> for L3 |
| `services/api-football-ingester/src/mapping.ts` | Create | external_id_mapping resolver, fuzzy match wrapper |
| `services/api-football-ingester/src/discovery.ts` | Create | /fixtures?live=all 60s loop + score-delta detection (L3) |
| `services/api-football-ingester/src/enrichment.ts` | Create | /statistics 5min, /events on-trigger, /players HT+FT, /lineups initial+sub |
| `services/api-football-ingester/src/prematch.ts` | Create | /headtohead + /predictions one-shot per match T-6h |
| `services/api-football-ingester/src/persistence.ts` | Create | Write events_v2 + live_data sub-keys, gated by feature flag |
| `services/api-football-ingester/src/stats-publisher.ts` | Create | POST /api/admin/api-football/stats per cycle |
| `services/api-football-ingester/src/scheduler.ts` | Create | Entry point, orchestrate all pollers |
| `services/api-football-ingester/src/__tests__/api-client.test.ts` | Create | Mock fetch, rate-limit parsing, 429 backoff |
| `services/api-football-ingester/src/__tests__/mapping.test.ts` | Create | Fuzzy match scenarios, confidence threshold logic |
| `services/api-football-ingester/src/__tests__/discovery.test.ts` | Create | Score-delta L3 logic + edge cases (VAR cancel, doppietta, restart) |
| `services/api-football-ingester/src/__tests__/persistence.test.ts` | Create | Write paths, namespace separation, flag gating |

### Migrations (M1)

| File | Status | Responsibility |
|---|---|---|
| `supabase/migrations/NNN_external_id_mapping.sql` | Create | external_id_mapping table + index |
| `supabase/migrations/NNN+1_settlement_dual_source_log.sql` | Create | dual_source_log table + disagreement index |
| `supabase/migrations/NNN+2_api_football_endpoint_health.sql` | Create | endpoint_health tracking table |
| `supabase/migrations/NNN+3_market_normalization_seed_odds_api.sql` | Create | Seed 108 OddsAPI football → canonical_key |
| `supabase/migrations/NNN+4_system_config_api_football_flags.sql` | Create | Insert API_FOOTBALL_WRITE_ENABLED=false + API_FOOTBALL_TIMER_OWNER=false |

### Admin routes (M1)

| File | Status | Responsibility |
|---|---|---|
| `app/api/admin/api-football/stats/route.ts` | Create | POST endpoint receiving cycle stats from service |
| `app/api/admin/api-football/mappings/route.ts` | Create | GET pending mappings (verified=false) + POST promote |
| `app/admin/api-football/page.tsx` | Create | Dashboard: ratelimit, cycle stats, mapping coverage |

### Settlement core (M3)

| File | Status | Responsibility |
|---|---|---|
| `lib/event-field-ownership.ts` | Create | FIELD_OWNERSHIP_FOOTBALL constant |
| `lib/settlement/source-router.ts` | Create | pickCanonicalSource() function |
| `lib/settlement/api-football/classify-af.ts` | Create | Tier C classify (22 stats-derived + 12 score-derived branches) |
| `lib/settlement/api-football/build-result-af.ts` | Create | Map live_data.statistics_af + score → ScoreResult for classify-af |
| `lib/settlement/source-router.test.ts` | Create | pickCanonicalSource routing scenarios |
| `lib/settlement/api-football/__tests__/classify-af.test.ts` | Create | 22+12 markets fixture-based test |
| `lib/settlement.ts` | Modify | Entry point: route through source-router |
| `lib/settlement/odds-api/classify.ts` | Modify | Add Bucket A score-derived branches (Team Total, Exact Goals, etc.) |

### FS scraper cross-repo (M2)

| File | Status | Responsibility |
|---|---|---|
| `flashscore-scraper/src/persistence/events_v2.ts` (or equivalent) | Modify | Gate write minute/period/score_* on `API_FOOTBALL_TIMER_OWNER=false` for sport=football |
| `flashscore-scraper/src/config/feature_flags.ts` | Create | Poll system_config for flag every 30s |

### Player UI (M3)

| File | Status | Responsibility |
|---|---|---|
| `betssolution-player/app/(routes)/sportsbook/event/[id]/sections/Lineups.tsx` | Create | New "Formazioni" section, reads live_data.lineups_af |
| `betssolution-player/app/(routes)/sportsbook/event/[id]/page.tsx` | Modify | Render Lineups section if data available |

---

## M1 — Service foundation + mapping (Week 1, ~5-7 gg)

### Task M1.1: Create service scaffolding

**Files:**
- Create: `services/api-football-ingester/package.json`
- Create: `services/api-football-ingester/tsconfig.json`
- Create: `services/api-football-ingester/README.md`

- [ ] **Step 1: Inspect odds-api-ingester pattern**

Run: `ssh mac-stream "cat ~/work/betssolution-admin/services/odds-api-ingester/package.json"`

Use as template for naming, scripts, deps.

- [ ] **Step 2: Create package.json**

```json
{
  "name": "api-football-ingester",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/scheduler.ts",
    "start": "tsx src/scheduler.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "pg": "^8.11.0",
    "undici": "^6.0.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "tsx": "^4.0.0",
    "vitest": "^1.0.0",
    "@types/node": "^20.0.0",
    "@types/pg": "^8.10.0"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

Mirror `services/odds-api-ingester/tsconfig.json` (ES modules, strict).

- [ ] **Step 4: Create README.md**

Describe service purpose, env vars (`API_SPORTS_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `API_FOOTBALL_WRITE_ENABLED`), run command, deploy unit.

- [ ] **Step 5: Verify scaffold**

Run: `ssh mac-stream "cd ~/work/betssolution-admin/services/api-football-ingester && ls -la && cat package.json"`

- [ ] **Step 6: Commit**

```bash
git add services/api-football-ingester/{package.json,tsconfig.json,README.md}
git commit -m "feat(api-football): scaffold ingester service"
```

---

### Task M1.2: Migration external_id_mapping table

**Files:**
- Create: `supabase/migrations/NNN_external_id_mapping.sql`

- [ ] **Step 1: Determine next migration number**

Run: `ssh mac-stream "ls ~/work/betssolution-admin/supabase/migrations/ | tail -5"`

Pick next integer.

- [ ] **Step 2: Write migration SQL**

```sql
CREATE TABLE external_id_mapping (
  event_id UUID NOT NULL REFERENCES events_v2(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('api-football', 'flashscore', 'odds-api')),
  external_id TEXT NOT NULL,
  confidence FLOAT NOT NULL DEFAULT 0.0,
  verified BOOLEAN NOT NULL DEFAULT false,
  matched_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (event_id, provider),
  UNIQUE (provider, external_id)
);

CREATE INDEX idx_external_id_mapping_provider_external
  ON external_id_mapping(provider, external_id);

CREATE INDEX idx_external_id_mapping_event_id
  ON external_id_mapping(event_id);
```

- [ ] **Step 3: Apply to staging DB**

Use staging Supabase first (verify connection string in `.env.staging` if exists, else apply via dashboard SQL editor).

- [ ] **Step 4: Verify schema**

```bash
ssh mac-stream "node ~/work/betssolution-admin/scripts/db/probe-football-gap.mjs"
# Adapt or write a quick `SELECT * FROM information_schema.tables WHERE table_name='external_id_mapping'`
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/NNN_external_id_mapping.sql
git commit -m "feat(db): create external_id_mapping table"
```

---

### Task M1.3: Migration settlement_dual_source_log table

**Files:**
- Create: `supabase/migrations/NNN+1_settlement_dual_source_log.sql`

- [ ] **Step 1: Write migration**

```sql
CREATE TABLE settlement_dual_source_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id UUID NOT NULL,
  market_type TEXT NOT NULL,
  canonical_source TEXT NOT NULL,
  canonical_verdict TEXT,
  shadow_source TEXT,
  shadow_verdict TEXT,
  disagreement BOOLEAN NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_dual_source_log_disagreement
  ON settlement_dual_source_log(disagreement, recorded_at DESC);

CREATE INDEX idx_dual_source_log_bet
  ON settlement_dual_source_log(bet_id);
```

- [ ] **Step 2: Apply + verify + commit** (same pattern as M1.2)

---

### Task M1.4: Migration api_football_endpoint_health

**Files:**
- Create: `supabase/migrations/NNN+2_api_football_endpoint_health.sql`

- [ ] **Step 1: Write migration**

```sql
CREATE TABLE api_football_endpoint_health (
  endpoint TEXT PRIMARY KEY,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

- [ ] **Step 2-3: Apply + verify + commit**

---

### Task M1.5: Migration market_normalization seed OddsAPI football

**Files:**
- Create: `supabase/migrations/NNN+3_market_normalization_seed_odds_api.sql`

- [ ] **Step 1: Generate full seed from probe output**

```bash
ssh mac-stream "cd ~/work/betssolution-admin && node scripts/db/probe-football-markets.mjs > /tmp/odds-api-football-markets.txt"
```

Process the 108 distinct market_names. Map each to canonical_key per spec §4.2 (Bucket A/B) or §4.3 (FS Bucket C). Generate INSERT statements.

- [ ] **Step 2: Write seed migration**

```sql
INSERT INTO market_normalization
  (source, source_market_type, canonical_key, canonical_name_it, verified)
VALUES
  ('odds-api', 'ML', '1x2', 'Vincente incontro', true),
  ('odds-api', 'Totals', 'totals', 'U/O Totali', true),
  ('odds-api', 'Double Chance', 'double_chance', 'Doppia Chance', true),
  ('odds-api', 'Both Teams To Score', 'btts', 'Gol/NoGol', true),
  ('odds-api', 'Spread', 'spread', 'Handicap', true),
  ('odds-api', 'Totals HT', 'totals_ht', 'U/O 1° Tempo', true),
  ('odds-api', 'European Handicap', 'european_handicap', 'Handicap Europeo', true),
  ('odds-api', 'Team Total Home', 'team_total_home', 'Totale Casa', true),
  ('odds-api', 'Team Total Away', 'team_total_away', 'Totale Ospite', true),
  ('odds-api', 'Draw No Bet', 'draw_no_bet', 'Draw No Bet', true),
  -- ... continua per tutti i 108
  ON CONFLICT (source, source_market_type) DO UPDATE
    SET canonical_key = EXCLUDED.canonical_key,
        canonical_name_it = EXCLUDED.canonical_name_it,
        verified = EXCLUDED.verified;
```

(Full list from probe output. ~108 row.)

- [ ] **Step 3: Apply + verify count**

```sql
SELECT count(*) FROM market_normalization WHERE source = 'odds-api';
-- expected 108
```

- [ ] **Step 4: Commit**

---

### Task M1.6: Migration system_config feature flags

**Files:**
- Create: `supabase/migrations/NNN+4_system_config_api_football_flags.sql`

- [ ] **Step 1: Write migration**

```sql
INSERT INTO system_config (key, value, description) VALUES
  ('API_FOOTBALL_WRITE_ENABLED', 'false', 'When true, api-football-ingester writes to events_v2. Default false during M1.'),
  ('API_FOOTBALL_TIMER_OWNER', 'false', 'When true, api-football owns timer/period/score; FS scraper skips those fields for sport=football.')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Apply + verify + commit**

---

### Task M1.7: api-client.ts with rate-limit tracking

**Files:**
- Create: `services/api-football-ingester/src/api-client.ts`
- Create: `services/api-football-ingester/src/types.ts`
- Test: `services/api-football-ingester/src/__tests__/api-client.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// __tests__/api-client.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ApiFootballClient } from '../api-client.js';

describe('ApiFootballClient', () => {
  it('parses rate-limit headers from response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({
        'x-ratelimit-requests-limit': '7500',
        'x-ratelimit-requests-remaining': '7400',
      }),
      json: async () => ({ response: [] }),
    });
    globalThis.fetch = fetchMock;
    const client = new ApiFootballClient({ apiKey: 'test' });
    await client.fetch('/fixtures?live=all');
    expect(client.lastRateLimit()).toEqual({
      limit: 7500,
      remaining: 7400,
    });
  });

  it('throws on 429 after backoff exhausted', async () => {
    // ... test exponential backoff 2s → 30s
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
ssh mac-stream "cd ~/work/betssolution-admin/services/api-football-ingester && npx vitest run"
# Expected: FAIL "Cannot find module '../api-client.js'"
```

- [ ] **Step 3: Implement api-client.ts**

```typescript
import type { RateLimitInfo } from './types.js';

export class ApiFootballClient {
  private apiKey: string;
  private baseUrl = 'https://v3.football.api-sports.io';
  private lastRl: RateLimitInfo | null = null;

  constructor(cfg: { apiKey: string }) {
    this.apiKey = cfg.apiKey;
  }

  lastRateLimit(): RateLimitInfo | null {
    return this.lastRl;
  }

  async fetch<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let attempt = 0;
    while (attempt < 5) {
      const res = await fetch(url, {
        headers: { 'x-apisports-key': this.apiKey },
      });
      this.lastRl = parseRateLimit(res.headers);
      if (res.ok) {
        const data = await res.json();
        return data.response as T;
      }
      if (res.status === 429) {
        const wait = Math.min(2000 * Math.pow(2, attempt), 30000);
        await new Promise(r => setTimeout(r, wait));
        attempt++;
        continue;
      }
      throw new Error(`api-football ${res.status}: ${await res.text()}`);
    }
    throw new Error('rate-limit retries exhausted');
  }
}

function parseRateLimit(h: Headers): RateLimitInfo {
  return {
    limit: parseIntOrNull(h.get('x-ratelimit-requests-limit')),
    remaining: parseIntOrNull(h.get('x-ratelimit-requests-remaining')),
  };
}

function parseIntOrNull(s: string | null): number | null {
  if (s == null) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}
```

- [ ] **Step 4: Write types.ts**

```typescript
export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
}

export interface AFFixture {
  fixture: {
    id: number;
    date: string;
    status: { elapsed: number | null; long: string };
    venue: { id: number | null; name: string; city: string };
  };
  league: { id: number; name: string; country: string };
  teams: { home: { id: number; name: string }; away: { id: number; name: string } };
  goals: { home: number | null; away: number | null };
  score: {
    halftime: { home: number | null; away: number | null };
    fulltime: { home: number | null; away: number | null };
    extratime: { home: number | null; away: number | null };
    penalty: { home: number | null; away: number | null };
  };
}

// ... AFEvent, AFStatistic, AFPlayer, AFLineup types
```

- [ ] **Step 5: Run tests pass**

- [ ] **Step 6: Commit**

```bash
git add services/api-football-ingester/src/{api-client.ts,types.ts,__tests__/api-client.test.ts}
git commit -m "feat(api-football): api-client with rate-limit tracking and 429 backoff"
```

---

### Task M1.8: mapping.ts with fuzzy match wrapper

**Files:**
- Create: `services/api-football-ingester/src/mapping.ts`
- Test: `services/api-football-ingester/src/__tests__/mapping.test.ts`

- [ ] **Step 1: Inspect existing fuzzy match**

```bash
ssh mac-stream "grep -n 'findFuzzyMatch\\|normalize_team_name' ~/work/betssolution-admin/app/api/flashscore/live/_lib.ts | head -20"
```

Understand existing signature. Reuse or wrap.

- [ ] **Step 2: Write failing tests** (confidence formula scenarios)

```typescript
it('returns confidence >= 0.85 for perfect match', () => {
  const score = computeConfidence({
    name_similarity: 1.0,
    league_match_score: 1.0,
    kickoff_proximity_score: 1.0,
  });
  expect(score).toBe(1.0);
});

it('returns confidence between 0.50 and 0.85 for league mismatch', () => {
  const score = computeConfidence({
    name_similarity: 1.0,
    league_match_score: 0.0,
    kickoff_proximity_score: 1.0,
  });
  expect(score).toBe(0.7);  // 0.5*1 + 0.3*0 + 0.2*1
});
```

- [ ] **Step 3-6: Implement, test pass, commit**

---

### Task M1.9: state.ts in-process Map

**Files:**
- Create: `services/api-football-ingester/src/state.ts`

- [ ] **Step 1: Write minimal stateful module**

```typescript
export class FixtureState {
  private lastSeenScores = new Map<number, { home: number; away: number }>();
  private lastEventsFetchAt = new Map<number, number>();

  getLastScore(id: number) {
    return this.lastSeenScores.get(id) ?? { home: 0, away: 0 };
  }

  setLastScore(id: number, score: { home: number; away: number }) {
    this.lastSeenScores.set(id, score);
  }

  getLastEventsFetchAt(id: number): number {
    return this.lastEventsFetchAt.get(id) ?? 0;
  }

  setEventsFetchAt(id: number, ts: number) {
    this.lastEventsFetchAt.set(id, ts);
  }

  // Cleanup: remove fixtures no longer live (called after each discovery)
  pruneStale(activeFixtureIds: Set<number>) {
    for (const id of this.lastSeenScores.keys()) {
      if (!activeFixtureIds.has(id)) {
        this.lastSeenScores.delete(id);
        this.lastEventsFetchAt.delete(id);
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

---

### Task M1.10: discovery.ts with L3 score-delta trigger

**Files:**
- Create: `services/api-football-ingester/src/discovery.ts`
- Test: `services/api-football-ingester/src/__tests__/discovery.test.ts`

- [ ] **Step 1: Write failing tests — score-delta scenarios**

```typescript
describe('discovery score-delta L3', () => {
  it('triggers /events when score changes from 0-0 to 1-0', () => {
    const state = new FixtureState();
    state.setLastScore(123, { home: 0, away: 0 });
    const decision = shouldFetchEvents(state, {
      fixture: { id: 123 }, goals: { home: 1, away: 0 }
    });
    expect(decision.fetch).toBe(true);
    expect(decision.reason).toBe('score-delta');
  });

  it('does NOT trigger when score unchanged and last fetch < 5min ago', () => {
    const state = new FixtureState();
    state.setLastScore(123, { home: 1, away: 0 });
    state.setEventsFetchAt(123, Date.now() - 60 * 1000);
    const decision = shouldFetchEvents(state, { fixture: { id: 123 }, goals: { home: 1, away: 0 } });
    expect(decision.fetch).toBe(false);
  });

  it('triggers card-poll when score unchanged but >5min since last fetch', () => {
    // ...
  });

  it('triggers refetch on VAR cancel (score decrement)', () => {
    // ...
  });

  it('handles service restart: seeds lastSeenScores from current /fixtures?live=all', () => {
    // ...
  });
});
```

- [ ] **Step 2-6: Implement, test pass, commit**

---

### Task M1.11: persistence.ts with flag gating

**Files:**
- Create: `services/api-football-ingester/src/persistence.ts`
- Test: `services/api-football-ingester/src/__tests__/persistence.test.ts`

- [ ] **Step 1: Write failing tests — flag gate**

```typescript
it('does NOT write to events_v2 when API_FOOTBALL_WRITE_ENABLED=false', async () => {
  const mockDb = createMockDb();
  await persistTimerAndScore(mockDb, fixture, { writeEnabled: false });
  expect(mockDb.queryHistory).toEqual([]); // no UPDATE
});

it('writes to events_v2.live_data.statistics_af under correct namespace', async () => {
  // ... verify NOT touching live_data.stats (FS-owned)
});
```

- [ ] **Step 2-6: Implement, test pass, commit**

---

### Task M1.12: enrichment.ts + prematch.ts pollers

**Files:**
- Create: `services/api-football-ingester/src/enrichment.ts`
- Create: `services/api-football-ingester/src/prematch.ts`

- [ ] **Step 1-5: Write minimal pollers consuming api-client**

Each poller:
- Pure function `pollX(client, state, fixtureIds): Promise<EnrichmentResult>`
- Caller (scheduler) decides cadence

- [ ] **Step 6: Commit**

---

### Task M1.13: stats-publisher.ts + admin route

**Files:**
- Create: `services/api-football-ingester/src/stats-publisher.ts`
- Create: `app/api/admin/api-football/stats/route.ts`

- [ ] **Step 1: Write admin route**

Pattern mirror `app/api/flashscore/stats/route.ts` (shipped 2026-05-13 per memory `fs-admin-stats-push`).

```typescript
// app/api/admin/api-football/stats/route.ts
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  // verify x-scraper-key header
  const key = req.headers.get('x-scraper-key');
  if (key !== process.env.SCRAPER_AUTH_KEY) {
    return new Response('Unauthorized', { status: 401 });
  }
  const payload = await req.json();
  const supabase = createClient(/* ... */);
  // Read current history, append new cycle, trim to 100, write back
  // ... (mirror FS pattern exactly)
  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Write stats-publisher.ts client**

- [ ] **Step 3: Commit**

---

### Task M1.14: scheduler.ts entry point

**Files:**
- Create: `services/api-football-ingester/src/scheduler.ts`

- [ ] **Step 1: Write scheduler orchestration**

```typescript
import { ApiFootballClient } from './api-client.js';
import { FixtureState } from './state.js';
import { discoveryTick } from './discovery.js';
import { enrichmentTick } from './enrichment.js';
import { prematchTick } from './prematch.js';
import { publishStats } from './stats-publisher.js';

const client = new ApiFootballClient({ apiKey: process.env.API_SPORTS_KEY! });
const state = new FixtureState();

setInterval(() => discoveryTick(client, state), 60_000);
setInterval(() => enrichmentTick(client, state), 60_000);
setInterval(() => prematchTick(client), 30 * 60_000);  // 30min cadence prematch
setInterval(() => publishStats(client, state), 5 * 60_000);  // 5min publish

console.log('[scheduler] api-football-ingester started');
```

- [ ] **Step 2: Smoke test locally** (mocked api key)

- [ ] **Step 3: Commit**

---

### Task M1.15: Deploy service + systemd unit

**Files:**
- Cross-repo: scraper-vps `/etc/systemd/system/api-football-ingester.service`

- [ ] **Step 1: Push admin branch to origin**

```powershell
$t = gh auth token
ssh scraper-vps "cd /root/betssolution-admin && git fetch && git checkout spec/football-api-sports-integration"
```

- [ ] **Step 2: Write systemd unit**

```
[Unit]
Description=api-football-ingester
After=network.target

[Service]
Type=simple
WorkingDirectory=/root/betssolution-admin/services/api-football-ingester
ExecStart=/root/.nvm/versions/node/v22.22.1/bin/npx tsx src/scheduler.ts
EnvironmentFile=/root/betssolution-admin/.env.local
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: Install + start**

```bash
ssh scraper-vps "cp /tmp/api-football-ingester.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable api-football-ingester && systemctl start api-football-ingester"
```

- [ ] **Step 4: Verify health**

```bash
ssh scraper-vps "systemctl status api-football-ingester"
ssh scraper-vps "journalctl -u api-football-ingester --since '1 minute ago' --no-pager | tail -20"
```

Expected: cycle log lines, no auth errors, ratelimit_remaining decrementing.

- [ ] **Step 5: Verify mapping coverage after 48-72h**

```sql
SELECT
  count(*) FILTER (WHERE verified=true) AS verified,
  count(*) FILTER (WHERE verified=false) AS pending,
  count(DISTINCT event_id) AS unique_events
FROM external_id_mapping
WHERE provider = 'api-football';
```

Target: >85% of top-tier (`bookmaker_count >=3`) football events live should have verified mapping.

- [ ] **Step 6: M1 SHIP COMMIT TAG**

```bash
ssh mac-stream "cd ~/work/betssolution-admin && git tag m1-football-api-sports"
```

---

## M2 — Timer ownership switch (Week 2, ~4-5 gg)

### Task M2.1: FIELD_OWNERSHIP constant

**Files:**
- Create: `lib/event-field-ownership.ts`
- Test: `lib/event-field-ownership.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { FIELD_OWNERSHIP_FOOTBALL } from './event-field-ownership.js';

it('declares api-football as owner of timer fields', () => {
  expect(FIELD_OWNERSHIP_FOOTBALL['events_v2.minute']).toBe('api-football');
  expect(FIELD_OWNERSHIP_FOOTBALL['events_v2.period']).toBe('api-football');
  expect(FIELD_OWNERSHIP_FOOTBALL['events_v2.score_home']).toBe('api-football');
});

it('declares fs-scraper as owner of incidents and stats', () => {
  expect(FIELD_OWNERSHIP_FOOTBALL['events_v2.live_data.incidents']).toBe('fs-scraper');
});
```

- [ ] **Step 2-6: Implement, pass, commit**

---

### Task M2.2: FS scraper cross-repo change (gate writes)

**Cross-repo work**: FS scraper lives on scraper-vps `/root/flashscore-scraper/` (NOT on Mac dev env).

- [ ] **Step 1: SSH inspect FS scraper persistence layer**

```bash
ssh scraper-vps "grep -n 'score_home\\|minute\\|period_scores' /root/flashscore-scraper/src/**/*.ts 2>/dev/null | head -20"
```

Locate the write paths to events_v2.

- [ ] **Step 2: Write feature flag poller**

Module: `flashscore-scraper/src/config/feature_flags.ts`

```typescript
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

let cache: Record<string, string> = {};
let lastFetch = 0;

export async function getFlag(key: string): Promise<string> {
  if (Date.now() - lastFetch < 30_000 && key in cache) return cache[key];
  const { data } = await sb.from('system_config').select('key,value');
  cache = Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value]));
  lastFetch = Date.now();
  return cache[key] ?? 'false';
}
```

- [ ] **Step 3: Gate write paths**

In FS scraper persistence module:

```typescript
async function persistLiveMatch(event: FsEvent) {
  const isFootball = event.sport_slug === 'football';
  const flag = isFootball ? await getFlag('API_FOOTBALL_TIMER_OWNER') : 'false';
  const skipTimer = flag === 'true';

  const update: any = {
    live_data: event.live_data,
    country_fs: event.country_fs,
    league_fs: event.league_fs,
  };
  if (!skipTimer) {
    update.minute = event.minute;
    update.period = event.period;
    update.score_home = event.score_home;
    update.score_away = event.score_away;
    update.period_scores = event.period_scores;
  }
  await sb.from('events_v2').update(update).eq('id', event.id);
}
```

- [ ] **Step 4: Commit FS scraper change (separate repo)**

```bash
ssh scraper-vps "cd /root/flashscore-scraper && git checkout -b feature/api-football-timer-flag && git add -A && git commit -m 'feat(persistence): gate football timer write behind API_FOOTBALL_TIMER_OWNER flag'"
```

Push origin via gh-token-pipe pattern (`reference-gh-token-pipe.md`).

---

### Task M2.3: api-football-ingester flag gate on write path

- [ ] **Step 1: Modify persistence.ts**

```typescript
// services/api-football-ingester/src/persistence.ts
async function persistTimerAndScore(db, fixture, { writeEnabled }) {
  if (!writeEnabled) return;  // M1 default
  // also check API_FOOTBALL_TIMER_OWNER === 'true' for M2 ownership semantics
  const timerOwner = await getFlag('API_FOOTBALL_TIMER_OWNER');
  if (timerOwner !== 'true') return;  // M2 gate

  await db.query(`
    UPDATE events_v2
    SET minute = $1, period = $2, score_home = $3, score_away = $4, period_scores = $5
    WHERE id = (SELECT event_id FROM external_id_mapping WHERE provider='api-football' AND external_id=$6 AND verified=true)
  `, [fixture.fixture.status.elapsed, ...]);
}
```

- [ ] **Step 2: Test + commit**

---

### Task M2.4: Staging flip flag test

- [ ] **Step 1: Set flags on staging DB**

```sql
UPDATE system_config SET value = 'true' WHERE key IN ('API_FOOTBALL_WRITE_ENABLED', 'API_FOOTBALL_TIMER_OWNER');
```

- [ ] **Step 2: Wait 60s** (both pollers re-read cache)

- [ ] **Step 3: Verify on staging**

```sql
SELECT id, home_team, away_team, minute, period, score_home, score_away, updated_at
FROM events_v2
WHERE sport_slug = 'football' AND status = 'live'
ORDER BY updated_at DESC
LIMIT 10;
```

Expected: `minute` populated for top-tier matches (mapped), `updated_at` recent (last 60s).

- [ ] **Step 4: Cross-source consistency check**

Sample 5 live matches, compare api-football score vs FS score (via direct FS api probe). Should match exactly.

- [ ] **Step 5: Flip flag false → verify rollback**

```sql
UPDATE system_config SET value = 'false' WHERE key = 'API_FOOTBALL_TIMER_OWNER';
```

Wait 60s. Verify FS resumes writing minute/period/score. No data loss.

---

### Task M2.5: Production flip + observation

- [ ] **Step 1: Apply migrations to PROD**

Migrations from M1.2-M1.6 applied prod first.

- [ ] **Step 2: Deploy admin + service code to prod scraper-vps**

- [ ] **Step 3: Flip `API_FOOTBALL_WRITE_ENABLED=true`** (M1 ingester writes mappings only, no events_v2 timer)

```sql
UPDATE system_config SET value = 'true' WHERE key = 'API_FOOTBALL_WRITE_ENABLED';
```

- [ ] **Step 4: Observe 24h**: mapping coverage, ingester health stats, no regression FS

- [ ] **Step 5: Flip `API_FOOTBALL_TIMER_OWNER=true`** (FS stops, api-football starts)

- [ ] **Step 6: Smoke 5 top-tier match × 90min**: verify timer/score real-time visible on kiosk

- [ ] **Step 7: M2 SHIP TAG**

```bash
ssh mac-stream "cd ~/work/betssolution-admin && git tag m2-football-api-sports"
```

---

## M3 — Settlement switch + lineups + Tier C expansion (Week 3-6, ~16-21 gg)

### Task M3.1: source-router.ts

**Files:**
- Create: `lib/settlement/source-router.ts`
- Test: `lib/settlement/source-router.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { pickCanonicalSource } from './source-router.js';

it('routes football 1x2 to api-football', () => {
  expect(pickCanonicalSource('1x2', 'football')).toBe('api-football');
});

it('routes football anytime_goalscorer to fs', () => {
  expect(pickCanonicalSource('anytime_goalscorer', 'football')).toBe('fs');
});

it('routes basketball ML to fs (non-football fallback)', () => {
  expect(pickCanonicalSource('ml', 'basketball')).toBe('fs');
});
```

- [ ] **Step 2: Implement**

```typescript
const FOOTBALL_AF_CANONICAL = new Set([
  '1x2', 'ml', 'totals', 'btts', 'double_chance', 'draw_no_bet',
  'correct_score', 'ht_ft', 'odd_even',
  '1x2_ht', 'totals_ht', 'btts_ht', /* ... full list per spec §4.2 */
]);

export function pickCanonicalSource(
  market_type: string,
  sport: string
): 'api-football' | 'fs' {
  if (sport !== 'football') return 'fs';
  if (FOOTBALL_AF_CANONICAL.has(market_type)) return 'api-football';
  return 'fs';
}
```

- [ ] **Step 3-5: Pass tests, commit**

---

### Task M3.2: build-result-af.ts

**Files:**
- Create: `lib/settlement/api-football/build-result-af.ts`
- Test: `lib/settlement/api-football/__tests__/build-result-af.test.ts`

- [ ] **Step 1: Write tests for mapping**

```typescript
it('maps live_data.statistics_af to ScoreResult corners_*', () => {
  const event = {
    score_home: 2, score_away: 1,
    period_scores: { halftime: { home: 1, away: 0 } },
    live_data: {
      statistics_af: [
        { team: 'home', stats: { 'Corner Kicks': 6, 'Yellow Cards': 2 } },
        { team: 'away', stats: { 'Corner Kicks': 3, 'Yellow Cards': 1 } },
      ],
    },
  };
  const r = buildResultFromAF(event);
  expect(r.corners_home).toBe(6);
  expect(r.corners_away).toBe(3);
  expect(r.cards_home).toBe(2);
  expect(r.ht_home).toBe(1);
});
```

- [ ] **Step 2-6: Implement, pass, commit**

---

### Task M3.3: classify-af.ts skeleton + Bucket A score-derived branches

**Files:**
- Create: `lib/settlement/api-football/classify-af.ts`
- Test: `lib/settlement/api-football/__tests__/classify-af.test.ts`

- [ ] **Step 1: Write skeleton mirror of `lib/settlement/odds-api/classify.ts`**

Copy file structure, import settlers from existing classify.ts where applicable (reuse `settle1X2`, `settleOU`, `settleStatOU`, etc.).

- [ ] **Step 2: Add Bucket A score-derived branches**

Template pattern per market (apply to all 12 score-derived):

```typescript
// In classifyLegAF dispatcher
if (mt === 'team_total_home') {
  return { verdict: settleOU(result.home, leg.line, leg.outcome_name) };
}
if (mt === 'team_total_away') {
  return { verdict: settleOU(result.away, leg.line, leg.outcome_name) };
}
if (mt === 'exact_total_goals') {
  return { verdict: settleExactTotalGoals(result.home + result.away, leg.outcome_name) };
}
if (mt === 'first_team_to_score') {
  return { verdict: settleFirstTeamToScore(result.live_data?.events_af, leg.outcome_name) };
}
// ... etc per i 12 Bucket A
```

- [ ] **Step 3: Write tests fixture-based — 1 test scenario per Bucket A market**

Use existing `tests/fixtures/football-completed-match.json` (or create if missing) with known final result. Assert verdict per outcome.

- [ ] **Step 4: Pass all Bucket A tests**

Target: 12 new test cases pass.

- [ ] **Step 5: Commit**

---

### Task M3.4: classify-af.ts Bucket B statistics-derived

- [ ] **Step 1: Write Bucket B branches (22 markets)**

Template:

```typescript
if (mt === 'corners_totals_home') {
  return { verdict: settleOU(result.corners_home ?? 0, leg.line, leg.outcome_name) };
}
if (mt === 'bookings_totals') {
  return { verdict: settleStatOU(result.cards_home, result.cards_away, leg.line, leg.outcome_name) };
}
// ... etc per i 22 Bucket B
```

Enumerate markets:

| Canonical key | Settle logic |
|---|---|
| corners_totals_home | `settleOU(result.corners_home, line, outcome)` |
| corners_totals_away | `settleOU(result.corners_away, line, outcome)` |
| corners_spread | `settleHandicap2Way(corners_home, corners_away, line, outcome)` |
| corner_handicap | same as corners_spread |
| bookings_totals | `settleStatOU(cards_home, cards_away, line, outcome)` |
| bookings_totals_home | `settleOU(cards_home, line, outcome)` |
| bookings_totals_away | `settleOU(cards_away, line, outcome)` |
| bookings_spread | `settleHandicap2Way(cards_home, cards_away, line, outcome)` |
| total_shots_home | `settleOU(shots_home, line, outcome)` |
| total_shots_away | `settleOU(shots_away, line, outcome)` |
| team_shots_home | (alias) |
| team_shots_away | (alias) |
| most_shots_on_target | `settleStat1X2(sot_home, sot_away, outcome)` |
| total_shots_on_target_home | `settleOU(sot_home, line, outcome)` |
| total_shots_on_target_away | `settleOU(sot_away, line, outcome)` |
| total_offsides | `settleStatOU(offsides_home, offsides_away, line, outcome)` |
| match_offsides | (alias) |
| team_offsides_home | `settleOU(offsides_home, line, outcome)` |
| team_offsides_away | `settleOU(offsides_away, line, outcome)` |
| card_handicap | `settleHandicap2Way(cards_home, cards_away, line, outcome)` |
| number_of_cards | range match (Exactly N, Under N, Over N) on cards total |
| team_cards_home | `settleOU(cards_home, line, outcome)` |
| team_cards_away | `settleOU(cards_away, line, outcome)` |
| total_fouls | `settleStatOU(fouls_home, fouls_away, line, outcome)` |
| total_fouls_home | `settleOU(fouls_home, line, outcome)` |
| total_fouls_away | `settleOU(fouls_away, line, outcome)` |
| goalkeeper_saves_home | `settleOU(gk_saves_home, line, outcome)` |
| goalkeeper_saves_away | `settleOU(gk_saves_away, line, outcome)` |

- [ ] **Step 2: Write 22 fixture-based tests**

- [ ] **Step 3: Pass + commit**

---

### Task M3.5: classify-af.ts Bucket C player props

- [ ] **Step 1: Write Bucket C branches (10 markets)**

Bucket C reads from `live_data.players_af_ft` (api-football /players endpoint snapshot at FT).

```typescript
function settlePlayerToScoreNGoals(players, outcome, n: number): Verdict | null {
  if (!players) return null;
  const target = normName(outcome);
  const found = players.find(p => normName(p.name) === target);
  if (!found) return null;
  return (found.goals?.total ?? 0) >= n ? 'won' : 'lost';
}

if (mt === 'to_score_2plus_goals') {
  const v = settlePlayerToScoreNGoals(result.live_data?.players_af_ft, leg.outcome_name, 2);
  return { verdict: v, reason: v == null ? 'players_af_missing' : undefined };
}
// ... etc per i 10 Bucket C
```

- [ ] **Step 2: Write 10 fixture-based tests**

- [ ] **Step 3: Pass + commit**

---

### Task M3.6: settlement.ts entry point integration

**Files:**
- Modify: `lib/settlement.ts`
- Test: `lib/settlement.test.ts` (existing, add cases)

- [ ] **Step 1: Modify settleLeg entry**

```typescript
import { pickCanonicalSource } from './settlement/source-router.js';
import { classifyLegAF } from './settlement/api-football/classify-af.js';
import { buildResultFromAF } from './settlement/api-football/build-result-af.js';

async function settleLeg(leg: BetLeg, event: Event, lookups: CanonicalLookups) {
  const source = pickCanonicalSource(leg.market_type, event.sport_slug);
  if (source === 'api-football') {
    const result = buildResultFromAF(event);
    const afVerdict = classifyLegAF(leg, result);
    // dual-source shadow for monitoring
    await logDualSource(leg, event, afVerdict, 'fs-shadow');
    return afVerdict;
  }
  // ... existing FS path
}
```

- [ ] **Step 2: Test integration** (full settle path Bucket A example)

- [ ] **Step 3: Commit**

---

### Task M3.7: Dual-source disagreement logger

- [ ] **Step 1: Implement logDualSource helper**

```typescript
async function logDualSource(leg, event, canonical, shadowSource) {
  const shadowResult = await buildResultFromFS(event);
  const shadowVerdict = classifyLeg(leg, shadowResult);
  await sb.from('settlement_dual_source_log').insert({
    bet_id: leg.bet_id,
    market_type: leg.market_type,
    canonical_source: 'api-football',
    canonical_verdict: canonical.verdict,
    shadow_source: shadowSource,
    shadow_verdict: shadowVerdict.verdict,
    disagreement: canonical.verdict !== shadowVerdict.verdict,
  });
}
```

- [ ] **Step 2: Test + commit**

---

### Task M3.8: Bucket A → B gate check before B ship

- [ ] **Step 1: Deploy Bucket A markets to prod (M3.3 deliverable)**

- [ ] **Step 2: Monitor for 3-7 days**

Gate criteria:
- `dual_source_disagreement` rate <2% (rolling 7d window)
- `api_football_endpoint_health` `consecutive_failures = 0` for /fixtures, /events
- Pro budget actual <90%

Query:

```sql
SELECT
  count(*) FILTER (WHERE disagreement) * 100.0 / count(*) AS disagreement_pct,
  count(*) AS total_settlements
FROM settlement_dual_source_log
WHERE canonical_source = 'api-football'
  AND market_type IN ('1x2', 'totals', 'team_total_home', /* ... Bucket A keys */)
  AND recorded_at > now() - interval '7 days';
```

- [ ] **Step 3: Decision gate**

If <2% → proceed to Bucket B (M3.4 deploy). If ≥2% → audit, fix, re-monitor.

---

### Task M3.9: Bucket B deploy + gate check before C

Same pattern as M3.8 for Bucket B markets.

---

### Task M3.10: Bucket C deploy

Final tier. After 7d B gate passes → enable Bucket C player props.

---

### Task M3.11: Player UI Lineups section

**Files:**
- Create: `betssolution-player/app/(routes)/sportsbook/event/[id]/sections/Lineups.tsx`
- Modify: `betssolution-player/app/(routes)/sportsbook/event/[id]/page.tsx`

- [ ] **Step 1: Component skeleton**

```tsx
'use client';

interface LineupAF {
  team: 'home' | 'away';
  formation: string;
  startXI: Array<{ player: { id: number; name: string; number: number; pos: string } }>;
  substitutes: Array<{ player: { id: number; name: string; pos: string } }>;
  coach: { id: number; name: string };
}

export function LineupsSection({ data }: { data: { home: LineupAF; away: LineupAF } | null }) {
  if (!data) return null;
  return (
    <section className="lineups">
      <h2>Formazioni</h2>
      <div className="lineups-grid">
        <TeamLineup lineup={data.home} side="home" />
        <TeamLineup lineup={data.away} side="away" />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Wire into page.tsx**

Read `event.live_data?.lineups_af` from existing event payload, pass to LineupsSection.

- [ ] **Step 3: Add component test (Vitest)**

```tsx
it('renders both team lineups', () => {
  const { getByText } = render(<LineupsSection data={mockLineupData} />);
  expect(getByText('Formazioni')).toBeInTheDocument();
  expect(getByText('4-3-3')).toBeInTheDocument(); // home formation
});

it('renders null when data missing', () => {
  const { container } = render(<LineupsSection data={null} />);
  expect(container.firstChild).toBeNull();
});
```

- [ ] **Step 4: Smoke on kiosk**

After deploy player → top-tier football live match → verify Formazioni visible.

- [ ] **Step 5: Commit**

---

### Task M3.12: Cleanup — drop dual_source_log

After 14 days <1% disagreement across all 3 buckets:

- [ ] **Step 1: Write cleanup migration**

```sql
-- supabase/migrations/NNN_drop_settlement_dual_source_log.sql
DROP TABLE settlement_dual_source_log;
```

- [ ] **Step 2: Remove shadow code path in settlement.ts**

- [ ] **Step 3: Remove API_FOOTBALL_TIMER_OWNER flag** (hardcode `true` for football)

- [ ] **Step 4: Lock FIELD_OWNERSHIP_FOOTBALL** (remove flag-gating in FS scraper + ingester)

- [ ] **Step 5: M3 SHIP TAG**

```bash
ssh mac-stream "cd ~/work/betssolution-admin && git tag m3-football-api-sports"
```

---

## Verification checklist

### Post-M1
- [ ] external_id_mapping table populated, >85% top-tier mapping coverage
- [ ] api_football_endpoint_health rows updating
- [ ] Admin dashboard `/admin/api-football` shows ratelimit_remaining decrementing as expected (~4500/day during M1, no enrichment yet)
- [ ] systemctl status api-football-ingester = active (running)
- [ ] No regression cross-sport (sample basket/tennis/baseball events still rendering)

### Post-M2
- [ ] Football live match shows `minute` populated real-time on kiosk
- [ ] Score updates within 60-90s of api-football discovery cycle
- [ ] FS scraper continues writing live_data.incidents, .stats, .matchMeta
- [ ] No race writes detectable in events_v2 (no oscillation in score values)
- [ ] Sample 5 top-tier match × 90min smoke: zero anomaly
- [ ] Rollback drill executed once on staging (flag flip back to false), FS resumed within 60s

### Post-M3
- [ ] 40 Tier C markets visible on kiosk for top-tier football matches
- [ ] dual_source_disagreement <1% across all buckets for 14 days
- [ ] Pro budget actual <90% sustained (no Ultra upgrade triggered)
- [ ] Formazioni section visible on detail page calcio
- [ ] Test count 290 → 370+ pass
- [ ] No regression cross-sport, no regression sport=football FS-canonical markets

---

## Rollback procedures

### M1 rollback
- `systemctl stop api-football-ingester` → service stops, no new mappings
- DB tables can remain (no impact); future `DROP TABLE external_id_mapping CASCADE` if abandoning

### M2 rollback (timer ownership)
- `UPDATE system_config SET value='false' WHERE key='API_FOOTBALL_TIMER_OWNER';`
- Within 30-60s FS scraper resumes writing minute/period/score
- Within 30-60s api-football-ingester stops writing those fields
- Zero data loss (FS data continues uninterrupted)

### M3 rollback (settlement)
- Per-bucket rollback: remove canonical_key from `FOOTBALL_AF_CANONICAL` set, redeploy admin → bet settle reverts to FS path
- Catastrophic: revert PR + redeploy → fs canonical for all markets

---

## References

- Spec: `docs/superpowers/specs/2026-05-18-football-api-sports-integration-design.md`
- Reference patterns:
  - `services/odds-api-ingester/` (service shape mirror)
  - `app/api/flashscore/stats/route.ts` (admin stats route pattern, shipped 2026-05-13)
  - `lib/settlement/odds-api/classify.ts` (classify pattern for AF dispatcher mirror)
- Memory:
  - `memory/reference-api-sports.md` (credentials, endpoint families)
  - `memory/reference-gh-token-pipe.md` (cross-repo push pattern)
  - `memory/reference-redis-on-scraper-vps.md` (optional future Redis usage)
- Probe scripts:
  - `scripts/db/probe-football-markets.mjs` (108 distinct OddsAPI market names)
  - `scripts/db/probe-football-gap.mjs` (market_normalization gap analysis)
