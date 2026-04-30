// Plan D Phase 2 — pure shadow settlement classifiers.
//
// Given a bet leg (market_type, outcome_name, line) and a score result
// (home, away, ht_home, ht_away), return a verdict: 'won' | 'lost' | 'void' | null.
//
// null = engine cannot classify (e.g. market_type not yet supported by shadow).
// Caller writes to settlement_log_shadow with source_used='unsupported_market'.
//
// Pure functions ONLY. No DB access. Tested via unit tests in tests/unit/shadow-classify.test.ts.

export type Verdict = "won" | "lost" | "void";

export interface ScoreResult {
  home: number;
  away: number;
  ht_home?: number | null;
  ht_away?: number | null;
}

export interface BetLeg {
  market_type: string;
  outcome_name: string;
  line: number | null;
}

// Normalise: lowercase + strip half-time suffix patterns for fast-path matching
function norm(s: string): string {
  return s.trim().toLowerCase();
}

// ═══════════════════════════════════════════════════
// Settler functions — return Verdict | null
// ═══════════════════════════════════════════════════

function settle1X2(home: number, away: number, outcome: string): Verdict {
  const o = norm(outcome);
  // Italian "1" / "X" / "2" or English "Home" / "Draw" / "Away"
  if (o === "1" || o === "home" || o === "casa") {
    return home > away ? "won" : "lost";
  }
  if (o === "x" || o === "draw" || o === "pareggio") {
    return home === away ? "won" : "lost";
  }
  if (o === "2" || o === "away" || o === "trasferta") {
    return away > home ? "won" : "lost";
  }
  // Unknown outcome name — caller treats as null
  return "void";
}

function settleOU(total: number, line: number | null, outcome: string): Verdict | null {
  if (line == null) return null;
  const o = norm(outcome);
  // .5 lines → no push possible
  // .0 lines → push (refund) when total === line
  if (o === "over" || o === "o" || o === "più di") {
    if (total > line) return "won";
    if (total < line) return "lost";
    return "void"; // push
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
  if (home === away) return "void"; // refund on draw
  if (o === "1" || o === "home") return home > away ? "won" : "lost";
  if (o === "2" || o === "away") return away > home ? "won" : "lost";
  return "void";
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
    if (ht_home == null || ht_away == null) {
      return { verdict: null, reason: "ht_scores_missing" };
    }
    return { verdict: settle1X2(ht_home, ht_away, leg.outcome_name) };
  }
  if (mt === "1x2 - 2t" || mt === "1x2 2° tempo") {
    if (ht_home == null || ht_away == null) {
      return { verdict: null, reason: "ht_scores_missing" };
    }
    const sh_home = result.home - ht_home;
    const sh_away = result.away - ht_away;
    return { verdict: settle1X2(sh_home, sh_away, leg.outcome_name) };
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
    const sh_total = total - (ht_home + ht_away);
    return { verdict: settleOU(sh_total, leg.line, leg.outcome_name) };
  }

  // ─── BTTS / GG/NG ───
  if (mt === "gg/ng" || mt === "both teams to score") {
    return { verdict: settleBTTS(result.home, result.away, leg.outcome_name) };
  }
  if (mt === "gg/ng - 2t" || mt === "both teams to score 2h") {
    if (ht_home == null || ht_away == null) return { verdict: null, reason: "ht_scores_missing" };
    const sh_home = result.home - ht_home;
    const sh_away = result.away - ht_away;
    return { verdict: settleBTTS(sh_home, sh_away, leg.outcome_name) };
  }

  // ─── Double Chance ───
  if (mt === "dc" || mt === "double chance") {
    return { verdict: settleDC(result.home, result.away, leg.outcome_name) };
  }

  // ─── Draw No Bet ───
  if (mt === "dnb" || mt === "draw no bet") {
    return { verdict: settleDNB(result.home, result.away, leg.outcome_name) };
  }

  // Unsupported — let caller log unsupported_market
  return { verdict: null, reason: "unsupported_market_type" };
}

// Friendly summary for logging
export function describeLeg(leg: BetLeg): string {
  const line = leg.line != null ? ` ${leg.line}` : "";
  return `${leg.market_type}${line} → ${leg.outcome_name}`;
}
