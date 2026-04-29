# Unified Sportsbook — Kambi primary + 22bet gap-filler

**Status:** draft · **Created:** 2026-04-24 · **Supersedes:** `2026-04-24-kambi-22bet-integration-design.md` phases 3/4/5

## Problem

Player prod oggi filtra hard-coded `source='kambi'` (`lib/scraper-source.ts`, default `'kambi'` applicato su 5 endpoint). 22bet in DB ma invisibile al player nonostante abbia:
- Catalogo eventi complementare (long-tail + sport esotici + campionati minori non-Kambi)
- Profondità mercati per-event 2.2× Kambi (117.9 vs ~50 mkt/ev per memory `22bet-session-2026-04-17.md`)
- Copertura densa su sport Kambi-light (snooker, pallamano, rugby, darts)

User requirement (2026-04-24 sera, testuale):
> "kambi e 22bet dove 22bet sopperisce a kambi nei mercati e negli eventi che kambi non ha, non voglio sovrapposizione, e settlement deve essere per tutti i mercati. Dato che abbiamo normalizzazione di eventi, mercati e outcome con i vari canonical deve essere un lavoro semplice."

## Design principles

1. **Kambi-first, 22bet-fallback**: quando entrambi hanno lo stesso evento/mercato, Kambi prevale. 22bet appare solo quando Kambi non ha.
2. **Dedup tier**:
   - Event level: `flashscore_id` pivot (quando disponibile, ~68% coverage). Fallback: `name + start_at + sport` trigram.
   - Market level: `canonical_key + canonical_line` pivot (94% coverage via `market_normalization`).
   - Outcome level: `canonical_outcome_key` via `outcome_normalization` (71% coverage) — usato da settlement, non dedup visivo.
3. **Zero user-visible duplicate events/markets**: il player non deve mai mostrare lo stesso evento due volte né lo stesso mercato due volte.
4. **Settlement source-agnostic**: settler unico per canonical_key, lookup via market_normalization.
5. **Backward compatible**: regex dispatcher attuale in settlement.ts resta come fast path; canonical_key lookup è fallback.

## Non-goals

- Best-odds-available comparator (user esplicitamente NO)
- UI change that shows "odds from kambi vs odds from 22bet" side-by-side
- Rewrite scraper layer (scraper è input-only, dedup avviene a read-time)
- Unificazione a livello DB (`events`/`markets` restano righe distinte per source, dedup è solo view/query-time)

## Architecture

### Phase A — Player API merge

5 endpoint toccati. Pattern identico ovunque:

```sql
-- Events query con dedup flashscore_id + Kambi priority
SELECT DISTINCT ON (COALESCE(flashscore_id, 'no-fs:'||id::text)) *
FROM events
WHERE source IN ('kambi', '22bet')
  AND status IN ('prematch', 'live')
  -- other filters (sport, league, time window)
ORDER BY
  COALESCE(flashscore_id, 'no-fs:'||id::text),
  CASE source WHEN 'kambi' THEN 0 WHEN '22bet' THEN 1 ELSE 2 END,
  start_at DESC;
```

Per markets per-event (chiamata annidata sui dettagli):
```sql
SELECT DISTINCT ON (COALESCE(mn.canonical_key, 'raw:'||m.market_type), COALESCE(mn.canonical_line::text, 'null')) m.*
FROM markets m
JOIN events e ON e.id = m.event_id
LEFT JOIN market_normalization mn
  ON mn.source = e.source AND mn.source_market_type = m.market_type
WHERE e.flashscore_id = :fsid  -- or similar join for fallback
  AND m.is_active = true
ORDER BY
  COALESCE(mn.canonical_key, 'raw:'||m.market_type),
  COALESCE(mn.canonical_line::text, 'null'),
  CASE e.source WHEN 'kambi' THEN 0 WHEN '22bet' THEN 1 ELSE 2 END;
```

### Phase B — Settlement canonical-driven

`lib/settlement.ts::resolveSettlerKey` current signature preserved. Fallback chain:
```typescript
// 1. VOID_PATTERNS (unchanged)
// 2. MARKET_PATTERNS regex (unchanged, fast path)
// 3. NEW: market_normalization lookup
const norm = await db.from('market_normalization')
  .select('canonical_key, canonical_line')
  .eq('source', source)
  .eq('source_market_type', marketType)
  .maybeSingle();
if (norm?.canonical_key && CANONICAL_TO_SETTLER[norm.canonical_key]) {
  return { key: CANONICAL_TO_SETTLER[norm.canonical_key], line: norm.canonical_line };
}
// 4. fallback void
```

`CANONICAL_TO_SETTLER` constant: dictionary di ~130 canonical keys esistenti → settler keys già esistenti.

Pre-dispatch outcome canonicalization:
```typescript
const canonicalOutcome = await db.from('outcome_normalization')
  .select('canonical_outcome_key')
  .eq('canonical_market_key', norm.canonical_key)
  .eq('source', source)
  .eq('source_outcome_name', outcomeName)
  .maybeSingle();
const selForSettler = canonicalOutcome?.canonical_outcome_key ?? outcomeName;
```

Caching: load both tables into Map at settlement pipeline start (called per-batch), refresh every N minutes. Tables are ~60k rows combined — in-memory fine.

### Phase C — Gap-fill

Audit script:
```sql
SELECT canonical_key, SUM(market_count) AS volume
FROM mv_source_market_types mv
JOIN market_normalization mn ON mn.source = mv.source AND mn.source_market_type = mv.market_type
WHERE mn.canonical_key IS NOT NULL
GROUP BY canonical_key
ORDER BY volume DESC;
```

Per ogni canonical_key senza entry in `CANONICAL_TO_SETTLER`: or add settler, or mark `void_by_design` in a new table.

### Phase 4 — Kambi live operator-merge

Separato repo `kambi-scraper`. `src/live-loop.ts`: pin evento a TUTTI gli operator visti invece del primo-visto; merge betOffers per eventId before flush. Probe evidence session 2026-04-24 spec: 888it=12 betOffers vs ub=17 stesso evento U20.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Event dedup falso-positivi (Kambi e 22bet stesso `flashscore_id` ma match diversi — raro ma possibile se fs-normalization ha bug) | Monitor `/admin/event-normalization` unmapped rate; keep flashscore_id sub-70% structurally limited |
| Event dedup falso-negativi (stesso evento ma Kambi senza flashscore_id) → eventi duplicati visibili al player | Fallback trigram match su `name+start_at+sport`. Edge case accettabile quando <5% eventi (metric da monitorare) |
| Market dedup senza canonical_key (raw:market_type fallback) → duplicati per mercati non normalizzati (6% volume) | Accept short-term, Phase C chiude gap. Rate diminuisce nel tempo |
| Settlement canonical_key lookup adds latency per-bet | Cache in-memory con refresh cron; ~60k rows Map fine |
| Regressione: settler esistente (via regex) restituisce risultato diverso da lookup canonical (stesso source_market_type) | Regex fast path gira PRIMA del canonical lookup; canonical è solo fallback quando regex non matcha |
| Outcome canonicalization missing per certe market/source combo | Fallback su outcome name raw (current behavior) |

## Success metrics

- Phase A shipped: `/api/sportsbook` mostra eventi + mercati 22bet quando Kambi non ha (verificato con curl + visual check player)
- Phase A zero regressione: eventi Kambi visibili sempre quando Kambi li ha (lista counter prima/dopo)
- Phase B shipped: `scripts/settle-canonical-coverage.ts` mostra >95% canonical keys con settler mappato
- Phase C: auto-VOID rate in `/api/cron/verify-results` scende sotto 5% (oggi ~30% su sport Kambi-only, ignoto su 22bet)

## Open questions

- Q1: quando si disabilita `NEXT_PUBLIC_SCRAPER_SOURCE` env var? Piano: dopo Phase A verification 24h, rimuovere da workflow deploy-staging/deploy-prod.
- Q2: fallback trigram event match necessario per Phase A o può aspettare? Piano: stub via-flashscore-only prima, aggiungere trigram fallback se coverage gap >5%.
- Q3: UI source badge necessario per compliance ADM? Piano: chiedere user (probabilmente NO, ma safe da chiarire).
