export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// E5 Phase 2 — Home CMS link health checker.
// For each active item with an href/image_url/icon_url/flag_url, do a HEAD
// (fallback GET) against the URL and update link_status ('ok' | 'broken').
// Internal paths (starting with /) are skipped — they're resolved at runtime.
//
// Rate-limited: processes at most 50 items per invocation (batches over multiple cron ticks).
// Recommended cron schedule: every 15 minutes.

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const BATCH_LIMIT = 50;
const CHECK_INTERVAL_HOURS = 6;

async function probeUrl(url: string): Promise<"ok" | "broken"> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal }).catch(() => null);
    // Some servers reject HEAD → fallback to GET (range: 0-0).
    if (!res || res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { Range: "bytes=0-0" },
      });
    }
    clearTimeout(timer);
    return res.ok || res.status === 206 ? "ok" : "broken";
  } catch {
    return "broken";
  }
}

function collectExternalUrls(row: any): string[] {
  const urls: string[] = [];
  for (const k of ["href", "image_url", "icon_url", "flag_url"]) {
    const v = row[k] as string | null;
    if (!v) continue;
    if (!/^https?:\/\//i.test(v)) continue; // skip internal paths
    urls.push(v);
  }
  return urls;
}

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-cron-key");
  if (!key || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  const cutoff = new Date(Date.now() - CHECK_INTERVAL_HOURS * 3600 * 1000).toISOString();

  const { data, error } = await supabase
    .from("home_content")
    .select("id, href, image_url, icon_url, flag_url, link_checked_at")
    .or(`link_checked_at.is.null,link_checked_at.lt.${cutoff}`)
    .limit(BATCH_LIMIT);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const summary = { checked: 0, ok: 0, broken: 0, skipped: 0 };

  for (const row of data ?? []) {
    const urls = collectExternalUrls(row);
    if (urls.length === 0) {
      await supabase.from("home_content").update({
        link_status: "unknown",
        link_checked_at: new Date().toISOString(),
      }).eq("id", row.id);
      summary.skipped++;
      continue;
    }

    // Row is "broken" if any external URL fails.
    const results = await Promise.all(urls.map(probeUrl));
    const status: "ok" | "broken" = results.every((r) => r === "ok") ? "ok" : "broken";
    await supabase.from("home_content").update({
      link_status: status,
      link_checked_at: new Date().toISOString(),
    }).eq("id", row.id);
    summary.checked++;
    if (status === "ok") summary.ok++;
    else summary.broken++;
  }

  return NextResponse.json({ ...summary, batch: data?.length ?? 0 });
}
