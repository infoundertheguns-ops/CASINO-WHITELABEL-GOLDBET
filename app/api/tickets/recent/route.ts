export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin, isAdminError } from "@/lib/auth/admin-session";

function romeMidnightISO(): string {
  const now = new Date();
  const romeOffsetMs = 2 * 3600 * 1000;
  const romeMidnight = new Date(
    Math.floor((now.getTime() + romeOffsetMs) / 86400000) * 86400000 - romeOffsetMs
  );
  return romeMidnight.toISOString();
}

export async function GET() {
  const session = await requireAdmin();
  if (isAdminError(session)) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("tickets")
    .select("ticket_code, win_amount, claimed_at, stake, total_odds, bet_type")
    .eq("claimed_by", session.adminUserId)
    .gte("claimed_at", romeMidnightISO())
    .order("claimed_at", { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}
