import type {
  ApiEvent,
  EventV2Row,
  MarketV2Row,
  OutcomeV2Row,
  TransformResult,
} from './types.js';

export function transformEvent(api: ApiEvent): TransformResult {
  const event: EventV2Row = {
    odds_api_id: api.id,
    home: api.home,
    away: api.away,
    home_id: api.homeId ?? null,
    away_id: api.awayId ?? null,
    starts_at: api.date,
    sport_slug: api.sport.slug,
    sport_name: api.sport.name,
    league_slug: api.league.slug,
    league_name: api.league.name,
    status: api.status,
    score_home: api.scores?.home ?? null,
    score_away: api.scores?.away ?? null,
    period_scores: api.scores?.periods ?? null,
    urls: api.urls ?? {},
  };

  const markets: MarketV2Row[] = [];
  const outcomes: OutcomeV2Row[] = [];

  if (api.bookmakers) {
    for (const [bookmaker, marketList] of Object.entries(api.bookmakers)) {
      for (const market of marketList) {
        markets.push({
          event_odds_api_id: api.id,
          bookmaker,
          market_name: market.name,
          odds_api_updated_at: market.updatedAt ?? null,
        });
        const market_key = {
          event_odds_api_id: api.id,
          bookmaker,
          market_name: market.name,
        };
        for (const odd of market.odds) {
          outcomes.push(...expandOutcome(market.name, odd as Record<string, unknown>, market_key));
        }
      }
    }
  }

  return { event, markets, outcomes };
}

/**
 * Convert a single odds entry to 1-3 outcome rows.
 *
 * The odds-api.io v3 schema reuses the same field names (home/draw/away/over/under/yes/no/label)
 * for many different market shapes. We detect the shape from the present keys (in priority
 * order) and expand to the canonical (outcome_key, line, odds) tuple.
 *
 * Priority of detection (most specific first):
 *   0a. label + over + under  -> 2 outcomes (<label>::over, <label>::under), line=hdp
 *   1. {over, under} present  -> Totals-style, 2 outcomes (over/under), line=hdp
 *   2. {yes, no}    present   -> BTTS-style, 2 outcomes (yes/no), line=null
 *   3. {home, draw, away}     -> 3-way ML or Eur Handicap, 3 outcomes, line=hdp or null
 *   4. {home, away} (no draw) -> 2-way (DNB or Spread), 2 outcomes, line=hdp or null
 *   5. {draw, away} (no home) -> 2-way handicap variant
 *   6. label + 1 numeric val  -> labeled outcome (Player props, Double Chance, etc), 1 outcome
 *   7. otherwise              -> empty (unknown shape)
 *
 * Note: rule 0a takes precedence over rule 1 when a label is present, to preserve player
 * identity for player-prop markets.
 */
export function expandOutcome(
  marketName: string,
  raw: Record<string, unknown>,
  market_key: OutcomeV2Row['market_key'],
): OutcomeV2Row[] {
  const out: OutcomeV2Row[] = [];
  const hdp = typeof raw.hdp === 'number' ? raw.hdp : null;

  const num = (v: unknown): number | null => {
    if (v == null) return null;
    const n = parseFloat(String(v));
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const home = num(raw.home);
  const draw = num(raw.draw);
  const away = num(raw.away);
  const over = num(raw.over);
  const under = num(raw.under);
  const yes = num(raw.yes);
  const no = num(raw.no);
  const label = typeof raw.label === 'string' ? raw.label : null;

  // 0a. Labeled totals: label + over + under all present → preserve player/label identity.
  // Without this, rule 1 absorbs over+under and DISCARDS the label, losing player
  // identity for markets like Player Props (basketball BetUK).
  if (label != null && label.trim() !== '' && over != null && under != null) {
    out.push({ market_key, outcome_key: `${label}::over`,  line: hdp, odds: over });
    out.push({ market_key, outcome_key: `${label}::under`, line: hdp, odds: under });
    return out;
  }

  // 1. Totals-style: over+under both present (highest priority, most informative)
  if (over != null && under != null) {
    out.push({ market_key, outcome_key: 'over',  line: hdp, odds: over });
    out.push({ market_key, outcome_key: 'under', line: hdp, odds: under });
    return out;
  }

  // 2. BTTS-style: yes+no both present
  if (yes != null && no != null) {
    out.push({ market_key, outcome_key: 'yes', line: null, odds: yes });
    out.push({ market_key, outcome_key: 'no',  line: null, odds: no });
    return out;
  }

  // 3. ML 3-way: home+draw+away (line may be null = pure ML, or hdp = European Handicap)
  if (home != null && draw != null && away != null) {
    out.push({ market_key, outcome_key: 'home', line: hdp, odds: home });
    out.push({ market_key, outcome_key: 'draw', line: hdp, odds: draw });
    out.push({ market_key, outcome_key: 'away', line: hdp, odds: away });
    return out;
  }

  // 4. 2-way home/away: DNB (line null) or Spread/AH (line=hdp)
  if (home != null && away != null && draw == null) {
    out.push({ market_key, outcome_key: 'home', line: hdp, odds: home });
    out.push({ market_key, outcome_key: 'away', line: hdp, odds: away });
    return out;
  }

  // 5. 2-way draw/away: occasional handicap variant where home is off-the-board
  if (draw != null && away != null && home == null) {
    out.push({ market_key, outcome_key: 'draw', line: hdp, odds: draw });
    out.push({ market_key, outcome_key: 'away', line: hdp, odds: away });
    return out;
  }

  // 6. Labeled single outcome: label + exactly one numeric odds field
  // The numeric odds may be in any of {under, over, away, home} depending on market.
  // Resolve in priority order. (rule 1+2 already absorbed the over+under and yes+no
  // multi-key cases, so reaching here means at most one numeric is present.)
  if (label != null) {
    const odds = under ?? over ?? away ?? home;
    if (odds != null) {
      out.push({ market_key, outcome_key: label, line: hdp, odds });
    }
    return out;
  }

  // 7. Even/Odd: {even, odd}
  const even = num(raw.even);
  const odd = num(raw.odd);
  if (even != null && odd != null) {
    out.push({ market_key, outcome_key: 'even', line: null, odds: even });
    out.push({ market_key, outcome_key: 'odd',  line: null, odds: odd });
    return out;
  }

  // 8. Generic field-as-outcome-key fallback. Used by shapes like {12, 1X, X2}
  // (hockey 3-Way Result Double Chance) where each non-hdp key is an outcome
  // label and its value is the parsed odds. Skips reserved meta keys.
  const RESERVED = new Set(['hdp', 'label', 'home', 'draw', 'away', 'over', 'under', 'yes', 'no', 'even', 'odd']);
  const genericPairs: Array<[string, number]> = [];
  for (const [k, v] of Object.entries(raw)) {
    if (RESERVED.has(k)) continue;
    const n = num(v);
    if (n != null) genericPairs.push([k, n]);
  }
  if (genericPairs.length >= 2) {
    for (const [k, v] of genericPairs) {
      out.push({ market_key, outcome_key: k, line: hdp, odds: v });
    }
    return out;
  }

  // 9. Unknown shape — skip silently. Caller can log if it cares.
  return out;
}
