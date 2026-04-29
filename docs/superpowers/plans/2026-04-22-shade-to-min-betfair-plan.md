# Shade-to-Min + Betfair Third Source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`2026-04-22-shade-to-min-betfair-design.md`](../specs/2026-04-22-shade-to-min-betfair-design.md)

**Goal:** Replace the stateful auto-suspend cron with a read-time shade-to-min computation across Kambi + 22bet + Betfair Exchange, so kiosk users see the lowest available quota when sources diverge >25% while remaining bettable otherwise.

**Architecture:** New `betfair-scraper` service on scraper-vps ingests Betfair public-API endpoints through Webshare Austrian residential proxies and upserts raw rows tagged `source='betfair'`. The existing normalization crons drain them async. Migration 089 creates `v_outcomes_displayed` (a pivoted view that computes `displayed_odds` via the pure `fn_compute_displayed_odds` function) and a runtime feature flag in `system_config`. The player frontend reads `displayed_odds` through a flag-gated hook; flipping the flag via SQL UPDATE activates shade in ≤60s without redeploy. Auto-suspend cron is commented from crontab (RPC retained for rollback).

**Tech Stack:**
- Node 20 + TypeScript + `tsx` runtime for the scraper
- `undici` (ProxyAgent) for HTTP client with rotating residential proxies
- `@supabase/supabase-js` service-role for upserts
- Supabase Postgres (prod `db.xgnyqkmugnfzhdveeqom.supabase.co`, staging `db.bnabvfalytivjsrwqydo.supabase.co`)
- Next.js (App Router) for admin + player frontends
- `vitest` for unit tests
- systemd for service management on scraper-vps (Hetzner CCX43)
- Webshare Static Residential 100-IP pool with Austrian allocation (dashboard UI)

---

## Prerequisites

- SSH access: `ssh scraper-vps` (alias resolves to `46.225.222.33`)
- Direct Postgres access via `scraper-vps` shell:
  - Prod: `PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres`
  - Staging: `PGPASSWORD='Veronihina2020@' psql -h db.bnabvfalytivjsrwqydo.supabase.co -U postgres -d postgres`
- Webshare dashboard access (to allocate Austrian IPs)
- Repos on `C:\Users\philp\Downloads\`:
  - `betssolution/betssolution-admin` (git, origin/master) — migrations + admin UI + `lib/normalize/`
  - `betssolution/betssolution-player` (git) — kiosk Next.js sportsbook
  - `betfair-exchange/` — existing repo holding the vendorable `scraper/betfair-api.ts`
- **New workspace to be created**: `C:\Users\philp\Downloads\betfair-scraper\`

## Schema truths verified against prod (2026-04-22)

These names matter and differ from the spec's informal names. Use these everywhere in the plan:

| Table | Real column names | Notes |
|---|---|---|
| `market_normalization` | `source`, `source_market_type`, `canonical_key`, `verified`, `confidence`, `extracted_by` | UNIQUE on (source, source_market_type). **CHECK source IN ('kambi','22bet')** — mig 089 must widen. |
| `outcome_normalization` | `source`, `source_market_type`, `source_outcome_name`, `canonical_key`, `canonical_outcome_key`, `verified`, `confidence`, `extracted_by` | UNIQUE on (source, source_market_type, source_outcome_name). **CHECK source IN ('kambi','22bet')** — mig 089 must widen. |
| `markets` | `event_id`, `name`, `slug`, `market_type`, `line` | raw `market_type` is the join column into `market_normalization.source_market_type` |
| `outcomes` | `market_id`, `name`, `odds`, `is_active`, `is_suspended`, `manual_odds`, `manual_suspended` | raw `name` is the join column into `outcome_normalization.source_outcome_name` |
| `events` | `source`, `flashscore_id`, `external_id`, `sport_id`, `starts_at`, `home_team`, `away_team` | `source` allows 'kambi'/'22bet'/'flashscore'/'betfair' — verify CHECK constraint exists; widen if needed in mig 089 |

**Supplementary verification command** (engineer should run first, Task 1, to catch any schema drift beyond this plan's snapshot):
```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -c \"\\d events\" -c \"\\d market_normalization\" -c \"\\d outcome_normalization\" -c \"\\d outcomes\" -c \"\\d markets\" -c \"\\d system_config\""
```

---

## Task 1: Pre-flight schema audit + Webshare Austrian proxy allocation

**Files:**
- Read only (no code changes yet)
- Create: `C:\Users\philp\Downloads\betfair-scraper\.env.template` (at end of task)

**Goal:** Verify live schemas match this plan, allocate proxies, prove Betfair endpoints reachable from AT IP.

- [ ] **Step 1: Verify schema against plan assumptions**

Run:
```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -c '\\d events' -c '\\d market_normalization' -c '\\d outcome_normalization' -c '\\d system_config'" 2>&1 | head -120
```

Expected: column names match the "Schema truths" table above. If `events` table has a CHECK constraint on `source` that rejects `'betfair'`, add it to the Task 7 migration.

- [ ] **Step 2: Verify `system_config` schema**

System_config is documented in `CLAUDE.md` but schema not fully inspected. Run:
```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -c '\\d system_config' -c 'SELECT key, value FROM system_config LIMIT 5;'"
```

Expected: a `key` text PK + `value` jsonb column + optional `description` column. If the value column is not jsonb, the migration's INSERT will need casting adjustment in Task 7.

- [ ] **Step 3: Allocate 20 Austrian IPs in Webshare dashboard**

Manual step (no automation available — the Webshare API is read-only on country selection per project memory):
1. Log in to Webshare dashboard (credentials `vhtsgyng:4826gq63kb2q`, API token `u3vp8oy6...` per memory)
2. Go to Proxy Management → Country Allocation
3. Reserve 20 of the 100 static residential IPs with `Country = Austria`
4. Export the proxy list (host:port:user:pass format) — typically 20 rows

Success criteria: you have 20 Austrian proxy URLs like `http://vhtsgyng:4826gq63kb2q@45.xx.yy.zz:8080`.

**Note on auto-fetch via API**: Webshare exposes a proxy list endpoint that returns currently-allocated IPs by country. If allocation was already done, skip the dashboard step and run:
```bash
curl -s "https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&country_code__in=AT&page_size=100" \
  -H "Authorization: Token u3vp8oy6tm7yhbjcmyxlnur7lb747egdado5t1v6" \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("AT count:",j.count); console.log(j.results.map(p=>`http://${p.username}:${p.password}@${p.proxy_address}:${p.port}`).join(","))'
```
Expected output: `AT count: 50+` followed by comma-separated proxy URLs ready to paste into `BETFAIR_PROXY_URLS`.

- [ ] **Step 4: Note on reachability test (SKIP — handled in Task 6)**

The raw HTTP reachability test (direct `curl` → Betfair API) was run during planning and **returns DSC-0009/0018/0021 faults** — Betfair requires a browser session now (tokens injected via JavaScript, not fetchable with curl). The plan pivots to Camoufox browser-based scraping (Task 3 Step 3 creates `betfair-browser.ts`). True end-to-end reachability is validated by Task 6 Step 6 (local dry-run) when the Camoufox session is launched through an AT proxy. No curl test at this stage.

- [ ] **Step 5: Draft `.env.template`**

Create the file (no secrets committed, template only):
```bash
mkdir -p /c/Users/philp/Downloads/betfair-scraper
```
Create `C:\Users\philp\Downloads\betfair-scraper\.env.template`:
```
# Supabase (service role for upserts)
SUPABASE_URL=https://xgnyqkmugnfzhdveeqom.supabase.co
SUPABASE_SERVICE_ROLE_KEY=

# Webshare Austrian proxies (one per line, comma-separated in a single env var)
BETFAIR_PROXY_URLS=
# Fallback pools (used only when AT exhausts)
BETFAIR_PROXY_URLS_UK=
BETFAIR_PROXY_URLS_DE=

# Runtime tuning
LIVE_INTERVAL_MS=30000
PREMATCH_INTERVAL_MS=300000
MAX_REQUESTS_PER_SECOND=3

# Logging
LOG_LEVEL=info
```

- [ ] **Step 6: Commit nothing yet**

No code changes yet — task 1 is pure discovery. Move to task 2.

---

## Task 2: Scaffold `betfair-scraper` project

**Files:**
- Create: `C:\Users\philp\Downloads\betfair-scraper\package.json`
- Create: `C:\Users\philp\Downloads\betfair-scraper\tsconfig.json`
- Create: `C:\Users\philp\Downloads\betfair-scraper\.gitignore`
- Create: `C:\Users\philp\Downloads\betfair-scraper\README.md`
- Create: `C:\Users\philp\Downloads\betfair-scraper\src\` (empty dir)
- Create: `C:\Users\philp\Downloads\betfair-scraper\vitest.config.ts`

- [ ] **Step 1: `package.json`**

```json
{
  "name": "betfair-scraper",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "start": "tsx src/index.ts",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "camoufox-js": "^0.4.0",
    "dotenv": "^16.4.5",
    "playwright": "^1.45.0",
    "undici": "^6.19.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 2: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": false,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: `.gitignore`**

```
node_modules/
.env
dist/
*.log
.DS_Store
```

- [ ] **Step 4: `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globals: false,
    environment: 'node',
  },
});
```

- [ ] **Step 5: `README.md` (stub)**

```markdown
# betfair-scraper

Public-API scraper for Betfair Exchange. Feeds the betssolution consensus system as a third source alongside Kambi and 22bet.

## Quick start
```
npm install
cp .env.template .env    # fill in secrets
npm test
npm start
```

Deploy target: `scraper-vps:/root/betfair-scraper/` as systemd unit `betfair-scraper.service`.

See `docs/superpowers/specs/2026-04-22-shade-to-min-betfair-design.md` in `betssolution-admin` for full spec.
```

- [ ] **Step 6: Install deps + verify toolchain**

```bash
cd /c/Users/philp/Downloads/betfair-scraper
npm install
npx tsc --noEmit
npx vitest run --reporter=verbose  # expect "No test files found" — fine, tests added later
```

Expected: `npm install` succeeds (no vulnerabilities warning is fine), `tsc` prints nothing, vitest exits 0.

- [ ] **Step 7: Commit**

This repo is a new standalone project, NOT a subfolder of an existing git repo. Initialize git:
```bash
cd /c/Users/philp/Downloads/betfair-scraper
git init
git add .
git commit -m "chore: scaffold betfair-scraper project"
```

---

## Task 3: Vendor `betfair-api.ts` + minimal config

**Files:**
- Create: `C:\Users\philp\Downloads\betfair-scraper\src\config.ts`
- Create: `C:\Users\philp\Downloads\betfair-scraper\src\betfair-api.ts` (vendored, lightly adapted)
- Create: `C:\Users\philp\Downloads\betfair-scraper\src\sport-map.ts`
- Create: `C:\Users\philp\Downloads\betfair-scraper\src\logger.ts`

- [ ] **Step 1: `src/logger.ts` (trivial structured logger)**

```ts
type Level = 'debug' | 'info' | 'warn' | 'error';
const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const envLevel = (process.env.LOG_LEVEL || 'info') as Level;
const threshold = RANK[envLevel] ?? 20;

export function log(level: Level, tag: string, msg: string, meta?: Record<string, unknown>) {
  if (RANK[level] < threshold) return;
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${tag}] ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}`;
  (level === 'error' ? console.error : console.log)(line);
}
```

- [ ] **Step 2: `src/config.ts`**

```ts
import 'dotenv/config';

function parseProxyList(env: string | undefined): string[] {
  if (!env) return [];
  return env.split(',').map(s => s.trim()).filter(Boolean);
}

export const SUPABASE_URL = process.env.SUPABASE_URL || '';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const PROXY_POOLS = {
  AT: parseProxyList(process.env.BETFAIR_PROXY_URLS),
  UK: parseProxyList(process.env.BETFAIR_PROXY_URLS_UK),
  DE: parseProxyList(process.env.BETFAIR_PROXY_URLS_DE),
} as const;

export function getProxies(): string[] {
  if (PROXY_POOLS.AT.length) return PROXY_POOLS.AT;
  if (PROXY_POOLS.UK.length) return PROXY_POOLS.UK;
  if (PROXY_POOLS.DE.length) return PROXY_POOLS.DE;
  return [];
}

export const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
];

export const MAX_REQUESTS_PER_SECOND = Number(process.env.MAX_REQUESTS_PER_SECOND || 3);
export const LIVE_INTERVAL_MS = Number(process.env.LIVE_INTERVAL_MS || 30_000);
export const PREMATCH_INTERVAL_MS = Number(process.env.PREMATCH_INTERVAL_MS || 300_000);

export function assertConfig() {
  if (!SUPABASE_URL) throw new Error('SUPABASE_URL missing');
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
  if (getProxies().length === 0) {
    // Allow zero-proxy mode in dev only
    if (process.env.NODE_ENV !== 'development') throw new Error('BETFAIR_PROXY_URLS missing');
  }
}
```

- [ ] **Step 3: Create `src/betfair-browser.ts` (Camoufox session manager)**

**Important context**: the HTTP-only approach (raw `fetch()` + `_ak=nzIFcwyWhrlwYMrh`) was tested during planning and returns DSC-0009/0018/0021 faults — Betfair has tightened the session requirement. The reliable approach is to launch a Camoufox browser (Playwright + stealth), navigate to `betfair.com/exchange/plus/`, let the page's JavaScript establish the session cookies/tokens, and then call `page.evaluate(async (url) => fetch(url).then(r => r.json()))` from **inside** the browser context. This reuses the browser's session and bypasses the fault.

Reference implementation: `C:/Users/philp/Downloads/betfair-exchange/scraper/betfair-scraper.ts` (the Camoufox variant, not the HTTP one). Lines 487-534 (`fetchViaBrowser()`) show the pattern.

```ts
// src/betfair-browser.ts
import { launchOptions } from 'camoufox-js';
import { firefox, type Browser, type BrowserContext, type Page } from 'playwright';
import { getProxies } from './config.ts';
import { log } from './logger.ts';

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let proxyIndex = 0;

export async function ensureSession(): Promise<Page> {
  if (page && !page.isClosed()) return page;

  const proxies = getProxies();
  const proxyUrl = proxies.length ? proxies[proxyIndex++ % proxies.length] : null;
  log('info', 'BROWSER', `launching Camoufox${proxyUrl ? ` via ${new URL(proxyUrl).host}` : ''}`);

  const camoufoxInput: any = {
    headless: true,
    blockImages: true,
    blockWebrtc: true,
    geoip: !!proxyUrl,
    locale: ['en-GB'],
    os: ['linux'],
  };
  if (proxyUrl) camoufoxInput.proxy = proxyUrl;

  const opts = await launchOptions(camoufoxInput);
  browser = await firefox.launch(opts);

  const contextOpts: any = { viewport: { width: 1366, height: 768 } };
  if (proxyUrl) {
    const u = new URL(proxyUrl);
    contextOpts.proxy = {
      server: `${u.protocol}//${u.hostname}:${u.port}`,
      username: u.username,
      password: u.password,
    };
  }
  context = await browser.newContext(contextOpts);
  page = await context.newPage();

  await page.goto('https://www.betfair.com/exchange/plus/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(3000);

  // Accept cookie banner if present
  try {
    const btn = page.locator('button:has-text("Accept"), #onetrust-accept-btn-handler');
    if (await btn.isVisible({ timeout: 2000 })) { await btn.click(); await page.waitForTimeout(1000); }
  } catch {}

  log('info', 'BROWSER', 'session ready');
  return page;
}

export async function closeSession(): Promise<void> {
  try { await page?.close(); } catch {}
  try { await context?.close(); } catch {}
  try { await browser?.close(); } catch {}
  page = null; context = null; browser = null;
}

/**
 * Call a Betfair API endpoint using the browser's session.
 * The page.evaluate runs inside the tab so fetch() uses valid cookies/tokens.
 */
export async function fetchInBrowser<T = unknown>(url: string): Promise<T> {
  const p = await ensureSession();
  return await p.evaluate(async (u: string) => {
    const res = await fetch(u, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, url) as T;
}
```

- [ ] **Step 3b: Create `src/betfair-api.ts` (URL builders — no fetch, delegates to fetchInBrowser)**

```ts
// src/betfair-api.ts
import { fetchInBrowser } from './betfair-browser.ts';

const BASE_BYMARKET = 'https://www.betfair.com/www/sports/exchange/readonly/v1/bymarket';
const COMMON_QS = '_ak=nzIFcwyWhrlwYMrh&alt=json&currencyCode=GBP&locale=en_GB&rollupLimit=25&rollupModel=STAKE&types=COMPETITION,EVENT,MARKET_DESCRIPTION,RUNNER_DESCRIPTION,RUNNER_STATE,MARKET_STATE,MARKET_RATES,RUNNER_EXCHANGE_PRICES_BEST,RUNNER_METADATA&marketProjection=EVENT,COMPETITION,MARKET_DESCRIPTION,RUNNER_DESCRIPTION,RUNNER_METADATA';

export async function fetchEventsByType(sportId: number, inPlayOnly = false): Promise<unknown> {
  const filter: any = { eventTypeIds: [sportId], marketTypeCodes: ['MATCH_ODDS'], turnInPlayEnabled: true };
  if (inPlayOnly) filter.inPlayOnly = true;
  const url = `${BASE_BYMARKET}?${COMMON_QS}&filter=${encodeURIComponent(JSON.stringify(filter))}`;
  return fetchInBrowser(url);
}

export async function fetchEventMarkets(eventId: number): Promise<unknown> {
  const filter = { eventIds: [eventId], turnInPlayEnabled: true };
  const url = `${BASE_BYMARKET}?${COMMON_QS}&filter=${encodeURIComponent(JSON.stringify(filter))}`;
  return fetchInBrowser(url);
}
```

The `fetchNavigation` and `fetchMarketPrices` helpers from the original `betfair-api.ts` can be added if needed later, but aren't required for MVP (events-by-type returns markets+runners in one call).

- [ ] **Step 4: `src/sport-map.ts` (Appendix A of spec)**

```ts
/**
 * Betfair event_type_id → our sports.id (uuid).
 * Source: prod query on 2026-04-22, see spec Appendix A.
 * Unknown ids fall through to null → event is saved with sport_id=NULL and skipped by consensus until mapped.
 */
export const BETFAIR_SPORT_TO_UUID: Record<number, string | null> = {
  1: '495cc9f2-d414-4ed7-9f33-a20db8ec3122',         // Soccer → calcio
  2: '23bbb7b6-5fff-45ec-bb85-6020661c3ab3',         // Tennis → tennis
  3: '397d3e5a-c939-4fb0-ae4a-b559f5c9c4c1',         // Golf → golf
  4: '28da75b0-8835-4892-acfd-a56f824f79f7',         // Cricket → cricket
  5: '52cec107-2902-44cf-b0cf-b050c4d19487',         // Rugby Union → rugby-union
  7: null,                                            // Horse Racing — handled by ippica-scraper, skip
  7522: '6220caec-789d-4dd5-b179-acaa887dd3fe',      // Basketball → basket
  7524: 'af3a27e5-71fe-46eb-a855-4e94d556156e',      // Ice Hockey → hockey-ghiaccio
  1477968: 'dc613fce-1bf5-43c2-aedb-312571d53506',   // Rugby League
  7511: '16667314-d8d0-4a3e-aa9f-a155f6df13de',      // Baseball
  6423: '63265903-76c3-4d3b-acf6-efcdf6699ad4',      // American Football
  26420387: 'f95b9083-a57a-4157-9a4a-a418eb836cec',  // MMA
  998919: '9c3f3ed2-8453-4468-bba2-f8013ef529ef',    // Volleyball → pallavolo
  468328: '161815ec-30ab-4333-9780-d4176303d588',    // Handball → pallamano
  6422: 'cd11415b-f96a-4aef-bb6e-1e6858c149e3',      // Snooker
  3503: 'f1277c9f-230e-4441-88c7-be09002e4c57',      // Darts → freccette
  2540321: 'cecc0692-9175-4003-9d5c-081b3f67e95d',   // Table Tennis → tennis-tavolo
};

export const ACTIVE_BETFAIR_SPORT_IDS: number[] = Object.entries(BETFAIR_SPORT_TO_UUID)
  .filter(([_, v]) => v !== null)
  .map(([k]) => Number(k));

export function mapBetfairSportId(betfairId: number): string | null {
  return BETFAIR_SPORT_TO_UUID[betfairId] ?? null;
}
```

- [ ] **Step 5: Typecheck**

```bash
cd /c/Users/philp/Downloads/betfair-scraper
npx tsc --noEmit
```
Expected: clean. If errors in vendored file due to strict mode, fix minimally (usually just `any` → `unknown` on response types).

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: vendor betfair-api.ts + config + sport-map

Copies betfair-api.ts from the existing betfair-exchange/scraper/
project, adds config.ts with proxy pool helpers, and sport-map.ts
with the 17 Betfair→our sport UUID mappings from Appendix A of the
spec."
```

---

## Task 4: Parse + transform Betfair responses (TDD)

**Files:**
- Create: `C:\Users\philp\Downloads\betfair-scraper\src\parser.ts`
- Create: `C:\Users\philp\Downloads\betfair-scraper\src\parser.test.ts`
- Create: `C:\Users\philp\Downloads\betfair-scraper\src\__fixtures__\betfair-match-odds.json` (sample response)

The parser transforms Betfair's nested response structure into flat rows we will upsert: events, markets, outcomes.

- [ ] **Step 1: Capture a real Betfair response for the fixture**

Run a live query against Betfair via one of the Austrian proxies (from Task 1 Step 4):
```bash
curl -s --proxy "http://vhtsgyng:4826gq63kb2q@AT_IP:8080" \
  "https://www.betfair.com/www/sports/exchange/readonly/v1/bymarket?_ak=nzIFcwyWhrlwYMrh&alt=json&currencyCode=GBP&locale=en_GB&rollupLimit=25&rollupModel=STAKE&types=COMPETITION,EVENT,MARKET_DESCRIPTION,RUNNER_DESCRIPTION,RUNNER_STATE,MARKET_STATE,MARKET_RATES,RUNNER_EXCHANGE_PRICES_BEST,RUNNER_METADATA&marketProjection=EVENT,COMPETITION,MARKET_DESCRIPTION,RUNNER_DESCRIPTION,RUNNER_METADATA&filter=$(node -e 'console.log(encodeURIComponent(JSON.stringify({eventTypeIds:[1],marketTypeCodes:[\"MATCH_ODDS\"],turnInPlayEnabled:true})))')" \
  -H "User-Agent: Mozilla/5.0" -H "Referer: https://www.betfair.com/exchange/plus/" \
  > /c/Users/philp/Downloads/betfair-scraper/src/__fixtures__/betfair-match-odds.json
```

Verify it's valid JSON and contains `attachments` and/or `eventTypes`:
```bash
cat /c/Users/philp/Downloads/betfair-scraper/src/__fixtures__/betfair-match-odds.json | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(Object.keys(j), "events:", Object.keys(j.attachments?.events||{}).length);'
```
Expected: array with `attachments` and `events:` count > 0.

- [ ] **Step 2: Write failing test**

Create `src/parser.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseExchangeData, type ParsedBetfair } from './parser.ts';
import fixture from './__fixtures__/betfair-match-odds.json' with { type: 'json' };

describe('parseExchangeData', () => {
  const parsed: ParsedBetfair = parseExchangeData(fixture);

  it('extracts at least one event', () => {
    expect(parsed.events.length).toBeGreaterThan(0);
  });

  it('each event has id, home, away, starts_at, sport_type_id', () => {
    for (const ev of parsed.events) {
      expect(typeof ev.id).toBe('number');
      expect(ev.id).toBeGreaterThan(0);
      expect(typeof ev.starts_at).toBe('string');
      expect(ev.sport_type_id).toBe(1); // soccer fixture
    }
  });

  it('events are split into home/away by " v " or " - " separator', () => {
    const withTeams = parsed.events.filter(e => e.home && e.away);
    expect(withTeams.length).toBeGreaterThan(0);
  });

  it('each MATCH_ODDS market has 2 or 3 runners', () => {
    const mos = parsed.markets.filter(m => m.market_type === 'MATCH_ODDS');
    expect(mos.length).toBeGreaterThan(0);
    for (const m of mos) {
      const runners = parsed.runners.filter(r => r.market_id === m.id);
      expect([2, 3]).toContain(runners.length);
    }
  });

  it('runners have back_price_1 as numeric odds or null', () => {
    for (const r of parsed.runners) {
      if (r.back_price_1 !== null && r.back_price_1 !== undefined) {
        expect(typeof r.back_price_1).toBe('number');
        expect(r.back_price_1).toBeGreaterThan(1);
      }
    }
  });

  it('does not throw on empty or malformed data', () => {
    expect(() => parseExchangeData({})).not.toThrow();
    expect(() => parseExchangeData(null)).not.toThrow();
    expect(parseExchangeData({ attachments: { events: {} } })).toMatchObject({ events: [], markets: [], runners: [] });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /c/Users/philp/Downloads/betfair-scraper
npx vitest run src/parser.test.ts
```
Expected: FAIL with "Cannot find module './parser.ts'".

- [ ] **Step 4: Implement `src/parser.ts`**

Lift the `parseExchangeData` function from `betfair-exchange/scraper/betfair-scraper.ts` (lines 43-247 in that file). Minor adaptations:
- Export named type `ParsedBetfair`
- Remove `competitions` since we don't have that concept in our `events` schema (we use `league_id` uuid; mapping Betfair competitions to our leagues is out of scope for Phase 1 — attach via event_normalization later)
- Keep `open_date` as ISO string; in push step we map to `events.starts_at`

```ts
export interface ParsedEvent {
  id: number;                 // Betfair eventId
  sport_type_id: number;      // Betfair eventTypeId
  name: string;
  home: string | null;
  away: string | null;
  starts_at: string;          // ISO 8601
  in_play: boolean;
  country_code: string | null;
  competition_name: string | null;
}

export interface ParsedMarket {
  id: string;                 // Betfair marketId
  event_id: number;
  name: string;
  market_type: string;
  status: string;
  in_play: boolean;
  total_matched: number;
}

export interface ParsedRunner {
  selection_id: number;
  market_id: string;
  name: string;
  status: string;
  handicap: number;
  last_price_traded: number | null;
  back_price_1: number | null;
  back_size_1: number | null;
}

export interface ParsedBetfair {
  events: ParsedEvent[];
  markets: ParsedMarket[];
  runners: ParsedRunner[];
}

export function parseExchangeData(data: unknown): ParsedBetfair {
  const events: ParsedEvent[] = [];
  const markets: ParsedMarket[] = [];
  const runners: ParsedRunner[] = [];

  if (!data || typeof data !== 'object') return { events, markets, runners };
  const d = data as Record<string, any>;

  // Strategy 1: nested eventTypes format
  const eventTypes = d.eventTypes;
  if (Array.isArray(eventTypes)) {
    for (const et of eventTypes) {
      const sportId = Number(et.eventTypeId);
      for (const en of et.eventNodes ?? []) {
        const ev = en.event;
        if (!ev) continue;
        const eventId = Number(en.eventId ?? ev.eventId);
        if (!Number.isFinite(eventId)) continue;

        const nameStr: string = ev.eventName || '';
        const sep = nameStr.includes(' v ') ? ' v ' : ' - ';
        const parts = nameStr.split(sep);
        const [home, away] = parts.length === 2
          ? [parts[0].trim(), parts[1].trim()]
          : [null, null];

        events.push({
          id: eventId,
          sport_type_id: sportId,
          name: nameStr,
          home, away,
          starts_at: ev.openDate || new Date().toISOString(),
          in_play: !!ev.inPlay,
          country_code: ev.countryCode ?? null,
          competition_name: en.competitionNode?.competition?.competitionName ?? null,
        });

        for (const mn of en.marketNodes ?? []) {
          const desc = mn.description || {};
          const state = mn.state || {};
          const marketId = String(mn.marketId);
          markets.push({
            id: marketId,
            event_id: eventId,
            name: desc.marketName || desc.marketType || '',
            market_type: desc.marketType || '',
            status: state.status || 'OPEN',
            in_play: !!state.inplay,
            total_matched: Number(state.totalMatched || 0),
          });
          for (const r of mn.runners ?? []) {
            const rs = r.state || {};
            const ex = r.exchange || {};
            const backs = ex.availableToBack ?? [];
            runners.push({
              selection_id: Number(r.selectionId),
              market_id: marketId,
              name: r.description?.runnerName || `Selection ${r.selectionId}`,
              status: rs.status || 'ACTIVE',
              handicap: Number(r.handicap || 0),
              last_price_traded: rs.lastPriceTraded ?? null,
              back_price_1: backs[0]?.price ?? null,
              back_size_1: backs[0]?.size ?? null,
            });
          }
        }
      }
    }
  }

  // Strategy 2: flat attachments format (common for bymarket responses)
  const att = d.attachments;
  if (att) {
    const eventsMap: Record<string, any> = att.events || {};
    for (const [eid, ev] of Object.entries(eventsMap)) {
      const eventId = Number(eid);
      if (!Number.isFinite(eventId) || events.some(e => e.id === eventId)) continue;
      const sportId = Number(ev.eventTypeId || 1);
      const nameStr: string = ev.eventName || '';
      const sep = nameStr.includes(' v ') ? ' v ' : ' - ';
      const parts = nameStr.split(sep);
      const [home, away] = parts.length === 2
        ? [parts[0].trim(), parts[1].trim()]
        : [null, null];
      events.push({
        id: eventId,
        sport_type_id: sportId,
        name: nameStr,
        home, away,
        starts_at: ev.openDate || new Date().toISOString(),
        in_play: !!ev.inPlay,
        country_code: ev.countryCode ?? null,
        competition_name: null,
      });
    }
    const marketsMap: Record<string, any> = att.markets || {};
    for (const [mid, mk] of Object.entries(marketsMap)) {
      const desc = mk.description || mk.marketDefinition || {};
      const state = mk.state || {};
      markets.push({
        id: String(mid),
        event_id: Number(mk.eventId || desc.eventId || 0),
        name: desc.marketName || desc.marketType || '',
        market_type: desc.marketType || '',
        status: state.status || mk.status || 'OPEN',
        in_play: state.inplay ?? mk.inPlay ?? false,
        total_matched: Number(state.totalMatched || mk.totalMatched || 0),
      });
      for (const r of mk.runners ?? []) {
        const rs = r.state || {};
        const ex = r.exchange || {};
        const backs = ex.availableToBack ?? [];
        runners.push({
          selection_id: Number(r.selectionId),
          market_id: String(mid),
          name: r.description?.runnerName || r.runnerName || `Selection ${r.selectionId}`,
          status: rs.status || r.status || 'ACTIVE',
          handicap: Number(r.handicap || 0),
          last_price_traded: rs.lastPriceTraded ?? null,
          back_price_1: backs[0]?.price ?? null,
          back_size_1: backs[0]?.size ?? null,
        });
      }
    }
  }

  return { events, markets, runners };
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run src/parser.test.ts --reporter=verbose
```
Expected: all 6 assertions pass. If the "each MATCH_ODDS market has 2 or 3 runners" test fails, check the fixture — Betfair may be returning draws-excluded sports (tennis = 2 outcomes) or include some markets in suspended state where runners may be structured differently. Adjust the fixture to soccer only if needed.

- [ ] **Step 6: Commit**

```bash
git add src/parser.ts src/parser.test.ts src/__fixtures__/
git commit -m "feat: parseExchangeData with 6 unit tests against real fixture"
```

---

## Task 5: HTTP push module (`push-to-vincitu.ts`)

**Files:**
- Create: `C:\Users\philp\Downloads\betfair-scraper\src\transform.ts`
- Create: `C:\Users\philp\Downloads\betfair-scraper\src\transform.test.ts`
- Create: `C:\Users\philp\Downloads\betfair-scraper\src\push-to-vincitu.ts`

**CRITICAL CONTEXT** (verified from `C:/Users/philp/Downloads/kambi-scraper/src/push-to-vincitu.ts` and inspection of the `upsert_prematch_batch` RPC):

1. Scrapers **do NOT write to Supabase directly**. They POST JSON payloads to `https://betssolution.com/api/scraper/prematch` and `/api/scraper/live` with header `x-scraper-key`. The route handlers invoke the RPCs `upsert_prematch_batch(payload)` and `upsert_live_batch(payload)`.

2. The RPCs are the protection layer for `manual_suspended`/`manual_odds`: they only INSERT/UPDATE the three columns `odds, is_active, is_suspended` on outcomes. A direct `outcomes.upsert()` from the scraper would clobber the `manual_*` columns (see MEMORY `session-2026-04-22-phase3-manual-override.md` section B2). **This is a blocking correctness issue if we bypass the RPC.**

3. The `events.source` column is a `GENERATED ALWAYS STORED` column computed from `external_id`:
   ```
   CASE
     WHEN external_id LIKE 'kambi:%'   THEN 'kambi'
     WHEN external_id LIKE 'leon:%'    THEN 'leon'
     WHEN external_id LIKE '22bet:%'   THEN '22bet'
     ELSE 'goldbet'
   END
   ```
   The current expression has NO branch for `betfair:%` — rows with `external_id='betfair:xxx'` would be tagged `source='goldbet'`. This must be fixed in migration 089 (Task 7 includes the fix). The scraper simply emits `external_id='betfair:{eventId}'` and the column auto-populates.

4. Required payload shape (per `kambi-scraper/src/transform.ts`):
   ```ts
   interface VincituMarket { type: string; outcomes: { name: string; odds: number }[]; }
   interface VincituPrematchEvent {
     external_id: string;         // e.g. 'betfair:12345'
     home_team: string;
     away_team: string;
     sport: string;                // Italian display name: 'Calcio', 'Tennis', etc.
     league: string;
     country?: string;
     country_code?: string;
     starts_at: string;            // ISO 8601
     status: string;               // 'prematch' | 'live'
     markets: VincituMarket[];
   }
   interface VincituLiveEvent extends VincituPrematchEvent {
     minute?: number;
     period?: string;
     home_score?: number;
     away_score?: number;
   }
   ```
   POST body shape: `{ events: VincituPrematchEvent[] }` — batched in groups of 10.

5. **Betfair sport name mapping to Italian display strings** (the RPC uses `sport` to upsert the `sports` row via `slugify(sport)` — we must emit the correct Italian display name so the `sports.slug` resolves to the right existing UUID):

| Betfair eventTypeId | `sport` value to emit |
|---|---|
| 1 Soccer | `Calcio` |
| 2 Tennis | `Tennis` |
| 4 Cricket | `Cricket` |
| 5 Rugby Union | `Rugby Union` |
| 7522 Basketball | `Basket` |
| 7524 Ice Hockey | `Hockey Ghiaccio` |
| 1477968 Rugby League | `Rugby League` |
| 7511 Baseball | `Baseball` |
| 6423 American Football | `Football Americano` |
| 26420387 MMA | `MMA` |
| 998919 Volleyball | `Pallavolo` |
| 468328 Handball | `Pallamano` |
| 6422 Snooker | `Snooker` |
| 3503 Darts | `Freccette` |
| 2540321 Table Tennis | `Tennis Tavolo` |

(Golf eventTypeId=3 → `Golf`, Horse Racing=7 → skip.)

- [ ] **Step 1: Write failing test for `transform.ts`**

Create `src/transform.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toVincituEvent, type VincituPrematchEvent } from './transform.ts';
import type { ParsedBetfair } from './parser.ts';

const sample: ParsedBetfair = {
  events: [{
    id: 12345, sport_type_id: 1,
    name: 'Juventus v Milan', home: 'Juventus', away: 'Milan',
    starts_at: '2026-04-30T20:00:00.000Z',
    in_play: false, country_code: 'IT', competition_name: 'Serie A',
  }],
  markets: [{
    id: '1.234.5', event_id: 12345,
    name: 'Match Odds', market_type: 'MATCH_ODDS',
    status: 'OPEN', in_play: false, total_matched: 10000,
  }],
  runners: [
    { selection_id: 111, market_id: '1.234.5', name: 'Juventus', status: 'ACTIVE', handicap: 0, last_price_traded: 2.10, back_price_1: 2.10, back_size_1: 500 },
    { selection_id: 222, market_id: '1.234.5', name: 'The Draw', status: 'ACTIVE', handicap: 0, last_price_traded: 3.50, back_price_1: 3.50, back_size_1: 300 },
    { selection_id: 333, market_id: '1.234.5', name: 'Milan',    status: 'ACTIVE', handicap: 0, last_price_traded: 3.20, back_price_1: 3.20, back_size_1: 400 },
  ],
};

describe('toVincituEvent', () => {
  it('emits external_id=betfair:{id} so the generated source column resolves to "betfair"', () => {
    const events = toVincituEvent(sample);
    expect(events).toHaveLength(1);
    expect(events[0].external_id).toBe('betfair:12345');
  });

  it('maps Betfair soccer (sport_type_id=1) to sport="Calcio" (Italian display name for RPC slugify)', () => {
    const [ev] = toVincituEvent(sample);
    expect(ev.sport).toBe('Calcio');
  });

  it('uses competition_name as league; falls back to "Unknown" if missing', () => {
    const [ev] = toVincituEvent(sample);
    expect(ev.league).toBe('Serie A');
    const noLeague = toVincituEvent({ ...sample, events: [{ ...sample.events[0], competition_name: null }] });
    expect(noLeague[0].league).toBe('Unknown');
  });

  it('nests markets+outcomes inline with VincituMarket shape', () => {
    const [ev] = toVincituEvent(sample);
    expect(ev.markets).toHaveLength(1);
    expect(ev.markets[0]).toMatchObject({ type: 'MATCH_ODDS' });
    expect(ev.markets[0].outcomes).toHaveLength(3);
    expect(ev.markets[0].outcomes[0]).toEqual({ name: 'Juventus', odds: 2.10 });
  });

  it('drops runners with null or <=1 back_price_1', () => {
    const nullOdds: ParsedBetfair = { ...sample, runners: [
      { ...sample.runners[0], back_price_1: null },
      { ...sample.runners[1], back_price_1: 1 },
      sample.runners[2],
    ]};
    const [ev] = toVincituEvent(nullOdds);
    expect(ev.markets[0].outcomes).toHaveLength(1);
    expect(ev.markets[0].outcomes[0].name).toBe('Milan');
  });

  it('skips events with unmapped sport_type_id (e.g. horse racing)', () => {
    const hr: ParsedBetfair = { ...sample, events: [{ ...sample.events[0], sport_type_id: 7 }] };
    expect(toVincituEvent(hr)).toHaveLength(0);
  });

  it('maps in_play=true to status="live"', () => {
    const live: ParsedBetfair = { ...sample, events: [{ ...sample.events[0], in_play: true }] };
    expect(toVincituEvent(live)[0].status).toBe('live');
  });

  it('drops markets that have no surviving outcomes (all null odds)', () => {
    const noOdds: ParsedBetfair = { ...sample, runners: sample.runners.map(r => ({ ...r, back_price_1: null })) };
    const [ev] = toVincituEvent(noOdds);
    expect(ev.markets).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd /c/Users/philp/Downloads/betfair-scraper
npx vitest run src/transform.test.ts
```
Expected: FAIL (module doesn't exist).

- [ ] **Step 3: Implement `src/transform.ts`**

```ts
import type { ParsedBetfair } from './parser.ts';
import { mapBetfairSportId } from './sport-map.ts';

export interface VincituOutcome {
  name: string;
  odds: number;
}

export interface VincituMarket {
  type: string;
  outcomes: VincituOutcome[];
}

export interface VincituPrematchEvent {
  external_id: string;
  home_team: string;
  away_team: string;
  sport: string;       // Italian display name (used by RPC slugify → sports table)
  league: string;
  country?: string;
  country_code?: string;
  starts_at: string;
  status: 'prematch' | 'live';
  markets: VincituMarket[];
}

export type VincituLiveEvent = VincituPrematchEvent;

// Betfair event_type_id → Italian sport display name.
// These names must match the existing rows in the sports table
// (see kambi-scraper transform.ts SPORT_MAP for precedent).
const BETFAIR_SPORT_TO_DISPLAY_NAME: Record<number, string | null> = {
  1: 'Calcio',
  2: 'Tennis',
  3: 'Golf',
  4: 'Cricket',
  5: 'Rugby Union',
  7: null,                    // Horse racing — handled by ippica-scraper, skip
  7522: 'Basket',
  7524: 'Hockey Ghiaccio',
  1477968: 'Rugby League',
  7511: 'Baseball',
  6423: 'Football Americano',
  26420387: 'MMA',
  998919: 'Pallavolo',
  468328: 'Pallamano',
  6422: 'Snooker',
  3503: 'Freccette',
  2540321: 'Tennis Tavolo',
};

export function toVincituEvent(parsed: ParsedBetfair): VincituPrematchEvent[] {
  const events: VincituPrematchEvent[] = [];

  // Group markets by event_id for fast lookup
  const marketsByEvent = new Map<number, typeof parsed.markets[number][]>();
  for (const m of parsed.markets) {
    if (!marketsByEvent.has(m.event_id)) marketsByEvent.set(m.event_id, []);
    marketsByEvent.get(m.event_id)!.push(m);
  }

  // Group runners by market_id
  const runnersByMarket = new Map<string, typeof parsed.runners[number][]>();
  for (const r of parsed.runners) {
    if (!runnersByMarket.has(r.market_id)) runnersByMarket.set(r.market_id, []);
    runnersByMarket.get(r.market_id)!.push(r);
  }

  for (const ev of parsed.events) {
    if (!ev.home || !ev.away) continue;
    const sportName = BETFAIR_SPORT_TO_DISPLAY_NAME[ev.sport_type_id];
    if (!sportName) continue;  // unmapped or explicitly skipped
    // Confirm we have a matching uuid (defensive — the maps should stay in sync)
    if (!mapBetfairSportId(ev.sport_type_id)) continue;

    const vincituMarkets: VincituMarket[] = [];
    for (const m of marketsByEvent.get(ev.id) ?? []) {
      const runners = runnersByMarket.get(m.id) ?? [];
      const outcomes: VincituOutcome[] = runners
        .filter(r => r.back_price_1 != null && r.back_price_1 > 1)
        .map(r => ({ name: r.name, odds: Number(r.back_price_1) }));
      if (outcomes.length === 0) continue;  // market with no bettable odds
      vincituMarkets.push({ type: m.market_type, outcomes });
    }

    events.push({
      external_id: `betfair:${ev.id}`,
      home_team: ev.home,
      away_team: ev.away,
      sport: sportName,
      league: ev.competition_name ?? 'Unknown',
      country: ev.country_code ? countryCodeToName(ev.country_code) : undefined,
      country_code: ev.country_code ?? undefined,
      starts_at: ev.starts_at,
      status: ev.in_play ? 'live' : 'prematch',
      markets: vincituMarkets,
    });
  }

  return events;
}

function countryCodeToName(code: string): string | undefined {
  // Minimal mapping — kambi-scraper has a more complete one.
  // For MVP we pass through the 2-letter code; RPC tolerates missing country name.
  return code;
}
```

- [ ] **Step 4: Run test to verify passes**

```bash
npx vitest run src/transform.test.ts --reporter=verbose
```
Expected: all 8 tests pass.

- [ ] **Step 5: Implement `src/push-to-vincitu.ts`** (HTTP POST to admin route)

```ts
import { log } from './logger.ts';
import type { VincituPrematchEvent, VincituLiveEvent } from './transform.ts';

const BATCH_SIZE = 10;
const FETCH_TIMEOUT_MS = 30_000;

function getConfig() {
  return {
    vincituUrl: process.env.VINCITU_URL || 'https://betssolution.com',
    apiKey: process.env.SCRAPER_API_KEY || '',
  };
}

interface PushResult { pushed: number; errors: string[]; }

async function postBatch<T>(url: string, apiKey: string, events: T[]): Promise<PushResult> {
  let totalPushed = 0;
  const allErrors: string[] = [];

  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-scraper-key': apiKey },
        body: JSON.stringify({ events: batch }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        allErrors.push(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
        continue;
      }
      const data = await resp.json() as { processed?: number; inserted?: number; updated?: number; errors?: string[] };
      totalPushed += (data.processed ?? 0) + (data.inserted ?? 0) + (data.updated ?? 0);
      if (data.errors?.length) allErrors.push(...data.errors);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      allErrors.push(`fetch failed: ${msg}`);
      if (msg.includes('ECONNREFUSED') || msg.includes('abort')) break;
    }
  }
  return { pushed: totalPushed, errors: allErrors };
}

export async function pushPrematchBatch(events: VincituPrematchEvent[]): Promise<PushResult> {
  if (events.length === 0) return { pushed: 0, errors: [] };
  const { vincituUrl, apiKey } = getConfig();
  const r = await postBatch(`${vincituUrl}/api/scraper/prematch`, apiKey, events);
  log('info', 'PUSH-PREMATCH', `pushed ${r.pushed}/${events.length}${r.errors.length ? ` (${r.errors.length} errors)` : ''}`);
  if (r.errors.length) log('warn', 'PUSH-PREMATCH', r.errors.slice(0, 3).join(' | '));
  return r;
}

export async function pushLiveBatch(events: VincituLiveEvent[]): Promise<PushResult> {
  if (events.length === 0) return { pushed: 0, errors: [] };
  const { vincituUrl, apiKey } = getConfig();
  const r = await postBatch(`${vincituUrl}/api/scraper/live`, apiKey, events);
  log('info', 'PUSH-LIVE', `pushed ${r.pushed}/${events.length}${r.errors.length ? ` (${r.errors.length} errors)` : ''}`);
  if (r.errors.length) log('warn', 'PUSH-LIVE', r.errors.slice(0, 3).join(' | '));
  return r;
}
```

Also update `.env.template` to include:
```
# HTTP push to betssolution admin
VINCITU_URL=https://betssolution.com
SCRAPER_API_KEY=
```

(Pull the real `SCRAPER_API_KEY` from `/root/kambi-scraper/.env` on scraper-vps during Task 8.)

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/transform.ts src/transform.test.ts src/push-to-vincitu.ts .env.template
git commit -m "feat: transform + HTTP push matching kambi-scraper contract

- transform.ts: ParsedBetfair → VincituPrematchEvent[]
  (8 unit tests: external_id format, sport mapping, market/outcome
  filtering, in_play → status=live, unmapped sport skip)
- push-to-vincitu.ts: POST to /api/scraper/{prematch,live} with
  x-scraper-key header, batched 10/request, 30s timeout
- Does NOT touch Supabase directly — goes through the RPC
  upsert_prematch_batch/upsert_live_batch which protect manual_*
  columns from being clobbered (MEMORY session Phase3 B2)"
```

---

## Task 6: Live + prematch loops + orchestrator

**Files:**
- Create: `C:\Users\philp\Downloads\betfair-scraper\src\live-loop.ts`
- Create: `C:\Users\philp\Downloads\betfair-scraper\src\prematch-loop.ts`
- Create: `C:\Users\philp\Downloads\betfair-scraper\src\index.ts`

No TDD for orchestrator — it's mostly I/O plumbing. Integration validated by Task 8 smoke tests.

- [ ] **Step 1: `src/live-loop.ts`**

```ts
import { fetchEventsByType } from './betfair-api.ts';
import { parseExchangeData } from './parser.ts';
import { toVincituEvent } from './transform.ts';
import { pushLiveBatch } from './push-to-vincitu.ts';
import { closeSession } from './betfair-browser.ts';
import { ACTIVE_BETFAIR_SPORT_IDS } from './sport-map.ts';
import { log } from './logger.ts';
import { LIVE_INTERVAL_MS } from './config.ts';

let running = false;
let consecutiveFailures = 0;

export async function runLiveLoop(): Promise<void> {
  if (running) { log('warn', 'LIVE', 'previous cycle still running — skipping'); return; }
  running = true;
  const start = Date.now();
  let totalPushed = 0;
  let cycleFailures = 0;
  try {
    for (const sportId of ACTIVE_BETFAIR_SPORT_IDS) {
      try {
        const data = await fetchEventsByType(sportId, true);
        const parsed = parseExchangeData(data);
        const events = toVincituEvent(parsed);
        if (events.length === 0) continue;
        const r = await pushLiveBatch(events);
        totalPushed += r.pushed;
      } catch (err: any) {
        cycleFailures++;
        log('error', 'LIVE', `sport ${sportId} failed: ${err.message}`);
      }
    }
    log('info', 'LIVE', 'cycle done', { ms: Date.now() - start, pushed: totalPushed, failures: cycleFailures });

    // Browser session recovery: if entire cycle failed, drop session to force relaunch
    // with fresh cookies/proxy on next cycle.
    if (cycleFailures === ACTIVE_BETFAIR_SPORT_IDS.length) {
      consecutiveFailures++;
      log('warn', 'LIVE', `full-cycle failure ${consecutiveFailures}, recycling browser`);
      await closeSession();
    } else {
      consecutiveFailures = 0;
    }
  } finally {
    running = false;
  }
}

export function startLiveLoop(): NodeJS.Timeout {
  const schedule = async () => {
    const start = Date.now();
    await runLiveLoop();
    const wait = Math.max(5_000, LIVE_INTERVAL_MS - (Date.now() - start));
    return setTimeout(schedule, wait);
  };
  return setTimeout(schedule, 0);
}
```

- [ ] **Step 2: `src/prematch-loop.ts`**

```ts
import { fetchEventsByType } from './betfair-api.ts';
import { parseExchangeData } from './parser.ts';
import { toVincituEvent } from './transform.ts';
import { pushPrematchBatch } from './push-to-vincitu.ts';
import { closeSession } from './betfair-browser.ts';
import { ACTIVE_BETFAIR_SPORT_IDS } from './sport-map.ts';
import { log } from './logger.ts';
import { PREMATCH_INTERVAL_MS } from './config.ts';

let running = false;
let consecutiveFailures = 0;

export async function runPrematchLoop(): Promise<void> {
  if (running) { log('warn', 'PREMATCH', 'previous still running — skipping'); return; }
  running = true;
  const start = Date.now();
  let totalPushed = 0;
  let cycleFailures = 0;
  try {
    for (const sportId of ACTIVE_BETFAIR_SPORT_IDS) {
      try {
        const data = await fetchEventsByType(sportId, false);
        const parsed = parseExchangeData(data);
        const events = toVincituEvent(parsed);
        if (events.length === 0) continue;
        const r = await pushPrematchBatch(events);
        totalPushed += r.pushed;
      } catch (err: any) {
        cycleFailures++;
        log('error', 'PREMATCH', `sport ${sportId} failed: ${err.message}`);
      }
    }
    log('info', 'PREMATCH', 'cycle done', { ms: Date.now() - start, pushed: totalPushed, failures: cycleFailures });

    if (cycleFailures === ACTIVE_BETFAIR_SPORT_IDS.length) {
      consecutiveFailures++;
      log('warn', 'PREMATCH', `full-cycle failure ${consecutiveFailures}, recycling browser`);
      await closeSession();
    } else {
      consecutiveFailures = 0;
    }
  } finally {
    running = false;
  }
}

export function startPrematchLoop(): NodeJS.Timeout {
  const schedule = async () => {
    const start = Date.now();
    await runPrematchLoop();
    const wait = Math.max(10_000, PREMATCH_INTERVAL_MS - (Date.now() - start));
    return setTimeout(schedule, wait);
  };
  return setTimeout(schedule, 0);
}
```

- [ ] **Step 3: `src/index.ts`**

```ts
import { assertConfig } from './config.ts';
import { startLiveLoop } from './live-loop.ts';
import { startPrematchLoop } from './prematch-loop.ts';
import { closeSession } from './betfair-browser.ts';
import { log } from './logger.ts';

async function main() {
  assertConfig();
  log('info', 'INIT', 'betfair-scraper starting');
  startLiveLoop();
  // Stagger prematch start to avoid first-minute burst (and let live establish browser session first)
  setTimeout(() => startPrematchLoop(), 15_000);
}

async function shutdown(signal: string) {
  log('info', 'EXIT', `${signal} received, closing browser`);
  await closeSession();
  process.exit(0);
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch(async err => {
  log('error', 'FATAL', err.message);
  await closeSession();
  process.exit(1);
});
```

**Live + prematch share ONE browser session** via the module-level globals in `betfair-browser.ts`. The `ensureSession()` call is idempotent — the first cycle to run (live at t=0) establishes the session; prematch at t=15s reuses the same page. This avoids double proxy consumption and session fingerprint divergence.

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 5: Install Camoufox browser binary**

Camoufox needs the Firefox-based Camoufox binary downloaded separately (~200MB):
```bash
cd /c/Users/philp/Downloads/betfair-scraper
npx camoufox-js fetch
```
Expected: download completes, binary saved under node_modules or user cache dir.

- [ ] **Step 6: Dry-run locally**

Set staging credentials in `.env` to avoid prod writes:
```bash
cd /c/Users/philp/Downloads/betfair-scraper
cp .env.template .env
# Edit .env: fill
#   VINCITU_URL=https://staging.betssolution.com
#   SCRAPER_API_KEY=<pull from /root/kambi-scraper/.env on scraper-vps>
#   SUPABASE_URL=https://bnabvfalytivjsrwqydo.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=<staging key>
#   BETFAIR_PROXY_URLS=<paste 2-5 AT proxy URLs comma-separated>
npx tsx src/index.ts 2>&1 | head -60
```
Watch for:
- `[INFO] [INIT] betfair-scraper starting`
- `[INFO] [BROWSER] launching Camoufox via 87.86.x.x:xxxx`
- `[INFO] [BROWSER] session ready` within ~30s
- `[INFO] [LIVE] cycle done { pushed: N }` within ~60s

If `[ERROR] [LIVE] sport X failed: HTTP 403` — session got blocked; check proxy is truly AT, and verify Camoufox stealth worked (site may have detected automation).

Kill with Ctrl+C after observing one full live cycle + one prematch cycle.

- [ ] **Step 7: Commit**

```bash
git add src/live-loop.ts src/prematch-loop.ts src/index.ts
git commit -m "feat: live + prematch loops with self-pacing scheduling

Both loops share the single Camoufox browser session via
betfair-browser.ts module globals. Full-cycle failure triggers
closeSession() so the next cycle relaunches with a fresh proxy.
Live starts at t=0, prematch staggered to t=15s so it reuses
the session live just established."
```

---

## Task 7: Migration 089 — schema widening + function + views + flag

**Files:**
- Create: `C:\Users\philp\Downloads\betssolution\betssolution-admin\supabase\migrations\089_shade_to_min_three_source.sql`
- Create: `C:\Users\philp\Downloads\betssolution\betssolution-admin\supabase\migrations\089_shade_to_min_three_source.test.sql` (manual verification queries)

- [ ] **Step 1: Draft migration file**

Create `089_shade_to_min_three_source.sql`:

```sql
-- ============================================================
-- 089_shade_to_min_three_source.sql
--
-- Enables Betfair as a third source and introduces read-time
-- shade-to-min odds computation. Replaces the auto_suspend cron
-- (cron disabled separately via crontab edit in Task 12).
--
-- Safe to apply BEFORE frontend changes — view is additive.
-- ============================================================

BEGIN;

-- ----------------------------------------------------------------
-- 1) Widen source CHECK constraints so 'betfair' is an allowed value
-- ----------------------------------------------------------------

ALTER TABLE market_normalization
  DROP CONSTRAINT IF EXISTS market_normalization_source_check;
ALTER TABLE market_normalization
  ADD CONSTRAINT market_normalization_source_check
  CHECK (source = ANY (ARRAY['kambi'::text, '22bet'::text, 'betfair'::text]));

ALTER TABLE outcome_normalization
  DROP CONSTRAINT IF EXISTS outcome_normalization_source_check;
ALTER TABLE outcome_normalization
  ADD CONSTRAINT outcome_normalization_source_check
  CHECK (source = ANY (ARRAY['kambi'::text, '22bet'::text, 'betfair'::text]));

-- Events source is a GENERATED ALWAYS STORED column. Its current expression
-- derives source from external_id prefix but has NO branch for 'betfair:%' —
-- rows with external_id='betfair:xxx' would end up tagged source='goldbet'
-- (the fallback). We rewrite the expression to include betfair.
--
-- PG 17+ supports ALTER COLUMN SET EXPRESSION AS; earlier versions must drop
-- and re-add the column. Supabase prod should be checked before applying.
-- Per memory the events table is large (~millions of rows historical);
-- the DROP+ADD path triggers a table rewrite and takes minutes. Prefer the
-- in-place update when possible.
DO $$
DECLARE
  v_pg_version int;
BEGIN
  v_pg_version := current_setting('server_version_num')::int;

  IF v_pg_version >= 170000 THEN
    -- PG 17+: in-place expression update (fast, no rewrite)
    EXECUTE $SQL$
      ALTER TABLE events ALTER COLUMN source SET EXPRESSION AS (
        CASE
          WHEN external_id LIKE 'kambi:%'   THEN 'kambi'
          WHEN external_id LIKE 'leon:%'    THEN 'leon'
          WHEN external_id LIKE '22bet:%'   THEN '22bet'
          WHEN external_id LIKE 'betfair:%' THEN 'betfair'
          ELSE 'goldbet'
        END
      )
    $SQL$;
    RAISE NOTICE 'events.source generated expression updated in-place (PG17+)';
  ELSE
    -- PG < 17: drop + re-add. Slow (rewrites table) but safe for generated cols.
    -- Verify no dependencies first: any view that selects events.source will block.
    -- Known views that reference events.source: v_consensus_latest (mig 086).
    -- That view is re-creatable from mig 086 so we drop+recreate it as part of this step.
    EXECUTE 'DROP VIEW IF EXISTS v_consensus_latest CASCADE';
    EXECUTE 'ALTER TABLE events DROP COLUMN source';
    EXECUTE $SQL$
      ALTER TABLE events ADD COLUMN source TEXT GENERATED ALWAYS AS (
        CASE
          WHEN external_id LIKE 'kambi:%'   THEN 'kambi'
          WHEN external_id LIKE 'leon:%'    THEN 'leon'
          WHEN external_id LIKE '22bet:%'   THEN '22bet'
          WHEN external_id LIKE 'betfair:%' THEN 'betfair'
          ELSE 'goldbet'
        END
      ) STORED
    $SQL$;
    RAISE NOTICE 'events.source generated expression recreated via DROP+ADD (PG<17)';
    -- v_consensus_latest must be recreated after this migration by re-running mig 086's DDL.
    -- The operator should be informed — see Task 7 Step 3 below.
  END IF;
END $$;

-- Events source CHECK constraint — skip unless present. GENERATED columns typically
-- don't have CHECK constraints but we handle it defensively.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='events'::regclass AND conname='events_source_check') THEN
    EXECUTE 'ALTER TABLE events DROP CONSTRAINT events_source_check';
    EXECUTE 'ALTER TABLE events ADD CONSTRAINT events_source_check CHECK (source = ANY (ARRAY[''kambi''::text, ''leon''::text, ''22bet''::text, ''betfair''::text, ''goldbet''::text, ''flashscore''::text]))';
  END IF;
END $$;

-- ----------------------------------------------------------------
-- 2) Extend consensus_snapshots (backward compatible — columns nullable)
-- ----------------------------------------------------------------

ALTER TABLE consensus_snapshots
  ADD COLUMN IF NOT EXISTS betfair_event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS betfair_odds numeric;

-- ----------------------------------------------------------------
-- 3) Pure compute function (IMMUTABLE for planner optimization)
-- INVARIANT: this function must remain pure in its inputs. Any future change that
-- reads from current_timestamp, session vars, or other tables MUST change the
-- volatility marker to STABLE or VOLATILE.
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_compute_displayed_odds(
  p_kambi_odds numeric, p_kambi_active boolean, p_kambi_suspended boolean,
  p_twobet_odds numeric, p_twobet_active boolean, p_twobet_suspended boolean,
  p_betfair_odds numeric, p_betfair_active boolean, p_betfair_suspended boolean,
  p_manual_odds numeric,
  p_canonical_verified boolean
) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_available numeric[];
  v_min numeric; v_max numeric;
  v_spread numeric;
  v_primary numeric;
BEGIN
  IF p_manual_odds IS NOT NULL THEN RETURN p_manual_odds; END IF;

  v_available := ARRAY[]::numeric[];
  IF p_kambi_odds IS NOT NULL AND COALESCE(p_kambi_active, false) AND NOT COALESCE(p_kambi_suspended, false) THEN
    v_available := array_append(v_available, p_kambi_odds);
  END IF;
  IF p_twobet_odds IS NOT NULL AND COALESCE(p_twobet_active, false) AND NOT COALESCE(p_twobet_suspended, false) THEN
    v_available := array_append(v_available, p_twobet_odds);
  END IF;
  IF p_betfair_odds IS NOT NULL AND COALESCE(p_betfair_active, false) AND NOT COALESCE(p_betfair_suspended, false) THEN
    v_available := array_append(v_available, p_betfair_odds);
  END IF;

  IF array_length(v_available, 1) IS NULL THEN RETURN NULL; END IF;

  v_primary := COALESCE(
    CASE WHEN COALESCE(p_kambi_active,false)  AND NOT COALESCE(p_kambi_suspended,false)  THEN p_kambi_odds   END,
    CASE WHEN COALESCE(p_twobet_active,false) AND NOT COALESCE(p_twobet_suspended,false) THEN p_twobet_odds  END,
    CASE WHEN COALESCE(p_betfair_active,false) AND NOT COALESCE(p_betfair_suspended,false) THEN p_betfair_odds END
  );

  IF NOT COALESCE(p_canonical_verified, false) THEN RETURN v_primary; END IF;

  IF array_length(v_available, 1) = 1 THEN
    IF v_available[1] > 3.0 THEN
      RETURN ROUND(v_available[1] * 0.90, 2);
    ELSE
      RETURN v_available[1];
    END IF;
  END IF;

  SELECT MIN(x), MAX(x) INTO v_min, v_max FROM unnest(v_available) x;
  v_spread := (v_max / v_min) - 1;
  IF v_spread > 0.25 THEN RETURN v_min; END IF;
  RETURN v_primary;
END $$;

COMMENT ON FUNCTION fn_compute_displayed_odds IS
  'Pure read-time shade-to-min computation. Inputs per source (odds,active,suspended) + manual override + canonical_verified flag. See spec 2026-04-22-shade-to-min-betfair-design.md section 5.';

-- ----------------------------------------------------------------
-- 4) v_outcomes_canonical — resolution helper joining normalization tables
-- ----------------------------------------------------------------

CREATE OR REPLACE VIEW v_outcomes_canonical AS
SELECT
  e.flashscore_id,
  e.sport_id,
  e.source,
  mn.canonical_key          AS market_canonical_key,
  mn.verified               AS market_canon_verified,
  onz.canonical_outcome_key,
  onz.verified              AS outcome_canon_verified,
  o.id                      AS outcome_id,
  o.odds,
  o.is_active,
  o.is_suspended,
  o.manual_odds,
  o.manual_suspended,
  m.id                      AS market_id,
  m.market_type             AS source_market_type,
  o.name                    AS source_outcome_name
FROM outcomes o
  JOIN markets m ON m.id = o.market_id
  JOIN events  e ON e.id = m.event_id
  LEFT JOIN market_normalization mn
    ON mn.source = e.source
   AND mn.source_market_type = m.market_type
  LEFT JOIN outcome_normalization onz
    ON onz.source = e.source
   AND onz.source_market_type = m.market_type
   AND onz.source_outcome_name = o.name
WHERE e.flashscore_id IS NOT NULL;

COMMENT ON VIEW v_outcomes_canonical IS
  'Per-source outcome rows with canonicalization resolved via market_normalization and outcome_normalization. Intermediate layer for v_outcomes_displayed.';

-- ----------------------------------------------------------------
-- 5) v_outcomes_displayed — pivot per canonical group + compute
-- ----------------------------------------------------------------

CREATE OR REPLACE VIEW v_outcomes_displayed AS
WITH pivoted AS (
  SELECT
    flashscore_id,
    sport_id,
    market_canonical_key,
    canonical_outcome_key,

    MAX(odds)     FILTER (WHERE source='kambi')    AS kambi_odds,
    BOOL_OR(is_active)    FILTER (WHERE source='kambi')    AS kambi_active,
    BOOL_OR(is_suspended) FILTER (WHERE source='kambi')    AS kambi_suspended,

    MAX(odds)     FILTER (WHERE source='22bet')    AS twobet_odds,
    BOOL_OR(is_active)    FILTER (WHERE source='22bet')    AS twobet_active,
    BOOL_OR(is_suspended) FILTER (WHERE source='22bet')    AS twobet_suspended,

    MAX(odds)     FILTER (WHERE source='betfair')  AS betfair_odds,
    BOOL_OR(is_active)    FILTER (WHERE source='betfair')  AS betfair_active,
    BOOL_OR(is_suspended) FILTER (WHERE source='betfair')  AS betfair_suspended,

    MAX(manual_odds)             AS manual_odds,
    BOOL_OR(manual_suspended)    AS manual_suspended,

    (BOOL_AND(COALESCE(market_canon_verified, false))
     AND BOOL_AND(COALESCE(outcome_canon_verified, false))
    ) AS canonical_verified,

    (ARRAY_AGG(outcome_id ORDER BY
       CASE source WHEN 'kambi' THEN 1 WHEN '22bet' THEN 2 WHEN 'betfair' THEN 3 ELSE 9 END
    ))[1] AS primary_outcome_id
  FROM v_outcomes_canonical
  WHERE market_canonical_key IS NOT NULL
    AND canonical_outcome_key IS NOT NULL
  GROUP BY flashscore_id, sport_id, market_canonical_key, canonical_outcome_key
)
SELECT
  p.*,
  fn_compute_displayed_odds(
    p.kambi_odds, p.kambi_active, p.kambi_suspended,
    p.twobet_odds, p.twobet_active, p.twobet_suspended,
    p.betfair_odds, p.betfair_active, p.betfair_suspended,
    p.manual_odds,
    p.canonical_verified
  ) AS displayed_odds
FROM pivoted p;

COMMENT ON VIEW v_outcomes_displayed IS
  'One row per canonical (flashscore_id, market_canonical_key, canonical_outcome_key) triple with per-source odds pivoted and displayed_odds computed. Frontend reads this view when system_config.shade_enabled=true.';

-- ----------------------------------------------------------------
-- 6) Feature flag in system_config
-- ----------------------------------------------------------------

INSERT INTO system_config (key, value, description)
VALUES (
  'shade_enabled',
  'false'::jsonb,
  'Enable shade-to-min on player frontend. When false, reads outcomes.odds (primary source). When true, reads v_outcomes_displayed.displayed_odds.'
)
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------
-- 7) Supporting indexes
-- ----------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_market_normalization_lookup
  ON market_normalization(source, source_market_type);
CREATE INDEX IF NOT EXISTS idx_outcome_normalization_lookup
  ON outcome_normalization(source, source_market_type, source_outcome_name);
CREATE INDEX IF NOT EXISTS idx_events_flashscore_source
  ON events(flashscore_id, source) WHERE flashscore_id IS NOT NULL;

COMMIT;
```

- [ ] **Step 1b: Verify events.source expression updated**

```bash
ssh scraper-vps "PGPASSWORD='Veronihina2020@' psql -h db.bnabvfalytivjsrwqydo.supabase.co -U postgres -d postgres -c \"SELECT generation_expression FROM information_schema.columns WHERE table_name='events' AND column_name='source';\""
```
Expected: the returned CASE expression contains `'betfair:%' THEN 'betfair'`. If it still shows only kambi/leon/22bet, the DO block hit the PG-version branch that couldn't update — check logs and escalate.

After applying to prod, additionally:
```bash
# Sample a fresh betfair row once Task 8 runs and verify source resolves correctly
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -c \"SELECT source, external_id FROM events WHERE external_id LIKE 'betfair:%' LIMIT 3;\""
```
Expected: `source='betfair'` on all rows.

- [ ] **Step 1c: If PG<17 path was taken — recreate v_consensus_latest**

If the prior DO block emitted `RAISE NOTICE 'events.source generated expression recreated via DROP+ADD'`, re-apply mig 086's view creation:
```bash
# Inspect mig 086 for the v_consensus_latest definition
grep -A 30 "v_consensus_latest" /c/Users/philp/Downloads/betssolution/betssolution-admin/supabase/migrations/086_*.sql
# Extract the CREATE VIEW v_consensus_latest ... statement and run it against staging then prod
```
Skip this step if the notice said "updated in-place (PG17+)".

- [ ] **Step 2: Create verification SQL file**

Create `089_shade_to_min_three_source.test.sql` (not applied, manually run after migration):
```sql
-- Verification queries for migration 089. Run after applying.

-- 1. Function exists and handles basic cases
SELECT fn_compute_displayed_odds(
  2.10, true, false,
  5.80, true, false,
  NULL, NULL, NULL,
  NULL,
  true
) AS test1_shade_to_min_2source;
-- Expected: 2.10

SELECT fn_compute_displayed_odds(
  2.10, true, false,
  2.15, true, false,
  2.12, true, false,
  NULL,
  true
) AS test2_aligned_returns_primary;
-- Expected: 2.10

SELECT fn_compute_displayed_odds(
  NULL, NULL, NULL,
  NULL, NULL, NULL,
  NULL, NULL, NULL,
  1.95,
  true
) AS test3_manual_override_wins;
-- Expected: 1.95

SELECT fn_compute_displayed_odds(
  5.80, true, false,
  NULL, NULL, NULL,
  NULL, NULL, NULL,
  NULL,
  true
) AS test4_single_high_markup;
-- Expected: 5.22 (5.80 * 0.90 rounded)

SELECT fn_compute_displayed_odds(
  NULL, NULL, NULL,
  NULL, NULL, NULL,
  NULL, NULL, NULL,
  NULL,
  true
) AS test5_no_source_returns_null;
-- Expected: NULL

-- 2. Views exist
SELECT COUNT(*) > 0 AS v_outcomes_canonical_exists FROM pg_views WHERE viewname = 'v_outcomes_canonical';
SELECT COUNT(*) > 0 AS v_outcomes_displayed_exists FROM pg_views WHERE viewname = 'v_outcomes_displayed';

-- 3. Feature flag
SELECT key, value FROM system_config WHERE key = 'shade_enabled';
-- Expected: shade_enabled = false

-- 4. Sample view rows (should not error; may be 0 rows if no betfair data yet)
SELECT COUNT(*) AS displayed_rows FROM v_outcomes_displayed;
SELECT * FROM v_outcomes_displayed LIMIT 3;

-- 5. CHECK constraints widened
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname IN ('market_normalization_source_check', 'outcome_normalization_source_check');
-- Expected: both should allow 'betfair' in ARRAY
```

- [ ] **Step 3: Apply to staging first**

```bash
ssh scraper-vps "PGPASSWORD='Veronihina2020@' psql -h db.bnabvfalytivjsrwqydo.supabase.co -U postgres -d postgres -f -" \
  < /c/Users/philp/Downloads/betssolution/betssolution-admin/supabase/migrations/089_shade_to_min_three_source.sql
```
Expected: no errors. Each ALTER and CREATE should print `ALTER TABLE` / `CREATE FUNCTION` / `CREATE VIEW`.

Run verification:
```bash
ssh scraper-vps "PGPASSWORD='Veronihina2020@' psql -h db.bnabvfalytivjsrwqydo.supabase.co -U postgres -d postgres -f -" \
  < /c/Users/philp/Downloads/betssolution/betssolution-admin/supabase/migrations/089_shade_to_min_three_source.test.sql
```
Expected:
- test1 = 2.10
- test2 = 2.10
- test3 = 1.95
- test4 = 5.22
- test5 = NULL
- Both views exist
- shade_enabled = false
- Both CHECK constraints include 'betfair'

If any fail, fix the migration before applying to prod. Do NOT proceed to prod unless staging passes.

- [ ] **Step 4: Apply to prod**

```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -f -" \
  < /c/Users/philp/Downloads/betssolution/betssolution-admin/supabase/migrations/089_shade_to_min_three_source.sql
```
Then rerun the verification SQL against prod. Same expected results.

- [ ] **Step 5: Commit migration files**

```bash
cd /c/Users/philp/Downloads/betssolution/betssolution-admin
git add supabase/migrations/089_shade_to_min_three_source.sql supabase/migrations/089_shade_to_min_three_source.test.sql
git commit -m "feat(mig 089): shade-to-min + Betfair source support

- Widen CHECK constraints on market_normalization, outcome_normalization
  (and events if applicable) to allow source='betfair'
- Extend consensus_snapshots with betfair_event_id + betfair_odds (nullable)
- Add fn_compute_displayed_odds IMMUTABLE pure function
- Add v_outcomes_canonical + v_outcomes_displayed views
- Add system_config.shade_enabled feature flag (default false)
- Add supporting indexes

Applied to staging + prod. Verified with 089_...test.sql.

See spec: docs/superpowers/specs/2026-04-22-shade-to-min-betfair-design.md"
```

---

## Task 8: Deploy `betfair-scraper` to scraper-vps (Phase 1)

**Files:**
- Create: `/etc/systemd/system/betfair-scraper.service` (on scraper-vps)
- Remote: `/root/betfair-scraper/` (scp destination)

- [ ] **Step 1: Pre-flight check on scraper-vps resources**

```bash
ssh scraper-vps "free -m && df -h / && systemctl list-units --type=service --state=running | wc -l"
```
Expected: ≥1GB free RAM, ≥5GB free disk on /.

- [ ] **Step 2: Install Playwright + Camoufox system dependencies on scraper-vps**

Playwright Firefox + Camoufox need OS libs for headless rendering:
```bash
ssh scraper-vps "apt-get update && apt-get install -y libdbus-glib-1-2 libxt6 libxtst6 libx11-xcb1 libxcomposite1 libxdamage1 libasound2 libgtk-3-0 python3 python3-pip"
```
Expected: packages install cleanly. These are standard Firefox headless deps.

- [ ] **Step 3: Bundle + scp to scraper-vps**

```bash
cd /c/Users/philp/Downloads/betfair-scraper
tar czf /tmp/betfair-scraper.tar.gz --exclude=node_modules --exclude=.env --exclude=.git .
scp /tmp/betfair-scraper.tar.gz scraper-vps:/tmp/
ssh scraper-vps "mkdir -p /root/betfair-scraper && cd /root/betfair-scraper && tar xzf /tmp/betfair-scraper.tar.gz && npm ci --omit=dev && npx playwright install firefox && npx camoufox-js fetch"
```
Notes:
- `npx playwright install firefox` downloads the Playwright-managed Firefox binary (~100MB)
- `npx camoufox-js fetch` downloads the Camoufox stealth patches (~200MB)
- Total disk footprint on scraper-vps: ~400MB — verify in Step 1 free space

- [ ] **Step 4: Populate .env on scraper-vps**

```bash
ssh scraper-vps 'cat > /root/betfair-scraper/.env <<EOF
SUPABASE_URL=https://xgnyqkmugnfzhdveeqom.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<paste prod service role key from 1Password / existing .env on /root/kambi-scraper/.env>
BETFAIR_PROXY_URLS=<paste 20 comma-separated AT proxy URLs>
BETFAIR_PROXY_URLS_UK=<optional>
BETFAIR_PROXY_URLS_DE=<optional>
LIVE_INTERVAL_MS=30000
PREMATCH_INTERVAL_MS=300000
MAX_REQUESTS_PER_SECOND=3
LOG_LEVEL=info
EOF
chmod 600 /root/betfair-scraper/.env'
```

(Pull the prod service_role_key with `ssh scraper-vps "grep SUPABASE /root/kambi-scraper/.env"` to avoid re-typing.)

- [ ] **Step 5: Write systemd unit**

```bash
ssh scraper-vps 'cat > /etc/systemd/system/betfair-scraper.service <<EOF
[Unit]
Description=Betfair Exchange scraper (third consensus source)
After=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/betfair-scraper
EnvironmentFile=/root/betfair-scraper/.env
ExecStart=/usr/bin/npx tsx src/index.ts
Restart=on-failure
RestartSec=5
StandardOutput=append:/var/log/betfair-scraper.log
StandardError=append:/var/log/betfair-scraper.log

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload'
```

- [ ] **Step 6: Start service + watch logs**

```bash
ssh scraper-vps "systemctl enable --now betfair-scraper.service"
ssh scraper-vps "tail -f /var/log/betfair-scraper.log" &
# Let it run for 2 minutes, observe
# Expected: INIT → LIVE cycle done (with nonzero counts for calcio at minimum) → wait → next cycle
```
Kill the tail after 2 minutes with `fg` then Ctrl+C, or open in a new terminal.

- [ ] **Step 7: Verify rows land in DB (prod)**

```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -c \"
  SELECT source, COUNT(*) AS events, COUNT(DISTINCT sport_id) AS sports
  FROM events WHERE source='betfair' GROUP BY source;
  SELECT m.market_type, COUNT(*)
  FROM markets m JOIN events e ON e.id=m.event_id
  WHERE e.source='betfair' GROUP BY m.market_type ORDER BY 2 DESC LIMIT 20;\""
```
Expected after ~5-10 minutes runtime: hundreds of events with source='betfair', several sports, top market_types including MATCH_ODDS, OVER_UNDER_*, BOTH_TEAMS_TO_SCORE, etc.

- [ ] **Step 8: Commit deploy notes**

Nothing code-wise — just append a line to the local README:
```bash
cd /c/Users/philp/Downloads/betfair-scraper
# Update README with "Deployed to scraper-vps on YYYY-MM-DD"
git add README.md
git commit -m "docs: deployed Phase 1 to scraper-vps"
```

---

## Task 9: Phase 1 shadow observation (24-48h passive)

No code. Observational gate before Phase 2.

- [ ] **Step 1: Set a wakeup or manual note to revisit in 24h**

- [ ] **Step 2: At 24h checkpoint, run acceptance queries**

```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres" <<'EOF'
-- Cycle health
SELECT
  COUNT(*) FILTER (WHERE source='betfair') AS betfair_events,
  COUNT(*) FILTER (WHERE source='kambi')   AS kambi_events,
  COUNT(*) FILTER (WHERE source='22bet')   AS twobet_events
FROM events WHERE status IN ('prematch','live') AND starts_at > NOW();

-- Canonicalization coverage (Phase 1 expects ~0% since rules added in Phase 2)
SELECT
  source,
  COUNT(*) FILTER (WHERE flashscore_id IS NOT NULL) AS mapped,
  COUNT(*) AS total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE flashscore_id IS NOT NULL) / NULLIF(COUNT(*),0), 1) AS pct
FROM events WHERE source IN ('kambi','22bet','betfair')
  AND status IN ('prematch','live') AND starts_at > NOW()
GROUP BY source ORDER BY pct DESC;

-- Market_type distribution (feeds Phase 2 rule design)
SELECT m.market_type, COUNT(*)
FROM markets m JOIN events e ON e.id=m.event_id
WHERE e.source='betfair'
GROUP BY m.market_type ORDER BY 2 DESC LIMIT 30;
EOF
```

- [ ] **Step 3: Check log for error patterns**

```bash
ssh scraper-vps "grep -c ERROR /var/log/betfair-scraper.log; tail -100 /var/log/betfair-scraper.log | grep ERROR | head"
```
Success criteria:
- <1% cycles produce errors (ERROR count ÷ cycle count since start)
- No 403 or 429 cronic pattern (occasional is OK)
- LIVE cycles finish in <60s average
- PREMATCH cycles finish in <300s average

If failing: investigate proxy rotation, allocate more AT IPs, or add fallback UK/DE pool entries to `.env`.

- [ ] **Step 4: Decision gate**

If Phase 1 succeeds, proceed to Task 10 (Phase 2 normalization rules). If Phase 1 reveals structural problems (e.g., zero events for all sports → proxies not truly AT, or endpoint wrong), pause and escalate before proceeding.

---

## Task 10: Betfair market_type normalization rules + outcome dict

**Files (corrected to match real repo structure — no `rules/` subdir exists):**
- Create: `C:\Users\philp\Downloads\betssolution\betssolution-admin\lib\normalize\regex-patterns-betfair.ts`
- Create: `C:\Users\philp\Downloads\betssolution\betssolution-admin\lib\normalize\regex-patterns-betfair.test.ts`
- Modify: `C:\Users\philp\Downloads\betssolution\betssolution-admin\lib\normalize\regex-patterns.ts` (import + concat Betfair rules)
- Create: `C:\Users\philp\Downloads\betssolution\betssolution-admin\supabase\migrations\090_betfair_outcome_dict_seed.sql`

**Real structure verified:** `lib/normalize/` is flat with `regex-patterns.ts`, `dictionary.ts`, `trigram.ts`, `propagation.ts`, `engine.ts`, `llm.ts`, `period.ts`, `types.ts`. There is NO `rules/` subdirectory. The engine loads all regex rules from `regex-patterns.ts` which exports a `RULES` array of `{ base_key, pattern, linePos?, periodPos? }` entries. First match wins. Period normalization is handled separately by `normalizePeriod()`.

- [ ] **Step 1: Inspect rule shape in regex-patterns.ts**

```bash
head -60 /c/Users/philp/Downloads/betssolution/betssolution-admin/lib/normalize/regex-patterns.ts
```

Confirm the exported shape is `{ base_key: string, pattern: RegExp, linePos?: number, periodPos?: number }`. Our Betfair rules must conform to the same shape so the engine's downstream `base_key + period + line` canonical-key construction works identically for Betfair as for Kambi/22bet.

Since Betfair strings (e.g. `MATCH_ODDS`, `OVER_UNDER_25`, `FIRST_HALF_GOALS_15`) have the period implicit in the key name rather than as a captured segment, we encode the period directly into the `base_key` + `periodPos=undefined`, OR use a fake capture group. Simpler: create a new export specifically for Betfair that the engine's runner can distinguish (or inline into the shared array and rely on the first-match-wins ordering).

- [ ] **Step 2: Write failing tests**

Create `lib/normalize/regex-patterns-betfair.test.ts`. Since Betfair keys have the period baked into the key name (MATCH_ODDS = FT by convention, HALF_TIME = HT, FIRST_HALF_GOALS_25 = HT), we encode period directly in `base_key` and leverage the engine's existing base_key + line combinator. Period "ft" produces canonical `1x2_h_ft`, period "ht" produces `1x2_h_ht`.

```ts
import { describe, it, expect } from 'vitest';
import { betfairRules } from './regex-patterns-betfair';
import { normalizePeriod } from './period';

function applyFirstMatch(input: string): { base_key: string | null; line: string | null; period: string | null } {
  for (const rule of betfairRules) {
    const m = input.match(rule.pattern);
    if (m) {
      const line = rule.linePos ? (m[rule.linePos] ?? null) : null;
      const period = rule.periodPos ? (m[rule.periodPos] ?? null) : null;
      return { base_key: rule.base_key, line, period };
    }
  }
  return { base_key: null, line: null, period: null };
}

describe('betfairRules — base_key mapping', () => {
  it.each([
    ['MATCH_ODDS',                '1x2_h_ft'],
    ['HALF_TIME',                 '1x2_h_ht'],
    ['FIRST_HALF_RESULT',         '1x2_h_ht'],
    ['HALF_TIME_FULL_TIME',       'htft_ft'],
    ['DOUBLE_CHANCE',             'dc_ft'],
    ['DRAW_NO_BET',               'dnb_ft'],
    ['BOTH_TEAMS_TO_SCORE',       'gg_ng_ft'],
    ['CORRECT_SCORE',             'correct_score_ft'],
    ['TOTAL_GOALS',               'total_goals_ft'],
    ['ODD_OR_EVEN',               'odd_even_ft'],
    ['CLEAN_SHEET',               'clean_sheet_ft'],
    ['WIN_TO_NIL',                'win_to_nil_ft'],
    ['HIGHEST_SCORING_HALF',      'highest_scoring_half_ft'],
    ['TO_SCORE',                  'anytime_scorer_ft'],
    ['GOAL_IN_BOTH_HALVES',       'goal_both_halves_ft'],
    ['NEXT_GOAL',                 'next_goal'],
    ['ASIAN_HANDICAP',            'asian_handicap_ft'],
    ['HANDICAP',                  '1x2_handicap_ft'],
  ])('maps base_key %s to %s', (input, expected) => {
    expect(applyFirstMatch(input).base_key).toBe(expected);
  });
});

describe('betfairRules — parametric line capture for OVER_UNDER_*', () => {
  it.each([
    ['OVER_UNDER_05', 'u_o_ft', '0.5'],
    ['OVER_UNDER_15', 'u_o_ft', '1.5'],
    ['OVER_UNDER_25', 'u_o_ft', '2.5'],
    ['OVER_UNDER_35', 'u_o_ft', '3.5'],
    ['OVER_UNDER_45', 'u_o_ft', '4.5'],
    ['OVER_UNDER_55', 'u_o_ft', '5.5'],
    ['FIRST_HALF_GOALS_05', 'u_o_ht', '0.5'],
    ['FIRST_HALF_GOALS_15', 'u_o_ht', '1.5'],
    ['FIRST_HALF_GOALS_25', 'u_o_ht', '2.5'],
  ])('extracts line %s from %s as base_key %s', (input, expectedBase, expectedLine) => {
    const r = applyFirstMatch(input);
    expect(r.base_key).toBe(expectedBase);
    expect(r.line).toBe(expectedLine);
  });
});

describe('betfairRules — negative', () => {
  it('does not match garbage', () => {
    expect(applyFirstMatch('RANDOM_UNKNOWN_KEY').base_key).toBeNull();
  });
  it('does not match Kambi Italian strings (Betfair rules are UPPERCASE-English only)', () => {
    expect(applyFirstMatch('1X2').base_key).toBeNull();
    expect(applyFirstMatch('U/O 2.5').base_key).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify failure**

```bash
cd /c/Users/philp/Downloads/betssolution/betssolution-admin
npx vitest run lib/normalize/regex-patterns-betfair.test.ts
```
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement `regex-patterns-betfair.ts`**

Match the existing `regex-patterns.ts` rule shape. Betfair strings have period implicit in the key name, so we bake the period directly into `base_key` (e.g. `u_o_ft` vs `u_o_ht`) and use `linePos`/`periodPos` only where Betfair provides parametric lines:

```ts
// Rule shape matches regex-patterns.ts (base_key / pattern / linePos / periodPos).
// Betfair strings are UPPERCASE English constants; period is implicit in the key name,
// so we bake period directly into base_key rather than capturing it.
export const betfairRules: Array<{
  base_key: string;
  pattern: RegExp;
  linePos?: number;
  periodPos?: number;
}> = [
  // 1X2 full-time and half-time
  { base_key: '1x2_h_ft',    pattern: /^MATCH_ODDS$/ },
  { base_key: '1x2_h_ht',    pattern: /^HALF_TIME$/ },
  { base_key: '1x2_h_ht',    pattern: /^FIRST_HALF_RESULT$/ },
  { base_key: 'htft_ft',     pattern: /^HALF_TIME_FULL_TIME$/ },

  // Chance markets
  { base_key: 'dc_ft',       pattern: /^DOUBLE_CHANCE$/ },
  { base_key: 'dnb_ft',      pattern: /^DRAW_NO_BET$/ },
  { base_key: 'gg_ng_ft',    pattern: /^BOTH_TEAMS_TO_SCORE$/ },

  // Over/Under — parametric. Encoding "0.5" / "1.5" / ... / "5.5" as capture group.
  { base_key: 'u_o_ft',      pattern: /^OVER_UNDER_(\d)(\d)$/,        linePos: 0 /* special: combine groups */ },
  { base_key: 'u_o_ht',      pattern: /^FIRST_HALF_GOALS_(\d)(\d)$/,  linePos: 0 },

  // Goals / scoring markets
  { base_key: 'correct_score_ft',        pattern: /^CORRECT_SCORE$/ },
  { base_key: 'total_goals_ft',          pattern: /^TOTAL_GOALS$/ },
  { base_key: 'odd_even_ft',             pattern: /^ODD_OR_EVEN$/ },
  { base_key: 'clean_sheet_ft',          pattern: /^CLEAN_SHEET$/ },
  { base_key: 'win_to_nil_ft',           pattern: /^WIN_TO_NIL$/ },
  { base_key: 'highest_scoring_half_ft', pattern: /^HIGHEST_SCORING_HALF$/ },
  { base_key: 'anytime_scorer_ft',       pattern: /^TO_SCORE$/ },
  { base_key: 'goal_both_halves_ft',     pattern: /^GOAL_IN_BOTH_HALVES$/ },
  { base_key: 'next_goal',               pattern: /^NEXT_GOAL$/ },

  // Handicap
  { base_key: 'asian_handicap_ft',       pattern: /^ASIAN_HANDICAP$/ },
  { base_key: '1x2_handicap_ft',         pattern: /^HANDICAP$/ },
];
```

**Note on the `linePos` special case**: the OVER_UNDER rule captures two groups (e.g. "2" and "5" for "OVER_UNDER_25") that must be combined into "2.5". The engine's current runner expects `linePos` to point at a single capture. If the engine doesn't support combining, add a tiny preprocessor step in `regex-patterns.ts` that transforms `OVER_UNDER_<N><M>` → `OVER_UNDER_<N>.<M>` before matching, OR expand the rule to one-per-line-value:

```ts
// Alternative expansion (safer — one rule per line)
{ base_key: 'u_o_ft', pattern: /^OVER_UNDER_05$/, /* line injected via special marker, or hardcode into a separate "line" field */ },
{ base_key: 'u_o_ft', pattern: /^OVER_UNDER_15$/ },
// ... etc
```

Ask in Step 1 inspection whether the engine has a `line` field on rules (or `extract_line()` SQL helper used by `upsert_prematch_batch` — which does `v_market_line := extract_line(v_market ->> 'type')`). The RPC extracts the line automatically from the market_type string via `extract_line()` so we can keep passing the raw `OVER_UNDER_25` through without splitting and let the server derive the line. Verify `extract_line('OVER_UNDER_25')` returns 2.5 or equivalent:
```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -c \"SELECT extract_line('OVER_UNDER_25'), extract_line('OVER_UNDER_15');\""
```
If `extract_line` does NOT recognize the Betfair format, the plan must either:
(a) Extend `extract_line()` SQL function to parse `OVER_UNDER_<NN>` patterns, OR
(b) Transform the market_type client-side before sending (e.g. `OVER_UNDER_25` → `U/O 2.5`).
Decide based on Step 1 inspection and update this step accordingly.

- [ ] **Step 5: Register with engine (import into main regex-patterns.ts)**

Open `lib/normalize/regex-patterns.ts`. The file exports a flat `RULES` array. Append the Betfair rules by importing and concatenating:

```ts
// at top of file, after existing imports
import { betfairRules } from './regex-patterns-betfair';

// after the existing RULES array is defined, immediately append:
RULES.push(...betfairRules);

// OR if RULES is declared with `const RULES = [ ... ]`:
// Change to `let RULES: Array<{...}> = [ ... ]` and then `RULES = [...RULES, ...betfairRules]`
// (Exact pattern depends on how RULES is exported; adapt to existing idiom.)
```

If the engine code reads `RULES` by reference (checked in `engine.ts` in Step 1), append works. If it was already destructured, export `betfairRules` separately and have the engine merge at load time.

- [ ] **Step 6: Run test to verify passes**

```bash
npx vitest run lib/normalize/regex-patterns-betfair.test.ts --reporter=verbose
```
Expected: all test cases pass.

Also run the existing regex-patterns test suite to ensure nothing regressed:
```bash
npx vitest run lib/normalize/
```
Expected: all existing Kambi/22bet tests still pass (no cross-pollination).

- [ ] **Step 7: Write outcome dict seed migration**

Create `supabase/migrations/090_betfair_outcome_dict_seed.sql`:

```sql
BEGIN;

-- Betfair outcome names are clean English constants. Seed ~50 entries
-- for core markets so outcome_normalization cron can pick them up.
INSERT INTO outcome_normalization
  (source, source_market_type, source_outcome_name, canonical_key, canonical_outcome_key, extracted_by, verified, confidence)
VALUES
  -- MATCH_ODDS (1x2_h_ft)
  ('betfair','MATCH_ODDS','Home',     '1x2_h_ft', '1x2_h_ft_home', 'manual', true, 100),
  ('betfair','MATCH_ODDS','The Draw', '1x2_h_ft', '1x2_h_ft_draw', 'manual', true, 100),
  ('betfair','MATCH_ODDS','Away',     '1x2_h_ft', '1x2_h_ft_away', 'manual', true, 100),
  -- Note: Betfair actually sends team names as runner names, not "Home"/"Away".
  -- Real normalization therefore uses trigram+event match. These seed entries catch
  -- the rare placeholder cases and provide structure for the engine to learn from.

  -- BOTH_TEAMS_TO_SCORE
  ('betfair','BOTH_TEAMS_TO_SCORE','Yes', 'gg_ng_ft', 'gg_ng_ft_yes', 'manual', true, 100),
  ('betfair','BOTH_TEAMS_TO_SCORE','No',  'gg_ng_ft', 'gg_ng_ft_no',  'manual', true, 100),

  -- DOUBLE_CHANCE
  ('betfair','DOUBLE_CHANCE','Home or Draw', 'dc_ft', 'dc_ft_1x', 'manual', true, 100),
  ('betfair','DOUBLE_CHANCE','Home or Away', 'dc_ft', 'dc_ft_12', 'manual', true, 100),
  ('betfair','DOUBLE_CHANCE','Draw or Away', 'dc_ft', 'dc_ft_x2', 'manual', true, 100),

  -- DRAW_NO_BET
  ('betfair','DRAW_NO_BET','Home', 'dnb_ft', 'dnb_ft_home', 'manual', true, 100),
  ('betfair','DRAW_NO_BET','Away', 'dnb_ft', 'dnb_ft_away', 'manual', true, 100),

  -- OVER_UNDER_* — all variants use same outcome names
  ('betfair','OVER_UNDER_05','Over 0.5', 'u_o_ft_0.5', 'u_o_ft_0.5_over',  'manual', true, 100),
  ('betfair','OVER_UNDER_05','Under 0.5','u_o_ft_0.5', 'u_o_ft_0.5_under', 'manual', true, 100),
  ('betfair','OVER_UNDER_15','Over 1.5', 'u_o_ft_1.5', 'u_o_ft_1.5_over',  'manual', true, 100),
  ('betfair','OVER_UNDER_15','Under 1.5','u_o_ft_1.5', 'u_o_ft_1.5_under', 'manual', true, 100),
  ('betfair','OVER_UNDER_25','Over 2.5', 'u_o_ft_2.5', 'u_o_ft_2.5_over',  'manual', true, 100),
  ('betfair','OVER_UNDER_25','Under 2.5','u_o_ft_2.5', 'u_o_ft_2.5_under', 'manual', true, 100),
  ('betfair','OVER_UNDER_35','Over 3.5', 'u_o_ft_3.5', 'u_o_ft_3.5_over',  'manual', true, 100),
  ('betfair','OVER_UNDER_35','Under 3.5','u_o_ft_3.5', 'u_o_ft_3.5_under', 'manual', true, 100),
  ('betfair','OVER_UNDER_45','Over 4.5', 'u_o_ft_4.5', 'u_o_ft_4.5_over',  'manual', true, 100),
  ('betfair','OVER_UNDER_45','Under 4.5','u_o_ft_4.5', 'u_o_ft_4.5_under', 'manual', true, 100),
  ('betfair','OVER_UNDER_55','Over 5.5', 'u_o_ft_5.5', 'u_o_ft_5.5_over',  'manual', true, 100),
  ('betfair','OVER_UNDER_55','Under 5.5','u_o_ft_5.5', 'u_o_ft_5.5_under', 'manual', true, 100),

  -- FIRST_HALF_GOALS
  ('betfair','FIRST_HALF_GOALS_05','Over 0.5', 'u_o_ht_0.5', 'u_o_ht_0.5_over',  'manual', true, 100),
  ('betfair','FIRST_HALF_GOALS_05','Under 0.5','u_o_ht_0.5', 'u_o_ht_0.5_under', 'manual', true, 100),
  ('betfair','FIRST_HALF_GOALS_15','Over 1.5', 'u_o_ht_1.5', 'u_o_ht_1.5_over',  'manual', true, 100),
  ('betfair','FIRST_HALF_GOALS_15','Under 1.5','u_o_ht_1.5', 'u_o_ht_1.5_under', 'manual', true, 100),
  ('betfair','FIRST_HALF_GOALS_25','Over 2.5', 'u_o_ht_2.5', 'u_o_ht_2.5_over',  'manual', true, 100),
  ('betfair','FIRST_HALF_GOALS_25','Under 2.5','u_o_ht_2.5', 'u_o_ht_2.5_under', 'manual', true, 100),

  -- ODD_OR_EVEN
  ('betfair','ODD_OR_EVEN','Odd',  'odd_even_ft', 'odd_even_ft_odd',  'manual', true, 100),
  ('betfair','ODD_OR_EVEN','Even', 'odd_even_ft', 'odd_even_ft_even', 'manual', true, 100)
ON CONFLICT (source, source_market_type, source_outcome_name) DO UPDATE SET
  canonical_key        = EXCLUDED.canonical_key,
  canonical_outcome_key = EXCLUDED.canonical_outcome_key,
  verified             = EXCLUDED.verified,
  confidence           = EXCLUDED.confidence,
  extracted_by         = EXCLUDED.extracted_by,
  updated_at           = NOW();

COMMIT;
```

(HALF_TIME outcome seeds follow same pattern if needed — but those use team names, which live-normalization resolves per-event.)

- [ ] **Step 8: Apply seed to staging then prod**

```bash
ssh scraper-vps "PGPASSWORD='Veronihina2020@' psql -h db.bnabvfalytivjsrwqydo.supabase.co -U postgres -d postgres -f -" \
  < /c/Users/philp/Downloads/betssolution/betssolution-admin/supabase/migrations/090_betfair_outcome_dict_seed.sql

ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -f -" \
  < /c/Users/philp/Downloads/betssolution/betssolution-admin/supabase/migrations/090_betfair_outcome_dict_seed.sql
```

- [ ] **Step 9: Deploy betfair rules to admin prod (so engine cron picks them up)**

Follow the standard admin deploy from CLAUDE.md / memory:
```bash
cd /c/Users/philp/Downloads/betssolution/betssolution-admin
npx next build
tar czf /tmp/next-build.tar.gz .next
tar czf /tmp/x.tar.gz --exclude=node_modules --exclude=.next --exclude=.git .
scp /tmp/next-build.tar.gz /tmp/x.tar.gz scraper-vps:/tmp/
ssh scraper-vps "systemctl stop betssolution-admin && cd /root/betssolution-admin && cp .env.local /tmp/admin-env-backup && rm -rf .next && tar xzf /tmp/x.tar.gz && cp /tmp/admin-env-backup .env.local && tar xzf /tmp/next-build.tar.gz && systemctl start betssolution-admin"
```

- [ ] **Step 10: Verify coverage within 2 hours**

```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -c \"
  SELECT
    mn.source,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE mn.canonical_key IS NOT NULL) AS mapped,
    COUNT(*) FILTER (WHERE mn.verified) AS verified,
    ROUND(100.0 * COUNT(*) FILTER (WHERE mn.verified) / NULLIF(COUNT(*),0), 1) AS pct_verified
  FROM market_normalization mn WHERE mn.source='betfair' GROUP BY mn.source;
  
  SELECT canonical_key, COUNT(*)
  FROM market_normalization WHERE source='betfair' AND canonical_key IS NOT NULL
  GROUP BY canonical_key ORDER BY 2 DESC LIMIT 20;\""
```
Success criteria: >85% of core-market rows have `verified=true` within 2h of deployment.

- [ ] **Step 11: Commit**

```bash
cd /c/Users/philp/Downloads/betssolution/betssolution-admin
git add lib/normalize/regex-patterns-betfair.ts lib/normalize/regex-patterns-betfair.test.ts lib/normalize/regex-patterns.ts supabase/migrations/090_betfair_outcome_dict_seed.sql
git commit -m "feat(normalize): Betfair market rules + outcome dict seed (mig 090)"
```

---

## Task 11: Player frontend — shade-enabled hook

**Files:**
- Modify: `C:\Users\philp\Downloads\betssolution\betssolution-player\lib\hooks\use-event.ts` (or equivalent — discover exact name first)
- Create: `C:\Users\philp\Downloads\betssolution\betssolution-player\lib\hooks\use-shade-flag.ts`

- [ ] **Step 1: Discover the current outcomes read path in player**

```bash
cd /c/Users/philp/Downloads/betssolution/betssolution-player
ls lib/hooks/
grep -rn "outcomes" lib/hooks/ --include="*.ts" | head -20
grep -rn "\.odds" lib/hooks/ --include="*.ts" | head -20
```

Identify the single hook responsible for outcome rendering (expected: `use-event.ts` or `use-sportsbook.ts`). Read it in full before editing.

- [ ] **Step 2: Write `use-shade-flag.ts`**

```ts
'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

let cached: { value: boolean; fetchedAt: number } | null = null;
const CACHE_MS = 30_000;

export function useShadeFlag(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => cached?.value ?? false);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      if (cached && Date.now() - cached.fetchedAt < CACHE_MS) {
        setEnabled(cached.value);
        return;
      }
      const supa = createClient();
      const { data } = await supa
        .from('system_config')
        .select('value')
        .eq('key', 'shade_enabled')
        .maybeSingle();
      const v = data?.value === true || data?.value === 'true';
      if (!cancelled) {
        cached = { value: v, fetchedAt: Date.now() };
        setEnabled(v);
      }
    }
    refresh();
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVis);
    const iv = setInterval(refresh, CACHE_MS);
    return () => { cancelled = true; clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  return enabled;
}
```

- [ ] **Step 3: Modify the outcomes hook**

The goal: each outcome returned by the hook gains a computed `displayOdds` field, `displayOdds = shade_enabled ? viewRow.displayed_odds : rawOutcome.odds`. Because `v_outcomes_displayed` joins by canonical keys (flashscore_id + canonical_key + canonical_outcome_key) NOT by `outcomes.id`, the hook needs to:

1. Fetch raw outcomes from `outcomes` (as today)
2. If flag is ON: also fetch `v_outcomes_displayed` for the same `flashscore_id` and merge by walking the raw outcomes' market_type + outcome name → canonical keys via the same normalization tables
3. If a raw outcome has no canonical match (uncanonicalized), fall back to `rawOutcome.odds`

For MVP we simplify by piggy-backing the canonicalization lookup in the same query server-side. Prefer an RPC to avoid a double-trip:

Create RPC in migration 091 (see Task 12) OR inline a two-query pattern. For the plan, use inline — simpler, no additional migration dependency:

```ts
// in use-event.ts (or wherever outcomes are loaded)
const supa = createClient();
const shadeEnabled = useShadeFlag();

// fetch primary outcomes as today
const { data: outcomes } = await supa
  .from('outcomes')
  .select('id, market_id, name, odds, is_active, is_suspended, manual_odds, manual_suspended, markets!inner(id, event_id, market_type, events!inner(id, flashscore_id, source))')
  .eq('markets.events.id', eventId)
  .eq('is_active', true);

// if shadeEnabled AND event has flashscore_id, fetch pivoted shade view
let shadeMap = new Map<string, number>(); // key = `${market_type}::${outcome_name}`
if (shadeEnabled && outcomes?.[0]?.markets?.events?.flashscore_id) {
  const flashscoreId = outcomes[0].markets.events.flashscore_id;
  const { data: shadeRows } = await supa
    .from('v_outcomes_displayed')
    .select('market_canonical_key, canonical_outcome_key, displayed_odds')
    .eq('flashscore_id', flashscoreId);
  // NOTE: we need a way to join back. Two options:
  //  (a) Extend v_outcomes_displayed to include primary_market_type + primary_outcome_name from the primary source (the ARRAY_AGG already picks kambi first)
  //  (b) Do a secondary lookup by primary_outcome_id (already in view) and match to outcomes.id
  // Prefer (b) for clarity.
}

// After fetching:
return outcomes?.map(oc => ({
  ...oc,
  displayOdds: shadeEnabled
    ? (shadeMap.get(oc.id) ?? oc.odds)  // fallback to raw if not shade-eligible
    : oc.odds,
  isBettable: oc.is_active && !oc.is_suspended && !oc.manual_suspended && (oc.manual_odds ?? oc.odds) > 1,
}));
```

**Important ergonomic fix**: to keep join logic client-side simple, modify `v_outcomes_displayed` in migration 089 to expose `primary_outcome_id` (already included in the spec). Then client joins by `outcomes.id = v_outcomes_displayed.primary_outcome_id`:

```ts
if (shadeEnabled && flashscoreId) {
  const { data: shadeRows } = await supa
    .from('v_outcomes_displayed')
    .select('primary_outcome_id, displayed_odds')
    .eq('flashscore_id', flashscoreId);
  shadeMap = new Map(shadeRows?.map(r => [r.primary_outcome_id, Number(r.displayed_odds)]) ?? []);
}
```

- [ ] **Step 4: Update the UI consumer**

Find the component that renders outcome buttons. It currently reads `outcome.odds`. Change to:
```tsx
<button disabled={!outcome.isBettable}>
  {outcome.displayOdds?.toFixed(2) ?? '—'}
</button>
```

- [ ] **Step 5: Verify locally**

```bash
cd /c/Users/philp/Downloads/betssolution/betssolution-player
npm run dev  # typically port 3001 per memory
# Open http://localhost:3001, navigate to a live event
# Toggle system_config.shade_enabled via direct SQL:
ssh scraper-vps "PGPASSWORD='Veronihina2020@' psql -h db.bnabvfalytivjsrwqydo.supabase.co -U postgres -d postgres -c \"UPDATE system_config SET value='true'::jsonb WHERE key='shade_enabled';\""
# Wait 30s, refresh browser — quotes should update to min-of-sources where canonicalized
# Flip back to false and confirm original behavior
ssh scraper-vps "PGPASSWORD='Veronihina2020@' psql -h db.bnabvfalytivjsrwqydo.supabase.co -U postgres -d postgres -c \"UPDATE system_config SET value='false'::jsonb WHERE key='shade_enabled';\""
```

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add lib/hooks/
git commit -m "feat(player): shade-enabled outcomes hook

Reads system_config.shade_enabled at runtime (30s cache). When true,
merges v_outcomes_displayed.displayed_odds via primary_outcome_id
join. Falls back to raw outcomes.odds when flag off or outcome
is not canonicalized.

Flag flip via SQL UPDATE propagates to all kiosks within 30s
without rebuild."
```

---

## Task 12: Deploy player + flip shade on staging (Phase 3 → 4 staging)

**Files:** none (deployment work)

**Pre-req reading**: the staging environment is documented in MEMORY at `C:\Users\philp\.claude\projects\C--Users-philp\memory\betssolution-staging-cicd.md`. Read that file before executing Task 12 — it describes the auto-deploy pipeline (GH Actions on push to `master` auto-deploys to `staging.betssolution.com`) and the manual-deploy procedure (scp+systemd on staging host).

Key facts expected from that memory:
- Staging player URL: `https://staging.betssolution.com` (port 3001)
- Staging DB: `db.bnabvfalytivjsrwqydo.supabase.co`
- Staging host: a Hetzner cx23 box distinct from scraper-vps

If CI/CD auto-deploys on push to master, Task 11's player changes will already be on staging once committed. In that case Task 12 Step 1 becomes a verification-only step. If manual deploy is required, adapt the commands below to the actual staging SSH alias documented in the memory file.

- [ ] **Step 0: Read the staging memory file**

```bash
cat /c/Users/philp/.claude/projects/C--Users-philp/memory/betssolution-staging-cicd.md
```
Capture: the SSH alias for staging (expected `staging-vps` per pattern, but verify), the systemd unit name, and the deploy procedure. Update the commands below to match.

- [ ] **Step 1: Deploy player to staging**

If CI/CD active: `git push origin master` for the player repo → GH Actions auto-deploys. Poll https://staging.betssolution.com for the new build (≤5 min).

If manual deploy per memory instructions:
```bash
cd /c/Users/philp/Downloads/betssolution/betssolution-player
npx next build
tar czf /tmp/player-build.tar.gz .next
tar czf /tmp/player-src.tar.gz --exclude=node_modules --exclude=.next --exclude=.git .
scp /tmp/player-build.tar.gz /tmp/player-src.tar.gz <staging-alias>:/tmp/
ssh <staging-alias> "systemctl stop <staging-unit-name> && cd <staging-path> && rm -rf .next && tar xzf /tmp/player-src.tar.gz && tar xzf /tmp/player-build.tar.gz && systemctl start <staging-unit-name>"
```
(Fill in `<staging-alias>`, `<staging-unit-name>`, `<staging-path>` from the memory file.)

- [ ] **Step 2: Verify staging with flag still OFF**

Open staging kiosk URL, confirm quotes render exactly as before (same as Kambi primary). Flag is OFF by default.

- [ ] **Step 3: Flip shade ON in staging DB**

```bash
ssh scraper-vps "PGPASSWORD='Veronihina2020@' psql -h db.bnabvfalytivjsrwqydo.supabase.co -U postgres -d postgres -c \"UPDATE system_config SET value='true'::jsonb WHERE key='shade_enabled';\""
```

- [ ] **Step 4: Observe staging for 60 seconds**

- Kiosk should show different (lower) quotes on outcomes where 22bet and/or Betfair diverge by >25%
- If flag activation breaks UI or introduces NULL odds on previously-bettable outcomes → flip back immediately:
  ```bash
  ssh scraper-vps "PGPASSWORD='Veronihina2020@' psql -h db.bnabvfalytivjsrwqydo.supabase.co -U postgres -d postgres -c \"UPDATE system_config SET value='false'::jsonb WHERE key='shade_enabled';\""
  ```

- [ ] **Step 5: Leave staging ON for 24h observation**

Metrics to collect during 24h window:
- Rate of NULL `displayed_odds` on canonical outcomes (should be ~0 — if not, investigate)
- Distribution of shade vs intact
- Kiosk log sanity (no crash, no surge in manual_override create rate)

- [ ] **Step 6: Proceed to Task 13 only if staging 24h is clean**

---

## Task 13: Deploy player to prod + flip shade ON + decommission auto-suspend

**Files:** none (deploy + crontab edit)

- [ ] **Step 1: Deploy player to prod with flag still OFF in prod DB**

```bash
cd /c/Users/philp/Downloads/betssolution/betssolution-player
# Build already present from Task 12
scp /tmp/player-build.tar.gz /tmp/player-src.tar.gz scraper-vps:/tmp/
ssh scraper-vps "systemctl stop betssolution-player && cd /root/betssolution-player && rm -rf .next && tar xzf /tmp/player-src.tar.gz && tar xzf /tmp/player-build.tar.gz && systemctl start betssolution-player"
```

- [ ] **Step 2: Verify prod flag is OFF and kiosk works normally**

```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -c \"SELECT value FROM system_config WHERE key='shade_enabled';\""
# Expected: false
```
Open play.betssolution.com kiosk, confirm quotes identical to pre-deploy. Leave running for 30 minutes of sanity before flipping.

- [ ] **Step 3: Disable auto-suspend cron (do BEFORE shade flip)**

Rationale: if auto-suspend and shade both run simultaneously, we'd double-guard. Disabling auto-suspend first means the system reverts to "no automatic protection" for ~1 minute, then shade activates.

```bash
ssh scraper-vps "crontab -l > /tmp/crontab-backup-$(date +%Y%m%d).txt"
ssh scraper-vps "crontab -l | sed '/auto_suspend_consensus_outliers/s/^/# DISABLED 2026-04-22 (shade-to-min) /' | crontab -"
ssh scraper-vps "crontab -l | grep -i auto_suspend"
# Expected: line is now commented
```
Keep the `cleanup_expired_manual_overrides` cron active — still useful for operator manual expiry.

- [ ] **Step 4: Flip shade ON in prod**

```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -c \"UPDATE system_config SET value='true'::jsonb WHERE key='shade_enabled';\""
```

- [ ] **Step 5: Observe prod for 15 minutes**

- Open kiosk, verify button rendering unchanged structurally (just different numbers)
- `tail -f /var/log/betssolution-player.log` (or equivalent) looking for errors
- Spot-check `/admin/consensus` page — outlier count should stabilize or drop (since shade now handles them without mutating manual_suspended)

- [ ] **Step 6: Rollback trigger (if problems detected)**

Have this command ready, do not execute unless problems seen:
```bash
# EMERGENCY ROLLBACK
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -c \"UPDATE system_config SET value='false'::jsonb WHERE key='shade_enabled';\""
ssh scraper-vps "crontab -l | sed 's/^# DISABLED 2026-04-22 (shade-to-min) //' | crontab -"
```
Propagation ≤60s.

- [ ] **Step 7: Save session notes to project memory**

Update `C:\Users\philp\.claude\projects\C--Users-philp\memory\MEMORY.md` with a line pointing to a new session memory file documenting the cutover. Content template:
```
## Shade-to-Min Cutover (YYYY-MM-DD)
- [Shade Cutover](shade-cutover-YYYY-MM-DD.md) — replaced auto_suspend cron with read-time shade-to-min view, activated on prod, 22bet/Kambi/Betfair three-source consensus live
```

Save the detailed memory per the memory section of the system prompt.

- [ ] **Step 8: Commit observability changes (crontab backup)**

Nothing code-committable on scraper-vps (crontab not in git). Add a note to session memory or a reference file on scraper-vps if desired.

---

## Task 14: `/admin/shade-monitor` page (post-rollout observability)

**Files:**
- Create: `C:\Users\philp\Downloads\betssolution\betssolution-admin\app\admin\shade-monitor\page.tsx`
- Modify: `C:\Users\philp\Downloads\betssolution\betssolution-admin\app\admin\layout.tsx` (add sidebar link)

- [ ] **Step 1: Write page component**

Create `app/admin/shade-monitor/page.tsx` as a server component:
```tsx
import { createAdminClient } from '@/lib/supabase/server';

interface Kpi { label: string; value: string; }

export default async function ShadeMonitorPage() {
  const supa = createAdminClient();

  // KPI 1: % rows where shade is firing (displayed_odds != primary_odds)
  const { data: kpiData } = await supa.rpc('shade_monitor_kpis');
  // shade_monitor_kpis RPC: see Step 2 (to be created in mig 091)

  // Top 20 canonical markets by shade frequency
  const { data: topMarkets } = await supa.rpc('shade_monitor_top_markets', { p_limit: 20 });

  // Spread distribution histogram
  const { data: spread } = await supa.rpc('shade_monitor_spread_histogram');

  return (
    <div className="p-6 space-y-8">
      <h1 className="text-2xl font-bold">Shade Monitor</h1>

      <section className="grid grid-cols-4 gap-4">
        {(kpiData as Kpi[] ?? []).map(k => (
          <div key={k.label} className="border rounded p-4">
            <div className="text-sm text-gray-500">{k.label}</div>
            <div className="text-2xl font-mono">{k.value}</div>
          </div>
        ))}
      </section>

      <section>
        <h2 className="text-lg font-semibold">Top 20 canonical markets shaded</h2>
        <table className="w-full text-sm">
          <thead><tr><th>Sport</th><th>Market</th><th>Outcome</th><th>Shade count 24h</th></tr></thead>
          <tbody>
            {(topMarkets as any[] ?? []).map((r, i) => (
              <tr key={i}><td>{r.sport}</td><td>{r.market_canonical_key}</td><td>{r.canonical_outcome_key}</td><td>{r.shade_count}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Spread histogram (pre-shade)</h2>
        <table className="w-full text-sm">
          <thead><tr><th>Bucket</th><th>Count</th></tr></thead>
          <tbody>
            {(spread as any[] ?? []).map((r, i) => (
              <tr key={i}><td>{r.bucket}</td><td>{r.count}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Create RPC helpers in migration 091**

```sql
-- supabase/migrations/091_shade_monitor_rpcs.sql
BEGIN;

CREATE OR REPLACE FUNCTION shade_monitor_kpis()
RETURNS TABLE(label text, value text)
LANGUAGE sql STABLE AS $$
  WITH latest AS (
    SELECT displayed_odds, kambi_odds, twobet_odds, betfair_odds, canonical_verified
    FROM v_outcomes_displayed
  )
  SELECT 'Total canonical outcomes', COUNT(*)::text FROM latest
  UNION ALL
  SELECT 'Shade active (displayed != primary)',
    COUNT(*) FILTER (WHERE canonical_verified AND displayed_odds IS DISTINCT FROM COALESCE(kambi_odds, twobet_odds, betfair_odds))::text FROM latest
  UNION ALL
  SELECT 'Single-source fallback count',
    COUNT(*) FILTER (WHERE canonical_verified AND (
      (kambi_odds IS NOT NULL)::int + (twobet_odds IS NOT NULL)::int + (betfair_odds IS NOT NULL)::int = 1
    ))::text FROM latest
  UNION ALL
  SELECT 'Unverified canonicalizations',
    COUNT(*) FILTER (WHERE NOT canonical_verified)::text FROM latest;
$$;

CREATE OR REPLACE FUNCTION shade_monitor_top_markets(p_limit int DEFAULT 20)
RETURNS TABLE(sport text, market_canonical_key text, canonical_outcome_key text, shade_count bigint)
LANGUAGE sql STABLE AS $$
  WITH shaded AS (
    SELECT market_canonical_key, canonical_outcome_key, sport_id
    FROM v_outcomes_displayed
    WHERE canonical_verified
      AND displayed_odds IS DISTINCT FROM COALESCE(kambi_odds, twobet_odds, betfair_odds)
  )
  SELECT COALESCE(s.slug, 'unknown'), v.market_canonical_key, v.canonical_outcome_key, COUNT(*)
  FROM shaded v LEFT JOIN sports s ON s.id = v.sport_id
  GROUP BY 1, 2, 3
  ORDER BY 4 DESC LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION shade_monitor_spread_histogram()
RETURNS TABLE(bucket text, count bigint)
LANGUAGE sql STABLE AS $$
  WITH spreads AS (
    SELECT
      GREATEST(kambi_odds, twobet_odds, betfair_odds) / NULLIF(LEAST(kambi_odds, twobet_odds, betfair_odds), 0) - 1 AS s
    FROM v_outcomes_displayed
    WHERE canonical_verified
      AND (kambi_odds IS NOT NULL)::int + (twobet_odds IS NOT NULL)::int + (betfair_odds IS NOT NULL)::int >= 2
  )
  SELECT
    CASE
      WHEN s IS NULL THEN 'n/a'
      WHEN s < 0.05 THEN '0-5%'
      WHEN s < 0.15 THEN '5-15%'
      WHEN s < 0.25 THEN '15-25%'
      WHEN s < 0.50 THEN '25-50%'
      WHEN s < 1.00 THEN '50-100%'
      ELSE '>100%'
    END,
    COUNT(*)
  FROM spreads GROUP BY 1 ORDER BY MIN(s) NULLS FIRST;
$$;

COMMIT;
```

Apply:
```bash
ssh scraper-vps "PGPASSWORD='Veronihina2020@' psql -h db.bnabvfalytivjsrwqydo.supabase.co -U postgres -d postgres -f -" \
  < /c/Users/philp/Downloads/betssolution/betssolution-admin/supabase/migrations/091_shade_monitor_rpcs.sql

ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -f -" \
  < /c/Users/philp/Downloads/betssolution/betssolution-admin/supabase/migrations/091_shade_monitor_rpcs.sql
```

- [ ] **Step 3: Add sidebar entry**

Edit `app/admin/layout.tsx`, add in the NAVIGATION array after "Consensus" and before "Manual Overrides":
```tsx
{ id: 'shade-monitor', label: '🎚️ Shade Monitor', href: '/admin/shade-monitor' },
```
And in the TITLES map:
```tsx
'shade-monitor': 'Shade Monitor',
```

- [ ] **Step 4: Deploy admin**

Same deploy pattern as Task 10 Step 9.

- [ ] **Step 5: Verify page loads**

Visit `https://betssolution.com/admin/shade-monitor` via the SSH tunnel or directly if exposed. Verify all 3 sections render with numbers.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/philp/Downloads/betssolution/betssolution-admin
git add app/admin/shade-monitor/ app/admin/layout.tsx supabase/migrations/091_shade_monitor_rpcs.sql
git commit -m "feat: /admin/shade-monitor page + RPC helpers (mig 091)"
```

---

## Task 15: Wrap-up — update project memory + spec status

**Files:**
- Modify: `C:\Users\philp\Downloads\betssolution\betssolution-admin\docs\superpowers\specs\2026-04-22-shade-to-min-betfair-design.md` (update status line)
- Create: `C:\Users\philp\.claude\projects\C--Users-philp\memory\shade-to-min-betfair-cutover.md`
- Modify: `C:\Users\philp\.claude\projects\C--Users-philp\memory\MEMORY.md` (add entry)

- [ ] **Step 1: Update spec status**

Change line 3 of the spec from `**Status**: Design draft — pending spec-reviewer + user approval` to `**Status**: IMPLEMENTED — see docs/superpowers/plans/2026-04-22-shade-to-min-betfair-plan.md`.

- [ ] **Step 2: Write cutover memory file**

```markdown
---
name: Shade-to-Min + Betfair Cutover
description: Replaced auto_suspend cron with read-time shade-to-min view, added Betfair as third consensus source, deployed prod YYYY-MM-DD
type: project
---
# Shade-to-Min + Betfair cutover

- Mig 089 + 090 + 091 applied staging + prod
- `betfair-scraper` systemd on scraper-vps live since YYYY-MM-DD, cycle times live ~30s prematch ~300s
- `system_config.shade_enabled=true` in prod, flip via SQL propagates in 30s
- `auto_suspend_consensus_outliers` cron disabled in scraper-vps crontab (RPC retained for rollback)
- `/admin/shade-monitor` page live
- Webshare AT proxies: N IPs allocated, fallback UK/DE configured
- Betfair market_normalization coverage: X% verified at 48h
- Player frontend reads `v_outcomes_displayed.displayed_odds` via `useShadeFlag()` hook when flag ON

**Success metrics at 90d**: watch `/admin/shade-monitor` — target 3-8% shade-active rate, `manual_overrides` auto-suspend count at 0, operator count steady-or-declining.
```

- [ ] **Step 3: Update MEMORY.md index**

Add entry at the appropriate section (near other session notes).

- [ ] **Step 4: Commit**

```bash
cd /c/Users/philp/Downloads/betssolution/betssolution-admin
git add docs/superpowers/specs/2026-04-22-shade-to-min-betfair-design.md
git commit -m "docs: mark shade-to-min spec as IMPLEMENTED"
```

---

## Summary

| Task | Phase | Blocking | TDD? |
|------|-------|----------|------|
| 1: Schema audit + proxies | pre-flight | Task 2+ | no |
| 2: Scaffold project | Phase 1 prep | Task 3+ | no |
| 3: Vendor api + config | Phase 1 prep | Task 4+ | no |
| 4: Parser | Phase 1 prep | Task 5+ | ✅ yes |
| 5: Push-to-vincitu | Phase 1 prep | Task 6+ | ✅ yes |
| 6: Loops + orchestrator | Phase 1 prep | Task 8 | no |
| 7: Migration 089 | Phase 3 DB | Task 8+, Task 11+ | partial (verification SQL) |
| 8: Deploy scraper | Phase 1 | Task 9 | no |
| 9: 24h observation | Phase 1 gate | Task 10 | n/a |
| 10: Normalization rules | Phase 2 | Task 11+ | ✅ yes |
| 11: Player frontend | Phase 3 | Task 12 | partial |
| 12: Staging flip | Phase 4 staging | Task 13 | n/a |
| 13: Prod flip + decommission | Phase 4 prod | Task 14, 15 | n/a |
| 14: Shade monitor page | Post-rollout | Task 15 | no |
| 15: Wrap-up memory | Post-rollout | — | n/a |

**Critical ordering invariants:**
- Task 7 (mig 089) must be applied before Task 11 (player hook reads the view)
- Task 10 (normalization) must complete before Task 13 (prod flip) — otherwise shade fires on low verified coverage
- Task 12 (staging 24h) must complete cleanly before Task 13 (prod flip)
- Task 13 Step 3 (disable auto-suspend) must precede Step 4 (flip shade) to avoid double-guarding

**Rollback at any stage:**
- Phases 1-2: `systemctl disable --now betfair-scraper` + nothing else needed
- Phase 3 (mig 089 in place, frontend deployed, flag OFF): rollback = no-op. View is inert while flag OFF.
- Phase 4 partial: `UPDATE system_config SET value='false'::jsonb WHERE key='shade_enabled'` — propagates in ≤60s. Re-enable cron if desired.
- Full rollback: all DB objects are additive, no drops needed.
