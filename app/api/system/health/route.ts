import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
import {
  computeHealthScores,
  computeTwobetHealth,
  computeBetfairHealth,
  type SystemHealthRPC,
  type ScraperInfo,
  type RedisInfo,
} from "@/lib/health";

// ═══ In-memory cache (30s TTL) ═══

interface CacheEntry {
  data: unknown;
  ts: number;
}

const CACHE_TTL = 30_000;
const g = globalThis as any;

function getCached(): CacheEntry | null {
  const entry = g.__systemHealthCache as CacheEntry | undefined;
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry;
  return null;
}

function setCache(data: unknown) {
  g.__systemHealthCache = { data, ts: Date.now() } as CacheEntry;
}

// ═══ Last-known-good result (survives cache TTL, used as fallback on RPC error) ═══

function getLastGood(): unknown | null {
  return g.__systemHealthLastGood ?? null;
}

function setLastGood(data: unknown) {
  g.__systemHealthLastGood = data;
}

// ═══ Extract scraper info from snapshot buffer ═══

function getScraperInfo(source: string, type: "live" | "prematch"): ScraperInfo {
  const snapshots = g.__scraperSnapshotsBySource as
    | Record<string, any[]>
    | undefined;
  if (!snapshots) return { connected: false };

  const buf = snapshots[source];
  if (!buf || buf.length === 0) return { connected: false };

  const latest = buf[buf.length - 1];
  const gb = latest?.kambi;
  if (!gb) return { connected: false };

  const cycleField =
    type === "live" ? gb.last_live_cycle : gb.last_prematch_cycle;
  const cycleAge = cycleField
    ? (Date.now() - new Date(cycleField).getTime()) / 1000
    : Infinity;

  // Fallback: if cycle timestamp is stale (>1h) but snapshot is fresh (<5min),
  // the scraper is alive but cycle timestamps are stale after restart.
  const snapshotAge = latest?.timestamp
    ? (Date.now() - new Date(latest.timestamp).getTime()) / 1000
    : Infinity;
  const effectiveAge =
    cycleAge > 3600 && snapshotAge < 300 ? snapshotAge : cycleAge;

  return {
    connected: true,
    lastCycleSeconds: effectiveAge,
    errorsLastHour: gb.errors_last_hour ?? 0,
    isLive: type === "live",
  };
}

// ═══ GET — System Health ═══

export async function GET() {
  // Check cache
  const cached = getCached();
  if (cached) {
    return NextResponse.json(cached.data);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { fetch: (url, opts) => fetch(url, { ...opts, cache: "no-store" }) } }
  );

  // 1. Call RPC
  let rpc: SystemHealthRPC | null = null;
  try {
    const { data, error } = await supabase.rpc("get_system_health");
    if (error) throw new Error(error.message);
    // RPC returns scalar JSONB — may be string or object
    if (typeof data === "string") {
      rpc = JSON.parse(data);
    } else {
      rpc = data as SystemHealthRPC;
    }
  } catch (err) {
    // Fallback: return last known good result with stale flag
    const lastGood = getLastGood();
    if (lastGood) {
      return NextResponse.json({ ...(lastGood as any), stale: true });
    }
    return NextResponse.json(
      { error: `RPC failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }

  if (!rpc) {
    const lastGood = getLastGood();
    if (lastGood) {
      return NextResponse.json({ ...(lastGood as any), stale: true });
    }
    return NextResponse.json({ error: "RPC returned null" }, { status: 500 });
  }

  // 1b. Hydrate scraper snapshots from Redis if in-memory buffer is empty (after Vincitu restart)
  const snapBuf = g.__scraperSnapshotsBySource as Record<string, any[]> | undefined;
  const hasInMemorySnapshots = snapBuf && Object.values(snapBuf).some(b => b.length > 0);
  if (!hasInMemorySnapshots) {
    try {
      const { getRedisClient } = await import("@/lib/redis");
      const redis = await getRedisClient();
      for (const source of ["kambi", "22bet", "betfair"]) {
        const raw = await redis.get(`scraper:snapshot:${source}`);
        if (raw) {
          if (!g.__scraperSnapshotsBySource) g.__scraperSnapshotsBySource = {};
          g.__scraperSnapshotsBySource[source] = [JSON.parse(raw)];
        }
      }
    } catch { /* Redis fallback is best-effort */ }
  }

  // 2. Scraper info from in-memory snapshots (Kambi + 22bet + Betfair)
  const kambiLive = getScraperInfo("kambi", "live");
  const kambiPrematch = getScraperInfo("kambi", "prematch");
  const twobetLive = getScraperInfo("22bet", "live");
  const twobetPrematch = getScraperInfo("22bet", "prematch");
  const betfairLive = getScraperInfo("betfair", "live");
  const betfairPrematch = getScraperInfo("betfair", "prematch");

  // 3. Redis info
  let redisInfo: RedisInfo = { connected: false };
  try {
    const { getRedisClient } = await import("@/lib/redis");
    const client = await getRedisClient();
    const start = Date.now();
    await client.ping();
    redisInfo = {
      connected: true,
      latencyMs: Date.now() - start,
    };
  } catch {
    redisInfo = { connected: false };
  }

  // 4. Kambi scores (primary — player-facing subsystems)
  const scores = computeHealthScores(
    rpc,
    { live: kambiLive, prematch: kambiPrematch },
    redisInfo,
  );

  // 5. 22bet scores (secondary — consensus + normalization focus)
  const twobetConnected = twobetLive.connected || twobetPrematch.connected;
  let twobet_scores: ReturnType<typeof computeTwobetHealth> | null = null;
  if (twobetConnected) {
    const staleCutoff = new Date(Date.now() - 75 * 60 * 1000).toISOString();
    const [consensusRes, staleRes] = await Promise.all([
      supabase.from("consensus_snapshots")
        .select("snapshot_at", { count: "exact", head: false })
        .order("snapshot_at", { ascending: false })
        .limit(1),
      supabase.from("events")
        .select("id", { count: "exact", head: true })
        .eq("source", "22bet")
        .eq("status", "prematch")
        .lt("updated_at", staleCutoff),
    ]);

    const lastSnapshotAt = consensusRes.data?.[0]?.snapshot_at ?? null;
    const lastRefreshAgeSec = lastSnapshotAt
      ? (Date.now() - new Date(lastSnapshotAt).getTime()) / 1000
      : null;

    // markets-per-event ratio for 22bet from RPC data
    const twobetMarkets = rpc.active_by_source?.markets?.["22bet"] ?? 0;
    const twobetEvents = (rpc.events?.["22bet_live"] ?? 0) + (rpc.events?.["22bet_prematch"] ?? 0);
    const marketsPerEvent = twobetEvents > 0 ? twobetMarkets / twobetEvents : 0;

    twobet_scores = computeTwobetHealth(
      { live: twobetLive, prematch: twobetPrematch },
      rpc,
      {
        lastRefreshAgeSec,
        totalSnapshots: consensusRes.count ?? 0,
      },
      {
        marketsPerEvent,
        stalePrematch: staleRes.count ?? 0,
      },
    );
  }

  // 6. Betfair scores (third consensus source — exchange)
  const betfairConnected = betfairLive.connected || betfairPrematch.connected;
  let betfair_scores: ReturnType<typeof computeBetfairHealth> | null = null;
  if (betfairConnected) {
    const staleCutoff = new Date(Date.now() - 75 * 60 * 1000).toISOString();
    const [consensusRes, staleRes] = await Promise.all([
      supabase.from("consensus_snapshots")
        .select("snapshot_at", { count: "exact", head: false })
        .order("snapshot_at", { ascending: false })
        .limit(1),
      supabase.from("events")
        .select("id", { count: "exact", head: true })
        .eq("source", "betfair")
        .eq("status", "prematch")
        .lt("updated_at", staleCutoff),
    ]);

    const lastSnapshotAt = consensusRes.data?.[0]?.snapshot_at ?? null;
    const lastRefreshAgeSec = lastSnapshotAt
      ? (Date.now() - new Date(lastSnapshotAt).getTime()) / 1000
      : null;

    const betfairMarkets = rpc.active_by_source?.markets?.["betfair"] ?? 0;
    const betfairEvents = (rpc.events?.["betfair_live"] ?? 0) + (rpc.events?.["betfair_prematch"] ?? 0);
    const marketsPerEvent = betfairEvents > 0 ? betfairMarkets / betfairEvents : 0;

    betfair_scores = computeBetfairHealth(
      { live: betfairLive, prematch: betfairPrematch },
      rpc,
      {
        lastRefreshAgeSec,
        totalSnapshots: consensusRes.count ?? 0,
      },
      {
        marketsPerEvent,
        stalePrematch: staleRes.count ?? 0,
      },
    );
  }

  const result = {
    scores,
    twobet_scores,
    betfair_scores,
    metrics: rpc,
    scraper: {
      kambi_live: kambiLive,
      kambi_prematch: kambiPrematch,
      twobet_live: twobetLive,
      twobet_prematch: twobetPrematch,
      betfair_live: betfairLive,
      betfair_prematch: betfairPrematch,
    },
    redis: redisInfo,
    cached_at: new Date().toISOString(),
  };

  setCache(result);
  setLastGood(result);

  return NextResponse.json(result);
}
