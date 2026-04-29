// Types for outcome-normalization engine (E1.F1).
// Parallel to lib/normalize/types.ts but targets outcome canonicalization
// (source_outcome_name → canonical_outcome_key within a canonical_key).

export type OutcomeSource = "flashscore" | "odds-api";

export interface OutcomeRow {
  id: number;
  source: OutcomeSource;
  source_market_type: string;
  source_outcome_name: string;
  canonical_key: string | null;
  canonical_outcome_key: string | null;
  extracted_by: string | null;
  confidence: number | null;
  verified: boolean;
  notes: string | null;
}

export interface OutcomeDictEntry {
  canonical_key: string;
  source_outcome_pattern: string; // already lowercased in DB
  canonical_outcome_key: string;
}

export interface OutcomeStageResult {
  canonical_key: string;
  canonical_outcome_key: string;
  confidence: number;
  extracted_by: "dictionary" | "propagation" | "llm";
}

export interface OutcomeEngineSummary {
  processed: number;
  matched: { dictionary: number; propagation: number; llm?: number };
  market_lookup_applied: number; // rows that gained canonical_key via market_normalization join
  unmatched: number;
  remaining: number;
  took_ms: number;
  llm?: {
    batches_used: number;
    batches_budget: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    errors: number;
  };
}
