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

/** Merge freshness buckets from map, optionally filtering to a single source */
export function mergeFreshness(
  freshnessMap: Record<string, FreshnessBuckets> | null | undefined,
  sourceFilter?: string,
): FreshnessBuckets | null {
  if (!freshnessMap) return null;
  const sources = sourceFilter
    ? [freshnessMap[sourceFilter]].filter(Boolean) as FreshnessBuckets[]
    : Object.values(freshnessMap);
  if (sources.length === 0) return null;

  const merged: FreshnessBuckets = {
    lt_30s: 0, "30s_2m": 0, "2m_5m": 0, "5m_15m": 0,
    "15m_30m": 0, "30m_1h": 0, gt_1h: 0,
  };
  for (const b of sources) {
    for (const k of Object.keys(merged) as (keyof FreshnessBuckets)[]) {
      merged[k] += b[k] || 0;
    }
  }
  return merged;
}

function scoreFreshnessLive(
  buckets: FreshnessBuckets | null,
  label = "Freshness Live",
  weight = 18,
): SubsystemScore {
  if (!buckets) {
    return { score: 100, weight, label, details: "Nessun evento live" };
  }

  const pctFresh = freshPercent(buckets, ["lt_30s", "30s_2m", "2m_5m"]);
  let score: number;
  if (pctFresh >= 70) score = 100;
  else if (pctFresh <= 20) score = 0;
  else score = ((pctFresh - 20) / 50) * 100;

  return {
    score: clamp(score),
    weight,
    label,
    details: `${Math.round(pctFresh)}% entro 5 min`,
  };
}

function scoreFreshnessPrematch(
  buckets: FreshnessBuckets | null,
  label = "Freshness Prematch",
  weight = 10,
): SubsystemScore {
  if (!buckets) {
    return { score: 100, weight, label, details: "Nessun evento prematch" };
  }

  const pctFresh = freshPercent(buckets, [
    "lt_30s", "30s_2m", "2m_5m", "5m_15m", "15m_30m", "30m_1h",
  ]);
  let score: number;
  if (pctFresh >= 50) score = 100;
  else if (pctFresh <= 10) score = 0;
  else score = ((pctFresh - 10) / 40) * 100;

  return {
    score: clamp(score),
    weight,
    label,
    details: `${Math.round(pctFresh)}% entro 1h`,
  };
}

// Consensus snapshot pipeline: cron runs every 20min, acceptable up to 30min, critical > 60min
function scoreConsensus(lastRefreshAgeSec: number | null, totalSnapshots: number): SubsystemScore {
  if (lastRefreshAgeSec == null) {
    return { score: 0, weight: 20, label: "Consensus", details: "Mai eseguito" };
  }
  if (totalSnapshots === 0) {
    return { score: 40, weight: 20, label: "Consensus", details: "0 outliers — threshold alto?" };
  }

  let score: number;
  if (lastRefreshAgeSec <= 30 * 60) score = 100;
  else if (lastRefreshAgeSec >= 60 * 60) score = 0;
  else score = 100 - ((lastRefreshAgeSec - 30 * 60) / (30 * 60)) * 100;

  const ageMin = Math.round(lastRefreshAgeSec / 60);
  return {
    score: clamp(score),
    weight: 20,
    label: "Consensus",
    details: `${totalSnapshots} outlier, ${ageMin}min fa`,
  };
}

// 22bet-specific data quality: markets-per-event ratio + stale prematch count
function scoreTwobetQuality(
  marketsPerEvent: number,
  staleTwobetPrematch: number,
): SubsystemScore {
  let score = 100;
  const issues: string[] = [];

  // mkt/ev: 22bet typical is 80-120 (from deep enrichment pipeline). Below 30 = suspect.
  if (marketsPerEvent < 30) {
    const penalty = Math.min(60, Math.round((30 - marketsPerEvent) * 2));
    score -= penalty;
    issues.push(`${marketsPerEvent.toFixed(0)} mkt/ev bassi`);
  } else if (marketsPerEvent < 60) {
    score -= 20;
    issues.push(`${marketsPerEvent.toFixed(0)} mkt/ev`);
  }

  if (staleTwobetPrematch > 0) {
    const penalty = Math.min(40, Math.floor(staleTwobetPrematch / 20) * 10);
    score -= penalty;
    issues.push(`${staleTwobetPrematch} stale`);
  }

  return {
    score: clamp(score),
    weight: 15,
    label: "Qualita Dati",
    details: issues.length > 0 ? issues.join(", ") : `${marketsPerEvent.toFixed(0)} mkt/ev, OK`,
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

// ═══ SCRAPER SCORING (Kambi + 22bet share thresholds) ═══

function scoreScraperLive(scraper: ScraperInfo, label: string, weight: number): SubsystemScore {
  if (!scraper.connected) {
    return { score: 0, weight, label, details: "Disconnesso" };
  }

  const cycle = scraper.lastCycleSeconds ?? Infinity;
  const errors = scraper.errorsLastHour ?? 0;

  // OK if cycle < 120s, degraded up to 600s
  let score: number;
  if (cycle <= 120) score = 100;
  else if (cycle >= 600) score = 0;
  else score = 100 - ((cycle - 120) / 480) * 100;

  const errorPenalty = Math.min(30, errors * 2);
  score = clamp(score - errorPenalty);

  return {
    score,
    weight,
    label,
    details: `Ciclo: ${Math.round(cycle)}s, Errori: ${errors}/h`,
  };
}

function scoreScraperPrematch(scraper: ScraperInfo, label: string, weight: number): SubsystemScore {
  if (!scraper.connected) {
    return { score: 0, weight, label, details: "Disconnesso" };
  }

  const cycle = scraper.lastCycleSeconds ?? Infinity;

  // OK if cycle < 600s (10min), degraded up to 7200s (2h)
  let score: number;
  if (cycle <= 600) score = 100;
  else if (cycle >= 7200) score = 0;
  else score = 100 - ((cycle - 600) / 6600) * 100;

  score = clamp(score);
  return {
    score,
    weight,
    label,
    details: `Ciclo: ${Math.round(cycle / 60)}min`,
  };
}

// ═══ OVERALL SCORE ═══

function computeOverall(subsystems: Record<string, SubsystemScore>): HealthScores {
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

// ═══ KAMBI HEALTH (primary — player-facing) ═══
// Kambi-only freshness (filters out 22bet buckets from the merged RPC map).
// Weights: Live 20, Prematch 12, Freshness Live 18, Freshness Prematch 10,
//          Data Quality 10, Redis 10, Settlement 10

export function computeHealthScores(
  rpc: SystemHealthRPC,
  kambiScraper: { live: ScraperInfo; prematch: ScraperInfo },
  redis: RedisInfo,
): HealthScores {
  const subsystems: Record<string, SubsystemScore> = {
    kambi_live: scoreScraperLive(kambiScraper.live, "Kambi Live", 20),
    kambi_prematch: scoreScraperPrematch(kambiScraper.prematch, "Kambi Prematch", 12),
    freshness_live: scoreFreshnessLive(
      mergeFreshness(rpc.outcome_freshness?.live, "kambi"),
    ),
    freshness_prematch: scoreFreshnessPrematch(
      mergeFreshness(rpc.outcome_freshness?.prematch, "kambi"),
    ),
    data_quality: scoreDataQuality(rpc.quality),
    redis_pipeline: scoreRedisPipeline(redis),
    settlement: scoreSettlement(rpc.quality),
  };
  return computeOverall(subsystems);
}

// ═══ 22BET HEALTH (secondary — consensus focus) ═══
// No settlement / redis (those concern Kambi player-facing flows).
// Weights: Live 20, Prematch 10, Freshness Live 15, Freshness Prematch 10,
//          Qualita Dati 20, Consensus 25

export function computeTwobetHealth(
  twobetScraper: { live: ScraperInfo; prematch: ScraperInfo },
  rpc: SystemHealthRPC,
  consensusInfo: { lastRefreshAgeSec: number | null; totalSnapshots: number },
  qualityInfo: { marketsPerEvent: number; stalePrematch: number },
): HealthScores {
  const subsystems: Record<string, SubsystemScore> = {
    twobet_live: scoreScraperLive(twobetScraper.live, "22bet Live", 20),
    twobet_prematch: scoreScraperPrematch(twobetScraper.prematch, "22bet Prematch", 10),
    freshness_live: scoreFreshnessLive(
      mergeFreshness(rpc.outcome_freshness?.live, "22bet"),
      "Freshness Live",
      15,
    ),
    freshness_prematch: scoreFreshnessPrematch(
      mergeFreshness(rpc.outcome_freshness?.prematch, "22bet"),
      "Freshness Prematch",
      10,
    ),
    data_quality: scoreTwobetQuality(qualityInfo.marketsPerEvent, qualityInfo.stalePrematch),
    consensus: scoreConsensus(consensusInfo.lastRefreshAgeSec, consensusInfo.totalSnapshots),
  };
  return computeOverall(subsystems);
}

// ═══ BETFAIR HEALTH (third consensus source — exchange) ═══
// Same 6-subsystem shape as 22bet — Betfair contributes to consensus too,
// no settlement/redis (Kambi-only concerns).
// Weights: Live 20, Prematch 10, Freshness Live 15, Freshness Prematch 10,
//          Qualita Dati 20, Consensus 25 — identical to 22bet so the banner
//          weighting is consistent across consensus sources.

export function computeBetfairHealth(
  betfairScraper: { live: ScraperInfo; prematch: ScraperInfo },
  rpc: SystemHealthRPC,
  consensusInfo: { lastRefreshAgeSec: number | null; totalSnapshots: number },
  qualityInfo: { marketsPerEvent: number; stalePrematch: number },
): HealthScores {
  const subsystems: Record<string, SubsystemScore> = {
    betfair_live: scoreScraperLive(betfairScraper.live, "Betfair Live", 20),
    betfair_prematch: scoreScraperPrematch(betfairScraper.prematch, "Betfair Prematch", 10),
    freshness_live: scoreFreshnessLive(
      mergeFreshness(rpc.outcome_freshness?.live, "betfair"),
      "Freshness Live",
      15,
    ),
    freshness_prematch: scoreFreshnessPrematch(
      mergeFreshness(rpc.outcome_freshness?.prematch, "betfair"),
      "Freshness Prematch",
      10,
    ),
    data_quality: scoreTwobetQuality(qualityInfo.marketsPerEvent, qualityInfo.stalePrematch),
    consensus: scoreConsensus(consensusInfo.lastRefreshAgeSec, consensusInfo.totalSnapshots),
  };
  return computeOverall(subsystems);
}
