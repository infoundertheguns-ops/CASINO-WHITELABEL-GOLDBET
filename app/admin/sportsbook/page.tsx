"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface Bet {
  id: string;
  user_id: string;
  username: string;
  bet_type: string;
  stake: number;
  total_odds: number;
  potential_win: number;
  status: string;
  created_at: string;
}

export default function AdminSportsbook() {
  const [bets, setBets] = useState<Bet[]>([]);
  const [filter, setFilter] = useState<"all" | "open" | "won" | "lost">("all");
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const fetchBets = async () => {
    setLoading(true);
    let query = supabase.from("bets").select("*").order("created_at", { ascending: false }).limit(50);
    if (filter !== "all") query = query.eq("status", filter);
    const { data } = await query;

    if (data && data.length > 0) {
      const userIds = [...new Set(data.map(b => b.user_id))];
      const { data: users } = await supabase.from("users").select("id, username").in("id", userIds);
      const userMap = new Map(users?.map(u => [u.id, u.username]) || []);
      setBets(data.map(b => ({ ...b, username: userMap.get(b.user_id) || "—" })));
    } else {
      setBets([]);
    }
    setLoading(false);
  };

  const settleBet = async (betId: string, result: "won" | "lost") => {
    const bet = bets.find(b => b.id === betId);
    if (!bet) return;

    await supabase.from("bets").update({ status: result, settled_at: new Date().toISOString() }).eq("id", betId);

    if (result === "won") {
      const { data: wallet } = await supabase.from("wallets").select("balance").eq("user_id", bet.user_id).single();
      if (wallet) {
        await supabase.from("wallets").update({ balance: wallet.balance + bet.potential_win }).eq("user_id", bet.user_id);
        await supabase.from("transactions").insert({
          user_id: bet.user_id,
          type: "win",
          amount: bet.potential_win,
          status: "completed",
          description: `Vincita scommessa ${bet.bet_type}`,
          reference_id: betId,
          reference_type: "bet",
        });
      }
    }

    await fetchBets();
  };

  useEffect(() => { fetchBets(); }, [filter]);

  const totals = {
    staked: bets.reduce((s, b) => s + (b.stake || 0), 0),
    liability: bets.filter(b => b.status === "open").reduce((s, b) => s + (b.potential_win || 0), 0),
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">Sportsbook</h1>
          <p className="text-sm text-gray-500">Gestione scommesse e settlement</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-[#12111a] rounded-xl border border-gray-800 p-4">
          <div className="text-[10px] text-gray-500 font-semibold">TOT. SCOMMESSO</div>
          <div className="text-lg font-black font-mono text-white">${totals.staked.toFixed(2)}</div>
        </div>
        <div className="bg-[#12111a] rounded-xl border border-gray-800 p-4">
          <div className="text-[10px] text-gray-500 font-semibold">LIABILITY APERTA</div>
          <div className="text-lg font-black font-mono text-red-400">${totals.liability.toFixed(2)}</div>
        </div>
        <div className="bg-[#12111a] rounded-xl border border-gray-800 p-4">
          <div className="text-[10px] text-gray-500 font-semibold">SCOMMESSE APERTE</div>
          <div className="text-lg font-black font-mono text-yellow-400">{bets.filter(b => b.status === "open").length}</div>
        </div>
      </div>

      <div className="flex gap-1 mb-4">
        {(["all", "open", "won", "lost"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
              filter === f ? "bg-brand text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            )}>{f === "all" ? "Tutte" : f === "open" ? "Aperte" : f === "won" ? "Vinte" : "Perse"}</button>
        ))}
      </div>

      <div className="bg-[#12111a] rounded-xl border border-gray-800 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500 text-sm">Caricamento...</div>
        ) : bets.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">Nessuna scommessa trovata</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left px-4 py-3 font-semibold">Utente</th>
                <th className="text-left px-4 py-3 font-semibold">Tipo</th>
                <th className="text-right px-4 py-3 font-semibold">Stake</th>
                <th className="text-right px-4 py-3 font-semibold">Quota</th>
                <th className="text-right px-4 py-3 font-semibold">Vincita pot.</th>
                <th className="text-center px-4 py-3 font-semibold">Stato</th>
                <th className="text-right px-4 py-3 font-semibold">Data</th>
                <th className="text-center px-4 py-3 font-semibold">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {bets.map((bet) => (
                <tr key={bet.id} className="border-b border-gray-800/50 hover:bg-white/5">
                  <td className="px-4 py-3 text-white font-medium">{bet.username}</td>
                  <td className="px-4 py-3 text-gray-400 capitalize">{bet.bet_type}</td>
                  <td className="px-4 py-3 text-right font-mono text-white">${bet.stake?.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-mono text-gray-300">{bet.total_odds?.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-mono text-emerald-400">${bet.potential_win?.toFixed(2)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={cn("px-2 py-0.5 rounded text-[9px] font-bold",
                      bet.status === "open" ? "bg-yellow-500/20 text-yellow-400" :
                      bet.status === "won" ? "bg-emerald-500/20 text-emerald-400" :
                      "bg-red-500/20 text-red-400"
                    )}>{bet.status.toUpperCase()}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500">{new Date(bet.created_at).toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="px-4 py-3 text-center">
                    {bet.status === "open" ? (
                      <div className="flex gap-1 justify-center">
                        <button onClick={() => settleBet(bet.id, "won")}
                          className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 text-[9px] font-bold hover:bg-emerald-500/30">✓ WIN</button>
                        <button onClick={() => settleBet(bet.id, "lost")}
                          className="px-2 py-1 rounded bg-red-500/20 text-red-400 text-[9px] font-bold hover:bg-red-500/30">✕ LOSE</button>
                      </div>
                    ) : <span className="text-gray-600">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
