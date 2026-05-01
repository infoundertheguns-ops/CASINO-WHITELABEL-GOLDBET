// odds-api.io v3 response types (subset we consume)

export type ApiSport = { name: string; slug: string };
export type ApiLeague = { name: string; slug: string; eventsCount?: number };

export type ApiPeriodScore = { home: number; away: number };
export type ApiScores = {
  home?: number;
  away?: number;
  periods?: Record<string, ApiPeriodScore>;
};

export type ApiOddsML = { home: string; draw?: string; away: string };
export type ApiOddsTotal = { hdp: number; over: string; under: string };
export type ApiOddsBTTS = { yes: string; no: string };
export type ApiOddsAH = { hdp: number; home: string; away: string };

export type ApiMarket = {
  name: string;
  updatedAt?: string;
  odds: Array<ApiOddsML | ApiOddsTotal | ApiOddsBTTS | ApiOddsAH | Record<string, unknown>>;
};

export type ApiEvent = {
  id: number;
  home: string;
  away: string;
  homeId?: number;
  awayId?: number;
  date: string;
  status: 'pending' | 'live' | 'settled' | 'cancelled' | 'postponed';
  sport: ApiSport;
  league: ApiLeague;
  scores?: ApiScores;
  urls?: Record<string, string>;
  bookmakerIds?: Record<string, string>;
  bookmakers?: Record<string, ApiMarket[]>;
};

// DB row shapes for upsert

export type EventV2Row = {
  odds_api_id: number;
  home: string;
  away: string;
  home_id: number | null;
  away_id: number | null;
  starts_at: string;
  sport_slug: string;
  sport_name: string;
  league_slug: string;
  league_name: string;
  status: string;
  score_home: number | null;
  score_away: number | null;
  period_scores: Record<string, ApiPeriodScore> | null;
  urls: Record<string, string>;
};

export type MarketV2Row = {
  event_odds_api_id: number;          // resolved -> event_id at upsert time
  bookmaker: string;
  market_name: string;
  odds_api_updated_at: string | null;
};

export type OutcomeV2Row = {
  market_key: { event_odds_api_id: number; bookmaker: string; market_name: string };
  outcome_key: string;
  line: number | null;
  odds: number;
};

export type TransformResult = {
  event: EventV2Row;
  markets: MarketV2Row[];
  outcomes: OutcomeV2Row[];
};

// === Realtime publisher wire contract (Plan D #3a) ===
// These shapes MUST match the consumer at:
//   betssolution-player/lib/hooks/use-live-odds.ts
//   betssolution-player/app/api/odds/stream/route.ts
// Do not reshape without coordinating with the consumer.

export interface LiveOddsChange {
  market_type: string;
  outcome_name: string;
  odds: number;
  previous_odds: number | null;
}

export interface LiveOddsMessage {
  event_id: string; // String(ApiEvent.id) — Redis wire is string-keyed
  ts: number;
  type: 'update' | 'finished';
  changes: LiveOddsChange[];
  scores?: { home: number; away: number };
  minute?: number;
  period?: string;
}

export interface CachedEventMarket {
  type: string;
  outcomes: Array<{ name: string; odds: number }>;
}

export interface CachedEvent {
  external_id: string;
  home_team: string;
  away_team: string;
  sport: string;
  league: string;
  minute?: number;
  period?: string;
  scores?: { home: number; away: number };
  markets: CachedEventMarket[];
  updated_at: number;
}
