# Sprint 3 Phase A — Cross-source synthetic canonical_id

## Goal

Risolvere il problema dei ~71 real-world matches che esistono come 2-3 eventi distinti su Kambi/22bet/Betfair perché manca un `flashscore_id`. Soluzione: aggiungere `events.canonical_id` UUID che lega gli stessi eventi cross-source quando il nome team coincide e l'orario è ravvicinato. Il consensus 3-source torna a funzionare e la pagina `/admin/canonicalization` Esplora mostra automaticamente quei gruppi come `🟢 3/3 source canonical` invece che `❌ Single source only`.

Diagnosi prod 2026-04-27: 264 pair candidates con similarity 1.00, mappabili a circa 71 real-world matches in finestra 7d attiva. Sample: Atalanta-Genoa (3 source!), Como-Napoli, Inter-Parma, Cremonese-Lazio (3 source), Brentford-West Ham, Pisa-Lecce.

Diagnosi sentinel: 51k unmapped totali ma 92% sono partite ended (storia inerte). Scope reale: 3.873 eventi attivi.

## Out of scope

- Phase B (`is_source_only` flag) — separato, dopo.
- Phase C (Betfair league static map) — separato.
- Pulizia retrospettiva degli unmapped ended — ultima.

## Spec

### Algoritmo di matching

Per ogni evento `e_target`:
1. Trova candidati cross-source: stesso `sport_id`, source diverso (`external_id LIKE`), `|starts_at - e_target.starts_at| <= 30min`, status non ended, escludi placeholder team names (`Home`, `Home (Special bets)`, `% +`).
2. Tra i candidati, scegli quelli con:
   - `similarity(normalize_team_name(home_team), normalize_team_name(e_target.home_team)) >= 0.85`
   - `similarity(normalize_team_name(away_team), normalize_team_name(e_target.away_team)) >= 0.85`
3. Tra i match validi, riusa il `canonical_id` esistente se uno qualsiasi di loro lo ha già. Altrimenti genera nuovo UUID e propagalo a tutti gli eventi del cluster (incluso `e_target`).

### Threshold

- Similarity 0.85 su entrambi (home E away). Lo stesso threshold di `match_event_by_trigram_v2` (mig 118).
- Time window 30 min — più stretto dei 60 min usati da inspect_event perché qui assegniamo un'identità persistente, vogliamo essere conservativi (false positive = match cross-source sbagliato che inquina il consensus).
- Stesso `sport_id` obbligatorio.

### Backfill scope

Una pass single-shot su:
```sql
WHERE en.match_stage = 'unmapped'
  AND e.starts_at > NOW() - INTERVAL '30 days'
  AND e.status IN ('prematch','live')
```
~3.873 eventi sui dati prod attuali. Tempo stimato: ~2-3 minuti (RPC self-join O(n²) per sport, paginated).

### Engine integration

Dopo Phase A, ogni nuovo evento ingerito che termina in `match_stage='unmapped'` deve passare per un **Stage 6: cross-source canonical_id**. Inserire dopo lo stage 5 attuale (LLM). Se cross-source assegna canonical_id → l'evento NON cambia `match_stage` (resta unmapped per Flashscore) ma ottiene il canonical_id sintetico.

Se trovi il codice engine in `lib/normalize/engine.ts` o `lib/normalize/run.ts` aggiungi la chiamata. Se è gestito lato scraper-side (kambi-scraper / 22bet-scraper / betfair-scraper) — quello è out-of-scope per questa sessione, fai solo l'admin-side.

## Tasks

### Task 1 — Mig 126: schema + RPC

File: `supabase/migrations/126_events_canonical_id_cross_source.sql`.

```sql
-- Schema
ALTER TABLE events ADD COLUMN IF NOT EXISTS canonical_id uuid;
CREATE INDEX IF NOT EXISTS idx_events_canonical_id ON events(canonical_id) WHERE canonical_id IS NOT NULL;

-- RPC: dato un event_id, cerca cross-source match e assegna/riusa canonical_id.
-- Idempotente: se l'evento già ha canonical_id, ritorna quello.
-- Ritorna { canonical_id uuid, cluster_size int, action text } dove action ∈
-- 'kept' (già assegnato), 'reused' (riusato di un match), 'created' (nuovo).
CREATE OR REPLACE FUNCTION assign_event_cross_source_canonical_id(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_existing uuid;
  v_match_canonical uuid;
  v_new_id uuid;
  v_size int;
  v_target events%ROWTYPE;
BEGIN
  SELECT * INTO v_target FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','event_not_found'); END IF;

  v_existing := v_target.canonical_id;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('canonical_id', v_existing, 'cluster_size', NULL, 'action', 'kept');
  END IF;

  -- Skip placeholders
  IF v_target.home_team IN ('Home','Home (Special bets)') OR v_target.home_team LIKE '% +' THEN
    RETURN jsonb_build_object('canonical_id', NULL, 'action', 'skipped_placeholder');
  END IF;

  -- Find cross-source matches
  WITH candidates AS (
    SELECT e2.id, e2.canonical_id
    FROM events e2
    WHERE e2.id <> p_event_id
      AND e2.sport_id = v_target.sport_id
      AND e2.status IN ('prematch','live')
      AND substring(e2.external_id from '^[^:]+') <> substring(v_target.external_id from '^[^:]+')
      AND e2.home_team NOT IN ('Home','Home (Special bets)')
      AND e2.home_team NOT LIKE '% +'
      AND abs(extract(epoch FROM (e2.starts_at - v_target.starts_at))) <= 1800
      AND similarity(normalize_team_name(e2.home_team), normalize_team_name(v_target.home_team)) >= 0.85
      AND similarity(normalize_team_name(e2.away_team), normalize_team_name(v_target.away_team)) >= 0.85
  )
  SELECT (array_agg(canonical_id) FILTER (WHERE canonical_id IS NOT NULL))[1]
  INTO v_match_canonical
  FROM candidates;

  IF v_match_canonical IS NOT NULL THEN
    -- Reuse existing canonical
    UPDATE events SET canonical_id = v_match_canonical WHERE id = p_event_id;
    -- Also assign to other matches that lack canonical_id
    UPDATE events e SET canonical_id = v_match_canonical
      WHERE e.canonical_id IS NULL
        AND e.id IN (
          SELECT id FROM events e2
          WHERE e2.id <> p_event_id
            AND e2.sport_id = v_target.sport_id
            AND substring(e2.external_id from '^[^:]+') <> substring(v_target.external_id from '^[^:]+')
            AND abs(extract(epoch FROM (e2.starts_at - v_target.starts_at))) <= 1800
            AND similarity(normalize_team_name(e2.home_team), normalize_team_name(v_target.home_team)) >= 0.85
            AND similarity(normalize_team_name(e2.away_team), normalize_team_name(v_target.away_team)) >= 0.85
        );
    SELECT count(*)::int INTO v_size FROM events WHERE canonical_id = v_match_canonical;
    RETURN jsonb_build_object('canonical_id', v_match_canonical, 'cluster_size', v_size, 'action', 'reused');
  END IF;

  -- Check if there are matches at all (without canonical)
  IF EXISTS (
    SELECT 1 FROM events e2
    WHERE e2.id <> p_event_id
      AND e2.sport_id = v_target.sport_id
      AND e2.status IN ('prematch','live')
      AND substring(e2.external_id from '^[^:]+') <> substring(v_target.external_id from '^[^:]+')
      AND e2.home_team NOT IN ('Home','Home (Special bets)')
      AND e2.home_team NOT LIKE '% +'
      AND abs(extract(epoch FROM (e2.starts_at - v_target.starts_at))) <= 1800
      AND similarity(normalize_team_name(e2.home_team), normalize_team_name(v_target.home_team)) >= 0.85
      AND similarity(normalize_team_name(e2.away_team), normalize_team_name(v_target.away_team)) >= 0.85
  ) THEN
    -- Create new canonical_id and assign to all matches (including target)
    v_new_id := gen_random_uuid();
    UPDATE events e SET canonical_id = v_new_id
      WHERE e.canonical_id IS NULL
        AND (e.id = p_event_id OR (
          e.sport_id = v_target.sport_id
            AND substring(e.external_id from '^[^:]+') <> substring(v_target.external_id from '^[^:]+')
            AND abs(extract(epoch FROM (e.starts_at - v_target.starts_at))) <= 1800
            AND similarity(normalize_team_name(e.home_team), normalize_team_name(v_target.home_team)) >= 0.85
            AND similarity(normalize_team_name(e.away_team), normalize_team_name(v_target.away_team)) >= 0.85
        ));
    SELECT count(*)::int INTO v_size FROM events WHERE canonical_id = v_new_id;
    RETURN jsonb_build_object('canonical_id', v_new_id, 'cluster_size', v_size, 'action', 'created');
  END IF;

  RETURN jsonb_build_object('canonical_id', NULL, 'cluster_size', 0, 'action', 'no_match');
END;
$fn$;

GRANT EXECUTE ON FUNCTION assign_event_cross_source_canonical_id(uuid) TO authenticated, service_role;
ALTER FUNCTION assign_event_cross_source_canonical_id(uuid) SET statement_timeout = '30s';
```

Apply su staging + prod via `node scripts/db/apply-mig.mjs --target {env} --file <path>`.

### Task 2 — Backfill worker

File: `scripts/db/backfill-cross-source-canonical.mjs` (committable, non diagnostic).

Pseudo:
```js
// 1. SELECT id FROM events e JOIN event_normalization en
//    WHERE en.match_stage = 'unmapped'
//      AND e.starts_at > NOW() - INTERVAL '30 days'
//      AND e.status IN ('prematch','live')
//      AND e.home_team NOT IN ('Home','Home (Special bets)')
//      AND e.home_team NOT LIKE '% +'
//      AND e.canonical_id IS NULL
//   ORDER BY e.starts_at;
// 2. For each id (batched 100): SELECT assign_event_cross_source_canonical_id(id);
// 3. Aggregate stats: created / reused / no_match / skipped_placeholder.
// 4. Print summary.
```

Run su staging prima, poi prod. Capture timing + stats.

### Task 3 — Update inspect_event() and canonicalization_browse_groups()

Mig 127: rewrite both functions to add `canonical_id`-based grouping as priority **before** trigram-on-the-fly. New cluster priority order:
1. `flashscore_id` (existing — highest priority)
2. `canonical_id` (NEW — synthetic cross-source)
3. trigram match (existing fallback)

In the `grouping` CTE add:
```
WHEN en.flashscore_id IS NOT NULL THEN 'fs:' || en.flashscore_id
WHEN en.canonical_id  IS NOT NULL THEN 'cs:' || en.canonical_id
WHEN EXISTS (...trigram pair...) THEN 'trigram:' || cluster_id
ELSE 'iso:' || en.id
```

The output JSON's `group_type` field should accept a new value `'cross_source'` (between `'flashscore'` and `'trigram'`).

Apply Mig 127 on staging+prod.

### Task 4 — Frontend types + UI badge

- `lib/admin/canonicalization-types.ts`: extend `EventGroup.group_type` union with `'cross_source'`. Update `field_signals.canonical_id` non più `'feature_pending'` ma `'ok_synthetic'` quando popolato.
- `components/event-group.tsx`: aggiungere badge `🟣 linked via cross-source canonical_id` per `group_type === 'cross_source'`.
- Cross-source footer messaging:
  - 3/3 → ✅ 3/3 source canonical (esistente)
  - 2/3 → ⚠️ 2/3 source linked, 1 missing (esistente)
  - 1/3 → testo aggiornato: rimuovere il riferimento "Task #2 will surface" (è ora una feature live, non pending). Sostituire con: `❌ Single source only — nessun match cross-source rilevato`.
- `lib/admin/canonicalization-signals.ts`: aggiungere helper `signalToIcon('ok_synthetic')` → `🔗`.

### Task 5 — Test

- `tests/lib/admin/canonicalization-signals.test.ts`: aggiungere test per `'ok_synthetic'` → `🔗` icon + tooltip.
- Smoke test backfill su staging: verificare `cluster_size` plausibili (2-3) e nessun cluster size > 4 (sarebbe segno di false positive).

### Task 6 — Engine integration (admin-side stage 6)

Trovare il file engine. Pattern probabile: `lib/normalize/engine.ts`, `lib/normalize/run.ts`, o `app/api/admin/event-normalization/run-engine/route.ts`. Cercare con grep `match_stage` + `unmapped`.

Aggiungere stage che, dopo LLM (stage 5), per ogni evento ancora `match_stage='unmapped'` chiama `assign_event_cross_source_canonical_id(event_id)`. Logga l'azione. Non cambia `match_stage` (resta unmapped per Flashscore) ma popola `canonical_id`.

Se l'engine vive lato scraper (es. kambi-scraper push-to-vincitu) → out of scope per questa task, lascia un commento `TODO: integrate to scraper push pipeline`.

### Task 7 — Smoke + commit + push

- `npm run build` + `npm run test` clean.
- Per-task commit con trailer standard.
- Smoke su staging dopo deploy: aprire `/admin/canonicalization` Esplora, cercare "Atalanta", verificare che il gruppo Atalanta-Genoa mostri 🟣 cross-source con 3 source cards.

### Task 8 — Apply prod + verify

- Apply mig 126 + mig 127 su prod.
- Run backfill su prod (cattura output completo).
- Trigger Deploy Production.
- Smoke prod.
- Aggiornare memory.

## Acceptance criteria

- Mig 126 + 127 applicate prod+staging.
- Backfill prod completa: aspettativa ~71 cluster nuovi creati (range 50-90), ~140-200 eventi assegnati, 0 cluster di size > 4.
- Pagina /admin/canonicalization Esplora cerca "Atalanta" → gruppo "Atalanta vs Genoa" mostra 3 source card (kambi+22bet+betfair) con badge 🟣.
- Le 71 partite prima al "❌ Single source only" ora figurano come 🟣 cross-source.
- Vitest suite green (eccetto pre-existing v_consensus_latest).
- `npm run build` clean.

## Rollback

```sql
-- Revert mig 126 + 127
DROP FUNCTION assign_event_cross_source_canonical_id(uuid);
DROP INDEX idx_events_canonical_id;
ALTER TABLE events DROP COLUMN canonical_id;
-- Revert inspect_event + canonicalization_browse_groups: re-apply mig 125 SQL bodies
```

Frontend: revert i 2 commit fronte UI.

## Note

- `canonical_id` UUID è generato server-side (`gen_random_uuid()`).
- Il threshold 0.85 è coerente con `match_event_by_trigram_v2`. Se in futuro emerge bisogno di conservatorio maggiore, si può alzare a 0.90.
- Il time window 30 min copre standard delays di scheduling (kick-off può variare di 10-15 min cross-source). Più largo introduce false positive su double-headers.
- Cluster transitivo (A-B match + B-C match → tutti e 3 nello stesso canonical_id) gestito dal RPC perché propaga il match esistente.
