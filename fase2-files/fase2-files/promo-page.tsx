"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const TABS = ["Tutte", "Casino", "Sport", "Tornei", "I Miei Bonus"];

const PROMOS = [
  { name: "Bonus Benvenuto 100%", desc: "Fino a $1,000 + 200 Free Spins sul primo deposito", badge: "NUOVO", cat: "casino", color: "from-orange-500 to-orange-300", icon: "🎁", cta: "Deposita ora", details: "Wagering 35x · Scade in 30gg · Min deposito $20" },
  { name: "Free Bet $50", desc: "Scommessa gratis su eventi live questo weekend", badge: "SPORT", cat: "sport", color: "from-blue-500 to-blue-300", icon: "⚽", cta: "Riscuoti", details: "Quota min 1.80 · Solo live · Scade domenica" },
  { name: "Mega Spin Tournament", desc: "Montepremi $10,000 — Gioca slot Pragmatic e scala la classifica", badge: "LIVE", cat: "torneo", color: "from-yellow-500 to-orange-400", icon: "🏆", cta: "Partecipa", details: "Top 100 vincono · Min spin $0.50 · Fino a venerdì" },
  { name: "Cashback Casino 10%", desc: "Ricevi il 10% delle perdite settimanali fino a $500", badge: "WEEKLY", cat: "casino", color: "from-purple-500 to-pink-400", icon: "💰", cta: "Attiva", details: "Automatico ogni lunedì · Wagering 5x · Solo slot" },
  { name: "Acca Boost +25%", desc: "Bonus del 25% sulle vincite delle multiple con 4+ selezioni", badge: "SPORT", cat: "sport", color: "from-green-500 to-emerald-400", icon: "📈", cta: "Dettagli", details: "Min 4 selezioni · Quota min 1.30 ciascuna · Max bonus $500" },
  { name: "Valentine Race", desc: "Montepremi $2,000 speciale San Valentino", badge: "LIVE", cat: "torneo", color: "from-red-500 to-pink-400", icon: "❤️", cta: "Partecipa", details: "324 partecipanti · Top 20 vincono · Fino al 15 feb" },
];

export default function PromoPage() {
  const [activeTab, setActiveTab] = useState(0);

  const filtered = activeTab === 0 ? PROMOS :
    activeTab === 1 ? PROMOS.filter(p => p.cat === "casino") :
    activeTab === 2 ? PROMOS.filter(p => p.cat === "sport") :
    activeTab === 3 ? PROMOS.filter(p => p.cat === "torneo") :
    [];

  return (
    <div>
      {/* Hero */}
      <div className="bg-gradient-to-r from-brand to-blue-500 p-5 lg:p-8 lg:rounded-2xl text-white relative overflow-hidden">
        <div className="relative z-10">
          <h1 className="text-2xl lg:text-3xl font-black">Promozioni</h1>
          <p className="text-sm opacity-90 mt-1">Casino · Sport · Tornei · Free Spins</p>
        </div>
        <span className="absolute right-5 top-1/2 -translate-y-1/2 text-5xl opacity-20">🎁</span>
      </div>

      <div className="p-4 lg:p-0 lg:mt-6">
        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-4">
          {TABS.map((tab, i) => (
            <button
              key={tab}
              onClick={() => setActiveTab(i)}
              className={cn(
                "flex-1 py-2 rounded-lg text-xs font-semibold transition-all",
                activeTab === i
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              )}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* My Bonuses placeholder */}
        {activeTab === 4 ? (
          <div className="text-center py-12">
            <span className="text-4xl block mb-3">🎁</span>
            <p className="text-sm text-gray-500 mb-2">Nessun bonus attivo</p>
            <button
              onClick={() => setActiveTab(0)}
              className="text-xs text-brand font-semibold hover:underline"
            >
              Scopri le promozioni disponibili →
            </button>
          </div>
        ) : (
          <div className="lg:grid lg:grid-cols-2 lg:gap-4 space-y-3 lg:space-y-0">
            {filtered.map((p, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                <div className={cn("h-24 lg:h-32 bg-gradient-to-r flex items-center px-5 relative", p.color)}>
                  <span className="text-4xl mr-4">{p.icon}</span>
                  <div className="text-white">
                    <div className="text-sm lg:text-base font-bold">{p.name}</div>
                  </div>
                  <span className="absolute top-2 right-2 bg-white/20 text-white text-[9px] font-bold px-2 py-0.5 rounded">
                    {p.badge}
                  </span>
                </div>
                <div className="p-4">
                  <p className="text-xs text-gray-600 mb-2">{p.desc}</p>
                  <p className="text-[10px] text-gray-400 mb-3">{p.details}</p>
                  <button className="w-full py-2.5 rounded-lg bg-brand text-white text-xs font-bold hover:bg-brand-dark transition-colors">
                    {p.cta}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
