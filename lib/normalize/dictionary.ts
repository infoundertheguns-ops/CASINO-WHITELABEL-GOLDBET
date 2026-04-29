import type { CanonicalMarket, Source, StageResult } from "./types";

// Legacy market dictionary maps from the deprecated kambi/22bet pipelines.
// Retained as historical reference only — the active source set is
// flashscore | odds-api (see ./types.ts), neither of which uses this lookup.
// New pipeline: market normalization is handled at ingestion in
// services/odds-api-ingester. This function is a no-op for current sources.
const LEGACY_KAMBI_ITALIAN_MAP: Record<string, string> = {
  "1x2": "1x2",
  "dc": "dc",
  "gg/ng": "gg_ng",
  "pari/dispari": "odd_even",
  "risultato esatto": "correct_score",
  "draw no bet": "dnb",
  "esito 1t/finale": "htft",
  "testa a testa": "h2h",
};

const LEGACY_TWOBET_G_MAP: Record<number, string> = {
  1: "1x2",
  8: "dc",
  14: "odd_even",
  15: "total_team",
  27: "asian_handicap",
  62: "total_team",
  99: "asian_total",
  136: "correct_score",
  2854: "asian_handicap",
};

export interface LookupArgs {
  source: Source;
  source_market_type: string;
  canonicals: CanonicalMarket[];
  twobetGroups: Array<{ twobet_g: number; name_it: string }>;
}

export function lookupDictionary(args: LookupArgs): StageResult | null {
  const { source, source_market_type, canonicals } = args;
  const needle = source_market_type.trim().toLowerCase();

  let base_key: string | undefined;

  // Active sources (flashscore, odds-api) bypass this legacy dictionary;
  // markets are normalized by the odds-api ingester / flashscore parser.
  if (source === "flashscore" || source === "odds-api") {
    base_key = LEGACY_KAMBI_ITALIAN_MAP[needle];
  }

  // Suppress unused-warnings: legacy maps retained for historical reference.
  void LEGACY_TWOBET_G_MAP;

  if (!base_key) return null;

  // Default period = ft. Dictionary stage does NOT attempt to parse period suffixes —
  // that's stage 1's job. Dictionary matches only when the full string matches a known base.
  const canonical = canonicals.find((c) => c.base_key === base_key && c.period === "ft");
  if (!canonical) return null;

  return {
    canonical_key: canonical.canonical_key,
    canonical_line: null,
    canonical_name_it: canonical.canonical_name_it,
    confidence: 90,
    extracted_by: "dictionary",
  };
}
