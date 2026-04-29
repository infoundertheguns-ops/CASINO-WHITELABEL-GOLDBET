// components/admin/bets/RiskBadge.tsx
export function RiskBadge({ score }: { score: number }) {
  const s = Math.max(0, Math.min(100, score));
  const color = s <= 30 ? "#10b981" : s <= 60 ? "#f59e0b" : "#ef4444";
  return (
    <span style={{
      display: "inline-block",
      minWidth: 36,
      padding: "2px 6px",
      borderRadius: 4,
      background: `${color}30`,
      color,
      fontSize: 11,
      fontWeight: 700,
      textAlign: "center",
    }}>{s}</span>
  );
}
