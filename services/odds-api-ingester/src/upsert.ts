import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { TransformResult } from './types.js';

export type UpsertConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
};

export type UpsertSummary = {
  events_upserted: number;
  markets_upserted: number;
  outcomes_upserted: number;
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

  constructor(cfg: UpsertConfig) {
    this.sb = createClient(cfg.supabaseUrl, cfg.serviceRoleKey, {
      auth: { persistSession: false },
    });
  }

  async upsertBatch(results: TransformResult[]): Promise<UpsertSummary> {
    if (results.length === 0) {
      return { events_upserted: 0, markets_upserted: 0, outcomes_upserted: 0 };
    }

    // 1) events_v2 -> chunked, accumulate id by odds_api_id.
    const eventRows = results.map(r => r.event);
    const idByOddsApiId = new Map<number, string>();
    for (let i = 0; i < eventRows.length; i += CHUNK_EVENTS) {
      const chunk = eventRows.slice(i, i + CHUNK_EVENTS);
      const { data, error } = await this.sb
        .from('events_v2')
        .upsert(chunk, { onConflict: 'odds_api_id' })
        .select('id, odds_api_id');
      if (error) throw new Error(`events_v2 upsert failed: ${error.message}`);
      for (const row of data ?? []) {
        idByOddsApiId.set(row.odds_api_id as number, row.id as string);
      }
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
      events_upserted: eventRows.length,
      markets_upserted: marketRows.length,
      outcomes_upserted: outcomeRows.length,
    };
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
