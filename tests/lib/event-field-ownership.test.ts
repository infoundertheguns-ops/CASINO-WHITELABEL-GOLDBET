import { describe, it, expect } from "vitest";
import { FIELD_OWNERSHIP_FOOTBALL } from "@/lib/event-field-ownership";

describe("FIELD_OWNERSHIP_FOOTBALL", () => {
  it("declares api-football as owner of timer/score columns (post-M2)", () => {
    expect(FIELD_OWNERSHIP_FOOTBALL["events_v2.minute"]).toBe("api-football");
    expect(FIELD_OWNERSHIP_FOOTBALL["events_v2.period"]).toBe("api-football");
    expect(FIELD_OWNERSHIP_FOOTBALL["events_v2.score_home"]).toBe("api-football");
    expect(FIELD_OWNERSHIP_FOOTBALL["events_v2.score_away"]).toBe("api-football");
    expect(FIELD_OWNERSHIP_FOOTBALL["events_v2.period_scores"]).toBe("api-football");
  });

  it("declares fs-scraper as owner of country/league columns", () => {
    expect(FIELD_OWNERSHIP_FOOTBALL["events_v2.country_fs"]).toBe("fs-scraper");
    expect(FIELD_OWNERSHIP_FOOTBALL["events_v2.league_fs"]).toBe("fs-scraper");
  });

  it("declares fs-scraper as owner of incidents/stats/matchMeta", () => {
    expect(FIELD_OWNERSHIP_FOOTBALL["events_v2.live_data.incidents"]).toBe("fs-scraper");
    expect(FIELD_OWNERSHIP_FOOTBALL["events_v2.live_data.stats"]).toBe("fs-scraper");
    expect(FIELD_OWNERSHIP_FOOTBALL["events_v2.live_data.matchMeta"]).toBe("fs-scraper");
    expect(FIELD_OWNERSHIP_FOOTBALL["events_v2.live_data.fs_pregame"]).toBe("fs-scraper");
  });

  it("declares api-football as owner of all _af-suffixed live_data sub-keys", () => {
    const keys = Object.keys(FIELD_OWNERSHIP_FOOTBALL).filter(
      (k) => k.endsWith("_af") || k.includes("_af_")
    );
    expect(keys.length).toBeGreaterThanOrEqual(7);
    for (const k of keys) {
      expect(
        FIELD_OWNERSHIP_FOOTBALL[k as keyof typeof FIELD_OWNERSHIP_FOOTBALL]
      ).toBe("api-football");
    }
  });

  it("has no overlapping ownership claims", () => {
    // Each field should be claimed by exactly one owner — no duplicates
    const keys = Object.keys(FIELD_OWNERSHIP_FOOTBALL);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
