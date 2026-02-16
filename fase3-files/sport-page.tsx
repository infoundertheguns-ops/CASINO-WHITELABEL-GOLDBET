"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useSportsbook } from "@/lib/hooks/use-sportsbook";
import { useAuth } from "@/lib/hooks/use-auth";

const SPORTS = ["⚽ Calcio", "🏀 Basket", "🎾 Tennis", "🏐 Volley", "🏒 Hockey", "🏈 Football"];

export default function SportPage() {
  const { events, betslip, toggleBet, isSelected, clearBetslip, totalOdds, placeBet, placingBet } = useSportsbook();
  const { wallet, refreshWallet } = useAuth();
  const [activeSport, setActiveSport] = useState(0);
  const [stake, setStake] = useState("");
  const [showMobileBetslip, setShowMobileBetslip] = useState(false);
  const [betResult, setBetResult] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [activeFilter, setActiveFilter] = useState<"all" | "live" | "prematch">("all");

  const filteredEvents = events.filter((e) => {
    if (activeFilter === "live") return e.live;
    if (activeFilter === "prematch") return !e.live;
    return true;
  });

  const potentialWin = stake ? parseFloat(stake) * totalOdds : 0;

  const handlePlaceBet = async () => {
    if (!stake || parseFloat(stake) <= 0) return;
    setBetResult(null);
    const result = await placeBet(parseFloat(stake));
    if (result.success) {
      setBetResult({ type: "success", msg: "Scommessa piazzata!" });
      setStake("");
      refreshWallet();
      setTimeout(() => setBetResult(null), 4000);
    } else {
      setBetResult({ type: "error", msg: result.error || "Errore" });
    }
  };

  return (
    <div className="p-4 lg:p-0">
      <div className="lg:flex lg:gap-5">
        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold text-gray-900">Scommesse Sportive</h2>
            {wallet && (
              <span className="text-xs font-mono text-gray-400">
                Saldo: <span className="text-emerald-500 font-bold">${wallet.balance?.toFixed(2)}</span>
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mb-3">Live e prematch su calcio, basket, tennis e altri sport.</p>

          {/* Sport filter */}
          <div className="flex gap-2 overflow-x-auto no-scrollbar mb-3 pb-1">
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

          {/* Live / Prematch filter */}
          <div className="flex gap-1 mb-4">
            {([
              { id: "all", label: "Tutti", count: events.length },
              { id: "live", label: "🔴 Live", count: events.filter(e => e.live).length },
              { id: "prematch", label: "Prematch", count: events.filter(e => !e.live).length },
            ] as const).map((f) => (
              <button
                key={f.id}
                onClick={() => setActiveFilter(f.id)}
                className={cn(
                  "px-3 py-1 rounded-lg text-xs font-semibold transition-all",
                  activeFilter === f.id
                    ? "bg-gray-900 text-white"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                )}
              >
                {f.label} <span className="opacity-60">({f.count})</span>
              </button>
            ))}
          </div>

          {/* Events Table Header (desktop) */}
          <div className="hidden lg:grid lg:grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
            <span>Evento</span>
            <span className="w-[180px] text-center">1X2</span>
            <span className="w-[120px] text-center">O/U 2.5</span>
            <span className="w-[120px] text-center">GG/NG</span>
          </div>

          {/* Events */}
          <div className="space-y-2">
            {filteredEvents.map((e) => (
              <div
                key={e.id}
                className={cn(
                  "bg-white rounded-xl border p-3 lg:p-3 hover:shadow-sm transition-all",
                  e.live ? "border-red-200 bg-red-50/30" : "border-gray-200"
                )}
              >
                {/* Mobile Layout */}
                <div className="lg:hidden">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[10px] font-semibold text-gray-400 flex items-center gap-1">
                      {e.leagueIcon} {e.league}
                    </span>
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
                      <span className="text-sm font-black text-gray-800 bg-gray-100 px-2 py-0.5 rounded">{e.scoreH} - {e.scoreA}</span>
                    ) : (
                      <span className="text-xs text-gray-400">vs</span>
                    )}
                    <span className="text-sm font-bold text-gray-900">{e.away}</span>
                  </div>
                  {/* Markets */}
                  {e.markets.map((m) => (
                    <div key={m.name} className="mb-2 last:mb-0">
                      <div className="text-[9px] text-gray-400 font-semibold mb-1">{m.name}</div>
                      <div className={cn("grid gap-1.5", m.selections.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
                        {m.selections.map((s) => (
                          <button
                            key={s.label}
                            onClick={() => toggleBet(e, m.name, s)}
                            className={cn(
                              "py-1.5 rounded-lg text-center border transition-all",
                              isSelected(e.id, m.name, s.label)
                                ? "border-brand bg-brand/10 ring-1 ring-brand"
                                : "border-gray-200 bg-gray-50 hover:border-brand/50"
                            )}
                          >
                            <span className="text-[9px] text-gray-400 block">{s.label}</span>
                            <span className={cn("text-xs font-bold", isSelected(e.id, m.name, s.label) ? "text-brand" : "text-gray-900")}>
                              {s.odds.toFixed(2)}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop Layout — single row */}
                <div className="hidden lg:grid lg:grid-cols-[1fr_auto_auto_auto] lg:gap-2 lg:items-center">
                  {/* Event info */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex-shrink-0 text-center w-8">
                      {e.live ? (
                        <div>
                          <span className="block text-xs font-black text-red-500">{e.minute}'</span>
                          <span className="block text-[8px] text-red-400 font-bold">LIVE</span>
                        </div>
                      ) : (
                        <span className="text-[10px] text-gray-400">{e.time}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] text-gray-400 flex items-center gap-1 mb-0.5">
                        {e.leagueIcon} {e.league}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-gray-900 truncate">{e.home}</span>
                        {e.live ? (
                          <span className="text-xs font-black bg-gray-100 px-1.5 py-0.5 rounded">{e.scoreH}-{e.scoreA}</span>
                        ) : (
                          <span className="text-[10px] text-gray-300">vs</span>
                        )}
                        <span className="text-sm font-bold text-gray-900 truncate">{e.away}</span>
                      </div>
                    </div>
                  </div>

                  {/* 1X2 Market */}
                  <div className="flex gap-1 w-[180px]">
                    {e.markets[0]?.selections.map((s) => (
                      <button
                        key={s.label}
                        onClick={() => toggleBet(e, e.markets[0].name, s)}
                        className={cn(
                          "flex-1 py-2 rounded-lg text-center border transition-all",
                          isSelected(e.id, e.markets[0].name, s.label)
                            ? "border-brand bg-brand/10 ring-1 ring-brand"
                            : "border-gray-200 bg-gray-50 hover:border-brand/50 hover:bg-orange-50"
                        )}
                      >
                        <span className="text-[9px] text-gray-400 block">{s.label}</span>
                        <span className={cn("text-xs font-bold", isSelected(e.id, e.markets[0].name, s.label) ? "text-brand" : "text-gray-900")}>
                          {s.odds.toFixed(2)}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* O/U 2.5 Market */}
                  <div className="flex gap-1 w-[120px]">
                    {e.markets[1]?.selections.map((s) => (
                      <button
                        key={s.label}
                        onClick={() => toggleBet(e, e.markets[1].name, s)}
                        className={cn(
                          "flex-1 py-2 rounded-lg text-center border transition-all",
                          isSelected(e.id, e.markets[1].name, s.label)
                            ? "border-brand bg-brand/10 ring-1 ring-brand"
                            : "border-gray-200 bg-gray-50 hover:border-brand/50 hover:bg-orange-50"
                        )}
                      >
                        <span className="text-[9px] text-gray-400 block">{s.label}</span>
                        <span className={cn("text-xs font-bold", isSelected(e.id, e.markets[1].name, s.label) ? "text-brand" : "text-gray-900")}>
                          {s.odds.toFixed(2)}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* GG/NG Market */}
                  <div className="flex gap-1 w-[120px]">
                    {e.markets[2]?.selections.map((s) => (
                      <button
                        key={s.label}
                        onClick={() => toggleBet(e, e.markets[2].name, s)}
                        className={cn(
                          "flex-1 py-2 rounded-lg text-center border transition-all",
                          isSelected(e.id, e.markets[2].name, s.label)
                            ? "border-brand bg-brand/10 ring-1 ring-brand"
                            : "border-gray-200 bg-gray-50 hover:border-brand/50 hover:bg-orange-50"
                        )}
                      >
                        <span className="text-[9px] text-gray-400 block">{s.label}</span>
                        <span className={cn("text-xs font-bold", isSelected(e.id, e.markets[2].name, s.label) ? "text-brand" : "text-gray-900")}>
                          {s.odds.toFixed(2)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ═══ DESKTOP BETSLIP ═══ */}
        <div className="hidden lg:block w-80 flex-shrink-0">
          <div className="sticky top-20 bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="bg-gray-900 text-white px-4 py-3 flex justify-between items-center">
              <span className="text-sm font-bold">🎫 Schedina</span>
              <div className="flex items-center gap-2">
                {betslip.length > 0 && (
                  <>
                    <span className="bg-brand text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                      {betslip.length}
                    </span>
                    <button onClick={clearBetslip} className="text-gray-400 hover:text-white text-xs">✕</button>
                  </>
                )}
              </div>
            </div>

            {betslip.length === 0 ? (
              <div className="p-8 text-center">
                <span className="text-3xl block mb-2">🎯</span>
                <p className="text-sm text-gray-400">Clicca sulle quote per aggiungere selezioni</p>
              </div>
            ) : (
              <div className="p-3">
                <div className="max-h-[300px] overflow-y-auto space-y-0">
                  {betslip.map((b, i) => (
                    <div key={i} className="flex items-center justify-between py-2.5 border-b border-gray-100 last:border-0">
                      <div className="min-w-0 flex-1 mr-2">
                        <div className="text-xs font-semibold text-gray-800 truncate">{b.match}</div>
                        <div className="text-[10px] text-gray-400">{b.marketName}: {b.selection}</div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-sm font-bold text-brand font-mono">{b.odds.toFixed(2)}</span>
                        <button
                          onClick={() => toggleBet(
                            events.find(e => e.id === b.eventId)!,
                            b.marketName,
                            { label: b.selection, odds: b.odds }
                          )}
                          className="text-gray-300 hover:text-red-400 text-xs"
                        >✕</button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Multiple info */}
                {betslip.length > 1 && (
                  <div className="flex justify-between text-xs mt-2 pt-2 border-t border-gray-200">
                    <span className="text-gray-500">
                      {betslip.length === 2 ? "Doppia" : betslip.length === 3 ? "Tripla" : `Multipla (${betslip.length})`}
                    </span>
                    <span className="font-bold text-gray-900 font-mono">{totalOdds.toFixed(2)}</span>
                  </div>
                )}

                {/* Stake input */}
                <div className="mt-3">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input
                      type="number"
                      value={stake}
                      onChange={(e) => setStake(e.target.value)}
                      placeholder="Importo"
                      className="w-full pl-7 pr-3 py-2.5 rounded-lg border border-gray-200 text-sm font-mono focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                    />
                  </div>
                  <div className="flex gap-1.5 mt-1.5">
                    {[5, 10, 25, 50, 100].map((v) => (
                      <button key={v} onClick={() => setStake(String(v))}
                        className="flex-1 py-1 rounded bg-gray-100 text-[10px] font-bold text-gray-500 hover:bg-gray-200 transition-colors"
                      >${v}</button>
                    ))}
                  </div>
                </div>

                {/* Potential win */}
                {stake && parseFloat(stake) > 0 && (
                  <div className="flex justify-between items-center mt-3 pt-2 border-t border-gray-200">
                    <span className="text-xs text-gray-500">Vincita potenziale</span>
                    <span className="text-lg font-black text-emerald-500 font-mono">${potentialWin.toFixed(2)}</span>
                  </div>
                )}

                {/* Result messages */}
                {betResult && (
                  <div className={cn(
                    "mt-2 px-3 py-2 rounded-lg text-xs font-semibold text-center",
                    betResult.type === "success" ? "bg-emerald-50 text-emerald-600 border border-emerald-200" : "bg-red-50 text-red-600 border border-red-200"
                  )}>
                    {betResult.type === "success" ? "✅" : "❌"} {betResult.msg}
                  </div>
                )}

                {/* Place bet button */}
                <button
                  onClick={handlePlaceBet}
                  disabled={placingBet || !stake || parseFloat(stake) <= 0}
                  className={cn(
                    "w-full mt-3 py-3 rounded-xl text-white text-sm font-bold transition-all",
                    placingBet ? "bg-gray-400 cursor-wait" : "bg-brand hover:bg-brand-dark active:scale-[0.98]",
                    (!stake || parseFloat(stake) <= 0) && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {placingBet ? "⏳ Piazzando..." : "Piazza Scommessa"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ MOBILE BETSLIP FLOATING ═══ */}
      {betslip.length > 0 && (
        <div className="lg:hidden fixed bottom-20 left-1/2 -translate-x-1/2 max-w-[400px] w-[calc(100%-2rem)] z-40">
          <button
            onClick={() => setShowMobileBetslip(!showMobileBetslip)}
            className="w-full py-3 rounded-xl bg-brand text-white font-bold text-sm shadow-lg flex items-center justify-center gap-2"
          >
            🎫 Schedina ({betslip.length}) · Quota {totalOdds.toFixed(2)}
          </button>
        </div>
      )}

      {/* Mobile betslip overlay */}
      {showMobileBetslip && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/50" onClick={() => setShowMobileBetslip(false)}>
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[70vh] overflow-y-auto p-4"
               onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm font-bold">🎫 Schedina ({betslip.length})</span>
              <button onClick={() => setShowMobileBetslip(false)} className="text-gray-400">✕</button>
            </div>
            {betslip.map((b, i) => (
              <div key={i} className="flex justify-between py-2 border-b border-gray-100">
                <div>
                  <div className="text-xs font-semibold">{b.match}</div>
                  <div className="text-[10px] text-gray-400">{b.marketName}: {b.selection}</div>
                </div>
                <span className="text-sm font-bold text-brand">{b.odds.toFixed(2)}</span>
              </div>
            ))}
            <div className="flex justify-between text-xs mt-2 pt-2">
              <span>Quota totale</span>
              <span className="font-bold font-mono">{totalOdds.toFixed(2)}</span>
            </div>
            <div className="relative mt-3">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
              <input type="number" value={stake} onChange={(e) => setStake(e.target.value)}
                placeholder="Importo" className="w-full pl-7 pr-3 py-2.5 rounded-lg border border-gray-200 text-sm font-mono" />
            </div>
            {stake && parseFloat(stake) > 0 && (
              <div className="flex justify-between text-xs mt-2">
                <span className="text-gray-500">Vincita potenziale</span>
                <span className="font-bold text-emerald-500 font-mono">${potentialWin.toFixed(2)}</span>
              </div>
            )}
            {betResult && (
              <div className={cn("mt-2 px-3 py-2 rounded-lg text-xs text-center",
                betResult.type === "success" ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
              )}>{betResult.msg}</div>
            )}
            <button onClick={handlePlaceBet} disabled={placingBet || !stake}
              className="w-full mt-3 py-3 rounded-xl bg-brand text-white font-bold text-sm">
              {placingBet ? "⏳ Piazzando..." : "Piazza Scommessa"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
