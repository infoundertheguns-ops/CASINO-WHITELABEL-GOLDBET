// app/(kiosk)/event/[eventId]/page-v2.tsx
// Composer page for event detail v2. Sport-keyed via event.sport.slug; built in Task 15 of the event-v2 plan.
//
// Receives a DbEvent (already loaded via loadPlayerEventV2) and dispatches markets to the
// right component via categorizeMarketsV2. We deliberately work with DbEvent/DbMarket/DbOutcome
// shapes instead of the legacy kiosk Event/Market/Selection because the v2 components consume
// outcomes (not selections) and need the original outcome.id (not the mapped Selection.id).
//
// Bet slip integration is intentionally a no-op TODO here — Task 16 wires the parent page to
// route the onSelectOutcome callback into the existing Zustand bet slip store.

"use client";

import { useState, useMemo, useEffect } from "react";
import type { DbEvent, DbMarket, DbOutcome } from "@/lib/types/db";
import { categorizeMarketsV2 } from "@/lib/market-categorizer-v2";
import { getDefaultLine } from "@/lib/line-picker-defaults";
import {
  TAB_ORDER_BY_SPORT,
  TAB_MARKETS_BY_SPORT,
  DEFAULT_SUB_PILL_BY_SPORT,
  parseMarketSpec,
  resolveTitleOverride,
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
import PlayerOverUnderRow from "@/components/event-v2/PlayerOverUnderRow";
import PlayerYesNoRow from "@/components/event-v2/PlayerYesNoRow";
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

// Tokenize a team name for DC label matching: lowercase, drop short/common tokens.
// The stop-word list intentionally includes division/category markers (Town, Reserves,
// U20, WFC, HNK, MFK, etc.) since they appear in BOTH teams in Reserves/Lower divisions
// and would otherwise create false-positive shared tokens.
const TEAM_STOPWORDS = new Set([
  // Football suffixes / club types
  'fc','ac','cf','sc','sk','hk','afc','cfc','sfc','ssc','aas','asd','usd','sa','de','la','le',
  'club','team','football','calcio','spa','srl','pro','presisi','united','utd','city',
  'real','sporting','athletic','academy',
  // Eastern Europe / Israel / South America prefixes
  'hapoel','maccabi','dynamo','dinamo','spartak','cska','dukla','sk','hk','fk','pfc','mfk',
  'hnk','nk','ks','ks','rb','rsc',
  // Division / category markers
  'town','reserve','reserves','reserva','reservas','youth','jeugd','jugend','junior','juniors',
  'u17','u18','u19','u20','u21','u23','wfc','women','femminile','ii','iii','b','c','d',
  // Year tokens (e.g. "1948", "1991")
  '1900','1901','1902','1903','1904','1905','1906','1907','1908','1909',
  '1910','1911','1912','1913','1914','1915','1916','1917','1918','1919',
  '1920','1921','1922','1923','1924','1925','1926','1927','1928','1929',
  '1930','1931','1932','1933','1934','1935','1936','1937','1938','1939',
  '1940','1941','1942','1943','1944','1945','1946','1947','1948','1949',
  '1950','1951','1952','1953','1954','1955','1956','1957','1958','1959',
  '1960','1961','1962','1963','1964','1965','1966','1967','1968','1969',
  '1970','1971','1972','1973','1974','1975','1976','1977','1978','1979',
  '1980','1981','1982','1983','1984','1985','1986','1987','1988','1989',
  '1990','1991','1992','1993','1994','1995','1996','1997','1998','1999',
  '2000','2001','2002','2003','2004','2005','2006','2007','2008','2009',
]);
function tokenize(name: string): string[] {
  return (name || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !TEAM_STOPWORDS.has(t));
}

// Compact DC label: maps full odds-api outcome names ("PSM Makassar or Bhayangkara FC")
// to standard 1X/X2/12 codes. Algorithm uses UNIQUE tokens (home-only minus away-only)
// to disambiguate teams that share city/region tokens (e.g. AEK Athens vs Panathinaikos
// Athens — "athens" is shared, classification must rely on "aek" / "panathinaikos").
function compactDCLabel(outcomeName: string, homeTeam: string, awayTeam: string): string {
  const lower = (outcomeName || '').toLowerCase();
  const parts = lower.split(/\s+or\s+|\s+o\s+/).filter(Boolean);
  const homeAll = new Set(tokenize(homeTeam));
  const awayAll = new Set(tokenize(awayTeam));
  // Unique-only sets: tokens that identify ONLY home or ONLY away.
  const homeOnly = new Set([...homeAll].filter((t) => !awayAll.has(t)));
  const awayOnly = new Set([...awayAll].filter((t) => !homeAll.has(t)));

  // Loose match: exact, OR one is a prefix of the other (both >= 4 chars).
  // Catches "hearts"/"heart", short forms, plural variants, etc — odds-api commonly
  // emits team nicknames in DC outcomes ("Hearts or Rangers" for Heart of Midlothian).
  function looseHas(set: Set<string>, t: string): boolean {
    if (set.has(t)) return true;
    if (t.length < 4) return false;
    for (const s of set) {
      if (s.length < 4) continue;
      if (t.startsWith(s) || s.startsWith(t)) return true;
    }
    return false;
  }
  function classify(part: string): 'H' | 'A' | 'D' | null {
    const trimmed = part.trim();
    if (/\bdraw\b|\bpareggio\b/.test(trimmed) || trimmed === 'x') return 'D';
    const toks = tokenize(part);
    let hUniq = 0, aUniq = 0, hAny = 0, aAny = 0;
    for (const t of toks) {
      if (looseHas(homeOnly, t)) hUniq++;
      if (looseHas(awayOnly, t)) aUniq++;
      if (looseHas(homeAll, t)) hAny++;
      if (looseHas(awayAll, t)) aAny++;
    }
    // Prefer unique-token discrimination. Fall back to any-token only when no unique
    // signal exists (e.g. an outcome part containing only a shared city name).
    if (hUniq !== aUniq) return hUniq > aUniq ? 'H' : 'A';
    if (hAny > aAny && hAny > 0) return 'H';
    if (aAny > hAny && aAny > 0) return 'A';
    return null;
  }

  const tags = parts.map(classify);
  const has = (k: 'H' | 'A' | 'D') => tags.includes(k);
  if (has('H') && has('D')) return '1X';
  if (has('A') && has('D')) return 'X2';
  if (has('H') && has('A')) return '12';
  return outcomeName;
}

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

// Display-name override for markets whose stored market_type is misleading
// or sport-specific. Applied in titleFor() before uppercase formatting.
const MARKET_TITLE_OVERRIDE: Record<string, string> = {
  "1X2 - 1T": "VINCENTE 1° SET",
};

// Market types that conceptually have NO line — even if v_player_markets exposes one
// (often 0 from a normalization quirk), it should not appear in the UI title.
const NO_LINE_TITLE_TYPES = new Set<string>([
  "1X2", "1X2 - 1T", "1X2 - 2T",
  "DNB", "DNB - 1T", "DNB - 2T",
  "DC", "DC - 1T", "DC - 2T", "Double Chance",
  "GG/NG", "GG/NG - 1T", "GG/NG - 2T",
  "Both Teams To Score", "Both Teams To Score HT",
  "HT/FT", "1T/Finale",
  "Risultato Esatto", "Correct Score",
  "First Team To Score",
  "P/D", "Pari/Dispari", "Odd/Even",
  "Number of Goals In Match", "Exact Total Goals",
  "To Score 2+ Goals", "To Score 3+ Goals",
  "Marcatore", "Team Goalscorer", "Multi Scorers",
  "Player To Score or Assist", "Player To Assist",
  "Player to be Booked", "Player Cards",
  "Player To Be Fouled",
  // Tennis line-less markets — view sometimes emits stray 0 line, must suppress.
  "T/T Match (Escl. Ritiro)", "T/T 1° Set", "T/T 2° Set",
]);
// Friendly title for a single market section. Includes line when present
// (e.g. "U/O 2.5", "HANDICAP -1.5"), but suppresses it for line-less market types
// where the underlying view sometimes emits a stray 0.
function titleFor(m: DbMarket, sportSlug?: string): string {
  if (sportSlug) {
    const override = resolveTitleOverride(sportSlug, m.market_type);
    if (override) {
      const overrideUC = override.toUpperCase();
      if (m.line == null) return overrideUC;
      if (NO_LINE_TITLE_TYPES.has(m.market_type)) return overrideUC;
      const lineStr = String(m.line);
      return overrideUC + ' ' + lineStr;
    }
  }
  const overridden = MARKET_TITLE_OVERRIDE[m.market_type];
  const base = (overridden ?? m.market_type).toUpperCase();
  if (m.line == null) return base;
  if (NO_LINE_TITLE_TYPES.has(m.market_type)) return base;
  const lineStr = Number.isInteger(m.line) ? String(m.line) : String(m.line);
  return base + ' ' + lineStr;
}

export default function EventDetailPageV2({ event, eventId, onSelectOutcome }: Props) {
  const sportSlug = event.sport?.slug ?? "calcio";
  const tabOrder = TAB_ORDER_BY_SPORT[sportSlug] ?? TAB_ORDER_BY_SPORT.calcio;
  const defaultSubPill = DEFAULT_SUB_PILL_BY_SPORT[sportSlug] ?? DEFAULT_SUB_PILL_BY_SPORT.calcio;
  const tabMarketsCfg = TAB_MARKETS_BY_SPORT[sportSlug] ?? TAB_MARKETS_BY_SPORT.calcio;

  const [activeTab, setActiveTab] = useState<string>(tabOrder[0] ?? "Principali");
  const [activeSubPill, setActiveSubPill] = useState<string>(
    defaultSubPill[tabOrder[0] ?? ""] ?? ""
  );

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setActiveSubPill(defaultSubPill[tab] ?? "");
  };

  const handleSelect = (o: SelectOutcomePayload) => {
    if (onSelectOutcome) onSelectOutcome(o);
    // TODO Task 16: wire to legacy bet slip Zustand store via parent page.
  };

  const tabConfig = tabMarketsCfg[activeTab];
  const hasSubPills = !!tabConfig?.subPills;
  // Hide sub-pills that have zero matching markets for this event (e.g. Combo HT/FT
  // when odds-api doesn't provide HT/FT data — rare globally). Compute the available
  // list once per render so the SubPillBar shows only meaningful tabs.
  const subPillNames = (() => {
    if (!hasSubPills) return [];
    const all = Object.keys(tabConfig!.subPills!);
    const eventMarketTypes = new Set((event.markets ?? []).map((m) => m.market_type));
    return all.filter((name) => {
      const specs = tabConfig!.subPills![name].markets;
      return specs.some((spec) => {
        const { marketType } = parseMarketSpec(spec);
        return eventMarketTypes.has(marketType);
      });
    });
  })();
  // If the currently active sub-pill is no longer in the available list, pick the first
  // available one. (Use useEffect so we don't mutate state during render.)
  useEffect(() => {
    if (hasSubPills && subPillNames.length > 0 && !subPillNames.includes(activeSubPill)) {
      setActiveSubPill(subPillNames[0]);
    }
  }, [activeTab, hasSubPills, subPillNames, activeSubPill]);

  // Compute the set of market_types referenced anywhere in tabMarketsCfg,
  // used both for tab visibility and for the Altri catch-all.
  const allConfiguredMarketTypes = (() => {
    const s = new Set<string>();
    for (const cfg of Object.values(tabMarketsCfg)) {
      const collect = (specs: string[]) => specs.forEach((sp) => s.add(parseMarketSpec(sp).marketType));
      if (cfg.markets) collect(cfg.markets);
      if (cfg.subPills) for (const pill of Object.values(cfg.subPills)) collect(pill.markets);
    }
    return s;
  })();

  // Markets present on this event whose market_type is NOT mapped to any tab.
  const uncategorizedMarkets = (event.markets ?? []).filter(
    (m) => !allConfiguredMarketTypes.has(m.market_type)
  );

  // Hide tabs that have zero matching markets across all their specs / sub-pills.
  // Altri is special: shown only when uncategorizedMarkets is non-empty.
  const availableTabs = (() => {
    const eventMarketTypes = new Set((event.markets ?? []).map((m) => m.market_type));
    return tabOrder.filter((tabName) => {
      if (tabName === "Altri") return uncategorizedMarkets.length > 0;
      const cfg = tabMarketsCfg[tabName];
      if (!cfg) return false;
      const allSpecs: string[] = [];
      if (cfg.markets) allSpecs.push(...cfg.markets);
      if (cfg.subPills) {
        for (const pill of Object.values(cfg.subPills)) allSpecs.push(...pill.markets);
      }
      return allSpecs.some((spec) => {
        const { marketType } = parseMarketSpec(spec);
        return eventMarketTypes.has(marketType);
      });
    });
  })();
  // If the currently active tab is hidden, switch to the first available.
  useEffect(() => {
    if (availableTabs.length > 0 && !availableTabs.includes(activeTab)) {
      setActiveTab(availableTabs[0]);
      setActiveSubPill(defaultSubPill[availableTabs[0]] ?? "");
    }
  }, [availableTabs, activeTab]);

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
      sportSlug,
      activeTab,
      hasSubPills ? activeSubPill : undefined
    );
  }, [event.markets, activeTab, activeSubPill, hasSubPills]);

  function renderSingleMarket(adapted: { _ref: DbMarket }, isPrincipali: boolean) {
    const m = adapted._ref;

    // Special grid: HT/FT
    if (m.market_type === "HT/FT" || m.market_type === "1T/Finale") {
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
        <MarketSection key={`${m.id}@${m.line ?? "_"}`} title="HT/FT — PRIMO TEMPO / FINALE">
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
        <MarketSection key={`${m.id}@${m.line ?? "_"}`} title="RISULTATO ESATTO">
          <ScoreGrid outcomes={map} onSelect={handleSelect} />
        </MarketSection>
      );
    }

    // Special: Double Double (basket) — Yes/No bet, 1 row per player
    if (sportSlug === "basket" && m.market_type === "Double Double") {
      const ynOutcomes = (m.outcomes ?? []).map((o) => ({
        outcomeId: outcomeId(o),
        outcomeIdV2: outcomeIdV2(o),
        name: o.name,
        odds: typeof o.odds === "number" ? o.odds : Number(o.odds),
      }));
      return (
        <MarketSection key={`${m.id}@${m.line ?? "_"}`} title={titleFor(m, sportSlug)}>
          <PlayerYesNoRow outcomes={ynOutcomes} onSelect={handleSelect} />
        </MarketSection>
      );
    }

    // Player markets — flat list. Use real DB market_type names (mig 159 vocabulary).
    const PLAYER_FLAT_TYPES = new Set([
      "Marcatore", "Team Goalscorer", "Multi Scorers",
      "Player To Score or Assist", "Player To Assist",
      "Player to be Booked", "Player Cards",
      "Player To Be Fouled",
      "To Score 2+ Goals", "To Score 3+ Goals",
      "Goalkeeper Saves",
      "Player Shots", "Player Shots on Target",
      "Player Shots on Target Outside Box", "Player Headed Shots on Target",
      "Player Tackles", "Player Fouls", "Player Fouls Committed",
      "Player Passes",
      // legacy invented names (kept for safety in case any extra path still emits them)
      "Marcatore Anytime", "1° Marcatore", "Ultimo Marcatore", "Marca + Assist",
      // basket Milestones (Player tab Punti/Rimbalzi/Triple/Assist)
      "Player Points Milestones", "Player Rebounds Milestones",
      "Player Threes Milestones", "Player Assists Milestones",
      "Player First Basket", "Player First Assist", "Player First Rebound",
      // "Double Double" intentionally NOT in PLAYER_FLAT_TYPES — Yes/No bet, not Over/Under
    ]);
    if (PLAYER_FLAT_TYPES.has(m.market_type)) {
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
        <MarketSection key={`${m.id}@${m.line ?? "_"}`} title={titleFor(m, sportSlug)}>
          <PlayerListFlat players={players} onSelect={handleSelect} />
        </MarketSection>
      );
    }

    // DC family: replace verbose odds-api outcome names with compact 1X/X2/12 codes.
    const isDoubleChance =
      m.market_type === "DC" ||
      m.market_type === "DC - 1T" ||
      m.market_type === "DC - 2T" ||
      m.market_type === "Double Chance";

    // Default: Hero in Principali tab for 1X2, otherwise Compact.
    const rawOutcomes = toOutcomeRowData(m.outcomes);
    const outcomes = (() => {
      if (isDoubleChance) {
        const labeled = rawOutcomes.map((o) => ({
          ...o,
          label: compactDCLabel(o.label, event.home_team ?? "", event.away_team ?? ""),
        }));
        const dcOrder = ["1X", "X2", "12"];
        return labeled.sort((a, b) => {
          const ia = dcOrder.indexOf(a.label);
          const ib = dcOrder.indexOf(b.label);
          return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        });
      }
      // Any 2/3-way market where outcomes are subset of {1, X, 2} → enforce that order.
      // Covers 1X2, DNB, "First Team To Score", "Tempo regolamentare (1X2)", etc.
      const order1x2 = ["1", "X", "2"];
      const is1x2like =
        rawOutcomes.length > 0 && rawOutcomes.length <= 3 &&
        rawOutcomes.every((o) => order1x2.includes(o.label));
      if (is1x2like) {
        return [...rawOutcomes].sort((a, b) => {
          const ia = order1x2.indexOf(a.label);
          const ib = order1x2.indexOf(b.label);
          return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        });
      }
      // Over/Under detection by outcome labels — covers any market_type that emits
      // Over/Under outcomes (Total Shots, Team Shots, Bookings Totals, etc.) without
      // hardcoding the market_type list.
      const overRx = /^(over|più|piu|meno|under)/i;
      const allOverUnder =
        rawOutcomes.length === 2 &&
        rawOutcomes.every((o) => overRx.test((o.label || "").toLowerCase()));
      if (allOverUnder) {
        return [...rawOutcomes].sort((a, b) => {
          const al = (a.label || "").toLowerCase();
          const bl = (b.label || "").toLowerCase();
          const aOver = al.startsWith("over") || al.startsWith("più") || al.startsWith("piu");
          const bOver = bl.startsWith("over") || bl.startsWith("più") || bl.startsWith("piu");
          return (aOver ? 0 : 1) - (bOver ? 0 : 1);
        });
      }
      // Yes/No family (GG/NG, BTTS, To Score variants): always Sì/Yes first
      const isYesNo = /^(GG\/NG|Both Teams To Score|To Score \d)/.test(m.market_type);
      if (isYesNo) {
        return [...rawOutcomes].sort((a, b) => {
          const al = (a.label || "").toLowerCase().trim();
          const bl = (b.label || "").toLowerCase().trim();
          const aYes = al === "si" || al === "sì" || al === "yes";
          const bYes = bl === "si" || bl === "sì" || bl === "yes";
          return (aYes ? 0 : 1) - (bYes ? 0 : 1);
        });
      }
      // EXACT TOTAL GOALS: numeric ordering by leading digit in label ("0 Goals", "7+ Goals")
      if (m.market_type === "Exact Total Goals") {
        const goalsRx = /^(\d+)/;
        return [...rawOutcomes].sort((a, b) => {
          const ma = goalsRx.exec(a.label || "");
          const mb = goalsRx.exec(b.label || "");
          const na = ma ? parseInt(ma[1], 10) : 999;
          const nb = mb ? parseInt(mb[1], 10) : 999;
          return na - nb;
        });
      }
      // NUMBER OF GOALS IN MATCH: Under N → midrange → Over N
      if (m.market_type === "Number of Goals In Match") {
        return [...rawOutcomes].sort((a, b) => {
          const al = (a.label || "").toLowerCase();
          const bl = (b.label || "").toLowerCase();
          const rank = (s: string) => s.startsWith("under") ? 0 : s.startsWith("over") ? 2 : 1;
          return rank(al) - rank(bl);
        });
      }
      // P/D — Pari first, Dispari second (Italian convention: Even/Odd)
      if (m.market_type === "P/D" || m.market_type === "Pari/Dispari" || m.market_type === "Odd/Even") {
        return [...rawOutcomes].sort((a, b) => {
          const al = (a.label || "").toLowerCase().trim();
          const bl = (b.label || "").toLowerCase().trim();
          const aPari = al === "pari" || al === "even";
          const bPari = bl === "pari" || bl === "even";
          return (aPari ? 0 : 1) - (bPari ? 0 : 1);
        });
      }
      // Bucket-range markets (Total Corners {Under 6, 6 - 8, 9 - 11, 12 - 14, Over 14})
      // Sort by lower bound; "Under N" → -∞ (lowest), "Over N" → +∞ (highest).
      const bucketRx = /^\s*(under|over)?\s*(\d+)(?:\s*-\s*(\d+))?/i;
      const allBucket = rawOutcomes.length >= 3 &&
        rawOutcomes.every((o) => bucketRx.test((o.label || "")));
      if (allBucket) {
        const score = (label: string): number => {
          const m2 = bucketRx.exec(label || "");
          if (!m2) return 0;
          const prefix = (m2[1] || "").toLowerCase();
          const lo = parseInt(m2[2] || "0", 10);
          if (prefix === "under") return lo - 1000;
          if (prefix === "over") return lo + 1000;
          return lo;
        };
        return [...rawOutcomes].sort((a, b) => score(a.label) - score(b.label));
      }
      return rawOutcomes;
    })();
    const isHero = isPrincipali && (
      m.market_type === "1X2" ||
      m.market_type === "T/T Match (Escl. Ritiro)" ||
      (sportSlug === "basket" && m.market_type === "T/T")
    );
    const isOverUnderFlat = (m.outcomes ?? []).some((o) => /::(over|under)$/.test(o?.name ?? ""));
    if (isOverUnderFlat) {
      const ouOutcomes = (m.outcomes ?? []).map((o) => ({
        outcomeId: outcomeId(o),
        outcomeIdV2: outcomeIdV2(o),
        name: o.name,
        odds: typeof o.odds === "number" ? o.odds : Number(o.odds),
        line: o.line ?? null,
      }));
      return (
        <MarketSection key={`${m.id}@${m.line ?? "_"}`} title={titleFor(m, sportSlug)}>
          <PlayerOverUnderRow outcomes={ouOutcomes} onSelect={handleSelect} />
        </MarketSection>
      );
    }
    const RowComp = isHero ? HeroOutcomeRow : CompactOutcomeRow;
    return (
      <MarketSection key={`${m.id}@${m.line ?? "_"}`} title={titleFor(m, sportSlug)}>
        <RowComp outcomes={outcomes} onSelect={handleSelect} />
      </MarketSection>
    );
  }

  function renderGroupedMarket(spec: string, variants: DbMarket[]) {
    const { marketType } = parseMarketSpec(spec);

    // BUG B fix: One markets_v2 row can have outcomes spanning many lines (one row per
    // (market_id, outcome.line, outcome.name)). The view also returns duplicate outcome
    // rows under load. Walk all source markets, collect outcomes, dedupe by outcome.id,
    // then group by (market_id, outcome.line). Each group becomes one LineVariant.
    type OutcomeAcc = {
      marketId: string;
      line: number;
      outcome: DbOutcome;
    };
    // Family-specific outcome filter: odds-api occasionally emits inappropriate names
    // (e.g. AH market line=0 with Over/Under outcomes that should be Goal Line). Keep
    // only outcomes whose names match the renderer's expected schema, otherwise the UI
    // ends up with phantom buttons all collapsed to the away team label.
    const isAHFamily = /Handicap|^AH|Spread|Hcap/i.test(marketType);
    const isOverUnderFamily = !isAHFamily;
    const acceptName = (name: string): boolean => {
      const l = (name || "").toLowerCase().trim();
      if (isAHFamily) {
        return l === "1" || l === "2" || l === "home" || l === "away";
      }
      // Over/Under family
      return /^(over|under|più|piu|meno)\b/.test(l);
    };

    const allOutcomes: OutcomeAcc[] = [];
    const seenOutcomeIds = new Set<string>();
    for (const m of variants) {
      for (const o of (m.outcomes ?? [])) {
        if (seenOutcomeIds.has(o.id)) continue;
        seenOutcomeIds.add(o.id);
        if (!acceptName(o.name)) continue;
        const lineVal = (o.line ?? m.line);
        if (lineVal == null) continue;
        allOutcomes.push({ marketId: m.id, line: Number(lineVal), outcome: o });
      }
    }

    // Group by (marketId, line) — each becomes one LineVariant. Within each group,
    // dedupe outcomes by name (keep first) so a line never shows two buttons with the
    // same label even if multiple raw outcomes match.
    const groups = new Map<string, OutcomeAcc[]>();
    for (const oa of allOutcomes) {
      const key = `${oa.marketId}@${oa.line}`;
      const list = groups.get(key) ?? [];
      const nameKey = (oa.outcome.name || "").toLowerCase().trim();
      const already = list.some((x) => (x.outcome.name || "").toLowerCase().trim() === nameKey);
      if (already) continue;
      list.push(oa);
      groups.set(key, list);
    }

    // BUG C fix: Multiple source_market_name (e.g. Totals + Goals Over/Under +
    // Alternative Goal Line) all map to same market_type "U/O" → multiple market_id
    // for same line value. Dedupe by line, keep group with most distinct outcomes
    // (mirrors mig 170 bookmaker pickup pattern).
    const variantByLine = new Map<number, { marketId: string; line: number; outcomes: DbOutcome[] }>();
    for (const list of groups.values()) {
      const line = list[0].line;
      const marketId = list[0].marketId;
      const outs = list.map((oa) => oa.outcome);
      const existing = variantByLine.get(line);
      if (!existing || outs.length > existing.outcomes.length) {
        variantByLine.set(line, { marketId, line, outcomes: outs });
      }
    }

    const lineVariants = [...variantByLine.values()]
      .sort((a, b) => a.line - b.line)
      .map((v) => ({
        line: v.line,
        marketId: v.marketId,
        marketIdV2: v.marketId,
        outcomes: v.outcomes.map((o) => ({
          outcomeId: outcomeId(o),
          outcomeIdV2: outcomeIdV2(o),
          name: o.name,
          odds: typeof o.odds === "number" ? o.odds : Number(o.odds),
          isSuspended: !!o.is_suspended,
          isManualSuspended: !!o.manual_suspended,
          oddsChange: null as "up" | "down" | null,
        })),
      }));

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
      marketType === "Handicap" ||
      marketType === "Handicap - 1T" ||
      marketType === "Alternative Asian Handicap" ||
      marketType === "Hcap Corners" ||
      marketType === "Handicap angoli" ||
      marketType === "Corner Handicap" ||
      marketType === "Card Handicap" ||
      marketType === "Bookings Spread" ||
      marketType === "Corners Race"
    ) {
      return (
        <MarketSection key={spec} title={(sportSlug ? (resolveTitleOverride(sportSlug, marketType)?.toUpperCase() ?? null) : null) ?? marketType.toUpperCase()}>
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
      getDefaultLine(sportSlug, marketType) ?? lineVariants[0].line;
    return (
      <MarketSection key={spec} title={(sportSlug ? (resolveTitleOverride(sportSlug, marketType)?.toUpperCase() ?? null) : null) ?? marketType.toUpperCase()}>
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
        tabs={availableTabs}
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
        {((activeTab !== "Altri" && categorized.markets.length === 0 && categorized.groupedMarkets.size === 0) ||
          (activeTab === "Altri" && uncategorizedMarkets.length === 0)) && (
            <div
              style={{ textAlign: "center", padding: 40, color: "#888" }}
            >
              Nessun mercato disponibile per questa categoria
            </div>
          )}

        {(() => {
          // Altri tab: render every uncategorized market as its own simple section,
          // so any market_type the config doesn't yet handle is still visible.
          if (activeTab === "Altri") {
            return uncategorizedMarkets.map((m) => {
              const adapted = {
                id: m.id,
                market_type: m.market_type,
                line: m.line ?? null,
                outcomes: m.outcomes ?? [],
                _ref: m,
              };
              return renderSingleMarket(
                adapted as unknown as { _ref: DbMarket },
                false
              );
            });
          }
          // Render in config-spec order so sections appear as declared in market-config-v2.
          const cfg = tabMarketsCfg[activeTab];
          let specs: string[] = [];
          if (cfg?.subPills && activeSubPill) {
            specs = cfg.subPills[activeSubPill]?.markets ?? [];
          } else if (cfg?.markets) {
            specs = cfg.markets;
          }
          // consumed is keyed by (market_id @ line) to allow multiple sections from the
          // same market_id when its line differs (used by @flat for player props).
          const consumed = new Set<string>();
          const consumedKey = (a: { id: string; line: number | null }) =>
            `${a.id}@${a.line ?? "_"}`;
          const nodes: React.ReactNode[] = [];
          for (const spec of specs) {
            const { marketType, suffix } = parseMarketSpec(spec);
            if (suffix === "picker" || suffix === "chip") {
              const adaptedVariants = categorized.groupedMarkets.get(spec);
              if (!adaptedVariants || adaptedVariants.length === 0) continue;
              const variants = (adaptedVariants as unknown as { _ref: DbMarket }[]).map(
                (a) => a._ref
              );
              nodes.push(renderGroupedMarket(spec, variants));
            } else if (suffix === "flat") {
              // Emit one section per (market_id, line) variant of this market_type.
              const flatVariants = categorized.markets.filter(
                (a) => a.market_type === marketType && !consumed.has(consumedKey(a))
              );
              for (const m of flatVariants) {
                consumed.add(consumedKey(m));
                nodes.push(
                  renderSingleMarket(m as unknown as { _ref: DbMarket }, false)
                );
              }
            } else {
              const adapted = categorized.markets.find(
                (a) => a.market_type === marketType && !consumed.has(consumedKey(a))
              );
              if (!adapted) continue;
              consumed.add(consumedKey(adapted));
              nodes.push(
                renderSingleMarket(
                  adapted as unknown as { _ref: DbMarket },
                  activeTab === "Principali"
                )
              );
            }
          }
          return nodes;
        })()}
      </div>
    </div>
  );
}
