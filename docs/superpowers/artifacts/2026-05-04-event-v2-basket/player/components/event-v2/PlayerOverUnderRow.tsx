// components/event-v2/PlayerOverUnderRow.tsx
"use client";

import React from "react";

type Outcome = {
  outcomeId: string;
  outcomeIdV2: string;
  name: string;       // expected: "<player>::over" or "<player>::under" (legacy "Over"/"Under" → skipped)
  odds: number;
  line: number | null;
};

type Props = {
  outcomes: Outcome[];
  onSelect: (o: { outcomeId: string; outcomeIdV2: string; odds: number; label: string }) => void;
};

type ParsedOutcome = {
  player: string;
  playerDisplay: string;
  statTag: string | null;
  direction: "over" | "under";
  odds: number;
  line: number;
  outcomeId: string;
  outcomeIdV2: string;
  raw: string;
};

function parseOutcome(o: Outcome): ParsedOutcome | null {
  const sepIdx = o.name.lastIndexOf("::");
  if (sepIdx < 0) return null;
  const labelPart = o.name.substring(0, sepIdx);
  const dir = o.name.substring(sepIdx + 2);
  if (dir !== "over" && dir !== "under") return null;
  const parenIdx = labelPart.indexOf("(");
  let playerDisplay = labelPart;
  let statTag: string | null = null;
  if (parenIdx > 0) {
    playerDisplay = labelPart.substring(0, parenIdx).trim();
    const closeIdx = labelPart.lastIndexOf(")");
    if (closeIdx > parenIdx) statTag = labelPart.substring(parenIdx + 1, closeIdx).trim();
  }
  return {
    player: labelPart, playerDisplay, statTag,
    direction: dir as "over" | "under",
    odds: o.odds, line: o.line ?? 0,
    outcomeId: o.outcomeId, outcomeIdV2: o.outcomeIdV2,
    raw: o.name,
  };
}

export default function PlayerOverUnderRow({ outcomes, onSelect }: Props) {
  type Pair = { player: string; playerDisplay: string; statTag: string | null; line: number; over?: ParsedOutcome; under?: ParsedOutcome };
  const groups = new Map<string, Pair>();
  for (const o of outcomes) {
    const p = parseOutcome(o);
    if (!p) continue;
    const key = `${p.player}|${p.line}`;
    if (!groups.has(key)) {
      groups.set(key, { player: p.player, playerDisplay: p.playerDisplay, statTag: p.statTag, line: p.line });
    }
    const g = groups.get(key)!;
    if (p.direction === "over") g.over = p;
    else g.under = p;
  }
  const list = Array.from(groups.values()).sort((a, b) => {
    if (a.player !== b.player) return a.player.localeCompare(b.player);
    return a.line - b.line;
  });

  if (list.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {list.map((g) => (
        <div key={`${g.player}@${g.line}`} style={{ display: "grid", gridTemplateColumns: "1fr auto 100px 100px", alignItems: "center", gap: 8, padding: "6px 8px", background: "#fff", borderRadius: 4 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#222", minHeight: 18 }}>
            {g.playerDisplay}
            {g.statTag && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 500, color: "#666" }}>({g.statTag})</span>}
          </div>
          <div style={{ fontSize: 12, color: "#888", minWidth: 36, textAlign: "center" }}>{g.line}</div>
          {g.over ? (
            <button
              onClick={() => onSelect({ outcomeId: g.over!.outcomeId, outcomeIdV2: g.over!.outcomeIdV2, odds: g.over!.odds, label: `${g.player} Over ${g.line}` })}
              style={{ fontSize: 12, padding: "4px 6px", border: "1px solid #ddd", borderRadius: 3, background: "#fafafa", cursor: "pointer" }}
            >
              <div style={{ fontSize: 10, color: "#666" }}>Over</div>
              <div style={{ fontWeight: 800, color: "#d0141c" }}>{g.over.odds.toFixed(2)}</div>
            </button>
          ) : <div />}
          {g.under ? (
            <button
              onClick={() => onSelect({ outcomeId: g.under!.outcomeId, outcomeIdV2: g.under!.outcomeIdV2, odds: g.under!.odds, label: `${g.player} Under ${g.line}` })}
              style={{ fontSize: 12, padding: "4px 6px", border: "1px solid #ddd", borderRadius: 3, background: "#fafafa", cursor: "pointer" }}
            >
              <div style={{ fontSize: 10, color: "#666" }}>Under</div>
              <div style={{ fontWeight: 800, color: "#d0141c" }}>{g.under.odds.toFixed(2)}</div>
            </button>
          ) : <div />}
        </div>
      ))}
    </div>
  );
}
