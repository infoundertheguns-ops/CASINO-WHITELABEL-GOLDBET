"use client";

interface BettingHistoryChartProps {
  data: { date: string; count: number; stake: number; won: number }[];
}

export function BettingHistoryChart({ data }: BettingHistoryChartProps) {
  if (data.length === 0) {
    return (
      <div className="rounded-xl p-4" style={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)" }}>
        <h3 className="text-xs font-bold mb-2" style={{ color: "var(--admin-text)" }}>Attivita' Scommesse</h3>
        <p className="text-[10px]" style={{ color: "var(--admin-text4)" }}>Nessun dato disponibile</p>
      </div>
    );
  }

  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const maxStake = Math.max(...sorted.map(d => d.stake), 1);
  const maxCount = Math.max(...sorted.map(d => d.count), 1);

  return (
    <div className="rounded-xl p-4" style={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)" }}>
      <h3 className="text-xs font-bold mb-3" style={{ color: "var(--admin-text)" }}>Attivita' Scommesse (ultimi giorni)</h3>

      <div className="flex items-end gap-1 h-32">
        {sorted.map((d, i) => {
          const stakeH = (d.stake / maxStake) * 100;
          const countH = (d.count / maxCount) * 100;
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group relative">
              {/* Tooltip */}
              <div className="absolute bottom-full mb-2 hidden group-hover:block z-10 px-2 py-1 rounded text-[9px] whitespace-nowrap"
                style={{ background: "var(--admin-bg)", border: "1px solid var(--admin-border)", color: "var(--admin-text)" }}>
                {d.date}: {d.count} bet, ${d.stake.toFixed(0)} stake, ${d.won.toFixed(0)} vinto
              </div>
              {/* Stake bar */}
              <div className="w-full rounded-t" style={{ height: `${stakeH}%`, background: "rgba(99,102,241,0.4)", minHeight: d.stake > 0 ? "2px" : 0 }} />
              {/* Count dots */}
              <div className="w-1.5 h-1.5 rounded-full" style={{
                background: "#f59e0b",
                marginTop: `-${countH * 0.3}%`,
              }} />
              {/* Date label */}
              {i % Math.max(1, Math.floor(sorted.length / 7)) === 0 && (
                <span className="text-[7px] mt-1" style={{ color: "var(--admin-text4)" }}>
                  {d.date.substring(5)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex gap-4 mt-2 justify-center">
        <span className="flex items-center gap-1 text-[8px]" style={{ color: "var(--admin-text4)" }}>
          <span className="w-2 h-2 rounded" style={{ background: "rgba(99,102,241,0.4)" }} /> Stake
        </span>
        <span className="flex items-center gap-1 text-[8px]" style={{ color: "var(--admin-text4)" }}>
          <span className="w-2 h-2 rounded-full" style={{ background: "#f59e0b" }} /> N. Bet
        </span>
      </div>
    </div>
  );
}
