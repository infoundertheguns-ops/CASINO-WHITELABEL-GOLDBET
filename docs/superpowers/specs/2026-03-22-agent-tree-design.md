# Agent Tree + Roles & Permissions — Design Spec

**Date**: 2026-03-22
**Status**: Draft
**Sub-project**: 1 of 4 (Agent Tree → Player Types → Ticket System → Financial Reporting)

## Overview

Hierarchical agent system with up to 3 levels (Master Agent → Agent → Sub-Agent), granular permissions (functional viewer/editor + betting controls + ticket limits), two wallet models (prepaid/postpaid), and agent access via the existing admin panel with role-based views.

## Agent Hierarchy

```
SUPER ADMIN
├── Master Agent (level 1)
│   ├── Agent (level 2)
│   │   ├── Sub-Agent (level 3)
│   │   │   └── Players (online + kiosk)
│   │   └── Players
│   └── Players
└── Players (no agent)
```

- Max 3 levels below super admin
- Each agent can create agents one level below
- Each agent can create players
- Players without agent are "direct" (managed by super admin)

## Permissions Model

Three categories of permissions, all managed exclusively by the super admin.

### A. Functional Permissions (per agent)

Each function can be: `none` | `viewer` | `editor`

| Function Key | Description |
|---|---|
| `dashboard` | View own KPIs and stats |
| `players` | View/manage own players |
| `sub_agents` | View/manage own sub-agents |
| `credit` | Load/unload player credit at counter |
| `tickets` | View/scan/claim tickets |
| `reports` | View financial reports |
| `commissions` | View commission reports |
| `bets` | View player bets |
| `risk` | View risk alerts for own players |

An agent with `viewer` can see data but not act. With `editor` can perform actions (create players, load credit, claim tickets, etc.). With `none` the section is hidden.

Agents see only their own data and their descendants' data. Never other agents' data.

### B. Betting Permissions (global, set by super admin)

Controls which sports, events, and markets are available for betting. Applied globally — agents inherit these, cannot modify.

| Setting | Description |
|---|---|
| `disabled_sports` | Array of sport slugs excluded from betting |
| `disabled_leagues` | Array of league IDs excluded |
| `disabled_market_types` | Array of market_type patterns excluded (e.g. "Risultato Esatto") |
| `event_blacklist` | Array of event IDs temporarily blocked |

Stored in `system_config` as JSON. The place-bet API checks these before accepting bets.

### C. Ticket Limits (global, set by super admin)

| Setting | Type | Description |
|---|---|---|
| `max_stake_single` | number | Max stake for singola bet |
| `max_stake_multi` | number | Max stake for multipla bet |
| `max_stake_system` | number | Max stake for sistema bet |
| `max_stake_day` | number | Max stake during day hours |
| `max_stake_night` | number | Max stake during night hours |
| `day_hours_start` | string | Day period start (e.g. "08:00") |
| `day_hours_end` | string | Day period end (e.g. "22:00") |
| `max_potential_win` | number | Max potential win per ticket |
| `max_daily_bets` | number | Max bets per player per day |
| `max_repeat_bets` | number | Max identical bets (same selections) |
| `max_odds_single` | number | Max total odds for singola |
| `max_odds_multi` | number | Max total odds for multipla |

Stored in `system_config`. The place-bet API enforces these on every bet.

## Agent Wallet

Two models, configurable per agent by super admin:

### Prepaid Model
- Super admin loads credit to agent's wallet
- Agent distributes credit to players from their wallet
- When agent wallet is empty, cannot load more players
- Agent wallet tracks: `balance`, `total_loaded`, `total_distributed`
- Flow: Super Admin → loads €10K → Agent wallet = €10K → Agent loads player €100 → Agent wallet = €9.9K

### Postpaid Model
- Agent loads/unloads players freely (no wallet limit)
- System tracks all transactions
- At end of period (weekly/monthly), settlement calculates:
  - Total player losses (= agent revenue)
  - Commission due to agent
  - Net balance to settle
- Agent can owe the platform or vice versa

### Database

Agent wallet uses the existing `wallets` table pattern with `owner_type = 'agent'`.

## Database Schema

### `agents` table

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| user_id | UUID FK → auth.users | Login account for this agent |
| parent_id | UUID FK → agents | NULL for master agents (direct under super admin) |
| level | INT | 1 = master, 2 = agent, 3 = sub-agent |
| name | TEXT | Display name |
| code | TEXT UNIQUE | Short code (e.g. "AG001") for identification |
| wallet_model | TEXT | "prepaid" or "postpaid" |
| commission_pct | DECIMAL(5,2) | Commission % on GGR from own players |
| status | TEXT | active / suspended / closed |
| permissions | JSONB | Functional permissions map |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

### `agents` permissions JSONB example

```json
{
  "dashboard": "viewer",
  "players": "editor",
  "sub_agents": "editor",
  "credit": "editor",
  "tickets": "editor",
  "reports": "viewer",
  "commissions": "viewer",
  "bets": "viewer",
  "risk": "none"
}
```

### Modifications to existing tables

**`users` table** — add columns:

| Column | Type | Notes |
|---|---|---|
| player_type | TEXT | "online" / "kiosk" / NULL (for agent accounts) |
| agent_id | UUID FK → agents | Which agent manages this player (NULL = direct/no agent) |

**`wallets` table** — add column:

| Column | Type | Notes |
|---|---|---|
| owner_type | TEXT | "player" (default) / "agent" |

**`system_config`** — add keys:

- `betting_permissions`: JSON with disabled_sports, disabled_leagues, disabled_market_types, event_blacklist
- `ticket_limits`: JSON with all limit values

### `agent_transactions` table

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| agent_id | UUID FK → agents | |
| type | TEXT | "credit_load" / "credit_distribute" / "commission" / "settlement" |
| amount | DECIMAL(12,2) | Positive = credit in, negative = credit out |
| balance_after | DECIMAL(12,2) | Agent wallet balance after this transaction |
| target_user_id | UUID FK | For credit_distribute: which player |
| reference_id | UUID | For commission: period ID; for settlement: settlement ID |
| notes | TEXT | |
| created_at | TIMESTAMPTZ | |

### `agent_settlements` table

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| agent_id | UUID FK → agents | |
| period_start | DATE | |
| period_end | DATE | |
| total_turnover | DECIMAL(12,2) | Sum of all player bets |
| total_winnings | DECIMAL(12,2) | Sum of all player wins |
| ggr | DECIMAL(12,2) | turnover - winnings |
| commission_pct | DECIMAL(5,2) | Agent's commission rate |
| commission_amount | DECIMAL(12,2) | ggr * commission_pct |
| status | TEXT | pending / approved / paid |
| created_at | TIMESTAMPTZ | |

## Admin Panel Integration

Agents log in to the same `/admin` panel. The system checks:

1. Is this user a super admin? → Full access
2. Is this user an agent? → Load agent's permissions → Show only permitted sections
3. Otherwise → Not authorized

### Admin sidebar for agents

The existing `AdminSidebar` reads from `NAVIGATION` config. For agents, the navigation is dynamically built from their permissions JSONB:

```
AGENT VIEW (example with typical permissions):
├── Dashboard (viewer → read-only KPIs)
├── Giocatori (editor → CRUD players, load credit)
├── Sub-Agenti (editor → CRUD sub-agents)
├── Scommesse (viewer → view bets)
├── Ticket (editor → scan, claim)
├── Report (viewer → view financial reports)
└── Commissioni (viewer → view own commissions)
```

Sections with `none` permission are hidden. Sections with `viewer` show data without action buttons. Sections with `editor` show full CRUD.

### Data scoping

Every query in agent view is scoped:
- Agent sees only players where `users.agent_id = agent.id` OR `users.agent_id IN (select id from agents where parent_id = agent.id)` (recursive for descendants)
- Agent sees only bets from their players
- Agent sees only financial data from their players

## API Changes

### New endpoints

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/api/admin/agents` | GET | super_admin | List all agents |
| `/api/admin/agents` | POST | super_admin | Create agent |
| `/api/admin/agents/[id]` | GET | super_admin / self | Agent detail |
| `/api/admin/agents/[id]` | PUT | super_admin | Update agent (permissions, commission, status) |
| `/api/admin/agents/[id]/wallet` | POST | super_admin | Load/unload agent wallet (prepaid) |
| `/api/admin/agents/[id]/players` | GET | super_admin / self | Agent's players |
| `/api/admin/agents/[id]/settlements` | GET | super_admin / self | Agent's commission settlements |
| `/api/agent/credit` | POST | agent (editor:credit) | Load/unload player credit |
| `/api/agent/tickets/verify` | POST | agent (editor:tickets) | Verify ticket by QR/barcode |
| `/api/agent/tickets/claim` | POST | agent (editor:tickets) | Mark ticket as claimed (paid) |

### Modified endpoints

| Endpoint | Change |
|---|---|
| `/api/player/place-bet` | Check betting_permissions + ticket_limits before accepting |
| `/api/auth/login` | Return agent info if user is an agent |

## Agent Onboarding Flow

1. Super admin creates agent account in admin panel
2. System creates: auth user + agent record + wallet (if prepaid)
3. Super admin sets permissions, commission %, wallet model
4. Agent logs in to `/admin` → sees their scoped view
5. Agent creates players (or sub-agents if level permits)
6. For kiosk players: agent loads credit at counter
7. For online players: player deposits via crypto or agent loads credit

## Out of Scope (for this spec)

- Player types (online vs kiosk) — spec 2
- Ticket system (print, QR, scan) — spec 3
- Financial reporting dashboard — spec 4
- Commission auto-calculation cron
- Agent API rate limiting
- Agent audit log (uses existing audit_log table)
