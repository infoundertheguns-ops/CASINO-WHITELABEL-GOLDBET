export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase = createAdminClient();
  const sp = req.nextUrl.searchParams;
  const action = sp.get("action") || "list";

  if (action === "periods") {
    const { data, error } = await supabase
      .from("canonical_markets")
      .select("period")
      .order("period");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const periods = Array.from(new Set((data ?? []).map((r: any) => r.period).filter(Boolean)));
    return NextResponse.json({ periods });
  }

  if (action === "check_key") {
    // Realtime uniqueness check used by create-form (debounced).
    const key = sp.get("canonical_key");
    if (!key) return NextResponse.json({ error: "canonical_key required" }, { status: 400 });
    const { count, error } = await supabase
      .from("canonical_markets")
      .select("*", { count: "exact", head: true })
      .eq("canonical_key", key);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ exists: (count ?? 0) > 0 });
  }

  if (action === "get") {
    const key = sp.get("canonical_key");
    if (!key) return NextResponse.json({ error: "canonical_key required" }, { status: 400 });
    const { data, error } = await supabase
      .from("canonical_markets")
      .select("*")
      .eq("canonical_key", key)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    // Count refs from BOTH market_normalization AND outcome_normalization.
    // canDelete in the modal needs both — see mig 114 + review #1bis.
    const [{ count: mCount }, { count: oCount }] = await Promise.all([
      supabase.from("market_normalization").select("*", { count: "exact", head: true }).eq("canonical_key", key),
      supabase.from("outcome_normalization").select("*", { count: "exact", head: true }).eq("canonical_key", key),
    ]);
    return NextResponse.json({
      row: { ...data, mapped_count: mCount ?? 0, outcome_count: oCount ?? 0 },
    });
  }

  // action === "list" (default) — uses RPC `get_canonical_markets_overview`
  // (mig 114 v2: includes outcome_count). Mig 114 is deployed everywhere we
  // care about; if missing, fail loudly so the operator notices instead of
  // silently degrading to a buggy fallback.
  const { data, error } = await supabase.rpc("get_canonical_markets_overview");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = createAdminClient();
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const required = ["canonical_key", "base_key", "period", "canonical_name_it", "outcomes"];
  for (const k of required) {
    if (body[k] == null || (typeof body[k] === "string" && !body[k].trim())) {
      return NextResponse.json({ error: `${k} required` }, { status: 400 });
    }
  }

  const canonical_key = String(body.canonical_key).trim();
  const base_key = String(body.base_key).trim();
  const period = String(body.period).trim();

  // Soft-enforce convention: canonical_key === `${base_key}_${period}`.
  // Override with allow_inconsistent_key=true (rare cases like legacy keys).
  const expected = `${base_key}_${period}`;
  if (canonical_key !== expected && !body.allow_inconsistent_key) {
    return NextResponse.json({
      error: `canonical_key "${canonical_key}" non coincide con base_key+period "${expected}". Aggiungi allow_inconsistent_key=true per forzare.`,
      suggested: expected,
    }, { status: 400 });
  }

  // Validate outcome key uniqueness server-side.
  if (!Array.isArray(body.outcomes) || body.outcomes.length === 0) {
    return NextResponse.json({ error: "outcomes deve avere almeno 1 elemento" }, { status: 400 });
  }
  const seen = new Set<string>();
  for (const o of body.outcomes) {
    const k = String(o?.key ?? "").trim();
    if (!k) return NextResponse.json({ error: "ogni outcome richiede 'key' non vuoto" }, { status: 400 });
    if (seen.has(k)) {
      return NextResponse.json({ error: `outcome key duplicato: "${k}"` }, { status: 400 });
    }
    seen.add(k);
  }

  // Let the DB trigger handle updated_at — don't stamp it from the app to
  // avoid clock skew or overriding triggers.
  const payload = {
    canonical_key,
    base_key,
    period,
    canonical_name_it: String(body.canonical_name_it).trim(),
    has_line: !!body.has_line,
    outcomes: body.outcomes,
    notes: body.notes ?? null,
  };
  const { data, error } = await supabase
    .from("canonical_markets")
    .upsert(payload, { onConflict: "canonical_key" })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ row: data });
}

export async function DELETE(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const key = sp.get("canonical_key");
  if (!key) return NextResponse.json({ error: "canonical_key required" }, { status: 400 });

  const supabase = createAdminClient();
  // Block delete if EITHER market_normalization OR outcome_normalization
  // references this canonical — pre-mig 114 the check only covered markets,
  // so canonicals with outcome refs could be silently orphaned.
  const [{ count: mCount }, { count: oCount }] = await Promise.all([
    supabase.from("market_normalization").select("*", { count: "exact", head: true }).eq("canonical_key", key),
    supabase.from("outcome_normalization").select("*", { count: "exact", head: true }).eq("canonical_key", key),
  ]);
  if ((mCount ?? 0) > 0 || (oCount ?? 0) > 0) {
    const refs = [
      (mCount ?? 0) > 0 ? `${mCount} market_normalization` : null,
      (oCount ?? 0) > 0 ? `${oCount} outcome_normalization` : null,
    ].filter(Boolean).join(" + ");
    return NextResponse.json({
      error: `Cannot delete: ${refs} reference this canonical. Unmap first.`,
      mapped_count: mCount ?? 0,
      outcome_count: oCount ?? 0,
    }, { status: 409 });
  }
  const { error } = await supabase
    .from("canonical_markets")
    .delete()
    .eq("canonical_key", key);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
