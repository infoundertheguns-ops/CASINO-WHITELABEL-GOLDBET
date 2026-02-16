"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export default function AdminAuditLog() {
  const [logs, setLogs] = useState<any[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => { load(); }, []);
  const load = async () => {
    setLoading(true);
    const [bR, tR, wR] = await Promise.all([
      supabase.from("bets").select("id, user_id, bet_type, stake, status, created_at").order("created_at", { ascending: false }).limit(20),
      supabase.from("transactions").select("id, user_id, type, amount, status, description, created_at").order("created_at", { ascending: false }).limit(20),
      supabase.from("crypto_withdrawals").select("id, user_id, status, amount_usdt, created_at").order("created_at", { ascending: false }).limit(10),
    ]);
    const all: any[] = [];
    (bR.data||[]).forEach(b => all.push({ ...b, _type: "bet", _action: `Scommessa ${b.bet_type} $${b.stake}` }));
    (tR.data||[]).forEach(t => all.push({ ...t, _type: "transaction", _action: `${t.type} $${Math.abs(t.amount||0).toFixed(2)}` }));
    (wR.data||[]).forEach(w => all.push({ ...w, _type: "withdrawal", _action: `Prelievo $${w.amount_usdt} — ${w.status}` }));
    all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    setLogs(all); setLoading(false);
  };

  const filtered = filter === "all" ? logs : logs.filter(l => l._type === filter);
  const typeIcon = (t: string) => t === "bet" ? "🎯" : t === "transaction" ? "💳" : "↑";
  const typeColor = (t: string) => t === "bet" ? "bg-brand/20 text-brand" : t === "transaction" ? "bg-blue-500/20 text-blue-400" : "bg-red-500/20 text-red-400";

  if (loading) return <div className="p-8 text-center text-gray-500">Caricamento...</div>;

  return (
    <div>
      <h1 className="text-2xl font-black text-white mb-1">Audit Log</h1>
      <p className="text-sm text-gray-500 mb-6">Traccia operazioni</p>
      <div className="flex gap-1 mb-4">
        {[{id:"all",l:"Tutti"},{id:"bet",l:"🎯 Scommesse"},{id:"transaction",l:"💳 Transazioni"},{id:"withdrawal",l:"↑ Prelievi"}].map(f=>(
          <button key={f.id} onClick={()=>setFilter(f.id)} className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold",filter===f.id?"bg-brand text-white":"bg-gray-800 text-gray-400 hover:bg-gray-700")}>{f.l}</button>
        ))}
      </div>
      <div className="bg-[#12111a] rounded-xl border border-gray-800 overflow-hidden">
        {filtered.length === 0 ? <div className="p-8 text-center text-gray-500">Nessun log</div> : (
          <div className="max-h-[600px] overflow-y-auto">
            {filtered.map((log, i) => (
              <div key={`${log._type}-${log.id}-${i}`} className="px-4 py-3 border-b border-gray-800/50 hover:bg-white/5 flex items-center gap-3">
                <span className="text-lg">{typeIcon(log._type)}</span>
                <div className="flex-1">
                  <span className={cn("px-1.5 py-0.5 rounded text-[8px] font-bold", typeColor(log._type))}>{log._type.toUpperCase()}</span>
                  <p className="text-[10px] text-gray-400 mt-0.5">{log._action}</p>
                </div>
                <div className="text-right">
                  <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded",
                    log.status==="completed"||log.status==="won"?"bg-emerald-500/20 text-emerald-400":
                    log.status==="open"||log.status==="pending"?"bg-yellow-500/20 text-yellow-400":"bg-gray-500/20 text-gray-400"
                  )}>{log.status?.toUpperCase()}</span>
                  <div className="text-[9px] text-gray-600 mt-0.5">{new Date(log.created_at).toLocaleString("it-IT",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
