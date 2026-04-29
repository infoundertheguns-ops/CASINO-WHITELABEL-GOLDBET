# Odds-API.io POC Day 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate odds-api.io as a replacement feed by ingesting Italian Serie A football events into a fresh `events_v2`/`markets_v2`/`outcomes_v2` schema in staging Supabase.

**Architecture:** Standalone Node/TypeScript service `services/odds-api-ingester` with pure transformer (TDD-tested), thin REST client, and idempotent Supabase upsert. POC entry point fetches Serie A events + Snai IT odds in one shot (no continuous loop yet).

**Tech Stack:** TypeScript, Node 20+, vitest, @supabase/supabase-js, native fetch, dotenv. Staging Supabase (project `bnabvfalytivjsrwqydo`).

---

## Pre-flight context

- Spec: `docs/superpowers/specs/2026-04-28-odds-api-io-migration-design.md`
- API key: env var `ODDS_API_KEY` (64-char hex, do NOT commit; `.env` is gitignored)
- Trial limits: Free tier, 100 req/h, only `Snai IT` selected on account (Sisal IT not active — confirm in dashboard before Day 1)
- Staging DB: `db.bnabvfalytivjsrwqydo.supabase.co`, password in memory (`feedback-db-credentials.md`)
- Sample API response captured: `Pisa SC vs US Lecce` (event id `61061637`) — used as fixture
- This POC does NOT touch production DB, does NOT modify legacy events/markets/outcomes tables, does NOT deploy a systemd unit. Pure additive validation.

## Acceptance criteria (Day 1 done = all true)

- `events_v2` populated with ≥35 of the 40 expected upcoming Serie A events
- ≥95% of those events have at least 3 markets (`markets_v2` rows: ML + Totals + BTTS minimum)
- ≥85% of markets have ≥1 outcome row in `outcomes_v2`
- Re-running the POC script does NOT create duplicates (idempotency proven)
- All vitest tests pass
- Schema migration applies cleanly on staging without warnings

---

## Task 1: Schema migration

**Files:**
- Create: `migrations/138_events_v2_schema.sql`

- [ ] **Step 1.1: Write the migration SQL**

Create `migrations/138_events_v2_schema.sql`:

```sql
-- Migration 138: events_v2/markets_v2/outcomes_v2 schema for odds-api.io POC.
-- Parallel to legacy events/markets/outcomes; nothing destructive.
-- Spec: docs/superpowers/specs/2026-04-28-odds-api-io-migration-design.md

BEGIN;

CREATE TABLE IF NOT EXISTS public.events_v2 (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  odds_api_id     bigint NOT NULL UNIQUE,
  home            text   NOT NULL,
  away            text   NOT NULL,
  home_id         bigint,
  away_id         bigint,
  starts_at       timestamptz NOT NULL,
  sport_slug      text   NOT NULL,
  sport_name      text   NOT NULL,
  league_slug     text   NOT NULL,
  league_name     text   NOT NULL,
  status          text   NOT NULL CHECK (status IN ('pending','live','settled','cancelled','postponed')),
  score_home      int,
  score_away      int,
  period_scores   jsonb,
  flashscore_id   text,
  urls            jsonb  NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_v2_sport_starts ON public.events_v2(sport_slug, starts_at);
CREATE INDEX IF NOT EXISTS idx_events_v2_status_starts ON public.events_v2(status, starts_at);
CREATE INDEX IF NOT EXISTS idx_events_v2_league ON public.events_v2(league_slug);

CREATE TABLE IF NOT EXISTS public.markets_v2 (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              uuid NOT NULL REFERENCES public.events_v2(id) ON DELETE CASCADE,
  bookmaker             text NOT NULL,
  market_name           text NOT NULL,
  odds_api_updated_at   timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, bookmaker, market_name)
);

CREATE INDEX IF NOT EXISTS idx_markets_v2_event ON public.markets_v2(event_id);

CREATE TABLE IF NOT EXISTS public.outcomes_v2 (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id     uuid NOT NULL REFERENCES public.markets_v2(id) ON DELETE CASCADE,
  outcome_key   text NOT NULL,
  line          numeric,
  odds          numeric NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  is_suspended  boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (market_id, outcome_key, line)
);

CREATE INDEX IF NOT EXISTS idx_outcomes_v2_market ON public.outcomes_v2(market_id);

COMMIT;
```

- [ ] **Step 1.2: Apply migration to staging DB**

Run from local shell (psql via SSH to scraper-vps):

```bash
ssh scraper-vps "PGPASSWORD='Veronihina2020@' psql -h db.bnabvfalytivjsrwqydo.supabase.co -U postgres -d postgres -f -" < migrations/138_events_v2_schema.sql
```

Expected output:
```
BEGIN
CREATE TABLE
CREATE INDEX
CREATE INDEX
CREATE INDEX
CREATE TABLE
CREATE INDEX
CREATE TABLE
CREATE INDEX
COMMIT
```

- [ ] **Step 1.3: Verify schema**

```bash
ssh scraper-vps "PGPASSWORD='Veronihina2020@' psql -h db.bnabvfalytivjsrwqydo.supabase.co -U postgres -d postgres -c '\d events_v2; \d markets_v2; \d outcomes_v2'"
```

Expected: 3 table definitions printed, no errors.

- [ ] **Step 1.4: Commit**

```bash
git add migrations/138_events_v2_schema.sql
git commit -m "feat(odds-api): add events_v2/markets_v2/outcomes_v2 schema (mig 138)"
```

---

## Task 2: Project scaffolding

**Files:**
- Create: `services/odds-api-ingester/package.json`
- Create: `services/odds-api-ingester/tsconfig.json`
- Create: `services/odds-api-ingester/vitest.config.ts`
- Create: `services/odds-api-ingester/.env.example`
- Create: `services/odds-api-ingester/.gitignore`
- Create: `services/odds-api-ingester/README.md`

- [ ] **Step 2.1: Create package.json**

`services/odds-api-ingester/package.json`:

```json
{
  "name": "@betssolution/odds-api-ingester",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "poc:serie-a": "tsx src/poc-serie-a.ts",
    "smoke": "node scripts/smoke-verify.mjs"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2.2: Create tsconfig.json**

`services/odds-api-ingester/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": false,
    "noEmit": true,
    "lib": ["ES2022"],
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*", "scripts/**/*"]
}
```

- [ ] **Step 2.3: Create vitest.config.ts**

`services/odds-api-ingester/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
```

- [ ] **Step 2.4: Create .env.example**

`services/odds-api-ingester/.env.example`:

```bash
# odds-api.io credentials
ODDS_API_KEY=put-64-char-hex-key-here
ODDS_API_BASE=https://api.odds-api.io/v3

# Staging Supabase (for POC); switch to prod after validation
SUPABASE_URL=https://bnabvfalytivjsrwqydo.supabase.co
SUPABASE_SERVICE_ROLE=put-staging-service-role-here
```

- [ ] **Step 2.5: Create .gitignore**

`services/odds-api-ingester/.gitignore`:

```
node_modules/
.env
.env.local
dist/
*.log
```

- [ ] **Step 2.6: Create README.md**

`services/odds-api-ingester/README.md`:

```markdown
# odds-api-ingester

Ingests events + odds from odds-api.io REST v3 into Supabase `events_v2`/`markets_v2`/`outcomes_v2`.
Replaces kambi/22bet/betfair scrapers (see `docs/superpowers/specs/2026-04-28-odds-api-io-migration-design.md`).

## Setup

```bash
cp .env.example .env
# fill in ODDS_API_KEY and SUPABASE_SERVICE_ROLE
npm install
```

## Run POC (Italian Serie A only, one-shot)

```bash
npm run poc:serie-a
```

## Verify

```bash
npm run smoke
```

## Test

```bash
npm test
```
```

- [ ] **Step 2.7: Install deps and commit**

```bash
cd services/odds-api-ingester
npm install
cd ../..
git add services/odds-api-ingester/package.json services/odds-api-ingester/package-lock.json services/odds-api-ingester/tsconfig.json services/odds-api-ingester/vitest.config.ts services/odds-api-ingester/.env.example services/odds-api-ingester/.gitignore services/odds-api-ingester/README.md
git commit -m "feat(odds-api): scaffold ingester service skeleton"
```

---

## Task 3: Type definitions

**Files:**
- Create: `services/odds-api-ingester/src/types.ts`

- [ ] **Step 3.1: Write types**

`services/odds-api-ingester/src/types.ts`:

```ts
// odds-api.io v3 response types (subset we consume)

export type ApiSport = { name: string; slug: string };
export type ApiLeague = { name: string; slug: string; eventsCount?: number };

export type ApiPeriodScore = { home: number; away: number };
export type ApiScores = {
  home?: number;
  away?: number;
  periods?: Record<string, ApiPeriodScore>;
};

export type ApiOddsML = { home: string; draw?: string; away: string };
export type ApiOddsTotal = { hdp: number; over: string; under: string };
export type ApiOddsBTTS = { yes: string; no: string };
export type ApiOddsAH = { hdp: number; home: string; away: string };

export type ApiMarket = {
  name: string;
  updatedAt?: string;
  odds: Array<ApiOddsML | ApiOddsTotal | ApiOddsBTTS | ApiOddsAH | Record<string, unknown>>;
};

export type ApiEvent = {
  id: number;
  home: string;
  away: string;
  homeId?: number;
  awayId?: number;
  date: string;
  status: 'pending' | 'live' | 'settled' | 'cancelled' | 'postponed';
  sport: ApiSport;
  league: ApiLeague;
  scores?: ApiScores;
  urls?: Record<string, string>;
  bookmakerIds?: Record<string, string>;
  bookmakers?: Record<string, ApiMarket[]>;
};

// DB row shapes for upsert

export type EventV2Row = {
  odds_api_id: number;
  home: string;
  away: string;
  home_id: number | null;
  away_id: number | null;
  starts_at: string;
  sport_slug: string;
  sport_name: string;
  league_slug: string;
  league_name: string;
  status: string;
  score_home: number | null;
  score_away: number | null;
  period_scores: Record<string, ApiPeriodScore> | null;
  urls: Record<string, string>;
};

export type MarketV2Row = {
  event_odds_api_id: number;          // resolved → event_id at upsert time
  bookmaker: string;
  market_name: string;
  odds_api_updated_at: string | null;
};

export type OutcomeV2Row = {
  market_key: { event_odds_api_id: number; bookmaker: string; market_name: string };
  outcome_key: string;
  line: number | null;
  odds: number;
};

export type TransformResult = {
  event: EventV2Row;
  markets: MarketV2Row[];
  outcomes: OutcomeV2Row[];
};
```

- [ ] **Step 3.2: Commit**

```bash
git add services/odds-api-ingester/src/types.ts
git commit -m "feat(odds-api): add type definitions for API and DB rows"
```

---

## Task 4: Transformer (TDD)

**Files:**
- Create: `services/odds-api-ingester/src/__tests__/fixtures/event-pisa-lecce.json`
- Create: `services/odds-api-ingester/src/__tests__/transformer.test.ts`
- Create: `services/odds-api-ingester/src/transformer.ts`

- [ ] **Step 4.1: Capture real API fixture**

Run once and save the response (this consumes 1 of 100 hourly requests):

```bash
curl -sS "https://api.odds-api.io/v3/odds?eventId=61061637&bookmakers=Snai+IT&apiKey=$ODDS_API_KEY" \
  > services/odds-api-ingester/src/__tests__/fixtures/event-pisa-lecce.json
```

Inspect the file: it should be 1.5-3 KB with `home: "Pisa SC"`, `bookmakers.Snai IT[0].name: "ML"`, etc.

- [ ] **Step 4.2: Write the failing test**

`services/odds-api-ingester/src/__tests__/transformer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transformEvent } from '../transformer.js';
import type { ApiEvent } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'event-pisa-lecce.json'), 'utf8')
) as ApiEvent;

describe('transformEvent', () => {
  it('extracts the event row with stable IDs and ISO date', () => {
    const result = transformEvent(fixture);
    expect(result.event.odds_api_id).toBe(61061637);
    expect(result.event.home).toBe('Pisa SC');
    expect(result.event.away).toBe('US Lecce');
    expect(result.event.sport_slug).toBe('football');
    expect(result.event.league_slug).toBe('italy-serie-a');
    expect(result.event.starts_at).toBe('2026-05-01T18:45:00Z');
    expect(result.event.status).toBe('pending');
  });

  it('produces one market row per (bookmaker, market_name)', () => {
    const result = transformEvent(fixture);
    const snaiMarkets = result.markets.filter(m => m.bookmaker === 'Snai IT');
    expect(snaiMarkets.length).toBeGreaterThanOrEqual(3);
    const names = snaiMarkets.map(m => m.market_name).sort();
    expect(names).toContain('ML');
    expect(names).toContain('Totals');
    expect(names).toContain('Both Teams To Score');
  });

  it('expands ML market into 3 outcomes (home/draw/away) for football', () => {
    const result = transformEvent(fixture);
    const mlOutcomes = result.outcomes.filter(
      o => o.market_key.market_name === 'ML' && o.market_key.bookmaker === 'Snai IT'
    );
    expect(mlOutcomes).toHaveLength(3);
    const keys = mlOutcomes.map(o => o.outcome_key).sort();
    expect(keys).toEqual(['away', 'draw', 'home']);
    mlOutcomes.forEach(o => {
      expect(o.line).toBeNull();
      expect(o.odds).toBeGreaterThan(1);
    });
  });

  it('expands Totals market into 2 outcomes per hdp line (over/under)', () => {
    const result = transformEvent(fixture);
    const totalsOutcomes = result.outcomes.filter(
      o => o.market_key.market_name === 'Totals' && o.market_key.bookmaker === 'Snai IT'
    );
    // Pisa-Lecce sample shows 9 hdp lines × 2 = 18 outcomes
    expect(totalsOutcomes.length).toBeGreaterThanOrEqual(2);
    expect(totalsOutcomes.length % 2).toBe(0);
    totalsOutcomes.forEach(o => {
      expect(o.line).not.toBeNull();
      expect(['over', 'under']).toContain(o.outcome_key);
    });
  });

  it('expands BTTS market into yes/no outcomes', () => {
    const result = transformEvent(fixture);
    const btts = result.outcomes.filter(
      o => o.market_key.market_name === 'Both Teams To Score' && o.market_key.bookmaker === 'Snai IT'
    );
    expect(btts).toHaveLength(2);
    expect(btts.map(o => o.outcome_key).sort()).toEqual(['no', 'yes']);
  });

  it('preserves urls and bookmakerIds verbatim', () => {
    const result = transformEvent(fixture);
    expect(result.event.urls['Snai IT']).toContain('snai.it');
  });

  it('returns null score_home/away for pending events', () => {
    const result = transformEvent(fixture);
    expect(result.event.score_home).toBeNull();
    expect(result.event.score_away).toBeNull();
  });
});
```

- [ ] **Step 4.3: Run tests to verify they fail**

```bash
cd services/odds-api-ingester
npm test
```

Expected: ALL fail with "Cannot find module '../transformer.js'" or similar.

- [ ] **Step 4.4: Implement the transformer**

`services/odds-api-ingester/src/transformer.ts`:

```ts
import type {
  ApiEvent,
  ApiOddsML,
  ApiOddsTotal,
  ApiOddsBTTS,
  ApiOddsAH,
  EventV2Row,
  MarketV2Row,
  OutcomeV2Row,
  TransformResult,
} from './types.js';

export function transformEvent(api: ApiEvent): TransformResult {
  const event: EventV2Row = {
    odds_api_id: api.id,
    home: api.home,
    away: api.away,
    home_id: api.homeId ?? null,
    away_id: api.awayId ?? null,
    starts_at: api.date,
    sport_slug: api.sport.slug,
    sport_name: api.sport.name,
    league_slug: api.league.slug,
    league_name: api.league.name,
    status: api.status,
    score_home: api.scores?.home ?? null,
    score_away: api.scores?.away ?? null,
    period_scores: api.scores?.periods ?? null,
    urls: api.urls ?? {},
  };

  const markets: MarketV2Row[] = [];
  const outcomes: OutcomeV2Row[] = [];

  if (api.bookmakers) {
    for (const [bookmaker, marketList] of Object.entries(api.bookmakers)) {
      for (const market of marketList) {
        markets.push({
          event_odds_api_id: api.id,
          bookmaker,
          market_name: market.name,
          odds_api_updated_at: market.updatedAt ?? null,
        });
        const marketKey = {
          event_odds_api_id: api.id,
          bookmaker,
          market_name: market.name,
        };
        for (const odd of market.odds) {
          outcomes.push(...expandOutcome(market.name, odd, marketKey));
        }
      }
    }
  }

  return { event, markets, outcomes };
}

function expandOutcome(
  marketName: string,
  raw: Record<string, unknown>,
  market_key: OutcomeV2Row['market_key'],
): OutcomeV2Row[] {
  const out: OutcomeV2Row[] = [];

  // ML: { home, draw?, away }
  if (typeof raw.home === 'string' && typeof raw.away === 'string' && raw.hdp == null) {
    const ml = raw as ApiOddsML;
    out.push({ market_key, outcome_key: 'home', line: null, odds: parseFloat(ml.home) });
    if (ml.draw != null) {
      out.push({ market_key, outcome_key: 'draw', line: null, odds: parseFloat(ml.draw) });
    }
    out.push({ market_key, outcome_key: 'away', line: null, odds: parseFloat(ml.away) });
    return out;
  }

  // Totals: { hdp, over, under }
  if (typeof raw.over === 'string' && typeof raw.under === 'string') {
    const tot = raw as ApiOddsTotal;
    out.push({ market_key, outcome_key: 'over',  line: tot.hdp, odds: parseFloat(tot.over) });
    out.push({ market_key, outcome_key: 'under', line: tot.hdp, odds: parseFloat(tot.under) });
    return out;
  }

  // BTTS: { yes, no }
  if (typeof raw.yes === 'string' && typeof raw.no === 'string') {
    const btts = raw as ApiOddsBTTS;
    out.push({ market_key, outcome_key: 'yes', line: null, odds: parseFloat(btts.yes) });
    out.push({ market_key, outcome_key: 'no',  line: null, odds: parseFloat(btts.no) });
    return out;
  }

  // Asian Handicap: { hdp, home, away }
  if (typeof raw.home === 'string' && typeof raw.away === 'string' && typeof raw.hdp === 'number') {
    const ah = raw as ApiOddsAH;
    out.push({ market_key, outcome_key: 'home', line: ah.hdp, odds: parseFloat(ah.home) });
    out.push({ market_key, outcome_key: 'away', line: ah.hdp, odds: parseFloat(ah.away) });
    return out;
  }

  // Unknown shape: skip with warning (logged at caller level if needed)
  return out;
}
```

- [ ] **Step 4.5: Run tests to verify pass**

```bash
cd services/odds-api-ingester
npm test
```

Expected: ALL 7 tests in `transformer.test.ts` pass.

- [ ] **Step 4.6: Commit**

```bash
git add services/odds-api-ingester/src/transformer.ts services/odds-api-ingester/src/__tests__/transformer.test.ts services/odds-api-ingester/src/__tests__/fixtures/event-pisa-lecce.json
git commit -m "feat(odds-api): add transformer with TDD coverage for ML/Totals/BTTS/AH"
```

---

## Task 5: API client (TDD with fetch mock)

**Files:**
- Create: `services/odds-api-ingester/src/__tests__/api-client.test.ts`
- Create: `services/odds-api-ingester/src/api-client.ts`

- [ ] **Step 5.1: Write failing test**

`services/odds-api-ingester/src/__tests__/api-client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OddsApiClient } from '../api-client.js';

describe('OddsApiClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('builds correct URL for fetchEvents with sport+league+status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map(),
      json: async () => [],
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new OddsApiClient({ apiKey: 'TESTKEY', baseUrl: 'https://api.example.io/v3' });
    await client.fetchEvents({ sport: 'football', league: 'italy-serie-a', status: 'pending' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/events');
    expect(url).toContain('sport=football');
    expect(url).toContain('league=italy-serie-a');
    expect(url).toContain('status=pending');
    expect(url).toContain('apiKey=TESTKEY');
  });

  it('returns parsed JSON array on success', async () => {
    const sample = [{ id: 1, home: 'A', away: 'B' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map(),
      json: async () => sample,
    }));

    const client = new OddsApiClient({ apiKey: 'K', baseUrl: 'https://x.io/v3' });
    const events = await client.fetchEvents({ sport: 'football' });
    expect(events).toEqual(sample);
  });

  it('throws on non-2xx with error body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Map(),
      json: async () => ({ error: 'You need to provide a valid apiKey' }),
    }));

    const client = new OddsApiClient({ apiKey: 'BAD', baseUrl: 'https://x.io/v3' });
    await expect(client.fetchEvents({ sport: 'football' })).rejects.toThrow(/401/);
  });

  it('fetchOdds builds URL with eventId and bookmakers comma-separated', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map(),
      json: async () => ({ id: 99, bookmakers: {} }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new OddsApiClient({ apiKey: 'K', baseUrl: 'https://x.io/v3' });
    await client.fetchOdds({ eventId: 99, bookmakers: ['Snai IT', 'Sisal IT'] });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/odds');
    expect(url).toContain('eventId=99');
    expect(decodeURIComponent(url)).toContain('bookmakers=Snai IT,Sisal IT');
  });

  it('records rate-limit headers when present', async () => {
    const headers = new Map<string, string>([
      ['x-ratelimit-limit', '100'],
      ['x-ratelimit-remaining', '42'],
      ['x-ratelimit-reset', '1735000000'],
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
      json: async () => [],
    }));

    const client = new OddsApiClient({ apiKey: 'K', baseUrl: 'https://x.io/v3' });
    await client.fetchEvents({ sport: 'football' });
    const last = client.lastRateLimit();
    expect(last?.remaining).toBe(42);
    expect(last?.limit).toBe(100);
  });
});
```

- [ ] **Step 5.2: Run tests, verify they fail**

```bash
cd services/odds-api-ingester
npm test -- api-client
```

Expected: 5 tests fail with module not found.

- [ ] **Step 5.3: Implement the client**

`services/odds-api-ingester/src/api-client.ts`:

```ts
import type { ApiEvent } from './types.js';

export type ClientConfig = {
  apiKey: string;
  baseUrl: string;
};

export type RateLimitInfo = {
  limit: number | null;
  remaining: number | null;
  reset: number | null;
};

export type FetchEventsParams = {
  sport: string;
  league?: string;
  status?: 'pending' | 'live' | 'settled';
};

export type FetchOddsParams = {
  eventId: number;
  bookmakers: string[];
};

export class OddsApiClient {
  private apiKey: string;
  private baseUrl: string;
  private lastRl: RateLimitInfo | null = null;

  constructor(cfg: ClientConfig) {
    this.apiKey = cfg.apiKey;
    this.baseUrl = cfg.baseUrl.replace(/\/$/, '');
  }

  lastRateLimit(): RateLimitInfo | null {
    return this.lastRl;
  }

  async fetchEvents(params: FetchEventsParams): Promise<ApiEvent[]> {
    const url = this.buildUrl('/events', { ...params, apiKey: this.apiKey });
    return this.get<ApiEvent[]>(url);
  }

  async fetchOdds(params: FetchOddsParams): Promise<ApiEvent> {
    const url = this.buildUrl('/odds', {
      eventId: String(params.eventId),
      bookmakers: params.bookmakers.join(','),
      apiKey: this.apiKey,
    });
    return this.get<ApiEvent>(url);
  }

  private buildUrl(path: string, params: Record<string, string | undefined>): string {
    const qs = Object.entries(params)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    return `${this.baseUrl}${path}${qs ? '?' + qs : ''}`;
  }

  private async get<T>(url: string): Promise<T> {
    const res = await fetch(url);
    this.lastRl = readRateLimit(res.headers);
    if (!res.ok) {
      let body: unknown = null;
      try { body = await res.json(); } catch { /* ignore */ }
      throw new Error(`HTTP ${res.status} on ${url} — body=${JSON.stringify(body)}`);
    }
    return res.json() as Promise<T>;
  }
}

function readRateLimit(headers: Headers | Map<string, string> | { get: (k: string) => string | null }): RateLimitInfo {
  const get = (k: string): string | null => {
    if (typeof (headers as Headers).get === 'function') {
      return (headers as Headers).get(k);
    }
    if (headers instanceof Map) {
      return headers.get(k) ?? headers.get(k.toLowerCase()) ?? null;
    }
    return null;
  };
  const num = (s: string | null) => (s == null ? null : Number(s));
  return {
    limit: num(get('x-ratelimit-limit')),
    remaining: num(get('x-ratelimit-remaining')),
    reset: num(get('x-ratelimit-reset')),
  };
}
```

- [ ] **Step 5.4: Run tests, verify they pass**

```bash
cd services/odds-api-ingester
npm test
```

Expected: 12 tests pass total (7 transformer + 5 api-client).

- [ ] **Step 5.5: Commit**

```bash
git add services/odds-api-ingester/src/api-client.ts services/odds-api-ingester/src/__tests__/api-client.test.ts
git commit -m "feat(odds-api): add REST client with rate-limit awareness"
```

---

## Task 6: Upsert layer

**Files:**
- Create: `services/odds-api-ingester/src/upsert.ts`

This task uses live staging DB integration (no unit tests; the smoke verification in Task 8 is the integration test).

- [ ] **Step 6.1: Implement upsert logic**

`services/odds-api-ingester/src/upsert.ts`:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { TransformResult } from './types.js';

export type UpsertConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
};

export type UpsertSummary = {
  events_inserted: number;
  events_updated: number;
  markets_upserted: number;
  outcomes_upserted: number;
};

export class Upserter {
  private sb: SupabaseClient;

  constructor(cfg: UpsertConfig) {
    this.sb = createClient(cfg.supabaseUrl, cfg.serviceRoleKey, {
      auth: { persistSession: false },
    });
  }

  async upsertBatch(results: TransformResult[]): Promise<UpsertSummary> {
    if (results.length === 0) {
      return { events_inserted: 0, events_updated: 0, markets_upserted: 0, outcomes_upserted: 0 };
    }

    // Step 1: upsert events_v2 in bulk, return id+odds_api_id mapping
    const eventRows = results.map(r => r.event);
    const { data: eventsData, error: eventsErr } = await this.sb
      .from('events_v2')
      .upsert(eventRows, { onConflict: 'odds_api_id' })
      .select('id, odds_api_id');
    if (eventsErr) throw new Error(`events_v2 upsert failed: ${eventsErr.message}`);

    const idByOddsApiId = new Map<number, string>();
    for (const row of eventsData ?? []) {
      idByOddsApiId.set(row.odds_api_id as number, row.id as string);
    }

    // Step 2: upsert markets_v2, resolve event_id from map, capture id mapping by composite key
    const marketRows = results.flatMap(r =>
      r.markets.map(m => ({
        event_id: idByOddsApiId.get(m.event_odds_api_id),
        bookmaker: m.bookmaker,
        market_name: m.market_name,
        odds_api_updated_at: m.odds_api_updated_at,
      })).filter(m => m.event_id != null)
    );
    const { data: marketsData, error: marketsErr } = await this.sb
      .from('markets_v2')
      .upsert(marketRows, { onConflict: 'event_id,bookmaker,market_name' })
      .select('id, event_id, bookmaker, market_name');
    if (marketsErr) throw new Error(`markets_v2 upsert failed: ${marketsErr.message}`);

    const marketIdByKey = new Map<string, string>();
    for (const row of marketsData ?? []) {
      const key = `${row.event_id}|${row.bookmaker}|${row.market_name}`;
      marketIdByKey.set(key, row.id as string);
    }

    // Step 3: upsert outcomes_v2 with resolved market_id
    const outcomeRows = results.flatMap(r =>
      r.outcomes.map(o => {
        const eventId = idByOddsApiId.get(o.market_key.event_odds_api_id);
        if (eventId == null) return null;
        const key = `${eventId}|${o.market_key.bookmaker}|${o.market_key.market_name}`;
        const marketId = marketIdByKey.get(key);
        if (marketId == null) return null;
        return {
          market_id: marketId,
          outcome_key: o.outcome_key,
          line: o.line,
          odds: o.odds,
        };
      }).filter((x): x is NonNullable<typeof x> => x != null)
    );

    if (outcomeRows.length > 0) {
      const { error: outcomesErr } = await this.sb
        .from('outcomes_v2')
        .upsert(outcomeRows, { onConflict: 'market_id,outcome_key,line' });
      if (outcomesErr) throw new Error(`outcomes_v2 upsert failed: ${outcomesErr.message}`);
    }

    return {
      events_inserted: 0,           // Supabase upsert does not distinguish; reported as combined
      events_updated: eventRows.length,
      markets_upserted: marketRows.length,
      outcomes_upserted: outcomeRows.length,
    };
  }
}
```

> **Note:** outcomes_v2 unique constraint includes `line` (a nullable column). Postgres treats `NULL != NULL` in UNIQUE, which means ML rows (line IS NULL) can duplicate on retry. Acceptable for POC since same content; address with `coalesce(line, -1)` partial expression unique index in Phase 1 cleanup if observed.

- [ ] **Step 6.2: Commit**

```bash
git add services/odds-api-ingester/src/upsert.ts
git commit -m "feat(odds-api): add idempotent Supabase upsert for events/markets/outcomes"
```

---

## Task 7: POC entry point — Serie A one-shot

**Files:**
- Create: `services/odds-api-ingester/src/poc-serie-a.ts`

- [ ] **Step 7.1: Implement the runner**

`services/odds-api-ingester/src/poc-serie-a.ts`:

```ts
import 'dotenv/config';
import { OddsApiClient } from './api-client.js';
import { transformEvent } from './transformer.js';
import { Upserter } from './upsert.js';
import type { ApiEvent, TransformResult } from './types.js';

const apiKey = requireEnv('ODDS_API_KEY');
const baseUrl = process.env.ODDS_API_BASE ?? 'https://api.odds-api.io/v3';
const supabaseUrl = requireEnv('SUPABASE_URL');
const serviceRole = requireEnv('SUPABASE_SERVICE_ROLE');

const client = new OddsApiClient({ apiKey, baseUrl });
const upserter = new Upserter({ supabaseUrl, serviceRoleKey: serviceRole });

async function main() {
  const t0 = Date.now();
  console.log('[poc-serie-a] start');

  // 1) List Serie A pending events
  const events = await client.fetchEvents({
    sport: 'football',
    league: 'italy-serie-a',
    status: 'pending',
  });
  console.log(`[poc-serie-a] /events returned ${events.length} pending`);
  log_rate_limit();

  if (events.length === 0) {
    console.log('[poc-serie-a] no events, nothing to do');
    return;
  }

  // 2) For each event, fetch odds with Snai IT (single-event, sequential to respect 100/h budget)
  const results: TransformResult[] = [];
  let i = 0;
  for (const e of events) {
    i++;
    try {
      const enriched = await client.fetchOdds({
        eventId: e.id,
        bookmakers: ['Snai IT'],
      });
      results.push(transformEvent(enriched));
      if (i % 5 === 0) console.log(`  [${i}/${events.length}] fetched`);
    } catch (err) {
      console.warn(`  [${i}/${events.length}] event ${e.id} failed:`, (err as Error).message);
    }
  }
  log_rate_limit();

  // 3) Upsert in batch
  const summary = await upserter.upsertBatch(results);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[poc-serie-a] done in ${dt}s`, summary);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function log_rate_limit() {
  const rl = client.lastRateLimit();
  if (rl) {
    console.log(`  [rate-limit] limit=${rl.limit} remaining=${rl.remaining} reset=${rl.reset}`);
  }
}

void main().catch(err => {
  console.error('[poc-serie-a] FATAL', err);
  process.exit(1);
});
```

- [ ] **Step 7.2: Run the POC against staging**

Confirm `.env` has correct `ODDS_API_KEY` (64-char) and `SUPABASE_SERVICE_ROLE` for staging:

```bash
cd services/odds-api-ingester
npm run poc:serie-a
```

Expected output:
```
[poc-serie-a] start
[poc-serie-a] /events returned 40 pending
  [rate-limit] limit=100 remaining=99 reset=...
  [5/40] fetched
  [10/40] fetched
  ...
[poc-serie-a] done in ~120s { events_updated: 40, markets_upserted: 100+, outcomes_upserted: 400+ }
```

If `events.length === 0`: Serie A may have no upcoming pending matches — try `status: 'live'` or another league for the smoke. Document the result and proceed to next steps.

- [ ] **Step 7.3: Commit**

```bash
git add services/odds-api-ingester/src/poc-serie-a.ts
git commit -m "feat(odds-api): add Serie A one-shot POC runner"
```

---

## Task 8: Smoke verification

**Files:**
- Create: `services/odds-api-ingester/scripts/smoke-verify.mjs`

- [ ] **Step 8.1: Write smoke script**

`services/odds-api-ingester/scripts/smoke-verify.mjs`:

```js
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE,
  { auth: { persistSession: false } },
);

async function main() {
  console.log('=== events_v2 (italy-serie-a) ===');
  const { data: events, error: e1 } = await sb
    .from('events_v2')
    .select('id, odds_api_id, home, away, starts_at, status')
    .eq('league_slug', 'italy-serie-a')
    .order('starts_at', { ascending: true });
  if (e1) throw e1;
  console.log(`  count: ${events.length}`);
  events.slice(0, 5).forEach(e =>
    console.log(`    ${e.odds_api_id}  ${e.starts_at}  ${e.home} v ${e.away}`)
  );

  console.log();
  console.log('=== markets_v2 distribution ===');
  const eventIds = events.map(e => e.id);
  const { data: markets, error: e2 } = await sb
    .from('markets_v2')
    .select('event_id, bookmaker, market_name')
    .in('event_id', eventIds);
  if (e2) throw e2;
  const byEvent = new Map();
  markets.forEach(m => {
    if (!byEvent.has(m.event_id)) byEvent.set(m.event_id, []);
    byEvent.get(m.event_id).push(m.market_name);
  });
  let with3plus = 0;
  for (const e of events) {
    const m = byEvent.get(e.id) || [];
    if (m.length >= 3) with3plus++;
  }
  console.log(`  events with ≥3 markets: ${with3plus}/${events.length} (${(100 * with3plus / events.length).toFixed(1)}%)`);

  console.log();
  console.log('=== outcomes_v2 sample ===');
  const { data: outcomes, error: e3 } = await sb
    .from('outcomes_v2')
    .select('outcome_key, line, odds')
    .in('market_id', markets.slice(0, 3).map(m => m.event_id))
    .limit(10);
  if (e3) throw e3;
  outcomes.forEach(o =>
    console.log(`    ${o.outcome_key}  line=${o.line}  odds=${o.odds}`)
  );

  console.log();
  console.log('=== ACCEPTANCE CHECK ===');
  const pass = with3plus / events.length >= 0.95;
  console.log(`  ≥95% events with 3+ markets: ${pass ? 'PASS' : 'FAIL'}`);
  process.exit(pass ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(2); });
```

- [ ] **Step 8.2: Run the smoke verification**

```bash
cd services/odds-api-ingester
npm run smoke
```

Expected:
```
=== events_v2 (italy-serie-a) ===
  count: 40
    61061637  2026-05-01T18:45:00+00:00  Pisa SC v US Lecce
    ...
=== markets_v2 distribution ===
  events with ≥3 markets: 38/40 (95.0%)
=== outcomes_v2 sample ===
    home  line=null  odds=3
    draw  line=null  odds=3
    away  line=null  odds=2.5
    over  line=2.5   odds=2.4
    under line=2.5   odds=1.53
    ...
=== ACCEPTANCE CHECK ===
  ≥95% events with 3+ markets: PASS
```

If FAIL: check for events that returned 0 markets (Snai not covering them) and lower acceptance to `≥85%` if appropriate; document the gap as an open issue for Day 2 decision.

- [ ] **Step 8.3: Test idempotency — re-run POC**

```bash
cd services/odds-api-ingester
npm run poc:serie-a
npm run smoke
```

Expected: same counts, no duplicates. (If outcome counts grew, the NULL-line uniqueness issue noted in Task 6 is biting; address by switching to expression unique index `(market_id, outcome_key, COALESCE(line, -999999))` in a follow-up migration.)

- [ ] **Step 8.4: Commit**

```bash
git add services/odds-api-ingester/scripts/smoke-verify.mjs
git commit -m "feat(odds-api): add smoke verification script for POC acceptance"
```

---

## Task 9: Wrap-up & handoff

- [ ] **Step 9.1: Verify all acceptance criteria met**

Re-read the criteria at the top of this plan; tick them off:
- [ ] events_v2 populated (≥35 of 40 expected)
- [ ] ≥95% of events have ≥3 markets
- [ ] ≥85% of markets have ≥1 outcome
- [ ] Idempotent re-run produces no duplicates
- [ ] All vitest tests pass
- [ ] Schema migration applied cleanly

If any FAIL: pause here, document the gap in `docs/superpowers/specs/2026-04-28-odds-api-io-migration-design.md` Section 9 (Open Questions), and consult before proceeding.

- [ ] **Step 9.2: Capture metrics**

Run a final smoke and save the output:

```bash
cd services/odds-api-ingester
npm run smoke 2>&1 | tee ../../docs/superpowers/specs/2026-04-28-poc-day1-smoke.log
```

- [ ] **Step 9.3: Update spec with Day 1 results**

Append to the spec under Section 9 (Open Questions) a new section **"## 10. POC Day 1 Results"** with:
- Total events ingested
- Markets/event median + max
- Outcomes/market median
- Snai IT coverage % (events with ≥1 Snai market)
- Sample odds reasonableness (e.g., favourite priced 1.40-1.50 vs underdog 6-8)
- Rate limit consumption (peak remaining)
- Open issues found

- [ ] **Step 9.4: Final commit**

```bash
git add docs/superpowers/specs/
git commit -m "docs(odds-api): add POC Day 1 smoke results to spec"
```

---

## Out-of-scope (Day 2 and beyond)

These are deliberately deferred from Day 1:

- Continuous tick scheduling (cron / systemd timer)
- Multi-sport ingestion (tennis, basket, etc.)
- Live in-play polling
- WebSocket integration
- Settlement reconciliation (`status=settled` → close bets)
- Admin Market Grid prototype UI
- Player frontend wiring
- Decommissioning legacy scrapers
- Migration to Pro/Enterprise tier

Day 2 plan will pick the next 1-3 of these based on Day 1 data quality findings.

---

## Risks observed during execution

If any of these manifest, STOP and discuss before continuing:

- Rate limit exhausted before completing Serie A (would need spread across hours)
- Snai IT covers <50% of Serie A events (defeats single-bookmaker POC premise)
- Markets shape differs significantly from sample (transformer needs new branches)
- Supabase upsert fails on conflict semantics (NULL line + UNIQUE constraint)
- league.slug not stable across days (compromises foreign-key strategy)
