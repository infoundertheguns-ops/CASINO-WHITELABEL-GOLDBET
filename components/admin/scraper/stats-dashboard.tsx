"use client";

import { useEffect, useState, useCallback } from "react";

// ═══ LIVE SOURCE TOGGLE ═══

function LiveSourceToggle() {
  const [source, setSource] = useState<"leon" | "goldbet">("leon");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/config/live-source")
      .then((r) => r.json())
      .then((d) => { if (d.source) setSource(d.source); })
      .catch(() => {});
  }, []);

  const toggle = async (newSource: "leon" | "goldbet") => {
    if (newSource === source || saving) return;
    setSaving(true);
    try {
      const resp = await fetch("/api/config/live-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: newSource }),
      });
      if (resp.ok) setSource(newSource);
    } catch {}
    setSaving(false);
  };

  return (
    <div style={{
      background: "var(--admin-card)",
      border: "1px solid var(--admin-border)",
      borderRadius: 10,
      padding: "16px 24px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--admin-text1)", textTransform: "uppercase", letterSpacing: 1.2 }}>
          Sorgente Live
        </div>
        <div style={{ fontSize: 12, color: "var(--admin-text3)", marginTop: 2 }}>
          Prematch sempre da Leon. Switch live in emergenza.
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {(["leon", "goldbet"] as const).map((s) => (
          <button
            key={s}
            onClick={() => toggle(s)}
            disabled={saving}
            style={{
              padding: "8px 20px",
              borderRadius: 6,
              border: source === s ? "2px solid #3b82f6" : "1px solid var(--admin-border)",
              background: source === s ? "rgba(59, 130, 246, 0.15)" : "transparent",
              color: source === s ? "#3b82f6" : "var(--admin-text3)",
              fontWeight: source === s ? 700 : 500,
              fontSize: 14,
              cursor: saving ? "not-allowed" : "pointer",
              textTransform: "capitalize",
              opacity: saving ? 0.5 : 1,
            }}
          >
            {s === "leon" ? "Leon" : "Goldbet"}
            {source === s && " \u2713"}
          </button>
        ))}
      </div>
    </div>
  );
}

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

interface FreshnessBuckets {
  lt_30s: number;
  "30s_2m": number;
  "2m_5m": number;
  "5m_15m": number;
  "15m_30m": number;
  "30m_1h": number;
  gt_1h: number;
}

interface SubsystemScore {
  score: number;
  weight: number;
  label: string;
  details?: string;
}

interface HealthData {
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
  height = 36,
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
        strokeWidth="2"
        strokeLinejoin="round"
        strokeOpacity={0.7}
      />
    </svg>
  );
}

// ═══ SPORT ICONS ═══

const SPORT_ICONS: Record<string, string> = {
  Calcio: "⚽", Basket: "🏀", Tennis: "🎾", Hockey: "🏒", Pallavolo: "🏐",
  Football: "⚽", Basketball: "🏀", Volleyball: "🏐", "Ice Hockey": "🏒",
  Baseball: "⚾", Handball: "🤾", Rugby: "🏉", Cricket: "🏏",
  "Table Tennis": "🏓", Badminton: "🏸", Futsal: "⚽", Esports: "🎮",
  MMA: "🥊", Boxing: "🥊",
};

// ═══ COLLAPSIBLE SECTION ═══

function CollapsibleSection({
  title,
  defaultOpen = true,
  badge,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      style={{
        background: "var(--admin-card)",
        border: "1px solid var(--admin-border)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          padding: "16px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "none",
          border: "none",
          borderBottom: open ? "1px solid var(--admin-border)" : "none",
          cursor: "pointer",
          color: "var(--admin-text)",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 18 }}>{title}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {badge}
          <span
            style={{
              fontSize: 20,
              color: "var(--admin-text3)",
              transition: "transform 0.2s",
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
              display: "inline-block",
            }}
          >
            ▾
          </span>
        </div>
      </button>
      {open && <div style={{ padding: "20px 24px" }}>{children}</div>}
    </div>
  );
}

// ═══ SECTION 0 — HEALTH BANNER ═══

function levelColor(level: string): string {
  if (level === "healthy") return "#10b981";
  if (level === "degraded") return "#f59e0b";
  return "#ef4444";
}

function levelBg(level: string): string {
  if (level === "healthy") return "rgba(16, 185, 129, 0.06)";
  if (level === "degraded") return "rgba(245, 158, 11, 0.06)";
  return "rgba(239, 68, 68, 0.06)";
}

function pillScoreColor(score: number): string {
  if (score >= 80) return "#10b981";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}

function HealthBanner({ health }: { health: HealthData }) {
  const { overall, level, subsystems } = health.scores;
  const color = levelColor(level);

  return (
    <div
      style={{
        background: levelBg(level),
        border: `1px solid ${color}33`,
        borderRadius: 10,
        padding: "24px 28px",
      }}
    >
      {/* Top row: semaphore + score */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: color,
            boxShadow: `0 0 14px ${color}`,
            flexShrink: 0,
          }}
        />
        <span style={{ fontWeight: 700, color: "var(--admin-text)", fontSize: 22 }}>
          System Health
        </span>
        <span
          style={{
            fontWeight: 700,
            fontSize: 28,
            color,
            fontVariantNumeric: "tabular-nums",
            marginLeft: "auto",
          }}
        >
          {overall}/100
        </span>
      </div>

      {/* Subsystem pills */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {Object.entries(subsystems).map(([key, sub]) => {
          const c = pillScoreColor(sub.score);
          return (
            <div
              key={key}
              title={sub.details || ""}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: `${c}15`,
                border: `1px solid ${c}30`,
                borderRadius: 8,
                padding: "8px 16px",
                fontSize: 15,
              }}
            >
              <span style={{ color: "var(--admin-text3)", fontWeight: 500 }}>
                {sub.label}
              </span>
              <span style={{ color: c, fontWeight: 700, fontVariantNumeric: "tabular-nums", fontSize: 17 }}>
                {sub.score}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══ SERVER HEALTH CARD ═══

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
  const dotColor = isOffline ? "#6b7280" : statusColor(gb?.session_status || "dead");

  return (
    <div
      style={{
        background: "var(--admin-card)",
        border: "1px solid var(--admin-border)",
        borderRadius: 10,
        padding: "20px 24px",
        opacity: isOffline ? 0.5 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: isOffline ? 0 : 14 }}>
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: dotColor,
            boxShadow: isOffline ? "none" : `0 0 10px ${dotColor}`,
          }}
        />
        <span style={{ fontWeight: 700, color: "var(--admin-text)", fontSize: 17 }}>
          {title}
        </span>
        {isOffline && (
          <span style={{ fontSize: 15, color: "var(--admin-text4)", marginLeft: "auto" }}>
            Offline
          </span>
        )}
      </div>

      {!isOffline && gb && (
        <>
          <div style={{ fontSize: 15, color: "var(--admin-text3)", marginBottom: 10 }}>
            {isMain ? (
              <>
                Last Live: <span style={{ color: "var(--admin-text2)" }}>{timeAgo(gb.last_live_cycle)}</span>
                <span style={{ margin: "0 10px" }}>·</span>
                Last Pre: <span style={{ color: "var(--admin-text2)" }}>{timeAgo(gb.last_prematch_cycle)}</span>
              </>
            ) : (
              <>
                Ultimo ciclo: <span style={{ color: "var(--admin-text2)" }}>{timeAgo(gb.last_prematch_cycle)}</span>
              </>
            )}
          </div>

          <div style={{ fontSize: 15, color: "var(--admin-text3)" }}>
            {isMain ? (
              <>
                Workers:{" "}
                <span style={{ color: "var(--admin-text2)" }}>
                  {gb.detail_workers != null
                    ? typeof gb.detail_workers === "object"
                      ? `${gb.detail_workers.ready}/${gb.detail_workers.total}`
                      : `${gb.detail_workers}/15`
                    : "—"}
                </span>
                <span style={{ margin: "0 8px" }}>·</span>
                Errori:{" "}
                <span style={{ color: gb.errors_last_hour > 0 ? "#ef4444" : "var(--admin-text2)" }}>
                  {gb.errors_last_hour}/h
                </span>
                {gb.memory_mb != null && (
                  <>
                    <span style={{ margin: "0 8px" }}>·</span>
                    RAM: <span style={{ color: "var(--admin-text2)" }}>{(gb.memory_mb / 1024).toFixed(1)} GB</span>
                  </>
                )}
              </>
            ) : (
              <>
                Eventi: <span style={{ color: "var(--admin-text2)" }}>{formatNumFull(gb.prematch_events)}</span>
                <span style={{ margin: "0 8px" }}>·</span>
                Mercati: <span style={{ color: "var(--admin-text2)" }}>{formatNum(gb.prematch_markets)}</span>
                {gb.memory_mb != null && (
                  <>
                    <span style={{ margin: "0 8px" }}>·</span>
                    RAM: <span style={{ color: "var(--admin-text2)" }}>{(gb.memory_mb / 1024).toFixed(1)} GB</span>
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

// ═══ EXTERNAL SCRAPER CARD (Leon, Kambi, Flashscore) ═══

function ExternalScraperCard({
  title,
  server,
  color,
}: {
  title: string;
  server: ServerData | null;
  color: string;
}) {
  const isOffline = !server || !server.latest;
  const gb = server?.latest?.goldbet;
  const dotColor = isOffline ? "#6b7280" : "#10b981";

  return (
    <div
      style={{
        background: "var(--admin-card)",
        border: `1px solid ${isOffline ? "var(--admin-border)" : color + "30"}`,
        borderRadius: 10,
        padding: "16px 20px",
        opacity: isOffline ? 0.4 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: isOffline ? 0 : 12 }}>
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: dotColor,
            boxShadow: isOffline ? "none" : `0 0 8px ${dotColor}`,
          }}
        />
        <span style={{ fontWeight: 700, color, fontSize: 16 }}>{title}</span>
        {isOffline && (
          <span style={{ fontSize: 14, color: "var(--admin-text4)", marginLeft: "auto" }}>Offline</span>
        )}
      </div>

      {!isOffline && gb && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 14 }}>
          <div style={{ color: "var(--admin-text3)" }}>
            Live: <span style={{ color: "var(--admin-text)", fontWeight: 600 }}>{formatNum(gb.live_events)}</span>
          </div>
          <div style={{ color: "var(--admin-text3)" }}>
            Pre: <span style={{ color: "var(--admin-text)", fontWeight: 600 }}>{formatNum(gb.prematch_events)}</span>
          </div>
          <div style={{ color: "var(--admin-text3)" }}>
            Mkt: <span style={{ color: "var(--admin-text)", fontWeight: 600 }}>{formatNum(gb.live_markets + gb.prematch_markets)}</span>
          </div>
          <div style={{ color: "var(--admin-text3)" }}>
            RAM: <span style={{ color: "var(--admin-text)", fontWeight: 600 }}>{gb.memory_mb ? `${gb.memory_mb}MB` : "—"}</span>
          </div>
          <div style={{ color: "var(--admin-text3)", gridColumn: "1 / -1" }}>
            Ciclo: <span style={{ color: "var(--admin-text)", fontWeight: 600 }}>{timeAgo(gb.last_live_cycle || gb.last_prematch_cycle)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══ COVERAGE KPI CARD ═══

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
        borderRadius: 10,
        padding: "20px 24px",
      }}
    >
      <div
        style={{
          fontSize: 13,
          textTransform: "uppercase",
          letterSpacing: 1.2,
          color: "var(--admin-text3)",
          fontWeight: 600,
          marginBottom: 10,
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div
            style={{
              fontSize: 36,
              fontWeight: 700,
              color,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1.1,
            }}
          >
            {pct}%
          </div>
          <div style={{ fontSize: 14, color: "var(--admin-text3)", marginTop: 6 }}>
            GB {formatNum(gbValue)} / V {formatNum(vValue)}
          </div>
        </div>
        {sparkData.length >= 2 && (
          <Sparkline data={sparkData} color={color} width={90} height={36} />
        )}
      </div>
    </div>
  );
}

// ═══ SPORT TABLE ═══

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
    const gbLiveEv = main?.goldbet.live.events || 0;
    const gbPrematchEv = pre?.goldbet.prematch.events ?? main?.goldbet.prematch.events ?? 0;
    const gbLiveMkt = main?.goldbet.live.markets || 0;
    const gbPrematchMkt = pre?.goldbet.prematch.markets ?? main?.goldbet.prematch.markets ?? 0;
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
          fontSize: 14,
          fontWeight: bold ? 700 : 600,
          color,
          background: coverageBg(pct),
          borderRadius: 6,
          padding: "4px 12px",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {pct}%
      </span>
    </span>
  );
}

const COL_TEMPLATE = "1.5fr repeat(2, 90px) 100px repeat(2, 90px) 100px";

function SportTable({
  mainSport,
  prematchSport,
}: {
  mainSport: Record<string, SportData> | undefined;
  prematchSport: Record<string, SportData> | undefined;
}) {
  const merged = mergeSportData(mainSport, prematchSport);
  const sorted = Object.entries(merged).sort((a, b) => b[1].gbEvents - a[1].gbEvents);
  if (sorted.length === 0) return null;

  let tGbEv = 0, tVEv = 0, tGbMkt = 0, tVMkt = 0;
  for (const [, d] of sorted) {
    tGbEv += d.gbEvents; tVEv += d.vEvents;
    tGbMkt += d.gbMarkets; tVMkt += d.vMarkets;
  }

  return (
    <>
      {/* Header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: COL_TEMPLATE,
          padding: "10px 24px",
          borderBottom: "1px solid var(--admin-border)",
          fontSize: 13,
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

      {sorted.map(([sport, d]) => (
        <div
          key={sport}
          style={{
            display: "grid",
            gridTemplateColumns: COL_TEMPLATE,
            padding: "12px 24px",
            borderBottom: "1px solid var(--admin-border)",
            alignItems: "center",
          }}
        >
          <span style={{ fontWeight: 600, color: "var(--admin-text)", fontSize: 15 }}>
            {SPORT_ICONS[sport] || "🏅"} {sport}
          </span>
          <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 15, color: "var(--admin-text2)" }}>
            {formatNumFull(d.gbEvents)}
          </span>
          <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 15, color: "var(--admin-text)", fontWeight: 600 }}>
            {formatNumFull(d.vEvents)}
          </span>
          <CoveragePill pct={coveragePct(d.gbEvents, d.vEvents)} />
          <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 15, color: "var(--admin-text2)" }}>
            {formatNum(d.gbMarkets)}
          </span>
          <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 15, color: "var(--admin-text)", fontWeight: 600 }}>
            {formatNum(d.vMarkets)}
          </span>
          <CoveragePill pct={coveragePct(d.gbMarkets, d.vMarkets)} />
        </div>
      ))}

      {/* Totals */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: COL_TEMPLATE,
          padding: "12px 24px",
          alignItems: "center",
          background: "rgba(59, 130, 246, 0.05)",
          fontWeight: 700,
        }}
      >
        <span style={{ color: "var(--admin-text)", fontSize: 15 }}>TOTALE</span>
        <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 15, color: "var(--admin-text2)" }}>{formatNumFull(tGbEv)}</span>
        <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 15, color: "var(--admin-text)" }}>{formatNumFull(tVEv)}</span>
        <CoveragePill pct={coveragePct(tGbEv, tVEv)} bold />
        <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 15, color: "var(--admin-text2)" }}>{formatNum(tGbMkt)}</span>
        <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 15, color: "var(--admin-text)" }}>{formatNum(tVMkt)}</span>
        <CoveragePill pct={coveragePct(tGbMkt, tVMkt)} bold />
      </div>
    </>
  );
}

// ═══ FRESHNESS ═══

const BUCKET_KEYS: (keyof FreshnessBuckets)[] = [
  "lt_30s", "30s_2m", "2m_5m", "5m_15m", "15m_30m", "30m_1h", "gt_1h",
];
const BUCKET_LABELS = ["<30s", "30s-2m", "2-5m", "5-15m", "15-30m", "30m-1h", ">1h"];
const BUCKET_COLORS = [
  "#10b981", "#22d3ee", "#3b82f6", "#f59e0b", "#f97316", "#ef4444", "#dc2626",
];

function FreshnessBar({ label, buckets }: { label: string; buckets: FreshnessBuckets | null }) {
  if (!buckets) return null;
  const total = BUCKET_KEYS.reduce((s, k) => s + (buckets[k] || 0), 0);
  if (total === 0) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 14, color: "var(--admin-text2)", fontWeight: 600, marginBottom: 6 }}>
        {label}{" "}
        <span style={{ color: "var(--admin-text4)", fontWeight: 400 }}>
          ({formatNumFull(total)} mercati)
        </span>
      </div>
      <div
        style={{
          display: "flex",
          height: 28,
          borderRadius: 6,
          overflow: "hidden",
          background: "var(--admin-border)",
        }}
      >
        {BUCKET_KEYS.map((k, i) => {
          const val = buckets[k] || 0;
          if (val === 0) return null;
          const pct = (val / total) * 100;
          return (
            <div
              key={k}
              title={`${BUCKET_LABELS[i]}: ${formatNumFull(val)} (${pct.toFixed(1)}%)`}
              style={{
                width: `${pct}%`,
                background: BUCKET_COLORS[i],
                minWidth: pct > 0.5 ? 2 : 0,
                transition: "width 0.3s",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function FreshnessContent({ health }: { health: HealthData }) {
  const of = health.metrics.outcome_freshness;
  if (!of) return null;

  const liveGB = of.live?.goldbet || null;
  const liveKambi = of.live?.kambi || null;
  const liveLeon = of.live?.leon || null;
  const preGB = of.prematch?.goldbet || null;
  const preKambi = of.prematch?.kambi || null;
  const preLeon = of.prematch?.leon || null;
  const hasAny = liveGB || liveKambi || liveLeon || preGB || preKambi || preLeon;
  if (!hasAny) return null;

  return (
    <>
      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 20, fontSize: 13 }}>
        {BUCKET_LABELS.map((lbl, i) => (
          <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: BUCKET_COLORS[i] }} />
            <span style={{ color: "var(--admin-text3)" }}>{lbl}</span>
          </div>
        ))}
      </div>
      <FreshnessBar label="Goldbet Live" buckets={liveGB} />
      <FreshnessBar label="Kambi Live" buckets={liveKambi} />
      <FreshnessBar label="Leon Live" buckets={liveLeon} />
      <FreshnessBar label="Goldbet Prematch" buckets={preGB} />
      <FreshnessBar label="Kambi Prematch" buckets={preKambi} />
      <FreshnessBar label="Leon Prematch" buckets={preLeon} />
    </>
  );
}

// ═══ REDIS PIPELINE ═══

function RedisPipelineContent({ metrics }: { metrics: RedisMetrics }) {
  const { redis, odds, throughput_history } = metrics;

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const sparkCps = throughput_history.map((h) => h.cps);
  const sparkQueue = throughput_history.map((h) => h.queue);

  const cards = [
    { label: "Quote/sec", value: String(odds.changes_per_second), color: "#8b5cf6", spark: sparkCps },
    { label: "Latenza Redis", value: `${redis.latency_ms}ms`, color: redis.latency_ms <= 5 ? "#10b981" : "#f59e0b" },
    { label: "Client SSE", value: String(odds.sse_clients), color: "#3b82f6" },
    { label: "Coda Supabase", value: String(odds.write_queue_depth), color: odds.write_queue_depth > 100 ? "#ef4444" : "#10b981", spark: sparkQueue },
    { label: "Memoria Redis", value: formatBytes(redis.memory_used), color: "#6366f1" },
    { label: "Eventi in cache", value: String(odds.active_events), color: "#06b6d4" },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 16,
      }}
    >
      {cards.map((card) => (
        <div
          key={card.label}
          style={{
            background: "rgba(255,255,255,0.03)",
            borderRadius: 8,
            padding: "16px 20px",
          }}
        >
          <div
            style={{
              fontSize: 13,
              textTransform: "uppercase",
              letterSpacing: 1,
              color: "var(--admin-text3)",
              marginBottom: 8,
              fontWeight: 600,
            }}
          >
            {card.label}
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: card.color,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1.1,
            }}
          >
            {card.value}
          </div>
          {card.spark && card.spark.length >= 2 && (
            <div style={{ marginTop: 8 }}>
              <Sparkline data={card.spark} color={card.color} width={110} height={28} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ═══ UNIFIED COVERAGE LOGIC ═══

function computeUnifiedCoverage(main: Snapshot | null, prematch: Snapshot | null) {
  const gbLiveEv = main?.goldbet.live_events_current_cycle ?? main?.goldbet.live_events ?? 0;
  const gbPrematchEv = prematch?.goldbet.prematch_events ?? main?.goldbet.prematch_events ?? 0;
  const vEvents = (main?.vincitu.live_events ?? 0) + (main?.vincitu.prematch_events ?? 0);
  const gbLiveMkt = main?.goldbet.live_markets ?? 0;
  const gbPrematchMkt = prematch?.goldbet.prematch_markets ?? main?.goldbet.prematch_markets ?? 0;
  const vMarkets = main?.vincitu.active_markets ?? 0;
  const gbLiveOut = main?.goldbet.live_outcomes ?? 0;
  const gbPrematchOut = prematch?.goldbet.prematch_outcomes ?? main?.goldbet.prematch_outcomes ?? 0;
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
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchStats = useCallback(async () => {
    try {
      const [statsResp, redisResp, healthResp] = await Promise.all([
        fetch("/api/scraper/stats"),
        fetch("/api/odds/metrics").catch(() => null),
        fetch("/api/system/health").catch(() => null),
      ]);
      if (statsResp.ok) setData(await statsResp.json());
      if (redisResp?.ok) setRedisMetrics(await redisResp.json());
      if (healthResp?.ok) setHealthData(await healthResp.json());
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
      <div style={{ padding: 60, textAlign: "center", color: "var(--admin-text3)", fontSize: 18 }}>
        Caricamento...
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 60, textAlign: "center", color: "var(--admin-text3)", fontSize: 18 }}>
        Errore nel caricamento dei dati
      </div>
    );
  }

  // ─── Disconnected: DB-only ───
  if (!data.connected) {
    const v = data.vincitu_only!;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <ServerHealthCard title="Main VPS" server={null} isMain />
          <ServerHealthCard title="Prematch VPS" server={null} isMain={false} />
        </div>

        <div
          style={{
            background: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            borderRadius: 10,
            padding: "20px 24px",
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <span style={{ fontSize: 28 }}>🔴</span>
          <div>
            <div style={{ color: "#ef4444", fontWeight: 700, fontSize: 18 }}>
              Scraper non connesso
            </div>
            <div style={{ color: "var(--admin-text3)", fontSize: 15 }}>
              Conteggi solo dal DB Vincitu
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 20 }}>
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
                borderRadius: 10,
                padding: 24,
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 1.2, color: "var(--admin-text3)", marginBottom: 10, fontWeight: 600 }}>
                {card.label}
              </div>
              <div style={{ fontSize: 36, fontWeight: 700, color: card.color, fontVariantNumeric: "tabular-nums" }}>
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
  const coverage = computeUnifiedCoverage(mainLatest, prematchLatest);

  const mainHistory = mainServer?.history || [];
  const sparkEvents = mainHistory.map((s) => {
    const gb = (s.goldbet.live_events_current_cycle ?? s.goldbet.live_events) + s.goldbet.prematch_events;
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
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* Section 0 — Health Banner */}
      {healthData && <HealthBanner health={healthData} />}

      {/* Live Source Toggle */}
      <LiveSourceToggle />

      {/* Section 1 — Server Health */}
      <CollapsibleSection title="Server Health">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <ServerHealthCard title="Main VPS (Goldbet Live)" server={mainServer} isMain />
          <ServerHealthCard title="Prematch VPS (Goldbet)" server={prematchServer} isMain={false} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, marginTop: 20 }}>
          <ExternalScraperCard title="Leon Bets" server={data.servers?.leon || null} color="#f59e0b" />
          <ExternalScraperCard title="Kambi" server={data.servers?.kambi || null} color="#8b5cf6" />
          <ExternalScraperCard title="Flashscore" server={data.servers?.flashscore || null} color="#06b6d4" />
        </div>
      </CollapsibleSection>

      {/* Section 2 — Coverage KPIs */}
      <CollapsibleSection title="Copertura">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
          <CoverageKPI label="Copertura Eventi" gbValue={coverage.events.gb} vValue={coverage.events.v} sparkData={sparkEvents} />
          <CoverageKPI label="Copertura Mercati" gbValue={coverage.markets.gb} vValue={coverage.markets.v} sparkData={sparkMarkets} />
          <CoverageKPI label="Copertura Outcomes" gbValue={coverage.outcomes.gb} vValue={coverage.outcomes.v} sparkData={sparkOutcomes} />
        </div>
      </CollapsibleSection>

      {/* Section 2.5 — Freshness */}
      {healthData && (
        <CollapsibleSection title="Freshness Quote" defaultOpen={false}>
          <FreshnessContent health={healthData} />
        </CollapsibleSection>
      )}

      {/* Section 3 — Sport Table */}
      <CollapsibleSection title="Copertura per Sport" defaultOpen={false}>
        <SportTable mainSport={mainLatest?.by_sport} prematchSport={prematchLatest?.by_sport} />
      </CollapsibleSection>

      {/* Section 4 — Redis Pipeline */}
      {redisMetrics && redisMetrics.redis.connected && (
        <CollapsibleSection
          title="Redis Pipeline"
          defaultOpen={false}
          badge={
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
              <span style={{ fontSize: 14, color: "var(--admin-text3)" }}>Attivo</span>
            </div>
          }
        >
          <RedisPipelineContent metrics={redisMetrics} />
        </CollapsibleSection>
      )}

      {/* Refresh indicator */}
      <div style={{ textAlign: "right", fontSize: 14, color: "var(--admin-text4)" }}>
        Auto-refresh ogni 30s — Ultimo: {lastRefresh.toLocaleTimeString("it-IT")}
      </div>
    </div>
  );
}
