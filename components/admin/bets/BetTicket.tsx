// components/admin/bets/BetTicket.tsx
// Betslip-style receipt view — mirrors what the player sees on the kiosk ticket.
import type { BetDetailResponse } from "@/lib/types/bets-admin";

const fmtEur = (n: number | null) =>
  n == null ? "—" : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);
const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : "—";

const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  open:               { bg: "#374151", color: "#d1d5db", label: "APERTA" },
  won:                { bg: "#064e3b", color: "#10b981", label: "VINCENTE" },
  lost:               { bg: "#7f1d1d", color: "#ef4444", label: "PERDENTE" },
  void:               { bg: "#1e1b4b", color: "#818cf8", label: "ANNULLATA" },
  pending_acceptance: { bg: "#78350f", color: "#f59e0b", label: "IN REVISIONE" },
  rejected:           { bg: "#7f1d1d", color: "#f87171", label: "RIFIUTATA" },
  cashout:            { bg: "#0c4a6e", color: "#38bdf8", label: "CASHOUT" },
};

const RESULT_ICON: Record<string, string> = {
  won: "✅", lost: "❌", void: "↩️",
};

const SOURCE_ICON: Record<string, string> = {
  sport: "⚽", ippica: "🐎", ippica_tote: "🎠",
};

interface Props {
  bet: BetDetailResponse["bet"];
  selections: BetDetailResponse["selections"];
  user: BetDetailResponse["user"];
  kiosk: BetDetailResponse["kiosk"];
  agent: BetDetailResponse["agent"];
}

export function BetTicket({ bet, selections, user, kiosk, agent }: Props) {
  const sc = STATUS_COLORS[bet.status] ?? STATUS_COLORS.open;
  const payout = (bet.actual_win != null && bet.actual_win > 0) ? bet.actual_win : bet.potential_win;

  return (
    <div style={{
      background: "var(--admin-surface)",
      border: `1px solid var(--admin-border)`,
      borderRadius: 8,
      overflow: "hidden",
      maxWidth: 540,
    }}>
      {/* Header — status stripe */}
      <div style={{
        background: sc.bg,
        color: sc.color,
        padding: "10px 16px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: "0.08em" }}>{sc.label}</div>
        <div style={{ fontFamily: "monospace", fontSize: 12 }}>#{bet.code.toUpperCase()}</div>
      </div>

      {/* Player / Kiosk info */}
      <div style={{
        borderBottom: "1px dashed var(--admin-border)",
        padding: "8px 16px",
        display: "flex",
        gap: 20,
        fontSize: 11,
        color: "var(--admin-text4)",
      }}>
        <span>👤 {user.username ?? "Anonimo"}</span>
        {kiosk && <span>🖥 {kiosk.code}</span>}
        {agent && <span>🏢 {agent.code}</span>}
        <span style={{ marginLeft: "auto" }}>{fmtDate(bet.created_at)}</span>
      </div>

      {/* Selections */}
      <div style={{ padding: "0 16px" }}>
        {selections.map((s, i) => (
          <div key={s.id} style={{
            padding: "10px 0",
            borderBottom: i < selections.length - 1 ? "1px dashed var(--admin-border)" : "none",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--admin-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {SOURCE_ICON[s.source] ?? "🎯"} {s.event.name}
                </div>
                {s.event.league && (
                  <div style={{ fontSize: 10, color: "var(--admin-text4)", marginTop: 1 }}>{s.event.league}</div>
                )}
                <div style={{ fontSize: 11, color: "var(--admin-text4)", marginTop: 4 }}>
                  {s.market.type}{s.market.label ? ` (${s.market.label})` : ""}
                </div>
                <div style={{ fontSize: 12, marginTop: 2, color: "var(--admin-text)" }}>
                  → <strong>{s.outcome.name}</strong>
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--admin-text)" }}>
                  {s.odds_at_placement.toFixed(2)}
                </div>
                {s.result && (
                  <div style={{ fontSize: 11, marginTop: 2 }}>
                    {RESULT_ICON[s.result] ?? ""} {s.result.toUpperCase()}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer — stake / quota / payout */}
      <div style={{
        borderTop: "2px solid var(--admin-border)",
        padding: "10px 16px",
        background: "var(--admin-bg)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--admin-text4)", marginBottom: 4 }}>
          <span>Tipo</span><span style={{ color: "var(--admin-text)", fontWeight: 600, textTransform: "uppercase" }}>{bet.bet_type}{bet.is_live ? " · LIVE" : ""}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--admin-text4)", marginBottom: 4 }}>
          <span>Importo giocato</span><span style={{ color: "var(--admin-text)", fontWeight: 600 }}>{fmtEur(bet.stake)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--admin-text4)", marginBottom: 4 }}>
          <span>Quota totale</span><span style={{ color: "var(--admin-text)", fontWeight: 600 }}>{bet.total_odds?.toFixed(2) ?? "—"}</span>
        </div>
        <div style={{
          display: "flex", justifyContent: "space-between", fontSize: 14,
          marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--admin-border)",
        }}>
          <span style={{ color: "var(--admin-text4)" }}>
            {bet.actual_win != null ? "Vincita" : "Vincita potenziale"}
          </span>
          <span style={{ fontWeight: 700, color: bet.actual_win && bet.actual_win > 0 ? "#10b981" : "var(--admin-text)" }}>
            {fmtEur(payout)}
          </span>
        </div>
        {bet.settled_at && (
          <div style={{ fontSize: 10, color: "var(--admin-text4)", marginTop: 6, textAlign: "right" }}>
            Liquidata: {fmtDate(bet.settled_at)}
          </div>
        )}
      </div>
    </div>
  );
}
