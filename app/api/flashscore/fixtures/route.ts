export const dynamic = "force-dynamic";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getSportSlugsEn } from "@/lib/sport-slug-it-to-en";
import {
  matchFixtures,
} from "@/lib/flashscore";
import type { FlashscoreFixture } from "@/lib/flashscore";

// ═══════════════════════════════════════════════════
// Flashscore Fixtures Endpoint (events_v2 path)
// Receives fixtures from standalone flashscore-scraper.
// 1. Saves all fixtures to be_fixtures for admin Fixtures page.
// 2. Pre-matches with events_v2 prematch rows to save flashscore_id.
// (Plan D S6 cutover: legacy `events` is no longer the prematch source;
// we read+write events_v2 directly.)
// ═══════════════════════════════════════════════════

const CHUNK_SIZE = 500;


// Record last successful run timestamp
async function stampLastRun(sb: any, key: string) {
  await sb.from("system_config").upsert({ key, value: JSON.stringify(new Date().toISOString()) }, { onConflict: "key" });
}

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

  // ── 1b. Update leagues.country from fixture data ──
  const countryPairs = new Map<string, string>();
  for (const f of fixtures) {
    if (f.country && f.league) {
      const key = `${f.sport}||${f.league}`;
      if (!countryPairs.has(key)) countryPairs.set(key, f.country);
    }
  }

  if (countryPairs.size > 0) {
    // Resolve sport slugs → IDs
    const sportSlugs = [...new Set([...countryPairs.keys()].map(k => k.split("||")[0]))];
    const sportIdMap = new Map<string, string>();
    for (const slug of sportSlugs) {
      const { data: row } = await supabase
        .from("sports").select("id").ilike("slug", slug).limit(1).single();
      if (row) sportIdMap.set(slug, row.id);
    }

    for (const [key, country] of countryPairs) {
      const [sportSlug, leagueName] = key.split("||");
      const sportId = sportIdMap.get(sportSlug);
      if (!sportId) continue;
      await supabase
        .from("leagues")
        .update({ country })
        .ilike("name", leagueName)
        .eq("sport_id", sportId)
        .or("country.is.null,country.eq.");
    }
  }

  // ── 2. Pre-match with events_v2 (save flashscore_id) ──
  const slugsEn = getSportSlugsEn(sport);
  if (slugsEn.length === 0) {
    await stampLastRun(supabase, "last_run_flashscore_fixtures");
    return NextResponse.json({ ...stats, reason: "unknown_sport" });
  }

  // FS fixtures feed covers ~next 48h. Constrain to events starting in
  // [-6h, +72h] window so high-volume sports (tennis backlog ~1.7k pending)
  // don't drop the most recent ones to the 1000-row cap, and order by
  // starts_at so partial pages still cover the matchable horizon.
  const fxFromIso = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const fxToIso = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  const { data: events, error: evErr } = await supabase
    .from("events_v2")
    .select(
      "id, odds_api_id, home, away, score_home, score_away, starts_at, live_data, flashscore_id"
    )
    .eq("status", "pending")
    .is("flashscore_id", null)
    .in("sport_slug", slugsEn)
    .gte("starts_at", fxFromIso)
    .lte("starts_at", fxToIso)
    .order("starts_at", { ascending: true })
    .limit(1000);

  if (evErr || !events) {
    return NextResponse.json({
      ...stats,
      error: evErr?.message || "No events found",
    });
  }

  // Count already matched (events_v2 with flashscore_id non-null for this sport)
  const { count: alreadyMatched } = await supabase
    .from("events_v2")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending")
    .not("flashscore_id", "is", null)
    .in("sport_slug", slugsEn);
  stats.already_matched = alreadyMatched || 0;

  if (events.length === 0) {
    await stampLastRun(supabase, "last_run_flashscore_fixtures");
    return NextResponse.json(stats);
  }

  // Adapt events_v2 shape → DbEvent shape used by matchFixtures.
  // events_v2 uses `home`/`away`; matchFixtures expects `home_team`/`away_team`.
  // `external_id` on legacy events was odds-api:NNN; we synthesize it here.
  const dbEvents = events.map((ev) => ({
    id: ev.id,
    external_id: ev.odds_api_id ? `odds-api:${ev.odds_api_id}` : "",
    home_team: ev.home,
    away_team: ev.away,
    score_home: ev.score_home,
    score_away: ev.score_away,
    starts_at: ev.starts_at,
    live_data: ev.live_data as Record<string, unknown> | null,
    sport_name: sport,
    flashscore_id: ev.flashscore_id,
  }));

  const matched = matchFixtures(dbEvents, fixtures);

  // payload-fs 2026-05-11: also persist FS-side country/league + pregame metadata
  // when matching. Lookups by id avoid extra DB roundtrips.
  const fxByMatchId = new Map(fixtures.map((f) => [f.matchId, f]));
  const dbEventById = new Map(dbEvents.map((e) => [e.id, e]));

  for (const m of matched) {
    const fx = fxByMatchId.get(m.flashscoreId);
    const dbEv = dbEventById.get(m.eventId);
    const updateRow: Record<string, unknown> = { flashscore_id: m.flashscoreId };
    if (fx?.country) updateRow.country_fs = fx.country;
    if (fx?.league) updateRow.league_fs = fx.league;
    if (fx?.pregame && dbEv) {
      const existingLd = (dbEv.live_data || {}) as Record<string, unknown>;
      updateRow.live_data = { ...existingLd, fs_pregame: fx.pregame };
    }

    const { error } = await supabase
      .from("events_v2")
      .update(updateRow)
      .eq("id", m.eventId);

    if (!error) {
      stats.matched++;
    } else {
      stats.errors.push(`${m.eventId}: ${error.message}`);
    }
  }

  await stampLastRun(supabase, "last_run_flashscore_fixtures");

  return NextResponse.json({
    ...stats,
    errors: stats.errors.length > 0 ? stats.errors.slice(0, 15) : undefined,
  });
}
