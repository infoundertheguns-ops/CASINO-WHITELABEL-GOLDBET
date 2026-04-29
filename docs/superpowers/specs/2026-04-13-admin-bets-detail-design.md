# Admin Bets Detail & Global List Design

**Date**: 2026-04-13
**Project**: betssolution-admin
**Status**: Approved by user, ready for implementation plan

---

## 1. Goal

Add to the admin a comprehensive read-only view of player bets:
- **Global bets list** for super_admin with advanced filters, search, export
- **Single bet detail page** with all info (selections, kiosk/agent origin, IP, risk flags, event log)
- **Improve existing agent-bets page** to share filters and link to detail

Strictly **read-only** in v1 (no manual void, settle, refund — those are v2 candidates).

## 2. Decisions (recap)

| Aspect | Choice |
|---|---|
| Scope | Read-only (option A) |
| Pages | New `/admin/bets` (list) + `/admin/bets/[id]` (detail) + improved `/admin/agent-bets` |
| Permission | super_admin sees all; agent sees only own network's bets (`bets.kiosk_id → kiosks.agent_id == current_agent_id`) |
| Refresh | Polling 30s (no SSE in v1) |
| Event log | Derived from existing timestamp columns (no new table) |
| Export | CSV, max 10k rows per request |

## 3. Architecture

### 3.1 Pages (3)

- `/admin/bets` — global list (super_admin only via sidebar; agent role redirected to `/admin/agent-bets`)
- `/admin/bets/[id]` — detail (both roles, scoped by permission)
- `/admin/agent-bets` — existing, refactored to call same API as global list with forced agent scope

### 3.2 Reusable components (`components/admin/bets/`)

- `BetCard.tsx` — header with stake/payout/status/timestamps/badges
- `BetSelections.tsx` — table of legs with event/market/outcome/odds@placement/current odds/result. Supports sport, ippica, ippica_tote sources.
- `BetMetadata.tsx` — IP, fingerprint, kiosk, agent, time_to_kickoff
- `BetRiskPanel.tsx` — risk_score badge, flags array, acceptance flow (requested vs accepted stake, mode, note)
- `BetEventLog.tsx` — vertical timeline placed → accepted → settled (derived from timestamps)
- `BetsTable.tsx` — sortable, filterable, paginated row list with click-to-detail
- `BetsFilters.tsx` — filter toolbar
- `BetsKpiCards.tsx` — aggregates row (count, stake, payout, GGR, open count)

### 3.3 API endpoints (3 new)

- `GET /api/admin/bets` — list with filters + KPI aggregates
- `GET /api/admin/bets/[id]` — single bet full detail with joins
- `GET /api/admin/bets/export.csv` — CSV export with same filters as list, max 10k rows

## 4. API contracts

### 4.1 `GET /api/admin/bets`

**Query params**:
- `status`: `all|open|won|lost|void|pending|rejected`
- `from`, `to`: ISO date
- `kiosk_id`, `agent_id`, `user_id`: UUID
- `sport`: catch-all sport types (calcio, basket, ippica, ecc.)
- `min_stake`, `max_stake`: numeric
- `is_live`: boolean
- `risk_min`, `risk_max`: 0–100
- `search`: full-text on `users.username`, short bet ID, kiosk code
- `sort`: `created_at|stake|payout`
- `dir`: `asc|desc`
- `limit`, `offset`: max 200/page

**Response**:
```json
{
  "bets": [
    {
      "id": "uuid",
      "code": "short readable code",
      "user": { "username": "...", "id": "uuid" },
      "kiosk": { "code": "...", "name": "..." },
      "agent": { "name": "...", "code": "..." },
      "bet_type": "single|multi|system",
      "stake": 50.0,
      "potential_win": 92.50,
      "actual_win": 92.50,
      "total_odds": 1.85,
      "status": "won",
      "is_live": false,
      "selections_count": 1,
      "risk_score": 42,
      "created_at": "...",
      "settled_at": "..."
    }
  ],
  "total": 12345,
  "aggregates": {
    "total_stake": 234567.89,
    "total_payout": 189876.54,
    "ggr_pct": 22.1,
    "open_count": 432
  }
}
```

**Permission logic**:
```
if userRole === 'agent':
  filters.agent_id = currentAgentId  // forced override
  // (sub-agent network expansion: out of scope v1)
// super_admin: no scope override
```

### 4.2 `GET /api/admin/bets/[id]`

**Response**:
```json
{
  "bet": { ...all bet table columns },
  "user": { "username", "id", "kyc_status", "country" },
  "kiosk": { "code", "name", "agent_id" },
  "agent": { "name", "code", "level" },
  "selections": [
    {
      "id": "uuid",
      "event": { "name", "league", "sport" },
      "market": { "type", "label" },
      "outcome": { "name" },
      "odds_at_placement": 1.85,
      "current_odds": 2.10,
      "result": "won|lost|void|null",
      "settled_at": "...",
      "source": "sport|ippica|ippica_tote"
    }
  ],
  "children_combos": [...],
  "risk": {
    "score": 42,
    "flags": ["stake_high", "fast_velocity"],
    "acceptance_mode": "auto|manual",
    "acceptance_note": "..."
  },
  "event_log": [
    { "ts": "...", "event": "placed", "actor": "player", "data": {} },
    { "ts": "...", "event": "accepted", "actor": "system|admin", "data": {} },
    { "ts": "...", "event": "settled", "actor": "system", "data": {} }
  ]
}
```

**Event log derivation** (no new table):
- `placed` ← `bets.created_at`, actor = `player`, data = `{ requested_stake, ip_address }`
- `accepted` ← `bets.reviewed_at` (or `created_at` if null), actor from `accepted_by`, data = `{ accepted_stake, acceptance_mode }`
- `settled` ← `bets.settled_at` if present, actor = `system`, data = `{ status, actual_win }`

### 4.3 `GET /api/admin/bets/export.csv`

Same filters as list. Streams CSV with columns: `id, created_at, username, kiosk_code, agent_code, bet_type, stake, total_odds, potential_win, actual_win, status, risk_score, selections_count`. Hard cap 10k rows; if filter yields more, returns 422 with hint to narrow filters.

## 5. UI specifications

### 5.1 List page `/admin/bets`

```
┌─────────────────────────────────────────────────────────────────┐
│  SCOMMESSE                                  [Esporta CSV]       │
├─────────────────────────────────────────────────────────────────┤
│  🎯 12.345 bets    💰 €234k stake    📈 €189k payout    GGR 22% │
├─────────────────────────────────────────────────────────────────┤
│  [Status ▼] [Periodo ▼] [Sport ▼] [Kiosk ▼] [Agent ▼]          │
│  [€ min] [€ max] [Risk min] [Risk max] [☑ Live]                │
│  [🔍 cerca username/codice/kiosk........]    [Reset]            │
├─────────────────────────────────────────────────────────────────┤
│  ID │ Data │ Player │ Kiosk │ Tipo │ Stake │ Quota │ Payout │ Status │ Risk │
├─────┼──────┼────────┼───────┼──────┼───────┼───────┼────────┼────────┼──────┤
│ a3f │ ...  │ mario  │ 167.. │ multi│ €10   │ 5.20  │ €52    │ 🔵open │ 🟢15 │
│ ... (clic riga → /admin/bets/[id])                                       │
├─────────────────────────────────────────────────────────────────┤
│  ◀ Pag 1 di 247    ▶                          [50 per pagina ▼] │
└─────────────────────────────────────────────────────────────────┘
```

**Behaviour**:
- KPI row reflects filters (not just visible page)
- Row click → push `/admin/bets/[id]`
- Sort by header click
- Status badge colors: open=blue, won=green, lost=red, void=grey, pending=orange, rejected=red
- Risk score badge proportional: 0–30 green, 31–60 yellow, 61–100 red
- Auto-refresh toggle (default ON, every 30s)
- URL state for filters/page (`?status=won&sport=calcio&page=3`) for shareable links

### 5.2 Detail page `/admin/bets/[id]`

```
┌────────────────────────────────────────────────────────────────────┐
│  ← Indietro                                  Bet ID: a3f7…b9c2 📋 │
├────────────────────────────────────────────────────────────────────┤
│  HEADER (BetCard)                                                  │
│    Status badge | stake | quota | payout | tipo | live | free bet  │
│    Created at — Settled at                                         │
├────────────────────────────────────────────────────────────────────┤
│  📋 SELEZIONI (BetSelections)                                      │
│    Per leg: evento, mercato, outcome, odds@placement, current,     │
│    result, settled_at, source                                      │
├────────────────────────────────────────────────────────────────────┤
│  👤 PLAYER             |   🖥️ KIOSK & AGENT                        │
│    username, kyc, IT   |     kiosk code/name, agent name/code      │
├────────────────────────────────────────────────────────────────────┤
│  🌐 METADATA           |   🛡️ RISK                                  │
│    IP, fingerprint     |     score badge, flags, acceptance mode  │
│    time_to_kickoff     |     acceptance_note                       │
├────────────────────────────────────────────────────────────────────┤
│  📜 EVENT LOG (BetEventLog)                                        │
│    Vertical timeline of placed → accepted → settled                │
└────────────────────────────────────────────────────────────────────┘
```

**For multi/system bets**: SELEZIONI shows all legs in table; below appears "COMBINAZIONI VINCENTI" listing child bets with their individual outcome.

**For ippica bets**: selection row shows `🐎 Race name — meeting (date)` instead of sport event, with horse number + market type (vincente/piazzato/tris).

## 6. Modifications to existing pages

### 6.1 `app/admin/agent-bets/page.tsx`
- Refactor to call `/api/admin/bets` (with backend-forced agent scope)
- Add filters: kiosk, sport, min/max stake, search
- Add link from each row to `/admin/bets/[id]`
- Keep existing visual style (no breaking redesign)

### 6.2 `app/admin/layout.tsx`
- NAVIGATION: super_admin "Scommesse" item — change route from `/admin/sportsbook?tab=bets` to `/admin/bets`
- Keep `/admin/sportsbook` accessible (its events + settlement tabs are still useful)

## 7. Out of scope (v1 — explicit)

- Manual actions on bet (void, settle, refund, cashout) → v2
- Real-time SSE/websocket for new bets → polling 30s sufficient
- Bet replay / full audit log → v2 with new `bet_event_log` table
- Hierarchical agent scope (sub-agent of sub-agent) → v2
- Toggle column visibility → v2 if needed
- Per-user saved filter presets → v2

## 8. Files produced

```
NEW:
  app/admin/bets/page.tsx
  app/admin/bets/[id]/page.tsx
  app/api/admin/bets/route.ts
  app/api/admin/bets/[id]/route.ts
  app/api/admin/bets/export/route.ts
  components/admin/bets/BetCard.tsx
  components/admin/bets/BetSelections.tsx
  components/admin/bets/BetMetadata.tsx
  components/admin/bets/BetRiskPanel.tsx
  components/admin/bets/BetEventLog.tsx
  components/admin/bets/BetsTable.tsx
  components/admin/bets/BetsFilters.tsx
  components/admin/bets/BetsKpiCards.tsx
  lib/types/bets-admin.ts

MODIFY:
  app/admin/agent-bets/page.tsx
  app/admin/layout.tsx
```

## 9. Schema relied upon (verified 2026-04-13)

- `bets`: id, user_id, bet_type, stake, total_odds, potential_win, actual_win, status, is_live, is_free_bet, free_bet_id, selections_count, ip_address, risk_score, risk_flags, settled_at, created_at, requested_stake, accepted_stake, acceptance_mode, accepted_by, acceptance_note, reviewed_at, placed_ip, placed_fingerprint, time_to_kickoff_minutes, parent_bet_id, combo_type, combo_count, combos_won, kiosk_id
- `bet_selections`: bet_id, event_id, market_id, outcome_id, odds_at_placement, result, settled_at, source (sport|ippica|ippica_tote), ippica_*_id
- Joins to: `users` (username, kyc), `kiosks` (code, name, agent_id), `agents` (name, code, level), `events`/`markets`/`outcomes` (sport leg names), `ippica_*` (ippica leg names)

No schema changes required.

## 10. Open risks / decisions deferred

- Performance of large-result queries (e.g. agent network with 100k+ bets): index on `bets(created_at DESC)` exists; no covering index for combined filters. If slow in practice, add composite indexes after measurement.
- "Current odds" for selections is best-effort (live odds may have moved or market closed). When unavailable, show `—`.
- Risk flag labels: assume the flag strings stored in `risk_flags` are already user-friendly enough; no translation table planned for v1.
