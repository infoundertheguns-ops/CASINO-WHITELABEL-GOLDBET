"use client";

import type { ServerData } from "./types";
import { timeAgo } from "./helpers";

interface SecondaryScrapersProps {
  flashscoreServer: ServerData | null;
}

export function SecondaryScrapers({ flashscoreServer }: SecondaryScrapersProps) {
  const flashOffline = !flashscoreServer || !flashscoreServer.latest;
  const flashGb = flashscoreServer?.latest?.kambi;

  const dotColor = flashOffline ? "#6b7280" : "#10b981";

  return (
    <div style={{
      background: "var(--admin-card)",
      border: `1px solid ${flashOffline ? "var(--admin-border)" : "#06b6d430"}`,
      borderRadius: 12,
      padding: "20px 24px",
      opacity: flashOffline ? 0.4 : 1,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: flashOffline ? 0 : 14 }}>
        <div style={{
          width: 10, height: 10, borderRadius: "50%",
          background: dotColor,
          boxShadow: flashOffline ? "none" : `0 0 6px ${dotColor}`,
        }} />
        <span style={{ fontWeight: 700, color: "#06b6d4", fontSize: 15 }}>Flashscore</span>
        {/* Review #5 P2-D: Settlement pill becomes a real link to /admin/settlement-health
            (Flashscore is the single source of truth for settlement coverage). */}
        <a
          href="/admin/settlement-health"
          title="Apri Settlement Health"
          style={{
            fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
            background: "#06b6d418", color: "#06b6d4", textTransform: "uppercase",
            border: "1px solid #06b6d444", textDecoration: "none",
            letterSpacing: 0.5,
          }}
        >Settlement →</a>
        {flashOffline && (
          <span style={{ fontSize: 13, color: "var(--admin-text4)", marginLeft: "auto" }}>Offline</span>
        )}
      </div>
      {!flashOffline && flashGb && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 14 }}>
          <div style={{ color: "var(--admin-text3)" }}>
            Risultati: <span style={{ color: "var(--admin-text)", fontWeight: 600 }}>{timeAgo(flashGb.last_live_cycle || flashGb.last_prematch_cycle)}</span>
          </div>
          <div style={{ color: "var(--admin-text3)" }}>
            Fixtures: <span style={{ color: "var(--admin-text)", fontWeight: 600 }}>{timeAgo(flashGb.last_prematch_cycle)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
