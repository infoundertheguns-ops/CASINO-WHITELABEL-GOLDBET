export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// POST /api/admin/consensus/[id]/restore
// Clears manual_* on the Kambi outcome resolved from this consensus row.

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const consensusId = Number(id);
  if (!Number.isFinite(consensusId) || consensusId <= 0) {
    return NextResponse.json({ error: "consensus id must be a positive integer" }, { status: 400 });
  }

  let userId: string | null = null;
  try {
    const authClient = await createClient();
    const { data } = await authClient.auth.getUser();
    userId = data.user?.id ?? null;
  } catch {}

  const sb = createAdminClient();

  const { data: outcomeId, error: resolveErr } = await sb.rpc("resolve_outcome_from_consensus", {
    p_consensus_id: consensusId,
  });
  if (resolveErr) return NextResponse.json({ error: resolveErr.message }, { status: 500 });
  if (!outcomeId) {
    return NextResponse.json({ error: "outcome not found for this consensus snapshot" }, { status: 404 });
  }

  const { data, error } = await sb.rpc("restore_outcome", {
    p_outcome_id: outcomeId,
    p_user_id: userId,
    p_source: "manual",
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ...data, resolved_outcome_id: outcomeId });
}
