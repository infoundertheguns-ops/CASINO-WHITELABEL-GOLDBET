# Player v2 Fix — Sprint A Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement task-by-task.

**Goal:** Restore correct prematch listing data on player v2 path by fixing 4 bugs: (1) classify_market_pattern mis-categorization filtering out DC/Goals Over/Under, (2) outcome cross-contamination across same markets_v2.id with different lines, (3) translation override sport_slug mismatch (English vs Italian), (4) payload size 21MB → <1MB via market whitelist + Redis cache.

**Repo:** `/root/betssolution-admin/` (migrations) + `/root/betssolution-player/` (helpers) on VPS `scraper-vps`.
**Branch admin:** `feature/plan-d-settlement-d1` HEAD `8c81dfa`.
**Player repo NOT git** — modifications tracked via memory + backups.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `supabase/migrations/163_classify_market_pattern_fix.sql` | Create | Add English market names (Double, Goals Over, Total Goals, etc.) to score regex |
| `supabase/migrations/164_oddsapi_translations_english_sports.sql` | Create | Add translation rows for sport_slug='football' (and other English sports) where Italian overrides exist |
| `/root/betssolution-player/lib/queries/sportsbook-listing-v2.ts` | Modify | (a) fetch outcomes with `line` column, (b) group outcomes by (market_id, line) instead of market_id, (c) add `source_market_name` whitelist filter, (d) Redis cache 30s TTL |
| `/root/betssolution-player/lib/redis-cache.ts` | Create | Singleton Redis wrapper with get/set helpers + JSON serialization |

No new vitest tests (player has no test infra). Manual smoke + browser verification.

---

## Task 1: Migration 163 — classify_market_pattern fix

**Files:** Create `supabase/migrations/163_classify_market_pattern_fix.sql`

### Step 1: Inspect current function

```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" -c "SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = '"'"'classify_market_pattern'"'"';"' 2>&1
```

Note the score regex line. Identify English market names that currently fall through to `special`.

### Step 2: Write migration

Create `supabase/migrations/163_classify_market_pattern_fix.sql`:

```sql
-- Migration 163: extend classify_market_pattern score regex
--
-- Bug discovered 2026-05-02: 'Double Chance' and 'Goals Over/Under'
-- (English odds-api raw names) were classified as 'special' because the
-- score regex only included Italian translated forms (Doppia/U/O) and a
-- few English variants (Both Teams, Match Result). The v_player_markets
-- view filters out 'special' → these markets were invisible on the player
-- listing. Add English English-language equivalents.

CREATE OR REPLACE FUNCTION public.classify_market_pattern(p_market_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_market_type ~* '^(Metodo Goal|Goal Method|Primi 10 Minuti|First 10|Special)' THEN 'special'
    WHEN p_market_type ~* '\y(Marcator|Giocator|Marca o Assist|Anytime|Player|Scorer|Multi Scorers|Team Goalscorer|Goalscorer)' THEN 'player'
    WHEN p_market_type ~* '\y(Corner|Angoli|Cartellin|Card |Cards|Tackles|Salvataggi|Goalkeeper Saves|Falli|Fouls|Tiri Totali|Tiri in Porta|Tiri Squadra|Team Shots|Match Shots|Shots on Target|Bookings|Doubles|Batter Walks|Hits)' THEN 'stats'
    WHEN p_market_type ~* '^(1X2|U/O|GG/NG|DC|DNB|HT/FT|ML|P/D|3-Way|2-Way|Doppia|Double|Pareggio|Vincente|Pari/Dispari|Odd/Even|Numero Goal|Esatto|Risultato|Linea Goal|Goal/No Goal|Goal Line|Goals Over|Goals Under|Goals Over/Under|Totale|Total|Handicap|Asian Handicap|European Handicap|Spread|Multigol|Multiscores|Alternative|Both Teams|Exact|First Team|Last Team|Number of|To Score|Tempo Regolamentare|Supplementari|Half Time|Full Time|1st Half|2nd Half|First Half|Second Half|Draw No Bet|Match Result|Final Score|Score after|Set Betting|Game Betting|Frame|Race To|Highest Scoring|Lowest Scoring|Penalty|To Win|Win and|Win Either|Winning Margin|Clean Sheet|5 Innings|7 Innings|9 Innings)' THEN 'score'
    ELSE 'special'
  END;
$function$;

-- Verification
DO $$
DECLARE r record;
BEGIN
  FOR r IN VALUES
    ('Double Chance', 'score'),
    ('Goals Over/Under', 'score'),
    ('Odd/Even', 'score'),
    ('ML', 'score'),
    ('Both Teams To Score', 'score'),
    ('Anytime Goalscorer', 'player'),
    ('Corners', 'stats'),
    ('Goal Method', 'special')
  LOOP
    IF classify_market_pattern(r.column1) <> r.column2 THEN
      RAISE EXCEPTION 'classify_market_pattern(%) returned %, expected %',
        r.column1, classify_market_pattern(r.column1), r.column2;
    END IF;
  END LOOP;
  RAISE NOTICE 'All classification assertions passed';
END $$;
```

### Step 3: Apply migration to prod DB

```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" -f /root/betssolution-admin/supabase/migrations/163_classify_market_pattern_fix.sql 2>&1'
```

Expected: `NOTICE: All classification assertions passed`.

### Step 4: Verify v_player_markets now exposes DC + U/O for Toronto FC

```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" -c "SELECT DISTINCT market_type, count(*) FROM v_player_markets WHERE event_id = '"'"'cf4ef871-f42f-4109-8317-eb5c9ddd1afe'"'"' AND (market_type ILIKE '"'"'%doppia%'"'"' OR market_type ILIKE '"'"'%double%'"'"' OR market_type ILIKE '"'"'%U/O%'"'"' OR market_type ILIKE '"'"'%totale%'"'"' OR market_type ILIKE '"'"'%goals over%'"'"') GROUP BY market_type ORDER BY market_type;"'
```

Expected: at least one row per (DC variant, U/O variant) translated.

### Step 5: Commit

```bash
ssh scraper-vps "cd /root/betssolution-admin && git add supabase/migrations/163_classify_market_pattern_fix.sql && git commit -m 'fix(db): classify_market_pattern recognizes English score market names

Migration 163 extends the score regex to include English odds-api
raw names (Double Chance, Goals Over/Under, Odd/Even) that previously
fell through to special and got filtered out by v_player_markets.

Direct cause of empty 1X2/DC/U/O columns in player listing post S6
cutover. DO block in migration verifies 8 known classifications.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>'"
```

---

## Task 2: Migration 164 — translation overrides for English sport_slugs

**Files:** Create `supabase/migrations/164_oddsapi_translations_english_sports.sql`

### Step 1: Identify English sport_slugs in events_v2

```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" -c "SELECT sport_slug, count(*) FROM events_v2 GROUP BY sport_slug ORDER BY count(*) DESC LIMIT 30;"'
```

Note all distinct sport_slug values. Most are English (football, basketball, tennis, etc.).

### Step 2: Identify Italian-anchored translation overrides

```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" -c "SELECT source_key, sport_slug, translated FROM oddsapi_translations WHERE kind = '"'"'market'"'"' AND sport_slug <> '"'"''"'"' ORDER BY source_key, sport_slug;"'
```

Note all rows. These overrides need English-sport_slug duplicates.

### Step 3: Write migration

Create `supabase/migrations/164_oddsapi_translations_english_sports.sql`:

```sql
-- Migration 164: duplicate Italian-anchored translation overrides for English sport_slugs
--
-- Bug discovered 2026-05-02: events_v2.sport_slug stores English values
-- (football, basketball, tennis...) per ingester convention, but
-- oddsapi_translations sport_slug overrides were seeded with Italian
-- values (calcio, basket, tennis...). Lookup misses → falls back to
-- default translation (e.g. ML → 'Vincente Incontro' instead of '1X2'
-- for football). Add English-language duplicates.

INSERT INTO oddsapi_translations (kind, source_key, sport_slug, parent_market, translated)
SELECT
  kind,
  source_key,
  CASE sport_slug
    WHEN 'calcio' THEN 'football'
    WHEN 'basket' THEN 'basketball'
    WHEN 'tennis' THEN 'tennis'
    WHEN 'pallamano' THEN 'handball'
    WHEN 'pallavolo' THEN 'volleyball'
    WHEN 'volley' THEN 'volleyball'
    WHEN 'rugby' THEN 'rugby'
    WHEN 'rugby-league' THEN 'rugby'
    WHEN 'hockey-ghiaccio' THEN 'icehockey'
    WHEN 'tennis-tavolo' THEN 'tabletennis'
    WHEN 'football-americano' THEN 'amfootball'
    WHEN 'arti-marziali' THEN 'mma'
    WHEN 'freccette' THEN 'darts'
    WHEN 'motociclismo' THEN 'motogp'
    WHEN 'pugilato' THEN 'boxing'
    WHEN 'boxe' THEN 'boxing'
    WHEN 'pallanuoto' THEN 'waterpolo'
    ELSE sport_slug  -- pass-through for already-English
  END AS sport_slug_en,
  parent_market,
  translated
FROM oddsapi_translations
WHERE sport_slug IN (
  'calcio','basket','tennis','pallamano','pallavolo','volley','rugby','rugby-league',
  'hockey-ghiaccio','tennis-tavolo','football-americano','arti-marziali','freccette',
  'motociclismo','pugilato','boxe','pallanuoto'
)
ON CONFLICT DO NOTHING;

-- Verification
DO $$
DECLARE n_added int;
BEGIN
  SELECT count(*) INTO n_added FROM oddsapi_translations WHERE sport_slug = 'football';
  IF n_added < 1 THEN
    RAISE EXCEPTION 'Expected at least 1 football translation, found %', n_added;
  END IF;
  RAISE NOTICE 'oddsapi_translations now has % rows for sport_slug=football', n_added;
END $$;
```

### Step 4: Apply

```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" -f /root/betssolution-admin/supabase/migrations/164_oddsapi_translations_english_sports.sql 2>&1'
```

### Step 5: Verify ML for football → 1X2

```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" -c "SELECT DISTINCT market_type FROM v_player_markets WHERE event_id = '"'"'cf4ef871-f42f-4109-8317-eb5c9ddd1afe'"'"' AND source_market_name = '"'"'ML'"'"';"'
```

Expected: `1X2` (or `Vincente Incontro` if football wasn't seeded — verify the function source first to know what should appear).

### Step 6: Commit

```bash
ssh scraper-vps "cd /root/betssolution-admin && git add supabase/migrations/164_oddsapi_translations_english_sports.sql && git commit -m 'fix(db): seed oddsapi_translations sport overrides for English sport_slugs

Migration 164 duplicates Italian-anchored sport_slug overrides
(calcio, basket, tennis, ...) onto their English counterparts
(football, basketball, tennis, ...) since events_v2 stores English
sport_slugs but the translation lookup expected Italian.

Direct cause: ML market on football events showed Vincente Incontro
default instead of 1X2 calcio override.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>'"
```

---

## Task 3: Helper fix — outcome grouping by (market_id, line) + line in select

**Files:** Modify `/root/betssolution-player/lib/queries/sportsbook-listing-v2.ts`

### Step 1: Read current helper

```bash
ssh scraper-vps 'cat /root/betssolution-player/lib/queries/sportsbook-listing-v2.ts | head -250'
```

### Step 2: Backup

```bash
ssh scraper-vps 'cp /root/betssolution-player/lib/queries/sportsbook-listing-v2.ts /root/betssolution-player/lib/queries/sportsbook-listing-v2.ts.bak-$(date +%Y%m%d-%H%M%S)'
```

### Step 3: Apply 3 changes to the file

**Change 3a**: outcomes select includes `line`

In the `// 3. Fetch outcomes (chunked)` section, change:
```ts
type ORow = {
  id: string; market_id: string; name: string; odds: number | string;
  is_active: boolean; is_suspended: boolean;
  manual_odds: number | string | null; manual_suspended: boolean;
};
```
to:
```ts
type ORow = {
  id: string; market_id: string; line: number | null; name: string; odds: number | string;
  is_active: boolean; is_suspended: boolean;
  manual_odds: number | string | null; manual_suspended: boolean;
};
```

And the supabase select string from `"id, market_id, name, odds, is_active, is_suspended, manual_odds, manual_suspended"` to `"id, market_id, line, name, odds, is_active, is_suspended, manual_odds, manual_suspended"`.

**Change 3b**: group outcomes by `(market_id, line)` instead of `market_id`

Replace:
```ts
const outcomesByMarket = new Map<string, ORow[]>();
for (const o of allOutcomes) {
  const list = outcomesByMarket.get(o.market_id) ?? [];
  list.push(o);
  outcomesByMarket.set(o.market_id, list);
}
```
with:
```ts
const outcomesByMarketLine = new Map<string, ORow[]>();
for (const o of allOutcomes) {
  const key = `${o.market_id}@${o.line ?? ''}`;
  const list = outcomesByMarketLine.get(key) ?? [];
  list.push(o);
  outcomesByMarketLine.set(key, list);
}
```

**Change 3c**: stitch step uses (market.id, market.line) key

In the markets.map(m, idx) block, change:
```ts
outcomes: (outcomesByMarket.get(m.id) ?? []).map(...)
```
to:
```ts
outcomes: (outcomesByMarketLine.get(`${m.id}@${m.line ?? ''}`) ?? []).map(...)
```

### Step 4: tsc check (player has TypeScript)

```bash
ssh scraper-vps 'source ~/.nvm/nvm.sh && cd /root/betssolution-player && npx tsc --noEmit 2>&1 | tail -5'
```
Expected: 0 errors.

### Step 5: No commit yet — proceed to Task 4 (perf whitelist) which modifies same file

---

## Task 4: Helper fix — market_name whitelist + Redis cache

**Files:**
- Modify: `/root/betssolution-player/lib/queries/sportsbook-listing-v2.ts` (whitelist)
- Create: `/root/betssolution-player/lib/redis-cache.ts` (cache singleton)
- Modify: `/root/betssolution-player/app/api/sportsbook/route.ts` (cache wrap)

### Step 1: Add market_name whitelist to listing helper

In `lib/queries/sportsbook-listing-v2.ts`, just before `// 3. Fetch outcomes (chunked)` (i.e., right after the markets fetch loop ends), add:

```ts
// Bug 4 perf fix: filter to listing-essential markets only.
// Detail page (sportsbook-detail-v2.ts) fetches all markets — this whitelist
// is for tile rendering only (1X2, GG/NG, U/O 2.5, DC and their HT variants).
const LISTING_MARKET_WHITELIST = new Set([
  // Football main
  "ML", "ML HT", "ML 2H",
  "Double Chance",
  "Both Teams To Score", "Both Teams To Score HT", "Both Teams To Score 2H",
  "Goals Over/Under", "Goals Over/Under HT", "Goals Over/Under 2H",
  "Half Time / Full Time",
  // Other sports main (basketball/tennis/etc. add as needed in follow-up)
]);

const filteredMarkets = allMarkets.filter((m) =>
  LISTING_MARKET_WHITELIST.has(m.source_market_name)
);
// Replace allMarkets refs below this point with filteredMarkets:
const marketIds = filteredMarkets.map((m) => m.id);
```

Then update the `marketsByEvent` build loop and the stitch loop to iterate `filteredMarkets` instead of `allMarkets`.

### Step 2: Create redis-cache.ts singleton

```bash
ssh scraper-vps 'cat /root/betssolution-player/lib/redis-cache.ts 2>/dev/null'
```
If exists, inspect; otherwise create.

Create `/root/betssolution-player/lib/redis-cache.ts`:

```ts
// Redis cache singleton for player listing payloads.
// Used by /api/sportsbook listing path with 30s TTL.
// Connection reused via global var to survive Next.js dev/prod hot-reload.

import { createClient, type RedisClientType } from "redis";

let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType> | null = null;

async function getClient(): Promise<RedisClientType> {
  if (client?.isOpen) return client;
  if (connecting) return connecting;
  connecting = (async () => {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL not set");
    const c = createClient({ url }) as RedisClientType;
    c.on("error", (err) => console.error("[redis-cache] error:", err.message));
    await c.connect();
    client = c;
    connecting = null;
    return c;
  })();
  return connecting;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const c = await getClient();
    const raw = await c.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn("[redis-cache] get failed:", (err as Error).message);
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    const c = await getClient();
    await c.set(key, JSON.stringify(value), { EX: ttlSeconds });
  } catch (err) {
    console.warn("[redis-cache] set failed:", (err as Error).message);
  }
}
```

### Step 3: Wrap listing in route.ts with cache

Find `app/api/sportsbook/route.ts` listing branch (the one calling `loadSportsbookListingV2`). Wrap with cache:

```ts
import { cacheGet, cacheSet } from "@/lib/redis-cache";

// Inside listing branch (after parsing filters, before calling loadSportsbookListingV2):
const cacheKey = `sb:listing:v2:${sportSlug || ""}:${leagueSlug || ""}:${statusList.join(",")}:${liveOnly ? 1 : 0}:${prematchOnly ? 1 : 0}:${limit}:${offset}`;
const cached = await cacheGet<{events: unknown[]}>(cacheKey);
if (cached) {
  return NextResponse.json(cached);
}

const events = await loadSportsbookListingV2(supabase, filters);
const payload = { events };
cacheSet(cacheKey, payload, 30); // fire-and-forget, 30s TTL
return NextResponse.json(payload);
```

(Variable names may differ — match what's in route.ts.)

### Step 4: Verify Redis is available

```bash
ssh scraper-vps 'redis-cli -a "$(grep ^REDIS_URL /root/betssolution-player/.env.local | sed -E "s|.*://[^:]*:([^@]+)@.*|\\1|")" PING 2>&1 | tail -1'
```
Expected: `PONG`. If Redis URL missing in .env.local, copy from admin: `ssh scraper-vps 'grep REDIS_URL /root/betssolution-admin/services/odds-api-ingester/.env >> /root/betssolution-player/.env.local'`.

### Step 5: tsc check

```bash
ssh scraper-vps 'source ~/.nvm/nvm.sh && cd /root/betssolution-player && npx tsc --noEmit 2>&1 | tail -5'
```
Expected: 0 errors.

### Step 6: Build + deploy + restart

```bash
ssh scraper-vps 'source ~/.nvm/nvm.sh && cd /root/betssolution-player && npm run build 2>&1 | tail -10 && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/ && systemctl restart betssolution-player && sleep 4 && systemctl is-active betssolution-player'
```

### Step 7: Smoke

```bash
# Check listing perf + size
ssh scraper-vps 'echo "=== Cold ===" && curl -s -o /tmp/sb.json -w "size=%{size_download}b time=%{time_total}s\n" "http://127.0.0.1:3001/api/sportsbook?sport=football&status=prematch&limit=50" && echo "=== Warm (cached) ===" && curl -s -o /dev/null -w "size=%{size_download}b time=%{time_total}s\n" "http://127.0.0.1:3001/api/sportsbook?sport=football&status=prematch&limit=50"'
```

Expected: cold size ~500KB-1MB, warm size same with time <100ms (cache hit).

```bash
# Sanity check payload has main markets
ssh scraper-vps 'python3 -c "import json; d=json.load(open(\"/tmp/sb.json\")); evs=d.get(\"events\",[]); print(f\"events={len(evs)}\"); [print(f\"  {e[\\\"home_team\\\"]} markets={len(e.get(\\\"markets\\\",[]))}\") for e in evs[:5]]"'
```

Expected: events have 4-10 markets each (whitelist filtered), all main types present.

### Step 8: Single commit for Tasks 3 + 4

```bash
ssh scraper-vps 'cp /root/betssolution-player/lib/queries/sportsbook-listing-v2.ts /tmp/v2-helper.ts && cp /root/betssolution-player/lib/redis-cache.ts /tmp/redis-cache.ts && cp /root/betssolution-player/app/api/sportsbook/route.ts /tmp/sportsbook-route.ts'
# Note: player repo is NOT git, so commits go to admin repo as artifacts
# Copy modified files into a docs/superpowers/artifacts/ folder in admin and commit there
ssh scraper-vps 'mkdir -p /root/betssolution-admin/docs/superpowers/artifacts/2026-05-02-player-v2-fix && cp /tmp/v2-helper.ts /tmp/redis-cache.ts /tmp/sportsbook-route.ts /root/betssolution-admin/docs/superpowers/artifacts/2026-05-02-player-v2-fix/ && cd /root/betssolution-admin && git add docs/superpowers/artifacts/2026-05-02-player-v2-fix/ && git commit -m "feat(player): listing v2 outcome fix + market whitelist + redis cache (artifacts)

Player repo is not git-tracked; modified files committed to admin
artifacts dir for audit trail. Live files at:
  /root/betssolution-player/lib/queries/sportsbook-listing-v2.ts
  /root/betssolution-player/lib/redis-cache.ts
  /root/betssolution-player/app/api/sportsbook/route.ts

Bug fixes:
- outcomes grouped by (market_id, line) instead of market_id alone
  (fixes cross-contamination across U/O/Handicap line variants)
- listing fetches only whitelist of main markets (~6 vs ~290)
  (perf: 21MB -> ~700KB payload)
- redis cache 30s TTL on listing (perf: warm hits <100ms)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

## Task 5: Final verification + browser test

### Step 1: Browser smoke

User opens `https://play.betssolution.com/login?kiosk=167281`, logs in, navigates to /pre-match/football. Verify:
- Events load <2s
- Each event row shows 1X2 (1, X, 2 quotes), DC (1X, X2, 12 quotes), GG/NG, U/O 2.5 quotes
- Click event detail page — should still work (uses different helper)

### Step 2: Show git log delta

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git log --oneline 8c81dfa..HEAD'
```

### Step 3: Hand off to user

Ask user to test the kiosk. If green, proceed with push to origin. If issues, surface.

---

## Out of scope (do not do)

- Push to origin without user approval
- Modify ingester to use Italian sport_slugs (architectural shift)
- Refactor v_player_markets to per-line synthetic id (helper-side fix sufficient)
- Add Redis cache to detail endpoint (separate decision)
- Add per-sport listing whitelists beyond football main markets (follow-up)
- Restore derive heartbeat (cutover decision intentional)
