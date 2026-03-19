"use client";

import { useState, useMemo, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useSportCounts, type SportCount, type LeagueCount } from "@/lib/hooks/use-sport-counts";
import { useSportsbook, type SportEvent, type Selection } from "@/lib/hooks/use-sportsbook";
import { getMidasSportIcon } from "@/components/kiosk/utils/midas-sport-map";
import KioskBetslip from "@/components/kiosk/kiosk-betslip";

/* ═══ PRE-MATCH PAGE — Replica Midas ═══ */

export default function KioskPreMatchPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full text-white/40">Caricamento...</div>}>
      <KioskPreMatchContent />
    </Suspense>
  );
}

function KioskPreMatchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialSport = searchParams.get("sport") || null;

  const { sports, leagues, expandedSport, fetchLeagues } = useSportCounts("all");
  const {
    events, loading, betslip, toggleBet, isSelected,
    clearBetslip, totalOdds, placeBet, placingBet,
  } = useSportsbook();

  const [activeSportSlug, setActiveSportSlug] = useState<string | null>(initialSport);
  const [activeLeagueSlug, setActiveLeagueSlug] = useState<string | null>(null);
  const [collapsedLeagues, setCollapsedLeagues] = useState<Set<string>>(new Set());

  // Active sport
  const activeSport = activeSportSlug || (sports[0]?.slug ?? null);

  // Filter events by sport + league
  const filteredEvents = useMemo(() => {
    let result = events.filter((e) => !e.live); // prematch only
    if (activeSport) result = result.filter((e) => e.sportSlug === activeSport);
    if (activeLeagueSlug) result = result.filter((e) => e.leagueSlug === activeLeagueSlug);
    return result;
  }, [events, activeSport, activeLeagueSlug]);

  // Group events by league
  const eventsByLeague = useMemo(() => {
    const map = new Map<string, { name: string; slug: string; events: SportEvent[] }>();
    for (const ev of filteredEvents) {
      const key = ev.leagueSlug || ev.league;
      if (!map.has(key)) {
        map.set(key, { name: ev.league, slug: key, events: [] });
      }
      map.get(key)!.events.push(ev);
    }
    return Array.from(map.values());
  }, [filteredEvents]);

  // Load leagues for active sport
  const handleSportClick = useCallback((slug: string) => {
    setActiveSportSlug(slug);
    setActiveLeagueSlug(null);
    fetchLeagues(slug);
  }, [fetchLeagues]);

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
      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* 5a. Sport pills bar */}
        <div className="flex-shrink-0 flex gap-1.5 overflow-x-auto px-2 py-2 no-scrollbar" style={{ background: "var(--midas-bg)" }}>
          {sports.map((sport) => (
            <button
              key={sport.slug}
              onClick={() => handleSportClick(sport.slug)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[3px] whitespace-nowrap cursor-pointer border-0 flex-shrink-0 transition-colors"
              style={{
                background: sport.slug === activeSport ? "var(--midas-red)" : "#ffffff",
                color: sport.slug === activeSport ? "#ffffff" : "#3B3C43",
                border: sport.slug === activeSport ? "none" : "2px solid #cccccc",
                fontFamily: "'Open Sans Condensed', sans-serif",
                fontSize: "14px",
                fontWeight: "bold",
              }}
            >
              <img
                src={getMidasSportIcon(sport.slug, sport.slug === activeSport ? "white" : "black")}
                alt=""
                className="w-4 h-4 object-contain"
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
              {sport.name}
              <span className="text-[11px] opacity-70">({sport.eventCount})</span>
            </button>
          ))}
        </div>

        {/* 5b. Competition tabs */}
        {expandedSport === activeSport && leagues.length > 0 && (
          <div className="flex-shrink-0 flex gap-0.5 overflow-x-auto px-2 py-1 no-scrollbar" style={{ background: "var(--midas-nav-bg)" }}>
            <button
              onClick={() => setActiveLeagueSlug(null)}
              className="px-3 py-1 rounded-[3px] whitespace-nowrap cursor-pointer border-0 text-[12px] font-bold flex-shrink-0"
              style={{
                background: !activeLeagueSlug ? "#ffffff" : "var(--midas-nav-unsel)",
                color: !activeLeagueSlug ? "var(--midas-red)" : "#ffffff",
                fontFamily: "'Open Sans Condensed', sans-serif",
              }}
            >
              Tutte ({filteredEvents.length})
            </button>
            {leagues.map((league) => (
              <button
                key={league.slug}
                onClick={() => setActiveLeagueSlug(league.slug === activeLeagueSlug ? null : league.slug)}
                className="px-3 py-1 rounded-[3px] whitespace-nowrap cursor-pointer border-0 text-[12px] font-bold flex-shrink-0"
                style={{
                  background: league.slug === activeLeagueSlug ? "#ffffff" : "var(--midas-nav-unsel)",
                  color: league.slug === activeLeagueSlug ? "var(--midas-red)" : "#ffffff",
                  fontFamily: "'Open Sans Condensed', sans-serif",
                }}
              >
                {league.name} ({league.eventCount})
              </button>
            ))}
          </div>
        )}

        {/* 5c + 5d. Events table */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-10 text-white/40 text-[13px]">
              Caricamento...
            </div>
          )}

          {!loading && eventsByLeague.length === 0 && (
            <div className="flex items-center justify-center py-10 text-white/40 text-[13px]">
              Nessun evento disponibile
            </div>
          )}

          {eventsByLeague.map((group) => (
            <div key={group.slug}>
              {/* League header */}
              <div
                className="flex items-center cursor-pointer select-none"
                onClick={() => toggleLeagueCollapse(group.slug)}
                style={{ background: "var(--midas-red)" }}
              >
                <div className="flex items-center gap-2 flex-1 px-3 py-1.5">
                  <img
                    src={getMidasSportIcon(activeSport || "calcio", "white")}
                    alt=""
                    className="w-4 h-4 object-contain"
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                  />
                  <span className="text-white text-[12px] font-bold uppercase" style={{ fontFamily: "'Open Sans Condensed', sans-serif" }}>
                    {group.name}
                  </span>
                  <span className="text-white/60 text-[11px]">({group.events.length})</span>
                </div>
                {/* Collapse button */}
                <div
                  className="px-3 py-1.5 flex items-center justify-center"
                  style={{ background: "var(--midas-medium-red)" }}
                >
                  <span className="text-white text-[10px]">{collapsedLeagues.has(group.slug) ? "▶" : "▼"}</span>
                </div>
              </div>

              {/* Column headers */}
              {!collapsedLeagues.has(group.slug) && (
                <>
                  <div className="flex items-center text-[10px] font-bold uppercase px-1" style={{ background: "#ececec", color: "#4a4a4a", fontFamily: "'Open Sans Condensed', sans-serif" }}>
                    <div className="w-[50px] text-center py-1">Ora</div>
                    <div className="flex-1 py-1 pl-1">Evento</div>
                    <div className="w-[48px] text-center py-1">1</div>
                    <div className="w-[48px] text-center py-1">X</div>
                    <div className="w-[48px] text-center py-1">2</div>
                    <div className="w-[48px] text-center py-1">U/O</div>
                    <div className="w-[48px] text-center py-1">GG/NG</div>
                    <div className="w-[36px] text-center py-1">+</div>
                  </div>

                  {/* Event rows */}
                  {group.events.map((event) => (
                    <EventRow
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

      {/* 5e. Betslip sidebar */}
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

/* ═══ EVENT ROW ═══ */

function EventRow({ event, isSelected, toggleBet, onClickMore }: {
  event: SportEvent;
  isSelected: (eventId: string, marketName: string, label: string) => boolean;
  toggleBet: (event: SportEvent, marketName: string, sel: Selection) => void;
  onClickMore: () => void;
}) {
  // Find main markets
  const m1x2 = event.markets.find((m) => m.name === "1X2" || m.marketType === "1X2");
  const muo = event.markets.find((m) =>
    (m.marketType || m.name || "").startsWith("U/O") ||
    (m.marketType || m.name || "").startsWith("O/U")
  );
  const mgg = event.markets.find((m) =>
    (m.marketType || m.name || "").includes("GG/NG") ||
    (m.marketType || m.name || "").includes("Gol/NoGol")
  );
  const extraCount = event.markets.length - [m1x2, muo, mgg].filter(Boolean).length;

  return (
    <div className="flex items-center border-b text-[12px] px-1 hover:bg-[var(--midas-row-highlight)] transition-colors" style={{ background: "var(--midas-event-regular-bg)", borderColor: "#e8e8e8" }}>
      {/* Time */}
      <div className="w-[50px] text-center text-black text-[11px] font-semibold py-2" style={{ fontFamily: "'Open Sans Condensed', sans-serif" }}>
        {event.time}
      </div>

      {/* Event name */}
      <div className="flex-1 py-2 pl-1 cursor-pointer" onClick={onClickMore}>
        <div className="text-[#4d4d4d] text-[11px] leading-tight font-semibold truncate" style={{ fontFamily: "'Open Sans Condensed', sans-serif" }}>
          {event.home}
        </div>
        <div className="text-[#4d4d4d] text-[11px] leading-tight font-semibold truncate" style={{ fontFamily: "'Open Sans Condensed', sans-serif" }}>
          {event.away}
        </div>
      </div>

      {/* 1X2 odds */}
      {m1x2 ? m1x2.selections.slice(0, 3).map((sel) => (
        <OddsCell
          key={sel.label}
          odds={sel.odds}
          selected={isSelected(event.id, m1x2!.name, sel.label)}
          onClick={() => toggleBet(event, m1x2!.name, sel)}
        />
      )) : (
        <>
          <EmptyOddsCell />
          <EmptyOddsCell />
          <EmptyOddsCell />
        </>
      )}

      {/* U/O */}
      {muo ? (
        <OddsCell
          odds={muo.selections[0]?.odds}
          label={muo.selections[0]?.label}
          selected={muo.selections[0] ? isSelected(event.id, muo.name, muo.selections[0].label) : false}
          onClick={() => muo.selections[0] && toggleBet(event, muo.name, muo.selections[0])}
        />
      ) : <EmptyOddsCell />}

      {/* GG/NG */}
      {mgg ? (
        <OddsCell
          odds={mgg.selections[0]?.odds}
          label={mgg.selections[0]?.label}
          selected={mgg.selections[0] ? isSelected(event.id, mgg.name, mgg.selections[0].label) : false}
          onClick={() => mgg.selections[0] && toggleBet(event, mgg.name, mgg.selections[0])}
        />
      ) : <EmptyOddsCell />}

      {/* More markets */}
      <div className="w-[36px] text-center">
        <button
          onClick={onClickMore}
          className="text-[10px] font-bold border-0 rounded-[2px] px-1 py-0.5 cursor-pointer"
          style={{ background: "var(--midas-event-more-regular)", color: "var(--midas-indicator)", fontFamily: "'Open Sans Condensed', sans-serif" }}
        >
          +{extraCount > 0 ? extraCount : ""}
        </button>
      </div>
    </div>
  );
}

/* ═══ ODDS CELL ═══ */

function OddsCell({ odds, label, selected, onClick }: {
  odds?: number;
  label?: string;
  selected: boolean;
  onClick: () => void;
}) {
  if (!odds) return <EmptyOddsCell />;

  return (
    <div className="w-[48px] text-center py-1.5 px-0.5">
      <button
        onClick={onClick}
        className="w-full py-1 rounded-[2px] text-[11px] font-bold border cursor-pointer transition-colors"
        style={{
          background: selected ? "var(--midas-red)" : "#f5f5f5",
          color: selected ? "#ffffff" : "#000000",
          borderColor: selected ? "var(--midas-red)" : "#d5d5d5",
          fontFamily: "'Open Sans Condensed', sans-serif",
        }}
      >
        {odds.toFixed(2)}
      </button>
    </div>
  );
}

function EmptyOddsCell() {
  return (
    <div className="w-[48px] text-center py-1.5 px-0.5">
      <div className="w-full py-1 rounded-[2px] text-[11px] text-[#ccc] border border-[#e8e8e8] bg-[#fafafa]" style={{ fontFamily: "'Open Sans Condensed', sans-serif" }}>
        —
      </div>
    </div>
  );
}
