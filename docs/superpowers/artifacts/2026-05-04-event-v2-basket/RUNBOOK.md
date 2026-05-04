# Event-v2 basket extension — Deployment RUNBOOK

**Date deployed**: 2026-05-04 / 2026-05-05
**Branch**: `feature/plan-d-settlement-d1`
**Final BUILD_ID**: `FdvLEwTr2feBMgqDRcNEn`

## What shipped

### Backend (admin git)
- `services/odds-api-ingester/src/transformer.ts` — added rule 0a (label preservation in `{label, over, under}` markets). Fix recovers ~1450 collapsed player labels across baseball + basket.
- `services/odds-api-ingester/src/__tests__/transformer.test.ts` — 4 new test cases (rule 0a basic, with stat suffix, regression for label-absent, whitespace fall-through).

### Backend operations
- DELETE'd ~32,453 stale `outcomes_v2` rows for all `Player Props` markets across 134 events (basket + baseball + hockey).
- Re-ingested ~6,950 outcomes with new `<player>::over` / `<player>::under` format. Backup at `/tmp/outcomes_v2-player-props-backup-20260504-200903.json` on scraper-vps (10.6MB).

### Frontend (player non-git, mirrored in `player/` here)
- `lib/market-config-v2.ts` — `BASKET_TAB_MARKETS_V2` (7 tabs), `BASKET_TAB_ORDER`, `BASKET_DEFAULT_SUB_PILL`, registered in 3 lookup maps.
- `lib/market-categorizer-v2.ts` — new `@over-under-flat` suffix.
- `lib/line-picker-defaults.ts` — `MEDIAN_LINE = -1e9` sentinel + basket DEFAULTS block + Spread NQ added to SENTINEL_FAMILIES.
- `components/event-v2/LinePicker.tsx` — MEDIAN_LINE branch in `pickDefault`.
- `components/event-v2/PlayerOverUnderRow.tsx` — NEW component for Player Props (`<player> (<stat>)::over/under` rendering, 1 row per player + line, Over + Under buttons paired).
- `components/event-v2/PlayerYesNoRow.tsx` — NEW component for Double Double (`<player> (Yes/No) (<team>)` rendering, 1 row per player, Sì + No buttons paired).
- `components/event-v2/PlayerListFlat.tsx` — REWROTE: 1 row per player + OVER badge + "Mostra altri X risultati" expand bar (was multi-column grid).
- `app/(kiosk)/event/[eventId]/page-v2.tsx` — extended `isHero` for basket T/T (sportSlug guard), `BASKET_TITLE_OVERRIDES` (18 entries with "OLTRE" prefix on Milestones), `titleFor` updated to accept optional `sportSlug` param, `resolveBasketOverride` helper used in titleFor + renderGroupedMarket, `isOverUnderFlat` detection wired to PlayerOverUnderRow, Double Double detection wired to PlayerYesNoRow, basket Milestones added to PLAYER_FLAT_TYPES, `Double Double` intentionally NOT in PLAYER_FLAT_TYPES (Yes/No bet), Player First Basket/Assist/Rebound in PLAYER_FLAT_TYPES.
- `next.config.ts` — added `headers()` function: HTML pages `no-cache, no-store, must-revalidate`; chunks `max-age=3600, must-revalidate` (was 1y immutable — reduced to allow faster cache invalidation).

### Configuration
- `/root/betssolution-player/.env.local` — flag `NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio,tennis,basket`.
- Backup: `/root/betssolution-player/.env.local.bak-pre-basket-flip`.

## Build IDs (chronological)

| BUILD_ID | When | Notes |
|---|---|---|
| `LSNWI9YAkVtiTA_sn-l4D` | pre-deploy (tennis ship) | starting point |
| `Wq9sMQl3Z4Q8oC0yesilF` | 21:09 | post initial frontend implementation, basket flag still off |
| `Xq27h3ASKdpXdXj9i5tHD` | post-flag-flip | first basket-active build |
| `DlRn0iaEQ_0Ns80_2_idi` | PlayerListFlat rewrite | 1 row per player |
| `n9ihqu8x8KAJA159mO9Sz` | next.config.ts cache headers | |
| `JazeCQe-BNrolDQ0HM8Yg` | basket types in PLAYER_FLAT_TYPES + titleFor in PlayerListFlat | |
| `KvvfT8Lv5bxpcU9X8kbwh` | Double Double removed from PLAYER_FLAT_TYPES | |
| `XlGe2NGwygqNrjw3aWWuD` | playerDisplay color/style debug | |
| `FdvLEwTr2feBMgqDRcNEn` | **FINAL** — PlayerYesNoRow for Double Double | active in prod |

## Smoke test summary

- OK Punti / Rimbalzi / Triple / Assist sub-pills: 1 row per player, OVER badge, line in title ("OLTRE 5/10/15..."), expand bar
- OK First sub-pill: 1 row per player with team tag (Home/Away), labels "PRIMO CANESTRO/ASSIST/RIMBALZO"
- OK Altro sub-pill: Double Double 1 row per player Sì/No buttons; Player Props 1 row per (player, line) Over/Under buttons with stat tag
- OK Title overrides: "PUNTI GIOCATORE - OLTRE", "VINCENTE 1° QUARTO", "HANDICAP 1° QUARTO", "UNDER/OVER (CON OT)"
- OK Cross-sport regression: calcio + tennis no regressions

## Rollback

### Frontend (no admin commit needed)
```bash
sed -i 's/NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio,tennis,basket/NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio,tennis/' /root/betssolution-player/.env.local
systemctl restart betssolution-player
```

### Backend transformer (commit revert)
```bash
cd /root/betssolution-admin
git revert <transformer-fix-commit-sha>
npm run build
systemctl restart odds-api-ingester
```
Note: this will produce data with old format alongside the new — frontend handles both gracefully via fallback in PlayerOverUnderRow (returns null on legacy outcomes).

## Known follow-ups (not in scope)

- Card Handicap / Handicap-1T edge case (`"1 (-1)"`/`"Tie (1)"` outcome names) — applies to football too, registry pending.
- Deploy script automation: symlink `.env.local` standalone + copy `.next/static`+`public/` still manual (now also rebuild after every change).
- Player repo NOT git: `/root/betssolution-player/` mirror via this artifact directory.
