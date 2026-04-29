"use client";

import type { PrematchCycleStats } from "./types";
import { formatNum, formatNumFull, timeAgo } from "./helpers";

interface Props {
  title: string;
  subtitle?: string;  // e.g. "discovery+deep" or "<3h events"
  cycle: PrematchCycleStats | null | undefined;
  accent: string;  // color for header + running pill
}

function formatInterval(ms: number): string {
  if (ms <= 0) return "\u2014";
  const min = ms / 60_000;
  if (min < 1) return `${Math.round(ms / 1000)}s`;
  // Whole minutes: no decimal. Fractional: one decimal. >=10min: rounded.
  if (min >= 10) return `${Math.round(min)}min`;
  return Number.isInteger(min) ? `${min}min` : `${min.toFixed(1)}min`;
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
      <span style={{ color: "var(--admin-text3)" }}>{label}</span>
      <span style={{
        fontWeight: 600,
        color: valueColor || "var(--admin-text)",
        fontVariantNumeric: "tabular-nums",
      }}>
        {value}
      </span>
    </div>
  );
}

export function PrematchCyclePanel({ title, subtitle, cycle, accent }: Props) {
  if (!cycle) return null;

  const lastAgo = cycle.last_end_ts > 0
    ? timeAgo(new Date(cycle.last_end_ts).toISOString())
    : "Mai eseguito";
  const durationSec = cycle.cycle_ms > 0 ? (cycle.cycle_ms / 1000).toFixed(1) + "s" : "\u2014";
  const interval = formatInterval(cycle.interval_ms);

  return (
    <div style={{
      padding: "10px 12px",
      background: "var(--admin-card-alt, rgba(255,255,255,0.02))",
      border: "1px solid var(--admin-border)",
      borderRadius: 8,
      marginBottom: 8,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1.2,
            color: accent,
            textTransform: "uppercase",
          }}>
            {title}
          </span>
          {cycle.running && (
            <span style={{
              fontSize: 9,
              fontWeight: 700,
              padding: "2px 6px",
              borderRadius: 4,
              background: `${accent}22`,
              color: accent,
              letterSpacing: 0.5,
            }}>
              RUNNING
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, color: "var(--admin-text4)", fontVariantNumeric: "tabular-nums" }}>
          ogni {interval}
        </span>
      </div>

      {subtitle && (
        <div style={{ fontSize: 11, color: "var(--admin-text4)", marginBottom: 8, fontStyle: "italic" }}>
          {subtitle}
        </div>
      )}

      {/* Metrics */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <Row label="Ultimo" value={lastAgo} />
        <Row label="Eventi" value={formatNumFull(cycle.events)} />
        <Row label="Mercati" value={formatNum(cycle.markets)} />
        <Row label="Outcomes" value={formatNum(cycle.outcomes)} />
        {cycle.cycle_ms > 0 && <Row label="Durata" value={durationSec} />}
      </div>
    </div>
  );
}
