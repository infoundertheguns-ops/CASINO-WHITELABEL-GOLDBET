// ═══ Types for Scraper Stats Dashboard ═══

export interface SportBreakdown {
  events: number;
  markets: number;
  outcomes: number;
}

export interface ScraperStats {
  live_events: number;
  prematch_events: number;
  live_markets: number;
  prematch_markets: number;
  live_outcomes: number;
  prematch_outcomes: number;
  last_live_cycle: string;
  last_prematch_cycle: string;
  errors_last_hour: number;
  session_status: string;
  by_sport?: Record<string, { live: SportBreakdown; prematch: SportBreakdown }>;
  live_events_current_cycle?: number;
  prematch_events_current_cycle?: number;
  detail_workers?: number | { ready: number; total: number };
  memory_mb?: number;
  source?: string;
  uptime_seconds?: number;
  prematch_cycle_duration_ms?: number;
  cycle_ms?: number;
  sports?: Record<string, any>;
  [key: string]: any;
}

export interface DbCounts {
  live_events: number;
  prematch_events: number;
  active_markets: number;
  active_outcomes: number;
  finished_events: number;
  ended_events: number;
}

export interface SportData {
  goldbet: { live: SportBreakdown; prematch: SportBreakdown };
  vincitu: {
    live_events: number;
    prematch_events: number;
    active_markets: number;
    active_outcomes: number;
  };
}

export interface Snapshot {
  timestamp: string;
  goldbet: ScraperStats;
  vincitu: DbCounts;
  diffs: {
    live_events_pct: number;
    prematch_events_pct: number;
    markets_pct: number;
    outcomes_pct: number;
  };
  by_sport?: Record<string, SportData>;
}

export interface ServerData {
  latest: Snapshot | null;
  history: Snapshot[];
}

export interface StatsResponse {
  connected: boolean;
  latest: Snapshot | null;
  history: Snapshot[];
  servers: Record<string, ServerData>;
  vincitu_only?: {
    live_events: number;
    prematch_events: number;
    finished_events: number;
    ended_events: number;
  };
}

export interface RedisMetrics {
  redis: {
    connected: boolean;
    memory_used: number;
    latency_ms: number;
    error?: string;
  };
  odds: {
    active_events: number;
    sse_clients: number;
    write_queue_depth: number;
    changes_per_second: number;
  };
  throughput_history: {
    ts: number;
    cps: number;
    queue: number;
    clients: number;
  }[];
}

export interface FreshnessBuckets {
  lt_30s: number;
  "30s_2m": number;
  "2m_5m": number;
  "5m_15m": number;
  "15m_30m": number;
  "30m_1h": number;
  gt_1h: number;
}

export interface SubsystemScore {
  score: number;
  weight: number;
  label: string;
  details?: string;
}

export interface HealthData {
  scores: {
    overall: number;
    level: "healthy" | "degraded" | "critical";
    subsystems: Record<string, SubsystemScore>;
  };
  metrics: {
    event_freshness: {
      live: Record<string, FreshnessBuckets> | null;
      prematch: Record<string, FreshnessBuckets> | null;
    };
    outcome_freshness: {
      live: Record<string, FreshnessBuckets> | null;
      prematch: Record<string, FreshnessBuckets> | null;
    };
    quality: {
      orphan_markets: number;
      finished_backlog: number;
      stale_prematch: number;
      events_no_markets: number;
      unsettled_bets: number;
    };
    pipeline: {
      outcomes_updated_5m: number;
      odds_changed_5m: number;
      latest_update: string | null;
    };
  };
}
