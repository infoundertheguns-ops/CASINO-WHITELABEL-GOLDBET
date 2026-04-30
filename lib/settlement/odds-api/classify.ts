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

export type Verdict = "won" | "lost" | "void";

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
  // Player markets — ordered list of goal scorers (chronological)
  scorers?: Scorer[];
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
  if (mt === "1x2" || mt === "vincente incontro" || mt === "ml" || mt === "tempo regolamentare") {
    return { verdict: settle1X2(result.home, result.away, leg.outcome_name) };
  }
  if (mt === "1x2 - 1t" || mt === "1x2 1° tempo" || mt === "half time result") {
    if (ht_home == null || ht_away == null) return { verdict: null, reason: "ht_scores_missing" };
    return { verdict: settle1X2(ht_home, ht_away, leg.outcome_name) };
  }
  if (mt === "1x2 - 2t" || mt === "1x2 2° tempo") {
    if (ht_home == null || ht_away == null) return { verdict: null, reason: "ht_scores_missing" };
    return { verdict: settle1X2(result.home - ht_home, result.away - ht_away, leg.outcome_name) };
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

  // Unsupported
  return { verdict: null, reason: "unsupported_market_type" };
}

export function describeLeg(leg: BetLeg): string {
  const line = leg.line != null ? ` ${leg.line}` : "";
  return `${leg.market_type}${line} → ${leg.outcome_name}`;
}
