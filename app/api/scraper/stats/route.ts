import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { sendTelegramAlert } from "@/lib/telegram";

// ═══ TYPES ═══

interface SportBreakdown {
  events: number;
  markets: number;
  outcomes: number;
}

interface ScraperStats {
  live_events: number;
  prematch_events: number;
  live_markets: number;
  prematch_markets: number;
  live_outcomes: number;
  prematch_outcomes: number;
  last_live_cycle: string;
  last_prematch_cycle: string;
  errors_last_hour: number;
  session_status: string;
  by_sport?: Record<string, { live: SportBreakdown; prematch: SportBreakdown }>;
  live_events_current_cycle?: number;
  prematch_events_current_cycle?: number;
  source?: string; // 'main' | 'prematch' — identifies which server sent the stats
  memory_mb?: number;
}

interface DbCounts {
  live_events: number;
  prematch_events: number;
  active_markets: number;
  active_outcomes: number;
  finished_events: number;
  ended_events: number;
}

interface DbSportCounts {
  sport_name: string;
  live_events: number;
  prematch_events: number;
  active_markets: number;
  active_outcomes: number;
}

interface Snapshot {
  timestamp: string;
  goldbet: ScraperStats;
  vincitu: DbCounts;
  diffs: {
    live_events_pct: number;
    prematch_events_pct: number;
    markets_pct: number;
    outcomes_pct: number;
  };
  by_sport?: Record<string, {
    goldbet: { live: SportBreakdown; prematch: SportBreakdown };
    vincitu: { live_events: number; prematch_events: number; active_markets: number; active_outcomes: number };
  }>;
}

// ═══ IN-MEMORY STORE (circular buffer per source, last ~60 snapshots = ~1 hour at 1/min) ═══
// Use globalThis to survive Next.js module re-evaluation

const MAX_SNAPSHOTS = 60;

const g = globalThis as any;
if (!g.__scraperSnapshotsBySource) g.__scraperSnapshotsBySource = {} as Record<string, Snapshot[]>;
const snapshotsBySource: Record<string, Snapshot[]> = g.__scraperSnapshotsBySource;

// Legacy alias — points to 'main' buffer for backward compat in GET
function getSnapshots(source: string): Snapshot[] {
  if (!snapshotsBySource[source]) snapshotsBySource[source] = [];
  return snapshotsBySource[source];
}

function addSnapshot(snap: Snapshot, source: string) {
  const buf = getSnapshots(source);
  buf.push(snap);
  if (buf.length > MAX_SNAPSHOTS) {
    buf.shift();
  }
}

function calcDiffPct(goldbet: number, vincitu: number): number {
  if (goldbet === 0) return vincitu === 0 ? 0 : 100;
  return Math.round(((vincitu - goldbet) / goldbet) * 1000) / 10; // 1 decimal
}

// ═══ TELEGRAM ALERTS ═══

const ALERT_THRESHOLD_PCT = 25; // Send alert when diff > 25%

async function checkAndAlert(snap: Snapshot) {
  const alerts: string[] = [];
  const d = snap.diffs;

  const gbLiveCycle = snap.goldbet.live_events_current_cycle ?? snap.goldbet.live_events;

  if (Math.abs(d.live_events_pct) > ALERT_THRESHOLD_PCT) {
    alerts.push(
      `📊 <b>Eventi Live</b>\nGoldbet (ciclo): ${gbLiveCycle}\nVincitu: ${snap.vincitu.live_events}\nDiff: ${d.live_events_pct > 0 ? "+" : ""}${d.live_events_pct}%`
    );
  }
  if (Math.abs(d.prematch_events_pct) > ALERT_THRESHOLD_PCT) {
    alerts.push(
      `📊 <b>Eventi Prematch</b>\nGoldbet: ${snap.goldbet.prematch_events}\nVincitu: ${snap.vincitu.prematch_events}\nDiff: ${d.prematch_events_pct > 0 ? "+" : ""}${d.prematch_events_pct}%`
    );
  }
  if (Math.abs(d.markets_pct) > ALERT_THRESHOLD_PCT) {
    const gbMarkets = snap.goldbet.live_markets + snap.goldbet.prematch_markets;
    alerts.push(
      `📊 <b>Mercati Attivi</b>\nGoldbet: ${gbMarkets.toLocaleString()}\nVincitu: ${snap.vincitu.active_markets.toLocaleString()}\nDiff: ${d.markets_pct > 0 ? "+" : ""}${d.markets_pct}%`
    );
  }
  if (Math.abs(d.outcomes_pct) > ALERT_THRESHOLD_PCT) {
    const gbOutcomes = snap.goldbet.live_outcomes + snap.goldbet.prematch_outcomes;
    alerts.push(
      `📊 <b>Outcomes Attivi</b>\nGoldbet: ${gbOutcomes.toLocaleString()}\nVincitu: ${snap.vincitu.active_outcomes.toLocaleString()}\nDiff: ${d.outcomes_pct > 0 ? "+" : ""}${d.outcomes_pct}%`
    );
  }

  if (alerts.length === 0) return;

  const now = new Date().toLocaleString("it-IT", { timeZone: "Europe/Rome" });
  const message = `⚠️ <b>SCRAPER DISCREPANZA</b>\n\n${alerts.join("\n\n")}\n\n🕐 ${now}`;

  await sendTelegramAlert(message, "scraper_discrepancy");
}

// ═══ POST — Receive stats from scraper ═══

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-scraper-key");
  if (!key || key !== process.env.SCRAPER_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let goldbet: ScraperStats;
  try {
    goldbet = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Query Vincitu DB counts
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Count events in parallel (small table, ~5K rows — safe)
  const [liveEv, prematchEv, finishedEv, endedEv] =
    await Promise.all([
      supabase
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("is_live", true),
      supabase
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("is_live", false)
        .eq("status", "prematch"),
      supabase
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("status", "finished"),
      supabase
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("status", "ended"),
    ]);

  // Use RPC for market/outcome counts — exact count on large tables (260K+ markets,
  // 677K+ outcomes) is too slow due to dead tuples and PostgREST parallel count bugs.
  // get_active_counts() uses exact count for markets + partial index estimate for outcomes.
  const { data: activeCounts } = await supabase.rpc("get_active_counts").single() as {
    data: { active_markets: number; active_outcomes: number } | null;
  };

  const vincitu: DbCounts = {
    live_events: liveEv.count || 0,
    prematch_events: prematchEv.count || 0,
    active_markets: activeCounts?.active_markets || 0,
    active_outcomes: activeCounts?.active_outcomes || 0,
    finished_events: finishedEv.count || 0,
    ended_events: endedEv.count || 0,
  };

  const gbTotalMarkets = goldbet.live_markets + goldbet.prematch_markets;
  const gbTotalOutcomes = goldbet.live_outcomes + goldbet.prematch_outcomes;

  // Use current cycle count for live (scrapes ALL events every 30s, so cycle = real count)
  // Use cumulative for prematch (scrapes subsets per cycle, cumulative = real count)
  const gbLiveForDiff = goldbet.live_events_current_cycle ?? goldbet.live_events;

  const diffs = {
    live_events_pct: calcDiffPct(gbLiveForDiff, vincitu.live_events),
    prematch_events_pct: calcDiffPct(
      goldbet.prematch_events,
      vincitu.prematch_events
    ),
    markets_pct: calcDiffPct(gbTotalMarkets, vincitu.active_markets),
    outcomes_pct: calcDiffPct(gbTotalOutcomes, vincitu.active_outcomes),
  };

  // Query DB counts per sport (events with sport join)
  let bySportData: Snapshot["by_sport"] | undefined;
  if (goldbet.by_sport && Object.keys(goldbet.by_sport).length > 0) {
    // Step 1: Fetch active events with sport name — paginate (Supabase returns max 1000 per request)
    const dbEvents: any[] = [];
    let evOffset = 0;
    const EV_PAGE = 1000;
    let evHasMore = true;
    while (evHasMore) {
      const { data: batch } = await supabase
        .from("events")
        .select("id, sport_id, is_live, status, sports!inner(name)")
        .in("status", ["prematch", "live"])
        .range(evOffset, evOffset + EV_PAGE - 1);
      if (!batch || batch.length === 0) { evHasMore = false; break; }
      dbEvents.push(...batch);
      evOffset += batch.length;
      if (batch.length < EV_PAGE) evHasMore = false;
    }

    // Step 2: Build event_id → sport_name map + aggregate events per sport
    const eventSportMap = new Map<string, string>(); // event.id → sport name
    const dbBySport: Record<string, { live_events: number; prematch_events: number; active_markets: number; active_outcomes: number }> = {};

    for (const ev of dbEvents) {
      const sportName = (ev as any).sports?.name || "Sconosciuto";
      eventSportMap.set(ev.id, sportName);
      if (!dbBySport[sportName]) {
        dbBySport[sportName] = { live_events: 0, prematch_events: 0, active_markets: 0, active_outcomes: 0 };
      }
      if (ev.is_live) {
        dbBySport[sportName].live_events++;
      } else {
        dbBySport[sportName].prematch_events++;
      }
    }

    // Step 3: Fetch active markets (just id + event_id, no nested join)
    // Paginate to get all active markets (Supabase returns max 1000 per request)
    const PAGE_SIZE = 1000;
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const { data: batch } = await supabase
        .from("markets")
        .select("id, event_id")
        .eq("is_active", true)
        .range(offset, offset + PAGE_SIZE - 1);

      if (!batch || batch.length === 0) {
        hasMore = false;
        break;
      }

      for (const mkt of batch) {
        const sportName = eventSportMap.get(mkt.event_id);
        if (sportName) {
          if (!dbBySport[sportName]) {
            dbBySport[sportName] = { live_events: 0, prematch_events: 0, active_markets: 0, active_outcomes: 0 };
          }
          dbBySport[sportName].active_markets++;
        }
      }

      offset += batch.length;
      if (batch.length < PAGE_SIZE) hasMore = false;
    }

    // Merge goldbet by_sport with DB by_sport
    const allSports = new Set([
      ...Object.keys(goldbet.by_sport),
      ...Object.keys(dbBySport),
    ]);

    bySportData = {};
    for (const sport of allSports) {
      const gb = goldbet.by_sport[sport] || {
        live: { events: 0, markets: 0, outcomes: 0 },
        prematch: { events: 0, markets: 0, outcomes: 0 },
      };
      const db = dbBySport[sport] || {
        live_events: 0, prematch_events: 0, active_markets: 0, active_outcomes: 0,
      };
      bySportData[sport] = { goldbet: gb, vincitu: db };
    }
  }

  const snap: Snapshot = {
    timestamp: new Date().toISOString(),
    goldbet,
    vincitu,
    diffs,
    by_sport: bySportData,
  };

  const source = goldbet.source || 'main';
  addSnapshot(snap, source);

  // Persist latest snapshot to Redis (TTL 5min) for resilience across Vincitu restarts
  try {
    const { getRedisClient } = await import("@/lib/redis");
    const redis = await getRedisClient();
    await redis.set(`scraper:snapshot:${source}`, JSON.stringify(snap), { EX: 300 });
  } catch { /* Redis persistence is best-effort */ }

  // Check for alerts (non-blocking) — only for main server
  if (source === 'main') {
    checkAndAlert(snap).catch(() => {});
  }

  return NextResponse.json({ ok: true, snapshot: snap });
}

// ═══ GET — Return latest stats for admin page ═══

export async function GET(req: NextRequest) {
  // Admin page access — either scraper key or no auth needed (internal)
  // For simplicity, allow unauthenticated GET (admin pages are already auth-gated)

  const allSources = Object.keys(snapshotsBySource);
  const hasAnyData = allSources.some(s => snapshotsBySource[s].length > 0);

  if (!hasAnyData) {
    // No scraper data yet — return DB-only counts
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const [liveEv, prematchEv, finishedEv, endedEv] = await Promise.all([
      supabase
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("is_live", true),
      supabase
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("is_live", false)
        .eq("status", "prematch"),
      supabase
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("status", "finished"),
      supabase
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("status", "ended"),
    ]);

    return NextResponse.json({
      connected: false,
      latest: null,
      history: [],
      servers: {},
      vincitu_only: {
        live_events: liveEv.count || 0,
        prematch_events: prematchEv.count || 0,
        finished_events: finishedEv.count || 0,
        ended_events: endedEv.count || 0,
      },
    });
  }

  // Build per-source response
  const servers: Record<string, { latest: Snapshot | null; history: Snapshot[] }> = {};
  for (const source of allSources) {
    const buf = snapshotsBySource[source];
    if (buf.length > 0) {
      servers[source] = {
        latest: buf[buf.length - 1],
        history: buf,
      };
    }
  }

  // Backward compat: "latest" and "history" from main server (or first available)
  const mainBuf = snapshotsBySource['main'] || [];
  const fallbackBuf = mainBuf.length > 0 ? mainBuf : (snapshotsBySource[allSources[0]] || []);

  return NextResponse.json({
    connected: true,
    latest: fallbackBuf.length > 0 ? fallbackBuf[fallbackBuf.length - 1] : null,
    history: fallbackBuf,
    servers,
  });
}
