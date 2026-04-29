# Canonicalization Observability Page — Design Spec

**Date**: 2026-04-26
**Status**: Draft, pending approval
**Scope**: Una nuova pagina admin `/admin/canonicalization` con due tab: (1) inspector evento drill-down con payload raw side-by-side dei 3 source, (2) gerarchia 5-livelli con KPI di canonicalizzazione. Nessuna nuova tabella, nessuna migration di schema. Solo 2 RPC di lettura + UI React.
**Source brainstorm**: sessione 2026-04-26. Decisioni di design risolte conversazionalmente (vedi `Design Decisions`).
**Predecessor**: spec `2026-04-22-consensus-event-normalization-manual-override-design.md` (canonical_events / event_normalization layer); spec `2026-04-20-market-normalization-design.md` (market layer).

## Problem

Il sistema di canonicalizzazione ha 5 livelli — sports, leagues, events, markets, outcomes — ognuno con il proprio stato di copertura, ma **non c'è una vista unica** che mostri l'intera gerarchia con i suoi gap. Le pagine esistenti coprono fette isolate:

- `/admin/event-normalization` → solo livello events ↔ Flashscore
- `/admin/market-normalization` → solo livello markets
- `/admin/outcome-normalization` → solo livello outcomes
- `/admin/canonical-markets` → catalogo markets canonical
- `/admin/scraper` → infrastruttura scraper (non canonicalization)
- (nessuna pagina) → leagues, sports

Per l'operatore questo significa:

1. **Nessun confronto cross-source per evento**. Quando "Roma vs Milan" arriva da Kambi+22bet+Betfair, l'operatore non può vedere in un colpo come ognuno dei 3 source rappresenta lo stesso match — quale league name ha mandato, quale country_code, se i nomi team coincidono, se uno dei 3 ha flashscore_id mappato e gli altri no, quanti markets/outcomes ognuno ha portato. Per fare questo confronto oggi servono ≥3 query SQL manuali su `events`, `event_normalization`, `leagues`, `markets`, `outcomes`.

2. **Nessun panorama gerarchico della canonicalizzazione**. Per sapere "a che punto siamo nella pipeline", l'operatore (o lo sviluppatore) deve aprire 4 pagine separate, leggere KPI con definizioni leggermente diverse, calcolare manualmente le percentuali. Non c'è un singolo screen che dica "Sports 100% canonical, Leagues 95% (47 Betfair Unknown), Events 54% Flashscore-mapped, Markets 68% canonical, Outcomes 35% seed-coverage".

3. **Nessuna visibilità sui campi del payload**. I 3 scraper pushano un payload condiviso (`VincituPrematchEvent`) ma con copertura disomogenea per campo. Betfair non manda `country` esteso né `tour_code`; Kambi non manda `flashscore_id` raw; 22bet a volte ha synthetic placeholders. **Niente nel sistema rivela queste differenze**: i campi mancanti diventano semplicemente NULL nel DB, indistinguibili da "campo non applicabile".

4. **Mancanza di feedback visivo per i prossimi interventi**. Stiamo per intraprendere Task #3 (Betfair league static map) e Task #2 (cross-source synthetic canonical_id). Senza una pagina di osservabilità, l'impatto di questi interventi sarà misurabile solo via SQL ad hoc, e i bug nella canonicalizzazione cross-source emergeranno tardi (utenti che si lamentano di duplicati nel player, settlement che fallisce silenziosamente).

## Goals

- **G1 — Inspector evento**: in una sola schermata, l'operatore inserisce nome team / external_id / flashscore_id e ottiene fino a 3 card affiancate (una per source presente: Kambi/22bet/Betfair) con **tutti i campi del payload** valorizzati o mancanti, ognuno con icona di stato della canonicalizzazione. Riconosce visivamente: "Betfair non ha la lega" (❌), "22bet ha variant del nome team" (⚠️), "Kambi è già flashscore-mapped al 98% di confidenza" (✅).
- **G2 — Gerarchia & KPI**: in una vista unica, panoramica dei 5 livelli con totali, percentuali canonicalizzate, breakdown per source, color coding 🟢/🟡/🔴 per gap critici. Click su qualsiasi metrica → drill-down all'evento o alla riga affected.
- **G3 — Zero touch su scrittura DB**. La pagina è solo lettura: 2 nuove RPC (`canonicalization_overview()` e `inspect_event(...)`), nessuna mutation, nessuna nuova tabella, nessuna nuova migration di schema. Sicura da ispezionare in qualsiasi momento, anche durante deploy o cron run.
- **G4 — Foundation per Task #2 e #3**. La pagina espone già i placeholder per `canonical_id` (Task #2 — "🚧 not active") e visualizza `Unknown (12345)` per leghe Betfair non mappate (Task #3 — "❌"). Quando #2 e #3 saranno deployati, gli stati cambiano automaticamente da 🚧/❌ a ✅ senza modifiche alla pagina.

## Non-goals

- **Nessun bulk action / mutation**. La pagina è read-only. Operazioni di canonicalizzazione (verify, edit, propose alias, ecc.) restano nelle pagine esistenti dedicate. Linkiamo a quelle pagine ma non le duplichiamo qui.
- **Nessun grafico time-series**. KPI sono snapshot al momento del load (con cache 60s). Trend storici / sparkline → fuori scope. Se richiesto in futuro, è un'aggiunta additiva.
- **Nessuna integrazione con sistemi esterni**. La pagina parla solo con DB Supabase via RPC; non chiama Flashscore / Anthropic API / Betfair API. Tutto ciò che mostra è già nel DB admin.
- **Nessuna persistenza di "raw payload" originale**. I scraper non loggano il JSON crudo da nessuna parte (sarebbe enorme). La pagina ricostruisce la rappresentazione "payload" leggendo i campi DB derivati (events + leagues + event_normalization + counts markets/outcomes). I campi che il source teoricamente manda ma non sono nel DB (es. Betfair `tour_code` mai popolato) sono mostrati come "❌ assente nel payload".
- **Nessuna osservabilità a livello mercato/outcome dentro l'inspector**. Tab 1 mostra solo i counter `markets · 47` e `outcomes · 142` per source. Drill-down ai mercati/outcome rimanda alle pagine esistenti.
- **Mobile responsive**: best effort, non priorità. Layout 3-card è desktop-first; su mobile collassa a stack verticale ma è OK se un po' scomodo.

## Design Decisions

| Q | Decisione | Rationale |
|---|---|---|
| **Q1** — Spec separato o estensione di event-normalization? | Spec separato. Pagina nuova `/admin/canonicalization`. | event-normalization è focalizzata su match Flashscore, non sull'intera pipeline. Fonderle confonderebbe scope. La nuova pagina è un "panorama" che linka alle pagine deep-dive. |
| **Q2** — Una pagina con 2 tab o due pagine separate? | Una pagina, 2 tab (Inspector + Gerarchia). | Cambio di tab ≠ navigazione. Lo state filtri/ricerca dell'Inspector può sopravvivere al toggle in Gerarchia. URL persistente `/admin/canonicalization?tab=inspector&q=Roma`. |
| **Q3** — Come raggruppa "stesso match" l'inspector? | Tre regole in cascata: (a) se 2+ events condividono `flashscore_id` → stesso gruppo (definitivo). (b) altrimenti se 2+ events hanno trigram(home_norm) ≥ 0.85 AND trigram(away_norm) ≥ 0.85 AND |starts_at delta| ≤ 60min AND stesso sport_id → stesso gruppo (heuristic). (c) altrimenti event isolato in gruppo proprio. Stesse regole future di Task #2 (cross-source unification): la pagina è il preview dell'algoritmo. | Definitivo > heuristic > isolato. Operatore può vedere i due livelli (≥0.85 trigram raggruppati visivamente con linea continua, ≥0.70 trigram con linea tratteggiata "match suggerito ma incerto"). |
| **Q4** — Search behavior. | Search box accetta: home_team / away_team / external_id / flashscore_id. ILIKE `%query%` su (home_team, away_team) + exact match su external_id e flashscore_id. Limit 50 events, ordered by starts_at DESC. | Operatore tipico cerca "Roma" o "Inter" — niente filtri avanzati. external_id/flashscore_id per debug puntuale. |
| **Q5** — Cache lato server della RPC overview. | Cache Postgres-side via materialized view? No, troppo overhead per dati che cambiano ogni 30min. Cache lato Next.js route handler con `unstable_cache` TTL 60s. | Acceptable staleness, zero infrastructure. La RPC overview gira in <2s su prod attualmente. |
| **Q6** — Drill-down dai KPI Gerarchia. | Sì, ma riusa pagine esistenti **senza estenderle**. Click su breakdown → redirect a pagina esistente con i SOLI query params che già accetta (es. `/admin/event-normalization?source=betfair`). Se l'operatore vuole filtrare ulteriormente (es. solo "league_unknown"), lo fa manualmente nella UI di destinazione. NO nuove query params, NO modifiche alle pagine esistenti in questo spec. | YAGNI: non duplichiamo logica e non aggiungiamo cross-page filter contracts. La nuova pagina è hub navigazionale leggero; le deep-dive restano autonome. |
| **Q7** — Naming pagina e route. | `/admin/canonicalization` (singolare invariato in italiano per coerenza con codice esistente: "canonical-markets", "canonicalization vision" memo). Sidebar label: "🔭 Canonicalizzazione". Posizionata in sidebar SOPRA le 4 pagine deep-dive (event-norm, market-norm, outcome-norm, canonical-markets). | Funge da entry-point gerarchico. |
| **Q8** — Aderenza alla "Canonicalization Autopilot vision". | Sì, esplicita. La pagina è il primo passo verso l'unificazione dei 4 strumenti in pipeline AI continua. Il README della pagina (sezione header) riferisce la vision con link al memory file. | Coerenza strategica. |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ /admin/canonicalization (Next.js page, App Router)                  │
│                                                                     │
│ ┌──────────────────────────┐  ┌──────────────────────────────────┐ │
│ │ Tab 1: Inspector Evento  │  │ Tab 2: Gerarchia & KPI           │ │
│ │  - Search box            │  │  - KPI strip 5 livelli           │ │
│ │  - Risultati raggruppati │  │  - Per-source breakdown          │ │
│ │  - Card 3 source         │  │  - Color coding                  │ │
│ │  - Status icon per campo │  │  - Link drill-down esterni       │ │
│ └─────────────┬────────────┘  └────────────────┬─────────────────┘ │
│               │                                │                    │
│               │ fetch                          │ fetch              │
│               ▼                                ▼                    │
│ ┌──────────────────────────┐  ┌──────────────────────────────────┐ │
│ │ /api/admin/canonicalization │ │ /api/admin/canonicalization     │ │
│ │   /inspect?q=...         │  │   /overview                      │ │
│ │   POST → RPC             │  │   GET → RPC (cached 60s)         │ │
│ └─────────────┬────────────┘  └────────────────┬─────────────────┘ │
└───────────────┼────────────────────────────────┼────────────────────┘
                │                                │
                ▼                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Supabase Postgres                                                   │
│  RPC inspect_event(p_query)         RPC canonicalization_overview() │
│   ├─ search events by team/ID        ├─ COUNT/PCT per livello       │
│   ├─ JOIN event_normalization        ├─ per-source breakdown        │
│   ├─ JOIN leagues                    ├─ legacy color thresholds     │
│   ├─ trigram cluster                 └─ ritorna single row JSONB    │
│   ├─ market/outcome counts                                          │
│   └─ ritorna array JSONB                                            │
└─────────────────────────────────────────────────────────────────────┘
```

Tabelle lette (sola lettura): `events`, `event_normalization`, `leagues`, `sports`, `markets`, `outcomes`, `mv_event_normalization_unmapped` (se esiste e utile), `mv_market_normalization_summary` (per KPI markets), `outcome_normalization` (se esiste).

Tabelle scritte: **nessuna**.

## Components

### RPC 1 — `canonicalization_overview()` (mig 122 — sola RPC, no schema change)

Ritorna single JSONB row con i KPI dei 5 livelli. Esempio shape:

```json
{
  "generated_at": "2026-04-26T18:00:00Z",
  "level_1_sports": {
    "total": 12,
    "canonical": 12,
    "pct": 100.0,
    "color": "green",
    "per_source": { "kambi": {"mapped": 12}, "22bet": {"mapped": 11}, "betfair": {"mapped": 9} }
  },
  "level_2_leagues": {
    "total": 1247,
    "identified": 1186,
    "unknown": 61,
    "pct": 95.1,
    "color": "yellow",
    "per_source": { "kambi": {"unknown": 0}, "22bet": {"unknown": 12}, "betfair": {"unknown": 47} }
  },
  "level_3_events": {
    "total_active_7d": 7872,
    "flashscore_mapped": 4253,
    "flashscore_pct": 54.0,
    "verified": 620,
    "verified_pct": 14.6,
    "per_stage": { "auto": 472, "manual": 0, "llm_auto": 148 },
    "cross_source_canonical": 0,
    "cross_source_pct": 0.0,
    "source_only_flagged": 0,
    "color": "yellow",
    "per_source": {
      "kambi": {"mapped": 1291, "total": 1853, "pct": 69.7},
      "22bet": {"mapped": 1615, "total": 4247, "pct": 38.0, "color": "red"},
      "betfair": {"mapped": 1347, "total": 1772, "pct": 76.0}
    }
  },
  "level_4_markets": { ... },
  "level_5_outcomes": { ... }
}
```

Implementazione: una singola CTE-chain con ~10 sub-query ottimizzate, target <2s su prod. `SECURITY DEFINER`, `SET search_path = public, extensions`.

### RPC 2 — `inspect_event(p_query text, p_limit int default 20)` (mig 122)

Input: query string (cercata su home_team/away_team/external_id/flashscore_id).
Output: array JSONB di **gruppi**. Ogni gruppo ha 1-3 events:

```json
[
  {
    "group_key": "fs:77721" oppure "trigram:abc123",
    "group_type": "flashscore" | "trigram" | "isolated",
    "group_confidence": 1.0 | 0.85 | null,
    "real_world_label": "Roma vs Milan · 2026-04-27 20:45 · Calcio",
    "events": [
      {
        "source": "kambi",
        "external_id": "kambi:23478",
        "home_team": "Roma",
        "away_team": "Milan",
        "sport": "Calcio",
        "league_name": "Serie A",
        "league_id": "abc-uuid",
        "country": "Italia",
        "country_code": "IT",
        "tour_code": null,
        "starts_at": "2026-04-27T18:45:00Z",
        "status": "prematch",
        "flashscore_id": "fs_77721",
        "match_stage": "trigram",
        "confidence": 0.98,
        "verified": true,
        "verified_by": null,
        "llm_verify": null,
        "canonical_id": null,
        "is_source_only": null,
        "markets_count": 47,
        "outcomes_count": 142,
        "field_signals": {
          "league_name": "ok",
          "country": "ok",
          "tour_code": "absent_ok",
          "flashscore_id": "ok_verified",
          "canonical_id": "feature_pending"
        }
      },
      { "source": "22bet", ... },
      { "source": "betfair", ... }
    ]
  }
]
```

Logica grouping (in SQL):

1. SELECT events matching query (ILIKE su home/away, exact su external_id/flashscore_id), JOIN event_normalization + leagues, LIMIT 50.
2. Per ogni event, calcola `group_key` con priorità:
   - Se `flashscore_id IS NOT NULL` → `'fs:' || flashscore_id`
   - Else compute trigram cluster: per ogni coppia di events (home_norm, away_norm) ≥0.85 + |starts_at|≤60min + stesso sport → assegna stesso `'trigram:' || dense_rank_id`
   - Else → `'iso:' || event.id`
3. GROUP BY group_key, JSON aggregate events nel gruppo.

`field_signals` calcolato in SQL con CASE WHEN per ogni campo:
- `ok` — presente e canonicalizzato
- `ok_verified` — presente, canonical, verified
- `variant` — presente ma con problema (es. league_name = 'Unknown' o = 'Unknown (12345)')
- `absent_ok` — campo opzionale assente correttamente
- `absent_problem` — campo che il source dovrebbe mandare ma non ha (es. Betfair `tour_code` se sport è ATP)
- `feature_pending` — feature non ancora attiva (canonical_id, is_source_only)

### Page `/admin/canonicalization/page.tsx`

- Header: titolo + sottotitolo + link "📖 Vision Canonicalizzazione" (apre memo).
- Tabs: `?tab=inspector` (default) | `?tab=overview`.
- **Inspector**:
  - Form ricerca con autosubmit on debounce 400ms.
  - Loading skeleton (3 card placeholder).
  - Risultati: lista gruppi. Ogni gruppo è una `<section>` con header (real_world_label + badge tipo gruppo) e 1-3 card.
  - Card: tabella verticale `[campo, valore, status_icon]`. Field signals con tooltip al hover su icona.
  - Footer gruppo: messaggio cross-source ("✅ 3/3 source canonical via flashscore_id" / "⚠️ 2/3 cross-source linked, Betfair isolated" / "❌ Nessun canonical link, possibile duplicato player-side").
- **Overview**:
  - 5 KPI strip stacked verticalmente. Ogni strip: titolo livello, totale, pct, color bar, breakdown per source con mini-bar chart.
  - Click su breakdown → redirect a pagina deep-dive (es. `/admin/event-normalization?source=22bet`).
  - Footer: "Ultimo aggiornamento: 60s fa · [Aggiorna]".

### API routes

- `GET /api/admin/canonicalization/overview` → cached `unstable_cache` 60s, ritorna JSONB della RPC `canonicalization_overview()`.
- `GET /api/admin/canonicalization/inspect?q=<query>&limit=20` → ritorna JSONB array dalla RPC `inspect_event(q, limit)`. No cache (operatore vuole real-time).

### Admin sidebar

Aggiungere voce in `components/layout/admin-sidebar.tsx` o equivalente:
- Sezione "Canonicalizzazione" come parent
- Children: `🔭 Panorama` (`/admin/canonicalization`), `🎯 Eventi` (event-normalization), `📊 Mercati` (market-normalization), `🎲 Outcomes` (outcome-normalization), `📚 Catalogo Markets` (canonical-markets)

## Data Flow

**Inspector flow** (operatore cerca "Roma"):

```
1. User types "Roma" → debounce 400ms → URL push ?q=Roma
2. Client hook fetches /api/admin/canonicalization/inspect?q=Roma
3. Route handler calls supabase.rpc('inspect_event', {p_query: 'Roma', p_limit: 20})
4. RPC:
   a. Initial set: events WHERE home_team ILIKE '%Roma%' OR away_team ILIKE '%Roma%' OR external_id = 'Roma' OR flashscore_id = 'Roma' ORDER BY starts_at DESC LIMIT 50
   b. JOIN event_normalization, leagues, sports
   c. LATERAL JOIN aggregate markets/outcomes counts
   d. Group computation (3 cascading rules in CTE)
   e. JSON aggregate per gruppo
5. Client renders gruppi → 3 card per gruppo con campi e status icons
```

**Overview flow** (operatore apre tab Gerarchia):

```
1. Tab toggle → URL ?tab=overview
2. Client fetches /api/admin/canonicalization/overview
3. Route handler unstable_cache(60s) → supabase.rpc('canonicalization_overview')
4. RPC esegue ~10 sub-query in single CTE chain, ritorna single JSONB row
5. Client renders 5 KPI strips
```

**Drill-down flow** (operatore clicca "47 Betfair Unknown leagues"):

```
1. Click su label
2. Client → router.push('/admin/event-normalization?source=betfair')
3. Pagina esistente carica con filtro source=betfair (già supportato)
4. Operatore filtra manualmente per league=Unknown nella UI di destinazione
```

Decisione esplicita (Q6): **nessuna estensione** delle pagine deep-dive. Solo query params che già esistono.

## Error Handling

- **RPC timeout** (>10s): fallback UI "Errore caricamento dati. Riprova." con button retry. Loggare `console.error` con query e durata.
- **Empty result** in inspector: messaggio "Nessun evento trovato per '<query>'" con suggerimenti di ricerca.
- **Single-source group** (gruppo con 1 evento isolato): rendering normale ma con badge "🔍 Solo 1 source — possibile match cross-source non rilevato (vedi Task #2)".
- **No data** in overview: rendering KPI con tutti `total: 0` e tooltip "DB sembra vuoto, verifica scraper".
- **API auth fail**: redirect a login (existing middleware).
- **Field signals legend**: tooltip on hover icona spiega cosa significa "feature_pending" / "absent_problem" / etc.

## Testing

- **Unit**:
  - `lib/admin/canonicalization-signals.ts` (helper che computa colori e icone): 8-12 test cases.
- **RPC tests** (`scripts/db/test-canonicalization-rpcs.mjs`):
  - `inspect_event('Roma')` → ritorna gruppi previsti (con seed fixture).
  - `inspect_event('kambi:99999')` → ritorna gruppo isolato.
  - `inspect_event('NoExist')` → ritorna [].
  - `canonicalization_overview()` → schema valido, totals coerenti con altri RPC esistenti (es. il `flashscore_mapped` deve coincidere con `event_normalization_coverage_pct(7, false)`).
- **Component tests** (vitest + Testing Library):
  - Inspector card rendering con stati misti.
  - KPI color coding (90%/75%/50%).
  - Tab switching preserva query string.
- **E2E** (manuale post-deploy): aprire `/admin/canonicalization`, cercare 3-4 nomi team noti, verificare side-by-side rendering, click su KPI drill-down.

## Migrations

**Mig 122** (`122_canonicalization_observability_rpcs.sql`):
- `CREATE OR REPLACE FUNCTION canonicalization_overview() RETURNS jsonb`
- `CREATE OR REPLACE FUNCTION inspect_event(p_query text, p_limit int default 20) RETURNS jsonb`
- Nessun ALTER TABLE, nessun INSERT, nessun INDEX nuovo.

Rollback: `DROP FUNCTION canonicalization_overview(); DROP FUNCTION inspect_event(text, int);` — sicuro, idempotente.

## Roadmap (post-deploy questa pagina)

| Step | Task | Effort | Effetto sulla pagina |
|---|---|---|---|
| 1 | Deploy questa pagina (`/admin/canonicalization`) | ~5h | Baseline visibility |
| 2 | Task #3 — Betfair static map competition (separate spec) | ~2-3h | Level 2 leagues unknown 47→<10 ✅ |
| 3 | Task #2 — Cross-source synthetic canonical_id + is_source_only (separate spec) | ~6-8h | Level 3 events `cross_source_canonical` da 0 → ~70% ✅, `is_source_only` flag attiva |

Ogni step successivo ha **feedback visivo immediato** sulla pagina di osservabilità: prima del deploy le metriche sono 🔴/🟡, dopo passano a 🟢. Questo è il contratto di valore della pagina.

## Open questions

- **Q-open-1**: Performance della RPC `inspect_event` con trigram clustering inline. Se troppo lenta (>2s) su prod (60k events), considerare alternative: (a) limitare clustering al sub-set risultato della query (probabilmente ≤50 events, fattibile), (b) esporre solo flashscore-grouping iniziale e fare trigram lato client. Misurare in dev/staging prima di prod.
- **Q-open-2**: Field signals "absent_problem" per `tour_code` Betfair. Quando consideriamo `tour_code` "atteso"? Solo per sport tennis-like (ATP/WTA/Slam tournaments). Vincoliamo via white-list di sport_id, oppure deferiamo a dopo (Q-open trasformata in "absent_ok" sempre per Betfair finché non ci interessa). Risoluzione tentativa: deferiamo, mostrare sempre "absent_ok" finché Task #2 / #3 non chiede policy esplicita.
- **Q-open-3**: Mobile responsive. Decisione: best-effort stack verticale, no priorità. Se utente di prod chiede mobile, follow-up.

## Approval gate

Spec da approvare. Punti che richiedono conferma esplicita:

1. Naming pagina: `/admin/canonicalization`, sidebar "🔭 Canonicalizzazione".
2. 2 tab in unica pagina (Inspector + Gerarchia), URL persistente.
3. RPC overview cached 60s, RPC inspect no-cache.
4. Drill-down via redirect a pagine esistenti (no logica duplicata).
5. Mig 122 = solo 2 RPC nuove, zero schema change.
6. Effort ~5h, foundation per Task #2 e #3 successivi.

Se OK → procedo a writing-plans skill per implementation plan.
