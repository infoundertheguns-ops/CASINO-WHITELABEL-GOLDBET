# Agent Tickets — Verifica & Incasso (redesign + audit)

**Data**: 2026-04-14
**Autore**: brainstorming session
**Stato**: design approvato, pronto per writing-plans

## Contesto

La pagina `app/admin/agent-tickets/page.tsx` permette all'operatore di cassa di verificare ticket cartacei stampati al kiosk e incassare le vincite. L'attuale implementazione (230 righe, stili inline) funziona ma ha lacune operative:

- `claimed_by` sempre `null` → nessun audit di chi ha pagato
- Nessuna conferma prima del pagamento (click irreversibile)
- Niente stampa ricevuta pagamento
- Nessuno storico / KPI turno / quadratura cassa
- Possibile race se due casse claimano lo stesso codice
- Stili inline monolitici, non riusa il design system admin

## Scope

**In scope**: redesign UI, audit operatore, conferma + stampa ricevuta termica, sidebar storico/KPI, ricerca storica, RPC atomica claim, gestione stati edge.

**Out of scope**: scanner fotocamera (contesto cassa usa scanner USB che emette keyboard events), cashout parziale ticket, firma digitale ricevuta.

## Contesto operativo

- **Operatore**: cassa di agenzia fissa, desktop 1920×1080, scanner USB (emette ENTER), tastiera + mouse
- **Auth**: session admin (`admin_users.id`), tracciamento `claimed_by`, nessun PIN aggiuntivo
- **Stampante**: termica 80mm come default del browser
- **Volumi attesi**: alcune decine di ticket/giorno per cassa, picchi serali

## Architettura

Redesign in-place della route esistente `app/admin/agent-tickets/`. Split del monolite in componenti focalizzati + nuovi endpoint API + una migration DB.

### Layout (two-column 70/30 collapsible)

```
┌───────────────────────────────────────┬──────────────┐
│  [Input codice gigante, autofocus]    │ TURNO OGGI   │
│  ┌────────────────────────────────┐   │ Pagati: 42   │
│  │   TK-A8F3E2        VINTA       │   │ Uscite: €1.2k│
│  │   Home vs Away                 │   │ Stampati:€3k │
│  │   ...selezioni...              │   │ ──────────── │
│  │   Stake  Quota  DA PAGARE      │   │ Ultimi       │
│  │   [ PAGA €145.20 ]             │   │ pagati ↓     │
│  └────────────────────────────────┘   │ TK-XX €45 🖨 │
│                                       │ [🔍 Cerca]   │
└───────────────────────────────────────┴──────────────┘
                                        ↑ toggle <<
```

- Input sempre autofocus, refocus dopo ogni azione
- Sidebar pinnata default, F2 toggle
- Card ticket grande, tipografia monospace per codici/importi
- Tutto via `components/ui/*` del design system admin (no inline styles)

## Data model

### Migration `028_tickets_audit.sql`

```sql
-- FK claimed_by → admin_users
ALTER TABLE tickets
  ADD CONSTRAINT tickets_claimed_by_fkey
  FOREIGN KEY (claimed_by) REFERENCES admin_users(id);

-- CHECK constraint su status (enforcement del contratto RPC claim_ticket)
ALTER TABLE tickets
  ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('open','won','lost','void','claimed','expired'));

-- Log ricevute (stampa + ristampe)
CREATE TABLE ticket_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id),
  printed_by UUID REFERENCES admin_users(id),
  printed_at TIMESTAMPTZ DEFAULT NOW(),
  receipt_type TEXT NOT NULL CHECK (receipt_type IN ('payment', 'reprint'))
);
CREATE INDEX idx_receipts_ticket ON ticket_receipts(ticket_id);
CREATE INDEX idx_receipts_agent_date ON ticket_receipts(printed_by, printed_at);

-- RPC KPI turno. Note: tickets_paid/total_paid sono per-operatore (filtrati
-- per claimed_by), mentre tickets_count_today/total_printed_today sono
-- PLATFORM-WIDE (tutti i ticket stampati, indipendente dall'agente) — serve
-- per quadratura "entrate cassa (stampati) vs uscite (pagati da me)".
CREATE FUNCTION get_agent_shift_stats(p_admin_id UUID, p_since TIMESTAMPTZ)
RETURNS TABLE(
  tickets_paid INT,              -- per-operatore
  total_paid DECIMAL,            -- per-operatore
  tickets_count_today INT,       -- platform-wide
  total_printed_today DECIMAL    -- platform-wide
) LANGUAGE sql AS $$
  SELECT
    (SELECT COUNT(*)::INT FROM tickets
       WHERE claimed_by = p_admin_id AND claimed_at >= p_since),
    (SELECT COALESCE(SUM(win_amount),0) FROM tickets
       WHERE claimed_by = p_admin_id AND claimed_at >= p_since),
    (SELECT COUNT(*)::INT FROM tickets WHERE printed_at >= p_since),
    (SELECT COALESCE(SUM(stake),0) FROM tickets WHERE printed_at >= p_since);
$$;

-- RPC claim atomica (race-safe)
CREATE FUNCTION claim_ticket(p_code TEXT, p_admin_id UUID)
RETURNS TABLE(ticket_id UUID, amount_paid DECIMAL, already_claimed BOOLEAN)
LANGUAGE plpgsql AS $$
DECLARE v_id UUID; v_amount DECIMAL; v_status TEXT;
BEGIN
  UPDATE tickets
    SET status = 'claimed',
        claimed_at = NOW(),
        claimed_by = p_admin_id,
        updated_at = NOW()
    WHERE ticket_code = UPPER(p_code)
      AND status IN ('won', 'void')
    RETURNING id, win_amount INTO v_id, v_amount;

  IF v_id IS NULL THEN
    SELECT status INTO v_status FROM tickets WHERE ticket_code = UPPER(p_code);
    RETURN QUERY SELECT NULL::UUID, NULL::DECIMAL, (v_status = 'claimed');
  ELSE
    INSERT INTO ticket_receipts(ticket_id, printed_by, receipt_type)
      VALUES (v_id, p_admin_id, 'payment');
    RETURN QUERY SELECT v_id, v_amount, FALSE;
  END IF;
END $$;
```

## API

### Modifiche `app/api/tickets/route.ts`

- `PUT /api/tickets` — legge `claimed_by` da session admin server-side (401 se non admin loggato). **Ignora esplicitamente qualsiasi `claimed_by` passato nel body** (breaking change rispetto al contratto attuale — nessun caller esistente lo usa). Chiama RPC `claim_ticket`. Se `already_claimed=true` → 409 Conflict. Risposta include `amount_paid` + `receipt_id` per il template stampa
- `GET /api/tickets` — invariato logicamente, ma sanitizza response (rimuove `player_id` esposto al lato cassa). **Callers da verificare**: la pagina kiosk (`app/kiosk/`) e `betssolution-player` non devono dipendere da `player_id` in questo endpoint; se lo usano, si sposta su un endpoint interno dedicato

### Nuovi endpoint

| Route | Metodo | Descrizione |
|---|---|---|
| `/api/tickets/shift` | GET | KPI turno operatore loggato. Query: `?since=ISO` (default 00:00 Europe/Rome) |
| `/api/tickets/recent` | GET | Ultimi 20 ticket pagati dall'admin loggato oggi |
| `/api/tickets/search` | GET | Ricerca storica. Query: `q` (codice parziale), `from`, `to`, `status`. Limit 50 |
| `/api/tickets/reprint` | POST | Ristampa ricevuta. Body `{ ticket_code }`. Inserisce `receipt_type='reprint'` + voce `audit_log`. Richiede session admin |
| `/api/tickets/unlock-expired` | POST | Sblocca ticket `expired` vincente per pagamento manuale. Body `{ ticket_code }`. Richiede ruolo `super_admin` (403 altrimenti). Setta status a `won` + scrive `audit_log` action `ticket_unlock_expired`. Il pagamento vero avviene poi col normale flusso PUT |

Tutti gli endpoint scrivono `audit_log` con `action='ticket_claim'|'ticket_reprint'|'ticket_view'` e metadata (code, amount, ticket_id).

## Componenti UI

```
app/admin/agent-tickets/
  page.tsx                       # orchestrator: state, keyboard, layout
  components/
    ticket-scan-input.tsx        # input gigante autofocus + regex validator
    ticket-card.tsx              # card risultato (6 varianti stato)
    pay-modal.tsx                # modale conferma "Stai per pagare €X"
    receipt-template.tsx         # template termica 80mm (print-only CSS)
    shift-sidebar.tsx            # KPI turno + lista ultimi + toggle
    recent-paid-list.tsx         # righe ultimi pagati, action ristampa
    search-drawer.tsx            # drawer ricerca storica (F3)
```

Tutto usa `components/ui/{Button, Input, Badge, Kpi, Table}` + tokens `--admin-*`. Niente stili inline.

### Keyboard shortcuts

| Tasto | Azione |
|---|---|
| `ENTER` (input) | Verifica codice |
| `ESC` | Reset (svuota input + ticket, refocus input) |
| `F2` | Toggle sidebar |
| `F3` | Apri drawer ricerca |
| `SPACE` (su ticket won/void) | Apri modale pagamento |
| `ENTER` (modale) | Conferma pagamento |
| `ESC` (modale) | Annulla |

Refocus automatico sull'input dopo ogni azione completata (chiusura modale, errore, verifica).

## Flusso pagamento

1. Operatore scannerizza codice → scanner USB digita `TK-A8F3E2` + ENTER
2. Client chiama `GET /api/tickets?code=...` → mostra card con stato
3. Se `won` o `void`: operatore preme SPACE o clicca PAGA
4. Modale: "Stai per pagare €145.20 — Conferma?"
5. ENTER conferma → `PUT /api/tickets` (claim_ticket RPC)
6. Su success: auto-print via `window.print()` del `<ReceiptTemplate />` nascosto
7. Ricarica verifica ticket (ora `claimed`) + aggiorna sidebar KPI
8. Input rifocalizzato, pronto per prossimo ticket

## Ricevuta termica

Template 80mm (~32 char/riga, font monospace, separatori ASCII):

```
   BETSSOLUTION
   VIA ROMA 12, ROMA
   ────────────────
   RICEVUTA PAGAMENTO
   14/04/2026 18:42
   Cod: TK-A8F3E2
   ────────────────
   Home vs Away      2.15
   Team A vs Team B  1.75
   + 1 selezione
   ────────────────
   Stake      €  20.00
   Quota      x   7.52
   PAGATO     € 150.40
   ────────────────
   Cassiere: Mario R.
   ID: a8f3e2...1234
   ────────────────
    GRAZIE E BUONA
      FORTUNA
```

- `@media print` nasconde tutta la pagina tranne `#receipt-area`
- `@page { size: 80mm auto; margin: 0 }`
- Ristampa: badge `COPIA` in alto

## Edge cases

| Scenario | Comportamento |
|---|---|
| Codice non valido (regex fail) | Errore client, non chiama API |
| Ticket non trovato | Banner rosso "Ticket non trovato" |
| Stato `open` | Banner blu "Evento in corso", nessuna azione |
| Stato `lost` | Banner rosso "Persa", nessun pagamento |
| Stato `claimed` | Banner viola con timestamp + nome cassiere + bottone Ristampa |
| Stato `expired` | Banner grigio, PAGA disabilitato, link "Sblocca (super_admin)" |
| Race 2 casse stesso ticket | RPC atomica: 2° riceve 409 "Già incassato" |
| Network error su claim | RPC idempotente: verifica successiva mostra `claimed` → operatore sa che è andato |
| Scanner spuri (spazi, minuscolo) | Client normalizza + valida `/^TK-[A-Z0-9]{6}$/` |
| Doppio ENTER | Debounce 300ms su submit |

## Testing

- **Unit**: validator regex, normalizzazione input, mapping stati → banner
- **RPC**: test `claim_ticket` con scenari (won, void, already claimed, not found, lost)
- **Integration**: mock session admin, verifica audit log scritto, verifica 409 su double-claim
- **Manual**: print dialog con stampante termica reale (o PDF virtuale 80mm) prima del deploy

## Rollout

1. Migration `028` su staging Supabase → verifica RPC
2. Deploy staging, test con ticket reali staging
3. Migration + deploy prod (kiosk attivo → zero downtime grazie a backward-compat: `claimed_by` era già column, si aggiunge solo FK)

## Lavori non inclusi (tech debt flag)

- Logo immagine su ricevuta (termiche rendono male i PNG, skip)
- Firma digitale / timbro
- Export CSV storico (esiste già in admin audit, non duplichiamo)
- PIN cassiere (scelto scenario "session admin semplice")
- Scanner fotocamera (contesto cassa non lo richiede)
