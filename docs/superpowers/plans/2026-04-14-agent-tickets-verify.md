# Agent Tickets — Verifica & Incasso Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign della pagina `app/admin/agent-tickets` per cassa di agenzia con audit operatore, conferma + stampa termica ricevute, sidebar KPI turno e ricerca storica, claim atomico race-safe.

**Architecture:** Nuova migration `033` con FK + CHECK constraint + RPC atomica `claim_ticket` + RPC `get_agent_shift_stats`. Refactor `PUT /api/tickets` per usare session admin server-side. Nuovi endpoint read-only (`/shift`, `/recent`, `/search`) + `/reprint` + `/unlock-expired`. UI splittata in 7 componenti dentro `app/admin/agent-tickets/components/`, usa design system `components/ui/*`, stampa via `window.print()` con CSS `@media print` 80mm.

**Tech Stack:** Next.js 14 App Router, Supabase (PostgreSQL RPC), vitest, TypeScript, tailwind + tokens admin (`--admin-*`).

**Spec:** `docs/superpowers/specs/2026-04-14-agent-tickets-verify-design.md`

---

## File Structure

**New files:**
- `supabase/migrations/033_tickets_audit.sql` — migration (CHECK, FK, tabella ricevute, 3 RPC)
- `lib/auth/admin-session.ts` — helper che risolve `admin_users.id` dalla session corrente
- `app/api/tickets/shift/route.ts` — GET KPI turno
- `app/api/tickets/recent/route.ts` — GET ultimi pagati
- `app/api/tickets/search/route.ts` — GET ricerca storica
- `app/api/tickets/reprint/route.ts` — POST ristampa ricevuta
- `app/api/tickets/unlock-expired/route.ts` — POST sblocco super_admin
- `app/admin/agent-tickets/components/ticket-scan-input.tsx`
- `app/admin/agent-tickets/components/ticket-card.tsx`
- `app/admin/agent-tickets/components/pay-modal.tsx`
- `app/admin/agent-tickets/components/receipt-template.tsx`
- `app/admin/agent-tickets/components/shift-sidebar.tsx`
- `app/admin/agent-tickets/components/recent-paid-list.tsx`
- `app/admin/agent-tickets/components/search-drawer.tsx`
- `app/admin/agent-tickets/lib/ticket-code.ts` — validator/normalizer
- `app/admin/agent-tickets/lib/status-map.ts` — mapping stato → banner/colori/label
- `tests/lib/ticket-code.test.ts`
- `tests/lib/status-map.test.ts`
- `tests/api/tickets-claim.test.ts`

**Modified files:**
- `app/api/tickets/route.ts` — refactor `PUT` (session-based + RPC), sanifica `GET`
- `app/admin/agent-tickets/page.tsx` — riscritta come orchestrator (state, keyboard, layout)

---

## Task 1: Migration 033 — schema + RPC

**Files:**
- Create: `supabase/migrations/033_tickets_audit.sql`

- [ ] **Step 1: Scrivi migration completa**

```sql
-- 033_tickets_audit.sql — Audit + atomic claim for agent ticket verification
BEGIN;

-- CHECK constraint sullo status (enforcement contratto RPC)
ALTER TABLE tickets
  ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('open','won','lost','void','claimed','expired'));

-- FK claimed_by → admin_users.id
ALTER TABLE tickets
  ADD CONSTRAINT tickets_claimed_by_fkey
  FOREIGN KEY (claimed_by) REFERENCES admin_users(id);

-- Log ricevute (stampa + ristampe)
CREATE TABLE IF NOT EXISTS ticket_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id),
  printed_by UUID REFERENCES admin_users(id),
  printed_at TIMESTAMPTZ DEFAULT NOW(),
  receipt_type TEXT NOT NULL CHECK (receipt_type IN ('payment','reprint'))
);
CREATE INDEX idx_receipts_ticket ON ticket_receipts(ticket_id);
CREATE INDEX idx_receipts_agent_date ON ticket_receipts(printed_by, printed_at);

ALTER TABLE ticket_receipts ENABLE ROW LEVEL SECURITY;
-- Tutto via service role dal server, nessuna policy pubblica
CREATE POLICY ticket_receipts_service_only ON ticket_receipts FOR ALL USING (false);

-- RPC claim atomica (race-safe)
CREATE OR REPLACE FUNCTION claim_ticket(p_code TEXT, p_admin_id UUID)
RETURNS TABLE(ticket_id UUID, amount_paid DECIMAL, already_claimed BOOLEAN, not_payable BOOLEAN)
LANGUAGE plpgsql AS $$
DECLARE
  v_id UUID;
  v_amount DECIMAL;
  v_status TEXT;
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
    IF v_status IS NULL THEN
      -- Not found
      RETURN QUERY SELECT NULL::UUID, NULL::DECIMAL, FALSE, FALSE;
    ELSIF v_status = 'claimed' THEN
      RETURN QUERY SELECT NULL::UUID, NULL::DECIMAL, TRUE, FALSE;
    ELSE
      -- Not payable (open/lost/expired)
      RETURN QUERY SELECT NULL::UUID, NULL::DECIMAL, FALSE, TRUE;
    END IF;
  ELSE
    INSERT INTO ticket_receipts(ticket_id, printed_by, receipt_type)
      VALUES (v_id, p_admin_id, 'payment');
    RETURN QUERY SELECT v_id, v_amount, FALSE, FALSE;
  END IF;
END $$;

-- RPC KPI turno: per-operator paid, platform-wide printed
CREATE OR REPLACE FUNCTION get_agent_shift_stats(p_admin_id UUID, p_since TIMESTAMPTZ)
RETURNS TABLE(
  tickets_paid INT,
  total_paid DECIMAL,
  tickets_count_today INT,
  total_printed_today DECIMAL
) LANGUAGE sql AS $$
  SELECT
    (SELECT COUNT(*)::INT FROM tickets
       WHERE claimed_by = p_admin_id AND claimed_at >= p_since),
    (SELECT COALESCE(SUM(win_amount),0) FROM tickets
       WHERE claimed_by = p_admin_id AND claimed_at >= p_since),
    (SELECT COUNT(*)::INT FROM tickets WHERE printed_at >= p_since),
    (SELECT COALESCE(SUM(stake),0) FROM tickets WHERE printed_at >= p_since);
$$;

-- RPC unlock expired (super_admin only — check in API layer)
CREATE OR REPLACE FUNCTION unlock_expired_ticket(p_code TEXT, p_admin_id UUID)
RETURNS TABLE(ticket_id UUID, new_status TEXT)
LANGUAGE plpgsql AS $$
DECLARE
  v_id UUID;
  v_bet_status TEXT;
  v_win DECIMAL;
BEGIN
  SELECT t.id, b.status, b.potential_win INTO v_id, v_bet_status, v_win
    FROM tickets t JOIN bets b ON b.id = t.bet_id
    WHERE t.ticket_code = UPPER(p_code) AND t.status = 'expired';

  IF v_id IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT;
    RETURN;
  END IF;

  IF v_bet_status = 'won' THEN
    UPDATE tickets SET status='won', win_amount=v_win, updated_at=NOW() WHERE id=v_id;
    RETURN QUERY SELECT v_id, 'won'::TEXT;
  ELSIF v_bet_status = 'void' THEN
    UPDATE tickets SET status='void', updated_at=NOW() WHERE id=v_id;
    RETURN QUERY SELECT v_id, 'void'::TEXT;
  ELSE
    RETURN QUERY SELECT v_id, v_bet_status::TEXT; -- lost → rimane non pagabile
  END IF;
END $$;

COMMIT;
```

- [ ] **Step 2: Applica migration su Supabase locale (se disponibile) o staging**

Run: `npm run db:migrate`
Expected: output `Applied migration 033_tickets_audit.sql`

Se non c'è supabase locale, applicala su staging via dashboard SQL editor → paste + run.

- [ ] **Step 3: Verifica sanity con psql**

```bash
PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -c "\\d ticket_receipts"
PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -c "\\df claim_ticket"
PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -c "\\df get_agent_shift_stats"
PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -c "\\df unlock_expired_ticket"
```

Expected: tutte e 4 le funzioni/tabelle esistono.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/033_tickets_audit.sql
git commit -m "db(033): audit + atomic claim per agent ticket verification"
```

---

## Task 2: Validator codice ticket + status map (pure logic, TDD)

**Files:**
- Create: `app/admin/agent-tickets/lib/ticket-code.ts`
- Create: `app/admin/agent-tickets/lib/status-map.ts`
- Test: `tests/lib/ticket-code.test.ts`
- Test: `tests/lib/status-map.test.ts`

- [ ] **Step 1: Scrivi test falliti per ticket-code**

`tests/lib/ticket-code.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { normalizeTicketCode, isValidTicketCode } from "@/app/admin/agent-tickets/lib/ticket-code";

describe("normalizeTicketCode", () => {
  it("uppercases and trims", () => {
    expect(normalizeTicketCode("  tk-abc123  ")).toBe("TK-ABC123");
  });
  it("removes internal spaces (scanner artefatti)", () => {
    expect(normalizeTicketCode("tk - a b c 1 2 3")).toBe("TK-ABC123");
  });
});

describe("isValidTicketCode", () => {
  it("accepts TK- + 6 alfanumerici upper", () => {
    expect(isValidTicketCode("TK-ABC123")).toBe(true);
    expect(isValidTicketCode("TK-A8F3E2")).toBe(true);
  });
  it("rejects lowercase, wrong length, missing prefix", () => {
    expect(isValidTicketCode("tk-abc123")).toBe(false);
    expect(isValidTicketCode("TK-ABC12")).toBe(false);
    expect(isValidTicketCode("ABC-123456")).toBe(false);
    expect(isValidTicketCode("")).toBe(false);
  });
  it("rejects confusing chars 0/O/1/I (matching generator whitelist)", () => {
    expect(isValidTicketCode("TK-ABCDEF")).toBe(true);
    expect(isValidTicketCode("TK-0O1IAB")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test → FAIL**

Run: `npx vitest run tests/lib/ticket-code.test.ts`
Expected: FAIL "Cannot find module"

- [ ] **Step 3: Implementa**

`app/admin/agent-tickets/lib/ticket-code.ts`:
```ts
const ALLOWED = /^TK-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

export function normalizeTicketCode(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

export function isValidTicketCode(code: string): boolean {
  return ALLOWED.test(code);
}
```

- [ ] **Step 4: Run test → PASS**

Run: `npx vitest run tests/lib/ticket-code.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Scrivi test falliti per status-map**

`tests/lib/status-map.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { getStatusVisual, isPayable } from "@/app/admin/agent-tickets/lib/status-map";

describe("getStatusVisual", () => {
  it("returns won styling", () => {
    const v = getStatusVisual("won");
    expect(v.label).toMatch(/vinta/i);
    expect(v.tone).toBe("success");
  });
  it("handles unknown status gracefully", () => {
    const v = getStatusVisual("something_weird");
    expect(v.tone).toBe("neutral");
  });
});

describe("isPayable", () => {
  it("true for won and void", () => {
    expect(isPayable("won")).toBe(true);
    expect(isPayable("void")).toBe(true);
  });
  it("false for open/lost/claimed/expired", () => {
    expect(isPayable("open")).toBe(false);
    expect(isPayable("lost")).toBe(false);
    expect(isPayable("claimed")).toBe(false);
    expect(isPayable("expired")).toBe(false);
  });
});
```

- [ ] **Step 6: Implementa**

`app/admin/agent-tickets/lib/status-map.ts`:
```ts
export type TicketStatus = "open" | "won" | "lost" | "void" | "claimed" | "expired";
export type Tone = "info" | "success" | "danger" | "warning" | "violet" | "neutral";

export interface StatusVisual {
  label: string;
  tone: Tone;
  banner: string;
}

const MAP: Record<TicketStatus, StatusVisual> = {
  open:    { label: "IN CORSO", tone: "info",    banner: "Evento ancora in corso — attendere il risultato" },
  won:     { label: "VINTA",    tone: "success", banner: "Ticket vincente — pronto al pagamento" },
  lost:    { label: "PERSA",    tone: "danger",  banner: "Scommessa persa — nessun pagamento" },
  void:    { label: "VOID",     tone: "warning", banner: "Rimborso dello stake al cliente" },
  claimed: { label: "INCASSATA",tone: "violet",  banner: "Ticket già incassato" },
  expired: { label: "SCADUTA",  tone: "neutral", banner: "Ticket scaduto (oltre 30gg) — sblocco manuale richiesto" },
};

export function getStatusVisual(status: string): StatusVisual {
  return MAP[status as TicketStatus] ?? { label: status.toUpperCase(), tone: "neutral", banner: "" };
}

export function isPayable(status: string): boolean {
  return status === "won" || status === "void";
}
```

- [ ] **Step 7: Run test → PASS**

Run: `npx vitest run tests/lib/status-map.test.ts`
Expected: 4 passed.

- [ ] **Step 8: Commit**

```bash
git add app/admin/agent-tickets/lib tests/lib/ticket-code.test.ts tests/lib/status-map.test.ts
git commit -m "feat(agent-tickets): pure helpers ticket-code + status-map con test"
```

---

## Task 3: Helper session admin server-side

**Files:**
- Create: `lib/auth/admin-session.ts`

- [ ] **Step 1: Implementa helper**

`lib/auth/admin-session.ts`:
```ts
import { createClient } from "@/lib/supabase/server";

export interface AdminSession {
  userId: string;        // auth.users.id
  adminUserId: string;   // admin_users.id
  role: string;          // admin_roles.name (super_admin, risk_manager, ecc.)
  email: string;
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: admin } = await supabase
    .from("admin_users")
    .select("id, email, admin_roles(name)")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!admin) return null;
  return {
    userId: user.id,
    adminUserId: admin.id,
    role: (admin.admin_roles as any)?.name ?? "unknown",
    email: admin.email,
  };
}

export async function requireAdmin(): Promise<AdminSession | { error: string; status: number }> {
  const s = await getAdminSession();
  if (!s) return { error: "Non autenticato come admin", status: 401 };
  return s;
}
```

> **Note:** se lo schema di `admin_users` non ha la colonna `user_id` o il link a `admin_roles` è diverso, l'executor deve adattare la query. Verifica con `\d admin_users` prima di procedere.

- [ ] **Step 2: Verifica schema admin_users**

Run:
```bash
PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -c "\\d admin_users"
```

Se lo schema differisce, adatta `getAdminSession`. Commenta il task e aggiorna lo snippet con i nomi reali.

- [ ] **Step 3: Commit**

```bash
git add lib/auth/admin-session.ts
git commit -m "feat(auth): helper getAdminSession per claim ticket server-side"
```

---

## Task 4: Refactor PUT /api/tickets con claim_ticket RPC + session

**Files:**
- Modify: `app/api/tickets/route.ts`
- Test: `tests/api/tickets-claim.test.ts`

- [ ] **Step 1: Scrivi test con fake supabase per la logica di mapping risposta RPC**

Creiamo prima una funzione pura estraibile.

`tests/api/tickets-claim.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mapClaimRpcResult } from "@/app/api/tickets/_claim";

describe("mapClaimRpcResult", () => {
  it("success → 200 payload", () => {
    const r = mapClaimRpcResult([{ ticket_id: "t1", amount_paid: 150.4, already_claimed: false, not_payable: false }]);
    expect(r).toEqual({ status: 200, body: { success: true, amount_paid: 150.4, ticket_id: "t1" } });
  });
  it("already_claimed → 409", () => {
    const r = mapClaimRpcResult([{ ticket_id: null, amount_paid: null, already_claimed: true, not_payable: false }]);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/già incassato/i);
  });
  it("not_payable → 400", () => {
    const r = mapClaimRpcResult([{ ticket_id: null, amount_paid: null, already_claimed: false, not_payable: true }]);
    expect(r.status).toBe(400);
  });
  it("not_found (all false, nessun ticket_id) → 404", () => {
    const r = mapClaimRpcResult([{ ticket_id: null, amount_paid: null, already_claimed: false, not_payable: false }]);
    expect(r.status).toBe(404);
  });
  it("rpc returned empty array → 500", () => {
    const r = mapClaimRpcResult([]);
    expect(r.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run test → FAIL**

Run: `npx vitest run tests/api/tickets-claim.test.ts`
Expected: FAIL "Cannot find module"

- [ ] **Step 3: Estrai funzione pura + refactor PUT**

`app/api/tickets/_claim.ts`:
```ts
export interface ClaimRpcRow {
  ticket_id: string | null;
  amount_paid: number | null;
  already_claimed: boolean;
  not_payable: boolean;
}

export interface MappedResult {
  status: number;
  body: any;
}

export function mapClaimRpcResult(rows: ClaimRpcRow[]): MappedResult {
  if (!rows || rows.length === 0) {
    return { status: 500, body: { error: "RPC vuota" } };
  }
  const r = rows[0];
  if (r.already_claimed) {
    return { status: 409, body: { error: "Ticket già incassato" } };
  }
  if (r.not_payable) {
    return { status: 400, body: { error: "Ticket non pagabile (stato non consentito)" } };
  }
  if (!r.ticket_id) {
    return { status: 404, body: { error: "Ticket non trovato" } };
  }
  return { status: 200, body: { success: true, amount_paid: Number(r.amount_paid), ticket_id: r.ticket_id } };
}
```

Ora modifica `app/api/tickets/route.ts` — sostituisci l'intera funzione `PUT`:

```ts
import { requireAdmin } from "@/lib/auth/admin-session";
import { mapClaimRpcResult } from "./_claim";
import { normalizeTicketCode, isValidTicketCode } from "@/app/admin/agent-tickets/lib/ticket-code";

// PUT — Claim ticket (agent pays out). Session-based auth only.
export async function PUT(req: NextRequest) {
  const session = await requireAdmin();
  if ("error" in session) return NextResponse.json({ error: session.error }, { status: session.status });

  const body = await req.json();
  const raw = body?.ticket_code;
  if (!raw) return NextResponse.json({ error: "ticket_code richiesto" }, { status: 400 });
  const code = normalizeTicketCode(String(raw));
  if (!isValidTicketCode(code)) return NextResponse.json({ error: "Formato codice non valido" }, { status: 400 });

  const supabase = getAdminSupabase();
  const { data, error } = await supabase.rpc("claim_ticket", {
    p_code: code,
    p_admin_id: session.adminUserId,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const mapped = mapClaimRpcResult((data as any) ?? []);

  // Audit log
  if (mapped.status === 200) {
    await supabase.from("audit_log").insert({
      admin_user_id: session.adminUserId,
      action: "ticket_claim",
      metadata: { ticket_code: code, ticket_id: mapped.body.ticket_id, amount_paid: mapped.body.amount_paid },
    });
  }

  return NextResponse.json(mapped.body, { status: mapped.status });
}
```

E sanifica GET — rimuovi `player_id` dalla response:

```ts
// Dentro GET, prima del return finale:
const { player_id, ...ticketSanitized } = ticket;
return NextResponse.json({
  ticket: { ...ticketSanitized, status: ticketStatus, win_amount: ... },
  bet,
  selections: selections || [],
});
```

- [ ] **Step 4: Run test → PASS**

Run: `npx vitest run tests/api/tickets-claim.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Verifica caller esistenti di GET /api/tickets (regressione player_id)**

Run:
```bash
grep -rn "player_id" app/kiosk/ 2>/dev/null
grep -rn "/api/tickets" app/ --include="*.tsx" --include="*.ts"
```

Se kiosk o altri caller accedono a `player_id` dalla response, sposta la sanitizzazione dietro un query param `?context=cashier` anziché rimuoverlo globalmente. Altrimenti procedi.

- [ ] **Step 6: Commit**

```bash
git add app/api/tickets/route.ts app/api/tickets/_claim.ts tests/api/tickets-claim.test.ts
git commit -m "feat(api/tickets): PUT session-based + RPC atomica claim_ticket"
```

---

## Task 5: Endpoint /shift e /recent

**Files:**
- Create: `app/api/tickets/shift/route.ts`
- Create: `app/api/tickets/recent/route.ts`

- [ ] **Step 1: Scrivi /shift**

`app/api/tickets/shift/route.ts`:
```ts
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/admin-session";

export async function GET(req: NextRequest) {
  const session = await requireAdmin();
  if ("error" in session) return NextResponse.json({ error: session.error }, { status: session.status });

  // Default since = oggi 00:00 Europe/Rome (UTC+1/+2). Uso offset fisso +02:00 (CEST) — semplice.
  const sinceParam = req.nextUrl.searchParams.get("since");
  let since: string;
  if (sinceParam) {
    since = sinceParam;
  } else {
    const now = new Date();
    const romeOffsetMs = 2 * 3600 * 1000; // CEST summer; dst switch è accettabile per questo use-case
    const romeMidnight = new Date(Math.floor((now.getTime() + romeOffsetMs) / 86400000) * 86400000 - romeOffsetMs);
    since = romeMidnight.toISOString();
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("get_agent_shift_stats", {
    p_admin_id: session.adminUserId,
    p_since: since,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ since, ...row });
}
```

- [ ] **Step 2: Scrivi /recent**

`app/api/tickets/recent/route.ts`:
```ts
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/admin-session";

export async function GET(req: NextRequest) {
  const session = await requireAdmin();
  if ("error" in session) return NextResponse.json({ error: session.error }, { status: session.status });

  const supabase = createAdminClient();
  // Inizio giornata Rome come in /shift
  const now = new Date();
  const romeOffsetMs = 2 * 3600 * 1000;
  const romeMidnight = new Date(Math.floor((now.getTime() + romeOffsetMs) / 86400000) * 86400000 - romeOffsetMs);

  const { data, error } = await supabase
    .from("tickets")
    .select("ticket_code, win_amount, claimed_at, stake, total_odds, bet_type")
    .eq("claimed_by", session.adminUserId)
    .gte("claimed_at", romeMidnight.toISOString())
    .order("claimed_at", { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}
```

- [ ] **Step 3: Smoke test manuale**

Run (serve dev con sessione admin):
```bash
curl -b cookies.txt http://localhost:3000/api/tickets/shift
curl -b cookies.txt http://localhost:3000/api/tickets/recent
```

Expected: 401 senza cookies; con sessione admin valida → JSON con KPI / lista.

- [ ] **Step 4: Commit**

```bash
git add app/api/tickets/shift app/api/tickets/recent
git commit -m "feat(api/tickets): endpoint /shift e /recent con session admin"
```

---

## Task 6: Endpoint /search, /reprint, /unlock-expired

**Files:**
- Create: `app/api/tickets/search/route.ts`
- Create: `app/api/tickets/reprint/route.ts`
- Create: `app/api/tickets/unlock-expired/route.ts`

- [ ] **Step 1: /search**

`app/api/tickets/search/route.ts`:
```ts
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/admin-session";

export async function GET(req: NextRequest) {
  const session = await requireAdmin();
  if ("error" in session) return NextResponse.json({ error: session.error }, { status: session.status });

  const sp = req.nextUrl.searchParams;
  const q = sp.get("q");
  const from = sp.get("from");
  const to = sp.get("to");
  const status = sp.get("status");

  const supabase = createAdminClient();
  let query = supabase.from("tickets")
    .select("ticket_code, status, bet_type, stake, total_odds, win_amount, printed_at, claimed_at, claimed_by")
    .order("printed_at", { ascending: false })
    .limit(50);

  if (q) query = query.ilike("ticket_code", `%${q.toUpperCase()}%`);
  if (from) query = query.gte("printed_at", from);
  if (to) query = query.lte("printed_at", to);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}
```

- [ ] **Step 2: /reprint**

`app/api/tickets/reprint/route.ts`:
```ts
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/admin-session";
import { normalizeTicketCode, isValidTicketCode } from "@/app/admin/agent-tickets/lib/ticket-code";

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if ("error" in session) return NextResponse.json({ error: session.error }, { status: session.status });

  const body = await req.json();
  const code = normalizeTicketCode(String(body?.ticket_code ?? ""));
  if (!isValidTicketCode(code)) return NextResponse.json({ error: "Formato codice non valido" }, { status: 400 });

  const supabase = createAdminClient();
  const { data: ticket } = await supabase.from("tickets").select("id, status").eq("ticket_code", code).maybeSingle();
  if (!ticket) return NextResponse.json({ error: "Ticket non trovato" }, { status: 404 });
  if (ticket.status !== "claimed") {
    return NextResponse.json({ error: "Ristampa disponibile solo per ticket incassati" }, { status: 400 });
  }

  await supabase.from("ticket_receipts").insert({
    ticket_id: ticket.id,
    printed_by: session.adminUserId,
    receipt_type: "reprint",
  });
  await supabase.from("audit_log").insert({
    admin_user_id: session.adminUserId,
    action: "ticket_reprint",
    metadata: { ticket_code: code, ticket_id: ticket.id },
  });

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: /unlock-expired**

`app/api/tickets/unlock-expired/route.ts`:
```ts
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/admin-session";
import { normalizeTicketCode, isValidTicketCode } from "@/app/admin/agent-tickets/lib/ticket-code";

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if ("error" in session) return NextResponse.json({ error: session.error }, { status: session.status });
  if (session.role !== "super_admin") {
    return NextResponse.json({ error: "Solo super_admin può sbloccare ticket scaduti" }, { status: 403 });
  }

  const body = await req.json();
  const code = normalizeTicketCode(String(body?.ticket_code ?? ""));
  if (!isValidTicketCode(code)) return NextResponse.json({ error: "Formato codice non valido" }, { status: 400 });

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("unlock_expired_ticket", {
    p_code: code,
    p_admin_id: session.adminUserId,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.ticket_id) return NextResponse.json({ error: "Ticket non trovato o non scaduto" }, { status: 404 });

  await supabase.from("audit_log").insert({
    admin_user_id: session.adminUserId,
    action: "ticket_unlock_expired",
    metadata: { ticket_code: code, new_status: row.new_status },
  });

  return NextResponse.json({ success: true, new_status: row.new_status });
}
```

- [ ] **Step 4: Commit**

```bash
git add app/api/tickets/search app/api/tickets/reprint app/api/tickets/unlock-expired
git commit -m "feat(api/tickets): /search /reprint /unlock-expired + audit_log"
```

---

## Task 7: Componente ticket-scan-input

**Files:**
- Create: `app/admin/agent-tickets/components/ticket-scan-input.tsx`

- [ ] **Step 1: Implementa**

```tsx
"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Button, Input } from "@/components/ui";
import { normalizeTicketCode } from "../lib/ticket-code";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onReset: () => void;
  loading: boolean;
}

export interface ScanInputHandle { focus: () => void }

export const TicketScanInput = forwardRef<ScanInputHandle, Props>(function TicketScanInput(
  { value, onChange, onSubmit, onReset, loading }, ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));
  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-card)] p-5">
      <div className="text-xs uppercase tracking-wide text-slate-400 mb-2">
        Scansiona o digita il codice ticket
      </div>
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(normalizeTicketCode(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); onSubmit(); }
            if (e.key === "Escape") { e.preventDefault(); onReset(); }
          }}
          placeholder="TK-XXXXXX"
          className="flex-1 font-mono text-xl tracking-[0.2em] text-center font-bold uppercase h-14"
          autoFocus
        />
        <Button onClick={onSubmit} disabled={loading} className="h-14 px-8 font-bold">
          Verifica
        </Button>
      </div>
    </div>
  );
});
```

> **Note executor:** se `components/ui/Input` non supporta `ref` forward o non accetta `className` così, adatta usando l'`<input>` HTML con classi Tailwind allineate al tema admin.

- [ ] **Step 2: Commit**

```bash
git add app/admin/agent-tickets/components/ticket-scan-input.tsx
git commit -m "feat(agent-tickets): TicketScanInput component"
```

---

## Task 8: Componente ticket-card

**Files:**
- Create: `app/admin/agent-tickets/components/ticket-card.tsx`

- [ ] **Step 1: Implementa**

```tsx
"use client";
import { Badge } from "@/components/ui";
import { getStatusVisual, isPayable } from "../lib/status-map";

const TONE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  info:    { bg: "#3b82f620", text: "#60a5fa", border: "#3b82f6" },
  success: { bg: "#10b98120", text: "#10b981", border: "#10b981" },
  danger:  { bg: "#ef444420", text: "#ef4444", border: "#ef4444" },
  warning: { bg: "#f59e0b20", text: "#f59e0b", border: "#f59e0b" },
  violet:  { bg: "#8b5cf620", text: "#a78bfa", border: "#8b5cf6" },
  neutral: { bg: "#6b728020", text: "#94a3b8", border: "#6b7280" },
};

interface Selection {
  odds_at_placement: number;
  events?: { home_team?: string; away_team?: string; score_home?: number; score_away?: number };
}

interface Props {
  ticket: {
    ticket_code: string;
    status: string;
    bet_type: string;
    selections_count: number;
    stake: number;
    total_odds: number;
    potential_win: number;
    win_amount?: number | null;
    claimed_at?: string | null;
  };
  selections: Selection[];
  claimedByName?: string | null;
  onPay: () => void;
  onReprint: () => void;
  onUnlockExpired: () => void;
  canUnlock: boolean;
}

export function TicketCard({ ticket, selections, claimedByName, onPay, onReprint, onUnlockExpired, canUnlock }: Props) {
  const v = getStatusVisual(ticket.status);
  const color = TONE_COLORS[v.tone];
  const payable = isPayable(ticket.status);
  const amount = ticket.status === "won" ? (ticket.win_amount ?? ticket.potential_win) : ticket.status === "void" ? ticket.stake : (ticket.win_amount ?? ticket.potential_win);

  return (
    <div
      className="rounded-xl p-5 border-l-4"
      style={{
        background: "var(--admin-card)",
        borderLeftColor: color.border,
        border: `1px solid ${color.border}40`,
        borderLeft: `4px solid ${color.border}`,
      }}
    >
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="font-mono text-3xl font-black tracking-[0.15em] text-amber-400">
            {ticket.ticket_code}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {ticket.bet_type?.toUpperCase()} · {ticket.selections_count} selezioni
          </div>
        </div>
        <span
          className="px-4 py-2 rounded-md text-sm font-extrabold"
          style={{ background: color.bg, color: color.text }}
        >
          {v.label}
        </span>
      </div>

      {selections.length > 0 && (
        <div className="mb-4">
          {selections.map((s, i) => (
            <div key={i} className="flex justify-between py-2 border-b border-white/5 text-sm">
              <div>
                <span className="text-slate-200 font-semibold">
                  {s.events?.home_team} vs {s.events?.away_team}
                </span>
                {s.events?.score_home != null && (
                  <span className="font-mono text-blue-400 ml-2">
                    {s.events.score_home}-{s.events.score_away}
                  </span>
                )}
              </div>
              <span className="font-mono text-amber-400 font-bold">
                {s.odds_at_placement?.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 pt-3 border-t border-white/10">
        <Kpi label="Puntata" value={`€${ticket.stake?.toFixed(2)}`} />
        <Kpi label="Quota" value={ticket.total_odds?.toFixed(2)} />
        <Kpi
          label={ticket.status === "won" ? "DA PAGARE" : "Vincita Pot."}
          value={`€${(amount ?? 0).toFixed(2)}`}
          highlight={ticket.status === "won"}
        />
      </div>

      <div className="mt-4">
        {payable && (
          <button
            onClick={onPay}
            className="w-full py-4 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-extrabold text-lg"
          >
            PAGA €{(amount ?? 0).toFixed(2)}
          </button>
        )}
        {ticket.status === "claimed" && (
          <div className="flex items-center gap-2">
            <div className="flex-1 px-3 py-2 rounded bg-violet-500/20 text-violet-300 text-sm text-center">
              Incassato il {ticket.claimed_at ? new Date(ticket.claimed_at).toLocaleString("it-IT") : "?"}{claimedByName ? ` da ${claimedByName}` : ""}
            </div>
            <button onClick={onReprint} className="px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 text-white text-sm">
              Ristampa
            </button>
          </div>
        )}
        {ticket.status === "expired" && canUnlock && (
          <button
            onClick={onUnlockExpired}
            className="w-full py-3 rounded bg-amber-600 hover:bg-amber-700 text-white font-bold"
          >
            Sblocca (super_admin)
          </button>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`font-mono font-extrabold text-lg ${highlight ? "text-emerald-400" : "text-slate-100"}`}>{value}</div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/admin/agent-tickets/components/ticket-card.tsx
git commit -m "feat(agent-tickets): TicketCard con 6 stati + actions"
```

---

## Task 9: Componenti pay-modal + receipt-template

**Files:**
- Create: `app/admin/agent-tickets/components/pay-modal.tsx`
- Create: `app/admin/agent-tickets/components/receipt-template.tsx`

- [ ] **Step 1: Implementa pay-modal**

```tsx
"use client";
import { useEffect } from "react";

interface Props {
  open: boolean;
  amount: number;
  ticketCode: string;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function PayModal({ open, amount, ticketCode, loading, onConfirm, onCancel }: Props) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); onConfirm(); }
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onConfirm, onCancel]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur">
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-8 max-w-md w-full mx-4">
        <div className="text-xl font-bold mb-2 text-white">Conferma pagamento</div>
        <div className="text-slate-300 mb-6">
          Stai per pagare al cliente:
          <div className="mt-3 text-center">
            <div className="font-mono text-3xl font-black text-emerald-400">€{amount.toFixed(2)}</div>
            <div className="font-mono text-sm text-amber-400 mt-1">{ticketCode}</div>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={onCancel} disabled={loading} className="flex-1 py-3 rounded bg-slate-700 hover:bg-slate-600 text-white">
            Annulla (ESC)
          </button>
          <button onClick={onConfirm} disabled={loading} className="flex-1 py-3 rounded bg-emerald-500 hover:bg-emerald-600 text-white font-bold">
            Conferma (ENTER)
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implementa receipt-template**

```tsx
"use client";
import { forwardRef } from "react";

interface ReceiptData {
  ticket_code: string;
  bet_type: string;
  stake: number;
  total_odds: number;
  amount_paid: number;
  selections: Array<{ label: string; odds: number }>;
  cashier_name: string;
  cashier_id: string;
  timestamp: string;
  is_reprint?: boolean;
}

export const ReceiptTemplate = forwardRef<HTMLDivElement, { data: ReceiptData | null }>(
  function ReceiptTemplate({ data }, ref) {
    if (!data) return null;
    const shown = data.selections.slice(0, 3);
    const rest = data.selections.length - shown.length;

    return (
      <div
        id="receipt-area"
        ref={ref}
        className="hidden print:block font-mono text-black bg-white"
        style={{ width: "80mm", padding: "4mm 2mm", fontSize: "12px", lineHeight: 1.25 }}
      >
        <style>{`
          @media print {
            @page { size: 80mm auto; margin: 0; }
            body * { visibility: hidden !important; }
            #receipt-area, #receipt-area * { visibility: visible !important; }
            #receipt-area { position: absolute; left: 0; top: 0; display: block !important; }
          }
        `}</style>
        <div style={{ textAlign: "center", fontWeight: 700 }}>BETSSOLUTION</div>
        <div style={{ textAlign: "center" }}>VIA ROMA 12, ROMA</div>
        <div>────────────────────────────────</div>
        <div style={{ textAlign: "center", fontWeight: 700 }}>
          {data.is_reprint ? "COPIA — RICEVUTA PAGAMENTO" : "RICEVUTA PAGAMENTO"}
        </div>
        <div>{data.timestamp}</div>
        <div>Cod: {data.ticket_code}</div>
        <div>────────────────────────────────</div>
        {shown.map((s, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{s.label.slice(0, 22)}</span>
            <span>{s.odds.toFixed(2)}</span>
          </div>
        ))}
        {rest > 0 && <div>+ {rest} selezion{rest === 1 ? "e" : "i"}</div>}
        <div>────────────────────────────────</div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Stake</span><span>€ {data.stake.toFixed(2)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Quota</span><span>x {data.total_odds.toFixed(2)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
          <span>PAGATO</span><span>€ {data.amount_paid.toFixed(2)}</span>
        </div>
        <div>────────────────────────────────</div>
        <div>Cassiere: {data.cashier_name}</div>
        <div>ID: {data.cashier_id.slice(0, 8)}</div>
        <div>────────────────────────────────</div>
        <div style={{ textAlign: "center" }}>GRAZIE E BUONA FORTUNA</div>
      </div>
    );
  }
);
```

- [ ] **Step 3: Commit**

```bash
git add app/admin/agent-tickets/components/pay-modal.tsx app/admin/agent-tickets/components/receipt-template.tsx
git commit -m "feat(agent-tickets): PayModal + ReceiptTemplate 80mm"
```

---

## Task 10: Componenti shift-sidebar + recent-paid-list + search-drawer

**Files:**
- Create: `app/admin/agent-tickets/components/shift-sidebar.tsx`
- Create: `app/admin/agent-tickets/components/recent-paid-list.tsx`
- Create: `app/admin/agent-tickets/components/search-drawer.tsx`

- [ ] **Step 1: recent-paid-list**

```tsx
"use client";

interface Item {
  ticket_code: string;
  win_amount: number;
  claimed_at: string;
}

interface Props {
  items: Item[];
  onReprint: (code: string) => void;
  onSelect: (code: string) => void;
}

export function RecentPaidList({ items, onReprint, onSelect }: Props) {
  if (items.length === 0) {
    return <div className="text-xs text-slate-500 italic py-2">Nessun ticket pagato nel turno</div>;
  }
  return (
    <div className="space-y-1 max-h-80 overflow-y-auto">
      {items.map((it) => (
        <div key={it.ticket_code} className="flex items-center justify-between gap-2 text-xs py-1 border-b border-white/5">
          <button onClick={() => onSelect(it.ticket_code)} className="font-mono text-amber-400 hover:text-amber-300">
            {it.ticket_code}
          </button>
          <span className="text-emerald-400 font-mono font-bold">€{Number(it.win_amount).toFixed(2)}</span>
          <button onClick={() => onReprint(it.ticket_code)} className="text-slate-400 hover:text-white" title="Ristampa">🖨</button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: shift-sidebar**

```tsx
"use client";
import { useEffect, useState } from "react";
import { RecentPaidList } from "./recent-paid-list";

interface Stats {
  tickets_paid: number;
  total_paid: number;
  tickets_count_today: number;
  total_printed_today: number;
}

interface Props {
  open: boolean;
  onToggle: () => void;
  onOpenSearch: () => void;
  onSelect: (code: string) => void;
  onReprint: (code: string) => void;
  refreshKey: number;
}

export function ShiftSidebar({ open, onToggle, onOpenSearch, onSelect, onReprint, refreshKey }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const [s, r] = await Promise.all([
        fetch("/api/tickets/shift").then(r => r.json()),
        fetch("/api/tickets/recent").then(r => r.json()),
      ]);
      setStats({
        tickets_paid: s.tickets_paid ?? 0,
        total_paid: Number(s.total_paid ?? 0),
        tickets_count_today: s.tickets_count_today ?? 0,
        total_printed_today: Number(s.total_printed_today ?? 0),
      });
      setRecent(r.items ?? []);
    })();
  }, [refreshKey]);

  if (!open) {
    return (
      <button onClick={onToggle} className="fixed right-2 top-24 bg-slate-800 rounded-l px-2 py-4 text-slate-300" title="F2 - Apri">
        ‹
      </button>
    );
  }

  return (
    <aside className="w-[320px] shrink-0 bg-[var(--admin-card)] border border-[var(--admin-border)] rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold text-slate-200">TURNO OGGI</div>
        <button onClick={onToggle} className="text-slate-400 hover:text-white text-xs" title="F2 - Chiudi">›› chiudi</button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-slate-800/50 p-2 rounded">
            <div className="text-slate-400">Pagati</div>
            <div className="font-mono font-bold text-lg text-emerald-400">{stats.tickets_paid}</div>
          </div>
          <div className="bg-slate-800/50 p-2 rounded">
            <div className="text-slate-400">Uscite €</div>
            <div className="font-mono font-bold text-lg text-emerald-400">€{stats.total_paid.toFixed(2)}</div>
          </div>
          <div className="bg-slate-800/50 p-2 rounded">
            <div className="text-slate-400">Stampati</div>
            <div className="font-mono font-bold text-lg text-slate-100">{stats.tickets_count_today}</div>
          </div>
          <div className="bg-slate-800/50 p-2 rounded">
            <div className="text-slate-400">Entrate €</div>
            <div className="font-mono font-bold text-lg text-slate-100">€{stats.total_printed_today.toFixed(2)}</div>
          </div>
        </div>
      )}

      <div>
        <div className="text-xs font-bold text-slate-300 mb-2">ULTIMI PAGATI</div>
        <RecentPaidList items={recent} onReprint={onReprint} onSelect={onSelect} />
      </div>

      <button onClick={onOpenSearch} className="w-full py-2 rounded bg-slate-700 hover:bg-slate-600 text-sm text-white">
        🔍 Cerca storico (F3)
      </button>
    </aside>
  );
}
```

- [ ] **Step 3: search-drawer**

```tsx
"use client";
import { useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (code: string) => void;
}

export function SearchDrawer({ open, onClose, onSelect }: Props) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const search = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    const r = await fetch(`/api/tickets/search?${params}`).then(r => r.json());
    setItems(r.items ?? []);
    setLoading(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose}>
      <div className="absolute right-0 top-0 h-full w-[480px] bg-slate-900 border-l border-slate-700 p-4 overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <div className="font-bold text-white">Ricerca storico ticket</div>
          <button onClick={onClose} className="text-slate-400">✕</button>
        </div>
        <div className="flex gap-2 mb-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="TK-XXX..."
            className="flex-1 px-3 py-2 rounded bg-slate-800 border border-slate-700 text-white font-mono"
            autoFocus
          />
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-2 rounded bg-slate-800 border border-slate-700 text-white text-sm">
            <option value="">Tutti</option>
            <option value="open">Open</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="void">Void</option>
            <option value="claimed">Claimed</option>
            <option value="expired">Expired</option>
          </select>
          <button onClick={search} disabled={loading} className="px-4 rounded bg-blue-600 text-white text-sm">Cerca</button>
        </div>
        <div className="space-y-1">
          {items.map((it) => (
            <button
              key={it.ticket_code}
              onClick={() => { onSelect(it.ticket_code); onClose(); }}
              className="w-full text-left p-2 rounded hover:bg-slate-800 text-xs flex justify-between"
            >
              <span className="font-mono text-amber-400">{it.ticket_code}</span>
              <span className="text-slate-300">{it.status}</span>
              <span className="font-mono text-slate-400">€{Number(it.stake).toFixed(0)}</span>
              <span className="text-slate-500">{new Date(it.printed_at).toLocaleDateString("it-IT")}</span>
            </button>
          ))}
          {!loading && items.length === 0 && q && <div className="text-slate-500 text-sm text-center py-6">Nessun risultato</div>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add app/admin/agent-tickets/components/shift-sidebar.tsx app/admin/agent-tickets/components/recent-paid-list.tsx app/admin/agent-tickets/components/search-drawer.tsx
git commit -m "feat(agent-tickets): ShiftSidebar + RecentPaidList + SearchDrawer"
```

---

## Task 11: Riscrittura page.tsx (orchestrator + keyboard + layout)

**Files:**
- Modify: `app/admin/agent-tickets/page.tsx` (riscrittura completa)

- [ ] **Step 1: Riscrivi page.tsx**

```tsx
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { TicketScanInput, ScanInputHandle } from "./components/ticket-scan-input";
import { TicketCard } from "./components/ticket-card";
import { PayModal } from "./components/pay-modal";
import { ReceiptTemplate } from "./components/receipt-template";
import { ShiftSidebar } from "./components/shift-sidebar";
import { SearchDrawer } from "./components/search-drawer";
import { isValidTicketCode, normalizeTicketCode } from "./lib/ticket-code";
import { isPayable } from "./lib/status-map";

export default function AgentTicketsPage() {
  const [code, setCode] = useState("");
  const [ticket, setTicket] = useState<any>(null);
  const [selections, setSelections] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [receiptData, setReceiptData] = useState<any>(null);
  const [session, setSession] = useState<{ adminUserId: string; role: string; email: string } | null>(null);
  const [submittingAt, setSubmittingAt] = useState<number>(0);

  const inputRef = useRef<ScanInputHandle>(null);
  const refocus = () => setTimeout(() => inputRef.current?.focus(), 0);

  // Carica session una volta (per role super_admin e nome cassiere in receipt)
  useEffect(() => {
    fetch("/api/auth/session").then(r => r.ok ? r.json() : null).then((s) => {
      if (s?.adminUserId) setSession(s);
    }).catch(() => {});
  }, []);

  const handleVerify = useCallback(async () => {
    if (!code.trim()) return;
    if (!isValidTicketCode(code.trim())) {
      setError("Formato codice non valido (TK-XXXXXX)");
      return;
    }
    // Debounce doppio submit (scanner che emette due enter)
    if (Date.now() - submittingAt < 300) return;
    setSubmittingAt(Date.now());

    setLoading(true); setError(""); setTicket(null);
    try {
      const res = await fetch(`/api/tickets?code=${encodeURIComponent(code.trim())}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setTicket(data.ticket);
      setSelections(data.selections || []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); refocus(); }
  }, [code, submittingAt]);

  const handlePayConfirm = useCallback(async () => {
    if (!ticket) return;
    setLoading(true);
    try {
      const res = await fetch("/api/tickets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_code: ticket.ticket_code }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }

      // Build receipt data
      setReceiptData({
        ticket_code: ticket.ticket_code,
        bet_type: ticket.bet_type,
        stake: ticket.stake,
        total_odds: ticket.total_odds,
        amount_paid: data.amount_paid,
        selections: selections.map((s) => ({
          label: `${s.events?.home_team ?? ""} vs ${s.events?.away_team ?? ""}`,
          odds: s.odds_at_placement,
        })),
        cashier_name: session?.email?.split("@")[0] ?? "operatore",
        cashier_id: session?.adminUserId ?? "",
        timestamp: new Date().toLocaleString("it-IT"),
        is_reprint: false,
      });

      setPayOpen(false);
      // Aspetta render template, poi stampa
      setTimeout(() => {
        window.print();
        setRefreshKey(k => k + 1);
        handleVerify(); // ricarica ticket (ora claimed)
      }, 100);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); refocus(); }
  }, [ticket, selections, session, handleVerify]);

  const handleReprint = useCallback(async (tcode: string) => {
    const res = await fetch(`/api/tickets?code=${encodeURIComponent(tcode)}`);
    const data = await res.json();
    if (!res.ok) { setError(data.error); return; }
    // Log reprint server-side
    await fetch("/api/tickets/reprint", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket_code: tcode }),
    });
    const t = data.ticket;
    setReceiptData({
      ticket_code: t.ticket_code,
      bet_type: t.bet_type,
      stake: t.stake,
      total_odds: t.total_odds,
      amount_paid: t.win_amount ?? t.stake,
      selections: (data.selections ?? []).map((s: any) => ({
        label: `${s.events?.home_team ?? ""} vs ${s.events?.away_team ?? ""}`,
        odds: s.odds_at_placement,
      })),
      cashier_name: session?.email?.split("@")[0] ?? "operatore",
      cashier_id: session?.adminUserId ?? "",
      timestamp: new Date().toLocaleString("it-IT"),
      is_reprint: true,
    });
    setTimeout(() => window.print(), 100);
  }, [session]);

  const handleUnlockExpired = useCallback(async () => {
    if (!ticket) return;
    const res = await fetch("/api/tickets/unlock-expired", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket_code: ticket.ticket_code }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); return; }
    handleVerify();
  }, [ticket, handleVerify]);

  const handleReset = useCallback(() => {
    setCode(""); setTicket(null); setError(""); setSelections([]);
    refocus();
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); setSidebarOpen(o => !o); }
      if (e.key === "F3") { e.preventDefault(); setSearchOpen(true); }
      if (e.key === " " && ticket && isPayable(ticket.status) && !payOpen) {
        if (document.activeElement?.tagName !== "INPUT") {
          e.preventDefault();
          setPayOpen(true);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [ticket, payOpen]);

  const amount = ticket ? (ticket.status === "void" ? ticket.stake : (ticket.win_amount ?? ticket.potential_win ?? 0)) : 0;

  return (
    <>
      <div className="flex gap-4 print:hidden">
        <div className="flex-1 space-y-4 max-w-4xl">
          <h2 className="text-xl font-bold text-slate-200 m-0">Verifica & Incasso Ticket</h2>

          <TicketScanInput
            ref={inputRef}
            value={code}
            onChange={setCode}
            onSubmit={handleVerify}
            onReset={handleReset}
            loading={loading}
          />

          {error && (
            <div className="p-3 rounded bg-red-500/20 text-red-400 text-sm">{error}</div>
          )}

          {ticket && (
            <TicketCard
              ticket={ticket}
              selections={selections}
              onPay={() => setPayOpen(true)}
              onReprint={() => handleReprint(ticket.ticket_code)}
              onUnlockExpired={handleUnlockExpired}
              canUnlock={session?.role === "super_admin"}
            />
          )}

          <div className="text-xs text-slate-500">
            ENTER verifica · ESC reset · SPACE paga · F2 sidebar · F3 ricerca
          </div>
        </div>

        <ShiftSidebar
          open={sidebarOpen}
          onToggle={() => setSidebarOpen(o => !o)}
          onOpenSearch={() => setSearchOpen(true)}
          onSelect={(c) => { setCode(c); setTimeout(handleVerify, 0); }}
          onReprint={handleReprint}
          refreshKey={refreshKey}
        />
      </div>

      <PayModal
        open={payOpen}
        amount={amount}
        ticketCode={ticket?.ticket_code ?? ""}
        loading={loading}
        onConfirm={handlePayConfirm}
        onCancel={() => { setPayOpen(false); refocus(); }}
      />

      <SearchDrawer
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(c) => { setCode(c); setTimeout(handleVerify, 0); }}
      />

      <ReceiptTemplate data={receiptData} />
    </>
  );
}
```

- [ ] **Step 2: Crea endpoint helper /api/auth/session (se non esiste)**

Check:
```bash
ls app/api/auth/session 2>/dev/null
```

Se non esiste, crea `app/api/auth/session/route.ts`:
```ts
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth/admin-session";

export async function GET() {
  const s = await getAdminSession();
  if (!s) return NextResponse.json({}, { status: 401 });
  return NextResponse.json({ adminUserId: s.adminUserId, role: s.role, email: s.email });
}
```

- [ ] **Step 3: Build check**

Run: `npm run build 2>&1 | tail -40`
Expected: build OK senza errori TS.

- [ ] **Step 4: Commit**

```bash
git add app/admin/agent-tickets/page.tsx app/api/auth/session 2>/dev/null || git add app/admin/agent-tickets/page.tsx
git commit -m "feat(agent-tickets): page.tsx orchestrator con keyboard shortcuts + stampa"
```

---

## Task 12: Manual QA su staging + fix bug emersi

**Files:**
- nessuno nuovo (test manuali)

- [ ] **Step 1: Deploy staging**

Segui il flusso deploy admin documentato in `MEMORY.md`:
```bash
cd betssolution-admin && npx next build && tar czf /tmp/next-build.tar.gz .next && tar czf /tmp/x.tar.gz --exclude=node_modules --exclude=.next --exclude=.git . && scp /tmp/next-build.tar.gz /tmp/x.tar.gz scraper-vps:/tmp/ && ssh scraper-vps "systemctl stop betssolution-admin && cd /root/betssolution-admin && cp .env.local /tmp/admin-env-backup && rm -rf .next && tar xzf /tmp/x.tar.gz && cp /tmp/admin-env-backup .env.local && tar xzf /tmp/next-build.tar.gz && systemctl start betssolution-admin"
```

- [ ] **Step 2: Test manuale flow completo**

Apri `/admin/agent-tickets` e verifica:
- [ ] Input autofocus all'apertura
- [ ] Scansiona codice ticket esistente → appare card con stato corretto
- [ ] ENTER dopo input → verifica; ESC → reset
- [ ] Per ticket won: SPACE apre modale, ENTER conferma, print dialog appare con template 80mm
- [ ] Dopo claim: ticket ricaricato in stato `claimed`, ricevuta stampata, sidebar KPI aggiornata (+1 pagati)
- [ ] Race: stesso codice su due browser → secondo riceve "Già incassato"
- [ ] F2 toggle sidebar, F3 apre drawer ricerca
- [ ] Ristampa da lista ultimi → print dialog con badge COPIA
- [ ] Ticket non-admin loggato (logout) → 401 su tutte le API

- [ ] **Step 3: Stampa test su termica reale (se disponibile)**

Imposta stampante termica 80mm come default del browser. Esegui "Paga" su ticket test. Verifica:
- Font monospace leggibile
- Righe non tagliate a 80mm
- Nessun logo/immagine stampato male

Se la termica non è disponibile, salva PDF virtuale 80mm e allega screenshot al commit.

- [ ] **Step 4: Fix bug emersi**

Per ogni issue trovato, piccolo commit dedicato con messaggio `fix(agent-tickets): ...`.

- [ ] **Step 5: Merge in main + deploy prod**

Dopo validazione staging → ripeti step 1 su prod.

---

## Done

A fine piano:
- Migration 033 applicata (prod)
- API session-based, claim atomico race-safe, audit_log scrive
- Pagina redesign con componenti isolati, stampa termica, sidebar KPI, ricerca
- Test unitari per logica pura e mapping risposta RPC
- QA manuale superato
