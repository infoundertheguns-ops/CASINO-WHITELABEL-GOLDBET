// M3.2 — Unit tests for buildResultFromAF.
//
// Covers:
//   - Score-derived fields from events_v2 columns
//   - period_scores shape variants ({firstHalf} vs {halftime})
//   - statistics_af mapping (type-string → AFTeamStats field)
//   - cards_total = cards_yellow + cards_red (red counted ONCE)
//   - Team identification by name (case-insensitive, trim) + positional fallback
//   - Robustness: null / missing / partial / string-percentage values
//   - Pass-through of players_af_ft / events_af
//   - Convenience aliases consistent with home_stats / away_stats

import { describe, it, expect } from "vitest";
import {
  buildResultFromAF,
  type EventForSettlement,
} from "@/lib/settlement/api-football/build-result-af";

function ev(overrides: Partial<EventForSettlement> = {}): EventForSettlement {
  return {
    home: "Manchester United",
    away: "Liverpool",
    score_home: 2,
    score_away: 1,
    period_scores: null,
    live_data: null,
    ...overrides,
  };
}

function stat(type: string, value: unknown) {
  return { type, value };
}

const FULL_STATS_HOME = [
  stat("Shots on Goal", 5),
  stat("Shots off Goal", 7),
  stat("Total Shots", 12),
  stat("Blocked Shots", 2),
  stat("Shots insidebox", 8),
  stat("Shots outsidebox", 4),
  stat("Fouls", 10),
  stat("Corner Kicks", 6),
  stat("Offsides", 3),
  stat("Ball Possession", "55%"),
  stat("Yellow Cards", 2),
  stat("Red Cards", 0),
  stat("Goalkeeper Saves", 4),
  stat("Total passes", 543),
  stat("Passes accurate", 478),
  stat("Passes %", "88%"),
];

const FULL_STATS_AWAY = [
  stat("Shots on Goal", 3),
  stat("Total Shots", 9),
  stat("Fouls", 14),
  stat("Corner Kicks", 4),
  stat("Offsides", 1),
  stat("Yellow Cards", 1),
  stat("Red Cards", 1),
  stat("Goalkeeper Saves", 6),
  stat("Ball Possession", "45%"),
];

describe("buildResultFromAF — score-derived", () => {
  it("maps score_home/score_away to home/away", () => {
    const r = buildResultFromAF(ev({ score_home: 2, score_away: 1 }));
    expect(r.home).toBe(2);
    expect(r.away).toBe(1);
  });

  it("derives ht_home/ht_away from period_scores.firstHalf (M1.11 shape)", () => {
    const r = buildResultFromAF(
      ev({
        score_home: 2,
        score_away: 1,
        period_scores: {
          firstHalf: { home: 1, away: 0 },
          secondHalf: { home: 1, away: 1 },
        },
      })
    );
    expect(r.ht_home).toBe(1);
    expect(r.ht_away).toBe(0);
  });

  it("derives ht_home/ht_away from period_scores.halftime (legacy passthrough)", () => {
    const r = buildResultFromAF(
      ev({
        period_scores: {
          halftime: { home: 0, away: 0 },
          fulltime: { home: 2, away: 1 },
        },
      })
    );
    expect(r.ht_home).toBe(0);
    expect(r.ht_away).toBe(0);
  });

  it("ht_home/ht_away are null when period_scores missing or malformed", () => {
    expect(buildResultFromAF(ev({ period_scores: null })).ht_home).toBeNull();
    expect(buildResultFromAF(ev({ period_scores: {} })).ht_home).toBeNull();
    expect(
      buildResultFromAF(ev({ period_scores: { firstHalf: { home: 1 } } as Record<string, unknown> })).ht_home
    ).toBeNull(); // away missing → reject the whole shape
  });

  it("defaults score_home/score_away to 0 when columns null", () => {
    const r = buildResultFromAF(ev({ score_home: null, score_away: null }));
    expect(r.home).toBe(0);
    expect(r.away).toBe(0);
  });
});

describe("buildResultFromAF — statistics_af mapping", () => {
  it("maps Total Shots / Shots on Goal / Corner Kicks / Fouls / Yellow / Red / Saves / Offsides", () => {
    const r = buildResultFromAF(
      ev({
        live_data: {
          statistics_af: [
            { team: { name: "Manchester United" }, statistics: FULL_STATS_HOME },
            { team: { name: "Liverpool" }, statistics: FULL_STATS_AWAY },
          ],
        },
      })
    );
    expect(r.home_stats).toEqual({
      shots: 12,
      shots_on_target: 5,
      corners: 6,
      offsides: 3,
      fouls: 10,
      cards_yellow: 2,
      cards_red: 0,
      cards_total: 2,
      goalkeeper_saves: 4,
    });
    expect(r.away_stats).toEqual({
      shots: 9,
      shots_on_target: 3,
      corners: 4,
      offsides: 1,
      fouls: 14,
      cards_yellow: 1,
      cards_red: 1,
      cards_total: 2,
      goalkeeper_saves: 6,
    });
  });

  it("cards_total = yellow + red (1 red counted once, not as 2)", () => {
    const r = buildResultFromAF(
      ev({
        live_data: {
          statistics_af: [
            {
              team: { name: "Manchester United" },
              statistics: [stat("Yellow Cards", 1), stat("Red Cards", 1)],
            },
          ],
        },
      })
    );
    expect(r.home_stats.cards_yellow).toBe(1);
    expect(r.home_stats.cards_red).toBe(1);
    expect(r.home_stats.cards_total).toBe(2);
  });

  it("skips string-percentage values (Ball Possession '55%' does not pollute)", () => {
    const r = buildResultFromAF(
      ev({
        live_data: {
          statistics_af: [
            {
              team: { name: "Manchester United" },
              statistics: [stat("Ball Possession", "55%"), stat("Passes %", "88%")],
            },
          ],
        },
      })
    );
    expect(r.home_stats).toEqual({}); // nothing accepted
    expect(r.shots_home).toBeUndefined();
  });

  it("drops null / non-numeric values without throwing", () => {
    const r = buildResultFromAF(
      ev({
        live_data: {
          statistics_af: [
            {
              team: { name: "Manchester United" },
              statistics: [
                stat("Total Shots", null),
                stat("Fouls", undefined),
                stat("Corner Kicks", "six"),
                stat("Yellow Cards", 2),
              ],
            },
          ],
        },
      })
    );
    expect(r.home_stats.shots).toBeUndefined();
    expect(r.home_stats.fouls).toBeUndefined();
    expect(r.home_stats.corners).toBeUndefined();
    expect(r.home_stats.cards_yellow).toBe(2);
    expect(r.home_stats.cards_total).toBe(2);
  });
});

describe("buildResultFromAF — team identification", () => {
  it("matches teams by name (case-insensitive, trim) even with reversed order", () => {
    const r = buildResultFromAF(
      ev({
        home: "Manchester United",
        away: "Liverpool",
        live_data: {
          statistics_af: [
            // api-football returned away first this time
            { team: { name: "  liverpool  " }, statistics: [stat("Corner Kicks", 4)] },
            { team: { name: "MANCHESTER UNITED" }, statistics: [stat("Corner Kicks", 6)] },
          ],
        },
      })
    );
    expect(r.home_stats.corners).toBe(6);
    expect(r.away_stats.corners).toBe(4);
    expect(r.corners_home).toBe(6);
    expect(r.corners_away).toBe(4);
  });

  it("falls back to positional [0]=home, [1]=away when names do not match", () => {
    const r = buildResultFromAF(
      ev({
        home: "Manchester United",
        away: "Liverpool",
        live_data: {
          statistics_af: [
            // Provider uses different names (e.g. "Man United" vs DB "Manchester United")
            { team: { name: "Man United" }, statistics: [stat("Corner Kicks", 6)] },
            { team: { name: "Reds" }, statistics: [stat("Corner Kicks", 4)] },
          ],
        },
      })
    );
    expect(r.home_stats.corners).toBe(6);
    expect(r.away_stats.corners).toBe(4);
  });
});

describe("buildResultFromAF — robustness", () => {
  it("returns AFResult with empty home_stats/away_stats when statistics_af missing", () => {
    const r = buildResultFromAF(ev({ live_data: {} }));
    expect(r.home_stats).toEqual({});
    expect(r.away_stats).toEqual({});
    expect(r.corners_home).toBeUndefined();
  });

  it("handles null statistics_af / null live_data", () => {
    expect(buildResultFromAF(ev({ live_data: null })).home_stats).toEqual({});
    expect(
      buildResultFromAF(ev({ live_data: { statistics_af: null } })).home_stats
    ).toEqual({});
  });

  it("handles empty statistics_af array", () => {
    const r = buildResultFromAF(ev({ live_data: { statistics_af: [] } }));
    expect(r.home_stats).toEqual({});
    expect(r.away_stats).toEqual({});
  });

  it("handles partial statistics_af (only one team present)", () => {
    const r = buildResultFromAF(
      ev({
        home: "Manchester United",
        away: "Liverpool",
        live_data: {
          statistics_af: [
            { team: { name: "Manchester United" }, statistics: FULL_STATS_HOME },
          ],
        },
      })
    );
    expect(r.home_stats.shots).toBe(12);
    expect(r.home_stats.corners).toBe(6);
    expect(r.away_stats).toEqual({});
    expect(r.corners_away).toBeUndefined();
  });
});

describe("buildResultFromAF — pass-through + aliases", () => {
  it("passes through players_af_ft and events_af untouched", () => {
    const playersPayload = { response: [{ team: { id: 33 }, players: [] }] };
    const eventsPayload = [{ time: { elapsed: 45 }, type: "Goal" }];
    const r = buildResultFromAF(
      ev({
        live_data: {
          players_af_ft: playersPayload,
          events_af: eventsPayload,
        },
      })
    );
    expect(r.players_af_ft).toBe(playersPayload);
    expect(r.events_af).toBe(eventsPayload);
  });

  it("convenience aliases are consistent with home_stats / away_stats", () => {
    const r = buildResultFromAF(
      ev({
        live_data: {
          statistics_af: [
            { team: { name: "Manchester United" }, statistics: FULL_STATS_HOME },
            { team: { name: "Liverpool" }, statistics: FULL_STATS_AWAY },
          ],
        },
      })
    );
    expect(r.shots_home).toBe(r.home_stats.shots);
    expect(r.shots_away).toBe(r.away_stats.shots);
    expect(r.sot_home).toBe(r.home_stats.shots_on_target);
    expect(r.sot_away).toBe(r.away_stats.shots_on_target);
    expect(r.corners_home).toBe(r.home_stats.corners);
    expect(r.corners_away).toBe(r.away_stats.corners);
    expect(r.cards_home).toBe(r.home_stats.cards_total);
    expect(r.cards_away).toBe(r.away_stats.cards_total);
    expect(r.offsides_home).toBe(r.home_stats.offsides);
    expect(r.offsides_away).toBe(r.away_stats.offsides);
    expect(r.fouls_home).toBe(r.home_stats.fouls);
    expect(r.fouls_away).toBe(r.away_stats.fouls);
    expect(r.gk_saves_home).toBe(r.home_stats.goalkeeper_saves);
    expect(r.gk_saves_away).toBe(r.away_stats.goalkeeper_saves);
  });

  it("aliases are undefined (not 0) when underlying stat absent", () => {
    const r = buildResultFromAF(
      ev({
        live_data: {
          statistics_af: [
            { team: { name: "Manchester United" }, statistics: [stat("Fouls", 10)] },
            { team: { name: "Liverpool" }, statistics: [stat("Fouls", 14)] },
          ],
        },
      })
    );
    expect(r.shots_home).toBeUndefined();
    expect(r.corners_home).toBeUndefined();
    expect(r.fouls_home).toBe(10);
    expect(r.fouls_away).toBe(14);
  });
});
