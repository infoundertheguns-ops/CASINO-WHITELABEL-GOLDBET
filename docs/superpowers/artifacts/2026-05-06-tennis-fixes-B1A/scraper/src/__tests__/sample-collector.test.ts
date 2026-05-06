import { describe, it, expect, beforeEach } from "vitest";
import { SampleCollector, type FailedSample } from "../sample-collector.js";

function mk(overrides: Partial<FailedSample> = {}): FailedSample {
  return {
    ts: Date.now(),
    sport_slug: "tennis",
    query_home: "Sinner J.",
    query_away: "Alcaraz C.",
    starts_at: "2026-05-07T14:00:00Z",
    reason: "name_mismatch",
    fs_candidates: [],
    ...overrides,
  };
}

describe("SampleCollector", () => {
  let c: SampleCollector;
  beforeEach(() => { c = new SampleCollector(); });

  it("records a sample under its sport slug", () => {
    c.record(mk({ sport_slug: "tennis" }));
    expect(c.getSamples("tennis", undefined, 10)).toHaveLength(1);
  });

  it("FIFO-shifts past cap (500)", () => {
    for (let i = 0; i < 502; i++) c.record(mk({ query_home: `H${i}` }));
    const got = c.getSamples("tennis", undefined, 1000);
    expect(got).toHaveLength(500);
    expect(got[0].query_home).toBe("H501");
    expect(got[got.length - 1].query_home).toBe("H2");
  });

  it("filters by reason when provided", () => {
    c.record(mk({ reason: "name_mismatch", query_home: "A" }));
    c.record(mk({ reason: "time_window_miss", query_home: "B" }));
    c.record(mk({ reason: "name_mismatch", query_home: "C" }));
    const nm = c.getSamples("tennis", "name_mismatch", 10);
    expect(nm.map(s => s.query_home)).toEqual(["C", "A"]);
  });

  it("clamps limit to [1, 500]", () => {
    for (let i = 0; i < 50; i++) c.record(mk({ query_home: `H${i}` }));
    expect(c.getSamples("tennis", undefined, 0)).toHaveLength(1);
    expect(c.getSamples("tennis", undefined, -5)).toHaveLength(1);
    expect(c.getSamples("tennis", undefined, 9999)).toHaveLength(50);
  });

  it("returns most-recent first", () => {
    c.record(mk({ query_home: "first" }));
    c.record(mk({ query_home: "second" }));
    c.record(mk({ query_home: "third" }));
    const got = c.getSamples("tennis", undefined, 10);
    expect(got.map(s => s.query_home)).toEqual(["third", "second", "first"]);
  });

  it("returns empty array for unknown sport_slug", () => {
    expect(c.getSamples("cricket", undefined, 10)).toEqual([]);
  });
});
