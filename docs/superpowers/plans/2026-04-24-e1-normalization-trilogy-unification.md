# E1 — Normalization Trilogy Unification (Plan)

**Spec**: `docs/superpowers/specs/2026-04-24-admin-panel-audit-scraper-down.md` epic E1, P0.
**Date**: 2026-04-24.
**Estimated effort**: 5-8 giorni (grossa).
**Prereq**: E2 deployed (commit `2159725`) — canonical_markets UI stabile, modal pattern consolidato.

---

## Discovery

Situazione corrente delle 3 pagine di normalization:

| | Market | Outcome | Event |
|---|---|---|---|
| UI Run engine | ✅ ▶ + LLM | ❌ solo cron DB | ✅ Backfill + LLM console |
| Engine TS | `lib/normalize/engine.ts` (regex→dict→prop→llm) | ❌ **none** (solo SQL RPC + cron scraper-vps) | `lib/normalize/events/engine.ts` (regex→trigram→alias→prop→llm) |
| LLM integration | server-side se `ANTHROPIC_API_KEY` | n/a | **prompt stampato in console**, manuale |
| Manual assign | in-line edit | in-line edit | ❌ **`prompt()` browser nativo** |
| KPI top-row | ✅ 4 volume+type | ✅ 6 cards | ❌ solo tab Stats |
| Source support | Kambi, 22bet | Kambi, 22bet, Betfair | N/A (event-level) |
| Filter persistence URL | ❌ | ❌ | ❌ |
| Shared UI primitives | ❌ (inline style) | ❌ | ❌ |

**Asimmetrie da rimuovere**:
1. Outcome Normalization manca del motore TypeScript in-repo (drainage è solo via SQL RPC+cron).
2. Event Normalization LLM flow richiede operatore copia-incolla da DevTools → subagent.
3. Event Normalization "Assegna manualmente" chiede `flashscore_id` via `prompt()` nativo.
4. Market Normalization filter `source` non include Betfair (incoerente con le altre).

## Scope E1

### 1. Outcome Normalization engine (nuovo, parallelo a market)
NEW `lib/normalize/outcome/engine.ts` con stages:
- **regex**: pattern matching nome outcome (`Over`/`Si`/`1`/etc) → canonical_outcome_key via regole.
- **dictionary**: lookup tramite `outcome_dict` table (da migration 065+096+097) per match esatti.
- **propagation**: se stesso `(canonical_key, source_outcome_name)` già mappato in altra source → propaga.
- **llm** (opzionale, gate `useLlm`): batch prompt a Claude Haiku con catalogo `canonical_markets.outcomes`.
- **auto-verify**: come market, post-stage promuove `confidence>=90` a `verified=true` (gate da param).

Endpoint: `GET /api/admin/outcome-normalization?action=run-engine&chunk=500[&use_llm=1]` con risposta `EngineSummary` identica a market.

Cron scraper-vps esistente può rimanere (non va toccato in E1) — il bottone UI Run engine invocerà lo stesso endpoint del cron.

### 2. Event Normalization — engine LLM integration
Il `lib/normalize/events/engine.ts` ha già supporto LLM (stage 5, offline via `run-subagent`). Modifiche:
- Aggiungere signature `normalizeEventsBatch({client, chunkSize, useLlm, llmApiKey, ...})` coerente con market.
- Route `POST /api/admin/event-normalization/run-engine` (nuovo) che batcha N eventi unmapped e chiama `normalizeEvent` per ciascuno.
- Se `useLlm=1` e `ANTHROPIC_API_KEY` presente → stage 5 auto-run in-process, zero console.log.
- Mantenere `run-subagent` come fallback per chi non ha API key (retro-compat).

### 3. Event Normalization — manual assign modal (rimuove `prompt()`)
NEW `components/admin/event-normalization/manual-assign-modal.tsx`:
- Props: `{event: EventRow, onClose, onAssigned}`.
- Cercando su `be_fixtures` via endpoint nuovo `GET /api/admin/fixtures?action=search&q=<team>&sport=<sport>&date_window=3h` (riusa fixture API esistente o estende).
- Preview match candidato: home/away/date/league.
- Supporta paste di URL Flashscore: parser estrae `match_id` da URL (eg `https://www.flashscore.it/partita/xxx-yyy-match/ABCDEFGH/` → `ABCDEFGH`).
- Conferma in 1 click → POST `manual-assign` come oggi.

### 4. UI shared: `<NormalizationDashboard>`
NEW `components/admin/normalization/normalization-dashboard.tsx` — componente parametrizzato:
```ts
interface NormalizationDashboardProps<TRow> {
  domain: 'market' | 'outcome' | 'event';
  kpiLoader: () => Promise<NormalizationKpi>;
  rowsLoader: (filters: Filters) => Promise<{ rows: TRow[]; total: number }>;
  renderRow: (row: TRow, handlers: RowHandlers) => ReactNode;
  runEngine?: (args: {useLlm: boolean; chunk: number}) => Promise<EngineSummary>;
  sources: Array<{value: string; label: string; color: string}>;
  canonicalOpen?: (key: string) => void; // for modal drill-through
  filters: FilterDef[];
  bulkActions?: BulkAction[];
}
```
- Esponi KPI top-row, source tabs, filter bar, bulk bar, tabella (render row parametrico), progress bar engine, pagination.
- Tutti i filtri sincronizzati in URL `searchParams` via hook `useAdminFilters`.
- 3 pagine ridiventano thin wrappers: fetch+renderRow specifico, delega tutto al dashboard.

**Rischio**: refactor tocca TRE pagine contemporaneamente → incident blast radius alto. Mitigazione: rollout per-pagina in commit separati (4 commit: shared+outcome, shared integration market, shared integration event, cleanup/tests).

### 5. Betfair filter support in Market Normalization
Aggiungere `betfair` a `VALID_SOURCES` e `SOURCE_OPTS` in Market Normalization (API + UI). RPC `list_markets_normalization_paged` già supporta source filter generico — verificare.

### 6. LLM integration improvements (shared)
- `lib/normalize/llm.ts` e `lib/normalize/events/llm-core.ts`: convergere su pattern unico.
- Modulo shared `lib/normalize/llm-shared.ts` con:
  - `callClaude(apiKey, systemPrompt, userPrompt, batchSize)` wrapper Anthropic SDK.
  - Prompt caching su `systemPrompt` (canonical catalog).
  - Usage tracking (input/output/cache tokens).
- Se `ANTHROPIC_API_KEY` presente, UI runEngine button runna server-side.
- Se missing, UI mostra messaggio "Configura ANTHROPIC_API_KEY o contatta dev" — **niente fallback console**.

## Fuori scope E1

- Outcome Normalization engine da zero NON deve duplicare il cron scraper-vps esistente: admin UI runna la stessa logic, zero fight.
- Drag&drop reorder dei bulk actions → future.
- Undo/redo → future.
- i18n labels UI → future.
- SQL-side porting del heuristic IT/EN (E3) → future epic.

## Ordine di implementazione (4 sotto-fasi)

### F1 — Outcome engine + shared LLM module (1-2g)
1. `lib/normalize/llm-shared.ts` — estrazione wrapper Claude.
2. `lib/normalize/outcome/engine.ts` — nuovo, usa shared LLM.
3. Endpoint `/api/admin/outcome-normalization?action=run-engine`.
4. Outcome Normalization UI: aggiungi ▶ Run engine button + progress + engine summary banner (pattern copiato da market).
5. Commit `feat(admin): E1.F1 - outcome engine + shared LLM module`.
6. Deploy staging.

### F2 — Event Normalization: LLM in-process + manual assign modal (1-2g)
1. `lib/normalize/events/engine.ts` — wrap in `normalizeEventsBatch` con `useLlm` integrato.
2. Endpoint `/api/admin/event-normalization/run-engine` (server LLM).
3. NEW `<ManualAssignModal>` component con fixture search + URL parser.
4. Event Normalization UI: sostituisci `prompt()` con modal, aggiungi KPI top-row coverage %, filter per source, paginazione.
5. Commit `feat(admin): E1.F2 - event engine LLM in-process + manual assign modal`.
6. Deploy staging.

### F3 — Shared `<NormalizationDashboard>` + refactor (2-3g)
1. NEW `<NormalizationDashboard>` component con signature parametrizzata.
2. Refactor Market Normalization page → usa shared dashboard.
3. Refactor Outcome Normalization page → usa shared dashboard.
4. Refactor Event Normalization page → usa shared dashboard.
5. Smoke test manuale sulle 3 pagine.
6. Commit `refactor(admin): E1.F3 - unified NormalizationDashboard for market/outcome/event`.
7. Deploy staging.

### F4 — URL searchParams + Betfair in Market Norm + cleanup (1g)
1. Hook `useAdminFilters<T>(defaults)` — sync state ↔ URL searchParams via `next/navigation`.
2. Applicare nelle 3 pagine.
3. Market Norm: aggiungere Betfair a VALID_SOURCES + dropdown.
4. Rimuovere dead code (copy-paste console LLM flow, duplicati style inline).
5. Typecheck + lint clean.
6. Commit `refactor(admin): E1.F4 - URL filters + Betfair support + cleanup`.
7. Deploy staging + prod.

## Rischi e mitigazioni

| Rischio | Mitigazione |
|--------|-------------|
| Shared dashboard introduce regressioni su 3 pagine insieme | Rollout F3 per-page in sotto-commit separati (market → outcome → event). |
| Outcome engine TS duplica cron scraper-vps → race | UI endpoint invoca stesse funzioni idempotenti (upsert onConflict); cron resta alive, nessun conflitto. Se serve: mutex via advisory lock PG. |
| LLM cost esploso se operatore spamma button | Budget batch default 10, maxDynamic 50. Warn UI pre-run con stima `batches × 0.03€` |
| `ANTHROPIC_API_KEY` missing in prod env | Pre-flight check in route; se missing, UI button disabled con tooltip "LLM non configurato". |
| Manual assign modal cerca fixture non matchante | Fallback input libero `be_match_id` come fallback (come oggi, ma in modal). |
| Event Normalization run-engine blocca worker | Background queue via Redis? No, mantenere sync 60s timeout per E1; async workers = future epic. |

## Delta pre/post E1

| Capability | Pre | Post |
|---|---|---|
| Outcome engine TS in admin repo | ❌ | ✅ |
| ▶ Run engine button in Outcome UI | ❌ | ✅ |
| Event Normalization LLM in-process | ❌ (console+subagent) | ✅ (API key o subagent fallback) |
| Event Normalization manual assign `prompt()` | ❌ | ✅ modal con fixture search + URL parser |
| KPI top-row coerente 3 pagine | ❌ | ✅ |
| Source tabs: Betfair in Market Norm | ❌ | ✅ |
| Filters deep-link URL | ❌ | ✅ |
| Shared UI primitives | inline | `<NormalizationDashboard>` |
| Dead code LLM console | presente | rimosso |
| Progress bar run engine | ❌ | ✅ (KPI remaining + ETA rough) |

## Success criteria

- [ ] Click ▶ Run engine in Outcome Normalization processa batch, aggiorna KPI, mostra summary.
- [ ] Click "Assegna" in Event Normalization apre modal con search live + URL parser, zero `prompt()`.
- [ ] ANTHROPIC_API_KEY configurato → LLM batch runna server-side senza copy-paste.
- [ ] Le 3 pagine hanno KPI top-row visivamente coerenti.
- [ ] Ricaricando pagina Market Norm con filtri applicati, i filtri persistono (URL deep-link).
- [ ] Betfair selezionabile in Market Norm dropdown source.
- [ ] Typecheck + staging green per ogni sotto-commit F1→F4.
- [ ] Prod deploy senza regressioni: KPI staging = KPI prod post-deploy (smoke-check).

## Open questions

1. **ANTHROPIC_API_KEY**: è configurato nell'environment prod di `betssolution-admin`? Se no, serve aggiungerlo prima di F2/F3 (o accettare che LLM button resti disabled in prod fino a setup).
2. **Outcome engine cron**: mantenere il cron scraper-vps `*/15min` oppure sostituirlo completamente con l'endpoint admin UI? Raccomandazione: mantenere per resilience (admin può andare offline).
3. **Event engine budget default**: LLM batch max 50? 100? Trade-off costo/velocità.
