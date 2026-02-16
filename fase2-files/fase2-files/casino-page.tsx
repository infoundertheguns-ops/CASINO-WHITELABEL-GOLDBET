"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const CATEGORIES = ["🔥 Popolari", "🎰 Slot", "🃏 Live Casino", "🎲 Table Games", "🚀 Crash", "⭐ Preferiti"];

const PROVIDERS = [
  { name: "Pragmatic Play", games: 156 },
  { name: "Evolution", games: 89 },
  { name: "Play'n GO", games: 134 },
  { name: "Hacksaw Gaming", games: 67 },
  { name: "NoLimit City", games: 52 },
  { name: "Spribe", games: 12 },
  { name: "Evoplay", games: 98 },
];

const GAMES = [
  { name: "Sweet Bonanza", provider: "Pragmatic Play", category: "slot", color: "from-pink-500 to-orange-400", icon: "🍬", hot: true, new: false },
  { name: "Gates of Olympus", provider: "Pragmatic Play", category: "slot", color: "from-yellow-500 to-blue-500", icon: "⚡", hot: true, new: false },
  { name: "Crazy Time", provider: "Evolution", category: "live", color: "from-yellow-400 to-red-500", icon: "🎡", hot: true, new: false },
  { name: "Aviator", provider: "Spribe", category: "crash", color: "from-red-600 to-red-400", icon: "✈️", hot: true, new: false },
  { name: "Lightning Roulette", provider: "Evolution", category: "live", color: "from-yellow-500 to-amber-600", icon: "⚡", hot: false, new: false },
  { name: "Sugar Rush", provider: "Pragmatic Play", category: "slot", color: "from-pink-400 to-purple-500", icon: "🧁", hot: false, new: true },
  { name: "Big Bass Splash", provider: "Pragmatic Play", category: "slot", color: "from-blue-500 to-teal-400", icon: "🐟", hot: false, new: false },
  { name: "Starlight Princess", provider: "Pragmatic Play", category: "slot", color: "from-purple-500 to-pink-400", icon: "👸", hot: false, new: false },
  { name: "Book of Dead", provider: "Play'n GO", category: "slot", color: "from-yellow-700 to-amber-500", icon: "📖", hot: false, new: false },
  { name: "Wanted Dead or Wild", provider: "Hacksaw Gaming", category: "slot", color: "from-amber-700 to-orange-500", icon: "🤠", hot: false, new: true },
  { name: "Mental", provider: "NoLimit City", category: "slot", color: "from-gray-800 to-purple-900", icon: "🧠", hot: false, new: true },
  { name: "Monopoly Live", provider: "Evolution", category: "live", color: "from-green-600 to-emerald-400", icon: "🎩", hot: false, new: false },
  { name: "Mines", provider: "Spribe", category: "crash", color: "from-gray-700 to-gray-500", icon: "💣", hot: false, new: false },
  { name: "Plinko", provider: "Spribe", category: "crash", color: "from-blue-600 to-cyan-400", icon: "⚪", hot: false, new: false },
  { name: "Dice", provider: "Spribe", category: "crash", color: "from-green-500 to-emerald-400", icon: "🎲", hot: false, new: false },
];

export default function CasinoPage() {
  const [activeCategory, setActiveCategory] = useState(0);
  const [search, setSearch] = useState("");

  const filteredGames = GAMES.filter((g) => {
    if (search) return g.name.toLowerCase().includes(search.toLowerCase());
    if (activeCategory === 0) return true; // Popolari = all hot first
    if (activeCategory === 1) return g.category === "slot";
    if (activeCategory === 2) return g.category === "live";
    if (activeCategory === 3) return g.category === "table";
    if (activeCategory === 4) return g.category === "crash";
    return true;
  });

  return (
    <div className="p-4 lg:p-0">
      {/* Hero banner */}
      <div className="bg-gradient-to-r from-purple-600 via-violet-600 to-indigo-600 rounded-2xl p-5 lg:p-8 mb-4 text-white relative overflow-hidden">
        <div className="relative z-10">
          <h1 className="text-xl lg:text-2xl font-black">Casino</h1>
          <p className="text-sm opacity-80 mt-1">1,000+ giochi da top provider</p>
        </div>
        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-6xl opacity-20">🎰</span>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Cerca giochi..."
          className="input-player"
        />
      </div>

      {/* Categories */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar mb-4 pb-1">
        {CATEGORIES.map((c, i) => (
          <button
            key={c}
            onClick={() => { setActiveCategory(i); setSearch(""); }}
            className={cn(
              "flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all",
              activeCategory === i
                ? "bg-purple-500 text-white border-purple-500"
                : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
            )}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Providers bar (desktop) */}
      <div className="hidden lg:flex gap-2 mb-4 overflow-x-auto no-scrollbar">
        {PROVIDERS.map((p) => (
          <button
            key={p.name}
            className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-xs font-medium text-gray-600 hover:border-purple-300 hover:text-purple-600 transition-colors"
          >
            {p.name} <span className="text-gray-400">({p.games})</span>
          </button>
        ))}
      </div>

      {/* Games Grid */}
      <div className="grid grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-2.5 lg:gap-3">
        {filteredGames.map((g, i) => (
          <button
            key={i}
            className="rounded-xl overflow-hidden bg-white border border-gray-200 text-left group hover:shadow-md hover:scale-[1.02] transition-all"
          >
            <div className={cn("h-24 lg:h-32 bg-gradient-to-br flex items-center justify-center text-3xl lg:text-4xl relative", g.color)}>
              {g.icon}
              {g.hot && (
                <span className="absolute top-1.5 left-1.5 bg-red-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded">
                  HOT
                </span>
              )}
              {g.new && (
                <span className="absolute top-1.5 left-1.5 bg-emerald-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded">
                  NEW
                </span>
              )}
              {/* Play overlay on hover */}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <span className="bg-white text-gray-900 text-xs font-bold px-4 py-2 rounded-lg">▶ GIOCA</span>
              </div>
            </div>
            <div className="p-2">
              <div className="text-[11px] font-bold text-gray-800 truncate">{g.name}</div>
              <div className="text-[9px] text-gray-400">{g.provider}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
