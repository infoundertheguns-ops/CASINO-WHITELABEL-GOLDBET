#!/usr/bin/env tsx
/**
 * Task 0.5.D — Backfill flashscore stats for historic ended+settled events
 * that have `flashscore_id` set but empty or missing `live_data.stats`.
 *
 * Rate-limited (500ms between fetches), paginated (50/page), idempotent,
 * re-runnable. Supports --sport / --since / --limit / --dry-run flags.
 *
 * Purpose: recover stats for events settled before the Task 0.5.B fix
 * (commit 52b4f4a). Without this, Phase 1 Family A settlers
 * (corners/cards/shots per team) would have ~0% hit rate on recent history.
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/backfill-fs-stats.ts \
 *     dotenv_config_path=.env.local \
 *     [--sport Calcio] \
 *     [--since 2026-04-01T00:00:00Z] \
 *     [--limit 1000] \
 *     [--dry-run]
 */

import { createClient } from "@supabase/supabase-js";
import { fetchMatchDetail, delay } from "@/lib/flashscore";

interface Args {
  sport: string | null;
  since: string;
  limit: number;
  dryRun: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let sport: string | null = null;
  let since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  let limit = 1000;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--sport") {
      sport = args[i + 1] ?? null;
      i++;
    } else if (args[i] === "--since") {
      since = args[i + 1] ?? since;
      i++;
    } else if (args[i] === "--limit") {
      const parsed = parseInt(args[i + 1] ?? "", 10);
      if (!Number.isNaN(parsed) && parsed > 0) limit = parsed;
      i++;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }
  return { sport, since, limit, dryRun };
}

async function main() {
  const { sport, since, limit, dryRun } = parseArgs();

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  console.log(`═══ BACKFILL FS STATS — ${dryRun ? "DRY RUN" : "LIVE"} ═══`);
  console.log(`Sport: ${sport || "ALL"}`);
  console.log(`Since: ${since}`);
  console.log(`Limit: ${limit}\n`);

  const PAGE_SIZE = 50;
  let processed = 0;
  let updated = 0;
  let skippedNoStats = 0;
  let errors = 0;
  let offset = 0;

  while (processed < limit) {
    const batchLimit = Math.min(PAGE_SIZE, limit - processed);

    // Fetch a page of candidates. We select a bit more than batchLimit
    // to survive the client-side filter for already-populated stats; but
    // to keep things simple and predictable we always advance `offset`
    // by the page size we requested.
    let query = supabase
      .from("events")
      .select(
        "id, home_team, away_team, flashscore_id, updated_at, live_data, sport_id, sports!inner(name)"
      )
      .eq("status", "ended")
      .not("flashscore_id", "is", null)
      .not("settled_at", "is", null)
      .gte("updated_at", since)
      .order("updated_at", { ascending: false })
      .range(offset, offset + batchLimit - 1);

    if (sport) query = query.eq("sports.name", sport);

    const { data: events, error } = await query;
    if (error) {
      console.error("Query error:", error);
      process.exit(1);
    }
    if (!events || events.length === 0) {
      console.log(`No more events. Stopping.`);
      break;
    }

    offset += events.length;

    // Client-side filter: only events where live_data.stats is missing
    // or an empty array. PostgREST cannot express jsonb_array_length=0
    // portably, so do it in JS.
    const candidates = events.filter((e) => {
      const stats = (e.live_data as any)?.stats;
      return !Array.isArray(stats) || stats.length === 0;
    });

    if (candidates.length === 0) {
      console.log(
        `Page offset=${offset}: 0/${events.length} candidates (all have stats). Continuing.`
      );
      continue;
    }

    for (const e of candidates) {
      if (processed >= limit) break;
      processed++;
      const sportName = (e.sports as any)?.name || "?";
      const label = `[${sportName}] ${e.home_team} vs ${e.away_team} (fsid=${e.flashscore_id})`;

      try {
        const detail = await fetchMatchDetail(e.flashscore_id!);
        if (!detail || detail.stats.length === 0) {
          skippedNoStats++;
          if (processed % 10 === 0) {
            console.log(`  [${processed}/${limit}] (no stats from FS) ${label}`);
          }
          await delay(500);
          continue;
        }

        if (dryRun) {
          console.log(
            `  [${processed}/${limit}] DRYRUN would update ${detail.stats.length} stats: ${label}`
          );
          updated++;
          await delay(500);
          continue;
        }

        const existingLd = (e.live_data as any) || {};
        const updatedLiveData = { ...existingLd, stats: detail.stats };
        const { error: upErr } = await supabase
          .from("events")
          .update({ live_data: updatedLiveData })
          .eq("id", e.id);

        if (upErr) {
          errors++;
          console.error(
            `  [${processed}/${limit}] UPDATE ERR ${label}: ${upErr.message}`
          );
        } else {
          updated++;
          if (processed % 10 === 0) {
            console.log(
              `  [${processed}/${limit}] updated ${detail.stats.length} stats: ${label}`
            );
          }
        }
        await delay(500);
      } catch (err) {
        errors++;
        console.error(
          `  [${processed}/${limit}] FETCH ERR ${label}: ${err instanceof Error ? err.message : err}`
        );
        await delay(500);
      }
    }

    console.log(
      `── Page offset=${offset}: processed=${processed}, updated=${updated}, skipped=${skippedNoStats}, errors=${errors}`
    );
  }

  console.log(`\n═══ DONE ═══`);
  console.log(`Processed: ${processed}`);
  console.log(`Updated:   ${updated} ${dryRun ? "(dry-run)" : ""}`);
  console.log(`Skipped (FS no stats): ${skippedNoStats}`);
  console.log(`Errors:    ${errors}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
