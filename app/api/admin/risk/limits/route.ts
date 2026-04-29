export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { detectAgent, getScopedPlayerIds, hasPermission } from "@/lib/agent-permissions";

// GET  /api/admin/risk/limits  — list limits
// POST /api/admin/risk/limits  — create limit

export async function GET(req: NextRequest) {
  const supabase = createAdminClient();
  const authClient = await createClient();

  const { data: { user: authUser } } = await authClient.auth.getUser();
  if (!authUser) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { data: adminRecord } = await supabase
    .from("admin_users").select("id").eq("user_id", authUser.id).limit(1).maybeSingle();

  const isSuperAdmin = !!adminRecord;
  let myAgent: any = null;
  let scopedPlayerIds: string[] | null = null;

  if (!isSuperAdmin) {
    myAgent = await detectAgent(supabase, authUser.id);
    if (!myAgent) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
    if (!hasPermission(myAgent.permissions, "risk", "viewer"))
      return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
    scopedPlayerIds = await getScopedPlayerIds(supabase, myAgent.id);
  }

  const sp = req.nextUrl.searchParams;
  const filterAgentId = sp.get("agent_id");
  const filterPlayerId = sp.get("player_id");
  const filterSport = sp.get("sport");

  try {
    let query = supabase
      .from("betting_limits")
      .select(`
        id, agent_id, player_id, sport,
        max_stake, max_win, max_daily_turnover,
        is_active, created_by, created_at, updated_at,
        agents(name),
        users!betting_limits_player_id_fkey(username)
      `)
      .order("created_at", { ascending: false });

    if (filterAgentId) query = query.eq("agent_id", filterAgentId);
    if (filterPlayerId) query = query.eq("player_id", filterPlayerId);
    if (filterSport) query = query.eq("sport", filterSport);

    // Scope: agent can only see limits for their own players
    if (scopedPlayerIds !== null) {
      if (scopedPlayerIds.length === 0) return NextResponse.json({ limits: [] });
      query = query.in("player_id", scopedPlayerIds);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ limits: data || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const supabase = createAdminClient();
  const authClient = await createClient();

  const { data: { user: authUser } } = await authClient.auth.getUser();
  if (!authUser) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { data: adminRecord } = await supabase
    .from("admin_users").select("id").eq("user_id", authUser.id).limit(1).maybeSingle();

  const isSuperAdmin = !!adminRecord;
  let myAgent: any = null;

  if (!isSuperAdmin) {
    myAgent = await detectAgent(supabase, authUser.id);
    if (!myAgent) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
    if (!hasPermission(myAgent.permissions, "risk", "editor"))
      return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { agent_id, player_id, sport, max_stake, max_win, max_daily_turnover } = body;

    // If agent (not super admin), verify the player belongs to their scope
    if (!isSuperAdmin && player_id) {
      const scopedIds = await getScopedPlayerIds(supabase, myAgent.id);
      if (!scopedIds.includes(player_id))
        return NextResponse.json({ error: "Giocatore fuori ambito" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("betting_limits")
      .insert({
        agent_id: agent_id || null,
        player_id: player_id || null,
        sport: sport || null,
        max_stake: max_stake ?? null,
        max_win: max_win ?? null,
        max_daily_turnover: max_daily_turnover ?? null,
        is_active: true,
        created_by: authUser.id,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ limit: data }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
