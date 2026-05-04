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

const INITIAL_ROWS = 6;

export default function PlayerListFlat({
  players, initialVisible = INITIAL_ROWS, onSelect,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(
    () => [...players].sort((a, b) => a.odds - b.odds),
    [players]
  );

  if (sorted.length === 0) return null;

  const visible = expanded ? sorted : sorted.slice(0, initialVisible);
  const remaining = sorted.length - visible.length;
  const canCollapse = expanded && sorted.length > initialVisible;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {visible.map(p => {
        const suspended = (p.isSuspended ?? false) || (p.isManualSuspended ?? false);
        return (
          <div
            key={p.outcomeId}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto auto",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              background: suspended ? "#e8e8e8" : "#fff",
              borderRadius: 4,
              border: "1px solid #eee",
              opacity: suspended ? 0.6 : 1,
              width: "100%",
            }}
          >
            <span
              style={{
                fontSize: 14,
                color: "#333",
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {p.playerName}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#666",
                padding: "2px 6px",
                border: "1px solid #ddd",
                borderRadius: 3,
                letterSpacing: 0.5,
                background: "#fafafa",
              }}
            >
              OVER
            </span>
            <button
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
                fontSize: 15,
                fontWeight: 800,
                color: "#d0141c",
                padding: "6px 12px",
                border: "1px solid #ddd",
                borderRadius: 3,
                background: suspended ? "#e8e8e8" : "#fafafa",
                cursor: suspended ? "not-allowed" : "pointer",
                minWidth: 64,
                textAlign: "center",
              }}
            >
              {p.odds.toFixed(2)}
            </button>
          </div>
        );
      })}
      {!expanded && remaining > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{
            marginTop: 4,
            padding: 10,
            fontSize: 12,
            fontWeight: 700,
            color: "#555",
            background: "#f5f5f5",
            border: "1px dashed #ccc",
            borderRadius: 4,
            cursor: "pointer",
            textAlign: "center",
            width: "100%",
          }}
        >
          Mostra altri {remaining} risultati
        </button>
      )}
      {canCollapse && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          style={{
            marginTop: 4,
            padding: 10,
            fontSize: 12,
            fontWeight: 700,
            color: "#555",
            background: "#f5f5f5",
            border: "1px dashed #ccc",
            borderRadius: 4,
            cursor: "pointer",
            textAlign: "center",
            width: "100%",
          }}
        >
          Mostra meno
        </button>
      )}
    </div>
  );
}
