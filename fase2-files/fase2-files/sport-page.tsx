"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const SPORTS = ["⚽ Calcio", "🏀 Basket", "🎾 Tennis", "🏐 Volley", "🏒 Hockey", "🏈 Football", "🏏 Cricket", "🥊 MMA"];

const EVENTS = [
  { id: 1, league: "Serie A", home: "Inter", away: "Juventus", time: "LIVE 72'", scoreH: 2, scoreA: 1, live: true, odds: [1.45, 4.50, 6.00] },
  { id: 2, league: "Serie A", home: "Milan", away: "Napoli", time: "20:45", live: false, odds: [2.10, 3.40, 3.20] },
  { id: 3, league: "Premier League", home: "Arsenal", away: "Liverpool", time: "21:00", live: false, odds: [2.30, 3.50, 2.90] },
  { id: 4, league: "La Liga", home: "Real Madrid", away: "Barcelona", time: "LIVE 34'", scoreH: 0, scoreA: 0, live: true, odds: [2.60, 3.20, 2.70] },
  { id: 5, league: "Bundesliga", home: "Bayern", away: "Dortmund", time: "18:30", live: false, odds: [1.65, 4.00, 4.80] },
  { id: 6, league: "Ligue 1", home: "PSG", away: "Marseille", time: "21:00", live: false, odds: [1.35, 5.50, 7.50] },
  { id: 7, league: "Champions League", home: "Man City", away: "Inter", time: "Domani 21:00", live: false, odds: [1.80, 3.60, 4.20] },
  { id: 8, league: "Champions League", home: "Real Madrid", away: "Bayern", time: "Domani 21:00", live: false, odds: [2.20, 3.40, 3.10] },
];

interface BetslipItem {
  eventId: number;
  selection: string;
  odds: number;
  label: string;
  match: string;
}

export default function SportPage() {
  const [activeSport, setActiveSport] = useState(0);
  const [betslip, setBetslip] = useState<BetslipItem[]>([]);
  const [stake, setStake] = useState("");
  const [showBetslip, setShowBetslip] = useState(false);

  const toggleBet = (eventId: number, selIdx: number, odds: number, match: string) => {
    const selection = ["1", "X", "2"][selIdx];
    const key = `${eventId}-${selection}`;
    const exists = betslip.find((b) => b.eventId === eventId && b.selection === selection);

    if (exists) {
      setBetslip(betslip.filter((b) => !(b.eventId === eventId && b.selection === selection)));
    } else {
      // Remove other selections for same event
      const filtered = betslip.filter((b) => b.eventId !== eventId);
      filtered.push({ eventId, selection, odds, label: selection, match });
      setBetslip(filtered);
    }
  };

  const isSelected = (eventId: number, selIdx: number) => {
    const selection = ["1", "X", "2"][selIdx];
    return betslip.some((b) => b.eventId === eventId && b.selection === selection);
  };

  const totalOdds = betslip.reduce((acc, b) => acc * b.odds, 1);
  const potentialWin = stake ? parseFloat(stake) * totalOdds : 0;

  return (
    <div className="p-4 lg:p-0">
      <div className="lg:flex lg:gap-6">
        {/* Main content */}
        <div className="flex-1">
          <h2 className="text-lg font-bold text-gray-900 mb-1">Scommesse Sportive</h2>
          <p className="text-xs text-gray-500 mb-3">Live e prematch su calcio, basket, tennis e altri sport.</p>

          {/* Sport filter */}
          <div className="flex gap-2 overflow-x-auto no-scrollbar mb-4 pb-1">
            {SPORTS.map((s, i) => (
              <button
                key={s}
                onClick={() => setActiveSport(i)}
                className={cn(
                  "flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all",
                  activeSport === i
                    ? "bg-brand text-white border-brand"
                    : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
                )}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Events */}
          <div className="lg:grid lg:grid-cols-2 lg:gap-3 space-y-2.5 lg:space-y-0">
            {EVENTS.map((e) => (
              <div key={e.id} className="bg-white rounded-xl border border-gray-200 p-3 hover:shadow-sm transition-shadow">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] font-semibold text-gray-400">{e.league}</span>
                  <span className={cn("text-[10px] font-bold flex items-center gap-1",
                    e.live ? "text-red-500" : "text-gray-400"
                  )}>
                    {e.live && <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />}
                    {e.time}
                  </span>
                </div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-bold text-gray-900">{e.home}</span>
                  {e.live ? (
                    <span className="text-sm font-black text-gray-800 bg-gray-100 px-2 py-0.5 rounded">
                      {e.scoreH} - {e.scoreA}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">vs</span>
                  )}
                  <span className="text-sm font-bold text-gray-900">{e.away}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {["1", "X", "2"].map((label, j) => (
                    <button
                      key={j}
                      onClick={() => toggleBet(e.id, j, e.odds[j], `${e.home} vs ${e.away}`)}
                      className={cn(
                        "py-2 rounded-lg text-center border transition-all",
                        isSelected(e.id, j)
                          ? "border-brand bg-brand/10 ring-1 ring-brand"
                          : "border-gray-200 bg-gray-50 hover:border-brand/50 hover:bg-orange-50"
                      )}
                    >
                      <span className="text-[10px] text-gray-400 block">{label}</span>
                      <span className={cn("text-sm font-bold", isSelected(e.id, j) ? "text-brand" : "text-gray-900")}>
                        {e.odds[j].toFixed(2)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Desktop Betslip Sidebar */}
        <div className="hidden lg:block w-80 flex-shrink-0">
          <div className="sticky top-20 bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="bg-gray-900 text-white px-4 py-3 flex justify-between items-center">
              <span className="text-sm font-bold">🎫 Schedina</span>
              {betslip.length > 0 && (
                <span className="bg-brand text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                  {betslip.length}
                </span>
              )}
            </div>

            {betslip.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400">
                Clicca sulle quote per aggiungere selezioni
              </div>
            ) : (
              <div className="p-3">
                {betslip.map((b, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                    <div>
                      <div className="text-xs font-semibold text-gray-800">{b.match}</div>
                      <div className="text-[10px] text-gray-400">Esito: {b.label}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-brand">{b.odds.toFixed(2)}</span>
                      <button
                        onClick={() => setBetslip(betslip.filter((_, idx) => idx !== i))}
                        className="text-gray-300 hover:text-red-400 text-xs"
                      >✕</button>
                    </div>
                  </div>
                ))}

                {betslip.length > 1 && (
                  <div className="flex justify-between text-xs mt-2 pt-2 border-t border-gray-200">
                    <span className="text-gray-500">Quota totale</span>
                    <span className="font-bold text-gray-900 font-mono">{totalOdds.toFixed(2)}</span>
                  </div>
                )}

                <div className="mt-3">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">€</span>
                    <input
                      type="number"
                      value={stake}
                      onChange={(e) => setStake(e.target.value)}
                      placeholder="Importo"
                      className="input-player pl-7 font-mono text-sm"
                    />
                  </div>
                  <div className="flex gap-1.5 mt-1.5">
                    {[5, 10, 25, 50].map((v) => (
                      <button key={v} onClick={() => setStake(String(v))}
                        className="flex-1 py-1 rounded bg-gray-100 text-[10px] font-bold text-gray-500 hover:bg-gray-200"
                      >€{v}</button>
                    ))}
                  </div>
                </div>

                {stake && parseFloat(stake) > 0 && (
                  <div className="flex justify-between text-xs mt-3 pt-2 border-t border-gray-200">
                    <span className="text-gray-500">Vincita potenziale</span>
                    <span className="font-bold text-emerald-500 font-mono">€{potentialWin.toFixed(2)}</span>
                  </div>
                )}

                <button className="w-full mt-3 py-2.5 rounded-lg bg-brand text-white text-sm font-bold hover:bg-brand-dark transition-colors">
                  Piazza Scommessa
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Betslip Floating Button */}
      {betslip.length > 0 && (
        <div className="lg:hidden fixed bottom-20 left-1/2 -translate-x-1/2 max-w-[400px] w-[calc(100%-2rem)] z-40">
          <button
            onClick={() => setShowBetslip(!showBetslip)}
            className="w-full py-3 rounded-xl bg-brand text-white font-bold text-sm shadow-lg flex items-center justify-center gap-2"
          >
            🎫 Schedina ({betslip.length}) · Quota {totalOdds.toFixed(2)}
            {stake && parseFloat(stake) > 0 && ` · Vinci €${potentialWin.toFixed(2)}`}
          </button>
        </div>
      )}
    </div>
  );
}
