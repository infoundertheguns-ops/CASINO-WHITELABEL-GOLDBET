# Task 17 — verify player-event-v2.ts no whitelist

**Date**: 2026-05-03
**Branch**: feature/plan-d-settlement-d1
**File**: /root/betssolution-player/lib/queries/player-event-v2.ts

## Function inspected

`loadPlayerEventV2(eventId)` — three sequential queries:

```ts
// 1. Event
supabase.from("v_player_events").select("*").eq("id", eventId).maybeSingle()

// 2. Markets — THIS IS THE ONE THAT MUST NOT WHITELIST
const { data: marketsRaw } = await supabase
  .from("v_player_markets")
  .select("id, event_id, bookmaker, source_market_name, market_type, line, category, is_suspended, sport_slug, flashscore_id")
  .eq("event_id", eventId)
  .returns<V2MarketRow[]>();

// 3. Outcomes (chunked by 200 market_ids)
supabase.from("v_player_outcomes").select(...).in("market_id", slice)
```

## Filters present

Markets query filters:
- `.eq("event_id", eventId)` — required scope filter, NOT a market-name whitelist
- No `.in("market_name", ...)`, no `.in("source_market_name", ...)`
- No `LISTING_MARKET_WHITELIST` import or reference
- No `.eq()` / `.match()` on market_type / source_market_name / category

Outcomes query filters: only `.in("market_id", slice)` (chunking, not whitelist).

Event query filters: only `.eq("id", eventId)`.

**Conclusion: no whitelist filter exists on markets.**

## DB vs API counts (sample event b9a6826c-0bd4-4ac5-89b3-ec6fc13d909d, calcio prematch)

| Source                                | Count |
|---------------------------------------|-------|
| `v_player_markets WHERE event_id=...` | 340   |
| `loadPlayerEventV2()` markets length  | 340   |

Match: **yes, exact 340 = 340**. Distinct `market_type` values returned: 68.

Methodology: invoked the same Supabase JS query the function uses (mirror script under `cd /root/betssolution-player && node test-script.mjs <id>`) since no `/api/event/<id>` HTTP endpoint exists. The page (`app/(kiosk)/event/[eventId]/page.tsx`) calls `loadPlayerEventV2` client-side; the function logic was reproduced 1:1 with no extra filters added or removed.

## Conclusion

- [x] No whitelist filter exists → safe for V2 page (Task 15) — all 340 markets exposed; downstream `categorizeMarketsToTabs` decides per-tab grouping with full universe.
- [ ] Whitelist filter EXISTS → needs removal in follow-up task.

No code change required. Reference: `lib/queries/sportsbook-listing-v2.ts` retains its `LISTING_MARKET_WHITELIST` for tile listing performance — that is the listing path, NOT this event-detail path.
