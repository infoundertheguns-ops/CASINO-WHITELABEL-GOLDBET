// ═══════════════════════════════════════════════════════════════
// System Health Scoring Engine — Kambi-centric
// 7 subsystems with weighted scores → overall 0-100 + traffic light
// ═══════════════════════════════════════════════════════════════

// ═══ TYPES ═══

export interface FreshnessBuckets {
  lt_30s: number;
  "30s_2m": number;
  "2m_5m": number;
  "5m_15m": number;
  "15m_30m": number;
  "30m_1h": number;
  gt_1h: number;
}

export interface SystemHealthRPC {
  events: Record<string, number>; // "kambi_live": N, "kambi_prematch": N, etc.
  active_by_source: {
    markets: Record<string, number> | null;
    outcomes_total: number;
  };
  event_freshness: {
    live: Record<string, FreshnessBuckets> | null;
    prematch: Record<string, FreshnessBuckets> | null;
  };
  outcome_freshness: {
    live: Record<string, FreshnessBuckets> | null;
    prematch: Record<string, FreshnessBuckets> | null;
  };
  pipeline: {
    outcomes_updated_5m: number;
    odds_changed_5m: number;
    latest_update: string | null;
  };
  quality: {
    orphan_markets: number;
    finished_backlog: number;
    stale_prematch: number;
    events_no_markets: number;
    unsettled_bets: number;
  };
  generated_at: string; // ISO timestamp from RPC
}

export interface ScraperInfo {
  connected: boolean;
  lastCycleSeconds?: number;
  errorsLastHour?: number;
  isLive?: boolean;
}

export interface RedisInfo {
  connected: boolean;
  latencyMs?: number;
}

export interface SubsystemScore {
  score: number; // 0-100
  weight: number;
  label: string;
  details?: string;
}

export type HealthLevel = "healthy" | "degraded" | "critical";

export interface HealthScores {
  overall: number;
  level: HealthLevel;
  subsystems: Record<string, SubsystemScore>;
}

// ═══ HELPERS ═══

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}

function bucketTotal(b: FreshnessBuckets | null | undefined): number {
  if (!b) return 0;
  return (
    b.lt_30s +
    b["30s_2m"] +
    b["2m_5m"] +
    b["5m_15m"] +
    b["15m_30m"] +
    b["30m_1h"] +
    b.gt_1h
  );
}

/** Percent of outcomes within a threshold (sum of first N buckets / total) */
function freshPercent(
  b: FreshnessBuckets | null | undefined,
  bucketKeys: (keyof FreshnessBuckets)[]
): number {
  if (!b) return 0;
  const total = bucketTotal(b);
  if (total === 0) return 100; // no data = no problems
  const within = bucketKeys.reduce((sum, k) => sum + (b[k] || 0), 0);
  return (within / total) * 100;
}

// ═══ SCORING FUNCTIONS ═══

function scoreFreshnessLive(
  outcomeFreshness: Record<string, FreshnessBuckets> | null
): SubsystemScore {
  if (!outcomeFreshness || Object.keys(outcomeFreshness).length === 0) {
    return {
      score: 100,
      weight: 18,
      label: "Freshness Live",
      details: "Nessun evento live",
    };
  }

  const merged: FreshnessBuckets = {
    lt_30s: 0, "30s_2m": 0, "2m_5m": 0, "5m_15m": 0,
    "15m_30m": 0, "30m_1h": 0, gt_1h: 0,
  };
  for (const buckets of Object.values(outcomeFreshness)) {
    for (const k of Object.keys(merged) as (keyof FreshnessBuckets)[]) {
      merged[k] += buckets[k] || 0;
    }
  }

  const pctFresh = freshPercent(merged, ["lt_30s", "30s_2m", "2m_5m"]);
  let score: number;
  if (pctFresh >= 70) score = 100;
  else if (pctFresh <= 20) score = 0;
  else score = ((pctFresh - 20) / 50) * 100;

  score = clamp(score);
  return {
    score,
    weight: 18,
    label: "Freshness Live",
    details: `${Math.round(pctFresh)}% entro 5 min`,
  };
}

function scoreFreshnessPrematch(
  outcomeFreshness: Record<string, FreshnessBuckets> | null
): SubsystemScore {
  if (!outcomeFreshness || Object.keys(outcomeFreshness).length === 0) {
    return {
      score: 100,
      weight: 10,
      label: "Freshness Prematch",
      details: "Nessun evento prematch",
    };
  }

  const merged: FreshnessBuckets = {
    lt_30s: 0, "30s_2m": 0, "2m_5m": 0, "5m_15m": 0,
    "15m_30m": 0, "30m_1h": 0, gt_1h: 0,
  };
  for (const buckets of Object.values(outcomeFreshness)) {
    for (const k of Object.keys(merged) as (keyof FreshnessBuckets)[]) {
      merged[k] += buckets[k] || 0;
    }
  }

  const pctFresh = freshPercent(merged, [
    "lt_30s", "30s_2m", "2m_5m", "5m_15m", "15m_30m", "30m_1h",
  ]);
  let score: number;
  if (pctFresh >= 50) score = 100;
  else if (pctFresh <= 10) score = 0;
  else score = ((pctFresh - 10) / 40) * 100;

  score = clamp(score);
  return {
    score,
    weight: 10,
    label: "Freshness Prematch",
    details: `${Math.round(pctFresh)}% entro 1h`,
  };
}

function scoreDataQuality(quality: SystemHealthRPC["quality"]): SubsystemScore {
  let score = 100;
  const issues: string[] = [];

  if (quality.orphan_markets > 0) {
    const penalty = Math.min(30, Math.floor(quality.orphan_markets / 10) * 5);
    score -= penalty;
    issues.push(`${quality.orphan_markets} orfani`);
  }

  if (quality.finished_backlog > 0) {
    const penalty = Math.min(30, Math.floor(quality.finished_backlog / 50) * 10);
    score -= penalty;
    issues.push(`${quality.finished_backlog} backlog`);
  }

  if (quality.stale_prematch > 0) {
    const penalty = Math.min(20, Math.floor(quality.stale_prematch / 20) * 5);
    score -= penalty;
    issues.push(`${quality.stale_prematch} stale`);
  }

  if (quality.events_no_markets > 0) {
    const penalty = Math.min(10, Math.floor(quality.events_no_markets / 50) * 5);
    score -= penalty;
  }

  score = clamp(score);
  return {
    score,
    weight: 10,
    label: "Qualita Dati",
    details: issues.length > 0 ? issues.join(", ") : "OK",
  };
}

function scoreRedisPipeline(redis: RedisInfo): SubsystemScore {
  if (!redis.connected) {
    return {
      score: 0,
      weight: 10,
      label: "Redis Pipeline",
      details: "Disconnesso",
    };
  }

  let score = 100;
  const latency = redis.latencyMs ?? 0;

  if (latency > 10) {
    const penalty = Math.min(100, Math.round(((latency - 10) / 40) * 100));
    score -= penalty;
  }

  score = clamp(score);
  return {
    score,
    weight: 10,
    label: "Redis Pipeline",
    details: `Latenza: ${latency}ms`,
  };
}

function scoreSettlement(quality: SystemHealthRPC["quality"]): SubsystemScore {
  const unsettled = quality.unsettled_bets;
  const backlog = quality.finished_backlog;

  let score = 100;
  const issues: string[] = [];

  if (unsettled > 0) {
    const penalty = Math.min(50, Math.floor(unsettled / 50) * 10);
    score -= penalty;
    issues.push(`${unsettled} non settled`);
  }

  if (backlog > 0) {
    const penalty = Math.min(50, Math.floor(backlog / 100) * 5);
    score -= penalty;
    issues.push(`${backlog} backlog`);
  }

  score = clamp(score);
  return {
    score,
    weight: 10,
    label: "Settlement",
    details: issues.length > 0 ? issues.join(", ") : "OK",
  };
}

// ═══ KAMBI SCORING ═══

function scoreKambiLive(scraper: ScraperInfo): SubsystemScore {
  let score = 0;
  let details = "";

  if (!scraper.connected) {
    details = "Disconnesso";
    return { score: 0, weight: 20, label: "Kambi Live", details };
  }

  const cycle = scraper.lastCycleSeconds ?? Infinity;
  const errors = scraper.errorsLastHour ?? 0;

  // OK if cycle < 120s, degraded up to 600s
  if (cycle <= 120) score = 100;
  else if (cycle >= 600) score = 0;
  else score = 100 - ((cycle - 120) / 480) * 100;

  const errorPenalty = Math.min(30, errors * 2);
  score = clamp(score - errorPenalty);

  details = `Ciclo: ${Math.round(cycle)}s, Errori: ${errors}/h`;
  return { score, weight: 20, label: "Kambi Live", details };
}

function scoreKambiPrematch(scraper: ScraperInfo): SubsystemScore {
  let score = 0;
  let details = "";

  if (!scraper.connected) {
    details = "Disconnesso";
    return { score: 0, weight: 12, label: "Kambi Prematch", details };
  }

  const cycle = scraper.lastCycleSeconds ?? Infinity;

  // OK if cycle < 600s (10min), degraded up to 7200s (2h)
  if (cycle <= 600) score = 100;
  else if (cycle >= 7200) score = 0;
  else score = 100 - ((cycle - 600) / 6600) * 100;

  score = clamp(score);
  details = `Ciclo: ${Math.round(cycle / 60)}min`;
  return { score, weight: 12, label: "Kambi Prematch", details };
}

// ═══ MAIN SCORING ═══
// Weights: Kambi Live 20, Kambi Prematch 12, Freshness Live 18,
//          Freshness Prematch 10, Data Quality 10, Redis 10, Settlement 10
//          Unused 10 = redistributed to total 90 (normalized)

export function computeHealthScores(
  rpc: SystemHealthRPC,
  kambiScraper: { live: ScraperInfo; prematch: ScraperInfo },
  redis: RedisInfo,
): HealthScores {
  const subsystems: Record<string, SubsystemScore> = {
    kambi_live: scoreKambiLive(kambiScraper.live),
    kambi_prematch: scoreKambiPrematch(kambiScraper.prematch),
    freshness_live: scoreFreshnessLive(rpc.outcome_freshness?.live ?? null),
    freshness_prematch: scoreFreshnessPrematch(rpc.outcome_freshness?.prematch ?? null),
    data_quality: scoreDataQuality(rpc.quality),
    redis_pipeline: scoreRedisPipeline(redis),
    settlement: scoreSettlement(rpc.quality),
  };

  // Weighted average
  let totalWeight = 0;
  let weightedSum = 0;
  for (const sub of Object.values(subsystems)) {
    weightedSum += sub.score * sub.weight;
    totalWeight += sub.weight;
  }
  const overall = totalWeight > 0 ? clamp(Math.round(weightedSum / totalWeight)) : 0;

  let level: HealthLevel;
  if (overall >= 80) level = "healthy";
  else if (overall >= 50) level = "degraded";
  else level = "critical";

  return { overall, level, subsystems };
}
