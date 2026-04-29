export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { detectAgent, getScopedPlayerIds } from "@/lib/agent-permissions";
import { hasPermission } from "@/lib/agent-permissions";

// GET /api/admin/risk/exposure
// Returns top 20 players by open-bet exposure + total KPIs
export async function GET(req: NextRequest) {
  const supabase = createAdminClient();
  const authClient = await createClient();

  const { data: { user: authUser } } = await authClient.auth.getUser();
  if (!authUser) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  // Auth: super admin or agent with risk viewer permission
  const { data: adminRecord } = await supabase
    .from("admin_users").select("id").eq("user_id", authUser.id).limit(1).maybeSingle();

  const isSuperAdmin = !!adminRecord;
  let scopedPlayerIds: string[] | null = null;

  if (!isSuperAdmin) {
    const myAgent = await detectAgent(supabase, authUser.id);
    if (!myAgent) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
    if (!hasPermission(myAgent.permissions, "risk", "viewer"))
      return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
    scopedPlayerIds = await getScopedPlayerIds(supabase, myAgent.id);
  }

  try {
    // Fetch all open bets
    let query = supabase
      .from("bets")
      .select("user_id, potential_win")
      .eq("status", "open");

    if (scopedPlayerIds !== null) {
      if (scopedPlayerIds.length === 0) {
        return NextResponse.json({ players: [], totals: { total_exposure: 0, player_count: 0 } });
      }
      query = query.in("user_id", scopedPlayerIds);
    }

    const { data: bets, error } = await query;
    if (error) throw error;

    // Aggregate by user_id
    const byUser: Record<string, { exposure: number; count: number }> = {};
    for (const bet of bets || []) {
      if (!byUser[bet.user_id]) byUser[bet.user_id] = { exposure: 0, count: 0 };
      byUser[bet.user_id].exposure += bet.potential_win || 0;
      byUser[bet.user_id].count++;
    }

    const userIds = Object.keys(byUser);
    const totalExposure = Object.values(byUser).reduce((s, v) => s + v.exposure, 0);

    // Fetch user info for top 20 by exposure
    const sorted = userIds
      .map(uid => ({ user_id: uid, ...byUser[uid] }))
      .sort((a, b) => b.exposure - a.exposure)
      .slice(0, 20);

    let players: any[] = sorted;
    if (sorted.length > 0) {
      const { data: users } = await supabase
        .from("users")
        .select("id, username, agent_id")
        .in("id", sorted.map(s => s.user_id));

      const userMap: Record<string, any> = {};
      for (const u of users || []) userMap[u.id] = u;

      players = sorted.map(s => ({
        ...s,
        username: userMap[s.user_id]?.username || s.user_id,
        agent_id: userMap[s.user_id]?.agent_id || null,
      }));
    }

    return NextResponse.json({
      players,
      totals: {
        total_exposure: totalExposure,
        player_count: userIds.length,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
