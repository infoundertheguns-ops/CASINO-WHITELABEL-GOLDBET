"use client";
import React from "react";

type Outcome = {
  outcomeId: string;
  outcomeIdV2: string;
  name: string;
  odds: number;
};

type Props = {
  outcomes: Outcome[];
  onSelect: (o: { outcomeId: string; outcomeIdV2: string; odds: number; label: string }) => void;
};

type Parsed = {
  player: string;
  team: string | null;
  direction: "yes" | "no";
  odds: number;
  outcomeId: string;
  outcomeIdV2: string;
};

function parse(o: Outcome): Parsed | null {
  // Match: "<player> (Yes|No) (team)" or "<player> (Yes|No)"
  const m = /^(.*?)\s*\((Yes|No)\)(?:\s*\(([^)]*)\))?\s*$/i.exec(o.name);
  if (!m) return null;
  const player = m[1].trim();
  const dirRaw = m[2].toLowerCase();
  const team = m[3] ? m[3].trim() : null;
  if (dirRaw !== "yes" && dirRaw !== "no") return null;
  if (!player) return null;
  return {
    player,
    team,
    direction: dirRaw as "yes" | "no",
    odds: o.odds,
    outcomeId: o.outcomeId,
    outcomeIdV2: o.outcomeIdV2,
  };
}

export default function PlayerYesNoRow({ outcomes, onSelect }: Props) {
  type Pair = { player: string; team: string | null; yes?: Parsed; no?: Parsed };
  const groups = new Map<string, Pair>();
  for (const o of outcomes) {
    const p = parse(o);
    if (!p) continue;
    if (!groups.has(p.player)) groups.set(p.player, { player: p.player, team: p.team });
    const g = groups.get(p.player)!;
    if (p.direction === "yes") g.yes = p;
    else g.no = p;
  }
  const list = Array.from(groups.values()).sort((a, b) => a.player.localeCompare(b.player));
  if (list.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {list.map((g) => (
        <div key={g.player} style={{ display: "grid", gridTemplateColumns: "1fr auto 100px 100px", alignItems: "center", gap: 8, padding: "8px 12px", background: "#fff", borderRadius: 4 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#222", minHeight: 18 }}>
            {g.player}
            {g.team && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 500, color: "#666" }}>({g.team})</span>}
          </div>
          <div style={{ fontSize: 11, color: "#888", minWidth: 36, textAlign: "center" }}>{/* spacer */}</div>
          {g.yes ? (
            <button type="button" onClick={() => onSelect({ outcomeId: g.yes!.outcomeId, outcomeIdV2: g.yes!.outcomeIdV2, odds: g.yes!.odds, label: `${g.player} Sì` })}
              style={{ fontSize: 12, padding: "4px 6px", border: "1px solid #ddd", borderRadius: 3, background: "#fafafa", cursor: "pointer" }}>
              <div style={{ fontSize: 10, color: "#666" }}>Sì</div>
              <div style={{ fontWeight: 800, color: "#d0141c" }}>{g.yes.odds.toFixed(2)}</div>
            </button>
          ) : <div />}
          {g.no ? (
            <button type="button" onClick={() => onSelect({ outcomeId: g.no!.outcomeId, outcomeIdV2: g.no!.outcomeIdV2, odds: g.no!.odds, label: `${g.player} No` })}
              style={{ fontSize: 12, padding: "4px 6px", border: "1px solid #ddd", borderRadius: 3, background: "#fafafa", cursor: "pointer" }}>
              <div style={{ fontSize: 10, color: "#666" }}>No</div>
              <div style={{ fontWeight: 800, color: "#d0141c" }}>{g.no.odds.toFixed(2)}</div>
            </button>
          ) : <div />}
        </div>
      ))}
    </div>
  );
}
