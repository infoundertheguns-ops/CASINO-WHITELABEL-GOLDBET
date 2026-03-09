"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/hooks/use-auth";
import { useSportsbook, type SportEvent, type Market, type Selection } from "@/lib/hooks/use-sportsbook";
import { usePlayerProps, type PlayerSportFilter } from "@/lib/hooks/use-player-props";
import type { MatchGroup, PlayerEventRow } from "@/lib/utils/player-props";
import { PlayerOddsCell } from "@/components/sportsbook/player-odds-cell";
import { BetslipPanel } from "@/components/sportsbook/betslip-panel";

// ═══ HELPERS ═══

function formatKickoff(startsAt: string): string {
  const d = new Date(startsAt);
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

function getOddsDirection(sel: Selection): "up" | "down" | null {
  if (!sel.changedAt || sel.previousOdds == null) return null;
  if (Date.now() - sel.changedAt > 3000) return null;
  if (sel.odds > sel.previousOdds) return "up";
  if (sel.odds < sel.previousOdds) return "down";
  return null;
}

// Quick-odds extraction: find a specific market's "Si" or "Over" selection for collapsed view
function findQuickOdds(
  markets: { name: string; selections: Selection[] }[],
  pattern: string,
  selLabel?: string
): { market: string; sel: Selection } | null {
  const m = markets.find((mk) => mk.name.toLowerCase().includes(pattern.toLowerCase()));
  if (!m || m.selections.length === 0) return null;
  if (selLabel) {
    const s = m.selections.find((s) => s.label.toLowerCase() === selLabel.toLowerCase());
    if (s) return { market: m.name, sel: s };
  }
  return { market: m.name, sel: m.selections[0] };
}

// Strip the player prefix from market name: "1° Marcatore | Mattia Zaccagni" → "1° Marcatore"
function cleanMarketName(name: string): string {
  const idx = name.indexOf(" | ");
  return idx > 0 ? name.slice(0, idx) : name;
}

const SPORT_PILLS: { key: PlayerSportFilter; label: string; icon: string }[] = [
  { key: "tutti", label: "Tutti", icon: "" },
  { key: "calcio", label: "Calcio", icon: "⚽" },
  { key: "basket", label: "Basket", icon: "🏀" },
];

// ═══ PAGE ═══

export default function MarcatoriPage() {
  const { user, wallet, refreshWallet } = useAuth();
  const {
    betslip,
    toggleBet,
    isSelected,
    clearBetslip,
    totalOdds,
    placeBet,
    placingBet,
    betMode,
    setBetMode,
    systemComboSize,
    setSystemComboSize,
    allEvents,
  } = useSportsbook();

  const {
    groups,
    loading,
    error,
    activeSport,
    setActiveSport,
    searchQuery,
    setSearchQuery,
    expandedMatch,
    setExpandedMatch,
    expandedPlayer,
    setExpandedPlayer,
    getPlayerMarkets,
    loadPlayerMarkets,
    loadingMarkets,
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

  // Build a SportEvent for betslip integration from a player event row + cached markets
  const buildPlayerSportEvent = useCallback((player: PlayerEventRow): SportEvent => {
    const markets = getPlayerMarkets(player.id) || [];
    return {
      id: player.id,
      home: player.parsed.playerName,
      away: player.parsed.matchKey,
      league: player.league_name,
      leagueIcon: player.sport_icon,
      time: formatKickoff(player.starts_at),
      live: false,
      markets,
      sportName: player.sport_name,
      sportSlug: player.sport_slug,
    };
  }, [getPlayerMarkets]);

  // Expand player → load markets
  const handlePlayerExpand = useCallback((eventId: string) => {
    if (expandedPlayer === eventId) {
      setExpandedPlayer(null);
    } else {
      setExpandedPlayer(eventId);
      loadPlayerMarkets(eventId);
    }
  }, [expandedPlayer, setExpandedPlayer, loadPlayerMarkets]);

  // Expand match
  const handleMatchExpand = useCallback((key: string) => {
    if (expandedMatch === key) {
      setExpandedMatch(null);
      setExpandedPlayer(null);
    } else {
      setExpandedMatch(key);
      setExpandedPlayer(null);
    }
  }, [expandedMatch, setExpandedMatch, setExpandedPlayer]);

  // Group matches by league for display
  const leagueGroups: { league: string; leagueSlug: string; matches: MatchGroup[] }[] = [];
  const leagueMap = new Map<string, MatchGroup[]>();
  for (const g of groups) {
    const arr = leagueMap.get(g.leagueSlug) || [];
    arr.push(g);
    leagueMap.set(g.leagueSlug, arr);
  }
  for (const [slug, matches] of leagueMap) {
    leagueGroups.push({ league: matches[0].league, leagueSlug: slug, matches });
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
                {counts.total} giocatori in {groups.length} partite
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
              placeholder="Cerca giocatore..."
              className="w-full pl-8 pr-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
            />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
              🔍
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

          {/* Loading */}
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
          ) : groups.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <span className="text-3xl block mb-2">🎯</span>
              <p className="text-sm text-gray-400">
                {searchQuery ? "Nessun giocatore trovato" : "Nessun evento marcatori disponibile"}
              </p>
            </div>
          ) : (
            /* ═══ MATCH GROUPS BY LEAGUE ═══ */
            <div className="space-y-4">
              {leagueGroups.map((lg) => (
                <div key={lg.leagueSlug}>
                  {/* League header */}
                  <div className="flex items-center gap-2 px-1 mb-2">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                      {lg.matches[0].sportIcon} {lg.league}
                    </span>
                    <span className="text-[10px] text-gray-300">
                      {lg.matches.reduce((s, m) => s + m.totalPlayers, 0)} giocatori
                    </span>
                  </div>

                  <div className="space-y-2">
                    {lg.matches.map((match) => {
                      const matchKey = `${match.matchKey}|${match.leagueSlug}`;
                      const isOpen = expandedMatch === matchKey;

                      return (
                        <div
                          key={matchKey}
                          className="bg-white rounded-xl border border-gray-200 overflow-hidden"
                        >
                          {/* Match header — always visible */}
                          <button
                            onClick={() => handleMatchExpand(matchKey)}
                            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="text-sm font-bold text-gray-900">
                                {match.homeTeam} — {match.awayTeam}
                              </div>
                              <span className="text-[10px] text-gray-400 flex-shrink-0">
                                {formatKickoff(match.startsAt)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-[10px] text-gray-400">
                                {match.totalPlayers} giocatori
                              </span>
                              <span className={cn(
                                "text-gray-400 text-xs transition-transform",
                                isOpen && "rotate-180"
                              )}>
                                ▼
                              </span>
                            </div>
                          </button>

                          {/* Expanded: player list */}
                          {isOpen && (
                            <div className="border-t border-gray-100">
                              {/* Home players */}
                              {match.homePlayers.length > 0 && (
                                <PlayerSection
                                  label={match.homeTeam}
                                  icon="🏠"
                                  players={match.homePlayers}
                                  sportSlug={match.sportSlug}
                                  expandedPlayer={expandedPlayer}
                                  onPlayerExpand={handlePlayerExpand}
                                  getPlayerMarkets={getPlayerMarkets}
                                  loadingMarkets={loadingMarkets}
                                  buildPlayerSportEvent={buildPlayerSportEvent}
                                  toggleBet={toggleBet}
                                  isSelected={isSelected}
                                />
                              )}

                              {/* Away players */}
                              {match.awayPlayers.length > 0 && (
                                <PlayerSection
                                  label={match.awayTeam}
                                  icon="🏃"
                                  players={match.awayPlayers}
                                  sportSlug={match.sportSlug}
                                  expandedPlayer={expandedPlayer}
                                  onPlayerExpand={handlePlayerExpand}
                                  getPlayerMarkets={getPlayerMarkets}
                                  loadingMarkets={loadingMarkets}
                                  buildPlayerSportEvent={buildPlayerSportEvent}
                                  toggleBet={toggleBet}
                                  isSelected={isSelected}
                                />
                              )}
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

        {/* ═══ DESKTOP BETSLIP ═══ */}
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
            🎫 ({betslip.length}) · {totalOdds.toFixed(2)}
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

// ═══ PLAYER SECTION (home/away team group) ═══

interface PlayerSectionProps {
  label: string;
  icon: string;
  players: PlayerEventRow[];
  sportSlug: string;
  expandedPlayer: string | null;
  onPlayerExpand: (id: string) => void;
  getPlayerMarkets: (id: string) => Market[] | null;
  loadingMarkets: Set<string>;
  buildPlayerSportEvent: (p: PlayerEventRow) => SportEvent;
  toggleBet: (event: SportEvent, marketName: string, sel: Selection) => void;
  isSelected: (eventId: string, marketName: string, selLabel: string) => boolean;
}

function PlayerSection({
  label, icon, players, sportSlug,
  expandedPlayer, onPlayerExpand,
  getPlayerMarkets, loadingMarkets,
  buildPlayerSportEvent, toggleBet, isSelected,
}: PlayerSectionProps) {
  const isCalcio = sportSlug.includes("calcio");

  return (
    <div className="px-3 py-2">
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
        <span>{icon}</span> {label}
      </div>

      <div className="space-y-0.5">
        {players.map((player) => {
          const isOpen = expandedPlayer === player.id;
          const isLoading = loadingMarkets.has(player.id);
          const markets = getPlayerMarkets(player.id);
          const sportEvent = buildPlayerSportEvent(player);

          // Quick odds for collapsed row
          let quickOdds: { label: string; market: string; sel: Selection }[] = [];
          if (markets && !isOpen) {
            if (isCalcio) {
              const m1 = findQuickOdds(markets, "1° marcatore", "si") ||
                         findQuickOdds(markets, "primo marcatore", "si");
              const m2 = findQuickOdds(markets, "marc plus", "si") ||
                         findQuickOdds(markets, "marcatore plus", "si");
              if (m1) quickOdds.push({ label: "1°M", ...m1 });
              if (m2) quickOdds.push({ label: "MP", ...m2 });
            } else {
              // Basket: U/O Punti, U/O Assist
              const m1 = findQuickOdds(markets, "punti", "over");
              const m2 = findQuickOdds(markets, "assist", "over");
              if (m1) quickOdds.push({ label: "Pts", ...m1 });
              if (m2) quickOdds.push({ label: "Ast", ...m2 });
            }
          }

          return (
            <div key={player.id}>
              {/* Player row */}
              <div
                className={cn(
                  "flex items-center justify-between py-1.5 px-2 rounded-lg cursor-pointer transition-colors",
                  isOpen ? "bg-brand/5" : "hover:bg-gray-50"
                )}
              >
                <button
                  onClick={() => onPlayerExpand(player.id)}
                  className="flex items-center gap-2 min-w-0 flex-1"
                >
                  <span className={cn(
                    "text-[10px] text-gray-400 transition-transform flex-shrink-0",
                    isOpen && "rotate-90"
                  )}>
                    ▶
                  </span>
                  <span className="text-xs font-semibold text-gray-800 truncate">
                    {player.parsed.playerName}
                  </span>
                  {isLoading && (
                    <span className="w-3 h-3 border-2 border-brand/30 border-t-brand rounded-full animate-spin flex-shrink-0" />
                  )}
                </button>

                {/* Quick odds */}
                <div className="flex gap-1 flex-shrink-0 ml-2">
                  {quickOdds.map((qo) => (
                    <PlayerOddsCell
                      key={qo.label}
                      label={qo.label}
                      sel={qo.sel}
                      active={isSelected(player.id, qo.market, qo.sel.label)}
                      onClick={() => toggleBet(sportEvent, qo.market, qo.sel)}
                    />
                  ))}
                  {!markets && !isLoading && !isOpen && (
                    <button
                      onClick={() => onPlayerExpand(player.id)}
                      className="text-[10px] text-brand font-semibold hover:underline px-1"
                    >
                      +
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded: all markets */}
              {isOpen && (
                <div className="ml-5 mr-1 mb-2">
                  {isLoading ? (
                    <div className="space-y-2 py-2">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="animate-pulse">
                          <div className="h-3 bg-gray-200 rounded w-32 mb-1" />
                          <div className="flex gap-1">
                            <div className="h-8 bg-gray-200 rounded w-16" />
                            <div className="h-8 bg-gray-200 rounded w-16" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : markets && markets.length > 0 ? (
                    <div className="space-y-2 py-1">
                      {markets.map((m) => (
                        <div key={m.id || m.name} className="border border-gray-100 rounded-lg p-2">
                          <div className="text-[10px] font-bold text-gray-500 mb-1.5 uppercase tracking-wide">
                            {cleanMarketName(m.name)}
                            {m.line != null && (
                              <span className="text-brand ml-1">{m.line}</span>
                            )}
                          </div>
                          <div className={cn(
                            "grid gap-1",
                            m.selections.length <= 2 ? "grid-cols-2" :
                            m.selections.length === 3 ? "grid-cols-3" : "grid-cols-3"
                          )}>
                            {m.selections.map((sel) => {
                              const dir = getOddsDirection(sel);
                              const active = isSelected(player.id, m.name, sel.label);
                              return (
                                <button
                                  key={sel.id || sel.label}
                                  onClick={() => toggleBet(sportEvent, m.name, sel)}
                                  className={cn(
                                    "py-1.5 rounded text-center border transition-all",
                                    active
                                      ? "border-brand bg-brand/10 ring-1 ring-brand"
                                      : "border-gray-200 bg-gray-50 hover:border-brand/50",
                                    dir === "up" && "odds-up",
                                    dir === "down" && "odds-down"
                                  )}
                                >
                                  <span className="text-[9px] text-gray-400 block">{sel.label}</span>
                                  <span className={cn("text-xs font-bold", active ? "text-brand" : "text-gray-900")}>
                                    {sel.odds.toFixed(2)}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-2 text-center text-[10px] text-gray-400">
                      Nessun mercato disponibile
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
