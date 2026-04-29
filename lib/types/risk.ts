export interface BettingLimit {
  id: string;
  agent_id: string | null;
  player_id: string | null;
  sport: string | null;
  max_stake: number | null;
  max_win: number | null;
  max_daily_turnover: number | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  agent_name?: string;
  player_username?: string;
}

export interface BlacklistEntry {
  id: string;
  player_id: string;
  agent_id: string | null;
  reason: string;
  blocked_by: string;
  is_active: boolean;
  created_at: string;
  player_username?: string;
  agent_name?: string;
}

export interface RiskAlert {
  id: string;
  alert_type: string;
  player_id: string | null;
  agent_id: string | null;
  details: any;
  notified: boolean;
  created_at: string;
}

export interface RiskAlertConfig {
  max_exposure: number;
  max_daily_win: number;
  consecutive_wins_alert: number;
  enabled: boolean;
}
