export type Source = 'flashscore' | 'odds-api';
export type Period = 'ft' | '1h' | '2h' | '3h' | '4h' | 'et' | 'etp' | 'regular_time';
export type ExtractedBy = 'manual' | 'regex' | 'dictionary' | 'propagation' | 'fuzzy' | 'llm';

export interface NormalizationRow {
  source: Source;
  source_market_type: string;
  canonical_key: string | null;
  canonical_line: number | null;
  canonical_name_it: string | null;
  verified: boolean;
  extracted_by: ExtractedBy | null;
  confidence: number | null;
  notes: string | null;
}

export interface ParsedMarketType {
  base_key: string;
  period: Period;
  line: number | null;
}

export interface StageResult {
  canonical_key: string;
  canonical_line: number | null;
  canonical_name_it: string | null;
  confidence: number;
  extracted_by: ExtractedBy;
}

export interface CanonicalMarket {
  canonical_key: string;
  base_key: string;
  period: Period;
  canonical_name_it: string;
  has_line: boolean;
  outcomes: Array<{ key: string; name_it: string }>;
}

export interface EngineSummary {
  processed: number;
  matched: { regex: number; dictionary: number; propagation: number; llm?: number };
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
