import type { Market } from "@/lib/hooks/use-sportsbook";

// ═══ MARKET CATEGORY SYSTEM ═══
// Replaces the old 6-group system with Goldbet-style category tabs.

export interface MarketCategory {
  id: string;
  label: string;
}

export interface TournamentColumn {
  header: string;
  marketMatch: string;   // match on market.name (lowercase includes)
  outcomeMatch: string;  // match on outcome.name (lowercase includes)
}

export const MARKET_CATEGORIES: MarketCategory[] = [
  { id: "principali", label: "PRINCIPALI" },
  { id: "1x2", label: "1X2" },
  { id: "uo", label: "U/O" },
  { id: "gol", label: "GOL" },
  { id: "primo_tempo", label: "PRIMO TEMPO" },
  { id: "handicap", label: "HANDICAP" },
  { id: "esatto", label: "RIS. ESATTO" },
  { id: "ht_ft", label: "1T/FINALE" },
  { id: "combo", label: "COMBO" },
  { id: "speciali", label: "SPECIALI" },
  { id: "giocatori", label: "GIOCATORI" },
  { id: "altro", label: "ALTRO" },
];

// ─── Pattern matching: market name → category ID ───

export function getMarketCategoryId(market: Market): string {
  const name = (market.name || "").toLowerCase();
  const type = (market.marketType || "").toLowerCase();

  // Player markets (contain " | " separator, e.g. "Marc Plus | Nikola Stulic")
  if (name.includes(' | ')) return "giocatori";

  // Player markets — Kambi style (market_type as name, player names as outcomes)
  if (/marcatore/i.test(name)) return "giocatori";
  if (/^segna\b/i.test(name)) return "giocatori";
  if (/fornisce.*assist/i.test(name)) return "giocatori";
  if (/\bgiocatore\b/i.test(name)) return "giocatori";
  if (/\bplayer\b/i.test(name)) return "giocatori";
  if (/\brimbalzi\b/i.test(name)) return "giocatori";
  if (/\brebounds?\b/i.test(name)) return "giocatori";
  if (/riceve un cartellino/i.test(name)) return "giocatori";
  if (/prende un cartellino/i.test(name)) return "giocatori";
  if (/first.basket/i.test(name)) return "giocatori";
  if (/\bscorer\b/i.test(name)) return "giocatori";

  // Primo Tempo — must check before generic patterns
  if (name.includes("primo tempo") || name.includes("1° tempo") || name.includes("1 tempo")) return "primo_tempo";
  if (name === "1x2 pt" || name === "u/o pt" || name === "gg/ng pt") return "primo_tempo";
  // Kambi: "2° Tempo" as standalone = 1X2 second half → primo_tempo group
  if (name === "2° tempo") return "primo_tempo";

  // Risultato Esatto
  if (name.includes("risultato esatto") || name.includes("exact score") || type === "exact_score") return "esatto";

  // HT/FT — Kambi: "Primo tempo/Finale"
  if (name.includes("ht/ft") || name.includes("tempo/finale") || type === "ht_ft") return "ht_ft";

  // Combo (multi-condition markets)
  if (name.includes("1x2 +") || name.includes("dc +") || name.includes("1x2 e ") || name.includes("dc e ")) return "combo";
  if (name.includes("marc +") || name.includes("pros marc +") || name.includes("metodo prossimo gol")) return "combo";
  if (name.includes("gg o over") || name.includes("gg e over") || name.includes("gg + over")) return "combo";

  // Handicap — Goldbet + Kambi: "Handicap", "1x2 con Handicap", "Handicap Asiatico", "Testa a Testa Handicap"
  if (name.includes("handicap") || name.includes("1x2 hand") || type === "handicap") return "handicap";

  // Under/Over — Goldbet: "U/O", "Under/Over" | Kambi: "Totale gol", "Totale Asiatico"
  if (name.includes("under/over") || name.startsWith("o/u") || name.startsWith("u/o")) return "uo";
  if (name.startsWith("totale gol") || name.startsWith("totale asiatico")) return "uo";

  // Gol
  if (name.includes("gol/nogol") || name.includes("gol/no gol") || name === "gg/ng" || type === "gg_ng") return "gol";
  if (name.includes("entrambe le squadre a segno") || name.includes("entrambe le squadre segnano")) return "gol";
  if (name.includes("somma gol") || name.includes("prossimo gol") || name.includes("primo gol")) return "gol";
  if (name.startsWith("gol totali") || name.includes("numero totale esatto di gol")) return "gol";
  if (name.includes("gol segnato in entrambi")) return "gol";
  if (name.includes("rete inviolata") || name.includes("vincente a 0") || name.includes("vince senza subire gol") || name.includes("clean sheet")) return "gol";
  // NB: "Segna ..." player markets already caught above in giocatori section

  // Winner markets per tutti sport → "1x2" category
  if (["t/t risultato", "testa a testa", "vincente incontro", "t/t match", "esito finale 1x2"]
      .some(p => name === p || name.startsWith(p))) return "1x2";
  if (name === "vincente incontro (escl. ritiro)") return "1x2";
  if (name === "1x2 tempi reg.") return "1x2";

  // 1X2 family
  if (name === "1x2" || type === "1x2") return "1x2";
  if (name.includes("doppia chance") || type === "double_chance") return "1x2";
  if (name.includes("draw no bet") || type === "draw_no_bet") return "1x2";

  // O/U per basket/volley/tennis/TT
  if (name.startsWith("u/o incl") || name.startsWith("u/o punti") || name.startsWith("u/o games")
      || name.startsWith("under/over punti")) return "uo";

  // Handicap per tutti sport
  if (name.startsWith("t/t handicap")) return "handicap";

  // Speciali
  if (name.includes("angoli") || name.includes("corner") || name.includes("calci d'angolo")) return "speciali";
  if (name.includes("ammonizion") || name.includes("cartellini") || name.includes("cartellino")) return "speciali";
  if (name.includes("pari/dispari") || name.includes("odd/even")) return "speciali";
  if (name.includes("calci di rigore") || name.includes("penalty") || name.includes("rigore assegnato")) return "speciali";
  if (name.includes("tiri totali") || name.includes("tiri in porta")) return "speciali";
  if (name.includes("fuorigioco") || name.includes("falli totali") || name.includes("woodwork")) return "speciali";

  return "altro";
}

// ─── Group markets by category ───

export function groupMarketsByCategory(markets: Market[]): Map<string, Market[]> {
  const map = new Map<string, Market[]>();

  for (const m of markets) {
    if (m.selections.length === 0) continue;
    const catId = getMarketCategoryId(m);
    const arr = map.get(catId) || [];
    arr.push(m);
    map.set(catId, arr);
  }

  return map;
}

// ─── "Principali" is a virtual category: picks key markets from other categories ───

function buildPrincipaliMarkets(markets: Market[]): Market[] {
  const result: Market[] = [];
  const nameL = (m: Market) => (m.name || "").toLowerCase();

  // 1X2
  const m1x2 = markets.find((m) => nameL(m) === "1x2");
  if (m1x2) result.push(m1x2);

  // U/O 2.5
  const muo = markets.find((m) => {
    const n = nameL(m);
    return (n.includes("under/over") || n.startsWith("u/o") || n.startsWith("o/u")) &&
      (n.includes("2.5") || m.line === 2.5);
  });
  if (muo) result.push(muo);

  // GG/NG
  const mgg = markets.find((m) => nameL(m).includes("gol/nogol") || nameL(m) === "gg/ng");
  if (mgg) result.push(mgg);

  // Doppia Chance
  const mdc = markets.find((m) => nameL(m).includes("doppia chance"));
  if (mdc) result.push(mdc);

  // Se nessun mercato calcio trovato, cerca mercato vincente generico (basket, tennis, hockey etc.)
  if (result.length === 0) {
    const winnerNames = ["t/t risultato", "testa a testa", "vincente incontro (escl. ritiro)",
      "vincente incontro", "esito finale 1x2", "t/t match", "1x2 tempi reg."];
    const winner = markets.find(m => winnerNames.includes(nameL(m)));
    if (winner) result.push(winner);
    // Primo O/U generico
    const firstOU = markets.find(m => nameL(m).startsWith("u/o") || nameL(m).startsWith("under/over"));
    if (firstOU) result.push(firstOU);
  }

  return result;
}

// ─── Get categories with counts for an event ───

export function getCategoriesWithCounts(markets: Market[]): { id: string; label: string; count: number }[] {
  const grouped = groupMarketsByCategory(markets);
  const principali = buildPrincipaliMarkets(markets);

  const result: { id: string; label: string; count: number }[] = [];

  // Principali always first if has markets
  if (principali.length > 0) {
    result.push({ id: "principali", label: "PRINCIPALI", count: principali.length });
  }

  for (const cat of MARKET_CATEGORIES) {
    if (cat.id === "principali") continue;
    const count = grouped.get(cat.id)?.length || 0;
    if (count > 0) {
      result.push({ id: cat.id, label: cat.label, count });
    }
  }

  return result;
}

// ─── Get markets for a specific category ───

export function getMarketsForCategory(markets: Market[], categoryId: string): Market[] {
  if (categoryId === "principali") {
    return buildPrincipaliMarkets(markets);
  }
  const grouped = groupMarketsByCategory(markets);
  return grouped.get(categoryId) || [];
}

// ─── Tournament table columns per category ───

const COLUMNS_PRINCIPALI: TournamentColumn[] = [
  { header: "1", marketMatch: "1x2", outcomeMatch: "1" },
  { header: "X", marketMatch: "1x2", outcomeMatch: "x" },
  { header: "2", marketMatch: "1x2", outcomeMatch: "2" },
  { header: "U 2.5", marketMatch: "under/over", outcomeMatch: "under" },
  { header: "O 2.5", marketMatch: "under/over", outcomeMatch: "over" },
  { header: "GG", marketMatch: "gol/nogol", outcomeMatch: "gg" },
  { header: "NG", marketMatch: "gol/nogol", outcomeMatch: "ng" },
];

const COLUMNS_1X2: TournamentColumn[] = [
  { header: "1", marketMatch: "1x2", outcomeMatch: "1" },
  { header: "X", marketMatch: "1x2", outcomeMatch: "x" },
  { header: "2", marketMatch: "1x2", outcomeMatch: "2" },
  { header: "1X", marketMatch: "doppia chance", outcomeMatch: "1x" },
  { header: "12", marketMatch: "doppia chance", outcomeMatch: "12" },
  { header: "X2", marketMatch: "doppia chance", outcomeMatch: "x2" },
];

const COLUMNS_UO: TournamentColumn[] = [
  { header: "U 0.5", marketMatch: "0.5", outcomeMatch: "under" },
  { header: "O 0.5", marketMatch: "0.5", outcomeMatch: "over" },
  { header: "U 1.5", marketMatch: "1.5", outcomeMatch: "under" },
  { header: "O 1.5", marketMatch: "1.5", outcomeMatch: "over" },
  { header: "U 2.5", marketMatch: "2.5", outcomeMatch: "under" },
  { header: "O 2.5", marketMatch: "2.5", outcomeMatch: "over" },
  { header: "U 3.5", marketMatch: "3.5", outcomeMatch: "under" },
  { header: "O 3.5", marketMatch: "3.5", outcomeMatch: "over" },
];

const COLUMNS_GOL: TournamentColumn[] = [
  { header: "GG", marketMatch: "gol/nogol", outcomeMatch: "gg" },
  { header: "NG", marketMatch: "gol/nogol", outcomeMatch: "ng" },
];

const TOURNAMENT_COLUMNS: Record<string, TournamentColumn[]> = {
  principali: COLUMNS_PRINCIPALI,
  "1x2": COLUMNS_1X2,
  uo: COLUMNS_UO,
  gol: COLUMNS_GOL,
};

export function getTournamentColumns(categoryId: string): TournamentColumn[] {
  return TOURNAMENT_COLUMNS[categoryId] || [];
}

// ─── Resolve a column to an odds value for an event ───

export function resolveColumnOdds(
  markets: Market[],
  col: TournamentColumn
): { odds: number; selectionLabel: string; marketName: string; selectionId?: string; suspended?: boolean } | null {
  for (const m of markets) {
    const mName = (m.name || "").toLowerCase();
    if (!mName.includes(col.marketMatch)) continue;

    for (const sel of m.selections) {
      const sName = (sel.label || "").toLowerCase();
      if (sName === col.outcomeMatch || sName.includes(col.outcomeMatch)) {
        return {
          odds: sel.odds,
          selectionLabel: sel.label,
          marketName: m.name,
          selectionId: sel.id,
          suspended: sel.suspended,
        };
      }
    }
  }
  return null;
}
