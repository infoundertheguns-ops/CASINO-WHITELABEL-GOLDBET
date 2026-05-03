export interface DbSport {
  name: string;
  slug: string;
  icon?: string;
}

export interface DbLeague {
  name: string;
  slug: string;
  country?: string;
  logo_url?: string;
}

export interface DbOutcome {
  id: string;
  market_id: string;
  name: string;
  odds: number;
  previous_odds?: number;
  is_active: boolean;
  is_suspended: boolean;
  manual_odds?: number | null;
  manual_suspended?: boolean | null;
  // Per-outcome line (one row per (market_id, outcome.line) when applicable)
  line?: number | null;
}

export interface DbMarket {
  id: string;
  event_id: string;
  name: string;
  slug: string;
  market_type: string;
  line?: number;
  sort_order: number;
  is_active: boolean;
  is_suspended: boolean;
  outcomes?: DbOutcome[];
  // Canonical fields enriched by /api/sportsbook via market_normalization.
  // Enables source-agnostic column dispatch — Kambi "1X2 1° Tempo" and
  // 22bet "1X2 - 1T" both carry canonical_key="1x2_1h".
  canonical_key?: string | null;
  canonical_line?: number | null;
  canonical_name_it?: string | null;
}

export interface DbEvent {
  id: string;
  external_id: string;
  sport_id: string;
  league_id: string;
  home_team: string;
  away_team: string;
  starts_at: string;
  status: "prematch" | "live" | "finished" | "cancelled" | "postponed";
  score_home?: number;
  score_away?: number;
  minute?: number;
  period?: string;
  is_live: boolean;
  is_featured: boolean;
  live_data: Record<string, unknown>;
  result?: Record<string, unknown>;
  source: string;
  source_markets_count?: number;
  sport?: DbSport;
  league?: DbLeague;
  markets?: DbMarket[];
}

export interface DbIppicaMeeting {
  id: string;
  external_id?: string;
  name: string;
  country: string;
  country_id?: string;
  race_type?: string;
  meeting_date: string;
  race_count?: number;
  status?: string;
  created_at: string;
  updated_at?: string;
}

export interface DbIppicaRace {
  id: string;
  external_id?: string;
  meeting_id: string;
  title: string;
  race_number: number;
  scheduled_at: string;
  off_time?: string;
  status: "scheduled" | "live" | "finished" | "cancelled" | "completed";
  race_class?: string;
  distance?: number;
  distance_units?: string;
  track?: string;
  race_kind?: string;
  going?: string;
  handicap?: boolean;
  eligibility?: string;
  prize_amount?: number;
  prize_currency?: string;
  runners_count?: number;
  created_at: string;
  updated_at?: string;
}

export interface DbIppicaRunner {
  id: string;
  race_id: string;
  external_id?: string;
  name: string;
  runner_number: number;
  drawn?: string;
  age?: number;
  sex?: string;
  weight_text?: string;
  weight_value?: number;
  jockey?: string;
  trainer?: string;
  rating?: number;
  form?: string;
  comment_it?: string;
  silk?: string;
  is_non_runner?: boolean;
  finish_position?: number | null;
  created_at: string;
  updated_at?: string;
}

export interface DbIppicaMarket {
  id: string;
  race_id: string;
  market_type: string;
  market_label?: string;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

export interface DbIppicaOdds {
  id: string;
  market_id: string;
  runner_number?: number | null;
  selection_name: string;
  odds: number | null;
  previous_odds?: number | null;
  trend?: string;
  status?: string;
  result?: string;
  created_at: string;
  updated_at?: string;
}
