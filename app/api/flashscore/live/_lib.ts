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

  // score overwrite
  const isTennisLike = ["tennis", "tennis_tavolo", "tennis tavolo", "volley", "volleyball", "badminton"]
    .includes(sport.toLowerCase());
  const upstreamLikelyWrong =
    isTennisLike && ev.score_home != null && (ev.score_home >= 15 || (ev.score_away ?? 0) >= 15);
  if (fs.scoreHome != null && fs.scoreAway != null) {
    if (ev.score_home == null || ev.score_away == null || upstreamLikelyWrong) {
      if (fs.scoreHome !== ev.score_home) update.score_home = fs.scoreHome;
      if (fs.scoreAway !== ev.score_away) update.score_away = fs.scoreAway;
    }
  }

  return { update: Object.keys(update).length === 0 ? null : update };
}

export function findFuzzyMatch(
  ev: V2LiveEvent,
  candidates: FlashscoreLive[],
  used: Set<number>,
): { idx: number; score: number } {
  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < candidates.length; i++) {
    if (used.has(i)) continue;
    const fs = candidates[i];
    if (fs.timestamp && ev.starts_at) {
      const dbTime = new Date(ev.starts_at).getTime() / 1000;
      if (Math.abs(dbTime - fs.timestamp) > 4 * 3600) continue;
    }
    const hs = teamMatchScore(ev.home, fs.homeTeam);
    const as = teamMatchScore(ev.away, fs.awayTeam);
    if (hs < 0.5 || as < 0.5) continue;
    const combined = hs + as;
    if (combined > bestScore) {
      bestScore = combined;
      bestIdx = i;
    }
  }
  if (bestScore <= 1.0) return { idx: -1, score: bestScore };
  return { idx: bestIdx, score: bestScore };
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
