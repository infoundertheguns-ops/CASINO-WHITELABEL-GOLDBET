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
  home_team?: string;
  away_team?: string;
  sport?: string;
  league?: string;
  starts_at?: string;
  period?: string;
  period_code?: number;
  half_score_home?: number[];
  half_score_away?: number[];
  stats?: Record<string, [number, number]>;
  match_events?: Array<{
    minute: number;
    type: string;
    team: "home" | "away";
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

function extractLine(marketType: string): number | null {
  const match = marketType.match(/[_.](\d+\.?\d*)$/);
  return match ? parseFloat(match[1]) : null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

const SPORT_ICONS: Record<string, string> = {
  calcio: "⚽",
  basket: "🏀",
  tennis: "🎾",
  hockey: "🏒",
  pallavolo: "🏐",
  "tennis-tavolo": "🏓",
  rugby: "🏉",
  baseball: "⚾",
  mma: "🥊",
  ciclismo: "🚴",
  esports: "🎮",
  handball: "🤾",
  freccette: "🎯",
  football: "🏈",
  boxe: "🥊",
  snooker: "🎱",
  cricket: "🏏",
  "sport-invernali": "⛷️",
  motori: "🏎️",
};

// ═══ HANDLER ═══

export async function POST(req: NextRequest) {
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

  const sportCache = new Map<string, string>();
  const leagueCache = new Map<string, string>();

  for (const ev of events) {
    try {
      if (!ev.external_id) {
        errors.push("missing external_id");
        continue;
      }

      // ── 1. Find or auto-create event ──
      // First try by external_id, then fallback to team names + league to catch duplicates
      let { data: event } = await supabase
        .from("events")
        .select("id")
        .eq("external_id", ev.external_id)
        .maybeSingle();

      if (!event && ev.home_team && ev.away_team) {
        // Fallback: find existing event by team names (catches dupes with different external_ids)
        const { data: dupEvent } = await supabase
          .from("events")
          .select("id, external_id")
          .eq("home_team", ev.home_team)
          .eq("away_team", ev.away_team)
          .eq("is_live", true)
          .maybeSingle();

        if (dupEvent) {
          event = dupEvent;
          // Update external_id to the latest one
          await supabase
            .from("events")
            .update({ external_id: ev.external_id })
            .eq("id", dupEvent.id);
        }
      }

      if (!event) {
        if (!ev.home_team || !ev.away_team || !ev.sport) {
          errors.push(`${ev.external_id}: event not found and missing creation fields`);
          continue;
        }

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

      // ── 2. Update event status, scores, live_data ──
      const liveData: Record<string, unknown> = {};
      if (ev.period_code != null) liveData.periodCode = ev.period_code;
      if (ev.half_score_home) liveData.halfScoreHome = ev.half_score_home;
      if (ev.half_score_away) liveData.halfScoreAway = ev.half_score_away;
      if (ev.stats) liveData.stats = ev.stats;
      if (ev.match_events) liveData.matchEvents = ev.match_events;

      await supabase
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

      if (!ev.markets?.length) {
        updated++;
        continue;
      }

      // ── 3. Upsert markets (deduplicate by market_type first) ──
      const dedupMarkets = new Map<string, Record<string, unknown>>();
      for (const m of ev.markets) {
        dedupMarkets.set(m.type, {
          event_id: event!.id,
          name: m.type,
          slug: slugify(m.type),
          market_type: m.type,
          line: extractLine(m.type),
          is_active: true,
          is_suspended: false,
        });
      }
      const marketRows = [...dedupMarkets.values()];

      const marketMap = new Map<string, string>();

      for (const batch of chunk(marketRows, 500)) {
        const { data: upserted, error: mktErr } = await supabase
          .from("markets")
          .upsert(batch, { onConflict: "event_id,market_type", ignoreDuplicates: false })
          .select("id, market_type");

        if (mktErr) {
          errors.push(`${ev.external_id}: market upsert failed — ${mktErr.message}`);
        } else {
          for (const m of upserted || []) {
            marketMap.set(m.market_type, m.id);
          }
        }
      }

      // ── 4. Suspend all existing outcomes for these markets ──
      const marketIds = [...marketMap.values()];
      if (marketIds.length > 0) {
        for (const idBatch of chunk(marketIds, 500)) {
          await supabase
            .from("outcomes")
            .update({ is_suspended: true })
            .in("market_id", idBatch);
        }
      }

      // ── 5. Upsert outcomes (deduplicate by market_id+name) ──
      const dedupOutcomes = new Map<string, Record<string, unknown>>();

      for (const m of ev.markets) {
        const marketId = marketMap.get(m.type);
        if (!marketId) continue;

        for (const o of m.outcomes) {
          if (o.odds <= 1) continue;
          const key = `${marketId}|${o.name}`;
          dedupOutcomes.set(key, {
            market_id: marketId,
            name: o.name,
            odds: o.odds,
            is_active: true,
            is_suspended: false,
          });
        }
      }
      const outcomeRows = [...dedupOutcomes.values()];

      for (const batch of chunk(outcomeRows, 500)) {
        const { error: outErr } = await supabase
          .from("outcomes")
          .upsert(batch, { onConflict: "market_id,name", ignoreDuplicates: false });

        if (outErr) {
          errors.push(`${ev.external_id}: outcome upsert failed — ${outErr.message}`);
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
