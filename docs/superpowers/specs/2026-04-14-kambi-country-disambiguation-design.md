# Kambi League Country/Tour Disambiguation — Design Spec

**Date**: 2026-04-14
**Status**: Approved (pending review)
**Author**: Claude (brainstorming session with Nicolo)
**Related memory**: `kambi-country-mapping-bug.md`

## Problem

Le leghe generiche in Kambi (es. `"Premier League"`) arrivano con nomi identici ma paesi diversi
(Etiopia, Iraq, Giordania, etc.). Il vincolo `UNIQUE(slug)` su `leagues` collassa tutte queste
leghe omonime in una singola riga, il cui `country` è determinato dall'ordine di upsert
(non-deterministico). Risultato osservato: 105 eventi di Premier League da paesi diversi
tutti attaccati a `calcio-premier-league` con `country='Iraq'`.

Impatto: display lega errato in tutti i ticket/pagine lega per eventi ambigui, dati inconsistenti
nel DB (~2843 righe su 3845 con `country IS NULL` — 74%).

## Goals

1. **Deterministico**: lo stesso input Kambi produce sempre lo stesso league_id (no race).
2. **Separazione semantica**: country sports (path[1]=nazione) vs tour sports (path[1]=tour/org).
3. **Zero ambiguità post-fix**: `CHECK constraint` garantisce che ogni lega abbia un disambiguatore.
4. **Applicabile a tutti i 25 sport** gestiti dallo scraper.

## Non-Goals

- Mantenere backwards-compat sugli slug esistenti (fase test, nessun bet reale, slug possono cambiare).
- Backfill heuristico di `country` su leghe pre-esistenti (viene tutto re-scrapato).
- Supportare sorgenti diverse da Kambi (Flashscore/ippica hanno schema separati).

## Design

### 1. Schema change — migration `034_league_country_code.sql`

**IMPORTANTE**: la migration deve essere **split in due fasi** perché le righe esistenti
(3845 righe con NULL entrambi) violerebbero immediatamente il CHECK. Soluzione:
`ADD CONSTRAINT ... NOT VALID` pre-truncate, poi `VALIDATE CONSTRAINT` post-truncate.

#### Fase 1 (pre-TRUNCATE) — `034_league_country_code_part1.sql`

```sql
-- Nuove colonne (nullable iniziale)
ALTER TABLE leagues
  ADD COLUMN country_code VARCHAR(32),
  ADD COLUMN tour_code    VARCHAR(32);

-- Constraints aggiunte come NOT VALID (non validate contro righe esistenti)
ALTER TABLE leagues ADD CONSTRAINT leagues_country_or_tour_chk
  CHECK (country_code IS NOT NULL OR tour_code IS NOT NULL) NOT VALID;

ALTER TABLE leagues ADD CONSTRAINT leagues_country_xor_tour_chk
  CHECK (NOT (country_code IS NOT NULL AND tour_code IS NOT NULL)) NOT VALID;
```

A questo punto: schema esteso, ma nessuna validazione contro dati esistenti.
Constraints saranno valutate solo su INSERT/UPDATE futuri (che però stiamo per bloccare col stop scraper).

#### Fase 2 (post-TRUNCATE) — `034_league_country_code_part2.sql`

```sql
-- Dopo TRUNCATE, tabella è vuota: constraints possono essere validate senza errori
ALTER TABLE leagues VALIDATE CONSTRAINT leagues_country_or_tour_chk;
ALTER TABLE leagues VALIDATE CONSTRAINT leagues_country_xor_tour_chk;

-- Nuova UNIQUE composita: sport + slug + disambiguatore
-- COALESCE è sempre non-NULL grazie al CHECK OR, quindi dedup funziona
CREATE UNIQUE INDEX uq_leagues_sport_slug_dedup
  ON leagues(sport_id, slug, COALESCE(country_code, tour_code));

-- Drop vecchia UNIQUE sullo slug (sostituita dall'index composita)
ALTER TABLE leagues DROP CONSTRAINT leagues_slug_key;
```

**Motivazione CHECK XOR**: una lega è chiaramente di un tipo; consentire entrambi creerebbe
ambiguità di routing (quale mostriamo come disambiguatore principale?).

**Motivazione COALESCE in UNIQUE**: garantisce che la dedup funzioni; il CHECK OR garantisce
che la COALESCE sia sempre non-NULL (altrimenti il `UNIQUE (NULL, NULL, NULL)` tratterebbe
tutte le righe come distinte — bug silente).

**Naming**: usato prefix `uq_` per consistency con migration 003 (`uq_events_external_id`).

### 2. Scraper change — `kambi-scraper`

#### `transform.ts`

Sostituire `extractCountry()` con `extractGroupInfo()`:

```typescript
interface GroupInfo {
  type: 'country' | 'tour';
  code: string;      // es. 'iraq', 'atp', 'formula-1'
  name: string;      // es. 'Iraq', 'ATP', 'Formula 1'
}

// Lista curata di slug paese da Kambi group.json (~200 entries)
// Derivata dall'ISO-3166 + alias Kambi noti
const KNOWN_COUNTRY_SLUGS = new Set([
  'italy', 'iraq', 'ethiopia', 'england', 'scotland', 'wales',
  'germany', 'france', 'spain', 'usa', 'brazil', /* ... */
]);

function extractGroupInfo(event: KambiEvent): GroupInfo | null {
  if (!event.path || event.path.length < 2) return null;
  const parent = event.path[1];  // path[0]=sport, path[1]=country/tour
  const slug = slugify(parent.name);

  if (KNOWN_COUNTRY_SLUGS.has(slug)) {
    return { type: 'country', code: slug, name: parent.name };
  }
  return { type: 'tour', code: slug, name: parent.name };
}
```

**Fallback**: se `path.length < 2`, usa `tour_code = 'uncategorized'` per soddisfare il CHECK.

#### `push-to-vincitu.ts` payload

```typescript
interface VincituPrematchEvent {
  // ... campi esistenti
  country?: string;       // nome localizzato (es. "Iraq"), come oggi
  country_code?: string;  // NUOVO: slug (es. "iraq")
  tour_code?: string;     // NUOVO: slug (es. "atp")
}
```

### 3. Admin RPC change — `upsert_prematch_batch` + `upsert_live_batch`

Estrarre una helper function per evitare duplicazione tra i due RPC:

```sql
CREATE OR REPLACE FUNCTION upsert_league(
  p_sport_id UUID,
  p_name TEXT,
  p_sport_slug TEXT,
  p_country TEXT,
  p_country_code TEXT,
  p_tour_code TEXT
) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_country_code TEXT;
  v_tour_code TEXT;
  v_disambiguator TEXT;
  v_slug TEXT;
  v_league_id UUID;
BEGIN
  -- Normalizzazione: garantisci che esattamente uno dei due sia popolato
  -- (rispetta il CHECK XOR e il CHECK OR)
  v_country_code := NULLIF(p_country_code, '');
  v_tour_code   := NULLIF(p_tour_code,   '');

  -- Se entrambi NULL → fallback a tour_code='uncategorized' (soddisfa CHECK OR)
  IF v_country_code IS NULL AND v_tour_code IS NULL THEN
    v_tour_code := 'uncategorized';
  END IF;

  -- Se entrambi popolati (bug upstream) → priorità a country_code (soddisfa CHECK XOR)
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
$$;
```

E chiamarla dai due RPC al posto del blocco INSERT esistente.

**Nota su `ON CONFLICT` expression match**: PostgreSQL richiede che l'espressione in
`ON CONFLICT` matchi testualmente quella nell'index. Scrivere `COALESCE(country_code, tour_code)`
in entrambi (stesso ordine argomenti, stesso whitespace). In caso di dubbio, test:

```sql
-- Test unit DB:
INSERT INTO leagues (sport_id, name, slug, country_code) VALUES
  (:sport, 'Premier League', 'calcio-premier-league-iraq', 'iraq');
INSERT INTO leagues (sport_id, name, slug, country_code) VALUES
  (:sport, 'Premier League', 'calcio-premier-league-iraq', 'iraq')
ON CONFLICT (sport_id, slug, COALESCE(country_code, tour_code)) DO UPDATE SET name = 'X';
-- Se errore "no unique or exclusion constraint matching", rinomina l'index
-- come CONSTRAINT usando DO $$ ALTER TABLE leagues ADD CONSTRAINT ... $$
```

Alternativa se la syntax expression-match dà problemi: aggiungere una generated column
`disambiguator GENERATED ALWAYS AS (COALESCE(country_code, tour_code)) STORED` e usare
`UNIQUE (sport_id, slug, disambiguator)` come constraint classica. Questo va validato
in fase di implementazione.

### 4. Data reset

Post-deploy schema+scraper:

```sql
-- Ordine: dal tavolo figlio al padre
TRUNCATE TABLE outcomes  CASCADE;
TRUNCATE TABLE markets   CASCADE;
TRUNCATE TABLE events    CASCADE;
TRUNCATE TABLE leagues   CASCADE;
-- sports resta (pochi, stabili, ref-integro)
```

**Nota**: CASCADE su `leagues` propaga a `events` che a sua volta propaga a `markets`/`outcomes`.
Ordine manuale è per chiarezza e velocità.

### 5. Rollout

**Sequence critica**: il vecchio RPC `upsert_prematch_batch` usa `ON CONFLICT (slug)`, che
fa riferimento a `leagues_slug_key`. Non appena quella UNIQUE è droppata (Fase 2 della migration),
il vecchio RPC crasha ad ogni batch. Per evitare una finestra di rottura, l'RPC nuovo DEVE essere
deployato **nella stessa migration** della Fase 2 (o lo scraper deve restare fermo tra Fase 1 e
Fase 2 — che è esattamente quello che facciamo qui).

```
1. [local] Test dry-run scraper
   - Aggiungi flag DRY_RUN a push-to-vincitu
   - Log country_code/tour_code per 10 eventi per sport (25 sport × 10 = 250 eventi)
   - Verifica: ogni evento ha country_code XOR tour_code popolato
   - Verifica: 0 slug duplicati in-memory per (sport, slug, disambiguator)

2. [DB prod] Deploy migration 034 Fase 1 (NOT VALID constraints)
   - ALTER TABLE ADD COLUMN country_code, tour_code
   - ADD CONSTRAINT ... NOT VALID (non tocca righe esistenti)
   - Stato DB: schema esteso, vecchio RPC ancora funziona, scraper gira normale

2.5. [DB prod] Pre-flight test `ON CONFLICT` expression-match
   - Su lega throwaway, prova l'INSERT con ON CONFLICT (sport_id, slug, COALESCE(country_code, tour_code))
   - Se fallisce con "no unique or exclusion constraint matching":
     → switch immediato al piano generated column (Open Question 1)
     → altrimenti procedi
   - Test deve girare PRIMA del TRUNCATE per lasciare opzione di rollback senza reset

3. [Scraper VPS] Stop + deploy kambi-scraper
   - systemctl stop kambi-scraper
   - git pull + npm install + npm run build
   - NON riavviare ancora: RPC nuovo non esiste

4. [DB prod] TRUNCATE
   - TRUNCATE outcomes, markets, events, leagues CASCADE
   - Scraper fermo, no race

5. [DB prod] Deploy migration 034 Fase 2 (VALIDATE + new INDEX + RPC)
   - **ORDINE CRITICO NEL FILE SQL**:
     1. VALIDATE CONSTRAINT leagues_country_or_tour_chk
     2. VALIDATE CONSTRAINT leagues_country_xor_tour_chk
     3. CREATE UNIQUE INDEX uq_leagues_sport_slug_dedup
     4. ALTER TABLE leagues DROP CONSTRAINT leagues_slug_key
     5. CREATE OR REPLACE FUNCTION upsert_league (helper, riferisce index)
     6. CREATE OR REPLACE FUNCTION upsert_prematch_batch (usa helper)
     7. CREATE OR REPLACE FUNCTION upsert_live_batch (usa helper)
   - Motivazione ordine: RPC nuovo fa ON CONFLICT sull'index nuovo → index DEVE esistere prima

6. [Scraper VPS] Start
   - systemctl start kambi-scraper
   - slow prematch parte immediatamente (lo scraper ha la nuova logica + payload esteso)
   - RPC nuovo riceve payload nuovo, tutto coerente

7. [Monitoring] ~20 min (sampling ogni 5min)
   - SELECT COUNT(*) AS total,
            COUNT(country_code) AS with_country,
            COUNT(tour_code) AS with_tour,
            COUNT(*) FILTER (WHERE country_code IS NULL AND tour_code IS NULL) AS violations
     FROM leagues;
   - SELECT sport_id, slug, COALESCE(country_code, tour_code) AS disc, COUNT(*)
     FROM leagues
     GROUP BY 1,2,3
     HAVING COUNT(*) > 1;
     -- Deve ritornare 0 righe (ogni (sport, slug, disc) è unico)

8. [Acceptance]
   - violations = 0 (CHECK OR sempre soddisfatto)
   - duplicati = 0 per (sport_id, slug, disambiguator)
   - total in range 1000-3500 — il pre-reset contava 3845 MA il 74% erano NULL-country
     duplicati collassati; post-fix il numero sarà fisiologicamente più basso (dedup è
     una feature, non una regressione). Valore atteso dipende da quanti paesi Kambi
     espone per sport (~200 paesi × 25 sport × N leghe per country/sport = variabile)
   - No errors in RPC logs (`journalctl -u kambi-scraper --since "20 min ago" | grep -i error`)
   - Frontend /sport/league/[slug] risponde 200 per slug random sample (5 slug da 5 sport diversi)
```

**Rollback** (in caso di problema irrisolvibile post-deploy): applicare migration `035_rollback_034.sql`:
```sql
DROP INDEX IF EXISTS uq_leagues_sport_slug_dedup;
ALTER TABLE leagues ADD CONSTRAINT leagues_slug_key UNIQUE (slug);
ALTER TABLE leagues DROP CONSTRAINT leagues_country_or_tour_chk;
ALTER TABLE leagues DROP CONSTRAINT leagues_country_xor_tour_chk;
ALTER TABLE leagues DROP COLUMN country_code;
ALTER TABLE leagues DROP COLUMN tour_code;
-- Re-deploy vecchio upsert_prematch_batch + upsert_live_batch (da migration 023)
-- Re-deploy vecchio scraper (git checkout <commit_pre_fix>)
```
Rollback richiede un nuovo TRUNCATE (vecchio schema non sa di country_code/tour_code).
La migration 035 deve essere scritta **nello stesso PR** della 034, non "pronta" in futuro.

### 6. Frontend impact

- Route `/sport/league/[slug]`: funziona, slug ora più lungo ma unique
- `ticket-template.ts` (`betssolution-player`): rimuovi workaround `"${name} (${country})"`, lascia solo `name` (country è implicito nel display della lega)
- `/admin/market-coverage/[slug]/page.tsx`: usa league.name + country come display, nessun cambio query

Nessuna rottura di API publiche.

### 7. Risks & Mitigations

| Rischio | Probabilità | Impatto | Mitigation |
|---|---|---|---|
| Kambi path[1] vuoto o malformato per qualche sport | Bassa | Medio | Fallback `tour_code = 'uncategorized'` |
| KNOWN_COUNTRY_SLUGS incompleto | Media | Basso | Monitoring post-deploy; sport con country valido finito in tour_code è bug cosmetico, non rompe dedup |
| Scraper crash durante primo ciclo post-reset | Bassa | Alto | Fase test, riavvio manuale da runbook; DB vuoto ma schema intatto |
| CHECK constraint rifiuta batch in produzione | Bassa | Alto | Dry-run locale obbligatorio prima del deploy |
| Rollback necessario | Bassa | Medio | Migration 035 di rollback pronta (drop constraints, ripristina UNIQUE(slug)) |

## Testing

- **Unit**: `classifyGroup('football', 'Iraq')` → `{type:'country', code:'iraq'}`
- **Unit**: `classifyGroup('tennis', 'ATP')` → `{type:'tour', code:'atp'}`
- **Integration**: mock Kambi response con 3 "Premier League" da paesi diversi → 3 leghe distinte
- **DB test**: INSERT con entrambi country_code + tour_code → violation
- **DB test**: INSERT senza né country_code né tour_code → violation
- **E2E**: scraper live contro VPS di staging, verificare 0 violations dopo 20min

## Acceptance Criteria

- [ ] Migration 034 applicata, schema validato
- [ ] Scraper deployato, `country_code` O `tour_code` popolato in ogni evento
- [ ] Reset eseguito, slow prematch ha ripopolato
- [ ] Query di verifica: 0 violations, 0 duplicati (sport_id, slug, disambiguator)
- [ ] Frontend `/sport/league/[slug]` funziona per le leghe ripopolate
- [ ] Ticket kiosk mostra nome lega pulito (senza workaround "(Iraq)")
- [ ] Memory `kambi-country-mapping-bug.md` marcato come RISOLTO

## Open Questions

**1. Generated column vs expression index per dedup key**

Il design attuale usa `CREATE UNIQUE INDEX ... ON (sport_id, slug, COALESCE(country_code, tour_code))` e `ON CONFLICT` con expression match. Funziona ma è fragile alla sintassi.

Alternativa più robusta: aggiungere una **generated column**:
```sql
ALTER TABLE leagues ADD COLUMN disambiguator TEXT
  GENERATED ALWAYS AS (COALESCE(country_code, tour_code)) STORED;

ALTER TABLE leagues ADD CONSTRAINT uq_leagues_sport_slug_dedup
  UNIQUE (sport_id, slug, disambiguator);

-- RPC: ON CONFLICT (sport_id, slug, disambiguator)
```

Pro: ON CONFLICT usa un constraint name, non expression match. Più stabile.
Con: colonna in più (+ storage), `STORED` non gratuito.

Decisione: da valutare in fase di implementazione se il test `ON CONFLICT` expression-match fallisce su Postgres 17.

**2. KNOWN_COUNTRY_SLUGS come seed table vs costante**

Il design attuale hardcoda ~200 slug paese in `transform.ts`. Alternative:
- Seed table `kambi_country_slugs` (admin-editable, no re-deploy)
- Nessuna whitelist: tutto va in `tour_code` tranne match euristici post-hoc

Decisione: iniziamo hardcoded per velocità, refactor a seed table se la lista diventa ingestibile.
