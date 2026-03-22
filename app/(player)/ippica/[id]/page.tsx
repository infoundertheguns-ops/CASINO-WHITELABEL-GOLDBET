"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useIppicaRace } from "@/lib/hooks/use-ippica";
import { useAuth } from "@/lib/hooks/use-auth";
import { RaceHeader } from "@/components/ippica/race-header";
import { RunnerRow } from "@/components/ippica/runner-row";
import { BetslipPanel } from "@/components/sportsbook/betslip-panel";
import type { IppicaBetSelection, IppicaMarketWithOdds } from "@/lib/types/ippica";
import type { BetslipItem } from "@/lib/hooks/use-sportsbook";

const MARKET_TABS = [
  { key: "Winner", label: "VINCENTE" },
  { key: "Place", label: "PIAZZATO" },
  { key: "Head to head", label: "TESTA A TESTA" },
  { key: "Even and odd", label: "PARI/DISPARI" },
];

export default function IppicaRaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { race, runners, markets, loading } = useIppicaRace(id);
  const { user, wallet, refreshWallet } = useAuth();

  const [activeTab, setActiveTab] = useState("Winner");
  const [ippicaBetslip, setIppicaBetslip] = useState<IppicaBetSelection[]>([]);
  const [stake, setStake] = useState("");
  const [placingBet, setPlacingBet] = useState(false);
  const [betResult, setBetResult] = useState<{ type: "success" | "error" | "warn"; text: string } | null>(null);
  const [showMobileBetslip, setShowMobileBetslip] = useState(false);
  const [sortBy, setSortBy] = useState<"number" | "odds" | "rating">("number");

  const selectedOddsIds = new Set(ippicaBetslip.map(s => s.oddsId));
  const isFinished = race?.status === "finished" || race?.status === "abandoned";

  // Filter markets by active tab
  const tabMarkets = useMemo(() => {
    if (activeTab === "Place") {
      return markets.filter(m => m.market_type.startsWith("Place"));
    }
    return markets.filter(m => m.market_type === activeTab);
  }, [markets, activeTab]);

  // Market counts per tab
  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tab of MARKET_TABS) {
      if (tab.key === "Place") {
        counts[tab.key] = markets.filter(m => m.market_type.startsWith("Place")).length;
      } else {
        counts[tab.key] = markets.filter(m => m.market_type === tab.key).length;
      }
    }
    return counts;
  }, [markets]);

  const activeRunners = runners.filter((r: any) => !r.is_non_runner);
  const nonRunners = runners.filter((r: any) => r.is_non_runner);

  // Sort runners
  const sortedRunners = useMemo(() => {
    const winnerMarket = markets.find(m => m.market_type === "Winner");
    const copy = [...activeRunners];
    if (sortBy === "odds" && winnerMarket) {
      const oddsLookup = new Map(winnerMarket.odds.map(o => [o.runner_number, o.odds || 999]));
      copy.sort((a: any, b: any) => (oddsLookup.get(a.runner_number) || 999) - (oddsLookup.get(b.runner_number) || 999));
    } else if (sortBy === "rating") {
      copy.sort((a: any, b: any) => (b.rating || 0) - (a.rating || 0));
    } else {
      copy.sort((a: any, b: any) => a.runner_number - b.runner_number);
    }
    return copy;
  }, [activeRunners, sortBy, markets]);

  function toggleBet(sel: IppicaBetSelection) {
    setIppicaBetslip(prev => {
      const exists = prev.find(s => s.oddsId === sel.oddsId);
      if (exists) return prev.filter(s => s.oddsId !== sel.oddsId);
      return [...prev, sel];
    });
  }

  function makeBetSelection(market: IppicaMarketWithOdds, oddsEntry: any): IppicaBetSelection | null {
    if (!oddsEntry?.odds || !race) return null;
    return {
      source: "ippica",
      raceId: race.id,
      raceName: race.title,
      meetingName: race.meeting_name || "",
      raceNumber: race.race_number,
      marketType: market.market_type,
      marketId: market.id,
      selectionName: oddsEntry.selection_name,
      odds: oddsEntry.odds,
      oddsId: oddsEntry.id,
      runnerNumber: oddsEntry.runner_number,
    };
  }

  const betslipItems: BetslipItem[] = ippicaBetslip.map(s => ({
    eventId: s.raceId,
    marketName: s.marketType === "Winner" ? "Vincente" : s.marketType.replace("Place", "Piazzato"),
    selection: s.selectionName,
    odds: s.odds,
    match: `${s.meetingName} - R${s.raceNumber}`,
    marketId: s.marketId,
    outcomeId: s.oddsId,
  }));

  const totalOdds = ippicaBetslip.reduce((acc, s) => acc * s.odds, 1);

  async function placeBet() {
    if (ippicaBetslip.length === 0 || !stake) return;
    setPlacingBet(true);
    setBetResult(null);
    try {
      const res = await fetch("/api/player/place-bet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stake: parseFloat(stake),
          source: "ippica",
          selections: ippicaBetslip.map(s => ({
            source: "ippica",
            raceId: s.raceId,
            marketId: s.marketId,
            oddsId: s.oddsId,
            odds: s.odds,
            selectionName: s.selectionName,
          })),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setBetResult({ type: "success", text: "Scommessa piazzata!" });
        setIppicaBetslip([]);
        setStake("");
        refreshWallet?.();
      } else {
        setBetResult({ type: "error", text: data.error || "Errore" });
      }
    } catch (e: any) {
      setBetResult({ type: "error", text: e.message });
    } finally {
      setPlacingBet(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!race) {
    return <div className="text-center py-12 text-gray-400">Corsa non trovata</div>;
  }

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link href="/ippica" className="hover:text-brand">Ippica</Link>
        <span>›</span>
        <span>{race.meeting_name}</span>
        <span>›</span>
        <span className="text-gray-600">Corsa {race.race_number}</span>
      </div>

      {/* Race header */}
      <div className="bg-white rounded-xl border border-gray-200 px-4">
        <RaceHeader race={race} />
      </div>

      <div className="flex gap-6">
        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Market tabs */}
          <div className="flex gap-1 overflow-x-auto pb-1">
            {MARKET_TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "px-4 py-2 rounded-lg text-xs font-bold uppercase whitespace-nowrap transition-colors",
                  activeTab === tab.key
                    ? "bg-brand text-white"
                    : "bg-white text-gray-500 border border-gray-200 hover:border-brand/30",
                  tabCounts[tab.key] === 0 && "opacity-40 pointer-events-none",
                )}
              >
                {tab.label}
                {tabCounts[tab.key] > 0 && (
                  <span className="ml-1 text-[10px] opacity-70">({tabCounts[tab.key]})</span>
                )}
              </button>
            ))}
          </div>

          {/* Winner / Place tab — runner table */}
          {(activeTab === "Winner" || activeTab === "Place") && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {/* Sort controls */}
              <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100">
                <span className="text-[10px] text-gray-400 uppercase">Ordina:</span>
                {(["number", "odds", "rating"] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setSortBy(s)}
                    className={cn(
                      "text-[10px] font-semibold px-2 py-0.5 rounded",
                      sortBy === s ? "bg-brand/10 text-brand" : "text-gray-400 hover:text-gray-600"
                    )}
                  >
                    {s === "number" ? "#" : s === "odds" ? "Quota" : "Rating"}
                  </button>
                ))}
              </div>

              <table className="w-full text-left">
                <thead>
                  <tr className="text-[10px] font-semibold uppercase text-gray-400 border-b border-gray-100">
                    <th className="px-2 py-2 w-8">#</th>
                    <th className="px-2 py-2">Cavallo</th>
                    <th className="px-2 py-2 hidden sm:table-cell">Form</th>
                    <th className="px-2 py-2 hidden md:table-cell">Peso</th>
                    <th className="px-2 py-2 hidden md:table-cell text-center">Rating</th>
                    {activeTab === "Winner" ? (
                      <>
                        <th className="px-2 py-2 text-center w-20">Vinc.</th>
                        <th className="px-2 py-2 text-center w-20">Piaz.</th>
                      </>
                    ) : (
                      tabMarkets.map(m => (
                        <th key={m.id} className="px-2 py-2 text-center w-20">
                          {m.market_type.replace("Place ", "P")}
                        </th>
                      ))
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sortedRunners.map((runner: any) => {
                    if (activeTab === "Winner") {
                      const wMarket = markets.find(m => m.market_type === "Winner");
                      const pMarket = markets.find(m => m.market_type.startsWith("Place"));
                      const wOdds = wMarket?.odds.find(o => o.runner_number === runner.runner_number);
                      const pOdds = pMarket?.odds.find(o => o.runner_number === runner.runner_number);
                      const wSel = wMarket && wOdds ? makeBetSelection(wMarket, wOdds) : null;
                      const pSel = pMarket && pOdds ? makeBetSelection(pMarket, pOdds) : null;

                      return (
                        <RunnerRow
                          key={runner.id}
                          runner={runner}
                          winnerOdds={wOdds}
                          placeOdds={pOdds}
                          onClickWinner={wSel ? () => toggleBet(wSel) : undefined}
                          onClickPlace={pSel ? () => toggleBet(pSel) : undefined}
                          isWinnerSelected={wOdds ? selectedOddsIds.has(wOdds.id) : false}
                          isPlaceSelected={pOdds ? selectedOddsIds.has(pOdds.id) : false}
                          showDetail
                          isFinished={isFinished}
                        />
                      );
                    }

                    // Place tab: multiple place columns
                    return (
                      <tr key={runner.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-2 py-1.5 text-xs font-mono font-bold text-gray-500 w-8 text-center">
                          {runner.runner_number}
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="text-sm font-semibold text-gray-800">{runner.name}</div>
                          <div className="text-[10px] text-gray-400">{runner.jockey}</div>
                        </td>
                        <td className="px-2 py-1.5 text-xs font-mono text-gray-500 hidden sm:table-cell">
                          {runner.form || "—"}
                        </td>
                        <td className="px-2 py-1.5 text-xs text-gray-500 hidden md:table-cell">
                          {runner.weight_text || "—"}
                        </td>
                        <td className="px-2 py-1.5 text-xs font-mono text-gray-500 hidden md:table-cell text-center">
                          {runner.rating || "—"}
                        </td>
                        {tabMarkets.map(m => {
                          const o = m.odds.find(o => o.runner_number === runner.runner_number);
                          const sel = o ? makeBetSelection(m, o) : null;
                          return (
                            <td key={m.id} className="px-1 py-1">
                              {o?.odds ? (
                                <button
                                  onClick={sel ? () => toggleBet(sel) : undefined}
                                  disabled={isFinished || o.status === "suspended"}
                                  className={cn(
                                    "w-full px-2 py-1.5 rounded text-sm font-mono font-semibold transition-all text-center",
                                    selectedOddsIds.has(o.id)
                                      ? "bg-brand text-white ring-2 ring-brand/30"
                                      : "bg-gray-50 text-gray-800 hover:bg-brand/10",
                                  )}
                                >
                                  {o.odds.toFixed(2)}
                                </button>
                              ) : (
                                <span className="text-xs text-gray-300 text-center block">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {nonRunners.map((runner: any) => (
                    <RunnerRow key={runner.id} runner={runner} showDetail isFinished={isFinished} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Head to Head tab */}
          {activeTab === "Head to head" && (
            <div className="space-y-3">
              {tabMarkets.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">Nessun Testa a Testa disponibile</div>
              ) : tabMarkets.map(m => (
                <div key={m.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-xs text-gray-400 mb-3 uppercase font-semibold">{m.market_label}</p>
                  <div className="flex gap-3">
                    {m.odds.map(o => {
                      const sel = makeBetSelection(m, o);
                      return (
                        <button
                          key={o.id}
                          onClick={sel ? () => toggleBet(sel) : undefined}
                          disabled={isFinished || o.status === "suspended"}
                          className={cn(
                            "flex-1 py-3 rounded-lg text-center transition-all border",
                            selectedOddsIds.has(o.id)
                              ? "bg-brand text-white border-brand"
                              : "bg-gray-50 border-gray-200 hover:border-brand/30",
                          )}
                        >
                          <div className="text-sm font-semibold">{o.selection_name}</div>
                          <div className="text-lg font-mono font-bold mt-1">
                            {o.odds?.toFixed(2) || "—"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Even/Odd tab */}
          {activeTab === "Even and odd" && (
            <div className="space-y-3">
              {tabMarkets.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">Nessun Pari/Dispari disponibile</div>
              ) : tabMarkets.map(m => (
                <div key={m.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex gap-3">
                    {m.odds.map(o => {
                      const sel = makeBetSelection(m, o);
                      return (
                        <button
                          key={o.id}
                          onClick={sel ? () => toggleBet(sel) : undefined}
                          disabled={isFinished || o.status === "suspended"}
                          className={cn(
                            "flex-1 py-4 rounded-lg text-center transition-all border",
                            selectedOddsIds.has(o.id)
                              ? "bg-brand text-white border-brand"
                              : "bg-gray-50 border-gray-200 hover:border-brand/30",
                          )}
                        >
                          <div className="text-lg font-semibold">{o.selection_name}</div>
                          <div className="text-2xl font-mono font-bold mt-1">
                            {o.odds?.toFixed(2) || "—"}
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

        {/* Desktop betslip */}
        <div className="hidden lg:block w-72 flex-shrink-0">
          <div className="sticky top-[76px]">
            <BetslipPanel
              betslip={betslipItems}
              allEvents={[]}
              totalOdds={totalOdds}
              placingBet={placingBet}
              stake={stake}
              setStake={setStake}
              onPlaceBet={placeBet}
              onRemoveItem={(item) => {
                setIppicaBetslip(prev => prev.filter(s => s.oddsId !== item.outcomeId));
              }}
              onClear={() => setIppicaBetslip([])}
              betMode="auto"
              setBetMode={() => {}}
              systemComboSize={2}
              setSystemComboSize={() => {}}
              user={user}
              wallet={wallet}
              msg={betResult}
            />
          </div>
        </div>
      </div>

      {/* Mobile betslip */}
      {ippicaBetslip.length > 0 && (
        <div className="lg:hidden fixed bottom-[70px] left-1/2 -translate-x-1/2 z-40 max-w-[430px] w-full px-4">
          <button
            onClick={() => setShowMobileBetslip(!showMobileBetslip)}
            className="w-full bg-brand text-white rounded-xl py-3 px-4 font-semibold text-sm flex items-center justify-between shadow-lg"
          >
            <span>Biglietto ({ippicaBetslip.length})</span>
            <span className="font-mono">{totalOdds.toFixed(2)}</span>
          </button>
          {showMobileBetslip && (
            <div className="mt-2 bg-white rounded-xl border border-gray-200 shadow-xl p-4 max-h-[50vh] overflow-y-auto">
              <BetslipPanel
                betslip={betslipItems}
                allEvents={[]}
                totalOdds={totalOdds}
                placingBet={placingBet}
                stake={stake}
                setStake={setStake}
                onPlaceBet={placeBet}
                onRemoveItem={(item) => {
                  setIppicaBetslip(prev => prev.filter(s => s.oddsId !== item.outcomeId));
                }}
                onClear={() => setIppicaBetslip([])}
                betMode="auto"
                setBetMode={() => {}}
                systemComboSize={2}
                setSystemComboSize={() => {}}
                user={user}
                wallet={wallet}
                msg={betResult}
                compact
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
