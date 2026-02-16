"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export default function AdminCasino() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from("game_sessions")
        .select("*, users(username)")
        .order("created_at", { ascending: false })
        .limit(30);
      setSessions(data || []);
      setLoading(false);
    }
    load();
  }, []);

  const totalBet = sessions.reduce((s, x) => s + (x.total_bet || 0), 0);
  const totalWin = sessions.reduce((s, x) => s + (x.total_win || 0), 0);
  const ggr = totalBet - totalWin;

  return (
    <div>
      <h1 className="text-2xl font-black text-white mb-1">Casino</h1>
      <p className="text-sm text-gray-500 mb-6">Sessioni di gioco e performance</p>

      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="bg-[#12111a] rounded-xl border border-gray-800 p-4">
          <div className="text-[10px] text-gray-500">SESSIONI</div>
          <div className="text-lg font-black font-mono text-white">{sessions.length}</div>
        </div>
        <div className="bg-[#12111a] rounded-xl border border-gray-800 p-4">
          <div className="text-[10px] text-gray-500">TOTAL BET</div>
          <div className="text-lg font-black font-mono text-brand">${totalBet.toFixed(2)}</div>
        </div>
        <div className="bg-[#12111a] rounded-xl border border-gray-800 p-4">
          <div className="text-[10px] text-gray-500">TOTAL WIN</div>
          <div className="text-lg font-black font-mono text-emerald-400">${totalWin.toFixed(2)}</div>
        </div>
        <div className="bg-[#12111a] rounded-xl border border-gray-800 p-4">
          <div className="text-[10px] text-gray-500">GGR</div>
          <div className={cn("text-lg font-black font-mono", ggr >= 0 ? "text-emerald-400" : "text-red-400")}>${ggr.toFixed(2)}</div>
        </div>
      </div>

      <div className="bg-[#12111a] rounded-xl border border-gray-800 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Caricamento...</div>
        ) : sessions.length === 0 ? (
          <div className="p-8 text-center text-gray-500">Nessuna sessione casino</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left px-4 py-3">Utente</th>
                <th className="text-left px-4 py-3">Gioco</th>
                <th className="text-left px-4 py-3">Provider</th>
                <th className="text-right px-4 py-3">Bet</th>
                <th className="text-right px-4 py-3">Win</th>
                <th className="text-center px-4 py-3">Rounds</th>
                <th className="text-center px-4 py-3">Stato</th>
                <th className="text-right px-4 py-3">Data</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map(s => (
                <tr key={s.id} className="border-b border-gray-800/50 hover:bg-white/5">
                  <td className="px-4 py-2 text-white">{s.users?.username || "—"}</td>
                  <td className="px-4 py-2 text-gray-300">{s.game_name}</td>
                  <td className="px-4 py-2 text-gray-500">{s.provider}</td>
                  <td className="px-4 py-2 text-right font-mono text-brand">${(s.total_bet || 0).toFixed(2)}</td>
                  <td className="px-4 py-2 text-right font-mono text-emerald-400">${(s.total_win || 0).toFixed(2)}</td>
                  <td className="px-4 py-2 text-center text-gray-400">{s.rounds || 0}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={cn("px-2 py-0.5 rounded text-[9px] font-bold",
                      s.status === "active" ? "bg-emerald-500/20 text-emerald-400" : "bg-gray-500/20 text-gray-400"
                    )}>{s.status?.toUpperCase()}</span>
                  </td>
                  <td className="px-4 py-2 text-right text-gray-500">{new Date(s.created_at).toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
