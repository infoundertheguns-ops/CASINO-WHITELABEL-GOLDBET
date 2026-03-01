import { createClient } from 'redis';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

type RedisClient = ReturnType<typeof createClient>;

// Singleton via globalThis to survive Next.js hot-reload
const g = globalThis as any;

async function ensureClient(key: string): Promise<RedisClient> {
  if (g[key]?.isOpen) return g[key];

  const client = createClient({ url: REDIS_URL });
  client.on('error', (err: Error) => console.error(`[Redis ${key}] ${err.message}`));
  await client.connect();
  g[key] = client;
  return client;
}

export async function getRedisClient(): Promise<RedisClient> {
  return ensureClient('__redisClient');
}

export async function getRedisSubscriber(): Promise<RedisClient> {
  return ensureClient('__redisSubscriber');
}

// SSE client count tracking
export function getSSEClientCount(): number {
  return g.__sseClientCount || 0;
}

export function incrementSSEClients(): void {
  g.__sseClientCount = (g.__sseClientCount || 0) + 1;
}

export function decrementSSEClients(): void {
  g.__sseClientCount = Math.max(0, (g.__sseClientCount || 0) - 1);
}

// Throughput tracking for metrics
export function recordOddsChanges(count: number): void {
  if (!g.__oddsChangesBuffer) g.__oddsChangesBuffer = [];
  g.__oddsChangesBuffer.push({ ts: Date.now(), count });
  if (g.__oddsChangesBuffer.length > 120) {
    g.__oddsChangesBuffer.splice(0, g.__oddsChangesBuffer.length - 120);
  }
}

export function getOddsChangesPerSecond(): number {
  const buf = g.__oddsChangesBuffer || [];
  if (buf.length < 2) return 0;
  const windowMs = 60_000;
  const cutoff = Date.now() - windowMs;
  const recent = buf.filter((b: any) => b.ts > cutoff);
  if (recent.length === 0) return 0;
  const total = recent.reduce((sum: number, b: any) => sum + b.count, 0);
  const elapsed = (Date.now() - recent[0].ts) / 1000;
  return elapsed > 0 ? Math.round(total / elapsed * 10) / 10 : 0;
}
