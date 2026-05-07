export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { matchSofaToCandidate, type SofaFixture, type Candidate } from "./_lib";

interface MatchedRow {
  sofa_event_id: number;
  event_v2_id: string;
  sport_slug: string;
  kickoff_at: string;
  sofa_status: string;
}

export async function POST(req: NextRequest) {
  if (req.headers.get("x-scraper-key") !== process.env.SCRAPER_API_KEY) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.fixtures)) {
    return NextResponse.json({ error: "fixtures must be array" }, { status: 400 });
  }
  const fixtures = body.fixtures as SofaFixture[];

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { fetch: (input, init) => fetch(input, { ...(init as RequestInit), cache: 'no-store' }) } },
  );

  const sixHoursAgoIso = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const { data: rows, error: poolErr } = await supabase
    .from("events_v2")
    .select("id, sport_slug, home, away, starts_at, status, sofascore_id")
    .in("sport_slug", ["calcio", "tennis", "basket"])
    .or(
      `status.in.(prematch,live),and(status.eq.settled,starts_at.gte.${sixHoursAgoIso})`,
    )
    .limit(5000);
  if (poolErr || !rows) {
    return NextResponse.json(
      { error: poolErr?.message ?? "pool fetch failed" },
      { status: 500 },
    );
  }
  const pool = rows as Candidate[];

  const stats = {
    received: fixtures.length,
    matched_direct: 0,
    matched_fuzzy: 0,
    no_time_window: 0,
    no_match_name: 0,
    skipped_unknown_sport: 0,
  };
  const matched: MatchedRow[] = [];
  const persistUpdates: Array<{ id: string; sofascore_id: number }> = [];

  for (const fx of fixtures) {
    const r = matchSofaToCandidate(fx, pool);
    switch (r.kind) {
      case "matched_direct":
        stats.matched_direct++;
        matched.push({
          sofa_event_id: fx.sofa_event_id,
          event_v2_id: r.candidate.id,
          sport_slug: r.candidate.sport_slug,
          kickoff_at: r.candidate.starts_at,
          sofa_status: fx.sofa_status,
        });
        break;
      case "matched_fuzzy":
        stats.matched_fuzzy++;
        persistUpdates.push({ id: r.candidate.id, sofascore_id: fx.sofa_event_id });
        matched.push({
          sofa_event_id: fx.sofa_event_id,
          event_v2_id: r.candidate.id,
          sport_slug: r.candidate.sport_slug,
          kickoff_at: r.candidate.starts_at,
          sofa_status: fx.sofa_status,
        });
        r.candidate.sofascore_id = fx.sofa_event_id;
        break;
      case "no_time_window":
        stats.no_time_window++;
        break;
      case "no_match_name":
        stats.no_match_name++;
        break;
      case "skipped_unknown_sport":
        stats.skipped_unknown_sport++;
        break;
    }
  }

  for (const u of persistUpdates) {
    await supabase.from("events_v2").update({ sofascore_id: u.sofascore_id }).eq("id", u.id);
  }
  await supabase.from("system_config").upsert(
    { key: "last_run_sofascore_fixtures", value: JSON.stringify(new Date().toISOString()) },
    { onConflict: "key" },
  );

  console.log(`[sofascore/fixtures] ${JSON.stringify(stats)}`);
  return NextResponse.json({ ...stats, matched });
}
