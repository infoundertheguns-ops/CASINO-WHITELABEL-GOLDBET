"use client";

import type { ServerData } from "./types";
import { formatNum, formatNumFull, timeAgo, formatUptime } from "./helpers";
import { PrematchCyclePanel } from "./prematch-cycle-panel";

interface TwobetHeroProps {
  server: ServerData | null;
}

function StatusDot({ online }: { online: boolean }) {
  const color = online ? "#10b981" : "#6b7280";
  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 8 }}>
      <div style={{
        width: 12, height: 12, borderRadius: "50%",
        background: color,
        boxShadow: online ? `0 0 8px ${color}` : "none",
      }} />
      {online && (
        <div style={{
          position: "absolute", width: 12, height: 12, borderRadius: "50%",
          background: color, opacity: 0.4,
          animation: "pulse-dot 2s infinite",
        }} />
      )}
      <span style={{
        fontSize: 13, fontWeight: 700, textTransform: "uppercase",
        color: online ? "#10b981" : "#ef4444",
      }}>
        {online ? "Online" : "Offline"}
      </span>
    </div>
  );
}

export function TwobetHeroSection({ server }: TwobetHeroProps) {
  const isOffline = !server || !server.latest;
  // Snapshot shape reuses "kambi" field name for the scraper payload —
  // for the 22bet server key this holds 22bet's stats.
  const stats = server?.latest?.kambi;

  const hasLiveData = !!(stats && stats.live_events > 0);
  const isOnline = !!stats;

  const snapshotTs = server?.latest?.timestamp;
  const lastCycleAgo = snapshotTs ? timeAgo(snapshotTs) : "\u2014";
  const cycleDurationMs = stats?.cycle_ms as number | undefined;
  const errorsPerHour = stats?.errors_last_hour ?? 0;

  const mktPerEvent = stats && (stats.prematch_events + stats.live_events) > 0
    ? Math.round((stats.prematch_markets + stats.live_markets) / (stats.prematch_events + stats.live_events) * 10) / 10
    : null;

  return (
    <>
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { transform: scale(1); opacity: 0.4; }
          50% { transform: scale(2); opacity: 0; }
        }
      `}</style>
      <div
        style={{
          background: "var(--admin-card)",
          border: "1px solid var(--admin-border)",
          borderLeft: `4px solid ${isOffline ? "#6b7280" : "#f97316"}`,
          borderRadius: 12,
          opacity: isOffline ? 0.6 : 1,
          overflow: "hidden",
        }}
      >
        {/* Header bar */}
        <div style={{
          padding: "16px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--admin-border)",
          background: "rgba(249,115,22,0.04)",
        }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--admin-text)", textTransform: "uppercase", letterSpacing: 1 }}>
            22bet Scraper
          </span>
          {mktPerEvent != null && (
            <span style={{
              padding: "4px 10px",
              borderRadius: 6,
              background: "rgba(249,115,22,0.12)",
              color: "#f97316",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0.5,
            }}>
              {mktPerEvent} mkt/ev
            </span>
          )}
        </div>

        {/* Body: 2 columns */}
        {!isOffline && stats ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
            {/* LIVE column */}
            <div style={{ padding: "20px 24px", borderRight: "1px solid var(--admin-border)" }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--admin-text-muted)", marginBottom: 12 }}>
                Live
              </div>
              <StatusDot online={isOnline && hasLiveData} />

              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                <MetricRow label="Ultimo ciclo" value={lastCycleAgo} />
                <MetricRow label="Eventi" value={formatNumFull(stats.live_events)} />
                <MetricRow label="Mercati" value={formatNumFull(stats.live_markets)} />
                <MetricRow label="Outcomes" value={formatNumFull(stats.live_outcomes)} />
                <MetricRow
                  label="Errori/h"
                  value={String(errorsPerHour)}
                  valueColor={errorsPerHour > 0 ? "#ef4444" : undefined}
                />
              </div>
            </div>

            {/* PREMATCH column with slow+fast sub-panels */}
            <div style={{ padding: "20px 24px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--admin-text-muted)", marginBottom: 12 }}>
                Prematch
              </div>
              <StatusDot online={isOnline} />

              <div style={{ marginTop: 12 }}>
                {stats.slow_prematch && (
                  <PrematchCyclePanel
                    title="Slow"
                    subtitle="Listing per sport + enrichment GetGameZip"
                    cycle={stats.slow_prematch}
                    accent="#f97316"
                  />
                )}
                {stats.fast_prematch && (
                  <PrematchCyclePanel
                    title="Fast"
                    subtitle="Solo eventi entro 3h, refresh champs cache"
                    cycle={stats.fast_prematch}
                    accent="#06b6d4"
                  />
                )}
                {!stats.slow_prematch && !stats.fast_prematch && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 10 }}>
                    <MetricRow label="Ultimo ciclo" value={lastCycleAgo} />
                    <MetricRow label="Eventi" value={formatNumFull(stats.prematch_events)} />
                    <MetricRow label="Mercati" value={formatNum(stats.prematch_markets)} />
                    <MetricRow label="Outcomes" value={formatNum(stats.prematch_outcomes)} />
                    {cycleDurationMs != null && (
                      <MetricRow label="Durata ciclo" value={`${(cycleDurationMs / 1000).toFixed(1)}s`} />
                    )}
                  </div>
                )}

                <div style={{
                  paddingTop: 10,
                  borderTop: "1px solid var(--admin-border)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}>
                  <MetricRow label="RAM" value={stats.memory_mb ? `${stats.memory_mb} MB` : "\u2014"} />
                  <MetricRow label="Uptime" value={formatUptime(stats.uptime_seconds)} />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ padding: 32, textAlign: "center", color: "#ef4444", fontSize: 16, fontWeight: 600 }}>
            OFFLINE
          </div>
        )}
      </div>
    </>
  );
}

function MetricRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: 14, color: "var(--admin-text3)" }}>{label}</span>
      <span style={{
        fontSize: 14, fontWeight: 600, color: valueColor || "var(--admin-text)",
        fontVariantNumeric: "tabular-nums",
      }}>
        {value}
      </span>
    </div>
  );
}
