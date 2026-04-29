// components/admin/bets/BetEventLog.tsx
import type { BetEventLogEntry } from "@/lib/types/bets-admin";

const ICON: Record<BetEventLogEntry["event"], string> = {
  placed: "▶",
  accepted: "✅",
  settled: "🏁",
};

export function BetEventLog({ entries }: { entries: BetEventLogEntry[] }) {
  return (
    <div style={{ padding: 12, background: "var(--admin-surface)", border: "1px solid var(--admin-border)", borderRadius: 6 }}>
      <div style={{ fontSize: 11, color: "var(--admin-text4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>📜 EVENT LOG</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {entries.map((e, i) => (
          <div key={i} style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--admin-text)" }}>
            <span style={{ fontFamily: "monospace", color: "var(--admin-text4)", minWidth: 130 }}>
              {new Date(e.ts).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "medium" })}
            </span>
            <span style={{ minWidth: 90 }}>{ICON[e.event]} {e.event.toUpperCase()}</span>
            <span style={{ color: "var(--admin-text4)" }}>{e.actor}</span>
            <span style={{ color: "var(--admin-text4)", fontFamily: "monospace", fontSize: 11 }}>
              {Object.entries(e.data).filter(([_, v]) => v != null).map(([k, v]) => `${k}=${v}`).join("  ")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
