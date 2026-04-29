export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { detectAgent, getScopedPlayerIds, hasPermission } from "@/lib/agent-permissions";

// GET  /api/admin/risk/blacklist — list active blacklist entries
// POST /api/admin/risk/blacklist — add player to blacklist

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

  try {
    let query = supabase
      .from("player_blacklist")
      .select(`
        id, player_id, agent_id, reason, blocked_by, is_active, created_at,
        users!player_blacklist_player_id_fkey(username),
        agents!player_blacklist_agent_id_fkey(name)
      `)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (scopedPlayerIds !== null) {
      if (scopedPlayerIds.length === 0) return NextResponse.json({ blacklist: [] });
      query = query.in("player_id", scopedPlayerIds);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ blacklist: data || [] });
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
    const { player_id, reason } = body;
    if (!player_id) return NextResponse.json({ error: "player_id obbligatorio" }, { status: 400 });

    // If agent, verify player is in scope
    if (!isSuperAdmin) {
      const scopedIds = await getScopedPlayerIds(supabase, myAgent.id);
      if (!scopedIds.includes(player_id))
        return NextResponse.json({ error: "Giocatore fuori ambito" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("player_blacklist")
      .insert({
        player_id,
        agent_id: isSuperAdmin ? null : myAgent.id,
        reason: reason || null,
        blocked_by: authUser.id,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ entry: data }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
