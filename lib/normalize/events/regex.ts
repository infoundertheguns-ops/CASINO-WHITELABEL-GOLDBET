// lib/normalize/events/regex.ts
// Stage 2: regex fuzzy matching — port of lib/flashscore.ts matchFixtures().
//
// Sprint 2.x — dynamic confidence (was fixed 0.8). Match strength tiers:
//   * Exact case-insensitive on both sides + time within 30min → 0.99
//   * Exact after normalize (alnum only) + time within 1h     → 0.97  ← reaches auto-verify
//   * Exact after normalize + time within 2h                  → 0.92
//   * Word-set equality (handles "AC Milan" vs "Milan AC")    → 0.88
// When the candidate carries a v2-RPC `score` >= 0.95, prefer score (it already
// includes league/country boost). Cap output at 0.99 — regex never claims absolute certainty.

import type { EventToNormalize, FlashscoreCandidate, MatchResult } from './types';

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function lower(s: string): string {
  return s.trim().toLowerCase();
}

function wordSet(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1), // drop single-letter noise like "F" / "C"
  );
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size || a.size === 0) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function hoursBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / (1000 * 60 * 60);
}

interface Scored {
  candidate: FlashscoreCandidate;
  confidence: number;
}

function scoreOne(event: EventToNormalize, c: FlashscoreCandidate): Scored | null {
  const eh = lower(event.home_team);
  const ea = lower(event.away_team);
  const ch = lower(c.home_team);
  const ca = lower(c.away_team);
  if (!eh || !ea || !ch || !ca) return null;

  const dt = hoursBetween(event.starts_at, c.starts_at);
  if (dt > 2) return null;

  // Tier 1: exact case-insensitive + tight time
  if (eh === ch && ea === ca) {
    if (dt <= 0.5) return { candidate: c, confidence: 0.99 };
    if (dt <= 1) return { candidate: c, confidence: 0.97 };
    return { candidate: c, confidence: 0.93 };
  }

  // Tier 2: exact after normalize (alnum-only)
  const nEh = normalize(eh);
  const nEa = normalize(ea);
  const nCh = normalize(ch);
  const nCa = normalize(ca);
  if (nEh === nCh && nEa === nCa) {
    if (dt <= 1) return { candidate: c, confidence: 0.97 };
    return { candidate: c, confidence: 0.92 };
  }

  // Tier 3: word-set equality (handles reordered tokens like "AC Milan" vs "Milan AC")
  if (setsEqual(wordSet(eh), wordSet(ch)) && setsEqual(wordSet(ea), wordSet(ca))) {
    return { candidate: c, confidence: 0.88 };
  }

  return null;
}

export async function matchByRegex(
  event: EventToNormalize,
  candidates: FlashscoreCandidate[],
): Promise<MatchResult | null> {
  if (!event.home_team || !event.away_team || candidates.length === 0) return null;

  const scored: Scored[] = [];
  for (const c of candidates) {
    const r = scoreOne(event, c);
    if (r) scored.push(r);
  }
  if (scored.length === 0) return null;

  // Pick the best regex match. If the v2 RPC supplied a `score` and it's
  // higher than our regex tier, prefer it (it includes league/country boost).
  scored.sort((a, b) => {
    const sa = Math.max(a.confidence, Number(a.candidate.score ?? 0));
    const sb = Math.max(b.confidence, Number(b.candidate.score ?? 0));
    return sb - sa;
  });
  const best = scored[0];
  const v2 = Number(best.candidate.score ?? 0);
  const finalConf = Math.min(0.99, Math.max(best.confidence, v2 >= 0.95 ? v2 : 0));

  return {
    flashscore_id: best.candidate.flashscore_id,
    stage: 'regex',
    confidence: finalConf,
  };
}
