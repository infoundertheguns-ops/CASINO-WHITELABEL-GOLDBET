export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// E5 Phase 2 — History log per home_content item.
// GET  /api/admin/home-content/:id/history → list of (history_id, action, changed_at, changed_by, snapshot)

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("home_content_history")
    .select("history_id, action, changed_at, changed_by, snapshot")
    .eq("home_content_id", id)
    .order("changed_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ history: data ?? [] });
}
