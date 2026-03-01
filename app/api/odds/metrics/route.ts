import { NextResponse } from 'next/server';
import { getRedisClient, getSSEClientCount, getOddsChangesPerSecond } from '@/lib/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Throughput history buffer (global, survives hot-reload)
const globalForHistory = globalThis as unknown as {
  __throughputHistory?: { ts: number; cps: number; queue: number; clients: number }[];
};

export async function GET() {
  try {
    const client = await getRedisClient();

    // Gather metrics from Redis
    const [queueDepth, cachedEvents, memoryInfo] = await Promise.all([
      client.lLen('supabase:write_queue').catch(() => 0),
      client.hLen('odds:cache').catch(() => 0),
      client.info('memory').catch(() => ''),
    ]);

    // Parse memory
    const memMatch = memoryInfo.match(/used_memory:(\d+)/);
    const memoryUsed = memMatch ? parseInt(memMatch[1], 10) : 0;

    // Get latency (ping)
    const pingStart = Date.now();
    await client.ping();
    const latencyMs = Date.now() - pingStart;

    const changesPerSecond = getOddsChangesPerSecond();
    const sseClients = getSSEClientCount();

    // Store in throughput history
    if (!globalForHistory.__throughputHistory) globalForHistory.__throughputHistory = [];
    globalForHistory.__throughputHistory.push({
      ts: Date.now(),
      cps: changesPerSecond,
      queue: queueDepth,
      clients: sseClients,
    });
    // Keep last 60 samples (1 hour at 1/min)
    if (globalForHistory.__throughputHistory.length > 60) {
      globalForHistory.__throughputHistory.splice(0, globalForHistory.__throughputHistory.length - 60);
    }

    return NextResponse.json({
      redis: {
        connected: true,
        memory_used: memoryUsed,
        latency_ms: latencyMs,
      },
      odds: {
        active_events: cachedEvents,
        sse_clients: sseClients,
        write_queue_depth: queueDepth,
        changes_per_second: changesPerSecond,
      },
      throughput_history: globalForHistory.__throughputHistory,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      redis: { connected: false, error: msg },
      odds: { active_events: 0, sse_clients: 0, write_queue_depth: 0, changes_per_second: 0 },
      throughput_history: [],
    });
  }
}
