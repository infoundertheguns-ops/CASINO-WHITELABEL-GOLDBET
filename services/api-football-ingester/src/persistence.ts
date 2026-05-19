/**
 * Persistence writers for the api-football ingester (M1.11 + M1.12).
 *
 * Three flag-gated writers:
 *
 *   1. `persistTimerAndScore` — updates `events_v2` timer/score columns
 *      (score_home, score_away, minute, period, period_scores). Does NOT
 *      touch `live_data` and does NOT touch `country_fs`/`league_fs`
 *      (fs-scraper owned per spec §3.2).
 *
 *   2. `persistLiveDataKey` (M1.12) — generic merger of a payload under
 *      a given `_af` sub-key of `events_v2.live_data` via the jsonb
 *      `||` operator. Existing FS-owned keys (incidents, stats, matchMeta,
 *      fs_pregame) AND sibling `_af` keys are preserved by the merge;
 *      only the targeted sub-key is replaced wholesale.
 *
 *   3. `persistStatistics` — thin wrapper over `persistLiveDataKey` for
 *      backwards compatibility with M1.11 callers. New code SHOULD call
 *      `persistLiveDataKey` directly with the desired `_af` key.
 *
 * All writers are no-ops when `opts.writeEnabled === false`. The flag is
 * read from `system_config.API_FOOTBALL_WRITE_ENABLED` by the caller;
 * this module is pure with respect to env/config to keep it test-friendly.
 *
 * Design notes:
 *   - The `PersistenceDb` interface is deliberately minimal (one
 *     `query(sql, params)` method) so unit tests can swap in a mock. The
 *     scheduler (M1.14) will wire a real `pg.Pool` whose `.query` matches.
 *   - `derivePeriod` is exported so the period-mapping table is testable
 *     in isolation.
 *   - No `Date.now()` or `process.env` reads: timestamps and flags must
 *     be supplied by the caller.
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
 * Closed set of `live_data` sub-keys owned by the api-football ingester.
 * Keep in sync with spec §3.2 and the M1.12 poller surface.
 */
export type LiveDataAfKey =
  | 'events_af'
  | 'statistics_af'
  | 'lineups_af'
  | 'players_af_ht'
  | 'players_af_ft'
  | 'h2h_af'
  | 'predictions_af';

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
 * Generic merge of `payload` under the given `_af` sub-key of
 * `events_v2.live_data`. Preserves all other sub-keys (FS-owned:
 * incidents/stats/matchMeta/fs_pregame; api-football-owned siblings:
 * any other `_af` keys already present).
 *
 * No-op (and returns `{written:false}`) when `opts.writeEnabled === false`.
 *
 * SQL contract (jsonb `||` merge):
 *
 *   UPDATE events_v2
 *   SET live_data = COALESCE(live_data, '{}'::jsonb)
 *                   || jsonb_build_object('<key>', $1::jsonb)
 *   WHERE id = $2
 *
 * The `<key>` literal is interpolated from the typed `LiveDataAfKey` set
 * (NOT taken from arbitrary user input) so SQL injection is structurally
 * impossible. The payload itself flows as a positional jsonb parameter.
 */
export async function persistLiveDataKey(
  db: PersistenceDb,
  eventId: string,
  key: LiveDataAfKey,
  payload: unknown,
  opts: PersistenceOpts
): Promise<{ written: boolean }> {
  if (!opts.writeEnabled) {
    return { written: false };
  }

  const sql = `
    UPDATE events_v2
    SET live_data = COALESCE(live_data, '{}'::jsonb)
                    || jsonb_build_object('${key}', $1::jsonb)
    WHERE id = $2
  `;

  // Serialise the payload so pg sends it as a jsonb-castable string
  // regardless of object vs already-stringified input.
  const payloadParam = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});

  await db.query(sql, [payloadParam, eventId]);
  return { written: true };
}

/**
 * Backwards-compatible thin wrapper preserved for M1.11 callers.
 * New code SHOULD call `persistLiveDataKey` directly.
 */
export async function persistStatistics(
  db: PersistenceDb,
  eventId: string,
  statisticsAf: unknown,
  opts: PersistenceOpts
): Promise<{ written: boolean }> {
  return persistLiveDataKey(db, eventId, 'statistics_af', statisticsAf, opts);
}
