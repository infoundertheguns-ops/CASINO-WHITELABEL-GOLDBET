import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
import {
  computeHealthScores,
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
  const gb = latest?.goldbet;
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
      for (const source of ["kambi"]) {
        const raw = await redis.get(`scraper:snapshot:${source}`);
        if (raw) {
          if (!g.__scraperSnapshotsBySource) g.__scraperSnapshotsBySource = {};
          g.__scraperSnapshotsBySource[source] = [JSON.parse(raw)];
        }
      }
    } catch { /* Redis fallback is best-effort */ }
  }

  // 2. Kambi scraper info from in-memory snapshots
  const kambiLive = getScraperInfo("kambi", "live");
  const kambiPrematch = getScraperInfo("kambi", "prematch");

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

  // 4. Compute scores — Kambi primary
  const scores = computeHealthScores(
    rpc,
    { live: { connected: false }, prematch: { connected: false } },
    redisInfo,
    { live: kambiLive, prematch: kambiPrematch }
  );

  const result = {
    scores,
    metrics: rpc,
    scraper: {
      kambi_live: kambiLive,
      kambi_prematch: kambiPrematch,
    },
    redis: redisInfo,
    cached_at: new Date().toISOString(),
  };

  setCache(result);
  setLastGood(result);

  return NextResponse.json(result);
}
