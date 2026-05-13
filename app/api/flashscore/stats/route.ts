export const dynamic = "force-dynamic";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

// ═══════════════════════════════════════════════════
// Flashscore Scraper Stats Endpoint
// Receives per-cycle telemetry from /root/flashscore-scraper.
// Stores in system_config as JSON blob (key per cycleType) with
// rolling history of last MAX_HISTORY cycles + monotonic totals.
// Dashboard polls latest blob to render trends (p50/p95, error rate).
// ═══════════════════════════════════════════════════

const MAX_HISTORY = 100;
const VALID_CYCLE_TYPES = new Set(["live", "results", "fixtures"]);

interface CycleEntry {
  at: string;
  duration_ms: number;
  errors: number;
}

interface StatsBlob {
  cycle_type: string;
  total_cycles: number;
  total_errors: number;
  history: CycleEntry[];
  last_cycle_at: string;
}

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-scraper-key");
  if (!key || key !== process.env.SCRAPER_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { cycleType?: string; durationMs?: number; errors?: number; ts?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { cycleType, durationMs, errors, ts } = body;

  if (!cycleType || !VALID_CYCLE_TYPES.has(cycleType)) {
    return NextResponse.json(
      { error: "Invalid cycleType (expected live|results|fixtures)" },
      { status: 400 },
    );
  }
  if (typeof durationMs !== "number" || durationMs < 0 || !Number.isFinite(durationMs)) {
    return NextResponse.json({ error: "Invalid durationMs (positive finite number)" }, { status: 400 });
  }
  if (typeof errors !== "number" || errors < 0 || !Number.isFinite(errors)) {
    return NextResponse.json({ error: "Invalid errors (non-negative finite number)" }, { status: 400 });
  }

  const at = ts && !Number.isNaN(Date.parse(ts)) ? new Date(ts).toISOString() : new Date().toISOString();
  const configKey = `fs_scraper_stats_${cycleType}`;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: existing } = await supabase
    .from("system_config")
    .select("value")
    .eq("key", configKey)
    .maybeSingle();

  let blob: StatsBlob;
  if (existing && existing.value) {
    try {
      const parsed = typeof existing.value === "string" ? JSON.parse(existing.value) : existing.value;
      blob = {
        cycle_type: cycleType,
        total_cycles: typeof parsed.total_cycles === "number" ? parsed.total_cycles : 0,
        total_errors: typeof parsed.total_errors === "number" ? parsed.total_errors : 0,
        history: Array.isArray(parsed.history) ? parsed.history : [],
        last_cycle_at: at,
      };
    } catch {
      blob = { cycle_type: cycleType, total_cycles: 0, total_errors: 0, history: [], last_cycle_at: at };
    }
  } else {
    blob = { cycle_type: cycleType, total_cycles: 0, total_errors: 0, history: [], last_cycle_at: at };
  }

  blob.history.push({ at, duration_ms: durationMs, errors });
  if (blob.history.length > MAX_HISTORY) {
    blob.history = blob.history.slice(-MAX_HISTORY);
  }
  blob.total_cycles += 1;
  blob.total_errors += errors;
  blob.last_cycle_at = at;

  const { error: upsertErr } = await supabase
    .from("system_config")
    .upsert({ key: configKey, value: JSON.stringify(blob) }, { onConflict: "key" });

  if (upsertErr) {
    return NextResponse.json({ error: "Storage failed", details: upsertErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    cycle_type: cycleType,
    total_cycles: blob.total_cycles,
    total_errors: blob.total_errors,
    history_length: blob.history.length,
  });
}
