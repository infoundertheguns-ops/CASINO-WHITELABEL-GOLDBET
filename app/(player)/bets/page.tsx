"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useAuth } from "@/lib/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// ═══ TYPES ═══

type StatusFilter = "all" | "open" | "won" | "lost" | "void";
const PAGE_SIZE = 20;

interface BetRow {
  id: string;
  bet_type: string;
  stake: number;
  total_odds: number;
  potential_win: number;
  status: string;
  created_at: string;
  selections: SelectionRow[];
}

interface SelectionRow {
  id: string;
  odds_at_placement: number;
  result: string | null;
  event_name: string;
  market_name: string;
  outcome_name: string;
}

interface KpiData {
  total: number;
  open: number;
  won: number;
  lost: number;
  totalStaked: number;
  totalWon: number;
}

// ═══ HELPERS ═══

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("it-IT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    open: { cls: "bg-yellow-100 text-yellow-700", label: "APERTA" },
    won: { cls: "bg-emerald-100 text-emerald-700", label: "VINTA" },
    lost: { cls: "bg-red-100 text-red-600", label: "PERSA" },
    void: { cls: "bg-gray-100 text-gray-500", label: "VOID" },
    cashout: { cls: "bg-blue-100 text-blue-600", label: "CASHOUT" },
  };
  const s = map[status] || { cls: "bg-gray-100 text-gray-500", label: status.toUpperCase() };
  return (
    <span className={cn("px-2 py-0.5 rounded text-[9px] font-bold", s.cls)}>
      {s.label}
    </span>
  );
}

function LegResultBadge({ result }: { result: string | null }) {
  if (!result) return <span className="text-[9px] text-gray-400">—</span>;
  const map: Record<string, string> = {
    won: "text-emerald-500",
    lost: "text-red-500",
    void: "text-gray-400",
    push: "text-blue-400",
  };
  return (
    <span className={cn("text-[9px] font-bold uppercase", map[result] || "text-gray-400")}>
      {result}
    </span>
  );
}

// ═══ PAGE ═══

export default function MyBetsPage() {
  const { user } = useAuth();
  const supabase = createClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const [bets, setBets] = useState<BetRow[]>([]);
  const [kpis, setKpis] = useState<KpiData>({
    total: 0,
    open: 0,
    won: 0,
    lost: 0,
    totalStaked: 0,
    totalWon: 0,
  });
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [totalFiltered, setTotalFiltered] = useState(0);

  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const pnl = kpis.totalWon - kpis.totalStaked;

  // ════════════════════════════════════════════
  // FETCH KPIs (lightweight, all bets)
  // ════════════════════════════════════════════
  const fetchKpis = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("bets")
      .select("status, stake, potential_win")
      .eq("user_id", user.id);

    if (!data) return;

    const k: KpiData = { total: data.length, open: 0, won: 0, lost: 0, totalStaked: 0, totalWon: 0 };
    for (const b of data) {
      const row = b as Record<string, unknown>;
      const status = row.status as string;
      const stake = (row.stake as number) || 0;
      const potWin = (row.potential_win as number) || 0;
      k.totalStaked += stake;
      if (status === "open") k.open++;
      else if (status === "won") {
        k.won++;
        k.totalWon += potWin;
      } else if (status === "lost") k.lost++;
    }
    setKpis(k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ════════════════════════════════════════════
  // FETCH PAGINATED BETS
  // ════════════════════════════════════════════
  const fetchBets = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from("bets")
      .select(
        `
        *,
        bet_selections(
          id, odds_at_placement, result,
          event:events(home_team, away_team),
          market:markets(name),
          outcome:outcomes(name)
        )
      `,
        { count: "exact" }
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (filter !== "all") query = query.eq("status", filter);

    const { data, count } = await query;
    setTotalFiltered(count || 0);

    setBets(
      (data || []).map((b: Record<string, unknown>) => {
        const sels =
          (b.bet_selections as Record<string, unknown>[] | null) || [];
        return {
          id: b.id as string,
          bet_type: b.bet_type as string,
          stake: b.stake as number,
          total_odds: (b.total_odds as number) || 0,
          potential_win: (b.potential_win as number) || 0,
          status: b.status as string,
          created_at: b.created_at as string,
          selections: sels.map((s: Record<string, unknown>) => {
            const ev = s.event as Record<string, string> | null;
            const mkt = s.market as Record<string, string> | null;
            const out = s.outcome as Record<string, string> | null;
            return {
              id: s.id as string,
              odds_at_placement: (s.odds_at_placement as number) || 0,
              result: s.result as string | null,
              event_name: ev
                ? `${ev.home_team} vs ${ev.away_team}`
                : "—",
              market_name: mkt?.name || "—",
              outcome_name: out?.name || "—",
            };
          }),
        };
      })
    );

    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, filter, page]);

  // ════════════════════════════════════════════
  // EFFECTS
  // ════════════════════════════════════════════

  // Reset page on filter change
  useEffect(() => {
    setPage(0);
  }, [filter]);

  // Fetch data
  useEffect(() => {
    fetchBets();
    fetchKpis();
  }, [fetchBets, fetchKpis]);

  // ════════════════════════════════════════════
  // REALTIME: open bets status changes
  // ════════════════════════════════════════════
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel("my-bets-realtime")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "bets",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const updated = payload.new as Record<string, unknown>;
          const newStatus = updated.status as string;
          const updatedId = updated.id as string;

          // Update bet in list
          setBets((prev) =>
            prev.map((b) =>
              b.id === updatedId ? { ...b, status: newStatus } : b
            )
          );

          // Refresh KPIs to reflect status change
          fetchKpis();
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, fetchKpis]);

  // ════════════════════════════════════════════
  // CASHOUT ESTIMATE
  // ════════════════════════════════════════════
  const getCashoutValue = (bet: BetRow): number => {
    return parseFloat((bet.stake * bet.total_odds * 0.85).toFixed(2));
  };

  const canCashout = (bet: BetRow): boolean => {
    return (
      bet.status === "open" &&
      (bet.bet_type === "multi" ||
        bet.bet_type === "multipla" ||
        bet.bet_type === "sistema")
    );
  };

  // ════════════════════════════════════════════
  // FILTER OPTIONS
  // ════════════════════════════════════════════
  const FILTERS: { id: StatusFilter; label: string; count: number }[] = [
    { id: "all", label: "Tutte", count: kpis.total },
    { id: "open", label: "Aperte", count: kpis.open },
    { id: "won", label: "Vinte", count: kpis.won },
    { id: "lost", label: "Perse", count: kpis.lost },
  ];

  // ════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════

  if (!user) {
    return (
      <div className="p-6 text-center text-gray-400">
        Accedi per vedere le scommesse
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-0">
      <h1 className="text-xl font-bold text-gray-900 mb-1">
        Le Mie Scommesse
      </h1>
      <p className="text-xs text-gray-400 mb-4">Storico e tracking</p>

      {/* ═══ KPIs ═══ */}
      <div className="grid grid-cols-5 gap-2 mb-4">
        {[
          { label: "Totali", value: String(kpis.total), color: "text-gray-800" },
          {
            label: "Aperte",
            value: String(kpis.open),
            color: "text-yellow-500",
          },
          {
            label: "Vinte",
            value: String(kpis.won),
            color: "text-emerald-500",
          },
          { label: "Perse", value: String(kpis.lost), color: "text-red-500" },
          {
            label: "P&L",
            value: `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(0)}`,
            color: pnl >= 0 ? "text-emerald-500" : "text-red-500",
          },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-white rounded-xl border border-gray-200 p-3 text-center"
          >
            <div className={cn("text-lg font-black font-mono", s.color)}>
              {s.value}
            </div>
            <div className="text-[9px] text-gray-400 font-semibold">
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* ═══ FILTERS ═══ */}
      <div className="flex gap-1 mb-4">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-semibold",
              filter === f.id
                ? "bg-brand text-white"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            )}
          >
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      {/* ═══ BET LIST ═══ */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse"
            >
              <div className="flex justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-4 w-16 bg-gray-200 rounded" />
                  <div>
                    <div className="h-3 w-20 bg-gray-200 rounded mb-1" />
                    <div className="h-2 w-28 bg-gray-200 rounded" />
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="h-4 w-14 bg-gray-200 rounded" />
                  <div className="h-4 w-14 bg-gray-200 rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : bets.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <span className="text-3xl block mb-2">🎯</span>
          <p className="text-sm text-gray-400">Nessuna scommessa</p>
        </div>
      ) : (
        <div className="space-y-2">
          {bets.map((bet) => {
            const isExpanded = expanded === bet.id;
            const showCashout = canCashout(bet);
            const cashoutVal = showCashout ? getCashoutValue(bet) : 0;

            return (
              <div
                key={bet.id}
                className={cn(
                  "bg-white rounded-xl border",
                  bet.status === "open"
                    ? "border-yellow-200"
                    : bet.status === "won"
                      ? "border-emerald-200"
                      : bet.status === "lost"
                        ? "border-red-200"
                        : "border-gray-200"
                )}
              >
                {/* Header row */}
                <button
                  onClick={() => setExpanded(isExpanded ? null : bet.id)}
                  className="w-full px-4 py-3 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <StatusBadge status={bet.status} />
                    <div className="text-left">
                      <div className="text-xs font-bold text-gray-800 capitalize">
                        {bet.bet_type === "singola"
                          ? "Singola"
                          : bet.bet_type === "multi" || bet.bet_type === "multipla"
                            ? `Multipla (${bet.selections.length})`
                            : `${bet.bet_type} (${bet.selections.length})`}
                      </div>
                      <div className="text-[10px] text-gray-400">
                        {fmtDate(bet.created_at)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-[10px] text-gray-400">Stake</div>
                      <div className="text-sm font-bold font-mono">
                        ${bet.stake?.toFixed(2)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-gray-400">Vincita</div>
                      <div
                        className={cn(
                          "text-sm font-bold font-mono",
                          bet.status === "won"
                            ? "text-emerald-500"
                            : "text-gray-600"
                        )}
                      >
                        ${bet.potential_win?.toFixed(2)}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "text-gray-400 transition-transform",
                        isExpanded ? "rotate-180" : ""
                      )}
                    >
                      ▾
                    </span>
                  </div>
                </button>

                {/* Expanded selections */}
                {isExpanded && (
                  <div className="px-4 pb-3 border-t border-gray-100 pt-3 space-y-2">
                    {bet.selections.map((sel) => (
                      <div
                        key={sel.id}
                        className="flex justify-between items-center text-xs bg-gray-50 rounded-lg px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-gray-800 truncate">
                            {sel.event_name}
                          </div>
                          <div className="text-[10px] text-gray-400">
                            {sel.market_name}:{" "}
                            <span className="font-semibold text-gray-600">
                              {sel.outcome_name}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                          <span className="font-mono font-bold text-gray-700">
                            {sel.odds_at_placement?.toFixed(2)}
                          </span>
                          <LegResultBadge result={sel.result} />
                        </div>
                      </div>
                    ))}

                    {/* Total odds */}
                    <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                      <span className="text-[10px] text-gray-400">
                        Quota totale
                      </span>
                      <span className="text-sm font-bold font-mono text-brand">
                        {bet.total_odds?.toFixed(2)}
                      </span>
                    </div>

                    {/* Cashout button for multi/sistema open bets */}
                    {showCashout && (
                      <div className="pt-2 border-t border-gray-100">
                        <button
                          disabled
                          title="Presto disponibile"
                          className="w-full py-2 rounded-lg bg-gray-100 text-gray-400 text-xs font-bold cursor-not-allowed flex items-center justify-center gap-2"
                        >
                          <span>Cashout</span>
                          <span className="font-mono text-gray-500">
                            ${cashoutVal.toFixed(2)}
                          </span>
                          <span className="text-[9px] text-gray-300">
                            (presto disponibile)
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Live tracking indicator */}
                {bet.status === "open" && (
                  <div className="px-4 pb-2">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-pulse" />
                      <span className="text-[9px] text-yellow-600 font-semibold">
                        In attesa di risultato
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ PAGINATION ═══ */}
      {!loading && totalFiltered > 0 && (
        <div className="flex items-center justify-between mt-4 px-1">
          <span className="text-[10px] text-gray-400">
            {totalFiltered} scommess{totalFiltered === 1 ? "a" : "e"} · Pagina{" "}
            {page + 1} di {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                page === 0
                  ? "bg-gray-100 text-gray-300 cursor-not-allowed"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              ← Precedente
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                page >= totalPages - 1
                  ? "bg-gray-100 text-gray-300 cursor-not-allowed"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              Successiva →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
