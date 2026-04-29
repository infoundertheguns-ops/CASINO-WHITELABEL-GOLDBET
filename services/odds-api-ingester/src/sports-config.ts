// Sport routing configuration for odds-api.io ingester.
//
// Sports listed here are pulled from odds-api.io. Sports NOT listed (esports,
// darts, snooker, boxing, minor leagues) remain on the legacy kambi+betfair
// pipeline. Per docs/superpowers/specs/2026-04-28-odds-api-io-migration-design.md
// Section 12 routing matrix.

export type SportConfig = {
  /** odds-api.io sport slug (passed to /events?sport=...) */
  slug: string;
  /** Human-readable display name */
  name: string;
  /**
   * Optional whitelist of league slugs. If empty, ALL leagues for the sport
   * are ingested. Use whitelist to avoid pulling minor leagues with sparse
   * coverage (e.g. Czech Extraliga U21 in ice hockey).
   */
  leagues?: string[];
  /**
   * Polling cadence multiplier. 1 = standard 60s prematch tick.
   * 2 = polled twice as often (for high-volume sports near kickoff).
   * Use sparingly — multiplies API quota consumption.
   */
  cadenceMultiplier?: number;
};

/**
 * Sports ingested from odds-api.io. Order matters: earlier entries are
 * polled first each tick, useful when rate limit is constrained.
 */
export const ENABLED_SPORTS: SportConfig[] = [
  { slug: 'football',           name: 'Football',           cadenceMultiplier: 2 },
  { slug: 'basketball',         name: 'Basketball' },
  { slug: 'tennis',             name: 'Tennis' },
  { slug: 'baseball',           name: 'Baseball' },
  { slug: 'ice-hockey',         name: 'Ice Hockey' },
  { slug: 'american-football',  name: 'American Football' },
  { slug: 'volleyball',         name: 'Volleyball' },
  { slug: 'handball',           name: 'Handball' },
  { slug: 'rugby',              name: 'Rugby' },
  { slug: 'cricket',            name: 'Cricket' },
  { slug: 'esports',            name: 'Esports' },
  { slug: 'darts',              name: 'Darts' },
  { slug: 'mixed-martial-arts', name: 'MMA' },
  { slug: 'boxing',             name: 'Boxing' },
  { slug: 'snooker',            name: 'Snooker' },
];

/**
 * Per-tick caps to keep the rate limit budget sustainable. With 5000 req/h
 * Pro tier and ~12 ticks/h (every 5 min), each tick must consume <420 req.
 * Using /odds/multi (10 events/req), this means ~4200 events per hour
 * total — enough for the imminent (<7d) window across major sports.
 */
export const MAX_EVENTS_PER_SPORT_PER_TICK = parseInt(
  process.env.MAX_EVENTS_PER_SPORT_PER_TICK ?? '100',
  10,
);

/** Only ingest events starting within this window (days from now). */
export const INGEST_WINDOW_DAYS = parseInt(
  process.env.INGEST_WINDOW_DAYS ?? '7',
  10,
);

/**
 * Bookmakers to query for each event. Pro tier max 15. Order is informational
 * only; the API returns whatever it has.
 */
export const ENABLED_BOOKMAKERS = (process.env.POC_BOOKMAKERS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

if (ENABLED_BOOKMAKERS.length === 0) {
  // Fallback default — matches the verified-working selection from POC Day 2.
  ENABLED_BOOKMAKERS.push(
    'Bet365', 'BetWinner', 'BetUK', 'Stoiximan', 'Pamestoixima',
    '18bet', 'paf', 'Stake', 'LeoVegas', 'Unibet',
    'DraftKings', '1xbet', 'Coral', 'Ladbrokes', '888Sport',
  );
}
