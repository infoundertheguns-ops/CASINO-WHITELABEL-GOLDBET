# Event V2 — Tennis sport extension

**Status**: Design approved
**Date**: 2026-05-04
**Author**: pair (user + Claude)
**Branch**: `feature/plan-d-settlement-d1`
**Predecessors**: `2026-05-03-event-page-redesign-design.md` (calcio v2), `2026-05-04-event-v2-batch-fixes/RUNBOOK.md` (calcio polish + sub-pill stale DOM fix)

## Goal

Extend the event detail v2 page (currently calcio-only) to **tennis**, the highest-volume non-calcio sport in prematch (~291 events on 11-day forward window vs calcio 399). Tennis is structurally simple (~8 distinct `market_type` values) so it serves as a low-risk first port and a stress test of the v2 framework's portability before the third+ sport.

Out of scope: basket, baseball, hockey-ghiaccio, pallamano, volley, cricket. Each gets its own follow-up spec.

## Background

The event detail v2 page (`app/(kiosk)/event/[eventId]/page-v2.tsx`) is enabled per-sport via `NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS` env var; events whose `sport_slug` is in that comma-list render through `EventDetailPageV2`, others fall back to legacy `LiveMarketGrid`.

The current shipping config has only calcio:
- `FOOTBALL_TAB_MARKETS_V2` in `lib/market-config-v2.ts`
- Registered as `SPORT_CONFIGS["calcio"]` in `lib/market-categorizer-v2.ts`
- `categorizeMarketsV2(..., "calcio", ...)` is hard-coded in `page-v2.tsx`
- `FOOTBALL_TAB_ORDER`, `FOOTBALL_DEFAULT_SUB_PILL` exported as bare constants (no per-sport indirection)

To add tennis we need both **data config** (which markets go where) and **framework generalization** (sport-keyed maps in place of football-specific exports).

## Tennis market vocabulary (from `v_player_markets`)

Survey on prematch window 2026-05-04 → 2026-05-15, ~3000 rows aggregated across 3 paginated pages:

| `market_type` | Approx rows | Line shape | Outcome shape |
|---|---:|---|---|
| `Handicap` | ~1200 | signed game handicap, e.g. `-5..+4.5` | 1/2 (game spread, AH-style) |
| `Totale giochi` | ~800 | numeric, `18.5..33.5` typical | Over/Under |
| `T/T Match (Escl. Ritiro)` | ~315 | `null` | 1/2 (no draw — retirement excluded) |
| `Totale set` | ~240 | `2.5` (best-of-3) or `3.5` (best-of-5 Slams) | Over/Under |
| `1X2 - 1T` | ~215 | `null` | 1/2 (mig 172 strips draw for 2-way sports) — semantically "1° Set winner" |
| `Totals 1st Set` | ~163 | numeric, `6.5..12.5` typical | Over/Under |
| `T/T 1° Set` | ~40 | `null` | 1/2 |
| `T/T 2° Set` | ~29 | `null` | 1/2 |

No player-prop markets surface for tennis (Marcatore-equivalent does not exist; per-player aces / double faults / breaks are not in current `oddsapi_translations` for tennis sport_slug). Player tab is therefore not rendered.

## Tab structure (mirrors legacy `LIVE_DETAIL_TABS.tennis`)

```
Principali  →  Set  →  U/O Giochi  →  Handicap  →  Altri (catch-all auto-hidden)
```

```ts
export const TENNIS_TAB_MARKETS_V2: SportTabConfig = {
  "Principali": {
    markets: [
      "T/T Match (Escl. Ritiro)",
      "Totale set@2.5",
      "Totale giochi@22.5",
      "Handicap@-1.5",
    ],
  },
  "Set": {
    markets: [
      "1X2 - 1T",                 // displays as "VINCENTE 1° SET" via title override
      "Totals 1st Set@picker",
      "T/T 1° Set",
      "T/T 2° Set",
    ],
  },
  "U/O Giochi": {
    markets: ["Totale giochi@picker"],
  },
  "Handicap": {
    markets: ["Handicap@picker"],
  },
  "Altri": {
    markets: [],  // catch-all rendered specially in page-v2 for unmapped types
  },
};

export const TENNIS_TAB_ORDER = ["Principali", "Set", "U/O Giochi", "Handicap", "Altri"];
export const TENNIS_DEFAULT_SUB_PILL: Record<string, string> = {};  // no sub-pills
```

Rationale per tab:
- **Principali** keeps the 4 most-bet markets at default lines, matching how Italian bookmakers (Sisal, GoldBet, Eurobet) frame their tennis tile.
- **Set** groups all per-set markets including the "Vincente 1° Set" market that ships from odds-api under the misleading `"1X2 - 1T"` label.
- **U/O Giochi** and **Handicap** give full LinePicker access to all line variants (the `@picker` suffix renders the existing `LinePicker` `under-over` / `team-handicap` blocks).
- **Altri** is auto-hidden when no uncategorized market_types exist, same logic as calcio.

## Rendering decisions

Modifications to `page-v2.tsx` `renderSingleMarket` and surrounding logic:

1. **Hero rendering for T/T Match in Principali**:
   ```ts
   const isHero = isPrincipali && (m.market_type === "1X2" || m.market_type === "T/T Match (Escl. Ritiro)");
   ```
   Tennis match winner gets the same prominent 2-button hero treatment as calcio's 1X2.

2. **`1X2 - 1T` rendered as 2-way**: the existing `is1x2like` heuristic in the outcome-ordering block already handles arbitrary {1, X, 2} subsets. After mig 172 the X outcome is excluded by the view, so `rawOutcomes` will have only `[{label:"1"}, {label:"2"}]` and the existing sort produces `[1, 2]` ordering. No code change beyond title override (point 4 below).

3. **Handicap renderer routing**: tennis `Handicap` follows the same dispatch as calcio's `Handicap` market — already routed to `AsianHandicapBlock` via existing `marketType === "Handicap"` branch in `renderGroupedMarket`. The `acceptName` filter currently keeps only `{1, 2, home, away}` outcome names. **Risk**: if odds-api emits player-named outcomes (e.g. `"Sinner +1.5"`) the filter drops them and the section renders empty. Fallback plan: extend `acceptName` for tennis Handicap to also accept any name that ends with a signed line suffix (regex `/[+-]\d+(\.\d+)?$/`), or relax to "any name" since tennis Handicap is always 2 outcomes.

4. **Title override map** (new):
   ```ts
   const MARKET_TITLE_OVERRIDE: Record<string, string> = {
     "1X2 - 1T": "VINCENTE 1° SET",
     // future: per-sport overrides go here
   };
   function titleFor(m: DbMarket): string {
     const overridden = MARKET_TITLE_OVERRIDE[m.market_type];
     const base = (overridden ?? m.market_type).toUpperCase();
     if (m.line == null) return base;
     if (NO_LINE_TITLE_TYPES.has(m.market_type)) return base;
     return base + ' ' + (Number.isInteger(m.line) ? String(m.line) : String(m.line));
   }
   ```
   Decoupled from `NO_LINE_TITLE_TYPES` (which suppresses the line suffix); the override only changes the rendered base label.

5. **`NO_LINE_TITLE_TYPES` extension**: append the four tennis line-less markets so a stray `0` from the view never appears as title suffix:
   ```ts
   "T/T Match (Escl. Ritiro)", "T/T 1° Set", "T/T 2° Set", "1X2 - 1T",
   ```

6. **`PLAYER_FLAT_TYPES`** in `renderSingleMarket`: no changes (tennis has no player markets).

## Architectural changes (sport plurality)

### `lib/market-config-v2.ts`

- Add `TENNIS_TAB_MARKETS_V2` (data above), `TENNIS_TAB_ORDER`, `TENNIS_DEFAULT_SUB_PILL`.
- Introduce sport-keyed lookup maps:
  ```ts
  export const TAB_ORDER_BY_SPORT: Record<string, string[]> = {
    calcio: FOOTBALL_TAB_ORDER,
    tennis: TENNIS_TAB_ORDER,
  };
  export const DEFAULT_SUB_PILL_BY_SPORT: Record<string, Record<string, string>> = {
    calcio: FOOTBALL_DEFAULT_SUB_PILL,
    tennis: TENNIS_DEFAULT_SUB_PILL,
  };
  export const TAB_MARKETS_BY_SPORT: Record<string, SportTabConfig> = {
    calcio: FOOTBALL_TAB_MARKETS_V2,
    tennis: TENNIS_TAB_MARKETS_V2,
  };
  ```
- Existing `FOOTBALL_TAB_ORDER`, `FOOTBALL_DEFAULT_SUB_PILL`, `FOOTBALL_TAB_MARKETS_V2` exports preserved (not renamed) so the categorizer's `SPORT_CONFIGS` import keeps compiling without shotgun edits.

### `lib/market-categorizer-v2.ts`

```ts
import { TAB_MARKETS_BY_SPORT } from "./market-config-v2";
const SPORT_CONFIGS: Record<string, SportTabConfig> = TAB_MARKETS_BY_SPORT;
```

(Replaces the existing 2-line `{ calcio: FOOTBALL_TAB_MARKETS_V2 }` literal.)

### `app/(kiosk)/event/[eventId]/page-v2.tsx`

1. Replace 4 hard-coded `"calcio"` strings with `sportSlug`:
   ```ts
   const sportSlug = event.sport?.slug ?? "calcio";
   ```
   Affects: the `categorizeMarketsV2` call inside `useMemo`, and three usages of `FOOTBALL_TAB_ORDER` / `FOOTBALL_DEFAULT_SUB_PILL` / `FOOTBALL_TAB_MARKETS_V2`.

2. Switch imports from football-specific exports to the per-sport maps:
   ```ts
   import {
     TAB_ORDER_BY_SPORT,
     DEFAULT_SUB_PILL_BY_SPORT,
     TAB_MARKETS_BY_SPORT,
     parseMarketSpec,
   } from "@/lib/market-config-v2";
   ```
   Then derive at render time:
   ```ts
   const tabOrder = TAB_ORDER_BY_SPORT[sportSlug] ?? TAB_ORDER_BY_SPORT.calcio;
   const defaultSubPill = DEFAULT_SUB_PILL_BY_SPORT[sportSlug] ?? {};
   const tabMarketsCfg = TAB_MARKETS_BY_SPORT[sportSlug] ?? TAB_MARKETS_BY_SPORT.calcio;
   ```
   `tabOrder` replaces `FOOTBALL_TAB_ORDER`; `defaultSubPill` replaces `FOOTBALL_DEFAULT_SUB_PILL`; `tabMarketsCfg` replaces `FOOTBALL_TAB_MARKETS_V2` in the `availableTabs` and `subPillNames` computations.

3. Initial state seed: `useState<string>("Principali")` works as-is for tennis (first tab in TENNIS_TAB_ORDER also is `Principali`). The `availableTabs` filter and the existing useEffect that re-targets the active tab when it disappears handle the case where Principali has zero markets for a degenerate event.

### Feature flag flip

Production env on scraper-vps:
```
NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio  →  NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio,tennis
```

Kept comma-separated to make subsequent sport additions a one-line env edit.

## Testing strategy

### Manual smoke test (kiosk)

Before flipping the flag, dev-rebuild deploys to scraper-vps. After hard-refresh on kiosk:
1. Navigate to a prematch tennis event (any from `v_player_events?sport_slug=eq.tennis&starts_at=gte=now`).
2. Verify all 5 tabs visible. Click each:
   - **Principali**: T/T Match shows hero buttons with player names + odds. Totale set/giochi/Handicap render compact rows with default lines. No "(Escl. Ritiro)" line suffix appearing in title.
   - **Set**: VINCENTE 1° SET title (not "1X2 - 1T"), 2 outcomes [1, 2]. Totals 1st Set picker switches lines. T/T 1° Set, T/T 2° Set render as 2-way.
   - **U/O Giochi**: LinePicker shows all available lines (~10–15 typical), Over/Under buttons.
   - **Handicap**: AsianHandicapBlock renders with player names + signed line. **If empty section appears**, capture outcome.name shape via diagnostic and adjust `acceptName` filter (regex extension).
   - **Altri**: hidden if no uncategorized markets; otherwise lists them.
3. Click between tabs back-and-forth multiple times — verify no stale DOM (the React key fix from `2026-05-04-event-v2-batch-fixes` should already cover this since tennis Handicap uses the same multi-line ID-collision pattern as calcio @flat).
4. Visual parity check: spacing, fonts, hero button size, brand red odds — should match calcio v2 exactly (shared components).

### Regression check on calcio

After flag flip, navigate any calcio event. All tabs/sub-pills must still work identically (Principali, Gol/U/O, Handicap, Tempi, Player, Stats, Altri). The framework refactor is purely additive — no calcio behavior should change.

### Coverage check

`SELECT COUNT(*) FROM v_player_markets WHERE sport_slug='tennis' AND market_type NOT IN (...8 known...)` should be 0 (or near-zero). If non-zero, those markets fall into Altri and we need to either configure them or accept the catch-all rendering.

## Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Tennis Handicap outcome names are player-named (e.g. `"Sinner +1.5"`), AH `acceptName` filter strips them → empty section | Medium | Discoverable on first smoke test; regex extension to `acceptName` is a one-line patch |
| Best-of-5 Slam matches default `Totale set@2.5` doesn't match (only `3.5` exists) | Low | `findClosestLine` falls back to nearest available line — UI will still render with line=3.5; user can verify via LinePicker in U/O Giochi tab |
| `1X2 - 1T` mig 172 draw-strip not actually applied for tennis sport_slug → 3 outcomes appear | Low | If happens, existing `is1x2like` sort handles 3-way [1,X,2] — visual not ideal but not broken; can add explicit per-sport draw filter in mapper |
| Sport_slug for an event is null / unknown | Very low | Fallback `?? "calcio"` keeps current behavior (the `availableTabs` filter then strips empty calcio tabs, leaving only Altri with all tennis markets — degraded but not broken) |

## Rollback

`sed -i "s/NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio,tennis/NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio/" /root/betssolution-player/.env.local && rebuild && restart`

Code stays in tree (additive, no calcio regressions); only the flag flips. Same pattern as calcio cutover.

## Implementation order (preview, full plan in writing-plans phase)

1. **Spec → plan → execute** via `superpowers:writing-plans` then `superpowers:executing-plans`.
2. Per-sport refactor in `market-config-v2.ts` + `market-categorizer-v2.ts` (additive, no behavior change yet).
3. `page-v2.tsx` thread `sportSlug` through (+ title override, hero condition extension, NO_LINE_TITLE_TYPES extension).
4. Add `TENNIS_TAB_MARKETS_V2` data.
5. Build + deploy to scraper-vps.
6. Smoke test on kiosk **before** flag flip — read URL `/event/<uuid>?debug` or temporarily extend `NEW_EVENT_PAGE_SPORTS` to add `tennis` only on a single test cycle.
7. Iterate on Handicap `acceptName` if needed.
8. Flag flip in env.local, restart, regression check on calcio.
9. Mirror updated source files to admin git artifacts; commit + push origin.
10. Update memory + RUNBOOK.

## Open questions for implementer

None blocking. The Handicap `acceptName` regex extension may be needed but is local to one function; will be discovered on first smoke test if at all.

## Acceptance criteria

- [ ] All 5 tennis tabs render with the configured markets in declared spec order.
- [ ] T/T Match in Principali uses hero rendering (large 2-button row).
- [ ] "1X2 - 1T" title displays as "VINCENTE 1° SET".
- [ ] Switching between tabs multiple times produces clean DOM (no stale content from previous tab).
- [ ] Calcio events behave exactly as before the change (regression baseline).
- [ ] Tennis Handicap section is non-empty for at least 80% of prematch events surveyed.
- [ ] Feature flag rollback restores legacy LiveMarketGrid for tennis without code changes.
