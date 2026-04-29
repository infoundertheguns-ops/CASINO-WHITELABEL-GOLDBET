# Agent System Completion — Design Spec

**Data**: 2026-04-05
**Scope**: 6 feature mancanti per completare il sistema agenti

---

## Regola di Scoping Globale

Tutte le feature seguono questa regola:

| Ruolo | Visibilita' |
|-------|-------------|
| **Super Admin** | Tutto, nessun filtro |
| **Master Agent (lv1)** | Tutta la sua rete (agent lv2, sub-agent lv3, tutti i giocatori sotto) |
| **Agent (lv2)** | I suoi sub-agent lv3 + i suoi giocatori |
| **Sub-Agent (lv3)** | Solo i suoi giocatori |

## Regola Permessi Top-Down

- Super Admin assegna permessi al Master Agent
- Master Agent gestisce tutta la sua rete: crea agent lv2 e lv3, setta commissioni, wallet, permessi
- Agent lv2/lv3 opera solo nei limiti dei permessi ricevuti
- Un agente NON puo' assegnare a un subordinato un permesso che lui stesso non ha
- Un subordinato NON puo' avere commissione superiore al parent

## Modello Commissione (Overriding Commission)

Ogni livello guadagna commissione sul GGR generato dalla propria rete, indipendentemente dagli altri livelli. Questo e' il modello standard nel settore (overriding commission).

**Esempio**: Player genera GGR 10.000
- Sub-Agent lv3 (5%): commissione 500 sul GGR dei suoi giocatori
- Agent lv2 (10%): commissione 1.000 sul GGR dei suoi giocatori + quelli dei sub-agent
- Master lv1 (15%): commissione 1.500 sul GGR di tutta la rete

**Vincolo**: la somma delle commission_rate nella catena (master + agent + sub-agent) NON puo' superare 100%. Validato alla creazione/modifica dell'agente.

---

## Migration 028 — Schema DB

```sql
-- 028_agent_completion.sql

-- 1. Settlement period su agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS settlement_period TEXT DEFAULT 'monthly';
-- Valori: 'weekly' | 'monthly'

-- 2. Approved/paid tracking su agent_settlements
ALTER TABLE agent_settlements ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE agent_settlements ADD COLUMN IF NOT EXISTS approved_by UUID;
ALTER TABLE agent_settlements ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE agent_settlements ADD COLUMN IF NOT EXISTS paid_by UUID;
ALTER TABLE agent_settlements ADD COLUMN IF NOT EXISTS notes TEXT;
-- Unique constraint per evitare settlement duplicati
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_settlements_unique
  ON agent_settlements(agent_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_agent_settlements_status ON agent_settlements(status);

-- 3. Betting limits (3 livelli: agente, giocatore, sport)
CREATE TABLE IF NOT EXISTS betting_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id),    -- NULL = limite globale
  player_id UUID REFERENCES users(id),    -- NULL = tutti i giocatori
  sport TEXT,                              -- NULL = tutti gli sport
  max_stake DECIMAL(12,2),
  max_win DECIMAL(12,2),
  max_daily_turnover DECIMAL(12,2),
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique per combinazione (trattando NULL come valore unico)
CREATE UNIQUE INDEX IF NOT EXISTS idx_betting_limits_unique
  ON betting_limits(COALESCE(agent_id, '00000000-0000-0000-0000-000000000000'),
                    COALESCE(player_id, '00000000-0000-0000-0000-000000000000'),
                    COALESCE(sport, '__all__'));

CREATE INDEX IF NOT EXISTS idx_betting_limits_agent ON betting_limits(agent_id);
CREATE INDEX IF NOT EXISTS idx_betting_limits_player ON betting_limits(player_id);

-- 4. Player blacklist
CREATE TABLE IF NOT EXISTS player_blacklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES users(id),
  agent_id UUID REFERENCES agents(id),    -- chi l'ha bloccato (NULL = super admin)
  reason TEXT NOT NULL,
  blocked_by UUID NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Un solo blocco attivo per giocatore
CREATE UNIQUE INDEX IF NOT EXISTS idx_blacklist_unique_active
  ON player_blacklist(player_id) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_blacklist_player ON player_blacklist(player_id);

-- 5. Risk alert config in system_config
INSERT INTO system_config (key, value) VALUES
  ('risk_alert_config', '{
    "max_exposure": 50000,
    "max_daily_win": 10000,
    "consecutive_wins_alert": 5,
    "enabled": true
  }'::JSONB)
ON CONFLICT (key) DO NOTHING;

-- 6. Risk alert log
CREATE TABLE IF NOT EXISTS risk_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type TEXT NOT NULL,  -- exposure, daily_win, consecutive_wins, blacklist_attempt
  player_id UUID REFERENCES users(id),
  agent_id UUID REFERENCES agents(id),
  details JSONB,
  notified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_alerts_type ON risk_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_created ON risk_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_player ON risk_alerts(player_id);

-- RLS (SELECT-only: tutte le write passano via API con service role)
ALTER TABLE betting_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY betting_limits_read ON betting_limits FOR SELECT USING (true);

ALTER TABLE player_blacklist ENABLE ROW LEVEL SECURITY;
CREATE POLICY blacklist_read ON player_blacklist FOR SELECT USING (true);

ALTER TABLE risk_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY risk_alerts_read ON risk_alerts FOR SELECT USING (true);
```

---

## Feature 1: Agent Bets

### API

**`GET /api/agent/bets`**

Query params: `status` (open/won/lost/void), `period` (today/7d/30d/custom), `player_id`, `sport`, `agent_id` (filtra per agente nella rete), `page`, `limit` (default 50)

Logica:
1. Auth → `detectAgent()` o super admin check
2. Super Admin: nessun filtro base. Agent: `getScopedPlayerIds()` per limitare
3. Se `agent_id` param: verifica che sia nella rete dell'agente richiedente
4. Query `bets` JOIN `users` (username) + conteggio selezioni
5. KPI separata: count bets, sum stake, sum actual_win, margine %
6. Dettaglio selezioni: sub-query `bet_selections` JOIN `events` + `markets` + `outcomes`

Response:
```typescript
{
  kpis: { total_bets, turnover, winnings, margin_pct },
  bets: [{
    id, username, bet_type, stake, total_odds, potential_win,
    actual_win, status, is_live, created_at, selections_count,
    selections: [{ event_name, sport, market_type, outcome_name, odds, result }]
  }],
  pagination: { page, limit, total }
}
```

### UI — `/admin/agent-bets/page.tsx`

- KPI cards: Scommesse, Turnover, Vincite, Margine %
- Filtri riga: Stato (dropdown), Periodo (today/7d/30d), Sport (dropdown), Giocatore (search), Agente (dropdown — visibile solo a Master/SuperAdmin)
- Tabella: Data, Giocatore, Agente, Tipo, Stake, Quota, Vincita pot., Stato (badge)
- Row click → espande con selezioni dettagliate
- Paginazione bottom

---

## Feature 2: Wallet Self-Service

### API

**`GET /api/agent/wallet`**

Query params: `period` (today/7d/30d), `type` (credit_load/credit_distribute/credit_collect/commission), `page`, `limit`

Logica:
1. Auth → `detectAgent()`
2. Fetch wallet dell'agente (owner_type = 'agent', agent_id = agent.id)
3. Fetch transazioni da `agent_transactions` con filtri
4. KPI: saldo, totale caricato, totale distribuito, totale commissioni

Response:
```typescript
{
  wallet: { balance, total_loaded, total_distributed },
  kpis: { balance, total_loaded, total_distributed, total_commissions },
  transactions: [{ id, type, amount, balance_after, notes, created_at }],
  pagination: { page, limit, total }
}
```

### UI — `/admin/agent-wallet/page.tsx`

- Card grande: Saldo attuale (verde se positivo, rosso se negativo)
- KPI: Totale caricato, Totale distribuito, Commissioni guadagnate
- Prepaid: mostra saldo reale. Postpaid: mostra credito distribuito/raccolto
- Filtri: Periodo, Tipo transazione
- Tabella transazioni: Data, Tipo (badge), Importo (+verde/-rosso), Saldo dopo, Note
- Solo lettura — nessuna operazione di carica/scarica

---

## Feature 3: Settlement Automatico

### Cron — `/api/cron/settlement`

Schedulato: ogni giorno alle 02:00 UTC (vercel cron o chiamata esterna)

Logica:
1. Fetch tutti gli agenti attivi con `settlement_period`
2. Per ogni agente, calcola se il periodo e' scaduto:
   - **Weekly**: oggi e' lunedi' → periodo = lunedi'-1 a domenica-1
   - **Monthly**: oggi e' il 1° → periodo = 1° mese-1 a ultimo mese-1
   - **Catch-up**: se l'ultimo settlement per l'agente e' piu' vecchio del periodo configurato, genera il settlement mancante (copre server down o cron fallito)
3. Controlla che non esista gia' un settlement per quel periodo (unique index protegge comunque)
4. Calcola per l'agente (usando `getScopedPlayerIds`):
   - `total_turnover` = SUM(stake) delle bet nel periodo (status != 'void' && != 'rejected')
   - `total_winnings` = SUM(actual_win) delle bet nel periodo
   - `ggr` = turnover - winnings
   - `commission_amount` = ggr > 0 ? ggr * commission_rate / 100 : 0
5. Crea record `agent_settlements` con status `pending`
6. Notifica Telegram: "Settlement generato: {agent.name}, {period}, GGR {ggr}, Commissione {commission}"

### Cascata livelli

Ogni agente ha il suo settlement indipendente:
- Master lv1: GGR calcolato su TUTTI i giocatori della rete
- Agent lv2: GGR calcolato sui SUOI giocatori + quelli dei suoi sub-agent lv3
- Sub-Agent lv3: GGR calcolato solo sui SUOI giocatori

Le commissioni non si sottraggono a cascata — ogni livello guadagna la sua percentuale sul proprio GGR (modello overriding commission, vedi sezione sopra).

---

## Feature 4: Settlement Approval UI

### API

**`GET /api/admin/settlements`** — lista settlement con filtri (status, agent_id, period)
**`PUT /api/admin/settlements/[id]`** — cambia stato

Transizioni:
- `pending` → `approved` (Super Admin o Master per i suoi subordinati — MAI per il proprio settlement)
- `approved` → `paid` (Super Admin o Master per i suoi subordinati — MAI per il proprio)
- Ogni transizione salva `approved_by`/`paid_by` e timestamp

**Vincolo auto-approvazione**: Un agente NON puo' approvare/pagare il proprio settlement. Solo il Super Admin o il suo parent nella gerarchia puo' farlo.

### UI — `/admin/settlements/page.tsx`

- Filtri: Stato (pending/approved/paid), Agente (dropdown), Periodo
- Tabella: Agente, Periodo, Turnover, Vincite, GGR, Commissione %, Commissione EUR, Stato (badge), Azioni
- Azioni: bottone Approva (su pending), bottone Segna Pagato (su approved)
- Click riga → dettaglio con breakdown per sport:
  - Sport, Bet count, Turnover, Vincite, GGR, Margine %
- KPI in alto: Tot pending, Tot approved (da pagare), Tot paid (questo mese)

Scoping:
- Super Admin: vede tutti i settlement, puo' approvare/pagare tutti
- Master Agent: vede settlement della sua rete (i suoi agent lv2/lv3), puo' approvare/pagare quelli dei suoi subordinati
- Agent lv2/lv3: vede solo i propri settlement (sola lettura, no azioni)

---

## Feature 5: Sub-Agent Management

### API

**`GET /api/agent/network`** — lista rete dell'agente
**`POST /api/agent/network`** — crea agente nella rete
**`PUT /api/agent/network/[id]`** — modifica agente nella rete
**`POST /api/agent/network/[id]/wallet`** — carica/scarica wallet agente nella rete

#### Creazione (`POST /api/agent/network`)

Payload:
```typescript
{
  name: string,
  code: string,
  username: string,
  password: string,
  level: 2 | 3,
  parent_id?: string,       // per lv3: quale agent lv2
  wallet_model: "prepaid" | "postpaid",
  commission_rate: number,
  settlement_period: "weekly" | "monthly",
  permissions: AgentPermissions
}
```

Validazioni:
1. Solo Master Agent (lv1) puo' creare. Agent lv2/lv3 NON creano.
2. Deve avere permesso `sub_agents: "editor"`
3. `level` 2 → parent_id = master.id automatico
4. `level` 3 → parent_id deve essere un agent lv2 della rete del master
5. `commission_rate` <= master.commission_rate
6. Somma commission_rate nella catena (master + nuovo agente) <= 100%
7. Ogni permesso assegnato <= corrispondente permesso del master
8. Code univoco
9. Se master e' prepaid e nuovo agente e' prepaid: nessun saldo caricato automaticamente (il master carichera' dopo)

**Nota su `sub_agents` permission per lv2**: Il permesso `sub_agents: "viewer"` per un agent lv2 significa che puo' VEDERE i sub-agent lv3 sotto di lui e i loro giocatori. Non puo' creare — solo il Master crea.

#### Modifica (`PUT /api/agent/network/[id]`)

- Solo campi: name, commission_rate, permissions, status, wallet_model, settlement_period
- Stesse validazioni di permessi/commissione
- L'agente target deve essere nella rete del richiedente

#### Wallet (`POST /api/agent/network/[id]/wallet`)

- Solo per agent prepaid nella rete del master
- `action`: load/unload
- Se il master e' prepaid: deduci dal suo wallet. Il master non puo' caricare piu' del suo saldo.
- Se il master e' postpaid: carica liberamente (nessun limite, registrato in agent_transactions per audit)

### UI — `/admin/agent-network/page.tsx`

- **Vista albero**: Master in alto, sotto i suoi agent lv2, sotto ogni lv2 i suoi lv3
  - Ogni nodo: codice, nome, livello badge, wallet model, saldo, status, num giocatori
  - Espandibile per vedere i figli
- **Bottone "Crea Agente"** → form modale/inline
- **Click su agente** → pagina dettaglio `/admin/agent-network/[id]`
  - 5 tab: Info (edit), Permessi (edit), Wallet (load/unload), Giocatori (lista + crea), Transazioni
  - Stessa struttura della pagina admin `/admin/agents/[id]` ma scoped al master

---

## Feature 6: Risk Management

### Integrazione nella pagina risk esistente

La pagina `/admin/risk/page.tsx` esiste gia' con 6 tab (dashboard, alerts, users, ai, trading, liability). I nuovi tab **Limiti** e **Blacklist** vengono aggiunti come tab 7 e 8. Il tab Esposizione viene integrato nel tab "liability" esistente. Il tab Alert risk (soglie) viene integrato nel tab "alerts" esistente.

Quando un agente accede alla pagina risk (con permesso `risk: viewer`), vede solo i dati scoped alla sua rete.

### API

**`GET /api/admin/risk/exposure`** — esposizione corrente
- Calcola SUM(potential_win) per bet con status 'open', groupBy player
- Scoped per agente se non super admin

**`GET /api/admin/risk/limits`** — lista limiti attivi
**`POST /api/admin/risk/limits`** — crea limite
**`PUT /api/admin/risk/limits/[id]`** — modifica limite
**`DELETE /api/admin/risk/limits/[id]`** — elimina limite

**`GET /api/admin/risk/blacklist`** — lista blacklist
**`POST /api/admin/risk/blacklist`** — aggiungi a blacklist
**`DELETE /api/admin/risk/blacklist/[id]`** — rimuovi da blacklist

**`GET /api/admin/risk/alerts`** — log alert
**`PUT /api/admin/risk/config`** — aggiorna soglie alert

### Validazione in place-bet

Aggiungere nel flusso di `place-bet/route.ts` PRIMA di accettare la scommessa, DOPO i check `user_limits` e `ticket_limits` gia' esistenti. I nuovi `betting_limits` sono un terzo layer che si applica in aggiunta (il piu' restrittivo vince fra tutti e 3 i sistemi):

```
1. Check blacklist → player_blacklist WHERE player_id = X AND is_active = TRUE
   Se trovato → rifiuta "Account sospeso"

2. Find applicable betting_limit (piu' specifico vince):
   a. player_id + sport (piu' specifico)
   b. player_id + sport NULL
   c. agent_id + sport (dell'agente del giocatore)
   d. agent_id + sport NULL
   e. agent_id NULL + sport NULL (globale)
   Prendi il primo match trovato (query ORDER BY specificita')

3. Validate (se limite trovato):
   - stake <= max_stake → "Importo massimo superato (€X)"
   - potential_win <= max_win → "Vincita massima superata (€X)"
   - daily_turnover + stake <= max_daily_turnover → "Limite giornaliero raggiunto"

4. Post-accept risk check (asincrono, non blocca la bet):
   - Se esposizione totale > soglia → alert Telegram + record risk_alerts
   - Se vincite giornaliere > soglia → alert Telegram
   - Se vincite consecutive > soglia → alert Telegram
```

### UI — Nuovi tab nella pagina `/admin/risk/page.tsx`

**Tab "limits" (nuovo)**:
- Filtro: Livello (globale/agente/giocatore), Sport
- Tabella: Livello, Agente/Giocatore, Sport, Max Stake, Max Win, Max Daily, Attivo
- Bottoni: Crea, Modifica, Elimina
- Form: dropdown agente (opz.), dropdown giocatore (opz.), dropdown sport (opz.), campi importo

**Tab "blacklist" (nuovo)**:
- Cerca giocatore per username
- Tabella: Username, Agente, Motivo, Bloccato da, Data, Azione (rimuovi)
- Bottone aggiungi: cerca giocatore + motivo

**Integrazione tab "alerts" esistente**:
- Aggiungere sezione config soglie risk: max esposizione, max vincita giornaliera, vincite consecutive
- Toggle on/off
- Log risk_alerts sotto le risk_flags esistenti

**Integrazione tab "liability" esistente**:
- Aggiungere KPI esposizione: Esposizione totale, Bet aperte, Esposizione media
- Top 20 giocatori per esposizione con barra colorata (verde/giallo/rosso)

---

## Navigazione aggiornata

### Super Admin sidebar
Aggiungere:
- "Settlements" sotto la sezione admin (icona calendario)
- Risk gia' presente — tab aggiunti

### Agent sidebar (da `buildAgentNavigation`)
Aggiungere:
- "Scommesse" (permesso `bets: viewer`) → `/admin/agent-bets`
- "Wallet" (sempre visibile) → `/admin/agent-wallet`
- "Rete Agenti" (permesso `sub_agents: viewer`, solo Master lv1) → `/admin/agent-network`
- "Settlements" (permesso `commissions: viewer`) → `/admin/settlements`
- "Rischio" (permesso `risk: viewer`) → `/admin/risk`

---

## Ordine implementazione

1. **Agent Bets** — API + UI (nessuna migration necessaria)
2. **Wallet Self-Service** — API + UI (nessuna migration necessaria)
3. **Migration 028** — Schema per settlement_period, betting_limits, player_blacklist, risk_alerts
4. **Settlement Automatico** — Cron + calcolo
5. **Settlement Approval UI** — API + pagina admin
6. **Sub-Agent Management** — API + pagina agent-network
7. **Risk Management** — API + validazione place-bet + tab UI + alert Telegram

---

## File da creare/modificare

### Nuovi file
- `app/api/agent/bets/route.ts`
- `app/api/agent/wallet/route.ts`
- `app/api/agent/network/route.ts`
- `app/api/agent/network/[id]/route.ts`
- `app/api/agent/network/[id]/wallet/route.ts`
- `app/api/admin/settlements/route.ts`
- `app/api/admin/settlements/[id]/route.ts`
- `app/api/admin/risk/exposure/route.ts`
- `app/api/admin/risk/limits/route.ts`
- `app/api/admin/risk/limits/[id]/route.ts`
- `app/api/admin/risk/blacklist/route.ts`
- `app/api/admin/risk/blacklist/[id]/route.ts`
- `app/api/cron/settlement/route.ts`
- `app/admin/agent-bets/page.tsx`
- `app/admin/agent-wallet/page.tsx`
- `app/admin/agent-network/page.tsx`
- `app/admin/agent-network/[id]/page.tsx`
- `app/admin/settlements/page.tsx`
- `supabase/migrations/028_agent_completion.sql`
- `lib/risk.ts` — helper per limit resolution + blacklist check
- `lib/types/risk.ts` — tipi per limiti, blacklist, alert
- `components/admin/risk/limits-tab.tsx` — tab limiti
- `components/admin/risk/blacklist-tab.tsx` — tab blacklist

### File da modificare
- `app/api/player/place-bet/route.ts` — aggiungere check blacklist + betting_limits (dopo user_limits e ticket_limits esistenti)
- `lib/types/agent.ts` — aggiungere `settlement_period` al tipo Agent + campi approval su AgentSettlement
- `lib/agent-permissions.ts` — aggiornare `buildAgentNavigation()` con nuove voci
- `app/admin/layout.tsx` — aggiungere Settlements nel sidebar admin
- `app/admin/risk/page.tsx` — aggiungere tab "limits" e "blacklist", integrare esposizione e config soglie
- `lib/telegram.ts` — aggiungere funzione per alert risk (stesso bot/chat)
