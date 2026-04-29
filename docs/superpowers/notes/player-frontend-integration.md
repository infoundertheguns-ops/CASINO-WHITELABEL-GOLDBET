# Player Frontend Integration — Task 0.3 Discovery Notes

**Date**: 2026-04-22
**Status**: DONE

---

## Active Frontend Path

Both paths are identical in file structure. The **GitHub clone** (`betssolution-player`) is more
up-to-date (has `lib/scoreboard/` modules + `lib/scraper-source.ts`). Use it as the canonical
source for Phase 3 edits and deploy from it.

- **Active production frontend** (GitHub clone, canonical):
  `C:\Users\philp\Downloads\betssolution\betssolution-player\`
- **MIDAS kiosk copy** (missing scoreboard modules, slightly older):
  `C:\Users\philp\Downloads\kiosk-stanleybet\web\`

---

## File: `use-event.ts` — Does Not Exist

The spec at `088.4` references `betssolution-player/lib/hooks/use-event.ts`. **This file does not
exist in either frontend.** There is no per-event hook — event data flows through:

1. `lib/hooks/use-sportsbook.ts` — fetches lists of events (polls `/api/sportsbook`)
2. `lib/hooks/use-live-odds.ts` — SSE hook for live odds updates

For Phase 3 Task 3.11 there is no `use-event.ts` to modify. The modification surface is broader
(see below).

---

## Outcome Object Shape

### DB type (`lib/types/db.ts` — `DbOutcome`)
```ts
interface DbOutcome {
  id: string;
  market_id: string;
  name: string;
  odds: number;          // ← raw odds field (not "price")
  previous_odds?: number;
  is_active: boolean;
  is_suspended: boolean;
}
```
After mig 088 adds columns, `DbOutcome` must gain:
```ts
  manual_odds?: number | null;
  manual_suspended?: boolean | null;
```

### Frontend type (`lib/types.ts` — `Selection`)
```ts
interface Selection {
  id: string;
  name: string;
  odds: number;          // ← this is what all UI reads
  previousOdds?: number;
  code?: string;
  status: "open" | "suspended" | "closed";
}
```

---

## Key Mapper — Primary Modification Point

**File**: `C:\Users\philp\Downloads\betssolution\betssolution-player\lib\mappers.ts`

The `mapOutcome()` function at line 207 is the single place where `DbOutcome` → `Selection`:

```ts
function mapOutcome(o: DbOutcome): Selection {
  return {
    id: o.id,
    name: o.name,
    odds: o.odds,                          // ← CHANGE to: o.manual_odds ?? o.odds
    previousOdds: o.previous_odds,
    status: o.is_suspended ? "suspended" : o.is_active ? "open" : "closed",
    // ↑ CHANGE to: (o.manual_suspended || o.is_suspended) ? "suspended" : ...
  };
}
```

**This is the only mapper.** All UI components (`OddsCell`, `LiveMarketGrid`, `EventRow`) consume
`selection.odds` and `selection.status` from this mapped type — no other mapper exists.

---

## SSE Stream Route

**File**: `C:\Users\philp\Downloads\betssolution\betssolution-player\app\api\odds\stream\route.ts`

- Endpoint: `GET /api/odds/stream?events=<comma-list>`
- Subscribes to Redis channel `odds:live`
- Emits two event types:
  - `snapshot` — initial Redis `odds:cache` hash dump
  - `odds` — live updates with `{ event_id, ts, type, changes: [{ market_type, outcome_name, odds, previous_odds }] }`

The SSE payload shape (`OddsChange`) only carries `odds` (not `manual_odds`). After mig 088, the
Kambi scraper's push to Redis (`odds:live`) also needs to include `manual_odds` if it exists, OR
the SSE serializer on the admin side needs to merge overrides before publishing to Redis.

**Consuming hook**: `lib/hooks/use-live-odds.ts` — `useLiveOdds()` — at line 67, connects to
`/api/odds/stream`. Processes `odds` events and calls `onOddsChange` callback. The live pages
apply deltas on top of the base snapshot from `mapDbToKioskEvent`.

---

## Bet Placement Validation (`app/api/bet/place/route.ts`)

The server-side validation at line 79 re-reads outcomes directly from DB:
```ts
.select("id, odds, is_active, is_suspended, market_id, markets!inner(event_id)")
```

After mig 088 this query must also read `manual_odds` and `manual_suspended`:
```ts
.select("id, odds, manual_odds, is_active, is_suspended, manual_suspended, market_id, markets!inner(event_id)")
```

And line 93 must treat `manual_suspended = true` as suspended:
```ts
if (!current || !current.is_active || current.is_suspended || current.manual_suspended) { ...SUSPENDED }
```

And line 99 odds comparison must use `manual_odds ?? current.odds`:
```ts
const effectiveOdds = current.manual_odds ?? current.odds;
const change = Math.abs(effectiveOdds - sel.odds) / sel.odds;
```

---

## Summary of Files to Modify in Phase 3 Task 3.11

| File | Change |
|------|--------|
| `lib/types/db.ts` | Add `manual_odds?: number \| null` + `manual_suspended?: boolean \| null` to `DbOutcome` |
| `lib/mappers.ts` | `mapOutcome()`: use `manual_odds ?? odds` and `manual_suspended \|\| is_suspended` |
| `app/api/bet/place/route.ts` | Select + validate `manual_odds`/`manual_suspended` server-side |
| `app/api/odds/stream/route.ts` | SSE serializer: include `manual_odds` in `OddsChange` if scraper publishes it |
| `lib/hooks/use-live-odds.ts` | Extend `OddsChange` interface to include `manual_odds?: number` if SSE carries it |

---

## Notes on kiosk-stanleybet vs betssolution-player

The two directories are in sync except `betssolution-player` has `lib/scoreboard/` and
`lib/scraper-source.ts` which `kiosk-stanleybet/web` lacks. This means **betssolution-player is
the more recent branch**. Apply Phase 3 edits to `betssolution-player` — it is the GitHub repo
that CI/CD deploys from (`infoundertheguns-ops/betssolution-player`).

The `kiosk-stanleybet/web` copy may need a manual sync after Phase 3 deploy or it can be left as
a local dev mirror (it is not deployed independently — the VPS runs from the GitHub clone).
