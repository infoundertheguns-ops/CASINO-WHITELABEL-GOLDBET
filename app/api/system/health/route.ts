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
    if (typeof data === "string") {
      rpc = JSON.parse(data);
    } else {
      rpc = data as SystemHealthRPC;
    }
  } catch (err) {
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

  // 2. No active push-scrapers — pipeline is pull-based (odds-api ingester + flashscore poller).
  //    Treat scraper info as a generic "pipeline alive" probe inferred from RPC pipeline metrics.
  const pipelineAlive = (rpc.pipeline?.outcomes_updated_5m ?? 0) > 0;
  const scraperLive: ScraperInfo = { connected: pipelineAlive, isLive: true };
  const scraperPrematch: ScraperInfo = { connected: pipelineAlive };

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

  // 4. Compute scores
  const scores = computeHealthScores(
    rpc,
    { live: scraperLive, prematch: scraperPrematch },
    redisInfo,
  );

  const result = {
    scores,
    metrics: rpc,
    scraper: {
      live: scraperLive,
      prematch: scraperPrematch,
    },
    redis: redisInfo,
    cached_at: new Date().toISOString(),
  };

  setCache(result);
  setLastGood(result);

  return NextResponse.json(result);
}
