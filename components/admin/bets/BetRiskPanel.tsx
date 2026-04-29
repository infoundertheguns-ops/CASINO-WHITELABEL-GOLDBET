// components/admin/bets/BetRiskPanel.tsx
import type { BetDetailResponse } from "@/lib/types/bets-admin";
import { RiskBadge } from "./RiskBadge";

export function BetRiskPanel({ risk, bet }: { risk: BetDetailResponse["risk"]; bet: BetDetailResponse["bet"] }) {
  return (
    <div style={{ padding: 12, background: "var(--admin-surface)", border: "1px solid var(--admin-border)", borderRadius: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: "var(--admin-text4)" }}>🛡️ RISK SCORE</span>
        <RiskBadge score={risk.score} />
      </div>
      {risk.flags.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {risk.flags.map((f) => (
            <span key={f} style={{ padding: "2px 6px", background: "#92400e30", color: "#f59e0b", fontSize: 10, borderRadius: 4 }}>{f}</span>
          ))}
        </div>
      )}
      <div style={{ fontSize: 12, color: "var(--admin-text)" }}>
        <div>Acceptance: <strong>{risk.acceptance_mode ?? "auto"}</strong> {risk.accepted_by && `(${risk.accepted_by})`}</div>
        {risk.acceptance_note && <div style={{ marginTop: 4, color: "var(--admin-text4)" }}>Note: {risk.acceptance_note}</div>}
        {bet.requested_stake != null && bet.accepted_stake != null && bet.requested_stake !== bet.accepted_stake && (
          <div style={{ marginTop: 4, color: "#f59e0b" }}>
            ⚠ Stake ridotto: richiesto €{bet.requested_stake} → accettato €{bet.accepted_stake}
          </div>
        )}
      </div>
    </div>
  );
}
