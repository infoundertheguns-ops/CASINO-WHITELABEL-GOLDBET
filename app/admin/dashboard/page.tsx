"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { RevenueChart } from "@/components/admin/dashboard/revenue-chart";
import { BetVolumeChart } from "@/components/admin/dashboard/bet-volume-chart";
import { PlayerActivityChart } from "@/components/admin/dashboard/player-activity-chart";
import { SportBreakdownChart } from "@/components/admin/dashboard/sport-breakdown-chart";

type Range = "7d" | "30d" | "90d";

interface KPICard {
  label: string;
  value: string;
  trend?: number;
  color: string;
}

export default function AdminDashboard() {
  const [range, setRange] = useState<Range>("30d");
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<KPICard[]>([]);
  const [stats, setStats] = useState<any[]>([]);
  const [recentBets, setRecentBets] = useState<any[]>([]);
  const [recentUsers, setRecentUsers] = useState<any[]>([]);
  const [sportBreakdown, setSportBreakdown] = useState<any[]>([]);
  const supabase = createClient();

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch aggregated stats
      const statsRes = await fetch(`/api/admin/stats?range=${range}`);
      const statsData = await statsRes.json();

      setStats(statsData.stats || []);

      // KPIs
      const k = statsData.kpis || {};
      const pk = statsData.prev_kpis || {};
      const trend = (cur: number, prev: number) => prev > 0 ? ((cur - prev) / prev) * 100 : 0;

      // Count total users and open alerts
      const [
        { data: allUsers },
        { data: openAlerts },
        { data: allWallets },
      ] = await Promise.all([
        supabase.from("users").select("id", { count: "exact" }),
        supabase.from("risk_flags").select("id", { count: "exact" }).eq("status", "open"),
        supabase.from("wallets").select("balance"),
      ]);

      const totalUsers = allUsers?.length || 0;
      const totalBalance = (allWallets || []).reduce((s, w) => s + (w.balance || 0), 0);

      setKpis([
        { label: "UTENTI", value: String(totalUsers), color: "text-blue-400" },
        { label: "SCOMMESSE", value: String(k.total_bets || 0), trend: trend(k.total_bets, pk.total_bets), color: "text-brand" },
        { label: "VOLUME", value: `$${(k.total_stake || 0).toFixed(0)}`, trend: trend(k.total_stake, pk.total_stake), color: "text-emerald-400" },
        { label: "GGR", value: `$${(k.ggr || 0).toFixed(0)}`, trend: trend(k.ggr, pk.ggr), color: (k.ggr || 0) >= 0 ? "text-emerald-500" : "text-red-400" },
        { label: "BET APERTE", value: String(k.open_bets || 0), color: "text-yellow-400" },
        { label: "DEPOSITI", value: `$${(k.deposits || 0).toFixed(0)}`, color: "text-teal-400" },
        { label: "ALERT RISCHIO", value: String(openAlerts?.length || 0), color: "text-red-400" },
        { label: "MARGIN %", value: `${(k.margin_pct || 0).toFixed(1)}%`, color: "text-purple-400" },
      ]);

      // Sport breakdown from stats
      const sportMap: Record<string, { count: number; stake: number }> = {};
      for (const day of statsData.stats || []) {
        for (const [sport, data] of Object.entries(day.sport_breakdown || {})) {
          if (!sportMap[sport]) sportMap[sport] = { count: 0, stake: 0 };
          sportMap[sport].count += (data as any).count || 0;
          sportMap[sport].stake += (data as any).stake || 0;
        }
      }
      setSportBreakdown(Object.entries(sportMap).map(([name, d]) => ({ name, ...d })));

      // Recent bets
      const { data: rBets } = await supabase
        .from("bets")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);

      if (rBets && rBets.length > 0) {
        const userIds = [...new Set(rBets.map((b: any) => b.user_id))];
        const { data: users } = await supabase.from("users").select("id, username").in("id", userIds);
        const userMap = new Map(users?.map((u: any) => [u.id, u.username]) || []);
        setRecentBets(rBets.map((b: any) => ({ ...b, username: userMap.get(b.user_id) || "—" })));
      }

      // Recent users
      const { data: rUsers } = await supabase
        .from("users")
        .select("id, username, email, created_at, kyc_status")
        .order("created_at", { ascending: false })
        .limit(5);
      if (rUsers) setRecentUsers(rUsers);

    } catch (err) {
      console.error("Dashboard error:", err);
    }
    setLoading(false);
  }, [range, supabase]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 text-sm">Caricamento dashboard...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black" style={{ color: "var(--admin-text)" }}>Dashboard</h1>
          <p className="text-sm" style={{ color: "var(--admin-text4)" }}>Overview piattaforma scommesse</p>
        </div>
        <div className="flex items-center gap-2">
          {(["7d", "30d", "90d"] as Range[]).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-bold transition-colors",
                range === r ? "bg-brand/20 text-brand" : "text-gray-500 hover:text-white"
              )}
            >
              {r === "7d" ? "7 Giorni" : r === "30d" ? "30 Giorni" : "90 Giorni"}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {kpis.map((kpi, i) => (
          <div key={i} className="rounded-xl p-4" style={{ background: "var(--admin-card)", borderColor: "var(--admin-border)", borderWidth: "1px" }}>
            <div className="text-[10px] font-semibold" style={{ color: "var(--admin-text4)" }}>{kpi.label}</div>
            <div className={cn("text-xl font-black font-mono mt-1", kpi.color)}>{kpi.value}</div>
            {kpi.trend !== undefined && kpi.trend !== 0 && (
              <div className={cn("text-[10px] font-bold mt-1",
                kpi.trend > 0 ? "text-emerald-400" : "text-red-400"
              )}>
                {kpi.trend > 0 ? "+" : ""}{kpi.trend.toFixed(1)}% vs periodo prec.
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <RevenueChart data={stats} />
        <BetVolumeChart data={stats} />
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <PlayerActivityChart data={stats} />
        <SportBreakdownChart data={sportBreakdown} />
      </div>

      {/* Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent Bets */}
        <div className="lg:col-span-2 rounded-xl overflow-hidden" style={{ background: "var(--admin-card)", borderColor: "var(--admin-border)", borderWidth: "1px" }}>
          <div className="px-4 py-3 flex justify-between items-center" style={{ borderBottom: "1px solid var(--admin-border)" }}>
            <span className="text-sm font-bold" style={{ color: "var(--admin-text)" }}>Ultime Scommesse</span>
            <span className="text-[10px]" style={{ color: "var(--admin-text4)" }}>{recentBets.length} risultati</span>
          </div>
          {recentBets.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">Nessuna scommessa</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ color: "var(--admin-text4)", borderBottom: "1px solid var(--admin-border)" }}>
                    <th className="text-left px-4 py-2 font-semibold">Utente</th>
                    <th className="text-left px-4 py-2 font-semibold">Tipo</th>
                    <th className="text-right px-4 py-2 font-semibold">Stake</th>
                    <th className="text-right px-4 py-2 font-semibold">Quota</th>
                    <th className="text-right px-4 py-2 font-semibold">Vincita pot.</th>
                    <th className="text-center px-4 py-2 font-semibold">Stato</th>
                    <th className="text-center px-4 py-2 font-semibold">Risk</th>
                    <th className="text-right px-4 py-2 font-semibold">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {recentBets.map((bet: any) => (
                    <tr key={bet.id} className="border-b border-gray-800/50 hover:bg-white/5">
                      <td className="px-4 py-2 font-medium" style={{ color: "var(--admin-text)" }}>{bet.username}</td>
                      <td className="px-4 py-2 capitalize" style={{ color: "var(--admin-text3)" }}>{bet.bet_type}</td>
                      <td className="px-4 py-2 text-right font-mono" style={{ color: "var(--admin-text)" }}>${bet.stake?.toFixed(2)}</td>
                      <td className="px-4 py-2 text-right font-mono" style={{ color: "var(--admin-text2)" }}>{bet.total_odds?.toFixed(2)}</td>
                      <td className="px-4 py-2 text-right font-mono text-emerald-400">${bet.potential_win?.toFixed(2)}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={cn("px-2 py-0.5 rounded text-[9px] font-bold",
                          bet.status === "open" ? "bg-yellow-500/20 text-yellow-400" :
                          bet.status === "won" ? "bg-emerald-500/20 text-emerald-400" :
                          bet.status === "lost" ? "bg-red-500/20 text-red-400" :
                          "bg-gray-500/20 text-gray-400"
                        )}>{bet.status?.toUpperCase()}</span>
                      </td>
                      <td className="px-4 py-2 text-center">
                        {bet.risk_score > 0 && (
                          <span className={cn("px-1.5 py-0.5 rounded text-[8px] font-bold font-mono",
                            bet.risk_score > 75 ? "bg-red-500/20 text-red-400" :
                            bet.risk_score > 50 ? "bg-orange-500/20 text-orange-400" :
                            bet.risk_score > 25 ? "bg-yellow-500/20 text-yellow-400" :
                            "bg-green-500/20 text-green-400"
                          )}>{bet.risk_score}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-500 whitespace-nowrap">
                        {new Date(bet.created_at).toLocaleDateString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent Users */}
        <div className="rounded-xl overflow-hidden" style={{ background: "var(--admin-card)", borderColor: "var(--admin-border)", borderWidth: "1px" }}>
          <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--admin-border)" }}>
            <span className="text-sm font-bold" style={{ color: "var(--admin-text)" }}>Ultimi Utenti</span>
          </div>
          {recentUsers.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">Nessun utente</div>
          ) : (
            <div>
              {recentUsers.map((u: any) => (
                <div key={u.id} className="flex items-center justify-between px-4 py-3 border-b border-gray-800/50 hover:bg-white/5">
                  <div>
                    <div className="text-xs font-semibold" style={{ color: "var(--admin-text)" }}>{u.username}</div>
                    <div className="text-[10px]" style={{ color: "var(--admin-text4)" }}>{u.email}</div>
                  </div>
                  <div className="text-right">
                    <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded",
                      u.kyc_status === "verified" ? "bg-emerald-500/20 text-emerald-400" : "bg-orange-500/20 text-orange-400"
                    )}>{u.kyc_status === "verified" ? "KYC OK" : "PENDING"}</span>
                    <div className="text-[9px] text-gray-600 mt-0.5">
                      {new Date(u.created_at).toLocaleDateString("it-IT")}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
