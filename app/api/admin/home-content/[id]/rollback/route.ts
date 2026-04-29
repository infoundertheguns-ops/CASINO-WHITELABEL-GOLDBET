export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// E5 Phase 2 — Rollback a home_content row to a specific history snapshot.
// POST /api/admin/home-content/:id/rollback  { history_id: <N> }
//
// Writes a fresh UPDATE (which itself records another history row) so the
// rollback is auditable.

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const MUTABLE_COLS = [
  "title", "title_en", "image_url", "icon_url", "flag_url", "href", "accent_color",
  "is_wide", "is_active", "sort_order",
  "published_from", "published_until",
];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const historyId = body.history_id;
  if (typeof historyId !== "number") {
    return NextResponse.json({ error: "history_id (number) richiesto" }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data: hrow, error: hErr } = await supabase
    .from("home_content_history")
    .select("snapshot, home_content_id")
    .eq("history_id", historyId)
    .single();
  if (hErr) return NextResponse.json({ error: hErr.message }, { status: 500 });
  if (!hrow) return NextResponse.json({ error: "history row non trovata" }, { status: 404 });
  if (hrow.home_content_id !== id) {
    return NextResponse.json({ error: "history row non appartiene a questo item" }, { status: 400 });
  }

  const snap = hrow.snapshot as Record<string, any>;
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  for (const col of MUTABLE_COLS) {
    if (col in snap) patch[col] = snap[col];
  }

  const { data, error } = await supabase
    .from("home_content")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data, rolled_back_to: historyId });
}
