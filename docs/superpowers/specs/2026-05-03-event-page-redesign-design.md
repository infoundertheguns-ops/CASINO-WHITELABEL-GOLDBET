# Event page redesign — design spec (calcio pilot)

**Data**: 2026-05-03
**Status**: Approved by user, ready for implementation planning
**Sport pilota**: calcio (football)
**Branch target**: `feature/plan-d-settlement-d1` (o derived feature branch)

## 1. Contesto e motivazione

La event page kiosk attuale (`app/(kiosk)/event/[eventId]/page.tsx`) è stata progettata sui dati derivati da scraper FlashScore con un vocabolario canonical legacy (`1x2_ft`, `u_o_ft`, ecc.). Post Plan D cutover S6 (2026-05-01) il path v2 (`loadPlayerEventV2()` → `v_player_*` views) salta esplicitamente l'enrichment canonical (vedi commento in `event/[eventId]/page.tsx:32`). Conseguenza: il categorizer `categorizeMarketsToTabs` non distribuisce correttamente i mercati nelle tab.

Inoltre l'integrazione odds-api porta nuove famiglie multi-line non gestibili dal layout corrente:

- U/O multi-linea (5 varianti per evento calcio)
- Asian Handicap multi-linea bidirezionale (4-8 varianti, signed lines incluse quarter line .25/.75)
- Asian Total per squadra (Total Home/Away over/under)
- European Handicap 3-way con linee multiple
- Player markets (Anytime/First/Last Marcatore, Marca+Assist, GK Saves, Player Shots OU)
- Stats markets (Total Cards/Corners O/U + 1T/2T variants + Hcap Corners + Corner Race)

Il design corrente raggruppa varianti multi-line come righe stacked indistinte → cluttered, scroll infinito, non touch-friendly su kiosk.

Questo spec ridisegna il content area della event page CALCIO (sport pilota) preservando la shell kiosk StanleyBet (header rosso, tab bar). Altri sport restano sul path legacy fino a brainstorm dedicati.

## 2. Constraints non negoziabili

- **Viewport**: 1920×1080 landscape fisso (`<meta viewport content="width=1920, initial-scale=1, maximum-scale=1, user-scalable=no">` confermato in `app/layout.tsx`)
- **Touch only**: tap target minimo 48×48px, no hover, no keyboard (no on-screen kbd in scope)
- **Shell preservata**: header 56px, tab bar 48px (rosso `#d0141c`, StanleyBet brand). NON ridisegnare cromature, bet slip, sidebar, polling 30s
- **No DB changes**: il path v2 `v_player_*` fornisce già tutti i dati. Spec è puramente frontend
- **Coexistenza con legacy**: feature flag `NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio` controlla quali sport usano il nuovo render. Default vuoto = tutti gli sport restano legacy
- **Reference SSBT internazionali**: Bet365, William Hill, Bwin, Pinnacle, Unibet — UI delle versioni SSBT/touch dove esistono, non versioni desktop

## 3. Tab structure

6 tab top-level rendered da `TabBar.tsx`. Default Principali. No carry-over selection tra eventi.

```
[Principali] [Gol/U/O] [Handicap] [Tempi] [Player] [Stats]
```

Sub-pill picker (rendered da `SubPillBar.tsx`) presente in 3 tab:

| Tab | Sub-pills | Default |
|---|---|---|
| Tempi | `[1° Tempo] [2° Tempo] [Combo HT/FT]` | Combo HT/FT |
| Player | `[Anytime] [1° Marcatore] [Ultimo] [Marca+Assist] [GK Saves] [Shots OU]` | Anytime |
| Stats | `[Cards] [Corners]` | Cards |

**Empty handling**: tab/sub-pill senza mercati per quell'evento restano visibili (no auto-hide), badge "—" sulla tab. Click → messaggio "Nessun mercato disponibile per questa categoria". Motivazione: nascondere tab causa inconsistenza tra eventi di leghe diverse.

### 3.1 Tab → mercati mapping (in `lib/market-config-v2.ts`)

```typescript
export const FOOTBALL_TAB_MARKETS_V2 = {
  "Principali": {
    markets: ["1X2", "DC", "GG/NG", "U/O@2.5", "DNB", "HT/FT@compact"],
  },
  "Gol/U/O": {
    markets: [
      "U/O@picker", "U/O - 1T@picker", "U/O - 2T@picker",
      "GG/NG", "GG/NG - 1T", "GG/NG - 2T",
      "Total Home@picker", "Total Away@picker",
      "Risultato Esatto@compact",
    ],
  },
  "Handicap": {
    markets: ["AH@picker", "AH - 1T@picker", "European Hcap@chip"],
  },
  "Tempi": {
    subPills: {
      "1° Tempo": { markets: ["1X2 - 1T", "DC - 1T", "GG/NG - 1T", "U/O - 1T@picker", "DNB - 1T"] },
      "2° Tempo": { markets: ["1X2 - 2T", "DC - 2T", "GG/NG - 2T", "U/O - 2T@picker", "DNB - 2T"] },
      "Combo HT/FT": { markets: ["HT/FT", "Risultato Esatto"] },
    },
  },
  "Player": {
    subPills: {
      "Anytime": { markets: ["Marcatore Anytime"] },
      "1° Marcatore": { markets: ["1° Marcatore"] },
      "Ultimo": { markets: ["Ultimo Marcatore"] },
      "Marca+Assist": { markets: ["Marca + Assist"] },
      "GK Saves": { markets: ["Goalkeeper Saves@picker"] },
      "Shots OU": { markets: ["Player Shots@picker"] },
    },
  },
  "Stats": {
    subPills: {
      "Cards": { markets: ["Total Cards@picker", "Cards 1T@picker", "Cards 2T@picker", "Total Cards Squadra"] },
      "Corners": { markets: ["Total Corners@picker", "Corners 1T@picker", "Corners 2T@picker", "Hcap Corners@chip", "1° Corner"] },
    },
  },
};
```

**Suffix semantics**:
- `@picker` → LinePicker hybrid C (3 stacked + expand "+ altre N linee")
- `@chip` → chip picker orizzontale (per famiglie con poche linee, es. EU Hcap)
- `@compact` → MatrixGrid (HT/FT 3×3) o ScoreGrid (Risultato Esatto 5×5)
- `@2.5` (e simili) → render single-line forced alla linea statica indicata
- nessun suffisso → render single-line standard (1 variante attesa)

I market_type stringhe sono i valori `market_type` esposti da `v_player_markets` (mig 159 dictionary canonical IT). I per-sport overrides applicati via mig 166-168 (basket "1X2 Tempo Regolamentare", hockey "1X2 TR", ecc.) sono casi futuri per altri sport, non rilevanti per calcio pilota.

## 4. Default lines per famiglia (in `lib/line-picker-defaults.ts`)

Strategia: **linea statica con fallback closest** (decisione user 2026-05-03). Per ogni `(sport_slug, market_type)` una linea di default; se quella linea non è offerta sull'evento, fallback alla più vicina disponibile numericamente.

```typescript
export const LINE_PICKER_DEFAULTS = {
  calcio: {
    "U/O": 2.5,            // standard IT assoluto
    "U/O - 1T": 0.5,       // "gol nel primo tempo si/no"
    "U/O - 2T": 1.5,
    "Total Home": 1.5,     // soglia tipica gol per squadra
    "Total Away": 1.5,
    "AH": 0,               // Asian Handicap → linea più vicina a 0 (selezione runtime)
    "AH - 1T": 0,
    "European Hcap": -1,   // handicap classico al favorito (3-way)
    "Total Cards": 3.5,    // standard IT (Snai/Goldbet)
    "Cards 1T": 1.5,
    "Cards 2T": 1.5,
    "Total Corners": 9.5,  // standard IT
    "Corners 1T": 4.5,
    "Corners 2T": 4.5,
    "Hcap Corners": 0,
    "Goalkeeper Saves": 3.5,  // OU per portiere — provvisorio, da tarare
    "Player Shots": 1.5,       // OU shots on target
  },
};
```

Nota AH: il valore `0` nel config è usato come "target", il LinePicker calcola la linea reale più vicina (es. `-0.5` se Inter favorita, `+0.5` se viceversa). Quarter line (.25/.75) trattata identicamente nel render.

## 5. Componenti

### 5.1 Componenti nuovi

```
components/event-v2/
  TabBar.tsx                  6 tab top + StanleyBet style (rosso #d0141c)
  SubPillBar.tsx              sub-pill picker orizzontale
  MarketSection.tsx           wrapper title + body, "altre linee →" link opzionale
  HeroOutcomeRow.tsx          Principali 1X2 prominent (size hero)
  CompactOutcomeRow.tsx       Principali grid 2-col cells (size compact)
  LinePicker.tsx              hybrid C: 3 stacked + expand
  AsianHandicapBlock.tsx      LinePicker wrapper bidirezionale + team labels
  EuropeanHandicapBlock.tsx   3-button row + chip picker linee
  MatrixGrid.tsx              HT/FT 3×3
  ScoreGrid.tsx               Risultato Esatto 5×5 (+ "4+" cattura)
  PlayerListTwoCol.tsx        2-col home/away marcatori
  OutcomeButton.tsx           atomico: hero/standard/compact size, suspended/odds-change states
  OddsFlash.tsx               2s green/red animation on odds change
```

### 5.2 OutcomeButton API

```typescript
type OutcomeButtonProps = {
  outcomeId: string;          // legacy id (fallback)
  outcomeIdV2: string;         // primary id (v_player_outcomes)
  label: string;               // "Inter", "Under", "Lautaro Martinez", "1.5"
  odds: number;                // 1.85
  isSuspended: boolean;        // bg #f0f0f0 + lock icon + non-clickable
  isManualSuspended: boolean;  // override admin (priorità visiva uguale)
  oddsChange: 'up' | 'down' | null;  // 2s flash green/red poi normale
  size: 'hero' | 'standard' | 'compact';
  onSelect: (outcome) => void;
};
```

Sizes:
- hero: padding 22px, odds 22px bold, label 11px → usato per Principali 1X2
- standard: padding 16px, odds 16px bold, label 10px → default LinePicker rows, AH/EU Hcap
- compact: padding 12px, odds 14px bold, label 9px → Principali 2-col, Matrix/Score grids, Player rows

### 5.3 LinePicker API

```typescript
type LinePickerProps = {
  marketFamily: string;        // "U/O", "AH", "Total Cards"
  variants: LineVariant[];     // tutti i mercati di questa famiglia per l'evento
  defaultLine: number;         // da LINE_PICKER_DEFAULTS
  topVisibleCount?: number;    // 3 default
  outcomeRenderer: 'under-over' | 'team-handicap' | 'cards-corners' | 'shots';
  expandedInitially?: boolean; // false default
};

type LineVariant = {
  line: number;
  marketId: string;
  marketIdV2: string;
  outcomes: { name: string; odds: number; isSuspended: boolean; ... }[];
};
```

Logica:
1. Sort variants per `line` ascending
2. Trova variant nearest to `defaultLine` (Math.min su `|line - defaultLine|`). Se più di una equidistante, prendi quella inferiore
3. Top-3 visibili: defaultVariant + 1 variant immediata sotto + 1 immediata sopra (se esistono)
4. La defaultVariant ha background `#fffbe6` + ★ marker dopo la label linea
5. Variant restanti dietro button "+ altre {N} linee" → expand inline (push markets sotto in DOM)
6. Edge cases:
   - 0 variants → render nulla (caller deve check)
   - 1 variant → no picker, single row
   - 2 variants → entrambe stacked, no expand
   - 3+ variants → top-3 + expand se >3

### 5.4 AsianHandicapBlock

Wrapper di `LinePicker` con:
- `outcomeRenderer='team-handicap'`
- Label outcome composta: `{teamName} {±line}` (es. "Inter -0.5", "Milan +0.5"). Il segno è inferito dal payload (line < 0 = primo outcome favorito)
- `defaultLine`: la linea con `Math.abs(line)` minimo (più vicina a 0)
- Quarter line (.25/.75) renderizzata identica, settlement back-end (Plan D classifier S5e già coperto, vedi memory) gestisce split

### 5.5 EuropeanHandicapBlock

Diverso da AH (non riusa LinePicker):
- 3 outcomes (1/X/2 con handicap applicato)
- Chip picker linee in basso (EU Hcap di solito 4-6 linee, no expand)
- Default linea: `-1` (o quella con il line più vicino a `-1`)
- Layout: HeroOutcomeRow-like con 3 buttons + chip strip sotto

### 5.6 MatrixGrid (HT/FT)

```typescript
type MatrixGridProps = {
  rowLabels: string[];      // ["HT 1", "HT X", "HT 2"]
  colLabels: string[];      // ["Finale 1", "Finale X", "Finale 2"]
  outcomes: Map<string, OutcomeData>;  // key = "1/1", "1/X", ..., "2/2"
};
```

- 9 OutcomeButton compact in matrice 3×3
- Headers riga + colonna con bg `#d0141c` (StanleyBet red)
- Cella mancante → "—" centrato non-clickable
- Parsing outcome: market_type "HT/FT", outcome.name format "X/Y" dove X=HT result, Y=FT result

### 5.7 ScoreGrid (Risultato Esatto)

```typescript
type ScoreGridProps = {
  homeMaxGoals: number;     // 4 default → +1 per "4+"
  awayMaxGoals: number;     // 4 default
  outcomes: Map<string, OutcomeData>;  // key = "0-0", "1-0", ..., "4+-4+"
  highlightedScore?: string;  // default "1-1"
};
```

- 25 OutcomeButton compact in matrice 5×5
- Headers riga = goal home (`#003a7e` blue), headers colonna = goal away (`#c8102e` red)
- "4+" cattura tutti gli score 4+ (4-0, 5-0, 4-1, ecc.) — single outcome aggregato
- highlightedScore: bg `#fffbe6` + border `#FFC107` (default 1-1 — empirico, può diventare runtime quando avremo dati storici)

### 5.8 PlayerListTwoCol

```typescript
type PlayerListTwoColProps = {
  homePlayers: PlayerOutcome[];  // sorted asc by odds
  awayPlayers: PlayerOutcome[];
  homeTeamName: string;
  awayTeamName: string;
  homeColor?: string;       // band header bg, default #003a7e
  awayColor?: string;       // default #c8102e
};

type PlayerOutcome = {
  outcomeId: string;
  outcomeIdV2: string;
  playerName: string;
  odds: number;
  isSuspended: boolean;
};
```

- 2 colonne flex 50/50, ognuna con band header colorata (team name + count)
- Player row = nome 11px (truncate ellipsis se lungo) + OutcomeButton compact 60px wide
- Sort frontend per odds ascending (favoriti in cima)
- Scroll verticale interno alla colonna se >7-8 player (max-height fissa, overflow-y auto)

**Open question implementation-time**: il payload `v_player_outcomes` per Marcatore Anytime contiene il nome giocatore ma non l'associazione team. Tre opzioni in ordine di preferenza:

1. (preferred) Verificare se `v_player_outcomes` (o un view extension) può esporre `player_team` (home/away). Cambio backend isolato a 1 view.
2. (fallback) Render flat list senza band team, sort per odds. Perdita UX ma funziona.
3. (sconsigliato) Heuristic frontend con roster lookup — fragile, dipende da dati esterni.

Decisione: tentare (1) durante implementation. Se `v_player_outcomes` non ha il campo, valutare se aggiungerlo via mig leggera o ripiegare su (2). Annotare in plan come task con due esiti possibili.

## 6. Comportamenti UX standard

### 6.1 Suspended outcome
- Background `#f0f0f0` (vs `#f0f0f0` normale → in realtà più grigio `#e0e0e0` da differenziare)
- Opacity 0.6
- Lock icon SVG 16×16 angolo top-right
- `pointer-events: none` (non clickable)
- `manualSuspended` ha priorità visiva su `isSuspended` (admin override è "permanente" semantically)

### 6.2 Odds change indicator
- Quote up: bg flash da `#e6f7e6` (verde chiaro) a normale, durata 2s ease-out
- Quote down: bg flash da `#fde8e8` (rosso chiaro) a normale, durata 2s ease-out
- Implementato come keyframes CSS in `OddsFlash.tsx`, attivato da `useEffect` su prop change

### 6.3 Polling 30s
- Riusa il `setInterval(fetchEvent, 30_000)` esistente in event/[eventId]/page.tsx
- Refetch su `visibilitychange` quando torna visibile
- Lock prematch quando start time superato (riusa logica `nowTick` esistente)

### 6.4 Sub-pill picker behavior
- Rendering: pillole orizzontali `border-radius: 16px`, padding 8px 16px
- Active: bg `#d0141c` + colore bianco
- Inactive: bg white + border `#ddd`
- Cambio sub-pill = state locale, no URL change (history non cluttered)
- Default sub-pill = primo dell'array (vedi sezione 3)

### 6.5 Empty tab/sub-pill
- TabBar mostra badge "—" sulla tab vuota
- Click: render messaggio centrato "Nessun mercato disponibile per questa categoria"
- Sub-pill vuota: stesso comportamento, messaggio nel content area

### 6.6 Loading state
- Riusa il "Caricamento..." esistente al primo paint
- Refetch (polling) NON mostra loading — render esistente resta, oddsChange flash mostra le modifiche

## 7. Backend / API changes

**Nessuna mig DB**. Il path v2 `v_player_*` già fornisce tutti i dati necessari.

**File TS server-side toccati**:
- `lib/queries/player-event-v2.ts`: nessuna modifica, solo verifica che TUTTI i markets siano esposti (no whitelist come listing helper)

**File frontend nuovi**:
- `lib/market-config-v2.ts` (sezione 3.1)
- `lib/line-picker-defaults.ts` (sezione 4)
- `lib/market-categorizer-v2.ts` — sostituisce `categorizeMarketsToTabs`. Input: array markets + sport_slug + activeTab + activeSubPill. Output: array markets ordinati per render
- `components/event-v2/*` (sezione 5)
- `app/(kiosk)/event/[eventId]/page-v2.tsx` — nuovo entry point per render v2

**File frontend modificati**:
- `app/(kiosk)/event/[eventId]/page.tsx` — aggiunge feature flag branch:
  ```typescript
  const newSports = (process.env.NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS ?? '').split(',').filter(Boolean);
  const useV2 = newSports.includes(event.sportSlug);
  return useV2 ? <EventDetailPageV2 {...props} /> : <LegacyContent {...props} />;
  ```

## 8. Rollout strategy

**Strategia**: incrementale per file system + feature flag, zero downtime.

### 8.1 Fase 0 — pre-deploy (locale)
1. Implementare tutti i componenti `event-v2/*`, config files, page-v2.tsx
2. Smoke test locale con `NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio` su dev
3. Verifica visiva su viewport simulato 1920×1080

### 8.2 Fase 1 — deploy nascosto (prod, flag vuoto)
1. `npm run build` con codice nuovo presente, `NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=` vuoto
2. Manual copy `.next/static` + `public` in `.next/standalone/` (runbook noto, vedi memory cutover)
3. Backup `.env.local` prima di toccare: `cp .env.local .env.local.bak-pre-eventv2-$(date +%Y%m%d-%H%M%S)`
4. Restart `betssolution-player`
5. Verifica path legacy invariato (smoke test su 5 event diversi sport)
6. Check logs: nessun bundle error, no runtime error

### 8.3 Fase 2 — abilita flag su scraper-vps
1. Edita `.env.local`: `NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio`
2. Re-build (NEXT_PUBLIC_* è baked at build time)
3. Re-symlink `.env.local` in `.next/standalone/` (CRITICAL — runbook gap noto, vedi memory)
4. Restart
5. Smoke test (vedi sezione 9.3)

### 8.4 Fase 3 — monitoring (1-2 settimane)
- Sentry/log filter per `event-v2/*`
- Manual visit periodico
- Feedback raccolto

### 8.5 Rollback
- `NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=` (vuoto) + rebuild + restart → torna a legacy istantaneamente
- File nuovi restano sul disk, niente da disinstallare

### 8.6 Cleanup legacy
**Out of scope** per questo spec. Il codice legacy event page resta vivo finché non sono ridisegnati TUTTI gli sport (futuri brainstorm). Cleanup = task separato post-rollout completo.

## 9. Testing

### 9.1 Unit tests (vitest in `__tests__/components/event-v2/`)

| Componente | Test cases |
|---|---|
| LinePicker | (a) default line con linea esatta presente; (b) fallback closest se default mancante; (c) top-3 visibili = default + 1 sopra + 1 sotto; (d) expand mostra restanti; (e) <3 varianti totali → no expand button; (f) 1 variante → no picker, render diretto; (g) 0 varianti → render nulla |
| OutcomeButton | (a) suspended state non clickable; (b) odds up → flash green 2s; (c) odds down → flash red 2s; (d) manualSuspended priorità su isSuspended |
| MatrixGrid (HT/FT) | (a) 9 outcomes mappati a celle 3×3; (b) outcome mancante → "—" non-clickable; (c) header label corretti |
| ScoreGrid (CS) | (a) score "1-0" → cella riga 0 colonna 1; (b) "4+" cattura aggregata 4-0, 4-1, 5-0; (c) cella default highlighted (1-1) con bg yellow |
| PlayerListTwoCol | (a) sort asc by odds; (b) split home/away corretto via player_team_id (se opzione 1); (c) fallback flat list se mapping mancante (opzione 2) |
| market-categorizer-v2 | (a) market "1X2" → tab Principali; (b) market "U/O" multi-line → tab Gol/U/O con `@picker`; (c) market sconosciuto → tab "Extra" o ignored; (d) sub-pill mapping per Tempi/Player/Stats |
| line-picker-defaults | (a) lookup `calcio.U/O = 2.5`; (b) lookup mancante → return null |

### 9.2 Visual regression (Playwright + screenshot diff)

Snapshots per ogni tab calcio su evento sample fixture (mock data):
- principali.png, gol-uo.png, handicap.png
- tempi-1t.png, tempi-2t.png, tempi-combo.png
- player-anytime.png, player-marca-assist.png
- stats-cards.png, stats-corners.png

Run su PR. Diff threshold ~1% per font rendering changes accettabili.

### 9.3 Smoke test manuale post-deploy

Checklist (in `docs/superpowers/runbooks/event-v2-smoke-test.md` da creare):

- [ ] Apri 3 eventi calcio prematch random, naviga tutti i 6 tab senza errori
- [ ] Click outcome in ogni tab → bet slip popola
- [ ] Verifica suspended outcome (se presente: agenzia override) → non cliccabile + lock icon
- [ ] Aspetta 60s → polling 30s scatta 2 volte → odds aggiornate, flash visibile su almeno 1 outcome
- [ ] Sub-pill picker (Tempi/Player/Stats) → cambia sub-pill → contenuto cambia
- [ ] Line picker U/O → tap "+ altre N linee" → expand inline funziona
- [ ] Apri evento basket/tennis/rugby → path legacy invariato
- [ ] Apri evento calcio LIVE (post-start) → render ok (live page invariata, ma se utente clicca su evento già iniziato deve gestire stato locked)

### 9.4 Performance budget
- Build size delta: target < +30KB gzipped (componenti nuovi)
- Time to interactive event page: target ≤ 1s su kiosk (cold)
- Polling 30s: durata fetch + render ≤ 200ms

## 10. Reference visivi

Mockup HTML completi (consultabili durante implementation):

- `C:\Users\philp\event-page-redesign\.superpowers\brainstorm\804-1777810933\tab-structure.html` — confronto 4/5/6 tab options
- `C:\Users\philp\event-page-redesign\.superpowers\brainstorm\804-1777810933\line-picker.html` — pattern A/B/C/D U/O multi-linea
- `C:\Users\philp\event-page-redesign\.superpowers\brainstorm\804-1777810933\handicap-asian.html` — AH bidirezionale + EU Hcap 3-way
- `C:\Users\philp\event-page-redesign\.superpowers\brainstorm\804-1777810933\player-tab.html` — Marcatore 2-col home/away
- `C:\Users\philp\event-page-redesign\.superpowers\brainstorm\804-1777810933\tempi-tab.html` — HT/FT matrix + CS score grid
- `C:\Users\philp\event-page-redesign\.superpowers\brainstorm\804-1777810933\principali-layout.html` — hero 1X2 + grid 2-col

Reference SSBT consultati: Bet365 SSBT (UK shops), William Hill SSBT (UK), Bwin desktop, Pinnacle desktop, Unibet mobile/SSBT.

## 11. Out of scope

- Altri sport (basket, tennis, hockey, rugby, ecc.) — futuri brainstorm dedicati. Restano sul path legacy fino a quel momento
- Live page (`app/(kiosk)/live/[eventId]/page.tsx`) — invariata
- Listing page (`/api/sportsbook` + tile UI) — task C "whitelist line filter calcio" è separato e tracciato in registry
- Bet slip / sidebar / header
- Cleanup codice legacy event page
- DB migration / odds-api scraper / ingester / settlement
- On-screen keyboard / search per Player tab
- A/B testing framework (rollback è binario via feature flag)
- Analytics / tracking events su tab navigation

## 12. Dipendenze e prerequisiti

- **Path v2 attivo** (`NEXT_PUBLIC_READ_FROM_V2=true`) — già live in prod (vedi memory cutover S6 2026-05-01)
- **mig 159 dictionary canonical IT** + mig 163-169 sport overrides — già live
- **Plan D classifier coverage** per quarter line .25/.75 settlement — già live (S5e/S6b)
- **`v_player_outcomes` shape** — necessario verificare se include `player_team` o equivalente per PlayerListTwoCol opzione 1; altrimenti fallback opzione 2

## 13. Open questions implementation-time

1. **Player team association** (sezione 5.8): verificare se `v_player_outcomes` contiene `player_team` field o se serve view extension. Esito determina se `PlayerListTwoCol` rendera 2-col o flat list
2. **Highlighted score in CS grid** (sezione 5.7): hard-code "1-1" o usare runtime data per evidenziare la quota più alta probabilità. Per ora hard-code, runtime in follow-up
3. **GK Saves / Player Shots default lines**: i valori 3.5 e 1.5 in sezione 4 sono provvisori, da tarare con dati reali post-deploy
4. **Polling 30s vs Realtime 3a**: il design assume polling. Se Plan D 3a Realtime publisher (vedi memory) viene attivato per kiosk frontend, il render deve adattarsi. Out of scope di questo spec, follow-up se attivato
