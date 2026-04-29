// components/admin/bets/BetsKpiCards.tsx
import type { BetsListAggregates } from "@/lib/types/bets-admin";

interface Props { agg: BetsListAggregates; total: number; }

const fmtEur = (n: number) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

export function BetsKpiCards({ agg, total }: Props) {
  const cards = [
    { icon: "🎯", label: "Bets", value: total.toLocaleString("it-IT"), tone: "#3b82f6" },
    { icon: "💰", label: "Stake totale", value: fmtEur(agg.total_stake), tone: "#10b981" },
    { icon: "📈", label: "Payout totale", value: fmtEur(agg.total_payout), tone: "#f59e0b" },
    { icon: "📊", label: "GGR", value: `${agg.ggr_pct.toFixed(1)}%`, tone: "#a78bfa" },
    { icon: "🔵", label: "Aperte", value: agg.open_count.toLocaleString("it-IT"), tone: "#60a5fa" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
      {cards.map((c) => (
        <div key={c.label} style={{
          padding: 12,
          background: "var(--admin-surface)",
          border: "1px solid var(--admin-border)",
          borderLeft: `3px solid ${c.tone}`,
          borderRadius: 6,
        }}>
          <div style={{ fontSize: 11, color: "var(--admin-text4)", marginBottom: 4 }}>
            {c.icon} {c.label}
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--admin-text)" }}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}
