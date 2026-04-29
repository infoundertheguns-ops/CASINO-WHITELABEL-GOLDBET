"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";

interface SportData {
  name: string;
  count: number;
  stake: number;
}

const COLORS = ["#f0b429", "#3b82f6", "#22c55e", "#ef4444", "#8b5cf6", "#f97316", "#ec4899"];

export function SportBreakdownChart({ data }: { data: SportData[] }) {
  if (data.length === 0) {
    return (
      <div className="rounded-xl p-4" style={{ background: "var(--admin-card)", borderColor: "var(--admin-border)", borderWidth: "1px" }}>
        <h3 className="text-sm font-bold mb-4" style={{ color: "var(--admin-text)" }}>Breakdown per Sport</h3>
        <div className="h-[250px] flex items-center justify-center text-sm" style={{ color: "var(--admin-text4)" }}>Nessun dato</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl p-4" style={{ background: "var(--admin-card)", borderColor: "var(--admin-border)", borderWidth: "1px" }}>
      <h3 className="text-sm font-bold mb-4" style={{ color: "var(--admin-text)" }}>Breakdown per Sport</h3>
      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={3}
            dataKey="count"
            nameKey="name"
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)", borderRadius: 8, fontSize: 12 }}
            itemStyle={{ color: "#fff" }}
            formatter={(val: number, name: string, props: any) => [
              `${val} scommesse (€${props.payload.stake?.toFixed(0) || 0})`,
              name,
            ]}
          />
          <Legend
            wrapperStyle={{ fontSize: 10 }}
            formatter={(value) => <span style={{ color: "#9ca3af" }}>{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
