"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useCasino, CasinoGame } from "@/lib/hooks/use-casino";
import { useAuth } from "@/lib/hooks/use-auth";

const CATEGORIES = [
  { id: "all", label: "🔥 Popolari" },
  { id: "slot", label: "🎰 Slot" },
  { id: "live", label: "🎥 Live Casino" },
  { id: "table", label: "🃏 Table Games" },
  { id: "crash", label: "🚀 Crash" },
];

const PROVIDERS = ["Pragmatic Play", "Evolution", "Play'n GO", "Hacksaw Gaming", "NoLimit City", "Spribe"];

export default function CasinoPage() {
  const { games, launchGame } = useCasino();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [provider, setProvider] = useState<string | null>(null);
  const [selectedGame, setSelectedGame] = useState<CasinoGame | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchMsg, setLaunchMsg] = useState("");

  const filtered = games.filter((g) => {
    if (search && !g.name.toLowerCase().includes(search.toLowerCase()) && !g.provider.toLowerCase().includes(search.toLowerCase())) return false;
    if (category !== "all" && g.category !== category) return false;
    if (provider && g.provider !== provider) return false;
    return true;
  });

  const handleLaunch = async (game: CasinoGame, mode: "real" | "demo") => {
    setLaunching(true);
    setLaunchMsg("");
    const result = await launchGame(game, mode);
    setLaunching(false);
    if (result.success) {
      setLaunchMsg(mode === "demo" ? "Demo avviata!" : `Sessione #${result.sessionId?.slice(0, 8)} creata!`);
      setTimeout(() => setLaunchMsg(""), 3000);
    } else {
      setLaunchMsg("Errore nel lancio del gioco");
    }
  };

  return (
    <div className="p-4 lg:p-0">
      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-r from-purple-600 via-violet-600 to-blue-600 p-6 lg:p-8 mb-5 relative overflow-hidden">
        <div className="absolute inset-0 bg-black/10" />
        <div className="relative">
          <h1 className="text-2xl lg:text-3xl font-black text-white mb-1">Casino</h1>
          <p className="text-white/70 text-sm">1,000+ giochi da top provider</p>
        </div>
        <span className="absolute right-6 top-1/2 -translate-y-1/2 text-6xl opacity-20">🎰</span>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cerca giochi..."
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
        />
      </div>

      {/* Categories */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar mb-3">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategory(c.id)}
            className={cn(
              "flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all",
              category === c.id
                ? "bg-brand text-white border-brand"
                : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Providers */}
      <div className="hidden lg:flex gap-2 mb-4">
        <button
          onClick={() => setProvider(null)}
          className={cn("px-3 py-1 rounded-lg text-[10px] font-semibold transition-all",
            !provider ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
          )}
        >Tutti</button>
        {PROVIDERS.map((p) => {
          const count = games.filter(g => g.provider === p).length;
          return (
            <button
              key={p}
              onClick={() => setProvider(provider === p ? null : p)}
              className={cn("px-3 py-1 rounded-lg text-[10px] font-semibold transition-all",
                provider === p ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              )}
            >{p} ({count})</button>
          );
        })}
      </div>

      {/* Games Grid */}
      <div className="grid grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {filtered.map((game) => (
          <div
            key={game.id}
            className="group cursor-pointer"
            onClick={() => setSelectedGame(game)}
          >
            <div className={cn(
              "relative rounded-xl aspect-square bg-gradient-to-br flex items-center justify-center overflow-hidden",
              game.color
            )}>
              <span className="text-4xl lg:text-5xl drop-shadow-lg group-hover:scale-110 transition-transform">{game.icon}</span>
              {game.hot && <span className="absolute top-2 left-2 bg-red-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded">HOT</span>}
              {game.new && <span className="absolute top-2 left-2 bg-emerald-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded">NEW</span>}
              {/* Hover overlay */}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <span className="text-white text-sm font-bold bg-white/20 backdrop-blur px-4 py-2 rounded-lg">▶ GIOCA</span>
              </div>
            </div>
            <div className="mt-1.5">
              <div className="text-xs font-semibold text-gray-800 truncate">{game.name}</div>
              <div className="text-[10px] text-gray-400">{game.provider}</div>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm">Nessun gioco trovato</div>
      )}

      {/* Game Modal */}
      {selectedGame && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setSelectedGame(null)}>
          <div className="bg-white rounded-2xl max-w-md w-full overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {/* Game header */}
            <div className={cn("bg-gradient-to-br p-8 text-center relative", selectedGame.color)}>
              <span className="text-7xl block mb-2">{selectedGame.icon}</span>
              <button onClick={() => setSelectedGame(null)} className="absolute top-3 right-3 text-white/60 hover:text-white text-lg">✕</button>
            </div>

            <div className="p-5">
              <h2 className="text-lg font-bold text-gray-900">{selectedGame.name}</h2>
              <p className="text-xs text-gray-400 mb-4">{selectedGame.provider} · {selectedGame.category.toUpperCase()}</p>

              {/* Game info */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                {selectedGame.rtp && (
                  <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                    <div className="text-[9px] text-gray-400 font-semibold">RTP</div>
                    <div className="text-sm font-bold text-gray-900">{selectedGame.rtp}%</div>
                  </div>
                )}
                {selectedGame.minBet && (
                  <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                    <div className="text-[9px] text-gray-400 font-semibold">MIN BET</div>
                    <div className="text-sm font-bold text-gray-900">${selectedGame.minBet}</div>
                  </div>
                )}
                {selectedGame.maxBet && (
                  <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                    <div className="text-[9px] text-gray-400 font-semibold">MAX BET</div>
                    <div className="text-sm font-bold text-gray-900">${selectedGame.maxBet}</div>
                  </div>
                )}
              </div>

              {/* Tags */}
              <div className="flex gap-2 mb-5">
                {selectedGame.hot && <span className="bg-red-50 text-red-500 text-[10px] font-bold px-2 py-1 rounded-lg">🔥 HOT</span>}
                {selectedGame.new && <span className="bg-emerald-50 text-emerald-500 text-[10px] font-bold px-2 py-1 rounded-lg">✨ NEW</span>}
                <span className="bg-gray-50 text-gray-500 text-[10px] font-bold px-2 py-1 rounded-lg capitalize">{selectedGame.category}</span>
              </div>

              {/* Launch msg */}
              {launchMsg && (
                <div className={cn("mb-3 px-3 py-2 rounded-lg text-xs text-center font-semibold",
                  launchMsg.includes("Errore") ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600"
                )}>{launchMsg}</div>
              )}

              {/* Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => handleLaunch(selectedGame, "demo")}
                  disabled={launching}
                  className="flex-1 py-3 rounded-xl border-2 border-gray-200 text-gray-700 text-sm font-bold hover:bg-gray-50 transition-colors"
                >
                  Demo
                </button>
                <button
                  onClick={() => handleLaunch(selectedGame, "real")}
                  disabled={launching || !user}
                  className={cn(
                    "flex-1 py-3 rounded-xl text-white text-sm font-bold transition-all",
                    launching ? "bg-gray-400" : "bg-brand hover:bg-brand-dark",
                    !user && "opacity-50"
                  )}
                >
                  {launching ? "⏳ Lancio..." : "▶ Gioca Ora"}
                </button>
              </div>
              {!user && <p className="text-[10px] text-gray-400 text-center mt-2">Accedi per giocare con soldi veri</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
