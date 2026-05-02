// ═══════════════════════════════════════════════════
// DATABASE TYPES — mirrors Supabase schema
// Run `npm run db:types` to auto-generate from Supabase
// ═══════════════════════════════════════════════════

// ═══ AUTH & USERS ═══
export interface User {
  id: string;
  email: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
  kyc_status: "unverified" | "pending" | "verified" | "rejected";
  user_class: "new" | "recreational" | "semi_pro" | "sharp" | "vip";
  is_blocked: boolean;
  country?: string;
  created_at: string;
  last_login_at?: string;
}

export interface Wallet {
  id: string;
  user_id: string;
  currency: string;
  balance: number;
  bonus_balance: number;
  locked_balance: number;
  updated_at: string;
}

export interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  role: "super_admin" | "admin" | "risk_manager" | "support" | "finance";
  permissions: string[];
  is_active: boolean;
}

// ═══ SPORTSBOOK ═══
export interface Sport {
  id: string;
  name: string;
  slug: string;
  icon?: string;
  sort_order: number;
  is_active: boolean;
}

export interface League {
  id: string;
  sport_id: string;
  name: string;
  slug: string;
  country?: string;
  icon?: string;
  is_active: boolean;
}

export interface Event {
  id: string;
  sport_id: string;
  league_id: string;
  name: string;
  home_team: string;
  away_team: string;
  starts_at: string;
  status: "prematch" | "live" | "ended" | "cancelled" | "postponed";
  score_home?: number;
  score_away?: number;
  minute?: number;
  period?: string;
  is_featured: boolean;
}

export interface Market {
  id: string;
  event_id: string;
  type: string; // 1x2, over_under, btts, etc.
  name: string;
  line?: number;
  status: "open" | "suspended" | "closed" | "settled";
  sort_order: number;
}

export interface Odd {
  id: string;
  market_id: string;
  selection: string;
  price: number;
  probability?: number;
  status: "active" | "suspended";
  updated_at: string;
}

export interface Bet {
  id: string;
  user_id: string;
  type: "singola" | "multipla" | "sistema";
  stake: number;
  potential_win: number;
  total_odds: number;
  status: "open" | "won" | "lost" | "void" | "cashout" | "pending_acceptance" | "rejected";
  is_free_bet: boolean;
  free_bet_id?: string;
  settled_at?: string;
  created_at: string;
  legs: BetLeg[];
  // Sistema (system bet) fields
  parent_bet_id?: string;
  combo_type?: string;       // "2/3", "3/5", etc.
  combo_count?: number;      // C(N,K) number of combos
  combos_won?: number;
  // Acceptance system
  requested_stake?: number;
  accepted_stake?: number;
  acceptance_mode?: "auto" | "manual" | "partial";
  accepted_by?: string;
  acceptance_note?: string;
  reviewed_at?: string;
  // Tracking
  placed_ip?: string;
  placed_fingerprint?: string;
  time_to_kickoff_minutes?: number;
  risk_score?: number;
  risk_flags?: string[];
}

export interface BetLeg {
  id: string;
  bet_id: string;
  event_id: string;
  market_id: string;
  odd_id: string;
  selection: string;
  odds_at_placement: number;
  result: "pending" | "won" | "lost" | "void" | "push" | "half_won" | "half_lost";
  event_name?: string;
  market_name?: string;
}

// ═══ CASINO ═══
export interface CasinoProvider {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;
  status: "active" | "maintenance" | "disabled";
  game_count: number;
}

export interface CasinoGame {
  id: string;
  provider_id: string;
  name: string;
  slug: string;
  category: "slots" | "live_casino" | "table_games" | "crash" | "scratch" | "video_poker" | "virtual_sports";
  thumbnail_url?: string;
  rtp?: number;
  volatility?: "low" | "medium" | "high";
  is_featured: boolean;
  is_new: boolean;
  is_active: boolean;
  launch_url?: string;
}

export interface GameSession {
  id: string;
  user_id: string;
  game_id: string;
  started_at: string;
  ended_at?: string;
  total_bet: number;
  total_win: number;
  rounds_played: number;
}

// ═══ CRYPTO PAYMENTS ═══
export interface CryptoDeposit {
  id: string;
  user_id: string;
  coin: "BTC" | "ETH" | "USDT_TRC" | "USDT_ERC" | "SOL";
  amount: number;
  amount_usd: number;
  address: string;
  tx_hash?: string;
  confirmations: number;
  required_confirmations: number;
  status: "pending" | "confirming" | "confirmed" | "credited" | "failed";
  created_at: string;
}

export interface CryptoWithdrawal {
  id: string;
  user_id: string;
  coin: "BTC" | "ETH" | "USDT_TRC" | "USDT_ERC" | "SOL";
  amount: number;
  amount_usd: number;
  address: string;
  tx_hash?: string;
  risk_score: number;
  flags: string[];
  status: "pending" | "approved" | "processing" | "completed" | "rejected" | "held";
  reviewed_by?: string;
  reviewed_at?: string;
  created_at: string;
}

export interface HotWallet {
  id: string;
  coin: string;
  address: string;
  balance: number;
  balance_usd: number;
  threshold_min: number;
  threshold_max: number;
}

export interface AMLAlert {
  id: string;
  user_id?: string;
  severity: "critical" | "high" | "medium" | "low";
  type: string;
  description: string;
  amount_usd?: number;
  status: "open" | "investigating" | "resolved" | "false_positive";
  created_at: string;
}

// ═══ PROMOTIONS ═══
export interface Promotion {
  id: string;
  code: string;
  name: string;
  slug?: string;
  description?: string;
  short_description?: string;
  terms_conditions?: string;
  banner_url?: string;
  badge_text?: string;
  badge_color?: string;
  type: PromotionType;
  category: "casino" | "sport" | "tournament" | "vip" | "referral";
  status: "draft" | "scheduled" | "active" | "paused" | "expired" | "archived";
  starts_at: string;
  ends_at?: string;
  max_claims_per_user: number;
  total_claims: number;
  is_featured: boolean;
  created_at: string;
}

export type PromotionType =
  | "casino_welcome" | "casino_deposit" | "casino_reload" | "casino_cashback"
  | "casino_no_deposit" | "free_spins" | "free_spins_no_deposit"
  | "sport_welcome" | "sport_free_bet" | "sport_enhanced_odds"
  | "sport_cashback" | "sport_acca_boost"
  | "slot_tournament" | "race" | "vip_reward" | "referral" | "custom";

export interface PromotionRules {
  id: string;
  promotion_id: string;
  min_deposit?: number;
  bonus_type?: "percentage" | "fixed" | "free_spins" | "free_bet";
  bonus_percentage?: number;
  max_bonus_amount?: number;
  free_spins_count?: number;
  free_spins_value?: number;
  free_bet_amount?: number;
  free_bet_min_odds?: number;
  cashback_percentage?: number;
  cashback_max_amount?: number;
  wagering_multiplier: number;
  wagering_applies_to: "bonus" | "bonus_and_deposit";
  wagering_deadline_days: number;
  max_bet_while_wagering?: number;
  max_win_from_bonus?: number;
  game_contributions: Record<string, number>;
}

export interface UserPromotion {
  id: string;
  user_id: string;
  promotion_id: string;
  bonus_amount: number;
  bonus_type?: string;
  status: "active" | "wagering" | "completed" | "forfeited" | "expired" | "cancelled";
  wagering_required: number;
  wagering_completed: number;
  wagering_remaining: number;
  wagering_deadline?: string;
  free_spins_total: number;
  free_spins_used: number;
  free_spins_remaining: number;
  free_spins_winnings: number;
  free_bet_amount: number;
  free_bet_used: boolean;
  claimed_at: string;
  completed_at?: string;
}

export interface SlotTournament {
  id: string;
  promotion_id?: string;
  name: string;
  description?: string;
  starts_at: string;
  ends_at: string;
  tournament_type: string;
  scoring_metric: "win_multiplier" | "total_win" | "total_wagered" | "points";
  entry_type: "free" | "buy_in" | "deposit_required";
  total_prize_pool: number;
  prize_distribution: PrizeEntry[];
  status: "upcoming" | "registration" | "live" | "calculating" | "completed" | "cancelled";
  participants_count: number;
}

export interface PrizeEntry {
  rank?: number;
  rank_from?: number;
  rank_to?: number;
  prize: number;
  type: "real_money" | "bonus" | "free_spins";
  free_spins_count?: number;
}

export interface TournamentParticipant {
  id: string;
  tournament_id: string;
  user_id: string;
  score: number;
  total_spins: number;
  total_wagered: number;
  biggest_win: number;
  biggest_multiplier: number;
  current_rank?: number;
  final_rank?: number;
  prize_amount?: number;
  prize_type?: string;
}

// ═══ RISK ═══
export interface RiskAlert {
  id: string;
  user_id?: string;
  severity: "critical" | "high" | "medium" | "low";
  type: string;
  description: string;
  amount?: number;
  status: "open" | "acknowledged" | "resolved" | "dismissed";
  created_at: string;
}

export interface RiskFlag {
  id: string;
  user_id?: string;
  flag_type: "auto_block" | "manual_review" | "kyc_required" | "limit_reduce" | "monitoring";
  severity: "critical" | "high" | "medium" | "low";
  description?: string;
  ai_analysis?: Record<string, any>;
  related_entity_type?: "bet" | "deposit" | "withdrawal" | "session";
  related_entity_id?: string;
  status: "open" | "acknowledged" | "resolved" | "dismissed" | "escalated";
  resolved_by?: string;
  resolved_at?: string;
  created_at: string;
  users?: { username: string };
}

export interface PlayerProfile {
  id: string;
  user_id: string;
  classification: "recreational" | "semi_pro" | "sharp" | "syndicate" | "vip";
  risk_score: number;
  total_bets: number;
  total_stake: number;
  total_won: number;
  total_lost: number;
  win_rate: number;
  avg_stake: number;
  avg_odds: number;
  max_stake: number;
  total_deposits: number;
  total_withdrawals: number;
  lifetime_ggr: number;
  last_bet_at?: string;
  last_deposit_at?: string;
  flags_count: number;
  device_fingerprints: string[];
  ip_addresses: string[];
  notes?: string;
  updated_at: string;
  created_at: string;
}

export interface RiskConfig {
  thresholds: {
    auto_block: number;
    auto_flag: number;
    auto_reduce_limits: number;
    auto_kyc: number;
    ai_threshold: number;
  };
  auto_actions: {
    enabled: boolean;
    block_account: boolean;
    reduce_limits: boolean;
    require_kyc: boolean;
    notify_admin: boolean;
  };
  rules: {
    stake_spike_multiplier: number;
    high_stake: number;
    very_high_stake: number;
    new_account_days: number;
    young_account_days: number;
    high_odds: number;
    extreme_odds: number;
    velocity_1h: number;
    extreme_velocity_1h: number;
    win_rate_threshold: number;
    win_rate_min_bets: number;
    unverified_stake: number;
    free_bet_high_odds: number;
  };
  ai_settings: {
    enabled: boolean;
    model: string;
    max_tokens: number;
    auto_analyze_above: number;
  };
}

export interface DailyStats {
  id: string;
  date: string;
  bet_count: number;
  total_stake: number;
  total_payout: number;
  ggr: number;
  margin_pct: number;
  deposit_count: number;
  deposit_volume: number;
  withdrawal_count: number;
  withdrawal_volume: number;
  new_users: number;
  active_users: number;
  risk_alerts: number;
  sport_breakdown: Record<string, { count: number; stake: number }>;
  casino_ggr: number;
  created_at: string;
}

export interface EnhancedRiskAnalysis {
  score: number;
  level: "low" | "medium" | "high" | "critical";
  flags: string[];
  player_classification: string;
  confidence: number;
  recommended_actions: string[];
  reasoning: string;
}

// ═══ RISK — Additional types ═══

export interface RiskAction {
  id: string;
  action_type: string;
  entity_type: string;
  entity_id: string;
  performed_by?: string;
  performed_by_system: boolean;
  details?: Record<string, any>;
  notes?: string;
  created_at: string;
}

export interface AdminNotification {
  id: string;
  admin_user_id?: string;
  type: "risk_alert" | "bet_review" | "liability_warning" | "odds_suggestion" | "system";
  severity: "info" | "warning" | "critical";
  title: string;
  message?: string;
  link?: string;
  related_entity_type?: string;
  related_entity_id?: string;
  is_read: boolean;
  created_at: string;
}

export interface OddsAdjustment {
  id: string;
  outcome_id: string;
  market_id?: string;
  event_id?: string;
  old_odds: number;
  new_odds: number;
  reason: string;
  suggested_by?: string;
  approved_by?: string;
  auto_applied: boolean;
  liability_snapshot?: Record<string, any>;
  created_at: string;
}

export interface LoginFingerprint {
  id: string;
  user_id: string;
  ip_address?: string;
  fingerprint?: string;
  user_agent?: string;
  country?: string;
  created_at: string;
}

export interface AcceptanceConfig {
  mode: "auto" | "manual" | "hybrid";
  partial_accept_enabled: boolean;
  manual_review_stake_threshold: number;
  live_bet_delay_seconds: number;
  max_liability_per_outcome: number;
  max_liability_per_event: number;
  max_liability_per_market: number;
  sharp_player_mode: "auto" | "manual" | "block";
  odds_change_tolerance: number;
  auto_accept_max_stake: number;
  always_manual_classes: string[];
}

// ═══ AGENTS ═══
export interface Agent {
  id: string;
  user_id: string;
  parent_agent_id?: string;
  name: string;
  commission_type: "ggr_share" | "turnover_share" | "cpa" | "hybrid";
  commission_rate: number;
  level: number;
  is_active: boolean;
}

// ═══ UI / APP TYPES ═══
export interface BetslipItem {
  event_id: string;
  market_id: string;
  odd_id: string;
  event_name: string;
  market_name: string;
  selection: string;
  odds: number;
}

export interface NavItem {
  id: string;
  icon: string;
  label: string;
  href: string;
  badge?: number;
}

export interface AdminNavGroup {
  group: string;
  items: AdminNavItem[];
}

export interface AdminNavItem {
  id: string;
  icon: string;
  label: string;
  badge?: number;
}
