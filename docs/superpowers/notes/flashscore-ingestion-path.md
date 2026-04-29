# Flashscore Result Ingestion Path — Discovery Note

**Date**: 2026-04-22
**Task**: 0.1 (pre-Phase 4 investigation)
**Status**: COMPLETE — all paths confirmed

---

## Summary

Flashscore results are ingested via **HTTP POST from the standalone flashscore-scraper to the admin API endpoint `/api/flashscore/results`**. The admin endpoint then directly calls `supabase.from("events").update(...)` to write `score_home`, `score_away`, and `live_data` fields, followed by `settleEvent()`.

---

## Files Involved

### flashscore-scraper (C:\Users\philp\Downloads\flashscore-scraper\)
- **`src/results-loop.ts`** — Polls Flashscore feed every 5 min for each sport (today + yesterday). Calls `pushResults(allResults, sport.name)`.
- **`src/push-to-vincitu.ts`** — HTTP client. `pushResults()` POSTs to `${VINCITU_URL}/api/flashscore/results` with `{ results, sport }` body and `x-scraper-key` auth header. `VINCITU_URL` defaults to `http://localhost:3000` (set to admin prod URL on scraper-vps via env var).

### betssolution-admin (C:\Users\philp\Downloads\betssolution\betssolution-admin\)
- **`app/api/flashscore/results/route.ts`** — POST handler. Matches incoming results to DB events (direct via `flashscore_id`, or fuzzy via `matchEvents()`). For each match, calls `verifyAndSettle()`.

---

## Current Write Path

Inside `verifyAndSettle()` in `app/api/flashscore/results/route.ts` (lines 174–196):

```typescript
await supabase
  .from("events")
  .update({
    score_home: fsResult.scoreHome,
    score_away: fsResult.scoreAway,
    live_data: updatedLiveData,   // includes verified_by, halfScoreHome/Away
    updated_at: new Date().toISOString(),
  })
  .eq("id", ev.id);
```

Then `settleEvent(supabase, ev.id)` is called immediately after to settle bets.

**No RPC involved** — it is a direct `from('events').update()` call in the admin Next.js process. The scraper never touches Supabase directly.

---

## Recommendation for Phase 4

Phase 4 needs flashscore results to write to `canonical_events.result` and fan out to linked `events` rows via trigger.

### Option A — Modify the existing admin endpoint (RECOMMENDED)

Modify `app/api/flashscore/results/route.ts → verifyAndSettle()`:
1. After the existing `events.update()`, add a lookup: resolve `canonical_event_id` from the matched event (via a new FK column or join).
2. Upsert `canonical_events SET result = {...}, score_home = ..., score_away = ...` where `id = canonical_event_id`.
3. The DB trigger (migration 089) fans out `score_home/score_away` back to all linked `events`.
4. Remove the direct score update from `events.update()` (let trigger handle it) — or keep it as a fallback if `canonical_event_id` is null (events not yet matched to a canonical).

This option requires **zero changes to the flashscore-scraper**. The scraper already POSTs to the admin endpoint; the admin endpoint absorbs the redirect logic.

### Option B — New RPC `ingest_flashscore_result(event_id, score_home, score_away, live_data)`

Create a Postgres RPC that:
1. Writes to `events` (current behavior).
2. Resolves canonical event and writes to `canonical_events`.
3. Returns same shape as current update.

Replace the `supabase.from('events').update(...)` call with `supabase.rpc('ingest_flashscore_result', ...)`.

Advantage: atomic + single round-trip. Disadvantage: more migration surface.

### Option C — Separate new endpoint `/api/flashscore/results-v2`

Not recommended — splits logic, requires scraper change to call new URL.

---

## Blockers

None. All paths confirmed from source. Phase 4 can proceed with Option A:
- Modify `verifyAndSettle()` in `app/api/flashscore/results/route.ts` to also upsert `canonical_events`.
- Migration 089 must create the `canonical_events` table with a trigger that fans out score/result to linked `events`.
- No flashscore-scraper changes needed.

---

## Additional Context

- The `verify-results` cron (`app/api/cron/verify-results/route.ts`) also writes flashscore data to `events` — but this is a separate admin-initiated cron for active events, not the primary results ingestion path. It also uses direct `events.update()` and would need parallel modification in Phase 4.
- `flashscore_id` is stored on `events` rows after first match (direct lookup fast path on subsequent calls).
