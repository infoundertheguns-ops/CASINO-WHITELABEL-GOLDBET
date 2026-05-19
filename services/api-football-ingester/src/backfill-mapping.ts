/**
 * One-shot backfill script for `external_id_mapping` (provider='api-football').
 *
 * Standalone CLI — NOT wired into scheduler. Hits api-sports.io
 * `/fixtures?date=YYYY-MM-DD` for N days forward, matches each fixture
 * against `events_v2` (sport_slug='football', status IN ('pending','live'))
 * using the same `resolveMapping` resolver the runtime discovery loop uses,
 * and UPSERTs rows into `external_id_mapping`.
 *
 * Rationale: without this batch, mappings only accumulate organically as
 * fixtures go LIVE inside the Phase A discovery window (±60min around
 * kickoff). Top-tier evening fixtures would therefore lack a mapping at
 * kickoff time, delaying first-poll. This script pre-populates so pollers
 * fire immediately.
 *
 * CLI args:
 *   --days=N        how many days forward to fetch (default 7)
 *   --dry-run       compute matches but don't INSERT
 *   --conf-min=N    minimum confidence to insert (default 0.5)
 *
 * Idempotent: `ON CONFLICT (provider, external_id) DO UPDATE`.
 * API budget: ~N calls (one per day). Pro plan 7500/day, trivial cost.
 */
import { Pool } from 'pg';
import 'dotenv/config';
import { ApiFootballClient } from './api-client.js';
import { resolveMapping } from './mapping.js';
import type { V2EventCandidate } from './mapping.js';
import type { AFFixture } from './types.js';
import { loadConfig } from './config.js';

interface Summary {
  days_processed: number;
  fixtures_fetched: number;
  fixtures_matched: number;
  fixtures_skipped_low_conf: number;
  fixtures_skipped_no_candidates: number;
  fixtures_already_mapped: number;
  inserts: number;
  updates: number;
  api_calls: number;
  rate_limit_remaining_start: number | null;
  rate_limit_remaining_end: number | null;
}

function parseFlag(args: string[], name: string): string | undefined {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit?.split('=')[1];
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const pool = new Pool({ connectionString: cfg.dbUrl });
  const client = new ApiFootballClient({ apiKey: cfg.apiKey });

  const args = process.argv.slice(2);
  const days = parseInt(parseFlag(args, 'days') ?? '7', 10);
  const dryRun = args.includes('--dry-run');
  const confMin = parseFloat(parseFlag(args, 'conf-min') ?? '0.5');

  console.log(
    `[backfill] args: days=${days} dryRun=${dryRun} confMin=${confMin}`,
  );

  const summary: Summary = {
    days_processed: 0,
    fixtures_fetched: 0,
    fixtures_matched: 0,
    fixtures_skipped_low_conf: 0,
    fixtures_skipped_no_candidates: 0,
    fixtures_already_mapped: 0,
    inserts: 0,
    updates: 0,
    api_calls: 0,
    rate_limit_remaining_start: null,
    rate_limit_remaining_end: null,
  };

  const samples: Array<{
    fixtureId: number;
    eventId: string;
    confidence: number;
    verified: boolean;
  }> = [];

  for (let dayOffset = 0; dayOffset < days; dayOffset++) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + dayOffset);
    const dateStr = date.toISOString().slice(0, 10);
    console.log(`[backfill] fetching /fixtures?date=${dateStr}`);

    let response: AFFixture[];
    try {
      response = await client.fetch<AFFixture[]>(`/fixtures?date=${dateStr}`);
    } catch (err) {
      console.warn(`[backfill] fetch failed for ${dateStr}:`, err);
      continue;
    }
    summary.api_calls++;
    summary.days_processed++;
    const rl = client.lastRateLimit();
    if (summary.rate_limit_remaining_start === null && rl?.remaining != null) {
      summary.rate_limit_remaining_start = rl.remaining;
    }
    if (rl?.remaining != null) summary.rate_limit_remaining_end = rl.remaining;

    if (!Array.isArray(response)) {
      console.warn(
        `[backfill] unexpected response shape on ${dateStr}, skipping`,
      );
      continue;
    }

    summary.fixtures_fetched += response.length;
    console.log(
      `[backfill] ${dateStr}: ${response.length} fixtures (rl remaining=${rl?.remaining ?? 'n/a'})`,
    );

    // Pre-fetch v2 candidates once per day window (perf: avoid per-fixture roundtrip).
    // -6h / +30h covers all UTC same-date kickoffs plus slack for late games.
    const winLow = new Date(date.getTime() - 6 * 60 * 60 * 1000).toISOString();
    const winHigh = new Date(
      date.getTime() + 30 * 60 * 60 * 1000,
    ).toISOString();
    const { rows: candidates } = await pool.query<V2EventCandidate>(
      `SELECT id, home, away, league_name, starts_at FROM events_v2
        WHERE sport_slug = 'football'
          AND status IN ('pending', 'live')
          AND starts_at >= $1 AND starts_at <= $2`,
      [winLow, winHigh],
    );
    console.log(
      `[backfill] ${dateStr}: ${candidates.length} v2 candidates in window`,
    );

    for (const fixture of response) {
      const fixtureId = fixture.fixture.id;
      // Skip if already mapped at >= confMin
      const { rows: existing } = await pool.query<{ confidence: number }>(
        `SELECT confidence FROM external_id_mapping WHERE provider='api-football' AND external_id=$1`,
        [String(fixtureId)],
      );
      if (existing.length > 0 && existing[0].confidence >= confMin) {
        summary.fixtures_already_mapped++;
        continue;
      }

      // Tight ±2h window around the fixture kickoff
      const kickoffMs = Date.parse(fixture.fixture.date);
      if (!Number.isFinite(kickoffMs)) continue;
      const winLowMs = kickoffMs - 2 * 60 * 60 * 1000;
      const winHighMs = kickoffMs + 2 * 60 * 60 * 1000;
      const tightCandidates = candidates.filter((c) => {
        const ck = Date.parse(c.starts_at);
        return Number.isFinite(ck) && ck >= winLowMs && ck <= winHighMs;
      });
      if (tightCandidates.length === 0) {
        summary.fixtures_skipped_no_candidates++;
        continue;
      }

      const decision = resolveMapping(fixture, tightCandidates);
      if (decision === null || decision.confidence < confMin) {
        summary.fixtures_skipped_low_conf++;
        continue;
      }

      summary.fixtures_matched++;
      if (!dryRun) {
        const isUpdate = existing.length > 0;
        await pool.query(
          `INSERT INTO external_id_mapping (event_id, provider, external_id, confidence, verified, matched_at)
           VALUES ($1, 'api-football', $2, $3, $4, NOW())
           ON CONFLICT (provider, external_id) DO UPDATE
             SET confidence = EXCLUDED.confidence,
                 verified   = EXCLUDED.verified,
                 matched_at = NOW(),
                 event_id   = EXCLUDED.event_id`,
          [
            decision.event_id,
            String(fixtureId),
            decision.confidence,
            decision.verified,
          ],
        );
        if (isUpdate) summary.updates++;
        else summary.inserts++;
      }

      if (samples.length < 10) {
        samples.push({
          fixtureId,
          eventId: decision.event_id,
          confidence: decision.confidence,
          verified: decision.verified,
        });
      }

      console.log(
        `[backfill] matched ${fixtureId} -> ${decision.event_id} (conf ${decision.confidence.toFixed(2)}${decision.verified ? ' VERIFIED' : ''})`,
      );
    }
  }

  await pool.end();
  console.log('[backfill] DONE');
  console.log(JSON.stringify({ summary, samples }, null, 2));
}

main().catch((err) => {
  console.error('[backfill] fatal:', err);
  process.exit(1);
});
