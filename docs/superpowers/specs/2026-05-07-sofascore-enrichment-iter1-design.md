# SofaScore enrichment — iter 1 data pipeline (design spec)

**Data**: 2026-05-07
**Author**: Phil + Claude (brainstorm session)
**Branch target**: `feature/sofascore-enrichment-iter1` (branch from `feature/plan-d-settlement-d1` HEAD `2314175`)
**Path repo dest**: `docs/superpowers/specs/2026-05-07-sofascore-enrichment-iter1-design.md` (questo file vive in research/ workspace, da copiare nel repo betssolution-admin al cutover sessione implementation)

---

## 1. Sintesi e motivazione

Aggiungere SofaScore come **secondo feed di enrichment** accanto a FlashScore (che resta source-of-truth per settlement). Iter 1 ship **solo la pipeline dati** (scraper + storage + matching), niente UI — admin né player. UI sarà iter 2.

Sport coperti iter 1: **calcio + tennis + basket** (cluster "verdi" del coverage probe `2026-05-07-coverage_by_tier.json`, ok-rate Mid tier 80–100% sui 3 endpoint chiave).

Endpoint ingeriti per evento: **tutti e 10** SofaScore espone (`statistics`, `lineups`, `incidents`, `graph`, `shotmap`, `best-players`, `highlights`, `comments`, `votes`, `featured-players`). UI consumirà subset in iter 2 senza richiedere ri-scrape.

### Perché ora
1. Player Event V2 (Plan B → multi-sport) è in prod ma è "thin" — solo markets/odds, nessuna stat. Gap UX vs SofaScore/SportsRadar competitor.
2. Tokenizer `normalize.ts` riusato da B1.A/B1.B + fs-id resolver v2 è abbastanza maturo per matchare un secondo feed con confidence.
3. odds-api copertura mercati è ampia (35k hidden post-mig 170) ma sportsbook listing UX non ha "info contestuali" che giustifichino tempo speso pre-bet — enrichment colma quel gap senza cambiare il settlement.

### Cluster verdi misurato (oggi 2026-05-07)
| Sport | Total | Mid stats / lineups / incidents |
|---|---:|---|
| calcio | 158 | 90% / 95% / 100% |
| tennis | 933 | 100% / N/A / N/A |
| basket | 314 | 85% / 80% / 95% |

### Out of scope iter 1 (esplicito)
- Nessun tab/componente nuovo su `betssolution-player` (Event V2 page resta com'è oggi)
- Nessuna pagina admin per esplorare l'enrichment (read tabella solo via SQL/Supabase Studio)
- Nessuna SSE/realtime push verso client
- Nessun backfill historic (forward-only da cutover)
- Nessun supporto cluster "gialli" (hockey/volley/handball) o "rossi" (baseball/cricket/MMA/boxing/snooker/esports/table-tennis)

---

## 2. Architettura & data flow

```
┌───────────────────────────────────────┐
│ sofascore-scraper (Python, stessa VPS │
│ del flashscore-scraper)               │
│                                       │
│ ┌──────────────────────────────────┐ │
│ │ scheduler (asyncio worker pool)  │ │
│ │   tier_live: every 60s           │ │
│ │   tier_prematch: every 30min     │ │
│ │   tier_finished: one-shot        │ │
│ │   discovery: 1×/day 04:00 UTC    │ │
│ └──────────────────────────────────┘ │
│            │                          │
│            ▼                          │
│ ┌──────────────────────────────────┐ │
│ │ curl_cffi (chrome131 fingerprint)│ │
│ │ rate-limit: 2.5 req/s + jitter   │ │
│ │ backoff: exponential on 403/429  │ │
│ └──────────────────────────────────┘ │
└────────────────┬──────────────────────┘
                 │ x-scraper-key + JSON
                 ▼
┌───────────────────────────────────────────┐
│ betssolution-admin                         │
│ POST /api/sofascore/fixtures   (1×/day)    │
│   → matchSofa() vs events_v2 → sofa_id    │
│ POST /api/sofascore/enrichment (per-event) │
│   → upsert event_enrichment table          │
│ GET  /api/sofascore/stats                  │
│   → ops dashboard JSON                     │
└────────────────┬──────────────────────────┘
                 │
                 ▼
┌───────────────────────────────────────────┐
│ Supabase Postgres                          │
│   events_v2 (+ sofascore_id col)           │
│   event_enrichment (1:1, 10 jsonb cols)    │
└───────────────────────────────────────────┘
```

### Flusso operativo end-to-end
1. **Discovery** (scraper, 1×/day @ 04:00 UTC): pulla `/sport/{football,tennis,basketball}/scheduled-events/{today}` → lista totale ~1400 eventi → POST a `/api/sofascore/fixtures` con array completo + meta (`tournament.name`, `category.name`, `kickoff_at`, `status.type`).
2. **Match phase** (admin side): l'endpoint matcha contro `events_v2` (status in {prematch,live}, sport_slug in {calcio,tennis,basket}) usando `normalize.ts` + time-tolerance ±20min → persiste `events_v2.sofascore_id` dove match trovato. Risponde con elenco `[{sofa_event_id, vincitu_event_v2_id, kickoff_at, sport_slug, status, sofa_status}]`.
3. **Scraper enrichment loop** (continuo): cache locale dei matched events (TTL 5min). Ogni tick (30s) classifica nel tier (live/prematch/finished) e accoda nel worker pool gli eventi `due` (tempo dal `last_synced_at >= tier.interval_s`). Ogni worker poll i 10 endpoint dell'evento → POST a `/api/sofascore/enrichment` con `{sofa_event_id, sport_slug, payloads, endpoint_status}`.
4. **Admin upsert** (`/api/sofascore/enrichment`): lookup `event_enrichment` per `sofa_event_id`, upsert delle colonne jsonb modificate, aggiorna `last_synced_at` + merge `last_endpoint_status`.

---

## 3. Schema storage

### 3.1 Migration: aggiungere `events_v2.sofascore_id`

```sql
-- migration NNN_events_v2_add_sofascore_id.sql
ALTER TABLE events_v2 ADD COLUMN IF NOT EXISTS sofascore_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_events_v2_sofascore_id
  ON events_v2 (sofascore_id) WHERE sofascore_id IS NOT NULL;

-- rollback (manual): ALTER TABLE events_v2 DROP COLUMN sofascore_id;
```

Nullable. Nessuna FK verso event_enrichment (la FK è nell'altra direzione). Mirror del pattern `flashscore_id`.

### 3.2 Migration: nuova tabella `event_enrichment`

```sql
-- migration NNN+1_create_event_enrichment.sql
CREATE TABLE event_enrichment (
  event_v2_id          UUID PRIMARY KEY REFERENCES events_v2(id) ON DELETE CASCADE,
  sofa_event_id        BIGINT NOT NULL UNIQUE,
  sport_slug           TEXT NOT NULL,           -- calcio | tennis | basket

  -- 10 endpoint payload (jsonb, nullable, indipendentemente popolati)
  stats                JSONB,
  lineups              JSONB,
  incidents            JSONB,
  momentum             JSONB,                   -- da /event/{id}/graph
  shotmap              JSONB,
  best_players         JSONB,
  highlights           JSONB,
  comments             JSONB,
  votes                JSONB,
  featured_players     JSONB,

  -- telemetria
  last_synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_endpoint_status JSONB NOT NULL DEFAULT '{}'::jsonb,
                        -- shape: {stats:{ok:true,http:200,size:26391,ts:"2026-05-07T..."}, lineups:{...}, ...}
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_event_enrichment_last_synced ON event_enrichment (last_synced_at);
CREATE INDEX idx_event_enrichment_sport_slug ON event_enrichment (sport_slug);

-- rollback: DROP TABLE event_enrichment;
```

**Note schema**:
- `event_v2_id` PK = forza 1:1 e cascade delete
- `sofa_event_id` UNIQUE = no doppi record per stesso match SofaScore
- `last_endpoint_status` jsonb permette debug per endpoint senza schema rigido (utile se SofaScore aggiunge/rimuove endpoint)
- TOAST gestisce automaticamente jsonb >2KB; payload max stimato ~600KB calcio top match (con comments + shotmap), gestibile

---

## 4. Match-to-events_v2 algorithm

### 4.1 Riuso di `normalize.ts`

L'algoritmo riusa interamente il tokenizer di `lib/normalize.ts` (versione post-B1.A/B1.B): regex split `[\s\-/&,]+`, paren strip `[.'()]`, `_DEFAULT_NOISE`, `RESERVE_MARKERS`, e la funzione `matchTeams(a, b) → score [0..1]` 3-stage subset.

**Per-sport noise list** (mantiene la stessa scelta di B1.B):
- `calcio` → `_DEFAULT_NOISE`
- `tennis` → `_TENNIS_NOISE` (= `_DEFAULT_NOISE` + `q1/q2/q3/ll/wc/pr/alt/qualifier`, con b/c esclusi per evitare collisione iniziali)
- `basket` → `_DEFAULT_NOISE`

### 4.2 Endpoint admin `POST /api/sofascore/fixtures`

```typescript
// app/api/sofascore/fixtures/route.ts (admin)
import { matchTeams } from "@/lib/normalize";
import { createClient } from "@supabase/supabase-js";

const TIME_TOLERANCE_SEC = 20 * 60;  // ±20min
const SOFA_SPORT_TO_VINCITU: Record<string, string> = {
  football: "calcio",
  tennis: "tennis",
  basketball: "basket",
};

interface SofaFixture {
  sofa_event_id: number;
  sofa_sport: "football" | "tennis" | "basketball";
  home: string;
  away: string;
  kickoff_at: string;          // ISO
  sofa_status: string;         // notstarted | inprogress | finished | postponed | canceled
  tournament_name: string;
  category_name: string | null;
}

interface MatchResultRow {
  sofa_event_id: number;
  event_v2_id: string;
  sport_slug: string;
  kickoff_at: string;
  sofa_status: string;
}

export async function POST(req: NextRequest) {
  // auth: x-scraper-key
  if (req.headers.get("x-scraper-key") !== process.env.SCRAPER_API_KEY)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { fixtures } = await req.json() as { fixtures: SofaFixture[] };

  // Candidate pool: prematch+live + recently-finished (≤6h) so late-night matches
  // closed before the 04:00 UTC discovery still receive enrichment one-shot.
  const sixHoursAgoIso = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const candidates = await supabase.from("events_v2")
    .select("id, sport_slug, home, away, starts_at, status, sofascore_id")
    .in("sport_slug", ["calcio", "tennis", "basket"])
    .or(`status.in.(prematch,live),and(status.eq.settled,starts_at.gte.${sixHoursAgoIso})`)
    .limit(5000);

  const stats = {
    received: fixtures.length,
    matched_direct: 0,
    matched_fuzzy: 0,
    no_time_window: 0,
    no_match_name: 0,
    skipped_other_sport: 0,
    skipped_unknown_sport: 0,
  };
  const matched: MatchResultRow[] = [];
  const updates: Array<{ id: string; sofascore_id: number }> = [];

  for (const fx of fixtures) {
    const vincituSport = SOFA_SPORT_TO_VINCITU[fx.sofa_sport];
    if (!vincituSport) { stats.skipped_unknown_sport++; continue; }

    // 1. Direct lookup
    const direct = candidates.find(c => c.sofascore_id === fx.sofa_event_id);
    if (direct) {
      stats.matched_direct++;
      matched.push({ sofa_event_id: fx.sofa_event_id, event_v2_id: direct.id,
                     sport_slug: direct.sport_slug, kickoff_at: direct.starts_at,
                     sofa_status: fx.sofa_status });
      continue;
    }

    // 2. Time window filter
    const fxTime = new Date(fx.kickoff_at).getTime() / 1000;
    const inWindow = candidates.filter(c =>
      c.sport_slug === vincituSport &&
      !c.sofascore_id &&
      Math.abs(new Date(c.starts_at).getTime() / 1000 - fxTime) <= TIME_TOLERANCE_SEC
    );
    if (inWindow.length === 0) { stats.no_time_window++; continue; }

    // 3. Token-based name match
    let best: { ev: typeof inWindow[0]; score: number } | null = null;
    for (const c of inWindow) {
      const hScore = matchTeams(c.home, fx.home, vincituSport);
      const aScore = matchTeams(c.away, fx.away, vincituSport);
      if (hScore < 0.5 || aScore < 0.5) continue;
      const combined = hScore + aScore;
      if (!best || combined > best.score) best = { ev: c, score: combined };
    }
    if (!best || best.score <= 1.0) { stats.no_match_name++; continue; }

    // 4. Persist
    updates.push({ id: best.ev.id, sofascore_id: fx.sofa_event_id });
    matched.push({ sofa_event_id: fx.sofa_event_id, event_v2_id: best.ev.id,
                   sport_slug: best.ev.sport_slug, kickoff_at: best.ev.starts_at,
                   sofa_status: fx.sofa_status });
    stats.matched_fuzzy++;
  }

  // Bulk update
  for (const u of updates) {
    await supabase.from("events_v2").update({ sofascore_id: u.sofascore_id }).eq("id", u.id);
  }

  console.log(`[sofascore/fixtures] ${JSON.stringify(stats)}`);
  return NextResponse.json({ ...stats, matched });
}
```

### 4.3 Policy no-match
Eventi SofaScore senza match locale vengono **ignorati** (non creiamo nuovi events_v2). Vincitu è odds-api driven; FS+SS sono solo enrichment. Lo scraper riceve solo gli eventi matched e poll solo quelli.

### 4.4 Tennis double match
SofaScore espone tennis double con sintassi `Bayldon B / Veldheer M vs Reymond A / Sanchez L`. Il tokenizer post-B1.B (regex `[\s\-/&,]+` + paren strip) gestisce già questa forma — confermato dai sample (vedi `artifacts/sofa_tennis_16096965_info.json`).

---

## 5. Scraper polling, rate-limit & worker pool

### 5.1 Tier definition

```python
# sofascore_scraper/tiers.py
TIER_LIVE = {"interval_s": 60,    "endpoints": ALL_10}
TIER_PREMATCH = {"interval_s": 30 * 60, "endpoints": ALL_10}
TIER_FINISHED = {"interval_s": None, "endpoints": ALL_10, "one_shot": True}

ALL_10 = ["statistics", "lineups", "incidents", "graph", "shotmap",
          "best-players/summary", "highlights", "comments", "votes",
          "featured-players"]
```

Tier classification per evento: si usa `sofa_status` ricevuto dal match phase. Re-classificazione automatica al successivo discovery (1×/day) o alla scoperta di transition (es. notstarted → inprogress evidente quando un poll restituisce `event.status.type=inprogress`).

**State storage**: la classificazione tier per ogni `sofa_event_id` vive in:
- **Memory cache** dello scraper (dict `{sofa_event_id: {tier, last_synced_at, last_observed_status}}`) — primary working state
- **Persisted in `event_enrichment.last_endpoint_status` jsonb** sotto chiave `_tier`: `{_tier: "live", _tier_observed_at: "..."}` — questo permette al scraper di ripartire dopo restart senza dover ri-poll un primo "info" endpoint per riclassificare. Al boot, lo scraper carica lo stato da `GET /api/sofascore/stats?tier_state=true` (opzionale; alternativa: ripartire from-scratch e accettare 1 ciclo completo di re-classification, ~30s).

### 5.2 Rate-limit & jitter

- Token bucket: **2.5 req/s sustained, burst 5**
- Jitter ±100ms su ogni request (evita lockstep)
- Worker pool: **4 worker async** consuma da single asyncio.Queue
- Backoff su 403/429: exponential 30s → 60s → 120s → 240s → max 600s
- Backoff è **per-sport-slug** (isolation): se SofaScore inizia a 403 sul sport `football`, sospendiamo solo football per il backoff window, tennis+basket continuano

### 5.3 Carico atteso (peak weekend pomeriggio sabato 16:00 UTC)

| Tier | Match attivi (stima) | Endpoint | Ciclo | Req/min |
|---|---:|---:|---:|---:|
| live | 50 (calcio 20 + basket 8 + tennis 22) | 10 | 60s | 500 |
| prematch | 200 | 10 | 30min | 67 |
| finished | 100 (one-shot post-FT) | 10 | — | trascurabile |
| **Totale** | | | | **~570 req/min = 9.5 req/s** |

**9.5 req/s > 2.5 sustained limit** → mitigation:
- Worker pool=4 + queue smoothing → ogni worker ~2.4 req/s, totale ~9.6 req/s ma con jitter scaglionato
- Se rate-limit reale di SofaScore < 9 req/s, lo scopriremo in monitoring → fallback: ridurre live tier interval_s a 90s (-33% load)
- Alert su backoff persistente >10min
- Se permanente: opzione iter-1.5 ridurre endpoint set su tier_live (escludi `comments`+`highlights`+`votes`+`best-players`+`featured-players` da live, mantieni solo nei tier prematch/finished)

### 5.3.1 Phase-0 measurement gate (esplicito, parte del plan)

**Prima di abilitare polling 10-endpoint live in prod**, lo scraper gira per **24h in modalità "measure-only"** con:
- Tier_live ridotto a `[statistics, incidents]` (2 endpoint, ~100 req/min peak)
- Tier_prematch e finished disabilitati
- Logging dettagliato: `http_status_count`, `latency_p50/p95`, `backoff_events`, `503_per_sport`

Decision tree dopo le 24h:
- Se `403/429 ratio < 5%` e `backoff_active < 5min totali` → abilita full 10 endpoint su tier_live
- Se `403/429 ratio 5–20%` → abilita 5 endpoint live (`statistics, incidents, graph, shotmap, lineups`), gli altri 5 solo prematch/finished
- Se `403/429 ratio > 20%` → mantieni 2 endpoint live, valuta proxy pool (iter 1.5)

Questo gate va incluso come task esplicito nel plan, **non lasciato a giudizio runtime**.

### 5.4 Discovery

Un solo cron `04:00 UTC daily`: pulla scheduled-events per i 3 sport, push fixtures all'admin, riceve back la lista matched, sostituisce la cache locale matched events.

---

## 6. API endpoints (admin)

### 6.1 `POST /api/sofascore/fixtures`
Body: `{fixtures: SofaFixture[]}`. Vedi §4.2. Risposta: `{stats, matched: MatchResultRow[]}`. Idempotente: ri-eseguito non duplica match (skip via `direct lookup` prima).

### 6.2 `POST /api/sofascore/enrichment`
Body:
```typescript
{
  sofa_event_id: number,
  sport_slug: "calcio" | "tennis" | "basket",
  payloads: {
    stats?: jsonb | null,
    lineups?: jsonb | null,
    // ... 8 altri endpoint
  },
  endpoint_status: {
    [endpoint: string]: { ok: boolean, http: number, size: number, ts: string }
  }
}
```

Logica:
1. Lookup `event_enrichment` per `sofa_event_id`
2. Se non esiste, INSERT con `event_v2_id` derivato via JOIN events_v2 by sofascore_id (errore se non trovato → log, return 404)
3. Se esiste, UPDATE: ogni endpoint con `payloads[ep] !== undefined` viene scritto (anche `null` valido per "endpoint OK ma vuoto"), gli `undefined` lasciano la colonna invariata
4. `last_synced_at = now()`, `last_endpoint_status = last_endpoint_status || endpoint_status` (jsonb merge — preserva endpoint non aggiornati in questo ciclo)

Idempotente. Auth via `x-scraper-key`.

### 6.3 `GET /api/sofascore/stats`
Risposta:
```typescript
{
  matched_total: number,                          // count events_v2 con sofascore_id NOT NULL
  by_sport: { calcio: N, tennis: N, basket: N },
  by_endpoint_freshness: {
    [endpoint: string]: {
      populated_pct: number,                      // % event_enrichment rows con questa colonna NOT NULL
      median_age_s: number,
    }
  },
  last_run_at: { fixtures_at, enrichment_last_at }
}
```

Usato per smoke test post-deploy + dashboard ops manuale (Supabase Studio o `curl /stats`).

### 6.4 Auth
Tutti gli endpoint sopra richiedono `x-scraper-key: $SCRAPER_API_KEY` (riusa la env già usata da `/api/flashscore/*`).

---

## 7. Feature flags & ops

### 7.1 .env (scraper VPS + admin)

```
# admin .env.local
SCRAPER_API_KEY=<shared with FS scraper>

# scraper VPS .env
SOFA_SCRAPER_ENABLED=true
SOFA_ENRICHMENT_SPORTS=calcio,tennis,basket
SOFA_LIVE_INTERVAL_S=60
SOFA_PREMATCH_INTERVAL_S=1800
SOFA_RATE_LIMIT_RPS=2.5
SOFA_BACKOFF_MAX_S=600
SOFA_WORKER_POOL_SIZE=4
SOFA_DISCOVERY_HOUR_UTC=4
ADMIN_API_BASE=https://admin.vincitu.it
SCRAPER_API_KEY=<same as admin>
```

### 7.2 Systemd unit

`/etc/systemd/system/sofascore-scraper.service`, stesso pattern del flashscore-scraper esistente:
```
[Service]
ExecStart=/path/to/venv/bin/python -m sofascore_scraper
Restart=on-failure
MemoryMax=1G
WorkingDirectory=/root/sofascore-scraper
EnvironmentFile=/root/sofascore-scraper/.env
StandardOutput=journal
StandardError=journal
```

### 7.3 Telemetry & monitoring

- Per fixture-discovery cycle: `console.log({sport, fixtures_pushed, matched, no_time_window, no_match_name, errors})`
- Per enrichment cycle (ogni 30s tick): `console.log({live_due, prematch_due, polled, ok_per_endpoint, http_403_count, http_429_count, backoff_active_for_sports})`
- Health check HTTP: scraper espone `:9090/health` → 200 OK + `{last_tick_at, queue_depth, backoff_state}`. Consumato da uptime monitor esterno.

### 7.4 Test mode (no-money safety)

Coerente con setup `SETTLE_VIA_ODDS_API=true` test mode di Plan D S6: l'enrichment non tocca settlement, quindi può girare in test mode senza precauzioni speciali. Validation gate non richiesto.

---

## 8. Rollback plan

In ordine di intrusività decrescente:
1. **Pause polling** (zero data loss): `SOFA_SCRAPER_ENABLED=false` in `.env` + `systemctl restart sofascore-scraper`. Tempo: ~10s.
2. **Stop e disinstalla service**: `systemctl stop sofascore-scraper && systemctl disable sofascore-scraper`. Tempo: ~30s.
3. **Drop tabella enrichment**: `DROP TABLE event_enrichment;`. Tempo: ~1s. Nessuna FK incoming, drop pulito.
4. **Drop colonna events_v2**: `ALTER TABLE events_v2 DROP COLUMN sofascore_id;`. Nullable, nessuna FK, drop pulito.

Tempo totale rollback completo end-to-end: **~2min**. Zero impatto su settlement/odds/Plan D pipeline.

### Trigger di rollback automatico (alert manuale, non automatizzato iter 1)
- Backoff persistente >30min su tutti e 3 sport
- HTTP 403/429 ratio >50% per 1h
- Match-rate fixtures <30% per 3 cicli consecutivi
- Memoria scraper >900MB sostenuta (vicino a MemoryMax=1G)

---

## 9. Test plan

### 9.1 Unit
- `lib/normalize.ts` test esistenti coprono tokenizer; aggiungere fixture per nomi tennis double (`A B / C D vs E F / G H`) e SofaScore-specific (es. `FC Bayern München`, `Cusco FC`).
- `app/api/sofascore/fixtures/route.ts`: test casi (direct match, fuzzy match, no time window, no name match, sport mapping, multiple sofa events for same vincitu match → first wins).
- `app/api/sofascore/enrichment/route.ts`: test (insert, update, partial payload preserves untouched cols, unknown sofa_event_id → 404, last_endpoint_status merge).

### 9.2 Integration
- Spin-up local sofascore-scraper contro admin in dev, single iteration discovery → fixtures POST → assert N matched > 0 in events_v2 sample seed.
- Single live event polling cycle → assert event_enrichment row created con almeno `stats` non null.

### 9.3 Smoke test post-deploy prod (test mode)
- `curl https://admin.vincitu.it/api/sofascore/stats` ritorna 200 con `matched_total > 0`
- `journalctl -u sofascore-scraper -n 100` mostra log di ciclo senza ERROR
- `SELECT count(*) FROM event_enrichment WHERE last_synced_at > now() - interval '5 min';` ritorna >5

---

## 10. Aperture / non-decisi (advisory, non bloccanti per il plan)

- **MLB regular season validation**: il probe oggi ha trovato 263 fixture solo MiLB → cluster baseball "rosso". Ripetere il probe in giorno con MLB live per decidere se aggiungere baseball ai "verdi" in iter 1.5. Non blocca iter 1.
- **Cloudflare residential proxy fallback**: se in iter 1 osserviamo block-rate >20% sostenuto per >24h, valutare aggiunta proxy pool (~30-50€/mo). Non scope iter 1.
- **Endpoint future SofaScore**: se SS aggiunge nuovi endpoint utili (es. `xg-timeline`), si aggiungono colonne a `event_enrichment` con migration triviale.
- **Partial polling per ridurre carico**: se il rate-limit empirico forza, escludere `comments`+`highlights`+`votes`+`best-players`+`featured-players` dal tier_live (mantenuti in prematch+finished). Iter 1.5 se necessario.

---

## 11. Riferimenti

- Coverage probe: `C:\Users\philp\research\sofascore-vs-flashscore\artifacts\coverage_by_tier.json`
- Sample raw payloads: `C:\Users\philp\research\sofascore-vs-flashscore\artifacts\sofa_*.json` (114 file, 11.5MB)
- Scraper PoC: `C:\Users\philp\research\sofascore-vs-flashscore\scrape_sofa.py`
- Report comparativo: `C:\Users\philp\research\sofascore-vs-flashscore\REPORT.md`
- FS schema riferimento: `C:\Users\philp\fs-fix-workspace\{live-route.ts, fixtures-route.ts, live-lib.ts}`
- normalize.ts (codice riusato): commit `2314175` su `feature/plan-d-settlement-d1`
