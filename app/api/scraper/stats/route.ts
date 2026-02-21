import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const key = req.headers.get("x-scraper-key");
  if (!key || key !== process.env.SCRAPER_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const [live, prematch, finished] = await Promise.all([
    supabase.from("events").select("id", { count: "exact", head: true }).eq("is_live", true),
    supabase.from("events").select("id", { count: "exact", head: true }).eq("is_live", false).eq("status", "prematch"),
    supabase.from("events").select("id", { count: "exact", head: true }).eq("status", "finished"),
  ]);

  return NextResponse.json({
    live: live.count || 0,
    prematch: prematch.count || 0,
    finished: finished.count || 0,
  });
}
