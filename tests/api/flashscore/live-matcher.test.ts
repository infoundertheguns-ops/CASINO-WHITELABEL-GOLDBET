import { describe, it, expect } from "vitest";
import { computeEnrichmentUpdate, findFuzzyMatch } from "@/app/api/flashscore/live/_lib";
import type { FlashscoreLive } from "@/lib/flashscore";

const baseEv = {
  id: "evt-1",
  home: "Inter",
  away: "Milan",
  score_home: null,
  score_away: null,
  starts_at: "2026-05-06T20:00:00Z",
  period: null,
  minute: null,
  live_data: null,
  flashscore_id: null,
};

const baseFs: FlashscoreLive = {
  matchId: "fs-1",
  homeTeam: "Inter",
  awayTeam: "Milan",
  scoreHome: 1,
  scoreAway: 0,
  periods: [[1, 0]],
  timestamp: 0,
  stageCode: "2",
  country: "",
  league: "",
  sport: "",
};

describe("computeEnrichmentUpdate", () => {
  it("returns null update when nothing has changed", () => {
    const { update } = computeEnrichmentUpdate({
      ev: { ...baseEv, score_home: 1, score_away: 0, period: "1T", live_data: { halfScoreHome: [1], halfScoreAway: [0] } },
      fs: baseFs,
      sport: "calcio",
    });
    expect(update).toBeNull();
  });

  it("sets period from periods.length when DB has none", () => {
    const { update } = computeEnrichmentUpdate({
      ev: baseEv,
      fs: { ...baseFs, periods: [[1, 0]] },
      sport: "calcio",
    });
    expect(update?.period).toBe("1T");
  });

  it("merges halfScoreHome/Away into live_data", () => {
    const { update } = computeEnrichmentUpdate({
      ev: baseEv,
      fs: { ...baseFs, periods: [[1, 0], [2, 1]] },
      sport: "calcio",
    });
    const ld = update?.live_data as Record<string, unknown>;
    expect(ld.halfScoreHome).toEqual([1, 2]);
    expect(ld.halfScoreAway).toEqual([0, 1]);
  });

  it("preserves existing live_data keys not touched by FS", () => {
    const { update } = computeEnrichmentUpdate({
      ev: { ...baseEv, live_data: { stats: [{ name: "Corners", home: 5, away: 3 }] } },
      fs: { ...baseFs, periods: [[1, 0]] },
      sport: "calcio",
    });
    const ld = update?.live_data as Record<string, unknown>;
    expect(ld.stats).toEqual([{ name: "Corners", home: 5, away: 3 }]);
    expect(ld.halfScoreHome).toEqual([1]);
  });

  it("overwrites score when DB null", () => {
    const { update } = computeEnrichmentUpdate({
      ev: baseEv,
      fs: { ...baseFs, scoreHome: 2, scoreAway: 1 },
      sport: "calcio",
    });
    expect(update?.score_home).toBe(2);
    expect(update?.score_away).toBe(1);
  });

  it("FS authoritative: overwrites score even when DB already has values (football)", () => {
    // Prior code gated overwrite on ev.score_home == null. With Opzione B, FS is
    // authoritative for live score (polls every 5s while OddsAPI lags ~141s and
    // writes NULL transient). See docs/superpowers/plans/2026-05-13-score-coherence.md
    // and pending-player-v1-score-coherence (FC Zlin 2-3 vs OddsAPI 2-2 stale).
    const { update } = computeEnrichmentUpdate({
      ev: { ...baseEv, score_home: 2, score_away: 2 },         // OddsAPI stale
      fs: { ...baseFs, scoreHome: 2, scoreAway: 3 },           // FS fresh, real score
      sport: "calcio",
    });
    // score_home not set in update because fs == ev (2 == 2), no diff to write
    expect(update?.score_home).toBeUndefined();
    // score_away overwritten 2 → 3 (FS authoritative, gate dropped)
    expect(update?.score_away).toBe(3);
  });

  it("FS authoritative: overwrites both sides when FS reports newer values (basketball)", () => {
    const { update } = computeEnrichmentUpdate({
      ev: { ...baseEv, score_home: 50, score_away: 48 },
      fs: { ...baseFs, scoreHome: 66, scoreAway: 65, periods: [[16, 18], [22, 20], [18, 15], [10, 12]] },
      sport: "basketball",
    });
    expect(update?.score_home).toBe(66);
    expect(update?.score_away).toBe(65);
  });

  it("tennis: FS sets overwrite stale OddsAPI sets (defensive — FS reports sets at top level)", () => {
    const { update } = computeEnrichmentUpdate({
      ev: { ...baseEv, score_home: 1, score_away: 0 },
      fs: { ...baseFs, scoreHome: 2, scoreAway: 0, periods: [[6,3],[6,4]] },
      sport: "tennis",
    });
    expect(update?.score_home).toBe(2);
    // fs.scoreAway === ev.score_away (both 0) → diff-only contract emits nothing
    expect(update?.score_away).toBeUndefined();
  });


  it("derives score sum for basketball when fs.scoreHome null but halfScoreHome populated", () => {
    const { update } = computeEnrichmentUpdate({
      ev: baseEv,
      fs: { ...baseFs, scoreHome: null, scoreAway: null, periods: [[16, 18], [22, 20], [18, 15], [10, 12]] },
      sport: "basketball",
    });
    expect(update?.score_home).toBe(66);
    expect(update?.score_away).toBe(65);
  });

  it("derives score sum for baseball when fs.scoreHome null", () => {
    const { update } = computeEnrichmentUpdate({
      ev: baseEv,
      fs: { ...baseFs, scoreHome: null, scoreAway: null, periods: [[0,1],[1,0],[0,0],[3,2],[0,0]] },
      sport: "baseball",
    });
    expect(update?.score_home).toBe(4);
    expect(update?.score_away).toBe(3);
  });

  it("does NOT derive score sum for football (HT score not equal full game)", () => {
    const { update } = computeEnrichmentUpdate({
      ev: baseEv,
      fs: { ...baseFs, scoreHome: null, scoreAway: null, periods: [[2, 1]] },
      sport: "calcio",
    });
    expect(update?.score_home).toBeUndefined();
    expect(update?.score_away).toBeUndefined();
  });

  it("does NOT derive score sum for tennis (set semantics, not points)", () => {
    const { update } = computeEnrichmentUpdate({
      ev: baseEv,
      fs: { ...baseFs, scoreHome: null, scoreAway: null, periods: [[6, 3], [4, 6], [6, 4]] },
      sport: "tennis",
    });
    expect(update?.score_home).toBeUndefined();
    expect(update?.score_away).toBeUndefined();
  });

    it("DOES overwrite tennis score when DB looks like game-points (>=15)", () => {
    const { update } = computeEnrichmentUpdate({
      ev: { ...baseEv, score_home: 30, score_away: 15 },
      fs: { ...baseFs, scoreHome: 1, scoreAway: 0 },
      sport: "tennis",
    });
    expect(update?.score_home).toBe(1);
    expect(update?.score_away).toBe(0);
  });

  it("derives Frame N for snooker from score sum", () => {
    const { update } = computeEnrichmentUpdate({
      ev: baseEv,
      fs: { ...baseFs, periods: [], scoreHome: 2, scoreAway: 1 },
      sport: "snooker",
    });
    expect(update?.period).toBe("Frame 4");
  });

  it("derives Leg N for darts from score sum", () => {
    const { update } = computeEnrichmentUpdate({
      ev: baseEv,
      fs: { ...baseFs, periods: [], scoreHome: 1, scoreAway: 2 },
      sport: "freccette",
    });
    expect(update?.period).toBe("Leg 4");
  });
});

describe("findFuzzyMatch", () => {
  const liveCandidates: FlashscoreLive[] = [
    { ...baseFs, matchId: "fs-a", homeTeam: "Inter Milano", awayTeam: "AC Milan", timestamp: new Date(baseEv.starts_at).getTime() / 1000 },
    { ...baseFs, matchId: "fs-b", homeTeam: "Roma", awayTeam: "Lazio", timestamp: new Date(baseEv.starts_at).getTime() / 1000 },
  ];

  it("returns best-scoring fuzzy match within window", () => {
    const result = findFuzzyMatch(baseEv, liveCandidates, new Set());
    expect(result.idx).toBe(0);
    expect(result.score).toBeGreaterThan(1.0);
  });

  it("skips already-used candidates", () => {
    const result = findFuzzyMatch(baseEv, liveCandidates, new Set([0]));
    expect(result.idx).toBe(-1);
  });

  it("rejects matches outside ±4h window", () => {
    const farPast = liveCandidates.map((c) => ({ ...c, timestamp: 86400 })); // 1970-01-02 — non-zero so window check runs
    const result = findFuzzyMatch(baseEv, farPast, new Set());
    expect(result.idx).toBe(-1);
  });

  it("rejects when team-name score below threshold", () => {
    const wrong = [{ ...baseFs, matchId: "fs-c", homeTeam: "Bayern", awayTeam: "Dortmund", timestamp: new Date(baseEv.starts_at).getTime() / 1000 }];
    const result = findFuzzyMatch(baseEv, wrong, new Set());
    expect(result.idx).toBe(-1);
  });
});
