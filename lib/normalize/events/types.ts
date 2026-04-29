// lib/normalize/events/types.ts
//
// Shared types for event normalization 5-stage pipeline.
// Mirrors lib/normalize/types.ts (markets) conventions.

export type EventSource = 'kambi' | '22bet';

export type MatchStage =
  | 'flashscore_native'
  | 'regex'
  | 'trigram'
  | 'alias_dict'
  | 'propagation'
  | 'llm'
  | 'manual';

export interface EventToNormalize {
  id: string;
  source: EventSource;
  sport: string; // Italian name from events.sports.name (e.g. 'Calcio')
  league: string | null;
  country: string | null; // leagues.country, used by trigram v2 country boost
  home_team: string;
  away_team: string;
  starts_at: string; // ISO 8601
  flashscore_id: string | null; // null = needs mapping
}

export interface FlashscoreCandidate {
  flashscore_id: string; // be_fixtures.be_match_id
  home_team: string;
  away_team: string;
  starts_at: string; // be_fixtures.match_date
  sport: string; // be_fixtures internal sport name
  league: string | null;
  country?: string | null;
  score?: number; // composite score from match_event_by_trigram_v2 (when applicable)
}

export interface MatchResult {
  flashscore_id: string | null;
  stage: MatchStage | 'unmapped';
  confidence: number; // 0.0 - 1.0
  llm_reason?: string;
  // LLM-only: separate self-verify gate. The LLM declares "I'd confirm without
  // hesitation" independently from confidence. Used as a dual gate alongside
  // AUTO_VERIFY_THRESHOLDS.llm. Undefined for non-LLM stages (ignored).
  llm_verify?: boolean;
}

export const AUTO_APPLY_THRESHOLDS: Record<MatchStage, number> = {
  flashscore_native: 1.0,
  regex: 0.8,
  trigram: 0.85,
  alias_dict: 0.85,
  propagation: 1.0,
  llm: 0.95,
  manual: 1.0,
};

// AUTO_VERIFY_THRESHOLDS — confidence required to mark verified=true automatically.
// Higher than AUTO_APPLY_THRESHOLDS by design: a match can be auto-applied to
// events.flashscore_id without being trusted as ground-truth. Verification is
// the gold-standard label used by retrofit migrations and bypassed by future
// algorithm changes.
//
// Tuning rationale at scale: with FP rate ~1% at conf 0.95, 100k mapped/day
// would yield ~1000 false positives. At 0.97 with the boosted v2 scoring,
// FP rate drops to ~0.1-0.3% per stage. LLM uses dual gate (confidence +
// explicit verify=true) so the threshold can stay at 0.95 without inflating FP.
export const AUTO_VERIFY_THRESHOLDS: Record<MatchStage, number> = {
  flashscore_native: 0.0, // always verified
  regex: 0.97,
  trigram: 0.97,
  alias_dict: 0.97,
  propagation: 0.0, // cache hit at 1.0 — always verified when present
  llm: 0.95, // pairs with llm_verify=true dual gate
  manual: 0.0, // operator confirmed by definition
};

// Stages that auto-verify unconditionally (regardless of confidence).
export const ALWAYS_AUTO_VERIFY_STAGES: ReadonlySet<MatchStage> =
  new Set(['flashscore_native', 'manual', 'propagation']);

// Minimum confidence to persist a partial result (pending manual review).
export const PENDING_REVIEW_MIN = 0.5;

/**
 * Decide whether a freshly persisted MatchResult should be auto-verified.
 * Returns true → engine writes a separate UPDATE with verified=true.
 * Returns false → leaves verified=false for human review.
 */
export function shouldAutoVerify(r: MatchResult): boolean {
  if (!r.flashscore_id) return false;
  if (r.stage === 'unmapped') return false;
  if (ALWAYS_AUTO_VERIFY_STAGES.has(r.stage as MatchStage)) return true;
  const threshold = AUTO_VERIFY_THRESHOLDS[r.stage as MatchStage];
  if (threshold === undefined) return false;
  if (r.confidence < threshold) return false;
  // LLM dual gate: confidence alone is not enough — LLM must self-verify.
  if (r.stage === 'llm' && r.llm_verify !== true) return false;
  return true;
}
