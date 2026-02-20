"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/hooks/use-auth";
import {
  useSportsbook,
  mapDbToSportEvent,
  type SportEvent,
  type Market,
  type Selection,
  type MatchStats,
  type MatchEvent,
} from "@/lib/hooks/use-sportsbook";
import { createClient } from "@/lib/supabase/client";

// ═══ LIVE TIMER — auto-increments minute between server pushes ═══
function LiveTimer({ minute, receivedAt }: { minute: number; receivedAt: number }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 10000);
    return () => clearInterval(interval);
  }, []);

  const elapsed = Math.floor((Date.now() - receivedAt) / 60000);
  const displayMinute = minute + elapsed;

  return <>{displayMinute}&apos;</>;
}

// ═══ ODDS DIRECTION HELPER ═══
function getOddsDirection(sel: Selection): "up" | "down" | null {
  if (!sel.changedAt || sel.previousOdds == null) return null;
  if (Date.now() - sel.changedAt > 5000) return null;
  if (sel.odds > sel.previousOdds) return "up";
  if (sel.odds < sel.previousOdds) return "down";
  return null;
}

// ═══ PERIOD LABELS ═══
const PERIOD_LABELS: Record<string, string> = {
  FIRST_HALF: "1T",
  HALF_TIME: "Intervallo",
  SECOND_HALF: "2T",
  EXTRA_FIRST_HALF: "1T Suppl.",
  EXTRA_SECOND_HALF: "2T Suppl.",
  PENALTY: "Rigori",
};

function getPeriodBadge(period?: string) {
  if (!period) return null;
  const label = PERIOD_LABELS[period] || period;
  const isInterval = period === "HALF_TIME";
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold",
        isInterval
          ? "bg-yellow-400/20 text-yellow-300"
          : "bg-emerald-400/20 text-emerald-300"
      )}
    >
      {label}
    </span>
  );
}

// ═══ BETRADAR-STYLE STATS ═══

const STAT_LABELS: Record<string, string> = {
  possession: "POSSESSO PALLA",
  shots: "TIRI TOTALI",
  shotsOnTarget: "TIRI IN PORTA",
  corners: "CORNER",
  fouls: "FALLI",
  yellowCards: "CARTELLINI GIALLI",
  redCards: "CARTELLINI ROSSI",
  offsides: "FUORIGIOCO",
  saves: "PARATE",
};

function StatBar({ label, home, away, isPct }: { label: string; home: number; away: number; isPct?: boolean }) {
  const total = home + away;
  const homePct = total > 0 ? (home / total) * 100 : 50;
  const homeWins = home > away;
  const awayWins = away > home;
  const suffix = isPct ? "%" : "";

  return (
    <div className="py-[7px]">
      <div className="flex items-center">
        {/* Home value */}
        <span className={cn(
          "text-[13px] tabular-nums w-10 text-left font-mono",
          homeWins ? "font-bold text-white" : "text-white/60"
        )}>
          {home}{suffix}
        </span>
        {/* Bar + label */}
        <div className="flex-1 relative">
          {/* Label above bar */}
          <div className="text-[10px] text-white/50 font-semibold text-center mb-1 tracking-wide">
            {label}
          </div>
          {/* Bar track */}
          <div className="h-[3px] bg-white/10 relative">
            {/* Home bar — grows from left */}
            <div
              className="absolute left-0 top-0 h-full transition-all duration-700 ease-out"
              style={{
                width: `${total > 0 ? homePct : 50}%`,
                backgroundColor: homeWins ? "#3b82f6" : "rgba(255,255,255,0.25)",
              }}
            />
            {/* Away bar — grows from right */}
            <div
              className="absolute right-0 top-0 h-full transition-all duration-700 ease-out"
              style={{
                width: `${total > 0 ? (100 - homePct) : 50}%`,
                backgroundColor: awayWins ? "#ef4444" : "rgba(255,255,255,0.25)",
              }}
            />
          </div>
        </div>
        {/* Away value */}
        <span className={cn(
          "text-[13px] tabular-nums w-10 text-right font-mono",
          awayWins ? "font-bold text-white" : "text-white/60"
        )}>
          {away}{suffix}
        </span>
      </div>
    </div>
  );
}

function CardsRow({ stats }: { stats: MatchStats }) {
  const yHome = stats.yellowCards[0];
  const yAway = stats.yellowCards[1];
  const rHome = stats.redCards[0];
  const rAway = stats.redCards[1];
  if (yHome + yAway + rHome + rAway === 0) return null;

  return (
    <div className="flex items-center justify-center gap-6 py-3 border-b border-white/10">
      {/* Home cards */}
      <div className="flex items-center gap-1.5">
        <span className="text-white/80 text-[13px] font-mono font-bold">{yHome}</span>
        <div className="w-3 h-4 rounded-[1px] bg-yellow-400" />
        <div className="w-3 h-4 rounded-[1px] bg-red-500 ml-0.5" />
        <span className="text-white/80 text-[13px] font-mono font-bold">{rHome}</span>
      </div>
      <span className="text-[10px] text-white/40 font-semibold tracking-wider">CARTELLINI</span>
      {/* Away cards */}
      <div className="flex items-center gap-1.5">
        <span className="text-white/80 text-[13px] font-mono font-bold">{yAway}</span>
        <div className="w-3 h-4 rounded-[1px] bg-yellow-400" />
        <div className="w-3 h-4 rounded-[1px] bg-red-500 ml-0.5" />
        <span className="text-white/80 text-[13px] font-mono font-bold">{rAway}</span>
      </div>
    </div>
  );
}

function StatsPanel({ stats, home, away }: { stats: MatchStats; home: string; away: string }) {
  const mainStats: (keyof MatchStats)[] = [
    "possession", "shots", "shotsOnTarget", "corners", "fouls", "offsides", "saves",
  ];

  return (
    <div className="rounded-xl overflow-hidden" style={{ backgroundColor: "#0a1929" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <span className="text-[11px] font-bold text-white/90 truncate max-w-[40%]">{home}</span>
        <span className="text-[10px] font-semibold text-white/40 tracking-wider">STATISTICHE</span>
        <span className="text-[11px] font-bold text-white/90 truncate max-w-[40%] text-right">{away}</span>
      </div>
      {/* Cards summary */}
      <CardsRow stats={stats} />
      {/* Stat bars */}
      <div className="px-4 py-1">
        {mainStats.map((key) => {
          const val = stats[key];
          if (!val) return null;
          return (
            <StatBar
              key={key}
              label={STAT_LABELS[key] || key}
              home={val[0]}
              away={val[1]}
              isPct={key === "possession"}
            />
          );
        })}
      </div>
    </div>
  );
}

// ═══ EVENT TIMELINE (BetRadar style) ═══

const EVENT_ICONS: Record<string, string> = {
  goal: "\u26BD",
  yellow_card: "\uD83D\uDFE8",
  red_card: "\uD83D\uDFE5",
  substitution: "\uD83D\uDD04",
  var: "\uD83D\uDCFA",
};

function EventTimeline({ events, home, away }: { events: MatchEvent[]; home: string; away: string }) {
  if (events.length === 0) return null;

  const sorted = [...events].sort((a, b) => b.minute - a.minute);

  return (
    <div className="rounded-xl overflow-hidden mt-3" style={{ backgroundColor: "#0a1929" }}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10">
        <span className="text-[10px] font-semibold text-white/40 tracking-wider">CRONACA</span>
      </div>
      <div className="divide-y divide-white/5">
        {sorted.map((evt, i) => {
          const isHome = evt.team === "home";
          const icon = EVENT_ICONS[evt.type] || "\u25CF";
          const playerName = evt.player || evt.detail || evt.type;

          return (
            <div key={`${evt.minute}-${evt.type}-${i}`} className="flex items-center px-4 py-2">
              {/* Home side */}
              <div className="flex-1 min-w-0">
                {isHome && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-white/90 truncate">{playerName}</span>
                    {evt.assist && (
                      <span className="text-[10px] text-white/40 truncate hidden sm:inline">({evt.assist})</span>
                    )}
                  </div>
                )}
              </div>
              {/* Center — icon + minute */}
              <div className="flex items-center gap-1.5 flex-shrink-0 mx-3">
                {isHome && <span className="text-sm">{icon}</span>}
                <span className="text-[11px] font-bold text-white/50 tabular-nums font-mono w-7 text-center">
                  {evt.minute}&apos;
                </span>
                {!isHome && <span className="text-sm">{icon}</span>}
              </div>
              {/* Away side */}
              <div className="flex-1 min-w-0 text-right">
                {!isHome && (
                  <div className="flex items-center justify-end gap-2">
                    {evt.assist && (
                      <span className="text-[10px] text-white/40 truncate hidden sm:inline">({evt.assist})</span>
                    )}
                    <span className="text-[11px] font-semibold text-white/90 truncate">{playerName}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══ MARKET GROUP DEFINITIONS ═══

interface MarketGroup {
  id: string;
  label: string;
  markets: Market[];
}

const GROUP_ORDER = ["risultato", "gol", "handicap", "combo", "esatti", "altro"] as const;

const GROUP_LABELS: Record<string, string> = {
  risultato: "Risultato",
  gol: "Gol",
  handicap: "Handicap",
  combo: "Combo",
  esatti: "Esatti",
  altro: "Altro",
};

function getMarketGroupId(market: Market): string {
  const type = (market.marketType || "").toLowerCase();
  const name = (market.name || "").toLowerCase();

  // Risultato
  if (name === "1x2" || name === "1x2 primo tempo") return "risultato";
  if (name.includes("doppia chance") || type === "double_chance") return "risultato";
  if (name.includes("draw no bet") || type === "draw_no_bet") return "risultato";
  if (name.includes("resto del match")) return "risultato";
  if (name.includes("pari/dispari") && !name.includes("angoli")) return "risultato";

  // Gol
  if (name.includes("under/over") || name.startsWith("o/u") || name.startsWith("u/o")) return "gol";
  if (name.includes("gol/nogol") || name === "gg/ng") return "gol";
  if (name.includes("somma gol")) return "gol";
  if (name.includes("prossimo gol") && !name.includes("+")) return "gol";
  if (name.includes("rete inviolata") || name.includes("vincente a 0") || name.includes("clean sheet")) return "gol";

  // Handicap
  if (name.includes("handicap") || name.includes("1x2 hand")) return "handicap";

  // Combo
  if (name.includes("1x2 +") || name.includes("dc +")) return "combo";
  if (name.includes("esito") && name.includes("tempo/finale")) return "combo";
  if (name.includes("ht/ft") || type === "ht_ft") return "combo";
  if (name.includes("metodo prossimo gol") || name.includes("pros marc +") || name.includes("marc +")) return "combo";

  // Esatti
  if (name.includes("risultato esatto") || name.includes("exact score")) return "esatti";

  return "altro";
}

function groupMarkets(markets: Market[]): MarketGroup[] {
  const map = new Map<string, Market[]>();

  for (const m of markets) {
    if (m.selections.length === 0) continue;
    const gid = getMarketGroupId(m);
    const arr = map.get(gid) || [];
    arr.push(m);
    map.set(gid, arr);
  }

  const groups: MarketGroup[] = [];
  for (const id of GROUP_ORDER) {
    const mkts = map.get(id);
    if (mkts && mkts.length > 0) {
      groups.push({ id, label: GROUP_LABELS[id], markets: mkts });
    }
  }
  return groups;
}

// ═══ PAGE COMPONENT ═══

export default function EventDetail() {
  const params = useParams();
  const router = useRouter();
  const { user, wallet } = useAuth();
  const {
    allEvents,
    loading: hookLoading,
    isMockData,
    betslip,
    placingBet,
    toggleBet,
    isSelected,
    clearBetslip,
    totalOdds,
    placeBet,
  } = useSportsbook();

  const [stake, setStake] = useState("");
  const [msg, setMsg] = useState("");
  const [showMobileBetslip, setShowMobileBetslip] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>(null);

  // Direct-fetch state for when event isn't in the hook's list
  const [directEvent, setDirectEvent] = useState<SportEvent | null>(null);
  const [directLoading, setDirectLoading] = useState(false);
  const [directError, setDirectError] = useState<string | null>(null);

  const eventId = typeof params?.id === "string" ? params.id : "";

  // Try to find event from hook first
  const hookEvent = useMemo(
    () => allEvents.find((e) => e.id === eventId),
    [allEvents, eventId]
  );

  const supabaseDetail = useMemo(() => createClient(), []);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reusable fetch for full event with ALL markets
  const fetchFullEvent = useCallback(async (isInitial = false) => {
    if (!eventId) return;
    if (isInitial) { setDirectLoading(true); setDirectError(null); }
    try {
      const { data, error } = await supabaseDetail
        .from("events")
        .select(`
          *,
          sport:sports(name, slug, icon),
          league:leagues(name, slug, country, logo_url),
          markets(
            id, name, slug, market_type, line, sort_order, is_active, is_suspended,
            outcomes(id, name, odds, previous_odds, is_active, is_suspended)
          )
        `)
        .eq("id", eventId)
        .single();

      if (error) throw error;
      if (!data) return;

      const mapped = mapDbToSportEvent(data, true);

      if (isInitial) {
        setDirectEvent(mapped);
      } else {
        // Compare with previous state to detect odds changes + preserve timer
        setDirectEvent((prev) => {
          if (!prev) return mapped;

          // Keep timer stable if minute hasn't changed
          if (prev.minute === mapped.minute && prev.minuteReceivedAt) {
            mapped.minuteReceivedAt = prev.minuteReceivedAt;
          }

          // Build map of previous selection state
          const prevSels = new Map<string, Selection>();
          for (const m of prev.markets) {
            for (const s of m.selections) {
              if (s.id) prevSels.set(s.id, s);
            }
          }

          return {
            ...mapped,
            markets: mapped.markets.map((m) => ({
              ...m,
              selections: m.selections.map((s) => {
                if (!s.id) return s;
                const old = prevSels.get(s.id);
                if (!old) return s;

                // Odds actually changed → new flash
                if (old.odds !== s.odds) {
                  return { ...s, previousOdds: old.odds, changedAt: Date.now() };
                }

                // Preserve ongoing flash from previous state
                if (old.changedAt && Date.now() - old.changedAt < 5000) {
                  return { ...s, changedAt: old.changedAt, previousOdds: old.previousOdds };
                }

                return s;
              }),
            })),
          };
        });
      }
    } catch (err: unknown) {
      if (isInitial) {
        const message = err instanceof Error ? err.message : "Errore nel caricamento";
        setDirectError(message);
      }
    } finally {
      if (isInitial) setDirectLoading(false);
    }
  }, [eventId, supabaseDetail]);

  // Initial fetch
  useEffect(() => {
    fetchFullEvent(true);
  }, [fetchFullEvent]);

  // Auto-refresh every 30s for live events
  useEffect(() => {
    const isLive = directEvent?.live || hookEvent?.live;
    if (!isLive || !eventId) {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      return;
    }

    intervalRef.current = setInterval(() => fetchFullEvent(false), 15_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [directEvent?.live, hookEvent?.live, eventId, fetchFullEvent]);

  // Collect known market IDs so we can filter outcome realtime events
  const marketIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const ids = new Set<string>();
    if (directEvent) {
      for (const m of directEvent.markets) {
        if (m.id) ids.add(m.id);
      }
    }
    marketIdsRef.current = ids;
  }, [directEvent]);

  // Debounced refetch for outcome changes
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedRefetch = useCallback(() => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    refetchTimerRef.current = setTimeout(() => fetchFullEvent(false), 500);
  }, [fetchFullEvent]);

  // Realtime: score/status updates + outcome changes (suspended, odds)
  useEffect(() => {
    if (!eventId) return;

    const channel = supabaseDetail
      .channel(`detail-${eventId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "events", filter: `id=eq.${eventId}` },
        (payload) => {
          const updated = payload.new as Record<string, any>;
          const updatedLiveData = updated.live_data || {};

          setDirectEvent((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              live: updated.is_live || false,
              minute: updated.minute,
              minuteReceivedAt: updated.is_live ? Date.now() : undefined,
              scoreH: updated.score_home,
              scoreA: updated.score_away,
              period: updated.period || undefined,
              periodCode: updatedLiveData.periodCode ?? undefined,
              halfScoreHome: Array.isArray(updatedLiveData.halfScoreHome) ? updatedLiveData.halfScoreHome : undefined,
              halfScoreAway: Array.isArray(updatedLiveData.halfScoreAway) ? updatedLiveData.halfScoreAway : undefined,
              stats: updatedLiveData.stats || undefined,
              matchEvents: Array.isArray(updatedLiveData.matchEvents) ? updatedLiveData.matchEvents : undefined,
            };
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "outcomes" },
        (payload) => {
          const updated = payload.new as Record<string, any>;
          if (!marketIdsRef.current.has(updated.market_id)) return;

          // Inline update: instant odds flash + suspended status
          const newOdds = parseFloat(updated.odds);
          setDirectEvent((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              markets: prev.markets.map((m) =>
                m.id === updated.market_id
                  ? {
                      ...m,
                      selections: m.selections.map((sel) => {
                        if (sel.id !== updated.id) return sel;
                        const oddsChanged = sel.odds !== newOdds;
                        return {
                          ...sel,
                          previousOdds: oddsChanged ? sel.odds : sel.previousOdds,
                          odds: newOdds,
                          changedAt: oddsChanged ? Date.now() : sel.changedAt,
                          suspended: updated.is_suspended || undefined,
                        };
                      }),
                    }
                  : m
              ),
            };
          });

          // Debounced full refetch for structural changes (new/removed outcomes)
          debouncedRefetch();
        }
      )
      .subscribe();

    return () => {
      supabaseDetail.removeChannel(channel);
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    };
  }, [eventId, supabaseDetail, debouncedRefetch]);

  // Use direct fetch (full markets) when available, fallback to hook
  const ev = directEvent || hookEvent;
  const loading = !directEvent && (hookLoading || directLoading);

  // Market groups
  const groups = useMemo(() => (ev ? groupMarkets(ev.markets) : []), [ev]);

  // Whether we have stats to show
  const hasStats = !!(ev?.live && ev?.stats);

  // Set default active tab to "statistiche" if live with stats, otherwise first market group
  useEffect(() => {
    if (activeTab === null) {
      if (hasStats) {
        setActiveTab("statistiche");
      } else if (groups.length > 0) {
        setActiveTab(groups[0].id);
      }
    }
  }, [groups, activeTab, hasStats]);

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeTab) || groups[0] || null,
    [groups, activeTab]
  );

  const totalMarketsCount = useMemo(
    () => groups.reduce((sum, g) => sum + g.markets.length, 0),
    [groups]
  );

  // Half-time scores display
  const halfScoreDisplay = useMemo(() => {
    if (!ev?.halfScoreHome?.length || !ev?.halfScoreAway?.length) return null;
    return ev.halfScoreHome.map((h, i) => `${h}-${ev.halfScoreAway?.[i] ?? "?"}`).join(", ");
  }, [ev]);

  // Potential win
  const potentialWin = stake ? parseFloat(stake) * totalOdds : 0;

  // Place bet handler
  const handlePlaceBet = async () => {
    if (!stake || parseFloat(stake) <= 0) return;
    setMsg("");
    const result = await placeBet(parseFloat(stake));
    if (result.success) {
      if (result.flagged) {
        setMsg("warn:Scommessa piazzata — in verifica dal sistema di sicurezza");
      } else {
        setMsg("ok:Scommessa piazzata!");
      }
      setStake("");
      setTimeout(() => setMsg(""), 4000);
    } else {
      setMsg(`err:${result.error}`);
    }
  };

  const msgType = msg.split(":")[0];
  const msgText = msg.slice(msg.indexOf(":") + 1);

  // ── Loading skeleton ──
  if (loading) {
    return (
      <div className="p-4 lg:p-0 animate-pulse">
        <div className="h-3 w-48 bg-gray-200 rounded mb-3" />
        <div className="h-44 bg-gray-200 rounded-2xl mb-5" />
        <div className="lg:flex lg:gap-5">
          <div className="flex-1 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-gray-200 rounded-xl h-32" />
            ))}
          </div>
          <div className="hidden lg:block w-72">
            <div className="h-72 bg-gray-200 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  // ── Event not found ──
  if (!ev) {
    return (
      <div className="p-6 text-center">
        {directError && (
          <p className="text-red-500 text-xs mb-3">{directError}</p>
        )}
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

  return (
    <div className="p-4 lg:p-0">
      {/* Mock data banner */}
      {isMockData && (
        <div className="mb-4 px-4 py-2 rounded-xl bg-yellow-50 border border-yellow-200 text-yellow-700 text-xs font-medium text-center">
          Dati demo — Connetti Supabase per dati reali
        </div>
      )}

      {/* ── Breadcrumb ── */}
      <nav className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <Link href="/sport" className="hover:text-brand transition-colors">
          Sport
        </Link>
        <span>/</span>
        <span className="text-gray-500">{ev.league}</span>
        <span>/</span>
        <span className="text-gray-600 font-medium truncate">
          {ev.home} vs {ev.away}
        </span>
      </nav>

      {/* ── Event Header ── */}
      {ev.live ? (
        /* LIVE header — simple pitch SVG background */
        <div
          className="rounded-2xl mb-5 relative overflow-hidden"
          style={{ backgroundColor: "#1a472a", minHeight: "180px" }}
        >
          <svg
            viewBox="0 0 600 180"
            className="absolute inset-0 w-full h-full"
            preserveAspectRatio="xMidYMid slice"
          >
            <rect width="600" height="180" fill="transparent" />
            <rect x="30" y="10" width="540" height="160" fill="none" stroke="white" strokeOpacity="0.12" strokeWidth="1.5" rx="2" />
            <line x1="300" y1="10" x2="300" y2="170" stroke="white" strokeOpacity="0.12" strokeWidth="1.5" />
            <circle cx="300" cy="90" r="35" fill="none" stroke="white" strokeOpacity="0.12" strokeWidth="1.5" />
            <circle cx="300" cy="90" r="2" fill="white" fillOpacity="0.15" />
            <rect x="30" y="35" width="70" height="110" fill="none" stroke="white" strokeOpacity="0.1" strokeWidth="1.2" />
            <rect x="30" y="60" width="30" height="60" fill="none" stroke="white" strokeOpacity="0.08" strokeWidth="1" />
            <rect x="500" y="35" width="70" height="110" fill="none" stroke="white" strokeOpacity="0.1" strokeWidth="1.2" />
            <rect x="540" y="60" width="30" height="60" fill="none" stroke="white" strokeOpacity="0.08" strokeWidth="1" />
            <path d="M 100 65 A 20 20 0 0 1 100 115" fill="none" stroke="white" strokeOpacity="0.08" strokeWidth="1" />
            <path d="M 500 65 A 20 20 0 0 0 500 115" fill="none" stroke="white" strokeOpacity="0.08" strokeWidth="1" />
          </svg>

          {/* Content overlay */}
          <div className="relative z-10 px-6 py-5 flex flex-col items-center justify-center min-h-[180px]">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] text-white/50">
                {ev.leagueIcon} {ev.league}
              </span>
              <div className="flex items-center gap-1.5 bg-black/30 rounded-full px-2.5 py-0.5">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                <span className="text-white text-[10px] font-bold">
                  LIVE{" "}
                  {ev.minute != null && ev.minuteReceivedAt
                    ? <LiveTimer minute={ev.minute} receivedAt={ev.minuteReceivedAt} />
                    : <>{ev.minute || 0}&apos;</>}
                </span>
              </div>
              {ev.period && getPeriodBadge(ev.period)}
            </div>

            <div className="flex items-center justify-center gap-6 sm:gap-10">
              <div className="text-center flex-1 min-w-0">
                <div className="text-lg sm:text-xl font-black text-white truncate">{ev.home}</div>
              </div>
              <div className="text-center flex-shrink-0">
                <div className="text-4xl sm:text-5xl font-black text-white tabular-nums tracking-wider">
                  {ev.scoreH ?? 0} - {ev.scoreA ?? 0}
                </div>
                {halfScoreDisplay && (
                  <div className="text-[11px] text-white/50 mt-1">(PT: {halfScoreDisplay})</div>
                )}
              </div>
              <div className="text-center flex-1 min-w-0">
                <div className="text-lg sm:text-xl font-black text-white truncate">{ev.away}</div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* PREMATCH header — dark gradient */
        <div className="rounded-2xl p-6 mb-5 relative overflow-hidden bg-gradient-to-r from-gray-800 to-gray-700">
          <div className="text-[10px] text-white/60 mb-4">
            {ev.leagueIcon} {ev.league}
          </div>

          <div className="flex items-center justify-center gap-8">
            <div className="text-center flex-1">
              <div className="text-xl font-black text-white">{ev.home}</div>
            </div>

            <div className="text-center flex-shrink-0">
              <div className="text-sm font-bold text-white/60">VS</div>
              <div className="text-[10px] text-white/40 mt-0.5">{ev.time}</div>
            </div>

            <div className="text-center flex-1">
              <div className="text-xl font-black text-white">{ev.away}</div>
            </div>
          </div>
        </div>
      )}

      <div className="lg:flex lg:gap-5">
        {/* ═══ MARKETS COLUMN ═══ */}
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-gray-900 mb-3">
            Mercati ({totalMarketsCount})
          </h2>

          {groups.length === 0 && !hasStats ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <p className="text-gray-400 text-sm">
                Nessun mercato disponibile
              </p>
            </div>
          ) : (
            <>
              {/* ── Horizontal category tabs (with optional Statistiche tab) ── */}
              <div className="mb-4 overflow-x-auto no-scrollbar">
                <div className="flex gap-0 border-b border-gray-200 min-w-max">
                  {hasStats && (
                    <button
                      onClick={() => setActiveTab("statistiche")}
                      className={cn(
                        "px-4 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors border-b-2 -mb-px",
                        activeTab === "statistiche"
                          ? "border-brand text-brand"
                          : "border-transparent text-gray-500 hover:text-gray-700"
                      )}
                    >
                      Statistiche
                    </button>
                  )}
                  {groups.map((group) => (
                    <button
                      key={group.id}
                      onClick={() => setActiveTab(group.id)}
                      className={cn(
                        "px-4 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors border-b-2 -mb-px",
                        activeTab === group.id
                          ? "border-brand text-brand"
                          : "border-transparent text-gray-500 hover:text-gray-700"
                      )}
                    >
                      {group.label}
                      <span className="ml-1 text-gray-400 font-normal">
                        ({group.markets.length})
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Statistiche panel ── */}
              {activeTab === "statistiche" && ev.stats && (
                <div className="space-y-3">
                  <StatsPanel stats={ev.stats} home={ev.home} away={ev.away} />
                  {ev.matchEvents && ev.matchEvents.length > 0 && (
                    <EventTimeline events={ev.matchEvents} home={ev.home} away={ev.away} />
                  )}
                </div>
              )}

              {/* ── Markets grid for active tab ── */}
              {activeTab !== "statistiche" && activeGroup && (
                <div className="space-y-3">
                  {activeGroup.markets.map((market) => (
                    <div
                      key={market.id || market.name}
                      className="bg-white rounded-xl border border-gray-200 overflow-hidden"
                    >
                      {/* Market name header (only if group has multiple markets) */}
                      {activeGroup.markets.length > 1 && (
                        <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                          <span className="text-[11px] text-gray-500 font-semibold">
                            {market.name}
                          </span>
                        </div>
                      )}
                      <div className="px-4 py-3">
                        <div
                          className={cn(
                            "gap-2",
                            market.selections.length <= 3
                              ? "flex"
                              : "grid grid-cols-3 lg:grid-cols-4"
                          )}
                        >
                          {market.selections.map((sel) => {
                            if (sel.suspended) {
                              return (
                                <div
                                  key={`${sel.id || sel.label}-suspended`}
                                  className="flex-1 py-2.5 px-2 rounded-lg text-center border-2 border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed min-w-0"
                                >
                                  <div className="text-[10px] text-gray-400 truncate">
                                    {sel.label}
                                  </div>
                                  <div className="text-sm text-gray-400">
                                    &#x1f512;
                                  </div>
                                </div>
                              );
                            }

                            const selected = isSelected(
                              ev.id,
                              market.name,
                              sel.label
                            );
                            const dir = getOddsDirection(sel);

                            return (
                              <button
                                key={`${sel.id || sel.label}-${sel.changedAt || 0}`}
                                onClick={() =>
                                  toggleBet(ev, market.name, sel)
                                }
                                className={cn(
                                  "flex-1 py-2.5 px-2 rounded-lg text-center border-2 transition-all min-w-0",
                                  selected
                                    ? "border-brand bg-brand/10 ring-1 ring-brand"
                                    : "border-gray-200 hover:border-gray-300",
                                  dir === "up" && "odds-up",
                                  dir === "down" && "odds-down"
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
                                      : dir === "up"
                                        ? "text-emerald-500"
                                        : dir === "down"
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
                    </div>
                  ))}
                </div>
              )}
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
                  <span className="bg-brand text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {betslip.length}
                  </span>
                  <button
                    onClick={clearBetslip}
                    className="text-gray-400 hover:text-white text-xs"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>

            {betslip.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-xs text-gray-400">Clicca sulle quote</p>
              </div>
            ) : (
              <div className="p-3">
                <div className="max-h-[280px] overflow-y-auto">
                  {betslip.map((b, i) => {
                    const bEvent = allEvents.find((e) => e.id === b.eventId) || ev;
                    return (
                      <div
                        key={i}
                        className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
                      >
                        <div className="min-w-0 flex-1 mr-2">
                          <div className="text-[11px] font-semibold text-gray-800 truncate">
                            {b.match}
                          </div>
                          <div className="text-[9px] text-gray-400">
                            {b.marketName}: {b.selection}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className="text-xs font-bold text-brand font-mono">
                            {b.odds.toFixed(2)}
                          </span>
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
                            className="text-gray-300 hover:text-red-400 text-[10px]"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {betslip.length > 1 && (
                  <div className="flex justify-between text-xs mt-2 pt-2 border-t border-gray-200">
                    <span className="text-gray-500">
                      {betslip.length === 2
                        ? "Doppia"
                        : betslip.length === 3
                          ? "Tripla"
                          : `Multipla (${betslip.length})`}
                    </span>
                    <span className="font-bold font-mono">
                      {totalOdds.toFixed(2)}
                    </span>
                  </div>
                )}

                {/* Stake */}
                <div className="mt-3">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">
                      $
                    </span>
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

                {/* Potential win */}
                {stake && parseFloat(stake) > 0 && (
                  <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-200">
                    <span className="text-[10px] text-gray-500">Vincita</span>
                    <span className="text-base font-black text-emerald-500 font-mono">
                      ${potentialWin.toFixed(2)}
                    </span>
                  </div>
                )}

                {/* Messages */}
                {msg && (
                  <div
                    className={cn(
                      "mt-2 px-2 py-1.5 rounded text-[10px] font-semibold text-center",
                      msgType === "ok"
                        ? "bg-emerald-50 text-emerald-600"
                        : msgType === "warn"
                          ? "bg-yellow-50 text-yellow-700"
                          : "bg-red-50 text-red-600"
                    )}
                  >
                    {msgText}
                  </div>
                )}

                {!user && (
                  <p className="text-[10px] text-red-500 text-center mt-2">
                    Accedi per scommettere
                  </p>
                )}

                <button
                  onClick={handlePlaceBet}
                  disabled={
                    placingBet || !user || !stake || parseFloat(stake) <= 0
                  }
                  className={cn(
                    "w-full mt-2 py-2.5 rounded-xl text-white text-sm font-bold transition-all",
                    placingBet
                      ? "bg-gray-400"
                      : "bg-brand hover:bg-brand-dark",
                    (!stake || parseFloat(stake) <= 0) && "opacity-50"
                  )}
                >
                  {placingBet ? "Piazzando..." : "Piazza Scommessa"}
                </button>
              </div>
            )}
          </div>

          {/* Wallet balance */}
          {wallet && (
            <div className="mt-2 text-center text-[10px] text-gray-400">
              Saldo:{" "}
              <span className="font-bold text-emerald-500">
                ${wallet.balance?.toFixed(2)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ═══ MOBILE FLOATING BETSLIP BUTTON ═══ */}
      {betslip.length > 0 && (
        <div className="lg:hidden fixed bottom-20 left-1/2 -translate-x-1/2 max-w-[400px] w-[calc(100%-2rem)] z-40">
          <button
            onClick={() => setShowMobileBetslip(true)}
            className="w-full py-3 rounded-xl bg-brand text-white font-bold text-sm shadow-lg flex items-center justify-center gap-2"
          >
            Schedina ({betslip.length}) · {totalOdds.toFixed(2)}
          </button>
        </div>
      )}

      {/* ═══ MOBILE BOTTOM SHEET ═══ */}
      {showMobileBetslip && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-black/50"
          onClick={() => setShowMobileBetslip(false)}
        >
          <div
            className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[70vh] overflow-y-auto p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm font-bold">
                Schedina ({betslip.length})
              </span>
              <button
                onClick={() => setShowMobileBetslip(false)}
                className="text-gray-400"
              >
                ✕
              </button>
            </div>

            {betslip.map((b, i) => (
              <div
                key={i}
                className="flex justify-between py-2 border-b border-gray-100"
              >
                <div>
                  <div className="text-xs font-semibold">{b.match}</div>
                  <div className="text-[10px] text-gray-400">
                    {b.marketName}: {b.selection}
                  </div>
                </div>
                <span className="text-sm font-bold text-brand">
                  {b.odds.toFixed(2)}
                </span>
              </div>
            ))}

            <div className="flex justify-between text-xs mt-2">
              <span>Quota</span>
              <span className="font-bold font-mono">
                {totalOdds.toFixed(2)}
              </span>
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
                <span className="font-bold text-emerald-500">
                  ${potentialWin.toFixed(2)}
                </span>
              </div>
            )}

            {msg && (
              <div
                className={cn(
                  "mt-2 px-2 py-1.5 rounded text-[10px] font-semibold text-center",
                  msgType === "ok"
                    ? "bg-emerald-50 text-emerald-600"
                    : msgType === "warn"
                      ? "bg-yellow-50 text-yellow-700"
                      : "bg-red-50 text-red-600"
                )}
              >
                {msgText}
              </div>
            )}

            <button
              onClick={handlePlaceBet}
              disabled={placingBet || !user || !stake || parseFloat(stake) <= 0}
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
