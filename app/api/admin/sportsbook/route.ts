export const dynamic = "force-dynamic";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

// Admin data API — uses service_role to bypass RLS
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// --- v2 schema translation helpers -----------------------------------------
// UI uses legacy vocabulary (prematch/ended); events_v2 uses pending/settled.
function v2ToLegacyStatus(s: string | null | undefined): string {
  if (s === "pending") return "prematch";
  if (s === "settled") return "ended";
  return s ?? "";
}
function shapeEvent(e: Record<string, unknown>): Record<string, unknown> {
  return {
    ...e,
    home_team: e.home,
    away_team: e.away,
    is_live: e.status === "live",
    status: v2ToLegacyStatus(e.status as string),
  };
}
function shapeSelections(sels: Record<string, unknown>[] | null | undefined): Record<string, unknown>[] {
  return (sels || []).map((sel) => {
    const ev = sel.event as Record<string, unknown> | null;
    return {
      ...sel,
      event: ev ? { home_team: ev.home, away_team: ev.away } : null,
    };
  });
}

export async function GET(req: NextRequest) {
  const tab = req.nextUrl.searchParams.get("tab") || "bets";
  const supabase = getSupabase();

  if (tab === "bets") {
    const status = req.nextUrl.searchParams.get("status");
    const cutoff = req.nextUrl.searchParams.get("cutoff");

    // Only fetch top-level bets (exclude sistema_combo children)
    let query = supabase
      .from("bets")
      .select(
        `*, bet_selections(id, event_id, odds_at_placement, result, event:events_v2(home, away))`
      )
      .is("parent_bet_id", null)
      .order("created_at", { ascending: false })
      .limit(200);

    if (status && status !== "all") query = query.eq("status", status);
    if (cutoff) query = query.gte("created_at", cutoff);

    const { data: bets, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // For sistema parent bets, fetch child combos with their bet_selections
    const sistemaBetIds = (bets || [])
      .filter((b: Record<string, unknown>) => b.bet_type === "sistema")
      .map((b: Record<string, unknown>) => b.id as string);

    let childrenMap = new Map<string, Record<string, unknown>[]>();
    if (sistemaBetIds.length > 0) {
      const { data: children } = await supabase
        .from("bets")
        .select(`id, parent_bet_id, stake, total_odds, potential_win, status, bet_selections(id, event_id, odds_at_placement, result, event:events_v2(home, away))`)
        .in("parent_bet_id", sistemaBetIds)
        .order("created_at", { ascending: true });

      for (const child of (children || [])) {
        const pid = child.parent_bet_id as string;
        const shaped = { ...child, bet_selections: shapeSelections(child.bet_selections as Record<string, unknown>[] | null) };
        if (!childrenMap.has(pid)) childrenMap.set(pid, []);
        childrenMap.get(pid)!.push(shaped);
      }
    }

    // Fetch usernames
    const userIds = [...new Set((bets || []).filter((b: any) => b.user_id).map((b: Record<string, unknown>) => b.user_id as string))];
    const { data: users } = userIds.length > 0
      ? await supabase.from("users").select("id, username").in("id", userIds)
      : { data: [] };
    const userMap = new Map((users || []).map((u: Record<string, unknown>) => [u.id, u.username]));

    // Fetch kiosk codes for kiosk bets
    const kioskIds = [...new Set((bets || []).filter((b: any) => b.kiosk_id).map((b: Record<string, unknown>) => b.kiosk_id as string))];
    const { data: kiosks } = kioskIds.length > 0
      ? await supabase.from("kiosks").select("id, code").in("id", kioskIds)
      : { data: [] };
    const kioskMap = new Map((kiosks || []).map((k: Record<string, unknown>) => [k.id, k.code]));

    // Open events count
    const { count } = await supabase
      .from("events_v2")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "live"]);

    return NextResponse.json({
      bets: (bets || []).map((b: Record<string, unknown>) => ({
        ...b,
        bet_selections: shapeSelections(b.bet_selections as Record<string, unknown>[] | null),
        username: b.user_id ? (userMap.get(b.user_id as string) || "—") : (b.kiosk_id ? `Kiosk ${kioskMap.get(b.kiosk_id as string) || ""}` : "—"),
        children: childrenMap.get(b.id as string) || undefined,
      })),
      openEventsCount: count || 0,
    });
  }

  if (tab === "events") {
    const { data, error } = await supabase
      .from("events_v2")
      .select(`*`)
      .order("starts_at", { ascending: false })
      .limit(300);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ events: (data || []).map((e: Record<string, unknown>) => shapeEvent(e)) });
  }

  if (tab === "settlement") {
    const statusParam = req.nextUrl.searchParams.get("status") || "all";
    const cutoff = req.nextUrl.searchParams.get("cutoff");
    const search = (req.nextUrl.searchParams.get("search") || "").trim();
    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") || "1", 10));
    const pageSize = Math.min(200, Math.max(10, parseInt(req.nextUrl.searchParams.get("pageSize") || "50", 10)));

    const statusList = statusParam === "all" ? ["won", "lost", "void"] : [statusParam];
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // Resolve search to user_id / kiosk_id lists when needed
    let userIdFilter: string[] | null = null;
    let kioskIdFilter: string[] | null = null;
    if (search) {
      const [{ data: matchedUsers }, { data: matchedKiosks }] = await Promise.all([
        supabase.from("users").select("id").ilike("username", `%${search}%`).limit(500),
        supabase.from("kiosks").select("id").ilike("code", `%${search}%`).limit(500),
      ]);
      userIdFilter = (matchedUsers || []).map((u: Record<string, unknown>) => u.id as string);
      kioskIdFilter = (matchedKiosks || []).map((k: Record<string, unknown>) => k.id as string);
    }

    let query = supabase
      .from("bets")
      .select(`*, bet_selections(event:events_v2(home, away))`, { count: "exact" })
      .in("status", statusList)
      .order("settled_at", { ascending: false, nullsFirst: false })
      .range(from, to);

    if (cutoff) query = query.gte("settled_at", cutoff);

    if (search && userIdFilter !== null && kioskIdFilter !== null) {
      const orParts: string[] = [];
      if (userIdFilter.length) orParts.push(`user_id.in.(${userIdFilter.join(",")})`);
      if (kioskIdFilter.length) orParts.push(`kiosk_id.in.(${kioskIdFilter.join(",")})`);
      // Also allow matching by bet id prefix
      if (/^[0-9a-f-]+$/i.test(search)) orParts.push(`id.eq.${search}`);
      if (orParts.length === 0) {
        // No match for search → return empty
        return NextResponse.json({ settledBets: [], total: 0, page, pageSize });
      }
      query = query.or(orParts.join(","));
    }

    const { data: bets, error, count } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const userIds = [...new Set((bets || []).filter((b: Record<string, unknown>) => b.user_id).map((b: Record<string, unknown>) => b.user_id as string))];
    const { data: users } = userIds.length > 0
      ? await supabase.from("users").select("id, username").in("id", userIds)
      : { data: [] };
    const userMap = new Map((users || []).map((u: Record<string, unknown>) => [u.id, u.username]));

    const kioskIds2 = [...new Set((bets || []).filter((b: Record<string, unknown>) => b.kiosk_id).map((b: Record<string, unknown>) => b.kiosk_id as string))];
    const { data: kiosks2 } = kioskIds2.length > 0
      ? await supabase.from("kiosks").select("id, code").in("id", kioskIds2)
      : { data: [] };
    const kioskMap2 = new Map((kiosks2 || []).map((k: Record<string, unknown>) => [k.id, k.code]));

    return NextResponse.json({
      settledBets: (bets || []).map((b: Record<string, unknown>) => ({
        ...b,
        bet_selections: shapeSelections(b.bet_selections as Record<string, unknown>[] | null),
        username: b.user_id ? (userMap.get(b.user_id as string) || "—") : (b.kiosk_id ? `Kiosk ${kioskMap2.get(b.kiosk_id as string) || ""}` : "—"),
      })),
      total: count || 0,
      page,
      pageSize,
    });
  }

  if (tab === "stats") {
    // Global KPIs computed DB-side — not limited by pagination
    const cutoff = req.nextUrl.searchParams.get("cutoff");
    let base = supabase.from("bets").select("status, stake, potential_win", { count: "exact" }).is("parent_bet_id", null);
    if (cutoff) base = base.gte("created_at", cutoff);
    const { data: rows, error } = await base;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    let staked = 0, payoutsWon = 0, refundsVoid = 0, openBets = 0, liability = 0;
    for (const r of (rows || []) as Record<string, unknown>[]) {
      const stake = Number(r.stake || 0);
      const pw = Number(r.potential_win || 0);
      staked += stake;
      const s = r.status as string;
      if (s === "won") payoutsWon += pw;
      else if (s === "void") refundsVoid += stake;
      else if (s === "open") { openBets += 1; liability += pw; }
    }
    const totalPayouts = payoutsWon + refundsVoid;
    const margin = staked > 0 ? ((staked - totalPayouts) / staked) * 100 : 0;

    const { count: openEventsCount } = await supabase
      .from("events_v2")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "live"]);

    return NextResponse.json({ staked, liability, openBets, margin, openEventsCount: openEventsCount || 0 });
  }

  return NextResponse.json({ error: "Invalid tab" }, { status: 400 });
}
