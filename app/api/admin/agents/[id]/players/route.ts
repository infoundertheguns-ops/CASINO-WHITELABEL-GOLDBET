export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET — List players belonging to this agent (and descendants)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getAdminSupabase();

  // Get all descendant agent IDs
  const agentIds: string[] = [id];
  let currentLevel = [id];
  for (let i = 0; i < 3; i++) {
    if (currentLevel.length === 0) break;
    const { data } = await supabase
      .from("agents")
      .select("id")
      .in("parent_id", currentLevel)
      .eq("status", "active");
    const childIds = (data || []).map((a: any) => a.id);
    agentIds.push(...childIds);
    currentLevel = childIds;
  }

  // Get players, EXCLUDE users that are agents themselves
  const { data: agentUserIds } = await supabase
    .from("agents")
    .select("user_id")
    .in("id", agentIds);
  const excludeIds = new Set((agentUserIds || []).map((a: any) => a.user_id));

  const { data: players, error } = await supabase
    .from("users")
    .select("id, username, email, display_name, player_type, agent_id, is_active, is_banned, created_at, last_login")
    .in("agent_id", agentIds)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Filter out agent users + get wallets
  const realPlayers = (players || []).filter((p: any) => !excludeIds.has(p.id));
  const playerIds = realPlayers.map((p: any) => p.id);

  const { data: wallets } = await supabase
    .from("wallets")
    .select("user_id, balance")
    .in("user_id", playerIds.length > 0 ? playerIds : ["none"])
    .eq("owner_type", "player");

  const balanceMap = new Map((wallets || []).map((w: any) => [w.user_id, w.balance]));

  const enriched = realPlayers.map((p: any) => ({
    ...p,
    balance: balanceMap.get(p.id) ?? 0,
  }));

  return NextResponse.json({ players: enriched });
}
