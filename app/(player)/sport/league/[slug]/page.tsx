"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useLeagueEvents } from "@/lib/hooks/use-league-events";
import {
  useSportsbook,
  type SportEvent,
  type Selection,
} from "@/lib/hooks/use-sportsbook";
import { MarketCategoryTabs } from "@/components/sportsbook/market-category-tabs";
import {
  MARKET_CATEGORIES,
  getTournamentColumns,
  resolveColumnOdds,
  getCategoriesWithCounts,
  getMarketsForCategory,
} from "@/lib/constants/market-categories";

// ═══ HELPERS ═══

function LiveTimer({ minute, receivedAt }: { minute: number; receivedAt: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 10000);
    return () => clearInterval(interval);
  }, []);
  const elapsed = Math.floor((Date.now() - receivedAt) / 60000);
  return <>{minute + elapsed}&apos;</>;
}

function getOddsDirection(sel: { odds: number; previousOdds?: number; changedAt?: number }): "up" | "down" | null {
  if (!sel.changedAt || sel.previousOdds == null) return null;
  if (Date.now() - sel.changedAt > 5000) return null;
  if (sel.odds > sel.previousOdds) return "up";
  if (sel.odds < sel.previousOdds) return "down";
  return null;
}

function formatDateHeader(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const eventDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (eventDay.getTime() - today.getTime()) / 86400000;

  if (diff === 0) return "Oggi";
  if (diff === 1) return "Domani";
  return d.toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatTime(ev: SportEvent): string {
  if (ev.live) return "";
  const match = ev.time.match(/(\d{2}:\d{2})/);
  return match ? match[1] : ev.time;
}

// Group events: live first, then by date
function groupEventsByDate(events: SportEvent[]): { label: string; events: SportEvent[]; isLive?: boolean }[] {
  const live = events.filter((e) => e.live);
  const prematch = events.filter((e) => !e.live);

  const groups: { label: string; events: SportEvent[]; isLive?: boolean }[] = [];

  if (live.length > 0) {
    groups.push({ label: "LIVE", events: live, isLive: true });
  }

  // Group prematch by date
  const dateMap = new Map<string, SportEvent[]>();
  for (const ev of prematch) {
    // Extract date from time field or use a fallback
    const dateKey = ev.time.includes("Domani")
      ? new Date(Date.now() + 86400000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    // Better: try to parse from ev.time, but we might not have starts_at directly.
    // Use market data order (events are already sorted by starts_at from the hook)
    const arr = dateMap.get(dateKey) || [];
    arr.push(ev);
    dateMap.set(dateKey, arr);
  }

  // Since events are already sorted by starts_at, we'll group sequentially
  // by detecting date changes
  let currentDate = "";
  let currentGroup: SportEvent[] = [];
  for (const ev of prematch) {
    // Extract a date string from the time - format varies
    const timeStr = ev.time;
    let dateLabel: string;
    if (timeStr.includes("Domani")) {
      dateLabel = "Domani";
    } else if (timeStr.match(/^\d{2}:\d{2}$/)) {
      dateLabel = "Oggi";
    } else {
      // Has a date component like "24 feb 20:45"
      dateLabel = timeStr.replace(/\d{2}:\d{2}$/, "").trim() || "Oggi";
    }

    if (dateLabel !== currentDate) {
      if (currentGroup.length > 0) {
        groups.push({ label: currentDate, events: currentGroup });
      }
      currentDate = dateLabel;
      currentGroup = [ev];
    } else {
      currentGroup.push(ev);
    }
  }
  if (currentGroup.length > 0) {
    groups.push({ label: currentDate, events: currentGroup });
  }

  return groups;
}

// ═══ PAGE ═══

export default function LeaguePage() {
  const params = useParams();
  const router = useRouter();
  const slug = typeof params?.slug === "string" ? params.slug : "";

  const { league, sportName, sportIcon, events, loading, error } = useLeagueEvents(slug);
  const { betslip, toggleBet, isSelected, clearBetslip, totalOdds, placeBet, placingBet } = useSportsbook();

  const [activeTab, setActiveTab] = useState("principali");
  const [stake, setStake] = useState("");
  const [msg, setMsg] = useState("");
  const [showMobileBetslip, setShowMobileBetslip] = useState(false);

  // Aggregate categories across all events
  const allCategories = useMemo(() => {
    // Merge all markets to get available categories
    const allMarkets = events.flatMap((e) => e.markets);
    return getCategoriesWithCounts(allMarkets);
  }, [events]);

  // Set default tab
  useEffect(() => {
    if (allCategories.length > 0 && !allCategories.find((c) => c.id === activeTab)) {
      setActiveTab(allCategories[0].id);
    }
  }, [allCategories, activeTab]);

  const columns = useMemo(() => getTournamentColumns(activeTab), [activeTab]);
  const dateGroups = useMemo(() => groupEventsByDate(events), [events]);

  // For categories that don't have column definitions, show card view
  const hasColumns = columns.length > 0;

  const potentialWin = stake ? parseFloat(stake) * totalOdds : 0;

  // ── Loading ──
  if (loading) {
    return (
      <div className="p-4 lg:p-0 animate-pulse">
        <div className="h-3 w-48 bg-gray-200 rounded mb-3" />
        <div className="h-10 bg-gray-200 rounded-xl mb-4" />
        <div className="h-8 bg-gray-200 rounded mb-3" />
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-12 bg-gray-200 rounded mb-1" />
        ))}
      </div>
    );
  }

  if (error || !league) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-400 mb-3">{error || "Lega non trovata"}</p>
        <button onClick={() => router.push("/sport")} className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-bold">
          &larr; Sport
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-0">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => router.push("/sport")} className="text-gray-400 hover:text-brand transition-colors">
          &larr;
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg flex-shrink-0">{sportIcon}</span>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-gray-900 truncate">{league.name}</h1>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">
              {sportName} {league.country && `\u00B7 ${league.country}`} \u00B7 {events.length} eventi
            </p>
          </div>
        </div>
      </div>

      {/* ── Category Tabs ── */}
      <div className="mb-4">
        <MarketCategoryTabs
          categories={allCategories}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      </div>

      <div className="lg:flex lg:gap-5">
        {/* ═══ MAIN CONTENT ═══ */}
        <div className="flex-1 min-w-0">
          {events.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <p className="text-gray-400 text-sm">Nessun evento disponibile</p>
            </div>
          ) : hasColumns ? (
            /* ═══ TABLE VIEW (for categories with columns) ═══ */
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {/* Column headers */}
              <div className="hidden sm:grid items-center border-b border-gray-100 bg-gray-50 text-[10px] font-bold text-gray-500 uppercase tracking-wider"
                style={{ gridTemplateColumns: `1fr repeat(${columns.length}, 64px) 36px` }}
              >
                <div className="px-3 py-2">Evento</div>
                {columns.map((col) => (
                  <div key={col.header} className="text-center py-2">{col.header}</div>
                ))}
                <div className="text-center py-2">+</div>
              </div>

              {/* Date groups */}
              {dateGroups.map((group) => (
                <div key={group.label}>
                  {/* Date header */}
                  <div className={cn(
                    "px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border-b border-gray-100",
                    group.isLive
                      ? "bg-emerald-50 text-emerald-600"
                      : "bg-gray-50 text-gray-400"
                  )}>
                    {group.isLive && <span className="inline-block w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse mr-1.5 align-middle" />}
                    {group.label}
                  </div>

                  {/* Events */}
                  {group.events.map((ev) => (
                    <EventRow
                      key={ev.id}
                      ev={ev}
                      columns={columns}
                      toggleBet={toggleBet}
                      isSelected={isSelected}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            /* ═══ CARD VIEW (for categories without table columns, e.g. handicap, esatto) ═══ */
            <div className="space-y-2">
              {dateGroups.map((group) => (
                <div key={group.label}>
                  <div className={cn(
                    "px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-t-xl border border-b-0 border-gray-200",
                    group.isLive ? "bg-emerald-50 text-emerald-600" : "bg-gray-50 text-gray-400"
                  )}>
                    {group.isLive && <span className="inline-block w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse mr-1.5 align-middle" />}
                    {group.label}
                  </div>
                  {group.events.map((ev) => (
                    <EventCard
                      key={ev.id}
                      ev={ev}
                      activeTab={activeTab}
                      toggleBet={toggleBet}
                      isSelected={isSelected}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ═══ DESKTOP BETSLIP ═══ */}
        <DesktopBetslip
          betslip={betslip}
          events={events}
          toggleBet={toggleBet}
          clearBetslip={clearBetslip}
          totalOdds={totalOdds}
          stake={stake}
          setStake={setStake}
          potentialWin={potentialWin}
          msg={msg}
          placingBet={placingBet}
          onPlaceBet={async () => {
            if (!stake || parseFloat(stake) <= 0) return;
            setMsg("");
            const result = await placeBet(parseFloat(stake));
            if (result.success) {
              setMsg(result.flagged ? "warn:Scommessa piazzata — in verifica" : "ok:Scommessa piazzata!");
              setStake("");
              setTimeout(() => setMsg(""), 4000);
            } else {
              setMsg(`err:${result.error}`);
            }
          }}
        />
      </div>

      {/* ═══ MOBILE FLOATING BETSLIP ═══ */}
      {betslip.length > 0 && (
        <div className="lg:hidden fixed bottom-20 left-1/2 -translate-x-1/2 max-w-[400px] w-[calc(100%-2rem)] z-40">
          <button
            onClick={() => setShowMobileBetslip(true)}
            className="w-full py-3 rounded-xl bg-brand text-white font-bold text-sm shadow-lg flex items-center justify-center gap-2"
          >
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
              onClick={async () => {
                if (!stake || parseFloat(stake) <= 0) return;
                setMsg("");
                const result = await placeBet(parseFloat(stake));
                if (result.success) {
                  setMsg("ok:Scommessa piazzata!");
                  setStake("");
                  setShowMobileBetslip(false);
                } else {
                  setMsg(`err:${result.error}`);
                }
              }}
              disabled={placingBet || !stake || parseFloat(stake) <= 0}
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

// ═══ EVENT ROW (table view) ═══

function EventRow({
  ev,
  columns,
  toggleBet,
  isSelected,
}: {
  ev: SportEvent;
  columns: ReturnType<typeof getTournamentColumns>;
  toggleBet: (event: SportEvent, marketName: string, sel: Selection) => void;
  isSelected: (eventId: string, marketName: string, selectionLabel: string) => boolean;
}) {
  const totalMarkets = ev.markets.length;

  return (
    <>
      {/* Desktop row */}
      <div
        className="hidden sm:grid items-center border-b border-gray-50 hover:bg-gray-50/50 transition-colors"
        style={{ gridTemplateColumns: `1fr repeat(${columns.length}, 64px) 36px` }}
      >
        {/* Event info */}
        <div className="px-3 py-2 min-w-0">
          <Link href={`/sport/${ev.id}`} className="group flex items-center gap-2">
            {ev.live ? (
              <span className="text-[10px] font-bold text-emerald-500 flex-shrink-0 w-10">
                {ev.minute != null && ev.minuteReceivedAt
                  ? <LiveTimer minute={ev.minute} receivedAt={ev.minuteReceivedAt} />
                  : <>{ev.minute || 0}&apos;</>}
              </span>
            ) : (
              <span className="text-[10px] text-gray-400 flex-shrink-0 w-10 font-mono">
                {formatTime(ev)}
              </span>
            )}
            <div className="min-w-0">
              <span className="text-xs font-semibold text-gray-800 group-hover:text-brand transition-colors truncate block">
                {ev.home} vs {ev.away}
              </span>
            </div>
          </Link>
          {ev.live && ev.scoreH != null && (
            <div className="ml-12 text-[10px] font-bold text-gray-600">
              {ev.scoreH} - {ev.scoreA}
            </div>
          )}
        </div>

        {/* Odds columns */}
        {columns.map((col) => {
          const resolved = resolveColumnOdds(ev.markets, col);
          if (!resolved) {
            return <div key={col.header} className="text-center text-[10px] text-gray-300">-</div>;
          }

          if (resolved.suspended) {
            return (
              <div key={col.header} className="text-center">
                <span className="text-[10px] text-gray-400">&#x1f512;</span>
              </div>
            );
          }

          const selected = isSelected(ev.id, resolved.marketName, resolved.selectionLabel);

          return (
            <button
              key={col.header}
              onClick={() => {
                const market = ev.markets.find((m) => m.name === resolved.marketName);
                const sel = market?.selections.find((s) => s.label === resolved.selectionLabel);
                if (sel && market) toggleBet(ev, market.name, sel);
              }}
              className={cn(
                "mx-0.5 py-1.5 rounded text-xs font-bold font-mono transition-all",
                selected
                  ? "bg-brand/10 text-brand ring-1 ring-brand"
                  : "bg-gray-100 text-gray-800 hover:bg-gray-200"
              )}
            >
              {resolved.odds.toFixed(2)}
            </button>
          );
        })}

        {/* More markets link */}
        <Link href={`/sport/${ev.id}`} className="text-center text-[10px] font-bold text-brand hover:underline">
          +{totalMarkets}
        </Link>
      </div>

      {/* Mobile card */}
      <div className="sm:hidden border-b border-gray-100 px-3 py-2">
        <Link href={`/sport/${ev.id}`} className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2 min-w-0">
            {ev.live ? (
              <span className="text-[10px] font-bold text-emerald-500">
                {ev.minute != null && ev.minuteReceivedAt
                  ? <LiveTimer minute={ev.minute} receivedAt={ev.minuteReceivedAt} />
                  : <>{ev.minute || 0}&apos;</>}
              </span>
            ) : (
              <span className="text-[10px] text-gray-400 font-mono">{formatTime(ev)}</span>
            )}
            <span className="text-xs font-semibold text-gray-800 truncate">
              {ev.home} vs {ev.away}
            </span>
          </div>
          {ev.live && ev.scoreH != null && (
            <span className="text-xs font-bold text-gray-700">{ev.scoreH}-{ev.scoreA}</span>
          )}
        </Link>
        <div className="flex gap-1">
          {columns.slice(0, 5).map((col) => {
            const resolved = resolveColumnOdds(ev.markets, col);
            if (!resolved) return <div key={col.header} className="flex-1" />;
            const selected = isSelected(ev.id, resolved.marketName, resolved.selectionLabel);
            return (
              <button
                key={col.header}
                onClick={() => {
                  const market = ev.markets.find((m) => m.name === resolved.marketName);
                  const sel = market?.selections.find((s) => s.label === resolved.selectionLabel);
                  if (sel && market) toggleBet(ev, market.name, sel);
                }}
                className={cn(
                  "flex-1 py-1.5 rounded text-center",
                  selected ? "bg-brand/10 ring-1 ring-brand" : "bg-gray-100"
                )}
              >
                <div className="text-[8px] text-gray-400">{col.header}</div>
                <div className={cn("text-[11px] font-bold font-mono", selected ? "text-brand" : "text-gray-800")}>
                  {resolved.odds.toFixed(2)}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ═══ EVENT CARD (card view for non-table categories) ═══

function EventCard({
  ev,
  activeTab,
  toggleBet,
  isSelected,
}: {
  ev: SportEvent;
  activeTab: string;
  toggleBet: (event: SportEvent, marketName: string, sel: Selection) => void;
  isSelected: (eventId: string, marketName: string, selectionLabel: string) => boolean;
}) {
  const markets = useMemo(() => getMarketsForCategory(ev.markets, activeTab), [ev.markets, activeTab]);

  return (
    <div className="bg-white border border-gray-200 border-t-0 last:rounded-b-xl overflow-hidden">
      <div className="px-3 py-2 flex items-center justify-between border-b border-gray-50">
        <Link href={`/sport/${ev.id}`} className="flex items-center gap-2 min-w-0 group">
          {ev.live ? (
            <span className="text-[10px] font-bold text-emerald-500">
              {ev.minute || 0}&apos;
            </span>
          ) : (
            <span className="text-[10px] text-gray-400 font-mono">{formatTime(ev)}</span>
          )}
          <span className="text-xs font-semibold text-gray-800 truncate group-hover:text-brand transition-colors">
            {ev.home} vs {ev.away}
          </span>
        </Link>
        {ev.live && ev.scoreH != null && (
          <span className="text-xs font-bold text-gray-700 flex-shrink-0">{ev.scoreH}-{ev.scoreA}</span>
        )}
      </div>
      {markets.length > 0 ? (
        <div className="px-3 py-2 space-y-2">
          {markets.map((market) => (
            <div key={market.id || market.name}>
              <div className="text-[10px] text-gray-400 font-semibold mb-1">{market.name}</div>
              <div className={cn(
                "gap-1",
                market.selections.length <= 3 ? "flex" : "grid grid-cols-3"
              )}>
                {market.selections.map((sel) => {
                  if (sel.suspended) {
                    return (
                      <div key={sel.id || sel.label} className="flex-1 py-1.5 rounded bg-gray-50 text-center text-[10px] text-gray-400 opacity-60">
                        {sel.label} &#x1f512;
                      </div>
                    );
                  }
                  const selected = isSelected(ev.id, market.name, sel.label);
                  return (
                    <button
                      key={sel.id || sel.label}
                      onClick={() => toggleBet(ev, market.name, sel)}
                      className={cn(
                        "flex-1 py-1.5 rounded text-center transition-all",
                        selected
                          ? "bg-brand/10 ring-1 ring-brand"
                          : "bg-gray-100 hover:bg-gray-200"
                      )}
                    >
                      <div className="text-[8px] text-gray-400">{sel.label}</div>
                      <div className={cn("text-[11px] font-bold font-mono", selected ? "text-brand" : "text-gray-800")}>
                        {sel.odds.toFixed(2)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-3 py-2 text-[10px] text-gray-400">Nessun mercato per questa categoria</div>
      )}
    </div>
  );
}

// ═══ DESKTOP BETSLIP ═══

function DesktopBetslip({
  betslip,
  events,
  toggleBet,
  clearBetslip,
  totalOdds,
  stake,
  setStake,
  potentialWin,
  msg,
  placingBet,
  onPlaceBet,
}: {
  betslip: ReturnType<typeof useSportsbook>["betslip"];
  events: SportEvent[];
  toggleBet: ReturnType<typeof useSportsbook>["toggleBet"];
  clearBetslip: () => void;
  totalOdds: number;
  stake: string;
  setStake: (v: string) => void;
  potentialWin: number;
  msg: string;
  placingBet: boolean;
  onPlaceBet: () => void;
}) {
  if (betslip.length === 0) return null;

  const msgType = msg.split(":")[0];
  const msgText = msg.slice(msg.indexOf(":") + 1);

  return (
    <div className="hidden lg:block w-72 flex-shrink-0">
      <div className="sticky top-20 bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="bg-gray-900 text-white px-4 py-3 flex justify-between items-center">
          <span className="text-sm font-bold">Schedina</span>
          <div className="flex items-center gap-2">
            <span className="bg-brand text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{betslip.length}</span>
            <button onClick={clearBetslip} className="text-gray-400 hover:text-white text-xs">&times;</button>
          </div>
        </div>
        <div className="p-3">
          <div className="max-h-[280px] overflow-y-auto">
            {betslip.map((b, i) => {
              const bEvent = events.find((e) => e.id === b.eventId);
              return (
                <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div className="min-w-0 flex-1 mr-2">
                    <div className="text-[11px] font-semibold text-gray-800 truncate">{b.match}</div>
                    <div className="text-[9px] text-gray-400">{b.marketName}: {b.selection}</div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-xs font-bold text-brand font-mono">{b.odds.toFixed(2)}</span>
                    <button
                      onClick={() => {
                        if (!bEvent) return;
                        const market = bEvent.markets.find((m) => m.name === b.marketName);
                        const sel = market?.selections.find((s) => s.label === b.selection);
                        if (sel) toggleBet(bEvent, b.marketName, sel);
                      }}
                      className="text-gray-300 hover:text-red-400 text-[10px]"
                    >&times;</button>
                  </div>
                </div>
              );
            })}
          </div>

          {betslip.length > 1 && (
            <div className="flex justify-between text-xs mt-2 pt-2 border-t border-gray-200">
              <span className="text-gray-500">{betslip.length === 2 ? "Doppia" : betslip.length === 3 ? "Tripla" : `Multipla (${betslip.length})`}</span>
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
                <button key={v} onClick={() => setStake(String(v))} className="flex-1 py-1 rounded bg-gray-100 text-[9px] font-bold text-gray-500 hover:bg-gray-200">
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

          {msg && (
            <div className={cn(
              "mt-2 px-2 py-1.5 rounded text-[10px] font-semibold text-center",
              msgType === "ok" ? "bg-emerald-50 text-emerald-600"
                : msgType === "warn" ? "bg-yellow-50 text-yellow-700"
                : "bg-red-50 text-red-600"
            )}>
              {msgText}
            </div>
          )}

          <button
            onClick={onPlaceBet}
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
      </div>
    </div>
  );
}
