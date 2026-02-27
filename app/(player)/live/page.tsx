"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useSportsbook, type SportEvent, type Selection } from "@/lib/hooks/use-sportsbook";
import { useAuth } from "@/lib/hooks/use-auth";
import { BetslipPanel } from "@/components/sportsbook/betslip-panel";

// ═══ LIVE TIMER ═══
function LiveTimer({ minute, receivedAt }: { minute: number; receivedAt: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 10000);
    return () => clearInterval(interval);
  }, []);
  const elapsed = Math.floor((Date.now() - receivedAt) / 60000);
  return <>{minute + elapsed}&apos;</>;
}

// ═══ ODDS DIRECTION ═══
function getOddsDirection(sel: Selection): "up" | "down" | null {
  if (!sel.changedAt || sel.previousOdds == null) return null;
  if (Date.now() - sel.changedAt > 3000) return null;
  if (sel.odds > sel.previousOdds) return "up";
  if (sel.odds < sel.previousOdds) return "down";
  return null;
}

const SPORT_ICONS: Record<string, string> = {
  calcio: "⚽", basket: "🏀", tennis: "🎾", hockey: "🏒",
  pallavolo: "🏐", football: "🏈", "table-tennis": "🏓",
  snooker: "🎱", cricket: "🏏",
};

const MARKET_ALIASES: Record<string, string[]> = {
  "1X2": [
    "1X2", "T/T Risultato", "Testa A Testa",
    "Vincente Incontro (escl. ritiro)", "Vincente Incontro",
    "Esito Finale 1X2", "T/T Match", "1X2 Tempi Reg.",
  ],
  "U/O 2.5": ["U/O 2.5", "O/U 2.5", "Under/Over 2.5"],
  "GG/NG": ["GG/NG", "Gol/NoGol", "Gol/No Gol"],
};

export default function LivePage() {
  const {
    events: allEvents,
    loading,
    isMockData,
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
  } = useSportsbook();
  const { user, wallet, refreshWallet } = useAuth();
  const [stake, setStake] = useState("");
  const [showMobileBetslip, setShowMobileBetslip] = useState(false);
  const [betResult, setBetResult] = useState<{ type: "success" | "error" | "warn"; text: string } | null>(null);
  const [activeSport, setActiveSport] = useState<string | null>(null);

  // All live events
  const allLiveEvents = useMemo(() => allEvents.filter((e) => e.live), [allEvents]);

  // Sport tabs with counts
  const sportTabs = useMemo(() => {
    const map = new Map<string, { name: string; slug: string; icon: string; count: number }>();
    for (const e of allLiveEvents) {
      const slug = e.sportSlug || "altro";
      const existing = map.get(slug);
      if (existing) {
        existing.count++;
      } else {
        map.set(slug, {
          name: e.sportName || slug,
          slug,
          icon: SPORT_ICONS[slug] || "⚽",
          count: 1,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [allLiveEvents]);

  // Filter by selected sport
  const liveEvents = useMemo(
    () => (activeSport ? allLiveEvents.filter((e) => e.sportSlug === activeSport) : allLiveEvents),
    [allLiveEvents, activeSport],
  );

  // Group by league
  const groupedByLeague = useMemo(() => {
    const map = new Map<string, SportEvent[]>();
    for (const e of liveEvents) {
      const key = e.league || "Altro";
      const arr = map.get(key) || [];
      arr.push(e);
      map.set(key, arr);
    }
    return map;
  }, [liveEvents]);

  const getMarket = (e: SportEvent, name: string) => {
    const aliases = MARKET_ALIASES[name] || [name];
    return e.markets.find((m) => aliases.includes(m.name));
  };

  const isSystem = betMode === "sistema" && betslip.length >= 3;
  const systemType = isSystem ? `${systemComboSize}/${betslip.length}` : undefined;

  const handlePlaceBet = async () => {
    if (!stake || parseFloat(stake) <= 0) return;
    setBetResult(null);
    const result = await placeBet(parseFloat(stake), systemType);
    if (result.success) {
      const text = result.combo_count
        ? `Sistema piazzato! ${result.combo_count} combo`
        : result.flagged ? "Scommessa piazzata (in verifica)" : "Scommessa piazzata!";
      setBetResult({ type: "success", text });
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

  const OddsCell = ({ event, marketName, sel }: { event: SportEvent; marketName: string; sel: Selection }) => {
    const active = isSelected(event.id, marketName, sel.label);
    const dir = getOddsDirection(sel);
    return (
      <button
        key={sel.changedAt || 0}
        onClick={() => toggleBet(event, marketName, sel)}
        className={cn(
          "px-2 py-1.5 rounded text-center border text-xs font-bold transition-all min-w-[52px]",
          active
            ? "border-brand bg-brand/10 text-brand ring-1 ring-brand"
            : "border-gray-200 bg-gray-50 text-gray-800 hover:border-brand/50 hover:bg-orange-50",
          dir === "up" && "odds-up",
          dir === "down" && "odds-down",
        )}
      >
        {sel.odds.toFixed(2)}
      </button>
    );
  };

  return (
    <div className="p-4 lg:p-0">
      {isMockData && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-700 text-xs font-semibold text-center">
          Dati demo — Connetti Supabase per dati reali
        </div>
      )}

      <div className="lg:flex lg:gap-4">
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <h2 className="text-lg font-bold text-gray-900">Live Betting</h2>
            </div>
            {wallet && (
              <span className="text-xs font-mono text-gray-400">
                Saldo: <span className="text-emerald-500 font-bold">${wallet.balance?.toFixed(2)}</span>
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mb-3">
            {allLiveEvents.length} {allLiveEvents.length === 1 ? "evento" : "eventi"} in diretta
          </p>

          {/* ═══ SPORT TABS ═══ */}
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-4 pb-1">
            <button
              onClick={() => setActiveSport(null)}
              className={cn(
                "flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5",
                !activeSport
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200",
              )}
            >
              Tutti
              <span className={cn(
                "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                !activeSport ? "bg-white/20 text-white" : "bg-gray-200 text-gray-500",
              )}>
                {allLiveEvents.length}
              </span>
            </button>
            {sportTabs.map((s) => (
              <button
                key={s.slug}
                onClick={() => setActiveSport(activeSport === s.slug ? null : s.slug)}
                className={cn(
                  "flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 uppercase",
                  activeSport === s.slug
                    ? "bg-brand text-white"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200",
                )}
              >
                {s.icon} {s.name}
                <span className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                  activeSport === s.slug ? "bg-white/20 text-white" : "bg-gray-200 text-gray-500",
                )}>
                  {s.count}
                </span>
              </button>
            ))}
          </div>

          {/* ═══ CONTENT ═══ */}
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 p-3 animate-pulse">
                  <div className="flex justify-between mb-2">
                    <div className="h-3 bg-gray-200 rounded w-24" />
                    <div className="h-3 bg-gray-200 rounded w-12" />
                  </div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="h-4 bg-gray-200 rounded w-20" />
                    <div className="h-4 bg-gray-200 rounded w-8" />
                    <div className="h-4 bg-gray-200 rounded w-20" />
                  </div>
                  <div className="hidden lg:flex gap-1">
                    {[1, 2, 3, 4, 5, 6, 7].map((j) => (
                      <div key={j} className="h-8 bg-gray-200 rounded w-[52px]" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : liveEvents.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <span className="text-3xl block mb-2">📡</span>
              <p className="text-sm text-gray-400">Nessun evento live al momento</p>
              <Link href="/sport" className="text-xs text-brand font-semibold mt-2 inline-block hover:underline">
                Vedi eventi prematch
              </Link>
            </div>
          ) : (
            <>
              {/* ═══ DESKTOP TABLE ═══ */}
              <div className="hidden lg:block">
                {/* Column headers */}
                <div className="grid grid-cols-[1fr_repeat(7,52px)_40px] gap-1 px-3 py-2 text-[9px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-200">
                  <span>Evento</span>
                  <span className="text-center">1</span>
                  <span className="text-center">X</span>
                  <span className="text-center">2</span>
                  <span className="text-center">O</span>
                  <span className="text-center">U</span>
                  <span className="text-center">GG</span>
                  <span className="text-center">NG</span>
                  <span />
                </div>

                {Array.from(groupedByLeague.entries()).map(([league, events]) => (
                  <div key={league}>
                    {/* League separator */}
                    <div className="bg-gray-100 px-3 py-1.5 flex items-center gap-2">
                      <span className="text-[10px]">{events[0]?.leagueIcon}</span>
                      <span className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">{league}</span>
                      <span className="text-[9px] text-gray-400">({events.length})</span>
                    </div>

                    {events.map((e) => {
                      const m1x2 = getMarket(e, "1X2");
                      const mOU = getMarket(e, "U/O 2.5");
                      const mGG = getMarket(e, "GG/NG");

                      return (
                        <div
                          key={e.id}
                          className="grid grid-cols-[1fr_repeat(7,52px)_40px] gap-1 items-center px-3 py-2 border-b border-gray-100 hover:bg-red-50/30 transition-colors bg-red-50/15"
                        >
                          {/* Event info */}
                          <Link href={`/live/${e.id}`} className="flex items-center gap-2 min-w-0 hover:opacity-80">
                            <div className="flex-shrink-0 w-10 text-center">
                              <span className="text-[10px] font-black text-red-500 block">
                                {e.minute != null && e.minuteReceivedAt
                                  ? <LiveTimer minute={e.minute} receivedAt={e.minuteReceivedAt} />
                                  : <>{e.minute || 0}&apos;</>}
                              </span>
                              <span className="text-[7px] bg-red-500 text-white px-1 rounded font-bold">LIVE</span>
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <div className="min-w-0">
                                  <div className="text-xs font-bold text-gray-900 truncate">{e.home}</div>
                                  <div className="text-xs font-bold text-gray-900 truncate">{e.away}</div>
                                </div>
                                <span className="text-[10px] font-black bg-gray-200 px-1.5 py-0.5 rounded flex-shrink-0">
                                  {e.scoreH ?? 0}-{e.scoreA ?? 0}
                                </span>
                              </div>
                            </div>
                          </Link>

                          {/* 1X2 */}
                          {m1x2?.selections[0] ? <OddsCell event={e} marketName="1X2" sel={m1x2.selections[0]} /> : <span />}
                          {m1x2?.selections[1] ? <OddsCell event={e} marketName="1X2" sel={m1x2.selections[1]} /> : <span />}
                          {m1x2?.selections[2] ? <OddsCell event={e} marketName="1X2" sel={m1x2.selections[2]} /> : <span />}
                          {/* O/U */}
                          {mOU?.selections[0] ? <OddsCell event={e} marketName="U/O 2.5" sel={mOU.selections[0]} /> : <span />}
                          {mOU?.selections[1] ? <OddsCell event={e} marketName="U/O 2.5" sel={mOU.selections[1]} /> : <span />}
                          {/* GG/NG */}
                          {mGG?.selections[0] ? <OddsCell event={e} marketName="GG/NG" sel={mGG.selections[0]} /> : <span />}
                          {mGG?.selections[1] ? <OddsCell event={e} marketName="GG/NG" sel={mGG.selections[1]} /> : <span />}

                          {/* Detail link */}
                          <Link
                            href={`/live/${e.id}`}
                            className="text-center text-gray-400 hover:text-brand text-xs font-bold"
                            title="Tutti i mercati"
                          >
                            +
                          </Link>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* ═══ MOBILE CARDS ═══ */}
              <div className="lg:hidden space-y-1">
                {Array.from(groupedByLeague.entries()).map(([league, events]) => (
                  <div key={league}>
                    {/* League separator */}
                    <div className="bg-gray-100 rounded-lg px-3 py-1.5 mb-1 flex items-center gap-2">
                      <span className="text-[10px]">{events[0]?.leagueIcon}</span>
                      <span className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">{league}</span>
                    </div>

                    <div className="space-y-2 mb-3">
                      {events.map((e) => (
                        <div key={e.id} className="bg-white rounded-xl border border-red-200 bg-red-50/30 p-3">
                          <Link href={`/live/${e.id}`}>
                            <div className="flex justify-between items-center mb-2">
                              <span className="text-[10px] font-semibold text-gray-400">{e.leagueIcon} {e.league}</span>
                              <span className="text-[10px] font-bold text-red-500 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                                LIVE{" "}
                                {e.minute != null && e.minuteReceivedAt
                                  ? <LiveTimer minute={e.minute} receivedAt={e.minuteReceivedAt} />
                                  : <>{e.minute || 0}&apos;</>}
                              </span>
                            </div>
                            <div className="flex items-center justify-between mb-3">
                              <span className="text-sm font-bold text-gray-900">{e.home}</span>
                              <span className="text-sm font-black bg-gray-100 px-2 py-0.5 rounded">
                                {e.scoreH ?? 0}-{e.scoreA ?? 0}
                              </span>
                              <span className="text-sm font-bold text-gray-900">{e.away}</span>
                            </div>
                          </Link>
                          {e.markets.map((m) => (
                            <div key={m.name} className="mb-2 last:mb-0">
                              <div className="text-[9px] text-gray-400 font-semibold mb-1">{m.name}</div>
                              <div className={cn("grid gap-1.5", m.selections.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
                                {m.selections.map((s) => {
                                  const dir = getOddsDirection(s);
                                  return (
                                    <button
                                      key={`${s.label}-${s.changedAt || 0}`}
                                      onClick={() => toggleBet(e, m.name, s)}
                                      className={cn(
                                        "py-1.5 rounded-lg text-center border transition-all",
                                        isSelected(e.id, m.name, s.label)
                                          ? "border-brand bg-brand/10 ring-1 ring-brand"
                                          : "border-gray-200 bg-gray-50 hover:border-brand/50",
                                        dir === "up" && "odds-up",
                                        dir === "down" && "odds-down",
                                      )}
                                    >
                                      <span className="text-[9px] text-gray-400 block">{s.label}</span>
                                      <span className={cn(
                                        "text-xs font-bold",
                                        isSelected(e.id, m.name, s.label) ? "text-brand" : "text-gray-900",
                                      )}>
                                        {s.odds.toFixed(2)}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                          <Link href={`/live/${e.id}`} className="block mt-2 text-center text-[10px] text-brand font-semibold hover:underline">
                            Tutti i mercati →
                          </Link>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
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
            ({betslip.length}) &middot; {totalOdds.toFixed(2)}
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
