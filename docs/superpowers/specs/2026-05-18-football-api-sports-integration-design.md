# Design — Football api-sports integration (Phase 1B Tier C)

**Date**: 2026-05-18
**Status**: Design approved, pending writing-plans
**Author**: brainstormed in session 2026-05-18
**Scope**: Football only (api-sports Pro plan attivo fino 2026-06-07)

---

## 1. Context & Motivation

### 1.1 Stato attuale

Il sistema attuale ingerisce dati calcio da due fonti:

- **OddsAPI** (`services/odds-api-ingester/`) — quote bookmaker, copertura mercati ampia (108 distinct market names rilevati ultimi 7d), settlement non-affidabile per molti mercati timing-sensitive.
- **FlashScore scraper** (`flashscore-scraper` su scraper-vps) — score, timer, incidents (gol/cards/sub con player.id 99.2% coverage football), live_data.stats[] 76 granulari, live_data.matchMeta (venue/referee).

Probe del 2026-05-18 su 3 match calcio live (Egypt + India ISL):
- `events_v2.score_home/away` ✅ popolato
- `events_v2.minute` ⚠️ NULL nei 3/3 sample
- `events_v2.period` ⚠️ NULL
- `live_data.stats` ✅ 76 stats
- `live_data.incidents` ✅ goal/card/sub con player attribution

**Conferma empirica**: timer FS è inconsistent (NULL per tier minori).

### 1.2 Constraint analysis

Per mostrare un mercato sul kiosk servono 3 condizioni AND:
1. OddsAPI offre le quote (vincolo esterno)
2. classify dispatcher mappa a canonical form (lavoro nostro)
3. settlement worker sa pagare/perdere il bet (richiede dato affidabile)

Oggi **condizione 3** è collo di bottiglia per ~86 dei 108 distinct OddsAPI football market names (~120k emit unsettled long-tail). Inventory dettagliato in §5.

### 1.3 Why api-football

api-sports Pro plan attivo (7500 req/day, scadenza 2026-06-07) copre football con:
- Timer real-time consistente (`fixture.status.elapsed`)
- HT score canonical (`score.halftime`)
- Statistics per-match granulari (`/fixtures/statistics`)
- Player stats per-fixture (`/fixtures/players`)
- Events con detail (Normal/Penalty/Own/Header su `/fixtures/events`)
- Lineups + h2h + predictions

Pattern adottato: **Hybrid per-market** con ownership esclusiva per-campo (vedi §3).

---

## 2. Goals & Non-goals

### Goals (Phase 1B)

- **G1**: timer/period/score real-time consistente per tutti i match calcio top-tier
- **G2**: settlement main markets (1X2, U/O, BTTS, DC, HT/FT, Correct Score) usa api-football come canonical
- **G3**: lineups visibili su detail page calcio (player UI nuova sezione)
- **G4**: market expansion Tier C — ~40 nuovi mercati abilitati (~83k emit unlock, ~69% gap closure)
- **G5**: zero regression cross-sport (basket/tennis/baseball/hockey/etc. restano FS-canonical immutati)
- **G6**: rollback path triviale (feature flag flip) per M2 timer ownership

### Non-goals

- **NG1**: api-football per sport ≠ football (delegated a futuro Spec C multi-provider orchestrator)
- **NG2**: real-time player props in-play (mid-match player stats refresh) — solo HT+FT snapshot in Phase 1B
- **NG3**: predictions endpoint markets (es. "Win Probability") — defer a Phase 2
- **NG4**: settlement migration retroattiva — solo nuovi bet post-M3
- **NG5**: api-football come fallback per altri sport — FS resta unico provider per ora
- **NG6**: top-tier filter (`bookmaker_count ≥ 3`) — deferred a observation phase, ship Strada A senza filter

---

## 3. Architecture

### 3.1 Service shape

Nuovo standalone service mirror pattern `odds-api-ingester`:

```
betssolution-admin/services/api-football-ingester/
├── src/
│   ├── api-client.ts       # api-sports HTTP client + rate-limit tracking
│   ├── scheduler.ts        # entry point, orchestrazione tier polling
│   ├── discovery.ts        # /fixtures?live=all loop 60s
│   ├── enrichment.ts       # /events delta-trigger, /statistics, /players, /lineups
│   ├── prematch.ts         # /headtohead + /predictions one-shot per match
│   ├── mapping.ts          # external_id_mapping resolver (fuzzy match)
│   ├── persistence.ts      # write paths events_v2 + live_data sub-keys
│   ├── state.ts            # in-process Map<fixtureId, {lastScore, lastEventsFetchAt}> per L3
│   └── stats-publisher.ts  # health endpoint POST /api/admin/api-football/stats
├── package.json
├── tsconfig.json
└── README.md
```

Deploy: systemd unit `api-football-ingester.service` su scraper-vps. `tsx src/scheduler.ts` direct (no build, pattern odds-api-ingester).

### 3.2 Field ownership (M2 onwards)

Single source of truth per ogni campo per evitare race writes:

```typescript
// lib/event-field-ownership.ts (nuovo)
export const FIELD_OWNERSHIP_FOOTBALL = {
  'events_v2.minute':         'api-football',
  'events_v2.period':         'api-football',
  'events_v2.score_home':     'api-football',
  'events_v2.score_away':     'api-football',
  'events_v2.period_scores':  'api-football',

  'events_v2.country_fs':     'fs-scraper',
  'events_v2.league_fs':      'fs-scraper',
  'events_v2.live_data.incidents':   'fs-scraper',
  'events_v2.live_data.stats':       'fs-scraper',
  'events_v2.live_data.matchMeta':   'fs-scraper',
  'events_v2.live_data.fs_pregame':  'fs-scraper',

  'events_v2.live_data.lineups_af':       'api-football',
  'events_v2.live_data.statistics_af':    'api-football',
  'events_v2.live_data.events_af':        'api-football',
  'events_v2.live_data.players_af_ht':    'api-football',
  'events_v2.live_data.players_af_ft':    'api-football',
  'events_v2.live_data.predictions_af':   'api-football',
  'events_v2.live_data.h2h_af':           'api-football',
} as const;
```

**Naming convention**: tutte le nuove sub-key sotto `live_data` hanno suffisso `_af` (api-football). Namespace separato da FS-owned. Zero overlap.

**fs-scraper code change** (M2 deploy): rimuovi write su minute/period/score_home/score_away/period_scores per `sport_slug='football'`. Altri sport restano FS-owned. Gated da feature flag `API_FOOTBALL_TIMER_OWNER` letto da `system_config`.

### 3.3 Data flow lifecycle di un match

```
T-6h      prematch:  /headtohead + /predictions one-shot       (2 calls)
T-1h      lineups:   /fixtures/lineups initial                  (1 call)
T-0       kickoff:   match entra in /fixtures?live=all          (no extra call)
T0..T+90  loop:      discovery 60s  → score-delta: /events     (~3 fetch totali)
                                    → cards/sub poll 5min       (~18 polls)
                                    → /statistics ogni 5min     (~18 polls)
                                    → /lineups on-sub event     (~3 polls subs)
T+45 (HT) /players HT snapshot                                  (1 call)
T+90 (FT) /players FT snapshot                                  (1 call)
T+91      reconciliation: /events FT final pass                 (1 call)
```

### 3.4 Score-delta event-driven trigger (Level 3 optimization)

**Mandatory baked-in** (vedi §6 budget analysis).

Logic core in `discovery.ts`:

```typescript
const lastSeenScores = new Map<number, { home: number; away: number }>();
const lastEventsFetchAt = new Map<number, number>();

async function discoveryTick() {
  const liveMatches = await api.get('/fixtures?live=all');

  for (const match of liveMatches) {
    const id = match.fixture.id;
    const newScore = match.goals;
    const oldScore = lastSeenScores.get(id) ?? { home: 0, away: 0 };
    const scoreChanged =
      newScore.home !== oldScore.home || newScore.away !== oldScore.away;

    const lastFetch = lastEventsFetchAt.get(id) ?? 0;
    const cardsPollDue = Date.now() - lastFetch > 5 * 60 * 1000;

    if (scoreChanged || cardsPollDue) {
      const events = await api.get(`/fixtures/events?fixture=${id}`);
      await persistEvents(id, events);
      lastEventsFetchAt.set(id, Date.now());
    }

    lastSeenScores.set(id, newScore);
    await persistTimerAndScore(id, match);
  }
}
```

**Risparmio**: 13500/day naive → ~1500/day event-driven (score-delta + 5min cards poll).

**Edge cases gestiti**:
- VAR goal cancel (score decremento) → refetch /events per riallineare
- Doppietta in 60s → 2 score-delta consecutive, entrambe trigger
- Service restart mid-match → seed lastSeenScores con score corrente alla prima call, fetch one-shot /events di seed
- FT reconciliation → 1 unica /events finale a status=Match Finished per garantire settlement data completa

### 3.5 Event ID mapping resolution

Nuova tabella `external_id_mapping`:

```sql
CREATE TABLE external_id_mapping (
  event_id UUID NOT NULL REFERENCES events_v2(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('api-football', 'flashscore', 'odds-api')),
  external_id TEXT NOT NULL,
  confidence FLOAT NOT NULL DEFAULT 0.0,
  verified BOOLEAN NOT NULL DEFAULT false,
  matched_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (event_id, provider),
  UNIQUE (provider, external_id)
);

CREATE INDEX idx_external_id_mapping_provider_external
  ON external_id_mapping(provider, external_id);
```

**Confidence formula**:
```
confidence = 0.5 × name_similarity(home, away)
           + 0.3 × league_match_score
           + 0.2 × kickoff_proximity_score   (window ±60min)
```

**Thresholds**:
- `confidence >= 0.85` → mapping persisted, ingester scrive su events_v2
- `0.50 <= confidence < 0.85` → mapping persisted ma `verified=false`, ingester NON scrive (audit admin route richiesta per promote)
- `confidence < 0.50` → discard, no row

**Resolve at ingest, cache thereafter**: prima volta vediamo fixture in /fixtures?live=all, fuzzy match contro events_v2 entries (sport=football, status in (prematch, live), kickoff_window). Subsequent calls by-id lookup veloce.

---

## 4. Settlement & Tier C market expansion

### 4.1 Settlement source routing

`lib/settlement/source-router.ts` (nuovo):

```typescript
export function pickCanonicalSource(
  market_type: string,
  sport: string
): 'api-football' | 'fs' {
  if (sport !== 'football') return 'fs';
  if (FOOTBALL_AF_CANONICAL.has(market_type)) return 'api-football';
  return 'fs';
}
```

### 4.2 FOOTBALL_AF_CANONICAL (api-football canonical)

**Score-derived (Bucket A — 12 markets, ~50k emit)**:
- 1x2, ml, totals, btts, double_chance, draw_no_bet, correct_score, ht_ft, odd_even
- 1x2_ht, totals_ht, btts_ht, odd_even_ht, 1x2_sh, totals_sh, btts_sh
- spread, european_handicap, asian_handicap, goal_line
- team_total_home, team_total_away, exact_total_goals, number_of_goals
- team_total_goals_home, team_total_goals_away, 1st_half_goal_line
- first_team_to_score, method_of_victory

**Statistics-derived (Bucket B — 22 markets, ~28k emit)**:
- corners_totals_home, corners_totals_away, corners_spread, corner_handicap
- bookings_totals, bookings_totals_home, bookings_totals_away, bookings_spread
- total_shots_home, total_shots_away, team_shots_home, team_shots_away
- most_shots_on_target, total_shots_on_target_home, total_shots_on_target_away
- total_offsides, match_offsides, team_offsides_home, team_offsides_away
- card_handicap, number_of_cards, team_cards_home, team_cards_away
- total_fouls, total_fouls_home, total_fouls_away
- goalkeeper_saves_home, goalkeeper_saves_away

### 4.3 FOOTBALL_FS_CANONICAL (FS resta canonical)

**Player attribution (10 markets, ~5k emit)**:
- anytime_goalscorer, first_goalscorer, last_goalscorer
- multi_scorers, anytime_goalscorer_or_assist
- to_score_2plus_goals, to_score_3plus_goals
- player_shots, player_shots_on_target
- player_to_be_booked, player_cards, player_fouls
- player_tackles, player_fouls_committed, player_to_be_fouled
- player_to_assist, team_goalscorer, goal_method

**Razionale split**:
- **api-football canonical**: aggregate stats + scores oggettivi numerici, no player attribution
- **FS canonical**: player attribution (FS ha 99.2% player.id coverage) + incident-derived markets

### 4.4 classify-af.ts nuovo

Nuovo file `lib/settlement/api-football/classify-af.ts` mirror di `classify.ts` ma con i 22 Bucket B (statistics) + Bucket A score-derived expansion. Riusa pattern `settleStatOU` / `settleStatHandicap` / `settleStat1X2` esistenti.

Settlement worker entry point:

```typescript
async function settleLeg(leg: BetLeg, event: Event) {
  const source = pickCanonicalSource(leg.market_type, event.sport_slug);

  if (source === 'api-football') {
    const result = await buildResultFromAF(event);
    return classifyLegAF(leg, result);
  }
  const result = await buildResultFromFS(event);
  return classifyLeg(leg, result);
}
```

### 4.5 market_normalization seed

Migration: seed `market_normalization` con ~108 row OddsAPI → canonical_key per source=odds-api.

```sql
-- migrations/NNN_odds_api_football_market_seed.sql
INSERT INTO market_normalization
  (source, source_market_type, canonical_key, canonical_name_it, verified)
VALUES
  ('odds-api', 'ML', '1x2', 'Vincente incontro', true),
  ('odds-api', 'Totals', 'totals', 'U/O Totali', true),
  ('odds-api', 'Team Total Home', 'team_total_home', 'Totale Casa', true),
  ('odds-api', 'Team Total Away', 'team_total_away', 'Totale Ospite', true),
  ('odds-api', 'Exact Total Goals', 'exact_total_goals', 'Numero gol esatto', true),
  -- ... ~108 row totali
ON CONFLICT (source, source_market_type) DO UPDATE
  SET canonical_key = EXCLUDED.canonical_key;
```

### 4.6 Cross-source disagreement detection

Durante M3 (e per 14 giorni post-deploy completa), ogni settlement leg con source=api-football fa anche shadow settle FS (se FS data disponibile) e logga disagreement:

```sql
CREATE TABLE settlement_dual_source_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id UUID NOT NULL,
  market_type TEXT NOT NULL,
  canonical_source TEXT NOT NULL,
  canonical_verdict TEXT,
  shadow_source TEXT,
  shadow_verdict TEXT,
  disagreement BOOLEAN NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_dual_source_log_disagreement
  ON settlement_dual_source_log(disagreement, recorded_at DESC);
```

**Alert threshold**: disagreement rate > 1% sostenuto 24h → audit prima di skipping FS shadow.

**Cleanup gate**: disagreement <1% per 14 giorni consecutivi → DROP table, rimuovi shadow path.

---

## 5. Market inventory & gap analysis

Probe DB ultimi 7d football (`scripts/db/probe-football-markets.mjs`): 108 distinct OddsAPI market names.

**Coverage stato attuale**:
- ~22 mercati COVERED da `classify.ts` (English alias match) — top per volume, ~190k emit cumulati
- ~86 mercati GAP non settlabili oggi — ~120k emit cumulati
- 0 mercati con mapping in `market_normalization` per source=odds-api (table popolata solo per Kambi/Betfair sources)

**Gap analysis post-Tier C**:

| Categoria | Count | Emit unlock | api-football endpoint |
|---|---|---|---|
| 🟢 Score-derived (Bucket A) | 12 | ~50k | /fixtures + score.halftime |
| 🟢 Statistics-derived (Bucket B) | 22 | ~28k | /fixtures/statistics |
| 🟡 Player props (Bucket C) | 10 | ~5k | /fixtures/players + /events |
| 🔴 Non-fixable | ~7 | ~2.8k | (Corners Race, Player Outside Box, Specials, etc.) |

**Phase 1B Tier C delivery**: 40+ nuovi mercati abilitati (~83k emit), ~69% gap closure calcio.

---

## 6. Rate-limit budget analysis

### 6.1 Budget Pro plan

api-sports Pro = **7500 req/day**, scadenza 2026-06-07.

### 6.2 Projection Phase 1B Tier C con L3 baked-in

| Endpoint | Volume | calls/day |
|---|---|---|
| /fixtures?live=all (discovery 60s) | 24h × 60 | 1440 |
| /fixtures/statistics live (5min × 150 match) | scheduled | 2700 |
| /fixtures/events (score-delta + 5min card poll) | event+sched | ~1500 |
| /fixtures/players (HT+FT × 150) | 2-shot per match | 300 |
| /fixtures/lineups (initial + on-sub) | ~3 per match | 450 |
| /fixtures/headtohead (250 prematch top-tier) | one-shot | 250 |
| /predictions (250 prematch top-tier) | one-shot | 250 |
| Buffer/retries | safety | 500 |
| **TOTALE** | | **~7400/day (~99% Pro)** |

### 6.3 Strategy: Strada A

- **L3 score-delta event-driven**: mandatory baked-in (struttural saving 30×)
- **L2 top-tier filter**: deferred → ship con tutti i 150 match polled
- **Monitoring**: 24h cycle stats + rate-limit remaining tracked in admin dashboard
- **Reactive fallback**: se overshoot persistent >Pro budget 3 giorni consecutivi → enable L2 top-tier filter (libera 50% budget) OR upgrade Ultra (+€79/mo)

---

## 7. Operational

### 7.1 Error handling & resilience

**Rate-limit 429 handling**:
- Header `x-ratelimit-requests-remaining` letto ogni response, cached
- Soglie: warn <20%, throttle <10% (skip enrichment non-critici), halt 0% (continue solo /fixtures?live=all)
- Backoff: exponential 2s-30s su 429, resume quando remaining >50%

**Mapping confidence threshold**: vedi §3.5

**Endpoint failure isolation**:
- Per-endpoint try/catch + `logEndpointFailure(endpoint, fixture_id, error)`
- 3 consecutive 5xx su fixture X → skip 5min cooldown
- Tracking: nuova table `api_football_endpoint_health (endpoint, last_success_at, consecutive_failures, last_error)`

**FS coexistence safety**:
- Feature flag `API_FOOTBALL_TIMER_OWNER` in `system_config`, polled da fs-scraper E api-football-ingester ogni 30s
- Single source of truth, no distributed coordination

### 7.2 Testing strategy

**Unit (offline, deterministic, no DB)**:
- api-client retry/backoff, rate-limit parsing
- mapping fuzzy match scenarios
- discovery score-delta L3 logic (VAR cancel, doppietta, restart mid-match)
- classify-af 22+10 Tier C markets
- persistence write paths + namespace separation

**Integration (mocked api-sports, real DB staging)**:
- Full lifecycle prematch → kickoff → live → FT → settlement
- external_id_mapping populated, live_data.lineups_af presente
- dual_source disagreement logging

**E2E (production smoke, manual)**:
- Post-M2: 5 top-tier match × 90min, timer/score real-time visible, no FS regression cross-sport
- Post-M3: 5 settlement reali con api-football canonical, disagreement <1%

**Test count target**: baseline 290 → 370 (+80 nuovi).

### 7.3 Rollout

**M1 — Service foundation + mapping (Week 1, ~5-7 gg)**:
1. Migration: external_id_mapping, settlement_dual_source_log, api_football_endpoint_health
2. Migration: market_normalization seed OddsAPI football
3. Service code deploy + systemctl enable + start
4. Feature flag `API_FOOTBALL_WRITE_ENABLED=false` (zero impact su events_v2)
5. Monitoring 48-72h: mapping coverage rate, match-rate api-football↔FS

**M2 — Timer ownership switch (Week 2, ~4-5 gg)**:
1. fs-scraper code change: skip write minute/period/score_* per sport=football gated da `API_FOOTBALL_TIMER_OWNER`
2. Flag default `false` ancora (no behavior change)
3. Staging test: flip flag, verifica timer real-time, score consistency
4. Prod flip flag → osservazione 24h
5. Rollback ready: flip flag `false` → FS torna canonical (codice non rimosso, gated)

**M3 — Settlement switch + lineups + Tier C expansion (Week 3-6, ~16-21 gg)**:
1. classify-af.ts deploy + dispatcher routing logic
2. Tier C progressivo: Bucket A (12 markets) → 1 sett monitoring → Bucket B (22) → Bucket C (10)
3. Lineups UI player side (sub-PR betssolution-player)
4. dual_source_log monitoring durante intero M3
5. Cleanup post-2 sett <1% disagreement: DROP dual_source_log, rimuovi shadow path, hardcode field ownership

### 7.4 Monitoring & observability

**Health endpoint** (mirror FS pattern shipped 2026-05-13):
- POST /api/admin/api-football/stats ogni cycle
- Payload: `{cycle_id, started_at, duration_ms, endpoints_called, calls_count, ratelimit_remaining, mappings_resolved, mappings_skipped_low_confidence, errors}`
- Storage `system_config.api_football_health` rolling 100 cycles

**Admin dashboard** (`/admin/api-football`):
- Live: ratelimit budget usage, cycle p50/p95, mapping coverage % per league
- Per-event drill: external_id_mapping lookup, source canonical per market
- dual_source_log viewer

**Alerts (Sentry)**:
- Hard 429 → page
- Cycle p95 >30s sustained 10min → warn
- Mapping coverage <80% top-tier → warn
- dual_source_disagreement >5% sustained → page

### 7.5 Cleanup post-M3

Dual_source_log <1% per 14 giorni consecutivi:
1. DROP migration table settlement_dual_source_log
2. Rimuovi shadow settle code path
3. Rimuovi feature flag API_FOOTBALL_TIMER_OWNER (sempre on)
4. Lock final ownership in lib/event-field-ownership.ts (no flag gating)

---

## 8. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Budget Pro overshoot persistente | Media | Settlement degradation | Reactive L2 filter enable OR Ultra upgrade (+€79/mo) |
| Mapping low confidence persistent | Media | Coverage <100% top-tier | Admin audit route per manual promote mapping; expand fuzzy logic |
| api-sports outage/downtime | Bassa | Timer/score regression | Fallback transparent a FS (flip flag); gracefully degrade |
| dual_source disagreement >5% sostenuto | Bassa | Settlement decision wrong | Auto-revert flag M2 + audit; possibile rinegoziazione ownership split |
| Top-tier filter inadeguato (low-tier match users complain) | Bassa | Coverage gap operatori | Defer L2 → ship Strada A senza filter (~99% budget); enable reattivo se overshoot |
| FS scraper bug residuo dopo M2 write removal | Bassa | Race write rinvigorita | Gate strict tramite feature flag, fs scraper SEMPRE check flag pre-write |

---

## 9. Open questions / Deferred decisions

- **Q1**: Cleanup retroattivo settlement bet pre-M3? — **Deferred**: solo nuovi bet post-M3 usano api-football canonical (NG4).
- **Q2**: Predictions endpoint mai esposto sul kiosk? — **Deferred a Phase 2**.
- **Q3**: api-football integration per altri sport? — **Deferred a Spec C multi-provider** (cross-sport orchestrator). Football è MVP.
- **Q4**: Renew api-sports Pro plan post-2026-06-07? — **Decision pending**: dipende da Phase 1B success + budget actual. ~+€39/mo se renewed.

---

## 10. References

- `memory/reference-api-sports.md` — credenziali Pro plan, endpoint families, rate limits
- `memory/pending-brainstorming-football-api-sports.md` — brainstorming history 2026-05-18
- `memory/feedback-api-sports-roadmap-first.md` — feedback 2026-05-16 incident: api-sports check before FS reverse-eng
- Similar shipped specs:
  - `docs/superpowers/specs/2026-05-08-sofascore-14sport-extension-design.md` (multi-sport pattern)
  - `docs/superpowers/specs/2026-04-29-plan-d-settlement-refactor-design.md` (settlement canonical pattern)
  - `docs/superpowers/specs/2026-04-30-fs-id-population-design.md` (external ID mapping pattern)
- Probe scripts:
  - `scripts/db/probe-football-live-fs-data.mjs`
  - `scripts/db/probe-football-markets.mjs`
