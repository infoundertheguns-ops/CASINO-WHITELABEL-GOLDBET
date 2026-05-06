# FS-id Resolver v2 — Deployment Runbook

Implementation plan: `docs/superpowers/plans/2026-05-06-fs-id-resolver-v2.md`
Spec: `docs/superpowers/specs/2026-05-06-fs-id-resolver-v2-design.md`
Branch: `feature/plan-d-settlement-d1`

## Pre-deployment baseline (2026-05-06)

Captured before any code change. Used as the "BEFORE" reference for measuring T6 success criteria.

### Search /stats (BEFORE)

Endpoint: `http://127.0.0.1:8090/stats` on `scraper-vps` (flashscore-scraper).

```json
{
  "uptime_sec": 488159,
  "search_requests_total": 960036,
  "cache_hits": 2746556,
  "cache_misses": 132648,
  "cache_size": 252,
  "fs_403_count": 0,
  "fs_5xx_count": 0,
  "no_match_count": 959514
}
```

Key signal: `no_match_count / search_requests_total = 959514 / 960036 = 99.95%` no-match rate.
This is the headline failure mode the resolver v2 must move. Target post-T6: ≥30% reduction in no-match share.

`cache_hits` (2.7M) >> `cache_misses` (132k) confirms the Map-based search cache is working — the upstream pressure is on FS itself (or rather, we never reach FS because normalize.ts rejects the team strings).

`fs_403_count = 0` and `fs_5xx_count = 0` confirm flashscore.com is healthy; the bottleneck is purely client-side normalize logic.

### DB coverage events_v2 (BEFORE)

```text
=== Coverage events_v2 by sport ===
┌─────────┬─────────────────────┬─────────┬────────┬─────────┐
│ (index) │ sport_slug          │ with_fs │ total  │ pct     │
├─────────┼─────────────────────┼─────────┼────────┼─────────┤
│ 0       │ 'football'          │ '2496'  │ '4819' │ '51.8'  │
│ 1       │ 'tennis'            │ '495'   │ '2764' │ '17.9'  │
│ 2       │ 'basketball'        │ '584'   │ '1069' │ '54.6'  │
│ 3       │ 'baseball'          │ '0'     │ '868'  │ '0.0'   │
│ 4       │ 'esports'           │ '46'    │ '590'  │ '7.8'   │
│ 5       │ 'handball'          │ '0'     │ '343'  │ '0.0'   │
│ 6       │ 'ice-hockey'        │ '90'    │ '192'  │ '46.9'  │
│ 7       │ 'volleyball'        │ '68'    │ '187'  │ '36.4'  │
│ 8       │ 'darts'             │ '0'     │ '144'  │ '0.0'   │
│ 9       │ 'cricket'           │ '46'    │ '128'  │ '35.9'  │
│ 10      │ 'rugby'             │ '32'    │ '110'  │ '29.1'  │
│ 11      │ 'boxing'            │ '0'     │ '54'   │ '0.0'   │
│ 12      │ 'mma'               │ '0'     │ '49'   │ '0.0'   │
│ 13      │ 'american-football' │ '8'     │ '8'    │ '100.0' │
│ 14      │ 'snooker'           │ '0'     │ '3'    │ '0.0'   │
└─────────┴─────────────────────┴─────────┴────────┴─────────┘
```

Notable drift from the plan's expected baseline (~75% football, 4776 total): football is now at **51.8%** (4819 total). The 22pp drop suggests recent ingester runs have been creating new football events faster than the resolver succeeds on them — coverage erosion is still active. Resolver v2 must arrest this trend, not just hold it.

Sports at **0.0% with_fs** (untouched by current resolver):
- baseball (868), handball (343), darts (144), boxing (54), mma (49), snooker (3)

T1 (sport_id corrections) targets baseball + handball (these have known sport_id mismatches in scraper config). darts/boxing/mma/snooker are out of scope (FS likely has them, but they need separate sport_id mappings — flagged as residual).

### Hidden stats+player markets (BEFORE)

Markets active on the home/event pages **but suppressed because the parent event has `flashscore_id IS NULL`** (player + stats categories require fs_id for settlement):

```text
=== Hidden markets (stats+player on FS-null events) ===
┌─────────┬──────────┬─────────┬──────────┐
│ (index) │ category │ hidden  │ total    │
├─────────┼──────────┼─────────┼──────────┤
│ 0       │ 'player' │ '4476'  │ '15047'  │
│ 1       │ 'stats'  │ '31469' │ '117211' │
└─────────┴──────────┴─────────┴──────────┘
```

- player: **4476 / 15047 (29.7%)** hidden
- stats: **31469 / 117211 (26.8%)** hidden
- combined: **35945 markets** invisible to bettors today — exactly the surface T6 is supposed to recover.

Plan's expected baseline (~4431 player, ~31391 stats) matches within rounding. ✅

### Pre-deploy audit — cross-canonical legacy events

Goal: detect "false positive" residue in the *legacy* `events` table that could re-pollute `events_v2` via `canonical_id` joins on the first ingester run after T1 deploys.

```text
=== Legacy events by sport (90d window) ===
┌─────────┬─────────────┬─────────┬────────┐
│ (index) │ sport_slug  │ with_fs │ total  │
├─────────┼─────────────┼─────────┼────────┤
│ 0       │ 'baseball'  │ '0'     │ '3926' │
│ 1       │ 'futsal'    │ '0'     │ '499'  │
│ 2       │ 'pallamano' │ '0'     │ '3319' │
└─────────┴─────────────┴─────────┴────────┘
```

(Note: legacy `events` joins `sports` for `slug`. Italian slug `pallamano` covers handball; `handball` slug does not exist on legacy side. `futsal` and `baseball` likewise enumerated.)

```text
=== Cross-canonical FALSE POSITIVES ===
(empty result set)
```

**Decision: 0 cross-canonical false positives → no cleanup migration needed.** Records are dormant: zero legacy events for these sports carry an fs_id, so there is no path by which step 2 (canonical_chain) of the resolver could pull a wrong fs_id from a legacy sibling on first run post-T1. Proceeding directly to T1.

### Scope note

This change touches `flashscore-scraper` and `services/odds-api-ingester` only. **No `betssolution-player` rebuild required.** No frontend / kiosk impact. The `.env.local` symlink footgun in `.next/standalone/` does NOT apply here.

Affected services on deploy:
- `flashscore-scraper.service` (rebuild + restart for normalize.ts changes)
- `odds-api-ingester.service` (rebuild + restart for resolver call-site / sport_id mapping changes)

Frontend stays on whatever `NEXT_PUBLIC_READ_FROM_V2` is currently set to (live: `true`). New fs_ids populate `events_v2.flashscore_id` directly; the player app reads it on next request. No bundle change, no SSR cache invalidation needed.
