// lib/types/bets-admin.ts
//
// Shared types for /api/admin/bets/* endpoints and pages under /admin/bets.
//
// NOTE: The "code" field shown in UI is derived as `id.split('-')[0]` (8 chars,
// e.g., `a3f7b9c2`). This is computed in API responses, not stored in DB.

export type BetStatus =
  | "open" | "won" | "lost" | "void"
  | "pending_acceptance" | "rejected" | "cashout";

export type BetType = "single" | "multi" | "system";

export type SelectionSource = "sport" | "ippica" | "ippica_tote";

// Plan D: half-stake variants from Asian Handicap quarter / Goal Line .25/.75 markets
export type SelectionResult = "won" | "lost" | "half_won" | "half_lost" | "void" | null;

export interface BetsListFilters {
  status?: BetStatus | "all";
  from?: string;
  to?: string;
  kiosk_id?: string;
  agent_id?: string;
  user_id?: string;
  sport?: string;
  min_stake?: number;
  max_stake?: number;
  is_live?: boolean;
  risk_min?: number;
  risk_max?: number;
  search?: string;
  sort?: "created_at" | "stake" | "payout";
  dir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface BetListItem {
  id: string;
  code: string;                 // derived: id.split('-')[0]
  user: { id: string; username: string | null };
  kiosk: { code: string | null; name: string | null } | null;
  agent: { code: string | null; name: string | null } | null;
  bet_type: BetType;
  stake: number;
  potential_win: number | null;
  actual_win: number | null;
  total_odds: number | null;
  status: BetStatus;
  is_live: boolean;
  selections_count: number;
  risk_score: number;
  created_at: string;
  settled_at: string | null;
}

export interface BetsListAggregates {
  total_stake: number;
  total_payout: number;
  ggr_pct: number;
  open_count: number;
}

export interface BetsListResponse {
  bets: BetListItem[];
  total: number;
  aggregates: BetsListAggregates;
}

export interface BetSelectionDetail {
  id: string;
  source: SelectionSource;
  event: { name: string; league: string | null; sport: string | null };
  market: { type: string; label: string | null };
  outcome: { name: string };
  odds_at_placement: number;
  current_odds: number | null;
  result: SelectionResult;
  settled_at: string | null;
  // Ippica-only optional fields:
  race_meeting?: string | null;
  race_date?: string | null;
  horse_number?: number | null;
}

export interface BetEventLogEntry {
  ts: string;
  event: "placed" | "accepted" | "settled";
  actor: "player" | "system" | "admin";
  data: Record<string, unknown>;
}

export interface BetDetailResponse {
  bet: {
    id: string;
    code: string;
    bet_type: BetType;
    stake: number;
    requested_stake: number | null;
    accepted_stake: number | null;
    total_odds: number | null;
    potential_win: number | null;
    actual_win: number | null;
    status: BetStatus;
    is_live: boolean;
    is_free_bet: boolean;
    selections_count: number;
    combo_type: string | null;
    combo_count: number | null;
    combos_won: number | null;
    parent_bet_id: string | null;
    created_at: string;
    settled_at: string | null;
    reviewed_at: string | null;
    time_to_kickoff_minutes: number | null;
  };
  user: { id: string; username: string | null; kyc_status: string | null; country: string | null };
  kiosk: { id: string; code: string; name: string; agent_id: string | null } | null;
  agent: { id: string; code: string; name: string; level: number | null } | null;
  selections: BetSelectionDetail[];
  children_combos: Array<{ id: string; stake: number; total_odds: number | null; potential_win: number | null; actual_win: number | null; status: BetStatus; selections_count: number }>;
  risk: {
    score: number;
    flags: string[];
    acceptance_mode: string | null;
    acceptance_note: string | null;
    accepted_by: string | null;
    placed_ip: string | null;
    placed_fingerprint: string | null;
  };
  event_log: BetEventLogEntry[];
}

export type BetsScope = "all" | { agent_id: string };
