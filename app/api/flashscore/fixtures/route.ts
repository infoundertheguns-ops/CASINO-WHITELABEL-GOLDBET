import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  matchFixtures,
} from "@/lib/flashscore";
import type { FlashscoreFixture } from "@/lib/flashscore";

// ═══════════════════════════════════════════════════
// Flashscore Fixtures Endpoint
// Receives fixtures from standalone flashscore-scraper
// 1. Pre-matches with DB events to save flashscore_id
// 2. Saves all fixtures to be_fixtures for admin view
// ═══════════════════════════════════════════════════

const CHUNK_SIZE = 500;

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-scraper-key");
  if (!key || key !== process.env.SCRAPER_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { fixtures, sport } = body as {
    fixtures: FlashscoreFixture[];
    sport: string;
  };

  if (!fixtures || !Array.isArray(fixtures) || fixtures.length === 0) {
    return NextResponse.json({ error: "No fixtures provided" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const stats = {
    received: fixtures.length,
    matched: 0,
    already_matched: 0,
    saved: 0,
    errors: [] as string[],
  };

  // ── 1. Save all fixtures to be_fixtures for admin Fixtures page ──
  const now = new Date().toISOString();
  for (let i = 0; i < fixtures.length; i += CHUNK_SIZE) {
    const chunk = fixtures.slice(i, i + CHUNK_SIZE);
    const rows = chunk.map((f) => ({
      sport: f.sport,
      country: f.country || null,
      league: f.league || null,
      home_team: f.homeTeam,
      away_team: f.awayTeam,
      match_date: new Date(f.timestamp * 1000).toISOString(),
      match_url: f.matchId, // unique key — flashscore match ID
      be_match_id: f.matchId,
      odds_1: null,
      odds_x: null,
      odds_2: null,
      updated_at: now,
    }));

    const { error } = await supabase
      .from("be_fixtures")
      .upsert(rows, { onConflict: "match_url" });

    if (error) {
      stats.errors.push(`upsert chunk ${i}: ${error.message}`);
    } else {
      stats.saved += chunk.length;
    }
  }

  // ── 2. Pre-match with DB events (save flashscore_id) ──
  const { data: events, error: evErr } = await supabase
    .from("events")
    .select(
      "id, external_id, home_team, away_team, score_home, score_away, starts_at, live_data, flashscore_id, sports!inner(name)"
    )
    .eq("status", "prematch")
    .is("flashscore_id", null)
    .ilike("sports.name", sport || "%")
    .limit(1000);

  if (evErr || !events) {
    return NextResponse.json({
      ...stats,
      error: evErr?.message || "No events found",
    });
  }

  // Count already matched
  const { count: alreadyMatched } = await supabase
    .from("events")
    .select("*", { count: "exact", head: true })
    .eq("status", "prematch")
    .not("flashscore_id", "is", null)
    .ilike("sports.name", sport || "%");
  stats.already_matched = alreadyMatched || 0;

  if (events.length === 0) {
    return NextResponse.json(stats);
  }

  const dbEvents = events.map((ev) => ({
    id: ev.id,
    external_id: ev.external_id,
    home_team: ev.home_team,
    away_team: ev.away_team,
    score_home: ev.score_home,
    score_away: ev.score_away,
    starts_at: ev.starts_at,
    live_data: ev.live_data as Record<string, unknown> | null,
    sport_name: sport,
    flashscore_id: ev.flashscore_id,
  }));

  const matched = matchFixtures(dbEvents, fixtures);

  for (const m of matched) {
    const { error } = await supabase
      .from("events")
      .update({ flashscore_id: m.flashscoreId })
      .eq("id", m.eventId);

    if (!error) {
      stats.matched++;
    } else {
      stats.errors.push(`${m.eventId}: ${error.message}`);
    }
  }

  return NextResponse.json({
    ...stats,
    errors: stats.errors.length > 0 ? stats.errors.slice(0, 15) : undefined,
  });
}
