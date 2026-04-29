export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { detectAgent, getDescendantAgentIds } from "@/lib/agent-permissions";

// PUT — Update settlement status (approve or pay)
// Body: { action: "approve" | "pay", notes?: string }
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createAdminClient();
  const authClient = await createClient();

  // ── Auth ──
  const { data: { user: authUser } } = await authClient.auth.getUser();
  if (!authUser) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { data: adminRecord } = await supabase
    .from("admin_users")
    .select("id")
    .eq("user_id", authUser.id)
    .limit(1)
    .maybeSingle();

  const isSuperAdmin = !!adminRecord;
  let myAgent = null;

  if (!isSuperAdmin) {
    myAgent = await detectAgent(supabase, authUser.id);
    if (!myAgent) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
    if (myAgent.level > 1) return NextResponse.json({ error: "Solo master o super admin possono approvare" }, { status: 403 });
  }

  // ── Parse body ──
  let body: { action?: string; notes?: string } = {};
  try { body = await req.json(); } catch { /* no body */ }

  const { action, notes } = body;
  if (!action || !["approve", "pay"].includes(action)) {
    return NextResponse.json({ error: "action deve essere 'approve' o 'pay'" }, { status: 400 });
  }

  // ── Fetch settlement ──
  const { data: settlement, error: fetchErr } = await supabase
    .from("agent_settlements")
    .select("id, agent_id, status")
    .eq("id", id)
    .limit(1)
    .maybeSingle();

  if (fetchErr || !settlement) {
    return NextResponse.json({ error: "Settlement non trovato" }, { status: 404 });
  }

  // ── Authorization: cannot approve own settlement ──
  if (myAgent && settlement.agent_id === myAgent.id) {
    return NextResponse.json({ error: "Non puoi approvare il tuo stesso settlement" }, { status: 403 });
  }

  // ── Authorization: settlement must be in agent network ──
  if (!isSuperAdmin && myAgent) {
    const networkIds = await getDescendantAgentIds(supabase, myAgent.id);
    if (!networkIds.includes(settlement.agent_id)) {
      return NextResponse.json({ error: "Settlement non appartiene alla tua rete" }, { status: 403 });
    }
  }

  // ── Validate state transition ──
  if (action === "approve" && settlement.status !== "pending") {
    return NextResponse.json({ error: `Stato attuale '${settlement.status}': solo pending → approved` }, { status: 400 });
  }
  if (action === "pay" && settlement.status !== "approved") {
    return NextResponse.json({ error: `Stato attuale '${settlement.status}': solo approved → paid` }, { status: 400 });
  }

  // ── Build update payload ──
  const now = new Date().toISOString();
  const updatePayload: Record<string, any> = {
    status: action === "approve" ? "approved" : "paid",
  };

  if (notes !== undefined) updatePayload.notes = notes;

  if (action === "approve") {
    updatePayload.approved_at = now;
    updatePayload.approved_by = authUser.id;
  } else {
    updatePayload.paid_at = now;
    updatePayload.paid_by = authUser.id;
  }

  const { error: updateErr } = await supabase
    .from("agent_settlements")
    .update(updatePayload)
    .eq("id", id);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ success: true, status: updatePayload.status });
}
