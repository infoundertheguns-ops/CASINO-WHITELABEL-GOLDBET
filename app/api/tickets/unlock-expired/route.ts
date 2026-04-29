export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin, isAdminError } from "@/lib/auth/admin-session";
import { normalizeTicketCode, isValidTicketCode } from "@/app/admin/agent-tickets/lib/ticket-code";

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (isAdminError(session)) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }
  if (session.role !== "super_admin") {
    return NextResponse.json({ error: "Solo super_admin può sbloccare ticket scaduti" }, { status: 403 });
  }

  const body = await req.json();
  const code = normalizeTicketCode(String(body?.ticket_code ?? ""));
  if (!isValidTicketCode(code)) {
    return NextResponse.json({ error: "Formato codice non valido" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("unlock_expired_ticket", {
    p_code: code,
    p_admin_id: session.adminUserId,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.ticket_id) {
    return NextResponse.json({ error: "Ticket non trovato o non scaduto" }, { status: 404 });
  }

  await supabase.from("audit_log").insert({
    admin_id: session.adminUserId,
    action: "ticket_unlock_expired",
    module: "tickets",
    target_type: "ticket",
    target_id: row.ticket_id,
    after_state: { ticket_code: code, new_status: row.new_status },
  });

  return NextResponse.json({ success: true, new_status: row.new_status });
}
