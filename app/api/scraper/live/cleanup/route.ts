import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-scraper-key");
  if (!key || key !== process.env.SCRAPER_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { current_live_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const currentIds = body.current_live_ids;
  if (!Array.isArray(currentIds)) {
    return NextResponse.json({ error: "current_live_ids array required" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Find events that are is_live=true but NOT in the current live feed
  const { data: staleEvents, error: fetchErr } = await supabase
    .from("events")
    .select("id, external_id")
    .eq("is_live", true);

  if (fetchErr || !staleEvents) {
    return NextResponse.json({ finished: 0, error: fetchErr?.message });
  }

  const currentSet = new Set(currentIds);
  const toFinish = staleEvents.filter((e) => !currentSet.has(e.external_id));

  if (toFinish.length === 0) {
    return NextResponse.json({ finished: 0 });
  }

  const ids = toFinish.map((e) => e.id);
  const { error: updateErr } = await supabase
    .from("events")
    .update({
      is_live: false,
      status: "finished",
      updated_at: new Date().toISOString(),
    })
    .in("id", ids);

  if (updateErr) {
    return NextResponse.json({ finished: 0, error: updateErr.message });
  }

  return NextResponse.json({ finished: toFinish.length });
}
