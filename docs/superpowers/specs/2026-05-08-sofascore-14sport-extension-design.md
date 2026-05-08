# SofaScore 14-Sport Extension — Design

**Date:** 2026-05-08
**Author:** philp + Claude
**Status:** Draft v2 (post spec-reviewer recommendations applied)

## Goal

Estendere il matcher SofaScore + scraper Python da 3 sport (football, tennis, basketball) a 14 sport (parity con eventi presenti in `events_v2` nelle 48h: baseball, esports, handball, rugby, darts, ice-hockey, cricket, volleyball, boxing, mma, american-football, snooker + i 3 esistenti). Big-bang rollout in un singolo ciclo.

## Non-Goals (out of scope, carried over)

- Non si tocca il codice FS (sia admin route che scraper repo). Acceptance Sofa-only.
- Non si refactora `teamMatchScore` per sport-aware noise tokens (task #22).
- Non si unifica `TIME_TOLERANCE_BY_SPORT` con il duplicato in `flashscore-scraper/src/sample-collector.ts` (task #22).
- Non si aggiunge alias mining specifico per nuovi sport (rischio: `no_match_name` alto per MMA/darts/snooker/esports — accettato come iterazione futura).
- No UI/frontend changes. No new admin endpoints. No new auth surfaces. No DB migration (events_v2 already has all 14 sport_slug values from OddsAPI ingester).

## Architecture

Single source of truth per la lista sport: la tuple `SOFA_SPORTS` in:
- `app/api/sofascore/fixtures/_lib.ts` (admin) → autoderiva `SOFA_VALID_SPORTS` Set + `buildPoolQuery().slugs`
- `/root/sofascore-scraper/sofascore_scraper/discovery.py` (Python) → drive il discovery loop

`TIME_TOLERANCE_BY_SPORT: Record<SofaSport, number>` map in `_lib.ts` esteso a 14 entry (esaustivo sul type union, type-safe). `TIME_TOLERANCE_DEFAULT_SEC` rimane invariato a 20*60 = 1200s (preserva semantica football/handball/volley default-friendly esistente; il fallback è essenzialmente dead code per sport mappati ma rimane per safety se Python invia slug-anomalo che bypassa SOFA_VALID_SPORTS check).

Capacity bump in `/root/sofascore-scraper/.env`:
- `SOFA_RATE_LIMIT_RPS`: 2.5 → 10
- `SOFA_WORKER_POOL_SIZE`: 4 → 16

Tutti gli altri parametri invariati (intervals, backoff, proxy URLs, discovery hour).

## Files Modified / Created

| File | Tipo | Change |
|---|---|---|
| `/root/sofascore-scraper/scripts/probe-sofa-slugs.py` | Python NEW | Pre-flight script che itera 14 slug, fetch SofaScore /scheduled-events/{today}, log received N events per sport. Usato in T1 rollout per identificare slug-not-supported. |
| `/root/sofascore-scraper/sofascore_scraper/discovery.py` | Python MOD | `SOFA_SPORTS = [...14 EN slugs...]` |
| `/root/sofascore-scraper/.env` | env MOD | rps 2.5→10, workers 4→16 |
| `app/api/sofascore/fixtures/_lib.ts` | admin TS MOD | extend `SOFA_SPORTS` tuple `as const` (3→14) + `TIME_TOLERANCE_BY_SPORT` Record exhaustive (3→14 entries). Default fallback **invariato** (20min). |
| `tests/api/sofascore/fixtures.test.ts` | admin test MOD | `SOFA_VALID_SPORTS.size === 14`, +3 regression test (baseball 60min match within 90, mma 80min match within 90, darts 50min match within 60). +1 negative test: football retains 20min tolerance unaffected by extension. |
| `tests/api/sofascore/stats.test.ts` | admin test MOD | `by_sport` empty assertion estesa a 14 keys 0 |

## Time Tolerance per Sport

| Sport | Tolerance | Rationale |
|---|---|---|
| football | 20min | (existing — invariato) |
| tennis | 30min | (existing — invariato) |
| basketball | 60min | (existing — invariato) |
| baseball | 90min | Long innings, rain delays comuni |
| cricket | 90min | Possibili pause prolungate |
| ice-hockey | 30min | OT/shootout drift moderato |
| handball | 20min | Match brevi, schedule preciso |
| volleyball | 20min | Idem |
| rugby | 30min | TV scheduling drift moderato |
| american-football | 30min | TV-driven, simile a basket |
| darts | 60min | Single events organizer-driven |
| boxing | 60min | Idem |
| mma | 90min | Card structure, undercards drift |
| snooker | 60min | Long matches |
| esports | 30min | Schedule rigido + stream delay |

`TIME_TOLERANCE_DEFAULT_SEC = 20*60` (1200s) — invariato. Esaustivo Record<SofaSport, number> rende il fallback dead code per sport in tuple; resta come safety net se Python invia slug non-canonical (caso degenere coperto da `skipped_unknown_sport` stage 0 prima di raggiungere il lookup).

## Slug Compatibility

events_v2 sport slugs (EN convention):
```
football, tennis, basketball, baseball, esports, handball, rugby, darts,
ice-hockey, cricket, volleyball, boxing, mma, american-football, snooker
```

SofaScore endpoint pattern: `GET /api/v1/sport/{slug}/scheduled-events/{date}`. Compatibilità slug **da verificare empiricamente** via `scripts/probe-sofa-slugs.py` (committed pre-rollout). Rischi noti:
- `ice-hockey` vs `hockey` (alcuni provider usano "hockey" tout-court)
- `american-football` vs alternative naming
- `snooker`: forse 0 events tracked
- `darts`: forse 0-1 league only

Strategia: pre-flight probe documenta supportati vs not. Slug-not-supported rimangono in `SOFA_SPORTS` tuple per safety (Python `discovery.py` continua silently — return ok=false skip), ma documentiamo nel commit body quale sport ha 0 supporto. Se uno sport ha 0 supporto persistente, rimozione dalla tuple in commit follow-up dedicato.

## Capacity Bump Justification

Phase-0 gate misurato 2026-05-08 13:30 UTC: 0% block ratio (88 events tracked, 0× 403/429) a 2.5 rps × 4 workers = 10 rps total.

Math post-extension:
- 14 sport × ~100 events/sport medio = ~1400 events tracked (vs ~400 attuale)
- Phase-0 OFF = 10 endpoints per event in live tier
- Live tier interval 60s
- Peak load: 100 live concurrenti × 10 endpoints / 60s = 16 calls/s

Con bump 4× rps + 4× workers = 160 rps total = **10× headroom** sopra peak teorico (16 calls/s). Total capacity bump 16× su 10 rps base. Margin sostanziale per spike + retry/backoff.

Rischio: SofaScore rate limit triggering. Mitigation: 100 proxy round-robin (Webshare residential IT), backoff_max_s=600 invariato, 24h capacity gate post-deploy.

## Test Coverage

Admin `tests/api/sofascore/fixtures.test.ts`:
1. Aggiusta `SOFA_VALID_SPORTS.size === 14` (era 3)
2. +3 regression test (positive):
   - baseball fixture +60min vs candidate → matched_fuzzy (within 90min tolerance)
   - mma fixture +80min vs candidate → matched_fuzzy (within 90min tolerance)
   - darts fixture +50min vs candidate → matched_fuzzy (within 60min tolerance)
3. +1 regression test (negative): football fixture +25min vs candidate → no_time_window (verifica che football resta a 20min, non rilassato dal fallback default).
4. Conserva i 3 existing (basket 45min, tennis 25min, football 25min no-match).
5. Conserva l'existing test `returns skipped_unknown_sport for unsupported sofa_sport` — questo lock dello stage-0 garantisce che il fallback `?? TIME_TOLERANCE_DEFAULT_SEC` non venga mai raggiunto via slug ignoto in produzione.

Admin `tests/api/sofascore/stats.test.ts`:
- Aggiusta `by_sport` empty assertion: 14 keys tutte 0 nel mock initialization

Python: nessun test (no test infrastructure nello scraper repo, accettato).

## Rollout

1. **Pre-flight probe** (commit 1, scraper repo): create + run `scripts/probe-sofa-slugs.py`, capture per-sport slug support output.
2. **Python commit** (commit 2, scraper repo): `discovery.py` SOFA_SPORTS extension + `.env` capacity bump. Commit body include probe output da step 1.
3. **Admin commit** (commit 3, admin repo): `_lib.ts` + 2 test files.
4. **Build admin** (`npm run build`).
5. **Restart entrambi servizi** (admin + sofascore-scraper).
6. **Wait 5-10min**: discovery + first matching cycle.
7. **Acceptance verification** (vedi sezione successiva).
8. **Push origin entrambi repo** via gh-token-pipe.

## Acceptance Criteria

Suddivisi in immediate (post-deploy, blocking) e post-deploy gates (non-blocking, monitoring).

### Immediate (must pass to declare ship)
1a. **Slug coverage**: pre-flight probe (rollout step 1) shows ≥10 of 14 sports return events > 0. (Acceptable: snooker, darts, american-football potrebbero essere 0/4 supportati.)
1b. **Match quality on supported sports**: post first cycle, `by_sport` shows count > 0 per ≥4 of the 11 nuovi sport con discovery successful (sport stats-rich come baseball/handball/rugby/hockey hanno alta probability; MMA/darts/snooker/esports/cricket sono accept-as-V1-limited).
2. **no_time_window ratio**: `(no_time_window / received) < 0.30` nel primo full cycle post-discovery.
3. **vitest**: full suite green eccetto la pre-existing consensus failure (target ~1022 pass).
4. **tsc**: clean exit zero errors.

### Post-deploy gates (non-blocking, follow-up monitoring)
5. **403/429 ratio gate** (post 24h, 2026-05-09 ~14:00 UTC): query template:
   ```sql
   SELECT
     SUM(CASE WHEN (last_endpoint_status->endpoint->>'http')::int IN (403,429) THEN 1 ELSE 0 END)::float /
     COUNT(*) AS blocked_pct
   FROM event_enrichment, jsonb_object_keys(last_endpoint_status) endpoint
   WHERE last_synced_at > NOW() - INTERVAL '24 hours';
   ```
   Threshold: `blocked_pct < 0.05`. **Manual check at +24h** by user; reminder via task tracker.

6. **Enrichment populating per new sports**: 30-60min post-deploy, query template:
   ```sql
   SELECT e.sport_slug, COUNT(*) FILTER (WHERE ee.last_endpoint_status->'stats'->>'http' = '200') populated
   FROM event_enrichment ee JOIN events_v2 e ON e.id = ee.event_v2_id
   WHERE ee.last_synced_at > NOW() - INTERVAL '60 minutes'
   GROUP BY e.sport_slug;
   ```
   Threshold: ≥3 nuovi sport con populated > 0.

### Rollback procedures

- **#1a fail (slug coverage <10)**: indagare i 4 not-supported via probe output. Se <8 supportati, rollback Python commit and re-scope (rimuovere slug dead from SOFA_SPORTS).
- **#1b fail (≥4 new sports matched after first cycle)**: matcher quality issue (probabile teamMatchScore noise per quei sport). Single-line revert su admin: rimuovere sport from SOFA_SPORTS tuple (auto-propaga). Push hotfix.
- **#2 fail (ratio ≥0.30)**: probabile regressione T14 pool window logic interagendo con ampliato sport pool. Verificare query EXPLAIN su events_v2 (potrebbe richiedere index su `sport_slug + starts_at + status`).
- **#5 fail (>5% blocks at 24h)**: revert capacity bump only (rps 10→5, workers 16→8). Extension itself preserved. Re-monitor 24h.
- **#6 fail (<3 enrichment populated)**: enrichment worker queue non drena. Check queue_depth growth + worker logs. Probably need rate bump higher or interval increase.

## Risks & Mitigations

| Rischio | Probability | Impact | Mitigation |
|---|---|---|---|
| Slug mismatch SofaScore (es. ice-hockey) | Medium | Sport silently 0 matched | Pre-flight probe step 1; documenta + ship; rimuovi slug se persistent 0 |
| Cloudflare trigger from 10 rps | Medium | All Sofa calls blocked | 100 proxies round-robin headroom; 24h gate; revert capacity if >5% blocks |
| `teamMatchScore` fail su MMA/darts/snooker (no_match_name >50%) | High per quei sport | Match rate basso per quei specifici sport | Acceptable per V1; acceptance #1b soften a ≥4 of 11; scope task #22 (sport-aware matcher rewrite) |
| Queue depth explosion post phase-0 OFF | Already happening (queue 1454+) | Median enrichment age cresce | Capacity bump addresses (10× peak headroom); acceptance #6 verifies drain |
| Test break per `SOFA_VALID_SPORTS.size` assertion change | Low | CI red | Update test in same commit; covered da sezione Test Coverage |
| Default fallback unintentionally invoked | Very low | Sport non in tuple usa 20min | Stage-0 `skipped_unknown_sport` test lock; Record exhaustive type-safety |

## Implementation Notes

- `TIME_TOLERANCE_BY_SPORT` lookup deve restare `Record<SofaSport, number>` exhaustive. Default fallback `?? TIME_TOLERANCE_DEFAULT_SEC` rimane per type-cast safety ma effettivamente irraggiungibile per sport in tuple.
- `SOFA_SPORTS as const` tuple: TypeScript narrowing automatico → `SofaSport` union 14 elementi → `Record<SofaSport, number>` esaustivo controllato a compile time.
- Python `discovery.py` usa stesso name `SOFA_SPORTS` (parallelism nominale, non centralizzato — task #22 considererà unification).
- Pre-flight probe `scripts/probe-sofa-slugs.py` è committed nel scraper repo come durable artifact, non one-off in `/tmp/`. Format output: una riga per sport `[probe] {sport}: received={N}` + summary `[probe] supported={count}/14`.
- 24h capacity gate (#5): user-driven manual check via task #(prossimo plan) tracker reminder. No alarm/Slack integration in scope.
