/**
 * Prematch-window pollers for the api-football ingester (M1.12).
 *
 * Mirrors the shape of `enrichment.ts` pollers: api-client.fetch +
 * persistLiveDataKey, flag-gated, catch-and-return error model.
 *
 * Scheduling-WHEN is owned by the M1.14 scheduler:
 *   - `pollHeadToHead` runs once per fixture in the T-24h..T-0 window
 *   - `pollPredictions` runs once per fixture in the T-2h..T-0 window
 * Both writers are idempotent (jsonb merge under their own sub-key).
 */
import type { ApiFootballClient } from './api-client.js';
import { persistLiveDataKey, type PersistenceDb, type PersistenceOpts } from './persistence.js';
import type { PollerResult } from './enrichment.js';

function countRaw(raw: unknown): number | undefined {
  return Array.isArray(raw) ? raw.length : undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Fetches `/fixtures/headtohead?h2h=A-B` → `live_data.h2h_af`. */
export async function pollHeadToHead(
  client: ApiFootballClient,
  db: PersistenceDb,
  eventId: string,
  homeTeamId: number,
  awayTeamId: number,
  opts: PersistenceOpts
): Promise<PollerResult> {
  try {
    const raw = await client.fetch<unknown>(
      `/fixtures/headtohead?h2h=${homeTeamId}-${awayTeamId}`
    );
    const result = await persistLiveDataKey(db, eventId, 'h2h_af', raw, opts);
    return { ok: true, written: result.written, rawCount: countRaw(raw) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Fetches `/predictions?fixture=X` → `live_data.predictions_af`. */
export async function pollPredictions(
  client: ApiFootballClient,
  db: PersistenceDb,
  eventId: string,
  fixtureId: number,
  opts: PersistenceOpts
): Promise<PollerResult> {
  try {
    const raw = await client.fetch<unknown>(`/predictions?fixture=${fixtureId}`);
    const result = await persistLiveDataKey(db, eventId, 'predictions_af', raw, opts);
    return { ok: true, written: result.written, rawCount: countRaw(raw) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
