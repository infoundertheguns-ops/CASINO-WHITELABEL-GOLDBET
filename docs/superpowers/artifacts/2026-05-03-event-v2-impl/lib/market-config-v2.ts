// lib/market-config-v2.ts

export type MarketSpec = string;  // formato "MARKET_TYPE" o "MARKET_TYPE@suffix"

export type SubPillConfig = {
  markets: MarketSpec[];
};

export type TabConfig = {
  markets?: MarketSpec[];
  subPills?: Record<string, SubPillConfig>;
};

export type SportTabConfig = Record<string, TabConfig>;

export const FOOTBALL_TAB_MARKETS_V2: SportTabConfig = {
  "Principali": {
    markets: ["1X2", "DC", "GG/NG", "U/O@2.5", "DNB"],
  },
  "Gol/U/O": {
    markets: [
      "U/O@picker", "U/O - 1T@picker", "U/O - 2T@picker",
      "GG/NG", "GG/NG - 1T", "GG/NG - 2T",
      "Total Home@picker", "Total Away@picker",
    ],
  },
  "Handicap": {
    markets: ["AH@picker", "AH - 1T@picker", "European Hcap@chip"],
  },
  "Tempi": {
    subPills: {
      "1° Tempo": { markets: ["1X2 - 1T", "DC - 1T", "GG/NG - 1T", "U/O - 1T@picker", "DNB - 1T"] },
      "2° Tempo": { markets: ["1X2 - 2T", "DC - 2T", "GG/NG - 2T", "U/O - 2T@picker", "DNB - 2T"] },
      "Combo HT/FT": { markets: ["HT/FT", "Risultato Esatto"] },
    },
  },
  "Player": {
    subPills: {
      "Anytime": { markets: ["Marcatore Anytime"] },
      "1° Marcatore": { markets: ["1° Marcatore"] },
      "Ultimo": { markets: ["Ultimo Marcatore"] },
      "Marca+Assist": { markets: ["Marca + Assist"] },
      "GK Saves": { markets: ["Goalkeeper Saves@picker"] },
      "Shots OU": { markets: ["Player Shots@picker"] },
    },
  },
  "Stats": {
    subPills: {
      "Cards": { markets: ["Total Cards@picker", "Cards 1T@picker", "Cards 2T@picker", "Total Cards Squadra"] },
      "Corners": { markets: ["Total Corners@picker", "Corners 1T@picker", "Corners 2T@picker", "Hcap Corners@chip", "1° Corner"] },
    },
  },
};

export const FOOTBALL_TAB_ORDER = ["Principali", "Gol/U/O", "Handicap", "Tempi", "Player", "Stats"];

export const FOOTBALL_DEFAULT_SUB_PILL: Record<string, string> = {
  "Tempi": "Combo HT/FT",
  "Player": "Anytime",
  "Stats": "Cards",
};

export function parseMarketSpec(spec: MarketSpec): { marketType: string; suffix: string | null } {
  const idx = spec.indexOf("@");
  if (idx === -1) return { marketType: spec, suffix: null };
  return { marketType: spec.substring(0, idx), suffix: spec.substring(idx + 1) };
}
