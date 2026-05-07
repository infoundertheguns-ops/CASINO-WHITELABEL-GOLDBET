import { teamMatchScore } from "@/lib/betexplorer";

const TIME_TOLERANCE_SEC = 20 * 60;

export interface SofaFixture {
  sofa_event_id: number;
  sofa_sport: string;
  home: string;
  away: string;
  kickoff_at: string;
  sofa_status: string;
  tournament_name: string;
  category_name: string | null;
}

export interface Candidate {
  id: string;
  sport_slug: string;
  home: string;
  away: string;
  starts_at: string;
  status: string;
  sofascore_id: number | null;
}

export type MatchResult =
  | { kind: "matched_direct"; candidate: Candidate }
  | { kind: "matched_fuzzy"; candidate: Candidate; score: number }
  | { kind: "no_time_window" }
  | { kind: "no_match_name" }
  | { kind: "skipped_unknown_sport" };

export function mapSofaSport(s: string): "calcio" | "tennis" | "basket" | null {
  switch (s) {
    case "football":
      return "calcio";
    case "tennis":
      return "tennis";
    case "basketball":
      return "basket";
    default:
      return null;
  }
}

export function matchSofaToCandidate(fx: SofaFixture, pool: Candidate[]): MatchResult {
  const vincituSport = mapSofaSport(fx.sofa_sport);
  if (!vincituSport) return { kind: "skipped_unknown_sport" };

  // 1. Direct lookup by existing sofascore_id
  const direct = pool.find((c) => c.sofascore_id === fx.sofa_event_id);
  if (direct) return { kind: "matched_direct", candidate: direct };

  // 2. Time-window filter (and exclude already-mapped to OTHER sofa events)
  const fxTime = new Date(fx.kickoff_at).getTime() / 1000;
  const inWindow = pool.filter(
    (c) =>
      c.sport_slug === vincituSport &&
      c.sofascore_id == null &&
      Math.abs(new Date(c.starts_at).getTime() / 1000 - fxTime) <= TIME_TOLERANCE_SEC,
  );
  if (inWindow.length === 0) return { kind: "no_time_window" };

  // 3. Token-based name match
  let best: { c: Candidate; score: number } | null = null;
  for (const c of inWindow) {
    const hScore = teamMatchScore(c.home, fx.home);
    const aScore = teamMatchScore(c.away, fx.away);
    if (hScore < 0.5 || aScore < 0.5) continue;
    const combined = hScore + aScore;
    if (!best || combined > best.score) best = { c, score: combined };
  }
  if (!best || best.score <= 1.0) return { kind: "no_match_name" };

  return { kind: "matched_fuzzy", candidate: best.c, score: best.score };
}
