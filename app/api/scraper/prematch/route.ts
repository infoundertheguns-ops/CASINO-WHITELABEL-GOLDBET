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

interface ScraperEvent {
  external_id: string;
  sport: string;
  league: string;
  home_team: string;
  away_team: string;
  starts_at: string;
  status?: string;
  markets: ScraperMarket[];
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

const SPORT_ICONS: Record<string, string> = {
  calcio: "⚽",
  basket: "🏀",
  tennis: "🎾",
  hockey: "🏒",
  pallavolo: "🏐",
  football: "🏈",
  baseball: "⚾",
  rugby: "🏉",
  mma: "🥊",
  ciclismo: "🚴",
};

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
  "first_goal": "Primo Gol",
  "ht_ft": "HT/FT",
  "corners_ou": "Corner O/U",
  "cards_ou": "Cartellini O/U",
  "clean_sheet": "Clean Sheet",
  "win_to_nil": "Vittoria a Zero",
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

  let body: { events?: ScraperEvent[] };
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

  let inserted = 0;
  let updated = 0;
  const errors: string[] = [];

  // Cache sport/league IDs to avoid repeated lookups
  const sportCache = new Map<string, string>();
  const leagueCache = new Map<string, string>();

  for (const ev of events) {
    try {
      if (!ev.external_id || !ev.sport || !ev.league || !ev.home_team || !ev.away_team || !ev.starts_at) {
        errors.push(`${ev.external_id || "unknown"}: missing required fields`);
        continue;
      }

      // ── 1. Upsert sport ──
      const sportSlug = slugify(ev.sport);
      let sportId = sportCache.get(sportSlug);

      if (!sportId) {
        const { data: sport, error: sportErr } = await supabase
          .from("sports")
          .upsert(
            { name: ev.sport, slug: sportSlug, icon: SPORT_ICONS[sportSlug] || "⚽", is_active: true },
            { onConflict: "slug" }
          )
          .select("id")
          .single();

        if (sportErr || !sport) {
          errors.push(`${ev.external_id}: sport upsert failed — ${sportErr?.message}`);
          continue;
        }
        sportId = sport.id as string;
        sportCache.set(sportSlug, sportId);
      }

      // ── 2. Upsert league ──
      const leagueSlug = `${sportSlug}-${slugify(ev.league)}`;
      let leagueId = leagueCache.get(leagueSlug);

      if (!leagueId) {
        const { data: league, error: leagueErr } = await supabase
          .from("leagues")
          .upsert(
            { sport_id: sportId, name: ev.league, slug: leagueSlug, is_active: true },
            { onConflict: "slug" }
          )
          .select("id")
          .single();

        if (leagueErr || !league) {
          errors.push(`${ev.external_id}: league upsert failed — ${leagueErr?.message}`);
          continue;
        }
        leagueId = league.id as string;
        leagueCache.set(leagueSlug, leagueId);
      }

      // ── 3. Check if event exists (for inserted vs updated count) ──
      const { data: existingEvent } = await supabase
        .from("events")
        .select("id")
        .eq("external_id", ev.external_id)
        .maybeSingle();

      // ── 4. Upsert event ──
      const { data: event, error: eventErr } = await supabase
        .from("events")
        .upsert(
          {
            external_id: ev.external_id,
            sport_id: sportId,
            league_id: leagueId,
            home_team: ev.home_team,
            away_team: ev.away_team,
            starts_at: ev.starts_at,
            status: ev.status || "prematch",
            is_live: false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "external_id" }
        )
        .select("id")
        .single();

      if (eventErr || !event) {
        errors.push(`${ev.external_id}: event upsert failed — ${eventErr?.message}`);
        continue;
      }

      if (existingEvent) {
        updated++;
      } else {
        inserted++;
      }

      // ── 5. Markets + Outcomes ──
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

        // Fetch existing outcomes for this market (batch per market)
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
            // Update: shift odds → previous_odds
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
            // Insert new outcome
            const { error: outErr } = await supabase.from("outcomes").insert({
              market_id: market.id,
              name: out.name,
              odds: out.odds,
              is_active: true,
              is_suspended: false,
            });
            if (outErr) {
              errors.push(`${ev.external_id}/${mkt.type}/${out.name}: outcome insert failed — ${outErr.message}`);
            }
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${ev.external_id}: ${msg}`);
    }
  }

  return NextResponse.json({ inserted, updated, errors });
}
