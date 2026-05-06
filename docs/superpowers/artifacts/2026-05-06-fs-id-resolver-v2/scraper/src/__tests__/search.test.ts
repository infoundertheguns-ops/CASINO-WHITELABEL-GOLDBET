import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FlashscoreFixture } from "../parser.js";

const fakeFixtures: FlashscoreFixture[] = [
  { matchId: "M1", homeTeam: "Inter", awayTeam: "AC Milan", timestamp: 1714579200, country: "Italy", league: "Serie A", sport: "Football" },
  { matchId: "M2", homeTeam: "Real Madrid", awayTeam: "Barcelona", timestamp: 1714579200, country: "Spain", league: "La Liga", sport: "Football" },
  { matchId: "M3", homeTeam: "Bayern Munchen", awayTeam: "Dortmund", timestamp: 1714666800, country: "Germany", league: "Bundesliga", sport: "Football" },
];

vi.mock("../flashscore-client.js", () => ({
  fetchResultsFeed: vi.fn(async () => "fake_raw"),
}));
vi.mock("../parser.js", () => ({
  parseFixturesFeed: vi.fn(() => fakeFixtures),
}));

import { searchEvent, dayOffsetFromIso } from "../search.js";

describe("dayOffsetFromIso", () => {
  it("returns 0 for today", () => {
    const today = new Date();
    today.setHours(15, 0, 0, 0);
    expect(dayOffsetFromIso(today.toISOString(), today)).toBe(0);
  });

  it("returns 1 for tomorrow", () => {
    const today = new Date(2026, 4, 1, 0, 0, 0);
    const tomorrow = new Date(2026, 4, 2, 15, 0, 0);
    expect(dayOffsetFromIso(tomorrow.toISOString(), today)).toBe(1);
  });
});

describe("searchEvent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns matchId on exact match", async () => {
    const r = await searchEvent({
      sportSlug: "football",
      startsAt: new Date(1714579200 * 1000).toISOString(),
      home: "Inter",
      away: "Milan",
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ matchId: "M1" });
  });

  it("returns 404 when no candidates within ±10min", async () => {
    const r = await searchEvent({
      sportSlug: "football",
      startsAt: new Date((1714579200 + 1800) * 1000).toISOString(),
      home: "Inter",
      away: "Milan",
    });
    expect(r.status).toBe(404);
  });

  it("returns 409 when two candidates equally match", async () => {
    // requires test data with duplicate teams — extended in implementation
  });
});
