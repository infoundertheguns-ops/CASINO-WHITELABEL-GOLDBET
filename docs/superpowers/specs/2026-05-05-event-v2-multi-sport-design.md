# Event-v2 multi-sport extension — design

**Author**: assistant + user (info.softvisiontechnologies@gmail.com)
**Date**: 2026-05-05
**Status**: design proposed, awaiting plan/implementation
**Branch target**: `feature/plan-d-settlement-d1`
**Predecessors**: `2026-05-03-event-page-redesign-design.md` (calcio Plan B), `2026-05-04-event-v2-tennis-design.md` (tennis), `2026-05-04-event-v2-basket-design.md` (basket)

## 1. Goal & scope

Estendere il render `event-v2` (kiosk event detail page rinnovato) ai 12 sport residui presenti in `events_v2`, dopo che calcio/tennis/basket sono già live in produzione.

**Sport target** (15 totali nel DB events_v2; 3 già coperti):

| # | Slug events_v2 | DB slug (legacy) | Eventi survey | Tier |
|---|---|---|---|---|
| 1 | football | calcio | 4387 | ✅ già v2 |
| 2 | tennis | tennis | 2112 | ✅ già v2 |
| 3 | basketball | basket | 978 | ✅ già v2 |
| 4 | baseball | baseball | 740 | A |
| 5 | esports | esports + 6 alias (counter-strike, dota, dota-2, valorant, league-of-legends, rainbow-six) | 532 | A |
| 6 | handball | pallamano | 322 | A |
| 7 | ice-hockey | hockey-ghiaccio | 182 | A |
| 8 | volleyball | pallavolo + volley | 177 | A |
| 9 | darts | freccette | 120 | A |
| 10 | rugby | rugby + rugby-league | 109 | A |
| 11 | cricket | cricket | 103 | A |
| 12 | boxing | boxe + pugilato | 54 | B |
| 13 | mma | arti-marziali | 49 | B |
| 14 | american-football | football-americano | 8 | C |
| 15 | snooker | snooker | 3 | C |

Tier = profondità del lavoro per sport (sezione 4).

**Out of scope**:
- Live event mode (`LiveMarketGrid` legacy invariato).
- Listing page redesign — già coperta da Plan D S3d.
- Performance optimization listing (registry item 22).
- Card Handicap / Handicap-1T edge case (`"1 (-1)"` outcome con line embedded).
- Stats tab dedicato (i mercati statistiche restano sotto Player sub-pill come per calcio).
- 6c S5 prod-anonymized validation (time-locked, separato).

## 2. Architettura: refactor B (centralized title overrides)

### Stato attuale

- `lib/market-config-v2.ts` (307 LoC): registri `TAB_MARKETS_BY_SPORT`, `TAB_ORDER_BY_SPORT`, `DEFAULT_SUB_PILL_BY_SPORT` con configs per `football`/`tennis`/`basket`.
- `app/(kiosk)/event/[eventId]/page-v2.tsx`: `BASKET_TITLE_OVERRIDES` (18 entry) + `resolveBasketOverride()` inline + branch hardcoded `if (sportSlug === "basket")` in `titleFor()`.

### Refactor proposto

1. **Sposta** `BASKET_TITLE_OVERRIDES` da `page-v2.tsx` a `lib/market-config-v2.ts` come voce dentro nuovo registro centralizzato:

```ts
export const TITLE_OVERRIDES_BY_SPORT: Record<string, Record<string, string>> = {
  basket: { /* 18 entry esistenti, invariate */ },
  // 12 nuovi sport popolati nelle prossime fasi
};
```

2. **Sostituisce** `resolveBasketOverride()` con helper unico:

```ts
export function resolveTitleOverride(
  sportSlug: string,
  marketType: string,
): string | null {
  const map = TITLE_OVERRIDES_BY_SPORT[sportSlug];
  return map?.[marketType] ?? null;
}
```

3. **Cambia** `titleFor()` in `page-v2.tsx`: rimuove branch `if (sportSlug === "basket")` e chiama `resolveTitleOverride(sportSlug, m.market_type)` per **tutti** gli sport. `renderGroupedMarket()` usa lo stesso helper invece di chiamare `resolveBasketOverride` direttamente.

4. **Estende** i 3 registri sport-config esistenti con 12 nuove voci (e relativi `XSPORT_TAB_MARKETS_V2`, `XSPORT_TAB_ORDER`, `XSPORT_DEFAULT_SUB_PILL` const).

### Invariante

Comportamento basket **identico** post-refactor. Smoke test su 1 evento basket post-refactor = baseline check.

### Perché B vs alternative

| Approccio | Effort iniziale | Costo per sport | `page-v2.tsx` finale | Verdetto |
|---|---|---|---|---|
| A: copia-incolla | 0 | ~25 LoC boilerplate per sport | +300 LoC boilerplate | scaling lineare cattivo |
| **B: tabella centrale** | ~30min refactor basket | ~10 LoC dati | -20 LoC | ✅ scelta |
| C: file per sport | ~1.5h refactor | 1 file nuovo | -20 LoC | over-engineering per ~50 LoC/sport |

## 3. Workflow per-sport (mechanical, replicabile)

### Step 1: Survey market_types
```sql
SELECT market_type, COUNT(*) AS n
FROM v_player_markets
WHERE sport_slug = '<sport>'
GROUP BY 1 ORDER BY 2 DESC;
```
Output → tabella di riferimento. Se 0 righe (sport con dummy data only): fallback a `LIVE_DETAIL_TABS[<sport>]` legacy o template base.

### Step 2: Decidere tab structure
- **Sport con `LIVE_DETAIL_TABS` legacy** (icehockey, eleague, darts, mma, boxing): mirror legacy + aggiustamenti dove survey rivela mismatch
- **Sport assenti dal legacy** (volleyball, rugby, handball, baseball, am-football, cricket, snooker): design da zero usando template base `["Mercati Principali", "U/O", "Handicap", "Tempi", "Player", "Altri"]` + filtro per cosa esiste in DB

### Step 3: Definire `XSPORT_TAB_MARKETS_V2`
Mappa ogni mercato del survey al tab/sub-pill corretto, con suffissi `@picker`/`@flat`/`@grouped`.

### Step 4: Title overrides "best effort" (Q4-C)
Aggiungo entry in `TITLE_OVERRIDES_BY_SPORT[sport]` solo per mercati con nome DB anglosassone/brutto. Esempi: `"T/T Match" → "VINCENTE MATCH"`, `"ML 1H" → "VINCENTE 1° TEMPO"`.

### Step 5: Registrare in 3 registri
```ts
TAB_MARKETS_BY_SPORT[<sport>]      = XSPORT_TAB_MARKETS_V2;
TAB_ORDER_BY_SPORT[<sport>]        = XSPORT_TAB_ORDER;
DEFAULT_SUB_PILL_BY_SPORT[<sport>] = XSPORT_DEFAULT_SUB_PILL;
```

### Step 6: Hero rule
Decisione mechanica per sport (vedi tabella sotto). Hero = mercato prominente in cima al tab "Principali".

| Sport | Hero | Motivo |
|---|---|---|
| baseball | T/T Match | 2-way (no draw) |
| esports | T/T Match | 2-way |
| handball | 1X2 Tempo Regolamentare | 3-way (draw possibile) |
| ice-hockey | 1X2 Tempo Regolamentare | 3-way |
| volleyball | T/T Match | 2-way (no draw) |
| darts | T/T Match | 2-way |
| rugby | runtime: 1X2 se outcomes [1,X,2] presenti, altrimenti T/T | union vs league mix |
| cricket | T/T Match | 2-way |
| boxing/mma | T/T Match | 2-way |
| am-football | T/T Match (ML) | 2-way |
| snooker | T/T Match | 2-way |

### Step 7: Alias DB-slug + slug events_v2
Il flag matcha contro `events.sport.slug` (legacy DB-slug, sondato dalla `sports` table). I config registry usano lo stesso slug (verifica empirica durante refactor B). Per sport con alias multipli, registrazione N-volte. Lista concreta degli alias rilevanti dalla `sports` table:

| Sport target | Slug DB attivi nella `sports` table |
|---|---|
| baseball | `baseball` |
| esports | `esports`, `dota`, `dota-2`, `counter-strike`, `valorant`, `league-of-legends`, `rainbow-six`, `call-of-duty`, `honor-of-kings`, `e-basketball` |
| handball | `pallamano` |
| ice-hockey | `hockey-ghiaccio` |
| volleyball | `pallavolo`, `volley` |
| darts | `freccette` |
| rugby | `rugby`, `rugby-league`, `rugby-union`, `rugby-sevens` |
| cricket | `cricket` |
| boxing | `boxe`, `pugilato` |
| mma | `mma`, `arti-marziali`, `martial-arts` |
| am-football | `football-americano` |
| snooker | `snooker` |

Pattern di registrazione (esempio volleyball):
```ts
TAB_MARKETS_BY_SPORT["pallavolo"]      = VOLLEY_TAB_MARKETS_V2;
TAB_MARKETS_BY_SPORT["volley"]         = VOLLEY_TAB_MARKETS_V2;
TAB_ORDER_BY_SPORT["pallavolo"]        = VOLLEY_TAB_ORDER;
TAB_ORDER_BY_SPORT["volley"]           = VOLLEY_TAB_ORDER;
DEFAULT_SUB_PILL_BY_SPORT["pallavolo"] = VOLLEY_DEFAULT_SUB_PILL;
DEFAULT_SUB_PILL_BY_SPORT["volley"]    = VOLLEY_DEFAULT_SUB_PILL;
TITLE_OVERRIDES_BY_SPORT["pallavolo"]  = VOLLEY_TITLE_OVERRIDES;
TITLE_OVERRIDES_BY_SPORT["volley"]     = VOLLEY_TITLE_OVERRIDES;
```

Concrete flag value finale (atteso, refinement in Fase 1 Step 1 quando si verifica quali slug hanno effettivamente eventi):
```
NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio,tennis,basket,baseball,esports,dota,dota-2,counter-strike,valorant,league-of-legends,rainbow-six,call-of-duty,honor-of-kings,e-basketball,pallamano,hockey-ghiaccio,pallavolo,volley,freccette,rugby,rugby-league,rugby-union,rugby-sevens,cricket,boxe,pugilato,mma,arti-marziali,martial-arts,football-americano,snooker
```

## 4. Rollout

### Fase 1: Author config (no kiosk needed, ~3-4h)
1. Refactor B: muove `BASKET_TITLE_OVERRIDES` da `page-v2.tsx` a `market-config-v2.ts` + helper unico
2. Smoke test rapido basket post-refactor (regressione baseline)
3. Per ogni 12 sport: survey + tab config + title overrides + register
4. Commit incrementale (1 commit/sport per granularità + rollback granularity)

### Fase 2: Build & deploy senza flag flip (~10min)
1. `npm run build` su admin-plan-d locale poi mirror VPS player
2. Manual copy `.next/static` + `public/` in `.next/standalone/` (deploy gotcha noto)
3. Symlink `.env.local` in standalone (deploy gotcha noto)
4. `systemctl restart betssolution-player`
5. Verifica `BUILD_ID` nuovo + service active + `/api/health` 200

### Fase 3: Seed dummy data (~10min)
**Threshold dummy data**: seed eventi dummy per ogni sport che soddisfa **almeno una** delle condizioni:
- (a) `<10 eventi prematch` attualmente in `events_v2` (am-football=8, snooker=3 sicuramente; refresh count in Fase 1)
- (b) il survey market_types rivela meno del 60% dei tab del config con almeno 1 mercato (es. snooker ha solo 3 eventi e potenzialmente solo 2 market_types coperti su 4 tab)

Per ogni sport che soddisfa il threshold, seed:
- 1 dummy event per sport via SQL insert in `events_v2` con marker `league_slug = 'QA-DUMMY-<sport>'`, `starts_at = NOW() + INTERVAL '7 days'`, `status = 'prematch'`
- Markets rappresentativi (10-20 per sport) coprendo i tab del config in `markets_v2`
- Outcomes plausibili (1.50-3.50 odds range) in `outcomes_v2`
- Script: `scripts/seed-dummy-sports.sql` (idempotente: `INSERT ... ON CONFLICT DO NOTHING`)

### Fase 4: Flag flip + re-build (~10min)
1. Edit `.env.local` con il valore concreto enumerato in Sezione 3 Step 7 (eventualmente raffinato in Fase 1 dopo verifica quali alias sono effettivamente popolati)
2. `npm run build` (NECESSARIO perché `NEXT_PUBLIC_*` è inlined a build time)
3. Re-deploy steps di Fase 2
4. Smoke 3 baseline (calcio + tennis + basket) per regressione

### Fase 5: Smoke pass utente (~30-60min, USER on kiosk)
- Apri 1 evento per ognuno dei 12 sport (dummy o reale)
- Annotare issue: tab brutti, label brutti, bet slip non funziona, hero sbagliato
- Screenshot + descrizione

### Fase 6: Bugfix iterativo (~1-2h)
- Fix in `market-config-v2.ts` (90% dei casi: aggiunte title override, riassegnazioni mercati)
- Re-build + re-deploy
- Ripeti finché tutti gli sport passano acceptance

### Fase 7: Cleanup dummy data (~1min)
- `scripts/cleanup-dummy-sports.sql`: `DELETE FROM events_v2 WHERE league_slug LIKE 'QA-DUMMY-%'` (CASCADE FK to markets_v2 + outcomes_v2)
- Verifica `SELECT COUNT(*) FROM events_v2 WHERE league_slug LIKE 'QA-DUMMY-%'` = 0
- **Mandatory** prima di chiudere sessione

### Bonus: deploy script automation
Scrivere `scripts/build-deploy-player.sh` su VPS che fa:
1. `cd /root/betssolution-player && npm run build`
2. `cp -r .next/static .next/standalone/.next/`
3. `cp -r public .next/standalone/`
4. `ln -sf /root/betssolution-player/.env.local /root/betssolution-player/.next/standalone/.env.local`
5. `systemctl restart betssolution-player`
6. `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/api/health`

Costa 10min, salva ~15-20min su 4-5 deploy iterativi nella sessione. Item registry pending da settimane.

## 5. Acceptance criteria

Per ogni sport, "fatto" = tutti questi:

1. Tab structure renderizza senza tab vuoti visibili (auto-hide pattern già in place)
2. Hero rendering: mercato hero (T/T o 1X2 da tabella) in cima al tab "Principali"
3. Niente label brutto in tab "Principali" (tier A bar alta, tier B/C minimi)
4. Bet slip funzionante: cliccando un'odd viene aggiunta correttamente
5. No regressioni calcio/tennis/basket post-refactor B

## 6. Risks & mitigazioni

| Rischio | P | I | Mitigazione |
|---|---|---|---|
| Refactor B rompe basket existing | bassa | medio | Smoke baseline post-refactor (Fase 1 step 2). Rollback = revert commit. |
| Sport con DB-slug alias non flaggati | media | basso | Tutti gli alias enumerati nel flag. `SELECT DISTINCT sport.slug FROM events` durante Fase 1. |
| Categorizer non pesca mercato → tab "Altri" | alta | basso | Tab "Altri" auto-hide se vuoto. Gestito durante smoke. |
| Hero rule sbagliato per rugby (union vs league) | media | basso | Decisione runtime: 1X2 se outcomes [1,X,2] presenti, altrimenti T/T. |
| Player tab semi-vuoto su sport ricchi (am-football volume basso) | media | basso | Auto-hide sub-pill se vuoto. Iterazione futura. |
| Build cycle troppo lungo | bassa | medio | Bonus deploy script automation. |
| Flag flip rompe sport non testato | bassa | alto | Rollback flag = sed + rebuild. Pattern noto. |
| Cleanup dummy data dimenticato | media | medio | Script automatic in Fase 7 + verifica COUNT=0 mandatory. |
| `NEXT_PUBLIC_*` inlined a build time → flag flip senza rebuild silenzioso | alta | medio | Rollout doc esplicita rebuild post flip (Fase 4 Step 2). |

## 7. Follow-up esplicit (future work)

1. Smoke reale degli sport "blind" (am-football, snooker) quando arriveranno eventi reali → upgrade tier C → tier B
2. Title overrides "B" (deep) per sport tier A se feedback utente lo richiede
3. Hero per rugby: se vediamo abbastanza eventi, eliminare runtime decision e fissare per league sub-type
4. Estensione `getLiveDetailTabs` legacy → drop quando legacy retired
5. Card Handicap / Handicap-1T edge case (registry pending, custom parser se utenti chiedono)

## 8. File modificati attesi

### Admin git (committable):
- `lib/market-config-v2.ts` (+800-1000 LoC: 12 sport configs + TITLE_OVERRIDES_BY_SPORT)
- `app/(kiosk)/event/[eventId]/page-v2.tsx` (-30 LoC: rimuove basket override inline + branch)

### Non-git (mirror in artifacts/):
- Stessi due file, copiati in `docs/superpowers/artifacts/2026-05-05-event-v2-multi-sport/player/`

### SQL scripts:
- `scripts/seed-dummy-sports.sql`
- `scripts/cleanup-dummy-sports.sql`

### Bonus:
- `scripts/build-deploy-player.sh` (su VPS, opzionalmente mirror in artifacts)

## 9. Stima effort totale

| Fase | Tempo |
|---|---|
| 1. Author config | 3-4h |
| 2. Build/deploy senza flag | 10min |
| 3. Seed dummy data | 30min (script + insert) |
| 4. Flag flip + rebuild | 10min |
| 5. Smoke pass utente | 30-60min |
| 6. Bugfix iterativo | 1-2h |
| 7. Cleanup | 1min |
| **Totale elapsed** | **~6-8h** |
