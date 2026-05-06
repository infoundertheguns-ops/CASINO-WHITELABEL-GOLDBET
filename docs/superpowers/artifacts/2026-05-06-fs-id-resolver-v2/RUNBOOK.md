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

## T1 — Sport ID corrections

Deployed 2026-05-06 ~13:11 UTC. Single restart of `flashscore-scraper.service`. Mirrored to `scraper/{config.json,src/sport-id-map.json,src/search.ts}` for git tracking.

### Changes applied

| File | Pre | Post |
|------|-----|------|
| `config.json` (push-loop "sports" array) | baseball=11, pallamano=6, futsal absent | baseball=6, pallamano=7, futsal=11 added |
| `src/sport-id-map.json` (search-endpoint slug→id) | baseball=11, handball=6, futsal absent, no "pallamano" alias | baseball=6, handball=7, pallamano=7, futsal=11 added |
| `src/search.ts` SPORT_NAMES (cosmetic log labels) | 6=Handball, 11=Baseball | 6=Baseball, 7=Handball, 11=Futsal added |

Backups on VPS: `/root/flashscore-scraper/{config.json,src/sport-id-map.json,src/search.ts}.bak-prefix-T1-1778073018`.

### Sanity gates

- vitest: 19/19 pass (unchanged) — no test logic touched yet (T2 territory).
- systemctl: pre-restart `active (running)` PID 3065580 (5 days uptime); post-restart `active (running)` PID 1167535, `/health` reports `{"ok":true,"uptime_sec":20+}`. No errors in `journalctl -n 10` post-restart.

### Smoke probes

| # | Sport | League | Home | Away | HTTP | Result |
|---|-------|--------|------|------|------|--------|
| Manual | baseball | MLB | Philadelphia Phillies | Athletics | **200** | matchId `jNdAe5JO`, viaDayOffset=2 |
| MLB-1 | baseball | USA-MLB | Tampa Bay Rays | Toronto Blue Jays | **200** | matchId `Uu2LwkB5`, viaDayOffset=0 |
| MLB-2 | baseball | USA-MLB | St. Louis Cardinals | Milwaukee Brewers | 404 | no_match (likely T3 normalize territory) |
| MLB-3 | baseball | USA-MLB | Houston Astros | Los Angeles Dodgers | **200** | matchId `UP1XghrK`, viaDayOffset=0 |
| Minor-1 | baseball | Eastern League | Harrisburg Senators | Erie Seawolves | 404 | no_match (minor league — weak FS coverage) |
| Minor-2 | baseball | Eastern League | Chesapeake Baysox | Altoona Curve | 404 | no_match (minor league) |
| Minor-3 | baseball | Triple-A | Worcester Red Sox | Scranton/Wilkes-Barre Railriders | 404 | no_match (minor league) |
| Hand-1 | handball | Russia Superliga | Dinamo Astrakhan | Sgau-Saratov | 404 | no_match (T3 normalize) |
| Hand-2 | handball | Estonia Esiliiga | HC Polva | HC Tallas 2 | 404 | no_match (T3 normalize) |
| Hand-3 | handball | Norway 1. Div Women | HK Rygge | Fyllingen | 404 | no_match (T3 normalize) |

**Headline result**: 3/4 MLB (top-tier) baseball probes return matchIds. Pre-T1 these would have hit sport_id=11 (futsal feed) → guaranteed 0% match. The fix takes effect.

Minor-league baseball + handball remain at 0% — expected per plan (handball needs T3 normalize for non-Latin/Cyrillic team names; lower-tier baseball needs FS coverage which doesn't exist for some affiliates). Not a regression and not a blocker — T3 will re-test after normalize lands.

### Audit decision

Pre-T1 audit (T0) confirmed 0 cross-canonical false positives. After T1 deploy, no new fs_ids have been written yet (only `/search` requests probed; `Upserter.maybeResolveFsId` runs on each ingester tick, T2-T4 will follow before next backfill). No cleanup needed.

### Coverage delta (probe-level proxy, pre vs. post-T1)

Direct DB coverage hasn't changed yet (no resolver call has populated rows post-restart in this 5-min window). The right delta is **probe success rate**:
- baseball pre-T1: 0% match (sport_id=11 → wrong feed). Today: 3/4 = **75%** on MLB probes.
- handball pre-T1: 0% match (sport_id=6 → wrong feed). Today: 0/3 — sport_id is now correct (=7) but team-name normalization (T3) blocks all 3 Eastern European league probes.

T6 will measure DB-level coverage after T2-T5 land and the backfill v2 sweeps.

### Commits

- `2a3e435` — mirror config.json + sport-id-map.json + search.ts to artifacts
- `this commit` — RUNBOOK.md T1 section


## T2 — normalize.ts TDD: failing tests

Mirrored 2026-05-06 (single commit `5e58a7a` per task list). Wrote 36 vitest cases covering: basic normalization, Eastern European prefix stripping, alias dictionary lookup, reserve-marker capture, and `matchTeams` Stage 1/2/3 behaviour. Pre-T3 baseline: **24 failed, 22 passed** out of 46 (cache 5 + normalize 36 + search 5).

Mirror only — no production changes. Service untouched.

## T3 — normalize.ts rewrite (token-based)

Deployed 2026-05-06 ~13:27 UTC. Single restart of `flashscore-scraper.service`. Mirrored to `scraper/src/{normalize.ts, search.ts, __tests__/search.test.ts}`.

### Changes applied

| File | Pre | Post |
|------|-----|------|
| `src/normalize.ts` | 22 LoC, regex-based suffix strip, `normalizeTeam: string -> string`, `matchTeams: (string,string) -> boolean` | 86 LoC, token-based, `normalizeTeam: -> NormalizedTeam {tokens, key, reserveMarkers}`, `matchTeams` 3-stage (reserve guard / strict eq / discriminating subset) |
| `src/search.ts` | calls `normalizeTeam` (treated opaquely; `matchTeams` consumes them) | unchanged at the source level (new return type flows via inference; tsc clean) |
| `src/__tests__/search.test.ts` | mocks `normalize.js` is NOT done (uses real module) | unchanged; tests still pass without mock changes |

`NOISE_TOKENS` (30 entries):
- Generic affixes: `fc/ac/cf/sc/sk/ss/ssc/usl/calcio/afc/cfc/usd`
- Eastern European prefixes (from discovery): `gks/kkp/kf/fk/mfk/ks/bk/ofk/zsk/nk/hnk/gnk/ffk/fck/rfk`
- Women's marker: `d` (FS appends to women's club names)
- Filler: `club/team/sport/sports`

`RESERVE_MARKERS` (preserved separately so `Roma` ≠ `Roma B`):
`ii/iii/b/c/u17/u19/u20/u21/u23/2/3/youth/academy/reserves`

`matchTeams` 3-stage:
1. Reserve marker mismatch → hard fail (e.g. `Roma` ≠ `Roma B`).
2. Strict eq on canonical key → match (fast path; covers all post-prefix-strip exact matches).
3. Subset on discriminating tokens (length ≥ 4, non-reserve) → match (handles city-qualifier divergence: `Shkendija Tetovo` ↔ `Shkendija`).

Backups on VPS: `/root/flashscore-scraper/src/{normalize.ts,search.ts}.bak-T3-1778073900`.

### Sanity gates

- vitest: **46/46 pass** (cache 5 + normalize 36 + search 5). Was 22/46 pre-T3.
- tsc --noEmit: **0 errors** (NormalizedTeam type flows through search.ts via inference; no call-site change needed).
- systemctl: pre-restart PID 1167535; post-restart PID 1178126, `/health` reports `{ok:true,uptime_sec:5+}`. No errors in journalctl.

### Smoke probes (T3 — football discovery cases)

| # | Home | Away | Time UTC | HTTP | Result |
|---|------|------|----------|------|--------|
| F-1 | GKS Katowice | KKP Stomilanki Olsztyn | 2026-05-06T13:00 | 404 | no_match (FS feed has 0 candidates within ±10min — game not on FS today) |
| F-2 | FC Prishtina | Prishtina E Re | 2026-05-06T13:00 | 404 | no_match (FS feed has 0 candidates within ±10min — Kosovan league not tracked today) |
| F-3 | AS Muhanga | Rayon Sports FC | 2026-05-06T13:00 | 404 | no_match (FS feed has 0 candidates within ±10min — Rwandan league not tracked today) |
| F-4 | KF Shkendija Haracine | Shkendija Tetovo | 2026-05-06T14:00 | **200** | matchId `StvqC7KG`, viaDayOffset=0 — Stage 3 subset matching (city qualifier divergence) |
| F-5 | FC Dinamo City | FK Vora | 2026-05-06T14:00 | 404 | no_match — FS has `Din. Tirana vs Vora` at 14:00 (away matches; home `dinamo city` ≠ `din tirana` — alias problem, not normalize) |

**Headline result**: 1/5 = 200 (was 0/5 pre-T3). The successful F-4 case proves Stage 3 subset matching (city qualifier divergence) works. The remaining 4 break down as:
- F-1, F-2, F-3 (3/5): legitimate `no_match` — verified via direct FS feed dump that no candidate fixtures exist within ±10min for those slots/sports today. Not a normalize issue.
- F-5 (1/5): FS has the away team match (`vora`) but the home team name on FS (`Din. Tirana`) is a different label for what the odds-api calls `Dinamo City`. This is an **alias-dictionary problem**, not a normalize problem. Adding `football:dinamo city` → `tirana` (or a separate alias entry) would resolve it.

The 1/5 is below the optimistic 3/5 plan estimate, but the actual signal is correct: where FS HAS the game, normalize now finds it. The other failures are not normalize-fixable — they need FS feed data to exist (3/5) or alias entries (1/5). Improvement vs all-404 baseline confirmed.

Cross-checked diagnosis via `probe-fs2.mjs` (in /tmp on VPS):
- F-1/F-2/F-3: filter candidates within ±10min returns 6 fixtures, none related to those teams/leagues. No normalize tweak helps.
- F-4: 21 candidates within ±10min, exactly one matches `[HA]` → `Shkendija Haracine vs Shkendija` → resolved.
- F-5: 21 candidates within ±10min, exactly one matches `[.A]` (away `vora` only). Home label divergence is alias work, not normalize.

### Coverage delta (probe-level proxy, pre vs. post-T3)

- Football discovery cases pre-T3: 0/5 (regex strip didn't handle multi-token prefixes, no Stage 3 subset).
- Football discovery cases post-T3: 1/5 (Shkendija subset case fixed).
- Other 4 are non-normalize bottlenecks (3 absent from FS feed, 1 alias divergence).

T6 will measure DB-level coverage after T4 (telemetry tags) and T5 (backfill v2) land.

### Commits

- `<this commit>` — mirror normalize.ts + search.ts + search.test.ts to artifacts
- `<next commit>` — RUNBOOK.md T2 + T3 sections
