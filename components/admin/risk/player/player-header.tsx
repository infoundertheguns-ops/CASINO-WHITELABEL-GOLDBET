"use client";

import { cn } from "@/lib/utils";

interface PlayerHeaderProps {
  user: any;
  profile: any;
  limits: any[];
}

export function PlayerHeader({ user, profile, limits }: PlayerHeaderProps) {
  const riskScore = profile?.risk_score || 0;
  const riskColor = riskScore > 75 ? "#ef4444" : riskScore > 50 ? "#f59e0b" : riskScore > 25 ? "#3b82f6" : "#22c55e";

  return (
    <div className="rounded-xl p-5" style={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)" }}>
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-black" style={{ color: "var(--admin-text)" }}>
              {user.username || user.email}
            </h2>
            <span className={cn("px-2 py-0.5 rounded text-[9px] font-bold",
              user.is_blocked ? "bg-red-500/20 text-red-400" :
              profile?.classification === "sharp" ? "bg-orange-500/20 text-orange-400" :
              profile?.classification === "syndicate" ? "bg-red-500/20 text-red-400" :
              profile?.classification === "vip" ? "bg-purple-500/20 text-purple-400" :
              "bg-green-500/20 text-green-400"
            )}>
              {user.is_blocked ? "BLOCCATO" : (profile?.classification || user.user_class || "recreational").toUpperCase()}
            </span>
            <span className={cn("px-2 py-0.5 rounded text-[9px] font-bold",
              user.kyc_status === "verified" ? "bg-emerald-500/20 text-emerald-400" :
              user.kyc_status === "pending" ? "bg-yellow-500/20 text-yellow-400" :
              "bg-gray-500/20 text-gray-400"
            )}>
              KYC: {user.kyc_status?.toUpperCase() || "N/A"}
            </span>
          </div>
          <p className="text-[10px] mt-1" style={{ color: "var(--admin-text4)" }}>
            {user.email} | Registrato: {new Date(user.created_at).toLocaleDateString("it-IT")} | Paese: {user.country || "N/A"}
          </p>
        </div>

        {/* Risk Score Meter */}
        <div className="text-center">
          <div className="relative w-20 h-20">
            <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
              <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3" />
              <circle cx="18" cy="18" r="15" fill="none" stroke={riskColor} strokeWidth="3"
                strokeDasharray={`${riskScore * 0.942} 94.2`} strokeLinecap="round" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-lg font-black" style={{ color: riskColor }}>{riskScore}</span>
            </div>
          </div>
          <span className="text-[8px] font-bold" style={{ color: riskColor }}>RISK SCORE</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-6 gap-3 mt-4">
        {[
          { label: "Bet Totali", value: profile?.total_bets || 0 },
          { label: "Stake Tot.", value: `$${(profile?.total_stake || 0).toLocaleString()}` },
          { label: "Win Rate", value: `${((profile?.win_rate || 0) * 100).toFixed(1)}%` },
          { label: "Avg Stake", value: `$${(profile?.avg_stake || 0).toFixed(2)}` },
          { label: "GGR", value: `$${(profile?.lifetime_ggr || 0).toFixed(2)}`, color: (profile?.lifetime_ggr || 0) >= 0 ? "#22c55e" : "#ef4444" },
          { label: "Flags", value: profile?.flags_count || 0 },
        ].map((s, i) => (
          <div key={i} className="text-center">
            <div className="text-[8px] uppercase font-bold" style={{ color: "var(--admin-text4)" }}>{s.label}</div>
            <div className="text-sm font-bold mt-0.5" style={{ color: (s as any).color || "var(--admin-text)" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Active limits */}
      {limits && limits.length > 0 && (
        <div className="mt-3 flex gap-2 flex-wrap">
          {limits.map((l: any) => (
            <span key={l.id} className="text-[8px] px-2 py-0.5 rounded bg-orange-500/20 text-orange-400 font-bold">
              {l.limit_type}: ${l.limit_value} ({l.set_by})
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
