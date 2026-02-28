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
  vincitu: { live_events: number; prematch_events: number; active_markets: number; active_outcomes: number };
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

interface StatsResponse {
  connected: boolean;
  latest: Snapshot | null;
  history: Snapshot[];
  vincitu_only?: {
    live_events: number;
    prematch_events: number;
    finished_events: number;
    ended_events: number;
  };
}

// ═══ HELPERS ═══

function diffColor(pct: number): string {
  const abs = Math.abs(pct);
  if (abs <= 10) return "#10b981"; // green
  if (abs <= 25) return "#f59e0b"; // yellow
  return "#ef4444"; // red
}

function diffBg(pct: number): string {
  const abs = Math.abs(pct);
  if (abs <= 10) return "rgba(16, 185, 129, 0.1)";
  if (abs <= 25) return "rgba(245, 158, 11, 0.1)";
  return "rgba(239, 68, 68, 0.1)";
}

function diffIcon(pct: number): string {
  const abs = Math.abs(pct);
  if (abs <= 10) return "✅";
  if (abs <= 25) return "⚠️";
  return "🔴";
}

function formatNum(n: number): string {
  return n.toLocaleString("it-IT");
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s fa`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m fa`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m fa`;
}

// ═══ SPARKLINE ═══

function Sparkline({
  data,
  width = 120,
  height = 32,
}: {
  data: number[];
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

  const latest = data[data.length - 1];
  const color = diffColor(latest);

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ═══ COMPARISON ROW ═══

function CompRow({
  label,
  goldbet,
  vincitu,
  diffPct,
  sparkData,
  goldbet_cumulative,
}: {
  label: string;
  goldbet: number;
  vincitu: number;
  diffPct: number;
  sparkData: number[];
  goldbet_cumulative?: number;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 100px 100px 90px 130px",
        alignItems: "center",
        padding: "12px 16px",
        borderBottom: "1px solid var(--admin-border)",
      }}
    >
      <span style={{ fontWeight: 600, color: "var(--admin-text)" }}>
        {label}
      </span>
      <div style={{ textAlign: "right" }}>
        <span
          style={{
            color: "var(--admin-text2)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatNum(goldbet)}
        </span>
        {goldbet_cumulative != null && goldbet_cumulative !== goldbet && (
          <div
            style={{
              fontSize: "0.7em",
              color: "var(--admin-text4)",
              marginTop: 2,
            }}
          >
            {formatNum(goldbet_cumulative)} monitorati
          </div>
        )}
      </div>
      <span
        style={{
          textAlign: "right",
          color: "var(--admin-text)",
          fontVariantNumeric: "tabular-nums",
          fontWeight: 600,
        }}
      >
        {formatNum(vincitu)}
      </span>
      <span
        style={{
          textAlign: "right",
          fontWeight: 700,
          color: diffColor(diffPct),
          background: diffBg(diffPct),
          borderRadius: 4,
          padding: "2px 8px",
          fontSize: "0.85em",
        }}
      >
        {diffIcon(diffPct)} {diffPct > 0 ? "+" : ""}
        {diffPct}%
      </span>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Sparkline data={sparkData} />
      </div>
    </div>
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

function getSportIcon(sport: string): string {
  return SPORT_ICONS[sport] || "🏅";
}

// ═══ SPORT BREAKDOWN TABLE ═══

function SportBreakdownTable({ bySport }: { bySport: Record<string, SportData> }) {
  // Sort by total Goldbet events descending
  const sorted = Object.entries(bySport).sort((a, b) => {
    const totalA = a[1].goldbet.live.events + a[1].goldbet.prematch.events;
    const totalB = b[1].goldbet.live.events + b[1].goldbet.prematch.events;
    return totalB - totalA;
  });

  if (sorted.length === 0) return null;

  return (
    <div
      style={{
        background: "var(--admin-card)",
        border: "1px solid var(--admin-border)",
        borderRadius: 8,
        overflow: "hidden",
        marginTop: 24,
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
        Dettaglio per Sport
      </div>

      {/* Header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr repeat(6, 1fr)",
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
        <span style={{ textAlign: "right" }}>Live GB</span>
        <span style={{ textAlign: "right" }}>Live V</span>
        <span style={{ textAlign: "right" }}>Pre GB</span>
        <span style={{ textAlign: "right" }}>Pre V</span>
        <span style={{ textAlign: "right" }}>Mkt GB</span>
        <span style={{ textAlign: "right" }}>Mkt V</span>
      </div>

      {/* Rows */}
      {sorted.map(([sport, data]) => {
        const gbLive = data.goldbet.live.events;
        const vLive = data.vincitu.live_events;
        const gbPre = data.goldbet.prematch.events;
        const vPre = data.vincitu.prematch_events;
        const gbMkt = data.goldbet.live.markets + data.goldbet.prematch.markets;
        const vMkt = data.vincitu.active_markets;

        const liveDiff = calcDiffPct(gbLive, vLive);
        const preDiff = calcDiffPct(gbPre, vPre);

        return (
          <div
            key={sport}
            style={{
              display: "grid",
              gridTemplateColumns: "1.4fr repeat(6, 1fr)",
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
              {getSportIcon(sport)} {sport}
            </span>
            <CellPair value={gbLive} isRef />
            <CellPair value={vLive} diff={liveDiff} />
            <CellPair value={gbPre} isRef />
            <CellPair value={vPre} diff={preDiff} />
            <CellPair value={gbMkt} isRef />
            <CellPair value={vMkt} diff={calcDiffPct(gbMkt, vMkt)} />
          </div>
        );
      })}

      {/* Totals row */}
      {(() => {
        let tGbLive = 0, tVLive = 0, tGbPre = 0, tVPre = 0, tGbMkt = 0, tVMkt = 0;
        for (const data of Object.values(bySport)) {
          tGbLive += data.goldbet.live.events;
          tVLive += data.vincitu.live_events;
          tGbPre += data.goldbet.prematch.events;
          tVPre += data.vincitu.prematch_events;
          tGbMkt += data.goldbet.live.markets + data.goldbet.prematch.markets;
          tVMkt += data.vincitu.active_markets;
        }
        return (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.4fr repeat(6, 1fr)",
              padding: "10px 16px",
              alignItems: "center",
              background: "rgba(59, 130, 246, 0.05)",
              fontWeight: 700,
            }}
          >
            <span style={{ color: "var(--admin-text)", fontSize: "0.9em" }}>
              TOTALE
            </span>
            <CellPair value={tGbLive} isRef bold />
            <CellPair value={tVLive} diff={calcDiffPct(tGbLive, tVLive)} bold />
            <CellPair value={tGbPre} isRef bold />
            <CellPair value={tVPre} diff={calcDiffPct(tGbPre, tVPre)} bold />
            <CellPair value={tGbMkt} isRef bold />
            <CellPair value={tVMkt} diff={calcDiffPct(tGbMkt, tVMkt)} bold />
          </div>
        );
      })()}
    </div>
  );
}

function calcDiffPct(goldbet: number, vincitu: number): number {
  if (goldbet === 0) return vincitu === 0 ? 0 : 100;
  return Math.round(((vincitu - goldbet) / goldbet) * 1000) / 10;
}

function CellPair({
  value,
  diff,
  isRef,
  bold,
}: {
  value: number;
  diff?: number;
  isRef?: boolean;
  bold?: boolean;
}) {
  return (
    <span
      style={{
        textAlign: "right",
        fontVariantNumeric: "tabular-nums",
        fontSize: "0.9em",
        color: isRef ? "var(--admin-text2)" : "var(--admin-text)",
        fontWeight: bold ? 700 : isRef ? 400 : 600,
      }}
    >
      {formatNum(value)}
      {diff != null && diff !== 0 && (
        <span
          style={{
            fontSize: "0.75em",
            marginLeft: 4,
            color: diffColor(diff),
          }}
        >
          {diff > 0 ? "+" : ""}{diff}%
        </span>
      )}
    </span>
  );
}

// ═══ MAIN DASHBOARD ═══

export default function ScraperStatsDashboard() {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchStats = useCallback(async () => {
    try {
      const resp = await fetch("/api/scraper/stats");
      if (resp.ok) {
        const json = await resp.json();
        setData(json);
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
    const interval = setInterval(fetchStats, 30_000); // refresh every 30s
    return () => clearInterval(interval);
  }, [fetchStats]);

  if (loading) {
    return (
      <div
        style={{
          padding: 40,
          textAlign: "center",
          color: "var(--admin-text3)",
        }}
      >
        Caricamento...
      </div>
    );
  }

  if (!data) {
    return (
      <div
        style={{
          padding: 40,
          textAlign: "center",
          color: "var(--admin-text3)",
        }}
      >
        Errore nel caricamento dei dati
      </div>
    );
  }

  // Not connected — show DB-only counts
  if (!data.connected) {
    const v = data.vincitu_only!;
    return (
      <div>
        {/* Status banner */}
        <div
          style={{
            background: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            borderRadius: 8,
            padding: "16px 20px",
            marginBottom: 24,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 24 }}>🔴</span>
          <div>
            <div
              style={{
                color: "#ef4444",
                fontWeight: 700,
                fontSize: "1.05em",
              }}
            >
              Scraper non connesso
            </div>
            <div style={{ color: "var(--admin-text3)", fontSize: "0.9em" }}>
              Nessun dato ricevuto dallo scraper. Conteggi solo dal DB Vincitu.
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
            {
              label: "Prematch",
              value: v.prematch_events,
              color: "#3b82f6",
            },
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
                {formatNum(card.value)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Connected — show comparison
  const latest = data.latest!;
  const history = data.history;

  const gbTotalMarkets =
    latest.goldbet.live_markets + latest.goldbet.prematch_markets;
  const gbTotalOutcomes =
    latest.goldbet.live_outcomes + latest.goldbet.prematch_outcomes;

  // Extract sparkline data
  const sparkLiveEvents = history.map((s) => s.diffs.live_events_pct);
  const sparkPrematchEvents = history.map((s) => s.diffs.prematch_events_pct);
  const sparkMarkets = history.map((s) => s.diffs.markets_pct);
  const sparkOutcomes = history.map((s) => s.diffs.outcomes_pct);

  const sessionColor =
    latest.goldbet.session_status === "healthy" ? "#10b981" : "#ef4444";
  const sessionLabel =
    latest.goldbet.session_status === "healthy" ? "Online" : "Problema";

  return (
    <div>
      {/* Status header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: sessionColor,
              boxShadow: `0 0 8px ${sessionColor}`,
            }}
          />
          <div>
            <span
              style={{
                fontWeight: 700,
                color: "var(--admin-text)",
                fontSize: "1.05em",
              }}
            >
              Scraper {sessionLabel}
            </span>
            <span
              style={{
                color: "var(--admin-text3)",
                fontSize: "0.85em",
                marginLeft: 12,
              }}
            >
              Ultimo aggiornamento: {timeAgo(latest.timestamp)}
            </span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 16,
            fontSize: "0.85em",
            color: "var(--admin-text3)",
          }}
        >
          <span>
            Live cycle: {timeAgo(latest.goldbet.last_live_cycle)}
          </span>
          <span>
            Prematch cycle: {timeAgo(latest.goldbet.last_prematch_cycle)}
          </span>
          {latest.goldbet.errors_last_hour > 0 && (
            <span style={{ color: "#ef4444" }}>
              {latest.goldbet.errors_last_hour} errori/h
            </span>
          )}
        </div>
      </div>

      {/* Comparison table */}
      <div
        style={{
          background: "var(--admin-card)",
          border: "1px solid var(--admin-border)",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 100px 100px 90px 130px",
            padding: "10px 16px",
            borderBottom: "1px solid var(--admin-border)",
            fontSize: "0.75em",
            textTransform: "uppercase",
            letterSpacing: 1,
            color: "var(--admin-text3)",
            fontWeight: 600,
          }}
        >
          <span>Metrica</span>
          <span style={{ textAlign: "right" }}>Goldbet</span>
          <span style={{ textAlign: "right" }}>Vincitu</span>
          <span style={{ textAlign: "right" }}>Diff</span>
          <span style={{ textAlign: "right" }}>Trend</span>
        </div>

        {/* Rows */}
        <CompRow
          label="Eventi Live"
          goldbet={latest.goldbet.live_events_current_cycle ?? latest.goldbet.live_events}
          vincitu={latest.vincitu.live_events}
          diffPct={latest.diffs.live_events_pct}
          sparkData={sparkLiveEvents}
          goldbet_cumulative={latest.goldbet.live_events}
        />
        <CompRow
          label="Eventi Prematch"
          goldbet={latest.goldbet.prematch_events_current_cycle ?? latest.goldbet.prematch_events}
          vincitu={latest.vincitu.prematch_events}
          diffPct={latest.diffs.prematch_events_pct}
          sparkData={sparkPrematchEvents}
          goldbet_cumulative={latest.goldbet.prematch_events}
        />
        <CompRow
          label="Mercati Attivi"
          goldbet={gbTotalMarkets}
          vincitu={latest.vincitu.active_markets}
          diffPct={latest.diffs.markets_pct}
          sparkData={sparkMarkets}
        />
        <CompRow
          label="Outcomes Attivi"
          goldbet={gbTotalOutcomes}
          vincitu={latest.vincitu.active_outcomes}
          diffPct={latest.diffs.outcomes_pct}
          sparkData={sparkOutcomes}
        />
      </div>

      {/* Sport breakdown table */}
      {latest.by_sport && Object.keys(latest.by_sport).length > 0 && (
        <SportBreakdownTable bySport={latest.by_sport} />
      )}

      {/* Extra info cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 16,
          marginTop: 24,
        }}
      >
        {/* Goldbet breakdown */}
        <div
          style={{
            background: "var(--admin-card)",
            border: "1px solid var(--admin-border)",
            borderRadius: 8,
            padding: 20,
          }}
        >
          <div
            style={{
              fontSize: "0.8em",
              textTransform: "uppercase",
              letterSpacing: 1,
              color: "var(--admin-text3)",
              marginBottom: 12,
              fontWeight: 600,
            }}
          >
            Goldbet — Dettaglio
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Row
              label="Mercati Live"
              value={formatNum(latest.goldbet.live_markets)}
            />
            <Row
              label="Mercati Prematch"
              value={formatNum(latest.goldbet.prematch_markets)}
            />
            <Row
              label="Outcomes Live"
              value={formatNum(latest.goldbet.live_outcomes)}
            />
            <Row
              label="Outcomes Prematch"
              value={formatNum(latest.goldbet.prematch_outcomes)}
            />
          </div>
        </div>

        {/* Vincitu DB state */}
        <div
          style={{
            background: "var(--admin-card)",
            border: "1px solid var(--admin-border)",
            borderRadius: 8,
            padding: 20,
          }}
        >
          <div
            style={{
              fontSize: "0.8em",
              textTransform: "uppercase",
              letterSpacing: 1,
              color: "var(--admin-text3)",
              marginBottom: 12,
              fontWeight: 600,
            }}
          >
            Vincitu DB
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Row
              label="Finished"
              value={formatNum(latest.vincitu.finished_events)}
            />
            <Row
              label="Ended"
              value={formatNum(latest.vincitu.ended_events)}
            />
            <Row
              label="Mercati Attivi"
              value={formatNum(latest.vincitu.active_markets)}
            />
            <Row
              label="Outcomes Attivi"
              value={formatNum(latest.vincitu.active_outcomes)}
            />
          </div>
        </div>

        {/* Scraper health */}
        <div
          style={{
            background: "var(--admin-card)",
            border: "1px solid var(--admin-border)",
            borderRadius: 8,
            padding: 20,
          }}
        >
          <div
            style={{
              fontSize: "0.8em",
              textTransform: "uppercase",
              letterSpacing: 1,
              color: "var(--admin-text3)",
              marginBottom: 12,
              fontWeight: 600,
            }}
          >
            Scraper Health
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Row label="Sessione" value={latest.goldbet.session_status} />
            <Row
              label="Errori/h"
              value={String(latest.goldbet.errors_last_hour)}
            />
            <Row label="Snapshots" value={String(history.length)} />
          </div>
        </div>
      </div>

      {/* Refresh indicator */}
      <div
        style={{
          marginTop: 16,
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

// Small helper row
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: "0.9em",
      }}
    >
      <span style={{ color: "var(--admin-text3)" }}>{label}</span>
      <span
        style={{
          color: "var(--admin-text)",
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}
