"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export default function AdminPromos() {
  const [promos, setPromos] = useState<any[]>([]);
  const [userPromos, setUserPromos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [pRes, upRes] = await Promise.all([
        supabase.from("promotions").select("*").order("created_at", { ascending: false }),
        supabase.from("user_promotions").select("*, users(username)").order("created_at", { ascending: false }).limit(20),
      ]);
      setPromos(pRes.data || []);
      setUserPromos(upRes.data || []);
      setLoading(false);
    }
    load();
  }, []);

  const totalBonusIssued = userPromos.reduce((s, p) => s + (p.bonus_amount || 0), 0);

  return (
    <div>
      <h1 className="text-2xl font-black text-white mb-1">Promozioni</h1>
      <p className="text-sm text-gray-500 mb-6">Gestione bonus e promozioni</p>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-[var(--admin-card)] rounded-xl border border-gray-800 p-4">
          <div className="text-[10px] text-gray-500">PROMOZIONI ATTIVE</div>
          <div className="text-lg font-black font-mono text-white">{promos.filter(p => p.status === "active").length}</div>
        </div>
        <div className="bg-[var(--admin-card)] rounded-xl border border-gray-800 p-4">
          <div className="text-[10px] text-gray-500">BONUS CLAIM</div>
          <div className="text-lg font-black font-mono text-purple-400">{userPromos.length}</div>
        </div>
        <div className="bg-[var(--admin-card)] rounded-xl border border-gray-800 p-4">
          <div className="text-[10px] text-gray-500">BONUS EROGATI</div>
          <div className="text-lg font-black font-mono text-brand">${totalBonusIssued.toFixed(2)}</div>
        </div>
      </div>

      <div className="bg-[var(--admin-card)] rounded-xl border border-gray-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800">
          <span className="text-sm font-bold text-white">Bonus Riscossi</span>
        </div>
        {userPromos.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">Nessun bonus riscosso ancora</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left px-4 py-2">Utente</th>
                <th className="text-left px-4 py-2">Promozione</th>
                <th className="text-right px-4 py-2">Bonus</th>
                <th className="text-right px-4 py-2">Wagered</th>
                <th className="text-center px-4 py-2">Stato</th>
                <th className="text-right px-4 py-2">Data</th>
              </tr>
            </thead>
            <tbody>
              {userPromos.map(p => (
                <tr key={p.id} className="border-b border-gray-800/50">
                  <td className="px-4 py-2 text-white">{p.users?.username || "—"}</td>
                  <td className="px-4 py-2 text-gray-300">{p.promo_name || "—"}</td>
                  <td className="px-4 py-2 text-right font-mono text-purple-400">${(p.bonus_amount || 0).toFixed(2)}</td>
                  <td className="px-4 py-2 text-right font-mono text-gray-400">${(p.wagered_amount || 0).toFixed(2)}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={cn("px-2 py-0.5 rounded text-[9px] font-bold",
                      p.status === "active" ? "bg-emerald-500/20 text-emerald-400" : "bg-gray-500/20 text-gray-400"
                    )}>{p.status?.toUpperCase()}</span>
                  </td>
                  <td className="px-4 py-2 text-right text-gray-500">{new Date(p.created_at).toLocaleDateString("it-IT")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
