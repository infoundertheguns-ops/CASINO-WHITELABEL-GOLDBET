"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSportsbook, type SportEvent, type Market, type Selection } from "@/lib/hooks/use-sportsbook";
import { getMidasSportIcon } from "@/components/kiosk/utils/midas-sport-map";
import KioskBetslip from "@/components/kiosk/kiosk-betslip";

/* ═══ EVENT DETAIL PAGE — All markets for one event ═══ */

// Market category mapping
const MARKET_CATEGORIES: Record<string, string[]> = {
  "Principale": ["1X2", "DC", "DNB", "1X2 1° Tempo", "1X2 2° Tempo"],
  "Gol": ["U/O", "O/U", "GG/NG", "Gol/NoGol", "Somma Gol", "Prossimo Gol"],
  "Risultato": ["Risultato Esatto", "Multi Gol"],
  "Handicap": ["Handicap", "1X2 H"],
  "Tempo": ["1° Tempo", "2° Tempo", "HT/FT"],
  "Speciali": [],
};

function categorizeMarket(market: Market): string {
  const mt = (market.marketType || market.name || "").toLowerCase();
  for (const [cat, patterns] of Object.entries(MARKET_CATEGORIES)) {
    if (cat === "Speciali") continue;
    for (const p of patterns) {
      if (mt.toLowerCase().startsWith(p.toLowerCase()) || mt.includes(p.toLowerCase())) return cat;
    }
  }
  return "Speciali";
}

export default function KioskEventDetailPage() {
  const params = useParams();
  const router = useRouter();
  const eventId = params.id as string;

  const {
    events, loading, betslip, toggleBet, isSelected,
    clearBetslip, totalOdds, placeBet, placingBet,
  } = useSportsbook();

  const [activeCategory, setActiveCategory] = useState<string>("Principale");

  const event = events.find((e) => e.id === eventId);

  // Categorize markets
  const categorizedMarkets = useMemo(() => {
    if (!event) return new Map<string, Market[]>();
    const map = new Map<string, Market[]>();
    for (const market of event.markets) {
      const cat = categorizeMarket(market);
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(market);
    }
    return map;
  }, [event]);

  const categories = Array.from(categorizedMarkets.keys());
  const activeMarkets = categorizedMarkets.get(activeCategory) || [];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-[13px]">
        Caricamento...
      </div>
    );
  }

  if (!event) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <div className="text-white/40 text-[13px]">Evento non trovato</div>
        <button
          onClick={() => router.back()}
          className="px-4 py-2 rounded-[3px] text-white font-bold border-0 cursor-pointer"
          style={{ background: "var(--midas-red)", fontFamily: "'Open Sans Condensed', sans-serif" }}
        >
          Torna indietro
        </button>
      </div>
    );
  }

  const isLive = event.live;

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* 6a. Event header */}
        <div
          className="flex-shrink-0 p-3"
          style={{ background: isLive ? "var(--midas-event-live-bg)" : "var(--midas-event-regular-bg)" }}
        >
          {/* Back button + sport icon */}
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => router.back()}
              className="text-[12px] font-bold border-0 rounded-[3px] px-2 py-1 cursor-pointer"
              style={{
                background: isLive ? "var(--midas-medium-red)" : "var(--midas-red)",
                color: "white",
                fontFamily: "'Open Sans Condensed', sans-serif",
              }}
            >
              ← Indietro
            </button>
            <img
              src={getMidasSportIcon(event.sportSlug || "calcio", isLive ? "white" : "black")}
              alt=""
              className="w-5 h-5 object-contain"
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
            <span
              className="text-[11px] uppercase font-bold"
              style={{ color: isLive ? "#ffffff" : "#4a4a4a", fontFamily: "'Open Sans Condensed', sans-serif" }}
            >
              {event.league}
            </span>
            {isLive && (
              <span className="bg-[var(--midas-running)] text-black px-2 py-[1px] rounded-full text-[9px] font-black uppercase ml-auto">
                LIVE {event.minute}&apos;
              </span>
            )}
          </div>

          {/* Teams + Score */}
          <div className="flex items-center justify-center gap-4">
            <div className="flex-1 text-right">
              <div
                className="text-[18px] font-bold"
                style={{ color: isLive ? "#ffffff" : "#4a4a4a", fontFamily: "'Open Sans Condensed', sans-serif" }}
              >
                {event.home}
              </div>
            </div>

            {/* Score boxes (live only) */}
            {isLive && (
              <div className="flex items-center gap-1">
                <div
                  className="w-[36px] h-[36px] flex items-center justify-center text-[18px] font-bold rounded-[3px]"
                  style={{ background: "var(--midas-score-bg)", color: "#000", border: "3px solid var(--midas-score-border)" }}
                >
                  {event.scoreH ?? 0}
                </div>
                <span className="text-[16px] font-bold" style={{ color: isLive ? "#fff" : "#4a4a4a" }}>-</span>
                <div
                  className="w-[36px] h-[36px] flex items-center justify-center text-[18px] font-bold rounded-[3px]"
                  style={{ background: "var(--midas-score-bg)", color: "#000", border: "3px solid var(--midas-score-border)" }}
                >
                  {event.scoreA ?? 0}
                </div>
              </div>
            )}

            {/* Time (prematch only) */}
            {!isLive && (
              <div className="flex items-center">
                <span className="text-[14px] font-bold text-[#000]" style={{ fontFamily: "'Open Sans Condensed', sans-serif" }}>
                  {event.time}
                </span>
              </div>
            )}

            <div className="flex-1">
              <div
                className="text-[18px] font-bold"
                style={{ color: isLive ? "#ffffff" : "#4a4a4a", fontFamily: "'Open Sans Condensed', sans-serif" }}
              >
                {event.away}
              </div>
            </div>
          </div>
        </div>

        {/* 6b. Market category tabs */}
        <div className="flex-shrink-0 flex gap-0 overflow-x-auto no-scrollbar" style={{ background: "var(--midas-red)" }}>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className="px-3 py-1.5 whitespace-nowrap cursor-pointer border-0 text-[11px] font-bold uppercase text-white flex-shrink-0"
              style={{
                background: cat === activeCategory ? "var(--midas-dark-red)" : "var(--midas-medium-red)",
                fontFamily: "'Open Sans Condensed', sans-serif",
              }}
            >
              {cat} ({categorizedMarkets.get(cat)?.length || 0})
            </button>
          ))}
        </div>

        {/* 6c. Markets grid */}
        <div className="flex-1 overflow-y-auto p-2">
          <div className="grid grid-cols-2 gap-2">
            {activeMarkets.map((market) => (
              <MarketCard
                key={market.id || market.name}
                event={event}
                market={market}
                isLive={isLive}
                isSelected={isSelected}
                toggleBet={toggleBet}
              />
            ))}
          </div>
          {activeMarkets.length === 0 && (
            <div className="flex items-center justify-center py-10 text-white/30 text-[12px]">
              Nessun mercato in questa categoria
            </div>
          )}
        </div>
      </div>

      {/* Betslip sidebar */}
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

/* ═══ MARKET CARD ═══ */

function MarketCard({ event, market, isLive, isSelected: isSelFn, toggleBet }: {
  event: SportEvent;
  market: Market;
  isLive: boolean;
  isSelected: (eventId: string, marketName: string, label: string) => boolean;
  toggleBet: (event: SportEvent, marketName: string, sel: Selection) => void;
}) {
  return (
    <div
      className="rounded-[3px] overflow-hidden"
      style={{ background: isLive ? "#101112" : "#ffffff" }}
    >
      {/* Market label */}
      <div
        className="px-2 py-1 text-[11px] font-bold uppercase text-white"
        style={{
          background: isLive ? "var(--midas-market-label-live)" : "var(--midas-market-label-regular)",
          fontFamily: "'Open Sans Condensed', sans-serif",
        }}
      >
        {market.name}
      </div>

      {/* Selections */}
      <div className="p-1.5">
        {market.selections.length <= 3 ? (
          // Horizontal layout for 2-3 selections
          <div className="flex gap-1">
            {market.selections.map((sel) => (
              <SelectionButton
                key={sel.label}
                sel={sel}
                selected={isSelFn(event.id, market.name, sel.label)}
                isLive={isLive}
                onClick={() => toggleBet(event, market.name, sel)}
              />
            ))}
          </div>
        ) : (
          // Vertical list for many selections
          <div className="flex flex-col gap-1">
            {market.selections.map((sel) => (
              <SelectionButton
                key={sel.label}
                sel={sel}
                selected={isSelFn(event.id, market.name, sel.label)}
                isLive={isLive}
                onClick={() => toggleBet(event, market.name, sel)}
                wide
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══ SELECTION BUTTON ═══ */

function SelectionButton({ sel, selected, isLive, onClick, wide }: {
  sel: Selection;
  selected: boolean;
  isLive: boolean;
  onClick: () => void;
  wide?: boolean;
}) {
  if (sel.suspended) {
    return (
      <div
        className={`${wide ? "w-full" : "flex-1"} py-1.5 px-2 rounded-[2px] text-center opacity-50`}
        style={{ background: isLive ? "#1a1a1a" : "#f2f2f2" }}
      >
        <span className="text-[10px] text-[#999]">—</span>
      </div>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`${wide ? "w-full flex justify-between" : "flex-1"} py-1.5 px-2 rounded-[2px] cursor-pointer border-0 transition-colors`}
      style={{
        background: selected ? "var(--midas-dark-red)" : (isLive ? "#1a1a1a" : "#f2f2f2"),
        fontFamily: "'Open Sans Condensed', sans-serif",
      }}
    >
      <span
        className="text-[10px] font-semibold"
        style={{ color: selected ? "#ffffff" : (isLive ? "#ffffff" : "#4a4a4a") }}
      >
        {sel.label}
      </span>
      <span
        className="text-[12px] font-bold ml-1"
        style={{ color: selected ? "#ffffff" : (isLive ? "#ffffff" : "#000000") }}
      >
        {sel.odds.toFixed(2)}
      </span>
    </button>
  );
}
