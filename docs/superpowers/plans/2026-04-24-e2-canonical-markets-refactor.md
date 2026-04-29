# E2 — Canonical Markets Refactor (Plan)

**Spec**: `docs/superpowers/specs/2026-04-24-admin-panel-audit-scraper-down.md` (epic E2, P0).
**Date**: 2026-04-24.
**Estimated effort**: 3-4 giorni (ridotto a ~2g dopo discovery: POST esistente è già upsert).
**Prereq**: E3 deployed (commit `b65a9d4`).

---

## Discovery

Il backend di `/api/admin/canonical-markets` **supporta già l'edit** via POST + upsert `onConflict: "canonical_key"` (route.ts:49). Il gap è interamente UI: mancano il pulsante edit, un modale dedicato, e la validazione outcome→canonical. Niente migration SQL strettamente necessaria.

## Scope

1. **Backend minor additions**:
   - `GET /api/admin/canonical-markets/[key]/usage` → restituisce `{markets: MarketNormalization[], outcomes: OutcomeNormalization[]}` per drill-down dal modale.
   - `GET /api/admin/canonical-markets?action=periods` → distinct periods (per dropdown dinamico).
   - Validazione server-side in `/api/admin/outcome-normalization` POST: se `canonical_key` e `canonical_outcome_key` sono entrambi forniti, verifica che l'outcome_key appartenga agli `canonical_markets.outcomes[*].key` del canonical. Se no, 400 con messaggio chiaro.

2. **New shared component**: `components/admin/canonical/CanonicalMarketDetailModal.tsx`.
   - Props: `{canonicalKey: string | null, mode: 'view' | 'create', onClose, onSaved}`.
   - Fetch canonical + usage al mount (se `canonicalKey` not null).
   - Tabs: **Overview** | **Mapped markets (N)** | **Mapped outcomes (N)**.
   - Overview form:
     - `canonical_key` (disabled se mode=view, enabled se mode=create).
     - `base_key` (disabled se mode=view).
     - `period` select dinamico da `/api/admin/canonical-markets?action=periods` + "altro..." option per nuovi.
     - `canonical_name_it` text editable.
     - `has_line` checkbox.
     - `outcomes` list editor (no JSON textarea): tabella con righe `[key input | name_it input | ✕ remove]` + "+ Aggiungi outcome" button.
     - `notes` textarea.
     - Actions: `Salva` (POST upsert) | `Clona` (apre modale create con suffix `_v2`) | `Cancella` (disabled se usage.markets.length>0, conferma modale).
   - Mapped markets tab: tabella `[source | source_market_type | verified? | link "Apri in Market Normalization"]`.
   - Mapped outcomes tab: analoga.

3. **Refactor** `app/admin/canonical-markets/page.tsx`:
   - Aggiungere KPI top-row: totale canonicali, has_line %, orphans (mapped=0), per-period breakdown mini-bar.
   - Filter search esistente preservato.
   - Rimuovere form inline, bottone "+ Nuovo" apre modale (mode=create).
   - Click su riga tabella apre modale (mode=view).
   - Rimuovere bottone delete inline (delete va dentro modale per avere conferma contextuale).
   - Periods hardcoded `["ft","1h","2h","et","regular_time"]` → rimosse dalla page, dinamico via modale.

4. **Integrazione** `app/admin/market-normalization/page.tsx`:
   - Colonna `Canonical`: se `row.canonical_key` esiste, wrap in `<span onClick>` che apre il modal (mode=view, key=row.canonical_key).
   - State `modalKey: string | null` + render `<CanonicalMarketDetailModal canonicalKey={modalKey} ... />` a fondo pagina.
   - onSaved callback ricarica la lista.

5. **Integrazione** `app/admin/outcome-normalization/page.tsx`:
   - Click su `canonical_key` apre modale come sopra.
   - `canonical_outcome_key` field: quando `canonical_key` è presente (edit o view), cambia da text input a `<select>` popolato dai `canonical_markets.outcomes[*].key` (via fetch dedicato GET canonical).
   - Se `canonical_key === null`, cade a text input (fallback).
   - onBlur / save: server refuterà se outcome_key non matcha.

## Fuori scope E2

- Multilingua outcomes (name_it / name_en / name_es) → future epic.
- Drag&drop reorder outcomes → niente persistenza di `display_order` oggi, deferito.
- Audit history del canonical (chi/quando ha modificato) → future epic.

## Ordine di implementazione

1. Backend: endpoint usage + endpoint periods + validazione outcome-norm.
2. Nuovo `CanonicalMarketDetailModal.tsx`.
3. Refactor Canonical Markets page (rimozione form inline, integrazione modale, KPI).
4. Integrazione Market Normalization (click canonical → modale).
5. Integrazione Outcome Normalization (click canonical → modale + select outcome_key ristretto).
6. Smoke test manuale staging.
7. Commit unico `refactor(admin): E2 - Canonical Markets modal + CRUD unified + cross-page drill-through`.
8. Push master → merge staging → deploy.

## Rischi e mitigazioni

| Rischio | Mitigazione |
|--------|-------------|
| POST upsert overwrite parziale se frontend manda campi mancanti | Modal sempre invia payload completo; server verifica required fields pre-upsert. |
| `canonical_outcome_key` validation rompe flussi esistenti (backfill manuali) | Validation solo quando `canonical_key` è popolato; se null, no check (stato oggi). |
| Delete bloccato confonde operatore | Modal mostra conteggi mapped + spiega "N rows bloccano il delete, vedi tab Mapped markets per unmap-first". |
| Periods `altro...` introduce valori errati | Dropdown + text input per "altro" con warning + patterns noti suggeriti ({ft,1h,2h,et,regular_time,11T,12T,etp}). |
| Modal richiede scroll lungo per canonicals con tanti outcomes | Outcomes list scrollabile max-h 400px interno. |

## Delta pre/post E2

| Capability | Pre | Post |
|---|---|---|
| Edit canonical post-uso | ❌ impossibile (delete bloccato, no PATCH UI) | ✅ modal con edit piena |
| Outcomes editor | JSON textarea raw | Riga-per-riga add/remove |
| Drill-through da Market Norm | ❌ | ✅ click canonical_key → modale |
| Drill-through da Outcome Norm | ❌ | ✅ |
| Validazione outcome_key ∈ canonical | ❌ | ✅ server-side |
| Select ristretto outcome_key in Outcome Norm | ❌ text libero | ✅ select da canonical.outcomes |
| Periods list stale | hardcoded | ✅ DB-driven |
| KPI top-row | ❌ | ✅ totale, has_line%, orphans, period breakdown |
| Mapped count drill-down | ❌ (solo count numero) | ✅ tab con liste cliccabili |
| Clona canonical | ❌ | ✅ quick-clone con suffix |

## Success criteria

- [ ] Operatore può modificare `canonical_name_it` di un canonical con `mapped_count > 0` senza SSH.
- [ ] In Outcome Normalization scegliendo `canonical_key=u_o_ft`, il dropdown outcome_key mostra solo `over`/`under`.
- [ ] Click su `canonical_key` in Market/Outcome Normalization apre modale con la stessa view.
- [ ] Zero regressioni: create/delete/search funzionano come prima.
- [ ] Typecheck + lint pass, deploy staging green.
