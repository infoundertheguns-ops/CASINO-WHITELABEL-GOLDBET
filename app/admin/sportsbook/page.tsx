"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Toaster, toast } from "sonner";

// ═══ TYPES ═══

type ActiveTab = "bets" | "events" | "settlement";
type DateRange = "today" | "7d" | "30d" | "all";
type BetStatusFilter = "all" | "open" | "won" | "lost" | "void";
type EventStatusFilter = "all" | "prematch" | "live" | "ended" | "cancelled";

interface BetRow {
  id: string;
  user_id: string;
  bet_type: string;
  stake: number;
  total_odds: number;
  potential_win: number;
  status: string;
  created_at: string;
  settled_at: string | null;
  username: string;
  legs: LegRow[];
}

interface LegRow {
  id: string;
  event_id: string;
  odds_at_placement: number;
  result: string | null;
  home_team: string;
  away_team: string;
}

interface EventRow {
  id: string;
  home_team: string;
  away_team: string;
  starts_at: string;
  status: string;
  score_home: number | null;
  score_away: number | null;
  is_live: boolean;
  minute: number | null;
  sport_name: string;
  league_name: string;
}

interface SettledBetRow {
  id: string;
  user_id: string;
  bet_type: string;
  stake: number;
  potential_win: number;
  status: string;
  settled_at: string | null;
  username: string;
  event_names: string;
}

// ═══ HELPERS ═══

function getDateCutoff(range: DateRange): string | null {
  if (range === "all") return null;
  const d = new Date();
  if (range === "today") d.setHours(0, 0, 0, 0);
  else if (range === "7d") d.setDate(d.getDate() - 7);
  else if (range === "30d") d.setDate(d.getDate() - 30);
  return d.toISOString();
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("it-IT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    open: "bg-yellow-500/20 text-yellow-400",
    won: "bg-emerald-500/20 text-emerald-400",
    lost: "bg-red-500/20 text-red-400",
    void: "bg-gray-500/20 text-gray-400",
    cashout: "bg-blue-500/20 text-blue-400",
    prematch: "bg-blue-500/20 text-blue-400",
    live: "bg-red-500/20 text-red-400",
    ended: "bg-emerald-500/20 text-emerald-400",
    cancelled: "bg-gray-500/20 text-gray-400",
    postponed: "bg-orange-500/20 text-orange-400",
  };
  return (
    <span
      className={cn(
        "px-2 py-0.5 rounded text-[9px] font-bold",
        styles[status] || "bg-gray-500/20 text-gray-400"
      )}
    >
      {status.toUpperCase()}
    </span>
  );
}

// ═══ COMPONENT ═══

export default function AdminSportsbook() {
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState<ActiveTab>("bets");

  // ── Bets tab state ──
  const [bets, setBets] = useState<BetRow[]>([]);
  const [betsLoading, setBetsLoading] = useState(true);
  const [betDateRange, setBetDateRange] = useState<DateRange>("all");
  const [betStatus, setBetStatus] = useState<BetStatusFilter>("all");
  const [betSearch, setBetSearch] = useState("");
  const [expandedBet, setExpandedBet] = useState<string | null>(null);
  const [openEventsCount, setOpenEventsCount] = useState(0);

  // ── Events tab state ──
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventStatusFilter, setEventStatusFilter] =
    useState<EventStatusFilter>("all");
  const [eventSportFilter, setEventSportFilter] = useState("all");
  const [eventDateRange, setEventDateRange] = useState<DateRange>("all");

  // ── Settlement modal ──
  const [settleModal, setSettleModal] = useState<{
    event: EventRow;
    homeScore: number;
    awayScore: number;
  } | null>(null);
  const [settling, setSettling] = useState(false);

  // ── Settlement log state ──
  const [settledBets, setSettledBets] = useState<SettledBetRow[]>([]);
  const [settledLoading, setSettledLoading] = useState(true);

  // ════════════════════════════════════════════
  // FETCH: Bets
  // ════════════════════════════════════════════
  const fetchBets = useCallback(async () => {
    setBetsLoading(true);
    try {
      let query = supabase
        .from("bets")
        .select(
          `
          *,
          bet_selections(
            id, event_id, odds_at_placement, result,
            event:events(home_team, away_team)
          )
        `
        )
        .order("created_at", { ascending: false })
        .limit(200);

      if (betStatus !== "all") query = query.eq("status", betStatus);
      const cutoff = getDateCutoff(betDateRange);
      if (cutoff) query = query.gte("created_at", cutoff);

      const { data } = await query;

      if (data && data.length > 0) {
        const userIds = [
          ...new Set(data.map((b: Record<string, unknown>) => b.user_id as string)),
        ];
        const { data: users } = await supabase
          .from("users")
          .select("id, username")
          .in("id", userIds);
        const userMap = new Map(
          (users || []).map((u: Record<string, unknown>) => [
            u.id as string,
            u.username as string,
          ])
        );

        setBets(
          data.map((b: Record<string, unknown>) => {
            const sels = (b.bet_selections as Record<string, unknown>[] | null) || [];
            return {
              id: b.id as string,
              user_id: b.user_id as string,
              bet_type: b.bet_type as string,
              stake: b.stake as number,
              total_odds: b.total_odds as number,
              potential_win: b.potential_win as number,
              status: b.status as string,
              created_at: b.created_at as string,
              settled_at: b.settled_at as string | null,
              username: userMap.get(b.user_id as string) || "—",
              legs: sels.map((s: Record<string, unknown>) => {
                const ev = s.event as Record<string, string> | null;
                return {
                  id: s.id as string,
                  event_id: s.event_id as string,
                  odds_at_placement: s.odds_at_placement as number,
                  result: s.result as string | null,
                  home_team: ev?.home_team || "—",
                  away_team: ev?.away_team || "—",
                };
              }),
            };
          })
        );
      } else {
        setBets([]);
      }
    } catch (err) {
      console.error("fetchBets error:", err);
    }
    setBetsLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [betStatus, betDateRange]);

  // ════════════════════════════════════════════
  // FETCH: Open events count
  // ════════════════════════════════════════════
  const fetchOpenEventsCount = useCallback(async () => {
    const { count } = await supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .in("status", ["prematch", "live"]);
    setOpenEventsCount(count || 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ════════════════════════════════════════════
  // FETCH: Events
  // ════════════════════════════════════════════
  const fetchEvents = useCallback(async () => {
    setEventsLoading(true);
    try {
      const { data } = await supabase
        .from("events")
        .select(
          `
          *,
          sport:sports(name),
          league:leagues(name)
        `
        )
        .order("starts_at", { ascending: false })
        .limit(300);

      setEvents(
        (data || []).map((e: Record<string, unknown>) => {
          const sport = e.sport as Record<string, string> | null;
          const league = e.league as Record<string, string> | null;
          return {
            id: e.id as string,
            home_team: e.home_team as string,
            away_team: e.away_team as string,
            starts_at: e.starts_at as string,
            status: e.status as string,
            score_home: e.score_home as number | null,
            score_away: e.score_away as number | null,
            is_live: e.is_live as boolean,
            minute: e.minute as number | null,
            sport_name: sport?.name || "—",
            league_name: league?.name || "—",
          };
        })
      );
    } catch (err) {
      console.error("fetchEvents error:", err);
    }
    setEventsLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ════════════════════════════════════════════
  // FETCH: Settlement log
  // ════════════════════════════════════════════
  const fetchSettledBets = useCallback(async () => {
    setSettledLoading(true);
    try {
      const { data } = await supabase
        .from("bets")
        .select(
          `
          *,
          bet_selections(
            event:events(home_team, away_team)
          )
        `
        )
        .in("status", ["won", "lost", "void"])
        .order("settled_at", { ascending: false })
        .limit(200);

      if (data && data.length > 0) {
        const userIds = [
          ...new Set(data.map((b: Record<string, unknown>) => b.user_id as string)),
        ];
        const { data: users } = await supabase
          .from("users")
          .select("id, username")
          .in("id", userIds);
        const userMap = new Map(
          (users || []).map((u: Record<string, unknown>) => [
            u.id as string,
            u.username as string,
          ])
        );

        setSettledBets(
          data.map((b: Record<string, unknown>) => {
            const sels =
              (b.bet_selections as Record<string, unknown>[] | null) || [];
            const names = sels
              .map((s: Record<string, unknown>) => {
                const ev = s.event as Record<string, string> | null;
                return ev
                  ? `${ev.home_team} vs ${ev.away_team}`
                  : "—";
              })
              .filter(
                (v: string, i: number, a: string[]) => a.indexOf(v) === i
              )
              .join(", ");

            return {
              id: b.id as string,
              user_id: b.user_id as string,
              bet_type: b.bet_type as string,
              stake: b.stake as number,
              potential_win: b.potential_win as number,
              status: b.status as string,
              settled_at: b.settled_at as string | null,
              username: userMap.get(b.user_id as string) || "—",
              event_names: names || "—",
            };
          })
        );
      } else {
        setSettledBets([]);
      }
    } catch (err) {
      console.error("fetchSettledBets error:", err);
    }
    setSettledLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ════════════════════════════════════════════
  // EFFECTS
  // ════════════════════════════════════════════
  useEffect(() => {
    fetchBets();
    fetchOpenEventsCount();
  }, [fetchBets, fetchOpenEventsCount]);

  useEffect(() => {
    if (activeTab === "events") fetchEvents();
    if (activeTab === "settlement") fetchSettledBets();
  }, [activeTab, fetchEvents, fetchSettledBets]);

  // ════════════════════════════════════════════
  // COMPUTED
  // ════════════════════════════════════════════

  // KPIs
  const kpis = useMemo(() => {
    const staked = bets.reduce((s, b) => s + (b.stake || 0), 0);
    const liability = bets
      .filter((b) => b.status === "open")
      .reduce((s, b) => s + (b.potential_win || 0), 0);
    const openBets = bets.filter((b) => b.status === "open").length;
    const payouts =
      bets
        .filter((b) => b.status === "won")
        .reduce((s, b) => s + (b.potential_win || 0), 0) +
      bets
        .filter((b) => b.status === "void")
        .reduce((s, b) => s + (b.stake || 0), 0);
    const margin = staked > 0 ? ((staked - payouts) / staked) * 100 : 0;
    return { staked, liability, openBets, margin, openEventsCount };
  }, [bets, openEventsCount]);

  // Filtered bets (client-side search)
  const filteredBets = useMemo(() => {
    if (!betSearch.trim()) return bets;
    const q = betSearch.toLowerCase();
    return bets.filter(
      (b) =>
        b.username.toLowerCase().includes(q) ||
        b.id.toLowerCase().includes(q)
    );
  }, [bets, betSearch]);

  // Unique sports for events filter
  const sportsList = useMemo(() => {
    const set = new Set<string>();
    events.forEach((e) => {
      if (e.sport_name && e.sport_name !== "—") set.add(e.sport_name);
    });
    return Array.from(set).sort();
  }, [events]);

  // Filtered events
  const filteredEvents = useMemo(() => {
    let list = events;
    if (eventStatusFilter !== "all")
      list = list.filter((e) => e.status === eventStatusFilter);
    if (eventSportFilter !== "all")
      list = list.filter((e) => e.sport_name === eventSportFilter);
    if (eventDateRange !== "all") {
      const cutoff = getDateCutoff(eventDateRange);
      if (cutoff)
        list = list.filter((e) => new Date(e.starts_at) >= new Date(cutoff));
    }
    return list;
  }, [events, eventStatusFilter, eventSportFilter, eventDateRange]);

  // ════════════════════════════════════════════
  // SETTLE EVENT HANDLER
  // ════════════════════════════════════════════
  const handleSettle = async () => {
    if (!settleModal) return;
    setSettling(true);
    try {
      const { event, homeScore, awayScore } = settleModal;

      // 1. Update event with final scores and status = ended
      const { error: updateErr } = await supabase
        .from("events")
        .update({
          score_home: homeScore,
          score_away: awayScore,
          status: "ended",
          is_live: false,
        })
        .eq("id", event.id);

      if (updateErr) throw updateErr;

      // 2. Call settlement API
      const res = await fetch("/api/settlement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: event.id,
          result: { home: homeScore, away: awayScore },
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Settlement failed");
      }

      toast.success(
        `Settlement completato: ${data.bets_settled || 0} scommesse, ${data.legs_processed || 0} legs`
      );

      setSettleModal(null);
      fetchEvents();
      fetchBets();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Errore sconosciuto";
      toast.error(`Errore settlement: ${message}`);
    }
    setSettling(false);
  };

  // Payout for a settled bet
  const getPayout = (bet: SettledBetRow): number => {
    if (bet.status === "won") return bet.potential_win;
    if (bet.status === "void") return bet.stake;
    return 0;
  };

  // ════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════
  const TABS: { id: ActiveTab; label: string }[] = [
    { id: "bets", label: "Scommesse" },
    { id: "events", label: "Eventi" },
    { id: "settlement", label: "Settlement Log" },
  ];

  const DATE_OPTIONS: { id: DateRange; label: string }[] = [
    { id: "today", label: "Oggi" },
    { id: "7d", label: "7gg" },
    { id: "30d", label: "30gg" },
    { id: "all", label: "Tutti" },
  ];

  const BET_STATUS_OPTIONS: { id: BetStatusFilter; label: string }[] = [
    { id: "all", label: "Tutte" },
    { id: "open", label: "Aperte" },
    { id: "won", label: "Vinte" },
    { id: "lost", label: "Perse" },
    { id: "void", label: "Void" },
  ];

  const EVENT_STATUS_OPTIONS: { id: EventStatusFilter; label: string }[] = [
    { id: "all", label: "Tutti" },
    { id: "prematch", label: "Prematch" },
    { id: "live", label: "Live" },
    { id: "ended", label: "Conclusi" },
    { id: "cancelled", label: "Annullati" },
  ];

  return (
    <div>
      <Toaster position="top-right" theme="dark" />

      {/* ═══ HEADER ═══ */}
      <div className="mb-6">
        <h1 className="text-2xl font-black text-white">Sportsbook</h1>
        <p className="text-sm text-gray-500">
          Gestione scommesse, eventi e settlement
        </p>
      </div>

      {/* ═══ KPIs ═══ */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <div className="bg-[#12111a] rounded-xl border border-gray-800 p-4">
          <div className="text-[10px] text-gray-500 font-semibold">
            TOT. SCOMMESSO
          </div>
          <div className="text-lg font-black font-mono text-white">
            ${kpis.staked.toFixed(2)}
          </div>
        </div>
        <div className="bg-[#12111a] rounded-xl border border-gray-800 p-4">
          <div className="text-[10px] text-gray-500 font-semibold">
            LIABILITY APERTA
          </div>
          <div className="text-lg font-black font-mono text-red-400">
            ${kpis.liability.toFixed(2)}
          </div>
        </div>
        <div className="bg-[#12111a] rounded-xl border border-gray-800 p-4">
          <div className="text-[10px] text-gray-500 font-semibold">
            SCOMMESSE APERTE
          </div>
          <div className="text-lg font-black font-mono text-yellow-400">
            {kpis.openBets}
          </div>
        </div>
        <div className="bg-[#12111a] rounded-xl border border-gray-800 p-4">
          <div className="text-[10px] text-gray-500 font-semibold">
            MARGIN %
          </div>
          <div
            className={cn(
              "text-lg font-black font-mono",
              kpis.margin >= 0 ? "text-emerald-400" : "text-red-400"
            )}
          >
            {kpis.margin.toFixed(1)}%
          </div>
        </div>
        <div className="bg-[#12111a] rounded-xl border border-gray-800 p-4">
          <div className="text-[10px] text-gray-500 font-semibold">
            EVENTI APERTI
          </div>
          <div className="text-lg font-black font-mono text-blue-400">
            {kpis.openEventsCount}
          </div>
        </div>
      </div>

      {/* ═══ TAB NAVIGATION ═══ */}
      <div className="flex gap-1 mb-5 border-b border-gray-800">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 py-2.5 text-xs font-bold transition-all border-b-2 -mb-px",
              activeTab === tab.id
                ? "text-white border-brand"
                : "text-gray-500 border-transparent hover:text-gray-300"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════ */}
      {/* TAB: SCOMMESSE                              */}
      {/* ═══════════════════════════════════════════ */}
      {activeTab === "bets" && (
        <div>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            {/* Date range */}
            <div className="flex gap-1">
              {DATE_OPTIONS.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setBetDateRange(d.id)}
                  className={cn(
                    "px-2.5 py-1 rounded text-[10px] font-semibold transition-all",
                    betDateRange === d.id
                      ? "bg-brand text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>

            {/* Status */}
            <div className="flex gap-1">
              {BET_STATUS_OPTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setBetStatus(s.id)}
                  className={cn(
                    "px-2.5 py-1 rounded text-[10px] font-semibold transition-all",
                    betStatus === s.id
                      ? "bg-brand text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Search */}
            <input
              type="text"
              value={betSearch}
              onChange={(e) => setBetSearch(e.target.value)}
              placeholder="Cerca utente o ID..."
              className="px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-brand w-48"
            />
          </div>

          {/* Table */}
          <div className="bg-[#12111a] rounded-xl border border-gray-800 overflow-hidden">
            {betsLoading ? (
              <div className="p-8 text-center text-gray-500 text-sm">
                Caricamento...
              </div>
            ) : filteredBets.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-sm">
                Nessuna scommessa trovata
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left px-4 py-3 font-semibold">
                      Utente
                    </th>
                    <th className="text-left px-4 py-3 font-semibold">Tipo</th>
                    <th className="text-left px-4 py-3 font-semibold">
                      Evento
                    </th>
                    <th className="text-right px-4 py-3 font-semibold">
                      Stake
                    </th>
                    <th className="text-right px-4 py-3 font-semibold">
                      Quota
                    </th>
                    <th className="text-right px-4 py-3 font-semibold">
                      Vincita pot.
                    </th>
                    <th className="text-center px-4 py-3 font-semibold">
                      Stato
                    </th>
                    <th className="text-right px-4 py-3 font-semibold">
                      Data
                    </th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {filteredBets.map((bet) => {
                    const isExpanded = expandedBet === bet.id;
                    const legSummary =
                      bet.legs.length > 0
                        ? bet.legs
                            .map((l) => `${l.home_team} vs ${l.away_team}`)
                            .filter(
                              (v, i, a) => a.indexOf(v) === i
                            )
                            .join(", ")
                        : "—";

                    return (
                      <tr key={bet.id} className="group">
                        <td colSpan={9} className="p-0">
                          {/* Main row */}
                          <div
                            className={cn(
                              "grid grid-cols-[1fr_60px_1fr_80px_60px_80px_70px_90px_32px] items-center px-4 py-3 border-b border-gray-800/50 hover:bg-white/5 cursor-pointer",
                              isExpanded && "bg-white/5"
                            )}
                            onClick={() =>
                              setExpandedBet(isExpanded ? null : bet.id)
                            }
                          >
                            <span className="text-white font-medium truncate">
                              {bet.username}
                            </span>
                            <span className="text-gray-400 capitalize">
                              {bet.bet_type}
                            </span>
                            <span className="text-gray-300 truncate text-[10px]">
                              {legSummary}
                            </span>
                            <span className="text-right font-mono text-white">
                              ${bet.stake?.toFixed(2)}
                            </span>
                            <span className="text-right font-mono text-gray-300">
                              {bet.total_odds?.toFixed(2)}
                            </span>
                            <span className="text-right font-mono text-emerald-400">
                              ${bet.potential_win?.toFixed(2)}
                            </span>
                            <span className="text-center">
                              <StatusBadge status={bet.status} />
                            </span>
                            <span className="text-right text-gray-500">
                              {fmtDate(bet.created_at)}
                            </span>
                            <span className="text-center text-gray-600">
                              {bet.legs.length > 0 && (
                                <span
                                  className={cn(
                                    "inline-block transition-transform",
                                    isExpanded ? "rotate-180" : ""
                                  )}
                                >
                                  ▾
                                </span>
                              )}
                            </span>
                          </div>

                          {/* Expanded legs */}
                          {isExpanded && bet.legs.length > 0 && (
                            <div className="bg-black/20 border-b border-gray-800/50 px-6 py-2">
                              <div className="text-[9px] text-gray-500 font-semibold mb-1">
                                SELEZIONI ({bet.legs.length})
                              </div>
                              {bet.legs.map((leg) => (
                                <div
                                  key={leg.id}
                                  className="flex items-center justify-between py-1.5 border-b border-gray-800/30 last:border-0"
                                >
                                  <span className="text-[11px] text-gray-300">
                                    {leg.home_team} vs {leg.away_team}
                                  </span>
                                  <div className="flex items-center gap-3">
                                    <span className="text-[10px] text-gray-500 font-mono">
                                      @{leg.odds_at_placement?.toFixed(2)}
                                    </span>
                                    {leg.result && (
                                      <StatusBadge status={leg.result} />
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════ */}
      {/* TAB: EVENTI                                 */}
      {/* ═══════════════════════════════════════════ */}
      {activeTab === "events" && (
        <div>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            {/* Sport select */}
            <select
              value={eventSportFilter}
              onChange={(e) => setEventSportFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-xs text-white focus:outline-none focus:border-brand"
            >
              <option value="all">Tutti gli sport</option>
              {sportsList.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            {/* Status */}
            <div className="flex gap-1">
              {EVENT_STATUS_OPTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setEventStatusFilter(s.id)}
                  className={cn(
                    "px-2.5 py-1 rounded text-[10px] font-semibold transition-all",
                    eventStatusFilter === s.id
                      ? "bg-brand text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Date range */}
            <div className="flex gap-1">
              {DATE_OPTIONS.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setEventDateRange(d.id)}
                  className={cn(
                    "px-2.5 py-1 rounded text-[10px] font-semibold transition-all",
                    eventDateRange === d.id
                      ? "bg-brand text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="bg-[#12111a] rounded-xl border border-gray-800 overflow-hidden">
            {eventsLoading ? (
              <div className="p-8 text-center text-gray-500 text-sm">
                Caricamento...
              </div>
            ) : filteredEvents.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-sm">
                Nessun evento trovato
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left px-4 py-3 font-semibold">
                      Evento
                    </th>
                    <th className="text-left px-4 py-3 font-semibold">
                      Sport
                    </th>
                    <th className="text-left px-4 py-3 font-semibold">Lega</th>
                    <th className="text-right px-4 py-3 font-semibold">
                      Data
                    </th>
                    <th className="text-center px-4 py-3 font-semibold">
                      Score
                    </th>
                    <th className="text-center px-4 py-3 font-semibold">
                      Stato
                    </th>
                    <th className="text-center px-4 py-3 font-semibold">
                      Azioni
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((ev) => {
                    const canSettle =
                      ev.status === "live" || ev.status === "ended";
                    return (
                      <tr
                        key={ev.id}
                        className="border-b border-gray-800/50 hover:bg-white/5"
                      >
                        <td className="px-4 py-3">
                          <div className="text-white font-medium">
                            {ev.home_team} vs {ev.away_team}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-400">
                          {ev.sport_name}
                        </td>
                        <td className="px-4 py-3 text-gray-400">
                          {ev.league_name}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-500">
                          {fmtDate(ev.starts_at)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {ev.score_home !== null && ev.score_away !== null ? (
                            <span className="font-mono font-bold text-white">
                              {ev.score_home} - {ev.score_away}
                            </span>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <StatusBadge status={ev.status} />
                        </td>
                        <td className="px-4 py-3 text-center">
                          {canSettle ? (
                            <button
                              onClick={() =>
                                setSettleModal({
                                  event: ev,
                                  homeScore: ev.score_home ?? 0,
                                  awayScore: ev.score_away ?? 0,
                                })
                              }
                              className="px-3 py-1 rounded bg-gold-500/20 text-yellow-400 text-[9px] font-bold hover:bg-yellow-500/30 transition-colors"
                            >
                              Settle
                            </button>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════ */}
      {/* TAB: SETTLEMENT LOG                         */}
      {/* ═══════════════════════════════════════════ */}
      {activeTab === "settlement" && (
        <div>
          <div className="bg-[#12111a] rounded-xl border border-gray-800 overflow-hidden">
            {settledLoading ? (
              <div className="p-8 text-center text-gray-500 text-sm">
                Caricamento...
              </div>
            ) : settledBets.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-sm">
                Nessun settlement trovato
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left px-4 py-3 font-semibold">
                      Bet ID
                    </th>
                    <th className="text-left px-4 py-3 font-semibold">
                      Utente
                    </th>
                    <th className="text-left px-4 py-3 font-semibold">
                      Evento
                    </th>
                    <th className="text-right px-4 py-3 font-semibold">
                      Stake
                    </th>
                    <th className="text-center px-4 py-3 font-semibold">
                      Stato
                    </th>
                    <th className="text-right px-4 py-3 font-semibold">
                      Payout
                    </th>
                    <th className="text-right px-4 py-3 font-semibold">
                      Data Settlement
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {settledBets.map((bet) => (
                    <tr
                      key={bet.id}
                      className="border-b border-gray-800/50 hover:bg-white/5"
                    >
                      <td className="px-4 py-3 font-mono text-gray-400">
                        {bet.id.slice(0, 8)}...
                      </td>
                      <td className="px-4 py-3 text-white font-medium">
                        {bet.username}
                      </td>
                      <td className="px-4 py-3 text-gray-300 max-w-[200px] truncate">
                        {bet.event_names}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-white">
                        ${bet.stake?.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge status={bet.status} />
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3 text-right font-mono font-bold",
                          getPayout(bet) > 0
                            ? "text-emerald-400"
                            : "text-gray-500"
                        )}
                      >
                        ${getPayout(bet).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500">
                        {bet.settled_at ? fmtDate(bet.settled_at) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════ */}
      {/* SETTLEMENT MODAL                            */}
      {/* ═══════════════════════════════════════════ */}
      {settleModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => !settling && setSettleModal(null)}
        >
          <div
            className="bg-[#12111a] rounded-2xl border border-gray-700 p-6 w-full max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-white mb-1">
              Settlement Evento
            </h3>
            <p className="text-sm text-gray-400 mb-5">
              {settleModal.event.home_team} vs {settleModal.event.away_team}
            </p>

            <div className="flex gap-4 mb-6">
              <div className="flex-1">
                <label className="block text-[10px] text-gray-500 font-semibold mb-1">
                  {settleModal.event.home_team} (HOME)
                </label>
                <input
                  type="number"
                  min={0}
                  value={settleModal.homeScore}
                  onChange={(e) =>
                    setSettleModal({
                      ...settleModal,
                      homeScore: parseInt(e.target.value) || 0,
                    })
                  }
                  className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-center text-lg font-mono font-bold focus:outline-none focus:border-brand"
                />
              </div>
              <div className="flex items-end pb-3 text-gray-500 font-bold">
                —
              </div>
              <div className="flex-1">
                <label className="block text-[10px] text-gray-500 font-semibold mb-1">
                  {settleModal.event.away_team} (AWAY)
                </label>
                <input
                  type="number"
                  min={0}
                  value={settleModal.awayScore}
                  onChange={(e) =>
                    setSettleModal({
                      ...settleModal,
                      awayScore: parseInt(e.target.value) || 0,
                    })
                  }
                  className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-center text-lg font-mono font-bold focus:outline-none focus:border-brand"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setSettleModal(null)}
                disabled={settling}
                className="flex-1 py-2.5 rounded-xl border border-gray-700 text-gray-400 text-sm font-bold hover:bg-gray-800 transition-colors"
              >
                Annulla
              </button>
              <button
                onClick={handleSettle}
                disabled={settling}
                className={cn(
                  "flex-1 py-2.5 rounded-xl text-white text-sm font-bold transition-all",
                  settling
                    ? "bg-gray-600"
                    : "bg-brand hover:bg-brand-dark"
                )}
              >
                {settling ? "Processando..." : "Conferma Settlement"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
