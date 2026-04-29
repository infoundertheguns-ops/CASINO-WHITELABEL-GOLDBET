import { describe, it, expect } from "vitest";
import { extractStat, extractTeamStat, type FlashscoreStat } from "@/lib/settlement/stats-extractor";

const sampleStats: FlashscoreStat[] = [
  { name: "Partita: Calci d'angolo", home: "5", away: "6" },
  { name: "Partita: Cartellini gialli", home: "4", away: "2" },
  { name: "Partita: Tiri totali", home: "11", away: "2" },
  { name: "Partita: Tiri in porta", home: "5", away: "1" },
  { name: "1 Tempo: Calci d'angolo", home: "2", away: "0" },
  { name: "1 Tempo: Cartellini gialli", home: "1", away: "0" },
  { name: "2 Tempo: Calci d'angolo", home: "3", away: "6" },
  // Intentional duplicate (flashscore emits dupes — first wins)
  { name: "Partita: Calci d'angolo", home: "5", away: "6" },
];

describe("extractStat (Italian names)", () => {
  it("extracts FT corners as totals", () => {
    expect(extractStat(sampleStats, "ft", "corners")).toEqual({ home: 5, away: 6, total: 11 });
  });
  it("extracts HT corners", () => {
    expect(extractStat(sampleStats, "ht", "corners")).toEqual({ home: 2, away: 0, total: 2 });
  });
  it("extracts FT yellow cards", () => {
    expect(extractStat(sampleStats, "ft", "cards_yellow")).toEqual({ home: 4, away: 2, total: 6 });
  });
  it("extracts FT shots-on-target", () => {
    expect(extractStat(sampleStats, "ft", "shots_on_target")).toEqual({ home: 5, away: 1, total: 6 });
  });
  it("extracts FT total shots (tiri totali)", () => {
    expect(extractStat(sampleStats, "ft", "shots_total")).toEqual({ home: 11, away: 2, total: 13 });
  });
  it("returns null if stat missing (HT shots)", () => {
    expect(extractStat(sampleStats, "ht", "shots_total")).toBeNull();
  });
  it("dedupes duplicate entries (uses first)", () => {
    const result = extractStat(sampleStats, "ft", "corners");
    expect(result).toEqual({ home: 5, away: 6, total: 11 });
  });
  it("is case-insensitive for section", () => {
    const withUpper: FlashscoreStat[] = [{ name: "PARTITA: Calci d'angolo", home: "1", away: "2" }];
    expect(extractStat(withUpper, "ft", "corners")).toEqual({ home: 1, away: 2, total: 3 });
  });
  it("handles red cards separately", () => {
    const withRed: FlashscoreStat[] = [
      { name: "Partita: Cartellini gialli", home: "2", away: "1" },
      { name: "Partita: Cartellini rossi", home: "1", away: "0" },
    ];
    expect(extractStat(withRed, "ft", "cards_yellow")).toEqual({ home: 2, away: 1, total: 3 });
    expect(extractStat(withRed, "ft", "cards_red")).toEqual({ home: 1, away: 0, total: 1 });
  });
  it("extracts SH corners", () => {
    expect(extractStat(sampleStats, "sh", "corners")).toEqual({ home: 3, away: 6, total: 9 });
  });
  it("returns null for non-numeric home value", () => {
    const bad: FlashscoreStat[] = [{ name: "Partita: Calci d'angolo", home: "abc", away: "5" }];
    expect(extractStat(bad, "ft", "corners")).toBeNull();
  });
  it("returns null for empty home value", () => {
    const bad: FlashscoreStat[] = [{ name: "Partita: Calci d'angolo", home: "", away: "5" }];
    expect(extractStat(bad, "ft", "corners")).toBeNull();
  });
});

// Keep extractTeamStat import used so unused-import lint doesn't trip
describe("extractTeamStat", () => {
  it("returns per-team value", () => {
    expect(extractTeamStat(sampleStats, "ft", "corners", "home")).toBe(5);
    expect(extractTeamStat(sampleStats, "ft", "corners", "away")).toBe(6);
    expect(extractTeamStat(sampleStats, "ht", "shots_total", "home")).toBeNull();
  });
});
