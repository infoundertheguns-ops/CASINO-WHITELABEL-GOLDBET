// components/admin/bets/BetMetadata.tsx
import type { BetDetailResponse } from "@/lib/types/bets-admin";

export function BetMetadata({ bet, kiosk, agent, risk }: {
  bet: BetDetailResponse["bet"];
  kiosk: BetDetailResponse["kiosk"];
  agent: BetDetailResponse["agent"];
  risk: BetDetailResponse["risk"];
}) {
  const Section = ({ title, items }: { title: string; items: Array<[string, string | number | null]> }) => (
    <div style={{ padding: 12, background: "var(--admin-surface)", border: "1px solid var(--admin-border)", borderRadius: 6 }}>
      <div style={{ fontSize: 11, color: "var(--admin-text4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>{title}</div>
      {items.map(([k, v]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
          <span style={{ color: "var(--admin-text4)" }}>{k}</span>
          <span style={{ color: "var(--admin-text)", fontFamily: typeof v === "string" && v.includes(".") ? "monospace" : undefined }}>{v ?? "—"}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
      <Section title="🖥️ KIOSK" items={[
        ["Codice", kiosk?.code ?? null],
        ["Nome", kiosk?.name ?? null],
      ]} />
      <Section title="🏢 AGENT" items={[
        ["Codice", agent?.code ?? null],
        ["Nome", agent?.name ?? null],
        ["Livello", agent?.level ?? null],
      ]} />
      <Section title="🌐 METADATA" items={[
        ["IP", risk.placed_ip],
        ["Fingerprint", risk.placed_fingerprint],
        ["Time-to-kickoff", bet.time_to_kickoff_minutes != null ? `${bet.time_to_kickoff_minutes} min` : null],
      ]} />
    </div>
  );
}
