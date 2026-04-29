export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { runOutcomeEngine } from "@/lib/normalize/outcome/engine";

// ═══════════════════════════════════════════════════
// /api/admin/outcome-normalization
// GET  ?action=list|kpis|canonicals|run-engine  — read / engine
// POST action=upsert | bulk-verify | bulk-clear | bulk-assign | clear-mapping
//
// 2026-04-25 review #3 hardening:
//  - upsert stamps confidence=100 on manual edit (parity with sister page)
//  - returns the saved row so client doesn't drift from DB
//  - new bulk-clear and bulk-assign actions
//  - canonicals action uses mig 113 RPC (in-use canonicals + count)
// ═══════════════════════════════════════════════════

const VALID_SOURCES = ["kambi", "22bet", "betfair", "all"];
const VALID_WRITABLE_SOURCES = ["kambi", "22bet", "betfair"];

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const action = sp.get("action") || "list";
  const source = sp.get("source") || "all";
  if (!VALID_SOURCES.includes(source)) {
    return NextResponse.json({ error: "Invalid source" }, { status: 400 });
  }
  const supa = createAdminClient();

  try {
    if (action === "kpis") {
      const { data, error } = await supa.rpc("outcome_norm_kpis", { p_source: source });
      if (error) throw error;
      return NextResponse.json({ kpis: (data?.[0] ?? null) });
    }

    if (action === "canonicals") {
      const { data, error } = await supa.rpc("outcome_norm_canonical_list");
      if (error) throw error;
      return NextResponse.json({ canonicals: data ?? [] });
    }

    if (action === "run-engine") {
      const chunk = parseInt(sp.get("chunk") || "500", 10);
      const summary = await runOutcomeEngine({ client: supa, chunkSize: chunk });
      return NextResponse.json(summary);
    }

    if (action === "list") {
      const q             = (sp.get("q") || "").trim() || null;
      const onlyUnmapped  = sp.get("only_unmapped") === "1";
      const onlyUnverified= sp.get("only_unverified") === "1";
      const canonical     = (sp.get("canonical") || "").trim() || null;
      const page          = Math.max(1, parseInt(sp.get("page") || "1", 10));
      const perPage       = Math.min(500, parseInt(sp.get("per_page") || "100", 10));
      const { data, error } = await supa.rpc("outcome_norm_list", {
        p_source: source, p_q: q,
        p_only_unmapped: onlyUnmapped,
        p_only_unverified: onlyUnverified,
        p_canonical_market: canonical,
        p_page: page, p_per_page: perPage,
      });
      if (error) throw error;
      const rows = data ?? [];
      const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
      return NextResponse.json({ rows, total, page, per_page: perPage });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    console.error("[outcome-normalization GET]", err);
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const action = body.action;
  const supa = createAdminClient();

  try {
    if (action === "upsert") {
      const { id, canonical_key, canonical_outcome_key, verified, notes } = body;
      if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

      // Validation: if both canonical_key and canonical_outcome_key are set,
      // ensure outcome_key ∈ canonical_markets.outcomes[*].key.
      if (canonical_key && canonical_outcome_key) {
        const { data: canonical, error: canonErr } = await supa
          .from("canonical_markets")
          .select("outcomes")
          .eq("canonical_key", canonical_key)
          .maybeSingle();
        if (canonErr) throw canonErr;
        if (!canonical) {
          return NextResponse.json({ error: `canonical_key "${canonical_key}" non trovato in canonical_markets` }, { status: 400 });
        }
        const allowedKeys: string[] = Array.isArray(canonical.outcomes)
          ? (canonical.outcomes as any[]).map((o) => o?.key).filter(Boolean)
          : [];
        if (allowedKeys.length > 0 && !allowedKeys.includes(canonical_outcome_key)) {
          return NextResponse.json({
            error: `canonical_outcome_key "${canonical_outcome_key}" non è tra gli outcomes ammessi per "${canonical_key}": [${allowedKeys.join(", ")}]`,
          }, { status: 400 });
        }
      }

      // Bug A parity with sister page: a manual edit must stamp both
      // extracted_by AND confidence so the UI/DB don't drift after reload.
      // NOTE: we deliberately do NOT auto-set verified=true on manual edit —
      // operator may want to save canonical_key first and verify later.
      const updates: any = {
        canonical_key: canonical_key ?? null,
        canonical_outcome_key: canonical_outcome_key ?? null,
        verified: !!verified,
        notes: notes ?? null,
        extracted_by: "manual",
        confidence: 100,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await supa
        .from("outcome_normalization")
        .update(updates)
        .eq("id", id)
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: `id ${id} not found` }, { status: 404 });
      return NextResponse.json({ ok: true, row: data });
    }

    if (action === "bulk-verify") {
      const { ids, verified } = body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return NextResponse.json({ error: "ids array required" }, { status: 400 });
      }
      const { error, count } = await supa
        .from("outcome_normalization")
        .update({ verified: !!verified, updated_at: new Date().toISOString() }, { count: "exact" })
        .in("id", ids);
      if (error) throw error;
      return NextResponse.json({ ok: true, count: count ?? ids.length });
    }

    // ── bulk-clear: nullify canonical_*/verified for selected ids
    if (action === "bulk-clear") {
      const { ids } = body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return NextResponse.json({ error: "ids array required" }, { status: 400 });
      }
      const { error, count } = await supa
        .from("outcome_normalization")
        .update({
          canonical_key: null,
          canonical_outcome_key: null,
          verified: false,
          extracted_by: "manual",
          confidence: null,
          updated_at: new Date().toISOString(),
        }, { count: "exact" })
        .in("id", ids);
      if (error) throw error;
      return NextResponse.json({ ok: true, count: count ?? ids.length });
    }

    // ── bulk-assign: set canonical_key (+ optional outcome key) for many rows
    if (action === "bulk-assign") {
      const { ids, canonical_key, canonical_outcome_key } = body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return NextResponse.json({ error: "ids array required" }, { status: 400 });
      }
      const ck = (canonical_key ?? "").trim();
      if (!ck) return NextResponse.json({ error: "canonical_key required for bulk-assign" }, { status: 400 });

      // Validate canonical exists + (if outcome supplied) outcome ∈ canonical.outcomes.
      const { data: cm, error: cmErr } = await supa
        .from("canonical_markets")
        .select("outcomes")
        .eq("canonical_key", ck)
        .maybeSingle();
      if (cmErr) throw cmErr;
      if (!cm) return NextResponse.json({ error: `canonical_key "${ck}" non esiste in canonical_markets` }, { status: 400 });

      const cok = (canonical_outcome_key ?? "").trim() || null;
      if (cok) {
        const allowed: string[] = Array.isArray(cm.outcomes)
          ? (cm.outcomes as any[]).map((o) => o?.key).filter(Boolean)
          : [];
        if (allowed.length > 0 && !allowed.includes(cok)) {
          return NextResponse.json({
            error: `canonical_outcome_key "${cok}" non ammesso per "${ck}": [${allowed.join(", ")}]`,
          }, { status: 400 });
        }
      }

      const { error, count } = await supa
        .from("outcome_normalization")
        .update({
          canonical_key: ck,
          canonical_outcome_key: cok,
          extracted_by: "manual",
          confidence: 100,
          verified: !!body.verified,
          updated_at: new Date().toISOString(),
        }, { count: "exact" })
        .in("id", ids);
      if (error) throw error;
      return NextResponse.json({ ok: true, count: count ?? ids.length });
    }

    if (action === "clear-mapping") {
      const { id } = body;
      if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const { error } = await supa.from("outcome_normalization").update({
        canonical_key: null,
        canonical_outcome_key: null,
        verified: false,
        extracted_by: "manual",
        confidence: null,
        updated_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    console.error("[outcome-normalization POST]", err);
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}
