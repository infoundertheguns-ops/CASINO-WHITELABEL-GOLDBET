export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// POST /api/admin/outcomes/[id]/restore
// body: { source?: 'manual' | 'cron_expiry' | 'auto_consensus' }
// Clears all manual_* fields. Idempotent.

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: outcomeId } = await ctx.params;
  if (!outcomeId) {
    return NextResponse.json({ error: "outcome id required" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({} as any));
  const source = ["manual", "cron_expiry", "auto_consensus"].includes(body.source)
    ? body.source
    : "manual";

  let userId: string | null = null;
  try {
    const authClient = await createClient();
    const { data } = await authClient.auth.getUser();
    userId = data.user?.id ?? null;
  } catch {
    // fall through
  }

  const sb = createAdminClient();
  const { data, error } = await sb.rpc("restore_outcome", {
    p_outcome_id: outcomeId,
    p_user_id: userId,
    p_source: source,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (data && typeof data === "object" && "error" in data) {
    return NextResponse.json(data, { status: 404 });
  }

  return NextResponse.json(data);
}
