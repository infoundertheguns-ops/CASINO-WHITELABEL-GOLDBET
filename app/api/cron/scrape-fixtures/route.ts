import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { fetchFixturesForDate, delay } from "@/lib/betexplorer";
import type { BetExplorerFixture } from "@/lib/betexplorer";

// ═══════════════════════════════════════════════════
// CRON: Scrape BetExplorer Fixtures
// - 14 requests (1 per day, all sports in one page)
// - Upserts into be_fixtures table
// - Deletes past fixtures
// - Runs every 6 hours via crontab
// ═══════════════════════════════════════════════════

const DAYS_AHEAD = 14;
const CHUNK_SIZE = 500;

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-cron-key");
  if (!key || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const stats = {
    fixtures_found: 0,
    upserted: 0,
    deleted: 0,
    errors: [] as string[],
    by_sport: {} as Record<string, number>,
    by_date: {} as Record<string, number>,
  };

  const started = Date.now();

  // ── Delete past fixtures ──
  try {
    const { data: deleted } = await supabase
      .from("be_fixtures")
      .delete()
      .lt("match_date", new Date().toISOString())
      .select("id");
    stats.deleted = deleted?.length || 0;
  } catch (err: any) {
    stats.errors.push(`delete: ${err.message}`);
  }

  // ── Generate dates: today → +13 days ──
  const dates: Date[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }

  // ── Scrape each date (all sports per page) ──
  const allFixtures: BetExplorerFixture[] = [];
  const urlSet = new Set<string>();

  for (const date of dates) {
    const dateStr = date.toISOString().split("T")[0];
    try {
      const fixtures = await fetchFixturesForDate(date);

      // Deduplicate across dates (shouldn't happen but be safe)
      let dateCount = 0;
      for (const f of fixtures) {
        if (!urlSet.has(f.matchUrl)) {
          urlSet.add(f.matchUrl);
          allFixtures.push(f);
          dateCount++;
          stats.by_sport[f.sport] = (stats.by_sport[f.sport] || 0) + 1;
        }
      }

      stats.by_date[dateStr] = dateCount;
      console.log(`[be-fixtures] ${dateStr}: ${dateCount} fixtures`);
      await delay(1500); // 1.5s between page+AJAX pair
    } catch (err: any) {
      stats.errors.push(`${dateStr}: ${err.message}`);
    }
  }

  stats.fixtures_found = allFixtures.length;

  // ── Upsert in chunks ──
  for (let i = 0; i < allFixtures.length; i += CHUNK_SIZE) {
    const chunk = allFixtures.slice(i, i + CHUNK_SIZE);
    const rows = chunk.map((f) => ({
      sport: f.sport,
      country: f.country,
      league: f.league,
      home_team: f.homeTeam,
      away_team: f.awayTeam,
      match_date: f.matchDate.toISOString(),
      match_url: f.matchUrl,
      be_match_id: f.beMatchId,
      odds_1: f.odds1,
      odds_x: f.oddsX,
      odds_2: f.odds2,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from("be_fixtures")
      .upsert(rows, { onConflict: "match_url" });

    if (error) {
      stats.errors.push(`upsert chunk ${i}: ${error.message}`);
    } else {
      stats.upserted += chunk.length;
    }
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log(
    `[be-fixtures] Done in ${elapsed}s — found=${stats.fixtures_found} upserted=${stats.upserted} deleted=${stats.deleted} errors=${stats.errors.length}`
  );

  return NextResponse.json({
    ...stats,
    elapsed_s: parseFloat(elapsed),
  });
}
