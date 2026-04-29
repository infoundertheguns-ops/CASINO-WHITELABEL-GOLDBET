// lib/normalize/events/llm-core.ts
// Stage 5 prompt builder + response parser.
// Shared between Claude Code subagent (Task tool) and future Haiku API path.

import type { EventToNormalize, FlashscoreCandidate, MatchResult } from './types';

export interface LLMInput {
  event: EventToNormalize;
  candidates: FlashscoreCandidate[];
}

export interface AliasProposal {
  // Mig 121 — LLM-proposed team_aliases entry. The engine inserts a row
  // with verified=false; operator triages in /admin/event-normalization.
  alias: string;       // raw form seen on source side (lowercase, no extras)
  canonical: string;   // canonical form (lowercase, the one to map *to*)
}

export interface LLMResponse {
  flashscore_id: string | null;
  confidence: number;
  // Dual gate alongside `confidence`: LLM declares whether the match is
  // unambiguous enough that an operator would confirm it without hesitation.
  // verify=true ⇒ engine auto-marks verified=true (skips human review).
  // verify=false ⇒ stays in LLM pending review queue even at conf 0.99.
  verify: boolean;
  reason: string;
  // Mig 121 — optional alias proposal. Populated when the LLM identifies a
  // recurring naming variant that future events would benefit from. NULL when
  // no useful alias was inferred. Independent from match: an LLM may match an
  // event AND propose an alias, or refuse to match but still propose.
  propose_alias?: AliasProposal | null;
}

export function buildPrompt(input: LLMInput): string {
  const cands = input.candidates.length
    ? input.candidates
        .map((c, i) => {
          const country = c.country ? ` | ${c.country}` : '';
          return `${i + 1}. id=${c.flashscore_id} | ${c.home_team} vs ${c.away_team} | ${c.starts_at} | ${c.league ?? 'unknown'}${country}`;
        })
        .join('\n')
    : '(none)';

  const eventCountry = input.event.country ? `\n- Country: ${input.event.country}` : '';

  return `You are an expert sports event matcher. Given a source event and candidates from Flashscore, identify which candidate (if any) represents the same real-world match.

## Source event
- Source: ${input.event.source}
- Sport: ${input.event.sport}
- Home: ${input.event.home_team}
- Away: ${input.event.away_team}
- Starts at: ${input.event.starts_at}
- League: ${input.event.league ?? 'unknown'}${eventCountry}

## Candidates (Flashscore)
${cands}

## Instructions
Return ONLY a JSON object, no prose outside the JSON block:

\`\`\`json
{
  "flashscore_id": "<id of matching candidate, or null if no plausible match>",
  "confidence": <float 0.0 to 1.0>,
  "verify": <true|false>,
  "reason": "<one-line rationale>",
  "propose_alias": null | {"alias": "<lowercase source name>", "canonical": "<lowercase canonical form>"}
}
\`\`\`

Field semantics:
- **confidence**: how certain you are this is the right candidate. 0.95+ = certain, 0.80-0.94 = probable, < 0.80 = uncertain.
- **verify**: would a human operator confirm this match WITHOUT HESITATION? Set verify=true ONLY when ALL of the following hold:
    1. League names match exactly (or are obvious translations: "Champions League" ↔ "Champions League").
    2. Country (when both sides supply one) matches exactly.
    3. Team names match unambiguously after diacritics/abbreviations are accounted for (e.g. "PSG" ↔ "Paris Saint-Germain", "Šeško" ↔ "Sesko").
    4. Times are within 30 minutes of each other.
    5. No two candidates would plausibly match — there is exactly one obvious answer.
  Set verify=false if ANY ambiguity exists: common surnames (e.g. "Smith"), generic league names ("Premier League" without country), multiple plausible candidates, or wide time drift. verify=false at high confidence is OK — it just routes to human review instead of auto-verify.
- **reason**: one short line. Mention league/country/normalisation evidence so operators can audit.
- **propose_alias**: null usually. Set to {alias, canonical} ONLY when you spot a recurring naming variant that future events would benefit from. Examples worth proposing: "psg" → "paris saint-germain", "man utd" → "manchester united", "bayern munich" → "bayern munchen". DO NOT propose for one-off typos, surnames-only matches, or trivially close strings (let regex/trigram handle those). The pair is sport-scoped: alias and canonical should both be lowercase and refer to the SAME team. The operator approves before it enters the dictionary.

Return null flashscore_id if candidates are clearly different (different sport, different teams, >6h time drift). When flashscore_id is null, set confidence=0 and verify=false. propose_alias may still be useful even when flashscore_id is null (you saw a known variant but no candidate matched the time/league).

Account for diacritics, translation (e.g., "Germany"↔"Germania"), nicknames, abbreviations.`;
}

export function parseResponse(raw: string): LLMResponse | null {
  const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/);
  const bare = raw.match(/(\{[\s\S]*\})/);
  const block = fenced ? fenced[1] : bare ? bare[1] : null;
  if (!block) return null;
  try {
    const parsed = JSON.parse(block);
    if (typeof parsed.confidence !== 'number') return null;
    // Mig 121 — sanitise alias proposal. Reject malformed shapes (string,
    // missing fields, non-string values) so a sloppy LLM output can't poison
    // team_aliases. We coerce to lowercase + trim; engine adds sport.
    let proposeAlias: AliasProposal | null = null;
    const pa = parsed.propose_alias;
    if (pa && typeof pa === 'object'
        && typeof pa.alias === 'string' && typeof pa.canonical === 'string') {
      const a = pa.alias.trim().toLowerCase();
      const c = pa.canonical.trim().toLowerCase();
      if (a.length >= 2 && c.length >= 2 && a !== c) {
        proposeAlias = { alias: a, canonical: c };
      }
    }
    return {
      flashscore_id: parsed.flashscore_id ?? null,
      confidence: Math.max(0, Math.min(1, parsed.confidence)),
      // verify defaults to false when missing (older models / malformed output) —
      // the dual gate then keeps verified=false, which is the safe fallback.
      verify: parsed.verify === true,
      reason: String(parsed.reason ?? ''),
      propose_alias: proposeAlias,
    };
  } catch {
    return null;
  }
}

export function toMatchResult(resp: LLMResponse | null): MatchResult | null {
  if (!resp || !resp.flashscore_id) return null;
  return {
    flashscore_id: resp.flashscore_id,
    stage: 'llm',
    confidence: resp.confidence,
    llm_reason: resp.reason,
    llm_verify: resp.verify,
  };
}
