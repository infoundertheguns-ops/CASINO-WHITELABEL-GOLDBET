export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// GET /api/admin/canonical-markets/[key]/usage
// Drill-down: returns all rows in market_normalization + outcome_normalization
// that reference this canonical_key. Used by CanonicalMarketDetailModal
// "Mapped markets" and "Mapped outcomes" tabs.
//
// Query params (review #1bis — reduce noise on canonicals with 500+ rows):
//   onlyVerified=true → only verified=true rows
//   onlyManual=true   → only extracted_by='manual' rows
export async function GET(
  req: NextRequest,
  { params }: { params: { key: string } }
) {
  const key = params.key;
  if (!key) return NextResponse.json({ error: "canonical_key required" }, { status: 400 });

  const sp = req.nextUrl.searchParams;
  const onlyVerified = sp.get("onlyVerified") === "true";
  const onlyManual = sp.get("onlyManual") === "true";

  const supabase = createAdminClient();

  let mq = supabase
    .from("market_normalization")
    .select("source, source_market_type, canonical_line, verified, extracted_by, confidence, updated_at")
    .eq("canonical_key", key);
  let oq = supabase
    .from("outcome_normalization")
    .select("id, source, source_market_type, source_outcome_name, canonical_outcome_key, verified, extracted_by, confidence, updated_at")
    .eq("canonical_key", key);
  if (onlyVerified) { mq = mq.eq("verified", true); oq = oq.eq("verified", true); }
  if (onlyManual)   { mq = mq.eq("extracted_by", "manual"); oq = oq.eq("extracted_by", "manual"); }

  const [markets, outcomes] = await Promise.all([
    mq.order("source").order("source_market_type").limit(500),
    oq.order("source").order("canonical_outcome_key").limit(2000),
  ]);

  if (markets.error) return NextResponse.json({ error: markets.error.message }, { status: 500 });
  if (outcomes.error) return NextResponse.json({ error: outcomes.error.message }, { status: 500 });

  return NextResponse.json({
    markets: markets.data ?? [],
    outcomes: outcomes.data ?? [],
    counts: {
      markets: markets.data?.length ?? 0,
      outcomes: outcomes.data?.length ?? 0,
    },
    filters: { onlyVerified, onlyManual },
  });
}
