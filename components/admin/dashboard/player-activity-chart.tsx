"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface DayStat {
  date: string;
  new_users: number;
  active_users: number;
}

export function PlayerActivityChart({ data }: { data: DayStat[] }) {
  const formatted = data.map(d => ({
    ...d,
    label: new Date(d.date).toLocaleDateString("it-IT", { day: "2-digit", month: "short" }),
  }));

  if (formatted.length === 0) {
    return (
      <div className="bg-[#12111a] rounded-xl border border-gray-800 p-4">
        <h3 className="text-sm font-bold text-white mb-4">Attivita Giocatori</h3>
        <div className="h-[250px] flex items-center justify-center text-gray-500 text-sm">Nessun dato</div>
      </div>
    );
  }

  return (
    <div className="bg-[#12111a] rounded-xl border border-gray-800 p-4">
      <h3 className="text-sm font-bold text-white mb-4">Attivita Giocatori</h3>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={formatted}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="label" tick={{ fill: "#6b7280", fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} />
          <Tooltip
            contentStyle={{ background: "#1a1830", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }}
            itemStyle={{ color: "#fff" }}
          />
          <Line type="monotone" dataKey="new_users" stroke="#3b82f6" name="Nuove Registrazioni" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="active_users" stroke="#f0b429" name="Utenti Attivi" strokeWidth={2} dot={false} strokeDasharray="5 5" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
