export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// E5 Phase 2 — Home CMS scheduler cron.
// Every minute:
//  - Items with published_from in the past AND is_active=false AND (published_until NULL OR future) → flip is_active=true.
//  - Items with published_until in the past AND is_active=true → flip is_active=false.
// Items without any window are untouched.

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-cron-key");
  if (!key || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  const now = new Date().toISOString();
  const summary = { activated: 0, deactivated: 0, errors: [] as string[] };

  // 1) Activate items whose window has opened.
  const { data: toActivate, error: aErr } = await supabase
    .from("home_content")
    .select("id")
    .eq("is_active", false)
    .lte("published_from", now)
    .or(`published_until.is.null,published_until.gt.${now}`);
  if (aErr) summary.errors.push(`select-activate: ${aErr.message}`);
  else if (toActivate && toActivate.length > 0) {
    const ids = toActivate.map((r) => r.id);
    const { error } = await supabase
      .from("home_content")
      .update({ is_active: true, updated_at: now })
      .in("id", ids);
    if (error) summary.errors.push(`update-activate: ${error.message}`);
    else summary.activated = ids.length;
  }

  // 2) Deactivate items whose window has closed.
  const { data: toDeactivate, error: dErr } = await supabase
    .from("home_content")
    .select("id")
    .eq("is_active", true)
    .lt("published_until", now);
  if (dErr) summary.errors.push(`select-deactivate: ${dErr.message}`);
  else if (toDeactivate && toDeactivate.length > 0) {
    const ids = toDeactivate.map((r) => r.id);
    const { error } = await supabase
      .from("home_content")
      .update({ is_active: false, updated_at: now })
      .in("id", ids);
    if (error) summary.errors.push(`update-deactivate: ${error.message}`);
    else summary.deactivated = ids.length;
  }

  return NextResponse.json({ ...summary, checked_at: now });
}
