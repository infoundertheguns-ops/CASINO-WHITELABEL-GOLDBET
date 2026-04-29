export type AgentLevel = 1 | 2 | 3;
export type AgentStatus = "active" | "suspended" | "closed";
export type WalletModel = "prepaid" | "postpaid";
export type PermissionLevel = "none" | "viewer" | "editor";

export const PERMISSION_KEYS = [
  "dashboard", "players", "sub_agents", "credit",
  "tickets", "reports", "commissions", "bets", "risk", "kiosks",
] as const;

export type PermissionKey = typeof PERMISSION_KEYS[number];
export type AgentPermissions = Record<PermissionKey, PermissionLevel>;

export const LEVEL_LABELS: Record<AgentLevel, string> = {
  1: "Master Agent",
  2: "Agent",
  3: "Sub-Agent",
};

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  dashboard: "Dashboard",
  players: "Giocatori",
  sub_agents: "Sub-Agenti",
  credit: "Credito",
  tickets: "Ticket",
  reports: "Report",
  commissions: "Commissioni",
  bets: "Scommesse",
  risk: "Rischio",
  kiosks: "Kiosk",
};

export interface Agent {
  id: string;
  user_id: string;
  parent_id: string | null;
  level: AgentLevel;
  name: string;
  code: string;
  wallet_model: WalletModel;
  commission_type: string;
  commission_rate: number;
  status: AgentStatus;
  settlement_period: "weekly" | "monthly";
  permissions: AgentPermissions;
  is_active: boolean;
  total_players: number;
  total_ggr: number;
  total_commission: number;
  created_at: string;
  updated_at: string;
  // Joined fields
  parent_name?: string;
  email?: string;
  wallet_balance?: number;
}

export interface AgentTransaction {
  id: string;
  agent_id: string;
  type: string;
  amount: number;
  balance_after: number | null;
  target_user_id: string | null;
  reference_id: string | null;
  notes: string | null;
  performed_by: string | null;
  created_at: string;
}

export interface AgentSettlement {
  id: string;
  agent_id: string;
  period_start: string;
  period_end: string;
  total_turnover: number;
  total_winnings: number;
  ggr: number;
  commission_pct: number;
  commission_amount: number;
  status: string;
  approved_at: string | null;
  approved_by: string | null;
  paid_at: string | null;
  paid_by: string | null;
  notes: string | null;
  created_at: string;
}

export interface BettingPermissions {
  disabled_sports: string[];
  disabled_leagues: string[];
  disabled_market_types: string[];
  event_blacklist: string[];
}

export interface TicketLimits {
  max_stake_single: number;
  max_stake_multi: number;
  max_stake_system: number;
  max_stake_day: number;
  max_stake_night: number;
  day_hours_start: string;
  day_hours_end: string;
  max_potential_win: number;
  max_daily_bets: number;
  max_repeat_bets: number;
  max_odds_single: number;
  max_odds_multi: number;
}

export const DEFAULT_PERMISSIONS: AgentPermissions = {
  dashboard: "viewer",
  players: "editor",
  sub_agents: "none",
  credit: "editor",
  tickets: "editor",
  reports: "viewer",
  commissions: "viewer",
  bets: "viewer",
  risk: "none",
  kiosks: "none",
};
