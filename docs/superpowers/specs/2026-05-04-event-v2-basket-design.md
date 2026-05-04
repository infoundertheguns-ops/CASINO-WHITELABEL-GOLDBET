# Event-v2 basket sport extension + Player Props transformer fix

**Date**: 2026-05-04
**Branch**: `feature/plan-d-settlement-d1`
**Target sport_slug**: `basket` (volume: ~89 events / 11d window in `v_player_events`; ~71k market rows in `v_player_markets` with `sport_slug='basketball'`)

## Problem

Tennis v2 SHIPPED on 2026-05-04 ~17:00 UTC. The per-sport indirection scaffolding (`TAB_MARKETS_BY_SPORT`, `TAB_ORDER_BY_SPORT`, `DEFAULT_SUB_PILL_BY_SPORT`) makes adding a new sport a data-only operation. Basket is the next-highest volume sport (3rd after football and tennis).

In addition, surveying the basket DB surfaced a backend bug: `Player Props` (BetUK basketball, ~321 outcome rows across 2 events) loses the player name during ingest because `transformer.ts` rule 1 absorbs `{label, hdp, over, under}` shapes and discards the label. The ~600 Milestones-style player markets (Points/Rebounds/Threes/Assists) are unaffected because they use a single-direction shape `{label, hdp, over}` that hits rule 6.

This spec covers:
1. Frontend basket sport extension (config + render rules + line picker defaults).
2. Backend `transformer.ts` fix to preserve player labels for `{label, over, under}` markets.
3. One-time cleanup + re-ingest of existing Player Props rows.
4. New median-line sentinel in LinePicker so basket U/O default tracks the league-specific line range.

## Out of scope

- Other sports (volley/baseball/hockey) v2 extension.
- Card Handicap / Handicap-1T outcome-name parser (registry pendente, applies to football too).
- Schema-level migration to expose `direction` as separate column on `outcomes_v2` (current `outcome_key` string + `::` separator suffices).
- DB-side translation overrides via SQL migration (deferred; client-side `titleFor` overrides cover basket scope).

## Tab layout

| Tab | Hero/Compact markets | Sub-pills |
|---|---|---|
| Principali | T/T (hero, basket-only) + 1X2 Tempo Regolamentare (compact, auto-hide) + U/O Incl. Supp.@picker + T/T Handicap@picker + DNB + P/D | — |
| U/O | U/O Incl. Supp.@picker + Alternative Totals@picker | — |
| Handicap | T/T Handicap@picker + Alternative Spread@picker | — |
| Tempi | — | `1° Tempo` (default) / `2° Tempo` (auto-hide if empty) |
| Quarti | — | `Q1` (default) / `Q2` / `Q3` / `Q4` (auto-hide quarters with no markets) |
| Player | — | `Punti` (default) / `Rimbalzi` / `Triple` / `Assist` / `First` / `Altro` |
| Altri | catch-all (auto-hide if uncategorized=0) | — |

Sub-pill contents:
- **Tempi → 1° Tempo**: `1X2 - 1T`, `U/O - 1T@picker`, `Handicap - 1T@picker`, `3-Way Result HT`
- **Tempi → 2° Tempo**: `1X2 - 2T`
- **Quarti → Q1**: `1X2 - 1Q`, `ML 1Q`, `U/O - 1Q@picker`, `Handicap - 1Q@picker`, `Spread 1Q@picker`
- **Quarti → Q2**: `ML 2Q`, `U/O - 2Q@picker`, `Spread 2Q@picker`
- **Quarti → Q3**: `ML 3Q`, `U/O - 3Q@picker`, `Spread 3Q@picker`
- **Quarti → Q4**: `ML 4Q`, `U/O - 4Q@picker`, `Spread 4Q@picker`
- **Player → Punti**: `Player Points Milestones@flat`
- **Player → Rimbalzi**: `Player Rebounds Milestones@flat`
- **Player → Triple**: `Player Threes Milestones@flat`
- **Player → Assist**: `Player Assists Milestones@flat`
- **Player → First**: `Player First Basket`, `Player First Assist`, `Player First Rebound`
- **Player → Altro**: `Double Double`, `Player Props@over-under-flat` (custom rendering — see §Render rules)

All 36 distinct basket market_types observed in DB are covered. Tab/sub-pill auto-hide handles low-volume markets (2° Tempo, First*, Player Props edge cases).

## Render rules

### Hero condition (`page-v2.tsx`)

Extend `isHero` (line 528):
```ts
const isHero = isPrincipali && (
  m.market_type === "1X2" ||
  m.market_type === "T/T Match (Escl. Ritiro)" ||
  (sportSlug === "basket" && m.market_type === "T/T")
);
```
Guard `sportSlug === "basket"` prevents `T/T` from being hero in volley/hockey (also expose `T/T` as market_type but in non-hero context).

### Title overrides (`titleFor` in `page-v2.tsx`)

Add `BASKET_TITLE_OVERRIDES` lookup applied when `sportSlug === "basket"`:

| DB market_type | Display |
|---|---|
| `T/T` | (unchanged) |
| `T/T Handicap` | (unchanged) |
| `1X2 Tempo Regolamentare` | "Vincente Tempi Regolamentari" |
| `U/O Incl. Supp.` | "Under/Over (con OT)" |
| `ML 1Q/2Q/3Q/4Q` | "Vincente 1°/2°/3°/4° Quarto" |
| `Spread 1Q/2Q/3Q/4Q` | "Handicap 1°/2°/3°/4° Quarto" |
| `1X2 - 1Q` | "1X2 1° Quarto" |
| `Player Points Milestones` | "Punti Giocatore" |
| `Player Rebounds Milestones` | "Rimbalzi Giocatore" |
| `Player Threes Milestones` | "Triple Giocatore" |
| `Player Assists Milestones` | "Assist Giocatore" |
| `Player First Basket` | "Primo Canestro" |
| `Player First Assist` | "Primo Assist" |
| `Player First Rebound` | "Primo Rimbalzo" |

Override applied before `titleFor` line-suffix logic, coherent with existing `NO_LINE_TITLE_TYPES`.

### LinePicker median sentinel (`line-picker-defaults.ts` + `LinePicker.tsx`)

Problem: basket U/O lines vary per league (NBA ~220, Euroleague ~165, NCAA ~130). A fixed numeric default in `pickDefault` would always pull NBA users to the lowest visible line.

Solution: introduce `MEDIAN_LINE` sentinel (`Number.NEGATIVE_INFINITY` or a named constant) in `line-picker-defaults.ts`:

```ts
export const MEDIAN_LINE = -1e9;  // sentinel — never collides with real lines

// in DEFAULTS.basket:
"U/O Incl. Supp.": MEDIAN_LINE,
"Alternative Totals": MEDIAN_LINE,
"U/O - 1T": MEDIAN_LINE,
"U/O - 1Q": MEDIAN_LINE,
"U/O - 2Q": MEDIAN_LINE,
"U/O - 3Q": MEDIAN_LINE,
"U/O - 4Q": MEDIAN_LINE,
```

In `LinePicker.tsx pickDefault`, branch on sentinel:
```ts
function pickDefault(variants: LineVariant[], target: number): LineVariant | null {
  if (variants.length === 0) return null;
  const sorted = [...variants].sort((a, b) => a.line - b.line);
  if (target === MEDIAN_LINE) {
    return sorted[Math.floor(sorted.length / 2)];
  }
  return [...variants].sort((a, b) => {
    const da = Math.abs(a.line - target);
    const db = Math.abs(b.line - target);
    if (da !== db) return da - db;
    return a.line - b.line;
  })[0];
}
```

**Sentinel collision safety**: detection uses **equality on the `target` parameter** (the configured default), NOT on `variant.line` values. Variant lines for handicap/spread can be negative (e.g. -10.5), but a real line will never equal `-1e9`. So negative handicap variants do not get falsely matched as "median".

Sentinel handlers added to `SENTINEL_FAMILIES` for handicap-style markets:
```ts
"Spread 1Q", "Spread 2Q", "Spread 3Q", "Spread 4Q",
```
(Already covered by existing `Handicap*` regex in `renderGroupedMarket isAHFamily` — `/Handicap|^AH|Spread|Hcap/i.test(marketType)`.)

Calcio/tennis defaults remain numeric (no MEDIAN_LINE), zero behavior change.

### Player Props custom render

Post-transformer-fix `Player Props` outcomes have `name = "<player>::over"` or `"<player>::under"`. Categorizer suffix `@over-under-flat` (new) emits one section per (player, line) with paired Over/Under outcomes:

```
Adam Mokoka
  10.5  Over 1.87  Under 1.84
  11.5  Over 1.89  Under 1.81
  ...
```

Implementation:
- New suffix `@over-under-flat` in `parseMarketSpec` (categorizer) — emits market with grouped outcomes.
- New component `PlayerOverUnderRow.tsx` (or extension to `PlayerListFlat.tsx` with `mode: "over-under"` prop).
- Fallback for legacy outcomes (no `::` separator): hide the section silently. After re-ingest cleanup, no legacy rows should remain.

**Scope note**: `@over-under-flat` is used **only** for `Player Props`. The Punti/Rimbalzi/Triple/Assist sub-pills continue to use the existing `@flat` suffix + `PlayerListFlat` component (single-direction Milestones, unchanged).

**Label rendering** `<player>::over` outcome.name parsing:
- Player display name = substring before first `(` if present, else full label-prefix before `::`.
  - `"Adam Mokoka (Points)::over"` → display "Adam Mokoka", optional stat tag "(Points)" rendered next to player name.
  - `"Adam Mokoka::over"` → display "Adam Mokoka", no stat tag.
- Both shapes (with and without `(...)`) MUST be covered by a `PlayerOverUnderRow` test case.

## Backend transformer fix (`transformer.ts`)

Add **rule 0a** with priority above rule 1:

```ts
// 0a. Labeled totals: label + over + under all present → preserve player label.
// Without this, rule 1 absorbs over+under and DISCARDS the label, losing player
// identity for markets like Player Props (basketball BetUK).
if (label != null && over != null && under != null) {
  out.push({ market_key, outcome_key: `${label}::over`,  line: hdp, odds: over });
  out.push({ market_key, outcome_key: `${label}::under`, line: hdp, odds: under });
  return out;
}
```

Other rules unchanged. Schema unchanged (single `outcome_key` text column).

### Cross-sport regression check

Before deploy, identify any current market whose raw shape includes `{label, over, under}` and verify rule 0a's behavior change is benign (i.e. label content is meaningful, not redundant with market_name).

Strategy (concrete, no conditional fallbacks):
1. **Grep test fixtures** under `services/odds-api-ingester/src/__tests__/fixtures/` for any market with both `over` AND `under` AND `label` keys present in the same odds entry. Document each finding (sport, market_name, sample label).
2. **Live API probe**: pick 1 active event per sport currently in `v_player_events` (calcio, tennis, basket, baseball, volley, hockey-ghiaccio, pallamano, cricket, rugby) and call odds-api `/odds?eventId=<id>&bookmakers=Bet365,BetUK,Pamestoixima,DraftKings,William%20Hill` once. Scan the JSON for any `{label, over, under}` triple in non-`Player Props` markets.
3. For each finding from steps 1-2, classify:
   - **Benign**: label is redundant with market_name (e.g. "First 10 Minutes" with label `"First 10"`). New rule produces extra-suffixed outcome_keys but no information loss.
   - **Surprising-positive**: label adds info that was previously discarded (e.g. another player-style market). Document in spec follow-ups, ship as bonus enrichment.
   - **Breaking**: rule 0a changes outcome_key in a way that breaks settlement classifier or frontend renderer for an existing live sport. Spec a guard before shipping.
4. Only after classification produces zero "Breaking" entries → deploy admin.

### Tests

`transformer.test.ts` add cases:
- Input `{label: "LeBron James", hdp: 25.5, over: "1.87", under: "1.84"}` → 2 outcomes `LeBron James::over` / `LeBron James::under`.
- Pisa-Lecce fixture continues to pass (no `{label,over,under}` shapes there).
- Football First-10-minutes shape (if in test fixtures) verified to continue producing expected over/under outcomes despite label being preserved (confirm separator chars don't break existing parsers downstream).

## Files modified

### Frontend (`/root/betssolution-player/` — non-git)
| File | Change |
|---|---|
| `lib/market-config-v2.ts` | `BASKET_TAB_MARKETS_V2`, `BASKET_TAB_ORDER`, `BASKET_DEFAULT_SUB_PILL`, registered in `TAB_MARKETS_BY_SPORT`/`TAB_ORDER_BY_SPORT`/`DEFAULT_SUB_PILL_BY_SPORT` |
| `lib/market-categorizer-v2.ts` | New suffix `@over-under-flat` handling (group outcomes by player) |
| `lib/line-picker-defaults.ts` | `MEDIAN_LINE` constant + basket DEFAULTS + extend SENTINEL_FAMILIES |
| `components/event-v2/LinePicker.tsx` | `pickDefault` branch on MEDIAN_LINE sentinel |
| `components/event-v2/PlayerOverUnderRow.tsx` | NEW — render player + Over/Under buttons paired by line |
| `app/(kiosk)/event/[eventId]/page-v2.tsx` | Extend `isHero` (basket T/T), extend `titleFor` (basket overrides), wire `@over-under-flat` rendering to PlayerOverUnderRow |
| `.env.local` | Flag `NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio,tennis,basket` |

### Backend (`/root/betssolution-admin/` — git)
| File | Change |
|---|---|
| `services/odds-api-ingester/src/transformer.ts` | Add rule 0a (label+over+under preservation) before rule 1 |
| `services/odds-api-ingester/src/__tests__/transformer.test.ts` | New test cases for rule 0a |

### Mirror artifacts
| File | Purpose |
|---|---|
| `docs/superpowers/artifacts/2026-05-04-event-v2-basket/RUNBOOK.md` | Deploy steps + rollback |
| `docs/superpowers/artifacts/2026-05-04-event-v2-basket/player/*` | Mirror of player files (8 files) for audit since player repo is non-git |

## Deploy plan

### Phase 1 — Backend transformer
1. Patch `transformer.ts` + add tests → `npm test` green.
2. Cross-sport regression check (see §Backend) → produces zero "Breaking" findings.
3. Build admin: `cd /root/betssolution-admin && npm run build`.
4. Restart `odds-api-ingester.service`. Verify health + log shows new rule path.
5. **Cleanup Player Props (race-safe)**:
   a. Pre-cleanup count assertion: `SELECT COUNT(*) FROM outcomes_v2 WHERE market_id IN (SELECT id FROM markets_v2 WHERE market_name='Player Props')`. Expected ~321 rows. If count is 0 or wildly different (>1000 or <50), abort and investigate before proceeding.
   b. Bracket the DELETE between ingest cycles — preferred: temporarily stop the ingester (`systemctl stop odds-api-ingester`) before DELETE, run DELETE, then `systemctl start` to resume. Alternative: time the DELETE to fire immediately after observing a completed `mid` tier log line, giving ~10min before next cycle.
   c. Execute `DELETE FROM outcomes_v2 WHERE market_id IN (SELECT id FROM markets_v2 WHERE market_name='Player Props')` via service-role REST or `psql`.
   d. Verify post-DELETE count is 0.
6. Wait 1 ingest cycle (mid tier 10min, or imminent 2min if event is <2h away). Verify `SELECT name FROM v_player_outcomes WHERE market_id IN (SELECT id FROM markets_v2 WHERE market_name='Player Props')` returns rows with format `<player>::over`/`<player>::under`. If still empty after 15min → investigate ingester scheduler (event may have moved out of any tier window).

### Phase 2 — Frontend basket extension
1. Apply player-side changes (config, line picker, render component, page-v2 wiring).
2. Build: `cd /root/betssolution-player && npm run build`.
3. Manual standalone copy: `cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/`.
4. Symlink env: `ln -sf /root/betssolution-player/.env.local .next/standalone/.env.local`.
5. Backup current env: `cp .env.local .env.local.bak-pre-basket-flip`.
6. Restart `betssolution-player.service`. Verify health 200 + BUILD_ID changed.
7. Run smoke test (see below) WITHOUT flag flip — basket events still render via legacy.
8. Flip flag: `NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio,tennis,basket`.
9. Restart service.
10. Re-run smoke test on basket events — now via v2.

### Phase 3 — Commits
- Admin (git): single commit `feat(transformer): preserve player label for over+under markets` containing transformer.ts + test changes.
- Admin (git): single commit `docs: basket event-v2 extension spec + RUNBOOK` containing spec + artifacts mirror.
- Player (non-git): document via mirror in admin artifacts; record BUILD_ID + flag state in session memory file.

## Smoke test (5 events)

| # | Profile | Verify |
|---|---|---|
| 1 | NBA event (U/O ~220) | Principali shows hero T/T, U/O picker default = median (≈220), expand reveals neighbours; no console errors |
| 2 | Euroleague event (U/O ~165) with Player Milestones | All Player tab sub-pills populate; Punti default; Milestones list per-player; First sub-pill auto-hidden if no first-event markets |
| 3 | NCAA / lower-tier event (U/O ~130) | U/O picker median picks correct line; Quarti tab Q1 default with Q3/Q4 auto-hidden if missing |
| 4 | Live event (status='live', mid-game) | Polling refreshes odds; Quarti markets all visible; no React key collision (sub-pill switch) |
| 5 | Event with Player Props (post-fix) | Player → Altro shows `Double Double` + `Player Props` rendered as PlayerOverUnderRow with player names visible; click selects correct outcome into bet slip |

Per-event checklist:
- Tab order respected (`Principali / U/O / Handicap / Tempi / Quarti / Player / Altri`).
- Hero T/T renders large in Principali, with Compact `1X2 Tempo Regolamentare` below when present.
- LinePicker shows 3 lines centered on default; expand reveals all.
- `titleFor` overrides applied (e.g. "Vincente 1° Quarto" displayed, not raw "ML 1Q").
- Auto-hide: empty tabs/sub-pills don't appear.
- Click outcome → bet slip dispatch with correct (eventId, marketName, outcomeName, odds).
- Browser console: zero React errors (key collisions, hooks rule violations).

## Rollback

Frontend-only rollback (most likely scenario):
```bash
sed -i 's/NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio,tennis,basket/NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio,tennis/' .env.local
systemctl restart betssolution-player
```
Basket events return to legacy page. Calcio/tennis unaffected.

Backend rollback (if transformer fix causes issues):
```bash
cd /root/betssolution-admin
git revert <transformer-fix-commit>
npm run build
systemctl restart odds-api-ingester
```
New rows revert to old format. Old `<player>::over` rows become orphaned (frontend renders them as fallback, then purge via cleanup or wait for next cycle to overwrite).

## Edge cases / known limitations

| Case | Handling |
|---|---|
| `T/T` exists in volley/hockey too (not basket) | Hero guard `sportSlug === "basket"` |
| Event without `1X2 Tempo Regolamentare` (majority) | Categorizer skips silently |
| Quarter not yet played (prematch) | All Q1-Q4 sub-pills shown if markets exist |
| Live event during Q3 | 30s polling refreshes odds; no special "active quarter" logic |
| 2° Tempo basket nearly empty (10 events DB-wide) | Sub-pill auto-hidden when no markets |
| Player Props label has stat suffix like `"Adam Mokoka (Points)"` | Renderer extracts player as everything before first `(` for display; full label preserved as bet identifier |
| Player Props label without disambiguating stat | Bet remains technically valid (line + odds correct), but stat type ambiguous in UI — accept and document |
| Spread NQ vs Handicap-NQ same product different names | Both visible (no dedupe alias). Future: extend `dedupeNonLineMarkets` if user complaints |
| MEDIAN_LINE on 1-variant market | `sorted[0]` = the only variant. Trivially correct. |
| MEDIAN_LINE on 2-variant market | Picks index 1 (the higher line). Fine for U/O context. |

## Effort estimate

~5-6h end-to-end:
- 1.5h backend transformer (patch + tests + regression check + deploy)
- 0.5h cleanup + re-ingest verify
- 2h frontend (config + LinePicker median + Player Props render + page-v2 wiring)
- 1h smoke test
- 0.5h commits + flag flip + memory update

## Follow-ups (not in scope)

- DB-side translation overrides via SQL migration (cleaner than client-side titleFor — defer until basket overrides exceed ~20 entries).
- `dedupeNonLineMarkets` alias map for `Spread NQ ↔ Handicap - NQ` (post-cutover S6).
- Verify Card Handicap / Handicap-1T outcome name `"1 (-1)"`/`"Tie (1)"` edge case applies to basket — likely no but worth a 5min check post-deploy.
- Auto-detect Player Props stat from label suffix and route to appropriate sub-pill (e.g. `(Points)` → Punti). Requires data observation post-fix.
