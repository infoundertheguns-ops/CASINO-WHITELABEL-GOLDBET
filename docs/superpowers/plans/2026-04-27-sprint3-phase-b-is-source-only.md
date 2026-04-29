# Sprint 3 Phase B — `events.is_source_only` boolean classifier

## Goal

Etichettare gli eventi che **strutturalmente non saranno mai su Flashscore** (tennis tavolo russo, esports synthetic, leghe "Alternative Matches", combatsport prospective) come `is_source_only=true`. Risultato:

1. **KPI L3 più realistico**: oggi il "57% flashscore_pct" trascina nel denominatore eventi che non potranno mai essere mappati. Con il flag, la metric mostra DUE numeri: "57% totale" e "92% tra mappabili" (quelli dove Flashscore poteva farcela).
2. **Esplora tree con badge 🔒**: distingue visualmente i gruppi single-source che SONO un problema (Task #2 candidates) da quelli che è inutile inseguire.
3. **Filtro futuro player UI**: opzionale nascondere i source_only per default.

Diagnosi prod 2026-04-27: ~3.300 eventi `no_match` dopo Phase A.2 backfill. Stima 60-70% sono source_only strutturali. Tradotto: ~2.000-2.300 eventi devono ricevere `is_source_only=true`.

## Spec

### Schema (Mig 129)

```sql
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_source_only boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_events_is_source_only ON events(is_source_only) WHERE is_source_only = true;
COMMENT ON COLUMN events.is_source_only IS
  'Sprint 3 Phase B: true = evento strutturalmente non in Flashscore (tennis tavolo russo, esports synthetic, leghe Alternative Matches). Esclude dal denominatore di "coverage tra mappabili".';
```

### Classifier RPC `classify_event_source_only(p_event_id uuid) → boolean`

Rules (in priorità top-down, prima true vince):

```
sport='Tennis Tavolo' AND league.name MATCHES one of:
  - 'Setka Cup', 'Setka Cup. .*', 'TT-Cup. .*', 'Liga Pro', 'Pro League',
    'Pro League. .*', 'Masters. Russia', 'Masters. Russia. .*',
    'Masters. Poland', 'Masters. Czech .*', 'Czech Liga Pro',
    'Pro League. Minsk', 'Pro League. Czech Republic'
  → source_only = true

sport='Esports' AND league.name MATCHES:
  - 'Esports Battle .*', 'eSports Battle .*', 'Cyber Live Arena .*',
    'Cyber Football .*', 'Cyber League .*', 'FIFA. .*'
  → source_only = true
  Default per Esports = source_only = true (Flashscore copre solo i top tier)

sport='Boxe' AND league.name MATCHES:
  - 'Fights', 'Top Dog FC.*', 'Boxing. Future Bouts'
  → source_only = true

sport='Arti Marziali' AND league.name MATCHES:
  - 'Prospective fights', 'Combatsport. .*'
  → source_only = true

sport='MMA' AND league.name = 'Unknown' AND source = 'betfair'
  → source_only = true (Betfair Unknown bug + MMA non in FS by design)

ANY sport AND league.name LIKE '%. Alternative Matches%'
  → source_only = true (22bet synthetic placeholder leagues)

sport='Cricket' AND league.name = 'Unknown' AND source IN ('betfair','22bet')
  → source_only = true

sport='Pallamano' AND league.name LIKE '%. Women%' AND status='prematch'
  AND starts_at > NOW() + INTERVAL '60 days'
  → source_only = true (long-future minor handball, won't appear in FS until close to date)

home_team IN ('Home', 'Home (Special bets)') OR home_team LIKE '% +'
  → source_only = true (placeholder pre-lineup)
```

Default `false` per tutto il resto.

L'RPC ritorna boolean E aggiorna `events.is_source_only` (idempotente; se già true ritorna true).

### Backfill worker

Script `scripts/db/backfill-is-source-only.mjs` (committable). Scope:

```sql
WHERE en.match_stage = 'unmapped'
  AND e.starts_at > NOW() - INTERVAL '30 days'
  AND e.status IN ('prematch','live')
  AND e.is_source_only = false
```

Per batch di 500: chiamare classifier RPC. Aggregare stats `total_scanned`, `flagged_true`, `kept_false`. Tempo stimato ~30s.

### Engine integration

In `lib/normalize/events/engine.ts`, dopo `persistMatch(unmapped)` (e dopo la chiamata `assign_event_cross_source_canonical_id` di Phase A), aggiungere chiamata a `classify_event_source_only`. Logga il risultato (best-effort, errors swallowed).

Ordine logico: prima cross_source (può salvarli), poi source_only (se ancora unmapped, classifica).

### KPI L3 update (Mig 130)

Modificare `canonicalization_overview()` per aggiungere `coverage_among_mappable`:

```sql
-- Computa eventi source_only attivi 7d
SELECT count(*) INTO v_source_only_count
  FROM events
  WHERE status IN ('prematch','live')
    AND home_team NOT IN ('Home', 'Home (Special bets)')
    AND home_team NOT LIKE '% +'
    AND starts_at > NOW() - INTERVAL '7 days'
    AND is_source_only = true;
```

JSON output L3 aggiunge:
```json
{
  ...
  "source_only_flagged": <count>,
  "mappable_total": <total - source_only>,
  "coverage_among_mappable_pct": <fs_mapped / mappable_total * 100>
}
```

I placeholders esistenti `cross_source_canonical` e `source_only_flagged` (vedi mig 122 line 244-246) ora si popolano realmente.

### Frontend updates

1. **Types**: extend `OverviewResponse.level_3_events` with `mappable_total: number; coverage_among_mappable_pct: number`. Mantenere `source_only_flagged` retro-compat.

2. **Overview KPI strip L3**: aggiungere riga sotto "Verified":
   ```
   Coverage tra mappabili: <count_mappable> ({coverage_among_mappable_pct}%)
   Strutturalmente source-only: {source_only_flagged}
   ```

3. **Esplora tree event-group**: aggiungere badge `🔒 source-only structural` quando TUTTI gli eventi del gruppo hanno `is_source_only=true`. Position: dopo il group_type badge, prima del cross-source footer. Helper: aggiungere `signalToIcon('structural_source_only')` → `🔒`.

4. **`canonicalization_browse_groups` + `inspect_event`**: estendere il JSON output per evento con `is_source_only` boolean. Frontend `<SourceCard>` mostra `🔒` accanto al status quando true.

## Tasks

### T1 — Mig 129 (schema + classifier)

File: `supabase/migrations/129_events_is_source_only_classifier.sql`. Schema + index + RPC `classify_event_source_only`. Apply staging+prod via apply-mig.mjs.

### T2 — Backfill worker

File: `scripts/db/backfill-is-source-only.mjs` (committed). Run su prod, capture stats.

### T3 — Engine stage 7

Modify `lib/normalize/events/engine.ts` (post Phase A `assign_event_cross_source_canonical_id`): chiama `classify_event_source_only`. Best-effort.

### T4 — Mig 130 (overview KPI update)

File: `supabase/migrations/130_canonicalization_overview_source_only.sql`. Rewrite `canonicalization_overview()` con nuovi campi L3.

### T5 — Mig 131 (browse + inspect surface is_source_only)

File: `supabase/migrations/131_browse_inspect_source_only.sql`. Aggiungere `is_source_only` al JSON output dei gruppi (sia inspect_event che canonicalization_browse_groups). Continua a usare il template mig 128 come baseline.

### T6 — Frontend types + UI

Update:
- `lib/admin/canonicalization-types.ts` (LevelOverview L3 + SourceEventCard.is_source_only + EventGroup may need is_source_only_group flag)
- `lib/admin/canonicalization-signals.ts` (icon `🔒`)
- `app/admin/canonicalization/components/event-group.tsx` (badge condizionale)
- `app/admin/canonicalization/components/source-card.tsx` (badge accanto a status)
- `app/admin/canonicalization/overview-tab.tsx` (riga Coverage tra mappabili)

### T7 — Tests + smoke

`npm run test` green. New unit test for `signalToIcon('structural_source_only')`. Smoke prod dopo deploy: aprire Esplora, cercare "Setka Cup" → vedere badge 🔒 sui gruppi.

### T8 — Commit per task + memory update

Standard trailer. Update memory file con baseline numbers.

## Acceptance criteria

- ✅ Mig 129/130/131 applicate prod+staging.
- ✅ Backfill prod: `flagged_true` ≥ 1.500 eventi (stima conservativa: 60% dei 3.300 no_match attuali).
- ✅ Pagina /admin/canonicalization KPI L3 mostra DUE numeri: totale e "tra mappabili".
- ✅ Coverage tra mappabili sale a ≥ 85% (oggi è 57% perché diluito dai source_only).
- ✅ Esplora tree mostra badge 🔒 sui gruppi Setka Cup / Esports Battle / Alternative Matches.
- ✅ Build + test clean (eccetto pre-existing v_consensus_latest).
- ✅ Memoria aggiornata.

## Out of scope

- Filtro player-side per nascondere source_only.
- Editor admin per gestire le rules del classifier (per ora sono SQL hardcoded; se serve UI di tuning si fa separato).
- Phase C (Betfair league static map) e pulizia retrospettiva.

## Rollback

```sql
-- Revert in ordine inverso
DROP FUNCTION classify_event_source_only(uuid);
DROP INDEX idx_events_is_source_only;
ALTER TABLE events DROP COLUMN is_source_only;
-- Re-apply mig 128 SQL bodies of canonicalization_overview / inspect_event / canonicalization_browse_groups
```

Frontend: revert i 1-2 commit.

## Note

- ALTER TABLE `events` con NOT NULL DEFAULT false è instant in PG ≥11 (non rewrite). Lock breve.
- Le rules SQL sono conservative: meglio non taggare un evento che potrebbe essere mappabile (false positive `is_source_only=true` blocca improvement futuro su quell'evento).
- Le rules vivono nel RPC body, non in tabella. Se in futuro emerge bisogno di UI per gestirle, sarà un'altra mig (pattern team_aliases).
