"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/hooks/use-auth";
import { useSportsbook, type SportEvent, type Selection } from "@/lib/hooks/use-sportsbook";
import { usePlayerProps, type PlayerSportFilter } from "@/lib/hooks/use-player-props";
import type { PlayerMatch, PlayerMarketCategory } from "@/lib/utils/player-props";
import { BetslipPanel } from "@/components/sportsbook/betslip-panel";

// ═══ HELPERS ═══

function formatKickoff(startsAt: string): string {
  const d = new Date(startsAt);
  if (isNaN(d.getTime())) return startsAt;
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays <= 0) {
    return `Oggi ${d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`;
  }
  if (diffDays === 1) {
    return `Domani ${d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const SPORT_PILLS: { key: PlayerSportFilter; label: string; icon: string }[] = [
  { key: "tutti", label: "Tutti", icon: "" },
  { key: "calcio", label: "Calcio", icon: "" },
  { key: "basket", label: "Basket", icon: "" },
];

// ═══ PAGE ═══

export default function MarcatoriPage() {
  const { user, wallet, refreshWallet } = useAuth();
  const {
    betslip, toggleBet, isSelected, clearBetslip, totalOdds,
    placeBet, placingBet, betMode, setBetMode,
    systemComboSize, setSystemComboSize, allEvents,
  } = useSportsbook();

  const {
    matches, loading, error, activeSport, setActiveSport,
    searchQuery, setSearchQuery, expandedMatch, setExpandedMatch,
    counts,
  } = usePlayerProps();

  const [stake, setStake] = useState("");
  const [showMobileBetslip, setShowMobileBetslip] = useState(false);
  const [betResult, setBetResult] = useState<{ type: "success" | "error" | "warn"; text: string } | null>(null);

  const isSystem = betMode === "sistema" && betslip.length >= 3;
  const systemType = isSystem ? `${systemComboSize}/${betslip.length}` : undefined;

  const handlePlaceBet = async () => {
    if (!stake || parseFloat(stake) <= 0) return;
    setBetResult(null);
    const result = await placeBet(parseFloat(stake), systemType);
    if (result.success) {
      const msg = result.combo_count
        ? `Sistema piazzato! ${result.combo_count} combo`
        : result.flagged ? "Scommessa piazzata (in verifica)" : "Scommessa piazzata!";
      setBetResult({ type: "success", text: msg });
      setStake("");
      refreshWallet();
      setTimeout(() => setBetResult(null), 4000);
    } else {
      setBetResult({ type: "error", text: result.error || "Errore" });
    }
  };

  const handleRemoveItem = (b: typeof betslip[0]) => {
    const ev = allEvents.find((e) => e.id === b.eventId);
    if (ev) toggleBet(ev, b.marketName, { label: b.selection, odds: b.odds });
  };

  // Group matches by league
  const leagueGroups: { league: string; leagueSlug: string; sportIcon: string; matches: PlayerMatch[] }[] = [];
  const leagueMap = new Map<string, PlayerMatch[]>();
  for (const m of matches) {
    const arr = leagueMap.get(m.leagueSlug) || [];
    arr.push(m);
    leagueMap.set(m.leagueSlug, arr);
  }
  for (const [slug, ms] of leagueMap) {
    leagueGroups.push({
      league: ms[0].league,
      leagueSlug: slug,
      sportIcon: ms[0].sportIcon,
      matches: ms,
    });
  }

  return (
    <div className="p-4 lg:p-0">
      <div className="lg:flex lg:gap-4">
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold text-gray-900">Marcatori</h2>
            {wallet && (
              <span className="text-xs font-mono text-gray-400">
                Saldo: <span className="text-emerald-500 font-bold">${wallet.balance?.toFixed(2)}</span>
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Scommesse sui marcatori e statistiche giocatori.
            {!loading && (
              <span className="text-gray-400 ml-1">
                {matches.length} partite con mercati giocatori
              </span>
            )}
          </p>

          {/* Sport pills */}
          <div className="flex gap-2 mb-3">
            {SPORT_PILLS.map((p) => (
              <button
                key={p.key}
                onClick={() => setActiveSport(p.key)}
                className={cn(
                  "flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all",
                  activeSport === p.key
                    ? "bg-brand text-white border-brand"
                    : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
                )}
              >
                {p.icon} {p.label}
                {p.key === "calcio" && counts.calcio > 0 && (
                  <span className="ml-1 text-[10px] opacity-70">({counts.calcio})</span>
                )}
                {p.key === "basket" && counts.basket > 0 && (
                  <span className="ml-1 text-[10px] opacity-70">({counts.basket})</span>
                )}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative mb-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cerca giocatore o squadra..."
              className="w-full pl-8 pr-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
            />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
              Q
            </span>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
              >
                &times;
              </button>
            )}
          </div>

          {/* Content */}
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse">
                  <div className="flex justify-between mb-2">
                    <div className="h-3 bg-gray-200 rounded w-24" />
                    <div className="h-3 bg-gray-200 rounded w-16" />
                  </div>
                  <div className="h-5 bg-gray-200 rounded w-40 mb-2" />
                  <div className="h-4 bg-gray-200 rounded w-28" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
              <p className="text-sm text-red-600">Errore: {error}</p>
            </div>
          ) : matches.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <span className="text-3xl block mb-2">
                {searchQuery ? "" : ""}
              </span>
              <p className="text-sm text-gray-400">
                {searchQuery ? "Nessun risultato trovato" : "Nessun mercato marcatori disponibile"}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {leagueGroups.map((lg) => (
                <div key={lg.leagueSlug}>
                  {/* League header */}
                  <div className="flex items-center gap-2 px-1 mb-2">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                      {lg.sportIcon} {lg.league}
                    </span>
                    <span className="text-[10px] text-gray-300">
                      {lg.matches.length} partite
                    </span>
                  </div>

                  <div className="space-y-2">
                    {lg.matches.map((match) => {
                      const isOpen = expandedMatch === match.eventId;

                      return (
                        <div
                          key={match.eventId}
                          className="bg-white rounded-xl border border-gray-200 overflow-hidden"
                        >
                          {/* Match header */}
                          <button
                            onClick={() => setExpandedMatch(isOpen ? null : match.eventId)}
                            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              {match.isLive && (
                                <span className="text-[10px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded">LIVE</span>
                              )}
                              <div className="text-sm font-bold text-gray-900">
                                {match.homeTeam} — {match.awayTeam}
                              </div>
                              <span className="text-[10px] text-gray-400 flex-shrink-0">
                                {formatKickoff(match.startsAt)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-[10px] text-gray-400">
                                {match.categories.length} cat. · {match.totalRunners} quote
                              </span>
                              <span className={cn(
                                "text-gray-400 text-xs transition-transform",
                                isOpen && "rotate-180"
                              )}>
                                V
                              </span>
                            </div>
                          </button>

                          {/* Expanded: player market categories */}
                          {isOpen && (
                            <div className="border-t border-gray-100">
                              {match.categories.map((cat) => (
                                <CategorySection
                                  key={cat.category}
                                  category={cat}
                                  eventId={match.eventId}
                                  homeTeam={match.homeTeam}
                                  awayTeam={match.awayTeam}
                                  allEvents={allEvents}
                                  toggleBet={toggleBet}
                                  isSelected={isSelected}
                                />
                              ))}
                            </div>
                          )}
                        </div>
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
          <div className="sticky top-20 bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="bg-gray-900 text-white px-4 py-3 flex justify-between items-center">
              <span className="text-sm font-bold">Schedina</span>
              {betslip.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="bg-brand text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{betslip.length}</span>
                  <button onClick={clearBetslip} className="text-gray-400 hover:text-white text-xs">&times;</button>
                </div>
              )}
            </div>
            <BetslipPanel
              betslip={betslip}
              allEvents={allEvents}
              totalOdds={totalOdds}
              placingBet={placingBet}
              stake={stake}
              setStake={setStake}
              onPlaceBet={handlePlaceBet}
              onRemoveItem={handleRemoveItem}
              onClear={clearBetslip}
              betMode={betMode}
              setBetMode={setBetMode}
              systemComboSize={systemComboSize}
              setSystemComboSize={setSystemComboSize}
              user={user}
              wallet={wallet}
              msg={betResult}
            />
          </div>
        </div>
      </div>

      {/* Mobile floating betslip */}
      {betslip.length > 0 && (
        <div className="lg:hidden fixed bottom-20 left-1/2 -translate-x-1/2 max-w-[400px] w-[calc(100%-2rem)] z-40">
          <button onClick={() => setShowMobileBetslip(!showMobileBetslip)}
            className="w-full py-3 rounded-xl bg-brand text-white font-bold text-sm shadow-lg flex items-center justify-center gap-2">
            ({betslip.length}) · {totalOdds.toFixed(2)}
          </button>
        </div>
      )}

      {showMobileBetslip && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/50" onClick={() => setShowMobileBetslip(false)}>
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[70vh] overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm font-bold">Schedina ({betslip.length})</span>
              <button onClick={() => setShowMobileBetslip(false)} className="text-gray-400">&times;</button>
            </div>
            <BetslipPanel
              betslip={betslip}
              allEvents={allEvents}
              totalOdds={totalOdds}
              placingBet={placingBet}
              stake={stake}
              setStake={setStake}
              onPlaceBet={handlePlaceBet}
              onRemoveItem={handleRemoveItem}
              onClear={clearBetslip}
              betMode={betMode}
              setBetMode={setBetMode}
              systemComboSize={systemComboSize}
              setSystemComboSize={setSystemComboSize}
              user={user}
              wallet={wallet}
              msg={betResult}
              compact
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ═══ CATEGORY SECTION — group of player markets under one heading ═══

interface CategorySectionProps {
  category: PlayerMarketCategory;
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  allEvents: SportEvent[];
  toggleBet: (event: SportEvent, marketName: string, sel: Selection) => void;
  isSelected: (eventId: string, marketName: string, selLabel: string) => boolean;
}

function CategorySection({
  category, eventId, homeTeam, awayTeam,
  allEvents, toggleBet, isSelected,
}: CategorySectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const sportEvent = allEvents.find((e) => e.id === eventId);

  return (
    <div className="px-3 py-2 border-b border-gray-50 last:border-b-0">
      {/* Category header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between mb-1.5"
      >
        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
          {category.category}
        </span>
        <span className="text-[10px] text-gray-400">
          {category.totalRunners} giocatori
          <span className={cn("ml-1 inline-block transition-transform", collapsed && "-rotate-90")}>V</span>
        </span>
      </button>

      {!collapsed && (
        <div className="space-y-1.5">
          {category.markets.map((market) => (
            <div key={market.id || market.name}>
              {/* Market subheader (if multiple markets in same category, e.g. different lines) */}
              {category.markets.length > 1 && (
                <div className="text-[9px] text-gray-400 mb-1 pl-1">
                  {market.name}
                  {market.line != null && <span className="text-brand ml-1">{market.line}</span>}
                </div>
              )}

              {/* Player runners as a grid */}
              <div className="grid grid-cols-2 gap-1">
                {market.selections.map((sel) => {
                  const active = isSelected(eventId, market.name, sel.label);
                  return (
                    <button
                      key={sel.id || sel.label}
                      onClick={() => {
                        if (sportEvent) toggleBet(sportEvent, market.name, sel);
                      }}
                      className={cn(
                        "flex items-center justify-between py-1.5 px-2 rounded border transition-all text-left",
                        active
                          ? "border-brand bg-brand/10 ring-1 ring-brand"
                          : "border-gray-200 bg-gray-50 hover:border-brand/50"
                      )}
                    >
                      <span className="text-[11px] text-gray-800 truncate mr-1">{sel.label}</span>
                      <span className={cn("text-xs font-bold flex-shrink-0", active ? "text-brand" : "text-gray-900")}>
                        {sel.odds.toFixed(2)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
