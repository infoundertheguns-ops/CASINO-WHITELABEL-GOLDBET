// Loads canonical lookup maps from the DB for a single event's settlement run.
// Kept separate from canonical-dispatcher.ts so the dispatcher stays pure
// (testable without Supabase mocks) and this loader can be shallow-mocked
// in integration tests.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  makeEmptyLookups,
  type CanonicalLookups,
} from "@/lib/settlement/canonical-dispatcher";

// Confidence threshold below which unverified auto-extracted mappings are
// ignored. Matches the operator-confirmed bar used across the admin UI.
const MIN_AUTO_CONFIDENCE = 90;

export async function loadCanonicalLookups(
  supabase: SupabaseClient,
  source: string | null,
  marketTypes: string[],
  outcomeNames: string[],
): Promise<CanonicalLookups> {
  const lookups = makeEmptyLookups();
  if (!source || marketTypes.length === 0) return lookups;

  // Dedup inputs — tiny bets can have duplicate market_type across legs.
  const mtUnique = Array.from(new Set(marketTypes));
  const onUnique = Array.from(new Set(outcomeNames));

  // 1. market_normalization for (source, mt): only trust verified OR
  //    high-confidence auto-extracted rows.
  const { data: mnRows } = await supabase
    .from("market_normalization")
    .select("source_market_type, canonical_key, canonical_line, verified, confidence")
    .eq("source", source)
    .in("source_market_type", mtUnique)
    .not("canonical_key", "is", null);

  const canonicalKeysInPlay = new Set<string>();
  for (const row of mnRows ?? []) {
    if (!row.canonical_key) continue;
    const trusted =
      row.verified === true ||
      (typeof row.confidence === "number" && row.confidence >= MIN_AUTO_CONFIDENCE);
    if (!trusted) continue;
    lookups.market.set(`${source}|${row.source_market_type}`, {
      canonical_key: row.canonical_key,
      canonical_line: row.canonical_line ?? null,
    });
    canonicalKeysInPlay.add(row.canonical_key);
  }

  // 2. outcome_normalization for (source, mt, on): source-specific curated.
  if (onUnique.length > 0) {
    const { data: onRows } = await supabase
      .from("outcome_normalization")
      .select(
        "source_market_type, source_outcome_name, canonical_outcome_key, verified, confidence",
      )
      .eq("source", source)
      .in("source_market_type", mtUnique)
      .in("source_outcome_name", onUnique)
      .not("canonical_outcome_key", "is", null);

    for (const row of onRows ?? []) {
      if (!row.canonical_outcome_key) continue;
      const trusted =
        row.verified === true ||
        (typeof row.confidence === "number" && row.confidence >= MIN_AUTO_CONFIDENCE);
      if (!trusted) continue;
      lookups.outcome.set(
        `${source}|${row.source_market_type}|${row.source_outcome_name.toLowerCase()}`,
        row.canonical_outcome_key,
      );
    }
  }

  // 3. outcome_dictionary for canonical_keys we actually need.
  if (canonicalKeysInPlay.size > 0) {
    const { data: dictRows } = await supabase
      .from("outcome_dictionary")
      .select("canonical_key, source_outcome_pattern, canonical_outcome_key")
      .in("canonical_key", Array.from(canonicalKeysInPlay));

    for (const row of dictRows ?? []) {
      lookups.dictionary.set(
        `${row.canonical_key}|${row.source_outcome_pattern.toLowerCase()}`,
        row.canonical_outcome_key,
      );
    }
  }

  return lookups;
}
