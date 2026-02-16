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

  const OddsBtn = ({ eventId, marketName, label, odds }: { eventId: string; marketName: string; label: string; odds: number }) => {
    const event = events.find(e => e.id === eventId)!;
    const market = event.markets.find(m => m.name === marketName)!;
    const sel = market.selections.find(s => s.label === label)!;
    const active = isSelected(eventId, marketName, label);
    return (
      <button
        onClick={() => toggleBet(event, marketName, sel)}
        className={cn(
          "px-2 py-1.5 rounded text-center border text-xs font-bold transition-all min-w-[52px]",
          active
            ? "border-brand bg-brand/10 text-brand ring-1 ring-brand"
            : "border-gray-200 bg-gray-50 text-gray-800 hover:border-brand/50 hover:bg-orange-50"
        )}
      >
        {odds.toFixed(2)}
      </button>
    );
  };

  return (
    <div className="p-4 lg:p-0">
      <div className="lg:flex lg:gap-4">
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

          {/* Sport pills */}
          <div className="flex gap-2 overflow-x-auto no-scrollbar mb-3 pb-1">
            {SPORTS.map((s, i) => (
              <button key={s} onClick={() => setActiveSport(i)}
                className={cn("flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all",
                  activeSport === i ? "bg-brand text-white border-brand" : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
                )}>{s}</button>
            ))}
          </div>

          {/* Filter */}
          <div className="flex gap-1 mb-3">
            {([
              { id: "all", label: "Tutti", count: events.length },
              { id: "live", label: "🔴 Live", count: events.filter(e => e.live).length },
              { id: "prematch", label: "Prematch", count: events.filter(e => !e.live).length },
            ] as const).map((f) => (
              <button key={f.id} onClick={() => setActiveFilter(f.id)}
                className={cn("px-3 py-1 rounded-lg text-xs font-semibold transition-all",
                  activeFilter === f.id ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                )}>{f.label} ({f.count})</button>
            ))}
          </div>

          {/* ═══ DESKTOP TABLE ═══ */}
          <div className="hidden lg:block">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_repeat(7,52px)] gap-1 px-3 py-2 text-[9px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-200">
              <span>Evento</span>
              <span className="text-center">1</span>
              <span className="text-center">X</span>
              <span className="text-center">2</span>
              <span className="text-center">O</span>
              <span className="text-center">U</span>
              <span className="text-center">GG</span>
              <span className="text-center">NG</span>
            </div>

            {/* Rows */}
            {filteredEvents.map((e) => (
              <div key={e.id} className={cn(
                "grid grid-cols-[1fr_repeat(7,52px)] gap-1 items-center px-3 py-2 border-b border-gray-100 hover:bg-gray-50/50 transition-colors",
                e.live && "bg-red-50/40"
              )}>
                {/* Event info */}
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex-shrink-0 w-10 text-center">
                    {e.live ? (
                      <div>
                        <span className="text-[10px] font-black text-red-500 block">{e.minute}'</span>
                        <span className="text-[7px] bg-red-500 text-white px-1 rounded font-bold">LIVE</span>
                      </div>
                    ) : (
                      <span className="text-[10px] text-gray-400 font-medium">{e.time}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[9px] text-gray-400 flex items-center gap-0.5">{e.leagueIcon} {e.league}</div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-gray-900 truncate">{e.home}</span>
                      {e.live ? (
                        <span className="text-[10px] font-black bg-gray-200 px-1 rounded">{e.scoreH}-{e.scoreA}</span>
                      ) : (
                        <span className="text-[9px] text-gray-300">-</span>
                      )}
                      <span className="text-xs font-bold text-gray-900 truncate">{e.away}</span>
                    </div>
                  </div>
                </div>

                {/* 1X2 */}
                <OddsBtn eventId={e.id} marketName="1X2" label="1" odds={e.markets[0].selections[0].odds} />
                <OddsBtn eventId={e.id} marketName="1X2" label="X" odds={e.markets[0].selections[1].odds} />
                <OddsBtn eventId={e.id} marketName="1X2" label="2" odds={e.markets[0].selections[2].odds} />
                {/* O/U */}
                <OddsBtn eventId={e.id} marketName="O/U 2.5" label="Over" odds={e.markets[1].selections[0].odds} />
                <OddsBtn eventId={e.id} marketName="O/U 2.5" label="Under" odds={e.markets[1].selections[1].odds} />
                {/* GG/NG */}
                <OddsBtn eventId={e.id} marketName="GG/NG" label="GG" odds={e.markets[2].selections[0].odds} />
                <OddsBtn eventId={e.id} marketName="GG/NG" label="NG" odds={e.markets[2].selections[1].odds} />
              </div>
            ))}
          </div>

          {/* ═══ MOBILE CARDS ═══ */}
          <div className="lg:hidden space-y-2.5">
            {filteredEvents.map((e) => (
              <div key={e.id} className={cn("bg-white rounded-xl border p-3", e.live ? "border-red-200 bg-red-50/30" : "border-gray-200")}>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] font-semibold text-gray-400">{e.leagueIcon} {e.league}</span>
                  <span className={cn("text-[10px] font-bold flex items-center gap-1", e.live ? "text-red-500" : "text-gray-400")}>
                    {e.live && <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />}
                    {e.time}
                  </span>
                </div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-bold text-gray-900">{e.home}</span>
                  {e.live ? <span className="text-sm font-black bg-gray-100 px-2 py-0.5 rounded">{e.scoreH}-{e.scoreA}</span> : <span className="text-xs text-gray-400">vs</span>}
                  <span className="text-sm font-bold text-gray-900">{e.away}</span>
                </div>
                {e.markets.map((m) => (
                  <div key={m.name} className="mb-2 last:mb-0">
                    <div className="text-[9px] text-gray-400 font-semibold mb-1">{m.name}</div>
                    <div className={cn("grid gap-1.5", m.selections.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
                      {m.selections.map((s) => (
                        <button key={s.label} onClick={() => toggleBet(e, m.name, s)}
                          className={cn("py-1.5 rounded-lg text-center border transition-all",
                            isSelected(e.id, m.name, s.label) ? "border-brand bg-brand/10 ring-1 ring-brand" : "border-gray-200 bg-gray-50 hover:border-brand/50"
                          )}>
                          <span className="text-[9px] text-gray-400 block">{s.label}</span>
                          <span className={cn("text-xs font-bold", isSelected(e.id, m.name, s.label) ? "text-brand" : "text-gray-900")}>{s.odds.toFixed(2)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* ═══ DESKTOP BETSLIP ═══ */}
        <div className="hidden lg:block w-72 flex-shrink-0">
          <div className="sticky top-20 bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="bg-gray-900 text-white px-4 py-3 flex justify-between items-center">
              <span className="text-sm font-bold">🎫 Schedina</span>
              {betslip.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="bg-brand text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{betslip.length}</span>
                  <button onClick={clearBetslip} className="text-gray-400 hover:text-white text-xs">✕</button>
                </div>
              )}
            </div>
            {betslip.length === 0 ? (
              <div className="p-6 text-center">
                <span className="text-2xl block mb-1">🎯</span>
                <p className="text-xs text-gray-400">Clicca sulle quote</p>
              </div>
            ) : (
              <div className="p-3">
                <div className="max-h-[280px] overflow-y-auto">
                  {betslip.map((b, i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                      <div className="min-w-0 flex-1 mr-2">
                        <div className="text-[11px] font-semibold text-gray-800 truncate">{b.match}</div>
                        <div className="text-[9px] text-gray-400">{b.marketName}: {b.selection}</div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="text-xs font-bold text-brand font-mono">{b.odds.toFixed(2)}</span>
                        <button onClick={() => {
                          const ev = events.find(e => e.id === b.eventId)!;
                          toggleBet(ev, b.marketName, { label: b.selection, odds: b.odds });
                        }} className="text-gray-300 hover:text-red-400 text-[10px]">✕</button>
                      </div>
                    </div>
                  ))}
                </div>
                {betslip.length > 1 && (
                  <div className="flex justify-between text-xs mt-2 pt-2 border-t border-gray-200">
                    <span className="text-gray-500">{betslip.length === 2 ? "Doppia" : betslip.length === 3 ? "Tripla" : `Multipla (${betslip.length})`}</span>
                    <span className="font-bold font-mono">{totalOdds.toFixed(2)}</span>
                  </div>
                )}
                <div className="mt-3">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                    <input type="number" value={stake} onChange={(e) => setStake(e.target.value)} placeholder="Importo"
                      className="w-full pl-6 pr-3 py-2 rounded-lg border border-gray-200 text-xs font-mono focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand" />
                  </div>
                  <div className="flex gap-1 mt-1.5">
                    {[5, 10, 25, 50, 100].map((v) => (
                      <button key={v} onClick={() => setStake(String(v))}
                        className="flex-1 py-1 rounded bg-gray-100 text-[9px] font-bold text-gray-500 hover:bg-gray-200">${v}</button>
                    ))}
                  </div>
                </div>
                {stake && parseFloat(stake) > 0 && (
                  <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-200">
                    <span className="text-[10px] text-gray-500">Vincita</span>
                    <span className="text-base font-black text-emerald-500 font-mono">${potentialWin.toFixed(2)}</span>
                  </div>
                )}
                {betResult && (
                  <div className={cn("mt-2 px-2 py-1.5 rounded text-[10px] font-semibold text-center",
                    betResult.type === "success" ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
                  )}>{betResult.msg}</div>
                )}
                <button onClick={handlePlaceBet} disabled={placingBet || !stake || parseFloat(stake) <= 0}
                  className={cn("w-full mt-2 py-2.5 rounded-xl text-white text-sm font-bold transition-all",
                    placingBet ? "bg-gray-400" : "bg-brand hover:bg-brand-dark",
                    (!stake || parseFloat(stake) <= 0) && "opacity-50"
                  )}>{placingBet ? "⏳ Piazzando..." : "Piazza Scommessa"}</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile floating betslip */}
      {betslip.length > 0 && (
        <div className="lg:hidden fixed bottom-20 left-1/2 -translate-x-1/2 max-w-[400px] w-[calc(100%-2rem)] z-40">
          <button onClick={() => setShowMobileBetslip(!showMobileBetslip)}
            className="w-full py-3 rounded-xl bg-brand text-white font-bold text-sm shadow-lg flex items-center justify-center gap-2">
            🎫 ({betslip.length}) · {totalOdds.toFixed(2)}
          </button>
        </div>
      )}

      {showMobileBetslip && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/50" onClick={() => setShowMobileBetslip(false)}>
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[70vh] overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm font-bold">🎫 Schedina ({betslip.length})</span>
              <button onClick={() => setShowMobileBetslip(false)} className="text-gray-400">✕</button>
            </div>
            {betslip.map((b, i) => (
              <div key={i} className="flex justify-between py-2 border-b border-gray-100">
                <div><div className="text-xs font-semibold">{b.match}</div><div className="text-[10px] text-gray-400">{b.marketName}: {b.selection}</div></div>
                <span className="text-sm font-bold text-brand">{b.odds.toFixed(2)}</span>
              </div>
            ))}
            <div className="flex justify-between text-xs mt-2"><span>Quota</span><span className="font-bold font-mono">{totalOdds.toFixed(2)}</span></div>
            <input type="number" value={stake} onChange={(e) => setStake(e.target.value)} placeholder="$ Importo"
              className="w-full mt-3 px-3 py-2.5 rounded-lg border border-gray-200 text-sm font-mono" />
            {stake && parseFloat(stake) > 0 && (
              <div className="flex justify-between text-xs mt-2"><span className="text-gray-500">Vincita</span><span className="font-bold text-emerald-500">${potentialWin.toFixed(2)}</span></div>
            )}
            <button onClick={handlePlaceBet} disabled={placingBet || !stake}
              className="w-full mt-3 py-3 rounded-xl bg-brand text-white font-bold text-sm">{placingBet ? "⏳" : "Piazza Scommessa"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
