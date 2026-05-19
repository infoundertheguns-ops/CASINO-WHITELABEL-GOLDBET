/**
 * Live-window pollers for the api-football ingester (M1.12).
 *
 * Each poller composes:
 *   1. `client.fetch(path)` — unwraps `response` per ApiFootballClient
 *      contract (M1.7); returns the inner array/object verbatim.
 *   2. `persistLiveDataKey(db, eventId, key, payload, opts)` — flag-gated
 *      jsonb merge under the targeted `_af` sub-key.
 *
 * The pollers are PURE wrt scheduling decisions and state mutation:
 *   - They do NOT consult `FixtureState` (the scheduler owns state.set*
 *     after a successful poll).
 *   - They do NOT read system_config flags directly — `opts.writeEnabled`
 *     is injected by the caller.
 *   - They do NOT touch `pruneStale`/cron — caller (M1.14 scheduler)
 *     decides WHEN to call each poller via discovery.ts predicates.
 *
 * Error model: any throw from the api-client (parser error, rate-limit
 * exhaustion, non-2xx surface) is caught and surfaced as
 * `{ ok:false, error }`. The persistence call only runs on the success
 * branch; if the API fails the DB is never touched (no partial writes,
 * no stale-payload risk).
 *
 * Flag-gate split (deliberate): when `writeEnabled=false` the API call
 * STILL fires. This lets us exercise the polling cadence + rate-limit
 * budget during dry-run rollout without persisting payloads. Caller
 * receives `{ok:true, written:false}` so it can still mark state.lastPoll.
 */
import type { ApiFootballClient } from './api-client.js';
import { persistLiveDataKey, type PersistenceDb, type PersistenceOpts } from './persistence.js';

export type PollerResult =
  | { ok: true; written: boolean; rawCount?: number }
  | { ok: false; error: string };

/** Length when payload is an array, otherwise undefined (object-shaped responses). */
function countRaw(raw: unknown): number | undefined {
  return Array.isArray(raw) ? raw.length : undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Fetches `/fixtures/events?fixture=X` and persists to `live_data.events_af`.
 * Caller (scheduler) decides WHEN to call (per discovery.ts shouldFetchEvents).
 */
export async function pollEvents(
  client: ApiFootballClient,
  db: PersistenceDb,
  eventId: string,
  fixtureId: number,
  opts: PersistenceOpts
): Promise<PollerResult> {
  try {
    const raw = await client.fetch<unknown>(`/fixtures/events?fixture=${fixtureId}`);
    const result = await persistLiveDataKey(db, eventId, 'events_af', raw, opts);
    return { ok: true, written: result.written, rawCount: countRaw(raw) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Fetches `/fixtures/statistics?fixture=X` → `live_data.statistics_af`. */
export async function pollStatistics(
  client: ApiFootballClient,
  db: PersistenceDb,
  eventId: string,
  fixtureId: number,
  opts: PersistenceOpts
): Promise<PollerResult> {
  try {
    const raw = await client.fetch<unknown>(`/fixtures/statistics?fixture=${fixtureId}`);
    const result = await persistLiveDataKey(db, eventId, 'statistics_af', raw, opts);
    return { ok: true, written: result.written, rawCount: countRaw(raw) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Fetches `/fixtures/lineups?fixture=X` → `live_data.lineups_af`. */
export async function pollLineups(
  client: ApiFootballClient,
  db: PersistenceDb,
  eventId: string,
  fixtureId: number,
  opts: PersistenceOpts
): Promise<PollerResult> {
  try {
    const raw = await client.fetch<unknown>(`/fixtures/lineups?fixture=${fixtureId}`);
    const result = await persistLiveDataKey(db, eventId, 'lineups_af', raw, opts);
    return { ok: true, written: result.written, rawCount: countRaw(raw) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * Fetches `/fixtures/players?fixture=X` → `live_data.players_af_ht` or
 * `players_af_ft` depending on `half`.
 *
 * The api-football `/fixtures/players` endpoint returns the current
 * cumulative snapshot, so the scheduler is responsible for calling this
 * exactly once at HT and once at FT (per spec §4) — the `half` parameter
 * just routes the same payload to the right archival sub-key.
 *
 * @param half - 'ht' (Half Time snapshot) | 'ft' (Full Time snapshot)
 */
export async function pollPlayers(
  client: ApiFootballClient,
  db: PersistenceDb,
  eventId: string,
  fixtureId: number,
  half: 'ht' | 'ft',
  opts: PersistenceOpts
): Promise<PollerResult> {
  try {
    const raw = await client.fetch<unknown>(`/fixtures/players?fixture=${fixtureId}`);
    const key = half === 'ht' ? 'players_af_ht' : 'players_af_ft';
    const result = await persistLiveDataKey(db, eventId, key, raw, opts);
    return { ok: true, written: result.written, rawCount: countRaw(raw) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
