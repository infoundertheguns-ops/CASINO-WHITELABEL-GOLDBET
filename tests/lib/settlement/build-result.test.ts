import { describe, it, expect } from "vitest";
import { __test__buildResult } from "@/lib/settlement";

describe("buildResult — per-team per-period stat integration", () => {
  it("populates FT/HT/SH corners + cards + shots from Italian feed", () => {
    const event = {
      score_home: 2,
      score_away: 1,
      live_data: {
        halfScoreHome: [1, 1],
        halfScoreAway: [0, 1],
        stats: [
          { name: "Partita: Calci d'angolo", home: 5, away: 6 },
          { name: "1 Tempo: Calci d'angolo", home: 2, away: 0 },
          { name: "2 Tempo: Calci d'angolo", home: 3, away: 6 },
          { name: "Partita: Cartellini gialli", home: 4, away: 2 },
          { name: "1 Tempo: Cartellini gialli", home: 2, away: 0 },
          { name: "Partita: Tiri totali", home: 11, away: 2 },
          { name: "1 Tempo: Tiri totali", home: 7, away: 0 },
          { name: "2 Tempo: Tiri totali", home: 4, away: 2 },
          { name: "Partita: Tiri in porta", home: 5, away: 1 },
          { name: "1 Tempo: Tiri in porta", home: 4, away: 0 },
        ],
      },
    };
    const sr = __test__buildResult(event, undefined, "calcio");
    expect(sr).not.toBeNull();
    expect(sr!.corners_home).toBe(5);
    expect(sr!.corners_away).toBe(6);
    expect(sr!.ht_corners_home).toBe(2);
    expect(sr!.sh_corners_home).toBe(3);
    expect(sr!.sh_corners_away).toBe(6);
    expect(sr!.cards_total).toBe(6);
    expect(sr!.ht_cards_total).toBe(2);
    expect(sr!.shots_total_home).toBe(11);
    expect(sr!.ht_shots_total_home).toBe(7);
    expect(sr!.sh_shots_total_away).toBe(2);
    expect(sr!.shots_on_target_home).toBe(5);
    expect(sr!.ht_shots_on_target_home).toBe(4);
  });

  it("sh_cards remains undefined when only ht_cards present", () => {
    const event = {
      score_home: 0, score_away: 0,
      live_data: {
        halfScoreHome: [0, 0], halfScoreAway: [0, 0],
        stats: [{ name: "1 Tempo: Cartellini gialli", home: 1, away: 0 }],
      },
    };
    const sr = __test__buildResult(event, undefined, "calcio");
    expect(sr!.ht_cards_home).toBe(1);
    expect(sr!.sh_cards_home).toBeUndefined();
  });

  it("handles red cards summed with yellow per period", () => {
    const event = {
      score_home: 0, score_away: 0,
      live_data: {
        halfScoreHome: [0, 0], halfScoreAway: [0, 0],
        stats: [
          { name: "1 Tempo: Cartellini gialli", home: 2, away: 0 },
          { name: "1 Tempo: Cartellini rossi", home: 1, away: 0 },
          { name: "Partita: Cartellini gialli", home: 3, away: 0 },
          { name: "Partita: Cartellini rossi", home: 1, away: 0 },
        ],
      },
    };
    const sr = __test__buildResult(event, undefined, "calcio");
    expect(sr!.ht_cards_home).toBe(3); // 2 yellow + 1 red
    expect(sr!.cards_home).toBe(4);    // 3 yellow + 1 red
  });

  it("populates ht_cards AND sh_cards with yellow+red sum for each period", () => {
    const event = {
      score_home: 1, score_away: 0,
      live_data: {
        halfScoreHome: [0, 1], halfScoreAway: [0, 0],
        stats: [
          { name: "Partita: Cartellini gialli", home: 5, away: 3 },
          { name: "Partita: Cartellini rossi", home: 1, away: 1 },
          { name: "1 Tempo: Cartellini gialli", home: 2, away: 1 },
          { name: "1 Tempo: Cartellini rossi", home: 0, away: 1 },
          { name: "2 Tempo: Cartellini gialli", home: 3, away: 2 },
          { name: "2 Tempo: Cartellini rossi", home: 1, away: 0 },
        ],
      },
    };
    const sr = __test__buildResult(event, undefined, "calcio");
    expect(sr).not.toBeNull();
    // HT: yellow + red per team
    expect(sr!.ht_cards_home).toBe(2); // 2 + 0
    expect(sr!.ht_cards_away).toBe(2); // 1 + 1
    expect(sr!.ht_cards_total).toBe(4);
    // SH: yellow + red per team
    expect(sr!.sh_cards_home).toBe(4); // 3 + 1
    expect(sr!.sh_cards_away).toBe(2); // 2 + 0
    expect(sr!.sh_cards_total).toBe(6);
    // FT (for symmetry): yellow + red per team
    expect(sr!.cards_home).toBe(6); // 5 + 1
    expect(sr!.cards_away).toBe(4); // 3 + 1
    expect(sr!.cards_total).toBe(10);
  });
});
