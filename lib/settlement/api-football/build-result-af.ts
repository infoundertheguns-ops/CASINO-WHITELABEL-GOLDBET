// M3.2 — Build a settlement ScoreResult from api-football enrichment payloads.
//
// Pure mapper. Reads `events_v2` row columns (score_home, score_away, home,
// away, period_scores) PLUS `live_data.statistics_af` / `live_data.events_af`
// / `live_data.players_af_ft` and projects them into an `AFResult` shape
// consumed by classify-af.ts (M3.3-M3.5).
//
// Design constraints:
//   - No I/O, no DB calls, no `fetch`, no `Date.now()`.
//   - All optional/nullable inputs are handled defensively: partial / null /
//     missing arrays must NOT throw. Missing data = field absent (undefined),
//     never zero (zero is a real, settlement-meaningful observation).
//   - The shape mirrors `lib/settlement/odds-api/classify.ts#ScoreResult` for
//     the score-derived fields AND the per-team aggregated aliases so callers
//     in classify-af can pick either the structured `home_stats` /
//     `away_stats` or the flat `corners_home` / `corners_away` form.
//   - Team identification: api-football returns 2 entries in
//     `statistics_af` (one per team) with `team.name`. We match against
//     `event.home` / `event.away` (string compare, case-insensitive trim).
//     If matching fails (e.g. team-name drift between providers) we fall
//     back to positional convention: index 0 = home, index 1 = away
//     (documented api-football behaviour, see /fixtures/statistics docs).

/**
 * Minimal local shape — we deliberately do NOT depend on the legacy
 * `SettlementResult` from `lib/settlement.ts` (that file owns a different
 * type tree) nor on `ScoreResult` from `lib/settlement/odds-api/classify`
 * (M3 will eventually consume our result, not the other way round).
 *
 * Caller is the dual-source settler harness (M3.6) which queries
 * `events_v2` with the columns enumerated below.
 */
export interface EventForSettlement {
  // Team names — `events_v2.home` / `events_v2.away` (text columns).
  home?: string | null;
  away?: string | null;
  // Final scores (api-football persists into these via persistTimerAndScore).
  score_home?: number | null;
  score_away?: number | null;
  // Per-period scores derived at ingest:
  //   { firstHalf: { home, away }, secondHalf: { home, away } }       (api-football M1.11)
  //   { halftime:  { home, away }, fulltime:  { home, away } }        (legacy FS / direct passthrough)
  // We tolerate either shape.
  period_scores?: Record<string, unknown> | null;
  // Optional `live_data` JSONB payload — may be null, may be missing keys.
  live_data?: Record<string, unknown> | null;
}

export interface AFTeamStats {
  shots?: number;
  shots_on_target?: number;
  corners?: number;
  offsides?: number;
  fouls?: number;
  cards_yellow?: number;
  cards_red?: number;
  cards_total?: number;
  goalkeeper_saves?: number;
}

export interface AFResult {
  // Score-derived (from events_v2 columns + period_scores).
  home: number;
  away: number;
  ht_home: number | null;
  ht_away: number | null;
  // Bucket B stats per team (from live_data.statistics_af).
  home_stats: AFTeamStats;
  away_stats: AFTeamStats;
  // Convenience flat aliases for Bucket B settlers that take per-team
  // totals rather than a structured per-team object. Only populated when
  // the underlying per-team stat is present.
  shots_home?: number;
  shots_away?: number;
  sot_home?: number;
  sot_away?: number;
  corners_home?: number;
  corners_away?: number;
  cards_home?: number;
  cards_away?: number;
  offsides_home?: number;
  offsides_away?: number;
  fouls_home?: number;
  fouls_away?: number;
  gk_saves_home?: number;
  gk_saves_away?: number;
  // Player-level pass-through for Bucket C settlers.
  players_af_ft?: unknown;
  events_af?: unknown;
}

// ════════════════════════════════════════════════════════════════════
// Internal helpers
// ════════════════════════════════════════════════════════════════════

interface AFStatEntry {
  type?: unknown;
  value?: unknown;
}

interface AFTeamStatsRaw {
  team?: { id?: unknown; name?: unknown } | null;
  statistics?: AFStatEntry[] | null;
}

/**
 * Coerce an api-football stat `value` to a finite number, or null.
 * api-football returns mixed types: integers, percentage strings ("88%"),
 * occasionally null. We accept only `typeof value === 'number'` AND finite;
 * percentage strings and other strings are dropped (not useful for settlement).
 */
function coerceNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function normTeamName(s: unknown): string {
  return typeof s === "string" ? s.trim().toLowerCase() : "";
}

/**
 * Apply a single api-football `{ type, value }` entry to an `AFTeamStats`
 * accumulator. Unknown `type` strings are ignored (forward-compatible with
 * api-football adding new stat kinds).
 */
function applyStatEntry(acc: AFTeamStats, entry: AFStatEntry): void {
  const type = typeof entry?.type === "string" ? entry.type : "";
  const v = coerceNumeric(entry?.value);
  if (v == null) return;

  switch (type) {
    case "Total Shots":
      acc.shots = v;
      return;
    case "Shots on Goal":
      acc.shots_on_target = v;
      return;
    case "Corner Kicks":
      acc.corners = v;
      return;
    case "Offsides":
      acc.offsides = v;
      return;
    case "Fouls":
      acc.fouls = v;
      return;
    case "Yellow Cards":
      acc.cards_yellow = v;
      return;
    case "Red Cards":
      acc.cards_red = v;
      return;
    case "Goalkeeper Saves":
      acc.goalkeeper_saves = v;
      return;
    default:
      // "Shots off Goal", "Blocked Shots", "Shots insidebox",
      // "Shots outsidebox", "Ball Possession", "Total passes",
      // "Passes accurate", "Passes %", etc — not settlement-relevant for
      // current Bucket B markets. Forward-compatible no-op.
      return;
  }
}

/**
 * Build per-team stats from a single api-football `statistics` array.
 * Sets `cards_total = cards_yellow + cards_red` (with red counted ONCE —
 * the convention in our settlers is 1 red = 1 card unit, not 2).
 */
function buildTeamStats(raw: AFStatEntry[] | null | undefined): AFTeamStats {
  const acc: AFTeamStats = {};
  if (!Array.isArray(raw)) return acc;
  for (const entry of raw) {
    if (entry && typeof entry === "object") applyStatEntry(acc, entry);
  }
  if (acc.cards_yellow != null || acc.cards_red != null) {
    acc.cards_total = (acc.cards_yellow ?? 0) + (acc.cards_red ?? 0);
  }
  return acc;
}

/**
 * Identify home/away indices within the 2-element statistics_af payload.
 *
 * Strategy (in order):
 *   1. Match `team.name` (case-insensitive trim) against event.home / event.away.
 *   2. Fallback to api-football positional convention: [0]=home, [1]=away.
 *
 * Returns `{ homeIdx, awayIdx }` referring to indices in `arr`. Indices
 * may equal each other (defensive) — callers tolerate a missing team by
 * yielding an empty AFTeamStats for that side.
 */
function identifyTeams(
  arr: AFTeamStatsRaw[],
  homeName: string | null | undefined,
  awayName: string | null | undefined
): { homeIdx: number; awayIdx: number } {
  const hN = normTeamName(homeName);
  const aN = normTeamName(awayName);

  let homeIdx = -1;
  let awayIdx = -1;

  for (let i = 0; i < arr.length; i++) {
    const tn = normTeamName(arr[i]?.team?.name);
    if (tn && hN && tn === hN && homeIdx === -1) homeIdx = i;
    else if (tn && aN && tn === aN && awayIdx === -1) awayIdx = i;
  }

  // Positional fallback when one or both team names didn't match.
  if (homeIdx === -1) homeIdx = awayIdx === 0 ? 1 : 0;
  if (awayIdx === -1) awayIdx = homeIdx === 1 ? 0 : 1;
  return { homeIdx, awayIdx };
}

/**
 * Extract `{home, away}` from a `period_scores` JSONB under either of the
 * supported keys. Returns `null` when neither shape produces both numbers.
 */
function extractHalftime(
  ps: Record<string, unknown> | null | undefined
): { home: number; away: number } | null {
  if (!ps || typeof ps !== "object") return null;
  // Preferred: api-football M1.11 shape — `{firstHalf, secondHalf}`.
  // (firstHalf.home is the HT goal count for the home team — it's a
  // per-half delta but since the first half starts 0-0 the delta IS the
  // HT score.)
  const fh = (ps as Record<string, unknown>).firstHalf as
    | Record<string, unknown>
    | undefined;
  if (
    fh &&
    typeof fh === "object" &&
    typeof fh.home === "number" &&
    typeof fh.away === "number"
  ) {
    return { home: fh.home, away: fh.away };
  }
  // Legacy / passthrough: `{halftime, fulltime}` shape.
  const ht = (ps as Record<string, unknown>).halftime as
    | Record<string, unknown>
    | undefined;
  if (
    ht &&
    typeof ht === "object" &&
    typeof ht.home === "number" &&
    typeof ht.away === "number"
  ) {
    return { home: ht.home, away: ht.away };
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════
// Public API
// ════════════════════════════════════════════════════════════════════

export function buildResultFromAF(event: EventForSettlement): AFResult {
  // --- Score-derived ---------------------------------------------------
  const home = typeof event.score_home === "number" ? event.score_home : 0;
  const away = typeof event.score_away === "number" ? event.score_away : 0;

  const ht = extractHalftime(event.period_scores);
  const ht_home = ht ? ht.home : null;
  const ht_away = ht ? ht.away : null;

  // --- Bucket B stats from live_data.statistics_af ---------------------
  const liveData = (event.live_data ?? {}) as Record<string, unknown>;
  const rawStats = liveData.statistics_af;

  let home_stats: AFTeamStats = {};
  let away_stats: AFTeamStats = {};

  if (Array.isArray(rawStats) && rawStats.length > 0) {
    const arr = rawStats as AFTeamStatsRaw[];
    const { homeIdx, awayIdx } = identifyTeams(arr, event.home, event.away);
    // arr.length === 1 (partial payload): identifyTeams may yield indices
    // pointing at the same slot — but the missing-team slot yields {} so
    // downstream Bucket B settlers naturally skip those markets.
    if (homeIdx >= 0 && homeIdx < arr.length) {
      home_stats = buildTeamStats(arr[homeIdx]?.statistics);
    }
    if (awayIdx >= 0 && awayIdx < arr.length && awayIdx !== homeIdx) {
      away_stats = buildTeamStats(arr[awayIdx]?.statistics);
    }
  }

  // --- Build the AFResult ---------------------------------------------
  const result: AFResult = {
    home,
    away,
    ht_home,
    ht_away,
    home_stats,
    away_stats,
  };

  // Flat aliases — only assigned when the underlying field is defined,
  // so callers can use `?? null` to detect "no data" vs "zero observed".
  if (home_stats.shots != null) result.shots_home = home_stats.shots;
  if (away_stats.shots != null) result.shots_away = away_stats.shots;
  if (home_stats.shots_on_target != null) result.sot_home = home_stats.shots_on_target;
  if (away_stats.shots_on_target != null) result.sot_away = away_stats.shots_on_target;
  if (home_stats.corners != null) result.corners_home = home_stats.corners;
  if (away_stats.corners != null) result.corners_away = away_stats.corners;
  if (home_stats.cards_total != null) result.cards_home = home_stats.cards_total;
  if (away_stats.cards_total != null) result.cards_away = away_stats.cards_total;
  if (home_stats.offsides != null) result.offsides_home = home_stats.offsides;
  if (away_stats.offsides != null) result.offsides_away = away_stats.offsides;
  if (home_stats.fouls != null) result.fouls_home = home_stats.fouls;
  if (away_stats.fouls != null) result.fouls_away = away_stats.fouls;
  if (home_stats.goalkeeper_saves != null) result.gk_saves_home = home_stats.goalkeeper_saves;
  if (away_stats.goalkeeper_saves != null) result.gk_saves_away = away_stats.goalkeeper_saves;

  // --- Bucket C pass-through ------------------------------------------
  if (liveData.players_af_ft !== undefined) result.players_af_ft = liveData.players_af_ft;
  if (liveData.events_af !== undefined) result.events_af = liveData.events_af;

  return result;
}
