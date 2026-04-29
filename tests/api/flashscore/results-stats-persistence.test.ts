// tests/api/flashscore/results-stats-persistence.test.ts
//
// Task 0.5.B: verify the /api/flashscore/results POST pipeline persists
// match stats into live_data. Root cause of the bug: the pipeline
// stamped settled_at without ever calling fetchMatchDetail, and the
// verify-results cron (which does fetch detail) filters settled_at IS NULL,
// losing the race every time. ~99.4% of events ended up with stats=[].
//
// We unit-test the pure helper `buildUpdatedLiveData` because the POST
// handler embeds a real fetch to the Flashscore feed and a Supabase
// client construction at module load — unit-testing it directly would
// require heavy DI refactoring. The helper owns the critical logic:
//   - merging with existing live_data (preserve previous stats on empty fetch)
//   - setting .stats only when non-empty (idempotency)
//   - still emitting verified_by / verified_at / flashscore_id / halfScores

import { describe, it, expect } from "vitest";
import { buildUpdatedLiveData } from "@/app/api/flashscore/results/_lib";
import type { FlashscoreStat } from "@/lib/flashscore";

// periods: [[homeP1, awayP1], [homeP2, awayP2], ...]
const fsPeriods: number[][] = [
  [1, 0],
  [1, 2],
];

const fsResult = {
  matchId: "fs-abc-123",
  periods: fsPeriods,
};

const sampleStats: FlashscoreStat[] = [
  { name: "Partita: Calci d'angolo", home: 5, away: 6 },
  { name: "Partita: Tiri totali", home: 12, away: 9 },
];

describe("buildUpdatedLiveData (flashscore/results stats persistence)", () => {
  it("persists matchStats into live_data.stats when detail returned stats", () => {
    const result = buildUpdatedLiveData({
      existingLiveData: null,
      sport: "calcio",
      fsResult,
      matchStats: sampleStats,
      now: "2026-04-24T12:00:00.000Z",
    });
    expect(result.stats).toEqual(sampleStats);
    expect(result.verified_by).toBe("flashscore");
    expect(result.verified_at).toBe("2026-04-24T12:00:00.000Z");
    expect(result.flashscore_id).toBe("fs-abc-123");
  });

  it("preserves existing live_data.stats when fetch returned no stats (idempotency)", () => {
    // This is the critical bug-fix regression test. If this test fails,
    // we're clobbering good stats with empty [] whenever FS rate-limits us.
    const previousStats: FlashscoreStat[] = [
      { name: "Partita: Calci d'angolo", home: 3, away: 4 },
    ];
    const result = buildUpdatedLiveData({
      existingLiveData: {
        stats: previousStats,
        some_other_key: "should-survive",
      },
      sport: "calcio",
      fsResult,
      matchStats: [], // empty — e.g. FS detail fetch failed
    });
    expect(result.stats).toEqual(previousStats);
    expect(result.some_other_key).toBe("should-survive");
  });

  it("does NOT set .stats on a fresh event when fetch returned nothing", () => {
    const result = buildUpdatedLiveData({
      existingLiveData: null,
      sport: "calcio",
      fsResult,
      matchStats: [],
    });
    expect("stats" in result).toBe(false);
  });

  it("still writes halfScores for calcio when periods are present", () => {
    const result = buildUpdatedLiveData({
      existingLiveData: null,
      sport: "calcio",
      fsResult,
      matchStats: [],
    });
    expect(result.halfScoreHome).toBeDefined();
    expect(result.halfScoreAway).toBeDefined();
  });

  it("overrides verified_by even if existing live_data had a different source", () => {
    const result = buildUpdatedLiveData({
      existingLiveData: { verified_by: "betexplorer" },
      sport: "calcio",
      fsResult,
      matchStats: sampleStats,
    });
    expect(result.verified_by).toBe("flashscore");
  });
});
