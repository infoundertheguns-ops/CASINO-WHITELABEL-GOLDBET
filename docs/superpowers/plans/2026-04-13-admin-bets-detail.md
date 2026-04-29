# Admin Bets Detail & Global List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read-only admin pages: a global bets list (`/admin/bets`), a single-bet detail page (`/admin/bets/[id]`), and a refactored `/admin/agent-bets` that links to the same detail page.

**Architecture:** Two new API endpoints (`/api/admin/bets` list + `/api/admin/bets/[id]` detail) backed by Postgres joins on the existing schema. UI built from focused reusable components in `components/admin/bets/`. Permission scoped at API layer (super_admin = all, agent = own kiosks). No DB schema changes.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase JS client (server with service role for admin queries), existing CSS theme (`var(--admin-*)`).

**Spec:** `docs/superpowers/specs/2026-04-13-admin-bets-detail-design.md`

---

## File Structure (target)

```
NEW:
  lib/types/bets-admin.ts                          — shared TS types for API request/response
  lib/admin/bets-permissions.ts                    — resolveBetsScope(userId): 'all' | { agent_id }
  lib/admin/bets-query.ts                          — buildBetsListQuery(filters, scope) returning { sql, params } or builder
  app/api/admin/bets/route.ts                      — GET list (filters + KPI aggregates)
  app/api/admin/bets/[id]/route.ts                 — GET single bet detail with joins + event_log derivation
  app/api/admin/bets/export/route.ts               — GET csv export with same filters, max 10k rows
  app/admin/bets/page.tsx                          — global list page (super_admin)
  app/admin/bets/[id]/page.tsx                     — detail page (both roles, scoped by API)
  components/admin/bets/BetsKpiCards.tsx           — aggregates row
  components/admin/bets/BetsFilters.tsx            — filter toolbar with URL state sync
  components/admin/bets/BetsTable.tsx              — sortable paginated table with row click
  components/admin/bets/BetCard.tsx                — detail header (status, stake, payout, timestamps)
  components/admin/bets/BetSelections.tsx          — legs table (sport + ippica + ippica_tote variants)
  components/admin/bets/BetMetadata.tsx            — IP, fingerprint, kiosk, agent, time_to_kickoff
  components/admin/bets/BetRiskPanel.tsx           — risk score badge, flags chips, acceptance flow
  components/admin/bets/BetEventLog.tsx            — vertical timeline (placed → accepted → settled)
  components/admin/bets/StatusBadge.tsx            — colored status pill (reused list+detail)
  components/admin/bets/RiskBadge.tsx              — colored risk score 0-100 pill

MODIFY:
  app/admin/agent-bets/page.tsx                    — refactor to call /api/admin/bets, link rows to detail
  app/admin/layout.tsx                             — NAVIGATION: super_admin "bets" → /admin/bets
```

**Boundary rationale**: each component owns one section of the detail UI; each lib/admin file owns one slice of business logic (permission resolution vs query building); each API route owns one HTTP contract.

---

## Conventions (apply across all tasks)

- **TypeScript everywhere**, strict types from `lib/types/bets-admin.ts`. No `any` in API contracts.
- **Server-side Supabase client**: use `createAdminClient()` from `lib/supabase/server.ts` (service role). Never expose service role to browser.
- **Permission**: every API route MUST call `resolveBetsScope(userId)` and apply it to queries; do NOT trust client-supplied `agent_id` filter without scope check.
- **Errors**: API returns `{ error: string }` with appropriate HTTP status (400 bad input, 401 unauth, 403 forbidden, 404 not found, 500 server). Frontend shows `toast.error(json.error)`.
- **Tests**: there is no existing test framework in `betssolution-admin`. Plan adds one minimal test runner setup (Task 0). After that each API task includes a smoke test (Node script that hits the endpoint with mocked fetch). UI is verified manually against staging.
- **Commits**: per task. Commit message format `feat:`, `fix:`, `refactor:`, `docs:`, `test:` etc.

---

## Phase 0 — Pre-flight setup

### Task 0.1: Verify schema + add missing column for "code"

The spec mentions a "short readable code" for bets but `bets` table has only `id` (UUID). To avoid a DB migration in v1, **the "code" shown in UI is the first 6 chars of the UUID** (no DB change). This decision is locked here so all tasks treat it consistently.

**Files:** none changed. This is documentation.

- [ ] **Step 1: Confirm in plan**

Add note in `lib/types/bets-admin.ts` (created in Task 1.1) that `code` field is derived as `id.split('-')[0]` (8 chars, e.g., `a3f7b9c2`). This is computed in API responses, not stored in DB.

### Task 0.2: Bootstrap a minimal test runner

The repo currently has no test setup. Add `vitest` for unit tests on lib files (permission, query builder).

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/.gitkeep`

- [ ] **Step 1: Install vitest + happy-dom**

```bash
cd /tmp/betssolution-admin
npm install --save-dev vitest @vitest/ui happy-dom
```

- [ ] **Step 2: Add `vitest.config.ts`**

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
```

- [ ] **Step 3: Add scripts to `package.json`**

In `"scripts"` block, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify it runs (no tests yet)**

```bash
npm test
```
Expected output: `No test files found, exiting with code 0` (vitest >=1.0 returns 0 with no tests when configured this way; if it errors, accept and proceed — first real test in Task 1.2 will validate setup).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tests/.gitkeep
git commit -m "test: add vitest test runner for lib unit tests"
```

---

## Phase 1 — Types + permission resolution

### Task 1.1: Create shared TypeScript types

**Files:**
- Create: `lib/types/bets-admin.ts`

- [ ] **Step 1: Write the types file**

```ts
// lib/types/bets-admin.ts
//
// Shared types for /api/admin/bets/* endpoints and pages under /admin/bets.

export type BetStatus =
  | "open" | "won" | "lost" | "void"
  | "pending_acceptance" | "rejected" | "cashout";

export type BetType = "single" | "multi" | "system";

export type SelectionSource = "sport" | "ippica" | "ippica_tote";

export type SelectionResult = "won" | "lost" | "void" | null;

export interface BetsListFilters {
  status?: BetStatus | "all";
  from?: string;
  to?: string;
  kiosk_id?: string;
  agent_id?: string;
  user_id?: string;
  sport?: string;
  min_stake?: number;
  max_stake?: number;
  is_live?: boolean;
  risk_min?: number;
  risk_max?: number;
  search?: string;
  sort?: "created_at" | "stake" | "payout";
  dir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface BetListItem {
  id: string;
  code: string;                 // derived: id.split('-')[0]
  user: { id: string; username: string | null };
  kiosk: { code: string | null; name: string | null } | null;
  agent: { code: string | null; name: string | null } | null;
  bet_type: BetType;
  stake: number;
  potential_win: number | null;
  actual_win: number | null;
  total_odds: number | null;
  status: BetStatus;
  is_live: boolean;
  selections_count: number;
  risk_score: number;
  created_at: string;
  settled_at: string | null;
}

export interface BetsListAggregates {
  total_stake: number;
  total_payout: number;
  ggr_pct: number;
  open_count: number;
}

export interface BetsListResponse {
  bets: BetListItem[];
  total: number;
  aggregates: BetsListAggregates;
}

export interface BetSelectionDetail {
  id: string;
  source: SelectionSource;
  event: { name: string; league: string | null; sport: string | null };
  market: { type: string; label: string | null };
  outcome: { name: string };
  odds_at_placement: number;
  current_odds: number | null;
  result: SelectionResult;
  settled_at: string | null;
  // Ippica-only optional fields:
  race_meeting?: string | null;
  race_date?: string | null;
  horse_number?: number | null;
}

export interface BetEventLogEntry {
  ts: string;
  event: "placed" | "accepted" | "settled";
  actor: "player" | "system" | "admin";
  data: Record<string, unknown>;
}

export interface BetDetailResponse {
  bet: {
    id: string;
    code: string;
    bet_type: BetType;
    stake: number;
    requested_stake: number | null;
    accepted_stake: number | null;
    total_odds: number | null;
    potential_win: number | null;
    actual_win: number | null;
    status: BetStatus;
    is_live: boolean;
    is_free_bet: boolean;
    selections_count: number;
    combo_type: string | null;
    combo_count: number | null;
    combos_won: number | null;
    parent_bet_id: string | null;
    created_at: string;
    settled_at: string | null;
    reviewed_at: string | null;
    time_to_kickoff_minutes: number | null;
  };
  user: { id: string; username: string | null; kyc_status: string | null; country: string | null };
  kiosk: { id: string; code: string; name: string; agent_id: string | null } | null;
  agent: { id: string; code: string; name: string; level: number | null } | null;
  selections: BetSelectionDetail[];
  children_combos: Array<{ id: string; stake: number; total_odds: number | null; potential_win: number | null; actual_win: number | null; status: BetStatus; selections_count: number }>;
  risk: {
    score: number;
    flags: string[];
    acceptance_mode: string | null;
    acceptance_note: string | null;
    accepted_by: string | null;
    placed_ip: string | null;
    placed_fingerprint: string | null;
  };
  event_log: BetEventLogEntry[];
}

export type BetsScope = "all" | { agent_id: string };
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/types/bets-admin.ts
git commit -m "feat(types): shared types for admin bets API and pages"
```

### Task 1.2: Implement `resolveBetsScope`

**Files:**
- Create: `lib/admin/bets-permissions.ts`
- Create: `tests/lib/bets-permissions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/bets-permissions.test.ts
import { describe, it, expect, vi } from "vitest";
import { resolveBetsScope } from "@/lib/admin/bets-permissions";

describe("resolveBetsScope", () => {
  it("returns 'all' for super_admin user", async () => {
    const supabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "admin-row" }, error: null }),
    } as any;
    // agents query returns no row → not an agent → super_admin path
    supabase.from.mockImplementation((table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve(table === "admin_users"
              ? { data: { id: "admin-row" }, error: null }
              : { data: null, error: null }),
        }),
      }),
    }));
    const scope = await resolveBetsScope(supabase, "user-uuid");
    expect(scope).toBe("all");
  });

  it("returns { agent_id } when user is an agent", async () => {
    const supabase = {} as any;
    supabase.from = vi.fn().mockImplementation((table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve(table === "agents"
              ? { data: { id: "agent-uuid", user_id: "user-uuid" }, error: null }
              : { data: null, error: null }),
        }),
      }),
    }));
    const scope = await resolveBetsScope(supabase, "user-uuid");
    expect(scope).toEqual({ agent_id: "agent-uuid" });
  });

  it("throws when user is neither admin nor agent", async () => {
    const supabase = {} as any;
    supabase.from = vi.fn().mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }));
    await expect(resolveBetsScope(supabase, "user-uuid")).rejects.toThrow(/not authorized/i);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npm test
```
Expected: 3 tests, all fail with "Cannot find module '@/lib/admin/bets-permissions'".

- [ ] **Step 3: Write the implementation**

```ts
// lib/admin/bets-permissions.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BetsScope } from "@/lib/types/bets-admin";

/**
 * Resolve which bets a given auth user can see.
 *
 * - If user_id is an agent → returns { agent_id }
 * - If user_id is an admin_users entry (super_admin or any role) → returns "all"
 * - Otherwise → throws (not authorized)
 *
 * Agent check is done first so that a user who is BOTH an agent and an admin
 * is treated as an agent (more restrictive).
 */
export async function resolveBetsScope(
  supabase: SupabaseClient,
  userId: string
): Promise<BetsScope> {
  // Check agents first
  const { data: agentRow } = await supabase
    .from("agents")
    .select("id, user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (agentRow?.id) {
    return { agent_id: agentRow.id };
  }

  // Check admin_users
  const { data: adminRow } = await supabase
    .from("admin_users")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (adminRow?.id) {
    return "all";
  }

  throw new Error("User not authorized: not an admin or agent");
}
```

- [ ] **Step 4: Run test, verify it passes**

```bash
npm test
```
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/admin/bets-permissions.ts tests/lib/bets-permissions.test.ts
git commit -m "feat(admin): resolveBetsScope with super_admin/agent permission resolution"
```

---

## Phase 2 — API endpoints

### Task 2.1: List API `GET /api/admin/bets`

**Files:**
- Create: `app/api/admin/bets/route.ts`
- Create: `tests/api/bets-list-query.test.ts` (test the query builder, not the HTTP handler)
- Create: `lib/admin/bets-list-query.ts` (extracted query builder for testability)

- [ ] **Step 1: Write the failing test for the query builder**

```ts
// tests/api/bets-list-query.test.ts
import { describe, it, expect } from "vitest";
import { buildBetsListPostgrest } from "@/lib/admin/bets-list-query";

describe("buildBetsListPostgrest", () => {
  function fakeSupabase() {
    const calls: string[] = [];
    const chain: any = new Proxy({}, {
      get: (_t, prop) => (...args: any[]) => {
        calls.push(`${String(prop)}(${args.map(a => JSON.stringify(a)).join(",")})`);
        return chain;
      },
    });
    chain._calls = calls;
    return { from: (t: string) => { calls.push(`from(${JSON.stringify(t)})`); return chain; }, _calls: calls };
  }

  it("applies status filter when not 'all'", () => {
    const sb = fakeSupabase();
    buildBetsListPostgrest(sb as any, { status: "won" }, "all");
    expect(sb._calls.some(c => c.includes('eq("status","won")'))).toBe(true);
  });

  it("does NOT apply status filter when 'all'", () => {
    const sb = fakeSupabase();
    buildBetsListPostgrest(sb as any, { status: "all" }, "all");
    expect(sb._calls.some(c => c.includes('eq("status"'))).toBe(false);
  });

  it("forces agent scope when scope is { agent_id }", () => {
    const sb = fakeSupabase();
    buildBetsListPostgrest(sb as any, { agent_id: "should-be-overridden" }, { agent_id: "real-agent-id" });
    expect(sb._calls.some(c => c.includes('"real-agent-id"'))).toBe(true);
    expect(sb._calls.some(c => c.includes('"should-be-overridden"'))).toBe(false);
  });

  it("applies stake range when provided", () => {
    const sb = fakeSupabase();
    buildBetsListPostgrest(sb as any, { min_stake: 10, max_stake: 100 }, "all");
    expect(sb._calls.some(c => c.includes('gte("stake",10)'))).toBe(true);
    expect(sb._calls.some(c => c.includes('lte("stake",100)'))).toBe(true);
  });

  it("orders by created_at desc by default", () => {
    const sb = fakeSupabase();
    buildBetsListPostgrest(sb as any, {}, "all");
    expect(sb._calls.some(c => c.includes('order("created_at"'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
npm test
```
Expected: 5 new tests fail with "Cannot find module '@/lib/admin/bets-list-query'".

- [ ] **Step 3: Implement the query builder**

```ts
// lib/admin/bets-list-query.ts
import type { SupabaseClient, PostgrestFilterBuilder } from "@supabase/supabase-js";
import type { BetsListFilters, BetsScope } from "@/lib/types/bets-admin";

/**
 * Build the Postgrest query for listing bets with filters and scope.
 * Returns the chain (caller invokes .range() and awaits).
 *
 * IMPORTANT: scope ALWAYS overrides any agent_id in filters.
 */
export function buildBetsListPostgrest(
  supabase: SupabaseClient,
  filters: BetsListFilters,
  scope: BetsScope
) {
  let q: any = supabase
    .from("bets")
    .select(
      `id, user_id, bet_type, stake, total_odds, potential_win, actual_win,
       status, is_live, selections_count, risk_score, created_at, settled_at,
       kiosk_id,
       user:users(id, username),
       kiosk:kiosks(code, name, agent_id, agent:agents(code, name))`,
      { count: "exact" }
    );

  // Permission scope (forced)
  if (scope !== "all") {
    // bets.kiosk_id → kiosks.agent_id == scope.agent_id
    // Postgrest filter on nested: use .eq on the joined table column
    q = q.eq("kiosk.agent_id", scope.agent_id);
  }

  // Status
  if (filters.status && filters.status !== "all") {
    q = q.eq("status", filters.status);
  }

  // Date range
  if (filters.from) q = q.gte("created_at", filters.from);
  if (filters.to) q = q.lte("created_at", filters.to);

  // FK filters
  if (filters.kiosk_id) q = q.eq("kiosk_id", filters.kiosk_id);
  if (filters.user_id) q = q.eq("user_id", filters.user_id);

  // Stake range
  if (typeof filters.min_stake === "number") q = q.gte("stake", filters.min_stake);
  if (typeof filters.max_stake === "number") q = q.lte("stake", filters.max_stake);

  // Live
  if (typeof filters.is_live === "boolean") q = q.eq("is_live", filters.is_live);

  // Risk range
  if (typeof filters.risk_min === "number") q = q.gte("risk_score", filters.risk_min);
  if (typeof filters.risk_max === "number") q = q.lte("risk_score", filters.risk_max);

  // Search (PostgREST or filter; we use ilike on UUID prefix and username via foreign-key not directly possible —
  // do username via inner join filter and id with text-cast)
  if (filters.search?.trim()) {
    const s = filters.search.trim();
    // id::text ilike or kiosk.code ilike. PostgREST supports `or=` with embedded fields.
    q = q.or(
      [
        `id::text.ilike.%${s}%`,
        `kiosk.code.ilike.%${s}%`,
      ].join(",")
    );
    // username search handled in route handler via post-filter (Postgrest limit)
    // recorded in BetsListFilters.search; route applies post-filter on user.username in JS
  }

  // Sort
  const sortCol = filters.sort === "stake" ? "stake"
                : filters.sort === "payout" ? "actual_win"
                : "created_at";
  const dir = filters.dir === "asc" ? { ascending: true } : { ascending: false };
  q = q.order(sortCol, dir);

  return q;
}
```

- [ ] **Step 4: Run test, verify it passes**

```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 5: Implement the route handler**

```ts
// app/api/admin/bets/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveBetsScope } from "@/lib/admin/bets-permissions";
import { buildBetsListPostgrest } from "@/lib/admin/bets-list-query";
import type { BetsListFilters, BetsListResponse, BetListItem, BetStatus, BetType } from "@/lib/types/bets-admin";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseFilters(sp: URLSearchParams): BetsListFilters {
  const num = (k: string) => {
    const v = sp.get(k);
    return v != null && v !== "" ? Number(v) : undefined;
  };
  const bool = (k: string) => {
    const v = sp.get(k);
    if (v == null || v === "") return undefined;
    return v === "true" || v === "1";
  };
  return {
    status: (sp.get("status") as BetsListFilters["status"]) || "all",
    from: sp.get("from") || undefined,
    to: sp.get("to") || undefined,
    kiosk_id: sp.get("kiosk_id") || undefined,
    agent_id: sp.get("agent_id") || undefined,
    user_id: sp.get("user_id") || undefined,
    sport: sp.get("sport") || undefined,
    min_stake: num("min_stake"),
    max_stake: num("max_stake"),
    is_live: bool("is_live"),
    risk_min: num("risk_min"),
    risk_max: num("risk_max"),
    search: sp.get("search") || undefined,
    sort: (sp.get("sort") as BetsListFilters["sort"]) || "created_at",
    dir: (sp.get("dir") as BetsListFilters["dir"]) || "desc",
    limit: Math.min(200, num("limit") ?? 50),
    offset: num("offset") ?? 0,
  };
}

export async function GET(req: NextRequest) {
  try {
    // Resolve auth user from cookie session
    const cookieStore = cookies();
    const sbToken = cookieStore.get("sb-access-token")?.value || cookieStore.get("supabase-auth-token")?.value;
    if (!sbToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminSb = createAdminClient();
    // Resolve user via JWT
    const { data: userData } = await adminSb.auth.getUser(sbToken);
    const userId = userData?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    let scope;
    try {
      scope = await resolveBetsScope(adminSb, userId);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const filters = parseFilters(req.nextUrl.searchParams);

    // Build query
    const baseQuery = buildBetsListPostgrest(adminSb, filters, scope);

    // Fetch page
    const { data, error, count } = await baseQuery.range(filters.offset!, filters.offset! + filters.limit! - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Post-filter: search on username (since we couldn't include in PostgREST .or for nested FK)
    let rows = data ?? [];
    if (filters.search?.trim()) {
      const s = filters.search.trim().toLowerCase();
      rows = rows.filter((r: any) => {
        const u = r.user?.username?.toLowerCase() ?? "";
        const k = r.kiosk?.code?.toLowerCase() ?? "";
        const id = r.id?.toLowerCase() ?? "";
        return u.includes(s) || k.includes(s) || id.includes(s);
      });
    }

    // Map to BetListItem shape
    const bets: BetListItem[] = rows.map((r: any) => ({
      id: r.id,
      code: r.id.split("-")[0],
      user: { id: r.user?.id ?? r.user_id, username: r.user?.username ?? null },
      kiosk: r.kiosk ? { code: r.kiosk.code ?? null, name: r.kiosk.name ?? null } : null,
      agent: r.kiosk?.agent ? { code: r.kiosk.agent.code ?? null, name: r.kiosk.agent.name ?? null } : null,
      bet_type: r.bet_type as BetType,
      stake: Number(r.stake ?? 0),
      potential_win: r.potential_win != null ? Number(r.potential_win) : null,
      actual_win: r.actual_win != null ? Number(r.actual_win) : null,
      total_odds: r.total_odds != null ? Number(r.total_odds) : null,
      status: r.status as BetStatus,
      is_live: !!r.is_live,
      selections_count: r.selections_count ?? 0,
      risk_score: r.risk_score ?? 0,
      created_at: r.created_at,
      settled_at: r.settled_at,
    }));

    // Aggregates: separate query (fast — uses indexes on status + same scope)
    const aggQuery = buildBetsListPostgrest(adminSb, { ...filters, sort: undefined, dir: undefined }, scope)
      .select("status, stake, actual_win", { count: "exact", head: false })
      .limit(50000); // safety; aggregates over up to 50k rows
    const { data: aggData } = await aggQuery;
    const all = aggData ?? [];
    const total_stake = all.reduce((s: number, r: any) => s + Number(r.stake ?? 0), 0);
    const total_payout = all.reduce((s: number, r: any) => s + Number(r.actual_win ?? 0), 0);
    const open_count = all.filter((r: any) => r.status === "open" || r.status === "pending_acceptance").length;
    const ggr_pct = total_stake > 0 ? Number((((total_stake - total_payout) / total_stake) * 100).toFixed(1)) : 0;

    const response: BetsListResponse = {
      bets,
      total: count ?? 0,
      aggregates: { total_stake, total_payout, ggr_pct, open_count },
    };

    return NextResponse.json(response);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
```

- [ ] **Step 6: Manual smoke against staging admin**

After deploy, hit:
```bash
curl -s -H "Cookie: sb-access-token=<get-from-browser-devtools>" \
  "https://admin-staging.betssolution.com/api/admin/bets?limit=2" | jq .
```
Expected: JSON with `bets`, `total`, `aggregates`. Acceptable if `bets: []` (staging may have no bets yet).

- [ ] **Step 7: Commit**

```bash
git add lib/admin/bets-list-query.ts tests/api/bets-list-query.test.ts app/api/admin/bets/route.ts
git commit -m "feat(api): GET /api/admin/bets with filters, scope, aggregates"
```

### Task 2.2: Detail API `GET /api/admin/bets/[id]`

**Files:**
- Create: `app/api/admin/bets/[id]/route.ts`

- [ ] **Step 1: Write route handler**

```ts
// app/api/admin/bets/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveBetsScope } from "@/lib/admin/bets-permissions";
import type {
  BetDetailResponse, BetEventLogEntry, BetSelectionDetail,
  BetStatus, BetType,
} from "@/lib/types/bets-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const cookieStore = cookies();
    const sbToken = cookieStore.get("sb-access-token")?.value || cookieStore.get("supabase-auth-token")?.value;
    if (!sbToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sb = createAdminClient();
    const { data: userData } = await sb.auth.getUser(sbToken);
    const userId = userData?.user?.id;
    if (!userId) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

    let scope;
    try { scope = await resolveBetsScope(sb, userId); }
    catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }

    const { data: betRow, error } = await sb
      .from("bets")
      .select(`
        *,
        user:users(id, username, kyc_status, country),
        kiosk:kiosks(id, code, name, agent_id, agent:agents(id, code, name, level))
      `)
      .eq("id", params.id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!betRow) return NextResponse.json({ error: "Bet not found" }, { status: 404 });

    // Permission check
    if (scope !== "all") {
      const betAgentId = (betRow as any).kiosk?.agent_id;
      if (betAgentId !== scope.agent_id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // Selections (sport)
    const { data: selRows } = await sb
      .from("bet_selections")
      .select(`
        id, source, odds_at_placement, result, settled_at,
        event:events(name, league:leagues(name), sport:sports(name)),
        market:markets(market_type, label),
        outcome:outcomes(name, odds),
        race:ippica_races(title, race_date, meeting:ippica_meetings(name)),
        race_market:ippica_markets(market_type),
        race_odds:ippica_odds(odds, runner_number)
      `)
      .eq("bet_id", params.id);

    const selections: BetSelectionDetail[] = (selRows ?? []).map((s: any) => {
      if (s.source === "sport") {
        return {
          id: s.id, source: "sport",
          event: {
            name: s.event?.name ?? "—",
            league: s.event?.league?.name ?? null,
            sport: s.event?.sport?.name ?? null,
          },
          market: { type: s.market?.market_type ?? "—", label: s.market?.label ?? null },
          outcome: { name: s.outcome?.name ?? "—" },
          odds_at_placement: Number(s.odds_at_placement ?? 0),
          current_odds: s.outcome?.odds != null ? Number(s.outcome.odds) : null,
          result: s.result ?? null,
          settled_at: s.settled_at,
        };
      }
      // Ippica/ippica_tote — title shown in event.name slot
      return {
        id: s.id, source: s.source,
        event: { name: s.race?.title ?? "Race", league: s.race?.meeting?.name ?? null, sport: "Ippica" },
        market: { type: s.race_market?.market_type ?? "—", label: null },
        outcome: { name: s.race_odds?.runner_number != null ? `#${s.race_odds.runner_number}` : "—" },
        odds_at_placement: Number(s.odds_at_placement ?? 0),
        current_odds: s.race_odds?.odds != null ? Number(s.race_odds.odds) : null,
        result: s.result ?? null,
        settled_at: s.settled_at,
        race_meeting: s.race?.meeting?.name ?? null,
        race_date: s.race?.race_date ?? null,
        horse_number: s.race_odds?.runner_number ?? null,
      };
    });

    // Children combos (system bets)
    const { data: childRows } = await sb
      .from("bets")
      .select("id, stake, total_odds, potential_win, actual_win, status, selections_count")
      .eq("parent_bet_id", params.id);

    const children_combos = (childRows ?? []).map((c: any) => ({
      id: c.id,
      stake: Number(c.stake ?? 0),
      total_odds: c.total_odds != null ? Number(c.total_odds) : null,
      potential_win: c.potential_win != null ? Number(c.potential_win) : null,
      actual_win: c.actual_win != null ? Number(c.actual_win) : null,
      status: c.status as BetStatus,
      selections_count: c.selections_count ?? 0,
    }));

    // Event log derivation
    const event_log: BetEventLogEntry[] = [];
    event_log.push({
      ts: betRow.created_at,
      event: "placed",
      actor: "player",
      data: {
        requested_stake: betRow.requested_stake ?? betRow.stake,
        ip_address: betRow.placed_ip ?? betRow.ip_address ?? null,
      },
    });
    if (betRow.reviewed_at || betRow.acceptance_mode) {
      event_log.push({
        ts: betRow.reviewed_at ?? betRow.created_at,
        event: "accepted",
        actor: betRow.accepted_by === "admin" ? "admin" : "system",
        data: {
          accepted_stake: betRow.accepted_stake ?? betRow.stake,
          mode: betRow.acceptance_mode ?? "auto",
          note: betRow.acceptance_note ?? null,
        },
      });
    }
    if (betRow.settled_at) {
      event_log.push({
        ts: betRow.settled_at,
        event: "settled",
        actor: "system",
        data: { status: betRow.status, actual_win: betRow.actual_win ?? 0 },
      });
    }

    const k = (betRow as any).kiosk;
    const ag = k?.agent;
    const response: BetDetailResponse = {
      bet: {
        id: betRow.id,
        code: betRow.id.split("-")[0],
        bet_type: betRow.bet_type as BetType,
        stake: Number(betRow.stake ?? 0),
        requested_stake: betRow.requested_stake != null ? Number(betRow.requested_stake) : null,
        accepted_stake: betRow.accepted_stake != null ? Number(betRow.accepted_stake) : null,
        total_odds: betRow.total_odds != null ? Number(betRow.total_odds) : null,
        potential_win: betRow.potential_win != null ? Number(betRow.potential_win) : null,
        actual_win: betRow.actual_win != null ? Number(betRow.actual_win) : null,
        status: betRow.status as BetStatus,
        is_live: !!betRow.is_live,
        is_free_bet: !!betRow.is_free_bet,
        selections_count: betRow.selections_count ?? 0,
        combo_type: betRow.combo_type ?? null,
        combo_count: betRow.combo_count ?? null,
        combos_won: betRow.combos_won ?? null,
        parent_bet_id: betRow.parent_bet_id ?? null,
        created_at: betRow.created_at,
        settled_at: betRow.settled_at,
        reviewed_at: betRow.reviewed_at,
        time_to_kickoff_minutes: betRow.time_to_kickoff_minutes ?? null,
      },
      user: {
        id: (betRow as any).user?.id ?? betRow.user_id,
        username: (betRow as any).user?.username ?? null,
        kyc_status: (betRow as any).user?.kyc_status ?? null,
        country: (betRow as any).user?.country ?? null,
      },
      kiosk: k ? { id: k.id, code: k.code, name: k.name, agent_id: k.agent_id ?? null } : null,
      agent: ag ? { id: ag.id, code: ag.code, name: ag.name, level: ag.level ?? null } : null,
      selections,
      children_combos,
      risk: {
        score: betRow.risk_score ?? 0,
        flags: Array.isArray(betRow.risk_flags) ? betRow.risk_flags : [],
        acceptance_mode: betRow.acceptance_mode ?? null,
        acceptance_note: betRow.acceptance_note ?? null,
        accepted_by: betRow.accepted_by ?? null,
        placed_ip: betRow.placed_ip ?? betRow.ip_address ?? null,
        placed_fingerprint: betRow.placed_fingerprint ?? null,
      },
      event_log,
    };

    return NextResponse.json(response);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Manual smoke**

```bash
# After getting a bet ID from Task 2.1 list endpoint
curl -s -H "Cookie: sb-access-token=..." \
  "https://admin-staging.betssolution.com/api/admin/bets/<uuid>" | jq .
```
Expected: `bet`, `user`, `kiosk`, `agent`, `selections`, `event_log` populated. Or `404` if no bets exist (acceptable).

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/bets/\[id\]/route.ts
git commit -m "feat(api): GET /api/admin/bets/[id] detail with selections + event log"
```

### Task 2.3: CSV export `GET /api/admin/bets/export`

**Files:**
- Create: `app/api/admin/bets/export/route.ts`

- [ ] **Step 1: Write route handler**

```ts
// app/api/admin/bets/export/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveBetsScope } from "@/lib/admin/bets-permissions";
import { buildBetsListPostgrest } from "@/lib/admin/bets-list-query";
import type { BetsListFilters } from "@/lib/types/bets-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_ROWS = 10000;

function parseFilters(sp: URLSearchParams): BetsListFilters {
  // Same parser as list route — duplicated here intentionally to avoid coupling
  const num = (k: string) => { const v = sp.get(k); return v ? Number(v) : undefined; };
  const bool = (k: string) => { const v = sp.get(k); return v == null ? undefined : v === "true" || v === "1"; };
  return {
    status: (sp.get("status") as any) || "all",
    from: sp.get("from") || undefined,
    to: sp.get("to") || undefined,
    kiosk_id: sp.get("kiosk_id") || undefined,
    user_id: sp.get("user_id") || undefined,
    sport: sp.get("sport") || undefined,
    min_stake: num("min_stake"),
    max_stake: num("max_stake"),
    is_live: bool("is_live"),
    risk_min: num("risk_min"),
    risk_max: num("risk_max"),
    search: sp.get("search") || undefined,
    sort: "created_at", dir: "desc", limit: MAX_ROWS, offset: 0,
  };
}

function csvEscape(v: any): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: NextRequest) {
  try {
    const cookieStore = cookies();
    const sbToken = cookieStore.get("sb-access-token")?.value || cookieStore.get("supabase-auth-token")?.value;
    if (!sbToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sb = createAdminClient();
    const { data: userData } = await sb.auth.getUser(sbToken);
    const userId = userData?.user?.id;
    if (!userId) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

    let scope;
    try { scope = await resolveBetsScope(sb, userId); }
    catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }

    const filters = parseFilters(req.nextUrl.searchParams);

    // Count first to enforce MAX_ROWS
    const countQuery = buildBetsListPostgrest(sb, filters, scope).select("id", { count: "exact", head: true });
    const { count } = await countQuery;
    if ((count ?? 0) > MAX_ROWS) {
      return NextResponse.json(
        { error: `Export limited to ${MAX_ROWS} rows. Narrow your filters (current match: ${count}).` },
        { status: 422 }
      );
    }

    const { data, error } = await buildBetsListPostgrest(sb, filters, scope).range(0, MAX_ROWS - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const headers = ["id","created_at","username","kiosk_code","agent_code","bet_type","stake","total_odds","potential_win","actual_win","status","risk_score","selections_count"];
    const rows = (data ?? []).map((r: any) => [
      r.id,
      r.created_at,
      r.user?.username ?? "",
      r.kiosk?.code ?? "",
      r.kiosk?.agent?.code ?? "",
      r.bet_type,
      r.stake,
      r.total_odds ?? "",
      r.potential_win ?? "",
      r.actual_win ?? "",
      r.status,
      r.risk_score ?? 0,
      r.selections_count ?? 0,
    ].map(csvEscape).join(","));

    const csv = [headers.join(","), ...rows].join("\n");
    const ts = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="bets-${ts}.csv"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Smoke test**

```bash
curl -s -H "Cookie: sb-access-token=..." \
  "https://admin-staging.betssolution.com/api/admin/bets/export?status=won" -o /tmp/bets.csv
head -3 /tmp/bets.csv
```
Expected: CSV with header line + data rows (or just header if no won bets).

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/bets/export/route.ts
git commit -m "feat(api): GET /api/admin/bets/export csv with 10k row cap"
```

---

## Phase 3 — UI components (small, focused)

### Task 3.1: `StatusBadge` + `RiskBadge`

**Files:**
- Create: `components/admin/bets/StatusBadge.tsx`
- Create: `components/admin/bets/RiskBadge.tsx`

- [ ] **Step 1: Implement StatusBadge**

```tsx
// components/admin/bets/StatusBadge.tsx
import type { BetStatus } from "@/lib/types/bets-admin";

const COLOR: Record<BetStatus, { bg: string; fg: string; label: string }> = {
  open:               { bg: "#1e3a8a30", fg: "#60a5fa", label: "APERTA" },
  pending_acceptance: { bg: "#92400e30", fg: "#f59e0b", label: "IN ATTESA" },
  won:                { bg: "#065f4630", fg: "#10b981", label: "VINTA" },
  lost:               { bg: "#7f1d1d30", fg: "#ef4444", label: "PERSA" },
  void:               { bg: "#37415130", fg: "#9ca3af", label: "VOID" },
  rejected:           { bg: "#7f1d1d30", fg: "#ef4444", label: "RIFIUTATA" },
  cashout:            { bg: "#5b21b630", fg: "#a78bfa", label: "CASHOUT" },
};

export function StatusBadge({ status }: { status: BetStatus }) {
  const c = COLOR[status] ?? { bg: "#37415130", fg: "#9ca3af", label: status };
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 4,
      background: c.bg,
      color: c.fg,
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: "0.05em",
    }}>{c.label}</span>
  );
}
```

- [ ] **Step 2: Implement RiskBadge**

```tsx
// components/admin/bets/RiskBadge.tsx
export function RiskBadge({ score }: { score: number }) {
  const s = Math.max(0, Math.min(100, score));
  const color = s <= 30 ? "#10b981" : s <= 60 ? "#f59e0b" : "#ef4444";
  return (
    <span style={{
      display: "inline-block",
      minWidth: 36,
      padding: "2px 6px",
      borderRadius: 4,
      background: `${color}30`,
      color,
      fontSize: 11,
      fontWeight: 700,
      textAlign: "center",
    }}>{s}</span>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/admin/bets/StatusBadge.tsx components/admin/bets/RiskBadge.tsx
git commit -m "feat(ui): StatusBadge + RiskBadge components"
```

### Task 3.2: `BetsKpiCards`

**Files:**
- Create: `components/admin/bets/BetsKpiCards.tsx`

- [ ] **Step 1: Implement**

```tsx
// components/admin/bets/BetsKpiCards.tsx
import type { BetsListAggregates } from "@/lib/types/bets-admin";

interface Props { agg: BetsListAggregates; total: number; }

const fmtEur = (n: number) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

export function BetsKpiCards({ agg, total }: Props) {
  const cards = [
    { icon: "🎯", label: "Bets", value: total.toLocaleString("it-IT"), tone: "#3b82f6" },
    { icon: "💰", label: "Stake totale", value: fmtEur(agg.total_stake), tone: "#10b981" },
    { icon: "📈", label: "Payout totale", value: fmtEur(agg.total_payout), tone: "#f59e0b" },
    { icon: "📊", label: "GGR", value: `${agg.ggr_pct.toFixed(1)}%`, tone: "#a78bfa" },
    { icon: "🔵", label: "Aperte", value: agg.open_count.toLocaleString("it-IT"), tone: "#60a5fa" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
      {cards.map((c) => (
        <div key={c.label} style={{
          padding: 12,
          background: "var(--admin-surface)",
          border: "1px solid var(--admin-border)",
          borderLeft: `3px solid ${c.tone}`,
          borderRadius: 6,
        }}>
          <div style={{ fontSize: 11, color: "var(--admin-text4)", marginBottom: 4 }}>
            {c.icon} {c.label}
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--admin-text)" }}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/admin/bets/BetsKpiCards.tsx
git commit -m "feat(ui): BetsKpiCards aggregates row"
```

### Task 3.3: `BetsFilters` toolbar

**Files:**
- Create: `components/admin/bets/BetsFilters.tsx`

- [ ] **Step 1: Implement (URL-state synced)**

```tsx
// components/admin/bets/BetsFilters.tsx
"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useEffect } from "react";
import type { BetsListFilters } from "@/lib/types/bets-admin";

const STATUSES = ["all","open","pending_acceptance","won","lost","void","rejected","cashout"];

export function BetsFilters({ initial }: { initial: BetsListFilters }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [search, setSearch] = useState(initial.search ?? "");

  const setParam = useCallback((k: string, v: string | undefined) => {
    const p = new URLSearchParams(sp);
    if (v == null || v === "") p.delete(k);
    else p.set(k, v);
    p.delete("offset"); // reset pagination on filter change
    router.push(`?${p.toString()}`);
  }, [sp, router]);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => setParam("search", search.trim() || undefined), 400);
    return () => clearTimeout(t);
  }, [search, setParam]);

  const inputStyle = { padding: "6px 10px", background: "var(--admin-input-bg)", border: "1px solid var(--admin-border)", borderRadius: 4, color: "var(--admin-text)", fontSize: 12 };

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <select
        value={initial.status ?? "all"}
        onChange={(e) => setParam("status", e.target.value)}
        style={inputStyle as any}
      >
        {STATUSES.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
      </select>

      <input type="date" value={initial.from ?? ""} onChange={(e) => setParam("from", e.target.value || undefined)} style={inputStyle as any} />
      <input type="date" value={initial.to ?? ""} onChange={(e) => setParam("to", e.target.value || undefined)} style={inputStyle as any} />

      <input type="number" placeholder="€ min" value={initial.min_stake ?? ""}
        onChange={(e) => setParam("min_stake", e.target.value || undefined)} style={{ ...inputStyle, width: 80 } as any} />
      <input type="number" placeholder="€ max" value={initial.max_stake ?? ""}
        onChange={(e) => setParam("max_stake", e.target.value || undefined)} style={{ ...inputStyle, width: 80 } as any} />

      <input type="number" placeholder="Risk min" value={initial.risk_min ?? ""}
        onChange={(e) => setParam("risk_min", e.target.value || undefined)} style={{ ...inputStyle, width: 80 } as any} />
      <input type="number" placeholder="Risk max" value={initial.risk_max ?? ""}
        onChange={(e) => setParam("risk_max", e.target.value || undefined)} style={{ ...inputStyle, width: 80 } as any} />

      <label style={{ fontSize: 12, color: "var(--admin-text)", display: "flex", alignItems: "center", gap: 4 }}>
        <input type="checkbox" checked={!!initial.is_live} onChange={(e) => setParam("is_live", e.target.checked ? "true" : undefined)} />
        Live
      </label>

      <input
        type="search"
        placeholder="🔍 username / id / kiosk code"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ ...inputStyle, flex: 1, minWidth: 200 } as any}
      />

      <button
        onClick={() => router.push("?")}
        style={{ ...inputStyle, cursor: "pointer", background: "var(--admin-bg)" } as any}
      >Reset</button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/admin/bets/BetsFilters.tsx
git commit -m "feat(ui): BetsFilters toolbar with URL state sync"
```

### Task 3.4: `BetsTable`

**Files:**
- Create: `components/admin/bets/BetsTable.tsx`

- [ ] **Step 1: Implement**

```tsx
// components/admin/bets/BetsTable.tsx
"use client";
import Link from "next/link";
import type { BetListItem } from "@/lib/types/bets-admin";
import { StatusBadge } from "./StatusBadge";
import { RiskBadge } from "./RiskBadge";

interface Props { bets: BetListItem[]; }

const fmtEur = (n: number | null) => n == null ? "—" : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);
const fmtDate = (s: string) => new Date(s).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });

export function BetsTable({ bets }: Props) {
  if (bets.length === 0) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--admin-text4)" }}>Nessun bet trovato</div>;
  }

  const cellStyle: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid var(--admin-border)", fontSize: 12 };
  const headStyle: React.CSSProperties = { ...cellStyle, fontWeight: 600, color: "var(--admin-text4)", textAlign: "left", textTransform: "uppercase", fontSize: 10, letterSpacing: "0.05em" };

  return (
    <div style={{ overflowX: "auto", border: "1px solid var(--admin-border)", borderRadius: 6 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", color: "var(--admin-text)" }}>
        <thead>
          <tr>
            {["ID","Data","Player","Kiosk","Tipo","Stake","Quota","Payout","Status","Risk"].map(h =>
              <th key={h} style={headStyle}>{h}</th>
            )}
          </tr>
        </thead>
        <tbody>
          {bets.map((b) => (
            <tr key={b.id} style={{ cursor: "pointer" }}>
              <td style={cellStyle}>
                <Link href={`/admin/bets/${b.id}`} style={{ color: "#60a5fa", fontFamily: "monospace" }}>{b.code}</Link>
              </td>
              <td style={cellStyle}>{fmtDate(b.created_at)}</td>
              <td style={cellStyle}>{b.user.username ?? <span style={{ color: "var(--admin-text4)" }}>—</span>}</td>
              <td style={cellStyle}>{b.kiosk?.code ?? "—"}</td>
              <td style={cellStyle}>{b.bet_type}</td>
              <td style={cellStyle}>{fmtEur(b.stake)}</td>
              <td style={cellStyle}>{b.total_odds?.toFixed(2) ?? "—"}</td>
              <td style={cellStyle}>{fmtEur(b.actual_win ?? b.potential_win)}</td>
              <td style={cellStyle}><StatusBadge status={b.status} /></td>
              <td style={cellStyle}><RiskBadge score={b.risk_score} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/admin/bets/BetsTable.tsx
git commit -m "feat(ui): BetsTable with row click → detail link"
```

### Task 3.5: Detail components — `BetCard`, `BetSelections`, `BetMetadata`, `BetRiskPanel`, `BetEventLog`

**Files:**
- Create: `components/admin/bets/BetCard.tsx`
- Create: `components/admin/bets/BetSelections.tsx`
- Create: `components/admin/bets/BetMetadata.tsx`
- Create: `components/admin/bets/BetRiskPanel.tsx`
- Create: `components/admin/bets/BetEventLog.tsx`

- [ ] **Step 1: BetCard**

```tsx
// components/admin/bets/BetCard.tsx
import type { BetDetailResponse } from "@/lib/types/bets-admin";
import { StatusBadge } from "./StatusBadge";

const fmtEur = (n: number | null) => n == null ? "—" : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleString("it-IT") : "—";

export function BetCard({ bet }: { bet: BetDetailResponse["bet"] }) {
  return (
    <div style={{ padding: 16, background: "var(--admin-surface)", border: "1px solid var(--admin-border)", borderRadius: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <StatusBadge status={bet.status} />
        <div style={{ fontSize: 24, fontWeight: 700, color: bet.actual_win && bet.actual_win > 0 ? "#10b981" : "var(--admin-text)" }}>
          {fmtEur(bet.actual_win ?? bet.potential_win)}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, fontSize: 13, color: "var(--admin-text)" }}>
        <div><div style={{ fontSize: 10, color: "var(--admin-text4)" }}>STAKE</div>{fmtEur(bet.stake)}</div>
        <div><div style={{ fontSize: 10, color: "var(--admin-text4)" }}>QUOTA</div>{bet.total_odds?.toFixed(2) ?? "—"}</div>
        <div><div style={{ fontSize: 10, color: "var(--admin-text4)" }}>POTENZIALE</div>{fmtEur(bet.potential_win)}</div>
        <div><div style={{ fontSize: 10, color: "var(--admin-text4)" }}>TIPO</div>{bet.bet_type}</div>
        <div><div style={{ fontSize: 10, color: "var(--admin-text4)" }}>LIVE</div>{bet.is_live ? "Sì" : "No"}</div>
        <div><div style={{ fontSize: 10, color: "var(--admin-text4)" }}>FREE BET</div>{bet.is_free_bet ? "Sì" : "No"}</div>
      </div>
      <div style={{ marginTop: 12, fontSize: 11, color: "var(--admin-text4)" }}>
        Piazzata: {fmtDate(bet.created_at)} • Settled: {fmtDate(bet.settled_at)}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: BetSelections**

```tsx
// components/admin/bets/BetSelections.tsx
import type { BetSelectionDetail } from "@/lib/types/bets-admin";

export function BetSelections({ selections }: { selections: BetSelectionDetail[] }) {
  if (selections.length === 0) return null;
  const cell: React.CSSProperties = { padding: "8px 10px", fontSize: 12, borderBottom: "1px solid var(--admin-border)" };

  return (
    <div style={{ border: "1px solid var(--admin-border)", borderRadius: 6, overflow: "hidden" }}>
      <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--admin-text4)", background: "var(--admin-bg)", borderBottom: "1px solid var(--admin-border)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        📋 SELEZIONI ({selections.length})
      </div>
      {selections.map((s) => (
        <div key={s.id} style={{ padding: "10px 12px", borderBottom: "1px solid var(--admin-border)", color: "var(--admin-text)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span>{s.source === "sport" ? "⚽" : "🐎"} <strong>{s.event.name}</strong>{s.event.league && ` — ${s.event.league}`}</span>
            <span style={{
              fontSize: 10, padding: "2px 6px", borderRadius: 4,
              background: s.result === "won" ? "#10b98130" : s.result === "lost" ? "#ef444430" : "#37415130",
              color: s.result === "won" ? "#10b981" : s.result === "lost" ? "#ef4444" : "#9ca3af",
            }}>{(s.result || "PENDING").toUpperCase()}</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--admin-text4)" }}>
            Mercato: {s.market.type}{s.market.label ? ` (${s.market.label})` : ""} • Selezione: {s.outcome.name}
          </div>
          <div style={{ fontSize: 11, marginTop: 4 }}>
            Quota @ piazzata: <strong>{s.odds_at_placement.toFixed(2)}</strong>
            {s.current_odds != null && <span style={{ marginLeft: 12, color: "var(--admin-text4)" }}>Attuale: {s.current_odds.toFixed(2)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: BetMetadata**

```tsx
// components/admin/bets/BetMetadata.tsx
import type { BetDetailResponse } from "@/lib/types/bets-admin";

export function BetMetadata({ bet, kiosk, agent, risk }: {
  bet: BetDetailResponse["bet"];
  kiosk: BetDetailResponse["kiosk"];
  agent: BetDetailResponse["agent"];
  risk: BetDetailResponse["risk"];
}) {
  const Section = ({ title, items }: { title: string; items: Array<[string, string | number | null]> }) => (
    <div style={{ padding: 12, background: "var(--admin-surface)", border: "1px solid var(--admin-border)", borderRadius: 6 }}>
      <div style={{ fontSize: 11, color: "var(--admin-text4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>{title}</div>
      {items.map(([k, v]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
          <span style={{ color: "var(--admin-text4)" }}>{k}</span>
          <span style={{ color: "var(--admin-text)", fontFamily: typeof v === "string" && v.includes(".") ? "monospace" : undefined }}>{v ?? "—"}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
      <Section title="🖥️ KIOSK" items={[
        ["Codice", kiosk?.code ?? null],
        ["Nome", kiosk?.name ?? null],
      ]} />
      <Section title="🏢 AGENT" items={[
        ["Codice", agent?.code ?? null],
        ["Nome", agent?.name ?? null],
        ["Livello", agent?.level ?? null],
      ]} />
      <Section title="🌐 METADATA" items={[
        ["IP", risk.placed_ip],
        ["Fingerprint", risk.placed_fingerprint],
        ["Time-to-kickoff", bet.time_to_kickoff_minutes != null ? `${bet.time_to_kickoff_minutes} min` : null],
      ]} />
    </div>
  );
}
```

- [ ] **Step 4: BetRiskPanel**

```tsx
// components/admin/bets/BetRiskPanel.tsx
import type { BetDetailResponse } from "@/lib/types/bets-admin";
import { RiskBadge } from "./RiskBadge";

export function BetRiskPanel({ risk, bet }: { risk: BetDetailResponse["risk"]; bet: BetDetailResponse["bet"] }) {
  return (
    <div style={{ padding: 12, background: "var(--admin-surface)", border: "1px solid var(--admin-border)", borderRadius: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: "var(--admin-text4)" }}>🛡️ RISK SCORE</span>
        <RiskBadge score={risk.score} />
      </div>
      {risk.flags.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {risk.flags.map((f) => (
            <span key={f} style={{ padding: "2px 6px", background: "#92400e30", color: "#f59e0b", fontSize: 10, borderRadius: 4 }}>{f}</span>
          ))}
        </div>
      )}
      <div style={{ fontSize: 12, color: "var(--admin-text)" }}>
        <div>Acceptance: <strong>{risk.acceptance_mode ?? "auto"}</strong> {risk.accepted_by && `(${risk.accepted_by})`}</div>
        {risk.acceptance_note && <div style={{ marginTop: 4, color: "var(--admin-text4)" }}>Note: {risk.acceptance_note}</div>}
        {bet.requested_stake != null && bet.accepted_stake != null && bet.requested_stake !== bet.accepted_stake && (
          <div style={{ marginTop: 4, color: "#f59e0b" }}>
            ⚠ Stake ridotto: richiesto €{bet.requested_stake} → accettato €{bet.accepted_stake}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: BetEventLog**

```tsx
// components/admin/bets/BetEventLog.tsx
import type { BetEventLogEntry } from "@/lib/types/bets-admin";

const ICON: Record<BetEventLogEntry["event"], string> = {
  placed: "▶",
  accepted: "✅",
  settled: "🏁",
};

export function BetEventLog({ entries }: { entries: BetEventLogEntry[] }) {
  return (
    <div style={{ padding: 12, background: "var(--admin-surface)", border: "1px solid var(--admin-border)", borderRadius: 6 }}>
      <div style={{ fontSize: 11, color: "var(--admin-text4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>📜 EVENT LOG</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {entries.map((e, i) => (
          <div key={i} style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--admin-text)" }}>
            <span style={{ fontFamily: "monospace", color: "var(--admin-text4)", minWidth: 130 }}>
              {new Date(e.ts).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "medium" })}
            </span>
            <span style={{ minWidth: 90 }}>{ICON[e.event]} {e.event.toUpperCase()}</span>
            <span style={{ color: "var(--admin-text4)" }}>{e.actor}</span>
            <span style={{ color: "var(--admin-text4)", fontFamily: "monospace", fontSize: 11 }}>
              {Object.entries(e.data).filter(([_, v]) => v != null).map(([k, v]) => `${k}=${v}`).join("  ")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add components/admin/bets/BetCard.tsx components/admin/bets/BetSelections.tsx components/admin/bets/BetMetadata.tsx components/admin/bets/BetRiskPanel.tsx components/admin/bets/BetEventLog.tsx
git commit -m "feat(ui): bet detail components (card, selections, metadata, risk, event log)"
```

---

## Phase 4 — Pages

### Task 4.1: List page `/admin/bets/page.tsx`

**Files:**
- Create: `app/admin/bets/page.tsx`

- [ ] **Step 1: Implement**

```tsx
// app/admin/bets/page.tsx
"use client";
import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { BetsKpiCards } from "@/components/admin/bets/BetsKpiCards";
import { BetsFilters } from "@/components/admin/bets/BetsFilters";
import { BetsTable } from "@/components/admin/bets/BetsTable";
import type { BetsListResponse, BetsListFilters } from "@/lib/types/bets-admin";

const POLL_MS = 30_000;

export default function AdminBetsPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const [data, setData] = useState<BetsListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const filters: BetsListFilters = {
    status: (sp.get("status") as any) || "all",
    from: sp.get("from") || undefined,
    to: sp.get("to") || undefined,
    min_stake: sp.get("min_stake") ? Number(sp.get("min_stake")) : undefined,
    max_stake: sp.get("max_stake") ? Number(sp.get("max_stake")) : undefined,
    is_live: sp.get("is_live") === "true",
    risk_min: sp.get("risk_min") ? Number(sp.get("risk_min")) : undefined,
    risk_max: sp.get("risk_max") ? Number(sp.get("risk_max")) : undefined,
    search: sp.get("search") || undefined,
    limit: 50,
    offset: sp.get("offset") ? Number(sp.get("offset")) : 0,
  };

  const fetchBets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams(sp);
      const res = await fetch(`/api/admin/bets?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Errore caricamento");
      setData(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sp]);

  useEffect(() => {
    fetchBets();
  }, [fetchBets]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchBets, POLL_MS);
    return () => clearInterval(id);
  }, [autoRefresh, fetchBets]);

  const exportUrl = `/api/admin/bets/export?${sp.toString()}`;
  const totalPages = data ? Math.ceil(data.total / 50) : 0;
  const currentPage = Math.floor((filters.offset ?? 0) / 50) + 1;

  const goPage = (p: number) => {
    const params = new URLSearchParams(sp);
    params.set("offset", String((p - 1) * 50));
    router.push(`?${params.toString()}`);
  };

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--admin-text)" }}>SCOMMESSE</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 11, color: "var(--admin-text4)", display: "flex", alignItems: "center", gap: 4 }}>
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto-refresh 30s
          </label>
          <a href={exportUrl} download style={{ padding: "6px 12px", background: "#10b981", color: "#fff", borderRadius: 4, fontSize: 12, textDecoration: "none" }}>
            📥 Esporta CSV
          </a>
        </div>
      </div>

      {data && <BetsKpiCards agg={data.aggregates} total={data.total} />}

      <BetsFilters initial={filters} />

      {error && <div style={{ padding: 12, background: "#7f1d1d30", color: "#ef4444", borderRadius: 4 }}>{error}</div>}
      {loading && !data && <div style={{ padding: 40, textAlign: "center", color: "var(--admin-text4)" }}>Caricamento…</div>}
      {data && <BetsTable bets={data.bets} />}

      {data && totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 8, alignItems: "center", fontSize: 12, color: "var(--admin-text)" }}>
          <button disabled={currentPage <= 1} onClick={() => goPage(currentPage - 1)}
            style={{ padding: "4px 10px", background: "var(--admin-surface)", border: "1px solid var(--admin-border)", borderRadius: 4 }}>◀</button>
          <span>Pagina {currentPage} di {totalPages}</span>
          <button disabled={currentPage >= totalPages} onClick={() => goPage(currentPage + 1)}
            style={{ padding: "4px 10px", background: "var(--admin-surface)", border: "1px solid var(--admin-border)", borderRadius: 4 }}>▶</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/admin/bets/page.tsx
git commit -m "feat(page): /admin/bets list with filters, kpis, pagination, csv export"
```

### Task 4.2: Detail page `/admin/bets/[id]/page.tsx`

**Files:**
- Create: `app/admin/bets/[id]/page.tsx`

- [ ] **Step 1: Implement**

```tsx
// app/admin/bets/[id]/page.tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { BetDetailResponse } from "@/lib/types/bets-admin";
import { BetCard } from "@/components/admin/bets/BetCard";
import { BetSelections } from "@/components/admin/bets/BetSelections";
import { BetMetadata } from "@/components/admin/bets/BetMetadata";
import { BetRiskPanel } from "@/components/admin/bets/BetRiskPanel";
import { BetEventLog } from "@/components/admin/bets/BetEventLog";

export default function BetDetailPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<BetDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/bets/${params.id}`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => ok ? setData(j) : setError(j.error || "Errore"))
      .catch((e) => setError(e.message));
  }, [params.id]);

  if (error) return <div style={{ padding: 20, color: "#ef4444" }}>{error} <Link href="/admin/bets" style={{ color: "#60a5fa" }}>← Indietro</Link></div>;
  if (!data) return <div style={{ padding: 40, textAlign: "center", color: "var(--admin-text4)" }}>Caricamento…</div>;

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Link href="/admin/bets" style={{ color: "#60a5fa", fontSize: 13 }}>← Indietro</Link>
        <code style={{ fontSize: 11, color: "var(--admin-text4)" }}>Bet ID: {data.bet.id}</code>
      </div>

      <BetCard bet={data.bet} />
      <BetSelections selections={data.selections} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ padding: 12, background: "var(--admin-surface)", border: "1px solid var(--admin-border)", borderRadius: 6 }}>
          <div style={{ fontSize: 11, color: "var(--admin-text4)", marginBottom: 8, textTransform: "uppercase" }}>👤 PLAYER</div>
          <div style={{ fontSize: 13 }}>Username: <strong>{data.user.username ?? "—"}</strong></div>
          <div style={{ fontSize: 11, color: "var(--admin-text4)" }}>ID: <code>{data.user.id}</code></div>
          <div style={{ fontSize: 12, marginTop: 4 }}>KYC: {data.user.kyc_status ?? "—"} • Country: {data.user.country ?? "—"}</div>
        </div>
        <BetRiskPanel risk={data.risk} bet={data.bet} />
      </div>

      <BetMetadata bet={data.bet} kiosk={data.kiosk} agent={data.agent} risk={data.risk} />

      {data.children_combos.length > 0 && (
        <div style={{ padding: 12, background: "var(--admin-surface)", border: "1px solid var(--admin-border)", borderRadius: 6 }}>
          <div style={{ fontSize: 11, color: "var(--admin-text4)", marginBottom: 8, textTransform: "uppercase" }}>🔢 COMBINAZIONI ({data.children_combos.length})</div>
          {data.children_combos.map((c) => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid var(--admin-border)" }}>
              <span><code>{c.id.split("-")[0]}</code> • {c.selections_count} legs</span>
              <span>€{c.stake} @ {c.total_odds?.toFixed(2)} → €{c.actual_win ?? c.potential_win?.toFixed(2) ?? "—"} <strong>{c.status.toUpperCase()}</strong></span>
            </div>
          ))}
        </div>
      )}

      <BetEventLog entries={data.event_log} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/admin/bets/\[id\]/page.tsx
git commit -m "feat(page): /admin/bets/[id] detail with all sections + children combos"
```

### Task 4.3: Update sidebar navigation

**Files:**
- Modify: `app/admin/layout.tsx`

- [ ] **Step 1: Find the line in `routeMap`**

In `/tmp/betssolution-admin/app/admin/layout.tsx`, locate:
```ts
bets: "/admin/sportsbook",
```

Change to:
```ts
bets: "/admin/bets",
```

- [ ] **Step 2: Verify activeId computation handles `/admin/bets`**

Find the `activeId` `useMemo` block. It already returns `parts[parts.length - 1]` as fallback, so `/admin/bets` will resolve to `"bets"` matching the NAVIGATION item id. No additional change needed.

- [ ] **Step 3: Commit**

```bash
git add app/admin/layout.tsx
git commit -m "feat(nav): super_admin Scommesse → /admin/bets (new page)"
```

### Task 4.4: Refactor `/admin/agent-bets`

**Files:**
- Modify: `app/admin/agent-bets/page.tsx`

- [ ] **Step 1: Replace data-fetching with new API**

The existing page is ~400 lines. Strategy:
1. Keep its existing state/UI shell
2. Replace its current `fetch()` URL with `/api/admin/bets` (the same one super_admin uses)
3. The backend forces agent scope automatically — no client-side filter needed
4. Wrap each row to be a `<Link href={`/admin/bets/${b.id}`}>` so it goes to shared detail

Inspect the file:
```bash
grep -n "fetch\|/api/" /tmp/betssolution-admin/app/admin/agent-bets/page.tsx | head
```

Replace the URL string used in the current API call with `/api/admin/bets?...` (same query params shape — page already passes `status`, `period`).

Add `import Link from "next/link";` if not already imported.

Wrap the table row's primary cell:
```tsx
<Link href={`/admin/bets/${bet.id}`} style={{ color: "#60a5fa" }}>
  {bet.id.split("-")[0]}
</Link>
```

(If the existing layout shows expandable detail inline, leave that working — we're only ADDING a link, not removing.)

- [ ] **Step 2: Manual verification**

Login as agent (when there is one) → page should load via new API. Click a row → goes to `/admin/bets/[id]`. Backend returns 403 if the bet is outside the agent's network.

- [ ] **Step 3: Commit**

```bash
git add app/admin/agent-bets/page.tsx
git commit -m "refactor(page): agent-bets uses shared /api/admin/bets + links to detail"
```

---

## Phase 5 — Deploy + verification

### Task 5.1: Push staging + verify auto-deploy

- [ ] **Step 1: Push to staging**

```bash
cd /tmp/betssolution-admin
git push origin staging
```

- [ ] **Step 2: Watch CI**

```bash
gh run list --workflow=deploy-staging.yml --limit=1 -R infoundertheguns-ops/betssolution-admin
gh run watch <run-id> -R infoundertheguns-ops/betssolution-admin
```
Expected: success after ~3 min. Telegram alert `[ADMIN-STAGING] Deploy ✅`.

### Task 5.2: Manual smoke on staging

- [ ] **Step 1: Login + visit list**

Open `https://admin-staging.betssolution.com/admin/bets` (login `admin` / `admin1234`).
Expected: page loads, KPIs visible (zeros if no bets), filter toolbar present, "Nessun bet trovato" if empty.

- [ ] **Step 2: Visit detail (if at least one bet exists)**

If there's a bet: click row → detail page shows all sections.
If no bets: SQL-insert a fake one for testing:
```bash
ssh scraper-vps "PG=/usr/lib/postgresql/17/bin && PGPASSWORD='Veronihina2020@' \$PG/psql -h db.bnabvfalytivjsrwqydo.supabase.co -U postgres -d postgres -c \"
INSERT INTO bets (user_id, bet_type, stake, total_odds, potential_win, status, kiosk_id, ip_address, risk_score)
SELECT 'b24848b1-5fdd-4f12-8ac5-e8f17cd48767', 'single', 10, 1.85, 18.50, 'open',
  (SELECT id FROM kiosks WHERE code='167280'), '95.244.123.5', 25
RETURNING id;\""
```
Then refresh `/admin/bets`. Click the row → detail.

### Task 5.3: Update memory

- [ ] **Step 1: Append to `betssolution-staging-cicd.md`**

```
## Admin Bets Detail (2026-04-13)
- New pages /admin/bets (list) and /admin/bets/[id] (detail) — read-only v1
- Shared API /api/admin/bets used by both super_admin and agent (scope enforced server-side)
- Spec: docs/superpowers/specs/2026-04-13-admin-bets-detail-design.md
- Plan: docs/superpowers/plans/2026-04-13-admin-bets-detail.md
```

### Task 5.4: Promote to production (when accepted)

- [ ] **Step 1: Merge staging → master**

```bash
git checkout master
git merge staging --no-ff -m "merge: admin bets detail pages"
git push origin master
```

- [ ] **Step 2: Manual prod deploy**

GitHub UI → Actions → **Deploy Production** → Run workflow → branch `master` → Run.
Expected: success after ~3 min. Verify at `https://admin.betssolution.com/admin/bets`.

---

## Notes & rationale

- **No DB schema change**: the spec was deliberately constrained to use existing columns. `code` is a derived display value (first UUID segment). Adding a real human-friendly bet code is a v2 task tied to ticket printing.
- **Test coverage is intentionally minimal**: vitest covers the 2 most error-prone units (`resolveBetsScope` and the filter→query mapping). Pages and components are visually verified on staging — adding component tests would require a larger toolchain (jsdom + react-testing-library + mocks for next/navigation) not yet in the project.
- **Polling vs SSE**: chose polling per spec (out of scope: real-time). Easy to upgrade later if needed.
- **CSV export limit (10k)**: protects against accidental DoS. The user can narrow filters and re-export.
- **Permission scope is server-enforced**: client cannot bypass by sending `agent_id=` in URL — the API ignores it for agent role.

---

## Out of scope (per spec §7)

- Manual bet actions (void/settle/refund/cashout)
- Real-time updates
- Audit log table
- Hierarchical agent scope
- Column visibility toggle
- Saved filter presets

These will be planned separately if/when prioritized.
