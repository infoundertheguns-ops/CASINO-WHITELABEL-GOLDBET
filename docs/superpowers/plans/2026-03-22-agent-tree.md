# Agent Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hierarchical agent system with permissions, wallet models, and admin panel integration.

**Architecture:** Extend existing `agents` table with permissions/wallet fields. New `agent_transactions` and `agent_settlements` tables. Agent auth via existing Supabase auth with role detection on login. Admin panel dynamically scoped by agent permissions. Betting permissions and ticket limits in `system_config`.

**Tech Stack:** Next.js, Supabase (PostgreSQL + Auth), TypeScript, existing admin panel components.

**Spec:** `docs/superpowers/specs/2026-03-22-agent-tree-design.md`

**Existing DB state:** `agents` table already exists with basic fields (id, user_id, name, code, parent_agent_id, level, commission_type, commission_rate, is_active). `users` table already has `agent_id` column. Need to extend, not create from scratch.

---

## File Structure

```
NEW FILES:
  supabase/migrations/026_agent_tree.sql             — DB migration: extend agents, new tables, system_config keys
  lib/types/agent.ts                                  — Agent TypeScript interfaces
  lib/agent-permissions.ts                            — Permission checking utilities
  app/api/admin/agents/route.ts                       — CRUD agents (list + create)
  app/api/admin/agents/[id]/route.ts                  — Agent detail (get + update)
  app/api/admin/agents/[id]/wallet/route.ts           — Agent wallet operations
  app/api/admin/agents/[id]/players/route.ts          — Agent's players list
  app/api/agent/credit/route.ts                       — Agent loads/unloads player credit
  app/admin/agents/page.tsx                           — Agent management page (super admin)
  app/admin/agents/[id]/page.tsx                      — Agent detail page
  components/admin/agents/agent-list.tsx               — Agent table component
  components/admin/agents/agent-form.tsx               — Create/edit agent form
  components/admin/agents/agent-permissions.tsx         — Permissions editor grid
  components/admin/agents/agent-wallet.tsx              — Wallet operations panel
  app/admin/agent-dashboard/page.tsx                   — Agent's own dashboard (when agent logs in)

MODIFIED FILES:
  app/admin/layout.tsx                                — Add agent nav items + dynamic scoping
  lib/types/index.ts                                  — Add Agent types to barrel export
  app/api/player/place-bet/route.ts                   — Add betting permissions + ticket limits checks
```

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/026_agent_tree.sql`

- [ ] **Step 1: Create migration file**

```sql
-- 026_agent_tree.sql — Extend agent system

-- Extend agents table
ALTER TABLE agents ADD COLUMN IF NOT EXISTS wallet_model TEXT NOT NULL DEFAULT 'postpaid';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{
  "dashboard": "viewer",
  "players": "editor",
  "sub_agents": "none",
  "credit": "editor",
  "tickets": "editor",
  "reports": "viewer",
  "commissions": "viewer",
  "bets": "viewer",
  "risk": "none"
}'::JSONB;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Rename parent_agent_id to parent_id for consistency (if not already)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agents' AND column_name = 'parent_agent_id') THEN
    ALTER TABLE agents RENAME COLUMN parent_agent_id TO parent_id;
  END IF;
END $$;

-- Add player_type to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS player_type TEXT DEFAULT 'online';

-- Agent wallets (reuse wallets table pattern)
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'player';
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id);

-- Agent transactions
CREATE TABLE IF NOT EXISTS agent_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id),
  type TEXT NOT NULL, -- credit_load, credit_distribute, credit_collect, commission, settlement
  amount DECIMAL(12,2) NOT NULL,
  balance_after DECIMAL(12,2),
  target_user_id UUID REFERENCES users(id),
  reference_id UUID,
  notes TEXT,
  performed_by UUID, -- who did this action
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_tx_agent ON agent_transactions(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_tx_created ON agent_transactions(created_at);

-- Agent settlements (periodic commission calculation)
CREATE TABLE IF NOT EXISTS agent_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_turnover DECIMAL(12,2) DEFAULT 0,
  total_winnings DECIMAL(12,2) DEFAULT 0,
  ggr DECIMAL(12,2) DEFAULT 0,
  commission_pct DECIMAL(5,2),
  commission_amount DECIMAL(12,2) DEFAULT 0,
  status TEXT DEFAULT 'pending', -- pending, approved, paid
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_settlements_agent ON agent_settlements(agent_id);

-- System config: betting permissions + ticket limits
INSERT INTO system_config (key, value) VALUES
  ('betting_permissions', '{"disabled_sports":[],"disabled_leagues":[],"disabled_market_types":[],"event_blacklist":[]}'::TEXT),
  ('ticket_limits', '{"max_stake_single":5000,"max_stake_multi":2000,"max_stake_system":1000,"max_stake_day":10000,"max_stake_night":5000,"day_hours_start":"08:00","day_hours_end":"22:00","max_potential_win":50000,"max_daily_bets":100,"max_repeat_bets":3,"max_odds_single":1000,"max_odds_multi":50000}'::TEXT)
ON CONFLICT (key) DO NOTHING;

-- RLS policies for agent tables
ALTER TABLE agent_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_tx_read ON agent_transactions FOR SELECT USING (true);
CREATE POLICY agent_settlements_read ON agent_settlements FOR SELECT USING (true);
```

- [ ] **Step 2: Run migration on Supabase**

```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres" < supabase/migrations/026_agent_tree.sql
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/026_agent_tree.sql
git commit -m "feat(agents): database migration - extend agents, transactions, settlements, config"
```

---

### Task 2: TypeScript Types + Permission Utilities

**Files:**
- Create: `lib/types/agent.ts`
- Create: `lib/agent-permissions.ts`

- [ ] **Step 1: Create agent types**

```typescript
// lib/types/agent.ts

export type AgentLevel = 1 | 2 | 3; // master, agent, sub-agent
export type AgentStatus = "active" | "suspended" | "closed";
export type WalletModel = "prepaid" | "postpaid";
export type PermissionLevel = "none" | "viewer" | "editor";

export const PERMISSION_KEYS = [
  "dashboard", "players", "sub_agents", "credit",
  "tickets", "reports", "commissions", "bets", "risk",
] as const;

export type PermissionKey = typeof PERMISSION_KEYS[number];
export type AgentPermissions = Record<PermissionKey, PermissionLevel>;

export const LEVEL_LABELS: Record<AgentLevel, string> = {
  1: "Master Agent",
  2: "Agent",
  3: "Sub-Agent",
};

export interface Agent {
  id: string;
  user_id: string;
  parent_id: string | null;
  level: AgentLevel;
  name: string;
  code: string;
  wallet_model: WalletModel;
  commission_type: string;
  commission_rate: number;
  status: AgentStatus;
  permissions: AgentPermissions;
  is_active: boolean;
  total_players: number;
  total_ggr: number;
  total_commission: number;
  created_at: string;
  updated_at: string;
  // Joined
  parent_name?: string;
  email?: string;
  wallet_balance?: number;
  player_count?: number;
  sub_agent_count?: number;
}

export interface AgentTransaction {
  id: string;
  agent_id: string;
  type: string;
  amount: number;
  balance_after: number | null;
  target_user_id: string | null;
  reference_id: string | null;
  notes: string | null;
  performed_by: string | null;
  created_at: string;
}

export interface AgentSettlement {
  id: string;
  agent_id: string;
  period_start: string;
  period_end: string;
  total_turnover: number;
  total_winnings: number;
  ggr: number;
  commission_pct: number;
  commission_amount: number;
  status: string;
  created_at: string;
}

export interface BettingPermissions {
  disabled_sports: string[];
  disabled_leagues: string[];
  disabled_market_types: string[];
  event_blacklist: string[];
}

export interface TicketLimits {
  max_stake_single: number;
  max_stake_multi: number;
  max_stake_system: number;
  max_stake_day: number;
  max_stake_night: number;
  day_hours_start: string;
  day_hours_end: string;
  max_potential_win: number;
  max_daily_bets: number;
  max_repeat_bets: number;
  max_odds_single: number;
  max_odds_multi: number;
}

export const DEFAULT_PERMISSIONS: AgentPermissions = {
  dashboard: "viewer",
  players: "editor",
  sub_agents: "none",
  credit: "editor",
  tickets: "editor",
  reports: "viewer",
  commissions: "viewer",
  bets: "viewer",
  risk: "none",
};
```

- [ ] **Step 2: Create permission utilities**

```typescript
// lib/agent-permissions.ts

import type { Agent, AgentPermissions, PermissionKey, PermissionLevel } from "@/lib/types/agent";

/**
 * Check if agent has at least the required permission level for a function
 */
export function hasPermission(
  permissions: AgentPermissions,
  key: PermissionKey,
  required: PermissionLevel
): boolean {
  const level = permissions[key] || "none";
  if (required === "none") return true;
  if (required === "viewer") return level === "viewer" || level === "editor";
  if (required === "editor") return level === "editor";
  return false;
}

/**
 * Build admin navigation items based on agent permissions
 */
export function buildAgentNavigation(permissions: AgentPermissions) {
  const items: { id: string; icon: string; label: string }[] = [];

  if (hasPermission(permissions, "dashboard", "viewer"))
    items.push({ id: "agent-dashboard", icon: "📊", label: "Dashboard" });
  if (hasPermission(permissions, "players", "viewer"))
    items.push({ id: "agent-players", icon: "👥", label: "Giocatori" });
  if (hasPermission(permissions, "sub_agents", "viewer"))
    items.push({ id: "agent-subagents", icon: "🏢", label: "Sub-Agenti" });
  if (hasPermission(permissions, "credit", "viewer"))
    items.push({ id: "agent-credit", icon: "💳", label: "Credito" });
  if (hasPermission(permissions, "tickets", "viewer"))
    items.push({ id: "agent-tickets", icon: "🎫", label: "Ticket" });
  if (hasPermission(permissions, "bets", "viewer"))
    items.push({ id: "agent-bets", icon: "🎯", label: "Scommesse" });
  if (hasPermission(permissions, "reports", "viewer"))
    items.push({ id: "agent-reports", icon: "📈", label: "Report" });
  if (hasPermission(permissions, "commissions", "viewer"))
    items.push({ id: "agent-commissions", icon: "💰", label: "Commissioni" });
  if (hasPermission(permissions, "risk", "viewer"))
    items.push({ id: "agent-risk", icon: "🛡️", label: "Rischio" });

  return [{ group: "AGENTE", items }];
}

/**
 * Get all descendant agent IDs for data scoping
 */
export async function getDescendantAgentIds(
  supabase: any,
  agentId: string
): Promise<string[]> {
  const ids: string[] = [agentId];
  let currentLevel = [agentId];

  // Max 3 levels deep
  for (let i = 0; i < 3; i++) {
    if (currentLevel.length === 0) break;
    const { data } = await supabase
      .from("agents")
      .select("id")
      .in("parent_id", currentLevel)
      .eq("status", "active");

    const childIds = (data || []).map((a: any) => a.id);
    ids.push(...childIds);
    currentLevel = childIds;
  }

  return ids;
}

/**
 * Get all player IDs scoped to an agent (own + descendants)
 */
export async function getScopedPlayerIds(
  supabase: any,
  agentId: string
): Promise<string[]> {
  const agentIds = await getDescendantAgentIds(supabase, agentId);
  const { data } = await supabase
    .from("users")
    .select("id")
    .in("agent_id", agentIds);

  return (data || []).map((u: any) => u.id);
}

/**
 * Detect if current user is an agent and return agent info
 */
export async function detectAgent(
  supabase: any,
  userId: string
): Promise<Agent | null> {
  const { data } = await supabase
    .from("agents")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .single();

  return data || null;
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/types/agent.ts lib/agent-permissions.ts
git commit -m "feat(agents): add types and permission utilities"
```

---

### Task 3: Agent CRUD API

**Files:**
- Create: `app/api/admin/agents/route.ts`
- Create: `app/api/admin/agents/[id]/route.ts`
- Create: `app/api/admin/agents/[id]/wallet/route.ts`
- Create: `app/api/admin/agents/[id]/players/route.ts`

- [ ] **Step 1: Create agents list + create endpoint** (`route.ts`)

GET: list all agents with player counts, wallet balance
POST: create new agent (creates auth user + agent record + wallet if prepaid)

- [ ] **Step 2: Create agent detail + update endpoint** (`[id]/route.ts`)

GET: agent detail with full info
PUT: update permissions, commission, status, wallet_model

- [ ] **Step 3: Create wallet operations endpoint** (`[id]/wallet/route.ts`)

POST: `{ action: "load" | "unload", amount }` — for prepaid agents

- [ ] **Step 4: Create agent players endpoint** (`[id]/players/route.ts`)

GET: list players belonging to this agent (and descendants)

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/agents/
git commit -m "feat(agents): add CRUD API endpoints"
```

---

### Task 4: Agent Credit API

**Files:**
- Create: `app/api/agent/credit/route.ts`

- [ ] **Step 1: Create credit endpoint**

POST: agent loads/unloads player credit
- Checks agent permissions (`credit: editor`)
- Checks player belongs to agent
- For prepaid: checks agent wallet has enough
- Creates `agent_transactions` record
- Updates player wallet

- [ ] **Step 2: Commit**

```bash
git add app/api/agent/credit/route.ts
git commit -m "feat(agents): add agent credit load/unload API"
```

---

### Task 5: Place-Bet API — Add Betting Permissions + Ticket Limits

**Files:**
- Modify: `app/api/player/place-bet/route.ts`

- [ ] **Step 1: Add betting permissions check**

After auth check, before odds validation:
- Fetch `system_config.betting_permissions`
- Check sport slug not in `disabled_sports`
- Check league_id not in `disabled_leagues`
- Check market_type not in `disabled_market_types`
- Check event_id not in `event_blacklist`

- [ ] **Step 2: Add ticket limits check**

After betting permissions, before wallet check:
- Fetch `system_config.ticket_limits`
- Check stake vs `max_stake_single/multi/system` based on bet type
- Check if current hour is day/night, apply `max_stake_day/night`
- Check `max_potential_win`
- Check `max_daily_bets` (count today's bets)
- Check `max_repeat_bets` (count same selections today)
- Check `max_odds_single/multi`

- [ ] **Step 3: Commit**

```bash
git add app/api/player/place-bet/route.ts
git commit -m "feat(agents): enforce betting permissions and ticket limits in place-bet"
```

---

### Task 6: Admin Panel — Agent Management Pages

**Files:**
- Create: `app/admin/agents/page.tsx`
- Create: `app/admin/agents/[id]/page.tsx`
- Create: `components/admin/agents/agent-list.tsx`
- Create: `components/admin/agents/agent-form.tsx`
- Create: `components/admin/agents/agent-permissions.tsx`
- Create: `components/admin/agents/agent-wallet.tsx`

- [ ] **Step 1: Create agent list component**

Table with: code, name, level badge, status badge, commission %, wallet model, players count, GGR, actions (edit/suspend)

- [ ] **Step 2: Create agent form component**

Form to create/edit agent: name, code, level, parent (dropdown), wallet model, commission %, email+password (for new)

- [ ] **Step 3: Create permissions editor**

Grid with 9 functions × 3 levels (none/viewer/editor) — checkbox/radio matrix

- [ ] **Step 4: Create wallet operations panel**

For prepaid agents: current balance, load/unload form, transaction history

- [ ] **Step 5: Create agent list page** (`agents/page.tsx`)

- [ ] **Step 6: Create agent detail page** (`agents/[id]/page.tsx`)

Tabs: Info | Permessi | Wallet | Giocatori | Transazioni

- [ ] **Step 7: Commit**

```bash
git add app/admin/agents/ components/admin/agents/
git commit -m "feat(agents): add admin panel agent management pages"
```

---

### Task 7: Admin Layout — Dynamic Navigation for Agents

**Files:**
- Modify: `app/admin/layout.tsx`

- [ ] **Step 1: Add agent detection on mount**

On layout mount, check if current user is an agent:
- If super admin: show full NAVIGATION as today
- If agent: build navigation from `buildAgentNavigation(permissions)`
- Add "Agenti" item to SISTEMA section for super admin

- [ ] **Step 2: Add agent routes to NAVIGATION and route map**

```typescript
// In SISTEMA section for super admin:
{ id: "agents", icon: "🏢", label: "Agenti" }

// In route map:
agents: "/admin/agents",
"agent-dashboard": "/admin/agent-dashboard",
```

- [ ] **Step 3: Commit**

```bash
git add app/admin/layout.tsx
git commit -m "feat(agents): dynamic admin navigation for agents"
```

---

### Task 8: Agent Dashboard Page

**Files:**
- Create: `app/admin/agent-dashboard/page.tsx`

- [ ] **Step 1: Create agent dashboard**

Shows when agent logs in:
- KPIs: total players, active players, GGR today/week/month, commission earned
- Recent bets from own players
- Recent credit operations
- Sub-agent summary (if level 1 or 2)

- [ ] **Step 2: Commit**

```bash
git add app/admin/agent-dashboard/page.tsx
git commit -m "feat(agents): add agent's own dashboard page"
```

---

### Task 9: Betting Permissions + Ticket Limits Admin UI

**Files:**
- Create: `app/admin/config/betting-permissions.tsx`
- Create: `app/admin/config/ticket-limits.tsx`

- [ ] **Step 1: Create betting permissions config UI**

In the existing config page, add sections:
- Sport toggle list (enable/disable per sport)
- Market type blacklist (add/remove patterns)
- Event blacklist (add/remove by ID)

- [ ] **Step 2: Create ticket limits config UI**

Form with all limit fields, save to system_config

- [ ] **Step 3: Commit**

```bash
git add app/admin/config/
git commit -m "feat(agents): add betting permissions and ticket limits admin UI"
```

---

### Task 10: Build + Deploy + Verify

- [ ] **Step 1: Run build**

```bash
cd C:\Users\philp\Downloads\vincitu-project\vincitu && npx next build
```

- [ ] **Step 2: Test locally**

- Login as super admin → see Agenti in sidebar
- Create a master agent
- Set permissions
- Login as agent → see scoped view

- [ ] **Step 3: Deploy to VPS**

- [ ] **Step 4: Commit any fixes**
