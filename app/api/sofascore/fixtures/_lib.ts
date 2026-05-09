import { teamMatchScore } from "@/lib/betexplorer";

const TIME_TOLERANCE_DEFAULT_SEC = 20 * 60;
const TIME_TOLERANCE_BY_SPORT: Record<SofaSport, number> = {
  football: 20 * 60,
  tennis: 30 * 60,
  basketball: 60 * 60,
  baseball: 90 * 60,
  cricket: 90 * 60,
  "ice-hockey": 30 * 60,
  handball: 20 * 60,
  volleyball: 20 * 60,
  rugby: 30 * 60,
  "american-football": 30 * 60,
  darts: 60 * 60,
  boxing: 60 * 60,
  mma: 90 * 60,
  snooker: 60 * 60,
  esports: 30 * 60,
};

const SOFA_SPORTS = [
  "football", "tennis", "basketball",
  "baseball", "esports", "handball", "rugby", "darts",
  "ice-hockey", "cricket", "volleyball", "boxing", "mma",
  "american-football", "snooker",
] as const;
export type SofaSport = (typeof SOFA_SPORTS)[number];
export const SOFA_VALID_SPORTS: ReadonlySet<SofaSport> = new Set(SOFA_SPORTS);

export interface SofaFixture {
  sofa_event_id: number;
  sofa_sport: string;
  home: string;
  away: string;
  kickoff_at: string;
  sofa_status: string;
  tournament_name: string;
  category_name: string | null;
  // displayInverseHomeAwayTeams from Sofa uniqueTournament. Optional: Sofa may not always
  // expose it. Persisted to events_v2.sofa_inverse_orientation when present.
  sofa_inverse_orientation?: boolean | null;
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

/**
 * Returns the slug + status arrays the route handler will feed into the
 * Supabase query. Extracted so unit tests can pin them down without
 * mocking Supabase.
 *
 * statuses covers pending (the events_v2 equivalent of SofaScore's prematch state) + live; the route additionally OR-s in
 * recently-settled rows via .or() (those need a starts_at>=NOW()-6h check
 * that does not belong here).
 */
export function buildPoolQuery(): { slugs: readonly SofaSport[]; statuses: readonly ("pending" | "live")[] } {
  return {
    slugs: SOFA_SPORTS,
    statuses: ["pending", "live"] as const,
  };
}

export function matchSofaToCandidate(fx: SofaFixture, pool: Candidate[]): MatchResult {
  if (!SOFA_VALID_SPORTS.has(fx.sofa_sport as SofaSport)) {
    return { kind: "skipped_unknown_sport" };
  }

  // 1. Direct lookup by existing sofascore_id
  const direct = pool.find((c) => c.sofascore_id === fx.sofa_event_id);
  if (direct) return { kind: "matched_direct", candidate: direct };

  // 2. Time-window filter (and exclude already-mapped to OTHER sofa events)
  const fxTime = new Date(fx.kickoff_at).getTime() / 1000;
  const tolerance = TIME_TOLERANCE_BY_SPORT[fx.sofa_sport as SofaSport] ?? TIME_TOLERANCE_DEFAULT_SEC;
  const inWindow = pool.filter(
    (c) =>
      c.sport_slug === fx.sofa_sport &&
      c.sofascore_id == null &&
      Math.abs(new Date(c.starts_at).getTime() / 1000 - fxTime) <= tolerance,
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
