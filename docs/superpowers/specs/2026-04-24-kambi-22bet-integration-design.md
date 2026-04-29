# Kambi + 22bet Integration — Maximum Markets Coverage

**Date:** 2026-04-24
**Status:** Design (scheduled, implementation deferred)
**Relative tasks:** #10 (Family A), #11 (Family B), #12 (Family C), #13 (Live ext)

## Problem statement

Player (kiosk) currently shows **only Kambi** as source (`NEXT_PUBLIC_SCRAPER_SOURCE=kambi`). 22bet lives in back-office for consensus/odds comparison but is never exposed to the bettor. All bets are placed against Kambi events and settled by our Flashscore-based engine.

Market coverage measured on 2026-04-24:

| Scope | Kambi | 22bet | Gap |
|-------|-------|-------|-----|
| Prematch overall | 46 mkt/ev | 143 mkt/ev | 22bet 3.1x |
| Prematch top match (PSG-Bayern, Real-Madrid, etc.) | ~260 | ~600 | 22bet 2.3x |
| Prematch shared Championship match | ~200 | ~630 | 22bet 3.2x |
| Prematch small match (U21, women) | 8–55 | 599–677 | 22bet 10–75x |
| **Live** | **15 mkt/ev** | 8 mkt/ev | **Kambi 2x** |

The prematch gap is **provider-native**: 22bet exposes a long-tail of exotic props (per-player pari/dispari, corner-per-interval, cross-team first-scorer combos) that Kambi structurally does NOT expose. Multi-operator Kambi merge (888it + Unibet) is already active and fetches all available betOffers — no additional API params or operators were found that expand coverage.

**Current player limitation:** the scraper-source selector is boolean (kambi|22bet), no merge. Extending to consume both requires solving the settlement problem: if we expose 22bet exotic markets to the bettor, our settlement engine — which today understands 150+ Kambi patterns — will auto-VOID the unrecognized markets, creating user friction.

## Goal

Maximize markets available to the bettor by integrating 22bet prematch markets alongside Kambi, **extending the settlement engine** to resolve the long-tail without VOID-ing legitimate wins. Second priority: investigate Kambi live coverage (15 mkt/ev feels thin even if 2x more than 22bet live).

## User decisions

- **Approach A** chosen (broader market surface), not B/C/D.
- **Policy 4** chosen: extend settlement engine to handle the new markets, NOT accept auto-VOID as compromise.
- **Priority order** accepted: A (team splits) → B (corner/cards extended) → C (exotic combos).
- **Live extension** to be investigated AFTER prematch extension is shipped.

## Architecture

### Four work streams

Each stream is an independent task in the task list. Streams 1–3 can ship incrementally to prod; stream 4 is investigation-first.

#### Stream 1 — Family A: Team splits (task #10)
Settle markets that split a match stat by team.

Target markets (22bet names):
- `O/U Corner Casa 4.5`, `O/U Corner Ospite 3.5`
- `O/U Tiri Casa`, `O/U Tiri Ospite`
- `O/U Gol Casa 1.5`, `O/U Gol Ospite 1.5`
- `1X2 Corner Casa`, `Handicap Corner Casa (+1.5)`
- HT/SH variants of each

Data requirements:
- `corners_home`, `corners_away`, `ht_corners_home`, `ht_corners_away` — **all present** in flashscore feed (verified in `lib/flashscore.ts`)
- `shots_home`, `shots_away` — **needs verification** — if missing, Opta stats feed may be available via flashscore details endpoint

Implementation:
- New settler keys: `O/U_HOME_CORNER`, `O/U_AWAY_CORNER`, `1X2_CORNER_HOME`, `HANDICAP_CORNER_HOME`, etc.
- Extend `SETTLERS` map in `lib/settlement.ts` (around line 780)
- Extend `MARKET_PATTERNS` regex list to catch 22bet names and map to new keys
- Remove matching patterns from `VOID_PATTERNS` (around line 167)

Estimate: ~1 day incl. test suite updates.

#### Stream 2 — Family B: Corner/Cards extended (task #11, blocked by #10)
Settle per-half and handicap variants of corner/cards markets.

Target markets:
- `Handicap Corner 1°T (-1)`, `Handicap Corner 2°T (+1.5)`
- `DC Corner 1°T`, `DC Corner 2°T`
- Cards HT: `O/U Cartellini 1°T 2.5`, `Handicap Cartellini 1°T` (**needs verification: does flashscore expose HT card counts?**)
- **NOT in scope**: `Primo corner`, `Gara a 5 corner` — these require minute-level timeline data not in flashscore feed. Stay in VOID_PATTERNS.

Data requirements:
- Corner HT/SH: already derivable from flashscore HT+FT snapshots
- Cards HT: unknown, needs probe. If not available, mark as VOID and document in spec.

Estimate: ~1 day.

#### Stream 3 — Family C: Exotic combos (task #12)
Combo markets composable from existing settleable parts.

Target markets:
- `1X2+GG` (1+GG, X+NG, 2+GG, etc. — 6 combos)
- `1X2+O/U 2.5` (1+Over, X+Under, etc. — 6 combos)
- `HT/FT+Exact Score` (conditional compose)
- `Vincente+entrambe segnano` = 1X2 AND GG outcome
- `DC+O/U`

No new data requirements — all composable from `home`, `away`, `ht_home`, `ht_away` which are already in `ResultData`. Settler is a function that decomposes the combo into parts, calls existing settlers, AND's the verdicts.

Estimate: ~0.5 day.

#### Stream 4 — Live extension investigation (task #13)
Kambi live = 15 mkt/ev. Prematch same event = 200+. Gap 13x.

Hypotheses to test:
1. Live loop uses different operator set than prematch — check `config.json` `sportOperators` merge is applied to live-loop.ts (inspection shows live-loop already uses `getUniqueOperators()` — needs empirical test)
2. Kambi live endpoint `event/live/open.json` + per-event `betoffer/event/{id}.json` may not return all markets when event is live; alternative endpoints may exist (e.g. `live/event/{id}.json`)
3. Categories removed during live: handicap asiatici, exact score, player props. Some may be recoverable (e.g. handicap by simple market-exists check).
4. Betfair Exchange has live markets for top matches — as a 3rd source it could add markets Kambi drops when events go live.

Output: measurement + recommendation. If fixable via operator/endpoint tweak, implement inline; if requires new source, follow-up task for Betfair integration.

Estimate: 2–4h investigation, then 1 day implementation if simple, or a new stream for Betfair.

### Player-side change (shared across streams 1–3)

Once settlement supports the new markets, expose 22bet markets to the player:

1. **API `/api/sportsbook`**: merge markets from both sources per-event, union by `(market_type, line)`, preserve Kambi outcome when market exists in both (Kambi is book-of-record for settlement continuity), add 22bet-only markets with `source: "22bet"` attribute on outcome (for bet placement routing)
2. **`bet_selections` row**: add `source` column (kambi|22bet). Settler uses this to decide whether Kambi-style or 22bet-style name pattern matching applies
3. **Event mapping**: uses existing `flashscore_id` to pivot 22bet events to their Kambi twin (same infrastructure used by consensus page). When no Kambi twin exists, 22bet event can still be offered as fallback (task #13 territory) — but defer: first ship the Kambi-primary+22bet-augment path.

Player changes are out-of-scope for streams 1–3 technically but are the consumer — schedule after stream 3 ships.

## Non-goals

- **Player props** (per-player goals, cards, shots, assists) — requires Opta data feed; not available via flashscore feed; separate future project
- **Minute-timeline markets** (corner in first 10', goal in 30-45') — requires event timeline data not in flashscore
- **Live long-tail expansion to 200 mkt/ev** — will not magically happen; Kambi sospende for risk management, that's business-logic not bug
- **Changing settlement source-of-truth** — Kambi remains primary book; 22bet markets use Kambi events as anchor (via flashscore_id)
- **Migrating away from Kambi** — out of scope

## Rollout plan

Stream 1 → Stream 2 (blocks) → Stream 3 (parallel-safe with 2). Stream 4 independent, any time.

After each stream: 1 day canary on staging, manual settle-test on 10 real events closed during canary, then prod via CI/CD.

Player-side markets exposure ships only after Stream 3 is stable in prod for 48h minimum — gives settlement time to encounter real long-tail events and catch any pattern gaps.

## Open questions — probed 2026-04-24

1. ✅ **flashscore exposes shots per team?** YES — `Partita/1 Tempo/2 Tempo: Tiri totali|Tiri in porta|Tiri fuori` per team. Probe: `scripts/probe-flashscore-stats.ts`.
2. ✅ **flashscore exposes HT cards per team?** YES — `1 Tempo: Cartellini gialli` (+`rossi` when present), per team.
3. ❌ **Kambi alternate live endpoint?** `/event/{id}/live.json` returns 404. But discovered: `live-loop.ts` pins events to first-seen operator; cross-operator betOffer merge yields +40-60% markets (888it=12 vs ub=17 on same event). Probe: `scripts/probe-kambi-live.ts`.
4. ⏸ **Betfair Exchange as 3rd source?** Deferred — Phase 4 cross-operator merge may close the gap.

**Bug surfaced by probe:** `lib/settlement.ts:123-149` `extractStat()` uses English stat names ("Match: Corner Kicks") but flashscore feed returns Italian ("Partita: Calci d'angolo"). Silent failure — corners/cards/shots never extracted in production today. Fix is Phase 0 Task 0.1 of the implementation plan.

## Plan

- `docs/superpowers/plans/2026-04-24-kambi-22bet-integration.md` — 5-phase implementation plan (foundation + 4 streams + player-side).

## Reference paths

- Settlement engine: `lib/settlement.ts` (1500+ lines, 150 patterns, 50 void patterns)
- Flashscore client: `lib/flashscore.ts`
- Kambi scraper: `kambi-scraper/src/transform.ts` + `kambi-client.ts`
- 22bet scraper: `22bet-scraper/src/transform.ts`
- Consensus logic (uses flashscore_id pivot): migration 086 `v_consensus_latest`
