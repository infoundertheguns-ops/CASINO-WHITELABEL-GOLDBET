/**
 * Persistence writers for the api-football ingester (M1.11).
 *
 * Two narrowly-scoped writers, each flag-gated by an opt-in boolean:
 *
 *   1. `persistTimerAndScore` — updates `events_v2` timer/score columns
 *      (score_home, score_away, minute, period, period_scores). Does NOT
 *      touch `live_data` (separate function) and does NOT touch
 *      `country_fs`/`league_fs` (fs-scraper owned per spec §3.2).
 *
 *   2. `persistStatistics` — merges a `statistics_af` payload into
 *      `events_v2.live_data` via the jsonb `||` operator. Existing
 *      FS-owned keys (incidents, stats, matchMeta, fs_pregame) are
 *      preserved by the merge; only the `statistics_af` sub-key is
 *      replaced wholesale (statistics is a per-cycle snapshot).
 *
 * Both writers are no-ops when `opts.writeEnabled === false`. The flag is
 * read from `system_config.API_FOOTBALL_WRITE_ENABLED` by the caller; this
 * module is pure with respect to env/config to keep it test-friendly.
 *
 * Design notes:
 *   - The `PersistenceDb` interface is deliberately minimal (one
 *     `query(sql, params)` method) so unit tests can swap in a mock. The
 *     scheduler (M1.14) will wire a real `pg.Pool` whose `.query` matches.
 *   - `derivePeriod` is exported so the period-mapping table is testable
 *     in isolation.
 *   - No `Date.now()` or `process.env` reads: timestamps and flags must be
 *     supplied by the caller.
 */
import type { AFFixture } from './types.js';

export interface PersistenceOpts {
  /** Value of the `API_FOOTBALL_WRITE_ENABLED` system_config flag. */
  writeEnabled: boolean;
}

export interface PersistenceDb {
  query<T = unknown>(sql: string, params: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Maps api-football `status.short` to our internal period code.
 *
 * Returns `null` for non-live or unknown statuses; callers SHOULD avoid
 * invoking writers for non-live fixtures, but a null period is safe to
 * skip without nuking an existing value in caller logic.
 */
export function derivePeriod(statusShort: string): string | null {
  switch (statusShort) {
    case '1H':
      return '1T';
    case 'HT':
      return 'HT';
    case '2H':
      return '2T';
    case 'ET':
      return 'ET';
    case 'BT':
      return 'BT';
    case 'P':
      return 'PEN';
    default:
      // FT/AET/PEN (final) and pre-match (NS/TBD/etc.) are NOT live.
      // The scheduler (M1.14) handles final-state transitions; here we
      // signal "no live period" so the writer preserves whatever the
      // upstream FS-scraper already persisted.
      return null;
  }
}

/**
 * Derives `period_scores` from fixture.score halftime + fulltime cumulative.
 * secondHalf = fulltime - halftime (per-half delta, not cumulative).
 * Returns null when halftime is incomplete (still in 1H, no HT split yet).
 */
function derivePeriodScores(fixture: AFFixture): {
  firstHalf: { home: number; away: number };
  secondHalf: { home: number; away: number };
} | null {
  const ht = fixture.score.halftime;
  const ft = fixture.score.fulltime;
  if (ht.home === null || ht.away === null) return null;
  // Fulltime cumulative falls back to current goals if not yet finalised.
  const ftHome = ft.home ?? fixture.goals.home ?? ht.home;
  const ftAway = ft.away ?? fixture.goals.away ?? ht.away;
  return {
    firstHalf: { home: ht.home, away: ht.away },
    secondHalf: { home: ftHome - ht.home, away: ftAway - ht.away },
  };
}

/**
 * Updates `events_v2` timer/score columns for `eventId` from `fixture`.
 *
 * No-op (and returns `{written:false}`) when `opts.writeEnabled === false`.
 * On a write, returns `{written:true}` after the SQL has executed.
 *
 * SQL contract (single statement, positional params, eventId last):
 *
 *   UPDATE events_v2
 *   SET score_home = $1,
 *       score_away = $2,
 *       minute = $3,
 *       period = $4,
 *       period_scores = $5
 *   WHERE id = $6
 *
 * Deliberately does NOT touch `live_data` or `country_fs`/`league_fs`.
 */
export async function persistTimerAndScore(
  db: PersistenceDb,
  eventId: string,
  fixture: AFFixture,
  opts: PersistenceOpts
): Promise<{ written: boolean }> {
  if (!opts.writeEnabled) {
    return { written: false };
  }

  const statusShort = fixture.fixture.status.short;

  const scoreHome = fixture.goals.home ?? 0;
  const scoreAway = fixture.goals.away ?? 0;
  const minute = fixture.fixture.status.elapsed;
  const period = derivePeriod(statusShort);
  const periodScores = derivePeriodScores(fixture);

  const sql = `
    UPDATE events_v2
    SET score_home = $1,
        score_away = $2,
        minute = $3,
        period = $4,
        period_scores = $5
    WHERE id = $6
  `;

  // Serialise period_scores to JSON so any pg driver path (parameterised
  // jsonb cast or text) round-trips identically. node-postgres will JSON
  // -stringify objects automatically, but explicit serialisation makes
  // the on-wire payload deterministic for the test contract.
  const periodScoresParam = periodScores === null ? null : JSON.stringify(periodScores);

  await db.query(sql, [scoreHome, scoreAway, minute, period, periodScoresParam, eventId]);
  return { written: true };
}

/**
 * Merges a `statistics_af` payload into `events_v2.live_data` for `eventId`.
 *
 * No-op (and returns `{written:false}`) when `opts.writeEnabled === false`.
 *
 * SQL contract (jsonb `||` merge, preserves all other top-level keys):
 *
 *   UPDATE events_v2
 *   SET live_data = COALESCE(live_data, '{}'::jsonb)
 *                   || jsonb_build_object('statistics_af', $1::jsonb)
 *   WHERE id = $2
 *
 * The `||` merge replaces only the `statistics_af` key; existing
 * FS-owned keys (`incidents`, `stats`, `matchMeta`, `fs_pregame`) are
 * preserved by construction. Statistics is a full per-cycle snapshot so
 * replacing the whole sub-tree is intentional.
 */
export async function persistStatistics(
  db: PersistenceDb,
  eventId: string,
  statisticsAf: unknown,
  opts: PersistenceOpts
): Promise<{ written: boolean }> {
  if (!opts.writeEnabled) {
    return { written: false };
  }

  const sql = `
    UPDATE events_v2
    SET live_data = COALESCE(live_data, '{}'::jsonb)
                    || jsonb_build_object('statistics_af', $1::jsonb)
    WHERE id = $2
  `;

  // Serialise the payload so pg sends it as a jsonb-castable string
  // regardless of object vs already-stringified input.
  const payloadParam =
    typeof statisticsAf === 'string' ? statisticsAf : JSON.stringify(statisticsAf ?? {});

  await db.query(sql, [payloadParam, eventId]);
  return { written: true };
}
