"use client";

interface RiskScoreTrendProps {
  bets: any[];
}

export function RiskScoreTrend({ bets }: RiskScoreTrendProps) {
  // Extract bets that have risk scores
  const scored = bets
    .filter(b => b.risk_score != null && b.risk_score > 0)
    .slice(0, 20)
    .reverse();

  if (scored.length === 0) {
    return (
      <div className="rounded-xl p-4" style={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)" }}>
        <h3 className="text-xs font-bold mb-2" style={{ color: "var(--admin-text)" }}>Trend Risk Score</h3>
        <p className="text-[10px]" style={{ color: "var(--admin-text4)" }}>Nessun risk score registrato</p>
      </div>
    );
  }

  const maxScore = 100;

  return (
    <div className="rounded-xl p-4" style={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)" }}>
      <h3 className="text-xs font-bold mb-3" style={{ color: "var(--admin-text)" }}>Trend Risk Score</h3>

      <div className="relative h-24">
        {/* Grid lines */}
        {[25, 50, 75].map(line => (
          <div key={line} className="absolute w-full border-b border-dashed border-gray-800/50"
            style={{ bottom: `${line}%` }}>
            <span className="text-[7px] absolute -left-0.5 -top-2" style={{ color: "var(--admin-text4)" }}>{line}</span>
          </div>
        ))}

        {/* Score line */}
        <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${scored.length * 20} 100`} preserveAspectRatio="none">
          <polyline
            points={scored.map((b, i) => `${i * 20 + 10},${100 - b.risk_score}`).join(" ")}
            fill="none"
            stroke="url(#riskGradient)"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <defs>
            <linearGradient id="riskGradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#22c55e" />
              <stop offset="50%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#ef4444" />
            </linearGradient>
          </defs>
          {/* Dots */}
          {scored.map((b, i) => (
            <circle key={i} cx={i * 20 + 10} cy={100 - b.risk_score} r="3"
              fill={b.risk_score > 75 ? "#ef4444" : b.risk_score > 50 ? "#f59e0b" : b.risk_score > 25 ? "#3b82f6" : "#22c55e"} />
          ))}
        </svg>
      </div>

      <div className="flex justify-between mt-1 text-[7px]" style={{ color: "var(--admin-text4)" }}>
        <span>Piu' vecchio</span>
        <span>Piu' recente</span>
      </div>
    </div>
  );
}
