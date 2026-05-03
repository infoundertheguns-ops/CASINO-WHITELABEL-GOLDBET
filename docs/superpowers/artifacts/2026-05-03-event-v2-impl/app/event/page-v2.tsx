// app/(kiosk)/event/[eventId]/page-v2.tsx
// Composer page for event detail v2 (calcio). Built in Task 15 of the event-v2 plan.
//
// Receives a DbEvent (already loaded via loadPlayerEventV2) and dispatches markets to the
// right component via categorizeMarketsV2. We deliberately work with DbEvent/DbMarket/DbOutcome
// shapes instead of the legacy kiosk Event/Market/Selection because the v2 components consume
// outcomes (not selections) and need the original outcome.id (not the mapped Selection.id).
//
// Bet slip integration is intentionally a no-op TODO here — Task 16 wires the parent page to
// route the onSelectOutcome callback into the existing Zustand bet slip store.

"use client";

import { useState, useMemo } from "react";
import type { DbEvent, DbMarket, DbOutcome } from "@/lib/types/db";
import { categorizeMarketsV2 } from "@/lib/market-categorizer-v2";
import { getDefaultLine } from "@/lib/line-picker-defaults";
import {
  FOOTBALL_TAB_ORDER,
  FOOTBALL_TAB_MARKETS_V2,
  FOOTBALL_DEFAULT_SUB_PILL,
  parseMarketSpec,
} from "@/lib/market-config-v2";
import TabBar from "@/components/event-v2/TabBar";
import SubPillBar from "@/components/event-v2/SubPillBar";
import MarketSection from "@/components/event-v2/MarketSection";
import HeroOutcomeRow from "@/components/event-v2/HeroOutcomeRow";
import CompactOutcomeRow from "@/components/event-v2/CompactOutcomeRow";
import LinePicker from "@/components/event-v2/LinePicker";
import AsianHandicapBlock from "@/components/event-v2/AsianHandicapBlock";
import EuropeanHandicapBlock from "@/components/event-v2/EuropeanHandicapBlock";
import MatrixGrid from "@/components/event-v2/MatrixGrid";
import ScoreGrid from "@/components/event-v2/ScoreGrid";
import PlayerListFlat from "@/components/event-v2/PlayerListFlat";
import { formatTime, formatDateItalian, shortCode } from "@/lib/utils";

export type SelectOutcomePayload = {
  outcomeId: string;
  outcomeIdV2: string;
  odds: number;
  label: string;
};

type Props = {
  event: DbEvent;
  eventId: string;
  // Optional callback for parent page to forward into bet slip store.
  // If omitted, selection is a no-op (useful for read-only previews / smoke tests).
  onSelectOutcome?: (o: SelectOutcomePayload) => void;
};

// v2 outcomes from v_player_outcomes carry the same UUID for legacy and v2 purposes
// (the v2 view IS the source of truth post-cutover). For now both fields point to the
// same id; if a future schema split exposes idV2 separately we can adapt here.
function outcomeId(o: DbOutcome): string {
  return o.id;
}
function outcomeIdV2(o: DbOutcome): string {
  return o.id;
}

function marketIdV2(m: DbMarket): string {
  return m.id;
}

// Build OutcomeData[] (used by Hero/Compact rows).
function toOutcomeRowData(outcomes: DbOutcome[] | undefined) {
  return (outcomes ?? []).map((o) => ({
    outcomeId: outcomeId(o),
    outcomeIdV2: outcomeIdV2(o),
    label: o.name,
    odds: typeof o.odds === "number" ? o.odds : Number(o.odds),
    isSuspended: !!o.is_suspended,
    isManualSuspended: !!o.manual_suspended,
    oddsChange: null as "up" | "down" | null,
  }));
}

// Build LineVariant[] (used by LinePicker / AH / EU blocks).
function toLineVariants(variants: DbMarket[]) {
  return variants
    .filter((m) => m.line != null)
    .map((m) => ({
      line: m.line as number,
      marketId: m.id,
      marketIdV2: marketIdV2(m),
      outcomes: (m.outcomes ?? []).map((o) => ({
        outcomeId: outcomeId(o),
        outcomeIdV2: outcomeIdV2(o),
        name: o.name,
        odds: typeof o.odds === "number" ? o.odds : Number(o.odds),
        isSuspended: !!o.is_suspended,
        isManualSuspended: !!o.manual_suspended,
        oddsChange: null as "up" | "down" | null,
      })),
    }));
}

// Friendly title for a single market section. Falls back to market_type.
function titleFor(m: DbMarket): string {
  return m.market_type.toUpperCase();
}

export default function EventDetailPageV2({ event, eventId, onSelectOutcome }: Props) {
  const [activeTab, setActiveTab] = useState<string>("Principali");
  const [activeSubPill, setActiveSubPill] = useState<string>(
    FOOTBALL_DEFAULT_SUB_PILL["Principali"] ?? ""
  );

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setActiveSubPill(FOOTBALL_DEFAULT_SUB_PILL[tab] ?? "");
  };

  const handleSelect = (o: SelectOutcomePayload) => {
    if (onSelectOutcome) onSelectOutcome(o);
    // TODO Task 16: wire to legacy bet slip Zustand store via parent page.
  };

  const tabConfig = FOOTBALL_TAB_MARKETS_V2[activeTab];
  const hasSubPills = !!tabConfig?.subPills;
  const subPillNames = hasSubPills ? Object.keys(tabConfig!.subPills!) : [];

  const categorized = useMemo(() => {
    return categorizeMarketsV2(
      (event.markets ?? []).map((m) => ({
        id: m.id,
        market_type: m.market_type,
        line: m.line ?? null,
        outcomes: m.outcomes ?? [],
        // Pass the original DbMarket through as well so render functions can access it.
        _ref: m,
      })),
      "calcio",
      activeTab,
      hasSubPills ? activeSubPill : undefined
    );
  }, [event.markets, activeTab, activeSubPill, hasSubPills]);

  function renderSingleMarket(adapted: { _ref: DbMarket }, isPrincipali: boolean) {
    const m = adapted._ref;

    // Special grid: HT/FT
    if (m.market_type === "HT/FT") {
      const outcomes = m.outcomes ?? [];
      const map = new Map(
        outcomes.map((o) => [
          o.name,
          {
            outcomeId: outcomeId(o),
            outcomeIdV2: outcomeIdV2(o),
            odds: typeof o.odds === "number" ? o.odds : Number(o.odds),
            isSuspended: !!o.is_suspended,
            isManualSuspended: !!o.manual_suspended,
          },
        ])
      );
      return (
        <MarketSection key={m.id} title="HT/FT — PRIMO TEMPO / FINALE">
          <MatrixGrid
            rowLabels={["HT 1", "HT X", "HT 2"]}
            colLabels={["Finale 1", "Finale X", "Finale 2"]}
            keyPrefix={["1", "X", "2"]}
            outcomes={map}
            onSelect={handleSelect}
          />
        </MarketSection>
      );
    }

    // Special grid: Risultato Esatto (correct score)
    if (m.market_type === "Risultato Esatto") {
      const outcomes = m.outcomes ?? [];
      const map = new Map(
        outcomes.map((o) => [
          o.name,
          {
            outcomeId: outcomeId(o),
            outcomeIdV2: outcomeIdV2(o),
            odds: typeof o.odds === "number" ? o.odds : Number(o.odds),
            isSuspended: !!o.is_suspended,
            isManualSuspended: !!o.manual_suspended,
          },
        ])
      );
      return (
        <MarketSection key={m.id} title="RISULTATO ESATTO">
          <ScoreGrid outcomes={map} onSelect={handleSelect} />
        </MarketSection>
      );
    }

    // Player markets — flat list (Marcatore Anytime / 1°/Ultimo / Marca+Assist)
    if (
      m.market_type === "Marcatore Anytime" ||
      m.market_type === "1° Marcatore" ||
      m.market_type === "Ultimo Marcatore" ||
      m.market_type === "Marca + Assist"
    ) {
      const players = (m.outcomes ?? []).map((o) => ({
        outcomeId: outcomeId(o),
        outcomeIdV2: outcomeIdV2(o),
        playerName: o.name,
        odds: typeof o.odds === "number" ? o.odds : Number(o.odds),
        isSuspended: !!o.is_suspended,
        isManualSuspended: !!o.manual_suspended,
        oddsChange: null as "up" | "down" | null,
      }));
      return (
        <MarketSection key={m.id} title={m.market_type.toUpperCase()}>
          <PlayerListFlat players={players} onSelect={handleSelect} />
        </MarketSection>
      );
    }

    // Default: Hero in Principali tab for 1X2, otherwise Compact.
    const outcomes = toOutcomeRowData(m.outcomes);
    const isHero = isPrincipali && m.market_type === "1X2";
    const RowComp = isHero ? HeroOutcomeRow : CompactOutcomeRow;
    return (
      <MarketSection key={m.id} title={titleFor(m)}>
        <RowComp outcomes={outcomes} onSelect={handleSelect} />
      </MarketSection>
    );
  }

  function renderGroupedMarket(spec: string, variants: DbMarket[]) {
    const { marketType } = parseMarketSpec(spec);
    const lineVariants = toLineVariants(variants);

    if (lineVariants.length === 0) return null;

    if (marketType === "European Hcap") {
      return (
        <MarketSection key={spec} title="EUROPEAN HANDICAP (3-WAY)">
          <EuropeanHandicapBlock variants={lineVariants} onSelect={handleSelect} />
        </MarketSection>
      );
    }

    if (
      marketType === "AH" ||
      marketType === "AH - 1T" ||
      marketType === "Hcap Corners"
    ) {
      return (
        <MarketSection key={spec} title={marketType.toUpperCase()}>
          <AsianHandicapBlock
            variants={lineVariants}
            homeTeamName={event.home_team}
            awayTeamName={event.away_team}
            marketFamily={marketType}
            onSelect={handleSelect}
          />
        </MarketSection>
      );
    }

    // Default: LinePicker with under-over renderer.
    const defaultLine =
      getDefaultLine("calcio", marketType) ?? lineVariants[0].line;
    return (
      <MarketSection key={spec} title={marketType.toUpperCase()}>
        <LinePicker
          marketFamily={marketType}
          variants={lineVariants}
          defaultLine={defaultLine}
          outcomeRenderer="under-over"
          onSelect={handleSelect}
        />
      </MarketSection>
    );
  }

  // Build a synthetic kiosk-style display id for the event header (matches legacy formatter).
  const competitionName = event.league?.name ?? "";
  const headerCode = shortCode(event.id);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Event header bar — visual parity with legacy page.tsx ~lines 116-160 */}
      <div
        className="flex items-center shrink-0 px-4"
        style={{
          backgroundColor: "#fff",
          height: 56,
          borderBottom: "1px solid #ddd",
        }}
      >
        <div className="flex items-center gap-2 shrink-0">
          <div
            className="flex items-center justify-center"
            style={{
              border: "2px solid #FFC107",
              borderRadius: 10,
              padding: "4px 10px",
            }}
          >
            <span className="text-[16px] font-bold text-[#333]">{headerCode}</span>
          </div>
        </div>

        <div className="flex items-center justify-center flex-1 gap-3">
          <span className="text-[#333] text-[26px] font-bold uppercase">
            {event.home_team}
          </span>
          <div className="flex flex-col items-center">
            <span className="text-[11px] text-[#999] uppercase leading-none">
              Tempo
            </span>
            <span className="text-[16px] font-bold text-[#333]">
              {formatTime(event.starts_at)}
            </span>
          </div>
          <span className="text-[#333] text-[26px] font-bold uppercase">
            {event.away_team}
          </span>
        </div>

        <div className="shrink-0 text-right">
          <div className="text-[14px] font-bold text-[#333]">
            {competitionName}
          </div>
          <div className="text-[12px] text-[#999] uppercase">
            {formatDateItalian(event.starts_at)}
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <TabBar
        tabs={FOOTBALL_TAB_ORDER}
        activeTab={activeTab}
        onChange={handleTabChange}
      />

      {/* Sub-pill bar (when applicable) */}
      {hasSubPills && (
        <div style={{ background: "#fafafa", padding: "0 8px" }}>
          <SubPillBar
            pills={subPillNames}
            active={activeSubPill}
            onChange={setActiveSubPill}
          />
        </div>
      )}

      {/* Content */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 8,
          background: "#f5f5f5",
        }}
      >
        {categorized.markets.length === 0 &&
          categorized.groupedMarkets.size === 0 && (
            <div
              style={{ textAlign: "center", padding: 40, color: "#888" }}
            >
              Nessun mercato disponibile per questa categoria
            </div>
          )}

        {categorized.markets.map((adapted) =>
          renderSingleMarket(
            adapted as unknown as { _ref: DbMarket },
            activeTab === "Principali"
          )
        )}

        {[...categorized.groupedMarkets.entries()].map(([spec, adaptedVariants]) => {
          // Unwrap _ref to get original DbMarket[] for grouped renderer.
          const variants = (adaptedVariants as unknown as { _ref: DbMarket }[]).map(
            (a) => a._ref
          );
          return renderGroupedMarket(spec, variants);
        })}
      </div>
    </div>
  );
}
