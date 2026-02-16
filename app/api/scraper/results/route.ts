import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

// ═══ TYPES ═══

interface ResultEvent {
  external_id: string;
  home_score: number;
  away_score: number;
  status?: string;
}

// ═══ HANDLER ═══

export async function POST(req: NextRequest) {
  // Auth
  const key = req.headers.get("x-scraper-key");
  if (!key || key !== process.env.SCRAPER_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { results?: ResultEvent[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const results = body.results;
  if (!Array.isArray(results) || results.length === 0) {
    return NextResponse.json({ error: "results array required" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  let settled = 0;
  const errors: string[] = [];

  for (const res of results) {
    try {
      if (!res.external_id || res.home_score == null || res.away_score == null) {
        errors.push(`${res.external_id || "unknown"}: missing required fields`);
        continue;
      }

      // ── 1. Find event by external_id ──
      const { data: event, error: findErr } = await supabase
        .from("events")
        .select("id, status")
        .eq("external_id", res.external_id)
        .maybeSingle();

      if (findErr || !event) {
        errors.push(`${res.external_id}: event not found`);
        continue;
      }

      // Skip already settled events
      if (event.status === "ended" || event.status === "finished") {
        errors.push(`${res.external_id}: already settled (status=${event.status})`);
        continue;
      }

      // ── 2. Update event → ended ──
      const { error: updateErr } = await supabase
        .from("events")
        .update({
          status: res.status || "ended",
          is_live: false,
          score_home: res.home_score,
          score_away: res.away_score,
          settled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", event.id);

      if (updateErr) {
        errors.push(`${res.external_id}: update failed — ${updateErr.message}`);
        continue;
      }

      // ── 3. Suspend all markets for this event ──
      await supabase
        .from("markets")
        .update({ is_suspended: true, updated_at: new Date().toISOString() })
        .eq("event_id", event.id);

      // ── 4. Trigger settlement via /api/settlement ──
      try {
        const settlementRes = await fetch(`${baseUrl}/api/settlement`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event_id: event.id,
            result: { home: res.home_score, away: res.away_score },
          }),
        });

        if (settlementRes.ok) {
          const settlementData = await settlementRes.json();
          if (settlementData.success) {
            settled++;
          } else {
            errors.push(`${res.external_id}: settlement returned error — ${settlementData.error || "unknown"}`);
          }
        } else {
          errors.push(`${res.external_id}: settlement HTTP ${settlementRes.status}`);
        }
      } catch (settlementErr: unknown) {
        const msg = settlementErr instanceof Error ? settlementErr.message : String(settlementErr);
        errors.push(`${res.external_id}: settlement call failed — ${msg}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${res.external_id}: ${msg}`);
    }
  }

  return NextResponse.json({ settled, errors });
}
