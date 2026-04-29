"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface DayStat {
  date: string;
  bet_count: number;
  total_stake: number;
}

export function BetVolumeChart({ data }: { data: DayStat[] }) {
  const formatted = data.map(d => ({
    ...d,
    label: new Date(d.date).toLocaleDateString("it-IT", { day: "2-digit", month: "short" }),
  }));

  if (formatted.length === 0) {
    return (
      <div className="rounded-xl p-4" style={{ background: "var(--admin-card)", borderColor: "var(--admin-border)", borderWidth: "1px" }}>
        <h3 className="text-sm font-bold mb-4" style={{ color: "var(--admin-text)" }}>Volume Scommesse</h3>
        <div className="h-[250px] flex items-center justify-center text-sm" style={{ color: "var(--admin-text4)" }}>Nessun dato</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl p-4" style={{ background: "var(--admin-card)", borderColor: "var(--admin-border)", borderWidth: "1px" }}>
      <h3 className="text-sm font-bold mb-4" style={{ color: "var(--admin-text)" }}>Volume Scommesse</h3>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={formatted}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="label" tick={{ fill: "#6b7280", fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis yAxisId="left" tick={{ fill: "#6b7280", fontSize: 10 }} />
          <YAxis yAxisId="right" orientation="right" tick={{ fill: "#6b7280", fontSize: 10 }} tickFormatter={v => `€${v}`} />
          <Tooltip
            contentStyle={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)", borderRadius: 8, fontSize: 12 }}
            itemStyle={{ color: "#fff" }}
          />
          <Bar yAxisId="left" dataKey="bet_count" fill="#f0b429" name="N. Scommesse" radius={[3, 3, 0, 0]} opacity={0.8} />
          <Bar yAxisId="right" dataKey="total_stake" fill="#8b5cf6" name="Volume ($)" radius={[3, 3, 0, 0]} opacity={0.6} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
