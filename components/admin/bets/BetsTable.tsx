// components/admin/bets/BetsTable.tsx
"use client";
import { useRouter } from "next/navigation";
import type { BetListItem } from "@/lib/types/bets-admin";
import { StatusBadge } from "./StatusBadge";
import { RiskBadge } from "./RiskBadge";

interface Props { bets: BetListItem[]; }

const fmtEur = (n: number | null) => n == null ? "—" : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);
const fmtDate = (s: string) => new Date(s).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });

export function BetsTable({ bets }: Props) {
  const router = useRouter();

  if (bets.length === 0) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--admin-text4)" }}>Nessun bet trovato</div>;
  }

  const cellStyle: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid var(--admin-border)", fontSize: 12 };
  const headStyle: React.CSSProperties = { ...cellStyle, fontWeight: 600, color: "var(--admin-text4)", textAlign: "left", textTransform: "uppercase", fontSize: 10, letterSpacing: "0.05em" };

  return (
    <div style={{ overflowX: "auto", border: "1px solid var(--admin-border)", borderRadius: 6 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", color: "var(--admin-text)" }}>
        <thead>
          <tr>
            {["ID","Data","Player","Kiosk","Tipo","Stake","Quota","Payout","Status","Risk"].map(h =>
              <th key={h} style={headStyle}>{h}</th>
            )}
          </tr>
        </thead>
        <tbody>
          {bets.map((b) => (
            <tr
              key={b.id}
              onClick={() => router.push(`/admin/bets/${b.id}`)}
              style={{ cursor: "pointer" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--admin-surface-hover, #ffffff08)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "")}
            >
              <td style={{ ...cellStyle, color: "#60a5fa", fontFamily: "monospace" }}>{b.code}</td>
              <td style={cellStyle}>{fmtDate(b.created_at)}</td>
              <td style={cellStyle}>{b.user.username ?? <span style={{ color: "var(--admin-text4)" }}>—</span>}</td>
              <td style={cellStyle}>{b.kiosk?.code ?? "—"}</td>
              <td style={cellStyle}>{b.bet_type}</td>
              <td style={cellStyle}>{fmtEur(b.stake)}</td>
              <td style={cellStyle}>{b.total_odds?.toFixed(2) ?? "—"}</td>
              <td style={cellStyle}>{fmtEur(b.actual_win ?? b.potential_win)}</td>
              <td style={cellStyle}><StatusBadge status={b.status} /></td>
              <td style={cellStyle}><RiskBadge score={b.risk_score} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
