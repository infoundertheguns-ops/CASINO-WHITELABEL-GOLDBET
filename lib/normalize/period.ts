import type { Period } from "./types";

// Word boundaries to avoid matching "21T" or "1Tempo" inside longer tokens.
// Wave 13: added "Quarto" (basket) + "Periodo" (hockey) alternatives so Kambi's
// "Handicap - 1° Quarto" / "Punti totali - 3° Quarto" / "Totale gol - 1° Periodo"
// map to 1h/2h/3h/4h correctly instead of silently falling through to 'ft'.
// Wave 20: 11T/12T = basketball aggregate halves convention (Q1+Q2 / Q3+Q4).
// IMPORTANT: 11T/12T must precede \b1\s*T\b and \b2\s*T\b in the alternation
// because JS regex is leftmost-first for alternations at the same position.
const HALF_1 = /\b11\s*T\b|\b1\s*T\b|\b1°\s*tempo\b|\bprimo\s*tempo\b|\b1°\s*quarto\b|\bprimo\s*quarto\b|\b1°\s*periodo\b|\bprimo\s*periodo\b/i;
const HALF_2 = /\b12\s*T\b|\b2\s*T\b|\b2°\s*tempo\b|\bsecondo\s*tempo\b|\b2°\s*quarto\b|\bsecondo\s*quarto\b|\b2°\s*periodo\b|\bsecondo\s*periodo\b/i;
// Periods 3 and 4 are used by basketball / hockey / volleyball via 22bet "3T","4T" suffixes.
const HALF_3 = /\b3\s*T\b|\b3°\s*tempo\b|\bterzo\s*tempo\b|\b3°\s*quarto\b|\bterzo\s*quarto\b|\b3°\s*periodo\b|\bterzo\s*periodo\b/i;
const HALF_4 = /\b4\s*T\b|\b4°\s*tempo\b|\bquarto\s*tempo\b|\b4°\s*quarto\b|\bquarto\s*quarto\b|\b4°\s*periodo\b|\bquarto\s*periodo\b/i;

// Wave 14: OT / "extra time included" variants.
// Kambi emits markets with "Supplementari inclusi" / "Including Overtime" /
// "Incl. Supp." suffix for markets whose resolution counts regulation + overtime.
// Semantically distinct from 'ft' (regulation only) — mapped to 'et' period.
// MUST be checked BEFORE the HALF_* tests so that composite fragments like
// "2nd Half - Including Overtime" resolve to 'et' rather than '2h'.
const OT = /\bsupplementari\s+inclusi\b|\bincluding\s+overtime\b|\bincl\.\s*supp\.(?!\s*e\s*rig)/i;

// Wave 34: "Supplementari e rigori inclusi" / "Series Outcome" / "Incl. supp. e rig."
// — explicit ET+PK (Extra Time + Penalties). Winner decided at penalty shootout.
// Semantically distinct from 'et' (regulation + ET only).
// MUST be checked BEFORE the OT test since phrases overlap.
const ETP = /\bsupplementari\s+e\s+rigori\s+inclusi\b|\bseries\s+outcome\b|\bincl\.\s*supp\.\s*e\s*rig/i;

export function normalizePeriod(fragment: string | null | undefined): Period | null {
  if (!fragment) return "ft";
  if (ETP.test(fragment)) return "etp";
  if (OT.test(fragment)) return "et";
  if (HALF_1.test(fragment)) return "1h";
  if (HALF_2.test(fragment)) return "2h";
  if (HALF_3.test(fragment)) return "3h";
  if (HALF_4.test(fragment)) return "4h";
  // Reject unknown numeric NT periods (5T, 11T, 12T, 0T, ...). Historically
  // these were silently absorbed into 'ft' by the default fallback, producing
  // wrong canonical mappings. Stay unmapped instead.
  if (/\b\d+\s*T\b/i.test(fragment)) return null;
  return "ft";
}
