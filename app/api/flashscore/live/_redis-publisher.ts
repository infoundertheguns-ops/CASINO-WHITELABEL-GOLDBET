import { getRedisClient } from '@/lib/redis'

const THROTTLE_WINDOW_MS = 5_000
const CLEANUP_AFTER_MS = 30_000
const CLEANUP_INTERVAL_MS = 60_000
const CHANNEL = 'sofa:refresh'

const lastPublishedAt = new Map<number, number>()
let lastCleanupAt = 0

export function shouldPublish(sofaEventId: number, nowMs: number = Date.now()): boolean {
  if (nowMs - lastCleanupAt > CLEANUP_INTERVAL_MS) {
    for (const [k, t] of lastPublishedAt.entries()) {
      if (nowMs - t > CLEANUP_AFTER_MS) lastPublishedAt.delete(k)
    }
    lastCleanupAt = nowMs
  }

  const last = lastPublishedAt.get(sofaEventId)
  if (last !== undefined && nowMs - last < THROTTLE_WINDOW_MS) return false
  lastPublishedAt.set(sofaEventId, nowMs)
  return true
}

export interface RefreshMessage {
  sofa_event_id: number
  reason: string
  incident_id?: string
  ts: string
}

export async function publishRefresh(msg: RefreshMessage): Promise<boolean> {
  if (!process.env.REDIS_URL) return false
  try {
    const client = await getRedisClient()
    const n = await client.publish(CHANNEL, JSON.stringify(msg))
    console.log(`[redis-publisher] published sid=${msg.sofa_event_id} reason=${msg.reason} subs=${n}`)
    return n > 0
  } catch (e) {
    console.error('[redis-publisher] publish failed:', (e as Error).message)
    return false
  }
}

export function _resetThrottleForTests() {
  lastPublishedAt.clear()
  lastCleanupAt = 0
}
