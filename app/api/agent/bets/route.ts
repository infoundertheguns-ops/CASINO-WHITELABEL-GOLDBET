export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  detectAgent,
  getScopedPlayerIds,
  getDescendantAgentIds,
  hasPermission,
} from "@/lib/agent-permissions";

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  // Auth
  const userSupabase = await createServerClient();
  const {
    data: { user: authUser },
  } = await userSupabase.auth.getUser();
  if (!authUser)
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const supabase = getAdminSupabase();

  // Determine if super admin or agent
  const { data: adminRecord } = await supabase
    .from("admin_users")
    .select("id")
    .eq("user_id", authUser.id)
    .maybeSingle();

  const isSuperAdmin = !!adminRecord;
  let agent = null;

  if (!isSuperAdmin) {
    agent = await detectAgent(supabase, authUser.id);
    if (!agent)
      return NextResponse.json(
        { error: "Accesso negato" },
        { status: 403 }
      );

    if (!hasPermission(agent.permissions, "bets", "viewer")) {
      return NextResponse.json(
        { error: "Non hai permesso di visualizzare le scommesse" },
        { status: 403 }
      );
    }
  }

  // Parse query params
  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status") || null; // open/won/lost/void
  const period = searchParams.get("period") || null; // today/7d/30d
  const player_id = searchParams.get("player_id") || null;
  const sport = searchParams.get("sport") || null;
  const agent_id_param = searchParams.get("agent_id") || null;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(
    200,
    Math.max(1, parseInt(searchParams.get("limit") || "50", 10))
  );
  const offset = (page - 1) * limit;

  // Resolve scoped player IDs + kiosk IDs
  let scopedPlayerIds: string[] | null = null; // null = no restriction (super admin)
  let scopedKioskIds: string[] = [];

  if (!isSuperAdmin && agent) {
    // If agent_id filter is requested, verify it belongs to requester's network
    if (agent_id_param) {
      const descendantIds = await getDescendantAgentIds(supabase, agent.id);
      if (!descendantIds.includes(agent_id_param)) {
        return NextResponse.json(
          { error: "Agente non nel tuo network" },
          { status: 403 }
        );
      }
      // Scope to that specific agent's players
      const { data: agentPlayers } = await supabase
        .from("users")
        .select("id")
        .eq("agent_id", agent_id_param);
      scopedPlayerIds = (agentPlayers || []).map((u: any) => u.id);
      // Scope to that specific agent's kiosks
      const { data: agentKiosks } = await supabase
        .from("kiosks")
        .select("id")
        .eq("agent_id", agent_id_param);
      scopedKioskIds = (agentKiosks || []).map((k: any) => k.id);
    } else {
      scopedPlayerIds = await getScopedPlayerIds(supabase, agent.id);
      // Get kiosks for agent and descendants
      const descendantIds = await getDescendantAgentIds(supabase, agent.id);
      const { data: kiosks } = await supabase
        .from("kiosks")
        .select("id")
        .in("agent_id", descendantIds);
      scopedKioskIds = (kiosks || []).map((k: any) => k.id);
    }
  } else if (isSuperAdmin && agent_id_param) {
    // Super admin filtering by specific agent
    const { data: agentPlayers } = await supabase
      .from("users")
      .select("id")
      .eq("agent_id", agent_id_param);
    scopedPlayerIds = (agentPlayers || []).map((u: any) => u.id);
    const { data: agentKiosks } = await supabase
      .from("kiosks")
      .select("id")
      .eq("agent_id", agent_id_param);
    scopedKioskIds = (agentKiosks || []).map((k: any) => k.id);
  }

  // Helper: apply common filters to a bets query builder
  function applyBetFilters(query: any) {
    if (status) query = query.eq("status", status);

    if (period) {
      const now = new Date();
      let from: Date;
      if (period === "today") {
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (period === "7d") {
        from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (period === "30d") {
        from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      } else {
        from = new Date(0);
      }
      query = query.gte("created_at", from.toISOString());
    }

    if (player_id) {
      query = query.eq("user_id", player_id);
    } else if (scopedPlayerIds !== null) {
      // Build OR filter: user_id in player list OR kiosk_id in kiosk list
      const conditions: string[] = [];
      if (scopedPlayerIds.length > 0) {
        conditions.push(`user_id.in.(${scopedPlayerIds.join(",")})`);
      }
      if (scopedKioskIds.length > 0) {
        conditions.push(`kiosk_id.in.(${scopedKioskIds.join(",")})`);
      }
      if (conditions.length === 0) {
        query = query.in("id", ["__no_match__"]);
      } else {
        query = query.or(conditions.join(","));
      }
    }

    return query;
  }

  // ----- Sport filter: requires fetching selection event sports -----
  // We first get all matching bet IDs without pagination to apply sport filter,
  // then paginate the result. For large datasets this is acceptable at the agent scope.

  let filteredBetIds: string[] | null = null; // null = no sport filter

  if (sport) {
    // Fetch all bets matching base filters (id + user_id only for efficiency)
    let idQuery = supabase.from("bets").select("id");
    idQuery = applyBetFilters(idQuery);
    const { data: allBets, error: allBetsError } = await idQuery;
    if (allBetsError) {
      return NextResponse.json(
        { error: "Errore nel recupero scommesse" },
        { status: 500 }
      );
    }

    const allBetIds = (allBets || []).map((b: any) => b.id);

    if (allBetIds.length === 0) {
      filteredBetIds = [];
    } else {
      // Fetch selections for those bets, joined with events sport
      const batchSize = 500;
      let matchingBetIds = new Set<string>();

      for (let i = 0; i < allBetIds.length; i += batchSize) {
        const batch = allBetIds.slice(i, i + batchSize);
        const { data: selections } = await supabase
          .from("bet_selections")
          .select("bet_id, events_v2!inner(sport_slug)")
          .in("bet_id", batch)
          .eq("events_v2.sport_slug", sport);

        for (const sel of selections || []) {
          matchingBetIds.add(sel.bet_id);
        }
      }

      filteredBetIds = Array.from(matchingBetIds);
    }
  }

  // ----- KPIs (aggregate over full filtered set, no pagination) -----
  let kpiQuery = supabase
    .from("bets")
    .select("stake, actual_win, status", { count: "exact" });

  if (filteredBetIds !== null) {
    kpiQuery =
      filteredBetIds.length === 0
        ? kpiQuery.in("id", ["__no_match__"])
        : kpiQuery.in("id", filteredBetIds);
  } else {
    kpiQuery = applyBetFilters(kpiQuery);
  }

  // Supabase default limit is 1000; use range to bypass
  kpiQuery = kpiQuery.range(0, 99999);

  const { data: kpiRows, count: kpiCount } = await kpiQuery;

  let total_bets = kpiCount || 0;
  let turnover = 0;
  let winnings = 0;

  for (const row of kpiRows || []) {
    turnover += row.stake || 0;
    if (row.status === "won") winnings += row.actual_win || 0;
  }

  const margin_pct =
    turnover > 0 ? ((turnover - winnings) / turnover) * 100 : 0;

  // ----- Main bets query (paginated) -----
  let betsQuery = supabase
    .from("bets")
    .select(
      `id, user_id, bet_type, stake, total_odds, potential_win, actual_win,
       status, is_live, selections_count, created_at,
       users(username, agent_id),
       kiosk:kiosks(code, name)`
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filteredBetIds !== null) {
    betsQuery =
      filteredBetIds.length === 0
        ? betsQuery.in("id", ["__no_match__"])
        : betsQuery.in("id", filteredBetIds);
  } else {
    betsQuery = applyBetFilters(betsQuery);
  }

  const { data: bets, error: betsError } = await betsQuery;
  if (betsError) {
    return NextResponse.json(
      { error: "Errore nel recupero scommesse" },
      { status: 500 }
    );
  }

  // ----- Fetch bet_selections for returned bets -----
  const betIds = (bets || []).map((b: any) => b.id);
  let selectionsMap: Record<string, any[]> = {};

  if (betIds.length > 0) {
    const { data: selections } = await supabase
      .from("bet_selections")
      .select(
        `id, bet_id, event_id, market_id, outcome_id, odds_at_placement, result,
         event:events_v2(home, away, sport_name),
         market:markets_v2(market_name),
         outcome:outcomes_v2(outcome_key)`
      )
      .in("bet_id", betIds);

    for (const sel of selections || []) {
      if (!selectionsMap[sel.bet_id]) selectionsMap[sel.bet_id] = [];
      selectionsMap[sel.bet_id].push(sel);
    }
  }

  // Attach selections to bets
  const betsWithSelections = (bets || []).map((bet: any) => ({
    ...bet,
    selections: selectionsMap[bet.id] || [],
  }));

  // ----- Pagination total -----
  // If sport filter applied, total = filteredBetIds.length
  // Otherwise use kpiCount which has the correct count
  const paginationTotal =
    filteredBetIds !== null ? filteredBetIds.length : (kpiCount || 0);

  return NextResponse.json({
    kpis: {
      total_bets,
      turnover: Math.round(turnover * 100) / 100,
      winnings: Math.round(winnings * 100) / 100,
      margin_pct: Math.round(margin_pct * 100) / 100,
    },
    bets: betsWithSelections,
    pagination: {
      page,
      limit,
      total: paginationTotal,
    },
  });
}
