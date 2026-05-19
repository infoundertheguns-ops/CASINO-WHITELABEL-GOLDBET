export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Admin endpoint receiving cycle health metrics from the api-football
 * ingester service (M1.13). Mirrors the flashscore/sofascore stats-push
 * pattern: shared-secret auth via `x-scraper-key`, persistence into
 * `system_config` as a rolling history (cap = HISTORY_CAP).
 *
 * Body shape (matches `CycleStats` from services/api-football-ingester):
 *   {
 *     cycleStartedAt: string (ISO),
 *     cycleDurationMs: number,
 *     endpointCalls: Record<string, number>,
 *     errors: Record<string, number>,
 *     rateLimitRemaining: number | null,
 *   }
 *
 * Storage key: `api_football_stats` in `system_config`.
 * Value shape:
 *   { cycles: Array<CycleStats & { receivedAt: string }> }
 *
 * Dedup policy: duplicates accepted as-is. The ingester scheduler is the
 * single producer with a monotonic clock per cycle; cycleStartedAt
 * collisions are unexpected and tagging a 409 here would add complexity
 * with no benefit. Receiver records receivedAt for observability.
 */

const HISTORY_CAP = 100;
const STORAGE_KEY = "api_football_stats";

interface CycleStatsBody {
  cycleStartedAt: string;
  cycleDurationMs: number;
  endpointCalls: Record<string, number>;
  errors: Record<string, number>;
  rateLimitRemaining: number | null;
}

function isCycleStatsBody(x: unknown): x is CycleStatsBody {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.cycleStartedAt !== "string") return false;
  if (typeof o.cycleDurationMs !== "number") return false;
  if (!o.endpointCalls || typeof o.endpointCalls !== "object") return false;
  if (!o.errors || typeof o.errors !== "object") return false;
  if (o.rateLimitRemaining !== null && typeof o.rateLimitRemaining !== "number") return false;
  return true;
}

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-scraper-key");
  if (!key || key !== process.env.SCRAPER_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isCycleStatsBody(body)) {
    return NextResponse.json({ error: "Invalid body shape" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { fetch: (input, init) => fetch(input, { ...(init as RequestInit), cache: "no-store" }) } },
  );

  // Read existing rolling history.
  const { data: existing } = await supabase
    .from("system_config")
    .select("value")
    .eq("key", STORAGE_KEY)
    .maybeSingle();

  let cycles: Array<CycleStatsBody & { receivedAt: string }> = [];
  if (existing?.value) {
    try {
      const parsed = typeof existing.value === "string" ? JSON.parse(existing.value) : existing.value;
      if (parsed && Array.isArray((parsed as { cycles?: unknown }).cycles)) {
        cycles = (parsed as { cycles: Array<CycleStatsBody & { receivedAt: string }> }).cycles;
      }
    } catch {
      cycles = [];
    }
  }

  const entry: CycleStatsBody & { receivedAt: string } = {
    ...body,
    receivedAt: new Date().toISOString(),
  };

  // Prepend new cycle, cap at HISTORY_CAP entries.
  cycles = [entry, ...cycles].slice(0, HISTORY_CAP);

  const newValue = JSON.stringify({ cycles });

  const { error: upsertErr } = await supabase
    .from("system_config")
    .upsert({ key: STORAGE_KEY, value: newValue }, { onConflict: "key" });

  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, stored: cycles.length });
}
