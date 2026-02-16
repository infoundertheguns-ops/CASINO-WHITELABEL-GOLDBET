"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/hooks/use-auth";
import { useSportsbook } from "@/lib/hooks/use-sportsbook";
// Types are used via the hook's return values

export default function EventDetail() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const {
    allEvents,
    loading,
    isMockData,
    betslip,
    placingBet,
    toggleBet,
    isSelected,
    clearBetslip,
    totalOdds,
    placeBet,
  } = useSportsbook();

  const [stake, setStake] = useState(10);
  const [msg, setMsg] = useState("");

  // ── Find event by ID ──
  const ev = useMemo(
    () => allEvents.find((e) => e.id === params?.id),
    [allEvents, params?.id]
  );

  // ── Loading skeleton ──
  if (loading) {
    return (
      <div className="p-4 lg:p-0 animate-pulse">
        <div className="h-4 w-32 bg-gray-200 rounded mb-3" />
        <div className="h-40 bg-gray-200 rounded-2xl mb-5" />
        <div className="lg:flex lg:gap-5">
          <div className="flex-1 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 bg-gray-200 rounded-xl" />
            ))}
          </div>
          <div className="lg:w-72 mt-5 lg:mt-0">
            <div className="h-64 bg-gray-200 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  // ── Event not found ──
  if (!ev) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-400 mb-3">Evento non trovato</p>
        <button
          onClick={() => router.push("/sport")}
          className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-bold"
        >
          ← Sport
        </button>
      </div>
    );
  }

  // ── Place bet handler ──
  const handlePlaceBet = async () => {
    if (betslip.length === 0 || stake <= 0) return;
    setMsg("");
    const result = await placeBet(stake);
    if (result.success) {
      if (result.flagged) {
        setMsg("⚠️ Scommessa piazzata — in verifica dal sistema di sicurezza");
      } else {
        setMsg("✅ Scommessa piazzata!");
      }
      setTimeout(() => setMsg(""), 4000);
    } else {
      setMsg(`❌ ${result.error}`);
    }
  };

  // ── Market grouping helpers ──
  // Group markets that share a marketType (e.g. multiple O/U lines) under one header
  const marketGroups = ev.markets.map((m) => ({
    market: m,
    displayName: m.name || m.marketType || "Mercato",
  }));

  return (
    <div className="p-4 lg:p-0">
      {/* Mock data banner */}
      {isMockData && (
        <div className="mb-4 px-4 py-2 rounded-xl bg-yellow-50 border border-yellow-200 text-yellow-700 text-xs font-medium text-center">
          ⚠️ Dati demo — Connetti Supabase per dati reali
        </div>
      )}

      {/* Back link */}
      <button
        onClick={() => router.push("/sport")}
        className="text-xs text-gray-400 hover:text-brand mb-3 flex items-center gap-1"
      >
        ← Tutti gli eventi
      </button>

      {/* Event header */}
      <div
        className={cn(
          "rounded-2xl p-6 mb-5 relative overflow-hidden",
          ev.live
            ? "bg-gradient-to-r from-red-600 to-red-500"
            : "bg-gradient-to-r from-gray-800 to-gray-700"
        )}
      >
        {ev.live && (
          <div className="absolute top-3 right-3 flex items-center gap-1.5">
            <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
            <span className="text-white text-[10px] font-bold">
              {ev.minute}&apos;
            </span>
          </div>
        )}
        <div className="text-[10px] text-white/60 mb-3">{ev.league}</div>
        <div className="flex items-center justify-center gap-6">
          <div className="text-lg font-black text-white">{ev.home}</div>
          {ev.live ? (
            <div className="text-center">
              <div className="text-3xl font-black text-white">
                {ev.scoreH} - {ev.scoreA}
              </div>
              <div className="text-[10px] text-white/60">LIVE</div>
            </div>
          ) : (
            <div className="text-center">
              <div className="text-sm font-bold text-white/60">VS</div>
              <div className="text-[10px] text-white/40">{ev.time}</div>
            </div>
          )}
          <div className="text-lg font-black text-white">{ev.away}</div>
        </div>
      </div>

      <div className="lg:flex lg:gap-5">
        {/* ── Markets column ── */}
        <div className="flex-1">
          <h2 className="text-sm font-bold text-gray-900 mb-3">
            Mercati ({marketGroups.length})
          </h2>

          {marketGroups.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <p className="text-gray-400 text-sm">
                Nessun mercato disponibile
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {marketGroups.map(({ market, displayName }) => (
                <div
                  key={market.id || market.name}
                  className="bg-white rounded-xl border border-gray-200 overflow-hidden"
                >
                  <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                    <span className="text-xs font-bold text-gray-700">
                      {displayName}
                    </span>
                  </div>
                  <div
                    className={cn(
                      "p-3 gap-2",
                      market.selections.length <= 3
                        ? "flex"
                        : "grid grid-cols-3 lg:grid-cols-4"
                    )}
                  >
                    {market.selections.map((sel) => {
                      const selected = isSelected(
                        ev.id,
                        market.name,
                        sel.label
                      );
                      const oddsUp =
                        sel.previousOdds !== undefined &&
                        sel.odds > sel.previousOdds;
                      const oddsDown =
                        sel.previousOdds !== undefined &&
                        sel.odds < sel.previousOdds;

                      return (
                        <button
                          key={sel.id || sel.label}
                          onClick={() => toggleBet(ev, market.name, sel)}
                          className={cn(
                            "flex-1 py-2.5 px-2 rounded-lg text-center border-2 transition-all min-w-0",
                            selected
                              ? "border-brand bg-brand/10 ring-1 ring-brand"
                              : "border-gray-200 hover:border-gray-300"
                          )}
                        >
                          <div className="text-[10px] text-gray-500 truncate">
                            {sel.label}
                          </div>
                          <div
                            className={cn(
                              "text-sm font-bold font-mono",
                              selected
                                ? "text-brand"
                                : oddsUp
                                  ? "text-emerald-500"
                                  : oddsDown
                                    ? "text-red-500"
                                    : "text-gray-900"
                            )}
                          >
                            {sel.odds.toFixed(2)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Betslip sidebar ── */}
        <div className="lg:w-72 mt-5 lg:mt-0">
          <div className="bg-white rounded-xl border border-gray-200 p-4 lg:sticky lg:top-20">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-bold text-gray-900">
                🎫 Schedina
              </span>
              {betslip.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="bg-brand text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    {betslip.length}
                  </span>
                  <button
                    onClick={clearBetslip}
                    className="text-[10px] text-gray-400 hover:text-red-400"
                  >
                    Svuota
                  </button>
                </div>
              )}
            </div>

            {betslip.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">
                Clicca una quota per aggiungerla
              </p>
            ) : (
              <>
                {betslip.map((b, i) => {
                  const bEvent = allEvents.find((e) => e.id === b.eventId);
                  return (
                    <div
                      key={i}
                      className="flex justify-between items-start py-2 border-b border-gray-100 last:border-0"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] text-gray-800 font-medium truncate">
                          {b.match}
                        </div>
                        <div className="text-[9px] text-gray-400">
                          {b.marketName}: {b.selection}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-brand">
                          {b.odds.toFixed(2)}
                        </span>
                        {bEvent && (
                          <button
                            onClick={() => {
                              const market = bEvent.markets.find(
                                (m) => m.name === b.marketName
                              );
                              const sel = market?.selections.find(
                                (s) => s.label === b.selection
                              );
                              if (sel) toggleBet(bEvent, b.marketName, sel);
                            }}
                            className="text-gray-400 hover:text-red-400 text-xs"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {betslip.length > 1 && (
                  <div className="flex justify-between py-2 border-t border-gray-200 mt-1">
                    <span className="text-[10px] text-gray-400">
                      Multipla ({betslip.length})
                    </span>
                    <span className="text-xs font-bold text-gray-900">
                      {totalOdds.toFixed(2)}
                    </span>
                  </div>
                )}

                {/* Stake input */}
                <div className="mt-3 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                    $
                  </span>
                  <input
                    type="number"
                    value={stake}
                    onChange={(e) => setStake(+e.target.value || 0)}
                    className="w-full pl-7 pr-3 py-2 rounded-lg border border-gray-200 text-sm font-mono focus:outline-none focus:border-brand"
                  />
                </div>
                <div className="flex gap-1 mt-1.5">
                  {[5, 10, 25, 50, 100].map((v) => (
                    <button
                      key={v}
                      onClick={() => setStake(v)}
                      className="flex-1 py-1 rounded bg-gray-100 text-[10px] font-bold text-gray-500 hover:bg-gray-200"
                    >
                      ${v}
                    </button>
                  ))}
                </div>

                {/* Potential win */}
                <div className="flex justify-between items-center mt-3 mb-2">
                  <span className="text-xs text-gray-400">Vincita</span>
                  <span className="text-lg font-black text-emerald-500 font-mono">
                    ${(stake * totalOdds).toFixed(2)}
                  </span>
                </div>

                {/* Messages */}
                {msg && (
                  <div
                    className={cn(
                      "mb-2 px-3 py-1.5 rounded-lg text-xs text-center font-semibold",
                      msg.startsWith("✅")
                        ? "bg-emerald-50 text-emerald-600"
                        : msg.startsWith("⚠️")
                          ? "bg-yellow-50 text-yellow-700"
                          : "bg-red-50 text-red-600"
                    )}
                  >
                    {msg}
                  </div>
                )}

                {!user && (
                  <p className="text-[10px] text-red-500 text-center mb-2">
                    Accedi per scommettere
                  </p>
                )}

                <button
                  onClick={handlePlaceBet}
                  disabled={placingBet || !user || stake <= 0}
                  className={cn(
                    "w-full py-2.5 rounded-xl text-white text-sm font-bold",
                    placingBet || !user
                      ? "bg-gray-400"
                      : "bg-brand hover:bg-brand-dark"
                  )}
                >
                  {placingBet ? "⏳..." : "Piazza Scommessa"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
