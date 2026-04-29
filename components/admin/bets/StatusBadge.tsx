// components/admin/bets/StatusBadge.tsx
import type { BetStatus } from "@/lib/types/bets-admin";

const COLOR: Record<BetStatus, { bg: string; fg: string; label: string }> = {
  open:               { bg: "#1e3a8a30", fg: "#60a5fa", label: "APERTA" },
  pending_acceptance: { bg: "#92400e30", fg: "#f59e0b", label: "IN ATTESA" },
  won:                { bg: "#065f4630", fg: "#10b981", label: "VINTA" },
  lost:               { bg: "#7f1d1d30", fg: "#ef4444", label: "PERSA" },
  void:               { bg: "#37415130", fg: "#9ca3af", label: "VOID" },
  rejected:           { bg: "#7f1d1d30", fg: "#ef4444", label: "RIFIUTATA" },
  cashout:            { bg: "#5b21b630", fg: "#a78bfa", label: "CASHOUT" },
};

export function StatusBadge({ status }: { status: BetStatus }) {
  const c = COLOR[status] ?? { bg: "#37415130", fg: "#9ca3af", label: status };
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 4,
      background: c.bg,
      color: c.fg,
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: "0.05em",
    }}>{c.label}</span>
  );
}
