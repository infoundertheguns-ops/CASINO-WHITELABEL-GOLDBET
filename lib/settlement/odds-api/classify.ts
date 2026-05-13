// Plan D Phase 2 — pure shadow settlement classifiers.
//
// Given a bet leg (market_type, outcome_name, line) and a score result
// (home, away, ht_home, ht_away, plus optional stats + scorers), return
// a verdict: 'won' | 'lost' | 'void' | null.
//
// null = engine cannot classify (market_type unsupported OR required stat
// data missing). Caller writes settlement_log_shadow source_used accordingly.
//
// Pure functions ONLY. No DB access. Tested via fixture in tests/lib/...

export type Verdict = "won" | "lost" | "void" | "half_won" | "half_lost";

export interface Scorer {
  name: string;
  team?: "home" | "away";
  minute?: number | null;
}

export interface ScoreResult {
  home: number;
  away: number;
  ht_home?: number | null;
  ht_away?: number | null;
  // Stats (optional — null/undefined when source feed doesn't include)
  corners_home?: number | null;
  corners_away?: number | null;
  ht_corners_home?: number | null;
  ht_corners_away?: number | null;
  cards_home?: number | null;
  cards_away?: number | null;
  shots_home?: number | null;
  shots_away?: number | null;
  shots_on_target_home?: number | null;
  shots_on_target_away?: number | null;
  gk_saves_home?: number | null;
  gk_saves_away?: number | null;
  // Player markets — ordered list of goal scorers (chronological)
  scorers?: Scorer[];
  // Player markets — assists provided (parallel to scorers, optional)
  assists?: Scorer[];
  // Player shots — per-player shot counts (optional; null/empty when source feed doesn't include)
  player_shots?: Array<{ name: string; shots: number }>;
  // Per-period scores (array indexed by period: 0 = 1st half / 1st set / Q1).
  // Populated by settle-leg.ts buildScores() from events_v2.live_data when present.
  // null/undefined when source data is missing — branches must guard with explicit check.
  period_scores_home?: number[] | null;
  period_scores_away?: number[] | null;
  // Sport hint to drive sport-aware extraction logic in buildScores.
  // Not consumed by classify branches today but reserved for future sport-specific aliases.
  sport_slug?: string | null;
}

export interface BetLeg {
  market_type: string;
  outcome_name: string;
  line: number | null;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

// Strip Italian title-case + diacritics for player-name matching
function normName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // strip combining marks
}

// ═══════════════════════════════════════════════════
// Score-based settlers (1X2 family)
// ═══════════════════════════════════════════════════

function settle1X2(home: number, away: number, outcome: string): Verdict {
  const o = norm(outcome);
  if (o === "1" || o === "home" || o === "casa") return home > away ? "won" : "lost";
  if (o === "x" || o === "draw" || o === "pareggio") return home === away ? "won" : "lost";
  if (o === "2" || o === "away" || o === "trasferta") return away > home ? "won" : "lost";
  return "void";
}

function settleOU(total: number, line: number | null, outcome: string): Verdict | null {
  if (line == null) return null;
  const o = norm(outcome);
  if (o === "over" || o === "o" || o === "più di") {
    if (total > line) return "won";
    if (total < line) return "lost";
    return "void";
  }
  if (o === "under" || o === "u" || o === "meno di") {
    if (total < line) return "won";
    if (total > line) return "lost";
    return "void";
  }
  return null;
}

function settleBTTS(home: number, away: number, outcome: string): Verdict {
  const o = norm(outcome);
  const both = home > 0 && away > 0;
  if (o === "yes" || o === "si" || o === "gg" || o === "goal") return both ? "won" : "lost";
  if (o === "no" || o === "ng" || o === "nogoal") return both ? "lost" : "won";
  return "void";
}

function settleDC(home: number, away: number, outcome: string): Verdict {
  const o = norm(outcome);
  const draw = home === away;
  const homeWin = home > away;
  const awayWin = away > home;
  if (o === "1x" || o === "home_or_draw") return homeWin || draw ? "won" : "lost";
  if (o === "x2" || o === "away_or_draw") return awayWin || draw ? "won" : "lost";
  if (o === "12" || o === "home_or_away") return homeWin || awayWin ? "won" : "lost";
  return "void";
}

function settleDNB(home: number, away: number, outcome: string): Verdict {
  const o = norm(outcome);
  if (home === away) return "void";
  if (o === "1" || o === "home") return home > away ? "won" : "lost";
  if (o === "2" || o === "away") return away > home ? "won" : "lost";
  return "void";
}

function settleHTFT(
  ht_home: number, ht_away: number,
  ft_home: number, ft_away: number,
  outcome: string
): Verdict {
  const ht1x2 = ht_home > ht_away ? "1" : ht_home < ht_away ? "2" : "x";
  const ft1x2 = ft_home > ft_away ? "1" : ft_home < ft_away ? "2" : "x";
  const parts = norm(outcome).split(/[\/\-\s]+/).filter(Boolean);
  if (parts.length !== 2) return "void";
  const expHT = mapHTFTPart(parts[0]);
  const expFT = mapHTFTPart(parts[1]);
  if (expHT == null || expFT == null) return "void";
  return (expHT === ht1x2 && expFT === ft1x2) ? "won" : "lost";
}

function mapHTFTPart(p: string): "1" | "x" | "2" | null {
  if (p === "1" || p === "home" || p === "casa") return "1";
  if (p === "x" || p === "draw" || p === "pareggio") return "x";
  if (p === "2" || p === "away" || p === "trasferta") return "2";
  return null;
}

function settleCorrectScore(home: number, away: number, outcome: string): Verdict {
  const m = norm(outcome).match(/^(\d+)\s*[-:x]\s*(\d+)$/);
  if (!m) return "void";
  const expHome = parseInt(m[1], 10);
  const expAway = parseInt(m[2], 10);
  if (!Number.isFinite(expHome) || !Number.isFinite(expAway)) return "void";
  return (home === expHome && away === expAway) ? "won" : "lost";
}

function settleOddEven(total: number, outcome: string): Verdict {
  const o = norm(outcome);
  const isOdd = total % 2 === 1;
  if (o === "odd" || o === "dispari" || o === "d") return isOdd ? "won" : "lost";
  if (o === "even" || o === "pari" || o === "p") return isOdd ? "lost" : "won";
  return "void";
}

function settleHandicap2Way(
  home: number, away: number, line: number | null, outcome: string
): Verdict | null {
  if (line == null) return null;
  const frac = Math.abs(line) % 1;
  if (Math.abs(frac - 0.25) < 1e-9 || Math.abs(frac - 0.75) < 1e-9) return null;
  const o = norm(outcome);
  if (o === "1" || o === "home" || o === "casa") {
    const adj = home + line;
    if (adj > away) return "won";
    if (adj < away) return "lost";
    return "void";
  }
  if (o === "2" || o === "away" || o === "trasferta") {
    const adj = away + line;
    if (adj > home) return "won";
    if (adj < home) return "lost";
    return "void";
  }
  return null;
}

function settleEuropeanHandicap(
  home: number, away: number, line: number | null, outcome: string
): Verdict | null {
  if (line == null) return null;
  const adj_home = home + line;
  return settle1X2(adj_home, away, outcome);
}

function settleAsianHandicapQuarter(
  home: number,
  away: number,
  line: number | null,
  outcome: string,
): Verdict | null {
  if (line == null) return null;
  // Quarter detection: line * 4 must be an ODD integer.
  // Examples: -1.25 * 4 = -5 (odd); -1.5 * 4 = -6 (even, NOT quarter); -1 * 4 = -4 (even).
  const fourX = line * 4;
  const fourXRounded = Math.round(fourX);
  if (Math.abs(fourX - fourXRounded) > 1e-9) return null;
  if (fourXRounded % 2 === 0) return null;
  // Split into two adjacent half-step lines.
  const lower = Math.floor(line * 2) / 2; // e.g. -1.25 -> -1.5
  const upper = Math.ceil(line * 2) / 2;  // e.g. -1.25 -> -1.0
  const v1 = settleHandicap2Way(home, away, lower, outcome);
  const v2 = settleHandicap2Way(home, away, upper, outcome);
  if (v1 == null || v2 == null) return null;
  return combineSplitVerdicts(v1, v2);
}

function combineSplitVerdicts(a: Verdict, b: Verdict): Verdict {
  // Combines two half-stake Verdicts from adjacent half-step lines (.25/.75 split-bet).
  if (a === "won" && b === "won") return "won";
  if (a === "lost" && b === "lost") return "lost";
  if ((a === "won" && b === "void") || (a === "void" && b === "won")) return "half_won";
  if ((a === "lost" && b === "void") || (a === "void" && b === "lost")) return "half_lost";
  if (a === "void" && b === "void") return "void"; // defensive: shouldn't occur at .25/.75
  // Defensive fallback for impossible combos (won+lost on adjacent half-step lines).
  return "void";
}

function settleGoalLine(
  total: number,
  line: number | null,
  outcome: string,
): Verdict | null {
  if (line == null) return null;
  // Quarter detection: line * 4 must be an ODD integer.
  // Examples: 2.25 * 4 = 9 (odd); 2.5 * 4 = 10 (even, NOT quarter); 2 * 4 = 8 (even).
  const fourX = line * 4;
  const fourXRounded = Math.round(fourX);
  if (Math.abs(fourX - fourXRounded) > 1e-9) return null;
  if (fourXRounded % 2 === 0) return null;
  // Split into two adjacent half-step lines.
  const lower = Math.floor(line * 2) / 2; // e.g. 2.25 -> 2.0
  const upper = Math.ceil(line * 2) / 2;  // e.g. 2.25 -> 2.5
  const v1 = settleOU(total, lower, outcome);
  const v2 = settleOU(total, upper, outcome);
  if (v1 == null || v2 == null) return null;
  return combineSplitVerdicts(v1, v2);
}

// ═══════════════════════════════════════════════════
// Stat-based generic settlers (corners/cards/shots/etc.)
// ═══════════════════════════════════════════════════

function settleStatOU(
  stat_home: number | null | undefined,
  stat_away: number | null | undefined,
  line: number | null,
  outcome: string
): Verdict | null {
  if (stat_home == null || stat_away == null) return null;
  return settleOU(stat_home + stat_away, line, outcome);
}

function settleStat1X2(
  stat_home: number | null | undefined,
  stat_away: number | null | undefined,
  outcome: string
): Verdict | null {
  if (stat_home == null || stat_away == null) return null;
  return settle1X2(stat_home, stat_away, outcome);
}

function settleStatHandicap(
  stat_home: number | null | undefined,
  stat_away: number | null | undefined,
  line: number | null,
  outcome: string
): Verdict | null {
  if (stat_home == null || stat_away == null) return null;
  return settleHandicap2Way(stat_home, stat_away, line, outcome);
}

// ═══════════════════════════════════════════════════
// Player-based settlers (scorer markets)
// ═══════════════════════════════════════════════════

function settleAnytimeGoalscorer(
  scorers: Scorer[] | null | undefined,
  outcome: string
): Verdict | null {
  if (scorers == null) return null;
  const target = normName(outcome);
  const scored = scorers.some((s) => normName(s.name) === target);
  return scored ? "won" : "lost";
}

function settleFirstGoalscorer(
  scorers: Scorer[] | null | undefined,
  outcome: string
): Verdict | null {
  if (scorers == null) return null;
  if (scorers.length === 0) return "void"; // 0-0 game refund
  const target = normName(outcome);
  return normName(scorers[0].name) === target ? "won" : "lost";
}

function settleLastGoalscorer(
  scorers: Scorer[] | null | undefined,
  outcome: string
): Verdict | null {
  if (scorers == null) return null;
  if (scorers.length === 0) return "void";
  const target = normName(outcome);
  return normName(scorers[scorers.length - 1].name) === target ? "won" : "lost";
}

function settleAnytimeGoalscorerOrAssist(
  scorers: Scorer[] | null | undefined,
  assists: Scorer[] | null | undefined,
  outcome: string,
  totalGoals: number
): Verdict | null {
  // Both data sources missing → cannot classify
  if (scorers == null && assists == null) return null;
  // 0-0 game → no goals, no assists → refund void
  if (totalGoals === 0) return "void";
  const target = normName(outcome);
  const matchScorer = (scorers ?? []).some((s) => normName(s.name) === target);
  const matchAssist = (assists ?? []).some((a) => normName(a.name) === target);
  return matchScorer || matchAssist ? "won" : "lost";
}

function settleMultiScorers(
  scorers: Scorer[] | null | undefined,
  outcome: string,
): { verdict: Verdict | null; reason?: string } {
  if (scorers == null) return { verdict: null, reason: "scorers_missing" };
  // Parse outcome into multiple player names. Separators: & , + and " and "
  const rawNames = outcome.split(/\s*[&,+]\s*|\s+and\s+/i).map((s) => s.trim()).filter(Boolean);
  if (rawNames.length < 2) return { verdict: null, reason: "single_name_use_anytime" };
  const targetNames = rawNames.map((n) => normName(n));
  const scorerSet = new Set((scorers ?? []).map((s) => normName(s.name)));
  const allMatched = targetNames.every((t) => scorerSet.has(t));
  return { verdict: allMatched ? "won" : "lost" };
}

function settlePlayerShots(
  player_shots: Array<{ name: string; shots: number }> | undefined,
  outcome: string,
  line: number | null,
  side: "over" | "under",
): Verdict | null {
  if (!player_shots) return null;
  if (line == null) return null;
  const target = normName(outcome);
  const found = player_shots.find((p) => normName(p.name) === target);
  if (!found) return null; // player not in feed → cannot classify
  if (found.shots === line) return "void";
  if (side === "over") {
    return found.shots > line ? "won" : "lost";
  }
  return found.shots < line ? "won" : "lost";
}

function settleFirstTeamToScore(
  scorers: Scorer[] | null | undefined,
  totalGoals: number,
  outcome: string,
): { verdict: Verdict | null; reason?: string } {
  if (scorers == null) return { verdict: null, reason: "scorers_missing" };
  const o = norm(outcome);
  // 0-0 game: no team scored.
  if (scorers.length === 0 || totalGoals === 0) {
    if (o === "none" || o === "nessuna" || o === "no goal") return { verdict: "won" };
    if (
      o === "home" || o === "casa" || o === "1" ||
      o === "away" || o === "trasferta" || o === "2"
    ) {
      return { verdict: "void" }; // refund
    }
    return { verdict: null, reason: "unknown_outcome" };
  }
  const firstTeam = scorers[0].team;
  if (firstTeam == null) return { verdict: null, reason: "first_scorer_team_missing" };
  if (o === "home" || o === "casa" || o === "1") return { verdict: firstTeam === "home" ? "won" : "lost" };
  if (o === "away" || o === "trasferta" || o === "2") return { verdict: firstTeam === "away" ? "won" : "lost" };
  if (o === "none" || o === "nessuna" || o === "no goal") return { verdict: "lost" };
  return { verdict: null, reason: "unknown_outcome" };
}

// ═══════════════════════════════════════════════════
// Per-period extraction helpers (tennis sets, basket quarters, etc.)
// ═══════════════════════════════════════════════════

function getPeriodScores(
  result: ScoreResult,
  periodIdx: number,
): [number | null, number | null] {
  const h = result.period_scores_home?.[periodIdx];
  const a = result.period_scores_away?.[periodIdx];
  return [h ?? null, a ?? null];
}

function getTotalGames(result: ScoreResult): [number | null, number | null] {
  const h = result.period_scores_home;
  const a = result.period_scores_away;
  if (!h || !a || h.length === 0 || a.length === 0) return [null, null];
  return [h.reduce((s, x) => s + x, 0), a.reduce((s, x) => s + x, 0)];
}

// ═══════════════════════════════════════════════════
// Market-type dispatcher
// ═══════════════════════════════════════════════════

export function classifyLeg(leg: BetLeg, result: ScoreResult): { verdict: Verdict | null; reason?: string } {
  const mt = norm(leg.market_type);
  const total = result.home + result.away;
  const ht_home = result.ht_home ?? null;
  const ht_away = result.ht_away ?? null;
  const ht_total = ht_home != null && ht_away != null ? ht_home + ht_away : null;

  // ─── 1X2 family ───
  if (
    mt === "1x2" || mt === "vincente incontro" || mt === "ml" || mt === "tempo regolamentare" ||
    mt === "3-way result" || mt === "3 way result"
  ) {
    return { verdict: settle1X2(result.home, result.away, leg.outcome_name) };
  }
  if (mt === "1x2 - 1t" || mt === "1x2 1° tempo" || mt === "half time result") {
    if (ht_home == null || ht_away == null) return { verdict: null, reason: "ht_scores_missing" };
    return { verdict: settle1X2(ht_home, ht_away, leg.outcome_name) };
  }
  if (mt === "1x2 - 2t" || mt === "1x2 2° tempo" || mt === "ml 2h" || mt === "second half result") {
    if (ht_home == null || ht_away == null) return { verdict: null, reason: "ht_scores_missing" };
    return { verdict: settle1X2(result.home - ht_home, result.away - ht_away, leg.outcome_name) };
  }

  // ─── Per-set / per-period 1X2 ───
  if (mt === "ml 1st set") {
    const [h, a] = getPeriodScores(result, 0);
    if (h == null || a == null) return { verdict: null, reason: "set1_missing" };
    return { verdict: settle1X2(h, a, leg.outcome_name) };
  }
  if (mt === "ml 2nd set") {
    const [h, a] = getPeriodScores(result, 1);
    if (h == null || a == null) return { verdict: null, reason: "set2_missing" };
    return { verdict: settle1X2(h, a, leg.outcome_name) };
  }
  if (mt === "totals 1st set") {
    const [h, a] = getPeriodScores(result, 0);
    if (h == null || a == null) return { verdict: null, reason: "set1_missing" };
    return { verdict: settleOU(h + a, leg.line, leg.outcome_name) };
  }

  // ─── Tennis Totals (Games) / Spread (Games) — sum across all sets ───
  if (mt === "totals (games)" || mt === "totale giochi") {
    const [h, a] = getTotalGames(result);
    if (h == null || a == null) return { verdict: null, reason: "period_scores_missing" };
    return { verdict: settleOU(h + a, leg.line, leg.outcome_name) };
  }
  if (mt === "spread (games)" || mt === "spread giochi") {
    const [h, a] = getTotalGames(result);
    if (h == null || a == null) return { verdict: null, reason: "period_scores_missing" };
    return { verdict: settleHandicap2Way(h, a, leg.line, leg.outcome_name) };
  }

  // ─── Set Betting (tennis correct-score on sets won).
  // Tennis-specific: result.home/away are sets won (per spec §2 data model),
  // so settleCorrectScore treats outcome "2-0" as "home 2 sets, away 0 sets".
  if (mt === "set betting") {
    return { verdict: settleCorrectScore(result.home, result.away, leg.outcome_name) };
  }

  // ─── Basket Totals 1Q ───
  if (mt === "totals 1q" || mt === "totale 1q") {
    const [h, a] = getPeriodScores(result, 0);
    if (h == null || a == null) return { verdict: null, reason: "q1_missing" };
    return { verdict: settleOU(h + a, leg.line, leg.outcome_name) };
  }

  // ─── 3-Way Result HT (basket/handball 1X2 on first period) ───
  if (mt === "3-way result ht" || mt === "3 way result ht") {
    const [h, a] = getPeriodScores(result, 0);
    if (h == null || a == null) return { verdict: null, reason: "ht_scores_missing" };
    return { verdict: settle1X2(h, a, leg.outcome_name) };
  }

  // ─── Goal Line (Asian total) ───
  if (mt === "goal line" || mt === "goalline" || mt === "asian total" || mt === "asian totals") {
    // Try quarter-line split first (.25/.75); fall through to standard OU for integer/half lines.
    const vq = settleGoalLine(total, leg.line, leg.outcome_name);
    if (vq != null) return { verdict: vq };
    return { verdict: settleOU(total, leg.line, leg.outcome_name) };
  }

  // ─── U/O Goals family ───
  if (mt === "u/o" || mt === "totals" || mt === "goals over/under") {
    return { verdict: settleOU(total, leg.line, leg.outcome_name) };
  }
  if (mt === "u/o - 1t" || mt === "totals ht" || mt === "totals 1h") {
    if (ht_total == null) return { verdict: null, reason: "ht_scores_missing" };
    return { verdict: settleOU(ht_total, leg.line, leg.outcome_name) };
  }
  if (mt === "u/o - 2t" || mt === "totals 2h") {
    if (ht_home == null || ht_away == null) return { verdict: null, reason: "ht_scores_missing" };
    return { verdict: settleOU(total - (ht_home + ht_away), leg.line, leg.outcome_name) };
  }

  // ─── Team Total (single-team over/under) ───
  if (mt === "team total home" || mt === "team total goals home") {
    return { verdict: settleOU(result.home, leg.line, leg.outcome_name) };
  }
  if (mt === "team total away" || mt === "team total goals away") {
    return { verdict: settleOU(result.away, leg.line, leg.outcome_name) };
  }

  // ─── BTTS ───
  if (mt === "gg/ng" || mt === "both teams to score") {
    return { verdict: settleBTTS(result.home, result.away, leg.outcome_name) };
  }
  if (mt === "gg/ng - 2t" || mt === "both teams to score 2h") {
    if (ht_home == null || ht_away == null) return { verdict: null, reason: "ht_scores_missing" };
    return { verdict: settleBTTS(result.home - ht_home, result.away - ht_away, leg.outcome_name) };
  }

  // ─── Double Chance / DNB ───
  if (mt === "dc" || mt === "double chance") {
    return { verdict: settleDC(result.home, result.away, leg.outcome_name) };
  }
  if (mt === "dnb" || mt === "draw no bet") {
    return { verdict: settleDNB(result.home, result.away, leg.outcome_name) };
  }

  // ─── HT/FT ───
  if (mt === "1t/finale" || mt === "half time / full time" || mt === "ht/ft") {
    if (ht_home == null || ht_away == null) return { verdict: null, reason: "ht_scores_missing" };
    return { verdict: settleHTFT(ht_home, ht_away, result.home, result.away, leg.outcome_name) };
  }

  // ─── Correct Score / Odd-Even ───
  if (mt === "risultato esatto" || mt === "correct score") {
    return { verdict: settleCorrectScore(result.home, result.away, leg.outcome_name) };
  }
  if (mt === "p/d" || mt === "odd/even" || mt === "pari/dispari") {
    return { verdict: settleOddEven(total, leg.outcome_name) };
  }

  // ─── Handicap (Spread) ───
  if (mt === "handicap" || mt === "spread") {
    return { verdict: settleHandicap2Way(result.home, result.away, leg.line, leg.outcome_name) };
  }
  if (mt === "handicap - 1t" || mt === "spread ht" || mt === "1st half handicap") {
    if (ht_home == null || ht_away == null) return { verdict: null, reason: "ht_scores_missing" };
    return { verdict: settleHandicap2Way(ht_home, ht_away, leg.line, leg.outcome_name) };
  }
  if (mt === "handicap - 2t" || mt === "spread 2h") {
    if (ht_home == null || ht_away == null) return { verdict: null, reason: "ht_scores_missing" };
    return { verdict: settleHandicap2Way(result.home - ht_home, result.away - ht_away, leg.line, leg.outcome_name) };
  }
  if (mt === "asian handicap" || mt === "handicap asiatico") {
    // Try quarter-line split first (.25/.75); fall through to standard 2-way for integer/half lines.
    const vq = settleAsianHandicapQuarter(result.home, result.away, leg.line, leg.outcome_name);
    if (vq != null) return { verdict: vq };
    return { verdict: settleHandicap2Way(result.home, result.away, leg.line, leg.outcome_name) };
  }
  if (mt === "european handicap") {
    return { verdict: settleEuropeanHandicap(result.home, result.away, leg.line, leg.outcome_name) };
  }

  // ─── Corners family ───
  if (mt === "totale angoli" || mt === "corners totals" || mt === "total corners") {
    const v = settleStatOU(result.corners_home, result.corners_away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "stats_missing_or_invalid_outcome" : undefined };
  }
  if (mt === "totale angoli - 1t" || mt === "corners totals ht") {
    const v = settleStatOU(result.ht_corners_home, result.ht_corners_away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "stats_missing_or_invalid_outcome" : undefined };
  }
  if (mt === "angoli" || mt === "corners 3-way") {
    const v = settleStat1X2(result.corners_home, result.corners_away, leg.outcome_name);
    return { verdict: v, reason: v == null ? "stats_missing" : undefined };
  }
  if (mt === "angoli 2-way" || mt === "corners 2-way") {
    if (result.corners_home == null || result.corners_away == null) return { verdict: null, reason: "stats_missing" };
    if (result.corners_home === result.corners_away) return { verdict: "void" };
    return { verdict: settleStat1X2(result.corners_home, result.corners_away, leg.outcome_name) };
  }
  if (mt === "handicap angoli" || mt === "corners spread" || mt === "corners handicap") {
    const v = settleStatHandicap(result.corners_home, result.corners_away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "stats_missing_or_quarter_line" : undefined };
  }

  // ─── Corners Totals per-team ───
  if (mt === "corners totals home" || mt === "totale angoli casa") {
    if (result.corners_home == null) return { verdict: null, reason: "corners_home_missing" };
    return { verdict: settleOU(result.corners_home, leg.line, leg.outcome_name) };
  }
  if (mt === "corners totals away" || mt === "totale angoli trasferta") {
    if (result.corners_away == null) return { verdict: null, reason: "corners_away_missing" };
    return { verdict: settleOU(result.corners_away, leg.line, leg.outcome_name) };
  }

  // ─── Cards (cartellini) — only over/under supported (most common market) ───
  if (mt === "totale cartellini" || mt === "cards totals" || mt === "total cards") {
    const v = settleStatOU(result.cards_home, result.cards_away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "stats_missing_or_invalid_outcome" : undefined };
  }

  // ─── Shots — over/under ───
  if (mt === "totale tiri" || mt === "total shots" || mt === "shots totals") {
    const v = settleStatOU(result.shots_home, result.shots_away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "stats_missing_or_invalid_outcome" : undefined };
  }
  if (mt === "totale tiri in porta" || mt === "shots on target totals" || mt === "total shots on target") {
    const v = settleStatOU(result.shots_on_target_home, result.shots_on_target_away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "stats_missing_or_invalid_outcome" : undefined };
  }
  if (mt === "totale parate" || mt === "totale parate portiere" || mt === "goalkeeper saves total" || mt === "goalkeeper saves totals") {
    const v = settleStatOU(result.gk_saves_home, result.gk_saves_away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "stats_missing_or_invalid_outcome" : undefined };
  }

  // ─── Player markets ───
  if (mt === "marcatore" || mt === "anytime goalscorer") {
    const v = settleAnytimeGoalscorer(result.scorers, leg.outcome_name);
    return { verdict: v, reason: v == null ? "scorers_missing" : undefined };
  }
  if (mt === "primo marcatore" || mt === "first goalscorer") {
    const v = settleFirstGoalscorer(result.scorers, leg.outcome_name);
    return { verdict: v, reason: v == null ? "scorers_missing" : undefined };
  }
  if (mt === "ultimo marcatore" || mt === "last goalscorer") {
    const v = settleLastGoalscorer(result.scorers, leg.outcome_name);
    return { verdict: v, reason: v == null ? "scorers_missing" : undefined };
  }
  if (mt === "marca o assist" || mt === "anytime goalscorer or assist" || mt === "marcatore o assist") {
    const v = settleAnytimeGoalscorerOrAssist(result.scorers, result.assists, leg.outcome_name, result.home + result.away);
    return { verdict: v, reason: v == null ? "scorers_and_assists_missing" : undefined };
  }
  if (mt === "più marcatori" || mt === "piu marcatori" || mt === "multi scorers" || mt === "both players to score") {
    return settleMultiScorers(result.scorers, leg.outcome_name);
  }
  if (mt === "tiri giocatore over" || mt === "player shots over" || mt === "tiri giocatore - over") {
    const v = settlePlayerShots(result.player_shots, leg.outcome_name, leg.line, "over");
    return { verdict: v, reason: v == null ? "player_shots_missing" : undefined };
  }
  if (mt === "tiri giocatore under" || mt === "player shots under" || mt === "tiri giocatore - under") {
    const v = settlePlayerShots(result.player_shots, leg.outcome_name, leg.line, "under");
    return { verdict: v, reason: v == null ? "player_shots_missing" : undefined };
  }

  // ─── First Team To Score ───
  if (mt === "first team to score" || mt === "prima squadra a segnare") {
    return settleFirstTeamToScore(result.scorers, result.home + result.away, leg.outcome_name);
  }

  // Unsupported
  return { verdict: null, reason: "unsupported_market_type" };
}

export function describeLeg(leg: BetLeg): string {
  const line = leg.line != null ? ` ${leg.line}` : "";
  return `${leg.market_type}${line} → ${leg.outcome_name}`;
}
