"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export default function AdminTreasury() {
  const [data, setData] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const [w, t, wd] = await Promise.all([
      supabase.from("wallets").select("balance, bonus_balance"),
      supabase.from("transactions").select("type, amount"),
      supabase.from("crypto_withdrawals").select("status, amount_usdt"),
    ]);
    const wallets = w.data || [];
    const txs = t.data || [];
    const withdrawals = wd.data || [];
    const totalBal = wallets.reduce((s: number, x: any) => s + (x.balance || 0), 0);
    const totalBonus = wallets.reduce((s: number, x: any) => s + (x.bonus_balance || 0), 0);
    const totalBets = txs.filter((x: any) => x.type === "bet").reduce((s: number, x: any) => s + Math.abs(x.amount || 0), 0);
    const totalWins = txs.filter((x: any) => x.type === "win").reduce((s: number, x: any) => s + (x.amount || 0), 0);
    const deposits = txs.filter((x: any) => x.type === "deposit").reduce((s: number, x: any) => s + (x.amount || 0), 0);
    const wdTotal = withdrawals.reduce((s: number, x: any) => s + (x.amount_usdt || 0), 0);
    const pending = withdrawals.filter((x: any) => x.status === "pending");
    setData({ totalBal, totalBonus, totalBets, totalWins, deposits, wdTotal, pending, ggr: totalBets - totalWins, net: deposits - wdTotal });
    setLoading(false);
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Caricamento...</div>;

  return (
    <div>
      <h1 className="text-2xl font-black text-white mb-1">Treasury</h1>
      <p className="text-sm text-gray-500 mb-6">Panoramica finanziaria</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          { l: "Depositi", v: `€${(data.deposits||0).toFixed(0)}`, c: "text-emerald-400", i: "↓" },
          { l: "Prelievi", v: `€${(data.wdTotal||0).toFixed(0)}`, c: "text-red-400", i: "↑" },
          { l: "Net Revenue", v: `€${(data.net||0).toFixed(0)}`, c: (data.net||0) >= 0 ? "text-emerald-400" : "text-red-400", i: "💰" },
          { l: "GGR", v: `€${(data.ggr||0).toFixed(0)}`, c: (data.ggr||0) >= 0 ? "text-emerald-400" : "text-red-400", i: "📊" },
        ].map((k, i) => (
          <div key={i} className="bg-[var(--admin-card)] rounded-xl border border-gray-800 p-4">
            <div className="text-lg mb-1">{k.i}</div>
            <div className={cn("text-xl font-black font-mono", k.c)}>{k.v}</div>
            <div className="text-[10px] text-gray-500">{k.l}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          { l: "Saldo Utenti", v: `€${(data.totalBal||0).toFixed(0)}`, c: "text-blue-400" },
          { l: "Bonus", v: `€${(data.totalBonus||0).toFixed(0)}`, c: "text-purple-400" },
          { l: "WD Pending", v: String(data.pending?.length || 0), c: "text-yellow-400" },
          { l: "Liability WD", v: `€${(data.pending||[]).reduce((s: number, x: any) => s + (x.amount_usdt || 0), 0).toFixed(0)}`, c: "text-orange-400" },
        ].map((k, i) => (
          <div key={i} className="bg-[var(--admin-card)] rounded-xl border border-gray-800 p-4">
            <div className={cn("text-xl font-black font-mono", k.c)}>{k.v}</div>
            <div className="text-[10px] text-gray-500">{k.l}</div>
          </div>
        ))}
      </div>
      <div className="bg-[var(--admin-card)] rounded-xl border border-gray-800 p-5 mb-6">
        <h3 className="text-sm font-bold text-white mb-3">🏦 Hot Wallet (simulato)</h3>
        <div className="grid grid-cols-4 gap-3">
          {[{coin:"BTC",bal:0.0234,usd:1450,c:"text-orange-500"},{coin:"ETH",bal:1.25,usd:3100,c:"text-blue-500"},{coin:"USDT",bal:25000,usd:25000,c:"text-emerald-500"},{coin:"SOL",bal:45.2,usd:2800,c:"text-purple-500"}].map(hw=>(
            <div key={hw.coin} className="bg-gray-900/50 rounded-lg p-3">
              <span className={cn("text-sm font-bold",hw.c)}>{hw.coin}</span>
              <div className="text-xs font-mono text-white mt-1">{hw.bal} {hw.coin}</div>
              <div className="text-[9px] text-gray-500">€{hw.usd.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="bg-[var(--admin-card)] rounded-xl border border-gray-800 p-5">
        <h3 className="text-sm font-bold text-white mb-3">📈 P&L</h3>
        <div className="flex items-center gap-6 text-sm">
          <div><div className="text-[10px] text-gray-500">Bet</div><div className="font-black font-mono text-emerald-400">€{(data.totalBets||0).toFixed(0)}</div></div>
          <div className="text-xl text-gray-600">−</div>
          <div><div className="text-[10px] text-gray-500">Win</div><div className="font-black font-mono text-red-400">€{(data.totalWins||0).toFixed(0)}</div></div>
          <div className="text-xl text-gray-600">=</div>
          <div><div className="text-[10px] text-gray-500">GGR</div><div className={cn("text-2xl font-black font-mono",(data.ggr||0)>=0?"text-emerald-400":"text-red-400")}>€{(data.ggr||0).toFixed(0)}</div></div>
        </div>
      </div>
    </div>
  );
}
