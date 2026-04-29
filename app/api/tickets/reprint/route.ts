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

  const body = await req.json();
  const code = normalizeTicketCode(String(body?.ticket_code ?? ""));
  if (!isValidTicketCode(code)) {
    return NextResponse.json({ error: "Formato codice non valido" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: ticket } = await supabase
    .from("tickets")
    .select("id, status")
    .eq("ticket_code", code)
    .maybeSingle();
  if (!ticket) return NextResponse.json({ error: "Ticket non trovato" }, { status: 404 });
  if (ticket.status !== "claimed") {
    return NextResponse.json({ error: "Ristampa disponibile solo per ticket incassati" }, { status: 400 });
  }

  await supabase.from("ticket_receipts").insert({
    ticket_id: ticket.id,
    printed_by: session.adminUserId,
    receipt_type: "reprint",
  });
  await supabase.from("audit_log").insert({
    admin_id: session.adminUserId,
    action: "ticket_reprint",
    module: "tickets",
    target_type: "ticket",
    target_id: ticket.id,
    after_state: { ticket_code: code },
  });

  return NextResponse.json({ success: true });
}
