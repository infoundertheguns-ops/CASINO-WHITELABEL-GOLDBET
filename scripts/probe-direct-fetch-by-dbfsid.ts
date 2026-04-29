#!/usr/bin/env tsx
/**
 * Probe: pick real flashscore_id values from prod DB for ended calcio events,
 * and directly fetch their match detail to see if flashscore actually
 * returns stats for those specific matches.
 *
 * This tells us whether the cron is dropping data or flashscore
 * genuinely doesn't serve stats for the leagues we're tracking.
 */

import { createClient } from "@supabase/supabase-js";
import { fetchMatchDetail } from "@/lib/flashscore";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  // Prefer top-tier leagues
  const { data: events } = await supabase
    .from("events")
    .select("id, home_team, away_team, flashscore_id, updated_at, leagues!inner(name), sports!inner(name)")
    .eq("status", "ended")
    .eq("sports.name", "Calcio")
    .not("flashscore_id", "is", null)
    .gte("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(200);

  if (!events || events.length === 0) {
    console.log("No events.");
    return;
  }

  // Split by "looks top tier"
  const TOP_LEAGUES = [
    "Serie A", "Premier League", "La Liga", "Bundesliga", "Ligue 1",
    "Champions League", "Europa League", "Conference League", "Eredivisie",
    "Primeira Liga", "Liga MX", "Major League Soccer",
  ];
  const top = events.filter((e) => {
    const ln = ((e.leagues as any)?.name || "").toLowerCase();
    return TOP_LEAGUES.some((t) => ln.includes(t.toLowerCase()));
  });
  const sample = (top.length > 0 ? top : events).slice(0, 8);

  console.log(`Fetching match detail for ${sample.length} calcio events (top-league bias):\n`);

  for (const e of sample) {
    const league = (e.leagues as any)?.name || "?";
    console.log(`\n── [${league}] ${e.home_team} vs ${e.away_team} (fsid=${e.flashscore_id}) ──`);
    try {
      const detail = await fetchMatchDetail(e.flashscore_id!);
      if (!detail) {
        console.log("  null returned");
        continue;
      }
      console.log(`  status=${detail.status} score=${detail.scoreHome}-${detail.scoreAway} periods=${detail.periods.length} STATS=${detail.stats.length}`);
      if (detail.stats.length > 0) {
        console.log("  first 5 stat names:");
        detail.stats.slice(0, 5).forEach((s) => console.log(`    ${s.name} | H=${s.home} A=${s.away}`));
      }
    } catch (err) {
      console.log(`  ERR: ${err instanceof Error ? err.message : err}`);
    }
    await new Promise((r) => setTimeout(r, 700));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
