"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export default function AdminAML() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [bigTx, setBigTx] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => { load(); }, []);
  const load = async () => {
    setLoading(true);
    const { data: flags } = await supabase.from("risk_flags").select("*").order("created_at", { ascending: false }).limit(30);
    const { data: txs } = await supabase.from("transactions").select("*").order("created_at", { ascending: false }).limit(50);
    setAlerts(flags || []);
    setBigTx((txs || []).filter((t: any) => Math.abs(t.amount || 0) > 500));
    setLoading(false);
  };

  const updateAlert = async (id: string, status: string) => {
    await supabase.from("risk_flags").update({ status, resolved_at: new Date().toISOString() }).eq("id", id);
    setAlerts(alerts.map(a => a.id === id ? { ...a, status } : a));
  };

  const sevColor = (s: string) => s === "critical" ? "bg-red-500/20 text-red-400" : s === "high" ? "bg-orange-500/20 text-orange-400" : s === "medium" ? "bg-yellow-500/20 text-yellow-400" : "bg-green-500/20 text-green-400";

  if (loading) return <div className="p-8 text-center text-gray-500">Caricamento...</div>;

  return (
    <div>
      <h1 className="text-2xl font-black text-white mb-1">AML Monitoring</h1>
      <p className="text-sm text-gray-500 mb-6">Anti-Money Laundering</p>
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { l: "ALERT TOTALI", v: alerts.length, c: "text-red-400" },
          { l: "APERTI", v: alerts.filter(a => a.status === "open").length, c: "text-yellow-400" },
          { l: "TX SOSPETTE", v: bigTx.length, c: "text-orange-400" },
          { l: "RISOLTI", v: alerts.filter(a => a.status === "resolved").length, c: "text-emerald-400" },
        ].map((k, i) => (
          <div key={i} className="bg-[var(--admin-card)] rounded-xl border border-gray-800 p-4">
            <div className="text-[10px] text-gray-500">{k.l}</div>
            <div className={cn("text-lg font-black font-mono", k.c)}>{k.v}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-[var(--admin-card)] rounded-xl border border-gray-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800"><span className="text-sm font-bold text-white">🚨 AML Alerts</span></div>
          {alerts.length === 0 ? <div className="p-8 text-center text-gray-500 text-sm">Nessun alert</div> : (
            <div className="max-h-[500px] overflow-y-auto">
              {alerts.map(a => (
                <div key={a.id} className="px-4 py-3 border-b border-gray-800/50 hover:bg-white/5">
                  <div className="flex justify-between items-start mb-1">
                    <span className={cn("px-1.5 py-0.5 rounded text-[8px] font-bold", sevColor(a.severity))}>{a.severity?.toUpperCase()}</span>
                    <span className={cn("text-[8px] font-bold", a.status === "open" ? "text-yellow-400" : "text-gray-500")}>{a.status?.toUpperCase()}</span>
                  </div>
                  <p className="text-[10px] text-gray-400 mb-2">{a.description}</p>
                  {a.status === "open" && (
                    <div className="flex gap-1">
                      <button onClick={() => updateAlert(a.id, "investigating")} className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 text-[8px] font-bold">🔍 Investiga</button>
                      <button onClick={() => updateAlert(a.id, "resolved")} className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[8px] font-bold">✓ Risolvi</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="bg-[var(--admin-card)] rounded-xl border border-gray-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800"><span className="text-sm font-bold text-white">💸 TX &gt; $500</span></div>
          {bigTx.length === 0 ? <div className="p-8 text-center text-gray-500 text-sm">Nessuna</div> : (
            <div className="max-h-[500px] overflow-y-auto">
              {bigTx.map(tx => (
                <div key={tx.id} className="px-4 py-2 border-b border-gray-800/50 flex justify-between items-center">
                  <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded capitalize", tx.type === "deposit" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400")}>{tx.type}</span>
                  <span className={cn("text-xs font-mono font-bold", tx.amount >= 0 ? "text-emerald-400" : "text-red-400")}>${Math.abs(tx.amount || 0).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
