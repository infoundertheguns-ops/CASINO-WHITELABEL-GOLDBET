import { NextRequest } from 'next/server';
import { getRedisClient, getRedisSubscriber, incrementSSEClients, decrementSSEClients, recordOddsChanges } from '@/lib/redis';
import { createClient as createRedisClient } from 'redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const HEARTBEAT_MS = 15_000;

export async function GET(request: NextRequest) {
  const eventFilter = request.nextUrl.searchParams.get('events');
  const filterSet = eventFilter ? new Set(eventFilter.split(',').map(s => s.trim()).filter(Boolean)) : null;

  // Create a dedicated subscriber for this SSE connection
  const subscriber = createRedisClient({ url: REDIS_URL });
  subscriber.on('error', () => {}); // suppress errors

  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      function send(event: string, data: string) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch {
          closed = true;
        }
      }

      try {
        await subscriber.connect();
        incrementSSEClients();

        // Send initial snapshot from Redis cache
        try {
          const client = await getRedisClient();
          const allCached = await client.hGetAll('odds:cache');
          const entries = Object.entries(allCached);

          if (entries.length > 0) {
            const snapshot: Record<string, unknown> = {};
            for (const [eventId, json] of entries) {
              if (filterSet && !filterSet.has(eventId)) continue;
              try { snapshot[eventId] = JSON.parse(json); } catch {}
            }
            if (Object.keys(snapshot).length > 0) {
              send('snapshot', JSON.stringify(snapshot));
            }
          }
        } catch {
          // Cache read failed, continue without snapshot
        }

        // Subscribe to odds:live channel
        await subscriber.subscribe('odds:live', (message) => {
          if (closed) return;
          try {
            const parsed = JSON.parse(message);
            // Apply event filter if specified
            if (filterSet && !filterSet.has(parsed.event_id)) return;
            send('odds', message);
            // Track throughput
            const changeCount = parsed.changes?.length || 0;
            if (changeCount > 0) recordOddsChanges(changeCount);
          } catch {}
        });

        // Heartbeat to keep connection alive
        const heartbeat = setInterval(() => {
          if (closed) { clearInterval(heartbeat); return; }
          send('heartbeat', JSON.stringify({ ts: Date.now() }));
        }, HEARTBEAT_MS);

        // Cleanup on abort
        request.signal.addEventListener('abort', async () => {
          closed = true;
          clearInterval(heartbeat);
          decrementSSEClients();
          try {
            await subscriber.unsubscribe('odds:live');
            await subscriber.quit();
          } catch {}
          try { controller.close(); } catch {}
        });

      } catch (err) {
        // Redis connection failed — send error event and close
        send('error', JSON.stringify({ message: 'Redis unavailable' }));
        closed = true;
        decrementSSEClients();
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
