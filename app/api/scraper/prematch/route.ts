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

// ═══ HANDLER ═══

export async function POST(req: NextRequest) {
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

  let processed = 0;
  const errors: string[] = [];

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

      // ── 3. Find or create event by external_id ──
      const { data: existingEvents } = await supabase
        .from("events")
        .select("id")
        .eq("external_id", ev.external_id)
        .limit(1);

      let event: { id: string } | null = existingEvents?.[0] || null;

      if (event) {
        // Update existing event
        await supabase
          .from("events")
          .update({
            sport_id: sportId,
            league_id: leagueId,
            home_team: ev.home_team,
            away_team: ev.away_team,
            starts_at: ev.starts_at,
            status: ev.status || "prematch",
            is_live: false,
            updated_at: new Date().toISOString(),
          })
          .eq("id", event.id);
      } else {
        // Insert new event
        const { data: newEvent, error: insertErr } = await supabase
          .from("events")
          .insert({
            external_id: ev.external_id,
            sport_id: sportId,
            league_id: leagueId,
            home_team: ev.home_team,
            away_team: ev.away_team,
            starts_at: ev.starts_at,
            status: ev.status || "prematch",
            is_live: false,
            updated_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (insertErr || !newEvent) {
          errors.push(`${ev.external_id}: event insert failed — ${insertErr?.message}`);
          continue;
        }
        event = newEvent;
      }

      processed++;
      if (!ev.markets?.length) continue;

      // ── 4. Upsert markets (deduplicate by market_type first) ──
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${ev.external_id}: ${msg}`);
    }
  }

  return NextResponse.json({ processed, errors });
}
