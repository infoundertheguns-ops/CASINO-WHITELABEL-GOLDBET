"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
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
import { useLiveOdds, type LiveOddsMessage } from "@/lib/hooks/use-live-odds";
import { createClient } from "@/lib/supabase/client";
import { MarketCategoryTabs } from "@/components/sportsbook/market-category-tabs";
import { BetslipPanel } from "@/components/sportsbook/betslip-panel";
import { MatchTimeline } from "@/components/sportsbook/match-timeline";
import {
  getCategoriesWithCounts,
  getMarketsForCategory,
} from "@/lib/constants/market-categories";

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
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold",
      isInterval ? "bg-yellow-400/20 text-yellow-300" : "bg-emerald-400/20 text-emerald-300"
    )}>
      {label}
    </span>
  );
}

// ═══ STATS COMPONENTS ═══

const STAT_LABELS: Record<string, string> = {
  possession: "POSSESSO PALLA", shots: "TIRI TOTALI", shotsOnTarget: "TIRI IN PORTA",
  corners: "CORNER", fouls: "FALLI", yellowCards: "CARTELLINI GIALLI",
  redCards: "CARTELLINI ROSSI", offsides: "FUORIGIOCO", saves: "PARATE",
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
        <span className={cn("text-[13px] tabular-nums w-10 text-left font-mono", homeWins ? "font-bold text-white" : "text-white/60")}>{home}{suffix}</span>
        <div className="flex-1 relative">
          <div className="text-[10px] text-white/50 font-semibold text-center mb-1 tracking-wide">{label}</div>
          <div className="h-[3px] bg-white/10 relative">
            <div className="absolute left-0 top-0 h-full transition-all duration-700 ease-out" style={{ width: `${total > 0 ? homePct : 50}%`, backgroundColor: homeWins ? "#3b82f6" : "rgba(255,255,255,0.25)" }} />
            <div className="absolute right-0 top-0 h-full transition-all duration-700 ease-out" style={{ width: `${total > 0 ? (100 - homePct) : 50}%`, backgroundColor: awayWins ? "#ef4444" : "rgba(255,255,255,0.25)" }} />
          </div>
        </div>
        <span className={cn("text-[13px] tabular-nums w-10 text-right font-mono", awayWins ? "font-bold text-white" : "text-white/60")}>{away}{suffix}</span>
      </div>
    </div>
  );
}

function CardsRow({ stats }: { stats: MatchStats }) {
  const yHome = stats.yellowCards[0], yAway = stats.yellowCards[1];
  const rHome = stats.redCards[0], rAway = stats.redCards[1];
  if (yHome + yAway + rHome + rAway === 0) return null;
  return (
    <div className="flex items-center justify-center gap-6 py-3 border-b border-white/10">
      <div className="flex items-center gap-1.5">
        <span className="text-white/80 text-[13px] font-mono font-bold">{yHome}</span>
        <div className="w-3 h-4 rounded-[1px] bg-yellow-400" />
        <div className="w-3 h-4 rounded-[1px] bg-red-500 ml-0.5" />
        <span className="text-white/80 text-[13px] font-mono font-bold">{rHome}</span>
      </div>
      <span className="text-[10px] text-white/40 font-semibold tracking-wider">CARTELLINI</span>
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
  const mainStats: (keyof MatchStats)[] = ["possession", "shots", "shotsOnTarget", "corners", "fouls", "offsides", "saves"];
  return (
    <div className="rounded-xl overflow-hidden" style={{ backgroundColor: "#0a1929" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <span className="text-[11px] font-bold text-white/90 truncate max-w-[40%]">{home}</span>
        <span className="text-[10px] font-semibold text-white/40 tracking-wider">STATISTICHE</span>
        <span className="text-[11px] font-bold text-white/90 truncate max-w-[40%] text-right">{away}</span>
      </div>
      <CardsRow stats={stats} />
      <div className="px-4 py-1">
        {mainStats.map((key) => {
          const val = stats[key];
          if (!val) return null;
          return <StatBar key={key} label={STAT_LABELS[key] || key} home={val[0]} away={val[1]} isPct={key === "possession"} />;
        })}
      </div>
    </div>
  );
}

// ═══ EVENT TIMELINE LIST (cronaca) ═══

const EVENT_ICONS: Record<string, string> = {
  goal: "\u26BD", yellow_card: "\uD83D\uDFE8", red_card: "\uD83D\uDFE5",
  substitution: "\uD83D\uDD04", var: "\uD83D\uDCFA",
};

function EventTimelineList({ events, home, away }: { events: MatchEvent[]; home: string; away: string }) {
  if (events.length === 0) return null;
  const sorted = [...events].sort((a, b) => b.minute - a.minute);
  return (
    <div className="rounded-xl overflow-hidden mt-3" style={{ backgroundColor: "#0a1929" }}>
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
              <div className="flex-1 min-w-0">
                {isHome && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-white/90 truncate">{playerName}</span>
                    {evt.assist && <span className="text-[10px] text-white/40 truncate hidden sm:inline">({evt.assist})</span>}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0 mx-3">
                {isHome && <span className="text-sm">{icon}</span>}
                <span className="text-[11px] font-bold text-white/50 tabular-nums font-mono w-7 text-center">{evt.minute}&apos;</span>
                {!isHome && <span className="text-sm">{icon}</span>}
              </div>
              <div className="flex-1 min-w-0 text-right">
                {!isHome && (
                  <div className="flex items-center justify-end gap-2">
                    {evt.assist && <span className="text-[10px] text-white/40 truncate hidden sm:inline">({evt.assist})</span>}
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

// ═══ MARKET CARD ═══

function MarketCard({
  market,
  ev,
  toggleBet,
  isSelected,
}: {
  market: Market;
  ev: SportEvent;
  toggleBet: (event: SportEvent, marketName: string, sel: Selection) => void;
  isSelected: (eventId: string, marketName: string, selectionLabel: string) => boolean;
}) {
  // Extract line from market name if present (e.g. "U/O Incl. Supp. 136.5" → line=136.5)
  // DB market.line is unreliable (Kambi internal field), so always prefer name-extracted line
  const lineMatch = market.name.match(/[-+]?(\d+\.?\d*)\s*$/);
  const displayLine = lineMatch ? lineMatch[0].trim() : null;
  const displayName = lineMatch ? market.name.replace(lineMatch[0], "").trim() : market.name;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 border-l-2 border-l-brand flex items-center justify-between">
        <span className="text-[11px] text-gray-600 font-bold uppercase">{displayName}</span>
        {displayLine && <span className="text-[10px] text-gray-400 font-mono">{displayLine}</span>}
      </div>
      {/* Outcomes grid */}
      <div className="px-3 py-2.5">
        <div className={cn(
          "gap-1.5",
          market.selections.length <= 3 ? "flex" : "grid grid-cols-3"
        )}>
          {market.selections.map((sel) => {
            if (sel.suspended) {
              return (
                <div key={`${sel.id || sel.label}-susp`} className="flex-1 py-2 px-1.5 rounded-lg text-center bg-gray-50 opacity-60 cursor-not-allowed">
                  <div className="text-[9px] text-gray-400 truncate">{sel.label}</div>
                  <div className="text-sm text-gray-400">&#x1f512;</div>
                </div>
              );
            }
            const selected = isSelected(ev.id, market.name, sel.label);
            const dir = getOddsDirection(sel);
            return (
              <button
                key={`${sel.id || sel.label}-${sel.changedAt || 0}`}
                onClick={() => toggleBet(ev, market.name, sel)}
                className={cn(
                  "flex-1 py-2 px-1.5 rounded-lg text-center transition-all",
                  selected ? "bg-brand/10 ring-1 ring-brand" : "bg-gray-100 hover:bg-gray-200",
                  dir === "up" && "odds-up",
                  dir === "down" && "odds-down"
                )}
              >
                <div className="text-[9px] text-gray-500 truncate">{sel.label}</div>
                <div className={cn(
                  "text-sm font-bold font-mono",
                  selected ? "text-brand" : dir === "up" ? "text-emerald-500" : dir === "down" ? "text-red-500" : "text-gray-900"
                )}>
                  {sel.odds.toFixed(2)}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ═══ SPORT FIELD BACKGROUNDS ═══

function SoccerField() {
  return (
    <svg viewBox="0 0 600 180" className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid slice">
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
  );
}

function BasketCourt() {
  return (
    <svg viewBox="0 0 600 180" className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid slice">
      <rect width="600" height="180" fill="transparent" />
      <rect x="30" y="10" width="540" height="160" fill="none" stroke="white" strokeOpacity="0.12" strokeWidth="1.5" rx="2" />
      <line x1="300" y1="10" x2="300" y2="170" stroke="white" strokeOpacity="0.12" strokeWidth="1.5" />
      <circle cx="300" cy="90" r="28" fill="none" stroke="white" strokeOpacity="0.12" strokeWidth="1.5" />
      <path d="M 30 55 Q 120 55 120 90 Q 120 125 30 125" fill="none" stroke="white" strokeOpacity="0.1" strokeWidth="1.2" />
      <path d="M 570 55 Q 480 55 480 90 Q 480 125 570 125" fill="none" stroke="white" strokeOpacity="0.1" strokeWidth="1.2" />
      <rect x="30" y="60" width="55" height="60" fill="none" stroke="white" strokeOpacity="0.08" strokeWidth="1" />
      <rect x="515" y="60" width="55" height="60" fill="none" stroke="white" strokeOpacity="0.08" strokeWidth="1" />
      <circle cx="85" cy="90" r="3" fill="none" stroke="white" strokeOpacity="0.1" strokeWidth="1" />
      <circle cx="515" cy="90" r="3" fill="none" stroke="white" strokeOpacity="0.1" strokeWidth="1" />
      <line x1="57" y1="45" x2="57" y2="135" stroke="white" strokeOpacity="0.06" strokeWidth="1" />
      <line x1="543" y1="45" x2="543" y2="135" stroke="white" strokeOpacity="0.06" strokeWidth="1" />
    </svg>
  );
}

function TennisCourt() {
  return (
    <svg viewBox="0 0 600 180" className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid slice">
      <rect width="600" height="180" fill="transparent" />
      <rect x="60" y="15" width="480" height="150" fill="none" stroke="white" strokeOpacity="0.12" strokeWidth="1.5" rx="1" />
      <rect x="110" y="15" width="380" height="150" fill="none" stroke="white" strokeOpacity="0.08" strokeWidth="1" />
      <line x1="300" y1="15" x2="300" y2="165" stroke="white" strokeOpacity="0.15" strokeWidth="1.5" />
      <line x1="300" y1="85" x2="300" y2="95" stroke="white" strokeOpacity="0.3" strokeWidth="2" />
      <line x1="110" y1="90" x2="490" y2="90" stroke="white" strokeOpacity="0.06" strokeWidth="1" />
      <line x1="60" y1="55" x2="540" y2="55" stroke="white" strokeOpacity="0.06" strokeWidth="0.8" />
      <line x1="60" y1="125" x2="540" y2="125" stroke="white" strokeOpacity="0.06" strokeWidth="0.8" />
    </svg>
  );
}

function IceRink() {
  return (
    <svg viewBox="0 0 600 180" className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid slice">
      <rect width="600" height="180" fill="transparent" />
      <rect x="30" y="10" width="540" height="160" rx="30" fill="none" stroke="white" strokeOpacity="0.12" strokeWidth="1.5" />
      <line x1="300" y1="10" x2="300" y2="170" stroke="white" strokeOpacity="0.15" strokeWidth="1.5" />
      <circle cx="300" cy="90" r="25" fill="none" stroke="white" strokeOpacity="0.1" strokeWidth="1.2" />
      <circle cx="300" cy="90" r="2" fill="white" fillOpacity="0.15" />
      <line x1="170" y1="10" x2="170" y2="170" stroke="rgba(59,130,246,0.15)" strokeWidth="1.5" />
      <line x1="430" y1="10" x2="430" y2="170" stroke="rgba(59,130,246,0.15)" strokeWidth="1.5" />
      <line x1="100" y1="10" x2="100" y2="170" stroke="rgba(239,68,68,0.12)" strokeWidth="1.5" />
      <line x1="500" y1="10" x2="500" y2="170" stroke="rgba(239,68,68,0.12)" strokeWidth="1.5" />
      <circle cx="170" cy="90" r="20" fill="none" stroke="white" strokeOpacity="0.06" strokeWidth="1" />
      <circle cx="430" cy="90" r="20" fill="none" stroke="white" strokeOpacity="0.06" strokeWidth="1" />
    </svg>
  );
}

function VolleyCourt() {
  return (
    <svg viewBox="0 0 600 180" className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid slice">
      <rect width="600" height="180" fill="transparent" />
      <rect x="60" y="15" width="480" height="150" fill="none" stroke="white" strokeOpacity="0.12" strokeWidth="1.5" rx="1" />
      <line x1="300" y1="5" x2="300" y2="175" stroke="white" strokeOpacity="0.2" strokeWidth="2" />
      <line x1="180" y1="15" x2="180" y2="165" stroke="white" strokeOpacity="0.06" strokeWidth="1" strokeDasharray="4 4" />
      <line x1="420" y1="15" x2="420" y2="165" stroke="white" strokeOpacity="0.06" strokeWidth="1" strokeDasharray="4 4" />
      <circle cx="300" cy="90" r="2" fill="white" fillOpacity="0.2" />
    </svg>
  );
}

function GenericField() {
  return (
    <svg viewBox="0 0 600 180" className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid slice">
      <rect width="600" height="180" fill="transparent" />
      <circle cx="300" cy="90" r="50" fill="none" stroke="white" strokeOpacity="0.08" strokeWidth="1.5" />
      <circle cx="300" cy="90" r="25" fill="none" stroke="white" strokeOpacity="0.06" strokeWidth="1" />
      <circle cx="300" cy="90" r="2" fill="white" fillOpacity="0.12" />
      <line x1="100" y1="90" x2="500" y2="90" stroke="white" strokeOpacity="0.04" strokeWidth="1" />
      <line x1="300" y1="20" x2="300" y2="160" stroke="white" strokeOpacity="0.04" strokeWidth="1" />
    </svg>
  );
}

const SPORT_BG_COLORS: Record<string, string> = {
  calcio: "#1a472a",
  "calcio-a-5": "#1a472a",
  basket: "#4a2810",
  tennis: "#1a3a5c",
  "tennis-tavolo": "#1a3355",
  hockey: "#0c2d48",
  "hockey-ghiaccio": "#0c2d48",
  volley: "#2d1a47",
  pallavolo: "#2d1a47",
  rugby: "#2a3d1a",
  baseball: "#2a3d1a",
  handball: "#3d2a1a",
  cricket: "#2a3d1a",
  snooker: "#1a3d2a",
  freccette: "#1a1a2e",
  mma: "#2e1a1a",
  boxe: "#2e1a1a",
  esports: "#1a1a2e",
};

function SportFieldSvg({ sportSlug }: { sportSlug?: string }) {
  const slug = sportSlug || "calcio";
  if (slug === "calcio" || slug === "calcio-a-5") return <SoccerField />;
  if (slug === "basket") return <BasketCourt />;
  if (slug === "tennis" || slug === "tennis-tavolo") return <TennisCourt />;
  if (slug === "hockey" || slug === "hockey-ghiaccio") return <IceRink />;
  if (slug === "volley" || slug === "pallavolo") return <VolleyCourt />;
  return <GenericField />;
}

// ═══ PAGE COMPONENT ═══

export default function EventDetail() {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const isLivePage = pathname.startsWith("/live/");
  const basePath = isLivePage ? "/live" : "/sport";
  const baseLabel = isLivePage ? "Live" : "Sport";
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
    betMode,
    setBetMode,
    systemComboSize,
    setSystemComboSize,
  } = useSportsbook();

  const [stake, setStake] = useState("");
  const [showMobileBetslip, setShowMobileBetslip] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [columnCount, setColumnCount] = useState(2);

  // Direct-fetch state
  const [directEvent, setDirectEvent] = useState<SportEvent | null>(null);
  const [directLoading, setDirectLoading] = useState(false);
  const [directError, setDirectError] = useState<string | null>(null);

  const eventId = typeof params?.id === "string" ? params.id : "";
  const hookEvent = useMemo(() => allEvents.find((e) => e.id === eventId), [allEvents, eventId]);
  const supabaseDetail = useMemo(() => createClient(), []);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reusable fetch
  const fetchFullEvent = useCallback(async (isInitial = false) => {
    if (!eventId) return;
    if (isInitial) { setDirectLoading(true); setDirectError(null); }
    try {
      const { data, error } = await supabaseDetail
        .from("events_v2")
        .select(`*, markets_v2(id, market_name, outcomes_v2(id, outcome_key, odds, is_active, is_suspended))`)
        .eq("id", eventId)
        .single();
      if (error) throw error;
      if (!data) return;
      const mapped = mapDbToSportEvent(data, true);
      if (isInitial) {
        setDirectEvent(mapped);
      } else {
        setDirectEvent((prev) => {
          if (!prev) return mapped;
          if (prev.minute === mapped.minute && prev.minuteReceivedAt) mapped.minuteReceivedAt = prev.minuteReceivedAt;
          const prevSels = new Map<string, Selection>();
          for (const m of prev.markets) for (const s of m.selections) if (s.id) prevSels.set(s.id, s);
          return {
            ...mapped,
            markets: mapped.markets.map((m) => ({
              ...m,
              selections: m.selections.map((s) => {
                if (!s.id) return s;
                const old = prevSels.get(s.id);
                if (!old) return s;
                if (old.odds !== s.odds) return { ...s, previousOdds: old.odds, changedAt: Date.now() };
                if (old.changedAt && Date.now() - old.changedAt < 5000) return { ...s, changedAt: old.changedAt, previousOdds: old.previousOdds };
                return s;
              }),
            })),
          };
        });
      }
    } catch (err: unknown) {
      if (isInitial) setDirectError(err instanceof Error ? err.message : "Errore nel caricamento");
    } finally {
      if (isInitial) setDirectLoading(false);
    }
  }, [eventId, supabaseDetail]);

  useEffect(() => { fetchFullEvent(true); }, [fetchFullEvent]);

  useEffect(() => {
    const isLive = directEvent?.live || hookEvent?.live;
    if (!isLive || !eventId) {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      return;
    }
    intervalRef.current = setInterval(() => fetchFullEvent(false), 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [directEvent?.live, hookEvent?.live, eventId, fetchFullEvent]);

  const marketIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const ids = new Set<string>();
    if (directEvent) for (const m of directEvent.markets) if (m.id) ids.add(m.id);
    marketIdsRef.current = ids;
  }, [directEvent]);

  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedRefetch = useCallback(() => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    refetchTimerRef.current = setTimeout(() => fetchFullEvent(false), 500);
  }, [fetchFullEvent]);

  // Realtime
  useEffect(() => {
    if (!eventId) return;
    const channel = supabaseDetail
      .channel(`detail-${eventId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "events_v2", filter: `id=eq.${eventId}` }, (payload) => {
        const updated = payload.new as Record<string, any>;
        const ld = updated.live_data || {};
        const isLive = updated.status === "live";
        setDirectEvent((prev) => {
          if (!prev) return prev;
          return {
            ...prev, live: isLive, minute: updated.minute,
            minuteReceivedAt: isLive ? Date.now() : undefined,
            scoreH: updated.score_home, scoreA: updated.score_away,
            period: updated.period || undefined, periodCode: ld.periodCode ?? undefined,
            halfScoreHome: Array.isArray(ld.halfScoreHome) ? ld.halfScoreHome : undefined,
            halfScoreAway: Array.isArray(ld.halfScoreAway) ? ld.halfScoreAway : undefined,
            stats: ld.stats || undefined,
            matchEvents: Array.isArray(ld.matchEvents) ? ld.matchEvents : undefined,
          };
        });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "outcomes_v2" }, (payload) => {
        const updated = payload.new as Record<string, any>;
        if (!marketIdsRef.current.has(updated.market_id)) return;

        // Remove deactivated/suspended outcomes
        if (!updated.is_active || updated.is_suspended) {
          setDirectEvent((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              markets: prev.markets.map((m) =>
                m.id === updated.market_id
                  ? { ...m, selections: m.selections.filter((sel) => sel.id !== updated.id) }
                  : m
              ),
            };
          });
          return;
        }

        const newOdds = parseFloat(updated.odds);
        setDirectEvent((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            markets: prev.markets.map((m) =>
              m.id === updated.market_id
                ? { ...m, selections: m.selections.map((sel) => {
                    if (sel.id !== updated.id) return sel;
                    const oddsChanged = sel.odds !== newOdds;
                    return { ...sel, previousOdds: oddsChanged ? sel.odds : sel.previousOdds, odds: newOdds, changedAt: oddsChanged ? Date.now() : sel.changedAt, suspended: updated.is_suspended || undefined };
                  }) }
                : m
            ),
          };
        });
        debouncedRefetch();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "markets_v2" }, (payload) => {
        const updated = payload.new as Record<string, any>;
        if (!marketIdsRef.current.has(updated.id)) return;
        // markets_v2 has no is_active/is_suspended columns (dropped in v2 schema).
        // Suspension/deactivation now happens at the outcome level only.
        // Trigger a debounced refetch so any market-level change (e.g. metadata) is reflected.
        debouncedRefetch();
      })
      .subscribe();
    return () => { supabaseDetail.removeChannel(channel); if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current); };
  }, [eventId, supabaseDetail, debouncedRefetch]);

  // SSE: live odds via Redis (primary for detail page)
  const detailExternalId = directEvent?.externalId;
  const handleDetailOddsChange = useCallback((msg: LiveOddsMessage) => {
    setDirectEvent((prev) => {
      if (!prev || prev.externalId !== msg.event_id) return prev;
      return {
        ...prev,
        ...(msg.scores ? { scoreH: msg.scores.home, scoreA: msg.scores.away } : {}),
        ...(msg.minute != null ? { minute: msg.minute, minuteReceivedAt: Date.now() } : {}),
        ...(msg.period ? { period: msg.period } : {}),
        time: `LIVE ${msg.minute || prev.minute || 0}'`,
        markets: prev.markets.map((market) => ({
          ...market,
          selections: market.selections.map((sel) => {
            const change = msg.changes.find(
              (c) => c.market_type === (market.marketType || market.name) && c.outcome_name === sel.label
            );
            if (!change) return sel;
            return { ...sel, previousOdds: sel.odds, odds: change.odds, changedAt: Date.now() };
          }),
        })),
      };
    });
  }, []);

  useLiveOdds({
    eventIds: detailExternalId ? [detailExternalId] : undefined,
    onOddsChange: handleDetailOddsChange,
    enabled: !!(directEvent?.live && detailExternalId),
  });

  const ev = directEvent || hookEvent;
  const loading = !directEvent && (hookLoading || directLoading);

  // New category system
  const categories = useMemo(() => (ev ? getCategoriesWithCounts(ev.markets) : []), [ev]);
  const hasStats = !!(ev?.live && ev?.stats);

  useEffect(() => {
    if (activeTab === null) {
      if (hasStats) setActiveTab("statistiche");
      else if (categories.length > 0) setActiveTab(categories[0].id);
    }
  }, [categories, activeTab, hasStats]);

  const activeMarkets = useMemo(() => {
    if (!ev || activeTab === "statistiche" || !activeTab) return [];
    return getMarketsForCategory(ev.markets, activeTab);
  }, [ev, activeTab]);

  const totalMarketsCount = ev?.markets.filter((m) => m.selections.length > 0).length || 0;

  const halfScoreDisplay = useMemo(() => {
    if (!ev?.halfScoreHome?.length || !ev?.halfScoreAway?.length) return null;
    return ev.halfScoreHome.map((h, i) => `${h}-${ev.halfScoreAway?.[i] ?? "?"}`).join(", ");
  }, [ev]);

  const isSystem = betMode === "sistema" && betslip.length >= 3;
  const systemType = isSystem ? `${systemComboSize}/${betslip.length}` : undefined;

  const [betResult, setBetResult] = useState<{ type: "success" | "error" | "warn"; text: string } | null>(null);

  const handlePlaceBet = async () => {
    if (!stake || parseFloat(stake) <= 0) return;
    setBetResult(null);
    const result = await placeBet(parseFloat(stake), systemType);
    if (result.success) {
      const text = result.combo_count
        ? `Sistema piazzato! ${result.combo_count} combo`
        : result.flagged ? "Scommessa piazzata \u2014 in verifica" : "Scommessa piazzata!";
      setBetResult({ type: "success", text });
      setStake("");
      setTimeout(() => setBetResult(null), 4000);
    } else {
      setBetResult({ type: "error", text: result.error || "Errore" });
    }
  };

  const handleRemoveItem = (b: typeof betslip[0]) => {
    const bEvent = allEvents.find((e) => e.id === b.eventId) || ev;
    if (bEvent) {
      const market = bEvent.markets.find((m) => m.name === b.marketName);
      const sel = market?.selections.find((s) => s.label === b.selection);
      if (sel) toggleBet(bEvent, b.marketName, sel);
    }
  };

  // Build league link slug
  const leagueSlug = ev?.leagueSlug || "";

  // Distribute markets into columns
  const marketColumns = useMemo(() => {
    const cols: Market[][] = Array.from({ length: columnCount }, () => []);
    activeMarkets.forEach((m, i) => cols[i % columnCount].push(m));
    return cols;
  }, [activeMarkets, columnCount]);

  // ── Loading ──
  if (loading) {
    return (
      <div className="p-4 lg:p-0 animate-pulse">
        <div className="h-3 w-48 bg-gray-200 rounded mb-3" />
        <div className="h-44 bg-gray-200 rounded-2xl mb-5" />
        <div className="lg:flex lg:gap-5">
          <div className="flex-1 space-y-3">{[1, 2, 3, 4].map((i) => <div key={i} className="bg-gray-200 rounded-xl h-32" />)}</div>
          <div className="hidden lg:block w-72"><div className="h-72 bg-gray-200 rounded-xl" /></div>
        </div>
      </div>
    );
  }

  // ── Not found ──
  if (!ev) {
    return (
      <div className="p-6 text-center">
        {directError && <p className="text-red-500 text-xs mb-3">{directError}</p>}
        <p className="text-gray-400 mb-3">Evento non trovato</p>
        <button onClick={() => router.push(basePath)} className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-bold">&larr; {baseLabel}</button>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-0">
      {isMockData && (
        <div className="mb-4 px-4 py-2 rounded-xl bg-yellow-50 border border-yellow-200 text-yellow-700 text-xs font-medium text-center">
          Dati demo &mdash; Connetti Supabase per dati reali
        </div>
      )}

      {/* ── Breadcrumb ── */}
      <nav className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <Link href={basePath} className="hover:text-brand transition-colors">{baseLabel}</Link>
        <span>/</span>
        {leagueSlug ? (
          <Link href={`/sport/league/${leagueSlug}`} className="text-gray-500 hover:text-brand transition-colors">{ev.league}</Link>
        ) : (
          <span className="text-gray-500">{ev.league}</span>
        )}
        <span>/</span>
        <span className="text-gray-600 font-medium truncate">{ev.home} vs {ev.away}</span>
      </nav>

      {/* ── Event Header ── */}
      {ev.live ? (
        /* LIVE header */
        <div className="rounded-2xl mb-4 relative overflow-hidden" style={{ backgroundColor: SPORT_BG_COLORS[ev.sportSlug || "calcio"] || "#1a472a", minHeight: "180px" }}>
          <SportFieldSvg sportSlug={ev.sportSlug} />
          <div className="relative z-10 px-6 py-5 flex flex-col items-center justify-center min-h-[180px]">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] text-white/50">{ev.leagueIcon} {ev.league}</span>
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
                {halfScoreDisplay && <div className="text-[11px] text-white/50 mt-1">(PT: {halfScoreDisplay})</div>}
              </div>
              <div className="text-center flex-1 min-w-0">
                <div className="text-lg sm:text-xl font-black text-white truncate">{ev.away}</div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* PREMATCH header */
        <div className="rounded-2xl p-6 mb-4 relative overflow-hidden bg-gradient-to-r from-gray-800 to-gray-700">
          <div className="text-[10px] text-white/60 mb-4">{ev.leagueIcon} {ev.league}</div>
          <div className="flex items-center justify-center gap-8">
            <div className="text-center flex-1"><div className="text-xl font-black text-white">{ev.home}</div></div>
            <div className="text-center flex-shrink-0">
              <div className="text-sm font-bold text-white/60">VS</div>
              <div className="text-[10px] text-white/40 mt-0.5">{ev.time}</div>
            </div>
            <div className="text-center flex-1"><div className="text-xl font-black text-white">{ev.away}</div></div>
          </div>
        </div>
      )}

      {/* ── Match Timeline (live only, when match events exist) ── */}
      {ev.live && ev.matchEvents && ev.matchEvents.length > 0 && ev.minute != null && (
        <div className="mb-4">
          <MatchTimeline
            matchEvents={ev.matchEvents}
            minute={ev.minute}
            home={ev.home}
            away={ev.away}
            period={ev.period}
          />
        </div>
      )}

      <div className="lg:flex lg:gap-5">
        {/* ═══ MARKETS COLUMN ═══ */}
        <div className="flex-1 min-w-0">
          {/* Header with market count + column toggle */}
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-900">
              Mercati ({totalMarketsCount})
            </h2>
            {/* Column toggle — desktop only */}
            <div className="hidden lg:flex items-center gap-1">
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  onClick={() => setColumnCount(n)}
                  className={cn(
                    "w-7 h-7 rounded text-[10px] font-bold transition-all",
                    columnCount === n ? "bg-brand text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {categories.length === 0 && !hasStats ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <p className="text-gray-400 text-sm">Nessun mercato disponibile</p>
            </div>
          ) : (
            <>
              {/* ── Category Tabs ── */}
              <div className="mb-4">
                <MarketCategoryTabs
                  categories={categories}
                  activeTab={activeTab || ""}
                  onTabChange={setActiveTab}
                  extraTab={hasStats ? { id: "statistiche", label: "Statistiche" } : undefined}
                />
              </div>

              {/* ── Statistiche panel ── */}
              {activeTab === "statistiche" && ev.stats && (
                <div className="space-y-3">
                  <StatsPanel stats={ev.stats} home={ev.home} away={ev.away} />
                  {ev.matchEvents && ev.matchEvents.length > 0 && (
                    <EventTimelineList events={ev.matchEvents} home={ev.home} away={ev.away} />
                  )}
                </div>
              )}

              {/* ── Markets grid (multi-column) ── */}
              {activeTab !== "statistiche" && (
                activeMarkets.length > 0 ? (
                  <div className={cn(
                    "gap-3",
                    columnCount === 1 && "space-y-3",
                    columnCount === 2 && "hidden lg:grid lg:grid-cols-2",
                    columnCount === 3 && "hidden lg:grid lg:grid-cols-3"
                  )}>
                    {columnCount === 1 ? (
                      activeMarkets.map((market) => (
                        <MarketCard key={market.id || market.name} market={market} ev={ev} toggleBet={toggleBet} isSelected={isSelected} />
                      ))
                    ) : (
                      marketColumns.map((col, ci) => (
                        <div key={ci} className="space-y-3">
                          {col.map((market) => (
                            <MarketCard key={market.id || market.name} market={market} ev={ev} toggleBet={toggleBet} isSelected={isSelected} />
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
                    <p className="text-gray-400 text-xs">Nessun mercato per questa categoria</p>
                  </div>
                )
              )}

              {/* Mobile: always 1 column */}
              {activeTab !== "statistiche" && activeMarkets.length > 0 && columnCount > 1 && (
                <div className="lg:hidden space-y-3">
                  {activeMarkets.map((market) => (
                    <MarketCard key={market.id || market.name} market={market} ev={ev} toggleBet={toggleBet} isSelected={isSelected} />
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
          {wallet && (
            <div className="mt-2 text-center text-[10px] text-gray-400">
              Saldo: <span className="font-bold text-emerald-500">${wallet.balance?.toFixed(2)}</span>
            </div>
          )}
        </div>
      </div>

      {/* ═══ MOBILE FLOATING BETSLIP ═══ */}
      {betslip.length > 0 && (
        <div className="lg:hidden fixed bottom-20 left-1/2 -translate-x-1/2 max-w-[400px] w-[calc(100%-2rem)] z-40">
          <button onClick={() => setShowMobileBetslip(true)}
            className="w-full py-3 rounded-xl bg-brand text-white font-bold text-sm shadow-lg flex items-center justify-center gap-2">
            Schedina ({betslip.length}) &middot; {totalOdds.toFixed(2)}
          </button>
        </div>
      )}

      {/* ═══ MOBILE BOTTOM SHEET ═══ */}
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
