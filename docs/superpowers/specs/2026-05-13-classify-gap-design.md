# Classify Gap — Design (s4-classify-gap)

**Date**: 2026-05-13
**Branch**: `feature/plan-d-settlement-d1`
**Scope**: Bet settlement coverage for OddsAPI markets where classifier currently returns `verdict=null`, leaving `bet_selections.result` stuck NULL.
**Status**: Draft → pending spec review + user approval

---

## 1. Problem

`lib/settlement/odds-api/classify.ts` is a pure dispatcher: given `(market_name, outcome_key, line)` + a `ScoreResult`, it returns a verdict. When a market name is not recognized, or required score fields are absent, it returns `null` and the calling `settle-leg.ts` skips the leg. Result: bets remain `result IS NULL` indefinitely.

A probe of prod data (`db.xgnyqkmugnfzhdveeqom.supabase.co`, 2026-05-13) surfaced two distinct bugs that together account for the entire "~20% top-30 markets gap" memo claim — and reveal the gap is materially larger.

### Bug X — Data routing

`settle-leg.ts::buildScores()` (line 37-56) reads half-time / per-period scores **only** from `events_v2.period_scores` (a column originally intended to be populated by the OddsAPI ingester transformer).

Probe finding:

```
SELECT status, COUNT(*) FILTER (WHERE period_scores IS NOT NULL) filled, COUNT(*) total
 cancelled | 0 | 4872
 pending   | 0 | 2390
 live      | 0 | 104
 settled   | 0 | 5773
```

`events_v2.period_scores` is **NULL for 100% of all 13139 events**. odds-api.io v3 either does not emit `scores.periods` consistently or the ingester window misses it. The column is dead.

Meanwhile, the FS scraper populates `events_v2.live_data` (JSONB) with per-period scores under different keys:

```
SELECT sport_slug, COUNT(*) FILTER (WHERE live_data->'periods' IS NOT NULL) periods,
                  COUNT(*) FILTER (WHERE (live_data->>'halfScoreHome') IS NOT NULL) hs
FROM events_v2 WHERE status='settled' GROUP BY 1;

 football          | 1209 / 2863 (42%) | 2340 / 2863 (82%)
 tennis            |  455 /  866 (52%) |  596 /  866 (69%)
 basketball        |  453 /  738 (61%) |  547 /  738 (74%)
 baseball          |  205 /  399       |  303 /  399
 handball          |   98 /  193       |  130 /  193
 volleyball        |   34 /   82       |   40 /   82
 rugby             |   32 /   70       |   32 /   70
 esports           |    0 /  212       |    0 /  212
 darts             |    0 /  163       |    0 /  163
 ice-hockey        |    0 /   84       |    0 /   84
```

**Affected markets** (already have classifier branches but always return `null` in prod due to missing `ht_home`/`ht_away`):

| Market | Volume (markets_v2) | Sport |
|---|---|---|
| Totals HT | 39299 | football |
| ML HT | 18018 | football |
| Spread HT | 17424 | football |
| Half Time / Full Time | 11671 | football |
| Both Teams To Score HT | 5098 | football |
| Half Time Result | 5048 | football |
| 1st Half Handicap | 2553 | football |
| Totals 2H | 14194 | football |
| Both Teams To Score 2H | 2601 | football |

Subtotal: **~116k markets** unsettleable due to Bug X alone.

### Bug Y — Missing classifier branches

Top-volume markets in prod for which `classify.ts` has **no branch** at all:

| Market | Volume | Sport |
|---|---|---|
| Team Total Away | 44183 | football |
| Team Total Home | 44134 | football |
| ML 2H | 15342 | football |
| First Team To Score | 9954 | football |
| Totals (Games) | 8340 | tennis |
| Corners Totals Away | 7101 | football |
| Corners Totals Home | 7101 | football |
| Spread (Games) | 6976 | tennis |
| 3-Way Result | 5837 | handball+basket+hockey+baseball |
| Set Betting | 919 | tennis |
| ML 1st Set / 2nd Set | 1041 + 1010 | tennis |
| Totals 1st Set | 1693 | tennis |
| 3-Way Result HT | 722 | basket+handball |
| Totals 1Q | 1999 | basket |
| Team Total Goals Home/Away (alt naming) | 2552 + 2552 | football |

Subtotal: **~140k markets** unsettleable due to Bug Y.

### Combined impact

Total unsettleable markets touched: **~260k** (after deduplication and applying live_data coverage caps, realistically ~150-180k will become settleable end-to-end with this work).

### Explicitly out-of-scope

| Sport / Market | Reason |
|---|---|
| esports map markets (1st/2nd/3rd Map Moneyline, Map Total Kills, etc.) | FS does not scrape esports — 0% `live_data` coverage. Needs separate provider integration. |
| darts set markets | 0% `live_data` periods. |
| ice-hockey period markets | 0% `live_data`. |
| Player props (Player Total Sets, Goalkeeper Saves per player, etc.) | Low volume (~1.9k), distinct enumeration work. Pending separate. |

---

## 2. Architecture

### Two-bucket data model

```
events_v2 row
   ├─ score_home / score_away      [always reliable when status=settled]
   │                                football → goals; tennis → sets won; esports → maps won
   ├─ period_scores (column)       [NULL in 100% of prod — kept as future-proof slot]
   └─ live_data (JSONB)            [FS scrape — populated 0-82% by sport]
        ├─ halfScoreHome: number[] [per-period score, e.g. tennis [6,7], basket [21,25,...]]
        ├─ halfScoreAway: number[]
        └─ periods: Array<{        [football-preferred shape]
              name: string           "1 Tempo" / "2 Tempo" / "Set 1" / "P1"
              homeScore: number
              awayScore: number
              durationSec?: number
           }>
```

### Component changes — overview

```
┌──────────────────────────────────────────────────────┐
│ settle-leg.ts                                        │
│  ┌─────────────────────────────────────────────┐    │
│  │ SELECT_LEG_FIELDS                           │    │
│  │   + events_v2.live_data                     │ ←  │  ADD
│  └─────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────┐    │
│  │ buildScores()                               │    │
│  │   reads period_scores (legacy fallback)     │    │
│  │   + reads live_data.periods / halfScore[]   │ ←  │  EXTEND
│  │   populates ht_home/away + period arrays    │    │
│  └─────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
                       │
                       ▼ ScoreResult (extended)
┌──────────────────────────────────────────────────────┐
│ classify.ts                                          │
│  existing branches (1X2, OU, BTTS, DC, ...)          │
│  + 4 new full-match branches                         │ ←  ADD
│  + 8 new per-period branches (tennis sets, etc.)     │ ←  ADD
│  + helper: extractPeriodFor(sport, periodIdx, side)  │ ←  ADD
└──────────────────────────────────────────────────────┘
```

### `ScoreResult` extension

Existing interface (unchanged fields remain):

```ts
interface ScoreResult {
  home: number;
  away: number;
  ht_home?: number | null;
  ht_away?: number | null;
  corners_home?: number | null;
  corners_away?: number | null;
  /* ... existing stat fields ... */
  scorers?: Scorer[];
  assists?: Scorer[];
  player_shots?: Array<{ name: string; shots: number }>;
}
```

New fields:

```ts
interface ScoreResult {
  /* ... existing ... */

  // Per-period scores (array indexed by period: 0 = 1st half / 1st set / Q1)
  period_scores_home?: number[] | null;
  period_scores_away?: number[] | null;

  // Sport hint for sport-aware classifier branches (e.g. 3-Way Result aliases for hockey)
  sport_slug?: string | null;
}
```

`ht_home`/`ht_away` continue to mean "first period score" and remain the contract for existing HT branches. They are now populated from EITHER `period_scores` column OR `live_data` (priority below).

### `buildScores()` — new logic

```
function buildScores(row):
  if row.score_home is null OR row.score_away is null:
    return null

  // Priority 1: period_scores column (legacy, currently always empty)
  ht_home, ht_away = extractFromPeriodScoresColumn(row.period_scores)
  periods_home, periods_away = [], []

  // Priority 2: live_data (FS source, primary)
  if ht_home is null:
    if row.sport_slug == "football":
      // Football prefers named periods
      p1 = findPeriodByName(row.live_data.periods, "1 Tempo")
      if p1: ht_home = p1.homeScore; ht_away = p1.awayScore

    if ht_home is null AND row.live_data.halfScoreHome is array:
      ht_home = row.live_data.halfScoreHome[0]
      ht_away = row.live_data.halfScoreAway[0]

  // Always populate period arrays from live_data when present
  if row.live_data.halfScoreHome is array:
    periods_home = row.live_data.halfScoreHome
    periods_away = row.live_data.halfScoreAway
  else if row.live_data.periods is array:
    periods_home = map(periods, p -> p.homeScore)
    periods_away = map(periods, p -> p.awayScore)

  return ScoreResult{
    home, away, ht_home, ht_away,
    period_scores_home: periods_home or null,
    period_scores_away: periods_away or null,
    sport_slug: row.sport_slug,
    /* + corners/cards/scorers from existing fields */
  }
```

### Classifier extension — sport-aware helper

```ts
// Returns [home_score, away_score] for the Nth period (0-indexed)
// or [null, null] if period data missing.
function getPeriodScores(result: ScoreResult, periodIdx: number): [number | null, number | null] {
  const h = result.period_scores_home?.[periodIdx];
  const a = result.period_scores_away?.[periodIdx];
  return [h ?? null, a ?? null];
}

// Returns total games (tennis) summed across all sets
function getTotalGames(result: ScoreResult): [number | null, number | null] {
  const h = result.period_scores_home;
  const a = result.period_scores_away;
  if (!h || !a) return [null, null];
  return [h.reduce((s, x) => s + x, 0), a.reduce((s, x) => s + x, 0)];
}
```

---

## 3. Classifier branches to add

### 3a. Full-match markets (Bug Y, no period dependency)

```
// Team Total Home / Away
if (mt === "team total home" || mt === "team total goals home") {
  return { verdict: settleOU(result.home, leg.line, leg.outcome_name) };
}
if (mt === "team total away" || mt === "team total goals away") {
  return { verdict: settleOU(result.away, leg.line, leg.outcome_name) };
}

// First Team To Score
if (mt === "first team to score" || mt === "prima squadra a segnare") {
  return settleFirstTeamToScore(result.scorers, result.home + result.away, leg.outcome_name);
}

// 3-Way Result (alias of 1X2 for hockey/basket/handball/baseball/tennis)
if (mt === "3-way result" || mt === "3 way result") {
  return { verdict: settle1X2(result.home, result.away, leg.outcome_name) };
}

// Corners Totals Home / Away
if (mt === "corners totals home" || mt === "totale angoli casa") {
  const v = result.corners_home == null
    ? null
    : settleOU(result.corners_home, leg.line, leg.outcome_name);
  return { verdict: v, reason: v == null ? "corners_home_missing" : undefined };
}
if (mt === "corners totals away" || mt === "totale angoli trasferta") {
  const v = result.corners_away == null
    ? null
    : settleOU(result.corners_away, leg.line, leg.outcome_name);
  return { verdict: v, reason: v == null ? "corners_away_missing" : undefined };
}
```

**`settleFirstTeamToScore`** logic:

```ts
function settleFirstTeamToScore(
  scorers: Scorer[] | null | undefined,
  totalGoals: number,
  outcome: string,
): { verdict: Verdict | null; reason?: string } {
  if (scorers == null) return { verdict: null, reason: "scorers_missing" };
  const o = norm(outcome);
  // 0-0 result: no team scored
  if (scorers.length === 0 || totalGoals === 0) {
    if (o === "none" || o === "nessuna" || o === "no goal") return { verdict: "won" };
    if (o === "home" || o === "casa" || o === "1" || o === "away" || o === "trasferta" || o === "2") {
      return { verdict: "void" };  // refund
    }
    return { verdict: "void" };
  }
  const firstTeam = scorers[0].team;
  if (firstTeam == null) return { verdict: null, reason: "first_scorer_team_missing" };
  if (o === "home" || o === "casa" || o === "1") return { verdict: firstTeam === "home" ? "won" : "lost" };
  if (o === "away" || o === "trasferta" || o === "2") return { verdict: firstTeam === "away" ? "won" : "lost" };
  if (o === "none" || o === "nessuna" || o === "no goal") return { verdict: "lost" };
  return { verdict: "void" };
}
```

### 3b. ML 2H (full second half result)

```
if (mt === "ml 2h" || mt === "second half result") {
  if (result.ht_home == null || result.ht_away == null) {
    return { verdict: null, reason: "ht_scores_missing" };
  }
  return { verdict: settle1X2(result.home - result.ht_home, result.away - result.ht_away, leg.outcome_name) };
}
```

(The existing `1x2 - 2t` branch is kept; this adds the English alias.)

### 3c. Per-period markets

```
// ML 1st Set / 2nd Set (tennis + volleyball)
if (mt === "ml 1st set") {
  const [h, a] = getPeriodScores(result, 0);
  if (h == null) return { verdict: null, reason: "set1_missing" };
  return { verdict: settle1X2(h, a, leg.outcome_name) };
}
if (mt === "ml 2nd set") {
  const [h, a] = getPeriodScores(result, 1);
  if (h == null) return { verdict: null, reason: "set2_missing" };
  return { verdict: settle1X2(h, a, leg.outcome_name) };
}

// Totals 1st Set (tennis: total games in set 1)
if (mt === "totals 1st set") {
  const [h, a] = getPeriodScores(result, 0);
  if (h == null) return { verdict: null, reason: "set1_missing" };
  return { verdict: settleOU(h + a, leg.line, leg.outcome_name) };
}

// Totals (Games) — tennis, total games across all sets
if (mt === "totals (games)" || mt === "totale giochi") {
  const [h, a] = getTotalGames(result);
  if (h == null) return { verdict: null, reason: "period_scores_missing" };
  return { verdict: settleOU(h + a, leg.line, leg.outcome_name) };
}

// Spread (Games) — tennis, handicap on total games
if (mt === "spread (games)" || mt === "spread giochi") {
  const [h, a] = getTotalGames(result);
  if (h == null) return { verdict: null, reason: "period_scores_missing" };
  return { verdict: settleHandicap2Way(h, a, leg.line, leg.outcome_name) };
}

// Set Betting (tennis correct-score on sets won)
if (mt === "set betting") {
  return { verdict: settleCorrectScore(result.home, result.away, leg.outcome_name) };
}

// Totals 1Q (basket)
if (mt === "totals 1q" || mt === "totale 1q") {
  const [h, a] = getPeriodScores(result, 0);
  if (h == null) return { verdict: null, reason: "q1_missing" };
  return { verdict: settleOU(h + a, leg.line, leg.outcome_name) };
}

// 3-Way Result HT (basket+handball — 1X2 on first period)
if (mt === "3-way result ht") {
  const [h, a] = getPeriodScores(result, 0);
  if (h == null) return { verdict: null, reason: "ht_scores_missing" };
  return { verdict: settle1X2(h, a, leg.outcome_name) };
}
```

---

## 4. Testing

### Fixture file extension

Add `tests/fixtures/settlement/gap-coverage.json` (separate from `score-only-60.json` to keep concerns isolated). Targets ~30 cases:

- **Team Total H/A**: won, lost, push (line integer), invalid outcome
- **First Team To Score**: home first → home wins, away first → away wins, 0-0 → none wins / home void / away void, scorers missing → null
- **3-Way Result**: aliases of 1X2 fixtures, hockey draw case
- **Corners Totals H/A**: corners_home present → resolves, corners_home null → null with reason
- **HT markets via live_data**: 1 fixture each for Half Time Result / Totals HT / BTTS HT — verifies that `buildScores()` correctly populated `ht_home/away` from synthetic `live_data` input
- **Tennis ML 1st Set / Totals 1st Set / Set Betting**: standard cases
- **Tennis Totals (Games) / Spread (Games)**: 3-set match with summing
- **ML 2H**: 1-0 HT → 2-2 FT → 2H 1-2 → away wins

### Unit tests for `buildScores()`

New file `tests/lib/settlement/odds-api/build-scores.test.ts`:

- `period_scores` populated → uses it (legacy path)
- `period_scores` null, `live_data.periods` with "1 Tempo" → extracts HT for football
- `period_scores` null, `live_data.halfScoreHome[0]` present → extracts HT for non-football
- Both `period_scores` and `live_data` null → ht_home/away null
- `live_data.halfScoreHome` array → populates `period_scores_home` array on result
- Cross-sport: same row with different `sport_slug` triggers different extraction priorities

### Hard gate

100% fixture pass + tsc clean before deploy. Pattern already enforced for S6 cutover.

---

## 5. Deploy + verification

### Pre-deploy

1. `npm run typecheck` clean
2. `npm test -- classify` all pass
3. Local smoke: invoke `runSettlementPass()` against staging via REPL or temp script

### Staging probe

After deploy on staging, run SQL to measure delta:

```sql
SELECT
  COUNT(*) FILTER (WHERE bs.result IS NULL) bets_still_null,
  COUNT(*) FILTER (WHERE bs.result IS NOT NULL) bets_classified,
  m.market_name,
  COUNT(*) total
FROM bet_selections bs
JOIN markets_v2 m ON m.id = bs.market_id
JOIN events_v2 e ON e.id = bs.event_id
WHERE e.status = 'settled'
GROUP BY m.market_name
ORDER BY total DESC
LIMIT 30;
```

Expected: 0 bets stuck for Team Total H/A, First Team To Score, 3-Way Result, Corners H/A on events with settled status and FS data present.

### Prod deploy

Standard admin deploy pipeline (tarball + scp + remote-apply.sh). Monitor `/api/admin/settlement-health` for 24h. Watch for unexpected verdicts (false positives) via `settlement_log` audit.

### Backfill (optional)

After 24h clean monitoring, run `runSettlementPass(hoursWindow=720)` (30-day backfill) once. Existing settled events that had stuck bets will be classified. No new ones expected once forward path is fixed.

---

## 6. Risks + mitigations

| Risk | Mitigation |
|---|---|
| `live_data` shape varies (esports = empty, darts = missing periods) | Branches return `null` with explicit reason — no crash, bet stays pending (existing behavior). |
| FS scraper writes wrong `halfScoreHome` (misnomer field on basket = per-quarter) | Field is array of per-period — semantic verified via probe samples. Helper `getPeriodScores(idx)` makes this explicit. |
| Football `live_data.periods` sometimes incomplete (only "1 Tempo" present) | `buildScores()` uses what's there, leaves `ht_home/away` null if not found — same null-verdict outcome as today. |
| Tennis `period_scores_home` mid-match (only Set 1 played) | Match still active = `status != 'settled'` → settle-leg.ts skips it. Only fired on settled events. |
| Bet voided/refunded markets misclassified due to alias mismatch | Add alias to existing branches conservatively; fixture tests cover known cases. Unknown aliases continue to return `null` (safe default). |

---

## 7. What this design does NOT change

- `period_scores` column kept as-is. Future investigation may revive it if OddsAPI starts emitting periods reliably. Not part of this work.
- No changes to `lib/settlement.ts` (the 2307 LOC legacy file).
- No DB migrations.
- No changes to OddsAPI ingester (`services/odds-api-ingester/`).
- No changes to FS scraper.
- No changes to `bet_selections` schema or upstream consumers.

---

## 8. Effort estimate

| Phase | Estimate |
|---|---|
| `buildScores()` extension + `ScoreResult` interface update | 1-1.5h |
| 4 full-match branches + `settleFirstTeamToScore` helper | 1h |
| 8 per-period branches + helpers (`getPeriodScores`, `getTotalGames`) | 1.5-2h |
| Test fixtures (~30 cases) + unit tests `buildScores` | 1h |
| Deploy + staging probe + 24h monitoring | 1h |
| **Total** | **5.5-6.5h** |

Original pending memo estimated 3-6h; revised estimate aligns with upper bound. Reframe is justified — `period_scores` finding requires the data-routing fix (Bug X) on top of the originally-scoped classifier branches (Bug Y).

---

## 9. Acceptance criteria

1. `classifyLeg()` returns non-null verdict for: Team Total Home/Away, First Team To Score, 3-Way Result, Corners Totals Home/Away on any event with `status='settled'` and applicable data present.
2. `classifyLeg()` returns non-null verdict for Half Time Result, Totals HT, BTTS HT, Spread HT, ML HT, ML 2H, HT/FT on football events with `live_data.periods` containing "1 Tempo".
3. `classifyLeg()` returns non-null verdict for ML 1st Set, Totals 1st Set, Set Betting, Totals (Games), Spread (Games) on tennis events with `live_data.halfScoreHome` array populated.
4. Staging probe: ≥ 80% reduction in `bet_selections` stuck `result IS NULL` for in-scope market names after a backfill `runSettlementPass(720h)`.
5. All existing fixtures still pass (no regression).
6. New `gap-coverage.json` fixtures all pass (hard gate).
7. `tsc --noEmit` clean.

---

## 10. Out-of-scope / follow-ups

- **Esports map markets** + **darts** + **ice-hockey period markets**: need separate provider integration (api-sports.io evaluated previously, currently parked). New pending if/when re-prioritized.
- **Player props** (Player Total Sets, Goalkeeper Saves per player, etc.): low volume, distinct enumeration of `label::over`/`label::under` patterns from ingester. Separate pending.
- **OddsAPI `period_scores` revival**: investigate odds-api.io v3 actual response payload to confirm if periods are ever sent, decide if column has future. Not blocking.
- **Backfill scope** beyond 30 days: depends on retention timer and whether old stuck bets should be paid out retroactively (business decision).
