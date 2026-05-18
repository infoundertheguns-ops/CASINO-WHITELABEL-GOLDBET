/**
 * Event ID mapping resolver for api-football fixtures vs `events_v2`.
 *
 * Implements spec §3.5: confidence-scored fuzzy match used the first time we
 * see a fixture from api-football's `/fixtures?live=all` (and prematch). The
 * persistence of the resulting row into `external_id_mapping` (mig 182) is
 * out of scope for this module — see M1.11. This file is a pure-function
 * scoring + thresholding layer; the caller supplies the candidate list and
 * decides what to do with the verdict.
 *
 * Confidence formula (spec §3.5):
 *   confidence = 0.5 * name_similarity(home, away)
 *              + 0.3 * league_match_score
 *              + 0.2 * kickoff_proximity_score   // window +/-60min, linear decay
 *
 * Thresholds:
 *   >= 0.85   verified=true   (downstream ingester writes events_v2 immediately)
 *   0.50-0.85 verified=false  (admin audit route can promote manually)
 *   < 0.50    discard, no row
 *
 * Team-name similarity reuse: `teamMatchScore` is a SYNCED COPY from
 * `lib/betexplorer.ts` living in `./team-similarity.ts`. See that file's
 * header for the why-not-import rationale.
 */

import type { AFFixture } from './types.js';
import { teamMatchScore } from './team-similarity.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Minimal shape of an `events_v2` candidate row consumed by `resolveMapping`.
 * Caller (M1.10/M1.11 discovery loop) is responsible for the DB query that
 * filters to `sport='football' AND status IN ('prematch','live') AND
 * starts_at BETWEEN fixture.kickoff +/- 60min`.
 */
export interface V2EventCandidate {
  id: string; // UUID
  home: string;
  away: string;
  league_name: string | null;
  starts_at: string; // ISO 8601
}

export interface ConfidenceInputs {
  name_similarity: number; // 0-1, see `nameSimilarity`
  league_match_score: number; // 0 or 1, see `leagueMatchScore`
  kickoff_proximity_score: number; // 0-1, see `kickoffProximityScore`
}

export interface MappingDecision {
  event_id: string; // UUID
  confidence: number;
  verified: boolean;
}

// ---------------------------------------------------------------------------
// Confidence components
// ---------------------------------------------------------------------------

/**
 * Pure formula. All inputs clamped to [0,1] before weighting so callers cannot
 * inject negative or super-unit scores that would violate the threshold rules.
 */
export function computeConfidence(inputs: ConfidenceInputs): number {
  const ns = clamp01(inputs.name_similarity);
  const lg = clamp01(inputs.league_match_score);
  const kp = clamp01(inputs.kickoff_proximity_score);
  return 0.5 * ns + 0.3 * lg + 0.2 * kp;
}

/**
 * Averaged per-team similarity. Returns 0-1.
 *
 * Per spec: name_similarity is one number for the pair, not per-team. We
 * average homeScore + awayScore so it stays comparable to the formula's 0.5
 * weight without giving home/away orientation any special meaning. Orientation
 * (swap) detection is NOT done here — callers that fetch candidates already
 * pass them in same orientation as the fixture (api-football and events_v2
 * both encode home/away explicitly).
 */
export function nameSimilarity(
  home1: string,
  away1: string,
  home2: string,
  away2: string,
): number {
  const homeScore = teamMatchScore(home1, home2);
  const awayScore = teamMatchScore(away1, away2);
  return (homeScore + awayScore) / 2;
}

/**
 * Binary league match: 1.0 if normalized equality, 0.0 otherwise.
 *
 * Normalization: lowercase + NFD diacritic strip + collapse whitespace +
 * trim. We intentionally do NOT do fuzzy/token matching on the league name —
 * api-football's `league.name` and events_v2 `league_name` come from
 * different upstream taxonomies and "Premier League" vs "EPL" vs "English
 * Premier League" would all score 0 here. The 0.3 weight in the formula is
 * deliberately small so league mismatch alone is not disqualifying (a perfect
 * name+kickoff match still yields 0.7 confidence, landing in the
 * verified=false audit bucket).
 *
 * Null/empty inputs return 0 (cannot prove a match without both sides).
 */
export function leagueMatchScore(
  leagueAf: string | null | undefined,
  leagueV2: string | null | undefined,
): number {
  const a = normalizeLeague(leagueAf);
  const b = normalizeLeague(leagueV2);
  if (!a || !b) return 0;
  return a === b ? 1 : 0;
}

function normalizeLeague(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Linear-decay score over a +/-60min window from `kickoffAfIso`.
 *
 *   delta = |kickoff_af - kickoff_v2|
 *   score = max(0, 1 - delta / 60min)
 *
 * Boundary semantics: at exactly 60min apart the score is 0 (boundary
 * EXCLUSIVE, anything beyond clamps to 0 — not negative). At 0min the score
 * is 1.0. Linear in between.
 *
 * Invalid date strings return 0 rather than NaN.
 */
export function kickoffProximityScore(
  kickoffAfIso: string,
  kickoffV2Iso: string,
): number {
  const a = Date.parse(kickoffAfIso);
  const b = Date.parse(kickoffV2Iso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  const deltaMin = Math.abs(a - b) / 60000;
  if (deltaMin >= 60) return 0;
  return 1 - deltaMin / 60;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Pure decision function. Iterates candidates, scores each, picks best,
 * applies threshold rules.
 *
 *   - Returns `null` if best confidence < 0.50 (no row should be written).
 *   - Returns `{ verified: true }` if best >= 0.85.
 *   - Returns `{ verified: false }` if 0.50 <= best < 0.85.
 *
 * Ties broken by candidate order (caller controls).
 */
export function resolveMapping(
  fixture: AFFixture,
  candidates: V2EventCandidate[],
): MappingDecision | null {
  if (candidates.length === 0) return null;

  const home = fixture.teams.home.name;
  const away = fixture.teams.away.name;
  const leagueAf = fixture.league.name;
  const kickoffAf = fixture.fixture.date;

  let best: { cand: V2EventCandidate; confidence: number } | null = null;

  for (const cand of candidates) {
    const ns = nameSimilarity(home, away, cand.home, cand.away);
    const lg = leagueMatchScore(leagueAf, cand.league_name);
    const kp = kickoffProximityScore(kickoffAf, cand.starts_at);
    const confidence = computeConfidence({
      name_similarity: ns,
      league_match_score: lg,
      kickoff_proximity_score: kp,
    });
    if (best === null || confidence > best.confidence) {
      best = { cand, confidence };
    }
  }

  if (best === null || best.confidence < 0.5) return null;

  return {
    event_id: best.cand.id,
    confidence: best.confidence,
    verified: best.confidence >= 0.85,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
