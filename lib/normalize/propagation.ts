import type { NormalizationRow, Source, StageResult } from "./types";

export interface PropagateArgs {
  source: Source;
  source_market_type: string;
  verifiedRows: NormalizationRow[];
}

/**
 * Stage 3 — literal-string cross-source propagation.
 * If the exact same source_market_type string is already verified on ANOTHER source,
 * copy canonical_key + canonical_line with confidence=85.
 */
export function propagate(args: PropagateArgs): StageResult | null {
  const { source, source_market_type, verifiedRows } = args;

  const match = verifiedRows.find(
    (r) =>
      r.verified &&
      r.canonical_key &&
      r.source !== source &&
      r.source_market_type === source_market_type,
  );

  if (!match) return null;

  return {
    canonical_key: match.canonical_key!,
    canonical_line: match.canonical_line,
    canonical_name_it: match.canonical_name_it,
    confidence: 85,
    extracted_by: "propagation",
  };
}
