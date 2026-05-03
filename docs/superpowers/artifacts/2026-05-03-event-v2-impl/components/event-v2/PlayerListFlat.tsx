// components/event-v2/PlayerListFlat.tsx
"use client";

import { useState, useMemo } from "react";
import OutcomeButton from "./OutcomeButton";

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
      {visible.map(p => (
        <div
          key={p.outcomeId}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 90px",
            gap: 6,
            padding: "8px 0",
            borderBottom: "1px solid #eee",
            alignItems: "center",
          }}
        >
          <span style={{
            fontSize: 13,
            color: "#333",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            paddingLeft: 8,
          }}>{p.playerName}</span>
          <OutcomeButton
            outcomeId={p.outcomeId}
            outcomeIdV2={p.outcomeIdV2}
            label={p.playerName}
            odds={p.odds}
            isSuspended={p.isSuspended ?? false}
            isManualSuspended={p.isManualSuspended ?? false}
            oddsChange={p.oddsChange ?? null}
            size="standard"
            onSelect={onSelect}
          />
        </div>
      ))}
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
