"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

interface Distribution {
  low: number;
  medium: number;
  high: number;
  critical: number;
}

const COLORS = {
  low: "#22c55e",
  medium: "#eab308",
  high: "#f97316",
  critical: "#ef4444",
};

export function RiskScoreChart({ distribution }: { distribution: Distribution }) {
  const data = [
    { name: "Low (0-25)", value: distribution.low, color: COLORS.low },
    { name: "Medium (26-50)", value: distribution.medium, color: COLORS.medium },
    { name: "High (51-75)", value: distribution.high, color: COLORS.high },
    { name: "Critical (76-100)", value: distribution.critical, color: COLORS.critical },
  ].filter(d => d.value > 0);

  if (data.length === 0) {
    return (
      <div className="rounded-xl p-4" style={{ background: "var(--admin-card)", borderColor: "var(--admin-border)", borderWidth: "1px" }}>
        <h3 className="text-sm font-bold mb-4" style={{ color: "var(--admin-text)" }}>Distribuzione Risk Score</h3>
        <div className="h-[200px] flex items-center justify-center text-sm" style={{ color: "var(--admin-text4)" }}>Nessun dato</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl p-4" style={{ background: "var(--admin-card)", borderColor: "var(--admin-border)", borderWidth: "1px" }}>
      <h3 className="text-sm font-bold mb-4" style={{ color: "var(--admin-text)" }}>Distribuzione Risk Score</h3>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={3}
            dataKey="value"
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)", borderRadius: 8, fontSize: 12 }}
            itemStyle={{ color: "#fff" }}
          />
          <Legend
            wrapperStyle={{ fontSize: 10, color: "#9ca3af" }}
            formatter={(value) => <span style={{ color: "#9ca3af" }}>{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
