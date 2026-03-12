"use client";

import type { ServerData } from "./types";
import { formatNum, timeAgo } from "./helpers";

interface SecondaryScrapersProps {
  kambiServer: ServerData | null;
  flashscoreServer: ServerData | null;
}

function ScraperCard({ title, badge, color, children, isOffline }: {
  title: string; badge: string; color: string; children: React.ReactNode; isOffline: boolean;
}) {
  const dotColor = isOffline ? "#6b7280" : "#10b981";

  return (
    <div style={{
      background: "var(--admin-card)",
      border: `1px solid ${isOffline ? "var(--admin-border)" : color + "30"}`,
      borderRadius: 12,
      padding: "20px 24px",
      opacity: isOffline ? 0.4 : 1,
      flex: 1,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: isOffline ? 0 : 14 }}>
        <div style={{
          width: 10, height: 10, borderRadius: "50%",
          background: dotColor,
          boxShadow: isOffline ? "none" : `0 0 6px ${dotColor}`,
        }} />
        <span style={{ fontWeight: 700, color, fontSize: 15 }}>{title}</span>
        <span style={{
          fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
          background: `${color}15`, color, textTransform: "uppercase",
        }}>{badge}</span>
        {isOffline && (
          <span style={{ fontSize: 13, color: "var(--admin-text4)", marginLeft: "auto" }}>Offline</span>
        )}
      </div>
      {!isOffline && children}
    </div>
  );
}

export function SecondaryScrapers({ kambiServer, flashscoreServer }: SecondaryScrapersProps) {
  const kambiOffline = !kambiServer || !kambiServer.latest;
  const kambiGb = kambiServer?.latest?.goldbet;

  const flashOffline = !flashscoreServer || !flashscoreServer.latest;
  const flashGb = flashscoreServer?.latest?.goldbet;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      {/* KAMBI */}
      <ScraperCard title="Kambi" badge="Backup" color="#8b5cf6" isOffline={kambiOffline}>
        {kambiGb && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 14 }}>
            <div style={{ color: "var(--admin-text3)" }}>
              Live: <span style={{ color: "var(--admin-text)", fontWeight: 600 }}>{formatNum(kambiGb.live_events)}</span>
            </div>
            <div style={{ color: "var(--admin-text3)" }}>
              Prematch: <span style={{ color: "var(--admin-text)", fontWeight: 600 }}>{formatNum(kambiGb.prematch_events)}</span>
            </div>
            <div style={{ color: "var(--admin-text3)" }}>
              Mercati: <span style={{ color: "var(--admin-text)", fontWeight: 600 }}>{formatNum(kambiGb.live_markets + kambiGb.prematch_markets)}</span>
            </div>
            <div style={{ color: "var(--admin-text3)" }}>
              Ultimo ciclo: <span style={{ color: "var(--admin-text)", fontWeight: 600 }}>{timeAgo(kambiGb.last_live_cycle || kambiGb.last_prematch_cycle)}</span>
            </div>
          </div>
        )}
      </ScraperCard>

      {/* FLASHSCORE */}
      <ScraperCard title="Flashscore" badge="Settlement" color="#06b6d4" isOffline={flashOffline}>
        {flashGb && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 14 }}>
            <div style={{ color: "var(--admin-text3)" }}>
              Risultati: <span style={{ color: "var(--admin-text)", fontWeight: 600 }}>{timeAgo(flashGb.last_live_cycle || flashGb.last_prematch_cycle)}</span>
            </div>
            <div style={{ color: "var(--admin-text3)" }}>
              Fixtures: <span style={{ color: "var(--admin-text)", fontWeight: 600 }}>{timeAgo(flashGb.last_prematch_cycle)}</span>
            </div>
          </div>
        )}
      </ScraperCard>
    </div>
  );
}
