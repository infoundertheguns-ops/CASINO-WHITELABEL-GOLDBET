export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { detectAgent, getScopedPlayerIds, hasPermission } from "@/lib/agent-permissions";

// PUT    /api/admin/risk/limits/[id] — update limit
// DELETE /api/admin/risk/limits/[id] — delete limit

type Params = { params: Promise<{ id: string }> };

async function resolveAccess(supabase: any, authUser: any) {
  const { data: adminRecord } = await supabase
    .from("admin_users").select("id").eq("user_id", authUser.id).limit(1).maybeSingle();

  const isSuperAdmin = !!adminRecord;
  let myAgent: any = null;
  let scopedPlayerIds: string[] | null = null;

  if (!isSuperAdmin) {
    myAgent = await detectAgent(supabase, authUser.id);
    if (!myAgent) return null;
    scopedPlayerIds = await getScopedPlayerIds(supabase, myAgent.id);
  }

  return { isSuperAdmin, myAgent, scopedPlayerIds };
}

async function verifyScope(supabase: any, id: string, scopedPlayerIds: string[] | null): Promise<boolean> {
  if (scopedPlayerIds === null) return true; // super admin

  const { data } = await supabase
    .from("betting_limits").select("player_id").eq("id", id).limit(1).maybeSingle();
  if (!data) return false;
  if (!data.player_id) return false; // global/agent limit — agents can't touch global
  return scopedPlayerIds.includes(data.player_id);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = createAdminClient();
  const authClient = await createClient();

  const { data: { user: authUser } } = await authClient.auth.getUser();
  if (!authUser) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const access = await resolveAccess(supabase, authUser);
  if (!access) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
  const { isSuperAdmin, myAgent, scopedPlayerIds } = access;

  if (!isSuperAdmin && !hasPermission(myAgent.permissions, "risk", "editor"))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const inScope = await verifyScope(supabase, id, scopedPlayerIds);
  if (!inScope) return NextResponse.json({ error: "Limite fuori ambito" }, { status: 403 });

  try {
    const body = await req.json();
    const updateData: any = { updated_at: new Date().toISOString() };
    if (body.max_stake !== undefined) updateData.max_stake = body.max_stake;
    if (body.max_win !== undefined) updateData.max_win = body.max_win;
    if (body.max_daily_turnover !== undefined) updateData.max_daily_turnover = body.max_daily_turnover;
    if (body.is_active !== undefined) updateData.is_active = body.is_active;

    const { data, error } = await supabase
      .from("betting_limits").update(updateData).eq("id", id).select().single();
    if (error) throw error;

    return NextResponse.json({ limit: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = createAdminClient();
  const authClient = await createClient();

  const { data: { user: authUser } } = await authClient.auth.getUser();
  if (!authUser) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const access = await resolveAccess(supabase, authUser);
  if (!access) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
  const { isSuperAdmin, myAgent, scopedPlayerIds } = access;

  if (!isSuperAdmin && !hasPermission(myAgent.permissions, "risk", "editor"))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const inScope = await verifyScope(supabase, id, scopedPlayerIds);
  if (!inScope) return NextResponse.json({ error: "Limite fuori ambito" }, { status: 403 });

  try {
    const { error } = await supabase.from("betting_limits").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
