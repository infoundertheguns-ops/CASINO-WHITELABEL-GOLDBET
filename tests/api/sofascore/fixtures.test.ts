import { describe, it, expect } from "vitest";
import { mapSofaSport, matchSofaToCandidate, type SofaFixture, type Candidate } from "@/app/api/sofascore/fixtures/_lib";

describe("mapSofaSport", () => {
  it("maps known sports", () => {
    expect(mapSofaSport("football")).toBe("calcio");
    expect(mapSofaSport("tennis")).toBe("tennis");
    expect(mapSofaSport("basketball")).toBe("basket");
  });
  it("returns null for unknown", () => {
    expect(mapSofaSport("snooker")).toBeNull();
  });
});

describe("matchSofaToCandidate", () => {
  const baseFx: SofaFixture = {
    sofa_event_id: 1, sofa_sport: "football",
    home: "FC Bayern München", away: "Paris Saint-Germain",
    kickoff_at: "2026-05-07T19:00:00Z",
    sofa_status: "finished",
    tournament_name: "UEFA Champions League", category_name: "Europe",
  };
  const baseC: Candidate = {
    id: "uuid-1", sport_slug: "calcio",
    home: "Bayern Munich", away: "PSG",
    starts_at: "2026-05-07T19:05:00Z",
    status: "live", sofascore_id: null,
  };

  it("returns matched_fuzzy on close name + kickoff", () => {
    const r = matchSofaToCandidate(baseFx, [baseC]);
    expect(r.kind).toBe("matched_fuzzy");
    if (r.kind === "matched_fuzzy") expect(r.candidate.id).toBe("uuid-1");
  });

  it("returns matched_direct when candidate already has sofascore_id matching fixture", () => {
    const r = matchSofaToCandidate(baseFx, [{ ...baseC, sofascore_id: 1 }]);
    expect(r.kind).toBe("matched_direct");
  });

  it("returns no_time_window when kickoff diff > 20min", () => {
    const r = matchSofaToCandidate(baseFx, [{ ...baseC, starts_at: "2026-05-07T20:30:00Z" }]);
    expect(r.kind).toBe("no_time_window");
  });

  it("returns no_match_name when names too different", () => {
    const r = matchSofaToCandidate(baseFx, [{ ...baseC, home: "Inter Milan", away: "AC Milan" }]);
    expect(r.kind).toBe("no_match_name");
  });

  it("does NOT match across sports", () => {
    const r = matchSofaToCandidate(baseFx, [{ ...baseC, sport_slug: "basket" }]);
    expect(r.kind).toBe("no_time_window");
  });

  it("ignores already-mapped candidates with different sofa_event_id", () => {
    const r = matchSofaToCandidate(baseFx, [{ ...baseC, sofascore_id: 99 }]);
    expect(r.kind).toBe("no_time_window");
  });

  it("returns skipped_unknown_sport for unsupported sofa_sport", () => {
    const r = matchSofaToCandidate({ ...baseFx, sofa_sport: "rugby" }, [baseC]);
    expect(r.kind).toBe("skipped_unknown_sport");
  });
});
