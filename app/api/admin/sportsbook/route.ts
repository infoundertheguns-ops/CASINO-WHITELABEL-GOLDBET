import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

// Admin data API — uses service_role to bypass RLS
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  const tab = req.nextUrl.searchParams.get("tab") || "bets";
  const supabase = getSupabase();

  if (tab === "bets") {
    const status = req.nextUrl.searchParams.get("status");
    const cutoff = req.nextUrl.searchParams.get("cutoff");

    let query = supabase
      .from("bets")
      .select(
        `*, bet_selections(id, event_id, odds_at_placement, result, event:events(home_team, away_team))`
      )
      .order("created_at", { ascending: false })
      .limit(200);

    if (status && status !== "all") query = query.eq("status", status);
    if (cutoff) query = query.gte("created_at", cutoff);

    const { data: bets, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Fetch usernames
    const userIds = [...new Set((bets || []).map((b: Record<string, unknown>) => b.user_id as string))];
    const { data: users } = userIds.length > 0
      ? await supabase.from("users").select("id, username").in("id", userIds)
      : { data: [] };

    const userMap = new Map((users || []).map((u: Record<string, unknown>) => [u.id, u.username]));

    // Open events count
    const { count } = await supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .in("status", ["prematch", "live"]);

    return NextResponse.json({
      bets: (bets || []).map((b: Record<string, unknown>) => ({
        ...b,
        username: userMap.get(b.user_id as string) || "—",
      })),
      openEventsCount: count || 0,
    });
  }

  if (tab === "events") {
    const { data, error } = await supabase
      .from("events")
      .select(`*, sport:sports(name), league:leagues(name)`)
      .order("starts_at", { ascending: false })
      .limit(300);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ events: data || [] });
  }

  if (tab === "settlement") {
    const { data: bets, error } = await supabase
      .from("bets")
      .select(`*, bet_selections(event:events(home_team, away_team))`)
      .in("status", ["won", "lost", "void"])
      .order("settled_at", { ascending: false })
      .limit(200);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const userIds = [...new Set((bets || []).map((b: Record<string, unknown>) => b.user_id as string))];
    const { data: users } = userIds.length > 0
      ? await supabase.from("users").select("id, username").in("id", userIds)
      : { data: [] };

    const userMap = new Map((users || []).map((u: Record<string, unknown>) => [u.id, u.username]));

    return NextResponse.json({
      settledBets: (bets || []).map((b: Record<string, unknown>) => ({
        ...b,
        username: userMap.get(b.user_id as string) || "—",
      })),
    });
  }

  return NextResponse.json({ error: "Invalid tab" }, { status: 400 });
}
