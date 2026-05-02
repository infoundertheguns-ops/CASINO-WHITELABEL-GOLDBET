"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { PlayerHeader } from "@/components/admin/risk/player/player-header";
import { BettingHistoryChart } from "@/components/admin/risk/player/betting-history-chart";
import { RiskScoreTrend } from "@/components/admin/risk/player/risk-score-trend";
import { PlayerFlagsList } from "@/components/admin/risk/player/player-flags-list";
import { PlayerQuickActions } from "@/components/admin/risk/player/player-quick-actions";

export default function PlayerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const playerId = params.id as string;

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/risk?tab=player&player_id=${playerId}`);
      const d = await res.json();
      setData(d);
    } catch {}
    setLoading(false);
  }, [playerId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="text-sm" style={{ color: "var(--admin-text4)" }}>Caricamento...</div></div>;
  }

  if (!data?.user) {
    return <div className="text-center py-12" style={{ color: "var(--admin-text4)" }}>Giocatore non trovato</div>;
  }

  return (
    <div className="space-y-4">
      <button onClick={() => router.push("/admin/risk")} className="text-xs text-brand hover:underline">
        &larr; Torna a Risk Management
      </button>

      <PlayerHeader user={data.user} profile={data.profile} limits={data.limits} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <BettingHistoryChart data={data.bet_history_chart || []} />
          <PlayerFlagsList flags={data.flags || []} onReload={load} />
        </div>
        <div className="space-y-4">
          <RiskScoreTrend bets={data.bets || []} />
          <PlayerQuickActions
            userId={playerId}
            isBlocked={data.user?.is_blocked}
            kycStatus={data.user?.kyc_status}
            onAction={load}
          />
        </div>
      </div>

      {/* Recent bets table */}
      <div className="rounded-xl overflow-hidden" style={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)" }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--admin-border)" }}>
          <h3 className="text-xs font-bold" style={{ color: "var(--admin-text)" }}>Scommesse Recenti</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ color: "var(--admin-text4)", borderBottom: "1px solid var(--admin-border)" }}>
                <th className="text-left px-4 py-2">Data</th>
                <th className="text-left px-4 py-2">Tipo</th>
                <th className="text-left px-4 py-2">Selezioni</th>
                <th className="text-right px-4 py-2">Stake</th>
                <th className="text-right px-4 py-2">Quote</th>
                <th className="text-right px-4 py-2">Risk</th>
                <th className="text-center px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {(data.bets || []).slice(0, 30).map((b: any) => (
                <tr key={b.id} style={{ borderBottom: "1px solid var(--admin-border)" }} className="hover:opacity-80">
                  <td className="px-4 py-2 whitespace-nowrap" style={{ color: "var(--admin-text4)" }}>
                    {new Date(b.created_at).toLocaleDateString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-4 py-2" style={{ color: "var(--admin-text3)" }}>{b.bet_type}</td>
                  <td className="px-4 py-2 max-w-xs truncate" style={{ color: "var(--admin-text)" }}>
                    {(b.bet_selections || []).map((s: any) =>
                      `${s.events?.home_team || ""} vs ${s.events?.away_team || ""}`
                    ).join(", ")}
                  </td>
                  <td className="px-4 py-2 text-right font-mono" style={{ color: "var(--admin-text)" }}>${b.stake}</td>
                  <td className="px-4 py-2 text-right font-mono" style={{ color: "var(--admin-text3)" }}>{b.total_odds?.toFixed(2)}</td>
                  <td className="px-4 py-2 text-right">
                    {b.risk_score != null && (
                      <span className={cn("font-mono",
                        b.risk_score > 75 ? "text-red-400" : b.risk_score > 50 ? "text-orange-400" : b.risk_score > 25 ? "text-yellow-400" : "text-gray-500"
                      )}>{b.risk_score}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-center">
                    {/* Plan D: half-stake variants from Asian Handicap quarter / Goal Line .25/.75 markets */}
                    <span className={cn("text-[8px] font-bold px-1.5 py-0.5 rounded",
                      b.status === "won" ? "bg-emerald-500/20 text-emerald-400" :
                      b.status === "lost" ? "bg-red-500/20 text-red-400" :
                      b.status === "half_won" ? "bg-amber-500/20 text-amber-400" :
                      b.status === "half_lost" ? "bg-amber-500/20 text-amber-400" :
                      b.status === "open" ? "bg-blue-500/20 text-blue-400" :
                      b.status === "rejected" ? "bg-gray-500/20 text-gray-400" :
                      "bg-yellow-500/20 text-yellow-400"
                    )}>{b.status === "half_won" ? "MEZZA VINTA" : b.status === "half_lost" ? "MEZZA PERSA" : b.status?.toUpperCase()}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
