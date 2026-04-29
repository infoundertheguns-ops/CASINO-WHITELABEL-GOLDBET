export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getKpis, getSports, listOutliers } from "./_lib";

// GET /api/admin/consensus?action=list|kpis|sports|refresh
//   list: &sport=&market_type=&min_delta=&only_unreviewed=1&limit=100
//   kpis: returns aggregate counters
//   sports: distinct sports with counts
//   refresh: trigger RPC refresh_consensus_snapshots(threshold)
// POST /api/admin/consensus  body: { id, reviewed, notes }

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const action = sp.get("action") || "list";
  const supabase = createAdminClient();

  try {
    if (action === "kpis") {
      return NextResponse.json(await getKpis(supabase));
    }
    if (action === "sports") {
      return NextResponse.json(await getSports(supabase));
    }
    if (action === "refresh") {
      const threshold = Number(sp.get("threshold") ?? 15);
      const { data, error } = await supabase.rpc("refresh_consensus_snapshots", { threshold_pct: threshold });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return NextResponse.json(row);
    }
    // default: list
    return NextResponse.json(await listOutliers(supabase, sp));
  } catch (err: any) {
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const supabase = createAdminClient();
  const patch: any = {};
  if (typeof body.reviewed === "boolean") {
    patch.reviewed = body.reviewed;
    patch.reviewed_at = body.reviewed ? new Date().toISOString() : null;
  }
  if (typeof body.notes === "string") patch.notes = body.notes;
  const { error } = await supabase.from("consensus_snapshots").update(patch).eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
