export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ═══════════════════════════════════════════════════
// Sync 22bet market-name dictionary into twobet_market_groups + twobet_market_outcomes.
// Pulls the public frontend bundle, extracts the two JSON objects, upserts.
// Idempotent: safe to re-run. Recommended schedule: weekly.
// ═══════════════════════════════════════════════════

const BUNDLE_URL = "https://22bets2.com/genfiles/cms/betstemplates/betsNames_full_it.js";

function extractBlock(src: string, varName: string): Record<string, any> | null {
  const idx = src.indexOf(`var ${varName}`);
  if (idx < 0) return null;
  const start = src.indexOf("{", idx);
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === "\"") { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(src.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

async function handle(req: NextRequest) {
  const key = req.headers.get("x-cron-key") ?? req.nextUrl.searchParams.get("key");
  if (!key || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const t0 = Date.now();
  let js: string;
  try {
    const resp = await fetch(BUNDLE_URL, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
    });
    if (!resp.ok) return NextResponse.json({ error: `HTTP ${resp.status}` }, { status: 502 });
    js = await resp.text();
  } catch (err) {
    return NextResponse.json({ error: `fetch failed: ${err instanceof Error ? err.message : err}` }, { status: 502 });
  }

  const betsModel = extractBlock(js, "betsModel") ?? {};
  const betsModelGroup = extractBlock(js, "betsModelGroup") ?? {};

  if (Object.keys(betsModelGroup).length === 0) {
    return NextResponse.json({ error: "Parsed 0 groups — bundle format changed?" }, { status: 500 });
  }

  // Count outcomes per group.
  const outcomeCount = new Map<number, number>();
  for (const [, v] of Object.entries(betsModel)) {
    const g = parseInt(String((v as any).IdG), 10);
    if (!Number.isFinite(g)) continue;
    outcomeCount.set(g, (outcomeCount.get(g) ?? 0) + 1);
  }

  // Upsert groups in batches.
  const groupRows = Object.entries(betsModelGroup)
    .map(([g, v]) => {
      const gNum = parseInt(g, 10);
      if (!Number.isFinite(gNum)) return null;
      return {
        twobet_g: gNum,
        name_it: String((v as any).N ?? "").slice(0, 500),
        outcome_count: outcomeCount.get(gNum) ?? 0,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  let groupsUpserted = 0;
  for (let i = 0; i < groupRows.length; i += 500) {
    const batch = groupRows.slice(i, i + 500);
    const { error } = await supabase
      .from("twobet_market_groups")
      .upsert(batch, { onConflict: "twobet_g" });
    if (error) return NextResponse.json({ error: `groups upsert: ${error.message}` }, { status: 500 });
    groupsUpserted += batch.length;
  }

  const outcomeRows = Object.entries(betsModel)
    .map(([t, v]) => {
      const tNum = parseInt(t, 10);
      const gNum = parseInt(String((v as any).IdG), 10);
      if (!Number.isFinite(tNum) || !Number.isFinite(gNum)) return null;
      if (!outcomeCount.has(gNum)) return null; // skip if parent group missing
      return {
        twobet_t: tNum,
        twobet_g: gNum,
        name_template_it: String((v as any).N ?? "").slice(0, 500),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  let outcomesUpserted = 0;
  for (let i = 0; i < outcomeRows.length; i += 1000) {
    const batch = outcomeRows.slice(i, i + 1000);
    const { error } = await supabase
      .from("twobet_market_outcomes")
      .upsert(batch, { onConflict: "twobet_t" });
    if (error) return NextResponse.json({ error: `outcomes upsert: ${error.message}` }, { status: 500 });
    outcomesUpserted += batch.length;
  }

  const result = {
    groups_upserted: groupsUpserted,
    outcomes_upserted: outcomesUpserted,
    duration_ms: Date.now() - t0,
    bundle_bytes: js.length,
  };

  await supabase.from("system_config").upsert(
    { key: "last_twobet_catalog_sync", value: JSON.stringify({ at: new Date().toISOString(), ...result }) },
    { onConflict: "key" }
  );

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) { return handle(req); }
export async function GET(req: NextRequest)  { return handle(req); }
