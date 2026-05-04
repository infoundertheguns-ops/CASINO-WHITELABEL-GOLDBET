// lib/market-categorizer-v2.ts
import {
  TAB_MARKETS_BY_SPORT,
  parseMarketSpec,
  type SportTabConfig,
} from "./market-config-v2";

type MarketLike = {
  id: string;
  market_type: string;
  line: number | null;
  outcomes: unknown[];
};

export type CategorizeResult<M extends MarketLike> = {
  markets: M[];
  groupedMarkets: Map<string, M[]>;
  extras: M[];
};

const SPORT_CONFIGS: Record<string, SportTabConfig> = TAB_MARKETS_BY_SPORT;

function findClosestLine<M extends MarketLike>(markets: M[], targetLine: number): M | null {
  if (markets.length === 0) return null;
  return markets.reduce((closest, m) => {
    if (m.line == null) return closest;
    if (closest.line == null) return m;
    return Math.abs(m.line - targetLine) < Math.abs(closest.line - targetLine) ? m : closest;
  });
}

export function categorizeMarketsV2<M extends MarketLike>(
  markets: M[],
  sportSlug: string,
  activeTab: string,
  activeSubPill?: string
): CategorizeResult<M> {
  const config = SPORT_CONFIGS[sportSlug];
  if (!config) return { markets: [], groupedMarkets: new Map(), extras: markets };

  const tabConfig = config[activeTab];
  if (!tabConfig) return { markets: [], groupedMarkets: new Map(), extras: [] };

  let specs: string[] = [];
  if (tabConfig.subPills && activeSubPill) {
    specs = tabConfig.subPills[activeSubPill]?.markets ?? [];
  } else if (tabConfig.markets) {
    specs = tabConfig.markets;
  }

  const result: CategorizeResult<M> = { markets: [], groupedMarkets: new Map(), extras: [] };
  const consumedIds = new Set<string>();

  for (const spec of specs) {
    const { marketType, suffix } = parseMarketSpec(spec);
    const matching = markets.filter(m => m.market_type === marketType);

    if (matching.length === 0) continue;

    if (suffix === "picker" || suffix === "chip") {
      result.groupedMarkets.set(spec, matching);
      matching.forEach(m => consumedIds.add(m.id));
    } else if (suffix === "flat") {
      // Emit every matching variant as its own single-market section. Used for player
      // props with multiple lines (e.g. Goalkeeper Saves 0.5 / 1.5 / ... — each line
      // is rendered as its own PlayerListFlat section so all players are visible).
      // Sort by line ascending for stable ordering.
      const sorted = [...matching].sort((a, b) => {
        const la = a.line == null ? Number.POSITIVE_INFINITY : a.line;
        const lb = b.line == null ? Number.POSITIVE_INFINITY : b.line;
        return la - lb;
      });
      for (const m of sorted) {
        result.markets.push(m);
        consumedIds.add(m.id);
      }
    } else if (suffix === "over-under-flat") {
      // Player Props with rule-0a labels (post-transformer-fix). Each market has
      // outcomes named "<player>::over" / "<player>::under" per (player, line).
      // Emit each market as its own section (like @flat); rendering at the page
      // layer parses outcome.name to pair Over/Under per player.
      const sorted = [...matching].sort((a, b) => {
        const la = a.line == null ? Number.POSITIVE_INFINITY : a.line;
        const lb = b.line == null ? Number.POSITIVE_INFINITY : b.line;
        return la - lb;
      });
      for (const m of sorted) {
        result.markets.push(m);
        consumedIds.add(m.id);
      }
    } else if (suffix && /^-?\d+(\.\d+)?$/.test(suffix)) {
      const targetLine = parseFloat(suffix);
      const closest = findClosestLine(matching, targetLine);
      if (closest) {
        result.markets.push(closest);
        consumedIds.add(closest.id);
      }
    } else if (suffix === "compact" || suffix === null) {
      const single = matching[0];
      if (single) {
        result.markets.push(single);
        consumedIds.add(single.id);
      }
    }
  }

  result.extras = markets.filter(m => !consumedIds.has(m.id));
  return result;
}
