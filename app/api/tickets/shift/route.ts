export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin, isAdminError } from "@/lib/auth/admin-session";

function romeMidnightISO(): string {
  const now = new Date();
  const romeOffsetMs = 2 * 3600 * 1000; // CEST; DST drift accettabile per use-case cassa
  const romeMidnight = new Date(
    Math.floor((now.getTime() + romeOffsetMs) / 86400000) * 86400000 - romeOffsetMs
  );
  return romeMidnight.toISOString();
}

export async function GET(req: NextRequest) {
  const session = await requireAdmin();
  if (isAdminError(session)) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const since = req.nextUrl.searchParams.get("since") ?? romeMidnightISO();

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("get_agent_shift_stats", {
    p_admin_id: session.adminUserId,
    p_since: since,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ since, ...(row ?? {}) });
}
