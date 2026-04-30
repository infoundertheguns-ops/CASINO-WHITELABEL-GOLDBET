// Plan D Phase 2 / S5 — synthetic fixture validation gate for shadow classifier.
//
// Each fixture entry: { id, description, leg, result, expected_verdict }.
// Test runner asserts classifyLeg(leg, result).verdict === expected_verdict.
//
// HARD GATE for S6 cutover: 100% pass required.
// Currently 60+ score-only fixtures (1X2/OU/BTTS/DC/DNB FT+HT+2H, IT+EN names).
// Stats/player fixtures pending classifier extension (item 6b registry).

import { describe, expect, test } from "vitest";
import { classifyLeg, type BetLeg, type ScoreResult, type Verdict } from "@/lib/settlement/odds-api/classify";
import fixtures from "@/tests/fixtures/settlement/score-only-60.json";

interface Fixture {
  id: string;
  description: string;
  leg: BetLeg;
  result: ScoreResult;
  expected_verdict: Verdict | null;
}

const typedFixtures = fixtures as Fixture[];

describe("Shadow classifier — score-only fixture gate", () => {
  test("fixture file has at least 60 entries (hard gate floor)", () => {
    expect(typedFixtures.length).toBeGreaterThanOrEqual(60);
  });

  test("all fixture ids are unique", () => {
    const ids = typedFixtures.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test.each(typedFixtures)(
    "$id — $description",
    ({ leg, result, expected_verdict }) => {
      const out = classifyLeg(leg, result);
      expect(out.verdict).toBe(expected_verdict);
    }
  );
});

describe("Shadow classifier — coverage by market family", () => {
  test("covers 1X2 FT/HT/2H", () => {
    const ids = typedFixtures.map((f) => f.id);
    expect(ids.some((id) => id.startsWith("1x2-ft"))).toBe(true);
    expect(ids.some((id) => id.startsWith("1x2-ht"))).toBe(true);
    expect(ids.some((id) => id.startsWith("1x2-2h"))).toBe(true);
  });

  test("covers U/O FT and HT/2H", () => {
    const ids = typedFixtures.map((f) => f.id);
    expect(ids.some((id) => id.startsWith("ou-ft"))).toBe(true);
    expect(ids.some((id) => id.startsWith("ou-ht") || id.startsWith("ou-2h"))).toBe(true);
  });

  test("covers BTTS", () => {
    expect(typedFixtures.some((f) => f.id.startsWith("btts"))).toBe(true);
  });

  test("covers DC", () => {
    expect(typedFixtures.some((f) => f.id.startsWith("dc-"))).toBe(true);
  });

  test("covers DNB with void/refund cases", () => {
    const dnb = typedFixtures.filter((f) => f.id.startsWith("dnb"));
    expect(dnb.length).toBeGreaterThan(0);
    expect(dnb.some((f) => f.expected_verdict === "void")).toBe(true);
  });

  test("covers Italian and English outcome name variants", () => {
    const aliases = typedFixtures.filter((f) => f.id.startsWith("alias"));
    expect(aliases.length).toBeGreaterThan(0);
  });

  test("covers HT/FT family", () => {
    expect(typedFixtures.some((f) => f.id.startsWith("htft"))).toBe(true);
  });

  test("covers Correct Score family", () => {
    expect(typedFixtures.some((f) => f.id.startsWith("cs-"))).toBe(true);
  });

  test("covers Odd/Even family", () => {
    expect(typedFixtures.some((f) => f.id.startsWith("oe-"))).toBe(true);
  });

  test("covers Handicap 2-way with push and quarter-line null cases", () => {
    const hcap = typedFixtures.filter((f) => f.id.startsWith("hcap"));
    expect(hcap.length).toBeGreaterThan(0);
    expect(hcap.some((f) => f.expected_verdict === "void")).toBe(true);
    expect(hcap.some((f) => f.expected_verdict === null)).toBe(true);
  });

  test("covers European Handicap (3-way)", () => {
    expect(typedFixtures.some((f) => f.id.startsWith("euhcap"))).toBe(true);
  });
});
