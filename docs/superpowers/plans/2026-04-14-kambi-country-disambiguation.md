# Kambi Country/Tour Disambiguation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Risolvere il bug di dedup delle leghe Kambi omonime ("Premier League" per Etiopia/Iraq/Inghilterra collassate in singola riga) aggiungendo colonne `country_code`/`tour_code` al DB + logica di estrazione nello scraper + reset completo dei dati esistenti.

**Architecture:** Migration DB split in due fasi (pre/post TRUNCATE per rispettare CHECK constraint). Scraper TypeScript aggiunge `classifyGroup()` helper con whitelist paesi ISO. Helper RPC `upsert_league` centralizza logica di upsert condivisa tra `upsert_prematch_batch` e `upsert_live_batch`. Full reset dei dati (fase test, zero bet reali).

**Tech Stack:**
- DB: PostgreSQL 17.6 (Supabase), migrations SQL
- Scraper: Node 20, TypeScript, HTTP-only Kambi API
- Repo 1: `C:\Users\philp\Downloads\betssolution\betssolution-admin\` (migrations + RPC)
- Repo 2: `C:\Users\philp\Downloads\kambi-scraper\` (transform + payload)
- Deploy: scraper-vps via SSH

**Spec reference:** `docs/superpowers/specs/2026-04-14-kambi-country-disambiguation-design.md`

---

## File Structure

**betssolution-admin**:
- Create: `supabase/migrations/034_league_country_code_part1.sql` (pre-TRUNCATE: columns + CHECK NOT VALID)
- Create: `supabase/migrations/034_league_country_code_part2.sql` (post-TRUNCATE: VALIDATE + INDEX + RPC)
- Create: `supabase/migrations/035_rollback_034.sql` (rollback manuale, non eseguito in flusso normale)

**kambi-scraper**:
- Create: `src/country-codes.ts` (KNOWN_COUNTRY_SLUGS set + classifyGroup function)
- Create: `src/country-codes.test.ts` (unit test assertions script per classifyGroup)
- Modify: `src/transform.ts` (aggiungi country_code/tour_code a VincituLiveEvent/VincituPrematchEvent, rimpiazza extractCountry con extractGroupInfo)
- Modify: `src/test.ts` (aggiungi sampling + asserzioni di validità payload dry-run)

**Out of scope (no modifica richiesta)**:
- `src/kambi-client.ts` (il path[1] è già estratto dall'event)
- `src/live-loop.ts`, `src/prematch-loop.ts` (usano transform.ts che è il punto di cambio)
- `src/push-to-vincitu.ts` (payload già trasparente, i nuovi campi passano come JSON normale)
- Frontend betssolution-admin (workaround `"name (country)"` nel ticket si può rimuovere in follow-up, non bloccante)

---

## Task 1: Migration 034 Part 1 — Aggiungi colonne + CHECK NOT VALID

**Files:**
- Create: `C:\Users\philp\Downloads\betssolution\betssolution-admin\supabase\migrations\034_league_country_code_part1.sql`

- [ ] **Step 1: Crea il file SQL**

```sql
-- ═══════════════════════════════════════════════════════════
-- Migration 034 Part 1: Aggiungi country_code + tour_code a leagues
-- CHECK constraints come NOT VALID (dati esistenti hanno NULL in entrambi).
-- Part 2 (VALIDATE + INDEX + RPC) va eseguito DOPO il TRUNCATE.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE leagues
  ADD COLUMN country_code VARCHAR(32),
  ADD COLUMN tour_code    VARCHAR(32);

-- Almeno uno dei due deve essere popolato (validato solo su INSERT futuri fino a VALIDATE)
ALTER TABLE leagues ADD CONSTRAINT leagues_country_or_tour_chk
  CHECK (country_code IS NOT NULL OR tour_code IS NOT NULL) NOT VALID;

-- Mutua esclusione (XOR): una lega è country-based O tour-based, non entrambi
ALTER TABLE leagues ADD CONSTRAINT leagues_country_xor_tour_chk
  CHECK (NOT (country_code IS NOT NULL AND tour_code IS NOT NULL)) NOT VALID;

COMMENT ON COLUMN leagues.country_code IS
  'Kambi country slug (es. iraq, italy, usa). NULL se lega è tour-based.';
COMMENT ON COLUMN leagues.tour_code IS
  'Kambi tour/organization slug (es. atp, pga-tour, formula-1). NULL se lega è country-based.';
```

- [ ] **Step 2: Applica la migration su DB prod via SSH**

Run:
```bash
scp C:/Users/philp/Downloads/betssolution/betssolution-admin/supabase/migrations/034_league_country_code_part1.sql scraper-vps:/tmp/
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -f /tmp/034_league_country_code_part1.sql"
```

Expected: 2 `ALTER TABLE` success, 2 `COMMENT` success, no errors.

- [ ] **Step 3: Verifica schema**

Run:
```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -c \"\\d leagues\" | grep -E 'country_code|tour_code|chk'"
```

Expected: 4 righe (2 columns + 2 constraints).

- [ ] **Step 4: Commit**

```bash
cd C:/Users/philp/Downloads/betssolution/betssolution-admin
git add supabase/migrations/034_league_country_code_part1.sql
git commit -m "feat(db): migration 034 part1 - add country_code/tour_code columns + CHECK NOT VALID

Part 1 of Kambi league disambiguation fix. Adds nullable columns with
deferred-validation CHECK constraints. Part 2 applies VALIDATE + unique
index + new RPC after data TRUNCATE.

Refs: docs/superpowers/specs/2026-04-14-kambi-country-disambiguation-design.md"
```

---

## Task 2: Scraper — crea `country-codes.ts` con whitelist + classifyGroup

**Files:**
- Create: `C:\Users\philp\Downloads\kambi-scraper\src\country-codes.ts`

- [ ] **Step 1: Scrivi la whitelist + funzione classifyGroup**

```typescript
/**
 * Kambi group classification: country-based vs tour-based.
 *
 * path[1] in un evento Kambi può essere:
 *   - un paese reale  → country_code (calcio, basket nazionali, cricket, ecc.)
 *   - un tour/organizzazione → tour_code (tennis ATP, golf PGA, F1, esports, ecc.)
 *
 * Strategia: lookup contro whitelist ISO. Match → country. Else → tour.
 */

/**
 * Slug paese noti da Kambi group.json (localizzazione inglese + italiano).
 * Source: Kambi API group tree + ISO-3166.
 * Lista curata, aggiungere nuovi paesi osservati in produzione.
 */
const KNOWN_COUNTRY_SLUGS = new Set<string>([
  // Europa
  'italy', 'italia',
  'england', 'inghilterra',
  'scotland', 'scozia',
  'wales', 'galles',
  'ireland', 'irlanda',
  'northern-ireland',
  'france', 'francia',
  'germany', 'germania',
  'spain', 'spagna',
  'portugal', 'portogallo',
  'netherlands', 'olanda', 'paesi-bassi',
  'belgium', 'belgio',
  'switzerland', 'svizzera',
  'austria',
  'denmark', 'danimarca',
  'sweden', 'svezia',
  'norway', 'norvegia',
  'finland', 'finlandia',
  'iceland', 'islanda',
  'poland', 'polonia',
  'czech-republic', 'repubblica-ceca',
  'slovakia', 'slovacchia',
  'hungary', 'ungheria',
  'romania',
  'bulgaria',
  'greece', 'grecia',
  'turkey', 'turchia',
  'russia',
  'ukraine', 'ucraina',
  'belarus', 'bielorussia',
  'croatia', 'croazia',
  'serbia',
  'slovenia',
  'bosnia-herzegovina', 'bosnia-and-herzegovina',
  'montenegro',
  'macedonia', 'north-macedonia',
  'albania',
  'kosovo',
  'estonia',
  'latvia', 'lettonia',
  'lithuania', 'lituania',
  'moldova',
  'georgia',
  'armenia',
  'azerbaijan',
  'cyprus', 'cipro',
  'malta',
  'luxembourg', 'lussemburgo',
  'faroe-islands', 'isole-faroe',
  'andorra',
  'liechtenstein',
  'monaco',
  'san-marino',

  // Americhe
  'usa', 'united-states', 'stati-uniti',
  'canada',
  'mexico', 'messico',
  'brazil', 'brasile',
  'argentina',
  'chile', 'cile',
  'colombia',
  'uruguay',
  'paraguay',
  'peru', 'peru',
  'ecuador',
  'bolivia',
  'venezuela',
  'costa-rica',
  'panama',
  'guatemala',
  'honduras',
  'el-salvador',
  'nicaragua',
  'jamaica',
  'cuba',
  'dominican-republic', 'repubblica-dominicana',
  'haiti',
  'trinidad-and-tobago',
  'barbados',
  'saint-kitts-and-nevis',

  // Asia
  'china', 'cina',
  'japan', 'giappone',
  'south-korea', 'corea-del-sud',
  'north-korea', 'corea-del-nord',
  'india',
  'pakistan',
  'bangladesh',
  'sri-lanka',
  'nepal',
  'bhutan',
  'maldives', 'maldive',
  'afghanistan',
  'iran',
  'iraq',
  'syria', 'siria',
  'lebanon', 'libano',
  'israel', 'israele',
  'jordan', 'giordania',
  'saudi-arabia', 'arabia-saudita',
  'uae', 'emirati-arabi-uniti', 'united-arab-emirates',
  'qatar',
  'bahrain',
  'kuwait',
  'oman',
  'yemen',
  'palestine', 'palestina',
  'turkmenistan',
  'uzbekistan',
  'kazakhstan', 'kazakistan',
  'kyrgyzstan',
  'tajikistan',
  'mongolia',
  'thailand', 'thailandia',
  'vietnam',
  'laos',
  'cambodia', 'cambogia',
  'myanmar',
  'malaysia',
  'singapore',
  'indonesia',
  'philippines', 'filippine',
  'taiwan',
  'hong-kong',
  'macau',

  // Africa
  'south-africa', 'sudafrica',
  'egypt', 'egitto',
  'morocco', 'marocco',
  'algeria',
  'tunisia',
  'libya', 'libia',
  'sudan',
  'ethiopia', 'etiopia',
  'eritrea',
  'somalia',
  'kenya',
  'tanzania',
  'uganda',
  'rwanda', 'ruanda',
  'burundi',
  'nigeria',
  'ghana',
  'ivory-coast', 'costa-d-avorio',
  'senegal',
  'mali',
  'burkina-faso',
  'niger',
  'cameroon', 'camerun',
  'gabon',
  'congo',
  'dr-congo',
  'angola',
  'zambia',
  'zimbabwe',
  'mozambique', 'mozambico',
  'madagascar',
  'mauritius',
  'seychelles',
  'namibia',
  'botswana',
  'sierra-leone',
  'liberia',
  'guinea',
  'chad', 'ciad',
  'mauritania',

  // Oceania
  'australia',
  'new-zealand', 'nuova-zelanda',
  'fiji',
  'papua-new-guinea',
  'samoa',
  'tonga',
  'vanuatu',
  'solomon-islands',
]);

export interface GroupInfo {
  type: 'country' | 'tour';
  code: string;       // slug (es. 'iraq', 'atp')
  name: string;       // display name (es. 'Iraq', 'ATP')
}

/**
 * Converte un nome di gruppo Kambi (path[1]) nel formato slug URL-safe.
 * Rimuove spazi, apostrofi, accenti. Minuscolo.
 */
export function slugifyGroupName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // rimuove accenti
    .replace(/['`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Classifica un gruppo Kambi (path[1]) come country o tour.
 *
 * @param groupName - nome raw dal Kambi path (es. "Iraq", "ATP", "Formula 1")
 * @returns GroupInfo con type='country'|'tour', code=slug, name=originale
 */
export function classifyGroup(groupName: string): GroupInfo {
  const code = slugifyGroupName(groupName);
  const type = KNOWN_COUNTRY_SLUGS.has(code) ? 'country' : 'tour';
  return { type, code, name: groupName };
}
```

- [ ] **Step 2: Commit della whitelist + funzione**

```bash
cd C:/Users/philp/Downloads/kambi-scraper
git add src/country-codes.ts
git commit -m "feat: add classifyGroup helper with country whitelist

Distingue country-based sports (calcio, basket, cricket) da tour-based
(tennis ATP, golf PGA, F1, esports) tramite lookup contro whitelist
di ~200 slug paese ISO.

Refs: docs/superpowers/specs/2026-04-14-kambi-country-disambiguation-design.md"
```

---

## Task 3: Scraper — test unit per classifyGroup

**Files:**
- Create: `C:\Users\philp\Downloads\kambi-scraper\src\country-codes.test.ts`

- [ ] **Step 1: Scrivi lo script di test con asserzioni**

```typescript
/**
 * Test manuale di classifyGroup + slugifyGroupName.
 * Run: npx tsx src/country-codes.test.ts
 */

import { classifyGroup, slugifyGroupName } from './country-codes.js';

let failed = 0;
let passed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ FAIL: ${msg}`);
  }
}

console.log('═══ slugifyGroupName ═══');
assert(slugifyGroupName('Iraq') === 'iraq', "Iraq → iraq");
assert(slugifyGroupName('Saudi Arabia') === 'saudi-arabia', "Saudi Arabia → saudi-arabia");
assert(slugifyGroupName("Côte d'Ivoire") === 'cote-d-ivoire', "accent+apostrophe handled");
assert(slugifyGroupName('  USA  ') === 'usa', "trim whitespace");

console.log('\n═══ classifyGroup — country sports ═══');
{
  const r = classifyGroup('Iraq');
  assert(r.type === 'country', "Iraq.type === country");
  assert(r.code === 'iraq', "Iraq.code === iraq");
  assert(r.name === 'Iraq', "Iraq.name preserved");
}
{
  const r = classifyGroup('Italy');
  assert(r.type === 'country', "Italy.type === country");
}
{
  const r = classifyGroup('Etiopia');  // nome localizzato IT
  assert(r.type === 'country', "Etiopia (IT) riconosciuto come country");
}
{
  const r = classifyGroup('Inghilterra');
  assert(r.type === 'country', "Inghilterra (IT) riconosciuto come country");
}

console.log('\n═══ classifyGroup — tour sports ═══');
{
  const r = classifyGroup('ATP');
  assert(r.type === 'tour', "ATP.type === tour");
  assert(r.code === 'atp', "ATP.code === atp");
}
{
  const r = classifyGroup('PGA Tour');
  assert(r.type === 'tour', "PGA Tour → tour");
  assert(r.code === 'pga-tour', "PGA Tour.code === pga-tour");
}
{
  const r = classifyGroup('Formula 1');
  assert(r.type === 'tour', "Formula 1 → tour");
  assert(r.code === 'formula-1', "Formula 1.code === formula-1");
}
{
  const r = classifyGroup('UFC');
  assert(r.type === 'tour', "UFC → tour");
}
{
  const r = classifyGroup('Counter-Strike');
  assert(r.type === 'tour', "Counter-Strike → tour");
  assert(r.code === 'counter-strike', "code normalizzato");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Esegui i test e verifica che passino**

Run:
```bash
cd C:/Users/philp/Downloads/kambi-scraper
npx tsx src/country-codes.test.ts
```

Expected: `XX passed, 0 failed`, exit code 0.

- [ ] **Step 3: Commit dei test**

```bash
git add src/country-codes.test.ts
git commit -m "test: classifyGroup handles country/tour correctly

Verifica casi noti di sport country-based (Iraq, Italy, Etiopia, Inghilterra)
e tour-based (ATP, PGA Tour, Formula 1, UFC, Counter-Strike)."
```

---

## Task 4: Scraper — modifica `transform.ts` per aggiungere country_code/tour_code

**Files:**
- Modify: `C:\Users\philp\Downloads\kambi-scraper\src\transform.ts` (lines ~23-52 types, ~223-229 extractCountry, ~381-423 transformLiveEvent/transformPrematchEvent)

- [ ] **Step 1: Aggiungi import di classifyGroup**

Insert dopo la riga `import type { KambiEvent, ... }` (riga ~14):

```typescript
import { classifyGroup, type GroupInfo } from './country-codes.js';
```

- [ ] **Step 2: Estendi VincituLiveEvent e VincituPrematchEvent**

Modifica l'interfaccia `VincituLiveEvent` (righe ~23-40) aggiungendo:

```typescript
export interface VincituLiveEvent {
  external_id: string;
  home_team: string;
  away_team: string;
  sport: string;
  league: string;
  country?: string;
  country_code?: string;    // NUOVO: slug Kambi (es. 'iraq')
  tour_code?: string;       // NUOVO: slug tour (es. 'atp')
  starts_at: string;
  status: string;
  minute?: number;
  period?: string;
  home_score?: number;
  away_score?: number;
  half_score_home?: number[];
  half_score_away?: number[];
  stats?: Record<string, [number, number]>;
  markets: VincituMarket[];
}
```

Stessa modifica a `VincituPrematchEvent` (righe ~42-52).

- [ ] **Step 3: Sostituisci `extractCountry` con `extractGroupInfo`**

Trova la funzione `extractCountry` (righe ~223-229):

```typescript
/** Extract country from Kambi event path (e.g. ["Football", "Italy", "Serie A"] → "Italy") */
function extractCountry(event: KambiEvent): string | undefined {
  if (event.path && event.path.length >= 3) {
    return event.path[1].name;
  }
  return undefined;
}
```

Sostituiscila con:

```typescript
/**
 * Estrae country/tour info dal Kambi event path.
 *
 * Path standard: ["Football", "Italy", "Serie A"]
 *   → path[0]=sport, path[1]=country/tour, path[2+]=league
 *
 * Fallback se path.length < 2: tour_code = 'uncategorized' (soddisfa CHECK OR)
 */
function extractGroupInfo(event: KambiEvent): GroupInfo {
  if (event.path && event.path.length >= 2) {
    const parent = event.path[1];
    return classifyGroup(parent.name);
  }
  return { type: 'tour', code: 'uncategorized', name: 'Uncategorized' };
}

/** Legacy: ritorna il display name del country (preserva campo `country` nel payload) */
function extractCountryName(event: KambiEvent): string | undefined {
  const info = extractGroupInfo(event);
  return info.type === 'country' ? info.name : undefined;
}
```

- [ ] **Step 4: Aggiorna `transformLiveEvent` per popolare country_code/tour_code**

Trova `transformLiveEvent` (righe ~381-399). Sostituisci il blocco di ritorno:

```typescript
  const league = extractLeague(event);
  const country = extractCountry(event);  // <- VECCHIA RIGA, RIMUOVI
  const teams = getTeamNames(event);
  return {
    external_id: `kambi:${event.id}`,
    home_team: teams.home,
    away_team: teams.away,
    sport: mapSport(event.sport, league),
    league,
    country,                                 // <- VECCHIA RIGA, RIMUOVI
    starts_at: event.start,
    status: 'live',
    // ...
```

con:

```typescript
  const league = extractLeague(event);
  const groupInfo = extractGroupInfo(event);
  const teams = getTeamNames(event);
  return {
    external_id: `kambi:${event.id}`,
    home_team: teams.home,
    away_team: teams.away,
    sport: mapSport(event.sport, league),
    league,
    country: groupInfo.type === 'country' ? groupInfo.name : undefined,
    country_code: groupInfo.type === 'country' ? groupInfo.code : undefined,
    tour_code: groupInfo.type === 'tour' ? groupInfo.code : undefined,
    starts_at: event.start,
    status: 'live',
    // ...
```

- [ ] **Step 5: Aggiorna `transformPrematchEvent` in modo analogo**

Applica la stessa sostituzione a `transformPrematchEvent` (righe ~409-423).

- [ ] **Step 6: Build TypeScript**

Run:
```bash
cd C:/Users/philp/Downloads/kambi-scraper
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/transform.ts
git commit -m "feat: emit country_code/tour_code in scraper payload

- extractGroupInfo classifies path[1] as country or tour via whitelist
- VincituLiveEvent/VincituPrematchEvent types extended with both optional fields
- Legacy 'country' field still populated for backwards-compat con campo leagues.country

Refs: docs/superpowers/specs/2026-04-14-kambi-country-disambiguation-design.md"
```

---

## Task 5: Scraper — estendi `test.ts` con asserzioni dry-run su payload

**Files:**
- Modify: `C:\Users\philp\Downloads\kambi-scraper\src\test.ts`

- [ ] **Step 1: Aggiungi una funzione `testCoverage` che valida il payload**

Aggiungi in coda a `test.ts` (prima della chiamata `main()` o simile):

```typescript
/**
 * Campiona 10 eventi per sport, verifica che ogni evento abbia country_code XOR tour_code.
 * Fail se qualche evento è senza entrambi (violerebbe CHECK constraint).
 */
async function testCoverage() {
  log('TEST', '\n═══ COVERAGE: country_code/tour_code ═══');

  // Campiona country-based (football) + tour-based (tennis, golf) per catchare
  // misclassificazione in entrambe le direzioni
  const sports = ['football', 'tennis', 'golf'];
  let ok = 0, violations = 0;
  let countrySeen = 0, tourSeen = 0;

  for (const sport of sports) {
    const prematch = await getPrematchBySport(sport);
    if (!prematch?.events) {
      log('TEST', `${sport}: no events`);
      continue;
    }

    const sample = prematch.events.slice(0, 5);
    for (const ev of sample) {
      const transformed = transformPrematchEvent(ev, []);
      const hasCountry = !!transformed.country_code;
      const hasTour = !!transformed.tour_code;

      if (hasCountry === hasTour) {
        // Entrambi o nessuno → violazione CHECK XOR o CHECK OR
        log('TEST', `✗ ${ev.englishName} (${sport}): country_code=${transformed.country_code} tour_code=${transformed.tour_code}`);
        violations++;
      } else {
        ok++;
        if (hasCountry) countrySeen++;
        if (hasTour) tourSeen++;
      }
    }
  }

  log('TEST', `\n${ok} ok, ${violations} violations`);
  log('TEST', `country-based seen: ${countrySeen}, tour-based seen: ${tourSeen}`);
  if (violations > 0) {
    throw new Error(`Coverage test failed: ${violations} events violate country XOR tour`);
  }
  if (countrySeen === 0 || tourSeen === 0) {
    throw new Error(`Coverage test inconclusive: only one branch exercised (country=${countrySeen}, tour=${tourSeen})`);
  }
}
```

Aggiungi la chiamata nel main o in coda a `testLive()`:

```typescript
await testCoverage();
```

- [ ] **Step 2: Esegui il test**

Run:
```bash
cd C:/Users/philp/Downloads/kambi-scraper
npm test
```

Expected: `10 ok, 0 violations` (o simile). Exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/test.ts
git commit -m "test: assert country_code XOR tour_code in scraper payload sample

Dry-run coverage su 10 eventi prematch: ogni evento deve avere esattamente
uno dei due campi popolato (altrimenti CHECK constraint lato DB fallirebbe)."
```

---

## Task 6: Migration 034 Part 2 — VALIDATE + INDEX + RPC helper + RPC update

**Files:**
- Create: `C:\Users\philp\Downloads\betssolution\betssolution-admin\supabase\migrations\034_league_country_code_part2.sql`

- [ ] **Step 1: Scrivi la migration Part 2 completa**

```sql
-- ═══════════════════════════════════════════════════════════
-- Migration 034 Part 2: VALIDATE CHECK + UNIQUE INDEX + RPC update
--
-- Precondizione: tabella `leagues` deve essere VUOTA (TRUNCATE già eseguito).
-- Se ci sono righe residue con country_code=NULL AND tour_code=NULL,
-- la VALIDATE CONSTRAINT fallirà. Ordine:
--   1. VALIDATE CHECK (on empty table, passa sempre)
--   2. CREATE UNIQUE INDEX (expr-based)
--   3. DROP old UNIQUE (leagues_slug_key)
--   4. CREATE OR REPLACE FUNCTION upsert_league (helper condivisa)
--   5. CREATE OR REPLACE FUNCTION upsert_prematch_batch (usa helper)
--   6. CREATE OR REPLACE FUNCTION upsert_live_batch (usa helper)
-- ═══════════════════════════════════════════════════════════

-- ── 1. VALIDATE CHECK constraints (tabella vuota, no-op di fatto) ──
ALTER TABLE leagues VALIDATE CONSTRAINT leagues_country_or_tour_chk;
ALTER TABLE leagues VALIDATE CONSTRAINT leagues_country_xor_tour_chk;

-- ── 2. UNIQUE INDEX composita (expr-based su COALESCE) ──
CREATE UNIQUE INDEX uq_leagues_sport_slug_dedup
  ON leagues(sport_id, slug, COALESCE(country_code, tour_code));

-- ── 3. Drop vecchia UNIQUE(slug) — sostituita dall'index composita ──
ALTER TABLE leagues DROP CONSTRAINT leagues_slug_key;

-- ── 4. Helper function: upsert_league ──
CREATE OR REPLACE FUNCTION upsert_league(
  p_sport_id UUID,
  p_name TEXT,
  p_sport_slug TEXT,
  p_country TEXT,
  p_country_code TEXT,
  p_tour_code TEXT
) RETURNS UUID
LANGUAGE plpgsql AS $fn$
DECLARE
  v_country_code TEXT;
  v_tour_code TEXT;
  v_disambiguator TEXT;
  v_slug TEXT;
  v_league_id UUID;
BEGIN
  -- Normalizzazione input
  v_country_code := NULLIF(p_country_code, '');
  v_tour_code   := NULLIF(p_tour_code,   '');

  -- Fallback: entrambi NULL → 'uncategorized' come tour
  IF v_country_code IS NULL AND v_tour_code IS NULL THEN
    v_tour_code := 'uncategorized';
  END IF;

  -- XOR enforcement: se entrambi popolati, prediligi country_code
  IF v_country_code IS NOT NULL AND v_tour_code IS NOT NULL THEN
    v_tour_code := NULL;
  END IF;

  v_disambiguator := COALESCE(v_country_code, v_tour_code);
  v_slug := p_sport_slug || '-' || slugify(p_name) || '-' || v_disambiguator;

  INSERT INTO leagues (sport_id, name, slug, country, country_code, tour_code, is_active)
  VALUES (p_sport_id, p_name, v_slug, p_country, v_country_code, v_tour_code, TRUE)
  ON CONFLICT (sport_id, slug, COALESCE(country_code, tour_code)) DO UPDATE SET
    name = EXCLUDED.name,
    country = COALESCE(EXCLUDED.country, leagues.country)
  RETURNING id INTO v_league_id;

  RETURN v_league_id;
END;
$fn$;

-- ── 5. upsert_prematch_batch — usa helper ──
CREATE OR REPLACE FUNCTION upsert_prematch_batch(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '60s'
AS $fn$
DECLARE
  v_events JSONB;
  v_ev JSONB;
  v_processed INT := 0;
  v_errors JSONB := '[]'::JSONB;
  v_sport_slug TEXT;
  v_sport_id UUID;
  v_league_id UUID;
  v_event_id UUID;
  v_is_live BOOLEAN;
  v_market JSONB;
  v_market_slug TEXT;
  v_market_id UUID;
  v_market_line NUMERIC;
  v_outcome JSONB;
  v_incoming_types TEXT[];
  v_overview_only BOOLEAN;
  v_batch_count INT;
  v_now TIMESTAMPTZ := now();
BEGIN
  v_events := payload -> 'events';
  IF v_events IS NULL OR jsonb_array_length(v_events) = 0 THEN
    RETURN jsonb_build_object('processed', 0, 'errors', jsonb_build_array('events array required'));
  END IF;

  FOR v_ev IN SELECT * FROM jsonb_array_elements(v_events)
  LOOP
    BEGIN
      IF v_ev ->> 'external_id' IS NULL OR v_ev ->> 'sport' IS NULL
         OR v_ev ->> 'league' IS NULL OR v_ev ->> 'home_team' IS NULL
         OR v_ev ->> 'away_team' IS NULL OR v_ev ->> 'starts_at' IS NULL THEN
        v_errors := v_errors || jsonb_build_array(
          COALESCE(v_ev ->> 'external_id', 'unknown') || ': missing required fields'
        );
        CONTINUE;
      END IF;

      v_overview_only := COALESCE((v_ev ->> 'overview_only')::BOOLEAN, FALSE);

      v_sport_slug := slugify(v_ev ->> 'sport');
      INSERT INTO sports (name, slug, icon, is_active)
      VALUES (v_ev ->> 'sport', v_sport_slug, sport_icon(v_sport_slug), TRUE)
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id INTO v_sport_id;

      -- NEW: usa helper upsert_league (estrae country_code/tour_code dal payload)
      v_league_id := upsert_league(
        v_sport_id,
        v_ev ->> 'league',
        v_sport_slug,
        v_ev ->> 'country',
        v_ev ->> 'country_code',
        v_ev ->> 'tour_code'
      );

      SELECT id, is_live INTO v_event_id, v_is_live
      FROM events WHERE external_id = v_ev ->> 'external_id' LIMIT 1;

      IF v_event_id IS NOT NULL AND v_is_live THEN
        v_processed := v_processed + 1;
        CONTINUE;
      END IF;

      IF v_event_id IS NOT NULL THEN
        UPDATE events SET
          sport_id = v_sport_id, league_id = v_league_id,
          home_team = v_ev ->> 'home_team', away_team = v_ev ->> 'away_team',
          starts_at = (v_ev ->> 'starts_at')::TIMESTAMPTZ,
          status = COALESCE(v_ev ->> 'status', 'prematch'),
          is_live = FALSE, updated_at = v_now
        WHERE id = v_event_id;
      ELSE
        INSERT INTO events (external_id, sport_id, league_id, home_team, away_team, starts_at, status, is_live, updated_at)
        VALUES (v_ev ->> 'external_id', v_sport_id, v_league_id,
          v_ev ->> 'home_team', v_ev ->> 'away_team',
          (v_ev ->> 'starts_at')::TIMESTAMPTZ,
          COALESCE(v_ev ->> 'status', 'prematch'), FALSE, v_now)
        RETURNING id INTO v_event_id;
      END IF;

      v_processed := v_processed + 1;

      -- Source markets count: sovrascrive direttamente (post-fix 2026-03-22)
      IF v_ev -> 'markets' IS NOT NULL
         AND jsonb_array_length(COALESCE(v_ev -> 'markets', '[]'::JSONB)) > 0 THEN
        v_batch_count := jsonb_array_length(v_ev -> 'markets');
        UPDATE events SET source_markets_count = v_batch_count
        WHERE id = v_event_id;
      END IF;

      IF v_ev -> 'markets' IS NULL OR jsonb_array_length(COALESCE(v_ev -> 'markets', '[]'::JSONB)) = 0 THEN
        IF NOT v_overview_only THEN
          UPDATE outcomes SET is_active = FALSE, is_suspended = TRUE
          WHERE market_id IN (SELECT id FROM markets WHERE event_id = v_event_id AND is_active = TRUE);
          UPDATE markets SET is_active = FALSE, is_suspended = TRUE
          WHERE event_id = v_event_id AND is_active = TRUE;
        END IF;
        CONTINUE;
      END IF;

      SELECT array_agg(DISTINCT m ->> 'type') INTO v_incoming_types
      FROM jsonb_array_elements(v_ev -> 'markets') AS m;

      FOR v_market IN SELECT * FROM jsonb_array_elements(v_ev -> 'markets')
      LOOP
        v_market_slug := slugify(v_market ->> 'type');
        v_market_line := extract_line(v_market ->> 'type');
        INSERT INTO markets (event_id, name, slug, market_type, line, is_active, is_suspended)
        VALUES (v_event_id, v_market ->> 'type', v_market_slug, v_market ->> 'type', v_market_line, TRUE, FALSE)
        ON CONFLICT (event_id, market_type) DO UPDATE SET
          name = EXCLUDED.name, slug = EXCLUDED.slug, line = EXCLUDED.line,
          is_active = TRUE, is_suspended = FALSE, updated_at = v_now
        RETURNING id INTO v_market_id;

        FOR v_outcome IN SELECT * FROM jsonb_array_elements(v_market -> 'outcomes')
        LOOP
          IF (v_outcome ->> 'odds')::NUMERIC <= 1 THEN CONTINUE; END IF;
          INSERT INTO outcomes (market_id, name, odds, is_active, is_suspended)
          VALUES (v_market_id, v_outcome ->> 'name', (v_outcome ->> 'odds')::NUMERIC, TRUE, FALSE)
          ON CONFLICT (market_id, name) DO UPDATE SET
            odds = EXCLUDED.odds, is_active = TRUE, is_suspended = FALSE;
        END LOOP;
      END LOOP;

      IF NOT v_overview_only THEN
        UPDATE outcomes SET is_active = FALSE, is_suspended = TRUE
        WHERE market_id IN (
          SELECT id FROM markets WHERE event_id = v_event_id AND is_active = TRUE
            AND market_type <> ALL(v_incoming_types)
        );
        UPDATE markets SET is_active = FALSE, is_suspended = TRUE
        WHERE event_id = v_event_id AND is_active = TRUE
          AND market_type <> ALL(v_incoming_types);
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_array(
        COALESCE(v_ev ->> 'external_id', 'unknown') || ': ' || SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed, 'errors', v_errors);
END;
$fn$;

-- ── 6. upsert_live_batch — usa helper ──
CREATE OR REPLACE FUNCTION upsert_live_batch(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '60s'
AS $$
DECLARE
  v_events JSONB;
  v_ev JSONB;
  v_updated INT := 0;
  v_inserted INT := 0;
  v_errors JSONB := '[]'::JSONB;
  v_event_id UUID;
  v_sport_slug TEXT;
  v_sport_id UUID;
  v_league_id UUID;
  v_league_name TEXT;
  v_live_data JSONB;
  v_is_ended BOOLEAN;
  v_market JSONB;
  v_market_slug TEXT;
  v_market_id UUID;
  v_market_line NUMERIC;
  v_outcome JSONB;
  v_incoming_types TEXT[];
  v_now TIMESTAMPTZ := now();
BEGIN
  v_events := payload -> 'events';

  IF v_events IS NULL OR jsonb_array_length(v_events) = 0 THEN
    RETURN jsonb_build_object('updated', 0, 'inserted', 0, 'errors', jsonb_build_array('events array required'));
  END IF;

  FOR v_ev IN SELECT * FROM jsonb_array_elements(v_events)
  LOOP
    BEGIN
      IF v_ev ->> 'external_id' IS NULL THEN
        v_errors := v_errors || jsonb_build_array('missing external_id');
        CONTINUE;
      END IF;

      SELECT id INTO v_event_id
      FROM events
      WHERE external_id = v_ev ->> 'external_id'
      LIMIT 1;

      IF v_event_id IS NULL AND v_ev ->> 'home_team' IS NOT NULL AND v_ev ->> 'away_team' IS NOT NULL THEN
        SELECT id INTO v_event_id
        FROM events
        WHERE home_team = v_ev ->> 'home_team'
          AND away_team = v_ev ->> 'away_team'
          AND is_live = TRUE
        LIMIT 1;

        IF v_event_id IS NOT NULL THEN
          UPDATE events SET external_id = v_ev ->> 'external_id'
          WHERE id = v_event_id;
        END IF;
      END IF;

      IF v_event_id IS NULL THEN
        IF v_ev ->> 'home_team' IS NULL OR v_ev ->> 'away_team' IS NULL OR v_ev ->> 'sport' IS NULL THEN
          v_errors := v_errors || jsonb_build_array(
            (v_ev ->> 'external_id') || ': event not found and missing creation fields'
          );
          CONTINUE;
        END IF;

        v_sport_slug := slugify(v_ev ->> 'sport');
        INSERT INTO sports (name, slug, icon, is_active)
        VALUES (v_ev ->> 'sport', v_sport_slug, sport_icon(v_sport_slug), TRUE)
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
        RETURNING id INTO v_sport_id;

        v_league_name := COALESCE(v_ev ->> 'league', 'Sconosciuto');

        -- NEW: usa helper upsert_league
        v_league_id := upsert_league(
          v_sport_id,
          v_league_name,
          v_sport_slug,
          v_ev ->> 'country',
          v_ev ->> 'country_code',
          v_ev ->> 'tour_code'
        );

        INSERT INTO events (external_id, sport_id, league_id, home_team, away_team, starts_at, status, is_live, updated_at)
        VALUES (
          v_ev ->> 'external_id', v_sport_id, v_league_id,
          v_ev ->> 'home_team', v_ev ->> 'away_team',
          COALESCE((v_ev ->> 'starts_at')::TIMESTAMPTZ, v_now),
          'live', TRUE, v_now
        )
        RETURNING id INTO v_event_id;

        v_inserted := v_inserted + 1;
      END IF;

      v_live_data := '{}'::JSONB;
      IF v_ev ->> 'period_code' IS NOT NULL THEN
        v_live_data := v_live_data || jsonb_build_object('periodCode', (v_ev ->> 'period_code')::INT);
      END IF;
      IF v_ev -> 'half_score_home' IS NOT NULL THEN
        v_live_data := v_live_data || jsonb_build_object('halfScoreHome', v_ev -> 'half_score_home');
      END IF;
      IF v_ev -> 'half_score_away' IS NOT NULL THEN
        v_live_data := v_live_data || jsonb_build_object('halfScoreAway', v_ev -> 'half_score_away');
      END IF;
      IF v_ev -> 'stats' IS NOT NULL THEN
        v_live_data := v_live_data || jsonb_build_object('stats', v_ev -> 'stats');
      END IF;
      IF v_ev -> 'match_events' IS NOT NULL THEN
        v_live_data := v_live_data || jsonb_build_object('matchEvents', v_ev -> 'match_events');
      END IF;

      v_is_ended := COALESCE(v_ev ->> 'period', '') IN ('ENDED', 'FINISHED', 'FULL_TIME', 'AFTER_EXTRA_TIME', 'AFTER_PENALTIES');

      UPDATE events SET
        status = CASE WHEN v_is_ended THEN 'finished' ELSE COALESCE(v_ev ->> 'status', 'live') END,
        is_live = NOT v_is_ended,
        minute = (v_ev ->> 'minute')::INT,
        score_home = (v_ev ->> 'home_score')::INT,
        score_away = (v_ev ->> 'away_score')::INT,
        period = v_ev ->> 'period',
        live_data = CASE WHEN v_live_data = '{}'::JSONB THEN NULL ELSE v_live_data END,
        updated_at = v_now
      WHERE id = v_event_id;

      IF v_is_ended THEN
        UPDATE outcomes SET is_active = FALSE, is_suspended = TRUE
        WHERE market_id IN (SELECT id FROM markets WHERE event_id = v_event_id AND is_active = TRUE);

        UPDATE markets SET is_active = FALSE, is_suspended = TRUE
        WHERE event_id = v_event_id AND is_active = TRUE;

        v_updated := v_updated + 1;
        CONTINUE;
      END IF;

      IF v_ev -> 'markets' IS NULL OR jsonb_array_length(COALESCE(v_ev -> 'markets', '[]'::JSONB)) = 0 THEN
        v_updated := v_updated + 1;
        CONTINUE;
      END IF;

      SELECT array_agg(DISTINCT m ->> 'type')
      INTO v_incoming_types
      FROM jsonb_array_elements(v_ev -> 'markets') AS m;

      UPDATE outcomes SET is_active = FALSE, is_suspended = TRUE
      WHERE market_id IN (
        SELECT id FROM markets
        WHERE event_id = v_event_id AND is_active = TRUE
          AND market_type <> ALL(v_incoming_types)
      );

      UPDATE markets SET is_active = FALSE, is_suspended = TRUE
      WHERE event_id = v_event_id AND is_active = TRUE
        AND market_type <> ALL(v_incoming_types);

      UPDATE outcomes SET is_suspended = TRUE
      WHERE market_id IN (
        SELECT id FROM markets
        WHERE event_id = v_event_id AND market_type = ANY(v_incoming_types)
      );

      FOR v_market IN SELECT * FROM jsonb_array_elements(v_ev -> 'markets')
      LOOP
        v_market_slug := slugify(v_market ->> 'type');
        v_market_line := extract_line(v_market ->> 'type');

        INSERT INTO markets (event_id, name, slug, market_type, line, is_active, is_suspended)
        VALUES (v_event_id, v_market ->> 'type', v_market_slug, v_market ->> 'type', v_market_line, TRUE, FALSE)
        ON CONFLICT (event_id, market_type) DO UPDATE SET
          name = EXCLUDED.name,
          slug = EXCLUDED.slug,
          line = EXCLUDED.line,
          is_active = TRUE,
          is_suspended = FALSE,
          updated_at = v_now
        RETURNING id INTO v_market_id;

        FOR v_outcome IN SELECT * FROM jsonb_array_elements(v_market -> 'outcomes')
        LOOP
          IF (v_outcome ->> 'odds')::NUMERIC <= 1 THEN
            CONTINUE;
          END IF;

          INSERT INTO outcomes (market_id, name, odds, is_active, is_suspended)
          VALUES (v_market_id, v_outcome ->> 'name', (v_outcome ->> 'odds')::NUMERIC, TRUE, FALSE)
          ON CONFLICT (market_id, name) DO UPDATE SET
            odds = EXCLUDED.odds,
            is_active = TRUE,
            is_suspended = FALSE;
        END LOOP;
      END LOOP;

      UPDATE events SET source_markets_count = jsonb_array_length(v_ev -> 'markets')
      WHERE id = v_event_id;

      v_updated := v_updated + 1;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_array(
        COALESCE(v_ev ->> 'external_id', 'unknown') || ': ' || SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated, 'inserted', v_inserted, 'errors', v_errors);
END;
$$;
```

- [ ] **Step 2: Commit (NON applicare ancora, si applica in Task 10)**

```bash
cd C:/Users/philp/Downloads/betssolution/betssolution-admin
git add supabase/migrations/034_league_country_code_part2.sql
git commit -m "feat(db): migration 034 part2 - VALIDATE + UNIQUE INDEX + RPC helper

Part 2 del fix disambiguazione Kambi. Da applicare DOPO il TRUNCATE.
- VALIDATE CHECK constraints (tabella vuota, pass istantaneo)
- CREATE UNIQUE INDEX expr-based su (sport_id, slug, COALESCE(country_code, tour_code))
- DROP leagues_slug_key
- CREATE OR REPLACE FUNCTION upsert_league (helper condivisa)
- CREATE OR REPLACE FUNCTION upsert_prematch_batch/upsert_live_batch (usano helper)

Refs: docs/superpowers/specs/2026-04-14-kambi-country-disambiguation-design.md"
```

---

## Task 7: Rollback migration 035

**Files:**
- Create: `C:\Users\philp\Downloads\betssolution\betssolution-admin\supabase\migrations\035_rollback_034.sql`

- [ ] **Step 1: Scrivi migration di rollback (schema revert)**

Questo file fa SOLO il revert dello schema (colonne, constraints, index, helper function).
Per ripristinare gli RPC, lo Step 2 esegue direttamente `023_league_country.sql` (già presente in repo).

```sql
-- ═══════════════════════════════════════════════════════════
-- Migration 035 (ROLLBACK di 034): revert schema
--
-- NON applicare in flusso normale. Solo rollback d'emergenza.
-- Precondizione: TRUNCATE leagues eseguito.
--
-- Dopo questo file, eseguire MANUALMENTE:
--   psql ... -f supabase/migrations/023_league_country.sql
-- per ripristinare upsert_prematch_batch + upsert_live_batch originali.
-- ═══════════════════════════════════════════════════════════

-- 1. Drop helper function (deve precedere il drop colonne per dipendenze)
DROP FUNCTION IF EXISTS upsert_league(UUID, TEXT, TEXT, TEXT, TEXT, TEXT);

-- 2. Drop nuovo index composito
DROP INDEX IF EXISTS uq_leagues_sport_slug_dedup;

-- 3. Drop CHECK constraints
ALTER TABLE leagues DROP CONSTRAINT IF EXISTS leagues_country_or_tour_chk;
ALTER TABLE leagues DROP CONSTRAINT IF EXISTS leagues_country_xor_tour_chk;

-- 4. Drop nuove colonne
ALTER TABLE leagues DROP COLUMN IF EXISTS country_code;
ALTER TABLE leagues DROP COLUMN IF EXISTS tour_code;

-- 5. Ripristina vecchia UNIQUE(slug)
ALTER TABLE leagues ADD CONSTRAINT leagues_slug_key UNIQUE (slug);
```

- [ ] **Step 2: Documenta la procedura completa di rollback**

Aggiungi in coda al file SQL un commento-guida (o in un file accanto `035_ROLLBACK_RUNBOOK.md`):

```
-- ═══════════════════════════════════════════════════════════
-- PROCEDURA DI ROLLBACK COMPLETA (in caso di emergenza):
-- ═══════════════════════════════════════════════════════════
--
-- 1. Stop scraper:
--    ssh scraper-vps "systemctl stop kambi-scraper"
--
-- 2. Deploy vecchio scraper (commit pre-fix):
--    cd kambi-scraper && git log --oneline | head -5  # trova commit pre-fix
--    git checkout <commit_pre_fix>
--    tar + scp + ssh install come Task 11
--
-- 3. TRUNCATE:
--    TRUNCATE outcomes, markets, events, leagues CASCADE;
--
-- 4. Applica revert schema:
--    psql ... -f 035_rollback_034.sql
--
-- 5. Ripristina RPC originali:
--    psql ... -f 023_league_country.sql
--
-- 6. Start scraper:
--    ssh scraper-vps "systemctl start kambi-scraper"
-- ═══════════════════════════════════════════════════════════
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/035_rollback_034.sql
git commit -m "feat(db): migration 035 - rollback plan for 034

Non eseguito in flusso normale. Documentato per sicurezza operativa."
```

---

## Task 8: Dry-run locale dello scraper contro Kambi prod

**Files:**
- (No file changes) — solo esecuzione script con nuova build

- [ ] **Step 1: Build scraper nuovo**

Run:
```bash
cd C:/Users/philp/Downloads/kambi-scraper
npm run build 2>&1 || npx tsx src/test.ts
```

Expected: nessun errore di compilazione, test ha girato contro API Kambi live.

- [ ] **Step 2: Verifica coverage test pass**

Assicurati che `testCoverage()` (Task 5) mostri `0 violations`. Se qualche evento viola (es. path.length < 2 senza fallback), correggi il fallback in `transform.ts`.

- [ ] **Step 3: Sample 3 sport tour-based**

Run uno one-liner mirato per validare:
```bash
cat > /tmp/test-tours.ts <<'EOF'
import { getPrematchBySport } from './src/kambi-client.js';
import { transformPrematchEvent } from './src/transform.js';
for (const sport of ['tennis', 'golf', 'motor_sports']) {
  const r = await getPrematchBySport(sport);
  const sample = r?.events?.slice(0, 2) || [];
  console.log(`\n=== ${sport} ===`);
  for (const ev of sample) {
    const t = transformPrematchEvent(ev, []);
    console.log(`${ev.englishName}: country=${t.country_code||'-'} tour=${t.tour_code||'-'}`);
  }
}
EOF
cd C:/Users/philp/Downloads/kambi-scraper && npx tsx /tmp/test-tours.ts
```

Expected output: tennis/golf eventi con `tour_code` popolato, `country_code=-`. Calcio/basket con `country_code` popolato.

---

## Task 9: Deploy migration Part 1 a DB prod

**Files:** (nessuno)

- [ ] **Step 1: Pre-check — verifica stato DB attuale**

Run:
```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -c \"SELECT column_name FROM information_schema.columns WHERE table_name='leagues' AND column_name IN ('country_code','tour_code');\""
```

Expected: 0 righe (colonne non ancora esistenti, Part 1 non ancora applicata).

- [ ] **Step 2: Applica Part 1 (se Task 1 Step 2 non già eseguito)**

Già eseguito in Task 1. Se no, riesegui Task 1 Step 2.

- [ ] **Step 3: Verifica che il vecchio scraper + RPC ancora funzionino**

Run:
```bash
ssh scraper-vps "systemctl status kambi-scraper --no-pager | head -5"
ssh scraper-vps "journalctl -u kambi-scraper -n 20 --no-pager | grep -E 'processed|error'"
```

Expected: scraper attivo, ultimi batch "processed" senza errori (il vecchio RPC non vede le nuove colonne, continua a lavorare normale).

---

## Task 10: Pre-flight ON CONFLICT expression-match test

**Files:** (nessuno)

- [ ] **Step 1: Esegui test ON CONFLICT su tabella viva**

Run:
```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres <<'SQL'
-- Cleanup idempotente se una run precedente ha lasciato l'index
DROP INDEX IF EXISTS tmp_test_expr_idx;

-- Crea un index temporaneo identico a quello finale
CREATE UNIQUE INDEX IF NOT EXISTS tmp_test_expr_idx
  ON leagues(sport_id, slug, COALESCE(country_code, tour_code));

-- Test: INSERT + ON CONFLICT expression
BEGIN;
INSERT INTO leagues (sport_id, name, slug, country_code, is_active)
VALUES (
  (SELECT id FROM sports LIMIT 1),
  'TEST_EXPR_MATCH',
  'test-expr-match-iraq',
  'iraq',
  TRUE
);

INSERT INTO leagues (sport_id, name, slug, country_code, is_active)
VALUES (
  (SELECT id FROM sports LIMIT 1),
  'TEST_EXPR_MATCH UPDATED',
  'test-expr-match-iraq',
  'iraq',
  TRUE
)
ON CONFLICT (sport_id, slug, COALESCE(country_code, tour_code)) DO UPDATE SET name = EXCLUDED.name;

-- Verifica: dovrebbe esserci una sola riga con name aggiornato
SELECT name FROM leagues WHERE slug = 'test-expr-match-iraq';

ROLLBACK;
DROP INDEX IF EXISTS tmp_test_expr_idx;
SQL"
```

Expected: 1 riga con `name = 'TEST_EXPR_MATCH UPDATED'`. Nessun errore "no unique or exclusion constraint matching".

- [ ] **Step 2: Se test fallisce → switch a generated column**

Se l'errore compare, edit `034_part2.sql` per usare generated column:

```sql
-- Sostituisci CREATE UNIQUE INDEX con:
ALTER TABLE leagues ADD COLUMN disambiguator TEXT
  GENERATED ALWAYS AS (COALESCE(country_code, tour_code)) STORED;
ALTER TABLE leagues ADD CONSTRAINT uq_leagues_sport_slug_dedup
  UNIQUE (sport_id, slug, disambiguator);

-- Nel helper RPC sostituisci:
ON CONFLICT (sport_id, slug, COALESCE(country_code, tour_code))
-- con:
ON CONFLICT ON CONSTRAINT uq_leagues_sport_slug_dedup
```

Poi commit + rivalidare:

```bash
git add supabase/migrations/034_league_country_code_part2.sql
git commit -m "fix: use generated column for dedup (ON CONFLICT expr-match unsupported)"
```

- [ ] **Step 3: Se test passa → procedi**

Nessuna modifica richiesta. Marcato check.

---

## Task 11: Stop scraper + deploy nuova build su VPS

**Files:** (nessuno)

- [ ] **Step 1: Stop scraper VPS**

Run:
```bash
ssh scraper-vps "systemctl stop kambi-scraper"
ssh scraper-vps "systemctl status kambi-scraper --no-pager | head -3"
```

Expected: "Active: inactive (dead)".

- [ ] **Step 2: Push codice scraper a VPS**

Run:
```bash
cd C:/Users/philp/Downloads/kambi-scraper
tar czf /tmp/kambi-scraper.tar.gz --exclude=node_modules --exclude=.git --exclude=dist .
scp /tmp/kambi-scraper.tar.gz scraper-vps:/tmp/
ssh scraper-vps "cd /root/kambi-scraper && tar xzf /tmp/kambi-scraper.tar.gz && npm install"
```

Expected: install completo, no errori.

- [ ] **Step 3: Verifica build TypeScript**

Run:
```bash
ssh scraper-vps "cd /root/kambi-scraper && npx tsc --noEmit"
```

Expected: no output (success).

- [ ] **Step 4: Verifica test coverage gira anche su VPS**

Run:
```bash
ssh scraper-vps "cd /root/kambi-scraper && npx tsx src/country-codes.test.ts"
```

Expected: `XX passed, 0 failed`.

---

## Task 12: TRUNCATE dati

**Files:** (nessuno)

- [ ] **Step 1: TRUNCATE cascade**

Run:
```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres <<'SQL'
BEGIN;
TRUNCATE TABLE outcomes CASCADE;
TRUNCATE TABLE markets CASCADE;
TRUNCATE TABLE events CASCADE;
TRUNCATE TABLE leagues CASCADE;
-- sports resta intatta
SELECT 'leagues' AS t, COUNT(*) FROM leagues
UNION ALL SELECT 'events', COUNT(*) FROM events
UNION ALL SELECT 'markets', COUNT(*) FROM markets
UNION ALL SELECT 'outcomes', COUNT(*) FROM outcomes;
COMMIT;
SQL"
```

Expected: tutte le tabelle → count 0.

---

## Task 13: Deploy migration Part 2 a DB prod

**Files:** (nessuno — applicazione del file creato in Task 6)

- [ ] **Step 1: Applica Part 2**

Run:
```bash
scp C:/Users/philp/Downloads/betssolution/betssolution-admin/supabase/migrations/034_league_country_code_part2.sql scraper-vps:/tmp/
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -f /tmp/034_league_country_code_part2.sql"
```

Expected: VALIDATE × 2, CREATE INDEX × 1, ALTER TABLE DROP × 1, CREATE FUNCTION × 3. No errori.

- [ ] **Step 2: Verifica schema finale**

Run:
```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -c \"\\d leagues\""
```

Expected:
- Colonne: id, sport_id, name, slug, country, country_code, tour_code, is_active, ...
- Indexes: `uq_leagues_sport_slug_dedup` (UNIQUE)
- Check constraints: `leagues_country_or_tour_chk`, `leagues_country_xor_tour_chk`
- `leagues_slug_key` NON deve essere più presente

- [ ] **Step 3: Verifica RPC**

Run:
```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -c \"SELECT proname FROM pg_proc WHERE proname IN ('upsert_league','upsert_prematch_batch','upsert_live_batch');\""
```

Expected: 3 righe (tutte le funzioni esistono).

---

## Task 14: Start scraper + verifica primo ciclo

**Files:** (nessuno)

- [ ] **Step 1: Start scraper**

Run:
```bash
ssh scraper-vps "systemctl start kambi-scraper"
ssh scraper-vps "systemctl status kambi-scraper --no-pager | head -5"
```

Expected: "Active: active (running)".

- [ ] **Step 2: Monitora primi 2 minuti di log**

Run:
```bash
ssh scraper-vps "journalctl -u kambi-scraper -f --no-pager" &
# Aspetta 120s poi Ctrl+C
```

Expected: log di live cycle "pushed X events", no errori "CHECK constraint" o "unique violation".

- [ ] **Step 3: Quick check DB dopo 2 minuti**

Run:
```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -c \"SELECT COUNT(*) FROM leagues;\""
```

Expected: > 0 (primi live events popolano subito).

---

## Task 15: Monitoring + acceptance (20 minuti)

**Files:** (nessuno)

- [ ] **Step 1: Aspetta primo ciclo slow prematch completo (~16 min)**

Check ogni 5 minuti. Il slow prematch logga "slow prematch cycle completed" quando finisce.

Run:
```bash
ssh scraper-vps "journalctl -u kambi-scraper --since \"20 min ago\" | grep -E 'slow prematch'"
```

Expected: "slow prematch cycle completed" almeno una volta.

- [ ] **Step 2: Query acceptance — violazioni & duplicati**

Run:
```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres <<'SQL'
-- 1. Violazioni CHECK (dovrebbero essere 0, il CHECK le rifiuta)
SELECT 'violations' AS kind, COUNT(*) AS n FROM leagues
  WHERE country_code IS NULL AND tour_code IS NULL;

-- 2. Duplicati (sport_id, slug, disambiguator)
SELECT 'duplicates' AS kind, COUNT(*) AS n FROM (
  SELECT sport_id, slug, COALESCE(country_code, tour_code), COUNT(*)
  FROM leagues
  GROUP BY 1,2,3 HAVING COUNT(*) > 1
) x;

-- 3. Totali
SELECT 'total' AS kind, COUNT(*) AS n FROM leagues
UNION ALL SELECT 'with_country', COUNT(country_code) FROM leagues
UNION ALL SELECT 'with_tour', COUNT(tour_code) FROM leagues;

-- 4. Distribuzione per sport
SELECT s.name AS sport, COUNT(*) AS leghe,
       COUNT(l.country_code) AS country_based,
       COUNT(l.tour_code) AS tour_based
FROM leagues l
JOIN sports s ON s.id = l.sport_id
GROUP BY s.name
ORDER BY leghe DESC LIMIT 15;
SQL"
```

Expected:
- violations = 0
- duplicates = 0
- total > 1000 (fascia attesa 1000-3500)
- Sport country-based (calcio, basket, hockey) dominano `country_based`
- Sport tour (tennis, golf, motor, esports) dominano `tour_based`

- [ ] **Step 3: Test frontend /sport/league/[slug]**

Prendi 5 slug random e verifica che la route risponda 200:

Run:
```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -c \"SELECT slug FROM leagues WHERE is_active ORDER BY random() LIMIT 5;\" | tail -6 | head -5"
# Per ogni slug:
curl -s -o /dev/null -w "%{http_code}\n" "https://betssolution.com/sport/league/$SLUG"
```

Expected: tutti 200. Se 404: bug di routing, investigare.

- [ ] **Step 4: No errori RPC in log**

Run:
```bash
ssh scraper-vps "journalctl -u kambi-scraper --since \"20 min ago\" | grep -iE 'error|constraint|conflict' | head -20"
```

Expected: 0 righe con error/constraint/conflict (o solo 429 Kambi rate-limit gestiti).

---

## Task 16: Aggiorna memory

**Files:**
- Modify: `C:\Users\philp\.claude\projects\C--Users-philp\memory\kambi-country-mapping-bug.md`
- Modify: `C:\Users\philp\.claude\projects\C--Users-philp\memory\MEMORY.md`

- [ ] **Step 1: Marca il bug come risolto**

Modifica `kambi-country-mapping-bug.md`:
- Cambia frontmatter `description` aggiungendo " **RISOLTO 2026-04-14** " all'inizio
- Aggiungi sezione in coda:

```markdown
## RISOLUZIONE (2026-04-14)

Implementato via migration 034 + refactor scraper:
- Colonne `country_code`/`tour_code` su `leagues`
- CHECK constraints OR + XOR (esattamente uno popolato)
- UNIQUE INDEX composita `(sport_id, slug, COALESCE(country_code, tour_code))`
- Helper RPC `upsert_league`
- Scraper `classifyGroup()` con whitelist ~200 paesi
- Full reset + re-scrape (fase test, nessun bet reale)

Spec: `docs/superpowers/specs/2026-04-14-kambi-country-disambiguation-design.md`
Plan: `docs/superpowers/plans/2026-04-14-kambi-country-disambiguation.md`
```

- [ ] **Step 2: Aggiorna MEMORY.md index entry**

In `MEMORY.md`, trova la riga:
```
## Kambi Country Mapping Bug — TODO (2026-04-14)
- [Kambi Country Bug](kambi-country-mapping-bug.md) — leghe generiche (es. "Premier League") mappate a country sbagliato (Etiopia→Iraq) in `leagues.country`. Fix scraper + migration. Priorità media
```

Sostituisci con:
```
## Kambi Country Mapping Bug — RISOLTO (2026-04-14)
- [Kambi Country Bug RISOLTO](kambi-country-mapping-bug.md) — fix applicato: country_code+tour_code su leagues, UNIQUE composita, scraper classifyGroup. Reset + re-scrape eseguito.
```

---

## Acceptance Criteria (riepilogo)

- [ ] Migration 034 Part 1 applicata (Task 9)
- [ ] Pre-flight ON CONFLICT test passato (Task 10)
- [ ] Scraper deployato e buildato su VPS (Task 11)
- [ ] TRUNCATE eseguito (Task 12)
- [ ] Migration 034 Part 2 applicata (Task 13)
- [ ] Scraper attivo, primo slow cycle completato (Task 14-15)
- [ ] Query acceptance: 0 violations, 0 duplicates, total > 1000 (Task 15)
- [ ] Frontend `/sport/league/[slug]` risponde 200 per sample (Task 15)
- [ ] Memory aggiornata (Task 16)

## Total estimated time

- Task 1-7 (coding + commit): ~45 min
- Task 8 (dry-run): ~10 min
- Task 9-10 (deploy part1 + test): ~5 min
- Task 11-14 (deploy + truncate + part2 + start): ~10 min
- Task 15 (monitoring): ~20 min (passive)
- Task 16 (memory): ~2 min

**Totale attivo**: ~70 min + 20 min monitoring passivo
