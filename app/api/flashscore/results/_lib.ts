// app/api/flashscore/results/_lib.ts
//
// Pure helpers for the /api/flashscore/results POST pipeline. Extracted
// so they can be unit-tested without dragging in the Next.js route
// module (Next.js App Router forbids arbitrary named exports from
// route.ts files — only HTTP method handlers + config are allowed).

import { buildHalfScores } from "@/lib/flashscore";
import type { FlashscoreResult, FlashscoreStat } from "@/lib/flashscore";

/**
 * Assemble the updated `live_data` payload from its constituent parts.
 *
 * Idempotency rule (important — see Task 0.5.B root cause analysis):
 *   - If `matchStats` is empty/undefined we DO NOT set `.stats` at all.
 *     This preserves any stats previously ingested by the verify-results
 *     cron and avoids clobbering good data with `[]` when the FS detail
 *     fetch fails (rate-limit, stale fsid, still-live state, etc.).
 */
export function buildUpdatedLiveData(params: {
  existingLiveData: Record<string, unknown> | null;
  sport: string;
  fsResult: Pick<FlashscoreResult, "matchId" | "periods">;
  matchStats: FlashscoreStat[];
  now?: string;
}): Record<string, unknown> {
  const { existingLiveData, sport, fsResult, matchStats } = params;
  const halfScores = buildHalfScores(sport, fsResult.periods);

  const updatedLiveData: Record<string, unknown> = {
    ...(existingLiveData || {}),
    verified_by: "flashscore",
    verified_at: params.now ?? new Date().toISOString(),
    flashscore_id: fsResult.matchId,
  };

  if (halfScores) {
    updatedLiveData.halfScoreHome = halfScores.home;
    updatedLiveData.halfScoreAway = halfScores.away;
  }

  // Only set stats when we have non-empty data — preserves existing stats
  // when the FS detail fetch fails.
  if (matchStats.length > 0) {
    updatedLiveData.stats = matchStats;
  }

  return updatedLiveData;
}
