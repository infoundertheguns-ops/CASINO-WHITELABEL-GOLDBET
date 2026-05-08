# SofaScore 14-Sport Extension — Design

**Date:** 2026-05-08
**Author:** philp + Claude
**Status:** Draft (brainstorm-approved)

## Goal

Estendere il matcher SofaScore + scraper Python da 3 sport (football, tennis, basketball) a 14 sport (parity con eventi presenti in `events_v2` nelle 48h: baseball, esports, handball, rugby, darts, ice-hockey, cricket, volleyball, boxing, mma, american-football, snooker + i 3 esistenti). Big-bang rollout in un singolo ciclo.

Output atteso post-deploy:
- `by_sport` stats endpoint mostra count > 0 per ≥7 dei nuovi sport (alcuni sport rari come snooker possono avere 0 events oggi)
- `no_time_window/received < 0.30` mantenuto post-extension
- 403/429 ratio < 5% nelle prime 24h post bump capacity (gate analogo a phase-0)

## Non-Goals (out of scope, carried over)

- Non si tocca il codice FS (sia admin route che scraper repo). Acceptance Sofa-only.
- Non si refactora `teamMatchScore` per sport-aware noise tokens (task #22).
- Non si unifica `TIME_TOLERANCE_BY_SPORT` con il duplicato in `flashscore-scraper/src/sample-collector.ts` (task #22).
- Non si aggiunge alias mining specifico per nuovi sport (rischio: `no_match_name` alto per MMA/darts/snooker/esports — accettato come iterazione futura).

## Architecture

Single source of truth per la lista sport: la tuple `SOFA_SPORTS` in:
- `app/api/sofascore/fixtures/_lib.ts` (admin) → autoderiva `SOFA_VALID_SPORTS` Set + `buildPoolQuery().slugs`
- `/root/sofascore-scraper/sofascore_scraper/discovery.py` (Python) → drive il discovery loop

`TIME_TOLERANCE_BY_SPORT` map in `_lib.ts` esteso a 14 entry. Default fallback aggiornato 30min (era 20min).

Capacity bump in `/root/sofascore-scraper/.env`:
- `SOFA_RATE_LIMIT_RPS`: 2.5 → 10
- `SOFA_WORKER_POOL_SIZE`: 4 → 16

Tutti gli altri parametri invariati (intervals, backoff, proxy URLs, discovery hour).

## Files Modified

| File | Tipo | Change |
|---|---|---|
| `/root/sofascore-scraper/sofascore_scraper/discovery.py` | Python | `SOFA_SPORTS = [...14 EN slugs...]` |
| `/root/sofascore-scraper/.env` | env | rps 2.5→10, workers 4→16 |
| `app/api/sofascore/fixtures/_lib.ts` | admin TS | extend `SOFA_SPORTS` tuple + `TIME_TOLERANCE_BY_SPORT` map (14 entries), default fallback 30min |
| `tests/api/sofascore/fixtures.test.ts` | admin test | `SOFA_VALID_SPORTS.size === 14`, +3 regression test (baseball 60min, mma 80min, darts 50min) |
| `tests/api/sofascore/stats.test.ts` | admin test | `by_sport` empty assertion estesa a 14 keys 0 |

No DB migration. No frontend coupling.

## Time Tolerance per Sport

| Sport | Tolerance | Rationale |
|---|---|---|
| football | 20min | (existing) |
| tennis | 30min | (existing) |
| basketball | 60min | (existing) |
| baseball | 90min | Long innings, rain delays comuni |
| cricket | 90min | Ditto, possibili pause prolungate |
| ice-hockey | 30min | OT/shootout drift moderato |
| handball | 20min | Match brevi, schedule preciso |
| volleyball | 20min | Idem |
| rugby | 30min | TV scheduling drift moderato |
| american-football | 30min | TV-driven, simile a basket |
| darts | 60min | Single events organizer-driven |
| boxing | 60min | Idem |
| mma | 90min | Card structure, undercards drift |
| snooker | 60min | Long matches, but few events |
| esports | 30min | Schedule rigido + stream delay |

Default fallback (sport non listato): 30min.

## Slug Compatibility

events_v2 sport slugs (EN convention) sono:
```
football, tennis, basketball, baseball, esports, handball, rugby, darts,
ice-hockey, cricket, volleyball, boxing, mma, american-football, snooker
```

SofaScore endpoint pattern: `GET /api/v1/sport/{slug}/scheduled-events/{date}`. Compatibilità slug **da verificare empiricamente** al primo discovery cycle. Rischi noti:
- `ice-hockey` vs `hockey` (alcuni provider usano just "hockey")
- `american-football` vs `american-football` o `nfl`
- `snooker`: forse 0 events tracked da SofaScore
- `darts`: forse 0-1 league only

Strategia mitigation: **probe pre-commit** via Python script che itera i 14 slugs e logga `received N events` per ognuno. Se uno restituisce 0/404, log warning + leave in list (no harm — sarà skip silently in production discovery loop). Documentare known-gaps nello spec.

## Capacity Bump Justification

Phase-0 gate misurato 2026-05-08 13:30 UTC: 0% block ratio (88 events tracked, 0× 403/429) a 2.5 rps × 4 workers = 10 rps total.

Math post-extension:
- 14 sport × ~100 events/sport medio = ~1400 events tracked (vs ~400 attuale)
- Phase-0 OFF = 10 endpoints per event in live tier
- Live tier interval 60s
- Peak load: 100 live concurrenti × 10 endpoints / 60s = 16 calls/s

Con bump 4× rps + 4× workers = 160 rps total. **16× capacity headroom** sopra peak teorico. Margin per spike + retry/backoff.

Rischio: SofaScore rate limit triggering. Mitigation: 100 proxy round-robin (Webshare residential IT), backoff_max_s=600 invariato, monitor 24h post-deploy.

## Test Coverage

Admin `tests/api/sofascore/fixtures.test.ts`:
1. Aggiusta `SOFA_VALID_SPORTS.size === 14` (era 3)
2. +3 regression test:
   - baseball fixture +60min vs candidate → matched_fuzzy (within 90min tolerance)
   - mma fixture +80min vs candidate → matched_fuzzy (within 90min tolerance)
   - darts fixture +50min vs candidate → matched_fuzzy (within 60min tolerance)
3. Conserva i 3 existing (basket 45min, tennis 25min, football 25min no-match)

Admin `tests/api/sofascore/stats.test.ts`:
- Aggiusta `by_sport` empty assertion: 14 keys tutte 0 nel mock initialization

Python: nessun test (no test infrastructure nello scraper repo, accettato).

## Rollout

1. Pre-flight probe: Python script `scripts/probe-sofa-slugs.py` per ognuno dei 14 slug, dump events count per sport. Identifica slug-not-supported.
2. Commit Python `discovery.py` + `.env` capacity bump → `infoundertheguns-ops/sofascore-scraper@main`
3. Commit admin `_lib.ts` + 2 test files → `feature/plan-d-settlement-d1`
4. Build admin (`npm run build`)
5. Restart entrambi servizi (admin + sofascore-scraper)
6. Wait 5-10min: discovery + first matching cycle
7. Acceptance verification (vedi sezione successiva)
8. Push origin entrambi repo via gh-token-pipe

## Acceptance Criteria

Tutti devono essere met:

1. **stats `by_sport` shows new sports**: `curl /api/sofascore/stats | jq .by_sport` → almeno 7 dei 11 nuovi sport con count > 0 entro 30 min post-deploy. (Margine: alcuni sport rari come snooker possono avere 0 events oggi — accettabile.)
2. **no_time_window ratio**: `(no_time_window / received) < 0.30` nel primo full cycle post-discovery.
3. **vitest**: full suite green eccetto la pre-existing consensus failure (1018+3 nuovi = 1021 pass).
4. **tsc**: clean exit zero errors.
5. **403/429 ratio gate** (post 24h): query `event_enrichment.last_endpoint_status` → blocked_pct < 5% across all sports/endpoints.
6. **enrichment populating per nuovi sport**: 30-60min post-deploy, `event_enrichment` populated count > 0 per ≥3 dei nuovi sport (sample query).

Se #1, #2, #3, #4 met immediately → ship. #5 e #6 sono gate post-deploy (24h e 60min rispettivamente). Se #5 fail (>5% block), revert capacity bump (rps 10→5) ma preservare extension; reinvestigare proxy.

## Risks & Mitigations

| Rischio | Probability | Impact | Mitigation |
|---|---|---|---|
| Slug mismatch SofaScore (es. ice-hockey) | Medium | Sport silently 0 matched | Pre-flight probe step 1; log + ship; fix slug post-empirical |
| Cloudflare trigger from 10 rps | Medium | All Sofa calls blocked | 100 proxies round-robin headroom; 24h gate; revert capacity if >5% blocks |
| `teamMatchScore` fail su MMA/darts/snooker (no_match_name >50%) | High per quei sport | Match rate basso per quei specifici sport | Acceptable per V1; scope task #22 (sport-aware matcher rewrite) |
| Queue depth explosion post phase-0 OFF | Already happening (queue 1454+) | Median enrichment age cresce | Capacity bump 16× addresses; verify queue drains after 30min |
| Test break per `SOFA_VALID_SPORTS.size` assertion change | Low | CI red | Update test in same commit; covered by sezione 4 |

## Implementation Notes

- TIME_TOLERANCE_BY_SPORT lookup deve restare `Record<SofaSport, number>` con default fallback in matchSofaToCandidate (`?? TIME_TOLERANCE_DEFAULT_SEC`). Sport sconosciuti (es. ricevuti per errore Python che invia slug non in SOFA_SPORTS) ricadrebbero comunque su `skipped_unknown_sport` in stage 0 prima di arrivare al lookup.
- `SOFA_SPORTS` tuple `as const` mantiene type narrowing automatico.
- Python `discovery.py` usa stesso name `SOFA_SPORTS` (parallelism nominal across repos, anche se non centralizzato — task #22 considererà unification).
- Il pre-flight probe (step 1) può essere il diagnostic script già scritto in `/tmp/sofa-diag-residual.py` post-modify per iterare anche sport non-supportati e log empty.
