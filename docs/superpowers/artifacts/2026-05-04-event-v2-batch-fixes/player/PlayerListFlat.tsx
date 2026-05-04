// components/event-v2/PlayerListFlat.tsx
"use client";

import { useState, useMemo } from "react";

type PlayerOutcome = {
  outcomeId: string;
  outcomeIdV2: string;
  playerName: string;
  odds: number;
  isSuspended?: boolean;
  isManualSuspended?: boolean;
  oddsChange?: "up" | "down" | null;
};

type Props = {
  players: PlayerOutcome[];
  initialVisible?: number;
  onSelect: (o: { outcomeId: string; outcomeIdV2: string; odds: number; label: string }) => void;
};

export default function PlayerListFlat({
  players, initialVisible = 10, onSelect,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(
    () => [...players].sort((a, b) => a.odds - b.odds),
    [players]
  );

  if (sorted.length === 0) return null;

  const visible = expanded ? sorted : sorted.slice(0, initialVisible);
  const remaining = sorted.length - visible.length;

  return (
    <div style={{ background: "#f5f5f5", padding: 8, borderRadius: 4 }}>
      {visible.map(p => {
        const suspended = (p.isSuspended ?? false) || (p.isManualSuspended ?? false);
        return (
          <button
            key={p.outcomeId}
            type="button"
            disabled={suspended}
            onClick={() => {
              if (suspended) return;
              onSelect({
                outcomeId: p.outcomeId,
                outcomeIdV2: p.outcomeIdV2,
                odds: p.odds,
                label: p.playerName,
              });
            }}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 12,
              padding: "10px 12px",
              borderBottom: "1px solid #eee",
              alignItems: "center",
              background: suspended ? "#e8e8e8" : "white",
              border: "none",
              borderRadius: 4,
              marginBottom: 2,
              cursor: suspended ? "not-allowed" : "pointer",
              opacity: suspended ? 0.6 : 1,
              width: "100%",
              textAlign: "left",
            }}
          >
            <span style={{
              fontSize: 14,
              color: "#333",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontWeight: 500,
            }}>{p.playerName}</span>
            <span style={{
              fontSize: 16,
              fontWeight: 800,
              color: "#d0141c",
              minWidth: 56,
              textAlign: "right",
            }}>{p.odds.toFixed(2)}</span>
          </button>
        );
      })}
      {!expanded && remaining > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{
            width: "100%",
            padding: 12,
            background: "white",
            border: "1px dashed #aaa",
            borderRadius: 4,
            marginTop: 8,
            color: "#d0141c",
            fontWeight: "bold",
            cursor: "pointer",
          }}
        >Mostra tutti ({remaining})</button>
      )}
    </div>
  );
}
