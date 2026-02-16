"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { usePromos, Promo } from "@/lib/hooks/use-promos";
import { useAuth } from "@/lib/hooks/use-auth";

const TABS = ["Tutte", "Casino", "Sport", "Tornei", "I Miei Bonus"];

export default function PromoPage() {
  const { promos, userPromos, claimPromo } = usePromos();
  const { user, refreshWallet } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [claimResult, setClaimResult] = useState<{ id: string; type: "success" | "error"; msg: string } | null>(null);

  const filtered = activeTab === 0 ? promos :
    activeTab === 1 ? promos.filter(p => p.cat === "casino") :
    activeTab === 2 ? promos.filter(p => p.cat === "sport") :
    activeTab === 3 ? promos.filter(p => p.cat === "torneo") :
    [];

  const handleClaim = async (promo: Promo) => {
    if (!user) return;
    setClaiming(promo.id);
    setClaimResult(null);
    const result = await claimPromo(promo);
    setClaiming(null);
    if (result.success) {
      setClaimResult({ id: promo.id, type: "success", msg: "Bonus attivato!" });
      refreshWallet();
    } else {
      setClaimResult({ id: promo.id, type: "error", msg: result.error || "Errore" });
    }
    setTimeout(() => setClaimResult(null), 4000);
  };

  const isAlreadyClaimed = (promoId: string) => {
    return userPromos.some(up => up.promo_id === promoId && up.status === "active");
  };

  return (
    <div className="p-4 lg:p-0">
      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-r from-green-500 via-emerald-500 to-blue-500 p-6 lg:p-8 mb-5 relative overflow-hidden">
        <div className="relative">
          <h1 className="text-2xl lg:text-3xl font-black text-white italic">Promozioni</h1>
          <p className="text-white/70 text-sm">Casino · Sport · Tornei · Free Spins</p>
        </div>
        <span className="absolute right-6 top-1/2 -translate-y-1/2 text-6xl opacity-20">🎁</span>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-5 overflow-x-auto no-scrollbar">
        {TABS.map((tab, i) => (
          <button
            key={tab}
            onClick={() => setActiveTab(i)}
            className={cn(
              "flex-shrink-0 px-4 py-2.5 text-xs font-semibold transition-all border-b-2 -mb-px",
              activeTab === i
                ? "border-brand text-brand"
                : "border-transparent text-gray-400 hover:text-gray-600"
            )}
          >
            {tab}
            {i === 4 && userPromos.length > 0 && (
              <span className="ml-1 bg-brand text-white text-[8px] px-1.5 py-0.5 rounded-full">{userPromos.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* My Bonuses Tab */}
      {activeTab === 4 ? (
        <div>
          {userPromos.length === 0 ? (
            <div className="text-center py-12">
              <span className="text-4xl block mb-3">🎯</span>
              <p className="text-sm text-gray-400">Nessun bonus attivo. Esplora le promozioni disponibili!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {userPromos.map((up) => (
                <div key={up.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="text-sm font-bold text-gray-900">{up.promo_name}</h3>
                      <span className={cn("text-[9px] font-bold px-2 py-0.5 rounded mt-1 inline-block",
                        up.status === "active" ? "bg-emerald-50 text-emerald-600" :
                        up.status === "completed" ? "bg-blue-50 text-blue-600" :
                        "bg-gray-50 text-gray-400"
                      )}>{up.status.toUpperCase()}</span>
                    </div>
                    {up.bonus_amount > 0 && (
                      <span className="text-lg font-black text-brand">${up.bonus_amount.toFixed(2)}</span>
                    )}
                  </div>
                  {up.wagering_required > 0 && (
                    <div className="mt-3">
                      <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                        <span>Wagering: ${up.wagered.toFixed(2)} / ${up.wagering_required.toFixed(2)}</span>
                        <span className="font-bold">{up.progress.toFixed(0)}%</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div
                          className="bg-brand h-2 rounded-full transition-all"
                          style={{ width: `${Math.min(100, up.progress)}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {up.expires_at && (
                    <div className="text-[9px] text-gray-400 mt-2">
                      Scade: {new Date(up.expires_at).toLocaleDateString("it-IT")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Promo Cards */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map((promo) => {
            const claimed = isAlreadyClaimed(promo.id);
            return (
              <div key={promo.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                {/* Gradient header */}
                <div className={cn("bg-gradient-to-r p-5 relative", promo.color)}>
                  <span className="absolute top-3 right-3 bg-white/20 backdrop-blur text-white text-[9px] font-bold px-2 py-0.5 rounded">
                    {promo.badge}
                  </span>
                  <span className="text-3xl block mb-1">{promo.icon}</span>
                  <h3 className="text-lg font-black text-white">{promo.name}</h3>
                </div>

                <div className="p-4">
                  <p className="text-sm text-gray-700 mb-1">{promo.desc}</p>
                  <p className="text-[10px] text-gray-400 mb-4">{promo.details}</p>

                  {/* Claim result */}
                  {claimResult?.id === promo.id && (
                    <div className={cn("mb-3 px-3 py-2 rounded-lg text-xs text-center font-semibold",
                      claimResult.type === "success" ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
                    )}>
                      {claimResult.type === "success" ? "✅" : "❌"} {claimResult.msg}
                    </div>
                  )}

                  <button
                    onClick={() => handleClaim(promo)}
                    disabled={!user || claiming === promo.id || claimed}
                    className={cn(
                      "w-full py-2.5 rounded-xl text-sm font-bold transition-all",
                      claimed ? "bg-gray-100 text-gray-400 cursor-not-allowed" :
                      claiming === promo.id ? "bg-gray-400 text-white" :
                      "bg-brand text-white hover:bg-brand-dark active:scale-[0.98]"
                    )}
                  >
                    {claimed ? "✓ Già attivato" : claiming === promo.id ? "⏳ Attivando..." : promo.cta}
                  </button>
                  {!user && <p className="text-[10px] text-gray-400 text-center mt-1">Accedi per attivare</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
