// Tennis duplicate event handling (2026-05-17)
//
// Problem: OddsAPI aggregates 2 data sources for tennis and emits the same
// real-world match under 2 different odds_api_id values (one 6-digit "legacy",
// one 8-digit "v3"). The /events endpoint mixes both schemas in the same
// response. Without dedup, the ingester would create 2 events_v2 rows per
// match, and the listing UI would show duplicates.
//
// Strategy: before upsert, build a signature {sport|home|away|UTCdate} for
// each input and compare against existing events_v2 rows. If signature
// matches an existing row with a DIFFERENT odds_api_id, skip insertion and
// map the new odds_api_id to the existing event_id. Markets/outcomes from
// the new emission then attach to the existing event row via the unchanged
// chunk-upsert step, MERGING bookmaker coverage from both data sources.
//
// Gate: applied to sport_slug='tennis' only. Other sports (~1.5% dupe rate
// for football, 0% for others) skip dedup until per-sport investigation
// confirms the pattern is safe.

import type { EventV2Row } from './types.js';

export type ExistingEventRow = {
  id: string;
  odds_api_id: number;
  sport_slug: string;
  home: string;
  away: string;
  starts_at: string;
};

export type DedupPlan = {
  /** Events that should reach the chunk upsert (new or normal update). */
  toUpsert: EventV2Row[];
  /** odds_api_id -> existing event_id (from DB, resolved immediately post-plan). */
  knownReuseMap: Map<number, string>;
  /** odds_api_id -> canonical odds_api_id within batch (resolved post-upsert). */
  pendingReuseMap: Map<number, number>;
};

const DEDUP_SPORTS = new Set(['tennis']);

function signature(sport: string, home: string, away: string, startsAt: string): string {
  // Match by sport + exact team names + UTC date (HH:MM ignored — same-day
  // reschedules collapse into one event). OddsAPI keeps team names stable
  // across the two ID schemas, so string equality is reliable.
  const dateUtc = startsAt.slice(0, 10);
  return `${sport}|${home}|${away}|${dateUtc}`;
}

export function planDedup(
  inputs: EventV2Row[],
  existingRows: ExistingEventRow[],
): DedupPlan {
  const toUpsert: EventV2Row[] = [];
  const knownReuseMap = new Map<number, string>();
  const pendingReuseMap = new Map<number, number>();

  const sigToExisting = new Map<string, ExistingEventRow>();
  for (const row of existingRows) {
    if (!DEDUP_SPORTS.has(row.sport_slug)) continue;
    const sig = signature(row.sport_slug, row.home, row.away, row.starts_at);
    if (!sigToExisting.has(sig)) sigToExisting.set(sig, row);
  }

  const sigToCanonical = new Map<string, number>();

  for (const ev of inputs) {
    if (!DEDUP_SPORTS.has(ev.sport_slug)) {
      toUpsert.push(ev);
      continue;
    }
    const sig = signature(ev.sport_slug, ev.home, ev.away, ev.starts_at);

    const existing = sigToExisting.get(sig);
    if (existing) {
      if (existing.odds_api_id === ev.odds_api_id) {
        toUpsert.push(ev);
      } else {
        knownReuseMap.set(ev.odds_api_id, existing.id);
      }
      continue;
    }

    const canonical = sigToCanonical.get(sig);
    if (canonical !== undefined) {
      pendingReuseMap.set(ev.odds_api_id, canonical);
      continue;
    }

    sigToCanonical.set(sig, ev.odds_api_id);
    toUpsert.push(ev);
  }

  return { toUpsert, knownReuseMap, pendingReuseMap };
}
