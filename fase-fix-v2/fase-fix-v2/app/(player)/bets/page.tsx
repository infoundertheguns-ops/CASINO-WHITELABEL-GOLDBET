"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export default function MyBetsPage() {
  const { user } = useAuth();
  const [bets, setBets] = useState<any[]>([]);
  const [filter, setFilter] = useState<"all" | "open" | "won" | "lost">("all");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => { if (user) loadBets(); }, [user]);

  const loadBets = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase.from("bets").select("*, bet_selections(*)").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50);
    setBets(data || []);
    setLoading(false);
  };

  const filtered = filter === "all" ? bets : bets.filter(b => b.status === filter);
  const openCount = bets.filter(b => b.status === "open").length;
  const wonCount = bets.filter(b => b.status === "won").length;
  const lostCount = bets.filter(b => b.status === "lost").length;
  const totalStaked = bets.reduce((s, b) => s + (b.stake || 0), 0);
  const totalWon = bets.filter(b => b.status === "won").reduce((s, b) => s + (b.potential_payout || 0), 0);

  const statusBadge = (st: string) => {
    const m: Record<string, { bg: string; label: string }> = {
      open: { bg: "bg-yellow-100 text-yellow-700", label: "APERTA" },
      won: { bg: "bg-emerald-100 text-emerald-700", label: "VINTA" },
      lost: { bg: "bg-red-100 text-red-600", label: "PERSA" },
      void: { bg: "bg-gray-100 text-gray-500", label: "VOID" },
    };
    const s = m[st] || m.open;
    return <span className={cn("px-2 py-0.5 rounded text-[9px] font-bold", s.bg)}>{s.label}</span>;
  };

  if (!user) return <div className="p-6 text-center text-gray-400">Accedi per vedere le scommesse</div>;

  return (
    <div className="p-4 lg:p-0">
      <h1 className="text-xl font-bold text-gray-900 mb-1">Le Mie Scommesse</h1>
      <p className="text-xs text-gray-400 mb-4">Storico e tracking</p>

      <div className="grid grid-cols-5 gap-2 mb-4">
        {[
          { label: "Totali", value: bets.length, color: "text-gray-800" },
          { label: "Aperte", value: openCount, color: "text-yellow-500" },
          { label: "Vinte", value: wonCount, color: "text-emerald-500" },
          { label: "Perse", value: lostCount, color: "text-red-500" },
          { label: "P&L", value: `${(totalWon - totalStaked) >= 0 ? "+" : ""}$${(totalWon - totalStaked).toFixed(0)}`, color: (totalWon - totalStaked) >= 0 ? "text-emerald-500" : "text-red-500" },
        ].map((s, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <div className={cn("text-lg font-black font-mono", s.color)}>{s.value}</div>
            <div className="text-[9px] text-gray-400 font-semibold">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-1 mb-4">
        {([{ id: "all", label: "Tutte", c: bets.length }, { id: "open", label: "🟡 Aperte", c: openCount }, { id: "won", label: "🟢 Vinte", c: wonCount }, { id: "lost", label: "🔴 Perse", c: lostCount }] as const).map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold", filter === f.id ? "bg-brand text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200")}>{f.label} ({f.c})</button>
        ))}
      </div>

      {loading ? <div className="p-8 text-center text-gray-400">Caricamento...</div> :
       filtered.length === 0 ? <div className="bg-white rounded-xl border p-8 text-center"><span className="text-3xl block mb-2">🎯</span><p className="text-sm text-gray-400">Nessuna scommessa</p></div> : (
        <div className="space-y-2">
          {filtered.map(bet => (
            <div key={bet.id} className={cn("bg-white rounded-xl border", bet.status === "open" ? "border-yellow-200" : bet.status === "won" ? "border-emerald-200" : bet.status === "lost" ? "border-red-200" : "border-gray-200")}>
              <button onClick={() => setExpanded(expanded === bet.id ? null : bet.id)} className="w-full px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {statusBadge(bet.status)}
                  <div className="text-left">
                    <div className="text-xs font-bold text-gray-800 capitalize">{bet.bet_type === "single" ? "Singola" : `Multipla (${bet.bet_selections?.length || 0})`}</div>
                    <div className="text-[10px] text-gray-400">{new Date(bet.created_at).toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right"><div className="text-[10px] text-gray-400">Stake</div><div className="text-sm font-bold font-mono">${bet.stake?.toFixed(2)}</div></div>
                  <div className="text-right"><div className="text-[10px] text-gray-400">Vincita</div><div className={cn("text-sm font-bold font-mono", bet.status === "won" ? "text-emerald-500" : "text-gray-600")}>${bet.potential_payout?.toFixed(2)}</div></div>
                  <span className={cn("text-gray-400 transition-transform", expanded === bet.id ? "rotate-180" : "")}>▾</span>
                </div>
              </button>
              {expanded === bet.id && bet.bet_selections && (
                <div className="px-4 pb-3 border-t border-gray-100 pt-3 space-y-2">
                  {bet.bet_selections.map((sel: any, si: number) => (
                    <div key={si} className="flex justify-between items-center text-xs bg-gray-50 rounded-lg px-3 py-2">
                      <div><div className="font-medium text-gray-800">{sel.event_id}</div><div className="text-[10px] text-gray-400">{sel.market_type}: <span className="font-semibold text-gray-600">{sel.selection}</span></div></div>
                      <span className="font-mono font-bold text-gray-700">{sel.odds?.toFixed(2)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                    <span className="text-[10px] text-gray-400">Quota totale</span>
                    <span className="text-sm font-bold font-mono text-brand">{bet.total_odds?.toFixed(2)}</span>
                  </div>
                </div>
              )}
              {bet.status === "open" && <div className="px-4 pb-2"><div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-pulse" /><span className="text-[9px] text-yellow-600 font-semibold">In attesa di risultato</span></div></div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
