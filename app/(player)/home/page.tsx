"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/hooks/use-auth";
import { useSportsbook, type SportEvent, type Selection } from "@/lib/hooks/use-sportsbook";
import { useCasino, type CasinoGame } from "@/lib/hooks/use-casino";
import { usePromos } from "@/lib/hooks/use-promos";
import { createClient } from "@/lib/supabase/client";

// ═══ TYPES ═══

interface RecentBet {
  id: string;
  bet_type: string;
  stake: number;
  total_odds: number;
  potential_win: number;
  status: string;
  created_at: string;
  selections_count: number;
}

// ═══ COMPONENT ═══

export default function HomePage() {
  const { user, wallet } = useAuth();
  const {
    events: allEvents,
    loading: sportsLoading,
    isMockData,
    betslip,
    toggleBet,
    isSelected,
    clearBetslip,
    totalOdds,
    placeBet,
    placingBet,
  } = useSportsbook();
  const { games } = useCasino();
  const { promos } = usePromos();

  const [recentBets, setRecentBets] = useState<RecentBet[]>([]);
  const [stake, setStake] = useState("");
  const [showMobileBetslip, setShowMobileBetslip] = useState(false);
  const [betResult, setBetResult] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const { refreshWallet } = useAuth();

  // ── Fetch recent bets ──
  useEffect(() => {
    if (!user) return;
    const supabase = createClient();
    supabase
      .from("bets")
      .select("id, bet_type, stake, total_odds, potential_win, status, created_at, selections_count")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5)
      .then(({ data }) => {
        if (data) setRecentBets(data as RecentBet[]);
      });
  }, [user]);

  // ── Derived data ──
  const liveEvents = allEvents.filter((e) => e.live).slice(0, 4);
  const upcomingEvents = allEvents.filter((e) => !e.live).slice(0, 6);
  const hotGames = games.filter((g) => g.hot).slice(0, 6);
  const featuredPromos = promos.slice(0, 3);
  const potentialWin = stake ? parseFloat(stake) * totalOdds : 0;

  const handlePlaceBet = async () => {
    if (!stake || parseFloat(stake) <= 0) return;
    setBetResult(null);
    const result = await placeBet(parseFloat(stake));
    if (result.success) {
      setBetResult({
        type: "success",
        msg: result.flagged ? "Scommessa piazzata (in verifica)" : "Scommessa piazzata!",
      });
      setStake("");
      refreshWallet();
      setTimeout(() => setBetResult(null), 4000);
    } else {
      setBetResult({ type: "error", msg: result.error || "Errore" });
    }
  };

  // ── Odds cell component ──
  const OddsBtn = ({ event, marketName, sel }: { event: SportEvent; marketName: string; sel: Selection }) => {
    const active = isSelected(event.id, marketName, sel.label);
    return (
      <button
        onClick={() => toggleBet(event, marketName, sel)}
        className={cn(
          "px-2 py-1.5 rounded text-center border text-xs font-bold transition-all min-w-[48px]",
          active
            ? "border-brand bg-brand/10 text-brand ring-1 ring-brand"
            : "border-gray-200 bg-gray-50 text-gray-800 hover:border-brand/50 hover:bg-orange-50"
        )}
      >
        {sel.odds.toFixed(2)}
      </button>
    );
  };

  // ── Status badge ──
  const BetStatusBadge = ({ status }: { status: string }) => {
    const styles: Record<string, string> = {
      open: "bg-blue-50 text-blue-600",
      won: "bg-emerald-50 text-emerald-600",
      lost: "bg-red-50 text-red-600",
      void: "bg-gray-100 text-gray-500",
    };
    return (
      <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded", styles[status] || "bg-gray-100 text-gray-500")}>
        {status.toUpperCase()}
      </span>
    );
  };

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Buongiorno";
    if (h < 18) return "Buon pomeriggio";
    return "Buonasera";
  };

  return (
    <div className="p-4 lg:p-0">
      <div className="lg:flex lg:gap-5">
        {/* ═══ MAIN CONTENT ═══ */}
        <div className="flex-1 min-w-0">
          {/* ── Hero Banner ── */}
          <div className="rounded-2xl bg-gradient-to-br from-gray-900 via-gray-800 to-[#e8611c]/80 p-5 lg:p-7 mb-5 relative overflow-hidden">
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjAzKSIvPjwvc3ZnPg==')] opacity-50" />
            <div className="relative">
              {user ? (
                <>
                  <p className="text-white/60 text-xs mb-0.5">{greeting()}</p>
                  <h1 className="text-2xl lg:text-3xl font-black text-white mb-1">
                    {user.username || "Player"}
                  </h1>
                </>
              ) : (
                <h1 className="text-2xl lg:text-3xl font-black text-white mb-1">
                  Benvenuto su <span className="text-[#e8611c]">VinciTu</span>
                </h1>
              )}
              <p className="text-white/50 text-sm mb-4">Scommesse, Casino & Crypto in un unico posto.</p>

              {wallet && (
                <div className="flex items-center gap-4">
                  <div className="bg-white/10 backdrop-blur rounded-xl px-4 py-2.5">
                    <div className="text-[9px] text-white/50 font-semibold uppercase tracking-wider">Saldo</div>
                    <div className="text-xl font-black text-white font-mono">${wallet.balance?.toFixed(2) || "0.00"}</div>
                  </div>
                  <Link
                    href="/wallet"
                    className="px-5 py-2.5 rounded-xl bg-[#e8611c] text-white text-sm font-bold hover:bg-[#d4550f] transition-colors"
                  >
                    Deposita
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* ── Quick Actions ── */}
          <div className="grid grid-cols-4 gap-2 mb-5">
            {[
              { href: "/sport", icon: "⚽", label: "Scommetti", color: "from-blue-500 to-blue-600" },
              { href: "/casino", icon: "🎰", label: "Casino", color: "from-purple-500 to-violet-600" },
              { href: "/bets", icon: "🎫", label: "Le Mie Bet", color: "from-emerald-500 to-emerald-600" },
              { href: "/promo", icon: "🎁", label: "Promo", color: "from-orange-500 to-red-500" },
            ].map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className={cn(
                  "bg-gradient-to-br text-white rounded-xl p-3 text-center hover:scale-[1.02] transition-transform",
                  a.color
                )}
              >
                <span className="text-2xl block mb-1">{a.icon}</span>
                <span className="text-[10px] font-bold">{a.label}</span>
              </Link>
            ))}
          </div>

          {/* ── Mock data banner ── */}
          {isMockData && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-700 text-xs font-semibold text-center">
              Dati demo — Connetti Supabase per dati reali
            </div>
          )}

          {/* ── Live Now ── */}
          {liveEvents.length > 0 && (
            <section className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  <h2 className="text-sm font-bold text-gray-900">Live Ora</h2>
                  <span className="text-[10px] bg-red-50 text-red-500 font-bold px-2 py-0.5 rounded-full">
                    {liveEvents.length}
                  </span>
                </div>
                <Link href="/sport" className="text-[11px] text-brand font-semibold hover:underline">
                  Vedi tutti
                </Link>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                {liveEvents.map((e) => {
                  const m1x2 = e.markets.find((m) => m.name === "1X2");
                  return (
                    <div key={e.id} className="bg-white rounded-xl border border-red-100 p-3 hover:shadow-sm transition-shadow">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] text-gray-400 font-semibold">{e.leagueIcon} {e.league}</span>
                        <span className="text-[10px] font-bold text-red-500 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                          {e.minute}&apos;
                        </span>
                      </div>

                      <Link href={`/sport/${e.id}`} className="block mb-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-bold text-gray-900">{e.home}</span>
                          <span className="text-sm font-black bg-gray-100 px-2.5 py-0.5 rounded">{e.scoreH ?? 0}-{e.scoreA ?? 0}</span>
                          <span className="text-sm font-bold text-gray-900">{e.away}</span>
                        </div>
                      </Link>

                      {m1x2 && (
                        <div className="grid grid-cols-3 gap-1.5">
                          {m1x2.selections.map((sel) => (
                            <OddsBtn key={sel.label} event={e} marketName="1X2" sel={sel} />
                          ))}
                        </div>
                      )}

                      <Link href={`/sport/${e.id}`} className="block mt-2 text-center text-[10px] text-brand font-semibold hover:underline">
                        +{e.markets.length} mercati
                      </Link>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── Upcoming Events ── */}
          <section className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-gray-900">Prossimi Eventi</h2>
              <Link href="/sport" className="text-[11px] text-brand font-semibold hover:underline">
                Tutti gli sport
              </Link>
            </div>

            {sportsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-white rounded-xl border border-gray-200 p-3 animate-pulse">
                    <div className="h-3 bg-gray-200 rounded w-24 mb-2" />
                    <div className="flex justify-between mb-2">
                      <div className="h-4 bg-gray-200 rounded w-20" />
                      <div className="h-4 bg-gray-200 rounded w-20" />
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[1, 2, 3].map((j) => (
                        <div key={j} className="h-8 bg-gray-200 rounded" />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : upcomingEvents.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
                <span className="text-2xl block mb-1">🏟️</span>
                <p className="text-xs text-gray-400">Nessun evento prematch al momento</p>
              </div>
            ) : (
              <div className="space-y-2">
                {upcomingEvents.map((e) => {
                  const m1x2 = e.markets.find((m) => m.name === "1X2");
                  return (
                    <div key={e.id} className="bg-white rounded-xl border border-gray-200 p-3 hover:shadow-sm transition-shadow">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] text-gray-400 font-semibold">{e.leagueIcon} {e.league}</span>
                        <span className="text-[10px] text-gray-400 font-medium">{e.time}</span>
                      </div>
                      <Link href={`/sport/${e.id}`} className="flex items-center justify-between mb-2.5">
                        <span className="text-sm font-bold text-gray-900">{e.home}</span>
                        <span className="text-xs text-gray-400">vs</span>
                        <span className="text-sm font-bold text-gray-900">{e.away}</span>
                      </Link>
                      {m1x2 && (
                        <div className="grid grid-cols-3 gap-1.5">
                          {m1x2.selections.map((sel) => (
                            <button
                              key={sel.label}
                              onClick={() => toggleBet(e, "1X2", sel)}
                              className={cn(
                                "py-1.5 rounded-lg text-center border transition-all",
                                isSelected(e.id, "1X2", sel.label)
                                  ? "border-brand bg-brand/10 ring-1 ring-brand"
                                  : "border-gray-200 bg-gray-50 hover:border-brand/50"
                              )}
                            >
                              <span className="text-[9px] text-gray-400 block">{sel.label}</span>
                              <span className={cn(
                                "text-xs font-bold",
                                isSelected(e.id, "1X2", sel.label) ? "text-brand" : "text-gray-900"
                              )}>
                                {sel.odds.toFixed(2)}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Hot Casino Games ── */}
          <section className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-gray-900">Casino Popolari</h2>
              <Link href="/casino" className="text-[11px] text-brand font-semibold hover:underline">
                Tutti i giochi
              </Link>
            </div>

            <div className="grid grid-cols-3 lg:grid-cols-6 gap-2.5">
              {hotGames.map((game) => (
                <Link key={game.id} href="/casino" className="group">
                  <div className={cn(
                    "relative rounded-xl aspect-square bg-gradient-to-br flex items-center justify-center overflow-hidden",
                    game.color
                  )}>
                    <span className="text-4xl drop-shadow-lg group-hover:scale-110 transition-transform">{game.icon}</span>
                    {game.hot && (
                      <span className="absolute top-1.5 left-1.5 bg-red-500 text-white text-[7px] font-bold px-1 py-0.5 rounded">
                        HOT
                      </span>
                    )}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-white text-[10px] font-bold bg-white/20 backdrop-blur px-3 py-1.5 rounded-lg">GIOCA</span>
                    </div>
                  </div>
                  <div className="mt-1">
                    <div className="text-[11px] font-semibold text-gray-800 truncate">{game.name}</div>
                    <div className="text-[9px] text-gray-400">{game.provider}</div>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          {/* ── Promotions ── */}
          <section className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-gray-900">Promozioni</h2>
              <Link href="/promo" className="text-[11px] text-brand font-semibold hover:underline">
                Vedi tutte
              </Link>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {featuredPromos.map((promo) => (
                <Link key={promo.id} href="/promo" className="group">
                  <div className={cn("bg-gradient-to-r rounded-xl p-4 relative overflow-hidden hover:shadow-md transition-shadow", promo.color)}>
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-4xl opacity-20">{promo.icon}</span>
                    <span className="bg-white/20 backdrop-blur text-white text-[8px] font-bold px-2 py-0.5 rounded inline-block mb-2">
                      {promo.badge}
                    </span>
                    <h3 className="text-sm font-bold text-white mb-0.5">{promo.name}</h3>
                    <p className="text-[11px] text-white/70 line-clamp-2">{promo.desc}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          {/* ── Recent Bets ── */}
          {user && recentBets.length > 0 && (
            <section className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-gray-900">Le Mie Scommesse</h2>
                <Link href="/bets" className="text-[11px] text-brand font-semibold hover:underline">
                  Vedi tutte
                </Link>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                {recentBets.map((bet) => (
                  <Link key={bet.id} href="/bets" className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-sm flex-shrink-0">
                        {bet.bet_type === "singola" ? "1" : bet.selections_count}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-gray-800 capitalize">
                          {bet.bet_type} · {bet.selections_count} {bet.selections_count === 1 ? "selezione" : "selezioni"}
                        </div>
                        <div className="text-[10px] text-gray-400">
                          {new Date(bet.created_at).toLocaleDateString("it-IT", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-xs font-bold text-gray-900 font-mono">${bet.stake.toFixed(2)}</div>
                      <BetStatusBadge status={bet.status} />
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* ═══ DESKTOP BETSLIP SIDEBAR ═══ */}
        <div className="hidden lg:block w-72 flex-shrink-0">
          <div className="sticky top-20 bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="bg-gray-900 text-white px-4 py-3 flex justify-between items-center">
              <span className="text-sm font-bold">Schedina</span>
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
                <p className="text-xs text-gray-400">Clicca sulle quote per aggiungere</p>
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
                        <button
                          onClick={() => {
                            const ev = allEvents.find((e) => e.id === b.eventId);
                            if (ev) toggleBet(ev, b.marketName, { label: b.selection, odds: b.odds });
                          }}
                          className="text-gray-300 hover:text-red-400 text-[10px]"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {betslip.length > 1 && (
                  <div className="flex justify-between text-xs mt-2 pt-2 border-t border-gray-200">
                    <span className="text-gray-500">
                      {betslip.length === 2 ? "Doppia" : betslip.length === 3 ? "Tripla" : `Multipla (${betslip.length})`}
                    </span>
                    <span className="font-bold font-mono">{totalOdds.toFixed(2)}</span>
                  </div>
                )}

                <div className="mt-3">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                    <input
                      type="number"
                      value={stake}
                      onChange={(e) => setStake(e.target.value)}
                      placeholder="Importo"
                      className="w-full pl-6 pr-3 py-2 rounded-lg border border-gray-200 text-xs font-mono focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                    />
                  </div>
                  <div className="flex gap-1 mt-1.5">
                    {[5, 10, 25, 50, 100].map((v) => (
                      <button
                        key={v}
                        onClick={() => setStake(String(v))}
                        className="flex-1 py-1 rounded bg-gray-100 text-[9px] font-bold text-gray-500 hover:bg-gray-200"
                      >
                        ${v}
                      </button>
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
                  <div className={cn(
                    "mt-2 px-2 py-1.5 rounded text-[10px] font-semibold text-center",
                    betResult.type === "success" ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
                  )}>
                    {betResult.msg}
                  </div>
                )}

                <button
                  onClick={handlePlaceBet}
                  disabled={placingBet || !stake || parseFloat(stake) <= 0}
                  className={cn(
                    "w-full mt-2 py-2.5 rounded-xl text-white text-sm font-bold transition-all",
                    placingBet ? "bg-gray-400" : "bg-brand hover:bg-brand-dark",
                    (!stake || parseFloat(stake) <= 0) && "opacity-50"
                  )}
                >
                  {placingBet ? "Piazzando..." : "Piazza Scommessa"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ MOBILE BETSLIP ═══ */}
      {betslip.length > 0 && (
        <div className="lg:hidden fixed bottom-20 left-1/2 -translate-x-1/2 max-w-[400px] w-[calc(100%-2rem)] z-40">
          <button
            onClick={() => setShowMobileBetslip(!showMobileBetslip)}
            className="w-full py-3 rounded-xl bg-brand text-white font-bold text-sm shadow-lg flex items-center justify-center gap-2"
          >
            ({betslip.length}) · {totalOdds.toFixed(2)}
          </button>
        </div>
      )}

      {showMobileBetslip && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/50" onClick={() => setShowMobileBetslip(false)}>
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[70vh] overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm font-bold">Schedina ({betslip.length})</span>
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
            <div className="flex justify-between text-xs mt-2">
              <span>Quota</span>
              <span className="font-bold font-mono">{totalOdds.toFixed(2)}</span>
            </div>
            <input
              type="number"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              placeholder="$ Importo"
              className="w-full mt-3 px-3 py-2.5 rounded-lg border border-gray-200 text-sm font-mono"
            />
            {stake && parseFloat(stake) > 0 && (
              <div className="flex justify-between text-xs mt-2">
                <span className="text-gray-500">Vincita</span>
                <span className="font-bold text-emerald-500">${potentialWin.toFixed(2)}</span>
              </div>
            )}
            <button
              onClick={handlePlaceBet}
              disabled={placingBet || !stake}
              className="w-full mt-3 py-3 rounded-xl bg-brand text-white font-bold text-sm"
            >
              {placingBet ? "Piazzando..." : "Piazza Scommessa"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
