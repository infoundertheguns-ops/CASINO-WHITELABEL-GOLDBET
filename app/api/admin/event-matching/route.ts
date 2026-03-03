import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  searchFlashscore,
  fetchResults,
  fetchFixtures,
  matchFixtures,
  teamMatchScoreDetailed,
  normalizeTeamName,
  delay,
  SPORT_MAP,
  type FlashscoreFixture,
} from "@/lib/flashscore";
import { setDbAliases } from "@/lib/team-aliases";

// ═══════════════════════════════════════════════════
// Admin Event Matching API
// Actions: search-fs, match, unmatch, auto-match, stats,
//          unmatched-events, debug-matching, save-alias, load-aliases
// ═══════════════════════════════════════════════════

const supabase = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

/** Load DB aliases into the runtime alias resolver */
async function loadAliasesFromDb() {
  const db = supabase();
  const { data } = await db.from("team_aliases").select("canonical, alias");
  if (data && data.length > 0) {
    setDbAliases(data);
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action } = body;

  // Load DB aliases for any matching-related action
  if (["auto-match", "debug-matching", "save-alias"].includes(action)) {
    await loadAliasesFromDb();
  }

  switch (action) {
    case "search-fs":
      return handleSearchFs(body);
    case "match":
      return handleMatch(body);
    case "unmatch":
      return handleUnmatch(body);
    case "auto-match":
      return handleAutoMatch(body);
    case "stats":
      return handleStats();
    case "unmatched-events":
      return handleUnmatchedEvents(body);
    case "debug-matching":
      return handleDebugMatching(body);
    case "save-alias":
      return handleSaveAlias(body);
    case "load-aliases":
      return handleLoadAliases();
    case "delete-alias":
      return handleDeleteAlias(body);
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}

// ═══ SEARCH FLASHSCORE ═══

async function handleSearchFs(body: { query: string }) {
  const { query } = body;
  if (!query || query.length < 2) {
    return NextResponse.json({ error: "Query too short" }, { status: 400 });
  }

  const results = await searchFlashscore(query);
  return NextResponse.json({ results: results.slice(0, 50) });
}

// ═══ MATCH EVENT ↔ FLASHSCORE ═══

async function handleMatch(body: { eventId: string; flashscoreId: string }) {
  const { eventId, flashscoreId } = body;
  if (!eventId || !flashscoreId) {
    return NextResponse.json({ error: "Missing eventId or flashscoreId" }, { status: 400 });
  }

  const db = supabase();
  const { error } = await db
    .from("events")
    .update({ flashscore_id: flashscoreId })
    .eq("id", eventId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// ═══ UNMATCH EVENT ═══

async function handleUnmatch(body: { eventId: string }) {
  const { eventId } = body;
  if (!eventId) {
    return NextResponse.json({ error: "Missing eventId" }, { status: 400 });
  }

  const db = supabase();
  const { error } = await db
    .from("events")
    .update({ flashscore_id: null })
    .eq("id", eventId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// ═══ AUTO-MATCH ═══

async function handleAutoMatch(body: { sport?: string }) {
  const db = supabase();
  const stats = { matched: 0, sports_processed: 0, errors: [] as string[] };

  const sports = body.sport
    ? [body.sport]
    : Object.keys(SPORT_MAP);

  for (const sport of sports) {
    try {
      // Get unmatched prematch/live events
      const { data: events } = await db
        .from("events")
        .select("id, external_id, home_team, away_team, score_home, score_away, starts_at, live_data, flashscore_id, sports!inner(name)")
        .is("flashscore_id", null)
        .in("status", ["prematch", "live"])
        .ilike("sports.name", sport)
        .limit(200);

      if (!events || events.length === 0) continue;

      // Fetch fixtures for today and next 7 days
      const today = new Date();
      const allFixtures: FlashscoreFixture[] = [];
      for (let d = 0; d <= 7; d++) {
        const date = new Date(today.getTime() + d * 24 * 60 * 60 * 1000);
        const fixtures = await fetchFixtures(sport, date);
        allFixtures.push(...fixtures);
        await delay(500);
      }

      if (allFixtures.length === 0) continue;

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

      const matched = matchFixtures(dbEvents, allFixtures);

      for (const m of matched) {
        const { error } = await db
          .from("events")
          .update({ flashscore_id: m.flashscoreId })
          .eq("id", m.eventId);

        if (!error) stats.matched++;
        else stats.errors.push(`${m.eventId}: ${error.message}`);
      }

      stats.sports_processed++;
    } catch (err) {
      stats.errors.push(`${sport}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json(stats);
}

// ═══ STATS ═══

async function handleStats() {
  const db = supabase();

  // Count events by flashscore_id status
  const { count: totalEvents } = await db
    .from("events")
    .select("*", { count: "exact", head: true })
    .in("status", ["prematch", "live", "finished"]);

  const { count: matchedEvents } = await db
    .from("events")
    .select("*", { count: "exact", head: true })
    .not("flashscore_id", "is", null)
    .in("status", ["prematch", "live", "finished"]);

  // Per-sport breakdown
  const { data: sportBreakdown } = await db.rpc("get_event_status_counts");

  // Recent matches (last 50 with flashscore_id)
  const { data: recentMatches } = await db
    .from("events")
    .select("id, home_team, away_team, flashscore_id, status, starts_at, live_data")
    .not("flashscore_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(50);

  return NextResponse.json({
    total: totalEvents || 0,
    matched: matchedEvents || 0,
    unmatched: (totalEvents || 0) - (matchedEvents || 0),
    percentage: totalEvents ? Math.round(((matchedEvents || 0) / totalEvents) * 100) : 0,
    sportBreakdown,
    recentMatches: recentMatches || [],
  });
}

// ═══ UNMATCHED EVENTS ═══

async function handleUnmatchedEvents(body: { sport?: string; status?: string; page?: number }) {
  const db = supabase();
  const page = body.page || 0;
  const pageSize = 50;

  let query = db
    .from("events")
    .select("id, external_id, home_team, away_team, status, starts_at, score_home, score_away, sports!inner(name)", { count: "exact" })
    .is("flashscore_id", null)
    .order("starts_at", { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);

  if (body.sport) {
    query = query.ilike("sports.name", body.sport);
  }
  if (body.status) {
    query = query.eq("status", body.status);
  }

  const { data, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    events: data || [],
    total: count || 0,
    page,
    pageSize,
  });
}

// ═══ DEBUG MATCHING ═══

interface DebugCandidate {
  fsId: string;
  fsHome: string;
  fsAway: string;
  fsTimestamp: number;
  homeScore: number;
  awayScore: number;
  combined: number;
  timeDelta: number;
  failReason: string;
  homeNorm: string;
  awayNorm: string;
  fsHomeNorm: string;
  fsAwayNorm: string;
  homeMethod: string;
  awayMethod: string;
}

async function handleDebugMatching(body: { sport?: string; status?: string; limit?: number }) {
  const db = supabase();
  const limit = Math.min(body.limit || 50, 100);

  // Load DB aliases
  await loadAliasesFromDb();

  // Get unmatched events
  let query = db
    .from("events")
    .select("id, external_id, home_team, away_team, status, starts_at, score_home, score_away, source, sports!inner(name)")
    .is("flashscore_id", null)
    .order("starts_at", { ascending: false })
    .limit(limit);

  if (body.sport) {
    query = query.ilike("sports.name", body.sport);
  }
  if (body.status) {
    query = query.eq("status", body.status);
  }

  const { data: events, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!events || events.length === 0) return NextResponse.json({ results: [], summary: { nearMiss: 0, noCandidates: 0, timeMismatch: 0, aliasNeeded: 0 } });

  // Collect unique sports from the events
  const sportsSet = new Set<string>();
  for (const ev of events) {
    const sportName = (ev.sports as any)?.name;
    if (sportName) sportsSet.add(sportName.toLowerCase());
  }

  // Fetch FS fixtures for each sport (today + next 3 days)
  const fsFixturesBySport: Record<string, FlashscoreFixture[]> = {};
  for (const sport of sportsSet) {
    const fsSport = SPORT_MAP[sport] || sport;
    const allFixtures: FlashscoreFixture[] = [];
    for (let d = 0; d <= 3; d++) {
      const date = new Date(Date.now() + d * 24 * 60 * 60 * 1000);
      try {
        const fixtures = await fetchFixtures(fsSport, date);
        allFixtures.push(...fixtures);
      } catch { /* ignore */ }
      await delay(300);
    }
    fsFixturesBySport[sport] = allFixtures;
  }

  // Analyze each event
  const results: any[] = [];
  let nearMiss = 0, noCandidates = 0, timeMismatch = 0, aliasNeeded = 0;

  for (const ev of events) {
    const sportName = ((ev.sports as any)?.name || "").toLowerCase();
    const fsFixtures = fsFixturesBySport[sportName] || [];

    const candidates: DebugCandidate[] = [];
    let bestCandidate: DebugCandidate | null = null;

    for (const fs of fsFixtures) {
      // Calculate detailed scores
      const homeDetail = teamMatchScoreDetailed(ev.home_team, fs.homeTeam);
      const awayDetail = teamMatchScoreDetailed(ev.away_team, fs.awayTeam);
      const combined = homeDetail.score + awayDetail.score;

      // Time delta
      const dbTime = new Date(ev.starts_at).getTime() / 1000;
      const timeDelta = fs.timestamp ? Math.abs(dbTime - fs.timestamp) : Infinity;

      // Determine fail reason
      let failReason = "ok";
      if (timeDelta > 6 * 3600) {
        failReason = "time_window";
      } else if (homeDetail.score < 0.5 || awayDetail.score < 0.5) {
        failReason = "min_team_score";
      } else if (combined <= 1.2) {
        failReason = "threshold";
      }

      // Only include top candidates (combined > 0.3 to filter total garbage)
      if (combined > 0.3 || timeDelta < 3600) {
        const candidate: DebugCandidate = {
          fsId: fs.matchId,
          fsHome: fs.homeTeam,
          fsAway: fs.awayTeam,
          fsTimestamp: fs.timestamp,
          homeScore: homeDetail.score,
          awayScore: awayDetail.score,
          combined,
          timeDelta,
          failReason,
          homeNorm: homeDetail.normDb,
          awayNorm: homeDetail.normBe, // This is intentionally the FS side for home
          fsHomeNorm: homeDetail.normBe,
          fsAwayNorm: awayDetail.normBe,
          homeMethod: homeDetail.method,
          awayMethod: awayDetail.method,
        };
        // Fix: use proper norm values
        candidate.homeNorm = homeDetail.normDb;
        candidate.awayNorm = awayDetail.normDb;
        candidate.fsHomeNorm = homeDetail.normBe;
        candidate.fsAwayNorm = awayDetail.normBe;

        candidates.push(candidate);
        if (!bestCandidate || combined > bestCandidate.combined) {
          bestCandidate = candidate;
        }
      }
    }

    // Sort by combined score descending, keep top 5
    candidates.sort((a, b) => b.combined - a.combined);
    const topCandidates = candidates.slice(0, 5);

    // Determine suggestion
    let suggestion = "no_data";
    if (candidates.length === 0) {
      suggestion = "no_data";
      noCandidates++;
    } else if (bestCandidate) {
      if (bestCandidate.failReason === "time_window") {
        suggestion = "time_window";
        timeMismatch++;
      } else if (bestCandidate.combined > 1.0 && bestCandidate.combined <= 1.2) {
        suggestion = "lower_threshold";
        nearMiss++;
      } else if (bestCandidate.combined > 0.5 && bestCandidate.combined <= 1.0) {
        suggestion = "add_alias";
        aliasNeeded++;
      } else if (bestCandidate.combined <= 0.5) {
        suggestion = "no_data";
        noCandidates++;
      }
    }

    results.push({
      event: {
        id: ev.id,
        home_team: ev.home_team,
        away_team: ev.away_team,
        sport: sportName,
        starts_at: ev.starts_at,
        source: ev.source,
        status: ev.status,
      },
      candidates: topCandidates,
      bestCandidate,
      suggestion,
    });
  }

  return NextResponse.json({
    results,
    summary: { nearMiss, noCandidates, timeMismatch, aliasNeeded },
  });
}

// ═══ SAVE ALIAS ═══

async function handleSaveAlias(body: { canonical: string; alias: string }) {
  const { canonical, alias } = body;
  if (!canonical || !alias) {
    return NextResponse.json({ error: "Missing canonical or alias" }, { status: 400 });
  }

  const db = supabase();
  const { error } = await db
    .from("team_aliases")
    .upsert({
      canonical: canonical.toLowerCase().trim(),
      alias: alias.toLowerCase().trim(),
    }, { onConflict: "canonical,alias" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Reload aliases
  await loadAliasesFromDb();

  return NextResponse.json({ success: true });
}

// ═══ LOAD ALIASES ═══

async function handleLoadAliases() {
  const db = supabase();
  const { data, error } = await db
    .from("team_aliases")
    .select("id, canonical, alias, created_at")
    .order("canonical", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ aliases: data || [] });
}

// ═══ DELETE ALIAS ═══

async function handleDeleteAlias(body: { id: number }) {
  const { id } = body;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const db = supabase();
  const { error } = await db
    .from("team_aliases")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
