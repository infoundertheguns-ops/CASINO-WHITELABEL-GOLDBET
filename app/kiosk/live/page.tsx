"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSportsbook, type SportEvent, type Selection } from "@/lib/hooks/use-sportsbook";
import { useSportCounts } from "@/lib/hooks/use-sport-counts";
import { getMidasSportIcon } from "@/components/kiosk/utils/midas-sport-map";
import KioskBetslip from "@/components/kiosk/kiosk-betslip";

/* ═══ LIVE PAGE — Dark theme, real-time scores ═══ */

export default function KioskLivePage() {
  const router = useRouter();
  const { sports } = useSportCounts("all");
  const {
    events, loading, betslip, toggleBet, isSelected,
    clearBetslip, totalOdds, placeBet, placingBet,
  } = useSportsbook();

  const [activeSportSlug, setActiveSportSlug] = useState<string | null>(null);
  const [collapsedLeagues, setCollapsedLeagues] = useState<Set<string>>(new Set());

  // Only live events
  const liveEvents = useMemo(() => {
    let result = events.filter((e) => e.live);
    if (activeSportSlug) result = result.filter((e) => e.sportSlug === activeSportSlug);
    return result;
  }, [events, activeSportSlug]);

  // Unique live sports for filter
  const liveSports = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>();
    for (const ev of events.filter((e) => e.live)) {
      const slug = ev.sportSlug || "other";
      if (!map.has(slug)) {
        map.set(slug, { name: ev.sportName || slug, count: 0 });
      }
      map.get(slug)!.count++;
    }
    return Array.from(map.entries()).map(([slug, data]) => ({ slug, ...data }));
  }, [events]);

  // Group by league
  const eventsByLeague = useMemo(() => {
    const map = new Map<string, { name: string; slug: string; events: SportEvent[] }>();
    for (const ev of liveEvents) {
      const key = ev.leagueSlug || ev.league;
      if (!map.has(key)) {
        map.set(key, { name: ev.league, slug: key, events: [] });
      }
      map.get(key)!.events.push(ev);
    }
    return Array.from(map.values());
  }, [liveEvents]);

  const toggleLeagueCollapse = (slug: string) => {
    setCollapsedLeagues((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Sport filter pills — dark theme */}
        <div className="flex-shrink-0 flex gap-1.5 overflow-x-auto px-2 py-2 no-scrollbar" style={{ background: "var(--midas-nav-bg)" }}>
          <button
            onClick={() => setActiveSportSlug(null)}
            className="px-3 py-1.5 rounded-[3px] whitespace-nowrap cursor-pointer border-0 flex-shrink-0 text-[13px] font-bold"
            style={{
              background: !activeSportSlug ? "var(--midas-nav-bg)" : "#4a4a4a",
              color: "#ffffff",
              border: !activeSportSlug ? "2px solid var(--midas-selected)" : "none",
              fontFamily: "'Open Sans Condensed', sans-serif",
            }}
          >
            Tutti ({events.filter((e) => e.live).length})
          </button>
          {liveSports.map((sport) => (
            <button
              key={sport.slug}
              onClick={() => setActiveSportSlug(sport.slug === activeSportSlug ? null : sport.slug)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[3px] whitespace-nowrap cursor-pointer border-0 flex-shrink-0 text-[13px] font-bold"
              style={{
                background: sport.slug === activeSportSlug ? "var(--midas-nav-bg)" : "#4a4a4a",
                color: "#ffffff",
                border: sport.slug === activeSportSlug ? "2px solid var(--midas-selected)" : "none",
                fontFamily: "'Open Sans Condensed', sans-serif",
              }}
            >
              <img
                src={getMidasSportIcon(sport.slug, "white")}
                alt=""
                className="w-4 h-4 object-contain"
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
              {sport.name} ({sport.count})
            </button>
          ))}
        </div>

        {/* Events list — dark theme */}
        <div className="flex-1 overflow-y-auto" style={{ background: "var(--midas-event-live-bg)" }}>
          {loading && (
            <div className="flex items-center justify-center py-10 text-white/40 text-[13px]">
              Caricamento...
            </div>
          )}

          {!loading && liveEvents.length === 0 && (
            <div className="flex items-center justify-center py-10 text-white/40 text-[13px]">
              Nessun evento live al momento
            </div>
          )}

          {eventsByLeague.map((group) => (
            <div key={group.slug}>
              {/* League header — dark */}
              <div
                className="flex items-center cursor-pointer select-none"
                onClick={() => toggleLeagueCollapse(group.slug)}
                style={{ background: "var(--midas-nav-bg)" }}
              >
                <div className="flex items-center gap-2 flex-1 px-3 py-1.5">
                  <span className="text-white text-[12px] font-bold uppercase" style={{ fontFamily: "'Open Sans Condensed', sans-serif" }}>
                    {group.name}
                  </span>
                  <span className="text-white/40 text-[11px]">({group.events.length})</span>
                </div>
                <div className="px-3 py-1.5" style={{ background: "var(--midas-nav-bg)" }}>
                  <span className="text-white/50 text-[10px]">{collapsedLeagues.has(group.slug) ? "▶" : "▼"}</span>
                </div>
              </div>

              {/* Column headers — dark */}
              {!collapsedLeagues.has(group.slug) && (
                <>
                  <div className="flex items-center text-[10px] font-bold uppercase px-1" style={{ background: "var(--midas-nav-bg)", color: "#888", fontFamily: "'Open Sans Condensed', sans-serif" }}>
                    <div className="w-[50px] text-center py-1">Min</div>
                    <div className="w-[60px] text-center py-1">Score</div>
                    <div className="flex-1 py-1 pl-1">Evento</div>
                    <div className="w-[48px] text-center py-1">1</div>
                    <div className="w-[48px] text-center py-1">X</div>
                    <div className="w-[48px] text-center py-1">2</div>
                    <div className="w-[48px] text-center py-1">U/O</div>
                    <div className="w-[36px] text-center py-1">+</div>
                  </div>

                  {group.events.map((event) => (
                    <LiveEventRow
                      key={event.id}
                      event={event}
                      isSelected={isSelected}
                      toggleBet={toggleBet}
                      onClickMore={() => router.push(`/kiosk/event/${event.id}`)}
                    />
                  ))}
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Betslip — live header variant */}
      <div className="w-[280px] flex-shrink-0 border-l border-white/10">
        <KioskBetslip
          betslip={betslip}
          toggleBet={toggleBet}
          clearBetslip={clearBetslip}
          totalOdds={totalOdds}
          placeBet={placeBet}
          placingBet={placingBet}
        />
      </div>
    </div>
  );
}

/* ═══ LIVE EVENT ROW ═══ */

function LiveEventRow({ event, isSelected, toggleBet, onClickMore }: {
  event: SportEvent;
  isSelected: (eventId: string, marketName: string, label: string) => boolean;
  toggleBet: (event: SportEvent, marketName: string, sel: Selection) => void;
  onClickMore: () => void;
}) {
  const m1x2 = event.markets.find((m) => m.name === "1X2" || m.marketType === "1X2");
  const muo = event.markets.find((m) =>
    (m.marketType || m.name || "").startsWith("U/O") ||
    (m.marketType || m.name || "").startsWith("O/U")
  );
  const extraCount = event.markets.length - [m1x2, muo].filter(Boolean).length;

  // Time status border
  const minuteNum = event.minute || 0;
  let statusColor = "var(--midas-running)";
  if (minuteNum <= 0) statusColor = "var(--midas-about-start)";

  return (
    <div
      className="flex items-center border-b text-[12px] px-1 hover:bg-[#1a1a1a] transition-colors"
      style={{ background: "var(--midas-event-live-bg)", borderColor: "#222" }}
    >
      {/* Minute with status border */}
      <div className="w-[50px] text-center py-2 relative">
        <div className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r" style={{ background: statusColor }} />
        <span className="text-white text-[11px] font-bold" style={{ fontFamily: "'Open Sans Condensed', sans-serif" }}>
          {minuteNum > 0 ? `${minuteNum}'` : "—"}
        </span>
        {event.period && (
          <div className="text-[8px] text-white/40">{event.period}</div>
        )}
      </div>

      {/* Score */}
      <div className="w-[60px] flex items-center justify-center gap-0.5">
        <span
          className="w-[22px] h-[22px] flex items-center justify-center text-[12px] font-bold rounded-[2px]"
          style={{ background: "var(--midas-score-bg)", color: "#000", border: "1px solid var(--midas-score-border)" }}
        >
          {event.scoreH ?? 0}
        </span>
        <span className="text-white/40 text-[10px]">-</span>
        <span
          className="w-[22px] h-[22px] flex items-center justify-center text-[12px] font-bold rounded-[2px]"
          style={{ background: "var(--midas-score-bg)", color: "#000", border: "1px solid var(--midas-score-border)" }}
        >
          {event.scoreA ?? 0}
        </span>
      </div>

      {/* Event name */}
      <div className="flex-1 py-2 pl-1 cursor-pointer" onClick={onClickMore}>
        <div className="text-white text-[11px] leading-tight font-semibold truncate" style={{ fontFamily: "'Open Sans Condensed', sans-serif" }}>
          {event.home}
        </div>
        <div className="text-white/70 text-[11px] leading-tight font-semibold truncate" style={{ fontFamily: "'Open Sans Condensed', sans-serif" }}>
          {event.away}
        </div>
      </div>

      {/* 1X2 */}
      {m1x2 ? m1x2.selections.slice(0, 3).map((sel) => (
        <LiveOddsCell
          key={sel.label}
          odds={sel.odds}
          selected={isSelected(event.id, m1x2!.name, sel.label)}
          onClick={() => toggleBet(event, m1x2!.name, sel)}
          previousOdds={sel.previousOdds}
        />
      )) : (
        <>
          <EmptyLiveOddsCell />
          <EmptyLiveOddsCell />
          <EmptyLiveOddsCell />
        </>
      )}

      {/* U/O */}
      {muo ? (
        <LiveOddsCell
          odds={muo.selections[0]?.odds}
          selected={muo.selections[0] ? isSelected(event.id, muo.name, muo.selections[0].label) : false}
          onClick={() => muo.selections[0] && toggleBet(event, muo.name, muo.selections[0])}
          previousOdds={muo.selections[0]?.previousOdds}
        />
      ) : <EmptyLiveOddsCell />}

      {/* More */}
      <div className="w-[36px] text-center">
        <button
          onClick={onClickMore}
          className="text-[10px] font-bold border-0 rounded-[2px] px-1 py-0.5 cursor-pointer"
          style={{ background: "var(--midas-event-more-live)", color: "#aaa", fontFamily: "'Open Sans Condensed', sans-serif" }}
        >
          +{extraCount > 0 ? extraCount : ""}
        </button>
      </div>
    </div>
  );
}

/* ═══ LIVE ODDS CELL ═══ */

function LiveOddsCell({ odds, selected, onClick, previousOdds }: {
  odds?: number;
  selected: boolean;
  onClick: () => void;
  previousOdds?: number;
}) {
  if (!odds) return <EmptyLiveOddsCell />;

  // Direction indicator
  let dirIndicator = "";
  if (previousOdds && previousOdds !== odds) {
    dirIndicator = odds > previousOdds ? "▲" : "▼";
  }

  return (
    <div className="w-[48px] text-center py-1.5 px-0.5">
      <button
        onClick={onClick}
        className="w-full py-1 rounded-[2px] text-[11px] font-bold border cursor-pointer transition-colors"
        style={{
          background: selected ? "var(--midas-red)" : "#1a1a1a",
          color: selected ? "#ffffff" : "#ffffff",
          borderColor: selected ? "var(--midas-red)" : "#333",
          fontFamily: "'Open Sans Condensed', sans-serif",
        }}
      >
        {odds.toFixed(2)}
        {dirIndicator && (
          <span className={`text-[8px] ml-0.5 ${dirIndicator === "▲" ? "text-[var(--midas-running)]" : "text-red-400"}`}>
            {dirIndicator}
          </span>
        )}
      </button>
    </div>
  );
}

function EmptyLiveOddsCell() {
  return (
    <div className="w-[48px] text-center py-1.5 px-0.5">
      <div className="w-full py-1 rounded-[2px] text-[11px] text-white/20 border border-[#333] bg-[#1a1a1a]">
        —
      </div>
    </div>
  );
}
