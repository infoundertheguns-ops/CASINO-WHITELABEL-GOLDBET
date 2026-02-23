"use client";

import { cn } from "@/lib/utils";

interface RiskKPIProps {
  openAlerts: number;
  criticalAlerts: number;
  avgScore: number;
  flaggedUsers: number;
  blockedToday: number;
}

export function RiskKPIs({ openAlerts, criticalAlerts, avgScore, flaggedUsers, blockedToday }: RiskKPIProps) {
  const kpis = [
    { label: "ALERT APERTI", value: openAlerts, color: "text-red-400" },
    { label: "CRITICAL", value: criticalAlerts, color: "text-red-500" },
    { label: "SCORE MEDIO", value: avgScore, color: "text-yellow-400" },
    { label: "UTENTI FLAGGATI", value: flaggedUsers, color: "text-orange-400" },
    { label: "BLOCCATI OGGI", value: blockedToday, color: "text-red-300" },
  ];

  return (
    <div className="grid grid-cols-5 gap-3 mb-6">
      {kpis.map((k, i) => (
        <div key={i} className="rounded-xl p-4" style={{ background: "var(--admin-card)", borderColor: "var(--admin-border)", borderWidth: "1px" }}>
          <div className="text-[10px] font-semibold" style={{ color: "var(--admin-text4)" }}>{k.label}</div>
          <div className={cn("text-2xl font-black font-mono mt-1", k.color)}>{k.value}</div>
        </div>
      ))}
    </div>
  );
}
