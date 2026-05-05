# Event-v2 multi-sport extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the v2 event detail page rendering to all 12 sports residual after calcio/tennis/basket, via a centralized `TITLE_OVERRIDES_BY_SPORT` registry refactor + per-sport tab/title configs + dummy-data smoke + batch flag flip.

**Architecture:** Frontend-only data config. Refactor B (centralize title overrides into `market-config-v2.ts`) → 12 per-sport config blocks → seed dummy events for sports with insufficient real coverage → build + flag flip + smoke + bugfix → cleanup dummy.

**Tech Stack:** TypeScript, React, Next.js (player kiosk), Supabase REST + service-role for dummy seed/cleanup, systemd services on VPS, manual deploy gotchas (symlink + standalone copy).

**Spec:** `docs/superpowers/specs/2026-05-05-event-v2-multi-sport-design.md`

**Working tree note:** the player codebase lives at `/root/betssolution-player/` on `scraper-vps` and is **NOT git-tracked**. All edits are made directly on VPS via `ssh scraper-vps '...'`. Modified files are mirrored to admin git at `docs/superpowers/artifacts/2026-05-05-event-v2-multi-sport/player/<relative-path>` and committed there for tracking.

---

## Pre-flight

- [ ] **Step 0a: Verify branch + VPS state**

```bash
ssh scraper-vps "systemctl is-active betssolution-player; \
  cat /root/betssolution-player/.next/BUILD_ID; \
  grep NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS /root/betssolution-player/.env.local"
cd C:/Users/philp/Documents/Project/betssolution-admin-plan-d && git rev-parse --abbrev-ref HEAD && git log --oneline -3
```

Expected:
- Service `active`
- BUILD_ID `FdvLEwTr2feBMgqDRcNEn` (basket end-of-session) or newer
- Flag `=calcio,tennis,basket`
- Branch `feature/plan-d-settlement-d1`
- HEAD includes `85fd6bf spec: tighten multi-sport — concrete flag list + alias map + dummy threshold`

If divergence — investigate before proceeding.

- [ ] **Step 0a-bis: Verify which alias slugs are actually populated**

Spec Section 3 Step 7 lists alias slugs (e.g. esports has 10 aliases). Verify which actually exist in `events.sport.slug` (legacy table — that's what the flag matches against):

```bash
ssh scraper-vps "
KEY=\$(grep SUPABASE_SERVICE_ROLE_KEY /root/betssolution-player/.env.local | cut -d= -f2)
URL=\$(grep NEXT_PUBLIC_SUPABASE_URL /root/betssolution-player/.env.local | cut -d= -f2)
python3 << 'PY'
import urllib.request, json, collections, subprocess
KEY = subprocess.check_output(['bash','-c','grep SUPABASE_SERVICE_ROLE_KEY /root/betssolution-player/.env.local | cut -d= -f2']).decode().strip()
URL = subprocess.check_output(['bash','-c','grep NEXT_PUBLIC_SUPABASE_URL /root/betssolution-player/.env.local | cut -d= -f2']).decode().strip()
counter = collections.Counter()
for offset in range(0, 30000, 1000):
    req = urllib.request.Request(
        f'{URL}/rest/v1/events?select=sport_id&order=id.asc',
        headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Range': f'{offset}-{offset+999}'}
    )
    rows = json.loads(urllib.request.urlopen(req).read())
    for r in rows: counter[r['sport_id']] += 1
    if len(rows) < 1000: break
# Now lookup sport.slug for each sport_id seen
ids = list(counter.keys())
req = urllib.request.Request(
    f'{URL}/rest/v1/sports?select=id,slug&id=in.({\",\".join(map(str,ids))})',
    headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}'}
)
slug_map = {r['id']: r['slug'] for r in json.loads(urllib.request.urlopen(req).read())}
slug_counter = collections.Counter()
for sid, n in counter.items():
    slug_counter[slug_map.get(sid, f'unknown:{sid}')] = n
for s,n in slug_counter.most_common():
    print(f'  {s:30s} {n:5d}')
PY
"
```

Document any unpopulated alias slugs from the spec table inline. Final flag value (Phase 5 Task 21) can drop unpopulated aliases without breaking anything (registry registration is harmless dead config), but pruning saves ENV string length.

- [ ] **Step 0a-ter: Note pre-existing tsc baseline errors**

```bash
ssh scraper-vps "cd /root/betssolution-player && npx tsc --noEmit -p tsconfig.json 2>&1 | tail -20"
```

Record baseline error count + identifiers (memory mentions a B2 pre-existing error in `resolve-flashscore-id.test.ts:66` from earlier session). Throughout Phase 1-2, after each `tsc` step, the count must equal baseline (no NEW errors introduced).

- [ ] **Step 0b: Create artifacts mirror directory**

```bash
mkdir -p C:/Users/philp/Documents/Project/betssolution-admin-plan-d/docs/superpowers/artifacts/2026-05-05-event-v2-multi-sport/player/lib
mkdir -p C:/Users/philp/Documents/Project/betssolution-admin-plan-d/docs/superpowers/artifacts/2026-05-05-event-v2-multi-sport/player/app/\(kiosk\)/event/\[eventId\]
mkdir -p C:/Users/philp/Documents/Project/betssolution-admin-plan-d/docs/superpowers/artifacts/2026-05-05-event-v2-multi-sport/scripts
```

---

## Phase 1 — Refactor B (centralize title overrides)

### Task 1: Read current state

**Files:**
- Read: `lib/market-config-v2.ts` (player VPS)
- Read: `app/(kiosk)/event/[eventId]/page-v2.tsx` (player VPS)

- [ ] **Step 1a: Snapshot current market-config-v2.ts**

```bash
ssh scraper-vps "cat /root/betssolution-player/lib/market-config-v2.ts" > /tmp/market-config-v2.before.ts
wc -l /tmp/market-config-v2.before.ts  # expect 307
```

- [ ] **Step 1b: Snapshot current page-v2.tsx (excerpt)**

```bash
ssh scraper-vps "sed -n '188,260p' /root/betssolution-player/app/\\(kiosk\\)/event/\\[eventId\\]/page-v2.tsx"
```

Confirm `BASKET_TITLE_OVERRIDES` (~18 entries) and `resolveBasketOverride()` exist. Note their exact line ranges for surgical edits later.

### Task 2: Add `TITLE_OVERRIDES_BY_SPORT` to market-config-v2.ts (basket migrated)

**Files:**
- Modify: `/root/betssolution-player/lib/market-config-v2.ts` (append at end of file before final exports, or near the existing registries)

- [ ] **Step 2a: Append registry + helper**

Append to the end of `market-config-v2.ts` (verify no duplicate definitions):

```ts

// === Title overrides per-sport ===
// Keyed on the sport_slug as it arrives in titleFor(m, sportSlug). Returns the
// IT-friendly label for a given DB market_type, or null when no override exists.
// Migrated from page-v2.tsx (was BASKET_TITLE_OVERRIDES + resolveBasketOverride).

export const TITLE_OVERRIDES_BY_SPORT: Record<string, Record<string, string>> = {
  basket: {
    "1X2 Tempo Regolamentare": "Vincente Tempi Regolamentari",
    "U/O Incl. Supp.": "Under/Over (con OT)",
    "ML 1Q": "Vincente 1° Quarto",
    "ML 2Q": "Vincente 2° Quarto",
    "ML 3Q": "Vincente 3° Quarto",
    "ML 4Q": "Vincente 4° Quarto",
    "Spread 1Q": "Handicap 1° Quarto",
    "Spread 2Q": "Handicap 2° Quarto",
    "Spread 3Q": "Handicap 3° Quarto",
    "Spread 4Q": "Handicap 4° Quarto",
    "1X2 - 1Q": "1X2 1° Quarto",
    "Player Points Milestones": "Punti Giocatore - Oltre",
    "Player Rebounds Milestones": "Rimbalzi Giocatore - Oltre",
    "Player Threes Milestones": "Triple Giocatore - Oltre",
    "Player Assists Milestones": "Assist Giocatore - Oltre",
    "Player First Basket": "Primo Canestro",
    "Player First Assist": "Primo Assist",
    "Player First Rebound": "Primo Rimbalzo",
  },
  // 12 new sports populated by tasks 6-17.
};

export function resolveTitleOverride(
  sportSlug: string,
  marketType: string,
): string | null {
  const map = TITLE_OVERRIDES_BY_SPORT[sportSlug];
  return map?.[marketType] ?? null;
}
```

Done via heredoc:
```bash
ssh scraper-vps "cat >> /root/betssolution-player/lib/market-config-v2.ts << 'EOF'

// === Title overrides per-sport ===
[paste full block above]
EOF"
```

- [ ] **Step 2b: Verify syntax (no build yet, just `tsc --noEmit` if available)**

```bash
ssh scraper-vps "cd /root/betssolution-player && npx tsc --noEmit -p tsconfig.json 2>&1 | head -20"
```

Expected: 0 errors. Pre-existing errors (if any) unchanged from baseline.

### Task 3: Update page-v2.tsx to use centralized helper

**Files:**
- Modify: `/root/betssolution-player/app/(kiosk)/event/[eventId]/page-v2.tsx`

- [ ] **Step 3a: Backup before edit**

```bash
ssh scraper-vps "cp /root/betssolution-player/app/\\(kiosk\\)/event/\\[eventId\\]/page-v2.tsx \
  /root/betssolution-player/app/\\(kiosk\\)/event/\\[eventId\\]/page-v2.tsx.bak-pre-multisport"
```

- [ ] **Step 3b: Add import for resolveTitleOverride**

Edit the existing import line that imports from `@/lib/market-config-v2` (locate via `grep -n "market-config-v2" page-v2.tsx`). Append `resolveTitleOverride` to the imported names.

- [ ] **Step 3c: Remove `BASKET_TITLE_OVERRIDES` const + `resolveBasketOverride` function**

In `page-v2.tsx`, locate:
```ts
const BASKET_TITLE_OVERRIDES: Record<string, string> = {
  ...18 entries...
};
```
and
```ts
function resolveBasketOverride(marketType: string): string | null {
  const v = BASKET_TITLE_OVERRIDES[marketType];
  return v ? v.toUpperCase() : null;
}
```

**DO NOT use `sed` for this — the override values contain object-literal-like syntax and sed range matching is fragile against the closing `};` of the const.**

Recommended approach: scp the file locally, edit with the Edit tool, scp back:
```bash
scp "scraper-vps:/root/betssolution-player/app/(kiosk)/event/[eventId]/page-v2.tsx" /tmp/page-v2.tsx
# Edit tool removes the const and the function precisely
scp /tmp/page-v2.tsx "scraper-vps:/root/betssolution-player/app/(kiosk)/event/[eventId]/page-v2.tsx"
```

- [ ] **Step 3d: Replace branch in `titleFor()`**

Find the block:
```ts
function titleFor(m: DbMarket, sportSlug?: string): string {
  if (sportSlug === "basket") {
    const override = resolveBasketOverride(m.market_type);
    if (override) {
      if (m.line == null) return override;
      if (NO_LINE_TITLE_TYPES.has(m.market_type)) return override;
      const lineStr = Number.isInteger(m.line) ? String(m.line) : String(m.line);
      return override + ' ' + lineStr;
    }
  }
  ...
```

Replace with sport-agnostic version:
```ts
function titleFor(m: DbMarket, sportSlug?: string): string {
  if (sportSlug) {
    const override = resolveTitleOverride(sportSlug, m.market_type);
    if (override) {
      const overrideUC = override.toUpperCase();
      if (m.line == null) return overrideUC;
      if (NO_LINE_TITLE_TYPES.has(m.market_type)) return overrideUC;
      const lineStr = String(m.line);
      return overrideUC + ' ' + lineStr;
    }
  }
  ...
```

- [ ] **Step 3e: Replace `resolveBasketOverride` call sites in `renderGroupedMarket`**

Find every remaining reference to `resolveBasketOverride` (probably in `renderGroupedMarket` for `@picker` markets). Each call:
```ts
const override = resolveBasketOverride(m.market_type);
```
becomes:
```ts
const override = sportSlug ? (resolveTitleOverride(sportSlug, m.market_type)?.toUpperCase() ?? null) : null;
```

Verify zero remaining references:
```bash
ssh scraper-vps "grep -n 'resolveBasketOverride\|BASKET_TITLE_OVERRIDES' /root/betssolution-player/app/\\(kiosk\\)/event/\\[eventId\\]/page-v2.tsx"
```

Expected: empty output.

- [ ] **Step 3f: Verify TS compiles**

```bash
ssh scraper-vps "cd /root/betssolution-player && npx tsc --noEmit -p tsconfig.json 2>&1 | head -20"
```

Expected: 0 errors related to titleFor / resolveBasketOverride.

### Task 4: Build, deploy, smoke baseline (basket regression check)

- [ ] **Step 4a: Build**

```bash
ssh scraper-vps "cd /root/betssolution-player && npm run build 2>&1 | tail -20"
```

Expected: "Compiled successfully" + new BUILD_ID.

- [ ] **Step 4b: Standalone copy + symlink**

```bash
ssh scraper-vps "cp -r /root/betssolution-player/.next/static /root/betssolution-player/.next/standalone/.next/ && \
  cp -r /root/betssolution-player/public /root/betssolution-player/.next/standalone/ && \
  ln -sf /root/betssolution-player/.env.local /root/betssolution-player/.next/standalone/.env.local && \
  systemctl restart betssolution-player && sleep 3 && \
  systemctl is-active betssolution-player && \
  cat /root/betssolution-player/.next/BUILD_ID && \
  curl -s -o /dev/null -w 'health %{http_code}\n' http://localhost:3001/api/health"
```

Expected: `active`, new BUILD_ID, `health 200`.

- [ ] **Step 4c: USER smoke baseline — basket event**

User opens 1 basket event on kiosk and verifies:
- Tab "Principali" shows hero (T/T or 1X2 TR per existing config)
- Player tab sub-pills (Punti/Rimbalzi/etc.) show overrides correctly ("PUNTI GIOCATORE - OLTRE 5" etc.)
- "VINCENTE TEMPI REGOLAMENTARI" appears for the 1X2 TR market

If any regression → STOP, restore backup `page-v2.tsx.bak-pre-multisport`, debug.

### Task 5: Mirror & commit refactor B

- [ ] **Step 5a: Pull modified files to admin mirror**

```bash
scp scraper-vps:/root/betssolution-player/lib/market-config-v2.ts \
  C:/Users/philp/Documents/Project/betssolution-admin-plan-d/docs/superpowers/artifacts/2026-05-05-event-v2-multi-sport/player/lib/market-config-v2.ts
scp "scraper-vps:/root/betssolution-player/app/(kiosk)/event/[eventId]/page-v2.tsx" \
  "C:/Users/philp/Documents/Project/betssolution-admin-plan-d/docs/superpowers/artifacts/2026-05-05-event-v2-multi-sport/player/app/(kiosk)/event/[eventId]/page-v2.tsx"
```

- [ ] **Step 5b: Commit refactor B**

```bash
cd C:/Users/philp/Documents/Project/betssolution-admin-plan-d
git add docs/superpowers/artifacts/2026-05-05-event-v2-multi-sport/
git commit -m "refactor: centralize title overrides in TITLE_OVERRIDES_BY_SPORT (basket migrated)"
```

---

## Phase 2 — Per-sport configs (12 sports)

Each sport task follows the SAME pattern:

1. Survey market_types in DB
2. Decide tab structure (mirror legacy `LIVE_DETAIL_TABS` if present, else design from template)
3. Author 4 const in `market-config-v2.ts`: `XSPORT_TAB_MARKETS_V2`, `XSPORT_TAB_ORDER`, `XSPORT_DEFAULT_SUB_PILL`, plus entry into `TITLE_OVERRIDES_BY_SPORT[<slug>]`
4. Register in 3 registries for ALL DB-slug aliases (per spec Section 3 Step 7)
5. `tsc --noEmit` clean
6. Mirror to artifacts + commit

**Template — sport task generic structure (used as macro for tasks 6-17):**

```bash
# 1. Survey
ssh scraper-vps "
KEY=\$(grep SUPABASE_SERVICE_ROLE_KEY /root/betssolution-player/.env.local | cut -d= -f2)
URL=\$(grep NEXT_PUBLIC_SUPABASE_URL /root/betssolution-player/.env.local | cut -d= -f2)
python3 << 'PY'
import urllib.request, json, collections, subprocess
KEY = subprocess.check_output(['bash','-c','grep SUPABASE_SERVICE_ROLE_KEY /root/betssolution-player/.env.local | cut -d= -f2']).decode().strip()
URL = subprocess.check_output(['bash','-c','grep NEXT_PUBLIC_SUPABASE_URL /root/betssolution-player/.env.local | cut -d= -f2']).decode().strip()
counter = collections.Counter()
SPORT = '<SPORT_SLUG_EVENTS_V2>'  # e.g. 'baseball'
for offset in range(0, 100000, 1000):
    req = urllib.request.Request(
        f'{URL}/rest/v1/v_player_markets?select=market_type&sport_slug=eq.{SPORT}&order=market_type.asc',
        headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Range': f'{offset}-{offset+999}'}
    )
    rows = json.loads(urllib.request.urlopen(req).read())
    for r in rows: counter[r['market_type']] += 1
    if len(rows) < 1000: break
for mt, n in counter.most_common(): print(f'  {mt:50s} {n:6d}')
PY
"

# 2. Edit /root/betssolution-player/lib/market-config-v2.ts via Edit tool
#    Adds: XSPORT_TAB_MARKETS_V2, XSPORT_TAB_ORDER, XSPORT_DEFAULT_SUB_PILL
#    Plus: TITLE_OVERRIDES_BY_SPORT[<slug>] entries

# 3. Register all aliases (per Sezione 3 Step 7 spec table)

# 4. tsc check
ssh scraper-vps "cd /root/betssolution-player && npx tsc --noEmit -p tsconfig.json 2>&1 | head -10"

# 5. Mirror + commit
scp scraper-vps:/root/betssolution-player/lib/market-config-v2.ts \
  C:/Users/philp/Documents/Project/betssolution-admin-plan-d/docs/superpowers/artifacts/2026-05-05-event-v2-multi-sport/player/lib/market-config-v2.ts
cd C:/Users/philp/Documents/Project/betssolution-admin-plan-d
git add docs/superpowers/artifacts/2026-05-05-event-v2-multi-sport/
git commit -m "config: event-v2 <sport> tab structure + title overrides + alias registration"
```

### Task 6: baseball

**DB-slug aliases:** `baseball`
**Hero:** T/T Match (2-way)
**Tab structure**: derive from survey. Likely tabs: ["Mercati Principali", "U/O", "Handicap", "Innings", "Player", "Altri"]. baseball has rich Player props (batter/pitcher milestones).

- [ ] Step 6a: Survey market_types
- [ ] Step 6b: Author config in market-config-v2.ts
- [ ] Step 6c: Register `TAB_MARKETS_BY_SPORT["baseball"]`, `TAB_ORDER_BY_SPORT["baseball"]`, `DEFAULT_SUB_PILL_BY_SPORT["baseball"]`, `TITLE_OVERRIDES_BY_SPORT["baseball"]`
- [ ] Step 6d: tsc clean
- [ ] Step 6e: Mirror + commit

### Task 7: esports

**DB-slug aliases:** `esports`, `dota`, `dota-2`, `counter-strike`, `valorant`, `league-of-legends`, `rainbow-six`, `call-of-duty`, `honor-of-kings`, `e-basketball`
**Hero:** T/T Match (2-way)
**Tab structure**: legacy `LIVE_DETAIL_TABS.eleague = ["Mercati Principali", "Under/Over", "Altro"]`. Mirror.

- [ ] Step 7a-e (template above)
- [ ] **N.B.**: register all 10 aliases (loop in code if compact, or 10 explicit lines)

### Task 8: handball

**DB-slug aliases:** `pallamano`
**Hero:** 1X2 Tempo Regolamentare (3-way)
**Tab structure**: not in legacy; design from template `["Mercati Principali", "U/O", "Handicap", "Tempi", "Player", "Altri"]`. handball has 1X2 TR + ML (T/T) per mig 171/172.

- [ ] Step 8a-e

### Task 9: ice-hockey

**DB-slug aliases:** `hockey-ghiaccio`
**Hero:** 1X2 Tempo Regolamentare (3-way per mig 167-169)
**Tab structure**: legacy `LIVE_DETAIL_TABS.icehockey = ["Mercati Principali", "Under/Over", "Periodi", "Altro"]`. Mirror.

- [ ] Step 9a-e

### Task 10: volleyball

**DB-slug aliases:** `pallavolo`, `volley`
**Hero:** T/T Match (2-way, no draw)
**Tab structure**: not in legacy. Template `["Mercati Principali", "Set", "U/O Punti", "Handicap", "Altri"]`.
**Note**: volley also has primary "Esito Finale 1X2" gap noted in memory (odds-api doesn't provide 3-Way for volley) — config should not assume 1X2 exists.

- [ ] Step 10a-e

### Task 11: darts

**DB-slug aliases:** `freccette`
**Hero:** T/T Match (2-way)
**Tab structure**: legacy `LIVE_DETAIL_TABS.darts = ["Mercati Principali", "Set/Leg", "Altro"]`. Mirror.

- [ ] Step 11a-e

### Task 12: rugby

**DB-slug aliases:** `rugby`, `rugby-league`, `rugby-union`, `rugby-sevens`
**Hero:** runtime decision — 1X2 if outcomes [1,X,2] present, else T/T (per spec section 3 hero table)
**Tab structure**: not in legacy. Template `["Mercati Principali", "U/O Punti", "Handicap", "Tempi", "Player", "Altri"]`. Player tab includes "Try Scorer" markets.
**Note**: per memory mig 171, rugby ML stays 2-way (no draw exposed), so 1X2 is rare → T/T fallback handles most cases.

- [ ] Step 12a-e

### Task 13: cricket

**DB-slug aliases:** `cricket`
**Hero:** T/T Match (2-way for T20/ODI)
**Tab structure**: not in legacy. Template `["Mercati Principali", "U/O", "Player", "Altri"]`. cricket has rich player props (Top Batsman, Top Bowler).

- [ ] Step 13a-e

### Task 14: boxing

**DB-slug aliases:** `boxe`, `pugilato`
**Hero:** T/T Match (2-way)
**Tab structure**: legacy `LIVE_DETAIL_TABS.boxing = ["Mercati Principali", "Altro"]`. Mirror; minimal config (Tier B per spec).
**Method markets**: Method of Victory (KO/TKO/Decision) → put under "Mercati Principali" if present.

- [ ] Step 14a-e

### Task 15: mma

**DB-slug aliases:** `mma`, `arti-marziali`, `martial-arts`
**Hero:** T/T Match (2-way)
**Tab structure**: legacy `LIVE_DETAIL_TABS.mma = ["Mercati Principali", "Altro"]`. Mirror.
**Method markets**: KO/Submission/Decision similar to boxing.

- [ ] Step 15a-e

### Task 16: american-football

**DB-slug aliases:** `football-americano`
**Hero:** T/T Match (ML, 2-way)
**Tab structure**: not in legacy (`default` fallback). Upgrade because am-football has rich markets despite low volume. Template `["Mercati Principali", "U/O Punti", "Handicap", "Quarti", "Player", "Altri"]`. Player tab includes Passing Yards / TD Scorer / etc.
**Note**: tier C — only 8 events in DB, will need dummy data (Phase 4).

- [ ] Step 16a-e

### Task 17: snooker

**DB-slug aliases:** `snooker`
**Hero:** T/T Match (2-way)
**Tab structure**: not in legacy (`default` fallback). Minimal `["Mercati Principali", "U/O Frame", "Altri"]`.
**Note**: tier C — only 3 events, dummy data needed.

- [ ] Step 17a-e

---

## Phase 3 — Build & deploy (no flag flip yet)

### Task 18: Full build + redeploy + service verify

- [ ] **Step 18a: Build**

```bash
ssh scraper-vps "cd /root/betssolution-player && npm run build 2>&1 | tail -20"
```

Expected: success, new BUILD_ID. Note BUILD_ID for tracking.

- [ ] **Step 18b: Standalone copy + symlink + restart**

```bash
ssh scraper-vps "cp -r /root/betssolution-player/.next/static /root/betssolution-player/.next/standalone/.next/ && \
  cp -r /root/betssolution-player/public /root/betssolution-player/.next/standalone/ && \
  ln -sf /root/betssolution-player/.env.local /root/betssolution-player/.next/standalone/.env.local && \
  systemctl restart betssolution-player && sleep 3 && \
  systemctl is-active betssolution-player && \
  curl -s -o /dev/null -w 'health %{http_code}\n' http://localhost:3001/api/health"
```

Expected: `active`, `health 200`.

- [ ] **Step 18c: Verify legacy paths still work (flag still =calcio,tennis,basket)**

User opens 1 event for a non-flag sport (e.g. baseball) on kiosk → must render via LEGACY page (not v2). Confirms flag-gating is correct before flipping.

---

## Phase 4 — Dummy data seed

### Task 19: Identify low-volume sports

- [ ] **Step 19a: Refresh count per sport**

```bash
ssh scraper-vps "
KEY=\$(grep SUPABASE_SERVICE_ROLE_KEY /root/betssolution-player/.env.local | cut -d= -f2)
URL=\$(grep NEXT_PUBLIC_SUPABASE_URL /root/betssolution-player/.env.local | cut -d= -f2)
python3 << 'PY'
import urllib.request, json, collections, subprocess
KEY = subprocess.check_output(['bash','-c','grep SUPABASE_SERVICE_ROLE_KEY /root/betssolution-player/.env.local | cut -d= -f2']).decode().strip()
URL = subprocess.check_output(['bash','-c','grep NEXT_PUBLIC_SUPABASE_URL /root/betssolution-player/.env.local | cut -d= -f2']).decode().strip()
counter = collections.Counter()
for offset in range(0, 20000, 1000):
    req = urllib.request.Request(
        f'{URL}/rest/v1/events_v2?select=sport_slug&status=eq.prematch&order=sport_slug.asc',
        headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Range': f'{offset}-{offset+999}'}
    )
    rows = json.loads(urllib.request.urlopen(req).read())
    for r in rows: counter[r['sport_slug']] += 1
    if len(rows) < 1000: break
for s,n in counter.most_common(): print(f'  {s:30s} {n:5d}')
PY
"
```

Apply spec threshold: dummy seed required for any sport with `<10` prematch events OR `<60% tabs covered` per Phase 2 survey.

Document the list inline:
```
DUMMY_SEED_TARGETS=<sport1>,<sport2>,...
```

### Task 20: Author + execute seed-dummy-sports.sql

**Files:**
- Create: `scripts/seed-dummy-sports.sql` (in admin git, mirror used by VPS via SSH execution)

- [ ] **Step 20a: Write SQL script**

Create file `C:/Users/philp/Documents/Project/betssolution-admin-plan-d/scripts/seed-dummy-sports.sql` with structure:

```sql
-- Seed dummy events for sports with insufficient real coverage.
-- Each event: 1 league, 1 event, ~15 markets, ~3 outcomes per market.
-- Cleanup: DELETE FROM events_v2 WHERE league_slug LIKE 'QA-DUMMY-%' (CASCADE).

BEGIN;

-- Per sport in DUMMY_SEED_TARGETS (refreshed in Task 19):
DO $$
DECLARE
  evt_id uuid;
BEGIN
  -- Example for snooker (replicate per target sport)
  evt_id := gen_random_uuid();
  INSERT INTO events_v2 (id, sport_slug, league_slug, league_name, home_team, away_team,
                         starts_at, status, source)
  VALUES (evt_id, 'snooker', 'QA-DUMMY-snooker', 'QA Dummy Snooker',
          'Player A QA', 'Player B QA',
          NOW() + INTERVAL '7 days', 'prematch', 'qa-dummy')
  ON CONFLICT DO NOTHING;

  -- Markets + outcomes (representative subset matching SNOOKER_TAB_MARKETS_V2)
  -- ... per market: INSERT into markets_v2 + outcomes_v2
END $$;

COMMIT;
```

The schema details for markets_v2/outcomes_v2 columns must be confirmed first via:
```bash
ssh scraper-vps "
KEY=\$(grep SUPABASE_SERVICE_ROLE_KEY /root/betssolution-player/.env.local | cut -d= -f2)
URL=\$(grep NEXT_PUBLIC_SUPABASE_URL /root/betssolution-player/.env.local | cut -d= -f2)
curl -s '\$URL/rest/v1/markets_v2?select=*&limit=1' -H \"apikey: \$KEY\" -H \"Authorization: Bearer \$KEY\" | python3 -c 'import sys,json; print(list(json.load(sys.stdin)[0].keys()))'
curl -s '\$URL/rest/v1/outcomes_v2?select=*&limit=1' -H \"apikey: \$KEY\" -H \"Authorization: Bearer \$KEY\" | python3 -c 'import sys,json; print(list(json.load(sys.stdin)[0].keys()))'
"
```

Adjust SQL columns to match real schema.

- [ ] **Step 20b: Execute SQL via service-role REST or psql**

If `DATABASE_URL` is in player .env.local (per Plan D #4 FS-id session), use psql:
```bash
ssh scraper-vps "DB_URL=\$(grep ^DATABASE_URL /root/betssolution-player/.env.local | cut -d= -f2-) && psql \"\$DB_URL\" -f -" < scripts/seed-dummy-sports.sql
```

Else, convert SQL to REST batched INSERTs.

- [ ] **Step 20c: Verify dummy events present**

```bash
ssh scraper-vps "
KEY=\$(grep SUPABASE_SERVICE_ROLE_KEY /root/betssolution-player/.env.local | cut -d= -f2)
URL=\$(grep NEXT_PUBLIC_SUPABASE_URL /root/betssolution-player/.env.local | cut -d= -f2)
curl -s \"\$URL/rest/v1/events_v2?select=id,sport_slug,league_slug,home_team&league_slug=like.QA-DUMMY-*\" -H \"apikey: \$KEY\" -H \"Authorization: Bearer \$KEY\"
"
```

Expected: 1 event per target sport with `league_slug=QA-DUMMY-<sport>`.

- [ ] **Step 20d: Commit script (admin git)**

```bash
cd C:/Users/philp/Documents/Project/betssolution-admin-plan-d
cp scripts/seed-dummy-sports.sql docs/superpowers/artifacts/2026-05-05-event-v2-multi-sport/scripts/seed-dummy-sports.sql
git add scripts/seed-dummy-sports.sql docs/superpowers/artifacts/2026-05-05-event-v2-multi-sport/
git commit -m "scripts: seed-dummy-sports for tier C smoke test"
```

---

## Phase 5 — Flag flip + rebuild

### Task 21: Flag flip + redeploy

- [ ] **Step 21a: Update .env.local with concrete flag list**

Per spec Section 3 Step 7. SSH edit:
```bash
ssh scraper-vps "
cp /root/betssolution-player/.env.local /root/betssolution-player/.env.local.bak-pre-multisport-flip
sed -i 's|^NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=.*|NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio,tennis,basket,baseball,esports,dota,dota-2,counter-strike,valorant,league-of-legends,rainbow-six,call-of-duty,honor-of-kings,e-basketball,pallamano,hockey-ghiaccio,pallavolo,volley,freccette,rugby,rugby-league,rugby-union,rugby-sevens,cricket,boxe,pugilato,mma,arti-marziali,martial-arts,football-americano,snooker|' /root/betssolution-player/.env.local
grep NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS /root/betssolution-player/.env.local
"
```

- [ ] **Step 21b: Rebuild (NECESSARY — NEXT_PUBLIC_* inlined at build time)**

```bash
ssh scraper-vps "cd /root/betssolution-player && npm run build 2>&1 | tail -10"
```

- [ ] **Step 21c: Standalone copy + symlink + restart**

Same as Step 18b.

- [ ] **Step 21d: Verify flag value baked in**

```bash
ssh scraper-vps "grep -r 'NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS' /root/betssolution-player/.next/standalone/.next/server/ 2>/dev/null | head -2"
```

Expected: at least one chunk references the new full flag list.

- [ ] **Step 21e: Smoke 3 baseline (calcio + tennis + basket regression)**

User opens 1 event per baseline sport → confirm v2 still renders correctly (no regression from refactor B + flag widening).

If regression → revert flag (`mv .env.local.bak-pre-multisport-flip .env.local && rebuild`), debug.

---

## Phase 6 — User smoke pass

### Task 22: User smoke handoff

- [ ] **Step 22a: USER opens 1 event per new sport on kiosk**

For each of the 12 new sports (using real events when ≥1 prematch exists, else navigate to dummy event via direct URL `/event/<dummy-uuid>` from Task 20c output), verify acceptance criteria (spec section 5):

1. Tab structure renders without empty visible tabs (auto-hide pattern)
2. Hero rendering present in tab "Principali"
3. No "ugly" labels in tab "Principali" (tier-dependent bar)
4. Bet slip works on 1 outcome click
5. No regression on calcio/tennis/basket (already covered by step 21e)

- [ ] **Step 22b: Issue log**

User documents per sport: ✅ pass | ❌ fail with description + screenshot.
Issues categorized:
- **Config issues** (wrong tab, missing market, ugly label) → Phase 7 bugfix
- **Framework issues** (categorizer doesn't pick a market type, hero rendering bug) → spec amendment + bugfix
- **Render issues** (visual glitch, broken bet slip) → debug separately

---

## Phase 7 — Bugfix iterative

### Task 23: Per-issue fix loop

- [ ] **Step 23a: For each issue from Task 22b, apply fix**

Most fixes are config-only:
- Add entry to `TITLE_OVERRIDES_BY_SPORT[<sport>]`
- Move market_type to different tab in `XSPORT_TAB_MARKETS_V2`
- Add missing alias registration

- [ ] **Step 23b: Rebuild + redeploy after each batch (group fixes)**

Don't redeploy per single fix — group fixes per ~5 issues, then rebuild + redeploy + verify.

```bash
ssh scraper-vps "cd /root/betssolution-player && npm run build 2>&1 | tail -5 && \
  cp -r .next/static .next/standalone/.next/ && \
  cp -r public .next/standalone/ && \
  ln -sf /root/betssolution-player/.env.local /root/betssolution-player/.next/standalone/.env.local && \
  systemctl restart betssolution-player && sleep 3 && \
  curl -s -o /dev/null -w 'health %{http_code}\n' http://localhost:3001/api/health"
```

- [ ] **Step 23c: Re-smoke fixed sports**

User re-verifies the affected sports.

- [ ] **Step 23d: Mirror + commit per batch**

```bash
scp scraper-vps:/root/betssolution-player/lib/market-config-v2.ts \
  C:/Users/philp/Documents/Project/betssolution-admin-plan-d/docs/superpowers/artifacts/2026-05-05-event-v2-multi-sport/player/lib/market-config-v2.ts
cd C:/Users/philp/Documents/Project/betssolution-admin-plan-d
git add docs/superpowers/artifacts/
git commit -m "fix: event-v2 multi-sport bugfix batch — <description>"
```

Loop until all 12 sports pass acceptance.

---

## Phase 8 — Cleanup dummy data

### Task 24: cleanup-dummy-sports.sql

**Files:**
- Create: `scripts/cleanup-dummy-sports.sql`

- [ ] **Step 24a: Write cleanup SQL**

```sql
-- Idempotent cleanup: removes dummy events seeded for QA smoke.
BEGIN;
DELETE FROM events_v2 WHERE league_slug LIKE 'QA-DUMMY-%';
-- markets_v2 + outcomes_v2 should CASCADE via FK; if not, manual:
-- DELETE FROM outcomes_v2 WHERE market_id IN (SELECT id FROM markets_v2 WHERE event_id IN (...));
COMMIT;
```

- [ ] **Step 24b: Execute**

```bash
ssh scraper-vps "DB_URL=\$(grep ^DATABASE_URL /root/betssolution-player/.env.local | cut -d= -f2-) && psql \"\$DB_URL\" -f -" < scripts/cleanup-dummy-sports.sql
```

- [ ] **Step 24c: Verify count = 0 (MANDATORY before closing session)**

```bash
ssh scraper-vps "
KEY=\$(grep SUPABASE_SERVICE_ROLE_KEY /root/betssolution-player/.env.local | cut -d= -f2)
URL=\$(grep NEXT_PUBLIC_SUPABASE_URL /root/betssolution-player/.env.local | cut -d= -f2)
curl -s \"\$URL/rest/v1/events_v2?select=count&league_slug=like.QA-DUMMY-*\" -H \"apikey: \$KEY\" -H \"Authorization: Bearer \$KEY\" -H 'Prefer: count=exact' -I | grep -i content-range
"
```

Expected: `content-range: */0` (0 dummy rows remain).

If count > 0 → STOP, investigate. Do NOT close session with dummy data leftover.

- [ ] **Step 24d: Commit cleanup script**

```bash
cp scripts/cleanup-dummy-sports.sql docs/superpowers/artifacts/2026-05-05-event-v2-multi-sport/scripts/
git add scripts/cleanup-dummy-sports.sql docs/superpowers/artifacts/
git commit -m "scripts: cleanup-dummy-sports — post-smoke teardown"
```

---

## Phase 9 (Bonus) — Deploy script automation

### Task 25 (optional): build-deploy-player.sh

**Files:**
- Create on VPS: `/root/betssolution-player/scripts/build-deploy.sh`
- Mirror to: `docs/superpowers/artifacts/2026-05-05-event-v2-multi-sport/scripts/build-deploy.sh`

- [ ] **Step 25a: Write script**

```bash
#!/usr/bin/env bash
set -euo pipefail

cd /root/betssolution-player
echo "[1/6] npm run build"
npm run build

echo "[2/6] copy .next/static into standalone"
cp -r .next/static .next/standalone/.next/

echo "[3/6] copy public/ into standalone"
cp -r public .next/standalone/

echo "[4/6] symlink .env.local into standalone"
ln -sf /root/betssolution-player/.env.local /root/betssolution-player/.next/standalone/.env.local

echo "[5/6] restart service"
systemctl restart betssolution-player

echo "[6/6] verify health"
sleep 3
curl -s -o /dev/null -w "health %{http_code}\n" http://localhost:3001/api/health
echo "BUILD_ID=$(cat .next/BUILD_ID)"
```

- [ ] **Step 25b: Install + chmod**

```bash
ssh scraper-vps "mkdir -p /root/betssolution-player/scripts && cat > /root/betssolution-player/scripts/build-deploy.sh << 'EOF'
[paste script]
EOF
chmod +x /root/betssolution-player/scripts/build-deploy.sh"
```

- [ ] **Step 25c: Mirror + commit**

```bash
scp scraper-vps:/root/betssolution-player/scripts/build-deploy.sh \
  docs/superpowers/artifacts/2026-05-05-event-v2-multi-sport/scripts/build-deploy.sh
git add docs/superpowers/artifacts/
git commit -m "scripts: build-deploy-player.sh — deploy automation"
```

---

## Final acceptance

- [ ] All 12 new sports pass acceptance criteria (Phase 6 sign-off by user)
- [ ] No regression on calcio/tennis/basket (Phase 5 step 21e)
- [ ] Dummy data cleanup verified (Phase 8 step 24c)
- [ ] Branch pushed to origin (manually, end of session)

```bash
cd C:/Users/philp/Documents/Project/betssolution-admin-plan-d
git push origin feature/plan-d-settlement-d1
```

- [ ] Session memory written: `~/.claude/projects/.../memory/session-2026-05-05-event-v2-multi-sport.md`
- [ ] `MEMORY.md` updated with new index entry
- [ ] `next-session-2026-05-06.md` created with end-state snapshot for next pickup

---

## Risk handling reference (from spec section 6)

| Symptom during execution | Likely cause | Action |
|---|---|---|
| Refactor B basket regression | titleFor wrong sportSlug threading | Restore page-v2.tsx.bak-pre-multisport, debug |
| Flag flip 500 errors | symlink lost or env stale | Verify Phase 5 Step 21c symlink, sanity-check `cat /root/betssolution-player/.next/standalone/.env.local` |
| Sport renders v2 but tabs empty | categorizer matches no markets | Phase 7 Task 23: refine XSPORT_TAB_MARKETS_V2 |
| Build cycle slow | manual deploy steps | Phase 9 Task 25 deploy script |
| Server Action stale errors | client-side cached chunks | User: hard refresh (Ctrl+F5) or relaunch chrome with fresh `--user-data-dir` |
