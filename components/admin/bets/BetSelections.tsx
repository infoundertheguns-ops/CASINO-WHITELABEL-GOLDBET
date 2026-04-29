// components/admin/bets/BetSelections.tsx
import type { BetSelectionDetail } from "@/lib/types/bets-admin";

export function BetSelections({ selections }: { selections: BetSelectionDetail[] }) {
  if (selections.length === 0) return null;
  const cell: React.CSSProperties = { padding: "8px 10px", fontSize: 12, borderBottom: "1px solid var(--admin-border)" };

  return (
    <div style={{ border: "1px solid var(--admin-border)", borderRadius: 6, overflow: "hidden" }}>
      <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--admin-text4)", background: "var(--admin-bg)", borderBottom: "1px solid var(--admin-border)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        📋 SELEZIONI ({selections.length})
      </div>
      {selections.map((s) => (
        <div key={s.id} style={{ padding: "10px 12px", borderBottom: "1px solid var(--admin-border)", color: "var(--admin-text)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span>{s.source === "sport" ? "⚽" : "🐎"} <strong>{s.event.name}</strong>{s.event.league && ` — ${s.event.league}`}</span>
            <span style={{
              fontSize: 10, padding: "2px 6px", borderRadius: 4,
              background: s.result === "won" ? "#10b98130" : s.result === "lost" ? "#ef444430" : "#37415130",
              color: s.result === "won" ? "#10b981" : s.result === "lost" ? "#ef4444" : "#9ca3af",
            }}>{(s.result || "PENDING").toUpperCase()}</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--admin-text4)" }}>
            Mercato: {s.market.type}{s.market.label ? ` (${s.market.label})` : ""} • Selezione: {s.outcome.name}
          </div>
          <div style={{ fontSize: 11, marginTop: 4 }}>
            Quota @ piazzata: <strong>{s.odds_at_placement.toFixed(2)}</strong>
            {s.current_odds != null && <span style={{ marginLeft: 12, color: "var(--admin-text4)" }}>Attuale: {s.current_odds.toFixed(2)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
