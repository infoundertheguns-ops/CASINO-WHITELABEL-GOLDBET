# Prestige Sync Integration — Discovery Notes
> Task 0.2 output. Investigated 2026-04-22.

## TL;DR

**No prestige-specific outcome sync exists.** The term "prestige sync" in spec 088.4 refers to the agent/kiosk network (TOTP-based prestige agents at kiosk terminals). There is no dedicated export/push mechanism that sends outcomes to a separate prestige system. Outcomes reach kiosk players via the **standard player frontend** (`betssolution-player`) which reads directly from the Supabase DB. The only bet-placement gate is `app/api/player/place-bet/route.ts`.

## What Was Searched

| Location | Pattern | Result |
|---|---|---|
| `betssolution-admin/app/api/` + `lib/` | `prestige`, `agent_sync`, `push-to-vincitu`, `vincitu`, `shadow` | No hits |
| `kambi-scraper/src/` | `prestige`, `vincitu`, `shadow`, `push` | No hits on prestige/shadow |
| `22bet-scraper/src/` | `prestige`, `vincitu`, `staging` | Only `push-to-vincitu` (standard HTTP push, no prestige-specific logic) |
| `betssolution-player/` | `prestige`, `agent_sync`, `sync.*outcome` | No hits |
| `.env.local` (admin), `.env` (kambi), `.env` (22bet) | `PRESTIGE`, `STAGING`, `SHADOW`, `AGENT` | No prestige-specific env vars |

## What "Prestige" Actually Means Here

Memory files (`agent-tickets-verify.md`, `betssolution-player.md`, `terminale51-kiosk.md`) use "prestige" to refer to **prestige-level agents** — TOTP-authenticated kiosk operators (e.g., `terminale51`, `agent prestige+TOTP`). These are standard agents in the `agents` DB table. There is no separate prestige sync service or prestige API.

## How Outcomes Reach Kiosk/Agent Players

The flow is pull-only from kiosk terminals:

1. **Scraper** (kambi or 22bet) → HTTP POST to `/api/scraper/live` or `/api/scraper/prematch` → admin calls `upsert_live_batch` or `upsert_prematch_batch` RPC → writes to `outcomes` table in Supabase.
2. **Kambi dual-write** (`shadowPush` in `kambi-scraper/src/push-to-vincitu.ts` on prod VPS): fires to BOTH `http://localhost:3000` (prod) and `https://admin-staging.betssolution.com` (staging). This is admin-to-admin replication only, no prestige-specific target.
3. **Kiosk player** (`betssolution-player` on port 3001) reads outcomes via **SSE stream** from `/api/odds/stream` (Redis pub/sub `odds:live`) or direct Supabase queries. No outcome push from admin to kiosk.
4. **Bet placement**: `app/api/player/place-bet/route.ts` validates outcome at bet time:
   ```typescript
   // line 232–244
   const { data: outcome } = await supabase
     .from("outcomes")
     .select("id, odds, is_active, is_suspended, market_id, name, ...")
     .eq("id", sel.outcomeId)
     .single();
   if (!outcome.is_active || outcome.is_suspended) {
     return NextResponse.json({ error: `Esito sospeso`, code: "OUTCOME_SUSPENDED" }, { status: 400 });
   }
   ```

## Recommendation for Phase 3 Task 3.12

**There is no separate prestige push to modify.** The modification required for 088.4 is:

### 1. Bet placement gate (ALREADY the right place)
`app/api/player/place-bet/route.ts` lines 242–244 — add `manual_suspended` check:

```typescript
// Before (line 242)
if (!outcome.is_active || outcome.is_suspended) {

// After
if (!outcome.is_active || outcome.is_suspended || outcome.manual_suspended) {
```

Also ensure the SELECT on line 232 includes `manual_suspended` and `manual_odds`:
```typescript
.select("id, odds, is_active, is_suspended, manual_suspended, manual_odds, market_id, name, markets(...)")
```

### 2. SSE stream (odds/stream/route.ts)
The Redis snapshot (`odds:cache`) and `odds:live` channel are populated by the scraper via `upsert_live_batch` RPC. The RPC writes whatever the scraper sends — it does NOT re-read manual overrides from the DB after writing. So `manual_suspended` / `manual_odds` will NOT appear in the Redis SSE stream unless:
- The RPC `upsert_live_batch` is modified to include `manual_odds`/`manual_suspended` in its output, OR
- A DB trigger on `outcomes` publishes to Redis on manual override change (recommended for Phase 3).

The betssolution-player UI will need to receive `manual_suspended` and `manual_odds` via SSE or direct Supabase Realtime. The spec's 088.4 approach (modify `use-event.ts` to use `manual_odds ?? odds` and `!manual_suspended`) requires those fields to reach the player. Current SSE only carries what the scraper last pushed (from Redis cache) — manual overrides stored in Supabase won't flow through unless the SSE is extended or the player falls back to Supabase Realtime for manual_* columns.

### 3. Spec test plan step 10 verdict
**NOT "not applicable"** — the bet placement gate IS the prestige sync. Kiosk bets go through `place-bet/route.ts` (with Bearer token auth). Adding `manual_suspended` check there covers all agent/kiosk bet paths. Test plan step 10 remains valid, with the test being: place manual_suspended on outcome → kiosk/agent bet on it → expect `OUTCOME_SUSPENDED` error.

## Schedule / Retry Cadence

No prestige-specific cron or scheduled sync. The scraper upsert cycle (kambi live: 30s, prematch: 3-20min) is the only push cadence. Manual overrides applied via admin RPC will be visible to bet placement immediately (direct DB read at placement time).

## Files Relevant to Phase 3 Task 3.12

- `C:/Users/philp/Downloads/betssolution/betssolution-admin/app/api/player/place-bet/route.ts` — add `manual_suspended` to SELECT + rejection gate (lines 232, 242)
- `C:/Users/philp/Downloads/betssolution/betssolution-admin/app/api/odds/stream/route.ts` — SSE stream (Redis-based); needs companion work to carry manual_* columns
- `C:/Users/philp/Downloads/betssolution/betssolution-player/` — `use-event.ts` hook to use `manual_odds ?? odds`
- `C:/Users/philp/Downloads/kambi-scraper/src/push-to-vincitu.ts` — dual-write (prod VPS only); no prestige-specific modifications needed here
