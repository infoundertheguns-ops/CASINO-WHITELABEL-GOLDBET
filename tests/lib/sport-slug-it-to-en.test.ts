import { describe, it, expect } from "vitest";
import { getSportSlugsEn } from "@/lib/sport-slug-it-to-en";

describe("getSportSlugsEn", () => {
  it("maps calcio → ['football']", () => {
    expect(getSportSlugsEn("calcio")).toEqual(["football"]);
  });

  it("maps basket → ['basketball']", () => {
    expect(getSportSlugsEn("basket")).toEqual(["basketball"]);
  });

  it("maps both 'hockey ghiaccio' (space) and 'hockey-ghiaccio' (kebab) → ['ice-hockey']", () => {
    expect(getSportSlugsEn("hockey ghiaccio")).toEqual(["ice-hockey"]);
    expect(getSportSlugsEn("hockey-ghiaccio")).toEqual(["ice-hockey"]);
  });

  it("maps boxe and pugilato (aliases) → ['boxing']", () => {
    expect(getSportSlugsEn("boxe")).toEqual(["boxing"]);
    expect(getSportSlugsEn("pugilato")).toEqual(["boxing"]);
  });

  it("maps mma and 'arti marziali' → ['mma']", () => {
    expect(getSportSlugsEn("mma")).toEqual(["mma"]);
    expect(getSportSlugsEn("arti marziali")).toEqual(["mma"]);
    expect(getSportSlugsEn("arti-marziali")).toEqual(["mma"]);
  });

  it("maps freccette → ['darts']", () => {
    expect(getSportSlugsEn("freccette")).toEqual(["darts"]);
  });

  it("maps 'football americano' / 'football-americano' → ['american-football']", () => {
    expect(getSportSlugsEn("football americano")).toEqual(["american-football"]);
    expect(getSportSlugsEn("football-americano")).toEqual(["american-football"]);
  });

  it("maps esports aliases → ['esports']", () => {
    expect(getSportSlugsEn("esports")).toEqual(["esports"]);
    expect(getSportSlugsEn("counter_strike")).toEqual(["esports"]);
    expect(getSportSlugsEn("league of legends")).toEqual(["esports"]);
    expect(getSportSlugsEn("valorant")).toEqual(["esports"]);
    expect(getSportSlugsEn("dota 2")).toEqual(["esports"]);
    expect(getSportSlugsEn("dota")).toEqual(["esports"]);
  });

  it("returns [] for sports not in events_v2 (no odds-api ingestion)", () => {
    expect(getSportSlugsEn("australian rules")).toEqual([]);
    expect(getSportSlugsEn("rugby league")).toEqual([]);
    expect(getSportSlugsEn("badminton")).toEqual([]);
    expect(getSportSlugsEn("golf")).toEqual([]);
    expect(getSportSlugsEn("tennis tavolo")).toEqual([]);
    expect(getSportSlugsEn("automobilismo")).toEqual([]);
    expect(getSportSlugsEn("formula 1")).toEqual([]);
    expect(getSportSlugsEn("ciclismo")).toEqual([]);
    expect(getSportSlugsEn("quidditch")).toEqual([]);
  });

  it("is case-insensitive", () => {
    expect(getSportSlugsEn("CALCIO")).toEqual(["football"]);
    expect(getSportSlugsEn("Tennis")).toEqual(["tennis"]);
  });

  it("trims whitespace", () => {
    expect(getSportSlugsEn("  calcio  ")).toEqual(["football"]);
  });
});
