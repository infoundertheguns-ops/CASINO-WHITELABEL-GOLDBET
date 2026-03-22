// lib/types/ippica.ts

export interface IppicaMeeting {
  id: string;
  external_id: string;
  name: string;
  country: string;
  country_id: string;
  race_type: string; // "GL" (galoppo) | "TR" (trotto)
  meeting_date: string;
  race_count: number;
  status: string; // scheduled | active | completed
}

export interface IppicaRace {
  id: string;
  external_id: string;
  meeting_id: string;
  title: string;
  race_number: number;
  scheduled_at: string;
  off_time?: string;
  status: string; // scheduled | open | closed | running | finished | abandoned
  race_class?: string;
  distance?: number;
  distance_units?: string;
  track?: string;
  race_kind?: string;
  going?: string;
  weather?: string;
  handicap: boolean;
  eligibility?: string;
  prize_amount?: number;
  prize_currency?: string;
  runners_count: number;
  // Joined from meeting
  meeting_name?: string;
  meeting_country?: string;
  meeting_race_type?: string;
}

export interface IppicaRunner {
  id: string;
  race_id: string;
  external_id: string;
  name: string;
  runner_number: number;
  drawn?: string;
  age?: number;
  sex?: string;
  weight_text?: string;
  weight_value?: number;
  jockey?: string;
  trainer?: string;
  trainer_location?: string;
  owner?: string;
  breeder?: string;
  bred?: string;
  color?: string;
  silk?: string;
  form?: string;
  rating?: number;
  comment_it?: string;
  breeding?: Record<string, unknown>;
  tackle?: Record<string, unknown>[];
  is_non_runner: boolean;
  finish_position?: number;
  disqualified?: boolean;
}

export interface IppicaMarket {
  id: string;
  race_id: string;
  market_type: string; // Winner, Place (2), Place (3), Place (4), Head to head, Even and odd
  market_label: string;
  is_active: boolean;
}

export interface IppicaOdds {
  id: string;
  market_id: string;
  runner_number?: number;
  selection_name: string;
  odds?: number;
  previous_odds?: number;
  trend: string; // down | stable | up
  status: string; // active | suspended | resulted
  result?: string; // won | lost | void
}

// Enriched odds with runner info for display
export interface IppicaOddsWithRunner extends IppicaOdds {
  runner?: IppicaRunner;
}

// Market with its odds
export interface IppicaMarketWithOdds extends IppicaMarket {
  odds: IppicaOdds[];
}

// For the "next races" strip
export interface NextRaceInfo {
  raceId: string;
  meetingId: string;
  meetingName: string;
  country: string;
  raceNumber: number;
  scheduledAt: string;
  status: string;
}

// Ippica betslip selection
export interface IppicaBetSelection {
  source: "ippica";
  raceId: string;
  raceName: string;
  meetingName: string;
  raceNumber: number;
  marketType: string;
  marketId: string;
  selectionName: string;
  odds: number;
  oddsId: string;
  runnerNumber?: number;
}
