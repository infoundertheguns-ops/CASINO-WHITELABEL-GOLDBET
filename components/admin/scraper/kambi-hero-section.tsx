"use client";

import type { ServerData } from "./types";
import { formatNum, formatNumFull, timeAgo, formatUptime } from "./helpers";
import { PrematchCyclePanel } from "./prematch-cycle-panel";

interface KambiHeroProps {
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

export function KambiHeroSection({ server }: KambiHeroProps) {
  const isOffline = !server || !server.latest;
  const gb = server?.latest?.kambi;

  const hasLiveData = !!(gb && gb.live_events > 0);
  const isOnline = !!gb;

  const snapshotTs = server?.latest?.timestamp;
  const lastCycleAgo = snapshotTs ? timeAgo(snapshotTs) : "\u2014";
  const cycleDurationMs = gb?.cycle_ms as number | undefined;
  const errorsPerHour = gb?.errors_last_hour ?? 0;

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
          borderLeft: `4px solid ${isOffline ? "#6b7280" : "#8b5cf6"}`,
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
          background: "rgba(255,255,255,0.02)",
        }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--admin-text)", textTransform: "uppercase", letterSpacing: 1 }}>
            Kambi Scraper
          </span>
        </div>

        {/* Body: 2 columns */}
        {!isOffline && gb ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
            {/* LIVE column */}
            <div style={{ padding: "20px 24px", borderRight: "1px solid var(--admin-border)" }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--admin-text-muted)", marginBottom: 12 }}>
                Live
              </div>
              <StatusDot online={isOnline && hasLiveData} />

              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                <MetricRow label="Ultimo ciclo" value={lastCycleAgo} />
                <MetricRow label="Eventi" value={formatNumFull(gb.live_events)} />
                <MetricRow label="Mercati" value={formatNumFull(gb.live_markets)} />
                <MetricRow label="Outcomes" value={formatNumFull(gb.live_outcomes)} />
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
                {gb.slow_prematch && (
                  <PrematchCyclePanel
                    title="Slow"
                    subtitle="Discovery + deep fetch, tutti i paesi"
                    cycle={gb.slow_prematch}
                    accent="#8b5cf6"
                  />
                )}
                {gb.fast_prematch && (
                  <PrematchCyclePanel
                    title="Fast"
                    subtitle="Solo eventi entro 3h, merge operatori"
                    cycle={gb.fast_prematch}
                    accent="#06b6d4"
                  />
                )}
                {/* Legacy fallback if scraper hasn't been updated yet */}
                {!gb.slow_prematch && !gb.fast_prematch && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 10 }}>
                    <MetricRow label="Ultimo ciclo" value={lastCycleAgo} />
                    <MetricRow label="Eventi" value={formatNumFull(gb.prematch_events)} />
                    <MetricRow label="Mercati" value={formatNum(gb.prematch_markets)} />
                    <MetricRow label="Outcomes" value={formatNum(gb.prematch_outcomes)} />
                    {cycleDurationMs != null && (
                      <MetricRow label="Durata ciclo" value={`${(cycleDurationMs / 1000).toFixed(1)}s`} />
                    )}
                  </div>
                )}

                {/* Common footer metrics */}
                <div style={{
                  paddingTop: 10,
                  borderTop: "1px solid var(--admin-border)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}>
                  <MetricRow label="RAM" value={gb.memory_mb ? `${gb.memory_mb} MB` : "\u2014"} />
                  <MetricRow label="Uptime" value={formatUptime(gb.uptime_seconds)} />
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
