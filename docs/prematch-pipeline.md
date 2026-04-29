# Pipeline Scraping Prematch + Redis Real-Time

> Documentazione tecnica completa del sistema di scraping prematch e live di Vincitu,
> inclusa l'architettura Redis real-time implementata il 2026-03-01.

---

## Indice

1. [Architettura Generale](#1-architettura-generale)
2. [Scheduling e Orchestrazione](#2-scheduling-e-orchestrazione)
3. [Quick Prematch (ogni 5 min)](#3-quick-prematch-ogni-5-min)
4. [Full Prematch (ogni 30 min)](#4-full-prematch-ogni-30-min)
5. [Prematch API — Logica di Scraping](#5-prematch-api--logica-di-scraping)
6. [Push verso Vincitu (HTTP)](#6-push-verso-betssolution-http)
7. [Ingestion Prematch (Vincitu API)](#7-ingestion-prematch-betssolution-api)
8. [Pipeline Redis Real-Time](#8-pipeline-redis-real-time)
9. [SSE Endpoint e Frontend Hook](#9-sse-endpoint-e-frontend-hook)
10. [Gestione Memoria e Recovery](#10-gestione-memoria-e-recovery)
11. [Monitoraggio e Metriche](#11-monitoraggio-e-metriche)
12. [Costanti e Configurazione](#12-costanti-e-configurazione)
13. [Bug Noti e Fix](#13-bug-noti-e-fix)

---

## 1. Architettura Generale

### Prima di Redis (fino al 2026-02-28)

```
Scraper (Camoufox)
  ├─ Live loop (30s)     ─→ HTTP POST batch ─→ /api/scraper/live    ─→ Supabase
  ├─ Quick prematch (5m) ─→ HTTP POST batch ─→ /api/scraper/prematch ─→ Supabase
  └─ Full prematch (30m) ─→ HTTP POST batch ─→ /api/scraper/prematch ─→ Supabase
                                                                        ↓
                                                              Supabase Realtime
                                                                        ↓
                                                                    Frontend
```

**Latenza totale**: 50-90s (30s scraping + 10-20s HTTP batch + 1-5s Realtime propagation)

### Dopo Redis (2026-03-01)

```
Scraper (Camoufox)
  │
  ├─ LIVE LOOP (30s)
  │   ├─ Per ogni evento → Redis PUBLISH odds:live  (<1ms)  ─→ SSE ─→ Frontend
  │   ├─ Per ogni evento → Redis RPUSH write_queue          (async)
  │   └─ Drain loop (5s) → LPOP queue → HTTP POST ─→ /api/scraper/live ─→ Supabase
  │
  ├─ QUICK PREMATCH (5m)
  │   └─ Overview-only → HTTP POST batch ─→ /api/scraper/prematch ─→ Supabase
  │
  └─ FULL PREMATCH (30m)
      └─ Detail + sub-tabs → HTTP POST batch ─→ /api/scraper/prematch ─→ Supabase
```

**Latenza live**: ~30-35s (limite fisico dello scraping — Redis delivery <1ms)
**Prematch**: invariato (HTTP diretto, non passa per Redis)

---

## 2. Scheduling e Orchestrazione

File: `src/continuous.ts`

### Funzione `main()`

All'avvio, il processo:

1. **Carica stato persistente** — `loadKnownEvents()` legge `~/.known-events.json` (mappa cumulativa di tutti gli eventi visti, sopravvive ai restart)
2. **Connette Redis** — `initRedis()` crea 2 client (uno per read/write, uno per PUBLISH). Se fallisce, si usa HTTP diretto come fallback
3. **Lancia browser** — Camoufox (Firefox modificato per anti-fingerprint)
4. **Naviga alla live hub** — Stabilisce la sessione Kambi (cookies, headers)
5. **Primo ciclo live** — Eseguito immediatamente
6. **Schedula loop** — Tutti i timer:

| Loop | Intervallo | Funzione |
|------|-----------|----------|
| Live | 30s | `liveLoop()` |
| Quick prematch | 5 min | `quickPrematchLoop()` |
| Full prematch | 30 min | `fullPrematchLoop()` (delay iniziale 2 min) |
| Stats fetch | 90s | `statsLoop()` (API-Football) |
| Stats push | 60s | `statsPushLoop()` → dashboard |
| Redis drain | 5s | `redisDrainLoop()` |
| Browser restart | 20 min | `periodicBrowserRestart()` |

### Timer e Intervalli

```typescript
const LIVE_INTERVAL_MS    = 30_000;   // Live scrape
const QUICK_PREMATCH_MS   = 5 * 60_000;  // Overview prematch
const FULL_PREMATCH_MS    = 30 * 60_000; // Full detail prematch
const STATS_INTERVAL_MS   = 90_000;   // API-Football stats
const STATS_PUSH_MS       = 60_000;   // Push stats to dashboard
const DRAIN_INTERVAL_MS   = 5_000;    // Redis → Supabase drain
const BROWSER_RESTART_MS  = 20 * 60_000; // Memory management
const LIVE_PAGE_REFRESH_MS = 15 * 60_000; // Clear JS heap
```

---

## 3. Quick Prematch (ogni 5 min)

File: `src/continuous.ts` → `quickPrematchLoop()`

### Scopo
Scraping veloce delle quote principali (1X2, O/U, GG/NG, DC) per i tornei più importanti. Nessuna chiamata alla detail API — solo intercept della overview.

### Flusso

```
1. Verifica prerequisiti
   - Browser attivo?
   - Sessione pronta?
   - Non già in esecuzione?
   ↓
2. ensureDiscovery()
   - Cache della lista tornei (validità 30 min)
   - Scopre sport → tornei → event count
   ↓
3. Filtra tornei high + medium tier
   - ~248 tornei tipicamente
   ↓
4. scrapeOverviewBatchParallel(createContext, tournaments, 2)
   - 2 worker paralleli
   - Ogni worker: 1 BrowserContext + 1 tab
   - Shared work queue (lock-free: nextIdx++)
   ↓
5. Per ogni torneo (dentro il worker):
   a. page.goto(tournament.listingUrl)
   b. Intercept response getOverviewEventsAams
   c. Parse mmkW → mercati principali
   d. Context recycling ogni 30 tornei
   ↓
6. pushPrematchBatch() → HTTP POST /api/scraper/prematch
   ↓
7. updateKnownEvents('prematch')
```

### Dettaglio `scrapeOverviewSingleTab()`

```typescript
async function scrapeOverviewSingleTab(page, tournament) {
  // 1. Registra listener per intercettare la response
  page.on('response', handler);

  // 2. Naviga alla pagina del torneo su Kambi
  await page.goto(tournament.listingUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 10_000,
  });

  // 3. L'SPA Angular carica e fa la chiamata API internamente
  //    Il listener intercetta la response JSON
  const overviewData = await Promise.race([overviewPromise, timeout(8000)]);

  // 4. Per ogni evento nella response:
  for (const ev of overviewData.leo) {
    // Parse mercati da mmkW (main market widget)
    // Contiene: 1X2, O/U 2.5, GG/NG, DC
    const markets = parseMarketsFromApi(ev.mmkW, 'Overview');
    results.push({ eventId, homeTeam, awayTeam, markets, ... });
  }
}
```

### Context Recycling (ogni 30 tornei)

Firefox alloca un content process per ogni pagina SPA caricata. La memoria cresce di ~50-100MB per caricamento. Solo `context.close()` termina il content process e libera la memoria. Navigare a `about:blank` NON aiuta.

```typescript
if (localCount % CONTEXT_RECYCLE_INTERVAL === 0) {
  await ctx.close();           // Termina content process
  ctx = await createContext();  // Nuovo contesto con proxy
  page = await ctx.newPage();   // Nuova tab pulita
}
```

---

## 4. Full Prematch (ogni 30 min)

File: `src/continuous.ts` → `fullPrematchLoop()`

### Scopo
Scraping completo di tutti i mercati per ogni evento: tab principale + fino a 5 sub-tab aggiuntive. Include mercati come handicap, esito esatto, intervallo, combo, giocatori, ecc.

### Differenze dal Quick Prematch

| Aspetto | Quick | Full |
|---------|-------|------|
| Frequenza | 5 min | 30 min |
| Metodo | Overview intercept | Detail API fetch |
| Worker | 2 paralleli | Sequenziale per chunk |
| Mercati | 3-4 (main odds) | 20-80+ (tutti i tab) |
| Sub-tabs | No | Sì (fino a 6) |
| Proxy | Per worker | Rotazione ogni 30 tornei |

### Flusso

```
1. Verifica prerequisiti (come quick)
   ↓
2. ensureDiscovery() → lista tornei
   ↓
3. Filtra high + medium tier
   ↓
4. Dividi in chunk da 30 tornei (TOURNAMENTS_PER_PROXY)
   ↓
5. Per ogni chunk:
   a. Seleziona proxy (round-robin)
   b. Crea BrowserContext con proxy
   c. Crea pagina
   d. scrapePrematchBatch(browser, page, chunk, rateLimiter)
   e. pushPrematchBatch() → HTTP POST
   f. updateKnownEvents()
   g. Chiudi contesto (libera memoria)
   ↓
6. Refresh sessione live (dopo lavoro pesante prematch)
```

### `scrapePrematchBatch()` — Cuore del Full Prematch

File: `src/prematch-api.ts`

```typescript
export async function scrapePrematchBatch(browser, page, tournaments, rateLimiter) {
  resetPrematchSession();  // Stato pulito per ogni batch

  for (let i = 0; i < tournaments.length; i++) {
    if (!rateLimiter.hasBudget()) break;

    // 1. Trova gli event ID del torneo
    const listing = await scrapeTournament(browser, page, tournament, rateLimiter);

    // NON navigare a about:blank qui!
    // Rompe getEventsByFetch() perché gli URL relativi non risolvono
  }
}
```

---

## 5. Prematch API — Logica di Scraping

File: `src/prematch-api.ts`

### Stato di Sessione

Ogni batch prematch ha il proprio stato:

```typescript
let capturedHeaders = {};     // Headers catturati dalla prima richiesta SPA
let headersCaptured = false;  // Flag: headers già catturati?
let fetchWorksForOverview = null;  // null=unknown, true/false
let knownDetailBase = null;   // 'pregame' o 'prematch' (varia per sport)
```

`resetPrematchSession()` azzera tutto all'inizio di ogni batch.

### Smart Dispatcher: `getEvents()`

Il dispatcher sceglie la strategia più efficiente per ottenere la lista eventi:

```
Primo torneo del batch?
  ├─ SÌ → getEventsByIntercept()
  │       - DEVE navigare per catturare headers
  │       - page.goto(listingUrl) → intercept response
  │       - Side effect: salva headers per i tornei successivi
  │
  └─ NO → getEventsByFetch() (fast path)
          - page.evaluate(fetch('/api/...'))
          - Usa headers catturati dal primo torneo
          - Nessuna navigazione (3-5x più veloce)
          │
          └─ Se fallisce → fallback a getEventsByIntercept()
```

### Intercept Path: `getEventsByIntercept()`

Usato per il primo torneo di ogni batch (cattura headers) e come fallback:

```
1. Registra listener su page.on('response') e page.on('request')
2. page.goto(tournament.listingUrl, waitUntil: 'domcontentloaded')
3. L'SPA Angular bootstrap → chiama /api/sport/pregame/getOverviewEventsAams
4. Il listener cattura:
   - Response body → lista eventi (leo[])
   - Request headers → salvati per uso futuro
5. Se totalPages > 1 → pagina con fetch() usando headers catturati
6. Return { eventIds: [...], tid }
```

Headers catturati (`buildForwardHeaders()`):
- `X-XSRF-TOKEN` (anti-CSRF)
- `X-Requested-With`
- `Authorization`
- `Accept`, `Accept-Language`
- `Cookie` (sessione)

### Fetch Path: `getEventsByFetch()`

Usato per tutti i tornei dopo il primo:

```typescript
const result = await page.evaluate(async (params) => {
  // Fallback XSRF dal cookie se non negli headers
  if (!params.headers['x-xsrf-token']) {
    const xsrf = document.cookie.split(';').find(c => c.startsWith('XSRF-TOKEN='));
    if (xsrf) params.headers['X-XSRF-TOKEN'] = decodeURIComponent(xsrf.split('=')[1]);
  }

  const resp = await fetch(
    `/api/sport/pregame/getOverviewEventsAams/0/${params.pageNum}/0/${params.tid}/0/0/0`,
    { credentials: 'same-origin', headers: params.headers }
  );
  return await resp.json();
}, { tid, pageNum, headers });
```

**IMPORTANTE**: usa URL relativi (`/api/...`). Funziona solo se la pagina è su un dominio Kambi. Se la pagina è su `about:blank`, fallisce con "is not a valid URL".

### Detail API: `scrapeEventDetail()`

Recupera tutti i mercati di un singolo evento:

```
1. Prova il base API noto (pregame o prematch)
   - fetch(/api/sport/{base}/getDetailsEventAams/0/{tid}/0/{eid}/0/0)
   - Se fallisce, prova l'altro base
   ↓
2. Parse tab principale (mmkW)
   - parseMarketsFromApi(event.mmkW, 'Eventi')
   ↓
3. Fetch sub-tabs (event.sbtb[])
   - Fino a 5 sub-tab aggiuntive (indice 1-5)
   - fetch(/api/sport/{base}/getDetailsEventAams/0/{tid}/0/{eid}/0/{subIdx})
   - Ogni sub-tab ha il proprio mmkW
   ↓
4. Unisci tutti i mercati
   - 20-80+ mercati per evento (vs 3-4 della overview)
```

### Rate Limiting: `AdaptiveRateLimiter`

Protegge dal WAF Akamai di Kambi:

- **Budget**: numero massimo di chiamate API per batch
- **Backoff adattivo**: su 429/403, ritardo esponenziale (1s → 2s → 4s... max 30s)
- **Success tracking**: riduce il ritardo dopo successi consecutivi
- **Hard limit**: batch=10 per le detail API (batch=20+ triggera blocco WAF)

---

## 6. Push verso Vincitu (HTTP)

File: `src/push-to-betssolution.ts`

### Prematch Push: `pushPrematchBatch()`

```typescript
function pushPrematchBatch(results, baseUrl, apiKey) {
  const events = results.map(r => ({
    external_id: r.eventId,
    sport: r.sport || 'Calcio',
    league: r.league || 'Sconosciuto',
    home_team: r.homeTeam,
    away_team: r.awayTeam,
    starts_at: parseKambiDate(r.startsAt),  // "DD-MM-YYYY HH:mm" → ISO 8601
    markets: transformMarkets(r.markets),       // Filtra odds > 1
  }));

  // Invia in batch da 10 eventi, timeout 30s
  return postBatch(`${baseUrl}/api/scraper/prematch`, apiKey, events);
}
```

### Live Push: `pushLiveBatch()`

Usato sia dal live loop diretto (fallback senza Redis) che dal drain loop:

```typescript
function pushLiveBatch(results, baseUrl, apiKey) {
  const events = results.map(r => ({
    external_id: r.eventId,
    status: 'live',
    minute: parseInt(r.minute),
    home_score: parseScore(r.score, 0),
    away_score: parseScore(r.score, 1),
    period: r.periodDesc,
    period_code: r.periodCode,
    half_score_home: r.halfScoreHome,
    half_score_away: r.halfScoreAway,
    stats: r.apiFootballStats,
    match_events: r.apiFootballEvents,
    markets: transformMarkets(r.markets),  // Può essere [] per overview-only
    home_team: r.homeTeam,
    away_team: r.awayTeam,
    sport: r.sport,
    league: r.tournament,
    starts_at: parseKambiDate(r.startsAt),
  }));

  return postBatch(`${baseUrl}/api/scraper/live`, apiKey, events);
}
```

---

## 7. Ingestion Prematch (Vincitu API)

File: `app/api/scraper/prematch/route.ts`

### Flusso per ogni evento

```
1. Auth: verifica x-scraper-key header
   ↓
2. Per ogni evento nel payload:
   a. Cerca evento per external_id
   b. Se non trovato → crea sport + league + evento
   c. Se is_live=true → SKIP (non sovrascrivere dati live con prematch)
   ↓
3. Aggiorna evento (starts_at, status=prematch)
   ↓
4. Se markets=[] → deattiva TUTTI i mercati attivi dell'evento
   (Kambi ha rimosso l'evento dal feed prematch)
   ↓
5. Upsert mercati (dedup per market_type)
   - Estrai line da market name: extractLine("OVER_UNDER_2.5") → 2.5
   ↓
6. Deattiva mercati stale (in DB ma non nel payload)
   ↓
7. Upsert outcomes (dedup per market_id + name)
   - Solo odds > 1
```

### Differenza con Live Route

| Aspetto | Prematch Route | Live Route |
|---------|---------------|------------|
| `markets=[]` | Deattiva tutti (evento rimosso) | **Skip** market logic (overview-only) |
| `is_live` check | Sì, skip se già live | No (aggiorna sempre) |
| Auto-create evento | Sì | Sì |
| Period detection | No | Sì (ENDED → finished) |
| Live data (stats) | No | Sì (halfScores, matchEvents) |

---

## 8. Pipeline Redis Real-Time

### Componenti

| Componente | File | Progetto |
|-----------|------|----------|
| Publisher | `src/redis-publisher.ts` | Scraper |
| Drain loop | `src/continuous.ts` → `redisDrainLoop()` | Scraper |
| Redis singleton | `lib/redis.ts` | Vincitu |
| SSE endpoint | `app/api/odds/stream/route.ts` | Vincitu |
| Cache endpoint | `app/api/odds/cache/route.ts` | Vincitu |
| Metrics endpoint | `app/api/odds/metrics/route.ts` | Vincitu |
| Frontend hook | `lib/hooks/use-live-odds.ts` | Vincitu |

### Redis Data Structures

```
odds:cache          Hash    {eventId → CachedEvent JSON}    TTL 1h
odds:live           Channel Pub/Sub per odds update
supabase:write_queue List   FIFO queue per persistenza async
```

### Publish Flow (per ogni evento live)

File: `src/redis-publisher.ts` → `publishLiveEvent()`

```
1. Costruisci CachedEvent dal risultato scraping
   {
     external_id, home_team, away_team, sport, league,
     minute, period, scores, half_score_home/away,
     stats (API-Football), match_events,
     markets: [{ type, outcomes: [{ name, odds }] }],
     updated_at: Date.now()
   }
   ↓
2. Leggi stato precedente da Redis (HGET odds:cache {eventId})
   ↓
3. Calcola diff quote (computeOddsDiff)
   - Per ogni outcome corrente:
     - Se non esiste in prev → nuova (previous_odds: null)
     - Se odds cambiata (|diff| >= 0.01) → change
   - Risultato: OddsChange[] con market_type, outcome_name, odds, previous_odds
   ↓
4. Tre operazioni Redis:
   a. HSET odds:cache {eventId} → stato corrente (per diff successive)
   b. PUBLISH odds:live → messaggio con solo i cambiamenti
   c. RPUSH supabase:write_queue → coda per persistenza Supabase
   ↓
5. Track metriche (changes/sec, latency)
```

### Messaggio Pub/Sub (`odds:live`)

```json
{
  "event_id": "15031862",
  "ts": 1709312400000,
  "type": "update",
  "changes": [
    { "market_type": "1X2", "outcome_name": "1", "odds": 2.15, "previous_odds": 2.10 },
    { "market_type": "OVER_UNDER_2.5", "outcome_name": "Over", "odds": 1.85, "previous_odds": 1.90 }
  ],
  "scores": { "home": 1, "away": 0 },
  "minute": 45,
  "period": "2T",
  "home_team": "Inter",
  "away_team": "Milan",
  "sport": "Calcio",
  "league": "Serie A",
  "market_count": 42,
  "outcome_count": 156
}
```

### Drain Loop (ogni 5s)

File: `src/continuous.ts` → `redisDrainLoop()`

```
1. drainWriteQueue(200)
   - LPOP fino a 200 items dalla queue
   - Deduplicazione: Map<event_id, latest_data>
   - Return solo l'ultimo update per ogni evento
   ↓
2. pushLiveBatch(dedupedItems) → HTTP POST /api/scraper/live
   ↓
3. La live route:
   - Se markets=[] → solo update score/minute/period (SKIP market logic)
   - Se markets presenti → upsert completo mercati + outcomes
```

**Perché la dedup?** Con 270 eventi e cicli da 30s, la queue accumula ~280 items ogni 30s. Il drain ogni 5s svuota prima che cresca troppo. La dedup garantisce che ogni evento venga scritto al DB solo una volta per drain cycle.

### Evento "Finished"

```typescript
publishEventFinished(externalId) {
  // 1. PUBLISH odds:live { type: "finished", event_id, changes: [] }
  // 2. HDEL odds:cache {externalId}
}
```

Il frontend riceve il messaggio "finished" e può aggiornare lo stato dell'evento.

---

## 9. SSE Endpoint e Frontend Hook

### SSE Endpoint

File: `app/api/odds/stream/route.ts`

```
GET /api/odds/stream?events=id1,id2 (opzionale)

1. Crea Redis subscriber dedicato per questa connessione
   ↓
2. Invia snapshot iniziale da Redis cache
   - HGETALL odds:cache → filtra per events param
   - event: snapshot, data: { events: [...] }
   ↓
3. Sottoscrivi canale odds:live
   - Per ogni messaggio:
     - Se events filter attivo → skip se event_id non in lista
     - event: odds, data: { ...LiveEventMessage }
     - Track throughput (recordOddsChanges)
   ↓
4. Heartbeat ogni 15s
   - event: heartbeat, data: { ts }
   ↓
5. Cleanup su abort signal
   - Unsubscribe, chiudi Redis subscriber
   - Decrementa SSE client count
```

### Frontend Hook: `useLiveOdds`

File: `lib/hooks/use-live-odds.ts`

```typescript
const { connected } = useLiveOdds({
  eventIds: ['15031862'],  // Opzionale: filtra eventi
  onSnapshot: (events) => {
    // Idratazione iniziale dal cache Redis
    // events: CachedEvent[]
  },
  onOddsChange: (msg) => {
    // Update incrementale
    // msg: { event_id, changes, scores, minute, ... }
  },
  onFinished: (eventId) => {
    // Evento terminato
  },
  enabled: true,
});
```

**Reconnect con exponential backoff**:
```
Disconnessione → attendi 1s → riconnetti
Fallisce → attendi 2s → riconnetti
Fallisce → attendi 4s → riconnetti
...fino a max 30s
Successo → reset delay a 1s
Heartbeat ricevuto → reset delay a 1s
```

### Integrazione nello Sportsbook

File: `lib/hooks/use-sportsbook.ts`

```typescript
// Nel hook principale dello sportsbook:
useLiveOdds({
  onOddsChange: (msg) => {
    setEvents(prev => prev.map(ev => {
      if (ev.externalId !== msg.event_id) return ev;
      // Aggiorna score, minute, period
      // Per ogni change: aggiorna odds dell'outcome + previousOdds + changedAt
      return { ...ev, ...updates };
    }));
    // Sincronizza betslip (se un outcome nel betslip ha nuove odds)
  },
});
```

### Pagina Dettaglio Evento

File: `app/(player)/sport/[id]/page.tsx`

```typescript
// SSE con filtro singolo evento (primary data source)
useLiveOdds({
  eventIds: [detailExternalId],
  onOddsChange: handleOddsChange,
});

// Polling Supabase ogni 30s (fallback, era 5s prima di Redis)
useEffect(() => {
  const interval = setInterval(fetchEventDetail, 30_000);
  return () => clearInterval(interval);
}, []);
```

---

## 10. Gestione Memoria e Recovery

### Problem: Firefox SPA Memory Leak

Ogni `page.goto()` su una pagina SPA (Angular di Kambi) alloca un content process Firefox da ~50-100MB. Navigare a `about:blank` NON libera questa memoria. Solo `context.close()` termina il processo e libera tutto.

### Soluzioni Implementate

| Meccanismo | Intervallo | Scopo |
|-----------|-----------|-------|
| Context recycling (overview) | Ogni 30 tornei | Chiude/ricrea contesto per worker |
| Context per chunk (full) | Ogni 30 tornei | Nuovo contesto per ogni chunk |
| Browser restart | Ogni 20 min | Riavvio completo del browser |
| Live page refresh | Ogni 15 min | Naviga a `about:blank` e poi torna alla live hub |
| Systemd MemoryMax | 20GB | Hard kill se supera |
| Systemd MemoryHigh | 16GB | Soft pressure |
| Swap | 4GB | Buffer aggiuntivo |

### Recovery da Errori

| Scenario | Rilevamento | Azione |
|---------|------------|--------|
| Browser crash | `browser.isConnected() = false` | Backoff esponenziale + relaunch |
| Session stale | >90s senza dati | Ri-navigazione alla live hub |
| Redis down | `isRedisConnected() = false` | Fallback a HTTP diretto |
| Kambi WAF 403 | Status 403 | Proxy rotation + backoff |
| API-Football limit | Error response | Skip stats fetch (non-fatal) |
| Vincitu unreachable | HTTP timeout | Skip batch, retry next cycle |

### Persistenza su Disco

```
~/.known-events.json     — mappa cumulativa eventi (sopravvive restart)
~/.scraper-state.json    — stato sessione (opzionale)
```

---

## 11. Monitoraggio e Metriche

### Stats Push (ogni 60s)

Il scraper invia a `/api/scraper/stats`:

```json
{
  "live_events": 434,
  "prematch_events": 986,
  "live_markets": 3116,
  "prematch_markets": 9846,
  "live_outcomes": 10114,
  "prematch_outcomes": 19989,
  "live_events_current_cycle": 258,
  "last_live_cycle": "2026-03-01T19:17:00Z",
  "last_prematch_cycle": "2026-03-01T19:15:00Z",
  "errors_last_hour": 0,
  "session_status": "healthy",
  "by_sport": { "Calcio": { "live": { "events": 137, ... }, "prematch": { ... } }, ... },
  "redis": { "queue_depth": 0, "cached_events": 1057, ... }
}
```

**Nota**: `live_events` è cumulativo (knownEvents.size), `live_events_current_cycle` è il conteggio reale dell'ultimo ciclo.

### Dashboard Admin

File: `components/admin/scraper/stats-dashboard.tsx`

Sezioni:
1. **Panoramica** — GB vs Vincitu con diff % e sparkline trend
2. **Dettaglio per Sport** — tabella con live/prematch/markets per sport
3. **Redis Pipeline** — 6 card (quote/sec, latenza, SSE clients, coda, memoria, cache)
4. **Dettagli tecnici** — mercati live/prematch, Vincitu DB counts, health

### Count DB Performance

I conteggi dei mercati/outcomes attivi usano l'RPC `get_active_counts()`:
- **Markets**: `SELECT count(*) FROM markets WHERE is_active = true` (esatto, ~260K righe)
- **Outcomes**: `reltuples` dall'indice parziale `idx_outcomes_active` (stima, ~2M righe)

Questo evita il timeout di 52s causato dalle dead tuples sul `count(*)` diretto.

### Telegram Alerts

Inviati automaticamente quando diff > 25% su eventi, mercati, o outcomes.

---

## 12. Costanti e Configurazione

### Scraper (`continuous.ts`)

| Costante | Valore | Descrizione |
|---------|--------|-------------|
| `LIVE_INTERVAL_MS` | 30s | Frequenza scrape live |
| `QUICK_PREMATCH_MS` | 5 min | Overview prematch |
| `FULL_PREMATCH_MS` | 30 min | Full detail prematch |
| `OVERVIEW_WORKERS` | 2 | Worker paralleli (quick) |
| `TOURNAMENTS_PER_PROXY` | 30 | Rotazione proxy (full) |
| `CONTEXT_RECYCLE_INTERVAL` | 30 | Riciclo contesto per worker |
| `BROWSER_RESTART_MS` | 20 min | Restart browser completo |
| `SESSION_STALE_MS` | 90s | Soglia sessione morta |
| `EVICT_MS` | 60 min | Evict eventi stale da knownEvents |

### Prematch API (`prematch-api.ts`)

| Costante | Valore | Descrizione |
|---------|--------|-------------|
| `MAX_SUB_TABS` | 6 | Sub-tab massime per evento |
| `INTERCEPT_TIMEOUT` | 20s | Timeout intercept overview |
| `OVERVIEW_TIMEOUT` | 8s | Timeout overview SPA |

### Redis (`redis-publisher.ts`)

| Costante | Valore | Descrizione |
|---------|--------|-------------|
| `REDIS_URL` | `redis://127.0.0.1:6379` | Connessione Redis |
| `CACHE_TTL` | 3600s (1h) | TTL cache odds:cache |
| `maxItems` (drain) | 200 | Max items per drain cycle |

### Push HTTP (`push-to-betssolution.ts`)

| Costante | Valore | Descrizione |
|---------|--------|-------------|
| `BATCH_SIZE` | 10 | Eventi per richiesta HTTP |
| `FETCH_TIMEOUT_MS` | 30s | Timeout HTTP |

---

## 13. Bug Noti e Fix

### Prematch `about:blank` (2026-03-01)

**Problema**: `scrapePrematchBatch()` navigava a `about:blank` tra i tornei per liberare memoria. Il torneo successivo usava `getEventsByFetch()` con URL relativo (`/api/...`) che non può risolvere su `about:blank`.

**Sintomo**: 26K+ errori "is not a valid URL". Solo il primo torneo di ogni batch funzionava.

**Fix**: Rimossa navigazione a `about:blank`. La memoria è già gestita dal riciclo contesto a livello di chunk. Commit `086cc0c`.

### Live Route `markets=[]` Deactivation (2026-03-01)

**Problema**: Con Redis drain, ~210/282 eventi arrivano senza mercati (overview-only dalla rotation). La live route deattivava TUTTI i mercati di questi eventi → -48% mercati.

**Sintomo**: Kambi 14,705 mercati vs Vincitu 7,654 dopo 30 min di drain.

**Fix**: Skip market logic quando `markets=[]` — l'evento non è stato fetchato dalla detail API questo ciclo, i mercati sono ancora validi. Commit `0767417`.

### Stats Count Timeout (2026-03-01)

**Problema**: `count: "exact"` sulla tabella outcomes (2M righe, 433K dead tuples) richiedeva 52s. In `Promise.all` con altre query, causava timeout o return null.

**Fix**: Creata RPC `get_active_counts()` + indici parziali (`idx_outcomes_active`, `idx_markets_active`) + VACUUM ANALYZE. Commit `0767417`.

### VACUUM in Transaction Block (2026-03-01)

**Problema**: `VACUUM` non può eseguire dentro un blocco transazionale. psql heredoc `<<EOF` wrappa tutto in `BEGIN/COMMIT`.

**Fix**: Usare flag `-c` separate: `psql -c "SET statement_timeout=600000" -c "VACUUM ANALYZE outcomes"`.
