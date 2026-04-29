# Admin Panel Audit — Scraper-Down Pages

**Date**: 2026-04-24
**Scope**: 14 pagine del gruppo SISTEMA dell'admin panel (Scraper Monitor → Fixtures). Settlements esclusa (fuori scope, da riclassificare nel gruppo AGENTI).
**Method**: walkthrough pagina-per-pagina con utente, raccolta osservazioni strutturate, consolidamento.
**Source notes**:
- `memory/session-2026-04-23-admin-review-part1.md` (pagine 1-4)
- `memory/session-2026-04-23-admin-review-part1.md` continuazione PM (pagine 5-6)
- `memory/admin-review-observations-2026-04-24.md` (pagine 7-14)
- `memory/admin-auto-min-cap-vision.md` (PARKED — non applicare)

> **Nota architetturale**: la vision **Auto-Min + Cap** è **PARKED** per decisione utente ("non voglio più cambiare architettura"). Consensus/Shade/Manual Overrides restano 6 pagine separate come oggi. La spec qui descritta NON ne presuppone il refactoring.

---

## 1. Gap trasversali (applicabili a ≥3 pagine)

### T1. Betfair UI gap
Backend già integra Betfair (peso 1.0 consensus, drill-down 3-src in shade, outcome normalization). Ma **l'UI** mostra Betfair solo parzialmente:
- ✅ Outcome Normalization ha tab Betfair.
- ❌ Market Normalization: dropdown source solo Kambi/22bet.
- ❌ Market Coverage: tab solo Kambi/22bet/Ippica.
- ❌ Consensus Outliers: solo Kambi vs 22bet colonne.
- ❌ Shade Monitor: drill-down 3-src ma KPI non decoupled.

**Azione**: uniformare `source ∈ {kambi, 22bet, betfair}` in tutte le pagine di osservabilità e normalization.

### T2. Pattern "page delegates to dashboard component" incoerente
Alcune pagine sono thin (7 righe che delegano a component grande), altre hanno il rendering tutto dentro `page.tsx`.
- Thin: Scraper Monitor → `stats-dashboard`, Market Coverage → `CoverageDashboard`, Fixtures → `FixturesDashboard`.
- Fat: tutte le normalization pages, Canonical Markets, Home Content, Market Catalog, Consensus, Shade Monitor, Manual Overrides, Settlements.

**Azione**: convergere al pattern thin (page = route, dashboard = component), per separazione route/rendering e test.

### T3. Styling inline pervasivo vs Tailwind atteso
CLAUDE.md dichiara Tailwind come stack frontend. **Ogni pagina admin usa styling inline** (`style={{...}}`) invece di classi Tailwind. Pattern trasversale.

**Azione**: tech-debt. Estrarre componenti UI primitives condivisi (`AdminKpi`, `AdminTable`, `AdminFilterBar`, `AdminStatusBadge`, `AdminPagination`) in `components/admin/ui/`. Migrare gradualmente a Tailwind + variants.

### T4. Filtri in React state locale, no deep-link
Nessuna pagina persiste filtri in URL search params. Impossibile condividere "vista filtrata Kambi unmapped confidence<50" con un collega.

**Azione**: tutti i filtri delle pagine di normalization/catalog/coverage devono sincronizzarsi a `URLSearchParams` via `next/navigation` → deep-linkable.

### T5. Campi `notes` e `updated_at` presenti nei type ma non renderizzati
Pattern ripetuto in: Market Normalization, Outcome Normalization, Market Catalog, Canonical Markets, Fixtures.

**Azione**: aggiungere colonna "Aggiornato" e tooltip "Notes" dove presenti.

### T6. Drill-down mancanti tra pagine correlate
Zero cross-navigation tra pagine interdipendenti:
- Market Coverage → Consensus (stessi event_id).
- Market Normalization → Canonical Markets (click su canonical_key).
- Outcome Normalization → Canonical Markets + Market Normalization.
- Fixtures ↔ Event Normalization (fixture è autocomplete target).
- Settlement Health backlog → lista bet specifici.

**Azione**: deep-link bidirezionali. `CanonicalMarketDetailModal` shared component (epic E3 sotto).

### T7. Run engine button incoerente tra normalization pages
- Market Normalization: ▶ Run engine (chunk 500) con summary banner.
- Outcome Normalization: **zero bottone** (solo cron scraper-vps).
- Event Normalization: ▶ Backfill 500 + 🤖 Prepara LLM batch (stampa in console, orrore UX).

**Azione**: uniformare (epic E1 sotto).

### T8. Naming voci sidebar troppo stretto
"Scraper Monitor" contiene 7 sezioni (Health banners, Kambi hero, 22bet hero, Flashscore, Coverage KPIs, Freshness, Redis). "Settlement Health" ha backlog/stuck/ippica. "Market Coverage" 3 tab. **Il nome in sidebar non lascia intuire il contenuto**.

**Azione**: rename + eventuale expand/collapse section nella sidebar con sotto-link.

### T9. Duplicazione info Flashscore
Flashscore actor appare in Scraper Monitor E in Settlement Health con KPI sovrapposti (freshness, coverage).

**Azione**: scegliere single source of truth per status Flashscore (presumibilmente Scraper Monitor). Settlement Health fa solo link "→ Scraper Monitor / Flashscore".

### T10. Ippica "card appiccicata"
Pattern "aggiunta a posteriori" in Settlement Health (actor card extra), Market Coverage (tab separato).

**Azione**: out of scope, richiede discussione architetturale Ippica vs generic sports → future epic.

### T11. Terminologia technical-heavy senza tooltip
`candidate_deltas`, `implied_prob`, `threshold_pct`, `shade-to-min`, `overround`, `extracted_by=xs`. Operatore non tecnico perso.

**Azione**: componente `<AdminGlossaryTerm>` con `<InfoTooltip>` che rimanda a un glossario unificato.

### T12. "Aggiorna" / "Ricarica" verb inconsistency
Same action, different labels across pages.

**Azione**: uniformare a "Aggiorna" (più friendly).

---

## 2. Epic di consolidamento (P0/P1/P2)

### E1. Normalization trilogy unification [P0]
**Problema**: Market, Outcome ed Event Normalization hanno UX divergente nonostante risolvano lo stesso pattern (source_X → canonical_X via pipeline multi-stage).

**Richiesta utente confermata**:
- Outcome Normalization deve essere porting 1:1 di Market Normalization (stesso engine pipeline, Run engine button, bulk ops, KPI layout).
- Event Normalization deve allinearsi stesso pattern + LLM integrato come stage dell'engine + manual override in-line via modal (no `prompt()` browser).

**Deliverable**:
- Componente `<NormalizationDashboard>` condiviso parametrizzato su `domain ∈ {market, outcome, event}`.
- Engine signatures uniformi: `regex → dictionary → propagation → (fuzzy|trigram) → llm → manual`.
- KPI top-row identico: Totale | Mappati X/Y (%) | Verificati | Da mappare.
- Per-source KPI breakdown (non solo aggregato) via mini-bar colored.
- Run engine button con progress bar real-time (remaining / ETA).
- LLM stage integrato server-side (ANTHROPIC_API_KEY o subagent pool), no copy-paste console.
- Event Normalization manual assign: modal con search Flashscore live, preview match (teams + date), parse URL Flashscore incollato.
- Coverage % renderizzato sempre (Event Normalization oggi solo `total_mapped` senza denominator).
- Tutti i filtri in URL searchParams.

**Pagine toccate**: Market/Outcome/Event Normalization.

### E2. Canonical Markets refactor [P0]
**Problema**: canonicali "in produzione" frozen (delete disabled, no PUT/PATCH UI). Outcomes come JSON textarea raw. Nessun drill-through dalle normalization pages.

**Richiesta utente confermata**: modale unificato `<CanonicalMarketDetailModal>` come UNICA UI per edit canonical.

**Deliverable**:
- Endpoint `PATCH /api/admin/canonical-markets/:key` (editabile: name_it, outcomes[], has_line, notes; immutable: canonical_key, base_key, period).
- Componente `<CanonicalMarketDetailModal>` con:
  - Definizione completa editabile (outcomes row-by-row con add/remove buttons, NO JSON textarea).
  - Tabs: Overview | Mapped markets (N) | Mapped outcomes (N) | History.
  - Drill-through bottone "Apri in Market Normalization filtrato" / "Apri in Outcome Normalization filtrato".
- In Outcome Normalization: dropdown `canonical_outcome_key` diventa **select ristretto** a `canonical_markets.outcomes` del canonical selezionato (server-side validation).
- Click su `canonical_key` in Market/Outcome Normalization table → apre il modal.
- Canonical Markets page diventa indice listing + "+ Nuovo" button + filter; tutto il resto passa dal modal.
- KPI top-row: Totale canonicali | has_line % | Per-period breakdown | Orphans (mapped_count=0).
- Periods da array hardcoded → caricati da DB (nuovi periods come `11T`/`12T`/`etp` compaiono senza redeploy).
- "Clona canonical" action per varianti (es. "U/O 2.5 1T" da "U/O 2.5 FT").

### E3. Market Translations page deletion [P1]
**Problema**: pagina standalone detector IT/EN read-only, nome fuorviante, semanticamente ridondante dopo l'avvento di canonical_markets (traduzione player viene da `canonical_name_it`, la lingua raw del source è irrilevante per i markets mappati).

**Decisione utente**: rimuovere completamente.

**Deliverable**:
- DELETE: `app/admin/market-translations/` + `app/api/admin/market-translations/route.ts`.
- DELETE: voce sidebar "Traduzioni Mercati".
- ADD in Market Normalization: KPI o filtro "Markets EN non-mappati" (il vero red flag = player vede stringa inglese grezza).
- ADD colonna opzionale "Lingua raw" in Market Normalization table per detection heuristic.

### E4. Market Catalog → Market Explorer cross-source [P1]
**Problema**: nome fuorviante, è dizionario 22bet statico non catalogo cross-source.

**Richiesta utente**: drill-down live per ogni mercato e outcome mostra quote delle 3 fonti (K | 22bet | BF) filtrato con dropdown sport → dropdown evento.

**Deliverable**:
- Rename page + sidebar: "Market Catalog" → "Market Explorer".
- Dropdown sport → dropdown evento → tabella mercati con colonne [Kambi odds | 22bet odds | BF odds] per ogni outcome.
- Sezione "Dizionario 22bet" diventa tab secondario, non landing primario.
- Fix over-fetch su ogni keystroke (debounce).
- Aggiungi paginazione (oggi limit 500 hardcoded).
- `outcome_count` → distingui "template count" vs "markets attivi in prod che usano questo G".
- KPI "Righe normalizzazione" cliccabile → link a Market Normalization.
- Sync success toast (oggi silenzioso).
- Cron cadence display ("Sync automatico ogni 20 min" / "Manual-only").

### E5. Home CMS modernization [P1]
**Problema**: CMS funzionale ma manca observability, preview, scheduling, versioning.

**Deliverable**:
- Live preview pane o link "Apri home player" in new tab con deep-link all'item selezionato.
- Drag&drop reorder (libreria `@dnd-kit/sortable`) — sostituisce ▲/▼ buttons.
- Upload preview pre-upload + client-side resize/compression (es `browser-image-compression`).
- Hint dimensioni consigliate per tipo (hero 1920×600, tile 96×96, flag 64×64).
- Validazione aspect ratio con warning non-bloccante.
- Href come autocomplete da catalogo route conosciute (sport/league DB-driven).
- Accent_color con preview tile applicata inline.
- Descrizione tab "live_sidebar" (tooltip/help icon).
- Versioning: tabella `home_content_history` (copia row prima di UPDATE), UI "Storico modifiche" modale con diff + rollback.
- Scheduling: campi `published_from` / `published_until` nullable. Cron attiva/disattiva automaticamente.
- Bulk actions: "Disattiva tutti i banner" per manutenzione.
- i18n `title`: struttura `title_it` + `title_en` + …
- External URL health check (cron periodico, flag broken).
- Audit log `who` + `when` per ogni modifica.
- Count tab distingue attivi/inattivi: `(8 totali / 5 attivi)`.
- File manager upload backend: mostrare storage used + lista orfani (file caricati ma mai referenziati → cleanup).

### E6. Fixtures ↔ Event Normalization bridge [P1]
**Problema**: Fixtures è read-only viewer disconnesso da Event Normalization, che è il suo consumer naturale.

**Deliverable**:
- In Fixtures: colonna `be_match_id` (oggi nel tipo ma non renderizzata) + count "Eventi scraper mappati (N)" cliccabile → Event Normalization filtrato.
- In Event Normalization manual assign modal (epic E1): ricerca live in Fixtures table, preview match, conferma in 1 click (rimpiazza `prompt()`).
- `status` column in Fixtures (upcoming/live/finished) — da derivare da `match_date` + enrichment live.
- Date preset chips: Oggi / Domani / Weekend / 7gg / Custom.
- Search estesa anche a league/country (oggi solo team).
- Sport KPI + Sport dropdown: mantenere solo una via di filtro (preferenza: KPI clickable, rimuovi dropdown duplicato).
- Sport list dynamic da DB (oggi 7 hardcoded, mancano snooker/darts/cricket/esports/rugby).
- Page size selector 25/50/100/200.
- Remove duplicate "Totale fixture" in header+footer.

### E7. Scraper Monitor consolidation con Settlement Health [P1]
**Problema**: duplicazione Flashscore actor in 2 pagine.

**Deliverable**:
- Scraper Monitor: diventa single source of truth per tutti gli actor scraping (Kambi, 22bet, Betfair, Flashscore).
- Settlement Health: rimuove Flashscore card + link verso Scraper Monitor section Flashscore.
- Coverage KPIs: spostate da Scraper Monitor a Market Coverage (unico posto).
- Ogni sezione Scraper Monitor ha deep-link collapsibile.

### E8. Glossary + accessibility pass [P2]
**Deliverable**:
- `<AdminGlossaryTerm>` component + JSON dictionary `lib/admin/glossary.ts`.
- Tooltip hover su tutti i termini tecnici (overround, implied_prob, candidate_delta, shade-to-min, extracted_by, etc.).
- Aria-label su tutti i button icon-only (✅/❌/▲/▼/🗑).
- Color-only status indicators aggiungono icona/label (per chi non distingue rosso/verde).

### E9. Shared admin UI primitives [P2]
**Deliverable**:
- `components/admin/ui/` package con: Kpi, Table (con sort/paginate), FilterBar, StatusBadge, Pagination, SourceBadge, ConfidenceCell, Modal, Toast.
- Migrare gradualmente tutte le pagine admin via refactor branch-per-pagina.
- Tailwind-first (no inline styles new code).

### E10. URL deep-link + filtri persistence [P2]
**Deliverable**:
- Hook `useAdminFilters<T>(defaults)` che sync state ↔ URL searchParams.
- Applicare a tutte le pagine con filtri (Normalization × 3, Market Coverage, Consensus, Shade Monitor, Manual Overrides, Catalog, Canonical Markets, Home Content, Fixtures, Settlements).

---

## 3. Epic scoring

| Epic | Priority | Est. effort | Value |
|------|----------|-------------|-------|
| E1 Normalization trilogy unification | P0 | L (5-8 giorni) | ★★★ |
| E2 Canonical Markets refactor | P0 | M (3-4 giorni) | ★★★ |
| E3 Market Translations deletion | P1 | S (1 giorno) | ★ |
| E4 Market Catalog → Explorer | P1 | M (3-4 giorni) | ★★ |
| E5 Home CMS modernization | P1 | L (5-7 giorni) | ★★ |
| E6 Fixtures ↔ Event Norm bridge | P1 | M (2-3 giorni) | ★★ |
| E7 Scraper Monitor consolidation | P1 | S (1-2 giorni) | ★ |
| E8 Glossary + accessibility | P2 | M (3-4 giorni) | ★ |
| E9 Shared admin UI primitives | P2 | XL (10+ giorni) | ★★ (tech-debt, enabler) |
| E10 URL deep-link | P2 | M (2-3 giorni) | ★ |

**Totale P0**: 8-12 giorni. **P1**: 12-17 giorni. **P2**: 15+ giorni.

---

## 4. Delta per-pagina (pre/post spec)

| Page | Pre | Post |
|------|-----|------|
| Scraper Monitor | 7 sezioni flat, duplicate Flashscore | Single source Flashscore + collapsibile |
| Settlement Health | Flashscore card + Ippica extra | Flashscore link-out a Scraper Monitor |
| Market Coverage | Kambi/22bet/Ippica tab | +Betfair, Ippica out-of-scope rimandata |
| Consensus Outliers | Kambi vs 22bet | +Betfair column + drill-down event |
| Shade Monitor | drill-down 3-src | PARKED (per decisione utente) |
| Manual Overrides | 4 azioni modale | PARKED (per decisione utente) |
| **Market Catalog** | Dizionario 22bet statico | **Market Explorer cross-source** (E4) |
| **Market Normalization** | Kambi/22bet only, engine UI ok | +Betfair, per-source KPI, URL filters (E1) |
| **Outcome Normalization** | Manual-only, 3 source | +Run engine, pipeline parity (E1) |
| **Event Normalization** | 5 tab + `prompt()` manual + LLM console | KPI top-row + LLM engine stage + manual modal (E1) |
| **Canonical Markets** | CRUD spezzato, outcomes JSON textarea | Modal unificato + drill-through (E2) |
| **Market Translations** | Detector read-only | **DELETED**, inglobato KPI in Market Norm (E3) |
| **Home Content** | CRUD basic | Preview live + drag&drop + versioning + scheduling (E5) |
| **Fixtures** | Read-only viewer isolato | Bridge bidirezionale a Event Norm (E6) |
| ~~Settlements~~ | ~~gestione commissioni~~ | Out of scope, riclassificare in gruppo AGENTI |

---

## 5. Non-goals / out of scope

- **Auto-Min + Cap vision**: parked per decisione utente 2026-04-23. Consensus/Shade/Manual Overrides restano 6 pagine separate, non consolidate. Riprendere solo se utente cambia posizione.
- **Ippica refactor**: sticker "card appiccicata" → future epic dedicato, richiede discussione architetturale.
- **Settlements Agenti**: riclassificare nel gruppo AGENTI con review separata.
- **Agent pages** (agent-bets, agent-commissions, …): fuori scope questa review.

---

## 6. Sequenza raccomandata di esecuzione

1. **E3 Market Translations deletion** (1 giorno, quick win, libera naming).
2. **E2 Canonical Markets refactor** (3-4 giorni, abilita modal condiviso riusato in E1).
3. **E1 Normalization trilogy unification** (5-8 giorni, core value).
4. **E6 Fixtures ↔ Event Norm bridge** (2-3 giorni, completa flow normalization).
5. **E7 Scraper Monitor consolidation** (1-2 giorni, dedup rapida).
6. **E4 Market Catalog → Explorer** (3-4 giorni).
7. **E5 Home CMS modernization** (5-7 giorni, standalone).
8. **E9 Shared admin UI primitives** (background refactor durante altre epic).
9. **E8 Glossary + accessibility** (parallelizzabile).
10. **E10 URL deep-link** (tocca molte pagine, meglio dopo E1/E2).

---

## 7. Open questions per ritorno dell'utente

1. **Settlements**: confermi riclassificazione a gruppo AGENTI e review separata?
2. **Ippica refactor**: vuoi che apriamo un'epic dedicata o resta così com'è?
3. **Priority override**: se dovessi scegliere 1 sola epic da fare questa settimana, quale? (mia raccomandazione: E3 + E2 insieme, 4-5 giorni totali, unlock enorme di UX).
4. **Tech-debt E9**: approvi l'investimento XL in shared primitives, o preferisci rimandare finché i pattern non si consolidano?
