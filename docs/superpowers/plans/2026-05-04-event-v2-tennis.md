# Event V2 Tennis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the v2 event detail page (currently calcio-only) to also render tennis events behind the same `NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS` feature flag, mirroring the legacy 5-tab layout (Principali / Set / U/O Giochi / Handicap / Altri).

**Architecture:** Additive refactor. Introduce per-sport indirection maps in `market-config-v2.ts` (TAB_ORDER_BY_SPORT, DEFAULT_SUB_PILL_BY_SPORT, TAB_MARKETS_BY_SPORT) so the categorizer + page-v2 stop hard-coding `"calcio"` and instead key off `event.sport.slug`. Add `TENNIS_TAB_MARKETS_V2` data + tennis-specific render rules (Hero for T/T Match, title override `1X2 - 1T → VINCENTE 1° SET`, NO_LINE_TITLE_TYPES extension). Calcio paths unchanged behaviorally — every change is a default-fallback that returns `"calcio"` config when sport_slug is missing or unconfigured.

**Tech Stack:** TypeScript, React, Next.js 16 App Router, Supabase REST (for market_type vocabulary verification), systemd (deploy on scraper-vps). No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-05-04-event-v2-tennis-design.md`](../specs/2026-05-04-event-v2-tennis-design.md)

**Working tree:** Code lives on scraper-vps at `/root/betssolution-player/` (not git-tracked). Mirror to `docs/superpowers/artifacts/2026-05-04-event-v2-tennis/player/` after each modification, plus update the existing `2026-05-04-event-v2-batch-fixes/player/` mirror for the touched files since they're shared. Final commits go to admin git on `feature/plan-d-settlement-d1`.

**Build/deploy procedure (each task that modifies code on VPS):**
1. SSH edit on `scraper-vps:/root/betssolution-player/`
2. `cd /root/betssolution-player && source /root/.nvm/nvm.sh && nvm use 22 --silent && npm run build`
3. `cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/`
4. `ln -sf /root/betssolution-player/.env.local .next/standalone/.env.local`
5. `systemctl restart betssolution-player && sleep 3 && systemctl is-active betssolution-player`
6. `curl -sS http://localhost:3001/api/health` → expect HTTP 200

---

## File Structure

**Files modified (3):**
- `lib/market-config-v2.ts` (180 → ~250 LoC) — add TENNIS_TAB_MARKETS_V2, TENNIS_TAB_ORDER, TENNIS_DEFAULT_SUB_PILL, plus 3 sport-keyed map exports.
- `lib/market-categorizer-v2.ts` (97 → ~95 LoC) — replace 1-line SPORT_CONFIGS literal with import of TAB_MARKETS_BY_SPORT.
- `app/(kiosk)/event/[eventId]/page-v2.tsx` (823 → ~840 LoC) — thread `sportSlug`, switch to per-sport map lookups, extend Hero condition, extend NO_LINE_TITLE_TYPES, add MARKET_TITLE_OVERRIDE.

**Files created (0)** — all changes are additive within existing files.

**Files NOT touched** (verified spec compliance):
- `components/event-v2/*` — shared components stay sport-agnostic.
- `lib/queries/player-event-v2.ts` — mapper handles every sport_slug already.
- Legacy `lib/market-config.ts` — used by LiveMarketGrid fallback, untouched.

**Env file modified (after smoke test passes):**
- `/root/betssolution-player/.env.local` — `NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio,tennis`

**No new tests planned.** Tennis v2 reuses existing components (`MarketSection`, `LinePicker`, `AsianHandicapBlock`, `HeroOutcomeRow`, `CompactOutcomeRow`) which already have unit tests in the calcio v2 suite. Verification is manual smoke test on the kiosk per spec acceptance criteria.

---

## Task 1: Add per-sport indirection maps in market-config-v2.ts (no behavior change)

**Files:**
- Modify: `/root/betssolution-player/lib/market-config-v2.ts` (append at end before parseMarketSpec function)

- [ ] **Step 1: Add the per-sport map exports below FOOTBALL_DEFAULT_SUB_PILL, before parseMarketSpec**

Insert these exports at line ~174 (right after `FOOTBALL_DEFAULT_SUB_PILL` declaration, before `parseMarketSpec`):

```ts
// Per-sport lookup maps. Defaults fall back to calcio so an unconfigured sport_slug
// still renders something (the availableTabs filter then strips empty tabs, leaving
// at most Altri with all markets visible).
export const TAB_MARKETS_BY_SPORT: Record<string, SportTabConfig> = {
  calcio: FOOTBALL_TAB_MARKETS_V2,
};

export const TAB_ORDER_BY_SPORT: Record<string, string[]> = {
  calcio: FOOTBALL_TAB_ORDER,
};

export const DEFAULT_SUB_PILL_BY_SPORT: Record<string, Record<string, string>> = {
  calcio: FOOTBALL_DEFAULT_SUB_PILL,
};
```

- [ ] **Step 2: Verify TypeScript compiles via build**

Run: `cd /root/betssolution-player && source /root/.nvm/nvm.sh && nvm use 22 --silent && npm run build 2>&1 | tail -10`
Expected: build completes, no TS errors. Static page count unchanged.

- [ ] **Step 3: Verify no behavior change** (categorizer not yet wired to new maps)

The categorizer still reads `SPORT_CONFIGS = { calcio: FOOTBALL_TAB_MARKETS_V2 }` literal — unchanged. This task is purely additive.

Quick check: `grep -c TAB_MARKETS_BY_SPORT /root/betssolution-player/lib/market-config-v2.ts` → expect 1 (only the export, no consumers yet).

- [ ] **Step 4: No deploy yet — task 2 wires consumer in same commit**

Skip restart for now. Combined commit with task 2.

---

## Task 2: Wire categorizer to per-sport map (no behavior change)

**Files:**
- Modify: `/root/betssolution-player/lib/market-categorizer-v2.ts:21-23`

- [ ] **Step 1: Replace the inline SPORT_CONFIGS literal with the imported map**

Find this block (lines 21-23):
```ts
const SPORT_CONFIGS: Record<string, SportTabConfig> = {
  calcio: FOOTBALL_TAB_MARKETS_V2,
};
```

Replace with:
```ts
import { TAB_MARKETS_BY_SPORT, type SportTabConfig } from "./market-config-v2";
```
(Note: there's already an existing import line on line 2-6 — extend it instead of adding a new one)

Then change the SPORT_CONFIGS line to:
```ts
const SPORT_CONFIGS: Record<string, SportTabConfig> = TAB_MARKETS_BY_SPORT;
```

The full new top of file should look like:
```ts
// lib/market-categorizer-v2.ts
import {
  FOOTBALL_TAB_MARKETS_V2,
  TAB_MARKETS_BY_SPORT,
  parseMarketSpec,
  type SportTabConfig,
} from "./market-config-v2";
// ... (MarketLike type unchanged)
// ... (CategorizeResult type unchanged)
const SPORT_CONFIGS: Record<string, SportTabConfig> = TAB_MARKETS_BY_SPORT;
```

`FOOTBALL_TAB_MARKETS_V2` import can stay (unused now but harmless) OR be dropped. **Drop it** to keep imports clean — change import block to:

```ts
import {
  TAB_MARKETS_BY_SPORT,
  parseMarketSpec,
  type SportTabConfig,
} from "./market-config-v2";
```

- [ ] **Step 2: Build to verify**

Run: `cd /root/betssolution-player && source /root/.nvm/nvm.sh && nvm use 22 --silent && npm run build 2>&1 | tail -10`
Expected: clean build, 0 TS errors.

- [ ] **Step 3: Deploy and smoke-test calcio (regression check)**

```bash
cd /root/betssolution-player && \
  cp -r .next/static .next/standalone/.next/ && \
  cp -r public .next/standalone/ && \
  ln -sf /root/betssolution-player/.env.local .next/standalone/.env.local && \
  systemctl restart betssolution-player && \
  sleep 3 && \
  systemctl is-active betssolution-player && \
  curl -sS -o /dev/null -w 'health %{http_code} %{time_total}s\n' http://localhost:3001/api/health
```

Then on kiosk: hard-refresh any calcio event, click through Player tab sub-pills (Marcatori → Goalkeeper → Shots → Cards → Other) — must still work identically (the `2026-05-04-event-v2-batch-fixes` composite-key fix is preserved). All other tabs Principali/Gol/U/O/Handicap/Tempi/Stats also unchanged.

- [ ] **Step 4: Mirror updated files to admin git artifacts**

```bash
# from local Windows
scp scraper-vps:/root/betssolution-player/lib/market-config-v2.ts \
    "C:/Users/philp/Documents/Project/betssolution-admin-plan-d/docs/superpowers/artifacts/2026-05-04-event-v2-batch-fixes/player/market-config-v2.ts"
scp scraper-vps:/root/betssolution-player/lib/market-categorizer-v2.ts \
    "C:/Users/philp/Documents/Project/betssolution-admin-plan-d/docs/superpowers/artifacts/2026-05-04-event-v2-batch-fixes/player/market-categorizer-v2.ts"
```

- [ ] **Step 5: Commit**

```bash
cd C:/Users/philp/Documents/Project/betssolution-admin-plan-d
git add docs/superpowers/artifacts/2026-05-04-event-v2-batch-fixes/player/market-config-v2.ts \
        docs/superpowers/artifacts/2026-05-04-event-v2-batch-fixes/player/market-categorizer-v2.ts
git commit -m "$(cat <<'EOF'
event-v2 tennis (1/4): per-sport indirection maps

Add TAB_MARKETS_BY_SPORT / TAB_ORDER_BY_SPORT / DEFAULT_SUB_PILL_BY_SPORT
in market-config-v2 and switch categorizer SPORT_CONFIGS to consume the
map. Calcio behavior unchanged — purely additive refactor preparing for
tennis registration.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Do NOT push yet — accumulated commits push at the end.

---

## Task 3: Add TENNIS_TAB_MARKETS_V2 data + register

**Files:**
- Modify: `/root/betssolution-player/lib/market-config-v2.ts` (append tennis config)

- [ ] **Step 1: Add TENNIS config blocks at end of file (after the FOOTBALL_* declarations, before the per-sport maps)**

Insert these declarations between `FOOTBALL_DEFAULT_SUB_PILL` (currently lines 170-174) and the new `TAB_MARKETS_BY_SPORT` map added in task 1:

```ts
export const TENNIS_TAB_MARKETS_V2: SportTabConfig = {
  "Principali": {
    markets: [
      "T/T Match (Escl. Ritiro)",
      "Totale set@2.5",
      "Totale giochi@22.5",
      "Handicap@-1.5",
    ],
  },
  "Set": {
    markets: [
      "1X2 - 1T",
      "Totals 1st Set@picker",
      "T/T 1° Set",
      "T/T 2° Set",
    ],
  },
  "U/O Giochi": {
    markets: ["Totale giochi@picker"],
  },
  "Handicap": {
    markets: ["Handicap@picker"],
  },
  "Altri": {
    markets: [],
  },
};

export const TENNIS_TAB_ORDER = ["Principali", "Set", "U/O Giochi", "Handicap", "Altri"];

export const TENNIS_DEFAULT_SUB_PILL: Record<string, string> = {};
```

- [ ] **Step 2: Register tennis in the per-sport maps**

Update the 3 maps from task 1 to include tennis:

```ts
export const TAB_MARKETS_BY_SPORT: Record<string, SportTabConfig> = {
  calcio: FOOTBALL_TAB_MARKETS_V2,
  tennis: TENNIS_TAB_MARKETS_V2,
};

export const TAB_ORDER_BY_SPORT: Record<string, string[]> = {
  calcio: FOOTBALL_TAB_ORDER,
  tennis: TENNIS_TAB_ORDER,
};

export const DEFAULT_SUB_PILL_BY_SPORT: Record<string, Record<string, string>> = {
  calcio: FOOTBALL_DEFAULT_SUB_PILL,
  tennis: TENNIS_DEFAULT_SUB_PILL,
};
```

- [ ] **Step 3: Build to verify**

Run: `cd /root/betssolution-player && source /root/.nvm/nvm.sh && nvm use 22 --silent && npm run build 2>&1 | tail -5`
Expected: clean.

- [ ] **Step 4: Verify the bundle contains tennis specs**

```bash
grep -o 'Totale giochi@22.5' /root/betssolution-player/.next/standalone/.next/server/chunks/ssr/app_*event*.js | head -1
```
Expected: at least 1 hit.

- [ ] **Step 5: Stop here — page-v2 not yet threading sportSlug**

Tennis events visited at this point still hit hard-coded `"calcio"` lookup → categorizer returns 0 markets → page shows "Nessun mercato disponibile" for tennis. **Don't deploy this state**. Continue to task 4 in the same commit.

---

## Task 4: Thread sportSlug through page-v2.tsx + render rules

**Files:**
- Modify: `/root/betssolution-player/app/(kiosk)/event/[eventId]/page-v2.tsx`

- [ ] **Step 1: Update imports**

Find current imports block (around lines 18-23):

```ts
import {
  FOOTBALL_TAB_ORDER,
  FOOTBALL_TAB_MARKETS_V2,
  FOOTBALL_DEFAULT_SUB_PILL,
  parseMarketSpec,
} from "@/lib/market-config-v2";
```

Replace with:

```ts
import {
  TAB_ORDER_BY_SPORT,
  TAB_MARKETS_BY_SPORT,
  DEFAULT_SUB_PILL_BY_SPORT,
  parseMarketSpec,
} from "@/lib/market-config-v2";
```

- [ ] **Step 2: Add MARKET_TITLE_OVERRIDE map near NO_LINE_TITLE_TYPES (around line 177)**

Insert before the `NO_LINE_TITLE_TYPES` declaration:

```ts
// Display-name override for markets whose stored market_type is misleading
// or sport-specific. Applied in titleFor() before uppercase formatting.
const MARKET_TITLE_OVERRIDE: Record<string, string> = {
  "1X2 - 1T": "VINCENTE 1° SET",
};
```

- [ ] **Step 3: Extend NO_LINE_TITLE_TYPES with tennis line-less markets**

Find the existing `NO_LINE_TITLE_TYPES` set (around line 178-193) and append after the existing entries (before the closing `])`):

```ts
  // Tennis line-less markets — view sometimes emits stray 0 line, must suppress.
  "T/T Match (Escl. Ritiro)", "T/T 1° Set", "T/T 2° Set",
```

Note: `"1X2 - 1T"` already covered by the existing entries (it's listed there for calcio half-time markets).

- [ ] **Step 4: Update titleFor() to consult the override map**

Find the existing `titleFor` function (around line 197-203):

```ts
function titleFor(m: DbMarket): string {
  const base = m.market_type.toUpperCase();
  if (m.line == null) return base;
  if (NO_LINE_TITLE_TYPES.has(m.market_type)) return base;
  const lineStr = Number.isInteger(m.line) ? String(m.line) : String(m.line);
  return base + ' ' + lineStr;
}
```

Replace with:

```ts
function titleFor(m: DbMarket): string {
  const overridden = MARKET_TITLE_OVERRIDE[m.market_type];
  const base = (overridden ?? m.market_type).toUpperCase();
  if (m.line == null) return base;
  if (NO_LINE_TITLE_TYPES.has(m.market_type)) return base;
  const lineStr = Number.isInteger(m.line) ? String(m.line) : String(m.line);
  return base + ' ' + lineStr;
}
```

- [ ] **Step 5: Add sportSlug derivation at top of EventDetailPageV2 component**

Find the start of `export default function EventDetailPageV2` (around line 205). Right after the destructure, add:

```ts
export default function EventDetailPageV2({ event, eventId, onSelectOutcome }: Props) {
  const sportSlug = event.sport?.slug ?? "calcio";
  const tabOrder = TAB_ORDER_BY_SPORT[sportSlug] ?? TAB_ORDER_BY_SPORT.calcio;
  const defaultSubPill = DEFAULT_SUB_PILL_BY_SPORT[sportSlug] ?? {};
  const tabMarketsCfg = TAB_MARKETS_BY_SPORT[sportSlug] ?? TAB_MARKETS_BY_SPORT.calcio;

  const [activeTab, setActiveTab] = useState<string>(tabOrder[0] ?? "Principali");
  const [activeSubPill, setActiveSubPill] = useState<string>(
    defaultSubPill[tabOrder[0] ?? ""] ?? ""
  );
  // ... rest of component
```

(Replace the existing `useState<string>("Principali")` and the `useState<string>(FOOTBALL_DEFAULT_SUB_PILL["Principali"] ?? "")` lines.)

- [ ] **Step 6: Replace remaining hard-coded references in component body**

Search-and-replace within `EventDetailPageV2` function body (NOT in the helper functions tokenize/compactDCLabel/etc which sit outside):

| Find | Replace |
|------|---------|
| `FOOTBALL_DEFAULT_SUB_PILL[tab]` | `defaultSubPill[tab]` |
| `FOOTBALL_DEFAULT_SUB_PILL[availableTabs[0]]` | `defaultSubPill[availableTabs[0]]` |
| `FOOTBALL_TAB_MARKETS_V2[activeTab]` | `tabMarketsCfg[activeTab]` |
| `Object.values(FOOTBALL_TAB_MARKETS_V2)` | `Object.values(tabMarketsCfg)` |
| `FOOTBALL_TAB_ORDER.filter(...)` | `tabOrder.filter(...)` |

Also: the call to `categorizeMarketsV2(... , "calcio", ...)` becomes `categorizeMarketsV2(..., sportSlug, ...)`. There is exactly one such call in the `useMemo` block (around line 290).

There should be **zero** remaining references to `FOOTBALL_TAB_ORDER` / `FOOTBALL_TAB_MARKETS_V2` / `FOOTBALL_DEFAULT_SUB_PILL` / `"calcio"` literal in the component after this step.

Verification grep:
```bash
grep -nE "FOOTBALL_(TAB_ORDER|TAB_MARKETS_V2|DEFAULT_SUB_PILL)|categorizeMarketsV2[^,]+,[^,]+,\\s*\"calcio\"" \
  /root/betssolution-player/app/\(kiosk\)/event/\[eventId\]/page-v2.tsx
```
Expected: 0 hits.

- [ ] **Step 7: Extend Hero condition for tennis T/T Match**

Find inside `renderSingleMarket` the line that computes `isHero` (around line 502):

```ts
const isHero = isPrincipali && m.market_type === "1X2";
```

Replace with:

```ts
const isHero = isPrincipali && (m.market_type === "1X2" || m.market_type === "T/T Match (Escl. Ritiro)");
```

- [ ] **Step 8: Build**

Run: `cd /root/betssolution-player && source /root/.nvm/nvm.sh && nvm use 22 --silent && npm run build 2>&1 | tail -10`
Expected: clean build. tsc 0 errors.

- [ ] **Step 9: Deploy**

```bash
cd /root/betssolution-player && \
  cp -r .next/static .next/standalone/.next/ && \
  cp -r public .next/standalone/ && \
  ln -sf /root/betssolution-player/.env.local .next/standalone/.env.local && \
  systemctl restart betssolution-player && \
  sleep 3 && \
  systemctl is-active betssolution-player && \
  curl -sS -o /dev/null -w 'health %{http_code} %{time_total}s\n' http://localhost:3001/api/health
```

- [ ] **Step 10: Calcio regression check on kiosk**

User does hard-refresh on a calcio event. Verify:
- All 7 tabs (Principali, Gol/U/O, Handicap, Tempi, Player, Stats, Altri) render same as before.
- Player tab sub-pills filter correctly (Marcatori shows MARCATORE etc., not GK Saves).
- 1X2 hero rendering preserved in Principali.
- DC compact labels still working (1X / X2 / 12).

If regression detected, ROLLBACK before continuing: `cp /tmp/page-v2.tsx.bak-pre-tennis /root/betssolution-player/app/\(kiosk\)/event/\[eventId\]/page-v2.tsx && rebuild && restart`. (Take a backup at start of step 1.)

- [ ] **Step 11: Mirror page-v2.tsx + market-config-v2.ts**

```bash
scp scraper-vps:/root/betssolution-player/app/\(kiosk\)/event/\[eventId\]/page-v2.tsx \
    "C:/Users/philp/Documents/Project/betssolution-admin-plan-d/docs/superpowers/artifacts/2026-05-04-event-v2-batch-fixes/player/page-v2.tsx"
scp scraper-vps:/root/betssolution-player/lib/market-config-v2.ts \
    "C:/Users/philp/Documents/Project/betssolution-admin-plan-d/docs/superpowers/artifacts/2026-05-04-event-v2-batch-fixes/player/market-config-v2.ts"
```

- [ ] **Step 12: Commit**

```bash
cd C:/Users/philp/Documents/Project/betssolution-admin-plan-d
git add docs/superpowers/artifacts/2026-05-04-event-v2-batch-fixes/player/page-v2.tsx \
        docs/superpowers/artifacts/2026-05-04-event-v2-batch-fixes/player/market-config-v2.ts
git commit -m "$(cat <<'EOF'
event-v2 tennis (2/4): TENNIS_TAB_MARKETS_V2 + sportSlug threading

Add TENNIS_TAB_MARKETS_V2 (5 tabs: Principali / Set / U/O Giochi / Handicap
/ Altri), TENNIS_TAB_ORDER, TENNIS_DEFAULT_SUB_PILL. Register tennis in the
per-sport maps from commit 1.

page-v2.tsx: derive sportSlug from event.sport.slug, swap hardcoded
FOOTBALL_* / "calcio" references for the per-sport map lookups.

Render extensions:
- Hero rendering extended to "T/T Match (Escl. Ritiro)" in Principali.
- MARKET_TITLE_OVERRIDE map renames "1X2 - 1T" → "VINCENTE 1° SET".
- NO_LINE_TITLE_TYPES adds T/T Match, T/T 1° Set, T/T 2° Set.

Tennis still NOT enabled in the env feature flag — verified via calcio
regression check on kiosk before flag flip in next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Smoke-test tennis behind a single-event preview, then flip flag

**Files:**
- Modify: `/root/betssolution-player/.env.local` (single line edit)

- [ ] **Step 1: Sample a tennis event ID for testing**

```bash
ssh scraper-vps "curl -s 'https://xgnyqkmugnfzhdveeqom.supabase.co/rest/v1/v_player_events?sport_slug=eq.tennis&select=id,home_team,away_team,starts_at&starts_at=gte.now()&order=starts_at.asc&limit=3' -H 'apikey: <SERVICE_ROLE_KEY>'"
```
Pick 1 event UUID. Memorize/copy the ID (we'll call it `<TENNIS_EVT>`).

- [ ] **Step 2: Flip the env flag to add tennis**

On scraper-vps:

```bash
sed -i 's/^NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio$/NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio,tennis/' /root/betssolution-player/.env.local
grep NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS /root/betssolution-player/.env.local
```
Expected output: `NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio,tennis`

If sed didn't match (different line format), do it manually:
```bash
nano /root/betssolution-player/.env.local
# change to: NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio,tennis
```

- [ ] **Step 3: Rebuild + restart so the new env value gets baked into the client bundle**

```bash
cd /root/betssolution-player && \
  source /root/.nvm/nvm.sh && nvm use 22 --silent && \
  npm run build 2>&1 | tail -5 && \
  cp -r .next/static .next/standalone/.next/ && \
  cp -r public .next/standalone/ && \
  ln -sf /root/betssolution-player/.env.local .next/standalone/.env.local && \
  systemctl restart betssolution-player && \
  sleep 3 && \
  systemctl is-active betssolution-player && \
  curl -sS -o /dev/null -w 'health %{http_code} %{time_total}s\n' http://localhost:3001/api/health && \
  cat .next/BUILD_ID
```

`NEXT_PUBLIC_*` env vars are inlined at build time, so a rebuild is mandatory.

- [ ] **Step 4: Kiosk smoke test on the sampled tennis event**

User opens `https://<kiosk-URL>/event/<TENNIS_EVT>` (or navigates via the listing). Hard-refresh.

Verification checklist (per spec acceptance criteria):

- [ ] All 5 tabs render: Principali, Set, U/O Giochi, Handicap, Altri (Altri only if uncategorized markets exist).
- [ ] **Principali** tab:
  - [ ] T/T Match section: hero buttons (large, 2 outcomes home/away with player names + odds).
  - [ ] Totale set 2.5 (default line): Over/Under compact row, Over first.
  - [ ] Totale giochi 22.5 (or closest): Over/Under compact row.
  - [ ] Handicap -1.5 (or closest): renders via AsianHandicapBlock with 2 buttons (player names, signed line).
- [ ] **Set** tab:
  - [ ] Section title "VINCENTE 1° SET" (NOT "1X2 - 1T") with 2 outcomes [1, 2].
  - [ ] Totals 1st Set picker: switches between available lines, Over/Under per line.
  - [ ] T/T 1° Set, T/T 2° Set: 2-way compact rows.
- [ ] **U/O Giochi** tab: LinePicker with all line variants (15+ typical), Over/Under buttons per line.
- [ ] **Handicap** tab: AsianHandicapBlock with all line variants, signed.
- [ ] **Altri** tab: hidden if no uncategorized markets, otherwise shows them.
- [ ] **Tab switching**: click between tabs back-and-forth multiple times — content updates correctly, no stale DOM (relies on the prior batch-fix composite-key React key fix).

- [ ] **Step 5: If Handicap section is empty, capture outcome name shape**

Likely cause: odds-api emits player-named outcomes (e.g. `"Sinner +1.5"`) and `acceptName` filter in `renderGroupedMarket` strips them.

To diagnose, query:
```bash
ssh scraper-vps "curl -s 'https://xgnyqkmugnfzhdveeqom.supabase.co/rest/v1/v_player_outcomes?market_id=eq.<HANDICAP_MARKET_ID>&select=name,line&limit=10' -H 'apikey: <KEY>'"
```

If names match `1`/`2`/`home`/`away` → not the issue, escalate to user.

If names are like `"Sinner +1.5"` / `"Player Name -2.5"` → patch `acceptName` in `renderGroupedMarket` (around line 529-536):

```ts
const acceptName = (name: string): boolean => {
  const l = (name || "").toLowerCase().trim();
  if (isAHFamily) {
    if (l === "1" || l === "2" || l === "home" || l === "away") return true;
    // Tennis Handicap may emit player names with signed line suffix.
    if (/[+-]\d+(\.\d+)?$/.test(l)) return true;
    return false;
  }
  return /^(over|under|più|piu|meno)\b/.test(l);
};
```

Then the AsianHandicapBlock needs to map these names back to home/away. Check `AsianHandicapBlock.tsx` `renderLabel` for team-handicap renderer — if it's already strict on `1/home`, extend for tennis. **This is a fix-on-discovery step**; full investigation only if smoke test reveals empty section.

- [ ] **Step 6: Calcio regression re-check**

Open any calcio event. Confirm Player tab sub-pills (Marcatori → Goalkeeper → Shots → Cards → Other) all filter content correctly. Hero 1X2 rendering still in Principali. DC compact labels intact.

- [ ] **Step 7: If smoke test passes, commit env change documentation**

The `.env.local` file is NOT git-tracked (it's in /root/betssolution-player which is not a git repo). So no commit there. But document the flag flip in a runbook entry.

Append to `docs/superpowers/artifacts/2026-05-04-event-v2-batch-fixes/RUNBOOK.md` (under the "Pending follow-up" section, or in a new "## 2026-05-04 — Tennis enabled" subsection):

```markdown
### Tennis sport enabled — 2026-05-04 ~HH:MM UTC

Spec: `docs/superpowers/specs/2026-05-04-event-v2-tennis-design.md`
Plan: `docs/superpowers/plans/2026-05-04-event-v2-tennis.md`

**Env flag flipped on scraper-vps**: `NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio` → `=calcio,tennis`. Build BUILD_ID `<NEW_BUILD_ID>`.

Smoke-tested events: `<TENNIS_EVT_UUID_1>`, `<TENNIS_EVT_UUID_2>`. All 5 tabs working as designed.

Rollback if needed: `sed -i "s/=calcio,tennis/=calcio/" /root/betssolution-player/.env.local && rebuild && restart`.

Post-fix needed (if any): <details>
```

```bash
cd C:/Users/philp/Documents/Project/betssolution-admin-plan-d
git add docs/superpowers/artifacts/2026-05-04-event-v2-batch-fixes/RUNBOOK.md
git commit -m "$(cat <<'EOF'
event-v2 tennis (3/4): runbook entry for flag flip

Tennis enabled in production via NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS env flag.
Rollback procedure documented.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Save memory + push

**Files:**
- Create: `C:\Users\philp\.claude\projects\C--Users-philp\memory\session-2026-05-04-event-v2-tennis.md`
- Modify: `C:\Users\philp\.claude\projects\C--Users-philp\memory\MEMORY.md` (add 1-line index entry)

- [ ] **Step 1: Write session memory**

Create a concise project-type memory at the path above:

```markdown
---
name: Event-v2 tennis sport extension
description: Tennis added to event-v2 framework via per-sport indirection maps; 5-tab structure; T/T Match hero; "1X2 - 1T" → "VINCENTE 1° SET" title override.
type: project
---

## 🎾 Event-v2 tennis SHIPPED — 2026-05-04 ~HH:MM UTC

Branch HEAD `<COMMIT_HASH>` su origin `feature/plan-d-settlement-d1`. BUILD_ID `<BUILD_ID>` deployato su scraper-vps. Flag `NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio,tennis`.

**Architectural change**: per-sport maps in `lib/market-config-v2.ts` (`TAB_MARKETS_BY_SPORT`, `TAB_ORDER_BY_SPORT`, `DEFAULT_SUB_PILL_BY_SPORT`); replace 4 hard-coded `"calcio"` in `page-v2.tsx` with `event.sport?.slug ?? "calcio"`. Calcio behavior unchanged — additive refactor.

**Tennis config**: 5 tabs (Principali / Set / U/O Giochi / Handicap / Altri), 8 distinct market_types covered:
- Principali: `T/T Match (Escl. Ritiro)` (hero), `Totale set@2.5`, `Totale giochi@22.5`, `Handicap@-1.5`
- Set: `1X2 - 1T` (renamed VINCENTE 1° SET via override), `Totals 1st Set@picker`, `T/T 1° Set`, `T/T 2° Set`
- U/O Giochi: `Totale giochi@picker`
- Handicap: `Handicap@picker`
- Altri: catch-all auto-hidden

**Render rules added**:
- Hero condition extended to `T/T Match (Escl. Ritiro)` when isPrincipali.
- `MARKET_TITLE_OVERRIDE` map for display-name remapping (replaces uppercase market_type for misleading vocabulary).
- `NO_LINE_TITLE_TYPES` extended with tennis line-less markets.

**Edge cases discovered**: <fill in if any — e.g. Handicap acceptName regex extension, BO5 line fallback, etc>

**Mirror**: source files in `docs/superpowers/artifacts/2026-05-04-event-v2-batch-fixes/player/` (page-v2.tsx, market-config-v2.ts, market-categorizer-v2.ts updated). Plan + spec in respective `docs/superpowers/{plans,specs}/2026-05-04-event-v2-tennis*` files.

**Rollback**: `sed -i "s/=calcio,tennis/=calcio/" /root/betssolution-player/.env.local && rebuild && restart`. Code stays in tree; flag flip only.

**Next sport candidates** (volume order): basket (105 events), baseball (55), hockey-ghiaccio (22), pallamano (20), volley (12), cricket (9). Each needs its own design+plan iteration; the per-sport map architecture from this commit makes each subsequent sport ~50% smaller in scope (just data config + edge-case render rules).
```

- [ ] **Step 2: Add MEMORY.md index entry**

Insert as the first bullet under the new tennis section header at the top of `MEMORY.md`:

```markdown
## 🎾 Event-v2 tennis sport extension SHIPPED — 2026-05-04 ~HH:MM UTC
- [Tennis session memory](session-2026-05-04-event-v2-tennis.md) ⭐ — per-sport indirection (TAB_MARKETS_BY_SPORT etc), 5-tab tennis config, T/T Match hero, "1X2 - 1T" → "VINCENTE 1° SET" override

```

- [ ] **Step 3: Push all accumulated commits to origin**

```bash
cd C:/Users/philp/Documents/Project/betssolution-admin-plan-d
git log --oneline origin/feature/plan-d-settlement-d1..HEAD
# expect 3 new commits: tennis 1/4, 2/4, 3/4
git push origin feature/plan-d-settlement-d1
```

---

## Acceptance criteria (from spec, copied for verification)

- [ ] All 5 tennis tabs render with the configured markets in declared spec order.
- [ ] T/T Match in Principali uses hero rendering (large 2-button row).
- [ ] "1X2 - 1T" title displays as "VINCENTE 1° SET".
- [ ] Switching between tabs multiple times produces clean DOM (no stale content from previous tab).
- [ ] Calcio events behave exactly as before the change (regression baseline).
- [ ] Tennis Handicap section is non-empty for at least 80% of prematch events surveyed.
- [ ] Feature flag rollback restores legacy LiveMarketGrid for tennis without code changes.

## Rollback procedure (if catastrophic regression)

```bash
ssh scraper-vps "
  sed -i 's/=calcio,tennis/=calcio/' /root/betssolution-player/.env.local && \
  cd /root/betssolution-player && \
  source /root/.nvm/nvm.sh && nvm use 22 --silent && \
  npm run build 2>&1 | tail -3 && \
  cp -r .next/static .next/standalone/.next/ && \
  cp -r public .next/standalone/ && \
  ln -sf /root/betssolution-player/.env.local .next/standalone/.env.local && \
  systemctl restart betssolution-player
"
```

For deeper rollback (revert framework refactor), `git revert` the 3 tennis commits on the admin git branch, then mirror the reverted files back to scraper-vps with the standard build+restart procedure. The framework refactor is isolated to 3 files so revert is mechanical.
