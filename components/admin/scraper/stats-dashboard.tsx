"use client";

import { useEffect, useState, useCallback } from "react";

// ═══ TYPES ═══

interface SportBreakdown {
  events: number;
  markets: number;
  outcomes: number;
}

interface ScraperStats {
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
}

interface DbCounts {
  live_events: number;
  prematch_events: number;
  active_markets: number;
  active_outcomes: number;
  finished_events: number;
  ended_events: number;
}

interface SportData {
  goldbet: { live: SportBreakdown; prematch: SportBreakdown };
  vincitu: {
    live_events: number;
    prematch_events: number;
    active_markets: number;
    active_outcomes: number;
  };
}

interface Snapshot {
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

interface ServerData {
  latest: Snapshot | null;
  history: Snapshot[];
}

interface StatsResponse {
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

interface RedisMetrics {
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

// ═══ HELPERS ═══

function coverageColor(pct: number): string {
  if (pct >= 90) return "#10b981";
  if (pct >= 75) return "#f59e0b";
  return "#ef4444";
}

function coverageBg(pct: number): string {
  if (pct >= 90) return "rgba(16, 185, 129, 0.1)";
  if (pct >= 75) return "rgba(245, 158, 11, 0.1)";
  return "rgba(239, 68, 68, 0.1)";
}

function formatNum(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k";
  return n.toLocaleString("it-IT");
}

function formatNumFull(n: number): string {
  return n.toLocaleString("it-IT");
}

function timeAgo(iso: string): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s fa`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m fa`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m fa`;
}

function statusColor(status: string): string {
  if (status === "healthy") return "#10b981";
  if (status === "degraded") return "#f59e0b";
  if (status === "prematch-only") return "#3b82f6";
  return "#ef4444";
}

function coveragePct(gb: number, v: number): number {
  if (gb === 0) return v === 0 ? 100 : 0;
  return Math.round((v / gb) * 1000) / 10;
}

// ═══ SPARKLINE ═══

function Sparkline({
  data,
  color,
  width = 120,
  height = 32,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline
        points={points}
        fill="none"
        stroke={color || "#10b981"}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeOpacity={0.7}
      />
    </svg>
  );
}

// ═══ SPORT ICONS ═══

const SPORT_ICONS: Record<string, string> = {
  Calcio: "⚽",
  Basket: "🏀",
  Tennis: "🎾",
  Hockey: "🏒",
  Pallavolo: "🏐",
  Football: "⚽",
  Basketball: "🏀",
  Volleyball: "🏐",
  "Ice Hockey": "🏒",
  Baseball: "⚾",
  Handball: "🤾",
  Rugby: "🏉",
  Cricket: "🏏",
  "Table Tennis": "🏓",
  Badminton: "🏸",
  Futsal: "⚽",
  Esports: "🎮",
  MMA: "🥊",
  Boxing: "🥊",
};

// ═══ SECTION 1 — SERVER HEALTH CARD ═══

function ServerHealthCard({
  title,
  server,
  isMain,
}: {
  title: string;
  server: ServerData | null;
  isMain: boolean;
}) {
  const isOffline = !server || !server.latest;
  const gb = server?.latest?.goldbet;

  const dotColor = isOffline
    ? "#6b7280"
    : statusColor(gb?.session_status || "dead");

  return (
    <div
      style={{
        background: "var(--admin-card)",
        border: "1px solid var(--admin-border)",
        borderRadius: 8,
        padding: "16px 20px",
        opacity: isOffline ? 0.5 : 1,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: isOffline ? 0 : 12,
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: dotColor,
            boxShadow: isOffline ? "none" : `0 0 8px ${dotColor}`,
          }}
        />
        <span
          style={{
            fontWeight: 700,
            color: "var(--admin-text)",
            fontSize: "0.95em",
          }}
        >
          {title}
        </span>
        {isOffline && (
          <span
            style={{
              fontSize: "0.8em",
              color: "var(--admin-text4)",
              marginLeft: "auto",
            }}
          >
            Offline
          </span>
        )}
      </div>

      {!isOffline && gb && (
        <>
          {/* Timing row */}
          <div
            style={{
              fontSize: "0.82em",
              color: "var(--admin-text3)",
              marginBottom: 8,
            }}
          >
            {isMain ? (
              <>
                Last Live:{" "}
                <span style={{ color: "var(--admin-text2)" }}>
                  {timeAgo(gb.last_live_cycle)}
                </span>
                <span style={{ margin: "0 8px" }}>·</span>
                Last Pre:{" "}
                <span style={{ color: "var(--admin-text2)" }}>
                  {timeAgo(gb.last_prematch_cycle)}
                </span>
              </>
            ) : (
              <>
                Ultimo ciclo:{" "}
                <span style={{ color: "var(--admin-text2)" }}>
                  {timeAgo(gb.last_prematch_cycle)}
                </span>
              </>
            )}
          </div>

          {/* Stats row */}
          <div
            style={{
              fontSize: "0.82em",
              color: "var(--admin-text3)",
            }}
          >
            {isMain ? (
              <>
                Workers:{" "}
                <span
                  style={{ color: "var(--admin-text2)", marginRight: 4 }}
                >
                  {gb.detail_workers != null
                    ? typeof gb.detail_workers === "object"
                      ? `${gb.detail_workers.ready}/${gb.detail_workers.total}`
                      : `${gb.detail_workers}/15`
                    : "—"}
                </span>
                <span style={{ margin: "0 4px" }}>·</span>
                Errori:{" "}
                <span
                  style={{
                    color:
                      gb.errors_last_hour > 0
                        ? "#ef4444"
                        : "var(--admin-text2)",
                    marginRight: 4,
                  }}
                >
                  {gb.errors_last_hour}/h
                </span>
                {gb.memory_mb != null && (
                  <>
                    <span style={{ margin: "0 4px" }}>·</span>
                    RAM:{" "}
                    <span style={{ color: "var(--admin-text2)" }}>
                      {(gb.memory_mb / 1024).toFixed(1)} GB
                    </span>
                  </>
                )}
              </>
            ) : (
              <>
                Eventi:{" "}
                <span
                  style={{ color: "var(--admin-text2)", marginRight: 4 }}
                >
                  {formatNumFull(gb.prematch_events)}
                </span>
                <span style={{ margin: "0 4px" }}>·</span>
                Mercati:{" "}
                <span
                  style={{ color: "var(--admin-text2)", marginRight: 4 }}
                >
                  {formatNum(gb.prematch_markets)}
                </span>
                {gb.memory_mb != null && (
                  <>
                    <span style={{ margin: "0 4px" }}>·</span>
                    RAM:{" "}
                    <span style={{ color: "var(--admin-text2)" }}>
                      {(gb.memory_mb / 1024).toFixed(1)} GB
                    </span>
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ═══ SECTION 2 — COVERAGE KPI CARD ═══

function CoverageKPI({
  label,
  gbValue,
  vValue,
  sparkData,
}: {
  label: string;
  gbValue: number;
  vValue: number;
  sparkData: number[];
}) {
  const pct = coveragePct(gbValue, vValue);
  const color = coverageColor(pct);

  return (
    <div
      style={{
        background: "var(--admin-card)",
        border: "1px solid var(--admin-border)",
        borderRadius: 8,
        padding: "16px 20px",
      }}
    >
      <div
        style={{
          fontSize: "0.7em",
          textTransform: "uppercase",
          letterSpacing: 1,
          color: "var(--admin-text3)",
          fontWeight: 600,
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "1.8em",
              fontWeight: 700,
              color,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {pct}%
          </div>
          <div
            style={{
              fontSize: "0.8em",
              color: "var(--admin-text3)",
              marginTop: 4,
            }}
          >
            GB {formatNum(gbValue)} / V {formatNum(vValue)}
          </div>
        </div>
        {sparkData.length >= 2 && (
          <Sparkline data={sparkData} color={color} width={80} height={28} />
        )}
      </div>
    </div>
  );
}

// ═══ SECTION 3 — SPORT TABLE ═══

interface MergedSport {
  gbEvents: number;
  vEvents: number;
  gbMarkets: number;
  vMarkets: number;
}

function mergeSportData(
  mainSport: Record<string, SportData> | undefined,
  prematchSport: Record<string, SportData> | undefined
): Record<string, MergedSport> {
  const result: Record<string, MergedSport> = {};

  const allSports = new Set([
    ...Object.keys(mainSport || {}),
    ...Object.keys(prematchSport || {}),
  ]);

  for (const sport of allSports) {
    const main = mainSport?.[sport];
    const pre = prematchSport?.[sport];

    // Live from main, prematch from prematch VPS (fallback main)
    const gbLiveEv = main?.goldbet.live.events || 0;
    const gbPrematchEv =
      pre?.goldbet.prematch.events ??
      main?.goldbet.prematch.events ??
      0;
    const gbLiveMkt = main?.goldbet.live.markets || 0;
    const gbPrematchMkt =
      pre?.goldbet.prematch.markets ??
      main?.goldbet.prematch.markets ??
      0;

    // Vincitu from main (shared DB)
    const vLive = main?.vincitu.live_events || 0;
    const vPrematch = main?.vincitu.prematch_events || 0;
    const vMarkets = main?.vincitu.active_markets || 0;

    result[sport] = {
      gbEvents: gbLiveEv + gbPrematchEv,
      vEvents: vLive + vPrematch,
      gbMarkets: gbLiveMkt + gbPrematchMkt,
      vMarkets,
    };
  }

  return result;
}

function CoveragePill({ pct, bold }: { pct: number; bold?: boolean }) {
  const color = coverageColor(pct);
  return (
    <span style={{ textAlign: "center", display: "flex", justifyContent: "center" }}>
      <span
        style={{
          fontSize: "0.8em",
          fontWeight: bold ? 700 : 600,
          color,
          background: coverageBg(pct),
          borderRadius: 4,
          padding: "2px 8px",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {pct}%
      </span>
    </span>
  );
}

const COL_TEMPLATE = "1.5fr repeat(2, 80px) 90px repeat(2, 80px) 90px";

function SportTable({
  mainSport,
  prematchSport,
}: {
  mainSport: Record<string, SportData> | undefined;
  prematchSport: Record<string, SportData> | undefined;
}) {
  const merged = mergeSportData(mainSport, prematchSport);

  const sorted = Object.entries(merged).sort(
    (a, b) => b[1].gbEvents - a[1].gbEvents
  );

  if (sorted.length === 0) return null;

  let tGbEv = 0,
    tVEv = 0,
    tGbMkt = 0,
    tVMkt = 0;
  for (const [, d] of sorted) {
    tGbEv += d.gbEvents;
    tVEv += d.vEvents;
    tGbMkt += d.gbMarkets;
    tVMkt += d.vMarkets;
  }

  return (
    <div
      style={{
        background: "var(--admin-card)",
        border: "1px solid var(--admin-border)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--admin-border)",
          fontWeight: 700,
          color: "var(--admin-text)",
          fontSize: "0.95em",
        }}
      >
        Copertura per Sport
      </div>

      {/* Header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: COL_TEMPLATE,
          padding: "8px 16px",
          borderBottom: "1px solid var(--admin-border)",
          fontSize: "0.7em",
          textTransform: "uppercase",
          letterSpacing: 1,
          color: "var(--admin-text3)",
          fontWeight: 600,
        }}
      >
        <span>Sport</span>
        <span style={{ textAlign: "right" }}>Ev. GB</span>
        <span style={{ textAlign: "right" }}>Ev. V</span>
        <span style={{ textAlign: "center" }}>Copertura</span>
        <span style={{ textAlign: "right" }}>Mkt GB</span>
        <span style={{ textAlign: "right" }}>Mkt V</span>
        <span style={{ textAlign: "center" }}>Copertura</span>
      </div>

      {/* Rows */}
      {sorted.map(([sport, d]) => (
        <div
          key={sport}
          style={{
            display: "grid",
            gridTemplateColumns: COL_TEMPLATE,
            padding: "10px 16px",
            borderBottom: "1px solid var(--admin-border)",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontWeight: 600,
              color: "var(--admin-text)",
              fontSize: "0.9em",
            }}
          >
            {SPORT_ICONS[sport] || "🏅"} {sport}
          </span>
          <span
            style={{
              textAlign: "right",
              fontVariantNumeric: "tabular-nums",
              fontSize: "0.9em",
              color: "var(--admin-text2)",
            }}
          >
            {formatNumFull(d.gbEvents)}
          </span>
          <span
            style={{
              textAlign: "right",
              fontVariantNumeric: "tabular-nums",
              fontSize: "0.9em",
              color: "var(--admin-text)",
              fontWeight: 600,
            }}
          >
            {formatNumFull(d.vEvents)}
          </span>
          <CoveragePill pct={coveragePct(d.gbEvents, d.vEvents)} />
          <span
            style={{
              textAlign: "right",
              fontVariantNumeric: "tabular-nums",
              fontSize: "0.9em",
              color: "var(--admin-text2)",
            }}
          >
            {formatNum(d.gbMarkets)}
          </span>
          <span
            style={{
              textAlign: "right",
              fontVariantNumeric: "tabular-nums",
              fontSize: "0.9em",
              color: "var(--admin-text)",
              fontWeight: 600,
            }}
          >
            {formatNum(d.vMarkets)}
          </span>
          <CoveragePill pct={coveragePct(d.gbMarkets, d.vMarkets)} />
        </div>
      ))}

      {/* Totals row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: COL_TEMPLATE,
          padding: "10px 16px",
          alignItems: "center",
          background: "rgba(59, 130, 246, 0.05)",
          fontWeight: 700,
        }}
      >
        <span style={{ color: "var(--admin-text)", fontSize: "0.9em" }}>
          TOTALE
        </span>
        <span
          style={{
            textAlign: "right",
            fontVariantNumeric: "tabular-nums",
            fontSize: "0.9em",
            color: "var(--admin-text2)",
          }}
        >
          {formatNumFull(tGbEv)}
        </span>
        <span
          style={{
            textAlign: "right",
            fontVariantNumeric: "tabular-nums",
            fontSize: "0.9em",
            color: "var(--admin-text)",
          }}
        >
          {formatNumFull(tVEv)}
        </span>
        <CoveragePill pct={coveragePct(tGbEv, tVEv)} bold />
        <span
          style={{
            textAlign: "right",
            fontVariantNumeric: "tabular-nums",
            fontSize: "0.9em",
            color: "var(--admin-text2)",
          }}
        >
          {formatNum(tGbMkt)}
        </span>
        <span
          style={{
            textAlign: "right",
            fontVariantNumeric: "tabular-nums",
            fontSize: "0.9em",
            color: "var(--admin-text)",
          }}
        >
          {formatNum(tVMkt)}
        </span>
        <CoveragePill pct={coveragePct(tGbMkt, tVMkt)} bold />
      </div>
    </div>
  );
}

// ═══ SECTION 4 — REDIS PIPELINE ═══

function RedisPipelineSection({ metrics }: { metrics: RedisMetrics }) {
  const { redis, odds, throughput_history } = metrics;

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const sparkCps = throughput_history.map((h) => h.cps);
  const sparkQueue = throughput_history.map((h) => h.queue);

  const cards: {
    label: string;
    value: string;
    color: string;
    spark?: number[];
  }[] = [
    {
      label: "Quote/sec",
      value: String(odds.changes_per_second),
      color: "#8b5cf6",
      spark: sparkCps,
    },
    {
      label: "Latenza Redis",
      value: `${redis.latency_ms}ms`,
      color: redis.latency_ms <= 5 ? "#10b981" : "#f59e0b",
    },
    { label: "Client SSE", value: String(odds.sse_clients), color: "#3b82f6" },
    {
      label: "Coda Supabase",
      value: String(odds.write_queue_depth),
      color: odds.write_queue_depth > 100 ? "#ef4444" : "#10b981",
      spark: sparkQueue,
    },
    {
      label: "Memoria Redis",
      value: formatBytes(redis.memory_used),
      color: "#6366f1",
    },
    {
      label: "Eventi in cache",
      value: String(odds.active_events),
      color: "#06b6d4",
    },
  ];

  return (
    <div
      style={{
        background: "var(--admin-card)",
        border: "1px solid var(--admin-border)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--admin-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#10b981",
              boxShadow: "0 0 6px #10b981",
            }}
          />
          <span
            style={{
              fontWeight: 700,
              color: "var(--admin-text)",
              fontSize: "0.95em",
            }}
          >
            Redis Pipeline
          </span>
        </div>
        <span style={{ fontSize: "0.8em", color: "var(--admin-text3)" }}>
          Fast path attivo
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 1,
          background: "var(--admin-border)",
        }}
      >
        {cards.map((card) => (
          <div
            key={card.label}
            style={{
              background: "var(--admin-card)",
              padding: "16px 16px 12px",
            }}
          >
            <div
              style={{
                fontSize: "0.7em",
                textTransform: "uppercase",
                letterSpacing: 1,
                color: "var(--admin-text3)",
                marginBottom: 6,
                fontWeight: 600,
              }}
            >
              {card.label}
            </div>
            <div
              style={{
                fontSize: "1.4em",
                fontWeight: 700,
                color: card.color,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {card.value}
            </div>
            {card.spark && card.spark.length >= 2 && (
              <div style={{ marginTop: 6 }}>
                <Sparkline
                  data={card.spark}
                  color={card.color}
                  width={100}
                  height={24}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══ UNIFIED COVERAGE LOGIC ═══

function computeUnifiedCoverage(
  main: Snapshot | null,
  prematch: Snapshot | null
) {
  // Events: live from main, prematch from prematch VPS (fallback main)
  const gbLiveEv =
    main?.goldbet.live_events_current_cycle ??
    main?.goldbet.live_events ??
    0;
  const gbPrematchEv =
    prematch?.goldbet.prematch_events ??
    main?.goldbet.prematch_events ??
    0;
  const vEvents =
    (main?.vincitu.live_events ?? 0) +
    (main?.vincitu.prematch_events ?? 0);

  // Markets: live from main, prematch from prematch VPS (fallback main)
  const gbLiveMkt = main?.goldbet.live_markets ?? 0;
  const gbPrematchMkt =
    prematch?.goldbet.prematch_markets ??
    main?.goldbet.prematch_markets ??
    0;
  const vMarkets = main?.vincitu.active_markets ?? 0;

  // Outcomes: live from main, prematch from prematch VPS (fallback main)
  const gbLiveOut = main?.goldbet.live_outcomes ?? 0;
  const gbPrematchOut =
    prematch?.goldbet.prematch_outcomes ??
    main?.goldbet.prematch_outcomes ??
    0;
  const vOutcomes = main?.vincitu.active_outcomes ?? 0;

  return {
    events: { gb: gbLiveEv + gbPrematchEv, v: vEvents },
    markets: { gb: gbLiveMkt + gbPrematchMkt, v: vMarkets },
    outcomes: { gb: gbLiveOut + gbPrematchOut, v: vOutcomes },
  };
}

// ═══ MAIN DASHBOARD ═══

export default function ScraperStatsDashboard() {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [redisMetrics, setRedisMetrics] = useState<RedisMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchStats = useCallback(async () => {
    try {
      const [statsResp, redisResp] = await Promise.all([
        fetch("/api/scraper/stats"),
        fetch("/api/odds/metrics").catch(() => null),
      ]);
      if (statsResp.ok) {
        setData(await statsResp.json());
      }
      if (redisResp?.ok) {
        setRedisMetrics(await redisResp.json());
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30_000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  if (loading) {
    return (
      <div
        style={{ padding: 40, textAlign: "center", color: "var(--admin-text3)" }}
      >
        Caricamento...
      </div>
    );
  }

  if (!data) {
    return (
      <div
        style={{ padding: 40, textAlign: "center", color: "var(--admin-text3)" }}
      >
        Errore nel caricamento dei dati
      </div>
    );
  }

  // ─── Disconnected: DB-only ───
  if (!data.connected) {
    const v = data.vincitu_only!;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Offline server cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
          }}
        >
          <ServerHealthCard title="Main VPS" server={null} isMain />
          <ServerHealthCard
            title="Prematch VPS"
            server={null}
            isMain={false}
          />
        </div>

        {/* Warning banner */}
        <div
          style={{
            background: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            borderRadius: 8,
            padding: "16px 20px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 20 }}>🔴</span>
          <div>
            <div style={{ color: "#ef4444", fontWeight: 700 }}>
              Scraper non connesso
            </div>
            <div style={{ color: "var(--admin-text3)", fontSize: "0.9em" }}>
              Conteggi solo dal DB Vincitu
            </div>
          </div>
        </div>

        {/* DB-only cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 16,
          }}
        >
          {[
            { label: "Live", value: v.live_events, color: "#10b981" },
            { label: "Prematch", value: v.prematch_events, color: "#3b82f6" },
            { label: "Finished", value: v.finished_events, color: "#f59e0b" },
            { label: "Ended", value: v.ended_events, color: "#6b7280" },
          ].map((card) => (
            <div
              key={card.label}
              style={{
                background: "var(--admin-card)",
                border: "1px solid var(--admin-border)",
                borderRadius: 8,
                padding: 20,
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: "0.8em",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  color: "var(--admin-text3)",
                  marginBottom: 8,
                }}
              >
                {card.label}
              </div>
              <div
                style={{
                  fontSize: "1.8em",
                  fontWeight: 700,
                  color: card.color,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatNumFull(card.value)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ─── Connected: full dashboard ───
  const mainServer = data.servers?.main || null;
  const prematchServer = data.servers?.prematch || null;
  const mainLatest = mainServer?.latest || null;
  const prematchLatest = prematchServer?.latest || null;

  // Unified coverage numbers
  const coverage = computeUnifiedCoverage(mainLatest, prematchLatest);

  // Sparkline data from main history (coverage % over time)
  const mainHistory = mainServer?.history || [];
  const sparkEvents = mainHistory.map((s) => {
    const gb =
      (s.goldbet.live_events_current_cycle ?? s.goldbet.live_events) +
      s.goldbet.prematch_events;
    const v = s.vincitu.live_events + s.vincitu.prematch_events;
    return coveragePct(gb, v);
  });
  const sparkMarkets = mainHistory.map((s) => {
    const gb = s.goldbet.live_markets + s.goldbet.prematch_markets;
    return coveragePct(gb, s.vincitu.active_markets);
  });
  const sparkOutcomes = mainHistory.map((s) => {
    const gb = s.goldbet.live_outcomes + s.goldbet.prematch_outcomes;
    return coveragePct(gb, s.vincitu.active_outcomes);
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Section 1 — Server Health Strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
        }}
      >
        <ServerHealthCard title="Main VPS" server={mainServer} isMain />
        <ServerHealthCard
          title="Prematch VPS"
          server={prematchServer}
          isMain={false}
        />
      </div>

      {/* Section 2 — Coverage KPIs */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 16,
        }}
      >
        <CoverageKPI
          label="Copertura Eventi"
          gbValue={coverage.events.gb}
          vValue={coverage.events.v}
          sparkData={sparkEvents}
        />
        <CoverageKPI
          label="Copertura Mercati"
          gbValue={coverage.markets.gb}
          vValue={coverage.markets.v}
          sparkData={sparkMarkets}
        />
        <CoverageKPI
          label="Copertura Outcomes"
          gbValue={coverage.outcomes.gb}
          vValue={coverage.outcomes.v}
          sparkData={sparkOutcomes}
        />
      </div>

      {/* Section 3 — Sport Table */}
      <SportTable
        mainSport={mainLatest?.by_sport}
        prematchSport={prematchLatest?.by_sport}
      />

      {/* Section 4 — Redis Pipeline (conditional) */}
      {redisMetrics && redisMetrics.redis.connected && (
        <RedisPipelineSection metrics={redisMetrics} />
      )}

      {/* Refresh indicator */}
      <div
        style={{
          textAlign: "right",
          fontSize: "0.8em",
          color: "var(--admin-text4)",
        }}
      >
        Auto-refresh ogni 30s — Ultimo:{" "}
        {lastRefresh.toLocaleTimeString("it-IT")}
      </div>
    </div>
  );
}
