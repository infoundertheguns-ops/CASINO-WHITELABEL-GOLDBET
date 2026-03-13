"use client";

import type { ServerData } from "./types";
import { formatNum, formatNumFull, timeAgo, formatUptime } from "./helpers";

interface LeonHeroProps {
  leonServer: ServerData | null;
  liveSource: "leon" | "kambi";
  onToggleSource: (source: "leon" | "kambi") => void;
  saving: boolean;
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

export function LeonHeroSection({ leonServer, liveSource, onToggleSource, saving }: LeonHeroProps) {
  const isOffline = !leonServer || !leonServer.latest;
  const gb = leonServer?.latest?.goldbet;

  // Leon snapshot uses different field names than legacy Goldbet
  // Check online by: snapshot exists + has events
  const hasLiveData = !!(gb && gb.live_events > 0);
  const hasPrematchData = !!(gb && gb.prematch_events > 0);
  const isLeonOnline = !!gb;

  // Leon uses cycle_ms (ms for last cycle), not last_live_cycle/last_prematch_cycle timestamps
  // Snapshot timestamp tells us when the last update was
  const snapshotTs = leonServer?.latest?.timestamp;
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
          borderLeft: `4px solid ${isOffline ? "#6b7280" : "#f59e0b"}`,
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
            Leon Bets Scraper
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            {(["leon", "kambi"] as const).map((s) => (
              <button
                key={s}
                onClick={() => onToggleSource(s)}
                disabled={saving}
                style={{
                  padding: "6px 16px",
                  borderRadius: 6,
                  border: liveSource === s ? "2px solid #3b82f6" : "1px solid var(--admin-border)",
                  background: liveSource === s ? "rgba(59, 130, 246, 0.15)" : "transparent",
                  color: liveSource === s ? "#3b82f6" : "var(--admin-text3)",
                  fontWeight: liveSource === s ? 700 : 500,
                  fontSize: 13,
                  cursor: saving ? "not-allowed" : "pointer",
                  opacity: saving ? 0.5 : 1,
                }}
              >
                {s === "leon" ? "Leon" : "Kambi"}
                {liveSource === s && " \u2713"}
              </button>
            ))}
          </div>
        </div>

        {/* Body: 2 columns */}
        {!isOffline && gb ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
            {/* LIVE column */}
            <div style={{ padding: "20px 24px", borderRight: "1px solid var(--admin-border)" }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--admin-text-muted)", marginBottom: 12 }}>
                Live
              </div>
              <StatusDot online={isLeonOnline && hasLiveData} />

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

            {/* PREMATCH column */}
            <div style={{ padding: "20px 24px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--admin-text-muted)", marginBottom: 12 }}>
                Prematch
              </div>
              <StatusDot online={isLeonOnline && hasPrematchData} />

              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                <MetricRow label="Ultimo ciclo" value={lastCycleAgo} />
                <MetricRow label="Eventi" value={formatNumFull(gb.prematch_events)} />
                <MetricRow label="Mercati" value={formatNum(gb.prematch_markets)} />
                <MetricRow label="Outcomes" value={formatNum(gb.prematch_outcomes)} />
                {cycleDurationMs != null && (
                  <MetricRow label="Durata ciclo" value={`${(cycleDurationMs / 1000).toFixed(1)}s`} />
                )}
                <MetricRow label="RAM" value={gb.memory_mb ? `${gb.memory_mb} MB` : "\u2014"} />
                <MetricRow label="Uptime" value={formatUptime(gb.uptime_seconds)} />
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
