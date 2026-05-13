// app/api/flashscore/live/_lib.ts
//
// Pure helpers extracted from route.ts for unit testability.
// No supabase / fetch / NextResponse — only data transforms.

import type {
  FlashscoreLive,
  FlashscoreSummary,
  FlashscoreStat,
} from "@/lib/flashscore";
import { derivePeriodLabel, teamMatchScore } from "@/lib/flashscore";

// FS authoritative for score_home/score_away during live: see app/api/flashscore/live/_lib.ts
// computeEnrichmentUpdate (Opzione B 2026-05-13). OddsAPI provides initial pre-FS state.
export interface V2LiveEvent {
  id: string;
  home: string;
  away: string;
  score_home: number | null;
  score_away: number | null;
  starts_at: string;
  period: string | null;
  minute: number | null;
  live_data: Record<string, unknown> | null;
  flashscore_id: string | null;
  sofascore_id: number | null;
  country_fs: string | null;
  league_fs: string | null;
}

export function computeEnrichmentUpdate(args: {
  ev: V2LiveEvent;
  fs: FlashscoreLive;
  sport: string;
}): { update: Record<string, unknown> | null } {
  const { ev, fs, sport } = args;
  const update: Record<string, unknown> = {};

  // period label
  let derivedPeriod = derivePeriodLabel(sport, fs.periods.length);
  if (!derivedPeriod) {
    const s = sport.toLowerCase();
    const homeS = fs.scoreHome ?? ev.score_home ?? 0;
    const awayS = fs.scoreAway ?? ev.score_away ?? 0;
    const unitIdx = homeS + awayS + 1;
    if (unitIdx > 0) {
      if (s === "snooker") derivedPeriod = `Frame ${unitIdx}`;
      else if (s === "freccette" || s === "darts") derivedPeriod = `Leg ${unitIdx}`;
    }
  }
  if (derivedPeriod && derivedPeriod !== ev.period) {
    update.period = derivedPeriod;
  }

  // live_data merge
  const halfScoreHome = fs.periods.map((p) => p[0]);
  const halfScoreAway = fs.periods.map((p) => p[1]);
  const existingLd = (ev.live_data || {}) as Record<string, unknown>;
  const mergedLd = { ...existingLd };
  let ldChanged = false;
  if (halfScoreHome.length > 0) {
    if (!arraysEqual(existingLd.halfScoreHome as number[] | undefined, halfScoreHome)) {
      mergedLd.halfScoreHome = halfScoreHome;
      ldChanged = true;
    }
    if (!arraysEqual(existingLd.halfScoreAway as number[] | undefined, halfScoreAway)) {
      mergedLd.halfScoreAway = halfScoreAway;
      ldChanged = true;
    }
  }

  // Structured periods from df_su_1 (named: "1st Half"/"Q1"/"Set 1"/...).
  // Replaces (or supersedes) the flat halfScoreHome/halfScoreAway arrays for
  // consumers that need labelled periods. Kept alongside the flat arrays for
  // backwards compatibility with anything still reading the legacy shape.
  if (fs.summary && fs.summary.periods.length > 0) {
    const newPeriods = fs.summary.periods;
    const prevPeriods = existingLd.periods as FlashscoreSummary["periods"] | undefined;
    if (!periodsEqual(prevPeriods, newPeriods)) {
      mergedLd.periods = newPeriods;
      ldChanged = true;
    }
  }

  // Incidents timeline (goals/cards/subs/assists). Idempotent on count+last id.
  if (fs.summary && fs.summary.incidents.length > 0) {
    const newIncidents = fs.summary.incidents;
    const prev = existingLd.incidents as Array<{ id: string }> | undefined;
    const prevLen = Array.isArray(prev) ? prev.length : 0;
    const prevLastId = prevLen > 0 ? prev![prevLen - 1].id : "";
    const newLastId = newIncidents[newIncidents.length - 1].id;
    if (newIncidents.length !== prevLen || newLastId !== prevLastId) {
      mergedLd.incidents = newIncidents;
      ldChanged = true;
    }
  }

  // Match meta (referee, venue, attendance). Set once; only update when changed.
  if (fs.summary && fs.summary.meta && Object.keys(fs.summary.meta).length > 0) {
    const newMeta = fs.summary.meta;
    const prevMeta = existingLd.matchMeta as Record<string, unknown> | undefined;
    if (!shallowMetaEqual(prevMeta, newMeta as Record<string, unknown>)) {
      mergedLd.matchMeta = newMeta;
      ldChanged = true;
    }
  }

  // By-section stats (with stable SD code). Replaces the flat stats array on
  // every change since stats values are continuously updated during a match.
  if (fs.stats && fs.stats.length > 0) {
    const prev = existingLd.stats as FlashscoreStat[] | undefined;
    if (!statsEqual(prev, fs.stats)) {
      mergedLd.stats = fs.stats;
      ldChanged = true;
    }
  }

  if (ldChanged) update.live_data = mergedLd;

  // FS-side country/league strings (payload-fs 2026-05-11). Persist when FS reports
  // a non-empty value that differs from current row. Use case: cross-ref vs OddsAPI
  // league_name to detect matcher drift (e.g., Argentine Primera bug).
  if (fs.country && fs.country !== ev.country_fs) update.country_fs = fs.country;
  if (fs.league && fs.league !== ev.league_fs) update.league_fs = fs.league;

  // FS is authoritative for live score: it polls every 5s with the canonical
  // scoreboard while OddsAPI lags ~140s and writes NULL transiently. Always
  // overwrite ev.score_* when FS reports a value. (Previous gate
  // `ev.score_home == null || upstreamLikelyWrong` left stale OddsAPI scores
  // visible in player kiosk — see player-v1-score-coherence pending.)
  if (fs.scoreHome != null && fs.scoreAway != null) {
    if (fs.scoreHome !== ev.score_home) update.score_home = fs.scoreHome;
    if (fs.scoreAway !== ev.score_away) update.score_away = fs.scoreAway;
  }

  // Sport-aware fallback: derive aggregate from per-period array when fs.scoreHome
  // is null but halfScoreHome is populated. Empirically df_du provides scoreHome only
  // for football; for basketball/baseball/hockey/handball/am-football/rugby it's
  // routinely null while the per-period array has all the data we need. Skipped for
  // tennis/volleyball/badminton where total != sum of period games.
  const SUM_AGGREGATE_SPORTS = new Set([
    "basketball", "basket",
    "baseball",
    "ice-hockey", "hockey",
    "handball", "pallamano",
    "american-football", "football_americano",
    "rugby", "rugby_league",
  ]);
  if (
    update.score_home == null && update.score_away == null &&
    ev.score_home == null &&
    halfScoreHome.length > 0 && halfScoreAway.length > 0 &&
    SUM_AGGREGATE_SPORTS.has(sport.toLowerCase())
  ) {
    const sumH = halfScoreHome.reduce((s, n) => s + (n || 0), 0);
    const sumA = halfScoreAway.reduce((s, n) => s + (n || 0), 0);
    if (ev.score_home !== sumH) update.score_home = sumH;
    if (ev.score_away !== sumA) update.score_away = sumA;
  }

  // D2 (2026-05-13 follow-up): for football/rugby FS scraper publishes per-period
  // scores only via fs.summary.periods (df_su_1, structured with {name,homeScore,
  // awayScore}). fs.scoreHome/scoreAway are null at top-level for these sports
  // because df_du_1 omits FT score. Sum the structured periods so events_v2
  // .score_home/away gets populated for admin dashboards + bet settlement.
  // Empirically validated FC Zlin: periods=[{1T:2-1},{2T:0-2}] sum=2-3 matches
  // last incident scoreAfter. See pending-football-fs-scoreHome-null.md.
  const SUMMARY_PERIODS_SPORTS = new Set([
    "calcio", "football",
    "rugby", "rugby_league",
    "cricket",
  ]);
  if (
    update.score_home == null && update.score_away == null &&
    ev.score_home == null &&
    SUMMARY_PERIODS_SPORTS.has(sport.toLowerCase()) &&
    fs.summary && fs.summary.periods.length > 0 &&
    fs.summary.periods.some((p) => typeof p.homeScore === "number")
  ) {
    const sumH = fs.summary.periods.reduce((s, p) => s + (typeof p.homeScore === "number" ? p.homeScore : 0), 0);
    const sumA = fs.summary.periods.reduce((s, p) => s + (typeof p.awayScore === "number" ? p.awayScore : 0), 0);
    if (ev.score_home !== sumH) update.score_home = sumH;
    if (ev.score_away !== sumA) update.score_away = sumA;
  }

  return { update: Object.keys(update).length === 0 ? null : update };
}

export function findFuzzyMatch(
  ev: V2LiveEvent,
  candidates: FlashscoreLive[],
  used: Set<number>,
): { idx: number; score: number; swapped: boolean } {
  let bestIdx = -1;
  let bestScore = 0;
  let bestSwapped = false;
  for (let i = 0; i < candidates.length; i++) {
    if (used.has(i)) continue;
    const fs = candidates[i];
    if (fs.timestamp && ev.starts_at) {
      const dbTime = new Date(ev.starts_at).getTime() / 1000;
      if (Math.abs(dbTime - fs.timestamp) > 4 * 3600) continue;
    }
    // Same orientation
    const hsSame = teamMatchScore(ev.home, fs.homeTeam);
    const asSame = teamMatchScore(ev.away, fs.awayTeam);
    const sameOk = hsSame >= 0.5 && asSame >= 0.5;
    const sameScore = sameOk ? hsSame + asSame : 0;
    // Swapped orientation — happens when FS lists home/away inverted vs odds-api
    // (observed: hockey IIHF Switzerland-Finland vs FS Finland-Switzerland;
    //  esports Misa-Dark Passage vs FS Dark Passage-Misa).
    const hsSwap = teamMatchScore(ev.home, fs.awayTeam);
    const asSwap = teamMatchScore(ev.away, fs.homeTeam);
    const swapOk = hsSwap >= 0.5 && asSwap >= 0.5;
    const swapScore = swapOk ? hsSwap + asSwap : 0;

    let combined = 0;
    let swapped = false;
    if (sameScore >= swapScore && sameOk) {
      combined = sameScore;
    } else if (swapOk) {
      combined = swapScore;
      swapped = true;
    } else {
      continue;
    }

    if (combined > bestScore) {
      bestScore = combined;
      bestIdx = i;
      bestSwapped = swapped;
    }
  }
  if (bestScore <= 1.0) return { idx: -1, score: bestScore, swapped: false };
  return { idx: bestIdx, score: bestScore, swapped: bestSwapped };
}

/**
 * Return a clone of the FS payload with home/away inverted (incl. score and
 * any incidents tagged team=1/2). Used when findFuzzyMatch reports `swapped:true`
 * so downstream `computeEnrichmentUpdate` can treat the FS data as if it were
 * already aligned with the events_v2 row's orientation.
 */
export function swapFsLiveOrientation(fs: FlashscoreLive): FlashscoreLive {
  const swapped: FlashscoreLive = {
    ...fs,
    homeTeam: fs.awayTeam,
    awayTeam: fs.homeTeam,
    scoreHome: fs.scoreAway,
    scoreAway: fs.scoreHome,
    periods: fs.periods.map((p) => [p[1], p[0]]),
  };
  if (fs.summary) {
    swapped.summary = {
      ...fs.summary,
      periods: fs.summary.periods.map((p) => ({
        ...p,
        homeScore: p.awayScore,
        awayScore: p.homeScore,
        homeTiebreak: p.awayTiebreak,
        awayTiebreak: p.homeTiebreak,
      })),
      incidents: fs.summary.incidents.map((inc) => ({
        ...inc,
        team: inc.team === 1 ? 2 : 1,
        scoreAfter: inc.scoreAfter
          ? { home: inc.scoreAfter.away, away: inc.scoreAfter.home }
          : undefined,
      })),
    };
  }
  if (fs.stats) {
    swapped.stats = fs.stats.map((s) => ({
      ...s,
      home: s.away,
      away: s.home,
    }));
  }
  return swapped;
}

function arraysEqual(a: number[] | undefined, b: number[] | undefined): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function periodsEqual(
  a: FlashscoreSummary["periods"] | undefined,
  b: FlashscoreSummary["periods"]
): boolean {
  if (!a) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].name !== b[i].name ||
      a[i].homeScore !== b[i].homeScore ||
      a[i].awayScore !== b[i].awayScore
    )
      return false;
  }
  return true;
}

function shallowMetaEqual(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown>
): boolean {
  if (!a) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  }
  return true;
}

function statsEqual(
  a: FlashscoreStat[] | undefined,
  b: FlashscoreStat[]
): boolean {
  if (!a) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].name !== b[i].name ||
      a[i].home !== b[i].home ||
      a[i].away !== b[i].away
    )
      return false;
  }
  return true;
}

interface IncidentLike {
  id?: unknown;
}

/**
 * Diff helper: returns ids present in `next` but not in `prior`.
 * Used by FS live route to detect newly arrived incidents (cards/goals/subs)
 * and trigger a Sofa enrichment refresh via Redis pub/sub.
 * Skips entries with falsy/non-string id.
 */
export function findNewIncidentIds(
  prior: IncidentLike[] | null | undefined,
  next: IncidentLike[] | null | undefined,
): string[] {
  if (!Array.isArray(next)) return [];
  const priorSet = new Set<string>();
  if (Array.isArray(prior)) {
    for (const p of prior) {
      if (typeof p?.id === 'string' && p.id) priorSet.add(p.id);
    }
  }
  const out: string[] = [];
  for (const n of next) {
    if (typeof n?.id === 'string' && n.id && !priorSet.has(n.id)) out.push(n.id);
  }
  return out;
}
