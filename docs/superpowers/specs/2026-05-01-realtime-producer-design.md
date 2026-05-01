# Realtime Producer (Plan D #3a) — Design Spec

**Date**: 2026-05-01
**Status**: Draft, pending approval
**Scope**: Re-establish sub-second live odds push from `odds-api-ingester` to player kiosks, blocking S6 cutover. Producer-only refactor — SSE consumer (`/api/odds/stream`) and browser hook (`use-live-odds`) are intact and unchanged.
**Source brainstorm**: Session 2026-05-01 morning. 2 design questions resolved. See `Design Decisions` section.

## Problem

Live odds push to kiosk browsers is broken since Phase 1.F (2026-04 archive of the 4 Flashscore scraper producers).

1. **Producer dead, consumer alive**. The 4 legacy scrapers used to publish to Redis channel `odds:live` and write to hash `odds:cache`. They were archived when Plan D Phase 1.F migrated odds intake to the consolidated `services/odds-api-ingester`. The new ingester upserts to `outcomes_v2` but does not publish anywhere.
2. **Consumer infrastructure intact**. `app/api/odds/stream/route.ts` (110 LoC) still subscribes to `odds:live` and serves snapshots from `odds:cache`. `lib/hooks/use-live-odds.ts` (128 LoC) still consumes via `EventSource`. Redis is up. The wire contract is fully specified by the consumer types.
3. **Kiosk fallback is 30s polling**. Without the live channel, kiosks call `/api/sportsbook` every 30s. Live odds drift visibly during in-play minutes. UX target for S6 cutover: **<500ms latency** end-to-end.
4. **Strategic blocker**. Plan D registry item #3a (this spec) is one of 4 remaining S6 cutover blockers. Until shipped, `NEXT_PUBLIC_READ_FROM_V2` cannot flip and `SETTLE_VIA_ODDS_API` cannot enable.

## Goals

- Restore sub-second live odds push for in-play events from ingester upsert to kiosk render.
- Zero changes to the SSE endpoint or the browser hook. The wire contract (`odds:live` channel, `odds:cache` hash, `LiveOddsMessage` shape, `CachedEvent` shape) is preserved exactly.
- Producer is fire-and-forget: Redis failure must not block Postgres upsert (PG remains source of truth).
- Cover ≥95% of in-play outcome changes within 500ms of ingester receiving the odds-api response (target validated post-deploy via timestamp delta sampling).
- Memory and Redis op cost stays bounded (<1MB process memory, <500 ops/min Redis at peak).

## Non-goals

- **Prematch live push**. Kiosks on prematch pages keep 30s polling. Sub-second is unnecessary for prematch UX. Filter: only events with `status='live'` are published with diff updates (the canonical `ApiEvent['status']` value used by the ingester transformer; see `services/odds-api-ingester/src/types.ts`). Events with `status='settled'` get a one-shot terminal message and cache eviction (see Data Flow §"Settled event eviction"). All other statuses (`'pending'`, `'cancelled'`, `'postponed'`) are skipped entirely.
- **Supabase Realtime migration (Option B from brainstorm)**. Discussed and rejected for now. Reasoning: consumer is already wired to Redis+SSE; Option A unblocks S6 cutover in ~1d vs ~3d for Option B. Future architectural cleanup may revisit; tracked separately as registry item — not in this spec.
- **Settled-event push semantics**. Events transitioning to `status='settled'` send a `type='finished'` message and stop publishing. The consumer hook already handles `onFinished` callback. No new transitions are designed here.
- **SSE endpoint hardening, fan-out scaling, kiosk concurrency tests**. The endpoint is intact and was operational before Phase 1.F. Producer change should not regress its behavior. Concurrency stress is out of scope.
- **Bet placement integrity**. Plan D registry item #3e (S3e session 2026-04-30) already shipped dual-ID outcome resolver. Live odds push is read-only for kiosks; bet/place dual-resolver is unaffected.

## Design Decisions

Resolved during brainstorming session 2026-05-01:

| Q | Decision | Rationale |
|---|---|---|
| **Q1** — Architecture: Redis+SSE (Option A) vs Supabase Realtime (Option B) | Option A: ingester publishes to Redis `odds:live` + `odds:cache`, consumer unchanged. | Consumer already wired and operational. Option A is producer-only change (~1d effort). Option B requires consumer browser refactor + Supabase Realtime config + load test (~3d). Cutover is the priority; cleanup can come later. |
| **Q2** — Scope: live-only vs all upserts | Live-only (`status='live'` filter, plus one-shot `status='settled'` for eviction). | Sub-second push has UX value only on live pages. Prematch polling at 30s already satisfies user need. Restricting publish to live caps Redis traffic to ~50 events × 1 cycle/30s ≈ 100 op/min. The canonical status enum is `ApiEvent['status']` from `services/odds-api-ingester/src/types.ts`: `'pending' \| 'live' \| 'settled' \| 'cancelled' \| 'postponed'`. The publisher must reuse this type rather than redeclaring as `string` — catches enum drift at compile time. |
| **Q3** — Diff computation strategy | In-memory `Map` per ingester process. Hydrated lazily (first-tick-after-restart publishes all-changes with `previous_odds=null`). | Fast (no DB roundtrip), bounded memory (~225KB at 50 events × 30 markets × 3 outcomes), restart-safe (consumer treats `null` as first-seen with no UI flash). PG `SELECT` alternative adds 50-200ms per tick — unacceptable on tight cycle. |
| **Q4** — Failure mode if Redis unavailable | Fire-and-forget. Log error, continue ingest. Kiosks fall back to 30s polling automatically. | Redis is an enhancement, not a dependency. Postgres upsert must always succeed (source of truth). Logging gives operator visibility without blocking the pipeline. |

## Architecture

```
┌──────────────────────────────┐
│  odds-api (REST poll)        │
└──────────────┬───────────────┘
               │ scheduler.ts → fetch sport snapshot
               ▼
┌──────────────────────────────────────────────────────────┐
│  services/odds-api-ingester (Node TS, scraper-vps)       │
│                                                          │
│  ingest.ts                                               │
│    ├─ transformer.ts → normalize odds-api payload        │
│    ├─ upsert.ts → write events_v2 / markets_v2 /         │
│    │              outcomes_v2 (Postgres, source of truth)│
│    └─ realtime-publisher.ts (NEW)                        │
│         ├─ filter status='live' (publish) | 'settled'    │
│         │   (final eviction message); else skip          │
│         ├─ diff vs in-memory Map<eventId, OddsState>     │
│         ├─ HSET odds:cache <eventId> <CachedEvent JSON>  │
│         └─ PUBLISH odds:live <LiveOddsMessage JSON>      │
└──────────────────────┬───────────────────────────────────┘
                       │ Redis pub/sub (127.0.0.1:6379)
                       ▼
┌──────────────────────────────────────────────────────────┐
│  betssolution-player /api/odds/stream (UNCHANGED)        │
│    ├─ on connect: HGETALL odds:cache → "snapshot" event  │
│    ├─ subscribe odds:live → "odds" event passthrough     │
│    └─ heartbeat 15s                                      │
└──────────────────────┬───────────────────────────────────┘
                       │ SSE (text/event-stream)
                       ▼
              kiosk browser
              use-live-odds hook (UNCHANGED)
                ├─ onSnapshot: full state for new events
                ├─ onOddsChange: per-event diff with prev_odds
                └─ onFinished: terminal state
```

**Single new module**: `services/odds-api-ingester/src/realtime-publisher.ts` (~120 LoC estimated). All other code is unchanged.

## Components

### `realtime-publisher.ts` (new)

Public API:

```typescript
import type { ApiEvent } from './types.ts';

export interface OddsState {
  // key = `${market_type}|${outcome_name}`
  outcomes: Map<string, number>;
}

export interface PublishContext {
  eventId: number;             // odds-api event id, source-of-truth numeric (ApiEvent.id)
  status: ApiEvent['status'];  // 'pending' | 'live' | 'settled' | 'cancelled' | 'postponed'
  cachedEvent: CachedEvent;    // full snapshot for HSET (its own external_id is already a string)
  newOdds: Array<{ market_type: string; outcome_name: string; odds: number }>;
}

export interface PublishResult {
  published: boolean;
  reason?: 'not_live' | 'no_changes' | 'redis_unavailable' | 'finished' | 'skipped';
  changesCount: number;
}

export function createRealtimePublisher(redisClient: RedisClient): RealtimePublisher;

export interface RealtimePublisher {
  publish(ctx: PublishContext): Promise<PublishResult>;
  // For testing/observability
  getStateSize(): number;
  evictEvent(eventId: number): void;  // called on status='settled' or stale GC pass
}
```

**Type/string boundary**: `eventId` is `number` everywhere inside the publisher (in-memory `stateByEvent` Map keys are `number`, log lines use `number`). Stringification happens **only at the Redis wire boundary** — exactly two call sites: the `HSET odds:cache <String(eventId)> <JSON>` and `PUBLISH odds:live <JSON with event_id: String(eventId)>`. The consumer side already treats `event_id` as string (Redis hash field name, JSON parsed value), so this matches the existing wire contract.

Result reasons:
- `'not_live'` — event status is `'pending'`, `'cancelled'`, or `'postponed'` → no-op
- `'finished'` — event status is `'settled'`, one-shot terminal message published + cache evicted + state evicted
- `'no_changes'` — `status='live'`, cache HSET refreshed but diff was empty (no PUBLISH)
- `'redis_unavailable'` — Redis op threw; logged, swallowed (does not propagate)
- `'skipped'` — publisher disabled via `REALTIME_PUBLISHER_ENABLED=false`

Internal state:

```typescript
const stateByEvent = new Map<number, OddsState>();
```

### `ingest.ts` (modified)

Single new call site: after `upsert.ts` completes the batch, call `publisher.publish(ctx)` for each event in the batch. Wrapped in try/catch to satisfy fire-and-forget contract (errors logged, not propagated).

Estimated diff: +15 LoC.

### `redis-client.ts` (new helper, ~30 LoC)

Singleton Redis client for the ingester process. Connects on first use, reconnects on disconnect with exponential backoff (mirrors player-side `lib/redis.ts` pattern). Exposes `getClient(): Promise<RedisClient>` for the publisher.

Reuses `redis` npm package. Verified absent from `services/odds-api-ingester/package.json` today — must be added as an explicit direct dependency in the planning step (do not rely on hoisting from the player workspace).

## Data Flow

### Tick sequence (per event in `ingest.ts` batch)

1. `transformer` produces normalized event payload.
2. `upsert` writes to `events_v2`, `markets_v2`, `outcomes_v2`.
3. `publisher.publish()` is called. Inside, status routing happens **first**, before any other work:

   ```
   switch (event.status) {
     case 'live':     → live-path (build snapshot, HSET cache, diff, publish if changes)
     case 'settled':  → settled-path (one-shot finished message, HDEL cache, evict state)
     default:         → return {published: false, reason: 'not_live'}  // 'pending'|'cancelled'|'postponed'
   }
   ```

4. **Live-path** (`status='live'`):
   - **Build snapshot**: assemble `CachedEvent` shape from event + markets + outcomes.
   - **HSET cache**: `HSET odds:cache <String(eventId)> <JSON.stringify(CachedEvent)>`. Always written, even if diff is empty (refreshes `updated_at`, `minute`, `period`, `scores`).
   - **Diff**: compare `newOdds` against `stateByEvent.get(eventId)`. Build `changes[]`.
   - **Publish if non-empty**: if `changes.length > 0`, build `LiveOddsMessage` and `PUBLISH odds:live <JSON>`. Update `stateByEvent`.
   - **Return**: `{published: changes.length > 0, reason: changes.length > 0 ? undefined : 'no_changes', changesCount: changes.length}`.

5. **Settled-path** (`status='settled'`, fires once per event):
   - Publish a `type='finished'` message: `PUBLISH odds:live {event_id: String(eventId), ts, type: 'finished', changes: []}`.
   - `HDEL odds:cache <String(eventId)>` to clean up cache.
   - `stateByEvent.delete(eventId)` to remove from in-memory state.
   - **Idempotency**: if `stateByEvent` does not contain `eventId` (event was already evicted, or was never live during this process's lifetime), the settled-path still publishes the `finished` message and runs HDEL — both are idempotent at the wire level. The Map delete is a no-op. This handles ingester restarts mid-event-lifecycle.
   - **Return**: `{published: true, reason: 'finished', changesCount: 0}`.

6. Errors at any sub-step inside `publish()` are caught at the publisher boundary, logged, and converted to `{published: false, reason: 'redis_unavailable'}`. Caller never throws.

### Message shapes (preserved from existing consumer types)

```typescript
// LiveOddsMessage (matches lib/hooks/use-live-odds.ts)
{
  event_id: string;
  ts: number;                // Date.now()
  type: "update" | "finished";
  changes: Array<{
    market_type: string;
    outcome_name: string;
    odds: number;
    previous_odds: number | null;  // null on first-seen
  }>;
  scores?: { home: number; away: number };
  minute?: number;
  period?: string;
}

// CachedEvent (matches lib/hooks/use-live-odds.ts and consumer route)
{
  external_id: string;
  home_team: string;
  away_team: string;
  sport: string;
  league: string;
  minute?: number;
  period?: string;
  scores?: { home: number; away: number };
  markets: Array<{ type: string; outcomes: Array<{ name: string; odds: number }> }>;
  updated_at: number;        // Date.now()
}
```

## Failure Modes

| Failure | Behavior | User impact |
|---|---|---|
| Redis down | Publisher catches `ECONNREFUSED`, logs `[realtime] redis publish failed`, returns `{published: false, reason: 'redis_unavailable'}`. Ingester continues. PG upsert succeeds. | Kiosks fall back to 30s polling (existing behavior). Recovers automatically when Redis returns. |
| Ingester process restart | `stateByEvent` Map is empty on first tick. All in-play outcomes appear as `previous_odds=null` ("first-seen"). Single burst per event of size = total outcomes. Sizing: 50 live events × ~30 markets × ~3 outcomes ≈ 4,500 outcome entries spread across 50 PUBLISH calls (≈90 outcomes per message, ~10KB JSON each). Well within Redis pub/sub default `client-output-buffer-limit pubsub` of 32MB hard / 8MB soft. | Browser hook treats `null` as initial value, renders without arrow/flash. After tick #2, normal diff resumes. |
| odds-api 5xx / timeout | Existing scheduler handling — retry, log, skip cycle. Publisher is not reached. | No live update for that cycle, kiosks see prior cache snapshot until next tick. |
| Kiosk reconnects | Existing SSE handling — `HGETALL odds:cache` snapshot replay on connect. Hook re-receives `onSnapshot` then resumes `onOddsChange`. | Up to 1 cycle of staleness on reconnect. |
| Redis client disconnect mid-publish | `redis-client` helper auto-reconnects with backoff. In-flight publish that failed is treated as `redis_unavailable` for that tick. State Map preserved. | Same as Redis down (transient). |
| Memory leak from never-evicted events | Eviction triggered when publisher sees `status='settled'` for an event. Belt-and-suspenders: periodic GC pass every 5 min removes events not touched in last 30 min from `stateByEvent` (handles cases where event disappears from odds-api before reaching `'settled'`). | None directly; safety net for edge cases (event manually removed from odds-api before settling). |

## Testing

### Unit tests (vitest, in `services/odds-api-ingester/src/__tests__/realtime-publisher.test.ts`)

Strict TDD — write tests first, then implementation.

1. **`computeDiff`** (pure function extracted from publisher):
   - First time seeing event → all outcomes appear with `previous_odds=null`
   - Same odds as prior state → returns empty `changes[]`
   - One outcome changed → returns single entry with correct `previous_odds`
   - New outcome appeared (e.g., new market line) → entry with `previous_odds=null`
   - Outcome disappeared from payload → not in `changes[]` (no delete semantics on wire)

2. **`statusRoute`** (filter, returns `'live' | 'settled' | 'skip'`):
   - `status='live'` → `'live'` (proceed to live-path)
   - `status='settled'` → `'settled'` (proceed to settled-path)
   - `status='pending' | 'cancelled' | 'postponed'` → `'skip'`
   - Type system enforces exhaustiveness on `ApiEvent['status']` (no fallthrough on new enum values without a compile error)

3. **`buildCachedEvent`** (snapshot builder):
   - Output matches `CachedEvent` interface exactly (validated via type-check + test fixture)
   - Includes `minute`, `period`, `scores` when present in input
   - Markets grouped correctly when input has multiple outcomes per market

4. **`publish` end-to-end with Redis mock**:
   - Live event with diff → HSET called, PUBLISH called, returns `{published: true, changesCount: N}`
   - Live event with no diff → HSET called (cache refresh), PUBLISH NOT called, returns `{published: false, reason: 'no_changes'}`
   - Prematch event (`status='pending'`) → neither HSET nor PUBLISH called, returns `{published: false, reason: 'not_live'}`
   - `status='cancelled'` / `'postponed'` → same as prematch path: skipped, returns `{published: false, reason: 'not_live'}`
   - Redis throws → returns `{published: false, reason: 'redis_unavailable'}`, does NOT propagate exception
   - Settled event (`status='settled'`) → publishes `type='finished'` message, HDEL cache, evicts from state, returns `{published: true, reason: 'finished', changesCount: 0}`
   - Settled event called again after eviction → idempotent: still publishes finished + HDEL (both idempotent at wire level), Map delete is no-op

5. **State Map management**:
   - `getStateSize()` reflects insertions
   - `evictEvent()` removes from Map
   - Periodic GC (mocked clock) removes stale entries

### Integration smoke test (manual, on scraper-vps post-deploy)

```bash
# Terminal 1: tail ingester log
ssh scraper-vps 'tail -f /var/log/odds-api-ingester.log | grep realtime'

# Terminal 2: subscribe to channel
ssh scraper-vps 'redis-cli SUBSCRIBE odds:live'

# Terminal 3: dump cache
ssh scraper-vps 'watch -n 2 "redis-cli HKEYS odds:cache | head"'

# Browser: open kiosk on a live event, observe odds movement and price arrows
```

Pass criteria:
- Log shows `[realtime] published <eventId> changes=<N>` for live events
- `redis-cli SUBSCRIBE` receives messages within seconds of expected odds movement
- Cache HKEYS grows when in-play events are detected and shrinks when settled
- Kiosk browser shows quote movement with up/down arrows in real time

### Cutover gate metrics

Post-deploy 24h observation window before flipping `NEXT_PUBLIC_READ_FROM_V2`:
- ≥95% of upserts on `status='live'` events result in `published=true` OR `reason='no_changes'` (i.e., not `redis_unavailable`)
- Median latency from `ts` field (set in `publish()`) to consumer receipt (browser-side `Date.now()` minus `ts`) ≤ 500ms (sampled via temporary kiosk-side log)
- Zero unhandled exceptions in ingester log attributable to publisher
- Memory RSS of ingester process stable (no leak >50MB over 24h)
- `getStateSize()` stays under ~100 entries during normal load (validates Q3 sizing estimate ~225KB; sustained growth above 200 indicates eviction is failing)
- Redis `INFO commandstats` `cmdstat_publish` + `cmdstat_hset` together stay under ~500 op/min during peak live windows (validates Q2 traffic estimate ~100 op/min with 5x headroom)

## Migration / Rollout

### Build and deploy

1. Land code on `feature/plan-d-settlement-d1` branch.
2. Run vitest suite, ensure 100% pass.
3. Build via existing ingester build script.
4. Deploy via the established VPS pattern (bundle on VPS → push from Windows where `gh auth` works as `infoundertheguns-ops`, per memory `project-betssolution-admin-git-desync.md`).
5. `systemctl restart odds-api-ingester`.

### Cutover steps

This spec ships **independent of S6 cutover**. The publisher is additive:
- Without this code: kiosks fall back to 30s polling on legacy path. Working state today.
- With this code (and `NEXT_PUBLIC_READ_FROM_V2=false`): kiosks still use legacy path; the live channel publishes but no consumer is reading the v2-flagged URLs. Harmless.
- With this code (and `NEXT_PUBLIC_READ_FROM_V2=true` at S6 cutover): kiosks use v2 path; live odds push is required and now functional.

So this can ship and run for days/weeks before the S6 flag flip. Recommended: ship and observe 24h before flipping anything else.

### Rollback

- Disable publisher via env flag `REALTIME_PUBLISHER_ENABLED=false`. Publisher returns `{published: false, reason: 'skipped'}` for every call. Ingester behavior reverts to pre-3a state.
- No DB schema changes in this spec → nothing to revert in Postgres.
- No consumer changes → no risk of breaking kiosk pages.

## Open Questions / Future Work

- **Backpressure**: if odds-api delivers a burst (rare league return-from-suspension), 50+ events publishing simultaneously through a single Redis client could queue. Current design: simple sequential publish. If observed problems post-deploy, switch to bounded `p-limit(8)` parallel within the publisher. Not premature now.
- **Cross-process coordination**: this spec assumes single ingester process. If horizontally scaled later, multiple processes would need shared diff state (Redis hash with prior odds, or DB-backed). Out of scope today; single-process is current operational reality.
- **Settled-state cleanup edge case**: events that disappear from odds-api before transitioning to `settled` (e.g., league postponed) leak in `stateByEvent` until the periodic GC pass. Acceptable safety net; not worth a custom signal.
- **Move to Supabase Realtime (Option B)**: tracked as registry item for post-cutover cleanup. Trigger condition: when Redis becomes a maintenance burden, OR when operational simplicity post-cutover matters more than incremental risk. Reassess at 30d post-S6 mark.
- **Latency observability**: temporary kiosk-side timing log for the 24h cutover gate above is manual. Consider promoting to a permanent low-rate observability metric in a follow-up.

## Effort estimate

- Tests + publisher implementation: ~2-3h
- Redis helper + ingest.ts wiring: ~1h
- Smoke test + observation: ~1h
- Build + deploy via VPS bundle pattern: ~1h
- Total: **~6h focused work**, fits in a single session.
