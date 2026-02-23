"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface SportRiskData {
  sport: string;
  count: number;
  avg_score: number;
}

export function SportRiskChart({ data }: { data: SportRiskData[] }) {
  if (data.length === 0) {
    return (
      <div className="rounded-xl p-4" style={{ background: "var(--admin-card)", borderColor: "var(--admin-border)", borderWidth: "1px" }}>
        <h3 className="text-sm font-bold mb-4" style={{ color: "var(--admin-text)" }}>Rischio per Sport</h3>
        <div className="h-[200px] flex items-center justify-center text-sm" style={{ color: "var(--admin-text4)" }}>Nessun dato</div>
      </div>
    );
  }

  const getColor = (score: number) =>
    score > 75 ? "#ef4444" :
    score > 50 ? "#f97316" :
    score > 25 ? "#eab308" :
    "#22c55e";

  return (
    <div className="rounded-xl p-4" style={{ background: "var(--admin-card)", borderColor: "var(--admin-border)", borderWidth: "1px" }}>
      <h3 className="text-sm font-bold mb-4" style={{ color: "var(--admin-text)" }}>Rischio per Sport</h3>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} layout="vertical" margin={{ left: 60 }}>
          <XAxis type="number" domain={[0, 100]} tick={{ fill: "#6b7280", fontSize: 10 }} />
          <YAxis dataKey="sport" type="category" tick={{ fill: "#d1d5db", fontSize: 11 }} width={55} />
          <Tooltip
            contentStyle={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)", borderRadius: 8, fontSize: 12 }}
            itemStyle={{ color: "#fff" }}
            formatter={(val: number) => [`Score: ${val}`, "Avg Risk"]}
          />
          <Bar dataKey="avg_score" radius={[0, 4, 4, 0]} barSize={20}>
            {data.map((entry, i) => (
              <Cell key={i} fill={getColor(entry.avg_score)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
