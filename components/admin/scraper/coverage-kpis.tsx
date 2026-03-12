"use client";

import type { Snapshot, ServerData } from "./types";
import { formatNum, formatNumFull } from "./helpers";
import { Sparkline } from "./sparkline";

interface CoverageKPIsProps {
  leonServer: ServerData | null;
}

function LeonKPICard({ label, value, sparkData, color }: {
  label: string; value: string; sparkData: number[]; color: string;
}) {
  return (
    <div style={{
      background: "var(--admin-card)",
      border: "1px solid var(--admin-border)",
      borderRadius: 12,
      padding: "20px 24px",
    }}>
      <div style={{
        fontSize: 13, textTransform: "uppercase", letterSpacing: 1.2,
        color: "var(--admin-text3)", fontWeight: 600, marginBottom: 10,
      }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{
          fontSize: 36, fontWeight: 700, color,
          fontVariantNumeric: "tabular-nums", lineHeight: 1.1,
        }}>
          {value}
        </div>
        {sparkData.length >= 2 && (
          <Sparkline data={sparkData} color={color} width={100} height={36} />
        )}
      </div>
    </div>
  );
}

export function CoverageKPIs({ leonServer }: CoverageKPIsProps) {
  const latest = leonServer?.latest;
  const history = leonServer?.history || [];

  if (!latest) return null;

  const gb = latest.goldbet;

  // Leon scraper absolute numbers
  const totalEvents = gb.live_events + gb.prematch_events;
  const totalMarkets = gb.live_markets + gb.prematch_markets;
  const totalOutcomes = gb.live_outcomes + gb.prematch_outcomes;

  // Sparklines: absolute Leon numbers over time
  const sparkEvents = history.map((s: Snapshot) =>
    s.goldbet.live_events + s.goldbet.prematch_events
  );
  const sparkMarkets = history.map((s: Snapshot) =>
    s.goldbet.live_markets + s.goldbet.prematch_markets
  );
  const sparkOutcomes = history.map((s: Snapshot) =>
    s.goldbet.live_outcomes + s.goldbet.prematch_outcomes
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
      <LeonKPICard
        label="Leon Eventi"
        value={formatNumFull(totalEvents)}
        sparkData={sparkEvents}
        color="#f59e0b"
      />
      <LeonKPICard
        label="Leon Mercati"
        value={formatNum(totalMarkets)}
        sparkData={sparkMarkets}
        color="#8b5cf6"
      />
      <LeonKPICard
        label="Leon Outcomes"
        value={formatNum(totalOutcomes)}
        sparkData={sparkOutcomes}
        color="#3b82f6"
      />
    </div>
  );
}
