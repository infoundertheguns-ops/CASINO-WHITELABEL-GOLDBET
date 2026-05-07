export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  buildPartialUpsert,
  mergeEndpointStatus,
  type EnrichmentPayload,
  type EndpointStatus,
} from "./_lib";

interface Body {
  sofa_event_id: number;
  sport_slug: "calcio" | "tennis" | "basket";
  payloads?: EnrichmentPayload;
  endpoint_status?: Record<string, EndpointStatus>;
}

export async function POST(req: NextRequest) {
  if (req.headers.get("x-scraper-key") !== process.env.SCRAPER_API_KEY) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || typeof body.sofa_event_id !== "number" || !body.sport_slug) {
    return NextResponse.json({ error: "missing required fields" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { fetch: (input, init) => fetch(input, { ...(init as RequestInit), cache: 'no-store' }) } },
  );

  const { data: ev2, error: ev2Err } = await supabase
    .from("events_v2")
    .select("id")
    .eq("sofascore_id", body.sofa_event_id)
    .maybeSingle();
  if (ev2Err) return NextResponse.json({ error: ev2Err.message }, { status: 500 });
  if (!ev2)
    return NextResponse.json(
      { error: "no events_v2 row for sofa_event_id" },
      { status: 404 }
    );

  const { data: prior } = await supabase
    .from("event_enrichment")
    .select("last_endpoint_status")
    .eq("event_v2_id", ev2.id)
    .maybeSingle();

  const merged = mergeEndpointStatus(
    (prior?.last_endpoint_status as Record<string, EndpointStatus>) ?? {},
    body.endpoint_status ?? {}
  );
  const partialCols = buildPartialUpsert(body.payloads ?? {});
  const now = new Date().toISOString();

  const { error: upErr } = await supabase
    .from("event_enrichment")
    .upsert(
      {
        event_v2_id: ev2.id,
        sofa_event_id: body.sofa_event_id,
        sport_slug: body.sport_slug,
        ...partialCols,
        last_synced_at: now,
        last_endpoint_status: merged,
      },
      { onConflict: "event_v2_id" }
    );
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  await supabase.from("system_config").upsert(
    { key: "last_run_sofascore_enrichment", value: JSON.stringify(now) },
    { onConflict: "key" }
  );

  return NextResponse.json({ ok: true, event_v2_id: ev2.id });
}
