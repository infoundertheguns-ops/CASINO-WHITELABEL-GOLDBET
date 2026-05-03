# Event Page Redesign (calcio pilot) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementare e deployare in produzione la nuova event page kiosk per calcio (sport pilota), preservando shell StanleyBet, dietro feature flag `NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio`. Altri sport restano sul path legacy.

**Architecture:** Frontend-only redesign in `/root/betssolution-player/`. 14 componenti nuovi sotto `components/event-v2/`, 3 lib config files, 1 page entry point nuovo (`page-v2.tsx`), 1 page entry point modificato per flag-branching. Zero DB changes, zero backend changes (path v2 `loadPlayerEventV2()` già fornisce dati). Coexistenza con event page legacy.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript strict, Tailwind, vitest + @testing-library/react (da aggiungere — Task 0). Lavoro su VPS scraper-vps via SSH, branch `feature/plan-d-settlement-d1`.

**Spec:** `docs/superpowers/specs/2026-05-03-event-page-redesign-design.md`

**Reference mockup HTML** (consultabili durante implementation): `C:\Users\philp\event-page-redesign\.superpowers\brainstorm\804-1777810933\*.html`

---

## Pre-implementation notes

- **Worktree**: il workflow del progetto è "branch diretto + push pattern VPS bundle", non worktrees. Lavorare su `feature/plan-d-settlement-d1` o sub-feature branch derivata.
- **Build runbook critico**: dopo ogni `npm run build`, eseguire SEMPRE `cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/`. Senza questo step i `.next/standalone` resta orfano e player serve 404.
- **Symlink runbook critico**: `.env.local` deve essere symlinkato in `.next/standalone/.env.local` dopo ogni build. Senza, le env var non sono lette dal runtime standalone.
- **Path v2 prerequisite**: `NEXT_PUBLIC_READ_FROM_V2=true` deve essere già attivo (lo è dal cutover S6 del 2026-05-01). Verifica con `grep READ_FROM_V2 /root/betssolution-player/.env.local`.

---

## Phase 0 — Setup test infrastructure

### Task 0.1: Investigare disponibilità player_team in v_player_outcomes

**Files:**
- Read: nessuna scrittura, solo investigation

**Why first:** L'open question #1 dello spec (sez 13) determina se PlayerListTwoCol può fare 2-col home/away (preferred) o cade su flat list (fallback). Necessario decidere PRIMA di implementare PlayerListTwoCol (Task 13).

- [ ] **Step 1: Ispeziona definition v_player_outcomes**

```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" -c "\d+ v_player_outcomes"'
```

- [ ] **Step 2: Sample 5 outcomes da Marcatore Anytime evento calcio**

```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" -c "
SELECT o.* FROM v_player_outcomes o
JOIN v_player_markets m ON o.market_id = m.id
JOIN v_player_events e ON m.event_id = e.id
WHERE e.sport_slug = '\''calcio'\''
AND m.market_type IN ('\''Marcatore Anytime'\'', '\''Anytime Goalscorer'\'')
LIMIT 5;"'
```

- [ ] **Step 3: Documenta esito in note implementation**

Crea `/root/betssolution-admin/docs/superpowers/notes/2026-05-03-player-team-investigation.md` con:
- Schema columns disponibili
- Sample rows (player name + team association se presente)
- **Decisione**: Opzione 1 (player_team disponibile, usa 2-col), Opzione 2 (mancante, view extension), Opzione 3 (fallback flat list)

- [ ] **Step 4: Commit nota**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git add docs/superpowers/notes/2026-05-03-player-team-investigation.md && git commit -m "notes: investigate v_player_outcomes player_team availability for event-v2 PlayerListTwoCol design

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

### Task 0.2: Setup vitest + @testing-library/react in player repo

**Files:**
- Create: `/root/betssolution-player/vitest.config.ts`
- Create: `/root/betssolution-player/__tests__/setup.ts`
- Modify: `/root/betssolution-player/package.json`
- Modify: `/root/betssolution-player/tsconfig.json` (add types)

- [ ] **Step 1: Install dev deps**

```bash
ssh scraper-vps 'source ~/.nvm/nvm.sh && cd /root/betssolution-player && npm install --save-dev vitest @testing-library/react @testing-library/jest-dom happy-dom @vitejs/plugin-react'
```

Expected: 5 packages added to devDependencies, no errors.

- [ ] **Step 2: Crea vitest.config.ts**

Content (copia adattata da admin repo + happy-dom per React testing):

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./__tests__/setup.ts"],
    include: ["__tests__/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
```

- [ ] **Step 3: Crea setup.ts**

```typescript
// __tests__/setup.ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 4: Aggiungi script test in package.json**

Modifica `scripts` section per aggiungere:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Aggiungi types in tsconfig.json**

Aggiungi a `compilerOptions.types`:
```json
"types": ["vitest/globals", "@testing-library/jest-dom"]
```

- [ ] **Step 6: Smoke test infra con dummy test**

Crea `/root/betssolution-player/__tests__/smoke.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("vitest runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `ssh scraper-vps 'source ~/.nvm/nvm.sh && cd /root/betssolution-player && npm test'`
Expected: `1 passed` con 1 test file.

- [ ] **Step 7: Commit**

NB: `/root/betssolution-player/` non è git repository (vedi memory item 7 player infra). Backup workflow tradizionale:

```bash
ssh scraper-vps 'cp -r /root/betssolution-player/__tests__ /root/betssolution-admin/docs/superpowers/artifacts/2026-05-03-event-v2-impl/player-tests-init/ 2>/dev/null || mkdir -p /root/betssolution-admin/docs/superpowers/artifacts/2026-05-03-event-v2-impl/ && cp -r /root/betssolution-player/__tests__ /root/betssolution-admin/docs/superpowers/artifacts/2026-05-03-event-v2-impl/player-tests-init && cp /root/betssolution-player/vitest.config.ts /root/betssolution-admin/docs/superpowers/artifacts/2026-05-03-event-v2-impl/'
ssh scraper-vps 'cd /root/betssolution-admin && git add docs/superpowers/artifacts/2026-05-03-event-v2-impl/ && git commit -m "artifact: vitest infra setup for player repo (event-v2 task 0.2)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

## Phase 1 — Lib config files

### Task 1: `lib/line-picker-defaults.ts`

**Files:**
- Create: `/root/betssolution-player/lib/line-picker-defaults.ts`
- Test: `/root/betssolution-player/__tests__/lib/line-picker-defaults.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/lib/line-picker-defaults.test.ts
import { describe, it, expect } from "vitest";
import { getDefaultLine, isSentinelLine } from "@/lib/line-picker-defaults";

describe("line-picker-defaults", () => {
  it("returns 2.5 for calcio U/O", () => {
    expect(getDefaultLine("calcio", "U/O")).toBe(2.5);
  });

  it("returns 0.5 for calcio U/O - 1T", () => {
    expect(getDefaultLine("calcio", "U/O - 1T")).toBe(0.5);
  });

  it("returns null for unknown sport", () => {
    expect(getDefaultLine("unknownsport", "U/O")).toBeNull();
  });

  it("returns null for unknown market", () => {
    expect(getDefaultLine("calcio", "unknown_market")).toBeNull();
  });

  it("identifies AH as sentinel (use nearest-to-zero)", () => {
    expect(isSentinelLine("calcio", "AH")).toBe(true);
    expect(isSentinelLine("calcio", "AH - 1T")).toBe(true);
    expect(isSentinelLine("calcio", "Hcap Corners")).toBe(true);
  });

  it("identifies U/O as static (not sentinel)", () => {
    expect(isSentinelLine("calcio", "U/O")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

```bash
ssh scraper-vps 'source ~/.nvm/nvm.sh && cd /root/betssolution-player && npx vitest run __tests__/lib/line-picker-defaults.test.ts'
```
Expected: FAIL "Cannot find module @/lib/line-picker-defaults".

- [ ] **Step 3: Implement**

```typescript
// lib/line-picker-defaults.ts

const SENTINEL_FAMILIES = new Set([
  "AH",
  "AH - 1T",
  "Hcap Corners",
  "European Hcap",
]);

const DEFAULTS: Record<string, Record<string, number>> = {
  calcio: {
    "U/O": 2.5,
    "U/O - 1T": 0.5,
    "U/O - 2T": 1.5,
    "Total Home": 1.5,
    "Total Away": 1.5,
    "AH": 0,
    "AH - 1T": 0,
    "European Hcap": -1,
    "Total Cards": 3.5,
    "Cards 1T": 1.5,
    "Cards 2T": 1.5,
    "Total Corners": 9.5,
    "Corners 1T": 4.5,
    "Corners 2T": 4.5,
    "Hcap Corners": 0,
    "Goalkeeper Saves": 3.5,
    "Player Shots": 1.5,
  },
};

export function getDefaultLine(sportSlug: string, marketType: string): number | null {
  return DEFAULTS[sportSlug]?.[marketType] ?? null;
}

export function isSentinelLine(sportSlug: string, marketType: string): boolean {
  return SENTINEL_FAMILIES.has(marketType) && getDefaultLine(sportSlug, marketType) !== null;
}
```

- [ ] **Step 4: Run test, verify PASS**

```bash
ssh scraper-vps 'source ~/.nvm/nvm.sh && cd /root/betssolution-player && npx vitest run __tests__/lib/line-picker-defaults.test.ts'
```
Expected: 6 passed.

- [ ] **Step 5: Backup + commit**

```bash
ssh scraper-vps 'mkdir -p /root/betssolution-admin/docs/superpowers/artifacts/2026-05-03-event-v2-impl/lib && cp /root/betssolution-player/lib/line-picker-defaults.ts /root/betssolution-admin/docs/superpowers/artifacts/2026-05-03-event-v2-impl/lib/ && cp /root/betssolution-player/__tests__/lib/line-picker-defaults.test.ts /root/betssolution-admin/docs/superpowers/artifacts/2026-05-03-event-v2-impl/lib/ && cd /root/betssolution-admin && git add docs/superpowers/artifacts/2026-05-03-event-v2-impl/lib/ && git commit -m "artifact: event-v2 task 1 line-picker-defaults

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

### Task 2: `lib/market-config-v2.ts`

**Files:**
- Create: `/root/betssolution-player/lib/market-config-v2.ts`

No tests (pure data file, validated by usage in market-categorizer-v2).

- [ ] **Step 1: Implement (copy from spec sez 3.1 verbatim)**

```typescript
// lib/market-config-v2.ts

export type MarketSpec = string;  // formato "MARKET_TYPE" o "MARKET_TYPE@suffix"

export type SubPillConfig = {
  markets: MarketSpec[];
};

export type TabConfig = {
  markets?: MarketSpec[];
  subPills?: Record<string, SubPillConfig>;
};

export type SportTabConfig = Record<string, TabConfig>;

export const FOOTBALL_TAB_MARKETS_V2: SportTabConfig = {
  "Principali": {
    markets: ["1X2", "DC", "GG/NG", "U/O@2.5", "DNB"],
  },
  "Gol/U/O": {
    markets: [
      "U/O@picker", "U/O - 1T@picker", "U/O - 2T@picker",
      "GG/NG", "GG/NG - 1T", "GG/NG - 2T",
      "Total Home@picker", "Total Away@picker",
    ],
  },
  "Handicap": {
    markets: ["AH@picker", "AH - 1T@picker", "European Hcap@chip"],
  },
  "Tempi": {
    subPills: {
      "1° Tempo": { markets: ["1X2 - 1T", "DC - 1T", "GG/NG - 1T", "U/O - 1T@picker", "DNB - 1T"] },
      "2° Tempo": { markets: ["1X2 - 2T", "DC - 2T", "GG/NG - 2T", "U/O - 2T@picker", "DNB - 2T"] },
      "Combo HT/FT": { markets: ["HT/FT", "Risultato Esatto"] },
    },
  },
  "Player": {
    subPills: {
      "Anytime": { markets: ["Marcatore Anytime"] },
      "1° Marcatore": { markets: ["1° Marcatore"] },
      "Ultimo": { markets: ["Ultimo Marcatore"] },
      "Marca+Assist": { markets: ["Marca + Assist"] },
      "GK Saves": { markets: ["Goalkeeper Saves@picker"] },
      "Shots OU": { markets: ["Player Shots@picker"] },
    },
  },
  "Stats": {
    subPills: {
      "Cards": { markets: ["Total Cards@picker", "Cards 1T@picker", "Cards 2T@picker", "Total Cards Squadra"] },
      "Corners": { markets: ["Total Corners@picker", "Corners 1T@picker", "Corners 2T@picker", "Hcap Corners@chip", "1° Corner"] },
    },
  },
};

export const FOOTBALL_TAB_ORDER = ["Principali", "Gol/U/O", "Handicap", "Tempi", "Player", "Stats"];

export const FOOTBALL_DEFAULT_SUB_PILL: Record<string, string> = {
  "Tempi": "Combo HT/FT",
  "Player": "Anytime",
  "Stats": "Cards",
};

export function parseMarketSpec(spec: MarketSpec): { marketType: string; suffix: string | null } {
  const idx = spec.indexOf("@");
  if (idx === -1) return { marketType: spec, suffix: null };
  return { marketType: spec.substring(0, idx), suffix: spec.substring(idx + 1) };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
ssh scraper-vps 'source ~/.nvm/nvm.sh && cd /root/betssolution-player && npx tsc --noEmit 2>&1 | grep -E "(market-config-v2|error)" | head -10'
```
Expected: nessun error riferito a `market-config-v2.ts`.

- [ ] **Step 3: Backup + commit**

```bash
ssh scraper-vps 'cp /root/betssolution-player/lib/market-config-v2.ts /root/betssolution-admin/docs/superpowers/artifacts/2026-05-03-event-v2-impl/lib/ && cd /root/betssolution-admin && git add docs/superpowers/artifacts/2026-05-03-event-v2-impl/lib/market-config-v2.ts && git commit -m "artifact: event-v2 task 2 market-config-v2

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

### Task 3: `lib/market-categorizer-v2.ts`

**Files:**
- Create: `/root/betssolution-player/lib/market-categorizer-v2.ts`
- Test: `/root/betssolution-player/__tests__/lib/market-categorizer-v2.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/lib/market-categorizer-v2.test.ts
import { describe, it, expect } from "vitest";
import { categorizeMarketsV2 } from "@/lib/market-categorizer-v2";

const mkMarket = (id: string, marketType: string, line: number | null = null) => ({
  id, market_type: marketType, line, outcomes: [],
});

describe("categorizeMarketsV2", () => {
  it("dispatches 1X2 to Principali tab", () => {
    const markets = [mkMarket("m1", "1X2")];
    const result = categorizeMarketsV2(markets, "calcio", "Principali");
    expect(result.markets.find(m => m.market_type === "1X2")).toBeTruthy();
  });

  it("groups U/O multi-line variants into Gol/U/O tab @picker", () => {
    const markets = [
      mkMarket("m1", "U/O", 1.5),
      mkMarket("m2", "U/O", 2.5),
      mkMarket("m3", "U/O", 3.5),
    ];
    const result = categorizeMarketsV2(markets, "calcio", "Gol/U/O");
    const uoGroup = result.groupedMarkets.get("U/O@picker");
    expect(uoGroup?.length).toBe(3);
  });

  it("U/O@2.5 in Principali keeps only line 2.5", () => {
    const markets = [
      mkMarket("m1", "U/O", 1.5),
      mkMarket("m2", "U/O", 2.5),
      mkMarket("m3", "U/O", 3.5),
    ];
    const result = categorizeMarketsV2(markets, "calcio", "Principali");
    const uo = result.markets.find(m => m.market_type === "U/O");
    expect(uo?.line).toBe(2.5);
  });

  it("U/O@2.5 falls back to closest if 2.5 missing", () => {
    const markets = [mkMarket("m1", "U/O", 2.0), mkMarket("m2", "U/O", 3.0)];
    const result = categorizeMarketsV2(markets, "calcio", "Principali");
    const uo = result.markets.find(m => m.market_type === "U/O");
    expect([2.0, 3.0]).toContain(uo?.line);
  });

  it("supports sub-pill filtering for Tempi", () => {
    const markets = [
      mkMarket("m1", "1X2 - 1T"),
      mkMarket("m2", "1X2 - 2T"),
      mkMarket("m3", "HT/FT"),
    ];
    const r1 = categorizeMarketsV2(markets, "calcio", "Tempi", "1° Tempo");
    expect(r1.markets.length).toBe(1);
    expect(r1.markets[0].market_type).toBe("1X2 - 1T");

    const r2 = categorizeMarketsV2(markets, "calcio", "Tempi", "Combo HT/FT");
    expect(r2.markets.length).toBe(1);
    expect(r2.markets[0].market_type).toBe("HT/FT");
  });

  it("returns empty for tab with no matching markets", () => {
    const markets = [mkMarket("m1", "1X2")];
    const result = categorizeMarketsV2(markets, "calcio", "Player", "Anytime");
    expect(result.markets.length).toBe(0);
  });

  it("preserves unknown markets in 'extras' bucket", () => {
    const markets = [mkMarket("m1", "Some Weird Market")];
    const result = categorizeMarketsV2(markets, "calcio", "Principali");
    expect(result.extras).toContain(markets[0]);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

```bash
ssh scraper-vps 'source ~/.nvm/nvm.sh && cd /root/betssolution-player && npx vitest run __tests__/lib/market-categorizer-v2.test.ts'
```

- [ ] **Step 3: Implement**

```typescript
// lib/market-categorizer-v2.ts
import {
  FOOTBALL_TAB_MARKETS_V2,
  parseMarketSpec,
  type SportTabConfig,
} from "./market-config-v2";

type MarketLike = {
  id: string;
  market_type: string;
  line: number | null;
  outcomes: unknown[];
};

export type CategorizeResult<M extends MarketLike> = {
  markets: M[];               // mercati single-line risolti per render diretto
  groupedMarkets: Map<string, M[]>; // chiave = "MARKET_TYPE@suffix", valore = varianti
  extras: M[];                // mercati che non matchano nessuna config (bucket fallback)
};

const SPORT_CONFIGS: Record<string, SportTabConfig> = {
  calcio: FOOTBALL_TAB_MARKETS_V2,
};

function findClosestLine<M extends MarketLike>(markets: M[], targetLine: number): M | null {
  if (markets.length === 0) return null;
  return markets.reduce((closest, m) => {
    if (m.line == null) return closest;
    if (closest.line == null) return m;
    return Math.abs(m.line - targetLine) < Math.abs(closest.line - targetLine) ? m : closest;
  });
}

export function categorizeMarketsV2<M extends MarketLike>(
  markets: M[],
  sportSlug: string,
  activeTab: string,
  activeSubPill?: string
): CategorizeResult<M> {
  const config = SPORT_CONFIGS[sportSlug];
  if (!config) return { markets: [], groupedMarkets: new Map(), extras: markets };

  const tabConfig = config[activeTab];
  if (!tabConfig) return { markets: [], groupedMarkets: new Map(), extras: [] };

  let specs: string[] = [];
  if (tabConfig.subPills && activeSubPill) {
    specs = tabConfig.subPills[activeSubPill]?.markets ?? [];
  } else if (tabConfig.markets) {
    specs = tabConfig.markets;
  }

  const result: CategorizeResult<M> = { markets: [], groupedMarkets: new Map(), extras: [] };
  const consumedIds = new Set<string>();

  for (const spec of specs) {
    const { marketType, suffix } = parseMarketSpec(spec);
    const matching = markets.filter(m => m.market_type === marketType);

    if (matching.length === 0) continue;

    if (suffix === "picker" || suffix === "chip") {
      result.groupedMarkets.set(spec, matching);
      matching.forEach(m => consumedIds.add(m.id));
    } else if (suffix && /^-?\d+(\.\d+)?$/.test(suffix)) {
      const targetLine = parseFloat(suffix);
      const closest = findClosestLine(matching, targetLine);
      if (closest) {
        result.markets.push(closest);
        consumedIds.add(closest.id);
      }
    } else if (suffix === "compact" || suffix === null) {
      const single = matching[0];
      if (single) {
        result.markets.push(single);
        consumedIds.add(single.id);
      }
    }
  }

  result.extras = markets.filter(m => !consumedIds.has(m.id));
  return result;
}
```

- [ ] **Step 4: Run test, verify PASS**

Run vitest. Expected: 7 passed.

Se "preserves unknown markets in 'extras' bucket" fail: verificare che i markets "1X2" sia consumato (in Principali config) e quindi NON sia in extras. Il test usa un market type inventato — verificare logica.

- [ ] **Step 5: Backup + commit**

```bash
ssh scraper-vps 'cp /root/betssolution-player/lib/market-categorizer-v2.ts /root/betssolution-admin/docs/superpowers/artifacts/2026-05-03-event-v2-impl/lib/ && cp /root/betssolution-player/__tests__/lib/market-categorizer-v2.test.ts /root/betssolution-admin/docs/superpowers/artifacts/2026-05-03-event-v2-impl/lib/ && cd /root/betssolution-admin && git add docs/superpowers/artifacts/2026-05-03-event-v2-impl/lib/ && git commit -m "artifact: event-v2 task 3 market-categorizer-v2

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

## Phase 2 — Atomic UI components

### Task 4: `components/event-v2/OutcomeButton.tsx` + `OddsFlash.tsx`

**Files:**
- Create: `/root/betssolution-player/components/event-v2/OutcomeButton.tsx`
- Create: `/root/betssolution-player/components/event-v2/OddsFlash.tsx`
- Test: `/root/betssolution-player/__tests__/components/event-v2/OutcomeButton.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// __tests__/components/event-v2/OutcomeButton.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import OutcomeButton from "@/components/event-v2/OutcomeButton";

const baseProps = {
  outcomeId: "leg1",
  outcomeIdV2: "v2leg1",
  label: "Inter",
  odds: 1.85,
  isSuspended: false,
  isManualSuspended: false,
  oddsChange: null,
  size: "standard" as const,
  onSelect: vi.fn(),
};

describe("OutcomeButton", () => {
  it("renders label and odds", () => {
    render(<OutcomeButton {...baseProps} />);
    expect(screen.getByText("Inter")).toBeInTheDocument();
    expect(screen.getByText("1.85")).toBeInTheDocument();
  });

  it("calls onSelect when clicked", () => {
    const onSelect = vi.fn();
    render(<OutcomeButton {...baseProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("does not call onSelect when suspended", () => {
    const onSelect = vi.fn();
    render(<OutcomeButton {...baseProps} isSuspended={true} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders lock icon when suspended", () => {
    render(<OutcomeButton {...baseProps} isSuspended={true} />);
    expect(screen.getByTestId("lock-icon")).toBeInTheDocument();
  });

  it("applies hero size class", () => {
    const { container } = render(<OutcomeButton {...baseProps} size="hero" />);
    expect(container.querySelector("[data-size='hero']")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

- [ ] **Step 3: Implement OddsFlash**

```tsx
// components/event-v2/OddsFlash.tsx
"use client";

import { useEffect, useState } from "react";

type Props = {
  oddsChange: 'up' | 'down' | null;
  children: React.ReactNode;
};

export default function OddsFlash({ oddsChange, children }: Props) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (oddsChange) {
      setActive(true);
      const t = setTimeout(() => setActive(false), 2000);
      return () => clearTimeout(t);
    }
  }, [oddsChange]);

  const bgColor = active && oddsChange === 'up' ? '#e6f7e6'
                : active && oddsChange === 'down' ? '#fde8e8'
                : 'transparent';

  return (
    <div
      style={{
        backgroundColor: bgColor,
        transition: 'background-color 2s ease-out',
      }}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Implement OutcomeButton**

```tsx
// components/event-v2/OutcomeButton.tsx
"use client";

import OddsFlash from "./OddsFlash";

type Size = 'hero' | 'standard' | 'compact';

type Props = {
  outcomeId: string;
  outcomeIdV2: string;
  label: string;
  odds: number;
  isSuspended: boolean;
  isManualSuspended: boolean;
  oddsChange: 'up' | 'down' | null;
  size: Size;
  onSelect: (outcome: { outcomeId: string; outcomeIdV2: string; odds: number; label: string }) => void;
};

const SIZE_STYLES: Record<Size, { padding: string; oddsFontSize: string; labelFontSize: string }> = {
  hero:     { padding: '22px', oddsFontSize: '22px', labelFontSize: '11px' },
  standard: { padding: '16px', oddsFontSize: '16px', labelFontSize: '10px' },
  compact:  { padding: '12px', oddsFontSize: '14px', labelFontSize: '9px' },
};

const LockIcon = () => (
  <svg
    data-testid="lock-icon"
    width="14" height="14" viewBox="0 0 24 24"
    style={{ position: 'absolute', top: 4, right: 4 }}
  >
    <rect x="5" y="11" width="14" height="10" rx="2" fill="#666"/>
    <path d="M8 11V7a4 4 0 1 1 8 0v4" stroke="#666" strokeWidth="2" fill="none"/>
  </svg>
);

export default function OutcomeButton({
  outcomeId, outcomeIdV2, label, odds, isSuspended, isManualSuspended,
  oddsChange, size, onSelect,
}: Props) {
  const suspended = isSuspended || isManualSuspended;
  const styles = SIZE_STYLES[size];

  const handleClick = () => {
    if (suspended) return;
    onSelect({ outcomeId, outcomeIdV2, odds, label });
  };

  return (
    <OddsFlash oddsChange={oddsChange}>
      <button
        type="button"
        data-size={size}
        onClick={handleClick}
        disabled={suspended}
        style={{
          position: 'relative',
          background: suspended ? '#e0e0e0' : '#f0f0f0',
          opacity: suspended ? 0.6 : 1,
          border: 'none',
          padding: styles.padding,
          borderRadius: 4,
          cursor: suspended ? 'not-allowed' : 'pointer',
          width: '100%',
          textAlign: 'center',
        }}
      >
        {suspended && <LockIcon />}
        <div style={{ fontSize: styles.labelFontSize, color: '#888' }}>{label}</div>
        <div style={{ fontSize: styles.oddsFontSize, fontWeight: 'bold', color: '#333', marginTop: 4 }}>
          {odds.toFixed(2)}
        </div>
      </button>
    </OddsFlash>
  );
}
```

- [ ] **Step 5: Run test, verify PASS**

Expected: 5 passed.

- [ ] **Step 6: Backup + commit**

```bash
ssh scraper-vps 'mkdir -p /root/betssolution-admin/docs/superpowers/artifacts/2026-05-03-event-v2-impl/components/event-v2 && cp /root/betssolution-player/components/event-v2/OutcomeButton.tsx /root/betssolution-player/components/event-v2/OddsFlash.tsx /root/betssolution-admin/docs/superpowers/artifacts/2026-05-03-event-v2-impl/components/event-v2/ && mkdir -p /root/betssolution-admin/docs/superpowers/artifacts/2026-05-03-event-v2-impl/__tests__/components/event-v2 && cp /root/betssolution-player/__tests__/components/event-v2/OutcomeButton.test.tsx /root/betssolution-admin/docs/superpowers/artifacts/2026-05-03-event-v2-impl/__tests__/components/event-v2/ && cd /root/betssolution-admin && git add docs/superpowers/artifacts/2026-05-03-event-v2-impl && git commit -m "artifact: event-v2 task 4 OutcomeButton + OddsFlash

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

### Task 5: `components/event-v2/MarketSection.tsx`

**Files:**
- Create: `/root/betssolution-player/components/event-v2/MarketSection.tsx`
- Test: `/root/betssolution-player/__tests__/components/event-v2/MarketSection.test.tsx`

NB: esiste già `components/markets/MarketSection.tsx` (legacy). NON modificarlo. Il nuovo è in `components/event-v2/`.

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MarketSection from "@/components/event-v2/MarketSection";

describe("MarketSection", () => {
  it("renders title and children", () => {
    render(
      <MarketSection title="GOAL / NO GOAL">
        <div>child content</div>
      </MarketSection>
    );
    expect(screen.getByText("GOAL / NO GOAL")).toBeInTheDocument();
    expect(screen.getByText("child content")).toBeInTheDocument();
  });

  it("renders 'altre linee' link if linkTo provided", () => {
    render(<MarketSection title="U/O 2.5" linkTo="Gol/U/O"><div /></MarketSection>);
    expect(screen.getByText(/altre linee/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

- [ ] **Step 3: Implement**

```tsx
// components/event-v2/MarketSection.tsx
"use client";

type Props = {
  title: string;
  linkTo?: string;
  onLinkClick?: () => void;
  children: React.ReactNode;
};

export default function MarketSection({ title, linkTo, onLinkClick, children }: Props) {
  return (
    <div style={{
      background: 'white',
      borderRadius: 4,
      padding: 8,
      marginBottom: 4,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
      }}>
        <span style={{
          fontWeight: 'bold',
          color: '#555',
          fontSize: 11,
          textTransform: 'uppercase',
        }}>{title}</span>
        {linkTo && (
          <button
            type="button"
            onClick={onLinkClick}
            style={{
              fontSize: 10,
              color: '#d0141c',
              background: 'none',
              border: 'none',
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
          >altre linee →</button>
        )}
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Run test, verify PASS**

- [ ] **Step 5: Backup + commit**

```bash
ssh scraper-vps 'cp /root/betssolution-player/components/event-v2/MarketSection.tsx /root/betssolution-admin/docs/superpowers/artifacts/2026-05-03-event-v2-impl/components/event-v2/ && cp /root/betssolution-player/__tests__/components/event-v2/MarketSection.test.tsx /root/betssolution-admin/docs/superpowers/artifacts/2026-05-03-event-v2-impl/__tests__/components/event-v2/ && cd /root/betssolution-admin && git add docs/superpowers/artifacts/2026-05-03-event-v2-impl && git commit -m "artifact: event-v2 task 5 MarketSection

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

## Phase 3 — Composite UI components

### Task 6: `HeroOutcomeRow.tsx` + `CompactOutcomeRow.tsx`

**Files:**
- Create: `/root/betssolution-player/components/event-v2/HeroOutcomeRow.tsx`
- Create: `/root/betssolution-player/components/event-v2/CompactOutcomeRow.tsx`
- Test: `/root/betssolution-player/__tests__/components/event-v2/OutcomeRow.test.tsx`

Entrambi rendono N OutcomeButton in una riga grid. Differiscono solo per `size` prop e gap. DRY: estrarre helper `<OutcomeRowGrid>` se ripetizione eccessiva.

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import HeroOutcomeRow from "@/components/event-v2/HeroOutcomeRow";

const outcomes = [
  { outcomeId: "1", outcomeIdV2: "v1", label: "Inter", odds: 2.05 },
  { outcomeId: "2", outcomeIdV2: "v2", label: "Pareggio", odds: 3.50 },
  { outcomeId: "3", outcomeIdV2: "v3", label: "Milan", odds: 3.40 },
];

describe("HeroOutcomeRow", () => {
  it("renders 3 buttons for 1X2", () => {
    render(<HeroOutcomeRow outcomes={outcomes} onSelect={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.getByText("Inter")).toBeInTheDocument();
    expect(screen.getByText("3.40")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

- [ ] **Step 3: Implement Hero + Compact**

```tsx
// components/event-v2/HeroOutcomeRow.tsx
"use client";
import OutcomeButton from "./OutcomeButton";

type OutcomeData = {
  outcomeId: string;
  outcomeIdV2: string;
  label: string;
  odds: number;
  isSuspended?: boolean;
  isManualSuspended?: boolean;
  oddsChange?: 'up' | 'down' | null;
};

type Props = {
  outcomes: OutcomeData[];
  onSelect: (o: { outcomeId: string; outcomeIdV2: string; odds: number; label: string }) => void;
};

export default function HeroOutcomeRow({ outcomes, onSelect }: Props) {
  const cols = outcomes.length;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: 6,
    }}>
      {outcomes.map(o => (
        <OutcomeButton
          key={o.outcomeId}
          outcomeId={o.outcomeId}
          outcomeIdV2={o.outcomeIdV2}
          label={o.label}
          odds={o.odds}
          isSuspended={o.isSuspended ?? false}
          isManualSuspended={o.isManualSuspended ?? false}
          oddsChange={o.oddsChange ?? null}
          size="hero"
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
```

```tsx
// components/event-v2/CompactOutcomeRow.tsx
"use client";
import OutcomeButton from "./OutcomeButton";

// stesso shape Props di HeroOutcomeRow, size diverso
type OutcomeData = {
  outcomeId: string;
  outcomeIdV2: string;
  label: string;
  odds: number;
  isSuspended?: boolean;
  isManualSuspended?: boolean;
  oddsChange?: 'up' | 'down' | null;
};

type Props = {
  outcomes: OutcomeData[];
  onSelect: (o: { outcomeId: string; outcomeIdV2: string; odds: number; label: string }) => void;
};

export default function CompactOutcomeRow({ outcomes, onSelect }: Props) {
  const cols = outcomes.length;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: 4,
    }}>
      {outcomes.map(o => (
        <OutcomeButton
          key={o.outcomeId}
          outcomeId={o.outcomeId}
          outcomeIdV2={o.outcomeIdV2}
          label={o.label}
          odds={o.odds}
          isSuspended={o.isSuspended ?? false}
          isManualSuspended={o.isManualSuspended ?? false}
          oddsChange={o.oddsChange ?? null}
          size="compact"
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test, verify PASS**

- [ ] **Step 5: Backup + commit**

(stessa struttura cp + commit dei task precedenti)

---

### Task 7: `LinePicker.tsx`

**Files:**
- Create: `/root/betssolution-player/components/event-v2/LinePicker.tsx`
- Test: `/root/betssolution-player/__tests__/components/event-v2/LinePicker.test.tsx`

- [ ] **Step 1: Write failing tests** (logiche TDD copy from spec sez 9.1)

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LinePicker from "@/components/event-v2/LinePicker";

const mkVariant = (line: number, underOdds: number, overOdds: number) => ({
  line,
  marketId: `m${line}`,
  marketIdV2: `v${line}`,
  outcomes: [
    { outcomeId: `u${line}`, outcomeIdV2: `vu${line}`, name: "Under", odds: underOdds },
    { outcomeId: `o${line}`, outcomeIdV2: `vo${line}`, name: "Over", odds: overOdds },
  ],
});

describe("LinePicker", () => {
  it("default line shown highlighted with star marker", () => {
    const variants = [mkVariant(1.5, 1.10, 7.50), mkVariant(2.5, 1.85, 1.95), mkVariant(3.5, 2.50, 1.55)];
    render(<LinePicker marketFamily="U/O" variants={variants} defaultLine={2.5} outcomeRenderer="under-over" onSelect={() => {}} />);
    expect(screen.getByText(/2\.5.*★/)).toBeInTheDocument();
  });

  it("falls back to closest if default line missing", () => {
    const variants = [mkVariant(2.0, 1.5, 2.5), mkVariant(3.0, 2.5, 1.5)];
    render(<LinePicker marketFamily="U/O" variants={variants} defaultLine={2.5} outcomeRenderer="under-over" onSelect={() => {}} />);
    // 2.0 e 3.0 equidistanti; convenzione = inferiore (2.0)
    expect(screen.getByText(/2\.0.*★/)).toBeInTheDocument();
  });

  it("shows top 3 (default + 1 below + 1 above)", () => {
    const variants = [mkVariant(1.5, 1.10, 7.50), mkVariant(2.5, 1.85, 1.95), mkVariant(2.75, 2.05, 1.78), mkVariant(3.5, 2.50, 1.55), mkVariant(4.5, 4.00, 1.25)];
    const { container } = render(<LinePicker marketFamily="U/O" variants={variants} defaultLine={2.5} outcomeRenderer="under-over" onSelect={() => {}} />);
    // Visible top-3 = 1.5, 2.5, 2.75 (default + 1 sotto + 1 sopra)
    const visibleLines = container.querySelectorAll("[data-line]");
    expect(visibleLines).toHaveLength(3);
  });

  it("expand button shows remaining variants", () => {
    const variants = [mkVariant(1.5, 1.10, 7.50), mkVariant(2.5, 1.85, 1.95), mkVariant(2.75, 2.05, 1.78), mkVariant(3.5, 2.50, 1.55), mkVariant(4.5, 4.00, 1.25)];
    render(<LinePicker marketFamily="U/O" variants={variants} defaultLine={2.5} outcomeRenderer="under-over" onSelect={() => {}} />);
    expect(screen.getByText(/altre 2 linee/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/altre 2 linee/i));
    // After expand, all 5 should be visible
    expect(screen.queryByText(/altre/i)).not.toBeInTheDocument();
  });

  it("with 1 variant, no picker no expand", () => {
    const variants = [mkVariant(2.5, 1.85, 1.95)];
    const { container } = render(<LinePicker marketFamily="U/O" variants={variants} defaultLine={2.5} outcomeRenderer="under-over" onSelect={() => {}} />);
    expect(screen.queryByText(/altre/i)).not.toBeInTheDocument();
    expect(container.querySelectorAll("[data-line]")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

- [ ] **Step 3: Implement**

```tsx
// components/event-v2/LinePicker.tsx
"use client";

import { useState } from "react";
import OutcomeButton from "./OutcomeButton";

type OutcomeShape = {
  outcomeId: string;
  outcomeIdV2: string;
  name: string;
  odds: number;
  isSuspended?: boolean;
  isManualSuspended?: boolean;
  oddsChange?: 'up' | 'down' | null;
};

type LineVariant = {
  line: number;
  marketId: string;
  marketIdV2: string;
  outcomes: OutcomeShape[];
};

type Renderer = 'under-over' | 'team-handicap' | 'cards-corners' | 'shots';

type Props = {
  marketFamily: string;
  variants: LineVariant[];
  defaultLine: number;
  topVisibleCount?: number;
  outcomeRenderer: Renderer;
  expandedInitially?: boolean;
  homeTeamName?: string;  // for team-handicap renderer
  awayTeamName?: string;
  onSelect: (o: { outcomeId: string; outcomeIdV2: string; odds: number; label: string }) => void;
};

function pickDefault(variants: LineVariant[], target: number): LineVariant | null {
  if (variants.length === 0) return null;
  return [...variants].sort((a, b) => {
    const da = Math.abs(a.line - target);
    const db = Math.abs(b.line - target);
    if (da !== db) return da - db;
    return a.line - b.line;  // tie-break: prefer lower line
  })[0];
}

function renderLabel(renderer: Renderer, outcome: OutcomeShape, line: number, home?: string, away?: string): string {
  switch (renderer) {
    case 'team-handicap':
      const sign = line < 0 ? line.toFixed(line % 1 === 0 ? 0 : 2) : `+${line.toFixed(line % 1 === 0 ? 0 : 2)}`;
      const teamForOutcome = outcome.name.toLowerCase().includes('home') || outcome.name === '1' ? home : away;
      return `${teamForOutcome ?? outcome.name} ${sign}`;
    default:
      return outcome.name;
  }
}

export default function LinePicker({
  marketFamily, variants, defaultLine, topVisibleCount = 3,
  outcomeRenderer, expandedInitially = false,
  homeTeamName, awayTeamName, onSelect,
}: Props) {
  const [expanded, setExpanded] = useState(expandedInitially);
  if (variants.length === 0) return null;

  const sorted = [...variants].sort((a, b) => a.line - b.line);
  const defaultVariant = pickDefault(sorted, defaultLine);
  if (!defaultVariant) return null;

  const defaultIdx = sorted.indexOf(defaultVariant);

  // Top visible: default + 1 below + 1 above (bounded)
  const startIdx = Math.max(0, defaultIdx - 1);
  const endIdx = Math.min(sorted.length, defaultIdx + 2);
  const topVisible = sorted.slice(startIdx, endIdx);
  const remaining = sorted.filter(v => !topVisible.includes(v));

  const visibleSet = expanded ? sorted : topVisible;

  return (
    <div style={{ background: '#f5f5f5', padding: 8, borderRadius: 4, fontSize: 13 }}>
      {visibleSet.map(v => (
        <div
          key={v.marketId}
          data-line={v.line}
          style={{
            display: 'grid',
            gridTemplateColumns: '60px 1fr 1fr',
            gap: 6,
            padding: '8px 0',
            borderBottom: '1px solid #eee',
            alignItems: 'center',
            background: v === defaultVariant ? '#fffbe6' : 'transparent',
          }}
        >
          <div style={{ fontWeight: 'bold' }}>
            {v.line}{v === defaultVariant ? ' ★' : ''}
          </div>
          {v.outcomes.map(o => (
            <OutcomeButton
              key={o.outcomeId}
              outcomeId={o.outcomeId}
              outcomeIdV2={o.outcomeIdV2}
              label={renderLabel(outcomeRenderer, o, v.line, homeTeamName, awayTeamName)}
              odds={o.odds}
              isSuspended={o.isSuspended ?? false}
              isManualSuspended={o.isManualSuspended ?? false}
              oddsChange={o.oddsChange ?? null}
              size="standard"
              onSelect={onSelect}
            />
          ))}
        </div>
      ))}
      {!expanded && remaining.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{
            width: '100%',
            padding: 12,
            background: 'white',
            border: '1px dashed #aaa',
            borderRadius: 4,
            marginTop: 8,
            color: '#d0141c',
            fontWeight: 'bold',
            cursor: 'pointer',
          }}
        >+ altre {remaining.length} linee</button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test, verify PASS**

- [ ] **Step 5: Backup + commit**

---

### Task 8: `AsianHandicapBlock.tsx`

**Files:**
- Create: `/root/betssolution-player/components/event-v2/AsianHandicapBlock.tsx`
- Test: `/root/betssolution-player/__tests__/components/event-v2/AsianHandicapBlock.test.tsx`

Wrapper di LinePicker con renderer team-handicap + sentinel default (nearest-to-zero).

Pattern simile a Task 7. Implementare wrapper sottile che importa LinePicker e usa `isSentinelLine` per scegliere defaultLine.

- [ ] **Step 1-5**: stesso TDD pattern di Task 7. Test: AH renderer aggiunge label "Inter -0.5" / "Milan +0.5", default = linea con `Math.abs` minimo.

---

### Task 9: `EuropeanHandicapBlock.tsx`

**Files:**
- Create: `/root/betssolution-player/components/event-v2/EuropeanHandicapBlock.tsx`
- Test: `/root/betssolution-player/__tests__/components/event-v2/EuropeanHandicapBlock.test.tsx`

Diverso da LinePicker: 3-button row (1X2 con handicap) + chip picker linee in basso (no expand). Default linea -1.

- [ ] **Step 1-5**: TDD. Implementare row + chip picker. Test render 3 buttons + chip click cambia variante visualizzata.

---

### Task 10: `MatrixGrid.tsx` (HT/FT)

**Files:**
- Create: `/root/betssolution-player/components/event-v2/MatrixGrid.tsx`
- Test: `/root/betssolution-player/__tests__/components/event-v2/MatrixGrid.test.tsx`

3×3 grid con headers riga (HT 1/X/2) + colonna (Finale 1/X/2). Mancanza outcome → "—".

- [ ] **Step 1-5**: TDD. Test: 9 outcomes mappati correttamente, missing outcome → "—" non clickable, header label corretti.

---

### Task 11: `ScoreGrid.tsx` (Risultato Esatto)

**Files:**
- Create: `/root/betssolution-player/components/event-v2/ScoreGrid.tsx`
- Test: `/root/betssolution-player/__tests__/components/event-v2/ScoreGrid.test.tsx`

5×5 grid (0-4+ × 0-4+), parsing label "X-Y", default cell highlighted "1-1".

- [ ] **Step 1-5**: TDD. Test: parsing "1-0" → cella corretta, "4+" cattura aggregata 4-0/4-1/5-0, default 1-1 highlighted.

---

## Phase 4 — List + nav components

### Task 12: `PlayerListTwoCol.tsx`

**Files:**
- Create: `/root/betssolution-player/components/event-v2/PlayerListTwoCol.tsx`
- Test: `/root/betssolution-player/__tests__/components/event-v2/PlayerListTwoCol.test.tsx`

**Decisione condizionale dal Task 0.1**:
- Se `player_team` disponibile in `v_player_outcomes` → 2-col home/away (preferred)
- Se mancante → flat list sortata per odds (fallback opzione 2 dello spec)

- [ ] **Step 1-5**: TDD basato su decisione Task 0.1. Test: sort asc by odds, 2-col split se opzione 1, flat list se opzione 2.

---

### Task 13: `TabBar.tsx`

**Files:**
- Create: `/root/betssolution-player/components/event-v2/TabBar.tsx`
- Test: `/root/betssolution-player/__tests__/components/event-v2/TabBar.test.tsx`

6 tab pills (rosso #d0141c StanleyBet style), riusa il pattern del rendering tab esistente in `event/[eventId]/page.tsx:160-180` ma componentizzato.

- [ ] **Step 1-5**: TDD. Test: 6 tab rendered, active tab evidenziato, click cambia activeTab via callback.

---

### Task 14: `SubPillBar.tsx`

**Files:**
- Create: `/root/betssolution-player/components/event-v2/SubPillBar.tsx`
- Test: `/root/betssolution-player/__tests__/components/event-v2/SubPillBar.test.tsx`

Sub-pillole orizzontali border-radius 16px, pattern stessa StanleyBet ma più sottili.

- [ ] **Step 1-5**: TDD. Test: render lista pill, active highlighted, callback su change.

---

## Phase 5 — Page assembly

### Task 15: `app/(kiosk)/event/[eventId]/page-v2.tsx`

**Files:**
- Create: `/root/betssolution-player/app/(kiosk)/event/[eventId]/page-v2.tsx`

Composer principale. Importa tutti i componenti di Phase 1-4. Usa `categorizeMarketsV2` per dispatchare mercati alla tab/sub-pill attiva. Renderizza ogni mercato secondo suffix (`@picker` → LinePicker, `@compact` → MatrixGrid o ScoreGrid in base a market_type, ecc.).

NB: questo task è grosso. Dividerlo in sub-step può essere appropriato. Linea guida:

- [ ] **Step 1: Boilerplate page (clone struct da page.tsx legacy)**

Header + tab bar (riusa logica esistente o usa nuovo TabBar component).

- [ ] **Step 2: State + fetch**

`activeTab` state, `activeSubPill` state per tab. Fetch via `loadPlayerEventV2` esistente.

- [ ] **Step 3: Categorizer call + dispatch render**

```tsx
const result = categorizeMarketsV2(event.markets, "calcio", activeTab, activeSubPill);
return (
  <>
    {result.markets.map(m => renderMarketByType(m))}
    {[...result.groupedMarkets.entries()].map(([spec, variants]) => renderGroupedByType(spec, variants))}
  </>
);
```

- [ ] **Step 4: Helper renderMarketByType + renderGroupedByType**

Switch case per market_type → componente:
- "1X2" → HeroOutcomeRow (in Principali) o CompactOutcomeRow
- "DC", "GG/NG", "DNB" → CompactOutcomeRow
- "HT/FT" → MatrixGrid
- "Risultato Esatto" → ScoreGrid
- "Marcatore Anytime" e simili → PlayerListTwoCol
- "@picker" suffix → LinePicker
- "@chip" suffix → EuropeanHandicapBlock o LinePicker variant

- [ ] **Step 5: Sub-pill bar quando tab ha subPills**

```tsx
const tabConfig = FOOTBALL_TAB_MARKETS_V2[activeTab];
{tabConfig?.subPills && (
  <SubPillBar pills={Object.keys(tabConfig.subPills)} active={activeSubPill} onChange={setActiveSubPill} />
)}
```

- [ ] **Step 6: Empty state per tab/sub-pill**

```tsx
{result.markets.length === 0 && result.groupedMarkets.size === 0 && (
  <div>Nessun mercato disponibile per questa categoria</div>
)}
```

- [ ] **Step 7: Verify TypeScript**

```bash
ssh scraper-vps 'source ~/.nvm/nvm.sh && cd /root/betssolution-player && npx tsc --noEmit 2>&1 | grep -E "page-v2|error" | head -20'
```

Expected: nessun errore in page-v2.tsx (può esserci errore preesistente in altri file della repo).

- [ ] **Step 8: Backup + commit**

---

## Phase 6 — Wiring + verify

### Task 16: Modify `app/(kiosk)/event/[eventId]/page.tsx` per feature flag

**Files:**
- Modify: `/root/betssolution-player/app/(kiosk)/event/[eventId]/page.tsx`

- [ ] **Step 1: Backup pre-modifica**

```bash
ssh scraper-vps 'cp /root/betssolution-player/app/\(kiosk\)/event/\[eventId\]/page.tsx /root/betssolution-player/app/\(kiosk\)/event/\[eventId\]/page.tsx.bak-pre-eventv2-$(date +%Y%m%d-%H%M%S)'
```

- [ ] **Step 2: Modify**

Aggiungere import + branch:

```tsx
import EventDetailPageV2 from "./page-v2";
// ... altri import ...

export default function EventDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const [event, setEvent] = useState<Event | null>(null);
  // ... fetch logic invariato ...

  // Feature flag branching
  const newSports = (process.env.NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS ?? '').split(',').filter(Boolean);
  if (event && newSports.includes(event.sportSlug)) {
    return <EventDetailPageV2 event={event} eventId={eventId} />;
  }

  // Path legacy invariato (resto del componente)
  // ... return JSX legacy ...
}
```

- [ ] **Step 3: Backup + commit**

---

### Task 17: Verify `lib/queries/player-event-v2.ts` no whitelist

**Files:**
- Read: `/root/betssolution-player/lib/queries/player-event-v2.ts`

- [ ] **Step 1: Inspect query**

```bash
ssh scraper-vps 'cat /root/betssolution-player/lib/queries/player-event-v2.ts'
```

Verificare che la query SQL/Supabase sui markets NON contenga filtro `.in("market_name", whitelist)` o equivalente che limiti i markets esposti.

- [ ] **Step 2: Smoke test count**

```bash
ssh scraper-vps 'set -a; source /root/betssolution-admin/services/odds-api-ingester/.env; set +a; psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM v_player_markets WHERE event_id = '\''<sample_event_id>'\''"' 
# vs API response markets count for same event
ssh scraper-vps 'curl -sS "http://127.0.0.1:3001/api/event/<sample_event_id>" | jq ".markets | length"'
```

Counts must match (or differ only by additional metadata markets the page filters out client-side).

- [ ] **Step 3: Documenta esito** in nota investigation Task 0.1

Se filter trovato: rimuoverlo (sub-task) oppure annotare in plan come technical debt + raccomandare fix successivo.

---

## Phase 7 — Deploy

### Task 18: Deploy Phase 1 — flag vuoto, smoke test legacy

- [ ] **Step 1: Backup .env.local**

```bash
ssh scraper-vps 'cp /root/betssolution-player/.env.local /root/betssolution-player/.env.local.bak-pre-eventv2-$(date +%Y%m%d-%H%M%S)'
```

- [ ] **Step 2: Build + deploy con flag VUOTO**

`NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS` deve essere assente o `=` vuoto.

```bash
ssh scraper-vps 'source ~/.nvm/nvm.sh && cd /root/betssolution-player && npm run build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/ && ln -sf /root/betssolution-player/.env.local /root/betssolution-player/.next/standalone/.env.local && systemctl restart betssolution-player'
```

- [ ] **Step 3: Smoke legacy invariato**

```bash
ssh scraper-vps 'curl -sS -o /dev/null -w "/api/health: %{http_code} %{time_total}s\n" "http://127.0.0.1:3001/api/health"; curl -sS -o /dev/null -w "calcio listing: %{http_code} %{time_total}s\n" "http://127.0.0.1:3001/api/sportsbook?sport=calcio&limit=5"'
```

Apri 5 event calcio random nel browser (passare URL via user). Verifica nessun crash, layout legacy invariato.

---

### Task 19: Deploy Phase 2 — abilita flag calcio

- [ ] **Step 1: Edit .env.local**

```bash
ssh scraper-vps 'grep -q NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS /root/betssolution-player/.env.local && sed -i "s/^NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=.*/NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio/" /root/betssolution-player/.env.local || echo "NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio" >> /root/betssolution-player/.env.local'
```

- [ ] **Step 2: Re-build + restart**

```bash
ssh scraper-vps 'source ~/.nvm/nvm.sh && cd /root/betssolution-player && npm run build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/ && ln -sf /root/betssolution-player/.env.local /root/betssolution-player/.next/standalone/.env.local && systemctl restart betssolution-player'
```

- [ ] **Step 3: Smoke V2 calcio**

Test checklist (vedi spec sez 9.3):
- 3 eventi calcio prematch random → naviga 6 tab
- Click outcome in ogni tab → bet slip popola
- Aspetta 60s → polling, flash visibile
- Sub-pill picker → contenuto cambia
- Line picker U/O → expand inline
- Apri evento basket/tennis → path legacy invariato

- [ ] **Step 4: Documenta smoke esito**

Crea `/root/betssolution-admin/docs/superpowers/runbooks/event-v2-smoke-test.md` con checklist + risultati.

- [ ] **Step 5: Commit smoke runbook**

---

### Task 20: Monitoring + cleanup follow-up

- [ ] **Step 1: Setup monitoring 1-2 settimane**

Periodically check player logs:

```bash
ssh scraper-vps 'tail -200 /var/log/betssolution-player.log | grep -E "(error|exception|event-v2)"'
```

- [ ] **Step 2: Aggiorna registry items in MEMORY.md**

Crea memory entry "Plan B (event page redesign calcio) shipped — 2026-XX-XX".

- [ ] **Step 3: (Opzionale) Setup Playwright visual regression**

Vedi spec sez 9.2 precondition. Se non necessario per primo release, defer come task separato.

---

## Notes su execution

- **Subagent-driven recommended** per Phase 1-4 (componenti indipendenti, parallelizzabili). Phase 5+ richiede sequenzialità.
- **Time estimate aggregato**: Phase 0-4 ~2-3 giorni focused; Phase 5-7 ~1-2 giorni; total ~4-5 giorni di lavoro effettivo.
- **Rollback in qualsiasi momento**: `NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=` (vuoto) + rebuild + restart. File nuovi restano sul disk.
- **Player repo non-git**: artifacts backup pattern (cp in admin/docs/superpowers/artifacts/) usato per ogni task. Plan futuro: convertire player in git repo (registry item).
