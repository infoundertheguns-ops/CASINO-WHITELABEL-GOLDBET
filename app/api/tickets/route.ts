export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin, isAdminError } from "@/lib/auth/admin-session";
import { mapClaimRpcResult } from "./_claim";
import { normalizeTicketCode, isValidTicketCode } from "@/app/admin/agent-tickets/lib/ticket-code";

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Generate short ticket code: TK-XXXXXX
function generateTicketCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I confusion
  let code = "TK-";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// POST — Create ticket after kiosk bet
export async function POST(req: NextRequest) {
  const supabase = getAdminSupabase();
  const body = await req.json();

  const { bet_id, agent_id, player_id } = body;
  if (!bet_id || !player_id) {
    return NextResponse.json({ error: "bet_id e player_id richiesti" }, { status: 400 });
  }

  // Fetch bet info
  const { data: bet } = await supabase
    .from("bets")
    .select("id, bet_type, selections_count, stake, total_odds, potential_win, status")
    .eq("id", bet_id)
    .single();

  if (!bet) return NextResponse.json({ error: "Scommessa non trovata" }, { status: 404 });

  // Generate unique ticket code
  let ticketCode = generateTicketCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: exists } = await supabase
      .from("tickets")
      .select("id")
      .eq("ticket_code", ticketCode)
      .maybeSingle();
    if (!exists) break;
    ticketCode = generateTicketCode();
  }

  // Expiry: 30 days from now
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600000).toISOString();

  const { data: ticket, error } = await supabase
    .from("tickets")
    .insert({
      ticket_code: ticketCode,
      bet_id,
      agent_id: agent_id || null,
      player_id,
      bet_type: bet.bet_type,
      selections_count: bet.selections_count,
      stake: bet.stake,
      total_odds: bet.total_odds,
      potential_win: bet.potential_win,
      status: "open",
      expires_at: expiresAt,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ticket }, { status: 201 });
}

// GET — Verify ticket by code (for agent scanning)
export async function GET(req: NextRequest) {
  const supabase = getAdminSupabase();
  const code = req.nextUrl.searchParams.get("code");

  if (!code) return NextResponse.json({ error: "code richiesto" }, { status: 400 });

  const { data: ticket } = await supabase
    .from("tickets")
    .select("*")
    .eq("ticket_code", code.toUpperCase())
    .single();

  if (!ticket) return NextResponse.json({ error: "Ticket non trovato" }, { status: 404 });

  // Fetch bet selections for display
  const { data: selections } = await supabase
    .from("bet_selections")
    .select("*, events(home_team, away_team, status, score_home, score_away)")
    .eq("bet_id", ticket.bet_id);

  // Check if bet is settled
  const { data: bet } = await supabase
    .from("bets")
    .select("status, total_odds, potential_win, stake")
    .eq("id", ticket.bet_id)
    .single();

  // Update ticket status based on bet status
  let ticketStatus = ticket.status;
  if (bet && ticket.status === "open") {
    if (bet.status === "won") {
      ticketStatus = "won";
      await supabase.from("tickets").update({
        status: "won",
        win_amount: bet.potential_win,
        updated_at: new Date().toISOString(),
      }).eq("id", ticket.id);
    } else if (bet.status === "lost") {
      ticketStatus = "lost";
      await supabase.from("tickets").update({
        status: "lost", win_amount: 0,
        updated_at: new Date().toISOString(),
      }).eq("id", ticket.id);
    } else if (bet.status === "void" || bet.status === "rejected") {
      ticketStatus = "void";
      await supabase.from("tickets").update({
        status: "void", win_amount: ticket.stake,
        updated_at: new Date().toISOString(),
      }).eq("id", ticket.id);
    }
  }

  // Check expiry
  if (ticket.expires_at && new Date(ticket.expires_at) < new Date() && ticketStatus === "open") {
    ticketStatus = "expired";
    await supabase.from("tickets").update({
      status: "expired", updated_at: new Date().toISOString(),
    }).eq("id", ticket.id);
  }

  const { player_id, ...ticketSanitized } = ticket;
  return NextResponse.json({
    ticket: { ...ticketSanitized, status: ticketStatus, win_amount: ticketStatus === "won" ? bet?.potential_win : ticketStatus === "void" ? ticket.stake : 0 },
    bet,
    selections: selections || [],
  });
}

// PUT — Claim ticket (agent pays out). Session-based auth ONLY.
// Ignora qualsiasi claimed_by passato nel body (breaking change vs vecchio contratto).
export async function PUT(req: NextRequest) {
  const session = await requireAdmin();
  if (isAdminError(session)) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const body = await req.json();
  const raw = body?.ticket_code;
  if (!raw) return NextResponse.json({ error: "ticket_code richiesto" }, { status: 400 });
  const code = normalizeTicketCode(String(raw));
  if (!isValidTicketCode(code)) {
    return NextResponse.json({ error: "Formato codice non valido" }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  const { data, error } = await supabase.rpc("claim_ticket", {
    p_code: code,
    p_admin_id: session.adminUserId,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const mapped = mapClaimRpcResult((data as any) ?? []);

  if (mapped.status === 200) {
    await supabase.from("audit_log").insert({
      admin_id: session.adminUserId,
      action: "ticket_claim",
      module: "tickets",
      target_type: "ticket",
      target_id: mapped.body.ticket_id,
      after_state: { ticket_code: code, amount_paid: mapped.body.amount_paid },
    });
  }

  return NextResponse.json(mapped.body, { status: mapped.status });
}
