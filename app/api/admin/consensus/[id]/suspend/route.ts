export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// POST /api/admin/consensus/[id]/suspend
// body: { reason?, duration_minutes?, source? }
// Resolves outcome_id from consensus snapshot, then suspends the Kambi outcome.

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const consensusId = Number(id);
  if (!Number.isFinite(consensusId) || consensusId <= 0) {
    return NextResponse.json({ error: "consensus id must be a positive integer" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({} as any));
  const reason = typeof body.reason === "string" ? body.reason : null;
  const durationRaw = body.duration_minutes;
  const duration = durationRaw === null || durationRaw === undefined ? null : Number(durationRaw);
  if (duration !== null && (!Number.isFinite(duration) || duration <= 0)) {
    return NextResponse.json({ error: "duration_minutes must be positive or null" }, { status: 400 });
  }
  const source = body.source === "auto_consensus" ? "auto_consensus" : "manual";

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

  const { data, error } = await sb.rpc("suspend_outcome", {
    p_outcome_id: outcomeId,
    p_reason: reason,
    p_duration_minutes: duration,
    p_user_id: userId,
    p_consensus_id: consensusId,
    p_source: source,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ...data, resolved_outcome_id: outcomeId });
}
