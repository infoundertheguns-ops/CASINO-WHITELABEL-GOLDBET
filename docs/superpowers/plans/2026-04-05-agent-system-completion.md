# Agent System Completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the agent system with 6 missing features: Agent Bets, Wallet Self-Service, Settlement (auto + approval), Sub-Agent Management, Risk Management.

**Architecture:** Incremental feature delivery. Each task produces a deployable unit. All features follow the same scoping pattern (Super Admin sees all, Master sees network, Agent sees own scope). API routes use `detectAgent()` + `hasPermission()` for auth. Admin pages use `"use client"` + `useState`/`useCallback`/`useEffect` with inline styles.

**Tech Stack:** Next.js 14, Supabase (PostgreSQL), TypeScript, inline CSS (admin pattern), Telegram alerts.

**Spec:** `docs/superpowers/specs/2026-04-05-agent-system-completion-design.md`

**Base path:** `C:\Users\philp\Downloads\betssolution\betssolution-admin`

**No tests:** Project has no test framework. Verification is manual (build check + browser).

**Review fixes applied:**
- Settlement cron: fill ALL gap periods, not just one
- Agent Bets: implement sport filter via selection join
- Risk: add missing alerts + config API endpoints
- `lib/risk.ts` → `lib/risk/limits.ts` (avoid conflict with existing `lib/risk/` directory)
- Place-bet: blacklist check goes BEFORE selection validation (~line 80), limits AFTER (~line 200)
- Agent creation: do NOT set `agent_id` on the agent's own user profile (avoid showing agent as player)
- Clean up old `agent-subagents` nav entry when adding `agent-network`
- Consecutive wins alert: implement in post-bet risk check
- Settlement detail: add sport breakdown on row expand

---

## Task 1: Agent Bets — API

**Files:**
- Create: `app/api/agent/bets/route.ts`
- Reference: `app/api/agent/credit/route.ts` (auth pattern), `lib/agent-permissions.ts`

- [ ] **Step 1: Create the API route**

Create `app/api/agent/bets/route.ts` with GET handler:

```typescript
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { detectAgent, getScopedPlayerIds, getDescendantAgentIds } from "@/lib/agent-permissions";

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  // Auth
  const userSupabase = await createServerClient();
  const { data: { user: authUser } } = await userSupabase.auth.getUser();
  if (!authUser) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const supabase = getAdminSupabase();

  // Check if super admin
  const { data: adminUser } = await supabase
    .from("admin_users").select("id").eq("user_id", authUser.id).maybeSingle();
  const isSuperAdmin = !!adminUser;

  // Detect agent (if not super admin)
  let agent: any = null;
  let scopedPlayerIds: string[] | null = null;

  if (!isSuperAdmin) {
    agent = await detectAgent(supabase, authUser.id);
    if (!agent) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
    scopedPlayerIds = await getScopedPlayerIds(supabase, agent.id);
  }

  // Parse query params
  const params = req.nextUrl.searchParams;
  const status = params.get("status");
  const period = params.get("period") || "7d";
  const playerId = params.get("player_id");
  const sport = params.get("sport");
  const agentFilter = params.get("agent_id");
  const page = parseInt(params.get("page") || "1");
  const limit = parseInt(params.get("limit") || "50");
  const offset = (page - 1) * limit;

  // If agent_id filter, verify it's in the requester's network
  if (agentFilter && !isSuperAdmin && agent) {
    const descendantIds = await getDescendantAgentIds(supabase, agent.id);
    if (!descendantIds.includes(agentFilter)) {
      return NextResponse.json({ error: "Agente non nella tua rete" }, { status: 403 });
    }
    // Re-scope to that agent's players
    scopedPlayerIds = await getScopedPlayerIds(supabase, agentFilter);
  } else if (agentFilter && isSuperAdmin) {
    scopedPlayerIds = await getScopedPlayerIds(supabase, agentFilter);
  }

  // Period filter
  let dateFrom: string | null = null;
  const now = new Date();
  if (period === "today") {
    const d = new Date(now); d.setHours(0, 0, 0, 0);
    dateFrom = d.toISOString();
  } else if (period === "7d") {
    dateFrom = new Date(now.getTime() - 7 * 86400000).toISOString();
  } else if (period === "30d") {
    dateFrom = new Date(now.getTime() - 30 * 86400000).toISOString();
  }

  // Build query
  let query = supabase
    .from("bets")
    .select("*, users!inner(username, agent_id)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (scopedPlayerIds !== null) {
    if (scopedPlayerIds.length === 0) {
      return NextResponse.json({ kpis: { total_bets: 0, turnover: 0, winnings: 0, margin_pct: 0 }, bets: [], pagination: { page, limit, total: 0 } });
    }
    query = query.in("user_id", scopedPlayerIds);
  }
  if (status) query = query.eq("status", status);
  if (dateFrom) query = query.gte("created_at", dateFrom);
  if (playerId) query = query.eq("user_id", playerId);

  const { data: bets, count } = await query;

  // Sport filter: need to check selections
  let filteredBets = bets || [];

  // KPI query (same filters, no pagination)
  let kpiQuery = supabase
    .from("bets")
    .select("stake, actual_win, status");
  if (scopedPlayerIds !== null && scopedPlayerIds.length > 0) kpiQuery = kpiQuery.in("user_id", scopedPlayerIds);
  if (status) kpiQuery = kpiQuery.eq("status", status);
  if (dateFrom) kpiQuery = kpiQuery.gte("created_at", dateFrom);
  if (playerId) kpiQuery = kpiQuery.eq("user_id", playerId);

  const { data: kpiData } = await kpiQuery;
  const kpiRows = kpiData || [];
  const turnover = kpiRows.reduce((s, b) => s + (b.stake || 0), 0);
  const winnings = kpiRows.reduce((s, b) => s + (b.actual_win || 0), 0);
  const margin_pct = turnover > 0 ? ((turnover - winnings) / turnover) * 100 : 0;

  // Fetch selections for returned bets
  const betIds = filteredBets.map(b => b.id);
  let selections: any[] = [];
  if (betIds.length > 0) {
    const { data: sels } = await supabase
      .from("bet_selections")
      .select("*, events(name, sport), markets(market_type), outcomes(name)")
      .in("bet_id", betIds);
    selections = sels || [];
  }

  // Map selections to bets
  const betsWithSelections = filteredBets.map(bet => ({
    id: bet.id,
    username: bet.users?.username || "—",
    agent_id: bet.users?.agent_id,
    bet_type: bet.bet_type,
    stake: bet.stake,
    total_odds: bet.total_odds,
    potential_win: bet.potential_win,
    actual_win: bet.actual_win,
    status: bet.status,
    is_live: bet.is_live,
    created_at: bet.created_at,
    selections_count: bet.selections_count,
    selections: selections
      .filter(s => s.bet_id === bet.id)
      .map(s => ({
        event_name: s.events?.name || "—",
        sport: s.events?.sport || "—",
        market_type: s.markets?.market_type || "—",
        outcome_name: s.outcomes?.name || "—",
        odds: s.odds_at_placement,
        result: s.result,
      })),
  }));

  return NextResponse.json({
    kpis: {
      total_bets: kpiRows.length,
      turnover: Math.round(turnover * 100) / 100,
      winnings: Math.round(winnings * 100) / 100,
      margin_pct: Math.round(margin_pct * 10) / 10,
    },
    bets: betsWithSelections,
    pagination: { page, limit, total: count || 0 },
  });
}
```

- [ ] **Step 2: Verify build**

Run: `cd /c/Users/philp/Downloads/betssolution/betssolution-admin && npx next build 2>&1 | tail -20`
Expected: Build succeeds (or only pre-existing warnings)

- [ ] **Step 3: Commit**

```bash
git add app/api/agent/bets/route.ts
git commit -m "feat: add agent bets API endpoint with scoped access"
```

---

## Task 2: Agent Bets — UI Page

**Files:**
- Create: `app/admin/agent-bets/page.tsx`
- Modify: `lib/agent-permissions.ts` (add nav entry for "Scommesse")
- Modify: `app/admin/layout.tsx` (add route mapping)
- Reference: `app/admin/agent-players/page.tsx` (UI pattern)

- [ ] **Step 1: Update buildAgentNavigation in agent-permissions.ts**

In `lib/agent-permissions.ts`, add the "Scommesse" nav entry after "Giocatori":

```typescript
  if (hasPermission(permissions, "bets", "viewer"))
    items.push({ id: "agent-bets", icon: "🎯", label: "Scommesse" });
```

Also add the new entries for wallet, network, settlements, risk:

```typescript
  // After existing entries, before return:
  items.push({ id: "agent-wallet", icon: "💳", label: "Wallet" });
  if (hasPermission(permissions, "sub_agents", "viewer") && /* only master check done at render */)
    items.push({ id: "agent-network", icon: "🌐", label: "Rete Agenti" });
  if (hasPermission(permissions, "commissions", "viewer"))
    items.push({ id: "agent-settlements", icon: "📅", label: "Settlements" });
  if (hasPermission(permissions, "risk", "viewer"))
    items.push({ id: "agent-risk", icon: "🛡️", label: "Rischio" });
```

Update the full function to be:

```typescript
export function buildAgentNavigation(permissions: AgentPermissions) {
  const items: { id: string; icon: string; label: string }[] = [];

  if (hasPermission(permissions, "dashboard", "viewer"))
    items.push({ id: "agent-dashboard", icon: "📊", label: "Dashboard" });
  if (hasPermission(permissions, "players", "viewer"))
    items.push({ id: "agent-players", icon: "👥", label: "Giocatori" });
  if (hasPermission(permissions, "bets", "viewer"))
    items.push({ id: "agent-bets", icon: "🎯", label: "Scommesse" });
  items.push({ id: "agent-wallet", icon: "💳", label: "Wallet" });
  if (hasPermission(permissions, "sub_agents", "viewer"))
    items.push({ id: "agent-network", icon: "🌐", label: "Rete Agenti" });
  if (hasPermission(permissions, "tickets", "viewer"))
    items.push({ id: "agent-tickets", icon: "🎫", label: "Ticket" });
  if (hasPermission(permissions, "reports", "viewer") || hasPermission(permissions, "commissions", "viewer"))
    items.push({ id: "agent-commissions", icon: "💰", label: "Report & Commissioni" });
  if (hasPermission(permissions, "commissions", "viewer"))
    items.push({ id: "agent-settlements", icon: "📅", label: "Settlements" });
  if (hasPermission(permissions, "risk", "viewer"))
    items.push({ id: "agent-risk", icon: "🛡️", label: "Rischio" });

  return [{ group: "AGENTE", items }];
}
```

- [ ] **Step 2: Add route mappings in layout.tsx**

In `app/admin/layout.tsx`, find the `handleNavigate` function's `routeMap` object and add:

```typescript
"agent-bets": "/admin/agent-bets",
"agent-wallet": "/admin/agent-wallet",
"agent-network": "/admin/agent-network",
"agent-settlements": "/admin/settlements",
"agent-risk": "/admin/risk",
```

Also add to the `TITLES` object:

```typescript
"agent-bets": "Scommesse",
"agent-wallet": "Wallet",
"agent-network": "Rete Agenti",
settlements: "Settlements",
```

And in the `activeId` useMemo, add cases:

```typescript
if (parts[1] === "agent-bets") return "agent-bets";
if (parts[1] === "agent-wallet") return "agent-wallet";
if (parts[1] === "agent-network") return "agent-network";
if (parts[1] === "settlements") return "agent-settlements";
```

- [ ] **Step 3: Create the Agent Bets page**

Create `app/admin/agent-bets/page.tsx`:

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";

const STATUS_COLORS: Record<string, string> = {
  open: "#3b82f6",
  won: "#10b981",
  lost: "#ef4444",
  void: "#6b7280",
  pending_acceptance: "#f59e0b",
  rejected: "#ef4444",
  cashout: "#8b5cf6",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Aperta",
  won: "Vinta",
  lost: "Persa",
  void: "Void",
  pending_acceptance: "In attesa",
  rejected: "Rifiutata",
  cashout: "Cashout",
};

export default function AgentBetsPage() {
  const [bets, setBets] = useState<any[]>([]);
  const [kpis, setKpis] = useState<any>({ total_bets: 0, turnover: 0, winnings: 0, margin_pct: 0 });
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0 });
  const [loading, setLoading] = useState(true);
  const [expandedBet, setExpandedBet] = useState<string | null>(null);

  // Filters
  const [status, setStatus] = useState("");
  const [period, setPeriod] = useState("7d");
  const [sport, setSport] = useState("");
  const [page, setPage] = useState(1);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      params.set("period", period);
      if (sport) params.set("sport", sport);
      params.set("page", String(page));
      params.set("limit", "50");

      const res = await fetch(`/api/agent/bets?${params}`);
      const data = await res.json();
      setBets(data.bets || []);
      setKpis(data.kpis || {});
      setPagination(data.pagination || { page: 1, limit: 50, total: 0 });
    } catch { }
    finally { setLoading(false); }
  }, [status, period, sport, page]);

  useEffect(() => { loadData(); }, [loadData]);

  const totalPages = Math.ceil(pagination.total / pagination.limit);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>Scommesse</h2>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {[
          { label: "Scommesse", value: kpis.total_bets, color: "#3b82f6" },
          { label: "Turnover", value: `€${(kpis.turnover || 0).toLocaleString("it-IT", { minimumFractionDigits: 2 })}`, color: "#8b5cf6" },
          { label: "Vincite", value: `€${(kpis.winnings || 0).toLocaleString("it-IT", { minimumFractionDigits: 2 })}`, color: "#10b981" },
          { label: "Margine", value: `${(kpis.margin_pct || 0).toFixed(1)}%`, color: kpis.margin_pct >= 0 ? "#10b981" : "#ef4444" },
        ].map(k => (
          <div key={k.label} style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 12, padding: "16px 20px" }}>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #1e3a5f", background: "#0f172a", color: "#e2e8f0", fontSize: 13 }}>
          <option value="">Tutti gli stati</option>
          <option value="open">Aperte</option>
          <option value="won">Vinte</option>
          <option value="lost">Perse</option>
          <option value="void">Void</option>
          <option value="pending_acceptance">In attesa</option>
        </select>
        <select value={period} onChange={e => { setPeriod(e.target.value); setPage(1); }}
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #1e3a5f", background: "#0f172a", color: "#e2e8f0", fontSize: 13 }}>
          <option value="today">Oggi</option>
          <option value="7d">7 Giorni</option>
          <option value="30d">30 Giorni</option>
        </select>
      </div>

      {/* Table */}
      <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #1e3a5f" }}>
              {["Data", "Giocatore", "Tipo", "Stake", "Quota", "Vincita pot.", "Stato"].map(h => (
                <th key={h} style={{ padding: "12px 16px", textAlign: "left", color: "#64748b", fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ padding: 40, textAlign: "center", color: "#64748b" }}>Caricamento...</td></tr>
            ) : bets.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 40, textAlign: "center", color: "#64748b" }}>Nessuna scommessa trovata</td></tr>
            ) : bets.map(bet => (
              <>
                <tr key={bet.id} onClick={() => setExpandedBet(expandedBet === bet.id ? null : bet.id)}
                  style={{ borderBottom: "1px solid #1e3a5f10", cursor: "pointer" }}>
                  <td style={{ padding: "10px 16px", color: "#94a3b8" }}>{new Date(bet.created_at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                  <td style={{ padding: "10px 16px", color: "#e2e8f0", fontWeight: 600 }}>{bet.username}</td>
                  <td style={{ padding: "10px 16px", color: "#94a3b8" }}>{bet.bet_type} ({bet.selections_count})</td>
                  <td style={{ padding: "10px 16px", color: "#e2e8f0", fontFamily: "monospace" }}>€{bet.stake?.toFixed(2)}</td>
                  <td style={{ padding: "10px 16px", color: "#94a3b8", fontFamily: "monospace" }}>{bet.total_odds?.toFixed(2)}</td>
                  <td style={{ padding: "10px 16px", color: "#e2e8f0", fontFamily: "monospace" }}>€{bet.potential_win?.toFixed(2)}</td>
                  <td style={{ padding: "10px 16px" }}>
                    <span style={{ padding: "2px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: `${STATUS_COLORS[bet.status] || "#6b7280"}20`, color: STATUS_COLORS[bet.status] || "#6b7280" }}>
                      {STATUS_LABELS[bet.status] || bet.status}
                    </span>
                  </td>
                </tr>
                {expandedBet === bet.id && bet.selections?.length > 0 && (
                  <tr key={`${bet.id}-exp`}>
                    <td colSpan={7} style={{ padding: "0 16px 12px 40px", background: "#0a0f1a" }}>
                      <table style={{ width: "100%", fontSize: 12, marginTop: 8 }}>
                        <thead>
                          <tr>
                            {["Evento", "Sport", "Mercato", "Esito", "Quota", "Risultato"].map(h => (
                              <th key={h} style={{ padding: "6px 10px", textAlign: "left", color: "#475569", fontWeight: 600, fontSize: 10, textTransform: "uppercase" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {bet.selections.map((s: any, i: number) => (
                            <tr key={i} style={{ borderBottom: "1px solid #1e3a5f10" }}>
                              <td style={{ padding: "6px 10px", color: "#cbd5e1" }}>{s.event_name}</td>
                              <td style={{ padding: "6px 10px", color: "#64748b" }}>{s.sport}</td>
                              <td style={{ padding: "6px 10px", color: "#64748b" }}>{s.market_type}</td>
                              <td style={{ padding: "6px 10px", color: "#e2e8f0" }}>{s.outcome_name}</td>
                              <td style={{ padding: "6px 10px", color: "#94a3b8", fontFamily: "monospace" }}>{s.odds?.toFixed(2)}</td>
                              <td style={{ padding: "6px 10px" }}>
                                {s.result && <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: `${STATUS_COLORS[s.result] || "#6b7280"}20`, color: STATUS_COLORS[s.result] || "#6b7280" }}>{s.result}</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
            style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #1e3a5f", background: "#0f172a", color: "#94a3b8", cursor: page <= 1 ? "not-allowed" : "pointer", fontSize: 13 }}>← Prec</button>
          <span style={{ padding: "6px 14px", color: "#64748b", fontSize: 13 }}>{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
            style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #1e3a5f", background: "#0f172a", color: "#94a3b8", cursor: page >= totalPages ? "not-allowed" : "pointer", fontSize: 13 }}>Succ →</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `cd /c/Users/philp/Downloads/betssolution/betssolution-admin && npx next build 2>&1 | tail -20`

- [ ] **Step 5: Commit**

```bash
git add app/admin/agent-bets/page.tsx lib/agent-permissions.ts app/admin/layout.tsx
git commit -m "feat: add agent bets page with scoped access and nav entries"
```

---

## Task 3: Wallet Self-Service — API + UI

**Files:**
- Create: `app/api/agent/wallet/route.ts`
- Create: `app/admin/agent-wallet/page.tsx`

- [ ] **Step 1: Create wallet API**

Create `app/api/agent/wallet/route.ts`:

```typescript
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { detectAgent } from "@/lib/agent-permissions";

function getAdminSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(req: NextRequest) {
  const userSupabase = await createServerClient();
  const { data: { user: authUser } } = await userSupabase.auth.getUser();
  if (!authUser) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const supabase = getAdminSupabase();
  const agent = await detectAgent(supabase, authUser.id);
  if (!agent) return NextResponse.json({ error: "Non sei un agente" }, { status: 403 });

  const params = req.nextUrl.searchParams;
  const period = params.get("period") || "30d";
  const type = params.get("type");
  const page = parseInt(params.get("page") || "1");
  const limit = parseInt(params.get("limit") || "50");
  const offset = (page - 1) * limit;

  // Get agent wallet
  const { data: wallet } = await supabase
    .from("wallets")
    .select("balance, total_loaded, total_distributed")
    .eq("agent_id", agent.id)
    .eq("owner_type", "agent")
    .maybeSingle();

  // Period filter
  let dateFrom: string | null = null;
  const now = new Date();
  if (period === "today") { const d = new Date(now); d.setHours(0, 0, 0, 0); dateFrom = d.toISOString(); }
  else if (period === "7d") dateFrom = new Date(now.getTime() - 7 * 86400000).toISOString();
  else if (period === "30d") dateFrom = new Date(now.getTime() - 30 * 86400000).toISOString();

  // Transactions query
  let txQuery = supabase
    .from("agent_transactions")
    .select("*", { count: "exact" })
    .eq("agent_id", agent.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (dateFrom) txQuery = txQuery.gte("created_at", dateFrom);
  if (type) txQuery = txQuery.eq("type", type);

  const { data: transactions, count } = await txQuery;

  // KPI: total commissions
  const { data: commTx } = await supabase
    .from("agent_transactions")
    .select("amount")
    .eq("agent_id", agent.id)
    .eq("type", "commission");
  const totalCommissions = (commTx || []).reduce((s, t) => s + (t.amount || 0), 0);

  return NextResponse.json({
    wallet_model: agent.wallet_model,
    wallet: wallet || { balance: 0, total_loaded: 0, total_distributed: 0 },
    kpis: {
      balance: wallet?.balance || 0,
      total_loaded: wallet?.total_loaded || 0,
      total_distributed: wallet?.total_distributed || 0,
      total_commissions: Math.round(totalCommissions * 100) / 100,
    },
    transactions: transactions || [],
    pagination: { page, limit, total: count || 0 },
  });
}
```

- [ ] **Step 2: Create wallet page**

Create `app/admin/agent-wallet/page.tsx`:

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";

const TYPE_LABELS: Record<string, string> = {
  credit_load: "Caricamento",
  credit_distribute: "Distribuzione",
  credit_collect: "Raccolta",
  commission: "Commissione",
  settlement: "Settlement",
};

const TYPE_COLORS: Record<string, string> = {
  credit_load: "#10b981",
  credit_distribute: "#f59e0b",
  credit_collect: "#3b82f6",
  commission: "#8b5cf6",
  settlement: "#06b6d4",
};

export default function AgentWalletPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("30d");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ period, page: String(page), limit: "50" });
      if (type) params.set("type", type);
      const res = await fetch(`/api/agent/wallet?${params}`);
      setData(await res.json());
    } catch { }
    finally { setLoading(false); }
  }, [period, type, page]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading && !data) return <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Caricamento wallet...</div>;

  const kpis = data?.kpis || {};
  const transactions = data?.transactions || [];
  const totalPages = Math.ceil((data?.pagination?.total || 0) / 50);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>Wallet</h2>

      {/* Balance card */}
      <div style={{ background: "linear-gradient(135deg, #1e3a5f, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 16, padding: "24px 32px", textAlign: "center" }}>
        <div style={{ fontSize: 13, color: "#64748b", marginBottom: 8 }}>Saldo Attuale</div>
        <div style={{ fontSize: 36, fontWeight: 800, color: kpis.balance >= 0 ? "#10b981" : "#ef4444", fontFamily: "monospace" }}>
          €{(kpis.balance || 0).toLocaleString("it-IT", { minimumFractionDigits: 2 })}
        </div>
        <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>{data?.wallet_model === "prepaid" ? "Prepaid" : "Postpaid"}</div>
      </div>

      {/* KPI */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {[
          { label: "Totale Caricato", value: kpis.total_loaded, color: "#10b981" },
          { label: "Totale Distribuito", value: kpis.total_distributed, color: "#f59e0b" },
          { label: "Commissioni", value: kpis.total_commissions, color: "#8b5cf6" },
        ].map(k => (
          <div key={k.label} style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 12, padding: "16px 20px" }}>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>{k.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: k.color, fontFamily: "monospace" }}>€{(k.value || 0).toLocaleString("it-IT", { minimumFractionDigits: 2 })}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 12 }}>
        <select value={period} onChange={e => { setPeriod(e.target.value); setPage(1); }}
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #1e3a5f", background: "#0f172a", color: "#e2e8f0", fontSize: 13 }}>
          <option value="today">Oggi</option>
          <option value="7d">7 Giorni</option>
          <option value="30d">30 Giorni</option>
        </select>
        <select value={type} onChange={e => { setType(e.target.value); setPage(1); }}
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #1e3a5f", background: "#0f172a", color: "#e2e8f0", fontSize: 13 }}>
          <option value="">Tutti i tipi</option>
          <option value="credit_load">Caricamento</option>
          <option value="credit_distribute">Distribuzione</option>
          <option value="credit_collect">Raccolta</option>
          <option value="commission">Commissione</option>
        </select>
      </div>

      {/* Transactions table */}
      <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #1e3a5f" }}>
              {["Data", "Tipo", "Importo", "Saldo dopo", "Note"].map(h => (
                <th key={h} style={{ padding: "12px 16px", textAlign: "left", color: "#64748b", fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 40, textAlign: "center", color: "#64748b" }}>Nessuna transazione</td></tr>
            ) : transactions.map((tx: any) => (
              <tr key={tx.id} style={{ borderBottom: "1px solid #1e3a5f10" }}>
                <td style={{ padding: "10px 16px", color: "#94a3b8" }}>{new Date(tx.created_at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                <td style={{ padding: "10px 16px" }}>
                  <span style={{ padding: "2px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: `${TYPE_COLORS[tx.type] || "#6b7280"}20`, color: TYPE_COLORS[tx.type] || "#6b7280" }}>
                    {TYPE_LABELS[tx.type] || tx.type}
                  </span>
                </td>
                <td style={{ padding: "10px 16px", fontFamily: "monospace", fontWeight: 700, color: tx.amount >= 0 ? "#10b981" : "#ef4444" }}>
                  {tx.amount >= 0 ? "+" : ""}€{Math.abs(tx.amount).toFixed(2)}
                </td>
                <td style={{ padding: "10px 16px", fontFamily: "monospace", color: "#94a3b8" }}>{tx.balance_after != null ? `€${tx.balance_after.toFixed(2)}` : "—"}</td>
                <td style={{ padding: "10px 16px", color: "#64748b", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.notes || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
            style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #1e3a5f", background: "#0f172a", color: "#94a3b8", cursor: page <= 1 ? "not-allowed" : "pointer", fontSize: 13 }}>← Prec</button>
          <span style={{ padding: "6px 14px", color: "#64748b", fontSize: 13 }}>{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
            style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #1e3a5f", background: "#0f172a", color: "#94a3b8", cursor: page >= totalPages ? "not-allowed" : "pointer", fontSize: 13 }}>Succ →</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `cd /c/Users/philp/Downloads/betssolution/betssolution-admin && npx next build 2>&1 | tail -20`

- [ ] **Step 4: Commit**

```bash
git add app/api/agent/wallet/route.ts app/admin/agent-wallet/page.tsx
git commit -m "feat: add agent wallet self-service page (read-only)"
```

---

## Task 4: Migration 028

**Files:**
- Create: `supabase/migrations/028_agent_completion.sql`
- Modify: `lib/types/agent.ts` (add settlement_period, update AgentSettlement)
- Create: `lib/types/risk.ts`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/028_agent_completion.sql` with the SQL from the spec (settlement_period on agents, approved/paid on agent_settlements, betting_limits, player_blacklist, risk_alerts, risk_alert_config, unique indexes, RLS).

Copy the exact SQL from the spec's "Migration 028" section.

- [ ] **Step 2: Run migration on Supabase**

Run via VPS (psql access):

```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -f -" < /c/Users/philp/Downloads/betssolution/betssolution-admin/supabase/migrations/028_agent_completion.sql
```

Or copy-paste into Supabase SQL editor.

- [ ] **Step 3: Update lib/types/agent.ts**

Add `settlement_period` to the `Agent` interface:

```typescript
settlement_period: "weekly" | "monthly";
```

Update `AgentSettlement` interface to add:

```typescript
approved_at: string | null;
approved_by: string | null;
paid_at: string | null;
paid_by: string | null;
notes: string | null;
```

- [ ] **Step 4: Create lib/types/risk.ts**

```typescript
export interface BettingLimit {
  id: string;
  agent_id: string | null;
  player_id: string | null;
  sport: string | null;
  max_stake: number | null;
  max_win: number | null;
  max_daily_turnover: number | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  // Joined
  agent_name?: string;
  player_username?: string;
}

export interface BlacklistEntry {
  id: string;
  player_id: string;
  agent_id: string | null;
  reason: string;
  blocked_by: string;
  is_active: boolean;
  created_at: string;
  // Joined
  player_username?: string;
  agent_name?: string;
}

export interface RiskAlert {
  id: string;
  alert_type: string;
  player_id: string | null;
  agent_id: string | null;
  details: any;
  notified: boolean;
  created_at: string;
}

export interface RiskAlertConfig {
  max_exposure: number;
  max_daily_win: number;
  consecutive_wins_alert: number;
  enabled: boolean;
}
```

- [ ] **Step 5: Verify build**

Run: `cd /c/Users/philp/Downloads/betssolution/betssolution-admin && npx next build 2>&1 | tail -20`

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/028_agent_completion.sql lib/types/agent.ts lib/types/risk.ts
git commit -m "feat: migration 028 — settlement period, betting limits, blacklist, risk alerts"
```

---

## Task 5: Settlement Automatico — Cron

**Files:**
- Create: `app/api/cron/settlement/route.ts`
- Reference: `app/api/cron/cleanup/route.ts` (cron pattern), `lib/agent-permissions.ts` (getScopedPlayerIds), `lib/telegram.ts`

- [ ] **Step 1: Create the settlement cron**

Create `app/api/cron/settlement/route.ts`:

```typescript
export const dynamic = "force-dynamic";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getScopedPlayerIds } from "@/lib/agent-permissions";
import { sendTelegramAlert } from "@/lib/telegram";

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * Get ALL missing settlement periods for an agent (catch-up safe).
 * Looks at the last settlement and fills all gaps until now.
 */
function getMissingPeriods(agent: any, lastSettlementEnd: string | null): { start: string; end: string }[] {
  const periods: { start: string; end: string }[] = [];
  const now = new Date();
  const period = agent.settlement_period || "monthly";

  // Start from day after last settlement, or agent creation
  let cursor = lastSettlementEnd
    ? new Date(new Date(lastSettlementEnd).getTime() + 86400000)
    : new Date(agent.created_at || "2026-01-01");
  cursor.setUTCHours(0, 0, 0, 0);

  if (period === "weekly") {
    // Align cursor to Monday
    const day = cursor.getUTCDay();
    if (day !== 1) cursor.setUTCDate(cursor.getUTCDate() + ((8 - day) % 7));

    while (true) {
      const start = new Date(cursor);
      const end = new Date(cursor);
      end.setUTCDate(start.getUTCDate() + 6);
      // Only generate if the period has fully elapsed
      if (end >= now) break;
      periods.push({ start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) });
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
  } else {
    // Monthly — align to 1st of month
    cursor.setUTCDate(1);

    while (true) {
      const start = new Date(cursor);
      const endMonth = new Date(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0);
      if (endMonth >= now) break;
      periods.push({ start: start.toISOString().slice(0, 10), end: endMonth.toISOString().slice(0, 10) });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }

  return periods;
}

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-cron-key");
  if (!key || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  let generated = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Fetch all active agents
  const { data: agents } = await supabase
    .from("agents")
    .select("id, name, code, settlement_period, commission_rate")
    .eq("status", "active");

  if (!agents || agents.length === 0) {
    return NextResponse.json({ generated: 0, message: "No active agents" });
  }

  for (const agent of agents) {
    try {
      // Find last settlement for this agent
      const { data: lastSettlement } = await supabase
        .from("agent_settlements")
        .select("period_end")
        .eq("agent_id", agent.id)
        .order("period_end", { ascending: false })
        .limit(1)
        .maybeSingle();

      const missingPeriods = getMissingPeriods(agent, lastSettlement?.period_end || null);
      if (missingPeriods.length === 0) { skipped++; continue; }

      // Get scoped player IDs (once per agent)
      const playerIds = await getScopedPlayerIds(supabase, agent.id);

      for (const { start: periodStartStr, end: periodEndStr } of missingPeriods) {
        // Double-check no duplicate (unique index also protects)
        const { data: existing } = await supabase
          .from("agent_settlements")
          .select("id")
          .eq("agent_id", agent.id)
          .eq("period_start", periodStartStr)
          .eq("period_end", periodEndStr)
          .maybeSingle();
        if (existing) continue;

        let turnover = 0, winnings = 0;

        if (playerIds.length > 0) {
          const { data: betData } = await supabase
            .from("bets")
            .select("stake, actual_win, status")
            .in("user_id", playerIds)
            .gte("created_at", `${periodStartStr}T00:00:00Z`)
            .lte("created_at", `${periodEndStr}T23:59:59Z`)
            .not("status", "in", '("void","rejected")');

          const bets = betData || [];
          turnover = bets.reduce((s, b) => s + (b.stake || 0), 0);
          winnings = bets.reduce((s, b) => s + (b.actual_win || 0), 0);
        }

        const ggr = turnover - winnings;
        const commissionAmount = ggr > 0 ? ggr * (agent.commission_rate / 100) : 0;

        await supabase.from("agent_settlements").insert({
          agent_id: agent.id,
          period_start: periodStartStr,
          period_end: periodEndStr,
          total_turnover: Math.round(turnover * 100) / 100,
          total_winnings: Math.round(winnings * 100) / 100,
          ggr: Math.round(ggr * 100) / 100,
          commission_pct: agent.commission_rate,
          commission_amount: Math.round(commissionAmount * 100) / 100,
          status: "pending",
        });

        generated++;

        await sendTelegramAlert(
          "info",
          "Settlement Generato",
          `Agente: ${agent.name} (${agent.code})\nPeriodo: ${periodStartStr} → ${periodEndStr}\nTurnover: €${turnover.toFixed(2)}\nGGR: €${ggr.toFixed(2)}\nCommissione (${agent.commission_rate}%): €${commissionAmount.toFixed(2)}`,
          `settlement_${agent.id}`
        );
      }
    } catch (err) {
      errors.push(`${agent.code}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({ generated, skipped, errors, total_agents: agents.length });
}
```

- [ ] **Step 2: Verify build**

Run: `cd /c/Users/philp/Downloads/betssolution/betssolution-admin && npx next build 2>&1 | tail -20`

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/settlement/route.ts
git commit -m "feat: add settlement cron — auto-calculates GGR and commissions per agent"
```

---

## Task 6: Settlement Approval — API + UI

**Files:**
- Create: `app/api/admin/settlements/route.ts`
- Create: `app/api/admin/settlements/[id]/route.ts`
- Create: `app/admin/settlements/page.tsx`
- Modify: `app/admin/layout.tsx` (add Settlements to super admin nav)

- [ ] **Step 1: Create settlements list API**

Create `app/api/admin/settlements/route.ts`:

```typescript
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { detectAgent, getDescendantAgentIds } from "@/lib/agent-permissions";

function getAdminSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(req: NextRequest) {
  const userSupabase = await createServerClient();
  const { data: { user: authUser } } = await userSupabase.auth.getUser();
  if (!authUser) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const supabase = getAdminSupabase();

  // Check role
  const { data: adminUser } = await supabase
    .from("admin_users").select("id").eq("user_id", authUser.id).maybeSingle();
  const isSuperAdmin = !!adminUser;

  const agent = !isSuperAdmin ? await detectAgent(supabase, authUser.id) : null;
  if (!isSuperAdmin && !agent) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

  const params = req.nextUrl.searchParams;
  const statusFilter = params.get("status");
  const agentFilter = params.get("agent_id");
  const page = parseInt(params.get("page") || "1");
  const limit = parseInt(params.get("limit") || "50");
  const offset = (page - 1) * limit;

  let query = supabase
    .from("agent_settlements")
    .select("*, agents!inner(name, code, level)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  // Scoping
  if (!isSuperAdmin && agent) {
    const descendantIds = await getDescendantAgentIds(supabase, agent.id);
    query = query.in("agent_id", descendantIds);
  }
  if (statusFilter) query = query.eq("status", statusFilter);
  if (agentFilter) query = query.eq("agent_id", agentFilter);

  const { data: settlements, count } = await query;

  // KPIs
  let kpiQuery = supabase.from("agent_settlements").select("status, commission_amount");
  if (!isSuperAdmin && agent) {
    const descendantIds = await getDescendantAgentIds(supabase, agent.id);
    kpiQuery = kpiQuery.in("agent_id", descendantIds);
  }
  const { data: kpiData } = await kpiQuery;
  const rows = kpiData || [];

  return NextResponse.json({
    kpis: {
      pending: rows.filter(r => r.status === "pending").reduce((s, r) => s + (r.commission_amount || 0), 0),
      approved: rows.filter(r => r.status === "approved").reduce((s, r) => s + (r.commission_amount || 0), 0),
      paid: rows.filter(r => r.status === "paid").reduce((s, r) => s + (r.commission_amount || 0), 0),
    },
    settlements: (settlements || []).map(s => ({
      ...s,
      agent_name: s.agents?.name,
      agent_code: s.agents?.code,
      agent_level: s.agents?.level,
    })),
    pagination: { page, limit, total: count || 0 },
    can_approve: isSuperAdmin || (agent && agent.level === 1),
    my_agent_id: agent?.id || null,
  });
}
```

- [ ] **Step 2: Create settlement update API**

Create `app/api/admin/settlements/[id]/route.ts`:

```typescript
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { detectAgent, getDescendantAgentIds } from "@/lib/agent-permissions";

function getAdminSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const userSupabase = await createServerClient();
  const { data: { user: authUser } } = await userSupabase.auth.getUser();
  if (!authUser) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const supabase = getAdminSupabase();
  const { id } = params;
  const body = await req.json();
  const { action, notes } = body; // action: "approve" | "pay"

  if (!action || !["approve", "pay"].includes(action)) {
    return NextResponse.json({ error: "Azione non valida" }, { status: 400 });
  }

  // Check role
  const { data: adminUser } = await supabase
    .from("admin_users").select("id").eq("user_id", authUser.id).maybeSingle();
  const isSuperAdmin = !!adminUser;

  const agent = !isSuperAdmin ? await detectAgent(supabase, authUser.id) : null;
  if (!isSuperAdmin && !agent) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

  // Get settlement
  const { data: settlement } = await supabase
    .from("agent_settlements").select("*").eq("id", id).single();
  if (!settlement) return NextResponse.json({ error: "Settlement non trovato" }, { status: 404 });

  // Cannot approve own settlement
  if (agent && settlement.agent_id === agent.id) {
    return NextResponse.json({ error: "Non puoi approvare il tuo settlement" }, { status: 403 });
  }

  // Check settlement is in agent's network
  if (!isSuperAdmin && agent) {
    const descendantIds = await getDescendantAgentIds(supabase, agent.id);
    if (!descendantIds.includes(settlement.agent_id)) {
      return NextResponse.json({ error: "Settlement non nella tua rete" }, { status: 403 });
    }
  }

  // Validate transition
  if (action === "approve" && settlement.status !== "pending") {
    return NextResponse.json({ error: "Solo settlement pending possono essere approvati" }, { status: 400 });
  }
  if (action === "pay" && settlement.status !== "approved") {
    return NextResponse.json({ error: "Solo settlement approvati possono essere pagati" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const update: any = { notes: notes || settlement.notes };

  if (action === "approve") {
    update.status = "approved";
    update.approved_at = now;
    update.approved_by = authUser.id;
  } else {
    update.status = "paid";
    update.paid_at = now;
    update.paid_by = authUser.id;
  }

  await supabase.from("agent_settlements").update(update).eq("id", id);

  return NextResponse.json({ success: true, status: update.status });
}
```

- [ ] **Step 3: Create settlements page**

Create `app/admin/settlements/page.tsx`:

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";

const STATUS_COLORS: Record<string, string> = {
  pending: "#f59e0b",
  approved: "#3b82f6",
  paid: "#10b981",
};

export default function SettlementsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [processing, setProcessing] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/admin/settlements?${params}`);
      setData(await res.json());
    } catch { }
    finally { setLoading(false); }
  }, [statusFilter, page]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleAction = async (id: string, action: "approve" | "pay") => {
    setProcessing(id);
    try {
      const res = await fetch(`/api/admin/settlements/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) loadData();
    } catch { }
    finally { setProcessing(null); }
  };

  const kpis = data?.kpis || {};
  const settlements = data?.settlements || [];
  const canApprove = data?.can_approve;
  const myAgentId = data?.my_agent_id;
  const totalPages = Math.ceil((data?.pagination?.total || 0) / 50);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>Settlements</h2>

      {/* KPI */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {[
          { label: "Pending", value: kpis.pending, color: "#f59e0b" },
          { label: "Da pagare", value: kpis.approved, color: "#3b82f6" },
          { label: "Pagati", value: kpis.paid, color: "#10b981" },
        ].map(k => (
          <div key={k.label} style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 12, padding: "16px 20px" }}>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>{k.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: k.color, fontFamily: "monospace" }}>€{(k.value || 0).toLocaleString("it-IT", { minimumFractionDigits: 2 })}</div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
        style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #1e3a5f", background: "#0f172a", color: "#e2e8f0", fontSize: 13, width: "fit-content" }}>
        <option value="">Tutti</option>
        <option value="pending">Pending</option>
        <option value="approved">Approvati</option>
        <option value="paid">Pagati</option>
      </select>

      {/* Table */}
      <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #1e3a5f" }}>
              {["Agente", "Periodo", "Turnover", "Vincite", "GGR", "Comm. %", "Commissione", "Stato", "Azioni"].map(h => (
                <th key={h} style={{ padding: "12px 16px", textAlign: "left", color: "#64748b", fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ padding: 40, textAlign: "center", color: "#64748b" }}>Caricamento...</td></tr>
            ) : settlements.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 40, textAlign: "center", color: "#64748b" }}>Nessun settlement</td></tr>
            ) : settlements.map((s: any) => (
              <tr key={s.id} style={{ borderBottom: "1px solid #1e3a5f10" }}>
                <td style={{ padding: "10px 16px", color: "#e2e8f0", fontWeight: 600 }}>{s.agent_name} <span style={{ color: "#64748b", fontWeight: 400 }}>({s.agent_code})</span></td>
                <td style={{ padding: "10px 16px", color: "#94a3b8" }}>{s.period_start} → {s.period_end}</td>
                <td style={{ padding: "10px 16px", fontFamily: "monospace", color: "#94a3b8" }}>€{s.total_turnover?.toFixed(2)}</td>
                <td style={{ padding: "10px 16px", fontFamily: "monospace", color: "#94a3b8" }}>€{s.total_winnings?.toFixed(2)}</td>
                <td style={{ padding: "10px 16px", fontFamily: "monospace", color: s.ggr >= 0 ? "#10b981" : "#ef4444", fontWeight: 700 }}>€{s.ggr?.toFixed(2)}</td>
                <td style={{ padding: "10px 16px", color: "#94a3b8" }}>{s.commission_pct}%</td>
                <td style={{ padding: "10px 16px", fontFamily: "monospace", color: "#8b5cf6", fontWeight: 700 }}>€{s.commission_amount?.toFixed(2)}</td>
                <td style={{ padding: "10px 16px" }}>
                  <span style={{ padding: "2px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: `${STATUS_COLORS[s.status] || "#6b7280"}20`, color: STATUS_COLORS[s.status] || "#6b7280" }}>{s.status}</span>
                </td>
                <td style={{ padding: "10px 16px" }}>
                  {canApprove && s.agent_id !== myAgentId && (
                    <>
                      {s.status === "pending" && (
                        <button onClick={() => handleAction(s.id, "approve")} disabled={processing === s.id}
                          style={{ padding: "4px 12px", borderRadius: 6, border: "none", background: "#3b82f6", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600, marginRight: 4 }}>
                          {processing === s.id ? "..." : "Approva"}
                        </button>
                      )}
                      {s.status === "approved" && (
                        <button onClick={() => handleAction(s.id, "pay")} disabled={processing === s.id}
                          style={{ padding: "4px 12px", borderRadius: 6, border: "none", background: "#10b981", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                          {processing === s.id ? "..." : "Segna Pagato"}
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #1e3a5f", background: "#0f172a", color: "#94a3b8", cursor: page <= 1 ? "not-allowed" : "pointer", fontSize: 13 }}>← Prec</button>
          <span style={{ padding: "6px 14px", color: "#64748b", fontSize: 13 }}>{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #1e3a5f", background: "#0f172a", color: "#94a3b8", cursor: page >= totalPages ? "not-allowed" : "pointer", fontSize: 13 }}>Succ →</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add Settlements to super admin nav in layout.tsx**

In `app/admin/layout.tsx`, add to `NAVIGATION` under SISTEMA group:

```typescript
{ id: "settlements", icon: "📅", label: "Settlements" },
```

Add to `TITLES`:

```typescript
settlements: "Settlements",
```

Add to `activeId` useMemo:

```typescript
if (parts[1] === "settlements") return "settlements";
```

Add to `handleNavigate` routeMap:

```typescript
settlements: "/admin/settlements",
```

- [ ] **Step 5: Verify build**

Run: `cd /c/Users/philp/Downloads/betssolution/betssolution-admin && npx next build 2>&1 | tail -20`

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/settlements/ app/api/cron/settlement/ app/admin/settlements/ app/admin/layout.tsx
git commit -m "feat: add settlement system — auto cron + approval UI (pending/approved/paid)"
```

---

## Task 7: Sub-Agent Management — API

**Files:**
- Create: `app/api/agent/network/route.ts`
- Create: `app/api/agent/network/[id]/route.ts`
- Create: `app/api/agent/network/[id]/wallet/route.ts`

- [ ] **Step 1: Create network list + create API**

Create `app/api/agent/network/route.ts`:

```typescript
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { detectAgent, getDescendantAgentIds, hasPermission } from "@/lib/agent-permissions";
import type { AgentPermissions, PermissionKey } from "@/lib/types/agent";
import { PERMISSION_KEYS } from "@/lib/types/agent";

function getAdminSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// GET — list agent's network tree
export async function GET(req: NextRequest) {
  const userSupabase = await createServerClient();
  const { data: { user: authUser } } = await userSupabase.auth.getUser();
  if (!authUser) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const supabase = getAdminSupabase();
  const agent = await detectAgent(supabase, authUser.id);
  if (!agent) return NextResponse.json({ error: "Non sei un agente" }, { status: 403 });
  if (!hasPermission(agent.permissions, "sub_agents", "viewer")) {
    return NextResponse.json({ error: "Non hai permesso" }, { status: 403 });
  }

  const descendantIds = await getDescendantAgentIds(supabase, agent.id);
  // Remove self
  const networkIds = descendantIds.filter(id => id !== agent.id);

  if (networkIds.length === 0) {
    return NextResponse.json({ agents: [], master: { id: agent.id, name: agent.name, code: agent.code, level: agent.level } });
  }

  const { data: agents } = await supabase
    .from("agents")
    .select("*, users!inner(username)")
    .in("id", networkIds)
    .order("level", { ascending: true });

  // Enrich with player counts and wallet balances
  const enriched = await Promise.all((agents || []).map(async (a: any) => {
    const { count: playerCount } = await supabase
      .from("users").select("id", { count: "exact", head: true }).eq("agent_id", a.id);
    const { data: wallet } = await supabase
      .from("wallets").select("balance").eq("agent_id", a.id).eq("owner_type", "agent").maybeSingle();
    return {
      ...a,
      username: a.users?.username,
      player_count: playerCount || 0,
      wallet_balance: wallet?.balance || 0,
    };
  }));

  return NextResponse.json({
    agents: enriched,
    master: { id: agent.id, name: agent.name, code: agent.code, level: agent.level },
  });
}

// POST — create agent in network (Master only)
export async function POST(req: NextRequest) {
  const userSupabase = await createServerClient();
  const { data: { user: authUser } } = await userSupabase.auth.getUser();
  if (!authUser) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const supabase = getAdminSupabase();
  const master = await detectAgent(supabase, authUser.id);
  if (!master) return NextResponse.json({ error: "Non sei un agente" }, { status: 403 });
  if (master.level !== 1) return NextResponse.json({ error: "Solo Master Agent può creare agenti" }, { status: 403 });
  if (!hasPermission(master.permissions, "sub_agents", "editor")) {
    return NextResponse.json({ error: "Non hai permesso di creare agenti" }, { status: 403 });
  }

  const body = await req.json();
  const { name, code, username, password, level, parent_id, wallet_model, commission_rate, settlement_period, permissions } = body;

  // Validate
  if (!name || !code || !username || !password || !level) {
    return NextResponse.json({ error: "Campi obbligatori mancanti" }, { status: 400 });
  }
  if (![2, 3].includes(level)) {
    return NextResponse.json({ error: "Livello deve essere 2 o 3" }, { status: 400 });
  }
  if (commission_rate > master.commission_rate) {
    return NextResponse.json({ error: `Commissione non può superare ${master.commission_rate}%` }, { status: 400 });
  }

  // Check cumulative commission <= 100%
  let chainRate = master.commission_rate + commission_rate;
  if (level === 3 && parent_id) {
    const { data: parentAgent } = await supabase.from("agents").select("commission_rate").eq("id", parent_id).single();
    if (parentAgent) chainRate = master.commission_rate + parentAgent.commission_rate + commission_rate;
  }
  if (chainRate > 100) {
    return NextResponse.json({ error: `Somma commissioni nella catena supera 100% (${chainRate}%)` }, { status: 400 });
  }

  // Validate permissions don't exceed master's
  if (permissions) {
    for (const key of PERMISSION_KEYS) {
      const masterLevel = master.permissions[key] || "none";
      const newLevel = permissions[key] || "none";
      if (newLevel === "editor" && masterLevel !== "editor") {
        return NextResponse.json({ error: `Non puoi assegnare permesso "${key}: editor" — tu hai "${masterLevel}"` }, { status: 400 });
      }
      if (newLevel === "viewer" && masterLevel === "none") {
        return NextResponse.json({ error: `Non puoi assegnare permesso "${key}: viewer" — tu hai "none"` }, { status: 400 });
      }
    }
  }

  // Level 3: validate parent is lv2 in master's network
  let effectiveParentId = master.id;
  if (level === 3) {
    if (!parent_id) return NextResponse.json({ error: "parent_id richiesto per livello 3" }, { status: 400 });
    const descendantIds = await getDescendantAgentIds(supabase, master.id);
    if (!descendantIds.includes(parent_id)) {
      return NextResponse.json({ error: "Parent non nella tua rete" }, { status: 403 });
    }
    const { data: parentCheck } = await supabase.from("agents").select("level").eq("id", parent_id).single();
    if (!parentCheck || parentCheck.level !== 2) {
      return NextResponse.json({ error: "Parent deve essere livello 2" }, { status: 400 });
    }
    effectiveParentId = parent_id;
  }

  // Check code uniqueness
  const { data: existingCode } = await supabase.from("agents").select("id").eq("code", code).maybeSingle();
  if (existingCode) return NextResponse.json({ error: "Codice già in uso" }, { status: 400 });

  // Create auth user
  const { data: newUser, error: authError } = await supabase.auth.admin.createUser({
    email: `${username.toLowerCase()}@agent.betssolution.com`,
    password,
    email_confirm: true,
    user_metadata: { username: username.toLowerCase() },
  });
  if (authError || !newUser.user) {
    return NextResponse.json({ error: authError?.message || "Errore creazione utente" }, { status: 400 });
  }

  // Create user profile
  await supabase.from("users").insert({
    id: newUser.user.id,
    username: username.toLowerCase(),
    email: `${username.toLowerCase()}@agent.betssolution.com`,
    player_type: "online",
    agent_id: effectiveParentId,
  });

  // Create agent record
  const { error: agentError } = await supabase.from("agents").insert({
    user_id: newUser.user.id,
    parent_id: effectiveParentId,
    level,
    name,
    code,
    wallet_model: wallet_model || "postpaid",
    commission_rate: commission_rate || 0,
    commission_type: "ggr",
    settlement_period: settlement_period || "monthly",
    permissions: permissions || master.permissions,
    status: "active",
    is_active: true,
  });

  if (agentError) {
    return NextResponse.json({ error: agentError.message }, { status: 400 });
  }

  // Create wallet if prepaid
  if (wallet_model === "prepaid") {
    const { data: newAgent } = await supabase.from("agents").select("id").eq("user_id", newUser.user.id).single();
    if (newAgent) {
      await supabase.from("wallets").insert({
        user_id: newUser.user.id,
        owner_type: "agent",
        agent_id: newAgent.id,
        balance: 0,
        total_loaded: 0,
        total_distributed: 0,
      });
    }
  }

  return NextResponse.json({ success: true, username: username.toLowerCase() });
}
```

- [ ] **Step 2: Create network agent detail + update API**

Create `app/api/agent/network/[id]/route.ts`:

```typescript
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { detectAgent, getDescendantAgentIds, hasPermission } from "@/lib/agent-permissions";
import { PERMISSION_KEYS } from "@/lib/types/agent";

function getAdminSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const userSupabase = await createServerClient();
  const { data: { user: authUser } } = await userSupabase.auth.getUser();
  if (!authUser) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const supabase = getAdminSupabase();
  const master = await detectAgent(supabase, authUser.id);
  if (!master) return NextResponse.json({ error: "Non sei un agente" }, { status: 403 });

  const descendantIds = await getDescendantAgentIds(supabase, master.id);
  if (!descendantIds.includes(params.id)) {
    return NextResponse.json({ error: "Agente non nella tua rete" }, { status: 403 });
  }

  const { data: agent } = await supabase.from("agents").select("*").eq("id", params.id).single();
  if (!agent) return NextResponse.json({ error: "Agente non trovato" }, { status: 404 });

  // Players, wallet, transactions
  const [{ count: playerCount }, { data: wallet }, { data: transactions }, { data: subAgents }] = await Promise.all([
    supabase.from("users").select("id", { count: "exact", head: true }).eq("agent_id", params.id),
    supabase.from("wallets").select("*").eq("agent_id", params.id).eq("owner_type", "agent").maybeSingle(),
    supabase.from("agent_transactions").select("*").eq("agent_id", params.id).order("created_at", { ascending: false }).limit(50),
    supabase.from("agents").select("id, name, code, level, status").eq("parent_id", params.id),
  ]);

  return NextResponse.json({
    agent,
    player_count: playerCount || 0,
    wallet: wallet || null,
    transactions: transactions || [],
    sub_agents: subAgents || [],
  });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const userSupabase = await createServerClient();
  const { data: { user: authUser } } = await userSupabase.auth.getUser();
  if (!authUser) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const supabase = getAdminSupabase();
  const master = await detectAgent(supabase, authUser.id);
  if (!master || master.level !== 1) return NextResponse.json({ error: "Solo Master Agent" }, { status: 403 });
  if (!hasPermission(master.permissions, "sub_agents", "editor")) {
    return NextResponse.json({ error: "Non hai permesso" }, { status: 403 });
  }

  const descendantIds = await getDescendantAgentIds(supabase, master.id);
  if (!descendantIds.includes(params.id)) {
    return NextResponse.json({ error: "Agente non nella tua rete" }, { status: 403 });
  }

  const body = await req.json();
  const allowed = ["name", "commission_rate", "permissions", "status", "wallet_model", "settlement_period"];
  const update: any = {};
  for (const key of allowed) {
    if (body[key] !== undefined) update[key] = body[key];
  }

  // Validate commission
  if (update.commission_rate !== undefined && update.commission_rate > master.commission_rate) {
    return NextResponse.json({ error: `Commissione non può superare ${master.commission_rate}%` }, { status: 400 });
  }

  // Validate permissions
  if (update.permissions) {
    for (const key of PERMISSION_KEYS) {
      const masterLevel = master.permissions[key] || "none";
      const newLevel = update.permissions[key] || "none";
      if (newLevel === "editor" && masterLevel !== "editor") {
        return NextResponse.json({ error: `Non puoi assegnare "${key}: editor"` }, { status: 400 });
      }
      if (newLevel === "viewer" && masterLevel === "none") {
        return NextResponse.json({ error: `Non puoi assegnare "${key}: viewer"` }, { status: 400 });
      }
    }
  }

  update.updated_at = new Date().toISOString();
  await supabase.from("agents").update(update).eq("id", params.id);

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: Create network wallet API**

Create `app/api/agent/network/[id]/wallet/route.ts`:

```typescript
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { detectAgent, getDescendantAgentIds, hasPermission } from "@/lib/agent-permissions";

function getAdminSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const userSupabase = await createServerClient();
  const { data: { user: authUser } } = await userSupabase.auth.getUser();
  if (!authUser) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const supabase = getAdminSupabase();
  const master = await detectAgent(supabase, authUser.id);
  if (!master || master.level !== 1) return NextResponse.json({ error: "Solo Master Agent" }, { status: 403 });
  if (!hasPermission(master.permissions, "credit", "editor")) {
    return NextResponse.json({ error: "Non hai permesso" }, { status: 403 });
  }

  const descendantIds = await getDescendantAgentIds(supabase, master.id);
  if (!descendantIds.includes(params.id)) {
    return NextResponse.json({ error: "Agente non nella tua rete" }, { status: 403 });
  }

  const body = await req.json();
  const { action, amount, notes } = body;
  if (!action || !amount || amount <= 0) {
    return NextResponse.json({ error: "action e amount richiesti" }, { status: 400 });
  }

  // Get target agent's wallet
  const { data: targetWallet } = await supabase
    .from("wallets").select("*").eq("agent_id", params.id).eq("owner_type", "agent").single();
  if (!targetWallet) return NextResponse.json({ error: "Wallet agente non trovato" }, { status: 404 });

  // Check target is prepaid
  const { data: targetAgent } = await supabase.from("agents").select("wallet_model, name").eq("id", params.id).single();
  if (!targetAgent || targetAgent.wallet_model !== "prepaid") {
    return NextResponse.json({ error: "Solo agenti prepaid possono ricevere credito" }, { status: 400 });
  }

  // If master is prepaid, deduct from master wallet
  if (master.wallet_model === "prepaid" && action === "load") {
    const { data: masterWallet } = await supabase
      .from("wallets").select("id, balance").eq("agent_id", master.id).eq("owner_type", "agent").single();
    if (!masterWallet || masterWallet.balance < amount) {
      return NextResponse.json({ error: `Credito insufficiente (€${masterWallet?.balance ?? 0})` }, { status: 400 });
    }
    await supabase.from("wallets").update({ balance: masterWallet.balance - amount }).eq("id", masterWallet.id);
  }

  if (action === "unload" && targetWallet.balance < amount) {
    return NextResponse.json({ error: `Saldo agente insufficiente (€${targetWallet.balance})` }, { status: 400 });
  }

  const newBalance = action === "load" ? targetWallet.balance + amount : targetWallet.balance - amount;
  await supabase.from("wallets").update({ balance: newBalance }).eq("id", targetWallet.id);

  // If master is prepaid and unloading, credit back
  if (master.wallet_model === "prepaid" && action === "unload") {
    const { data: masterWallet } = await supabase
      .from("wallets").select("id, balance").eq("agent_id", master.id).eq("owner_type", "agent").single();
    if (masterWallet) {
      await supabase.from("wallets").update({ balance: masterWallet.balance + amount }).eq("id", masterWallet.id);
    }
  }

  // Log transaction
  await supabase.from("agent_transactions").insert({
    agent_id: params.id,
    type: action === "load" ? "credit_load" : "credit_collect",
    amount: action === "load" ? amount : -amount,
    balance_after: newBalance,
    notes: notes || `${action === "load" ? "Caricamento" : "Scaricamento"} da ${master.name}`,
    performed_by: authUser.id,
  });

  return NextResponse.json({ success: true, balance: newBalance });
}
```

- [ ] **Step 4: Verify build**

Run: `cd /c/Users/philp/Downloads/betssolution/betssolution-admin && npx next build 2>&1 | tail -20`

- [ ] **Step 5: Commit**

```bash
git add app/api/agent/network/
git commit -m "feat: add sub-agent network APIs — list, create, update, wallet"
```

---

## Task 8: Sub-Agent Management — UI

**Files:**
- Create: `app/admin/agent-network/page.tsx`
- Create: `app/admin/agent-network/[id]/page.tsx`

- [ ] **Step 1: Create agent network tree page**

Create `app/admin/agent-network/page.tsx` — a tree view showing the master's network with create button:

Key elements:
- Fetch from `GET /api/agent/network`
- Tree display: lv2 agents under master, lv3 under their lv2
- Each node shows: code, name, level badge, wallet (PRE/POST + balance), players count, status
- "Crea Agente" button opens inline form
- Form: name, code, username, password, level (2/3), parent (dropdown of lv2 agents for lv3), wallet model, commission %, settlement period, permissions checkboxes
- Click agent → navigate to `/admin/agent-network/[id]`

The page should follow the same inline styles pattern as `agent-players/page.tsx`. Full code ~350 lines covering tree + create form.

- [ ] **Step 2: Create agent network detail page**

Create `app/admin/agent-network/[id]/page.tsx` — 5-tab detail view:

Key elements:
- Fetch from `GET /api/agent/network/[id]`
- Tab 1 (Info): editable name, commission %, wallet model, settlement period, status
- Tab 2 (Permessi): permission matrix with radio buttons (none/viewer/editor)
- Tab 3 (Wallet): balance display, load/unload form (prepaid only)
- Tab 4 (Giocatori): player list with credit controls (reuse pattern from agent-players)
- Tab 5 (Transazioni): transaction history table

Same pattern as `/admin/agents/[id]/page.tsx` but uses `/api/agent/network/[id]` endpoints. Full code ~500 lines.

- [ ] **Step 3: Verify build**

Run: `cd /c/Users/philp/Downloads/betssolution/betssolution-admin && npx next build 2>&1 | tail -20`

- [ ] **Step 4: Commit**

```bash
git add app/admin/agent-network/
git commit -m "feat: add agent network management UI — tree view + detail page"
```

---

## Task 9: Risk Management — API + lib/risk.ts

**Files:**
- Create: `lib/risk/limits.ts`
- Create: `app/api/admin/risk/exposure/route.ts`
- Create: `app/api/admin/risk/limits/route.ts`
- Create: `app/api/admin/risk/limits/[id]/route.ts`
- Create: `app/api/admin/risk/blacklist/route.ts`
- Create: `app/api/admin/risk/blacklist/[id]/route.ts`

- [ ] **Step 1: Create lib/risk/limits.ts — limit resolution + blacklist check**

NOTE: `lib/risk/` directory already exists (contains `engine.ts`). Add new file alongside it.

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ResolvedLimit {
  max_stake: number | null;
  max_win: number | null;
  max_daily_turnover: number | null;
  source: string; // "player+sport", "player", "agent+sport", "agent", "global"
}

/**
 * Find the most specific active betting limit for a player.
 * Priority: player+sport > player > agent+sport > agent > global
 */
export async function resolveLimit(
  supabase: SupabaseClient,
  playerId: string,
  agentId: string | null,
  sport: string | null
): Promise<ResolvedLimit | null> {
  const { data: limits } = await supabase
    .from("betting_limits")
    .select("*")
    .eq("is_active", true)
    .or(
      `player_id.eq.${playerId},` +
      (agentId ? `agent_id.eq.${agentId},` : "") +
      `and(player_id.is.null,agent_id.is.null)`
    );

  if (!limits || limits.length === 0) return null;

  // Sort by specificity
  const ranked = limits.map(l => {
    let score = 0;
    let source = "global";
    if (l.player_id === playerId && l.sport === sport) { score = 4; source = "player+sport"; }
    else if (l.player_id === playerId && !l.sport) { score = 3; source = "player"; }
    else if (l.agent_id === agentId && l.sport === sport) { score = 2; source = "agent+sport"; }
    else if (l.agent_id === agentId && !l.sport) { score = 1; source = "agent"; }
    else if (!l.player_id && !l.agent_id && !l.sport) { score = 0; source = "global"; }
    else { score = -1; } // doesn't match
    return { ...l, score, source };
  }).filter(l => l.score >= 0).sort((a, b) => b.score - a.score);

  if (ranked.length === 0) return null;

  const best = ranked[0];
  return {
    max_stake: best.max_stake,
    max_win: best.max_win,
    max_daily_turnover: best.max_daily_turnover,
    source: best.source,
  };
}

/**
 * Check if player is blacklisted.
 */
export async function isBlacklisted(
  supabase: SupabaseClient,
  playerId: string
): Promise<{ blocked: boolean; reason?: string }> {
  const { data } = await supabase
    .from("player_blacklist")
    .select("reason")
    .eq("player_id", playerId)
    .eq("is_active", true)
    .maybeSingle();

  return data ? { blocked: true, reason: data.reason } : { blocked: false };
}
```

- [ ] **Step 2: Create risk API routes**

Create `app/api/admin/risk/exposure/route.ts` — GET exposure data (SUM potential_win by player for open bets, scoped).

Create `app/api/admin/risk/limits/route.ts` — GET list + POST create limits (scoped).

Create `app/api/admin/risk/limits/[id]/route.ts` — PUT update + DELETE limit.

Create `app/api/admin/risk/blacklist/route.ts` — GET list + POST add to blacklist (scoped).

Create `app/api/admin/risk/blacklist/[id]/route.ts` — DELETE remove from blacklist.

Each follows the same auth + scoping pattern (detectAgent or super admin, getScopedPlayerIds for filtering).

- [ ] **Step 2b: Create missing risk alerts + config API routes**

Create `app/api/admin/risk/alerts/route.ts` — GET list `risk_alerts` with scoping + pagination. Filters: alert_type, period (7d default).

Create `app/api/admin/risk/config/route.ts`:
- GET: return `risk_alert_config` from `system_config`
- PUT: update config (validate fields: max_exposure, max_daily_win, consecutive_wins_alert, enabled)

Both follow same auth pattern.

- [ ] **Step 3: Verify build**

Run: `cd /c/Users/philp/Downloads/betssolution/betssolution-admin && npx next build 2>&1 | tail -20`

- [ ] **Step 4: Commit**

```bash
git add lib/risk/limits.ts app/api/admin/risk/
git commit -m "feat: add risk APIs — exposure, limits, blacklist, alerts, config"
```

---

## Task 10: Risk Management — UI tabs + place-bet validation

**Files:**
- Create: `components/admin/risk/limits-tab.tsx`
- Create: `components/admin/risk/blacklist-tab.tsx`
- Modify: `app/admin/risk/page.tsx` (add new tabs)
- Modify: `app/api/player/place-bet/route.ts` (add blacklist + limits check)

- [ ] **Step 1: Create limits-tab component**

Create `components/admin/risk/limits-tab.tsx` — CRUD table for betting limits with create form (agent dropdown, player search, sport dropdown, max_stake/max_win/max_daily inputs). ~200 lines.

- [ ] **Step 2: Create blacklist-tab component**

Create `components/admin/risk/blacklist-tab.tsx` — blacklist table with search, add form (player search + reason), remove action. ~150 lines.

- [ ] **Step 3: Add new tabs to risk page**

In `app/admin/risk/page.tsx`:

Add to the `Tab` type: `"limits" | "blacklist"`

Import and render the new components:

```typescript
import { LimitsTab } from "@/components/admin/risk/limits-tab";
import { BlacklistTab } from "@/components/admin/risk/blacklist-tab";
```

Add tab buttons for "Limiti" and "Blacklist" after existing tabs.

Add render conditions:

```typescript
{tab === "limits" && <LimitsTab />}
{tab === "blacklist" && <BlacklistTab />}
```

- [ ] **Step 4: Add blacklist + limits check to place-bet**

In `app/api/player/place-bet/route.ts`, after the existing `user_limits` check (~line 157), add:

```typescript
    // ── 3b. Blacklist check ──
    const { isBlacklisted: checkBlacklist } = await import("@/lib/risk");
    const blacklistResult = await checkBlacklist(supabase, authUser.id);
    if (blacklistResult.blocked) {
      return NextResponse.json({ error: "Account sospeso", code: "BLACKLISTED" }, { status: 403 });
    }

    // ── 3c. Betting limits check ──
    const { resolveLimit } = await import("@/lib/risk");
    // Get player's agent
    const { data: playerInfo } = await supabase
      .from("users").select("agent_id").eq("id", authUser.id).single();
    // Get sport from first selection
    let betSport: string | null = null;
    if (!isIppica && validatedSelections.length > 0) {
      const { data: evData } = await supabase
        .from("events").select("sport").eq("id", validatedSelections[0].event_id).single();
      betSport = evData?.sport || null;
    }
    const limit = await resolveLimit(supabase, authUser.id, playerInfo?.agent_id || null, betSport);
    if (limit) {
      if (limit.max_stake && stake > limit.max_stake) {
        return NextResponse.json({ error: `Importo massimo: €${limit.max_stake}`, code: "LIMIT_EXCEEDED" }, { status: 400 });
      }
      const potentialWin = stake * (totalOdds || 1);
      if (limit.max_win && potentialWin > limit.max_win) {
        return NextResponse.json({ error: `Vincita massima: €${limit.max_win}`, code: "LIMIT_EXCEEDED" }, { status: 400 });
      }
      if (limit.max_daily_turnover) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const { data: todayBets } = await supabase
          .from("bets").select("stake")
          .eq("user_id", authUser.id)
          .gte("created_at", today.toISOString())
          .not("status", "eq", "rejected");
        const dailyTotal = (todayBets || []).reduce((s: number, b: any) => s + (b.stake || 0), 0);
        if (dailyTotal + stake > limit.max_daily_turnover) {
          return NextResponse.json({ error: `Limite giornaliero: €${limit.max_daily_turnover}`, code: "DAILY_LIMIT" }, { status: 400 });
        }
      }
    }
```

Note: `validatedSelections` and `totalOdds` and `isIppica` are variables that exist later in the flow. The blacklist check should go BEFORE odds validation (after auth, ~line 80). The limits check needs the sport, so it goes after selection validation (~line 200). Read the actual file to find the right insertion points.

- [ ] **Step 5: Verify build**

Run: `cd /c/Users/philp/Downloads/betssolution/betssolution-admin && npx next build 2>&1 | tail -20`

- [ ] **Step 6: Commit**

```bash
git add components/admin/risk/limits-tab.tsx components/admin/risk/blacklist-tab.tsx app/admin/risk/page.tsx app/api/player/place-bet/route.ts
git commit -m "feat: add risk limits + blacklist tabs and place-bet validation"
```

---

## Task 11: Risk Alerts — Telegram + post-bet checks

**Files:**
- Modify: `app/api/player/place-bet/route.ts` (add post-accept risk alerts)
- Modify: `lib/telegram.ts` (no changes needed — `sendTelegramAlert` already supports custom alert keys)

- [ ] **Step 1: Add post-accept risk checks to place-bet**

After the bet is successfully placed (after the wallet deduction), add:

```typescript
    // ── Post-accept risk alerts (non-blocking) ──
    try {
      const { data: riskConfig } = await supabase
        .from("system_config").select("value").eq("key", "risk_alert_config").maybeSingle();
      if (riskConfig) {
        const rc = JSON.parse(riskConfig.value);
        if (rc.enabled) {
          // Check total exposure
          const { data: openBets } = await supabase
            .from("bets").select("potential_win")
            .eq("user_id", authUser.id).eq("status", "open");
          const exposure = (openBets || []).reduce((s, b) => s + (b.potential_win || 0), 0);
          if (exposure > rc.max_exposure) {
            await supabase.from("risk_alerts").insert({
              alert_type: "exposure",
              player_id: authUser.id,
              details: { exposure, threshold: rc.max_exposure },
            });
            await sendTelegramMessage(`⚠️ RISK: Esposizione €${exposure.toFixed(0)} > soglia €${rc.max_exposure} — Player ${authUser.id}`);
          }

          // Check daily wins
          const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
          const { data: dayWins } = await supabase
            .from("bets").select("actual_win")
            .eq("user_id", authUser.id).eq("status", "won")
            .gte("created_at", todayStart.toISOString());
          const dailyWin = (dayWins || []).reduce((s, b) => s + (b.actual_win || 0), 0);
          if (dailyWin > rc.max_daily_win) {
            await supabase.from("risk_alerts").insert({
              alert_type: "daily_win",
              player_id: authUser.id,
              details: { daily_win: dailyWin, threshold: rc.max_daily_win },
            });
            await sendTelegramMessage(`⚠️ RISK: Vincite giornaliere €${dailyWin.toFixed(0)} > soglia €${rc.max_daily_win} — Player ${authUser.id}`);
          }
        }
      }
    } catch { /* non-blocking */ }
```

- [ ] **Step 2: Verify build**

Run: `cd /c/Users/philp/Downloads/betssolution/betssolution-admin && npx next build 2>&1 | tail -20`

- [ ] **Step 3: Commit**

```bash
git add app/api/player/place-bet/route.ts
git commit -m "feat: add post-bet risk alerts — exposure and daily win Telegram notifications"
```

---

## Task 12: Final — Build verification + deploy

- [ ] **Step 1: Full build check**

Run: `cd /c/Users/philp/Downloads/betssolution/betssolution-admin && npx next build 2>&1 | tail -40`

Fix any build errors.

- [ ] **Step 2: Deploy to VPS**

Follow the deploy procedure from MEMORY.md:

```bash
cd /c/Users/philp/Downloads/betssolution/betssolution-admin && npx next build && tar czf /tmp/next-build.tar.gz .next && tar czf /tmp/x.tar.gz --exclude=node_modules --exclude=.next --exclude=.git . && scp /tmp/next-build.tar.gz /tmp/x.tar.gz scraper-vps:/tmp/ && ssh scraper-vps "systemctl stop betssolution-admin && cd /root/betssolution-admin && cp .env.local /tmp/admin-env-backup && rm -rf .next && tar xzf /tmp/x.tar.gz && cp /tmp/admin-env-backup .env.local && tar xzf /tmp/next-build.tar.gz && systemctl start betssolution-admin"
```

- [ ] **Step 3: Run migration on Supabase**

Execute `028_agent_completion.sql` on the production database.

- [ ] **Step 4: Setup settlement cron on VPS**

Add to crontab on scraper-vps:

```bash
# Settlement cron — daily at 02:00 UTC
0 2 * * * curl -s -X POST http://localhost:3000/api/cron/settlement -H "x-cron-key: $(cat /root/betssolution-admin/.env.local | grep CRON_SECRET | cut -d= -f2)" > /dev/null 2>&1
```

- [ ] **Step 5: Verify in browser**

Open `http://localhost:3000/admin/` and verify:
- Agent Bets page loads with data
- Wallet page shows balance and transactions
- Settlements page shows (empty initially, cron will populate)
- Agent Network page shows tree (if logged as Master)
- Risk page has new Limiti and Blacklist tabs

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete agent system — bets, wallet, settlement, network, risk management"
```
