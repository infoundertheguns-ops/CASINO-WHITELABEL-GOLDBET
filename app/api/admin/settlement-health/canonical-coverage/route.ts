export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { CANONICAL_TO_SETTLER, VOID_BY_DESIGN } from "@/lib/settlement/canonical-dispatcher";

// Settlement Phase B/C — Canonical Coverage snapshot.
// Returns per-canonical_key:
//   - canonical_name_it
//   - has_settler       (registered in CANONICAL_TO_SETTLER)
//   - void_by_design    (intentionally unsettleable)
//   - source_breakdown  (per-source market_types count + verified count)
// Plus totals: settleable / void_by_design / no_settler (gap).
//
// Use this to visualize where the canonical dispatch covers vs leaks.

interface CanonicalRow {
  canonical_key: string;
  canonical_name_it: string | null;
  has_settler: boolean;
  void_by_design: boolean;
  total_mappings: number;
  verified_mappings: number;
  by_source: Record<string, { total: number; verified: number }>;
}

export async function GET(_req: NextRequest) {
  const supabase = createAdminClient();

  // Pull all verified (or high-conf auto) mappings from market_normalization.
  const { data: rows, error } = await supabase
    .from("market_normalization")
    .select("source, canonical_key, canonical_name_it, verified, confidence")
    .not("canonical_key", "is", null)
    .limit(50000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byCanonical = new Map<string, CanonicalRow>();

  for (const r of rows ?? []) {
    if (!r.canonical_key) continue;
    const trusted = r.verified === true || (typeof r.confidence === "number" && r.confidence >= 90);
    if (!trusted) continue;

    let bucket = byCanonical.get(r.canonical_key);
    if (!bucket) {
      const hasSettler = r.canonical_key in CANONICAL_TO_SETTLER;
      const voidByDesign = VOID_BY_DESIGN.has(r.canonical_key);
      bucket = {
        canonical_key: r.canonical_key,
        canonical_name_it: r.canonical_name_it ?? null,
        has_settler: hasSettler,
        void_by_design: voidByDesign,
        total_mappings: 0,
        verified_mappings: 0,
        by_source: {},
      };
      byCanonical.set(r.canonical_key, bucket);
    }

    const src = r.source as string;
    if (!bucket.by_source[src]) bucket.by_source[src] = { total: 0, verified: 0 };
    bucket.by_source[src].total++;
    bucket.total_mappings++;
    if (r.verified) {
      bucket.by_source[src].verified++;
      bucket.verified_mappings++;
    }
  }

  const list = Array.from(byCanonical.values())
    .sort((a, b) => b.total_mappings - a.total_mappings);

  const totals = {
    canonicals: list.length,
    settleable: list.filter((c) => c.has_settler).length,
    void_by_design: list.filter((c) => c.void_by_design).length,
    gap: list.filter((c) => !c.has_settler && !c.void_by_design).length,
    total_mappings: list.reduce((a, c) => a + c.total_mappings, 0),
    settleable_mappings: list.filter((c) => c.has_settler).reduce((a, c) => a + c.total_mappings, 0),
  };

  return NextResponse.json({ totals, canonicals: list });
}
