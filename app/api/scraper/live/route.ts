import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

// ═══ TYPES ═══

interface ScraperOutcome {
  name: string;
  odds: number;
}

interface ScraperMarket {
  type: string;
  outcomes: ScraperOutcome[];
}

interface LiveEvent {
  external_id: string;
  status?: string;
  minute?: number;
  home_score?: number;
  away_score?: number;
  markets?: ScraperMarket[];
}

// ═══ HELPERS ═══

function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const MARKET_NAMES: Record<string, string> = {
  "1X2": "1X2",
  "over_under_0.5": "O/U 0.5",
  "over_under_1.5": "O/U 1.5",
  "over_under_2.5": "O/U 2.5",
  "over_under_3.5": "O/U 3.5",
  "over_under_4.5": "O/U 4.5",
  "gg_ng": "GG/NG",
  "double_chance": "Doppia Chance",
  "handicap": "Handicap",
  "exact_score": "Risultato Esatto",
  "draw_no_bet": "Draw No Bet",
};

function extractLine(marketType: string): number | null {
  const match = marketType.match(/[_.](\d+\.?\d*)$/);
  return match ? parseFloat(match[1]) : null;
}

// ═══ HANDLER ═══

export async function POST(req: NextRequest) {
  // Auth
  const key = req.headers.get("x-scraper-key");
  if (!key || key !== process.env.SCRAPER_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { events?: LiveEvent[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const events = body.events;
  if (!Array.isArray(events) || events.length === 0) {
    return NextResponse.json({ error: "events array required" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let updated = 0;
  const errors: string[] = [];

  for (const ev of events) {
    try {
      if (!ev.external_id) {
        errors.push("missing external_id");
        continue;
      }

      // ── 1. Find event by external_id ──
      const { data: event, error: findErr } = await supabase
        .from("events")
        .select("id")
        .eq("external_id", ev.external_id)
        .maybeSingle();

      if (findErr || !event) {
        errors.push(`${ev.external_id}: event not found`);
        continue;
      }

      // ── 2. Update event status, scores, minute ──
      const { error: updateErr } = await supabase
        .from("events")
        .update({
          status: ev.status || "live",
          is_live: true,
          minute: ev.minute ?? null,
          score_home: ev.home_score ?? null,
          score_away: ev.away_score ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", event.id);

      if (updateErr) {
        errors.push(`${ev.external_id}: update failed — ${updateErr.message}`);
        continue;
      }

      // ── 3. Upsert markets + outcomes (live odds update) ──
      for (const mkt of ev.markets || []) {
        const marketSlug = slugify(mkt.type);
        const line = extractLine(mkt.type);

        const { data: market, error: marketErr } = await supabase
          .from("markets")
          .upsert(
            {
              event_id: event.id,
              name: MARKET_NAMES[mkt.type] || mkt.type,
              slug: marketSlug,
              market_type: mkt.type,
              line,
              is_active: true,
              is_suspended: false,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "event_id,market_type" }
          )
          .select("id")
          .single();

        if (marketErr || !market) {
          errors.push(`${ev.external_id}/${mkt.type}: market upsert failed — ${marketErr?.message}`);
          continue;
        }

        // Fetch existing outcomes for this market
        const { data: existingOutcomes } = await supabase
          .from("outcomes")
          .select("id, name, odds")
          .eq("market_id", market.id);

        const existingMap = new Map(
          (existingOutcomes || []).map((o) => [o.name, o])
        );

        for (const out of mkt.outcomes || []) {
          const existing = existingMap.get(out.name);

          if (existing) {
            // Shift current odds → previous_odds, set new odds
            if (existing.odds !== out.odds) {
              await supabase
                .from("outcomes")
                .update({
                  previous_odds: existing.odds,
                  odds: out.odds,
                  is_active: true,
                  is_suspended: false,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", existing.id);
            }
          } else {
            await supabase.from("outcomes").insert({
              market_id: market.id,
              name: out.name,
              odds: out.odds,
              is_active: true,
              is_suspended: false,
            });
          }
        }
      }

      updated++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${ev.external_id}: ${msg}`);
    }
  }

  return NextResponse.json({ updated, errors });
}
