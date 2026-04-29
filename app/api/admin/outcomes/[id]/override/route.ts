export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// POST /api/admin/outcomes/[id]/override
// body: {
//   new_odds: number,          // required, > 1
//   reason?: string,
//   duration_minutes?: number | null,
//   consensus_id?: number | null
// }

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: outcomeId } = await ctx.params;
  if (!outcomeId) {
    return NextResponse.json({ error: "outcome id required" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({} as any));

  const newOdds = Number(body.new_odds);
  if (!Number.isFinite(newOdds) || newOdds <= 1) {
    return NextResponse.json(
      { error: "new_odds must be a number > 1" },
      { status: 400 }
    );
  }

  const reason = typeof body.reason === "string" ? body.reason : null;

  const durationRaw = body.duration_minutes;
  const duration =
    durationRaw === null || durationRaw === undefined
      ? null
      : Number(durationRaw);
  if (duration !== null && (!Number.isFinite(duration) || duration <= 0)) {
    return NextResponse.json(
      { error: "duration_minutes must be a positive number or null" },
      { status: 400 }
    );
  }

  const consensusId =
    body.consensus_id === undefined || body.consensus_id === null
      ? null
      : Number(body.consensus_id);
  if (consensusId !== null && !Number.isFinite(consensusId)) {
    return NextResponse.json(
      { error: "consensus_id must be a number or null" },
      { status: 400 }
    );
  }

  let userId: string | null = null;
  try {
    const authClient = await createClient();
    const { data } = await authClient.auth.getUser();
    userId = data.user?.id ?? null;
  } catch {
    // fall through
  }

  const sb = createAdminClient();
  const { data, error } = await sb.rpc("override_outcome_odds", {
    p_outcome_id: outcomeId,
    p_new_odds: newOdds,
    p_reason: reason,
    p_duration_minutes: duration,
    p_user_id: userId,
    p_consensus_id: consensusId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (data && typeof data === "object" && "error" in data) {
    return NextResponse.json(data, { status: 400 });
  }

  return NextResponse.json(data);
}
