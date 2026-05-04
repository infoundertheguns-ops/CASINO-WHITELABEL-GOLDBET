# Cross-sport regression check — rule 0a `{label,over,under}`

Task 1 of plan `2026-05-04-event-v2-basket.md`. Branch `feature/plan-d-settlement-d1` HEAD `0af6948`.

## Proposed change

`services/odds-api-ingester/src/transformer.ts` adds a new highest-priority rule before rule 1:

```ts
// 0a. Labelled totals: emit per-label over/under so distinct entities don't collide
if (label != null && over != null && under != null) {
  out.push({ market_key, outcome_key: `${label}::over`,  line: hdp, odds: over });
  out.push({ market_key, outcome_key: `${label}::under`, line: hdp, odds: under });
  return out;
}
```

## Step 1a — fixture grep

Scanned 1 fixture file (only `event-pisa-lecce.json` exists). Found **1 hit**:

| Sport | Market | Label sample |
|---|---|---|
| calcio | First 10 Minutes (00:00 - 09:59) | `"Goals (Over) (0.5)"` |

## Step 1b — live odds-api probe (15 bookmakers per event)

Probed one prematch event in next 72h per sport (9 sports active in `v_player_events`).

| Sport | event | bookmakers | markets | hits | unique market_names with hits |
|---|---|---|---|---|---|
| tennis | 71220842 (Edwards) | 1 | 1 | 0 | – |
| calcio | 70228874 (Furia) | 3 | 18 | 0 | – |
| baseball | 63299263 (Rockies-MLB) | 14 | 81 | 255 | 12 (player props) |
| basket | 70849802 (Paisas, Colombia LBP) | 6 | 25 | 0 | – |
| basket | 70504984 (Knicks NBA) | 15 | 127 | 598 | 13 (player props) |
| basket | 70504952 (Spurs NBA) | 15 | 135 | 605 | 13 (player props) |
| hockey-ghiaccio | 71244154 (Bulldogs) | 5 | 12 | 0 | – |
| cricket | 71283906 (S Kanto) | 1 | 1 | 0 | – |
| volley | 71284588 (Molot) | 2 | 6 | 0 | – |
| pallamano | 71096124 (Zvezda) | 2 | 12 | 0 | – |
| rugby | 65687452 (Brumbies) | 2 | 17 | 0 | – |

(Minor-league basket event 70849802 had no player-props bookmakers; NBA games show the full pattern.)

## Classification table

| Sport | Market name | Classification | Reason |
|---|---|---|---|
| calcio | First 10 Minutes (00:00 - 09:59) | **Benign** | 1 label per market (`"Goals (Over) (0.5)"`); rule 0a just suffixes it. No info recovered, no info lost. |
| baseball | Triples O/U | **Surprising-positive** | 17+ player labels collide today on `(market,"over",0.5)` → only 1 survives db dedup. Rule 0a recovers all per-player lines. |
| baseball | Hits O/U | Surprising-positive | Same: 17 players × 0.5/1.5/2.5. |
| baseball | Runs Batted In O/U | Surprising-positive | 12 players × 0.5. |
| baseball | Total Bases O/U | Surprising-positive | 7 players × 1.5. |
| baseball | Batter Strikeouts O/U | Surprising-positive | 18 players × 0.5/1.5. |
| baseball | Total Hits, Runs and RBIs O/U | Surprising-positive | 14 players. |
| baseball | Doubles O/U | Surprising-positive | 18 players. |
| baseball | Pitcher Strikeouts O/U | Surprising-positive | Pitcher-only props. |
| baseball | Pitcher Walks Issued O/U | Surprising-positive | 2 pitchers. |
| baseball | Stolen Bases O/U | Surprising-positive | 14 players. |
| baseball | Runs O/U | Surprising-positive | 15 players. |
| baseball | Pitcher Outs O/U | Surprising-positive | 1+ pitchers. |
| baseball | Batter Walks O/U | Surprising-positive | 17 players. |
| baseball | Home Runs O/U | Surprising-positive | 18 players. |
| baseball | Pitcher Hits Allowed O/U | Surprising-positive | 2 pitchers. |
| baseball | Singles O/U | Surprising-positive | 18 players. |
| baseball | Player Props (DraftKings unified) | Surprising-positive | Single market with label = `"Player (Stat)"`, ~50 distinct labels per event. |
| basket | Steals O/U | Surprising-positive | NBA player-props pattern. |
| basket | Points & Assists O/U | Surprising-positive | NBA. |
| basket | Points, Assists & Rebounds O/U | Surprising-positive | NBA. |
| basket | Rebounds O/U | Surprising-positive | NBA. |
| basket | Assists & Rebounds O/U | Surprising-positive | NBA. |
| basket | Field Goals Made O/U | Surprising-positive | NBA. |
| basket | Points & Rebounds O/U | Surprising-positive | NBA. |
| basket | Assists O/U | Surprising-positive | NBA. |
| basket | Steals & Blocks O/U | Surprising-positive | NBA. |
| basket | Threes Made O/U | Surprising-positive | NBA. |
| basket | Points O/U | Surprising-positive | NBA. |
| basket | Blocks O/U | Surprising-positive | NBA — primary basket event-v2 target. |
| basket | Player Props (BetUK unified) | Surprising-positive | Single market with label = `"Player (Stat)"`, multi-stat. |

**Zero "Breaking" entries.**

## Settlement-side regression assessment

### Legacy classifier (`lib/settlement/odds-api/classify.ts`)

- `settleOU` uses `norm(outcome_name)` → `"over"`/`"under"` literal match.
- **Critical**: classifier dispatches by `market_type` (Italian/canonical names). None of the affected market_names (`Player Props`, `Hits O/U`, `Triples O/U`, `Points O/U`, basket per-player O/U, `Pitcher * O/U`, etc.) are dispatched to `settleOU` — they fall through to `unsupported_market_type → null`.
- After rule 0a: outcome_key becomes `"<label>::over"`. Even if these markets WERE dispatched, `norm("juan soto (1) (1.5)::over") !== "over"` → null. But since dispatch never happens, this is moot.
- Conclusion: **no settlement regression**.

### Canonical dispatcher (`lib/settlement/canonical-dispatcher.ts`)

- Maps `(source, source_market_type, source_outcome_name_lower)` → `canonical_outcome_key`. The `source_outcome_name` is the human display name from the outcomes_v2 row, not `outcome_key`. Passthrough — no string-equality check on `outcome_key`.
- Conclusion: **no regression**.

### Frontend renderers (`betssolution-player`)

- `grep` of player repo for `outcome_key === "over"` / `"under"`: zero hits.
- Sportsbook listing v2 / player-event-v2 pass `source_outcome_key` through but never branch on it.
- Display uses `outcome.name` (the human label).
- Conclusion: **no frontend regression**.

### DB upsert dedup (`services/odds-api-ingester/src/upsert.ts:111-129`)

- Dedup key: `(market_id, outcome_key, line)`.
- Currently 17 baseball "Hits O/U" players × hdp 0.5 collide on `(market, "over", 0.5)` → only ONE survives. This is the bug rule 0a fixes.
- After rule 0a: 17 distinct `(market, "<player>::over", 0.5)` rows survive. **Net positive**.

## Verdict

**SAFE TO PROCEED with rule 0a (no guard needed).**

Findings are exclusively **Benign** (calcio first-N-minutes single-label) or **Surprising-positive** (baseball + basket player-props recovery). No downstream code does string-equality against `outcome_key` for `"over"`/`"under"`. Settlement keys off `market_type` dispatch and `outcome_name` strings, never `outcome_key`. The change recovers data currently lost to db dedup collision and is the foundation of basket player-props rendering.

## Caveats

- Benign calcio "First 10 Minutes" markets aren't currently settled either (no entry in classify.ts dispatch, no canonical mapping observed). Kiosk display unchanged because frontend renders `outcome.name`.
- If any future settler is added that dispatches `Hits O/U` / `Player Props` to a player-props settler, that settler must parse `outcome_name` (label/player/stat) and not assume `outcome_key in {over,under}`. Rule 0a doesn't change `outcome_name` — only `outcome_key`.
