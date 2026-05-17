import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { resolveFlashscoreId } from './resolve-flashscore-id.js';
import type { TransformResult } from './types.js';
import { planDedup, type ExistingEventRow } from './dedup-plan.js';

export type UpsertConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
};

export type EventRow = {  id: string;  flashscore_id: string | null;  odds_api_id: number;  sport_slug: string;  starts_at: string;  home: string;  away: string;};
export type UpsertSummary = {
  events_upserted: number;
  markets_upserted: number;
  outcomes_upserted: number;
  eventRows: EventRow[];
};

// Per-table chunk sizes. All three tables are chunked so that no single
// upsert statement holds row-level locks for more than a few seconds —
// this prevents the slow tier (1500 events/sport × ~50 markets/event ×
// ~5 outcomes/market) from blocking the independent derive_legacy_from_v2
// loop, which otherwise saw occasional lock_timeout under heavy load.
//
// Sizes balance HTTP roundtrip overhead vs lock duration. Empirically the
// slow tier was 75-168s as a single batch; chunked it should be 10-30s
// total wall-clock with each individual statement <2s.
const CHUNK_EVENTS = 500;
const CHUNK_MARKETS = 1000;
const CHUNK_OUTCOMES = 1000;

export class Upserter {
  private sb: SupabaseClient;
  private pgPool: Pool | null = null;

  constructor(cfg: UpsertConfig) {
    this.sb = createClient(cfg.supabaseUrl, cfg.serviceRoleKey, {
      auth: { persistSession: false },
    });
  }

  async upsertBatch(results: TransformResult[]): Promise<UpsertSummary> {
    if (results.length === 0) {
      return { events_upserted: 0, markets_upserted: 0, outcomes_upserted: 0, eventRows: [] };
    }

    // 1) events_v2 -> chunked, accumulate id by odds_api_id.
    // Exclude score_home/score_away from upsert: FS scraper is the authoritative
    // source for live score (Opzione B 2026-05-13). OddsAPI api.scores frequently
    // returns null transient, which would race-overwrite FS values via the
    // ON CONFLICT DO UPDATE clause. Omitting the keys keeps existing DB values
    // intact on UPDATE; on INSERT (new row) the column default is NULL anyway.
    const eventInputs = results.map(r => {
      const { score_home: _sh, score_away: _sa, ...rest } = r.event;
      return rest as typeof r.event;
    });

    // Tennis dedup (2026-05-17): OddsAPI emits the same real-world match
    // under 2 different odds_api_id values (legacy 6-digit + v3 8-digit).
    // Without dedup the listing UI shows duplicates. We pre-query existing
    // tennis pending events in the time window and let planDedup map the
    // second emission's odds_api_id to the existing event_id, so its
    // markets/outcomes merge under the existing row instead of creating a
    // second one. Gated to tennis only (other sports <2% dupe rate).
    const tennisInputs = eventInputs.filter(e => e.sport_slug === 'tennis');
    let existingTennis: ExistingEventRow[] = [];
    if (tennisInputs.length > 0) {
      const times = tennisInputs.map(e => new Date(e.starts_at).getTime());
      const minTime = Math.min(...times);
      const maxTime = Math.max(...times);
      const HOUR = 60 * 60 * 1000;
      const lo = new Date(minTime - 36 * HOUR).toISOString();
      const hi = new Date(maxTime + 36 * HOUR).toISOString();
      const { data, error } = await this.sb
        .from('events_v2')
        .select('id, odds_api_id, sport_slug, home, away, starts_at')
        .eq('sport_slug', 'tennis')
        .eq('status', 'pending')
        .gte('starts_at', lo)
        .lte('starts_at', hi);
      if (error) throw new Error(`tennis dedup lookup failed: ${error.message}`);
      existingTennis = (data ?? []) as ExistingEventRow[];
    }

    const plan = planDedup(eventInputs, existingTennis);
    const inputsToUpsert = plan.toUpsert;

    const eventRowsOut: EventRow[] = [];
    const idByOddsApiId = new Map<number, string>();
    for (let i = 0; i < inputsToUpsert.length; i += CHUNK_EVENTS) {
      const chunk = inputsToUpsert.slice(i, i + CHUNK_EVENTS);
      const { data, error } = await this.sb
        .from('events_v2')
        .upsert(chunk, { onConflict: 'odds_api_id' })
        .select('id, flashscore_id, odds_api_id, sport_slug, starts_at, home, away');
      if (error) throw new Error(`events_v2 upsert failed: ${error.message}`);
      for (const row of data ?? []) {
        idByOddsApiId.set(row.odds_api_id as number, row.id as string);
        eventRowsOut.push({ id: row.id as string, flashscore_id: (row.flashscore_id as string | null) ?? null, odds_api_id: row.odds_api_id as number, sport_slug: row.sport_slug as string, starts_at: row.starts_at as string, home: row.home as string, away: row.away as string });
      }
    }

    // Fold dedup-mapped odds_api_id into idByOddsApiId so the markets/outcomes
    // steps below route them to the correct existing event_id.
    for (const [oai, eid] of plan.knownReuseMap) {
      idByOddsApiId.set(oai, eid);
    }
    for (const [oai, canonicalOai] of plan.pendingReuseMap) {
      const eid = idByOddsApiId.get(canonicalOai);
      if (eid) idByOddsApiId.set(oai, eid);
    }

    // 2) markets_v2 -> chunked, accumulate id by composite key.
    const marketRows = results.flatMap(r =>
      r.markets
        .map(m => ({
          event_id: idByOddsApiId.get(m.event_odds_api_id),
          bookmaker: m.bookmaker,
          market_name: m.market_name,
          odds_api_updated_at: m.odds_api_updated_at,
        }))
        .filter((m): m is { event_id: string; bookmaker: string; market_name: string; odds_api_updated_at: string | null } =>
          m.event_id != null,
        ),
    );
    const marketIdByKey = new Map<string, string>();
    for (let i = 0; i < marketRows.length; i += CHUNK_MARKETS) {
      const chunk = marketRows.slice(i, i + CHUNK_MARKETS);
      const { data, error } = await this.sb
        .from('markets_v2')
        .upsert(chunk, { onConflict: 'event_id,bookmaker,market_name' })
        .select('id, event_id, bookmaker, market_name');
      if (error) throw new Error(`markets_v2 upsert failed: ${error.message}`);
      for (const row of data ?? []) {
        const key = `${row.event_id}|${row.bookmaker}|${row.market_name}`;
        marketIdByKey.set(key, row.id as string);
      }
    }

    // 3) outcomes_v2 -> resolve market_id, dedup, chunk.
    const outcomeRows = results.flatMap(r =>
      r.outcomes
        .map(o => {
          const eventId = idByOddsApiId.get(o.market_key.event_odds_api_id);
          if (eventId == null) return null;
          const key = `${eventId}|${o.market_key.bookmaker}|${o.market_key.market_name}`;
          const marketId = marketIdByKey.get(key);
          if (marketId == null) return null;
          return {
            market_id: marketId,
            outcome_key: o.outcome_key,
            line: o.line,
            odds: o.odds,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x != null),
    );

    if (outcomeRows.length > 0) {
      // Dedup within the batch: same (market_id, outcome_key, line) can appear
      // multiple times when the API returns multiple odds entries with the
      // same hdp (e.g. Totals with two over-2.5 lines from a glitch). Postgres
      // ON CONFLICT cannot resolve same-row duplicates within a single
      // statement — last write wins via Map.
      const dedup = new Map<string, typeof outcomeRows[0]>();
      for (const row of outcomeRows) {
        const lineKey = row.line == null ? '__null' : String(row.line);
        const key = `${row.market_id}|${row.outcome_key}|${lineKey}`;
        dedup.set(key, row);
      }
      const dedupedRows = Array.from(dedup.values());

      for (let i = 0; i < dedupedRows.length; i += CHUNK_OUTCOMES) {
        const chunk = dedupedRows.slice(i, i + CHUNK_OUTCOMES);
        const { error } = await this.sb
          .from('outcomes_v2')
          .upsert(chunk, { onConflict: 'market_id,outcome_key,line_norm' });
        if (error) throw new Error(`outcomes_v2 upsert failed: ${error.message}`);
      }
    }

    return {
      events_upserted: inputsToUpsert.length,
      markets_upserted: marketRows.length,
      outcomes_upserted: outcomeRows.length,
      eventRows: eventRowsOut,
    };
  }

  private getPgPool(): Pool {
    if (this.pgPool) return this.pgPool;
    if (process.env.DATABASE_URL) {
      this.pgPool = new Pool({ max: 4, connectionString: process.env.DATABASE_URL });
      return this.pgPool;
    }
    throw new Error('database connection env var missing');
  }

  /**
   * Plan D #4 - FS-id population hook.
   */
  async maybeResolveFsId(row: EventRow): Promise<void> {
    if (row.flashscore_id) return;
    const log = {
      info: (obj: any, msg: string) => console.log(msg),
      warn: (obj: any, msg: string) => console.warn(msg),
    };
    try {
      const pool = this.getPgPool();
      const dbAdapter = {
        queryOne: async <T = any>(sql: string, params: any[]): Promise<T | null> => {
          const r = await pool.query(sql, params);
          return ((r.rows[0] as T) ?? null);
        },
      };
      const matchId = await resolveFlashscoreId(
        {
          odds_api_id: row.odds_api_id,
          sport_slug: row.sport_slug,
          starts_at: new Date(row.starts_at),
          home: row.home,
          away: row.away,
        },
        {
          db: dbAdapter,
          searchUrl: process.env.FS_SEARCH_URL!,
          apiKey: process.env.FS_SEARCH_API_KEY!,
          log,
        }
      );
      if (matchId !== null) {
        await this.persistFsId(row.id, matchId);
      }
    } catch (err) {
      log.warn({ id: row.id, err: String(err) }, '[fs-id] hook failure (ignored)');
    }
  }

  private async persistFsId(eventId: string, fsId: string): Promise<void> {
    const payload = { flashscore_id: fsId, updated_at: new Date().toISOString() };
    await this.sb.from('events_v2').update(payload).eq('id', eventId).is('flashscore_id', null);
  }

  /**
   * Trigger the derive_legacy_from_v2() RPC, which copies events_v2 / markets_v2 /
   * outcomes_v2 data into the legacy events / markets / outcomes tables so the
   * existing player frontend (which queries legacy) sees the new data.
   */
  async callDeriveLegacy(): Promise<{ data: any; error: { message: string } | null }> {
    const { data, error } = await this.sb.rpc('derive_legacy_from_v2');
    return { data, error: error ? { message: error.message } : null };
  }

  /**
   * Trigger mark_stale_lives_settled(): flips events_v2.status='live' rows
   * whose starts_at is older than the threshold (default 6h) to 'settled',
   * and propagates to legacy events.is_live=false. Cleans up ghost-live
   * entries when odds-api stops returning a finished event.
   */
  async callMarkStaleLives(maxLiveHours = 6): Promise<{ data: any; error: { message: string } | null }> {
    const { data, error } = await this.sb.rpc('mark_stale_lives_settled', {
      p_max_live_hours: maxLiveHours,
    });
    return { data, error: error ? { message: error.message } : null };
  }
}
