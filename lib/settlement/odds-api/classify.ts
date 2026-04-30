// Plan D Phase 2 — pure shadow settlement classifiers.
//
// Given a bet leg (market_type, outcome_name, line) and a score result
// (home, away, ht_home, ht_away), return a verdict: 'won' | 'lost' | 'void' | null.
//
// null = engine cannot classify (e.g. market_type not yet supported by shadow).
// Caller writes to settlement_log_shadow with source_used='unsupported_market'.
//
// Pure functions ONLY. No DB access. Tested via fixture in tests/lib/settlement/...

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
  return "void";
}

function settleOU(total: number, line: number | null, outcome: string): Verdict | null {
  if (line == null) return null;
  const o = norm(outcome);
  if (o === "over" || o === "o" || o === "più di") {
    if (total > line) return "won";
    if (total < line) return "lost";
    return "void"; // push (only on .0 lines)
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

// ─── HT/FT — Half Time / Full Time combined result
// Outcome format: "1/X", "X/2", "Home/Draw", "1-X", or fully spelled.
// Either half determined by 1X2 logic (home>away → "1", etc).
function settleHTFT(
  ht_home: number, ht_away: number,
  ft_home: number, ft_away: number,
  outcome: string
): Verdict {
  const ht1x2 = ht_home > ht_away ? "1" : ht_home < ht_away ? "2" : "x";
  const ft1x2 = ft_home > ft_away ? "1" : ft_home < ft_away ? "2" : "x";
  // Tokenize outcome: split on / or - or whitespace
  const parts = norm(outcome).split(/[\/\-\s]+/).filter(Boolean);
  if (parts.length !== 2) return "void";
  const expectedHT = mapHTFTPart(parts[0]);
  const expectedFT = mapHTFTPart(parts[1]);
  if (expectedHT == null || expectedFT == null) return "void";
  return (expectedHT === ht1x2 && expectedFT === ft1x2) ? "won" : "lost";
}

function mapHTFTPart(p: string): "1" | "x" | "2" | null {
  if (p === "1" || p === "home" || p === "casa") return "1";
  if (p === "x" || p === "draw" || p === "pareggio") return "x";
  if (p === "2" || p === "away" || p === "trasferta") return "2";
  return null;
}

// ─── Correct Score — outcome "2-1" or "2:1" → exact match
function settleCorrectScore(home: number, away: number, outcome: string): Verdict {
  const m = norm(outcome).match(/^(\d+)\s*[-:x]\s*(\d+)$/);
  if (!m) return "void";
  const expHome = parseInt(m[1], 10);
  const expAway = parseInt(m[2], 10);
  if (!Number.isFinite(expHome) || !Number.isFinite(expAway)) return "void";
  return (home === expHome && away === expAway) ? "won" : "lost";
}

// ─── Odd/Even — total parity
function settleOddEven(total: number, outcome: string): Verdict {
  const o = norm(outcome);
  const isOdd = total % 2 === 1;
  if (o === "odd" || o === "dispari" || o === "d") return isOdd ? "won" : "lost";
  if (o === "even" || o === "pari" || o === "p") return isOdd ? "lost" : "won";
  return "void";
}

// ─── Handicap 2-way (Spread) — outcome=1/home or 2/away with signed line
// Convention: line is the handicap APPLIED to the outcome side.
// outcome "1" line -1.5 → adjusted_home = home + (-1.5); home wins if adjusted > away
// outcome "2" line +0.5 → adjusted_away = away + 0.5; away wins if adjusted > home
// .0 lines push when adjusted == opponent (refund void).
// .5 lines never push.
// Quarter lines (.25/.75) NOT supported — return null.
function settleHandicap2Way(
  home: number, away: number, line: number | null, outcome: string
): Verdict | null {
  if (line == null) return null;
  // Quarter lines unsupported (Asian split)
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

// ─── European Handicap (3-way) — like 1X2 but with handicap applied to home.
// outcome 1/X/2 with line (e.g. -1, 0, +2). Adjusted scores: home + line vs away.
// .5 not used (would never push); typically .0 lines (-3, -2, -1, 0, +1, +2, +3).
function settleEuropeanHandicap(
  home: number, away: number, line: number | null, outcome: string
): Verdict | null {
  if (line == null) return null;
  const adj_home = home + line;
  return settle1X2(adj_home, away, outcome);
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

  // ─── HT/FT — Half Time / Full Time ───
  if (mt === "1t/finale" || mt === "half time / full time" || mt === "ht/ft") {
    if (ht_home == null || ht_away == null) return { verdict: null, reason: "ht_scores_missing" };
    return { verdict: settleHTFT(ht_home, ht_away, result.home, result.away, leg.outcome_name) };
  }

  // ─── Correct Score / Risultato Esatto ───
  if (mt === "risultato esatto" || mt === "correct score") {
    return { verdict: settleCorrectScore(result.home, result.away, leg.outcome_name) };
  }

  // ─── Odd/Even (P/D) ───
  if (mt === "p/d" || mt === "odd/even" || mt === "pari/dispari") {
    return { verdict: settleOddEven(total, leg.outcome_name) };
  }

  // ─── Handicap 2-way (Spread) ───
  // Translation produces "Handicap" (FT), "Handicap - 1T", "Handicap - 2T", "Handicap - 1Q"
  if (mt === "handicap" || mt === "spread") {
    return { verdict: settleHandicap2Way(result.home, result.away, leg.line, leg.outcome_name) };
  }
  if (mt === "handicap - 1t" || mt === "spread ht" || mt === "1st half handicap") {
    if (ht_home == null || ht_away == null) return { verdict: null, reason: "ht_scores_missing" };
    return { verdict: settleHandicap2Way(ht_home, ht_away, leg.line, leg.outcome_name) };
  }
  if (mt === "handicap - 2t" || mt === "spread 2h") {
    if (ht_home == null || ht_away == null) return { verdict: null, reason: "ht_scores_missing" };
    const sh_home = result.home - ht_home;
    const sh_away = result.away - ht_away;
    return { verdict: settleHandicap2Way(sh_home, sh_away, leg.line, leg.outcome_name) };
  }

  // ─── European Handicap (3-way 1X2 with handicap on home) ───
  if (mt === "european handicap") {
    return { verdict: settleEuropeanHandicap(result.home, result.away, leg.line, leg.outcome_name) };
  }

  // Unsupported — let caller log unsupported_market
  return { verdict: null, reason: "unsupported_market_type" };
}

// Friendly summary for logging
export function describeLeg(leg: BetLeg): string {
  const line = leg.line != null ? ` ${leg.line}` : "";
  return `${leg.market_type}${line} → ${leg.outcome_name}`;
}
