export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { detectAgent, getScopedPlayerIds, hasPermission } from "@/lib/agent-permissions";

// DELETE /api/admin/risk/blacklist/[id] — soft-remove (set is_active = false)

type Params = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
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
    // Fetch entry to verify scope
    const { data: entry } = await supabase
      .from("player_blacklist").select("player_id").eq("id", id).limit(1).maybeSingle();
    if (!entry) return NextResponse.json({ error: "Non trovato" }, { status: 404 });

    if (!isSuperAdmin) {
      const scopedIds = await getScopedPlayerIds(supabase, myAgent.id);
      if (!scopedIds.includes(entry.player_id))
        return NextResponse.json({ error: "Voce fuori ambito" }, { status: 403 });
    }

    const { error } = await supabase
      .from("player_blacklist").update({ is_active: false }).eq("id", id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
