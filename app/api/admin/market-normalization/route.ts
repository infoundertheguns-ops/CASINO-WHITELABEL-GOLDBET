export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { runEngine } from "@/lib/normalize/engine";
import { isItalian } from "@/lib/admin/market-language-heuristic";

// ═══════════════════════════════════════════════════
// API: Market Normalization editor.
//
// 2026-04-25 review #2 hardening:
//  - POST persists canonical_line and stamps extracted_by='manual'/conf=100
//    (Bug A/B); returns the saved row so the client doesn't drift from DB.
//  - PATCH supports bulk-confirm (single query / source), bulk-clear,
//    bulk-assign with optional canonical_line. (Bug D + spec L)
//  - canonical-keys uses new RPC (Bug E, no full-table scan).
//  - list propagates p_canonical_key for drill-from-canonical-markets (Bug C).
//  - dead `suggest` endpoint removed (spec O).
// ═══════════════════════════════════════════════════

const VALID_SOURCES = ["flashscore", "odds-api"];

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const action = sp.get("action") || "list";
  const source = sp.get("source") || "odds-api";

  if (source !== "all" && !VALID_SOURCES.includes(source)) {
    return NextResponse.json({ error: "Invalid source" }, { status: 400 });
  }

  const supabase = createAdminClient();

  try {
    if (action === "list") {
      return await list(supabase, source, sp);
    }
    if (action === "canonical-keys") {
      return await canonicalKeys(supabase);
    }
    if (action === "run-engine") {
      return await runEngineChunk(supabase, sp, false);
    }
    if (action === "run-engine-llm") {
      return await runEngineChunk(supabase, sp, true);
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    console.error("[market-normalization]", err);
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}

async function list(supabase: any, source: string, sp: URLSearchParams) {
  const onlyUnmapped   = sp.get("only_unmapped") === "1";
  const onlyUnverified = sp.get("only_unverified") === "1";
  const q              = (sp.get("q") || "").trim() || null;
  const confBucket     = sp.get("conf") || "all";
  const extractedBy    = (sp.get("extracted_by") || "").trim() || null;
  const canonicalKey   = (sp.get("canonical_key") || "").trim() || null; // Bug C
  const lang           = (sp.get("lang") || "").trim();
  const page           = Math.max(1, parseInt(sp.get("page") || "1", 10));
  const perPage        = Math.min(500, parseInt(sp.get("per_page") || "100", 10));
  const sourceFilter   = source === "all" || !source ? null : source;

  const { data, error } = await supabase.rpc("list_markets_normalization_paged", {
    p_source_filter:   sourceFilter,
    p_q:               q,
    p_only_unmapped:   onlyUnmapped,
    p_only_unverified: onlyUnverified,
    p_conf_bucket:     confBucket,
    p_extracted_by:    extractedBy,
    p_canonical_key:   canonicalKey,
    p_page:            page,
    p_per_page:        perPage,
  });
  if (error) throw error;

  const payload = data || { rows: [], total_rows: 0, total_mapped: 0, total_verified: 0, total_volume: 0, mapped_volume: 0, verified_volume: 0 };
  const totalRows = payload.total_rows ?? 0;
  const mappedRows = payload.total_mapped ?? 0;
  const verifiedRows = payload.total_verified ?? 0;
  const totalVolume = Number(payload.total_volume ?? 0);
  const mappedVolume = Number(payload.mapped_volume ?? 0);
  const verifiedVolume = Number(payload.verified_volume ?? 0);

  let rows: any[] = (payload.rows ?? []).map((r: any) => ({
    ...r,
    is_italian: isItalian(r.source_market_type || ""),
  }));

  // Lang post-filter — known to be page-scoped (caveat surfaced in UI hint).
  if (lang === "it") rows = rows.filter((r) => r.is_italian);
  else if (lang === "en") rows = rows.filter((r) => !r.is_italian);

  return NextResponse.json({
    rows,
    page,
    per_page: perPage,
    total_rows: totalRows,
    lang_filtered_in_page: lang ? rows.length : null,
    kpis: {
      total_volume:     totalVolume,
      mapped_volume:    mappedVolume,
      unmapped_volume:  totalVolume - mappedVolume,
      verified_volume:  verifiedVolume,
      coverage_pct:     totalVolume > 0 ? Math.round((mappedVolume / totalVolume) * 1000) / 10 : 0,
      total:    totalRows,
      mapped:   mappedRows,
      unmapped: totalRows - mappedRows,
      verified: verifiedRows,
    },
  });
}

async function canonicalKeys(supabase: any) {
  // Bug E: use server-side aggregation RPC.
  const { data, error } = await supabase.rpc("get_market_normalization_canonical_keys");
  if (error) {
    // Fallback for envs without mig 112: previous JS aggregation.
    if (/function .* does not exist/i.test(error.message) || /could not find/i.test(error.message)) {
      const r = await supabase
        .from("market_normalization")
        .select("canonical_key, canonical_name_it")
        .not("canonical_key", "is", null);
      if (r.error) throw r.error;
      const map = new Map<string, { canonical_key: string; canonical_name_it: string; count: number }>();
      for (const row of r.data ?? []) {
        const k = row.canonical_key as string;
        const e = map.get(k);
        if (e) e.count++;
        else map.set(k, { canonical_key: k, canonical_name_it: row.canonical_name_it || "", count: 1 });
      }
      const keys = Array.from(map.values()).sort((a, b) => b.count - a.count);
      return NextResponse.json({ keys, fallback: true });
    }
    throw error;
  }
  return NextResponse.json({ keys: data ?? [] });
}

// ═══ POST — upsert a mapping row (manual edit) ═══
export async function POST(req: NextRequest) {
  const supabase = createAdminClient();
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const source = body.source;
  const source_market_type = body.source_market_type;
  if (!VALID_SOURCES.includes(source)) return NextResponse.json({ error: "Invalid source" }, { status: 400 });
  if (!source_market_type) return NextResponse.json({ error: "source_market_type required" }, { status: 400 });

  const canonical_key = (body.canonical_key ?? "").trim() || null;
  const canonical_name_it = (body.canonical_name_it ?? "").trim() || null;
  const verified = !!body.verified;
  const notes = (body.notes ?? "").trim() || null;

  // Bug A: canonical_line was being silently dropped by the upsert.
  let canonical_line: number | null = null;
  if (body.canonical_line != null && body.canonical_line !== "") {
    const n = Number(body.canonical_line);
    if (!Number.isFinite(n)) return NextResponse.json({ error: "canonical_line must be numeric" }, { status: 400 });
    canonical_line = n;
  }

  // Bug B: a manual edit must overwrite extracted_by/confidence so the UI
  // and DB stay consistent (otherwise the row keeps reading as regex/dictionary
  // even after operator override).
  const payload: Record<string, any> = {
    source,
    source_market_type,
    canonical_key,
    canonical_name_it,
    canonical_line,
    verified,
    notes,
    extracted_by: "manual",
    confidence: 100,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("market_normalization")
    .upsert(payload, { onConflict: "source,source_market_type" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ row: data });
}

// ═══ DELETE — clear mapping ═══
export async function DELETE(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const source = sp.get("source");
  const source_market_type = sp.get("source_market_type");
  if (!source || !source_market_type) return NextResponse.json({ error: "source + source_market_type required" }, { status: 400 });

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("market_normalization")
    .delete()
    .eq("source", source)
    .eq("source_market_type", source_market_type);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

async function runEngineChunk(supabase: any, sp: URLSearchParams, useLlm: boolean) {
  const chunk = parseInt(sp.get("chunk") || "500", 10);
  const llmBudget = parseInt(sp.get("llm_budget") || "", 10);
  const llmBatchSize = parseInt(sp.get("llm_batch") || "", 10);
  const llmMinConf = parseInt(sp.get("llm_min_conf") || "", 10);
  const summary = await runEngine({
    client: supabase,
    chunkSize: Math.min(chunk, 1000),
    useLlm,
    llmBudgetBatches: Number.isFinite(llmBudget) ? llmBudget : undefined,
    llmBatchSize: Number.isFinite(llmBatchSize) ? llmBatchSize : undefined,
    llmMinConfidence: Number.isFinite(llmMinConf) ? llmMinConf : undefined,
  });
  return NextResponse.json(summary);
}

// ═══ PATCH — bulk operations ═══
export async function PATCH(req: NextRequest) {
  const supabase = createAdminClient();
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const action = body.action;
  const items: Array<{ source: string; source_market_type: string }> = body.items ?? [];

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "items[] required" }, { status: 400 });
  }
  if (items.length > 1000) {
    return NextResponse.json({ error: "max 1000 items per call" }, { status: 400 });
  }

  // Group items by source so we can run a single batched UPDATE/DELETE per source.
  const bySource = new Map<string, string[]>();
  for (const it of items) {
    if (!VALID_SOURCES.includes(it.source)) continue;
    const arr = bySource.get(it.source) ?? [];
    arr.push(it.source_market_type);
    bySource.set(it.source, arr);
  }

  // ── bulk-confirm: set verified=true preserving extracted_by/confidence
  if (action === "bulk-confirm") {
    let confirmed = 0;
    for (const [src, types] of bySource) {
      const { error, count } = await supabase
        .from("market_normalization")
        .update({ verified: true, updated_at: new Date().toISOString() }, { count: "exact" })
        .eq("source", src)
        .in("source_market_type", types);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      confirmed += count ?? 0;
    }
    return NextResponse.json({ confirmed });
  }

  // ── bulk-clear: delete the mapping rows entirely
  if (action === "bulk-clear") {
    let cleared = 0;
    for (const [src, types] of bySource) {
      const { error, count } = await supabase
        .from("market_normalization")
        .delete({ count: "exact" })
        .eq("source", src)
        .in("source_market_type", types);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      cleared += count ?? 0;
    }
    return NextResponse.json({ cleared });
  }

  // ── bulk-assign: set canonical_key (+ optional canonical_line) for many rows
  if (action === "bulk-assign") {
    const canonical_key = (body.canonical_key ?? "").trim();
    if (!canonical_key) return NextResponse.json({ error: "canonical_key required for bulk-assign" }, { status: 400 });
    const canonical_line = body.canonical_line == null || body.canonical_line === ""
      ? null
      : Number(body.canonical_line);
    if (canonical_line != null && !Number.isFinite(canonical_line)) {
      return NextResponse.json({ error: "canonical_line must be numeric" }, { status: 400 });
    }

    // Pull the canonical name once so the mapping row carries it.
    const cm = await supabase
      .from("canonical_markets")
      .select("canonical_name_it")
      .eq("canonical_key", canonical_key)
      .maybeSingle();
    if (cm.error) return NextResponse.json({ error: cm.error.message }, { status: 500 });
    if (!cm.data) return NextResponse.json({ error: `canonical_key "${canonical_key}" non esiste in canonical_markets` }, { status: 400 });
    const canonicalNameIt = cm.data.canonical_name_it as string;

    let assigned = 0;
    for (const [src, types] of bySource) {
      // Build upsert payloads — bulk UPDATE alone wouldn't insert missing rows
      // (rare but possible if a market_type appeared since last engine run).
      const rows = types.map((smt) => ({
        source: src,
        source_market_type: smt,
        canonical_key,
        canonical_name_it: canonicalNameIt,
        canonical_line,
        extracted_by: "manual",
        confidence: 100,
        verified: !!body.verified, // optional flag
        updated_at: new Date().toISOString(),
      }));
      const { error, count } = await supabase
        .from("market_normalization")
        .upsert(rows, { onConflict: "source,source_market_type", count: "exact" });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      assigned += count ?? rows.length;
    }
    return NextResponse.json({ assigned });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
