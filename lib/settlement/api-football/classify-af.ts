// M3.3 + M3.4 + M3.5 — Dispatcher for api-football-derived settlement.
//
// Given a BetLeg and an AFResult (built by buildResultFromAF), dispatch
// to the appropriate score-derived (Bucket A) / statistics-derived
// (Bucket B) / player-prop (Bucket C) settler. Reuse the existing
// settlers from `lib/settlement/odds-api/classify.ts` wherever the
// computational shape lines up — they're battle-tested and we don't
// want to fork settler logic.
//
// Returns:
//   { verdict: Verdict }                        — successful classification
//   { verdict: null, reason: 'X_missing' }      — source data not yet
//                                                 present in AFResult;
//                                                 caller should DEFER
//                                                 settlement and retry
//                                                 later (do NOT wrong-call)
//   { verdict: null, reason: 'market_type_not_supported_af' }
//                                               — outside Bucket A/B/C;
//                                                 caller may fall back to
//                                                 FS-derived classifier
//
// Spec §M3.3, §M3.4, §M3.5.

import {
  norm,
  normName,
  settle1X2,
  settleOU,
  settleBTTS,
  settleDC,
  settleDNB,
  settleHTFT,
  settleCorrectScore,
  settleOddEven,
  settleHandicap2Way,
  settleEuropeanHandicap,
  settleAsianHandicapQuarter,
  settleGoalLine,
  settleStatOU,
  settleStat1X2,
  settleStatHandicap,
  type BetLeg,
  type Verdict,
} from "@/lib/settlement/odds-api/classify";
import type { AFResult } from "./build-result-af";

export interface ClassifyAFResult {
  verdict: Verdict | null;
  reason?: string;
}

// ════════════════════════════════════════════════════════════════════
// Local helpers — outcome name parsing
// ════════════════════════════════════════════════════════════════════

/**
 * Extract a numeric line embedded in an outcome string.
 * Examples:
 *   "Over 2.5"          → 2.5
 *   "Under 3"           → 3
 *   "Mario Rossi 2.5+"  → 2.5
 *   "1"                 → null (no decimal/separated number) — caller should use leg.line
 *
 * Returns the FIRST finite numeric token; `null` when none found.
 */
function extractLine(outcome: string): number | null {
  const m = outcome.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Detect Over/Under side from an outcome name.
 * Tolerant to suffix/prefix patterns (e.g. "Over 2.5", "Mario Rossi Over 1.5").
 */
function detectOUSide(outcome: string): "over" | "under" | null {
  const o = norm(outcome);
  if (/\b(over|più di|piu di)\b/.test(o) || /\bo\b/.test(o)) return "over";
  if (/\b(under|meno di)\b/.test(o) || /\bu\b/.test(o)) return "under";
  return null;
}

/**
 * For player-prop outcomes that embed both name + line ("Mario Rossi Over 2.5"),
 * strip the trailing Over/Under <line> tokens and return the player name candidate.
 * If the outcome has no Over/Under suffix, returns the trimmed outcome.
 */
function extractPlayerName(outcome: string): string {
  return outcome
    .replace(/\s*(over|under|più di|piu di|meno di)\s*\d+(?:[.,]\d+)?\s*$/i, "")
    .replace(/\s*\d+(?:[.,]\d+)?\s*\+?\s*$/i, "")
    .replace(/\s*(over|under|più di|piu di|meno di)\s*$/i, "")
    .trim();
}

/**
 * Locate a player in api-football's `players_af_ft` structure:
 *   players_af_ft : Array<{ team: {...}, players: Array<{ player: {...}, statistics: [{...}] }> }>
 *
 * Returns `{ player, stats }` or null when not found.
 * `stats` is the first element of `player.statistics` (api-football wraps a
 * single stat snapshot in a 1-element array).
 */
interface AFPlayerLookup {
  player: { id?: number; name?: string };
  team?: { name?: string };
  stats: AFPlayerStatBlock | null;
}
interface AFPlayerStatBlock {
  games?: { minutes?: number | null } | null;
  shots?: { total?: number | null; on?: number | null } | null;
  goals?: {
    total?: number | null;
    assists?: number | null;
    conceded?: number | null;
    saves?: number | null;
  } | null;
  fouls?: { committed?: number | null; drawn?: number | null } | null;
  cards?: { yellow?: number | null; red?: number | null } | null;
  tackles?: {
    total?: number | null;
    blocks?: number | null;
    interceptions?: number | null;
  } | null;
}

function findPlayer(playersFt: unknown, name: string): AFPlayerLookup | null {
  if (!Array.isArray(playersFt)) return null;
  const target = normName(name);
  if (!target) return null;
  for (const teamGroup of playersFt) {
    if (!teamGroup || typeof teamGroup !== "object") continue;
    const tg = teamGroup as { team?: { name?: string }; players?: unknown };
    if (!Array.isArray(tg.players)) continue;
    for (const p of tg.players) {
      if (!p || typeof p !== "object") continue;
      const pl = p as {
        player?: { id?: number; name?: string };
        statistics?: AFPlayerStatBlock[] | null;
      };
      const pname = pl.player?.name;
      if (typeof pname !== "string") continue;
      if (normName(pname) !== target) continue;
      return {
        player: pl.player ?? {},
        team: tg.team,
        stats: Array.isArray(pl.statistics) && pl.statistics.length > 0
          ? pl.statistics[0]
          : null,
      };
    }
  }
  return null;
}

interface AFIncident {
  time?: { elapsed?: number | null } | null;
  team?: { name?: string | null } | null;
  type?: string | null;
  detail?: string | null;
  player?: { name?: string | null } | null;
}

function asIncidentArray(events: unknown): AFIncident[] | null {
  if (!Array.isArray(events)) return null;
  return events as AFIncident[];
}

// ════════════════════════════════════════════════════════════════════
// Bucket A — score-derived (M3.3)
// ════════════════════════════════════════════════════════════════════

function classifyBucketA(
  mt: string,
  leg: BetLeg,
  r: AFResult
): ClassifyAFResult | null {
  const total = r.home + r.away;
  const ht_home = r.ht_home;
  const ht_away = r.ht_away;
  const htBoth = ht_home != null && ht_away != null;
  const ht_total = htBoth ? (ht_home as number) + (ht_away as number) : null;
  const h2_home = htBoth ? r.home - (ht_home as number) : null;
  const h2_away = htBoth ? r.away - (ht_away as number) : null;

  // 1X2 / ML / 3-way result (full-time)
  if (mt === "1x2" || mt === "ml" || mt === "3way_result" || mt === "3-way result") {
    return { verdict: settle1X2(r.home, r.away, leg.outcome_name) };
  }
  // 1X2 HT / 3-way result HT
  if (mt === "1x2_ht" || mt === "3way_result_ht" || mt === "3-way result ht") {
    if (!htBoth) return { verdict: null, reason: "ht_scores_missing" };
    return { verdict: settle1X2(ht_home as number, ht_away as number, leg.outcome_name) };
  }
  // 1X2 2H / ML 2H
  if (mt === "1x2_2h" || mt === "ml_2h") {
    if (!htBoth) return { verdict: null, reason: "ht_scores_missing" };
    return { verdict: settle1X2(h2_home as number, h2_away as number, leg.outcome_name) };
  }

  // Totals (FT)
  if (mt === "totals" || mt === "number_of_goals") {
    // number_of_goals can also use Exactly N pattern — try OU first.
    const ouSide = detectOUSide(leg.outcome_name);
    if (ouSide) {
      const v = settleOU(total, leg.line, leg.outcome_name);
      if (v != null) return { verdict: v };
    }
    if (mt === "number_of_goals") {
      // "Exactly N" / pure "N" form
      const n = extractLine(leg.outcome_name);
      if (n != null) return { verdict: total === n ? "won" : "lost" };
    }
    return { verdict: null, reason: "outcome_unrecognized" };
  }
  // Totals HT
  if (mt === "totals_ht") {
    if (ht_total == null) return { verdict: null, reason: "ht_scores_missing" };
    const v = settleOU(ht_total, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }
  // Totals 2H
  if (mt === "totals_2h") {
    if (!htBoth) return { verdict: null, reason: "ht_scores_missing" };
    const v = settleOU(
      (h2_home as number) + (h2_away as number),
      leg.line,
      leg.outcome_name
    );
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }

  // BTTS family
  if (mt === "btts") return { verdict: settleBTTS(r.home, r.away, leg.outcome_name) };
  if (mt === "btts_ht" || mt === "both_teams_to_score_1h") {
    if (!htBoth) return { verdict: null, reason: "ht_scores_missing" };
    return { verdict: settleBTTS(ht_home as number, ht_away as number, leg.outcome_name) };
  }
  if (mt === "btts_2h" || mt === "both_teams_to_score_2h") {
    if (!htBoth) return { verdict: null, reason: "ht_scores_missing" };
    return { verdict: settleBTTS(h2_home as number, h2_away as number, leg.outcome_name) };
  }

  // Double Chance / DNB
  if (mt === "double_chance") return { verdict: settleDC(r.home, r.away, leg.outcome_name) };
  if (mt === "draw_no_bet") return { verdict: settleDNB(r.home, r.away, leg.outcome_name) };
  if (mt === "draw_no_bet_ht") {
    if (!htBoth) return { verdict: null, reason: "ht_scores_missing" };
    return { verdict: settleDNB(ht_home as number, ht_away as number, leg.outcome_name) };
  }

  // Correct Score / HT/FT / Odd-Even
  if (mt === "correct_score") {
    return { verdict: settleCorrectScore(r.home, r.away, leg.outcome_name) };
  }
  if (mt === "ht_ft") {
    if (!htBoth) return { verdict: null, reason: "ht_scores_missing" };
    return {
      verdict: settleHTFT(
        ht_home as number,
        ht_away as number,
        r.home,
        r.away,
        leg.outcome_name
      ),
    };
  }
  if (mt === "odd_even") {
    return { verdict: settleOddEven(total, leg.outcome_name) };
  }

  // Team totals (FT)
  if (mt === "team_total_home" || mt === "team_total_goals_home") {
    const v = settleOU(r.home, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }
  if (mt === "team_total_away" || mt === "team_total_goals_away") {
    const v = settleOU(r.away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }
  // Team totals HT
  if (mt === "team_total_goals_home_ht") {
    if (ht_home == null) return { verdict: null, reason: "ht_scores_missing" };
    const v = settleOU(ht_home, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }
  if (mt === "team_total_goals_away_ht") {
    if (ht_away == null) return { verdict: null, reason: "ht_scores_missing" };
    const v = settleOU(ht_away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }

  // Exact total goals (no line; outcome embeds N)
  if (mt === "exact_total_goals") {
    const n = extractLine(leg.outcome_name);
    if (n == null) return { verdict: null, reason: "outcome_unrecognized" };
    return { verdict: total === n ? "won" : "lost" };
  }

  // First team to score — from events_af first Goal type
  if (mt === "first_team_to_score") {
    const ev = asIncidentArray(r.events_af);
    if (ev == null) return { verdict: null, reason: "events_af_missing" };
    const firstGoal = ev.find((i) => i?.type === "Goal");
    if (!firstGoal) {
      // 0-0 game — only valid if outcome is "no goal" / "neither"
      const o = norm(leg.outcome_name);
      if (o === "no goal" || o === "neither" || o === "no") {
        return { verdict: total === 0 ? "won" : "lost" };
      }
      return { verdict: "lost" }; // no goal scored, but outcome named a team
    }
    const o = norm(leg.outcome_name);
    const teamName = norm(firstGoal.team?.name ?? "");
    // Outcome forms: literal team name, or "no goal" / "neither".
    // "1" / "2" / "home" / "away" cannot be resolved here because AFResult
    // does not carry the event's team names (caller's responsibility to
    // expand H/A → literal name before invoking). Reject those.
    if (o === "no goal" || o === "neither") {
      return { verdict: "lost" }; // a goal was scored
    }
    if (o === "1" || o === "2" || o === "home" || o === "away" || o === "casa" || o === "trasferta") {
      return { verdict: null, reason: "outcome_requires_literal_team_name" };
    }
    return { verdict: teamName === o ? "won" : "lost" };
  }

  // Method of victory — derived from events_af + result
  if (mt === "method_of_victory") {
    const ev = asIncidentArray(r.events_af);
    if (ev == null) return { verdict: null, reason: "events_af_missing" };
    const o = norm(leg.outcome_name);
    // Detect penalty shootout (api-football emits incident with detail "Penalty Shootout"
    // or type="Goal" with detail containing "Penalty Shootout").
    const hasShootout = ev.some((i) => {
      const d = (i?.detail ?? "").toString().toLowerCase();
      const t = (i?.type ?? "").toString().toLowerCase();
      return d.includes("shootout") || t.includes("shootout");
    });
    // Detect extra time goal
    const hasExtraTime = ev.some((i) => {
      const elapsed = i?.time?.elapsed;
      return typeof elapsed === "number" && elapsed > 90 && i?.type === "Goal";
    });
    let actual: string;
    if (hasShootout) actual = "penalty shootout";
    else if (hasExtraTime) actual = "extra time";
    else actual = "normal";
    if (o === "normal" || o === "normal time" || o === "regulation") {
      return { verdict: actual === "normal" ? "won" : "lost" };
    }
    if (o === "extra time" || o === "et") {
      return { verdict: actual === "extra time" ? "won" : "lost" };
    }
    if (o === "penalty shootout" || o === "penalties" || o === "shootout") {
      return { verdict: actual === "penalty shootout" ? "won" : "lost" };
    }
    return { verdict: null, reason: "outcome_unrecognized" };
  }

  return null; // Not a Bucket A market
}

// ════════════════════════════════════════════════════════════════════
// Bucket B — statistics-derived (M3.4)
// ════════════════════════════════════════════════════════════════════

function classifyBucketB(
  mt: string,
  leg: BetLeg,
  r: AFResult
): ClassifyAFResult | null {
  // Corners
  if (mt === "total_corners") {
    if (r.corners_home == null || r.corners_away == null) {
      return { verdict: null, reason: "statistics_af_missing" };
    }
    const v = settleStatOU(r.corners_home, r.corners_away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }
  if (mt === "total_corners_ht") {
    // api-football statistics_af has no HT split for corners
    return { verdict: null, reason: "statistics_af_missing" };
  }
  if (mt === "corners_totals_home") {
    if (r.corners_home == null) return { verdict: null, reason: "statistics_af_missing" };
    const v = settleOU(r.corners_home, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }
  if (mt === "corners_totals_away") {
    if (r.corners_away == null) return { verdict: null, reason: "statistics_af_missing" };
    const v = settleOU(r.corners_away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }
  if (mt === "corners_spread" || mt === "corner_handicap") {
    if (r.corners_home == null || r.corners_away == null) {
      return { verdict: null, reason: "statistics_af_missing" };
    }
    const v = settleStatHandicap(r.corners_home, r.corners_away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized_or_quarter_line" : undefined };
  }
  if (mt === "corner_1x2" || mt === "corner_2way") {
    if (r.corners_home == null || r.corners_away == null) {
      return { verdict: null, reason: "statistics_af_missing" };
    }
    const v = settleStat1X2(r.corners_home, r.corners_away, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }

  // Bookings / cards
  if (mt === "bookings_totals" || mt === "number_of_cards") {
    if (r.cards_home == null || r.cards_away == null) {
      return { verdict: null, reason: "statistics_af_missing" };
    }
    // "Exactly N" form (number_of_cards) → check outcome line
    const ouSide = detectOUSide(leg.outcome_name);
    const tot = r.cards_home + r.cards_away;
    if (ouSide) {
      const v = settleOU(tot, leg.line, leg.outcome_name);
      if (v != null) return { verdict: v };
    }
    if (mt === "number_of_cards") {
      const n = extractLine(leg.outcome_name);
      if (n != null) return { verdict: tot === n ? "won" : "lost" };
    }
    const v = settleStatOU(r.cards_home, r.cards_away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }
  if (mt === "bookings_totals_home" || mt === "team_cards_home") {
    if (r.cards_home == null) return { verdict: null, reason: "statistics_af_missing" };
    const v = settleOU(r.cards_home, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }
  if (mt === "bookings_totals_away" || mt === "team_cards_away") {
    if (r.cards_away == null) return { verdict: null, reason: "statistics_af_missing" };
    const v = settleOU(r.cards_away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }
  if (mt === "bookings_spread" || mt === "card_handicap") {
    if (r.cards_home == null || r.cards_away == null) {
      return { verdict: null, reason: "statistics_af_missing" };
    }
    const v = settleStatHandicap(r.cards_home, r.cards_away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized_or_quarter_line" : undefined };
  }

  // Shots
  if (mt === "total_shots") {
    if (r.shots_home == null || r.shots_away == null) {
      return { verdict: null, reason: "statistics_af_missing" };
    }
    const v = settleStatOU(r.shots_home, r.shots_away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }
  if (mt === "total_shots_home" || mt === "team_shots_home") {
    if (r.shots_home == null) return { verdict: null, reason: "statistics_af_missing" };
    const v = settleOU(r.shots_home, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }
  if (mt === "total_shots_away" || mt === "team_shots_away") {
    if (r.shots_away == null) return { verdict: null, reason: "statistics_af_missing" };
    const v = settleOU(r.shots_away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }

  // Shots on target
  if (mt === "total_shots_on_target") {
    if (r.sot_home == null || r.sot_away == null) {
      return { verdict: null, reason: "statistics_af_missing" };
    }
    const v = settleStatOU(r.sot_home, r.sot_away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }
  if (mt === "total_shots_on_target_home") {
    if (r.sot_home == null) return { verdict: null, reason: "statistics_af_missing" };
    const v = settleOU(r.sot_home, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }
  if (mt === "total_shots_on_target_away") {
    if (r.sot_away == null) return { verdict: null, reason: "statistics_af_missing" };
    const v = settleOU(r.sot_away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }
  if (mt === "most_shots_on_target") {
    if (r.sot_home == null || r.sot_away == null) {
      return { verdict: null, reason: "statistics_af_missing" };
    }
    const v = settleStat1X2(r.sot_home, r.sot_away, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }

  // Offsides
  if (mt === "total_offsides") {
    if (r.offsides_home == null || r.offsides_away == null) {
      return { verdict: null, reason: "statistics_af_missing" };
    }
    const v = settleStatOU(r.offsides_home, r.offsides_away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }
  if (mt === "team_offsides_home") {
    if (r.offsides_home == null) return { verdict: null, reason: "statistics_af_missing" };
    const v = settleOU(r.offsides_home, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }
  if (mt === "team_offsides_away") {
    if (r.offsides_away == null) return { verdict: null, reason: "statistics_af_missing" };
    const v = settleOU(r.offsides_away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }

  // Fouls
  if (mt === "total_fouls") {
    if (r.fouls_home == null || r.fouls_away == null) {
      return { verdict: null, reason: "statistics_af_missing" };
    }
    const v = settleStatOU(r.fouls_home, r.fouls_away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }
  if (mt === "total_fouls_home") {
    if (r.fouls_home == null) return { verdict: null, reason: "statistics_af_missing" };
    const v = settleOU(r.fouls_home, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }
  if (mt === "total_fouls_away") {
    if (r.fouls_away == null) return { verdict: null, reason: "statistics_af_missing" };
    const v = settleOU(r.fouls_away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }

  // Goalkeeper saves
  if (mt === "goalkeeper_saves_home") {
    if (r.gk_saves_home == null) return { verdict: null, reason: "statistics_af_missing" };
    const v = settleOU(r.gk_saves_home, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }
  if (mt === "goalkeeper_saves_away") {
    if (r.gk_saves_away == null) return { verdict: null, reason: "statistics_af_missing" };
    const v = settleOU(r.gk_saves_away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }

  // Handicaps on score (live in Bucket B per spec for consistency with stat handicaps)
  if (mt === "asian_handicap") {
    const vq = settleAsianHandicapQuarter(r.home, r.away, leg.line, leg.outcome_name);
    if (vq != null) return { verdict: vq };
    const v = settleHandicap2Way(r.home, r.away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized_or_invalid_line" : undefined };
  }
  if (mt === "european_handicap") {
    const v = settleEuropeanHandicap(r.home, r.away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }
  if (mt === "spread") {
    const v = settleHandicap2Way(r.home, r.away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized_or_invalid_line" : undefined };
  }
  if (mt === "spread_ht") {
    if (r.ht_home == null || r.ht_away == null) {
      return { verdict: null, reason: "ht_scores_missing" };
    }
    const v = settleHandicap2Way(r.ht_home, r.ht_away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized_or_invalid_line" : undefined };
  }
  if (mt === "goal_line") {
    const vq = settleGoalLine(r.home + r.away, leg.line, leg.outcome_name);
    if (vq != null) return { verdict: vq };
    const v = settleOU(r.home + r.away, leg.line, leg.outcome_name);
    return { verdict: v, reason: v == null ? "outcome_unrecognized" : undefined };
  }

  return null;
}

// ════════════════════════════════════════════════════════════════════
// Bucket C — player props (M3.5)
// ════════════════════════════════════════════════════════════════════

function classifyBucketC(
  mt: string,
  leg: BetLeg,
  r: AFResult
): ClassifyAFResult | null {
  // All Bucket C markets need players_af_ft EXCEPT team_goalscorer / goal_method
  // which work off events_af.
  const playersPresent = Array.isArray(r.players_af_ft);

  if (mt === "to_score_2plus_goals" || mt === "to_score_3plus_goals") {
    if (!playersPresent) return { verdict: null, reason: "players_af_missing" };
    const threshold = mt === "to_score_2plus_goals" ? 2 : 3;
    const name = extractPlayerName(leg.outcome_name);
    const found = findPlayer(r.players_af_ft, name);
    if (!found) return { verdict: "lost" }; // player didn't take part / not in feed
    const goals = found.stats?.goals?.total;
    if (typeof goals !== "number") return { verdict: "lost" };
    return { verdict: goals >= threshold ? "won" : "lost" };
  }

  if (mt === "player_shots") {
    if (!playersPresent) return { verdict: null, reason: "players_af_missing" };
    const name = extractPlayerName(leg.outcome_name);
    const found = findPlayer(r.players_af_ft, name);
    if (!found) return { verdict: null, reason: "player_not_found" };
    const shots = found.stats?.shots?.total;
    if (typeof shots !== "number") return { verdict: null, reason: "shots_stat_missing" };
    const lineFromLeg = leg.line;
    const lineFromOutcome = extractLine(leg.outcome_name);
    const line = lineFromLeg ?? lineFromOutcome;
    const side = detectOUSide(leg.outcome_name);
    if (side == null || line == null) return { verdict: null, reason: "outcome_unrecognized" };
    if (shots === line) return { verdict: "void" };
    if (side === "over") return { verdict: shots > line ? "won" : "lost" };
    return { verdict: shots < line ? "won" : "lost" };
  }

  if (mt === "player_shots_on_target") {
    if (!playersPresent) return { verdict: null, reason: "players_af_missing" };
    const name = extractPlayerName(leg.outcome_name);
    const found = findPlayer(r.players_af_ft, name);
    if (!found) return { verdict: null, reason: "player_not_found" };
    const sot = found.stats?.shots?.on;
    if (typeof sot !== "number") return { verdict: null, reason: "sot_stat_missing" };
    const line = leg.line ?? extractLine(leg.outcome_name);
    const side = detectOUSide(leg.outcome_name);
    if (side == null || line == null) return { verdict: null, reason: "outcome_unrecognized" };
    if (sot === line) return { verdict: "void" };
    if (side === "over") return { verdict: sot > line ? "won" : "lost" };
    return { verdict: sot < line ? "won" : "lost" };
  }

  if (mt === "player_to_be_booked") {
    if (!playersPresent) return { verdict: null, reason: "players_af_missing" };
    // Outcome may be just "Player Name" (yes-form) or "Player Name - No" /
    // "Player Name No". Normalize by stripping trailing yes/no marker.
    const raw = leg.outcome_name.trim();
    const noMatch = /\b(no|no booking|not booked)\s*$/i.test(raw);
    const name = raw.replace(/\s*[-,]?\s*(no|no booking|not booked|yes|booked)\s*$/i, "").trim();
    const found = findPlayer(r.players_af_ft, name);
    if (!found) {
      // Player not on field — "no" wins, "yes" loses
      return { verdict: noMatch ? "won" : "lost" };
    }
    const yellow = found.stats?.cards?.yellow ?? 0;
    const red = found.stats?.cards?.red ?? 0;
    const booked = yellow + red >= 1;
    if (noMatch) return { verdict: booked ? "lost" : "won" };
    return { verdict: booked ? "won" : "lost" };
  }

  if (mt === "player_fouls") {
    if (!playersPresent) return { verdict: null, reason: "players_af_missing" };
    const name = extractPlayerName(leg.outcome_name);
    const found = findPlayer(r.players_af_ft, name);
    if (!found) return { verdict: null, reason: "player_not_found" };
    const v = found.stats?.fouls?.committed;
    if (typeof v !== "number") return { verdict: null, reason: "fouls_stat_missing" };
    const line = leg.line ?? extractLine(leg.outcome_name);
    const side = detectOUSide(leg.outcome_name);
    if (side == null || line == null) return { verdict: null, reason: "outcome_unrecognized" };
    if (v === line) return { verdict: "void" };
    if (side === "over") return { verdict: v > line ? "won" : "lost" };
    return { verdict: v < line ? "won" : "lost" };
  }

  if (mt === "player_to_be_fouled") {
    if (!playersPresent) return { verdict: null, reason: "players_af_missing" };
    const name = extractPlayerName(leg.outcome_name);
    const found = findPlayer(r.players_af_ft, name);
    if (!found) return { verdict: null, reason: "player_not_found" };
    const v = found.stats?.fouls?.drawn;
    if (typeof v !== "number") return { verdict: null, reason: "fouls_drawn_stat_missing" };
    const line = leg.line ?? extractLine(leg.outcome_name);
    const side = detectOUSide(leg.outcome_name);
    if (side == null || line == null) return { verdict: null, reason: "outcome_unrecognized" };
    if (v === line) return { verdict: "void" };
    if (side === "over") return { verdict: v > line ? "won" : "lost" };
    return { verdict: v < line ? "won" : "lost" };
  }

  if (mt === "player_tackles") {
    if (!playersPresent) return { verdict: null, reason: "players_af_missing" };
    const name = extractPlayerName(leg.outcome_name);
    const found = findPlayer(r.players_af_ft, name);
    if (!found) return { verdict: null, reason: "player_not_found" };
    const v = found.stats?.tackles?.total;
    if (typeof v !== "number") return { verdict: null, reason: "tackles_stat_missing" };
    const line = leg.line ?? extractLine(leg.outcome_name);
    const side = detectOUSide(leg.outcome_name);
    if (side == null || line == null) return { verdict: null, reason: "outcome_unrecognized" };
    if (v === line) return { verdict: "void" };
    if (side === "over") return { verdict: v > line ? "won" : "lost" };
    return { verdict: v < line ? "won" : "lost" };
  }

  if (mt === "player_to_assist") {
    if (!playersPresent) return { verdict: null, reason: "players_af_missing" };
    const name = extractPlayerName(leg.outcome_name);
    const found = findPlayer(r.players_af_ft, name);
    if (!found) return { verdict: "lost" };
    const a = found.stats?.goals?.assists ?? 0;
    return { verdict: a >= 1 ? "won" : "lost" };
  }

  if (mt === "team_goalscorer") {
    const ev = asIncidentArray(r.events_af);
    if (ev == null) return { verdict: null, reason: "events_af_missing" };
    const target = norm(leg.outcome_name);
    const scored = ev.some(
      (i) => i?.type === "Goal" && norm(i?.team?.name ?? "") === target
    );
    return { verdict: scored ? "won" : "lost" };
  }

  if (mt === "goal_method") {
    const ev = asIncidentArray(r.events_af);
    if (ev == null) return { verdict: null, reason: "events_af_missing" };
    const firstGoal = ev.find((i) => i?.type === "Goal");
    if (!firstGoal) return { verdict: "void" }; // 0-0
    const detail = (firstGoal.detail ?? "").toString().toLowerCase();
    const o = norm(leg.outcome_name);
    // Map outcome → expected detail keyword
    const expected: Record<string, RegExp> = {
      "normal goal": /normal/,
      "normal": /normal/,
      "penalty": /penalty/,
      "own goal": /own/,
      "header": /head/,
    };
    const re = expected[o];
    if (!re) return { verdict: null, reason: "outcome_unrecognized" };
    return { verdict: re.test(detail) ? "won" : "lost" };
  }

  return null;
}

// ════════════════════════════════════════════════════════════════════
// Public dispatcher
// ════════════════════════════════════════════════════════════════════

export function classifyLegAF(
  leg: BetLeg,
  result: AFResult
): ClassifyAFResult {
  const mt = norm(leg.market_type);

  const a = classifyBucketA(mt, leg, result);
  if (a) return a;

  const b = classifyBucketB(mt, leg, result);
  if (b) return b;

  const c = classifyBucketC(mt, leg, result);
  if (c) return c;

  return { verdict: null, reason: "market_type_not_supported_af" };
}
