"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface KPI {
  label: string;
  value: string;
  icon: string;
  color: string;
}

export default function AdminDashboard() {
  const [kpis, setKpis] = useState<KPI[]>([]);
  const [recentBets, setRecentBets] = useState<any[]>([]);
  const [recentUsers, setRecentUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    async function loadDashboard() {
      setLoading(true);

      try {
        // Users
        const { data: usersData } = await supabase.from("users").select("id");
        const totalUsers = usersData?.length || 0;

        // Bets
        const { data: betsData } = await supabase.from("bets").select("*");
        const bets = betsData || [];
        const totalBets = bets.length;
        const totalStaked = bets.reduce((sum: number, b: any) => sum + (b.stake || 0), 0);
        const openBets = bets.filter((b: any) => b.status === "open").length;

        // Wallets
        const { data: walletsData } = await supabase.from("wallets").select("*");
        const wallets = walletsData || [];
        const totalBalance = wallets.reduce((sum: number, w: any) => sum + (w.balance || 0), 0);
        const totalBonus = wallets.reduce((sum: number, w: any) => sum + (w.bonus_balance || 0), 0);

        // Transactions
        let deposits = 0;
        try {
          const { data: txData } = await supabase.from("transactions").select("*");
          deposits = (txData || []).filter((t: any) => t.type === "deposit").reduce((s: number, t: any) => s + Math.abs(t.amount || 0), 0);
        } catch {}

        // Sessions
        let totalSessions = 0;
        try {
          const { data: sessData } = await supabase.from("game_sessions").select("id");
          totalSessions = sessData?.length || 0;
        } catch {}

        setKpis([
          { label: "Utenti Registrati", value: String(totalUsers), icon: "👥", color: "text-blue-500" },
          { label: "Scommesse Totali", value: String(totalBets), icon: "🎯", color: "text-brand" },
          { label: "Volume Scommesso", value: `$${totalStaked.toFixed(2)}`, icon: "💵", color: "text-emerald-500" },
          { label: "Scommesse Aperte", value: String(openBets), icon: "⏳", color: "text-yellow-500" },
          { label: "Saldo Utenti", value: `$${totalBalance.toFixed(2)}`, icon: "💰", color: "text-purple-500" },
          { label: "Bonus Erogati", value: `$${totalBonus.toFixed(2)}`, icon: "🎁", color: "text-pink-500" },
          { label: "Sessioni Casino", value: String(totalSessions), icon: "🎰", color: "text-indigo-500" },
          { label: "Depositi", value: `$${deposits.toFixed(2)}`, icon: "↓", color: "text-teal-500" },
        ]);

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
    }

    loadDashboard();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 text-sm">⏳ Caricamento dashboard...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">Dashboard</h1>
          <p className="text-sm text-gray-500">Overview piattaforma in tempo reale</p>
        </div>
        <div className="text-xs text-gray-500">
          {new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {kpis.map((kpi, i) => (
          <div key={i} className="bg-[#12111a] rounded-xl border border-gray-800 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-lg">{kpi.icon}</span>
            </div>
            <div className={cn("text-xl font-black font-mono", kpi.color)}>{kpi.value}</div>
            <div className="text-[10px] text-gray-500 font-semibold mt-0.5">{kpi.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent Bets */}
        <div className="lg:col-span-2 bg-[#12111a] rounded-xl border border-gray-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800 flex justify-between items-center">
            <span className="text-sm font-bold text-white">🎯 Ultime Scommesse</span>
            <span className="text-[10px] text-gray-500">{recentBets.length} risultati</span>
          </div>
          {recentBets.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">Nessuna scommessa ancora</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left px-4 py-2 font-semibold">Utente</th>
                    <th className="text-left px-4 py-2 font-semibold">Tipo</th>
                    <th className="text-right px-4 py-2 font-semibold">Stake</th>
                    <th className="text-right px-4 py-2 font-semibold">Quota</th>
                    <th className="text-right px-4 py-2 font-semibold">Vincita pot.</th>
                    <th className="text-center px-4 py-2 font-semibold">Stato</th>
                    <th className="text-right px-4 py-2 font-semibold">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {recentBets.map((bet: any) => (
                    <tr key={bet.id} className="border-b border-gray-800/50 hover:bg-white/5">
                      <td className="px-4 py-2 text-white font-medium">{bet.username}</td>
                      <td className="px-4 py-2 text-gray-400 capitalize">{bet.bet_type}</td>
                      <td className="px-4 py-2 text-right font-mono text-white">${bet.stake?.toFixed(2)}</td>
                      <td className="px-4 py-2 text-right font-mono text-gray-300">{bet.total_odds?.toFixed(2)}</td>
                      <td className="px-4 py-2 text-right font-mono text-emerald-400">${bet.potential_win?.toFixed(2)}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={cn("px-2 py-0.5 rounded text-[9px] font-bold",
                          bet.status === "open" ? "bg-yellow-500/20 text-yellow-400" :
                          bet.status === "won" ? "bg-emerald-500/20 text-emerald-400" :
                          bet.status === "lost" ? "bg-red-500/20 text-red-400" :
                          "bg-gray-500/20 text-gray-400"
                        )}>{bet.status?.toUpperCase()}</span>
                      </td>
                      <td className="px-4 py-2 text-right text-gray-500">
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
        <div className="bg-[#12111a] rounded-xl border border-gray-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800">
            <span className="text-sm font-bold text-white">👥 Ultimi Utenti</span>
          </div>
          {recentUsers.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">Nessun utente</div>
          ) : (
            <div>
              {recentUsers.map((u: any) => (
                <div key={u.id} className="flex items-center justify-between px-4 py-3 border-b border-gray-800/50 hover:bg-white/5">
                  <div>
                    <div className="text-xs font-semibold text-white">{u.username}</div>
                    <div className="text-[10px] text-gray-500">{u.email}</div>
                  </div>
                  <div className="text-right">
                    <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded",
                      u.kyc_status === "verified" ? "bg-emerald-500/20 text-emerald-400" : "bg-orange-500/20 text-orange-400"
                    )}>{u.kyc_status === "verified" ? "KYC ✓" : "PENDING"}</span>
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
