export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ENRICHMENT_KEYS } from "../enrichment/_lib";

export async function GET(_req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { fetch: (input, init) => fetch(input, { ...(init as RequestInit), cache: 'no-store' }) } },
  );

  // matched_total + by_sport
  const { data: matched } = await supabase
    .from("events_v2")
    .select("sport_slug")
    .not("sofascore_id", "is", null)
    .in("sport_slug", ["football", "tennis", "basketball"]);
  const by_sport: Record<string, number> = { football: 0, tennis: 0, basketball: 0, baseball: 0, esports: 0, handball: 0, rugby: 0, darts: 0, "ice-hockey": 0, cricket: 0, volleyball: 0, boxing: 0, mma: 0, "american-football": 0, snooker: 0 };
  for (const r of (matched ?? []) as Array<{ sport_slug: string }>) {
    const k = r.sport_slug as keyof typeof by_sport;
    if (k in by_sport) by_sport[k]++;
  }

  // by_endpoint_freshness
  const cols = ["event_v2_id", "last_synced_at", ...ENRICHMENT_KEYS].join(", ");
  const { data: rows } = await supabase
    .from("event_enrichment")
    .select(cols);

  const total = rows?.length ?? 0;
  const by_endpoint_freshness: Record<
    string,
    { populated_pct: number; median_age_s: number }
  > = {};
  const now = Date.now();
  for (const k of ENRICHMENT_KEYS) {
    let populated = 0;
    const ages: number[] = [];
    for (const r of (rows ?? []) as unknown as Array<Record<string, unknown>>) {
      if (r[k] != null) {
        populated++;
        const lsa = r.last_synced_at as string | null | undefined;
        if (lsa) ages.push((now - new Date(lsa).getTime()) / 1000);
      }
    }
    ages.sort((a, b) => a - b);
    const median = ages.length ? ages[Math.floor(ages.length / 2)] : 0;
    by_endpoint_freshness[k] = {
      populated_pct: total ? Math.round((10000 * populated) / total) / 100 : 0,
      median_age_s: Math.round(median),
    };
  }

  // last_run_at
  const { data: lastRunsRaw } = await supabase
    .from("system_config")
    .select("key, value")
    .in("key", ["last_run_sofascore_fixtures", "last_run_sofascore_enrichment"]);
  const last_run_at: Record<string, string | null> = {
    last_run_sofascore_fixtures: null,
    last_run_sofascore_enrichment: null,
  };
  for (const r of (lastRunsRaw ?? []) as Array<{ key: string; value: string }>) {
    try {
      last_run_at[r.key] = JSON.parse(r.value);
    } catch {
      last_run_at[r.key] = null;
    }
  }

  return NextResponse.json({
    matched_total: matched?.length ?? 0,
    by_sport,
    by_endpoint_freshness,
    last_run_at,
  });
}
