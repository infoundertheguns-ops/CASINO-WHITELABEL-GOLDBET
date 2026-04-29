// components/admin/bets/BetCard.tsx
import type { BetDetailResponse } from "@/lib/types/bets-admin";
import { StatusBadge } from "./StatusBadge";

const fmtEur = (n: number | null) => n == null ? "—" : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleString("it-IT") : "—";

export function BetCard({ bet }: { bet: BetDetailResponse["bet"] }) {
  return (
    <div style={{ padding: 16, background: "var(--admin-surface)", border: "1px solid var(--admin-border)", borderRadius: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <StatusBadge status={bet.status} />
        <div style={{ fontSize: 24, fontWeight: 700, color: bet.actual_win && bet.actual_win > 0 ? "#10b981" : "var(--admin-text)" }}>
          {fmtEur((bet.actual_win != null && bet.actual_win > 0) ? bet.actual_win : bet.potential_win)}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, fontSize: 13, color: "var(--admin-text)" }}>
        <div><div style={{ fontSize: 10, color: "var(--admin-text4)" }}>STAKE</div>{fmtEur(bet.stake)}</div>
        <div><div style={{ fontSize: 10, color: "var(--admin-text4)" }}>QUOTA</div>{bet.total_odds?.toFixed(2) ?? "—"}</div>
        <div><div style={{ fontSize: 10, color: "var(--admin-text4)" }}>POTENZIALE</div>{fmtEur(bet.potential_win)}</div>
        <div><div style={{ fontSize: 10, color: "var(--admin-text4)" }}>TIPO</div>{bet.bet_type}</div>
        <div><div style={{ fontSize: 10, color: "var(--admin-text4)" }}>LIVE</div>{bet.is_live ? "Sì" : "No"}</div>
        <div><div style={{ fontSize: 10, color: "var(--admin-text4)" }}>FREE BET</div>{bet.is_free_bet ? "Sì" : "No"}</div>
      </div>
      <div style={{ marginTop: 12, fontSize: 11, color: "var(--admin-text4)" }}>
        Piazzata: {fmtDate(bet.created_at)} • Settled: {fmtDate(bet.settled_at)}
      </div>
    </div>
  );
}
