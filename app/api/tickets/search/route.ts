export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin, isAdminError } from "@/lib/auth/admin-session";

export async function GET(req: NextRequest) {
  const session = await requireAdmin();
  if (isAdminError(session)) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const sp = req.nextUrl.searchParams;
  const q = sp.get("q");
  const from = sp.get("from");
  const to = sp.get("to");
  const status = sp.get("status");

  const supabase = createAdminClient();
  let query = supabase
    .from("tickets")
    .select("ticket_code, status, bet_type, stake, total_odds, win_amount, printed_at, claimed_at, claimed_by")
    .order("printed_at", { ascending: false })
    .limit(50);

  if (q) query = query.ilike("ticket_code", `%${q.toUpperCase()}%`);
  if (from) query = query.gte("printed_at", from);
  if (to) query = query.lte("printed_at", to);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}
