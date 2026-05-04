# Event-v2 batch fixes — 2026-05-04

Session goal: tab-by-tab visual review of calcio event detail v2, fix every UI bug surfaced. Branch `feature/plan-d-settlement-d1`. All edits are on the player codebase (`/root/betssolution-player/`, NOT git-tracked) and mirrored here under `player/` for code-history preservation.

## Bugs fixed (in order)

### Mapper (`lib/queries/player-event-v2.ts`)

1. **U/O outcomes leaking across lines** — `v_player_markets` exposes one row per (market_id, line) but outcomes joined by market_id contain ALL lines. Added `o.line === m.line` filter for line-keyed markets, dedupe by outcome.id.
2. **1X2 / GG/NG / DC / DNB / BTTS HT / Exact Total Goals / etc. emptied by line filter** — For these "no-line" market types the outcome.line column is junk (sometimes 0/1/2). Added `NON_LINE_MARKET_TYPES` set; for those, skip the line filter.
3. **Duplicate non-line market rows** — Added `dedupeNonLineMarkets()` post-processor that collapses multiple m.line rows of the same market_id into one (keeps richest by outcome count).
4. **Outcomes truncated at 1000 rows** — Supabase REST default cap. Switched to paginated query: `.range(from, from + PAGE - 1)` with PAGE=1000, loop until short page. Cremonese-Lazio went from 1000 → 2233 outcomes loaded.

### Categorizer (`lib/market-categorizer-v2.ts`)

5. **`@flat` suffix** — emits ONE section per matching market variant (used for player props with multiple lines: Goalkeeper Saves 0.5..9.5, Player Shots 0.5..8.5, etc).

### Config (`lib/market-config-v2.ts`)

6. PRINCIPALI / GOL/U/O / HANDICAP / TEMPI: correct market_type names matching DB (mig 159 vocabulary).
7. **`To Score 2+/3+ Goals`** moved from Gol/U/O to Player → Marcatori (they are player props).
8. **Player @picker → @flat** — Goalkeeper Saves, Player Shots*, Player Tackles, Player Fouls*, Player Passes, Player To Be Fouled, Player To Assist (one section per line).
9. **`P/D` (Pari/Dispari)** added to Gol/U/O — was missing (2706 events).
10. **`Bookings Totals Home/Away@picker`** added to Stats/Cards.
11. **Stats / Tackles** new sub-pill: `Match Tackles@picker`, `Team Tackles Home/Away@picker`.
12. **Stats / Shots**: all `Total/Team Shots*` now `@picker` (had multiple lines previously rendered as single market).
13. **Stats / Shots**: added `Team Shots on Target Home/Away@picker` (were unmapped, falling into Altri).
14. **`Altri` tab** — catch-all for any market_type not mapped to other tabs. Auto-hidden when uncategorized=0.

### Page composer (`app/(kiosk)/event/[eventId]/page-v2.tsx`)

15. **Empty tabs auto-hidden** — `availableTabs` filter; `useEffect` switches to first available if active tab disappears.
16. **Empty sub-pills auto-hidden** — same logic for sub-pill bar.
17. **Spec-order rendering** — replaced "all single markets first, then all groups" with iterating config spec list and emitting in declared order. Sections now appear as configured.
18. **`titleFor`** — line suffix suppressed for `NO_LINE_TITLE_TYPES` (no more "DC 0", "DNB 0", "MARCATORE 0.5").
19. **`compactDCLabel` rewrite** — token-overlap matching with UNIQUE-token preference (home-only minus away-only) to disambiguate teams sharing city/region tokens (AEK Athens vs Panathinaikos Athens, etc.). Stopwords expanded: `town`, `reserve`, `reserves`, `u20`, `wfc`, `hnk`, `mfk`, `pfc`, `fk`, `cska`, `hapoel`, `dukla`, `spartak`, year tokens 1900-2009, `ii`/`iii`. Coverage 92% → 99.1% on 1765 prematch DC events. Remaining 16 events (0.9%) fall back to verbose name (no mislabel risk).
20. **Outcome ordering rules** in `renderSingleMarket`:
    - DC family: `[1X, X2, 12]`
    - 1X2-like (any market with outcomes ⊆ {1,X,2}): `[1, X, 2]` — covers 1X2, DNB, First Team To Score
    - Generic Over/Under detection (any market with both labels matching `/^(over|under|più|piu|meno)/i`): Over first
    - Yes/No (GG/NG, BTTS, To Score N): Sì first
    - Exact Total Goals: numeric leading-digit
    - Number of Goals In Match: `[Under N, midrange, Over N]`
    - Pari/Dispari: Pari first
    - Bucket-range markets (Total Corners {Under 6, 6-8, 9-11, 12-14, Over 14}): numeric range sort with Under→-∞, Over→+∞
21. **AH family extension** — added `Corners Race` to AsianHandicapBlock routing (was falling through to generic LinePicker with "1"/"2" labels).
22. **Family-specific outcome name filter in `renderGroupedMarket`** — for AH family (Handicap, Asian Handicap, Spread, Hcap*) keep only `1/2/home/away`; for U/O family keep only Over/Under variants. Drops phantom buttons from mixed-naming bookmaker data.
23. **Within-group dedupe by name** — single tile per outcome name within (marketId, line) group.

### LinePicker (`components/event-v2/LinePicker.tsx`)

24. **`under-over` renderer**: outcomes sorted Over-first within each line.
25. **`team-handicap` renderer**: outcomes sorted home-first; `renderLabel` accepts `"1"|"home"` (case-insensitive) instead of fragile `includes('home')` substring.

### Visual / typography (`components/event-v2/`)

26. **MarketSection header**: 11px → 15px, `#555` → `#1a1a1a`, weight 700, letter-spacing.
27. **OutcomeButton sizes**: hero 32→24px odds + 18px padding; standard 16→20px; compact 14→18px. Labels: 9-12 → 11-16px.
28. **OutcomeButton colors**: odds in brand red `#d0141c` weight 800; label `#666` weight 500. Strong visual hierarchy.
29. **PlayerListFlat redesign**: removed duplicated label (was showing player name in left column AND in OutcomeButton). Now single clickable row: `<button>` with `gridTemplateColumns: 1fr auto`, name on left + odds on right, full-width tap target.

## Outcome-correctness audit

Verified that `(outcome.name, outcome.odds)` always travels as a coupled tuple through every transformation. Sort/rename operations never separate them. The only true mislabel risk was DC token-overlap (now 0.9% verbose-fallback, 0% mislabel).

For LinePicker AH family: `renderLabel` derives the team name from outcome.name. Since `acceptName` filter pre-strips anything not in `{1, 2, home, away}`, malformed bookmaker data SKIPS the outcome rather than guessing wrong.

## Deploy

Built+restarted player ~10 times during the session. Final state:

- Service `betssolution-player` active
- Feature flag `NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio` (unchanged from cutover)
- Symlink `.next/standalone/.env.local → .env.local` recreated each rebuild (still NOT in deploy script — TODO)
- Smoke: `/api/health 200 ~100ms`

### Follow-up batch — 2026-05-04 ~16-17 UTC: sub-pill stale DOM bug

30. **Sub-pill click did not refresh content area** — clicking Marcatori/Goalkeeper/Shots/Cards/Other in Player tab kept rendering the previous sub-pill's markets, even though `activeSubPill` state and `categorized.markets` updated correctly. Confirmed via injected diagnostic overlay (yellow banner showing state, black trace strip showing IIFE specs+nodesCount): IIFE produced the correct nodes, but React did not commit them.

    **Root cause**: `v_player_markets` exposes the SAME `id` for rows that share `(market_id, market_type)` but differ in `line` (verified: Cremonese-Lazio Goalkeeper Saves had 5 rows all id `557e41a4-...`, Player Shots on Target had 5 rows all id `30526302-...`). With `<MarketSection key={m.id}>` in `renderSingleMarket`, multiple sections within a single render shared the same React key. React's reconciliation behavior with duplicate keys is undefined — in this case, sub-pill switches kept stale DOM nodes instead of unmounting+mounting cleanly. No console error, just silent DOM staleness.

    **Fix**: composite key `key={\`${m.id}@${m.line ?? "_"}\`}` on all 4 `<MarketSection>` calls inside `renderSingleMarket` (HT/FT MatrixGrid, Risultato Esatto ScoreGrid, Player flat list, default Hero/Compact row). 4 occurrences in `app/(kiosk)/event/[eventId]/page-v2.tsx`.

    Build `syN9iLUB-KtbkO6N9wxf_` deployed; user-verified working on Torino-Sassuolo (Marcatori → MARCATORE+TEAM GOALSCORER, Shots → 2 PSoT line variants, Other → PLAYER TO ASSIST) and Cremonese-Lazio.

    **Lesson saved to memory**: `feedback-react-keys-v_player_markets.md` — every `key=` for entities loaded from `v_player_*` views must compose `(id, line)` because the view's id is not unique on its own.

## Pending follow-up

- **Visual verification**: Stats/Shots, Stats/Cards (Bookings Totals H/A), Stats/Tackles, Player/Goalkeeper @flat (10 sections), Player/Shots @flat (multi-line), Altri tab — fixes deployed but not yet eyeballed by user.
- **Card Handicap / Handicap - 1T edge case**: outcomes with line in name (`"1 (-1)"`, `"Tie (1)"`) — current AH `acceptName` filter drops them. Markets will appear empty. Needs custom parser if utenti chiedono.
- **Symlink `.env.local`** in standalone deploy: still manual step. Should be in build/deploy script.
- **16 unresolvable DC events** (Santa Coloma derby etc.): show verbose `Cremonese or Lazio` strings. Cosmetic.

## Files changed (mirrored under player/)

| File | Lines changed approx | Purpose |
|---|---:|---|
| `lib/queries/player-event-v2.ts` | +50 | Pagination, NON_LINE filter, dedupe |
| `lib/market-config-v2.ts` | +60 | Tabs/sub-pills/markets reorganized, Altri added |
| `lib/market-categorizer-v2.ts` | +14 | `@flat` suffix |
| `app/(kiosk)/event/[eventId]/page-v2.tsx` | +200 / +4 | titleFor, ordering, render block, Altri, hide-empty + composite keys (id@line) for v_player_markets duplicate-id rows |
| `components/event-v2/MarketSection.tsx` | ~5 | Header typography |
| `components/event-v2/OutcomeButton.tsx` | ~10 | Sizes, colors |
| `components/event-v2/PlayerListFlat.tsx` | -25 +35 | Compact button rows |
| `components/event-v2/LinePicker.tsx` | +25 | Outcome sort per renderer |

