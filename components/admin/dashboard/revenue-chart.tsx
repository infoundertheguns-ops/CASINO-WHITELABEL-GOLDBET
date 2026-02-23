"use client";

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface DayStat {
  date: string;
  ggr: number;
  deposit_volume: number;
  withdrawal_volume: number;
}

export function RevenueChart({ data }: { data: DayStat[] }) {
  const formatted = data.map(d => ({
    ...d,
    label: new Date(d.date).toLocaleDateString("it-IT", { day: "2-digit", month: "short" }),
  }));

  if (formatted.length === 0) {
    return (
      <div className="bg-[#12111a] rounded-xl border border-gray-800 p-4">
        <h3 className="text-sm font-bold text-white mb-4">Revenue Trend</h3>
        <div className="h-[250px] flex items-center justify-center text-gray-500 text-sm">Nessun dato</div>
      </div>
    );
  }

  return (
    <div className="bg-[#12111a] rounded-xl border border-gray-800 p-4">
      <h3 className="text-sm font-bold text-white mb-4">Revenue Trend</h3>
      <ResponsiveContainer width="100%" height={250}>
        <AreaChart data={formatted}>
          <defs>
            <linearGradient id="ggrGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="depGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="label" tick={{ fill: "#6b7280", fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} tickFormatter={v => `$${v}`} />
          <Tooltip
            contentStyle={{ background: "#1a1830", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }}
            itemStyle={{ color: "#fff" }}
            formatter={(val: number) => [`$${val.toFixed(2)}`]}
          />
          <Area type="monotone" dataKey="ggr" stroke="#22c55e" fill="url(#ggrGrad)" name="GGR" strokeWidth={2} />
          <Area type="monotone" dataKey="deposit_volume" stroke="#3b82f6" fill="url(#depGrad)" name="Depositi" strokeWidth={1.5} />
          <Area type="monotone" dataKey="withdrawal_volume" stroke="#ef4444" fill="none" name="Prelievi" strokeWidth={1} strokeDasharray="4 4" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
