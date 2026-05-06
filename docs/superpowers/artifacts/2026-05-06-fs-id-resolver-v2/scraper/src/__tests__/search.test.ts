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
import { fetchResultsFeed } from "../flashscore-client.js";
import { parseFixturesFeed } from "../parser.js";

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

describe("searchEvent — telemetry reason tags", () => {
  // Use distinct event timestamps per telemetry test so the module-level cache
  // (keyed by sport_id-day_offset) doesn't collide with entries populated by
  // earlier "searchEvent" tests above.
  const TS_FEED_EMPTY = 1716307200;       // ~2024-05-21
  const TS_TIME_MISS  = 1718000000;       // ~2024-06-10
  const TS_NAME_MISS  = 1720000000;       // ~2024-07-03

  beforeEach(() => vi.clearAllMocks());

  it("returns 404 with reason 'feed_empty' when feed returns null/empty for all 3 day-offsets", async () => {
    vi.mocked(fetchResultsFeed).mockResolvedValue(null);
    vi.mocked(parseFixturesFeed).mockReturnValue([]);

    const r = await searchEvent({
      sportSlug: "football",
      startsAt: new Date(TS_FEED_EMPTY * 1000).toISOString(),
      home: "Inter",
      away: "Milan",
    });
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ error: "no_match", reason: "feed_empty" });
  });

  it("returns 404 with reason 'time_window_miss' when fixtures exist but timestamps fall outside ±10min", async () => {
    const farFixtures: FlashscoreFixture[] = [
      { matchId: "M1", homeTeam: "Inter", awayTeam: "AC Milan", timestamp: TS_TIME_MISS, country: "Italy", league: "Serie A", sport: "Football" },
    ];
    vi.mocked(fetchResultsFeed).mockResolvedValue("fake_raw");
    vi.mocked(parseFixturesFeed).mockReturnValue(farFixtures);

    // Event timestamp 30min after any fixture → all fixtures fall outside ±10min window
    const r = await searchEvent({
      sportSlug: "football",
      startsAt: new Date((TS_TIME_MISS + 1800) * 1000).toISOString(),
      home: "Inter",
      away: "Milan",
    });
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ error: "no_match", reason: "time_window_miss" });
  });

  it("returns 404 with reason 'name_mismatch' when in-window fixtures exist but team names don't match", async () => {
    const inWindowFixtures: FlashscoreFixture[] = [
      { matchId: "M1", homeTeam: "Some Other FC", awayTeam: "Random Town", timestamp: TS_NAME_MISS, country: "X", league: "Y", sport: "Football" },
    ];
    vi.mocked(fetchResultsFeed).mockResolvedValue("fake_raw");
    vi.mocked(parseFixturesFeed).mockReturnValue(inWindowFixtures);

    const r = await searchEvent({
      sportSlug: "football",
      startsAt: new Date(TS_NAME_MISS * 1000).toISOString(),
      home: "Inter",
      away: "Milan",
    });
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ error: "no_match", reason: "name_mismatch" });
  });
});
