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
  // Optional fields for auto-creation of events not yet in DB
  home_team?: string;
  away_team?: string;
  sport?: string;
  league?: string;
  starts_at?: string;
  // Extra live data
  period?: string;
  period_code?: number;
  half_score_home?: number[];
  half_score_away?: number[];
  // API-Football statistics
  stats?: Record<string, [number, number]>;
  match_events?: Array<{
    minute: number;
    type: string;
    team: 'home' | 'away';
    player: string;
    assist?: string;
    detail?: string;
  }>;
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
  let inserted = 0;
  const errors: string[] = [];

  // Cache sport/league IDs for auto-creation
  const sportCache = new Map<string, string>();
  const leagueCache = new Map<string, string>();

  const SPORT_ICONS: Record<string, string> = {
    calcio: "⚽", basket: "🏀", tennis: "🎾", hockey: "🏒",
    pallavolo: "🏐", football: "🏈", baseball: "⚾", rugby: "🏉",
  };

  for (const ev of events) {
    try {
      if (!ev.external_id) {
        errors.push("missing external_id");
        continue;
      }

      // ── 1. Find or auto-create event by external_id ──
      let { data: event, error: findErr } = await supabase
        .from("events")
        .select("id")
        .eq("external_id", ev.external_id)
        .maybeSingle();

      if (findErr && !event) {
        errors.push(`${ev.external_id}: lookup failed — ${findErr.message}`);
        continue;
      }

      // Auto-create event if not found and creation fields are present
      if (!event) {
        if (!ev.home_team || !ev.away_team || !ev.sport) {
          errors.push(`${ev.external_id}: event not found and missing creation fields`);
          continue;
        }

        // Upsert sport
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

        // Upsert league
        const leagueName = ev.league || "Sconosciuto";
        const leagueSlug = `${sportSlug}-${slugify(leagueName)}`;
        let leagueId = leagueCache.get(leagueSlug);
        if (!leagueId) {
          const { data: league, error: leagueErr } = await supabase
            .from("leagues")
            .upsert(
              { sport_id: sportId, name: leagueName, slug: leagueSlug, is_active: true },
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

        // Insert new event
        const { data: newEvent, error: insertErr } = await supabase
          .from("events")
          .insert({
            external_id: ev.external_id,
            sport_id: sportId,
            league_id: leagueId,
            home_team: ev.home_team,
            away_team: ev.away_team,
            starts_at: ev.starts_at || new Date().toISOString(),
            status: "live",
            is_live: true,
            updated_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (insertErr || !newEvent) {
          errors.push(`${ev.external_id}: auto-create failed — ${insertErr?.message}`);
          continue;
        }

        event = newEvent;
        inserted++;
      }

      // ── 2. Update event status, scores, minute ──
      const liveData: Record<string, unknown> = {};
      if (ev.period_code != null) liveData.periodCode = ev.period_code;
      if (ev.half_score_home) liveData.halfScoreHome = ev.half_score_home;
      if (ev.half_score_away) liveData.halfScoreAway = ev.half_score_away;
      if (ev.stats) liveData.stats = ev.stats;
      if (ev.match_events) liveData.matchEvents = ev.match_events;

      const { error: updateErr } = await supabase
        .from("events")
        .update({
          status: ev.status || "live",
          is_live: true,
          minute: ev.minute ?? null,
          score_home: ev.home_score ?? null,
          score_away: ev.away_score ?? null,
          period: ev.period || null,
          live_data: Object.keys(liveData).length > 0 ? liveData : null,
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

        // Find existing market by event_id + market_type
        const { data: existingMarket } = await supabase
          .from("markets")
          .select("id")
          .eq("event_id", event.id)
          .eq("market_type", mkt.type)
          .maybeSingle();

        let market: { id: string } | null = null;

        if (existingMarket) {
          // Update existing market
          await supabase
            .from("markets")
            .update({
              name: MARKET_NAMES[mkt.type] || mkt.type,
              slug: marketSlug,
              line,
              is_active: true,
              is_suspended: false,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existingMarket.id);
          market = existingMarket;
        } else {
          // Insert new market
          const { data: newMarket, error: insertErr } = await supabase
            .from("markets")
            .insert({
              event_id: event.id,
              name: MARKET_NAMES[mkt.type] || mkt.type,
              slug: marketSlug,
              market_type: mkt.type,
              line,
              is_active: true,
              is_suspended: false,
            })
            .select("id")
            .single();
          if (insertErr || !newMarket) {
            errors.push(`${ev.external_id}/${mkt.type}: market insert failed — ${insertErr?.message}`);
            continue;
          }
          market = newMarket;
        }

        if (!market) continue;

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

  return NextResponse.json({ updated, inserted, errors });
}
