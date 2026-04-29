# Ippica Scraper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an HTTP-only horse racing scraper that polls MST Channel API and writes race data, runners, odds, and results directly to Supabase.

**Architecture:** Single TypeScript process with 3 independent polling loops (program discovery 30min, odds update 2min, results+settlement 1min). Writes directly to Supabase via `@supabase/supabase-js`. No Redis, no intermediate API — simpler than Kambi scraper.

**Tech Stack:** TypeScript, tsx (runtime), @supabase/supabase-js, Node.js fetch API

**Spec:** `docs/superpowers/specs/2026-03-21-ippica-scraper-design.md`

**Reference:** `C:\Users\philp\Downloads\kambi-scraper\` — follow same project structure patterns (package.json, tsconfig.json, src/ layout)

---

## File Structure

```
C:\Users\philp\Downloads\ippica-scraper\
├── src/
│   ├── index.ts              # Entry point: init supabase, bootstrap cache, start 3 loops
│   ├── mst-client.ts         # HTTP client: fetchJson, getChannels, getNext, getRace, getLast, proxy failover
│   ├── transform.ts          # MST JSON → DB row format: meetings, races, runners, markets, odds
│   ├── supabase.ts           # Supabase client init + all upsert/query functions
│   ├── program-loop.ts       # Discovery loop: channels + next → meetings + races
│   ├── odds-loop.ts          # Odds loop: race detail → runners + markets + odds
│   ├── results-loop.ts       # Results loop: last → finish positions + settlement
│   └── types.ts              # TypeScript interfaces for MST API responses + DB rows
├── config.json               # Intervals, URLs, concurrency settings
├── package.json
├── tsconfig.json
└── .env                      # SUPABASE_URL, SUPABASE_SERVICE_KEY
```

---

### Task 1: Project Scaffold

**Files:**
- Create: `C:\Users\philp\Downloads\ippica-scraper\package.json`
- Create: `C:\Users\philp\Downloads\ippica-scraper\tsconfig.json`
- Create: `C:\Users\philp\Downloads\ippica-scraper\config.json`
- Create: `C:\Users\philp\Downloads\ippica-scraper\.env`
- Create: `C:\Users\philp\Downloads\ippica-scraper\.gitignore`

- [ ] **Step 1: Create project directory and package.json**

```json
{
  "name": "ippica-scraper",
  "version": "1.0.0",
  "private": true,
  "description": "MST Channel horse racing scraper for Vincitu",
  "type": "module",
  "dependencies": {
    "@supabase/supabase-js": "^2.49.1"
  },
  "devDependencies": {
    "@types/node": "^22.7.4",
    "tsx": "^4.19.1",
    "typescript": "~5.9.0"
  },
  "scripts": {
    "start": "tsx src/index.ts",
    "test": "tsx src/test.ts"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create config.json**

```json
{
  "baseUrl": "https://fe-proxyhts-online-mst-int.mstchannel.com",
  "fallbackUrls": [
    "https://fe-proxyhts-gamenet-mst-int.mstchannel.com",
    "https://fe-proxyhts-sisal-mst-int.mstchannel.com"
  ],
  "programIntervalMs": 1800000,
  "oddsIntervalMs": 120000,
  "resultsIntervalMs": 60000,
  "oddsConcurrency": 5,
  "oddsBatchDelay": 300,
  "oddsWindowHours": 3,
  "maxConsecutiveFailures": 5
}
```

- [ ] **Step 4: Create .env**

```bash
SUPABASE_URL=https://xgnyqkmugnfzhdveeqom.supabase.co
SUPABASE_SERVICE_KEY=placeholder-replace-on-vps
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
.env
```

- [ ] **Step 6: Install dependencies**

Run: `cd C:\Users\philp\Downloads\ippica-scraper && npm install`
Expected: `node_modules/` created, no errors

- [ ] **Step 7: Init git and commit**

```bash
cd C:\Users\philp\Downloads\ippica-scraper
git init
git add package.json tsconfig.json config.json .gitignore
git commit -m "chore: scaffold ippica-scraper project"
```

---

### Task 2: Database Migration

**Files:**
- Create: `C:\Users\philp\Downloads\betssolution-project\betssolution\supabase\migrations\024_ippica_schema.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- ippica_meetings
CREATE TABLE IF NOT EXISTS ippica_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  country_id TEXT NOT NULL,
  race_type TEXT NOT NULL,
  meeting_date DATE NOT NULL,
  race_count INT DEFAULT 0,
  status TEXT DEFAULT 'scheduled',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ippica_races
CREATE TABLE IF NOT EXISTS ippica_races (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT UNIQUE NOT NULL,
  meeting_id UUID REFERENCES ippica_meetings(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  race_number INT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  off_time TIMESTAMPTZ,
  status TEXT DEFAULT 'scheduled',
  race_class TEXT,
  distance DECIMAL(8,2),
  distance_units TEXT,
  track TEXT,
  race_kind TEXT,
  going TEXT,
  weather TEXT,
  handicap BOOLEAN DEFAULT FALSE,
  eligibility TEXT,
  prize_amount INT,
  prize_currency TEXT,
  runners_count INT DEFAULT 0,
  source_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ippica_runners
CREATE TABLE IF NOT EXISTS ippica_runners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id UUID NOT NULL REFERENCES ippica_races(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  runner_number INT NOT NULL,
  drawn TEXT,
  age INT,
  sex TEXT,
  weight_text TEXT,
  weight_value INT,
  jockey TEXT,
  trainer TEXT,
  trainer_location TEXT,
  owner TEXT,
  breeder TEXT,
  bred TEXT,
  color TEXT,
  silk TEXT,
  form TEXT,
  rating INT,
  comment_it TEXT,
  breeding JSONB,
  tackle JSONB,
  is_non_runner BOOLEAN DEFAULT FALSE,
  finish_position INT,
  disqualified BOOLEAN DEFAULT FALSE,
  disqualify_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (race_id, runner_number)
);

-- ippica_markets
CREATE TABLE IF NOT EXISTS ippica_markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id UUID NOT NULL REFERENCES ippica_races(id) ON DELETE CASCADE,
  market_type TEXT NOT NULL,
  market_label TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (race_id, market_type, market_label)
);

-- ippica_odds
CREATE TABLE IF NOT EXISTS ippica_odds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID NOT NULL REFERENCES ippica_markets(id) ON DELETE CASCADE,
  runner_number INT,
  selection_name TEXT NOT NULL,
  odds DECIMAL(8,2),
  previous_odds DECIMAL(8,2),
  trend TEXT DEFAULT 'stable',
  status TEXT DEFAULT 'active',
  result TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (market_id, selection_name)
);

-- Indexes for FK lookups and common queries
CREATE INDEX idx_ippica_races_meeting_id ON ippica_races(meeting_id);
CREATE INDEX idx_ippica_races_status_scheduled ON ippica_races(status, scheduled_at);
CREATE INDEX idx_ippica_runners_race_id ON ippica_runners(race_id);
CREATE INDEX idx_ippica_markets_race_id ON ippica_markets(race_id);
CREATE INDEX idx_ippica_odds_market_id ON ippica_odds(market_id);
CREATE INDEX idx_ippica_odds_result ON ippica_odds(result);
```

- [ ] **Step 2: Run migration on Supabase**

Connect to VPS and run migration against Supabase:
```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -f -" < C:\Users\philp\Downloads\betssolution-project\betssolution\supabase\migrations\024_ippica_schema.sql
```
Expected: All CREATE TABLE and CREATE INDEX commands succeed.

- [ ] **Step 3: Verify tables exist**

```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -c \"\\dt ippica_*\""
```
Expected: 5 tables listed (ippica_meetings, ippica_races, ippica_runners, ippica_markets, ippica_odds)

- [ ] **Step 4: Commit migration**

```bash
cd C:\Users\philp\Downloads\betssolution-project\betssolution
git add supabase/migrations/024_ippica_schema.sql
git commit -m "feat: add ippica schema (meetings, races, runners, markets, odds)"
```

---

### Task 3: TypeScript Types

**Files:**
- Create: `C:\Users\philp\Downloads\ippica-scraper\src\types.ts`

- [ ] **Step 1: Write MST API response types**

```typescript
// ---- MST API Response Types ----

export interface MstChannelResponse {
  channel: MstChannel[]
}

export interface MstChannel {
  id: string
  description: string
  country: MstCountry[]
}

export interface MstCountry {
  id: string
  description: string
  meeting: MstMeetingRef[]
}

export interface MstMeetingRef {
  id: string
  name: string
  tipo: string  // "GL" or "TR"
  mdate: string // "2026-03-21"
}

export interface MstNextResponse {
  race: MstRaceListItem[]
}

export interface MstRaceListItem {
  timestamp: string
  cid: string       // country ID
  country: string
  mid: string       // meeting ID
  meeting: string   // meeting name
  sigla: string
  tp: string        // "GL" or "TR"
  id: string        // race ID
  title: string
  number: string    // race number
  date: string      // ISO datetime
  st: string        // status code
  ss: string        // sub-status: "AP", "CH", "RU", "FI", "AB"
  tqq: string | null
  prize: string
  prize_currency: string
  distance_units: string
  distance: string
  weather: string | null
  palinsesto: string
  avvenimento: string
  odds: string      // "1" if odds available
  runners: string   // runner count
  pers: MstPers
}

export interface MstPers {
  tot: string
  qf: string
  ss: string
  palinsesto: string
  avvenimento: string
  pal_online: string
  avv_online: string
}

export interface MstLastResponse {
  race: MstLastRaceItem[]
}

export interface MstLastRaceItem {
  cid: string
  country: string
  mid: string
  meeting: string
  tp: string
  id: string
  title: string
  number: string
  date: string
  off_time?: string
  st: string
  ss: string
  tris: string
  prize: string
  prize_currency: string
  tot: string
  result?: MstResultEntry[]
}

export interface MstResultEntry {
  number: string   // runner number
  pos: string      // finishing position
  name: string
  odds?: MstResultOdds[]
}

export interface MstResultOdds {
  scommessa: string  // bet type: "1"=win, "2"=place2, "3"=place3, "4"=place4
  quota: string
}

export interface MstRaceDetailResponse {
  race: MstRaceDetail
}

export interface MstRaceDetail {
  timestamp: string
  mid: string
  course: string
  country: string
  sigla: string
  antepost: string
  id_fornitore: string
  countryid: string
  tp: string
  id: string
  title: string
  number: string
  date: string
  st: string
  ss: string
  tqq: string
  weather: string | null
  going: string | null
  distance_units: string
  distance_value: string
  pv_currency: string
  pv_amount: string
  am_currency: string
  am_amount: string
  conditions: string
  eligibility: string
  track: string | null
  type: string | null      // "Hurdle", "Flat", etc.
  handicap: string         // "Yes" or "No"
  stewards: string
  off_time?: string
  ipp: string
  class: string | null
  horses?: MstHorse[]
  markets?: MstMarket[]
}

export interface MstHorse {
  id: string
  name: string
  number: string
  drawn: string
  cp: string
  age: string
  jockey: string
  jockey_change: string
  image: string | null
  silk: string | null
  w_units: string | null
  w_value: string
  w_text: string | null
  a_units: string | null
  a_value: string
  bred: string | null
  hstatus: string         // "1" = active, other = non-runner
  sex: string
  dsex: string
  tr_name: string | null
  tr_nationality: string | null
  tr_location: string | null
  owner_name: string | null
  breeder: string | null
  ferri: string | null
  paraocchi: string
  fp: string              // favorite price
  finish_pos: string
  disqualified: string    // "0" or "1"
  reason: string | null
  amend_pos: string
  distance: string | null
  form?: MstForm[]
  rating?: MstRating[]
  breeding?: MstBreeding[]
  colour?: MstColour[]
  tackle?: MstTackle[]
  comments?: MstComment[]
}

export interface MstForm {
  ftype: string
  figures: string
}

export interface MstRating {
  rtype: string
  value: string
}

export interface MstBreeding {
  btype: string  // "Sire", "Dam", "DamSire"
  name: string
  bred: string
  born: string
}

export interface MstColour {
  id: string
  colour: string
}

export interface MstTackle {
  ttype: string
  tcount: string
}

export interface MstComment {
  language: string
  comment: string
}

export interface MstMarket {
  id: string
  market: string          // "Winner", "Place (2)", "Head to head", "Even and odd"
  ia: string | null       // H2H identifier
  ia_desc: string | null  // H2H description: "Horse A VS Horse B"
  base: string
  min: string
  multipla: string
  odds?: MstOddsEntry[]
  info?: { margin: string }
  pers: MstPers
}

export interface MstOddsEntry {
  esito: string       // outcome number (maps to runner number for Winner/Place)
  quota: string       // odds in centesimal (820 = 8.20)
  descrizione: string // horse name or "Even"/"Odd"
  stato: string       // "2" = active
  trend: string       // "-2", "0", "2"
}

// ---- DB Row Types ----

export interface DbMeeting {
  external_id: string
  name: string
  country: string
  country_id: string
  race_type: string
  meeting_date: string
  race_count: number
  status: string
  updated_at: string
}

export interface DbRace {
  external_id: string
  meeting_id?: string  // UUID, resolved after meeting upsert
  title: string
  race_number: number
  scheduled_at: string
  off_time?: string
  status: string
  race_class?: string
  distance?: number
  distance_units?: string
  track?: string
  race_kind?: string
  going?: string
  weather?: string
  handicap: boolean
  eligibility?: string
  prize_amount?: number
  prize_currency?: string
  runners_count: number
  source_data?: Record<string, unknown>
  updated_at: string
}

export interface DbRunner {
  race_id: string      // UUID
  external_id: string
  name: string
  runner_number: number
  drawn?: string
  age?: number
  sex?: string
  weight_text?: string
  weight_value?: number
  jockey?: string
  trainer?: string
  trainer_location?: string
  owner?: string
  breeder?: string
  bred?: string
  color?: string
  silk?: string
  form?: string
  rating?: number
  comment_it?: string
  breeding?: Record<string, unknown>
  tackle?: Record<string, unknown>[]
  is_non_runner: boolean
  updated_at: string
}

export interface DbMarket {
  race_id: string      // UUID
  market_type: string
  market_label: string  // '' for non-H2H markets, "Horse A VS Horse B" for H2H
  is_active: boolean
  updated_at: string
}

export interface DbOdds {
  market_id: string    // UUID
  runner_number?: number
  selection_name: string
  odds?: number
  previous_odds?: number
  trend: string
  status: string
  updated_at: string
}

// ---- Cache Types ----

export interface CachedRace {
  externalId: string   // "mst:{raceId}"
  mstRaceId: string    // raw MST race ID
  scheduledAt: Date
  status: string
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd C:\Users\philp\Downloads\ippica-scraper && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd C:\Users\philp\Downloads\ippica-scraper
git add src/types.ts
git commit -m "feat: add TypeScript types for MST API and DB rows"
```

---

### Task 4: MST HTTP Client

**Files:**
- Create: `C:\Users\philp\Downloads\ippica-scraper\src\mst-client.ts`

- [ ] **Step 1: Write the MST client**

```typescript
import config from '../config.json' with { type: 'json' }
import type {
  MstChannelResponse,
  MstNextResponse,
  MstLastResponse,
  MstRaceDetailResponse,
} from './types.js'

const TIMEOUT_MS = 15_000
const MAX_RETRIES = 2

let _currentUrlIndex = 0
let _consecutiveFailures = 0

function getAllUrls(): string[] {
  return [config.baseUrl, ...config.fallbackUrls]
}

function getCurrentBaseUrl(): string {
  return getAllUrls()[_currentUrlIndex]
}

function rotateUrl(): void {
  const urls = getAllUrls()
  const oldUrl = urls[_currentUrlIndex]
  _currentUrlIndex = (_currentUrlIndex + 1) % urls.length
  _consecutiveFailures = 0
  console.log(`[mst-client] Proxy failover: ${oldUrl} → ${urls[_currentUrlIndex]}`)
}

function onSuccess(): void {
  _consecutiveFailures = 0
}

function onFailure(): void {
  _consecutiveFailures++
  if (_consecutiveFailures >= config.maxConsecutiveFailures) {
    rotateUrl()
  }
}

async function fetchJson<T>(path: string): Promise<T | null> {
  const url = `${getCurrentBaseUrl()}${path}`
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'IppicaScraper/1.0' },
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (!resp.ok) {
        console.error(`[mst-client] HTTP ${resp.status} for ${path} (attempt ${attempt + 1})`)
        if (attempt < MAX_RETRIES) {
          await sleep(2000 * (attempt + 1))
          continue
        }
        onFailure()
        return null
      }

      const data = await resp.json() as T
      onSuccess()
      return data
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[mst-client] Error fetching ${path} (attempt ${attempt + 1}): ${msg}`)
      if (attempt < MAX_RETRIES) {
        await sleep(2000 * (attempt + 1))
      }
    }
  }
  onFailure()
  return null
}

export async function getChannels(): Promise<MstChannelResponse | null> {
  return fetchJson<MstChannelResponse>('/rest/program/channels')
}

export async function getNext(): Promise<MstNextResponse | null> {
  return fetchJson<MstNextResponse>('/rest/program/next')
}

export async function getRaceDetail(raceId: string): Promise<MstRaceDetailResponse | null> {
  return fetchJson<MstRaceDetailResponse>(`/rest/program/race/${raceId}`)
}

export async function getLast(): Promise<MstLastResponse | null> {
  return fetchJson<MstLastResponse>('/rest/program/last')
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
```

- [ ] **Step 2: Write a quick smoke test**

Create `src/test.ts`:

```typescript
import { getChannels, getNext, getRaceDetail, getLast } from './mst-client.js'

async function main() {
  console.log('--- Testing MST API ---\n')

  console.log('1. Channels...')
  const channels = await getChannels()
  if (channels) {
    const totalMeetings = channels.channel.reduce(
      (sum, ch) => sum + ch.country.reduce((s, c) => s + c.meeting.length, 0), 0
    )
    console.log(`   ${channels.channel.length} channels, ${totalMeetings} meetings\n`)
  }

  console.log('2. Next races...')
  const next = await getNext()
  if (next) {
    console.log(`   ${next.race.length} upcoming races`)
    if (next.race.length > 0) {
      const r = next.race[0]
      console.log(`   First: ${r.meeting} - ${r.title} (${r.country}, ${r.tp})\n`)

      console.log(`3. Race detail for ${r.id}...`)
      const detail = await getRaceDetail(r.id)
      if (detail) {
        const horses = detail.race.horses?.length ?? 0
        const markets = detail.race.markets?.length ?? 0
        console.log(`   ${horses} horses, ${markets} markets`)
        if (detail.race.horses?.[0]) {
          const h = detail.race.horses[0]
          console.log(`   First horse: #${h.number} ${h.name} (jockey: ${h.jockey})\n`)
        }
      }
    }
  }

  console.log('4. Last results...')
  const last = await getLast()
  if (last) {
    const withResults = last.race.filter(r => r.result && r.result.length > 0)
    console.log(`   ${last.race.length} recent races, ${withResults.length} with results`)
    if (withResults.length > 0) {
      const r = withResults[0]
      console.log(`   ${r.meeting}: ${r.title}`)
      r.result!.slice(0, 3).forEach(res => {
        console.log(`     ${res.pos}. #${res.number} ${res.name}`)
      })
    }
  }

  console.log('\n--- Done ---')
}

main().catch(console.error)
```

- [ ] **Step 3: Run the smoke test**

Run: `cd C:\Users\philp\Downloads\ippica-scraper && npm test`
Expected: All 4 endpoints return data. Channels, races, race detail with horses/markets, last results.

- [ ] **Step 4: Commit**

```bash
cd C:\Users\philp\Downloads\ippica-scraper
git add src/mst-client.ts src/test.ts
git commit -m "feat: MST HTTP client with proxy failover + smoke test"
```

---

### Task 5: Transform Layer

**Files:**
- Create: `C:\Users\philp\Downloads\ippica-scraper\src\transform.ts`

- [ ] **Step 1: Write the transform module**

```typescript
import type {
  MstChannel, MstRaceListItem, MstRaceDetail, MstHorse,
  MstMarket, MstOddsEntry, MstLastRaceItem,
  DbMeeting, DbRace, DbRunner, DbMarket, DbOdds,
} from './types.js'

const now = () => new Date().toISOString()

// ---- Status Mapping ----

export function mapRaceStatus(ss: string, st: string): string {
  switch (ss) {
    case 'AP': return ['5', '9'].includes(st) ? 'open' : 'scheduled'
    case 'CH': return 'closed'
    case 'RU': return 'running'
    case 'FI': return 'finished'
    case 'AB': return 'abandoned'
    default: return 'scheduled'
  }
}

// ---- Trend Mapping ----

export function mapTrend(trend: string): string {
  switch (trend) {
    case '-2': return 'down'
    case '2': return 'up'
    default: return 'stable'
  }
}

// ---- Meetings ----

export function transformChannelsToMeetings(channels: MstChannel[]): DbMeeting[] {
  const meetings: DbMeeting[] = []
  for (const channel of channels) {
    for (const country of channel.country) {
      for (const meeting of country.meeting) {
        meetings.push({
          external_id: `mst:${meeting.id}`,
          name: meeting.name,
          country: country.description,
          country_id: country.id,
          race_type: meeting.tipo,
          meeting_date: meeting.mdate,
          race_count: 0,
          status: 'scheduled',
          updated_at: now(),
        })
      }
    }
  }
  return meetings
}

// ---- Races (from /next list) ----

export function transformNextToRaces(races: MstRaceListItem[]): DbRace[] {
  return races.map(r => ({
    external_id: `mst:${r.id}`,
    title: r.title,
    race_number: parseInt(r.number, 10),
    scheduled_at: r.date,
    status: mapRaceStatus(r.ss, r.st),
    distance: r.distance ? parseFloat(r.distance) : undefined,
    distance_units: r.distance_units || undefined,
    weather: r.weather || undefined,
    prize_amount: r.prize ? parseInt(r.prize, 10) : undefined,
    prize_currency: r.prize_currency || undefined,
    runners_count: r.runners ? parseInt(r.runners, 10) : 0,
    handicap: false,
    updated_at: now(),
    // meeting_id resolved later by matching mst:${r.mid}
    _meeting_external_id: `mst:${r.mid}`,
  })) as (DbRace & { _meeting_external_id: string })[]
}

// ---- Race Detail → Runners ----

export function transformHorsesToRunners(horses: MstHorse[], raceId: string): DbRunner[] {
  return horses.map(h => {
    const breeding: Record<string, unknown> = {}
    if (h.breeding) {
      for (const b of h.breeding) {
        breeding[b.btype.toLowerCase()] = { name: b.name, bred: b.bred?.trim(), born: b.born }
      }
    }

    const tackle = h.tackle?.map(t => ({ type: t.ttype, count: parseInt(t.tcount, 10) })) ?? []

    const form = h.form?.[0]?.figures || undefined
    const rating = h.rating?.find(r => r.rtype === 'Official')
    const color = h.colour?.[0]?.colour || undefined
    const commentIt = h.comments?.find(c => c.language === 'it-IT')?.comment || undefined

    return {
      race_id: raceId,
      external_id: `mst:${h.id}`,
      name: h.name,
      runner_number: parseInt(h.number, 10),
      drawn: h.drawn || undefined,
      age: h.age ? parseInt(h.age, 10) : undefined,
      sex: h.sex || undefined,
      weight_text: h.w_text || undefined,
      weight_value: h.w_value ? parseInt(h.w_value, 10) : undefined,
      jockey: h.jockey || undefined,
      trainer: h.tr_name || undefined,
      trainer_location: h.tr_location || undefined,
      owner: h.owner_name || undefined,
      breeder: h.breeder || undefined,
      bred: h.bred?.trim() || undefined,
      color,
      silk: h.silk || undefined,
      form,
      rating: rating ? parseInt(rating.value, 10) : undefined,
      comment_it: commentIt,
      breeding: Object.keys(breeding).length > 0 ? breeding : undefined,
      tackle: tackle.length > 0 ? tackle : undefined,
      is_non_runner: h.hstatus !== '1',
      updated_at: now(),
    }
  })
}

// ---- Race Detail → Markets + Odds ----

export interface TransformedMarketWithOdds {
  market: DbMarket
  odds: Omit<DbOdds, 'market_id'>[]
}

export function transformMarketsAndOdds(
  markets: MstMarket[],
  raceId: string
): TransformedMarketWithOdds[] {
  const result: TransformedMarketWithOdds[] = []

  for (const m of markets) {
    // Skip markets without odds (e.g. Forecast info-only)
    if (!m.odds || m.odds.length === 0) continue

    const marketLabel = m.ia_desc || ''

    const market: DbMarket = {
      race_id: raceId,
      market_type: m.market,
      market_label: marketLabel,
      is_active: true,
      updated_at: now(),
    }

    const odds: Omit<DbOdds, 'market_id'>[] = m.odds.map(o => ({
      runner_number: isRunnerMarket(m.market) ? parseInt(o.esito, 10) : undefined,
      selection_name: normalizeSelectionName(o.descrizione),
      odds: o.quota && o.quota !== '0' ? parseInt(o.quota, 10) / 100 : undefined,
      trend: mapTrend(o.trend),
      status: o.stato === '2' ? 'active' : 'suspended',
      updated_at: now(),
    }))

    result.push({ market, odds })
  }

  return result
}

function isRunnerMarket(marketType: string): boolean {
  return ['Winner', 'Place (2)', 'Place (3)', 'Place (4)'].includes(marketType)
}

function normalizeSelectionName(name: string): string {
  // Trim whitespace, normalize internal spaces
  return name.trim().replace(/\s+/g, ' ')
}

// ---- Race Detail Update ----

export function transformRaceDetail(detail: MstRaceDetail): Partial<DbRace> {
  return {
    status: mapRaceStatus(detail.ss, detail.st),
    race_class: detail.class || undefined,
    distance: detail.distance_value ? parseFloat(detail.distance_value) : undefined,
    distance_units: detail.distance_units || undefined,
    track: detail.track || undefined,
    race_kind: detail.type || undefined,
    going: detail.going || undefined,
    weather: detail.weather || undefined,
    handicap: detail.handicap === 'Yes',
    eligibility: detail.eligibility || undefined,
    prize_amount: detail.am_amount ? parseInt(detail.am_amount, 10) : undefined,
    prize_currency: detail.am_currency || undefined,
    runners_count: detail.horses?.filter(h => h.hstatus === '1').length ?? 0,
    off_time: detail.off_time || undefined,
    source_data: detail as unknown as Record<string, unknown>,
    updated_at: now(),
  }
}

// ---- Results ----

export interface ResultData {
  mstRaceId: string
  meetingName: string
  offTime?: string
  runners: { number: number; position: number; name: string; disqualified: boolean }[]
}

export function transformLastToResults(races: MstLastRaceItem[]): ResultData[] {
  return races
    .filter(r => r.result && r.result.length > 0)
    .map(r => ({
      mstRaceId: r.id,
      meetingName: r.meeting,
      offTime: r.off_time,
      runners: r.result!.map(res => ({
        number: parseInt(res.number, 10),
        position: parseInt(res.pos, 10),
        name: res.name,
        disqualified: false, // MST doesn't flag DQ in /last, checked in detail
      })),
    }))
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd C:\Users\philp\Downloads\ippica-scraper && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd C:\Users\philp\Downloads\ippica-scraper
git add src/transform.ts
git commit -m "feat: transform layer (MST → DB format)"
```

---

### Task 6: Supabase Client + Upsert Functions

**Files:**
- Create: `C:\Users\philp\Downloads\ippica-scraper\src\supabase.ts`

- [ ] **Step 1: Write the Supabase module**

```typescript
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { DbMeeting, DbRace, DbRunner, DbMarket, DbOdds, CachedRace } from './types.js'
import type { TransformedMarketWithOdds } from './transform.js'

let supabase: SupabaseClient

export function initSupabase(): void {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY')
  supabase = createClient(url, key)
  console.log('[supabase] Client initialized')
}

export function getSupabase(): SupabaseClient {
  return supabase
}

// ---- Meetings ----

export async function upsertMeetings(meetings: DbMeeting[]): Promise<number> {
  if (meetings.length === 0) return 0
  const { error, count } = await supabase
    .from('ippica_meetings')
    .upsert(meetings, { onConflict: 'external_id', count: 'exact' })
  if (error) {
    console.error('[supabase] upsertMeetings error:', error.message)
    return 0
  }
  return count ?? meetings.length
}

// ---- Races ----

export async function upsertRaces(
  races: (DbRace & { _meeting_external_id?: string })[]
): Promise<number> {
  if (races.length === 0) return 0

  // Resolve meeting_id from external_id
  const meetingExtIds = [...new Set(races.map(r => r._meeting_external_id).filter(Boolean))]
  const meetingMap = new Map<string, string>()

  if (meetingExtIds.length > 0) {
    const { data } = await supabase
      .from('ippica_meetings')
      .select('id, external_id')
      .in('external_id', meetingExtIds)
    if (data) {
      for (const m of data) meetingMap.set(m.external_id, m.id)
    }
  }

  const rows = races.map(r => {
    const { _meeting_external_id, ...rest } = r
    return {
      ...rest,
      meeting_id: _meeting_external_id ? meetingMap.get(_meeting_external_id) : undefined,
    }
  })

  const { error, count } = await supabase
    .from('ippica_races')
    .upsert(rows, { onConflict: 'external_id', count: 'exact' })
  if (error) {
    console.error('[supabase] upsertRaces error:', error.message)
    return 0
  }
  return count ?? rows.length
}

export async function updateRace(
  externalId: string,
  updates: Partial<DbRace>
): Promise<void> {
  const { error } = await supabase
    .from('ippica_races')
    .update(updates)
    .eq('external_id', externalId)
  if (error) console.error(`[supabase] updateRace ${externalId} error:`, error.message)
}

export async function getRaceIdByExternalId(externalId: string): Promise<string | null> {
  const { data } = await supabase
    .from('ippica_races')
    .select('id')
    .eq('external_id', externalId)
    .single()
  return data?.id ?? null
}

export async function getRacesByExternalIds(
  externalIds: string[]
): Promise<Map<string, { id: string; status: string }>> {
  const map = new Map<string, { id: string; status: string }>()
  if (externalIds.length === 0) return map

  // Batch in chunks of 100
  for (let i = 0; i < externalIds.length; i += 100) {
    const batch = externalIds.slice(i, i + 100)
    const { data } = await supabase
      .from('ippica_races')
      .select('id, external_id, status')
      .in('external_id', batch)
    if (data) {
      for (const r of data) map.set(r.external_id, { id: r.id, status: r.status })
    }
  }
  return map
}

// ---- Bootstrap Cache ----

export async function bootstrapRaceCache(): Promise<CachedRace[]> {
  const { data, error } = await supabase
    .from('ippica_races')
    .select('external_id, scheduled_at, status')
    .in('status', ['scheduled', 'open', 'closed'])
    .gte('scheduled_at', new Date(Date.now() - 2 * 3600_000).toISOString())
    .lte('scheduled_at', new Date(Date.now() + 24 * 3600_000).toISOString())

  if (error) {
    console.error('[supabase] bootstrapRaceCache error:', error.message)
    return []
  }

  return (data ?? []).map(r => ({
    externalId: r.external_id,
    mstRaceId: r.external_id.replace('mst:', ''),
    scheduledAt: new Date(r.scheduled_at),
    status: r.status,
  }))
}

// ---- Runners (exclude finish_position from upsert) ----

export async function upsertRunners(runners: DbRunner[]): Promise<number> {
  if (runners.length === 0) return 0

  const { error, count } = await supabase
    .from('ippica_runners')
    .upsert(runners, { onConflict: 'race_id,runner_number', count: 'exact' })
  if (error) {
    console.error('[supabase] upsertRunners error:', error.message)
    return 0
  }
  return count ?? runners.length
}

// ---- Markets + Odds ----

export async function upsertMarketsAndOdds(
  items: TransformedMarketWithOdds[]
): Promise<{ markets: number; odds: number }> {
  if (items.length === 0) return { markets: 0, odds: 0 }

  let marketsCount = 0
  let oddsCount = 0

  for (const item of items) {
    // Upsert market
    const { data: marketData, error: marketErr } = await supabase
      .from('ippica_markets')
      .upsert(item.market, {
        onConflict: 'race_id,market_type,market_label',
      })
      .select('id')
      .single()

    if (marketErr) {
      console.error(`[supabase] upsertMarket error (${item.market.market_type}):`, marketErr.message)
      continue
    }
    marketsCount++

    if (!marketData?.id || item.odds.length === 0) continue

    // Read existing odds for previous_odds tracking
    const { data: existingOdds } = await supabase
      .from('ippica_odds')
      .select('selection_name, odds')
      .eq('market_id', marketData.id)

    const prevOddsMap = new Map<string, number>()
    if (existingOdds) {
      for (const o of existingOdds) {
        if (o.odds) prevOddsMap.set(o.selection_name, o.odds)
      }
    }

    // Upsert odds with previous_odds (only set when odds actually changed)
    const oddsRows: DbOdds[] = item.odds.map(o => {
      const prevOdds = prevOddsMap.get(o.selection_name)
      return {
        ...o,
        market_id: marketData.id,
        // Only update previous_odds when the current odds differ from stored
        previous_odds: (prevOdds != null && o.odds != null && prevOdds !== o.odds)
          ? prevOdds
          : undefined,
      }
    }) as DbOdds[]

    const { error: oddsErr, count } = await supabase
      .from('ippica_odds')
      .upsert(oddsRows, { onConflict: 'market_id,selection_name', count: 'exact' })

    if (oddsErr) {
      console.error(`[supabase] upsertOdds error (${item.market.market_type}):`, oddsErr.message)
    } else {
      oddsCount += count ?? oddsRows.length
    }
  }

  return { markets: marketsCount, odds: oddsCount }
}

// ---- Results & Settlement ----

export async function updateRunnerPositions(
  raceId: string,
  positions: { runner_number: number; finish_position: number; disqualified: boolean }[]
): Promise<void> {
  for (const p of positions) {
    const { error } = await supabase
      .from('ippica_runners')
      .update({
        finish_position: p.finish_position,
        disqualified: p.disqualified,
        updated_at: new Date().toISOString(),
      })
      .eq('race_id', raceId)
      .eq('runner_number', p.runner_number)
    if (error) {
      console.error(`[supabase] updateRunnerPosition #${p.runner_number} error:`, error.message)
    }
  }
}

export async function settleRaceOdds(
  raceId: string,
  positions: Map<number, number>, // runner_number → finish_position
  isAbandoned: boolean
): Promise<number> {
  // Get all markets + odds for this race
  const { data: markets } = await supabase
    .from('ippica_markets')
    .select('id, market_type, market_label')
    .eq('race_id', raceId)

  if (!markets || markets.length === 0) return 0

  // Fetch runners for H2H name→number resolution
  const { data: runnersData } = await supabase
    .from('ippica_runners')
    .select('runner_number, name')
    .eq('race_id', raceId)
  const runners = new Map<string, number>()
  if (runnersData) {
    for (const r of runnersData) runners.set(r.name, r.runner_number)
  }

  let settled = 0

  for (const market of markets) {
    const { data: odds } = await supabase
      .from('ippica_odds')
      .select('id, runner_number, selection_name, status')
      .eq('market_id', market.id)
      .neq('status', 'void')  // skip already voided

    if (!odds || odds.length === 0) continue

    for (const odd of odds) {
      let result: string

      if (isAbandoned) {
        result = 'void'
      } else if (odd.runner_number != null && !positions.has(odd.runner_number)) {
        // Runner not in results (non-runner)
        result = 'void'
      } else {
        result = settleOutcome(market.market_type, market.market_label, odd, positions, runners)
      }

      const { error } = await supabase
        .from('ippica_odds')
        .update({ result, status: 'resulted', updated_at: new Date().toISOString() })
        .eq('id', odd.id)

      if (!error) settled++
    }
  }

  return settled
}

function settleOutcome(
  marketType: string,
  marketLabel: string,
  odd: { runner_number: number | null; selection_name: string },
  positions: Map<number, number>,
  runners: Map<string, number>  // name → runner_number
): string {
  if (marketType === 'Winner') {
    if (odd.runner_number == null) return 'void'
    const pos = positions.get(odd.runner_number)
    return pos === 1 ? 'won' : 'lost'
  }

  const placeMatch = marketType.match(/^Place \((\d+)\)$/)
  if (placeMatch) {
    const placeCount = parseInt(placeMatch[1], 10)
    if (odd.runner_number == null) return 'void'
    const pos = positions.get(odd.runner_number)
    if (pos == null) return 'void'
    return pos <= placeCount ? 'won' : 'lost'
  }

  if (marketType === 'Even and odd') {
    let winnerNumber: number | null = null
    for (const [num, pos] of positions) {
      if (pos === 1) { winnerNumber = num; break }
    }
    if (winnerNumber == null) return 'void'
    const isEven = winnerNumber % 2 === 0
    if (odd.selection_name === 'Even') return isEven ? 'won' : 'lost'
    if (odd.selection_name === 'Odd') return isEven ? 'lost' : 'won'
    return 'void'
  }

  if (marketType === 'Head to head') {
    // market_label: "Horse A VS Horse B", selection_name: "1" or "2"
    if (!marketLabel) return 'void'
    const parts = marketLabel.split(' VS ')
    if (parts.length !== 2) return 'void'

    const horse1Num = runners.get(parts[0].trim())
    const horse2Num = runners.get(parts[1].trim())
    if (horse1Num == null || horse2Num == null) return 'void'

    const pos1 = positions.get(horse1Num)
    const pos2 = positions.get(horse2Num)
    if (pos1 == null || pos2 == null) return 'void'  // non-runner → void

    if (odd.selection_name === '1') return pos1 < pos2 ? 'won' : 'lost'
    if (odd.selection_name === '2') return pos2 < pos1 ? 'won' : 'lost'
    return 'void'
  }

  // Unknown market type
  return 'void'
}

// ---- Non-Runner Odds Voiding ----

export async function voidNonRunnerOdds(raceId: string, runnerNumbers: number[]): Promise<void> {
  if (runnerNumbers.length === 0) return

  // Get all markets for this race
  const { data: markets } = await supabase
    .from('ippica_markets')
    .select('id')
    .eq('race_id', raceId)

  if (!markets || markets.length === 0) return

  const marketIds = markets.map(m => m.id)

  // Void odds for non-runner numbers
  const { error } = await supabase
    .from('ippica_odds')
    .update({ status: 'void', result: 'void', updated_at: new Date().toISOString() })
    .in('market_id', marketIds)
    .in('runner_number', runnerNumbers)
    .neq('status', 'void')  // skip already voided

  if (error) {
    console.error(`[supabase] voidNonRunnerOdds error:`, error.message)
  }
}

// ---- Unsettled Check ----

export async function getUnsettledRaces(): Promise<string[]> {
  // Find races that are finished but have unsettled odds
  const { data, error } = await supabase
    .from('ippica_races')
    .select(`
      id,
      ippica_markets!inner(
        ippica_odds!inner(result)
      )
    `)
    .eq('status', 'finished')
    .is('ippica_markets.ippica_odds.result', null)
    .limit(20)

  if (error) {
    console.error('[supabase] getUnsettledRaces error:', error.message)
    return []
  }

  return data?.map(r => r.id) ?? []
}

export async function getRunnerPositions(
  raceId: string
): Promise<Map<number, number>> {
  const { data } = await supabase
    .from('ippica_runners')
    .select('runner_number, finish_position')
    .eq('race_id', raceId)
    .not('finish_position', 'is', null)

  const map = new Map<number, number>()
  if (data) {
    for (const r of data) map.set(r.runner_number, r.finish_position)
  }
  return map
}

// ---- Meeting Status Update ----

export async function updateMeetingStatuses(): Promise<void> {
  // Get all meetings for today
  const today = new Date().toISOString().slice(0, 10)
  const { data: meetings } = await supabase
    .from('ippica_meetings')
    .select('id, external_id')
    .eq('meeting_date', today)
    .neq('status', 'completed')

  if (!meetings || meetings.length === 0) return

  for (const meeting of meetings) {
    const { data: races } = await supabase
      .from('ippica_races')
      .select('status')
      .eq('meeting_id', meeting.id)

    if (!races || races.length === 0) continue

    const allFinished = races.every(r => r.status === 'finished' || r.status === 'abandoned')
    const anyActive = races.some(r => r.status === 'open' || r.status === 'running')

    let newStatus: string
    if (allFinished) newStatus = 'completed'
    else if (anyActive) newStatus = 'active'
    else continue

    await supabase
      .from('ippica_meetings')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', meeting.id)
  }
}

// ---- Cleanup ----

export async function cleanupOldData(): Promise<{ races: number; meetings: number }> {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600_000).toISOString()

  const { count: races } = await supabase
    .from('ippica_races')
    .delete({ count: 'exact' })
    .in('status', ['finished', 'abandoned'])
    .lt('scheduled_at', cutoff)

  const cutoffDate = new Date(Date.now() - 7 * 24 * 3600_000).toISOString().slice(0, 10)
  const { count: meetings } = await supabase
    .from('ippica_meetings')
    .delete({ count: 'exact' })
    .lt('meeting_date', cutoffDate)

  return { races: races ?? 0, meetings: meetings ?? 0 }
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd C:\Users\philp\Downloads\ippica-scraper && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd C:\Users\philp\Downloads\ippica-scraper
git add src/supabase.ts
git commit -m "feat: Supabase client with upsert, settlement, and cleanup functions"
```

---

### Task 7: Program Loop

**Files:**
- Create: `C:\Users\philp\Downloads\ippica-scraper\src\program-loop.ts`

- [ ] **Step 1: Write the program loop**

```typescript
import { getChannels, getNext } from './mst-client.js'
import { transformChannelsToMeetings, transformNextToRaces } from './transform.js'
import { upsertMeetings, upsertRaces, updateMeetingStatuses } from './supabase.js'
import type { CachedRace } from './types.js'

let _running = false

export async function runProgramCycle(
  raceCache: Map<string, CachedRace>
): Promise<void> {
  if (_running) {
    console.log('[program] Skipping — already running')
    return
  }
  _running = true
  const start = Date.now()

  try {
    // 1. Fetch channels → upsert meetings
    const channelsResp = await getChannels()
    let meetingsCount = 0
    if (channelsResp) {
      const meetings = transformChannelsToMeetings(channelsResp.channel)
      meetingsCount = await upsertMeetings(meetings)
    }

    // 2. Fetch next → upsert races + populate cache
    const nextResp = await getNext()
    let racesCount = 0
    if (nextResp) {
      const races = transformNextToRaces(nextResp.race)
      racesCount = await upsertRaces(races)

      // Populate cache with new races
      for (const r of races) {
        const extId = r.external_id
        if (!raceCache.has(extId) && r.status !== 'finished' && r.status !== 'abandoned') {
          raceCache.set(extId, {
            externalId: extId,
            mstRaceId: extId.replace('mst:', ''),
            scheduledAt: new Date(r.scheduled_at),
            status: r.status,
          })
        }
      }
    }

    // 3. Update meeting statuses
    await updateMeetingStatuses()

    const elapsed = Date.now() - start
    console.log(
      `[program] Cycle done in ${elapsed}ms — ${meetingsCount} meetings, ${racesCount} races, cache: ${raceCache.size}`
    )
  } catch (err) {
    console.error('[program] Cycle error:', err instanceof Error ? err.message : err)
  } finally {
    _running = false
  }
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd C:\Users\philp\Downloads\ippica-scraper && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd C:\Users\philp\Downloads\ippica-scraper
git add src/program-loop.ts
git commit -m "feat: program loop (meeting/race discovery every 30min)"
```

---

### Task 8: Odds Loop

**Files:**
- Create: `C:\Users\philp\Downloads\ippica-scraper\src\odds-loop.ts`

- [ ] **Step 1: Write the odds loop**

```typescript
import config from '../config.json' with { type: 'json' }
import { getRaceDetail, sleep } from './mst-client.js'
import {
  transformHorsesToRunners,
  transformMarketsAndOdds,
  transformRaceDetail,
} from './transform.js'
import {
  getRaceIdByExternalId,
  updateRace,
  upsertRunners,
  upsertMarketsAndOdds,
  voidNonRunnerOdds,
} from './supabase.js'
import type { CachedRace } from './types.js'

let _running = false

export async function runOddsCycle(
  raceCache: Map<string, CachedRace>
): Promise<void> {
  if (_running) {
    console.log('[odds] Skipping — already running')
    return
  }
  _running = true
  const start = Date.now()

  try {
    // Filter: only races within oddsWindowHours
    const windowMs = config.oddsWindowHours * 3600_000
    const now = Date.now()
    const eligible: CachedRace[] = []

    for (const cached of raceCache.values()) {
      // Skip finished/abandoned
      if (cached.status === 'finished' || cached.status === 'abandoned') continue
      // Only within window
      if (cached.scheduledAt.getTime() <= now + windowMs) {
        eligible.push(cached)
      }
    }

    if (eligible.length === 0) {
      console.log('[odds] No eligible races in window')
      return
    }

    let runnersTotal = 0
    let marketsTotal = 0
    let oddsTotal = 0
    let errors = 0

    // Process in batches with concurrency limit
    for (let i = 0; i < eligible.length; i += config.oddsConcurrency) {
      const batch = eligible.slice(i, i + config.oddsConcurrency)
      const results = await Promise.allSettled(
        batch.map(cached => processRaceOdds(cached, raceCache))
      )

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          runnersTotal += result.value.runners
          marketsTotal += result.value.markets
          oddsTotal += result.value.odds
        } else if (result.status === 'rejected') {
          errors++
        }
      }

      // Delay between batches
      if (i + config.oddsConcurrency < eligible.length) {
        await sleep(config.oddsBatchDelay)
      }
    }

    const elapsed = Date.now() - start
    console.log(
      `[odds] Cycle done in ${elapsed}ms — ${eligible.length} races, ` +
      `${runnersTotal} runners, ${marketsTotal} markets, ${oddsTotal} odds` +
      (errors > 0 ? `, ${errors} errors` : '')
    )
  } catch (err) {
    console.error('[odds] Cycle error:', err instanceof Error ? err.message : err)
  } finally {
    _running = false
  }
}

async function processRaceOdds(
  cached: CachedRace,
  raceCache: Map<string, CachedRace>
): Promise<{ runners: number; markets: number; odds: number } | null> {
  const detail = await getRaceDetail(cached.mstRaceId)
  if (!detail) return null

  const race = detail.race

  // Check if finished/abandoned → remove from cache
  const status = race.ss
  if (status === 'FI' || status === 'AB') {
    raceCache.delete(cached.externalId)
    return null
  }

  // Update race detail
  const raceUpdates = transformRaceDetail(race)
  // Don't include source_data in every odds cycle — too much data
  delete raceUpdates.source_data
  await updateRace(cached.externalId, raceUpdates)

  // Update cached status
  if (raceUpdates.status) {
    cached.status = raceUpdates.status
  }

  // Get race UUID
  const raceId = await getRaceIdByExternalId(cached.externalId)
  if (!raceId) return null

  // Upsert runners (without finish_position)
  let runnersCount = 0
  if (race.horses && race.horses.length > 0) {
    const runners = transformHorsesToRunners(race.horses, raceId)
    runnersCount = await upsertRunners(runners)

    // Void odds for non-runners
    const nonRunners = runners.filter(r => r.is_non_runner)
    if (nonRunners.length > 0) {
      await voidNonRunnerOdds(raceId, nonRunners.map(r => r.runner_number))
    }
  }

  // Upsert markets + odds
  let marketsCount = 0
  let oddsCount = 0
  if (race.markets && race.markets.length > 0) {
    const marketsAndOdds = transformMarketsAndOdds(race.markets, raceId)
    const result = await upsertMarketsAndOdds(marketsAndOdds)
    marketsCount = result.markets
    oddsCount = result.odds
  }

  return { runners: runnersCount, markets: marketsCount, odds: oddsCount }
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd C:\Users\philp\Downloads\ippica-scraper && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd C:\Users\philp\Downloads\ippica-scraper
git add src/odds-loop.ts
git commit -m "feat: odds loop (runners/markets/odds update every 2min)"
```

---

### Task 9: Results Loop

**Files:**
- Create: `C:\Users\philp\Downloads\ippica-scraper\src\results-loop.ts`

- [ ] **Step 1: Write the results loop**

```typescript
import { getLast } from './mst-client.js'
import { transformLastToResults } from './transform.js'
import {
  getRacesByExternalIds,
  updateRace,
  updateRunnerPositions,
  settleRaceOdds,
  getUnsettledRaces,
  getRunnerPositions,
} from './supabase.js'
import type { CachedRace } from './types.js'

let _running = false

export async function runResultsCycle(
  raceCache: Map<string, CachedRace>
): Promise<void> {
  if (_running) {
    console.log('[results] Skipping — already running')
    return
  }
  _running = true
  const start = Date.now()

  try {
    let settledCount = 0

    // 1. Fetch latest results
    const lastResp = await getLast()
    if (lastResp) {
      // Handle finished races (with results)
      const results = transformLastToResults(lastResp.race)

      // Handle abandoned races (no results, ss=AB)
      const abandonedRaces = lastResp.race.filter(r => r.ss === 'AB')

      // Combine all race IDs to check
      const allExternalIds = [
        ...results.map(r => `mst:${r.mstRaceId}`),
        ...abandonedRaces.map(r => `mst:${r.id}`),
      ]
      const raceMap = allExternalIds.length > 0
        ? await getRacesByExternalIds([...new Set(allExternalIds)])
        : new Map()

      // Process finished races
      for (const result of results) {
        const externalId = `mst:${result.mstRaceId}`
        const raceInfo = raceMap.get(externalId)
        if (!raceInfo) continue
        if (raceInfo.status === 'finished' || raceInfo.status === 'abandoned') continue

        // Update race status to finished
        await updateRace(externalId, {
          status: 'finished',
          off_time: result.offTime,
          updated_at: new Date().toISOString(),
        } as any)

        // Update runner positions
        const positions = result.runners.map(r => ({
          runner_number: r.number,
          finish_position: r.position,
          disqualified: r.disqualified,
        }))
        await updateRunnerPositions(raceInfo.id, positions)

        // Settle odds
        const posMap = new Map<number, number>()
        for (const r of result.runners) posMap.set(r.number, r.position)

        const settled = await settleRaceOdds(raceInfo.id, posMap, false)
        settledCount += settled

        // Remove from cache
        raceCache.delete(externalId)

        console.log(
          `[results] Settled ${result.meetingName} race ${result.mstRaceId}: ` +
          `${positions.length} runners, ${settled} odds`
        )
      }

      // Process abandoned races — void all odds
      for (const race of abandonedRaces) {
        const externalId = `mst:${race.id}`
        const raceInfo = raceMap.get(externalId)
        if (!raceInfo) continue
        if (raceInfo.status === 'abandoned') continue

        await updateRace(externalId, {
          status: 'abandoned',
          updated_at: new Date().toISOString(),
        } as any)

        const settled = await settleRaceOdds(raceInfo.id, new Map(), true)
        settledCount += settled
        raceCache.delete(externalId)

        console.log(`[results] Abandoned ${race.meeting} race ${race.id}: ${settled} odds voided`)
      }
    }

    // 2. Unsettled check — re-settle any missed races
    const unsettledIds = await getUnsettledRaces()
    for (const raceId of unsettledIds) {
      const positions = await getRunnerPositions(raceId)
      if (positions.size === 0) continue

      const settled = await settleRaceOdds(raceId, positions, false)
      if (settled > 0) {
        console.log(`[results] Re-settled race ${raceId}: ${settled} odds`)
        settledCount += settled
      }
    }

    const elapsed = Date.now() - start
    if (settledCount > 0) {
      console.log(`[results] Cycle done in ${elapsed}ms — ${settledCount} odds settled`)
    }
  } catch (err) {
    console.error('[results] Cycle error:', err instanceof Error ? err.message : err)
  } finally {
    _running = false
  }
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd C:\Users\philp\Downloads\ippica-scraper && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd C:\Users\philp\Downloads\ippica-scraper
git add src/results-loop.ts
git commit -m "feat: results loop (settlement + unsettled retry every 1min)"
```

---

### Task 10: Main Entry Point

**Files:**
- Create: `C:\Users\philp\Downloads\ippica-scraper\src\index.ts`

- [ ] **Step 1: Write the main entry point**

```typescript
import config from '../config.json' with { type: 'json' }
import { initSupabase, bootstrapRaceCache, cleanupOldData } from './supabase.js'
import { runProgramCycle } from './program-loop.js'
import { runOddsCycle } from './odds-loop.js'
import { runResultsCycle } from './results-loop.js'
import type { CachedRace } from './types.js'

// Load .env (simple, no dotenv dependency)
import { readFileSync } from 'fs'
import { resolve } from 'path'

function loadEnv(): void {
  try {
    const envPath = resolve(import.meta.dirname ?? '.', '..', '.env')
    const lines = readFileSync(envPath, 'utf-8').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx < 0) continue
      const key = trimmed.slice(0, eqIdx)
      const value = trimmed.slice(eqIdx + 1)
      if (!process.env[key]) process.env[key] = value
    }
  } catch {
    // .env not found — env vars must be set externally
  }
}

const raceCache = new Map<string, CachedRace>()

async function main(): Promise<void> {
  console.log('=== Ippica Scraper v1.0 ===')
  console.log(`Base URL: ${config.baseUrl}`)
  console.log(`Intervals: program=${config.programIntervalMs / 1000}s, odds=${config.oddsIntervalMs / 1000}s, results=${config.resultsIntervalMs / 1000}s`)
  console.log(`Odds window: ${config.oddsWindowHours}h, concurrency: ${config.oddsConcurrency}\n`)

  // Load env & init
  loadEnv()
  initSupabase()

  // Bootstrap cache from DB
  const cached = await bootstrapRaceCache()
  for (const r of cached) raceCache.set(r.externalId, r)
  console.log(`[bootstrap] Loaded ${raceCache.size} active races from DB\n`)

  // Run first program cycle immediately
  await runProgramCycle(raceCache)

  // Run first odds cycle immediately
  await runOddsCycle(raceCache)

  // Start intervals
  setInterval(() => runProgramCycle(raceCache), config.programIntervalMs)
  setInterval(() => runOddsCycle(raceCache), config.oddsIntervalMs)
  setInterval(() => runResultsCycle(raceCache), config.resultsIntervalMs)

  // Daily cleanup at 04:00 UTC
  scheduleCleanup()

  console.log('\n[main] All loops started. Press Ctrl+C to stop.\n')
}

function scheduleCleanup(): void {
  const now = new Date()
  const next4am = new Date(now)
  next4am.setUTCHours(4, 0, 0, 0)
  if (next4am <= now) next4am.setUTCDate(next4am.getUTCDate() + 1)

  const delay = next4am.getTime() - now.getTime()
  setTimeout(async () => {
    try {
      const result = await cleanupOldData()
      console.log(`[cleanup] Purged ${result.races} races, ${result.meetings} meetings (>7 days)`)
    } catch (err) {
      console.error('[cleanup] Error:', err instanceof Error ? err.message : err)
    }
    // Reschedule for tomorrow
    scheduleCleanup()
  }, delay)

  console.log(`[cleanup] Next cleanup at ${next4am.toISOString()}`)
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Verify full project compiles**

Run: `cd C:\Users\philp\Downloads\ippica-scraper && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run locally (quick test)**

Run: `cd C:\Users\philp\Downloads\ippica-scraper && npm start`
Expected: Scraper starts, bootstraps cache, runs first program cycle (fetches meetings + races), runs first odds cycle (fetches race details), then enters interval mode. Let it run for ~30 seconds to verify data flows into Supabase, then Ctrl+C.

**Note**: This requires real SUPABASE_SERVICE_KEY in .env. If testing locally with placeholder key, it will error on Supabase calls but MST API calls should succeed.

- [ ] **Step 4: Commit**

```bash
cd C:\Users\philp\Downloads\ippica-scraper
git add src/index.ts
git commit -m "feat: main entry point with 3 loops + daily cleanup"
```

---

### Task 11: Deploy to VPS

**Files:**
- No new files — deploy existing project

- [ ] **Step 1: Get Supabase service role key from VPS**

The service role key is needed for direct DB writes. Get it from the existing Vincitu `.env.local`:

```bash
ssh scraper-vps "grep SUPABASE_SERVICE_ROLE_KEY /root/betssolution/.env.local"
```

Save this key — you'll need it for the ippica .env on VPS.

- [ ] **Step 2: Create directory and .env on VPS**

```bash
ssh scraper-vps "mkdir -p /root/ippica-scraper && cat > /root/ippica-scraper/.env << 'EOF'
SUPABASE_URL=https://xgnyqkmugnfzhdveeqom.supabase.co
SUPABASE_SERVICE_KEY=<paste service role key here>
EOF"
```

- [ ] **Step 3: Deploy scraper files**

From local machine:
```bash
cd C:\Users\philp\Downloads\ippica-scraper
tar czf /tmp/ippica.tar.gz --exclude=node_modules --exclude=.git --exclude=.env .
scp /tmp/ippica.tar.gz scraper-vps:/tmp/
ssh scraper-vps "cd /root/ippica-scraper && tar xzf /tmp/ippica.tar.gz && npm install"
```

- [ ] **Step 4: Create systemd service**

```bash
ssh scraper-vps "cat > /etc/systemd/system/ippica-scraper.service << 'EOF'
[Unit]
Description=Ippica MST Scraper
After=network.target

[Service]
Type=simple
WorkingDirectory=/root/ippica-scraper
ExecStart=/usr/bin/tsx src/index.ts
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF"
```

- [ ] **Step 5: Start the service**

```bash
ssh scraper-vps "systemctl daemon-reload && systemctl enable ippica-scraper && systemctl start ippica-scraper"
```

- [ ] **Step 6: Verify it's running**

```bash
ssh scraper-vps "systemctl status ippica-scraper"
ssh scraper-vps "journalctl -u ippica-scraper --no-pager -n 30"
```

Expected: Service active, logs show bootstrap + first program cycle + first odds cycle with data counts.

- [ ] **Step 7: Verify data in Supabase**

```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -c 'SELECT COUNT(*) as meetings FROM ippica_meetings; SELECT COUNT(*) as races FROM ippica_races; SELECT COUNT(*) as runners FROM ippica_runners; SELECT COUNT(*) as markets FROM ippica_markets; SELECT COUNT(*) as odds FROM ippica_odds;'"
```

Expected: Non-zero counts for all tables.

- [ ] **Step 8: Commit deploy notes**

```bash
cd C:\Users\philp\Downloads\ippica-scraper
git add -A
git commit -m "chore: v1.0 deployed to scraper-vps"
```
