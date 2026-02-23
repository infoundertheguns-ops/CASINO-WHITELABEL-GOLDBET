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
      <div className="bg-[#12111a] rounded-xl border border-gray-800 p-4">
        <h3 className="text-sm font-bold text-white mb-4">Volume Scommesse</h3>
        <div className="h-[250px] flex items-center justify-center text-gray-500 text-sm">Nessun dato</div>
      </div>
    );
  }

  return (
    <div className="bg-[#12111a] rounded-xl border border-gray-800 p-4">
      <h3 className="text-sm font-bold text-white mb-4">Volume Scommesse</h3>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={formatted}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="label" tick={{ fill: "#6b7280", fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis yAxisId="left" tick={{ fill: "#6b7280", fontSize: 10 }} />
          <YAxis yAxisId="right" orientation="right" tick={{ fill: "#6b7280", fontSize: 10 }} tickFormatter={v => `$${v}`} />
          <Tooltip
            contentStyle={{ background: "#1a1830", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }}
            itemStyle={{ color: "#fff" }}
          />
          <Bar yAxisId="left" dataKey="bet_count" fill="#f0b429" name="N. Scommesse" radius={[3, 3, 0, 0]} opacity={0.8} />
          <Bar yAxisId="right" dataKey="total_stake" fill="#8b5cf6" name="Volume ($)" radius={[3, 3, 0, 0]} opacity={0.6} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
