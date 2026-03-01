import { NextRequest, NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const client = await getRedisClient();
    const eventId = request.nextUrl.searchParams.get('event');

    if (eventId) {
      // Single event
      const json = await client.hGet('odds:cache', eventId);
      if (!json) {
        return NextResponse.json({ error: 'Event not found in cache' }, { status: 404 });
      }
      return NextResponse.json(JSON.parse(json));
    }

    // All cached live events
    const all = await client.hGetAll('odds:cache');
    const result: Record<string, unknown> = {};
    for (const [id, json] of Object.entries(all)) {
      try { result[id] = JSON.parse(json); } catch {}
    }

    return NextResponse.json({
      count: Object.keys(result).length,
      events: result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Redis unavailable: ${msg}` }, { status: 503 });
  }
}
