// Redis cache singleton for player listing payloads.
// 30s TTL on listing endpoint; warm hits return JSON in <100ms.
// Connection reused via module-level var.

import { createClient, type RedisClientType } from "redis";

let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType> | null = null;

async function getClient(): Promise<RedisClientType> {
  if (client?.isOpen) return client;
  if (connecting) return connecting;
  connecting = (async () => {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL not set");
    const c = createClient({ url }) as RedisClientType;
    c.on("error", (err) => console.error("[redis-cache] error:", err.message));
    await c.connect();
    client = c;
    connecting = null;
    return c;
  })();
  return connecting;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const c = await getClient();
    const raw = await c.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn("[redis-cache] get failed:", (err as Error).message);
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    const c = await getClient();
    await c.set(key, JSON.stringify(value), { EX: ttlSeconds });
  } catch (err) {
    console.warn("[redis-cache] set failed:", (err as Error).message);
  }
}
