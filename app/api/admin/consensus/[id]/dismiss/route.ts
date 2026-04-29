export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// POST /api/admin/consensus/[id]/dismiss
// body: {
//   dismiss_type: 'bug_kambi' | 'bug_22bet' | 'mismatch_normalization' | 'value_genuine' | 'other',
//   notes?: string
// }

const VALID_TYPES = [
  "bug_kambi",
  "bug_22bet",
  "mismatch_normalization",
  "value_genuine",
  "other",
] as const;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: consensusIdStr } = await ctx.params;
  const consensusId = Number(consensusIdStr);
  if (!Number.isFinite(consensusId) || consensusId <= 0) {
    return NextResponse.json(
      { error: "consensus id must be a positive integer" },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({} as any));

  if (!VALID_TYPES.includes(body.dismiss_type)) {
    return NextResponse.json(
      {
        error: "invalid dismiss_type",
        allowed: VALID_TYPES,
        got: body.dismiss_type,
      },
      { status: 400 }
    );
  }

  const notes = typeof body.notes === "string" ? body.notes : null;

  let userId: string | null = null;
  try {
    const authClient = await createClient();
    const { data } = await authClient.auth.getUser();
    userId = data.user?.id ?? null;
  } catch {
    // fall through
  }

  const sb = createAdminClient();
  const { data, error } = await sb.rpc("dismiss_consensus", {
    p_consensus_id: consensusId,
    p_dismiss_type: body.dismiss_type,
    p_notes: notes,
    p_user_id: userId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (data && typeof data === "object" && "error" in data) {
    return NextResponse.json(data, { status: 404 });
  }

  return NextResponse.json(data);
}
