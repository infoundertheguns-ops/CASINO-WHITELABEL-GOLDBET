#!/usr/bin/env tsx
/**
 * Task 0.3 — Smoke test: verify prod DB persists flashscore stats with
 * Italian section+stat names as expected by the new extractor.
 *
 * Read-only. No writes.
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/smoke-test-stats-ingestion.ts dotenv_config_path=.env.local
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log("═══ TASK 0.3 — STATS INGESTION SMOKE TEST ═══\n");

  // Survey: how many ended calcio events in last 48h, with vs without flashscore_id,
  // with vs without non-empty stats?
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const { count: totalEnded } = await supabase
    .from("events")
    .select("*", { count: "exact", head: true })
    .eq("status", "ended")
    .gte("updated_at", since);

  const { count: withFsId } = await supabase
    .from("events")
    .select("*", { count: "exact", head: true })
    .eq("status", "ended")
    .gte("updated_at", since)
    .not("flashscore_id", "is", null);

  console.log(`Ended events last 48h (all sports): ${totalEnded}`);
  console.log(`  of which with flashscore_id set:  ${withFsId}\n`);

  // Try to find ANY event (any sport, any window, any status) with non-empty stats
  // to confirm whether the verify-results cron has ever run successfully.
  const { data: anyWithStats, error: anyErr } = await supabase
    .from("events")
    .select("id, home_team, away_team, status, updated_at, flashscore_id, live_data, sports!inner(name)")
    .not("live_data->stats", "is", null)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (anyErr) { console.error(anyErr); process.exit(1); }
  const withAnyStats = (anyWithStats || []).filter((e) => {
    const s = (e.live_data as any)?.stats;
    return Array.isArray(s) && s.length > 0;
  });
  console.log(`Events with NON-EMPTY stats (last 500 NOT-NULL): ${withAnyStats.length}/${(anyWithStats||[]).length}`);
  if (withAnyStats.length > 0) {
    console.log("\nMost recent events that DO have populated stats:");
    for (const e of withAnyStats.slice(0, 10)) {
      const s = (e.live_data as any).stats as { name: string }[];
      const sportName = (e.sports as any)?.name || "?";
      console.log(`  [${sportName}] ${e.home_team} vs ${e.away_team} | ${s.length} stats | updated=${e.updated_at.slice(0,16)} | fsid=${e.flashscore_id || "-"}`);
      console.log(`     first 3 names: ${s.slice(0,3).map(x=>x.name).join(" | ")}`);
    }
  } else {
    console.log("⚠️  Across last 500 events with non-NULL stats, NONE has a non-empty stats array.\n");
  }

  // Sample: 15 events with flashscore_id, show stats array length distribution
  const { data: sample, error } = await supabase
    .from("events")
    .select("id, home_team, away_team, updated_at, flashscore_id, live_data, sport_id, sports!inner(name)")
    .eq("status", "ended")
    .eq("sports.name", "Calcio")
    .not("flashscore_id", "is", null)
    .gte("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(25);

  if (error) {
    console.error("Query error:", error);
    process.exit(1);
  }
  if (!sample || sample.length === 0) {
    console.log("⚠️  No flashscore-matched ended calcio events in last 48h.");
    return;
  }

  console.log(`Sample of ${sample.length} flashscore-matched ended calcio events:\n`);

  let nEmpty = 0;
  let nItalian = 0;
  let nWithCorners = 0;

  for (const e of sample) {
    const raw = (e.live_data as any)?.stats;
    const stats = (Array.isArray(raw) ? raw : []) as { name: string; home: any; away: any }[];
    if (stats.length === 0) nEmpty++;
    const hasItalian = stats.some((s) => /^(Partita|1 Tempo|2 Tempo):/i.test(s.name));
    if (hasItalian) nItalian++;
    const hasCorners = stats.some((s) => /Calci d'angolo/i.test(s.name));
    if (hasCorners) nWithCorners++;

    const firstName = stats[0]?.name || "(none)";
    console.log(
      `  fsid=${e.flashscore_id}  ${e.home_team.padEnd(20).slice(0, 20)} vs ${e.away_team.padEnd(20).slice(0, 20)}  stats=${stats.length.toString().padStart(3)}  first="${firstName.slice(0, 45)}"`
    );
  }

  console.log(`\n═══ COVERAGE (of ${sample.length} flashscore-matched ended calcio events) ═══`);
  console.log(`  Non-empty stats:         ${sample.length - nEmpty}/${sample.length}`);
  console.log(`  Italian-name prefix:     ${nItalian}/${sample.length}`);
  console.log(`  Corners present:         ${nWithCorners}/${sample.length}`);

  // Also inspect one event with stats if any, to see what names look like
  const withStats = sample.find((e) => {
    const raw = (e.live_data as any)?.stats;
    return Array.isArray(raw) && raw.length > 0;
  });
  if (withStats) {
    const stats = ((withStats.live_data as any).stats as { name: string }[]).slice(0, 8);
    console.log(`\n═══ SAMPLE STAT NAMES (first event with data: ${withStats.home_team}) ═══`);
    stats.forEach((s) => console.log(`  - ${s.name}`));
  } else {
    console.log(`\n⚠️  NO events in sample have any stats data. verify-results cron may not be running or not persisting.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
