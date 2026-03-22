import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getDescendantAgentIds } from "@/lib/agent-permissions";

// GET — List players belonging to this agent (and descendants)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createAdminClient();

  const agentIds = await getDescendantAgentIds(supabase, id);

  const { data: players, error } = await supabase
    .from("users")
    .select("id, username, email, display_name, player_type, agent_id, is_active, is_banned, created_at, last_login")
    .in("agent_id", agentIds)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Get wallet balances
  const playerIds = (players || []).map((p: any) => p.id);
  const { data: wallets } = await supabase
    .from("wallets")
    .select("user_id, balance")
    .in("user_id", playerIds.length > 0 ? playerIds : ["none"])
    .eq("owner_type", "player");

  const balanceMap = new Map((wallets || []).map((w: any) => [w.user_id, w.balance]));

  const enriched = (players || []).map((p: any) => ({
    ...p,
    balance: balanceMap.get(p.id) ?? 0,
  }));

  return NextResponse.json({ players: enriched });
}
