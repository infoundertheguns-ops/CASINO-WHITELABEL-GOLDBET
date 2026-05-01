import { createClient } from 'redis';

export type RedisClient = ReturnType<typeof createClient>;

const REDIS_URL = (): string => process.env.REDIS_URL || 'redis://127.0.0.1:6379';

let cachedClient: RedisClient | undefined;

async function ensureClient(): Promise<RedisClient> {
  if (cachedClient && cachedClient.isOpen) return cachedClient;

  const client = createClient({ url: REDIS_URL() });
  client.on('error', (err: Error) => {
    console.error(`[redis-client] ${err.message}`);
  });
  await client.connect();
  cachedClient = client;
  return client;
}

export async function getRedisClient(): Promise<RedisClient> {
  return ensureClient();
}

export async function disposeRedisClient(): Promise<void> {
  const c = cachedClient;
  if (c && c.isOpen) {
    try { await c.quit(); } catch { /* ignore */ }
  }
  cachedClient = undefined;
}
