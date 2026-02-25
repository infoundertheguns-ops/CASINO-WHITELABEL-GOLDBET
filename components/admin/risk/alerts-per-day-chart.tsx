"use client";

interface AlertsPerDayChartProps {
  data: Record<string, number>; // { "2026-02-20": 5, "2026-02-21": 3 }
}

export function AlertsPerDayChart({ data }: AlertsPerDayChartProps) {
  // Last 14 days
  const days: { date: string; label: string; count: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().substring(0, 10);
    days.push({
      date: key,
      label: d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" }),
      count: data[key] || 0,
    });
  }

  const maxCount = Math.max(...days.map(d => d.count), 1);

  return (
    <div className="rounded-xl p-4" style={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)" }}>
      <h3 className="text-xs font-bold mb-3" style={{ color: "var(--admin-text)" }}>Alert per Giorno (14gg)</h3>

      <div className="flex items-end gap-1 h-28">
        {days.map((d, i) => {
          const h = (d.count / maxCount) * 100;
          return (
            <div key={i} className="flex-1 flex flex-col items-center group relative">
              {/* Tooltip */}
              <div className="absolute bottom-full mb-2 hidden group-hover:block z-10 px-2 py-1 rounded text-[9px] whitespace-nowrap"
                style={{ background: "var(--admin-bg)", border: "1px solid var(--admin-border)", color: "var(--admin-text)" }}>
                {d.label}: {d.count} alert
              </div>
              {/* Bar */}
              <div
                className="w-full rounded-t transition-all"
                style={{
                  height: `${h}%`,
                  minHeight: d.count > 0 ? "3px" : "1px",
                  background: d.count > 5 ? "rgba(239,68,68,0.5)" : d.count > 2 ? "rgba(245,158,11,0.4)" : "rgba(99,102,241,0.3)",
                }}
              />
              {/* Date label (every other) */}
              {i % 2 === 0 && (
                <span className="text-[7px] mt-1 whitespace-nowrap" style={{ color: "var(--admin-text4)" }}>
                  {d.label}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-between mt-2 text-[9px]" style={{ color: "var(--admin-text4)" }}>
        <span>Tot: {days.reduce((s, d) => s + d.count, 0)}</span>
        <span>Media: {(days.reduce((s, d) => s + d.count, 0) / 14).toFixed(1)}/giorno</span>
      </div>
    </div>
  );
}
