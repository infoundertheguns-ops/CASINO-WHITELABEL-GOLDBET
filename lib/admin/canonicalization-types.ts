// lib/admin/canonicalization-types.ts
// TypeScript types mirroring JSONB output of mig 122 RPCs.

export type SignalState =
  | 'ok'
  | 'ok_verified'
  | 'ok_synthetic'
  | 'variant'
  | 'absent_ok'
  | 'absent_problem'
  | 'feature_pending'
  | 'structural_source_only';

export type LevelColor = 'green' | 'yellow' | 'red' | 'gray';

export interface SourceEventCard {
  source: 'kambi' | '22bet' | 'betfair' | 'unknown';
  external_id: string;
  home_team: string;
  away_team: string;
  sport: string | null;
  league_name: string | null;
  league_id: string | null;
  country: string | null;
  country_code: string | null;
  tour_code: string | null;
  starts_at: string;
  status: string;
  flashscore_id: string | null;
  match_stage: string | null;
  confidence: number | null;
  verified: boolean | null;
  verified_by: string | null;
  llm_verify: boolean | null;
  canonical_id: string | null;
  is_source_only: boolean | null;
  markets_count: number;
  outcomes_count: number;
  field_signals: Record<string, SignalState>;
}

export interface EventGroup {
  group_key: string;
  group_type: 'flashscore' | 'cross_source' | 'trigram' | 'isolated';
  real_world_label: string;
  events: SourceEventCard[];
}

export type InspectResponse = EventGroup[];

export interface LevelOverview {
  total: number;
  pct: number;
  color: LevelColor;
  // Level-specific extras
  [key: string]: unknown;
}

// ─── Browse tree (mig 123) ──────────────────────────────────────────
export interface BrowseSport {
  sport_id: string;
  sport_name: string;
  event_count: number;
}

export interface BrowseLeague {
  league_id: string;
  league_name: string;
  country: string | null;
  country_code: string | null;
  tour_code: string | null;
  event_count: number;
}

export interface BrowseGroupsResponse {
  groups: EventGroup[];
  truncated: boolean;
}

export interface OverviewResponse {
  generated_at: string;
  level_1_sports: LevelOverview;
  level_2_leagues: LevelOverview & {
    identified: number;
    unknown: number;
    per_source: {
      kambi: { unknown: number };
      '22bet': { unknown: number };
      betfair: { unknown: number };
    };
  };
  level_3_events: LevelOverview & {
    total_active_7d: number;
    flashscore_mapped: number;
    flashscore_pct: number;
    verified: number;
    verified_pct: number;
    per_stage: { auto: number; manual: number; llm_auto: number };
    cross_source_canonical: number;
    cross_source_pct: number;
    cross_source_clusters: number;
    source_only_flagged: number;
    // Sprint 3 Phase B (mig 130): mappable_total = total_active_7d - source_only_flagged.
    // coverage_among_mappable_pct = fs_mapped / mappable_total * 100. The
    // meaningful coverage number, undiluted by structural source-only events.
    mappable_total: number;
    coverage_among_mappable_pct: number;
    per_source: Record<'kambi' | '22bet' | 'betfair', { total: number; mapped: number; pct: number }>;
  };
  level_4_markets: LevelOverview & { canonical: number };
  level_5_outcomes: LevelOverview & { total_distinct: number; canonical_seed: number };
}
