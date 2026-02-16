"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export default function AdminCrypto() {
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [deposits, setDeposits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [wRes, dRes] = await Promise.all([
        supabase.from("crypto_withdrawals").select("*, users(username)").order("created_at", { ascending: false }).limit(20),
        supabase.from("crypto_deposits").select("*, users(username)").order("created_at", { ascending: false }).limit(20),
      ]);
      setWithdrawals(wRes.data || []);
      setDeposits(dRes.data || []);
      setLoading(false);
    }
    load();
  }, []);

  const approveWithdrawal = async (id: string) => {
    await supabase.from("crypto_withdrawals").update({ status: "approved", reviewed_at: new Date().toISOString() }).eq("id", id);
    setWithdrawals(withdrawals.map(w => w.id === id ? { ...w, status: "approved" } : w));
  };

  const rejectWithdrawal = async (id: string) => {
    await supabase.from("crypto_withdrawals").update({ status: "rejected", reviewed_at: new Date().toISOString() }).eq("id", id);
    setWithdrawals(withdrawals.map(w => w.id === id ? { ...w, status: "rejected" } : w));
  };

  return (
    <div>
      <h1 className="text-2xl font-black text-white mb-1">Crypto & Treasury</h1>
      <p className="text-sm text-gray-500 mb-6">Gestione depositi, prelievi e wallet</p>

      {/* Pending Withdrawals */}
      <div className="bg-[#12111a] rounded-xl border border-gray-800 overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-gray-800">
          <span className="text-sm font-bold text-white">↑ Prelievi ({withdrawals.length})</span>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-500 text-sm">Caricamento...</div>
        ) : withdrawals.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">Nessun prelievo</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left px-4 py-2">Utente</th>
                <th className="text-right px-4 py-2">Importo</th>
                <th className="text-left px-4 py-2">Indirizzo</th>
                <th className="text-center px-4 py-2">Stato</th>
                <th className="text-center px-4 py-2">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {withdrawals.map(w => (
                <tr key={w.id} className="border-b border-gray-800/50 hover:bg-white/5">
                  <td className="px-4 py-2 text-white">{w.users?.username || "—"}</td>
                  <td className="px-4 py-2 text-right font-mono text-red-400">${w.amount_usdt?.toFixed(2)}</td>
                  <td className="px-4 py-2 text-gray-400 font-mono text-[10px] truncate max-w-[200px]">{w.to_address}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={cn("px-2 py-0.5 rounded text-[9px] font-bold",
                      w.status === "pending" ? "bg-yellow-500/20 text-yellow-400" :
                      w.status === "approved" ? "bg-emerald-500/20 text-emerald-400" :
                      "bg-red-500/20 text-red-400"
                    )}>{w.status?.toUpperCase()}</span>
                  </td>
                  <td className="px-4 py-2 text-center">
                    {w.status === "pending" ? (
                      <div className="flex gap-1 justify-center">
                        <button onClick={() => approveWithdrawal(w.id)} className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 text-[9px] font-bold">✓ Approva</button>
                        <button onClick={() => rejectWithdrawal(w.id)} className="px-2 py-1 rounded bg-red-500/20 text-red-400 text-[9px] font-bold">✕ Rifiuta</button>
                      </div>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Deposits */}
      <div className="bg-[#12111a] rounded-xl border border-gray-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800">
          <span className="text-sm font-bold text-white">↓ Depositi ({deposits.length})</span>
        </div>
        {deposits.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">Nessun deposito crypto registrato</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left px-4 py-2">Utente</th>
                <th className="text-right px-4 py-2">Importo</th>
                <th className="text-left px-4 py-2">TX Hash</th>
                <th className="text-center px-4 py-2">Stato</th>
              </tr>
            </thead>
            <tbody>
              {deposits.map(d => (
                <tr key={d.id} className="border-b border-gray-800/50">
                  <td className="px-4 py-2 text-white">{d.users?.username || "—"}</td>
                  <td className="px-4 py-2 text-right font-mono text-emerald-400">${d.amount_usdt?.toFixed(2)}</td>
                  <td className="px-4 py-2 text-gray-400 font-mono text-[10px] truncate max-w-[200px]">{d.tx_hash || "—"}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={cn("px-2 py-0.5 rounded text-[9px] font-bold",
                      d.status === "confirmed" || d.status === "credited" ? "bg-emerald-500/20 text-emerald-400" : "bg-yellow-500/20 text-yellow-400"
                    )}>{d.status?.toUpperCase()}</span>
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
