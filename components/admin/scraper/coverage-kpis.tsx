"use client";

import type { Snapshot, ServerData } from "./types";
import { formatNum, formatNumFull } from "./helpers";
import { Sparkline } from "./sparkline";

interface CoverageKPIsProps {
  server: ServerData | null;
  twobetServer?: ServerData | null;
}

function KPICard({ label, value, sparkData, color }: {
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

function buildKambiCards(server: ServerData) {
  const gb = server.latest!.kambi;
  const history = server.history || [];

  const totalEvents = gb.live_events + gb.prematch_events;
  const totalMarkets = gb.live_markets + gb.prematch_markets;
  const totalOutcomes = gb.live_outcomes + gb.prematch_outcomes;

  const sparkEvents = history.map((s: Snapshot) => s.kambi.live_events + s.kambi.prematch_events);
  const sparkMarkets = history.map((s: Snapshot) => s.kambi.live_markets + s.kambi.prematch_markets);
  const sparkOutcomes = history.map((s: Snapshot) => s.kambi.live_outcomes + s.kambi.prematch_outcomes);

  return [
    <KPICard key="k-ev" label="Kambi Eventi" value={formatNumFull(totalEvents)} sparkData={sparkEvents} color="#f59e0b" />,
    <KPICard key="k-mk" label="Kambi Mercati" value={formatNum(totalMarkets)} sparkData={sparkMarkets} color="#8b5cf6" />,
    <KPICard key="k-ou" label="Kambi Outcomes" value={formatNum(totalOutcomes)} sparkData={sparkOutcomes} color="#3b82f6" />,
  ];
}

function buildTwobetCards(server: ServerData) {
  const tb = server.latest!.kambi; // snapshot payload field is named "kambi" regardless of source
  const history = server.history || [];

  const totalEvents = tb.live_events + tb.prematch_events;
  const totalMarkets = tb.live_markets + tb.prematch_markets;
  const totalOutcomes = tb.live_outcomes + tb.prematch_outcomes;

  const sparkEvents = history.map((s: Snapshot) => s.kambi.live_events + s.kambi.prematch_events);
  const sparkMarkets = history.map((s: Snapshot) => s.kambi.live_markets + s.kambi.prematch_markets);
  const sparkOutcomes = history.map((s: Snapshot) => s.kambi.live_outcomes + s.kambi.prematch_outcomes);

  return [
    <KPICard key="t-ev" label="22bet Eventi" value={formatNumFull(totalEvents)} sparkData={sparkEvents} color="#f97316" />,
    <KPICard key="t-mk" label="22bet Mercati" value={formatNum(totalMarkets)} sparkData={sparkMarkets} color="#fb923c" />,
    <KPICard key="t-ou" label="22bet Outcomes" value={formatNum(totalOutcomes)} sparkData={sparkOutcomes} color="#fdba74" />,
  ];
}

export function CoverageKPIs({ server, twobetServer }: CoverageKPIsProps) {
  const cards: React.ReactNode[] = [];
  if (server?.latest) cards.push(...buildKambiCards(server));
  if (twobetServer?.latest) cards.push(...buildTwobetCards(twobetServer));

  if (cards.length === 0) return null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
      {cards}
    </div>
  );
}
