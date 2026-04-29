import { describe, it, expect } from "vitest";
import { normalizePeriod } from "@/lib/normalize/period";

describe("normalizePeriod", () => {
  it("returns 'ft' for empty, null, or full-time strings", () => {
    expect(normalizePeriod("")).toBe("ft");
    expect(normalizePeriod(null)).toBe("ft");
    expect(normalizePeriod(undefined)).toBe("ft");
  });

  it("recognises Italian first-half forms", () => {
    expect(normalizePeriod("1T")).toBe("1h");
    expect(normalizePeriod("1° Tempo")).toBe("1h");
    expect(normalizePeriod("1° tempo")).toBe("1h");
    expect(normalizePeriod("- 1T")).toBe("1h");
    expect(normalizePeriod("1T 1.5")).toBe("1h");
  });

  it("recognises Italian second-half forms", () => {
    expect(normalizePeriod("2T")).toBe("2h");
    expect(normalizePeriod("2° Tempo")).toBe("2h");
    expect(normalizePeriod("- 2T")).toBe("2h");
  });

  it("recognises Italian third-period forms (basket/hockey)", () => {
    expect(normalizePeriod("3T")).toBe("3h");
    expect(normalizePeriod("3° Tempo")).toBe("3h");
    expect(normalizePeriod("terzo tempo")).toBe("3h");
    expect(normalizePeriod("- 3T")).toBe("3h");
  });

  it("recognises Italian fourth-period forms (basket/hockey)", () => {
    expect(normalizePeriod("4T")).toBe("4h");
    expect(normalizePeriod("4° Tempo")).toBe("4h");
    expect(normalizePeriod("- 4T")).toBe("4h");
  });

  it("falls through to 'ft' on unknown non-numeric fragments", () => {
    expect(normalizePeriod("Regolamentari")).toBe("ft");
    expect(normalizePeriod("Supplementari")).toBe("ft");
  });

  // Wave 20: 11T/12T are now basketball aggregate halves convention
  // (Q1+Q2 = 11T = 1h, Q3+Q4 = 12T = 2h — 22bet NBA convention).
  it("maps basketball aggregate-halves 11T/12T to 1h/2h (Wave 20)", () => {
    expect(normalizePeriod("11T")).toBe("1h");
    expect(normalizePeriod("12T")).toBe("2h");
    expect(normalizePeriod("- 11T")).toBe("1h");
    expect(normalizePeriod("- 12T")).toBe("2h");
  });

  it("returns null for remaining unknown numeric NT periods (5T/0T etc)", () => {
    expect(normalizePeriod("5T")).toBeNull();
    expect(normalizePeriod("0T")).toBeNull();
    expect(normalizePeriod("13T")).toBeNull();
  });

  // ═══ Wave 13: basket "Quarto" + hockey "Periodo" forms ═══
  // Prior to Wave 13, "1° Quarto"/"1° Periodo" fell through to 'ft' because the
  // HALF_N regexes only matched "tempo"/"T". That silently mis-mapped basket
  // quarter handicaps to _ft period.

  it("recognises basket Italian N° Quarto forms", () => {
    expect(normalizePeriod("1° Quarto")).toBe("1h");
    expect(normalizePeriod("2° Quarto")).toBe("2h");
    expect(normalizePeriod("3° Quarto")).toBe("3h");
    expect(normalizePeriod("4° Quarto")).toBe("4h");
  });

  it("recognises basket Italian written-out quarto forms", () => {
    expect(normalizePeriod("primo quarto")).toBe("1h");
    expect(normalizePeriod("secondo quarto")).toBe("2h");
    expect(normalizePeriod("terzo quarto")).toBe("3h");
    expect(normalizePeriod("quarto quarto")).toBe("4h");
  });

  it("recognises Quarto inside Kambi composite fragments", () => {
    expect(normalizePeriod("- 1° Quarto")).toBe("1h");
    expect(normalizePeriod("- 4° Quarto")).toBe("4h");
  });

  it("recognises hockey Italian N° Periodo forms", () => {
    expect(normalizePeriod("1° Periodo")).toBe("1h");
    expect(normalizePeriod("2° Periodo")).toBe("2h");
    expect(normalizePeriod("3° Periodo")).toBe("3h");
  });

  it("recognises hockey written-out periodo forms", () => {
    expect(normalizePeriod("primo periodo")).toBe("1h");
    expect(normalizePeriod("secondo periodo")).toBe("2h");
  });

  // ═══ Wave 14: OT / Supplementari inclusi / Including Overtime → 'et' ═══
  // Kambi emits "Risultato esatto - Supplementari inclusi" / "Totale gol - Incl. Supp. N"
  // / "1X2 con handicap - Supplementari inclusi (±N)" / "U/O Incl. Supp. N".
  // These markets include regular time + extra time (overtime). Distinct from 'ft'.

  it("recognises Italian Supplementari inclusi → 'et'", () => {
    expect(normalizePeriod("Supplementari inclusi")).toBe("et");
    expect(normalizePeriod("- Supplementari inclusi")).toBe("et");
    expect(normalizePeriod("supplementari inclusi")).toBe("et"); // case insensitive
  });

  it("recognises English Including Overtime → 'et'", () => {
    expect(normalizePeriod("Including Overtime")).toBe("et");
    expect(normalizePeriod("- Including Overtime")).toBe("et");
    expect(normalizePeriod("including overtime")).toBe("et");
  });

  it("recognises abbreviated 'Incl. Supp.' → 'et'", () => {
    expect(normalizePeriod("Incl. Supp.")).toBe("et");
    expect(normalizePeriod("- Incl. Supp.")).toBe("et");
  });

  // ═══ Wave 34: ETP period (Extra Time + Penalties) ═══
  it("recognises 'Supplementari e rigori inclusi' → 'etp' (ET+PK)", () => {
    expect(normalizePeriod("Supplementari e rigori inclusi")).toBe("etp");
    expect(normalizePeriod("- Supplementari e rigori inclusi")).toBe("etp");
  });

  it("recognises 'Series Outcome' → 'etp'", () => {
    expect(normalizePeriod("Series Outcome")).toBe("etp");
    expect(normalizePeriod("- Series Outcome")).toBe("etp");
  });

  it("recognises 'Incl. supp. e rig.' → 'etp'", () => {
    expect(normalizePeriod("Incl. supp. e rig.")).toBe("etp");
  });

  // Regression: "Supplementari inclusi" (ET only) stays 'et', NOT 'etp'
  it("regression: plain 'Supplementari inclusi' still 'et' not 'etp'", () => {
    expect(normalizePeriod("Supplementari inclusi")).toBe("et");
  });
});
