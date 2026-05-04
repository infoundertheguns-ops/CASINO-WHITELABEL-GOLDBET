# Event-v2 basket extension + Player Props transformer fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `basket` sport to event-v2 detail page (replicating tennis pattern) and fix the ingester transformer to preserve player labels in `{label, over, under}` markets so basket Player Props render correctly.

**Architecture:** Frontend-only data config for basket (no framework refactor) + targeted backend fix in `transformer.ts` rule ordering + new MEDIAN_LINE sentinel in LinePicker for league-variable U/O lines + new `@over-under-flat` suffix and `PlayerOverUnderRow` component for paired Over/Under-per-player rendering.

**Tech Stack:** TypeScript, React, Next.js (player), Node.js + Vitest (admin ingester), Supabase REST + service-role, systemd services.

**Spec:** `docs/superpowers/specs/2026-05-04-event-v2-basket-design.md`

---

## Pre-flight

- [ ] **Step 0a: Verify VPS state matches end-of-previous-session**

```bash
ssh scraper-vps "systemctl is-active betssolution-player odds-api-ingester; \
  cat /root/betssolution-player/.next/BUILD_ID; \
  grep NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS /root/betssolution-player/.env.local; \
  cd /root/betssolution-admin && git rev-parse --abbrev-ref HEAD && git log -1 --oneline"
```

Expected:
- Both services `active`
- BUILD_ID `LSNWI9YAkVtiTA_sn-l4D` (or newer if anyone deployed in between)
- Flag value `=calcio,tennis`
- Branch `feature/plan-d-settlement-d1`
- HEAD includes commit `372a9f8 docs(spec): event-v2 basket extension + Player Props transformer fix`

If any divergence — stop and investigate before proceeding.

---

## Phase 1 — Backend transformer fix

### Task 1: Cross-sport regression — fixture grep

**Files:**
- Read: `services/odds-api-ingester/src/__tests__/fixtures/*.json` (currently only `event-pisa-lecce.json`)
- Output: notes inline (in this plan, in step 1c) — no file output yet

**Note**: Absence of findings in fixtures does NOT prove safety — fixtures only cover football. The **live API probe (Step 1b) is the load-bearing check**, not the fixture grep.

- [ ] **Step 1a: Grep all fixtures for `{label, over, under}` triples**

Run on VPS:
```bash
ssh scraper-vps 'cd /root/betssolution-admin/services/odds-api-ingester/src/__tests__/fixtures && python3 -c "
import json, glob
for f in glob.glob(\"*.json\"):
    d = json.load(open(f))
    for bk, mkts in (d.get(\"bookmakers\") or {}).items():
        for m in mkts:
            for o in m.get(\"odds\", []):
                if all(k in o for k in (\"label\", \"over\", \"under\")):
                    print(f\"{f} :: {bk} :: {m[\\\"name\\\"]} :: {o}\")
"'
```

Expected: prints zero or a small set of `{label, over, under}` instances. Document each in step 1c.

- [ ] **Step 1b: Live API probe — 1 active event per current sport**

Pick 1 prematch event ID per sport from `v_player_events` (excluding NULL sport_slug):
```bash
ssh scraper-vps "cd /root/betssolution-player && SR=\$(grep ^SUPABASE_SERVICE_ROLE_KEY .env.local | cut -d= -f2) && SU=\$(grep ^NEXT_PUBLIC_SUPABASE_URL .env.local | cut -d= -f2) && curl -sS \"\$SU/rest/v1/v_player_events?status=eq.prematch&select=odds_api_id,sport_slug,home_team&limit=2000\" -H \"apikey: \$SR\" -H \"Authorization: Bearer \$SR\" | python3 -c 'import json,sys,collections; d=json.load(sys.stdin); seen={}; 
for r in d:
  s=r[\"sport_slug\"]
  if s and s not in seen: seen[s]=r[\"odds_api_id\"]
for s,oid in seen.items(): print(s, oid)'"
```

For each sport's event, fetch raw odds from odds-api with multiple bookmakers and grep for `{label, over, under}` shapes:
```bash
ssh scraper-vps 'KEY=$(grep ^ODDS_API_KEY /root/betssolution-admin/services/odds-api-ingester/.env | cut -d= -f2) && for OAID in <list-from-above>; do
  echo "=== odds_api_id=$OAID ==="
  curl -sS "https://api.odds-api.io/v3/odds?eventId=$OAID&bookmakers=Bet365,BetUK,Pamestoixima,DraftKings&apiKey=$KEY" | \
  python3 -c "
import json, sys
try: d = json.load(sys.stdin)
except: print(\"  (parse error)\"); sys.exit()
for bk, mkts in (d.get(\"bookmakers\") or {}).items():
    for m in mkts:
        for o in m.get(\"odds\", []):
            if all(k in o for k in (\"label\", \"over\", \"under\")):
                print(f\"  {bk} :: {m[\\\"name\\\"]} :: {o}\")
"
done'
```

- [ ] **Step 1c: Classify findings**

For each finding from steps 1a-1b, write a one-line entry under one of:

**Benign** (label redundant with market_name, e.g. `"First 10 Minutes"` market with label `"First 10"`):
- `<sport> :: <market_name> :: label="<sample>"` — reason

**Surprising-positive** (label adds info, was previously discarded — basket Player Props goes here):
- `<sport> :: <market_name> :: label="<sample>"` — reason

**Breaking** (rule 0a would change outcome_key in a way that breaks settlement classifier or frontend):
- `<sport> :: <market_name> :: label="<sample>"` — reason

If any **Breaking** entries → STOP. Spec a guard or scope-limit rule 0a (e.g. only fire for market_name `"Player Props"`) before proceeding.

- [ ] **Step 1d: Commit findings to memory artifact**

If non-trivial findings, save to `docs/superpowers/artifacts/2026-05-04-event-v2-basket/regression-check.md` and commit at end of Phase 1. If empty (no findings, rule 0a is purely additive for new sport) just record "no findings" inline in step 1c.

### Task 2: Failing transformer test for rule 0a

**Files:**
- Modify: `services/odds-api-ingester/src/__tests__/transformer.test.ts`

- [ ] **Step 2a: Read existing test file structure**

```bash
ssh scraper-vps 'head -60 /root/betssolution-admin/services/odds-api-ingester/src/__tests__/transformer.test.ts'
```

Note the import pattern, describe/it blocks, fixture utilities.

- [ ] **Step 2b: Add 3 new test cases for rule 0a**

Add to `transformer.test.ts` inside an appropriate `describe` block (or new `describe('rule 0a — labeled totals')`):

```ts
it('rule 0a: preserves label when over+under both present', () => {
  const market_key = { event_odds_api_id: 1, bookmaker: 'BetUK', market_name: 'Player Props' };
  const out = expandOutcome('Player Props', {
    label: 'LeBron James', hdp: 25.5, over: '1.87', under: '1.84',
  } as Record<string, unknown>, market_key);
  expect(out).toHaveLength(2);
  expect(out[0]).toMatchObject({ outcome_key: 'LeBron James::over',  line: 25.5, odds: 1.87 });
  expect(out[1]).toMatchObject({ outcome_key: 'LeBron James::under', line: 25.5, odds: 1.84 });
});

it('rule 0a: preserves label with stat suffix', () => {
  const market_key = { event_odds_api_id: 1, bookmaker: 'BetUK', market_name: 'Player Props' };
  const out = expandOutcome('Player Props', {
    label: 'Adam Mokoka (Points)', hdp: 10.5, over: '1.91', under: '1.81',
  } as Record<string, unknown>, market_key);
  expect(out).toHaveLength(2);
  expect(out[0]).toMatchObject({ outcome_key: 'Adam Mokoka (Points)::over', line: 10.5, odds: 1.91 });
  expect(out[1]).toMatchObject({ outcome_key: 'Adam Mokoka (Points)::under', line: 10.5, odds: 1.81 });
});

it('rule 1 still fires when label absent (regression)', () => {
  const market_key = { event_odds_api_id: 1, bookmaker: 'Bet365', market_name: 'Goals Over/Under' };
  const out = expandOutcome('Goals Over/Under', {
    hdp: 2.5, over: '2.500', under: '1.533',
  } as Record<string, unknown>, market_key);
  expect(out).toHaveLength(2);
  expect(out[0]).toMatchObject({ outcome_key: 'over',  line: 2.5, odds: 2.5 });
  expect(out[1]).toMatchObject({ outcome_key: 'under', line: 2.5, odds: 1.533 });
});
```

- [ ] **Step 2c: Run tests, confirm 2 fail / 1 passes**

```bash
ssh scraper-vps 'cd /root/betssolution-admin/services/odds-api-ingester && npm test -- --run transformer'
```

Expected: 2 new "rule 0a" tests FAIL (outcome_key without label prefix), regression test PASSES.

If pisa-lecce or other existing tests fail → halt, investigate (might be test pollution).

### Task 3: Implement rule 0a in transformer.ts

**Files:**
- Modify: `services/odds-api-ingester/src/transformer.ts:97-102` (insert before rule 1)

- [ ] **Step 3a: Add rule 0a above rule 1**

In `expandOutcome` function, just before the comment `// 1. Totals-style: over+under both present`, add:

```ts
  // 0a. Labeled totals: label + over + under all present → preserve player/label identity.
  // Without this, rule 1 absorbs over+under and DISCARDS the label, losing player
  // identity for markets like Player Props (basketball BetUK).
  if (label != null && over != null && under != null) {
    out.push({ market_key, outcome_key: `${label}::over`,  line: hdp, odds: over });
    out.push({ market_key, outcome_key: `${label}::under`, line: hdp, odds: under });
    return out;
  }

```

Confirm `label` is already extracted earlier in the function (it is — `const label = typeof raw.label === 'string' ? raw.label : null;` line ~93).

- [ ] **Step 3b: Run tests, confirm all pass**

```bash
ssh scraper-vps 'cd /root/betssolution-admin/services/odds-api-ingester && npm test -- --run transformer'
```

Expected: ALL transformer tests PASS, including 3 new ones.

- [ ] **Step 3c: Run full ingester test suite**

```bash
ssh scraper-vps 'cd /root/betssolution-admin/services/odds-api-ingester && npm test'
```

Expected: full suite PASS (65+ tests). If any pre-existing test fails → halt, investigate.

- [ ] **Step 3d: Run admin tsc**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && npx tsc --noEmit'
```

Expected: 0 errors (or only pre-existing errors documented in memory — `resolve-flashscore-id.test.ts:66` is a known pre-existing error).

### Task 4: Commit transformer fix

- [ ] **Step 4a: Commit**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git add services/odds-api-ingester/src/transformer.ts services/odds-api-ingester/src/__tests__/transformer.test.ts && git status -s && git commit -m "$(cat <<EOF
fix(transformer): preserve player label for over+under markets

Adds rule 0a to expandOutcome with priority above rule 1. Previously,
{label, over, under} shapes (e.g. basketball Player Props from BetUK)
were absorbed by rule 1 which only emits generic over/under outcomes
and DISCARDS the label, losing player identity.

New behavior: when label is present alongside over+under, emit two
outcomes with outcome_key = "<label>::over" / "<label>::under",
preserving the player name. Schema unchanged (single text column).

3 new test cases in transformer.test.ts; existing 65+ tests unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"'
```

### Task 5: Build admin + restart ingester (race-safe)

**Files:**
- Build artifact: `/root/betssolution-admin/dist/services/odds-api-ingester/`

- [ ] **Step 5a: Build admin**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && npm run build 2>&1 | tail -20'
```

Expected: success, no errors. Build artifacts updated under `dist/`.

- [ ] **Step 5b: Stop ingester (race-safe before cleanup)**

```bash
ssh scraper-vps 'systemctl stop odds-api-ingester && sleep 2 && systemctl is-active odds-api-ingester'
```

Expected: `inactive`.

**Tier-window guidance**: stopping for ~5min during prematch peak causes a freshness gap on other sports. If the Player Props events are within 2h of start time (likely → they hit `imminent` tier every 2min), prefer to time the cleanup right after a completed `imminent` cycle log line. If events are mid/slow tier, stopping is fine since cycle interval is 10-30min anyway.

### Task 6: Cleanup Player Props outcomes_v2

**Files:** none (DB-only operation)

- [ ] **Step 6a: Pre-cleanup count assertion**

```bash
ssh scraper-vps "cd /root/betssolution-player && SR=\$(grep ^SUPABASE_SERVICE_ROLE_KEY .env.local | cut -d= -f2) && SU=\$(grep ^NEXT_PUBLIC_SUPABASE_URL .env.local | cut -d= -f2) && curl -sS \"\$SU/rest/v1/outcomes_v2?market_id=in.(\$(curl -sS \"\$SU/rest/v1/markets_v2?market_name=eq.Player%20Props&select=id&limit=1000\" -H \"apikey: \$SR\" -H \"Authorization: Bearer \$SR\" | python3 -c 'import json,sys; print(\",\".join(r[\"id\"] for r in json.load(sys.stdin)))'))&select=count\" -H \"apikey: \$SR\" -H \"Authorization: Bearer \$SR\" -H \"Prefer: count=exact\" -H \"Range: 0-0\" -D - -o /dev/null 2>&1 | grep -i content-range"
```

Expected: `content-range: 0-0/N` where N is around 200-400 (spec: ~321). If N=0 or N>1000 → halt and investigate.

Record N for post-cleanup verification.

- [ ] **Step 6b: Execute DELETE via psql connection or REST**

Prefer direct SQL for atomicity. Use `psql` on VPS if available, else REST DELETE chunked:

```bash
ssh scraper-vps "cd /root/betssolution-player && SR=\$(grep ^SUPABASE_SERVICE_ROLE_KEY .env.local | cut -d= -f2) && SU=\$(grep ^NEXT_PUBLIC_SUPABASE_URL .env.local | cut -d= -f2) && IDS=\$(curl -sS \"\$SU/rest/v1/markets_v2?market_name=eq.Player%20Props&select=id&limit=1000\" -H \"apikey: \$SR\" -H \"Authorization: Bearer \$SR\" | python3 -c 'import json,sys; print(\",\".join(r[\"id\"] for r in json.load(sys.stdin)))') && echo \"market_ids=\$IDS\" && curl -sS -X DELETE \"\$SU/rest/v1/outcomes_v2?market_id=in.(\$IDS)\" -H \"apikey: \$SR\" -H \"Authorization: Bearer \$SR\" -H \"Prefer: return=representation\" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(f\"deleted {len(d)} rows\")'"
```

Expected: prints `deleted N rows` matching pre-count from 6a (±a few if ingester was still finishing a write before stop).

- [ ] **Step 6c: Post-DELETE count assertion (must be 0)**

Re-run 6a. Expected: `content-range: */0`.

### Task 7: Restart ingester + wait + verify re-ingest

- [ ] **Step 7a: Start ingester**

```bash
ssh scraper-vps 'systemctl start odds-api-ingester && sleep 3 && systemctl is-active odds-api-ingester'
```

Expected: `active`.

- [ ] **Step 7b: Watch logs for next ingest cycle on Player Props events**

```bash
ssh scraper-vps 'journalctl -u odds-api-ingester -n 0 -f --since now' &
# wait up to 12 minutes (mid tier 10min); look for upserts touching Player Props market or general "tier=mid completed" line
```

Or use Monitor for log tailing. Wait for at least one `tier=mid` or `tier=imminent` cycle to complete.

- [ ] **Step 7c: Verify post-ingest data shape**

```bash
ssh scraper-vps "cd /root/betssolution-player && SR=\$(grep ^SUPABASE_SERVICE_ROLE_KEY .env.local | cut -d= -f2) && SU=\$(grep ^NEXT_PUBLIC_SUPABASE_URL .env.local | cut -d= -f2) && IDS=\$(curl -sS \"\$SU/rest/v1/markets_v2?market_name=eq.Player%20Props&select=id&limit=1000\" -H \"apikey: \$SR\" -H \"Authorization: Bearer \$SR\" | python3 -c 'import json,sys; print(\",\".join(r[\"id\"] for r in json.load(sys.stdin)))') && curl -sS \"\$SU/rest/v1/v_player_outcomes?market_id=in.(\$IDS)&select=name,line,odds&limit=10\" -H \"apikey: \$SR\" -H \"Authorization: Bearer \$SR\""
```

Expected: rows with `name` containing `::over` or `::under` and a player-like prefix (e.g. `"Adam Mokoka::over"`). If still empty after 15min → check if events have been settled (would explain empty). If shape still `"Over"`/`"Under"` → transformer fix not picked up; verify build/restart sequence.

If verification PASSES → Phase 1 complete.

---

## Phase 2 — Frontend basket extension

**Note**: player repo is non-git. Edits go directly to `/root/betssolution-player/`. Mirror snapshots into admin git under `docs/superpowers/artifacts/2026-05-04-event-v2-basket/player/` at end of phase.

### Task 8: Add MEDIAN_LINE sentinel + basket defaults

**Files:**
- Modify: `/root/betssolution-player/lib/line-picker-defaults.ts`

- [ ] **Step 8a: Read current file**

```bash
ssh scraper-vps 'cat /root/betssolution-player/lib/line-picker-defaults.ts'
```

- [ ] **Step 8b: Add MEDIAN_LINE export and basket block**

Edit `lib/line-picker-defaults.ts`:

1. Above `const SENTINEL_FAMILIES = new Set([...])`, add:
```ts
export const MEDIAN_LINE = -1e9;  // sentinel — never collides with real lines (real lines are bounded by ±200 across all sports)
```

2. Inside `SENTINEL_FAMILIES` Set, add basket spread families:
```ts
"Spread 1Q",
"Spread 2Q",
"Spread 3Q",
"Spread 4Q",
```

3. Inside `DEFAULTS` object, add basket block (after calcio block):
```ts
basket: {
  // Sentinel 0 → LinePicker pesca la linea più vicina a 0 (= più bilanciata per handicap/spread)
  "T/T Handicap": 0,
  "Alternative Spread": 0,
  "Handicap - 1T": 0,
  "Handicap - 1Q": 0,
  "Spread 1Q": 0,
  "Spread 2Q": 0,
  "Spread 3Q": 0,
  "Spread 4Q": 0,
  // U/O totals: median sentinel — line range varies per league (NBA ~220, Euroleague ~165, NCAA ~130)
  "U/O Incl. Supp.": MEDIAN_LINE,
  "Alternative Totals": MEDIAN_LINE,
  "U/O - 1T": MEDIAN_LINE,
  "U/O - 1Q": MEDIAN_LINE,
  "U/O - 2Q": MEDIAN_LINE,
  "U/O - 3Q": MEDIAN_LINE,
  "U/O - 4Q": MEDIAN_LINE,
},
```

- [ ] **Step 8c: tsc check on player**

```bash
ssh scraper-vps 'cd /root/betssolution-player && npx tsc --noEmit 2>&1 | head -20'
```

Expected: 0 errors (or only pre-existing).

### Task 9: Patch LinePicker.tsx for MEDIAN_LINE

**Files:**
- Modify: `/root/betssolution-player/components/event-v2/LinePicker.tsx:38-46` (pickDefault function)

- [ ] **Step 9a: Add MEDIAN_LINE import + sentinel branch**

Modify `pickDefault`:

```ts
import { MEDIAN_LINE } from "@/lib/line-picker-defaults";

function pickDefault(variants: LineVariant[], target: number): LineVariant | null {
  if (variants.length === 0) return null;
  const sorted = [...variants].sort((a, b) => a.line - b.line);
  if (target === MEDIAN_LINE) {
    return sorted[Math.floor(sorted.length / 2)];
  }
  return [...sorted].sort((a, b) => {
    const da = Math.abs(a.line - target);
    const db = Math.abs(b.line - target);
    if (da !== db) return da - db;
    return a.line - b.line;
  })[0];
}
```

Replace the existing function body. Keep import path consistent with other imports in this file (probably `@/lib/...`).

- [ ] **Step 9b: tsc check**

```bash
ssh scraper-vps 'cd /root/betssolution-player && npx tsc --noEmit 2>&1 | head -10'
```

Expected: 0 errors.

### Task 10: Add @over-under-flat suffix to categorizer

**Files:**
- Modify: `/root/betssolution-player/lib/market-categorizer-v2.ts`

- [ ] **Step 10a: Read current categorizer**

```bash
ssh scraper-vps 'cat /root/betssolution-player/lib/market-categorizer-v2.ts'
```

- [ ] **Step 10b: Add `over-under-flat` branch in suffix dispatcher**

Inside `categorizeMarketsV2`, in the `for (const spec of specs)` loop, alongside `if (suffix === "picker" || suffix === "chip")` and `else if (suffix === "flat")`, add:

```ts
} else if (suffix === "over-under-flat") {
  // Player Props with rule-0a labels (post-transformer-fix). Each market has
  // outcomes named "<player>::over" / "<player>::under" per (player, line).
  // Emit each market as its own section (like @flat); rendering at the page
  // layer parses outcome.name to pair Over/Under per player.
  const sorted = [...matching].sort((a, b) => {
    const la = a.line == null ? Number.POSITIVE_INFINITY : a.line;
    const lb = b.line == null ? Number.POSITIVE_INFINITY : b.line;
    return la - lb;
  });
  for (const m of sorted) {
    result.markets.push(m);
    consumedIds.add(m.id);
  }
}
```

The categorizer doesn't need to know about player grouping — it just exposes the markets. Rendering at page-v2 will detect `"::over"`/`"::under"` outcomes and switch to PlayerOverUnderRow.

- [ ] **Step 10c: tsc check**

```bash
ssh scraper-vps 'cd /root/betssolution-player && npx tsc --noEmit 2>&1 | head -10'
```

Expected: 0 errors.

### Task 11: Create PlayerOverUnderRow component

**Files:**
- Create: `/root/betssolution-player/components/event-v2/PlayerOverUnderRow.tsx`

- [ ] **Step 11a: Look at PlayerListFlat.tsx for styling consistency**

```bash
ssh scraper-vps 'cat /root/betssolution-player/components/event-v2/PlayerListFlat.tsx'
```

- [ ] **Step 11b: Create PlayerOverUnderRow.tsx**

```tsx
"use client";

import React from "react";

type Outcome = {
  outcomeId: string;
  outcomeIdV2: string;
  name: string;       // expected format: "<player>::over" or "<player>::under" (pre-transformer-fix data may be plain "Over"/"Under" — fallback)
  odds: number;
  line: number | null;
};

type Props = {
  outcomes: Outcome[];
  onSelect: (o: { outcomeId: string; outcomeIdV2: string; odds: number; label: string }) => void;
};

type ParsedOutcome = {
  player: string;        // e.g. "Adam Mokoka" or "Adam Mokoka (Points)"
  playerDisplay: string; // e.g. "Adam Mokoka" (substring before first "(" if present)
  statTag: string | null; // e.g. "Points" or null
  direction: "over" | "under";
  odds: number;
  line: number;
  outcomeId: string;
  outcomeIdV2: string;
  raw: string;
};

function parseOutcome(o: Outcome): ParsedOutcome | null {
  const sepIdx = o.name.lastIndexOf("::");
  if (sepIdx < 0) return null; // legacy format pre-fix — skip silently
  const labelPart = o.name.substring(0, sepIdx);
  const dir = o.name.substring(sepIdx + 2);
  if (dir !== "over" && dir !== "under") return null;
  const parenIdx = labelPart.indexOf("(");
  let playerDisplay = labelPart;
  let statTag: string | null = null;
  if (parenIdx > 0) {
    playerDisplay = labelPart.substring(0, parenIdx).trim();
    const closeIdx = labelPart.lastIndexOf(")");
    if (closeIdx > parenIdx) {
      statTag = labelPart.substring(parenIdx + 1, closeIdx).trim();
    }
  }
  return {
    player: labelPart,
    playerDisplay,
    statTag,
    direction: dir as "over" | "under",
    odds: o.odds,
    line: o.line ?? 0,
    outcomeId: o.outcomeId,
    outcomeIdV2: o.outcomeIdV2,
    raw: o.name,
  };
}

export default function PlayerOverUnderRow({ outcomes, onSelect }: Props) {
  // Parse all outcomes; group by (player, line) → { over, under }.
  type Pair = { player: string; playerDisplay: string; statTag: string | null; line: number; over?: ParsedOutcome; under?: ParsedOutcome };
  const groups = new Map<string, Pair>();
  for (const o of outcomes) {
    const p = parseOutcome(o);
    if (!p) continue;
    const key = `${p.player}|${p.line}`;
    if (!groups.has(key)) {
      groups.set(key, { player: p.player, playerDisplay: p.playerDisplay, statTag: p.statTag, line: p.line });
    }
    const g = groups.get(key)!;
    if (p.direction === "over") g.over = p;
    else g.under = p;
  }
  const list = Array.from(groups.values()).sort((a, b) => {
    if (a.player !== b.player) return a.player.localeCompare(b.player);
    return a.line - b.line;
  });

  if (list.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {list.map((g) => (
        <div key={`${g.player}@${g.line}`} style={{ display: "grid", gridTemplateColumns: "1fr auto 100px 100px", alignItems: "center", gap: 8, padding: "6px 8px", background: "#fff", borderRadius: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {g.playerDisplay}
            {g.statTag && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 500, color: "#666" }}>({g.statTag})</span>}
          </div>
          <div style={{ fontSize: 12, color: "#888", minWidth: 36, textAlign: "center" }}>{g.line}</div>
          {g.over ? (
            <button
              onClick={() => onSelect({ outcomeId: g.over!.outcomeId, outcomeIdV2: g.over!.outcomeIdV2, odds: g.over!.odds, label: `${g.player} Over ${g.line}` })}
              style={{ fontSize: 12, padding: "4px 6px", border: "1px solid #ddd", borderRadius: 3, background: "#fafafa", cursor: "pointer" }}
            >
              <div style={{ fontSize: 10, color: "#666" }}>Over</div>
              <div style={{ fontWeight: 800, color: "#d0141c" }}>{g.over.odds.toFixed(2)}</div>
            </button>
          ) : <div />}
          {g.under ? (
            <button
              onClick={() => onSelect({ outcomeId: g.under!.outcomeId, outcomeIdV2: g.under!.outcomeIdV2, odds: g.under!.odds, label: `${g.player} Under ${g.line}` })}
              style={{ fontSize: 12, padding: "4px 6px", border: "1px solid #ddd", borderRadius: 3, background: "#fafafa", cursor: "pointer" }}
            >
              <div style={{ fontSize: 10, color: "#666" }}>Under</div>
              <div style={{ fontWeight: 800, color: "#d0141c" }}>{g.under.odds.toFixed(2)}</div>
            </button>
          ) : <div />}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 11c: tsc check**

```bash
ssh scraper-vps 'cd /root/betssolution-player && npx tsc --noEmit 2>&1 | head -10'
```

Expected: 0 errors.

### Task 12: Add BASKET_TAB_MARKETS_V2 to market-config-v2.ts

**Files:**
- Modify: `/root/betssolution-player/lib/market-config-v2.ts`

- [ ] **Step 12a: Add basket config block**

After the tennis block (`export const TENNIS_DEFAULT_SUB_PILL = ...`), add:

```ts
export const BASKET_TAB_MARKETS_V2: SportTabConfig = {
  "Principali": {
    markets: [
      "T/T",                          // hero (basket-only, see page-v2 isHero ext)
      "1X2 Tempo Regolamentare",      // compact, auto-hide if absent
      "U/O Incl. Supp.@picker",
      "T/T Handicap@picker",
      "DNB",
      "P/D",
    ],
  },
  "U/O": {
    markets: [
      "U/O Incl. Supp.@picker",
      "Alternative Totals@picker",
    ],
  },
  "Handicap": {
    markets: [
      "T/T Handicap@picker",
      "Alternative Spread@picker",
    ],
  },
  "Tempi": {
    subPills: {
      "1° Tempo": {
        markets: [
          "1X2 - 1T",
          "U/O - 1T@picker",
          "Handicap - 1T@picker",
          "3-Way Result HT",
        ],
      },
      "2° Tempo": {
        markets: ["1X2 - 2T"],
      },
    },
  },
  "Quarti": {
    subPills: {
      "Q1": {
        markets: ["1X2 - 1Q", "ML 1Q", "U/O - 1Q@picker", "Handicap - 1Q@picker", "Spread 1Q@picker"],
      },
      "Q2": {
        markets: ["ML 2Q", "U/O - 2Q@picker", "Spread 2Q@picker"],
      },
      "Q3": {
        markets: ["ML 3Q", "U/O - 3Q@picker", "Spread 3Q@picker"],
      },
      "Q4": {
        markets: ["ML 4Q", "U/O - 4Q@picker", "Spread 4Q@picker"],
      },
    },
  },
  "Player": {
    subPills: {
      "Punti":    { markets: ["Player Points Milestones@flat"] },
      "Rimbalzi": { markets: ["Player Rebounds Milestones@flat"] },
      "Triple":   { markets: ["Player Threes Milestones@flat"] },
      "Assist":   { markets: ["Player Assists Milestones@flat"] },
      "First": {
        markets: ["Player First Basket", "Player First Assist", "Player First Rebound"],
      },
      "Altro": {
        markets: ["Double Double", "Player Props@over-under-flat"],
      },
    },
  },
  "Altri": {
    markets: [],  // catch-all uncategorized
  },
};

export const BASKET_TAB_ORDER = [
  "Principali", "U/O", "Handicap", "Tempi", "Quarti", "Player", "Altri",
];

export const BASKET_DEFAULT_SUB_PILL: Record<string, string> = {
  "Tempi": "1° Tempo",
  "Quarti": "Q1",
  "Player": "Punti",
};
```

- [ ] **Step 12b: Register basket in lookup maps**

In the same file, modify the existing `TAB_MARKETS_BY_SPORT`, `TAB_ORDER_BY_SPORT`, `DEFAULT_SUB_PILL_BY_SPORT` exports:

```ts
export const TAB_MARKETS_BY_SPORT: Record<string, SportTabConfig> = {
  calcio: FOOTBALL_TAB_MARKETS_V2,
  tennis: TENNIS_TAB_MARKETS_V2,
  basket: BASKET_TAB_MARKETS_V2,
};

export const TAB_ORDER_BY_SPORT: Record<string, string[]> = {
  calcio: FOOTBALL_TAB_ORDER,
  tennis: TENNIS_TAB_ORDER,
  basket: BASKET_TAB_ORDER,
};

export const DEFAULT_SUB_PILL_BY_SPORT: Record<string, Record<string, string>> = {
  calcio: FOOTBALL_DEFAULT_SUB_PILL,
  tennis: TENNIS_DEFAULT_SUB_PILL,
  basket: BASKET_DEFAULT_SUB_PILL,
};
```

- [ ] **Step 12c: tsc check**

```bash
ssh scraper-vps 'cd /root/betssolution-player && npx tsc --noEmit 2>&1 | head -10'
```

Expected: 0 errors.

### Task 13: Extend isHero + titleFor + render wiring in page-v2.tsx

**Files:**
- Modify: `/root/betssolution-player/app/(kiosk)/event/[eventId]/page-v2.tsx`

- [ ] **Step 13a: Read current page-v2 structure**

```bash
ssh scraper-vps 'wc -l /root/betssolution-player/app/\(kiosk\)/event/\[eventId\]/page-v2.tsx && grep -n "isHero\|titleFor\|TENNIS_TITLE\|BASKET_TITLE\|renderSingleMarket\|renderGroupedMarket\|@flat\|@picker" /root/betssolution-player/app/\(kiosk\)/event/\[eventId\]/page-v2.tsx | head -30'
```

- [ ] **Step 13b: Extend isHero (line 528 area)**

Locate the line:
```ts
const isHero = isPrincipali && (m.market_type === "1X2" || m.market_type === "T/T Match (Escl. Ritiro)");
```

Replace with:
```ts
const isHero = isPrincipali && (
  m.market_type === "1X2" ||
  m.market_type === "T/T Match (Escl. Ritiro)" ||
  (sportSlug === "basket" && m.market_type === "T/T")
);
```

- [ ] **Step 13c: Add BASKET_TITLE_OVERRIDES + extend titleFor**

Locate `titleFor` (or any tennis override block). Add a basket overrides constant near the top of the component file (or alongside any existing tennis override constant):

```ts
const BASKET_TITLE_OVERRIDES: Record<string, string> = {
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
  "Player Points Milestones": "Punti Giocatore",
  "Player Rebounds Milestones": "Rimbalzi Giocatore",
  "Player Threes Milestones": "Triple Giocatore",
  "Player Assists Milestones": "Assist Giocatore",
  "Player First Basket": "Primo Canestro",
  "Player First Assist": "Primo Assist",
  "Player First Rebound": "Primo Rimbalzo",
};
```

In `titleFor` body, add (before line-suffix logic):
```ts
if (sportSlug === "basket" && BASKET_TITLE_OVERRIDES[m.market_type]) {
  return BASKET_TITLE_OVERRIDES[m.market_type];
}
```

(Place this lookup **after** the existing tennis override block — pattern should already exist for `"1X2 - 1T"` → `"VINCENTE 1° SET"` — and **before** any line-suffix concatenation.)

- [ ] **Step 13d: Wire @over-under-flat rendering**

Locate `renderSingleMarket` function. The `@over-under-flat` suffix maps to a per-market render path because the categorizer pushes each `Player Props` market into `result.markets`. Detect outcomes with `::` separator and render via PlayerOverUnderRow:

In `renderSingleMarket` (which is called per-market from the markets list), after computing `outcomes` array (or inline in the JSX), branch on whether the first outcome name contains `"::over"` or `"::under"`:

```ts
const isOverUnderFlat = outcomes.length > 0 && /::(over|under)$/.test(outcomes[0].name ?? "");
const RowComp = isHero ? HeroOutcomeRow : (isOverUnderFlat ? PlayerOverUnderRow : CompactOutcomeRow);
```

Add import at top:
```ts
import PlayerOverUnderRow from "@/components/event-v2/PlayerOverUnderRow";
```

The `outcomes` array shape passed to `PlayerOverUnderRow` is the same OutcomeData shape used by other rows (label/odds/line) — confirm that `name` is preserved on OutcomeData. If not, may need to thread `name: outcome.name` through (look around line 154 build OutcomeData).

- [ ] **Step 13e: tsc check**

```bash
ssh scraper-vps 'cd /root/betssolution-player && npx tsc --noEmit 2>&1 | head -10'
```

Expected: 0 errors.

### Task 14: Build player + standalone copy + restart (no flag flip yet)

- [ ] **Step 14a: Build**

```bash
ssh scraper-vps 'cd /root/betssolution-player && npm run build 2>&1 | tail -20'
```

Expected: success. Capture new BUILD_ID:
```bash
ssh scraper-vps 'cat /root/betssolution-player/.next/BUILD_ID'
```

- [ ] **Step 14b: Standalone copy steps**

```bash
ssh scraper-vps 'cd /root/betssolution-player && rm -rf .next/standalone/.next/static .next/standalone/public && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/ && ln -sf /root/betssolution-player/.env.local .next/standalone/.env.local'
```

- [ ] **Step 14c: Backup .env.local + restart (still without flag flip)**

```bash
ssh scraper-vps 'cp /root/betssolution-player/.env.local /root/betssolution-player/.env.local.bak-pre-basket-flip && systemctl restart betssolution-player && sleep 5 && systemctl is-active betssolution-player && curl -sS -o /dev/null -w "health %{http_code}\n" http://localhost:3001/api/health'
```

Expected: `active`, `health 200`.

### Task 15: Pre-flag-flip smoke (basket events still on legacy)

- [ ] **Step 15a: Verify basket event still uses legacy page**

Pick 1 basket event from `v_player_events`:
```bash
ssh scraper-vps "cd /root/betssolution-player && SR=\$(grep ^SUPABASE_SERVICE_ROLE_KEY .env.local | cut -d= -f2) && SU=\$(grep ^NEXT_PUBLIC_SUPABASE_URL .env.local | cut -d= -f2) && curl -sS \"\$SU/rest/v1/v_player_events?sport_slug=eq.basket&status=eq.prematch&select=id,home_team,away_team&limit=3\" -H \"apikey: \$SR\" -H \"Authorization: Bearer \$SR\""
```

Open in kiosk browser the URL `http://localhost:3001/event/<id>`. Should still render via legacy page (flag still `=calcio,tennis`). Verify nothing broke for basket via legacy.

- [ ] **Step 15b: Verify calcio + tennis still work via v2**

Open 1 calcio event + 1 tennis event from kiosk. Confirm both render as before, no regressions from MEDIAN_LINE / categorizer / page-v2 edits.

If anything regressed → halt, fix, retry. Calcio Principali should still show `1X2` hero, tennis Principali should still show `T/T Match (Escl. Ritiro)` hero.

### Task 16: Flip flag → activate basket

- [ ] **Step 16a: Flip flag**

```bash
ssh scraper-vps "sed -i 's/NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio,tennis/NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio,tennis,basket/' /root/betssolution-player/.env.local && grep NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS /root/betssolution-player/.env.local"
```

Expected output: `NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio,tennis,basket`.

- [ ] **Step 16b: Restart**

```bash
ssh scraper-vps 'systemctl restart betssolution-player && sleep 5 && systemctl is-active betssolution-player && curl -sS -o /dev/null -w "health %{http_code}\n" http://localhost:3001/api/health'
```

Expected: `active`, `health 200`.

### Task 17: Smoke test — 5 basket events

For each of the 5 events listed below, open `http://localhost:3001/event/<id>` in the kiosk browser and verify the per-event checklist.

- [ ] **Step 17a: Pick 5 events**

```bash
ssh scraper-vps "cd /root/betssolution-player && SR=\$(grep ^SUPABASE_SERVICE_ROLE_KEY .env.local | cut -d= -f2) && SU=\$(grep ^NEXT_PUBLIC_SUPABASE_URL .env.local | cut -d= -f2) && curl -sS \"\$SU/rest/v1/v_player_events?sport_slug=eq.basket&status=eq.prematch&select=id,league_name,home_team,away_team,starts_at&limit=20&order=starts_at.asc\" -H \"apikey: \$SR\" -H \"Authorization: Bearer \$SR\" | python3 -m json.tool"
```

Pick 5 covering:
1. NBA / US-league (high U/O lines ~220)
2. Euroleague (mid U/O ~160)
3. NCAA / lower-tier (low U/O ~130)
4. Live event (any league with `status=live`)
5. Event with Player Props (one of the 2 events: `73a907e0-...` Fenerbahce or `857ae698-...` Olympiakos — though they may be settled by now; pick any with current `Player Props` markets via SQL)

If only 1-2 NBA events available in window, skip to next-best (any high-line event).

- [ ] **Step 17b: Per-event checklist (run for all 5)**

For each event, in browser, verify:

- [ ] Tab order: `Principali / U/O / Handicap / Tempi / Quarti / Player / Altri` (right-to-left or left-to-right per kiosk pattern)
- [ ] Hero T/T renders large in Principali, with `1X2 Tempo Regolamentare` compact below (when present, otherwise auto-hidden)
- [ ] LinePicker shows 3 lines centered on median (NBA shows ~220 default, Euroleague ~165, NCAA ~135)
- [ ] Click "expand" reveals all available lines
- [ ] titleFor overrides applied (e.g. tab Quarti Q1 shows "Vincente 1° Quarto", "1X2 1° Quarto", "Handicap 1° Quarto" — NOT raw `ML 1Q`/`1X2 - 1Q`/`Handicap - 1Q` etc.)
- [ ] Player tab Punti default sub-pill shows player list (from Milestones markets)
- [ ] Player → Altro: when Player Props markets exist, PlayerOverUnderRow displays player name + Over/Under buttons paired by line. **Verify BOTH label shapes present in DB**: 
  - simple `"<name>::over"` → renders player name only (no stat tag pill)
  - parenthesized `"<name> (<stat>)::over"` → renders player name + small `(<stat>)` tag in lighter color
  If only one shape exists in current data, document and verify the other shape via inspecting raw odds-api payload directly.
- [ ] Empty tabs/sub-pills auto-hidden (e.g. 2° Tempo, First sub-pill if no first-event markets)
- [ ] Click an outcome → bet slip popup adds the selection with correct (player + line + direction OR market + outcome + odds) for non-Player-Props
- [ ] Browser console: zero React errors (key collisions, hooks, etc.)

If any check fails → halt, document, fix, rebuild, retry.

### Task 18: Verify calcio + tennis no regression

- [ ] **Step 18a: Open 2 calcio events + 2 tennis events**

Confirm:
- Calcio: Principali hero is `1X2` (not basket T/T), tab order matches existing FOOTBALL_TAB_ORDER
- Tennis: Principali hero is `T/T Match (Escl. Ritiro)`, MEDIAN_LINE doesn't affect tennis (tennis uses `Totale set@2.5` and `Totale giochi@22.5` — fixed lines)
- Both render as they did pre-deploy

If any regression → halt, fix, retry.

---

## Phase 3 — Mirror, memory, commits

### Task 19: Mirror player files into admin git artifacts

**Files:**
- Create: `/root/betssolution-admin/docs/superpowers/artifacts/2026-05-04-event-v2-basket/RUNBOOK.md`
- Create: `/root/betssolution-admin/docs/superpowers/artifacts/2026-05-04-event-v2-basket/player/<files>`

- [ ] **Step 19a: Create artifact dir + mirror modified player files**

```bash
ssh scraper-vps 'mkdir -p /root/betssolution-admin/docs/superpowers/artifacts/2026-05-04-event-v2-basket/player && \
cp /root/betssolution-player/lib/market-config-v2.ts /root/betssolution-admin/docs/superpowers/artifacts/2026-05-04-event-v2-basket/player/ && \
cp /root/betssolution-player/lib/market-categorizer-v2.ts /root/betssolution-admin/docs/superpowers/artifacts/2026-05-04-event-v2-basket/player/ && \
cp /root/betssolution-player/lib/line-picker-defaults.ts /root/betssolution-admin/docs/superpowers/artifacts/2026-05-04-event-v2-basket/player/ && \
cp /root/betssolution-player/components/event-v2/LinePicker.tsx /root/betssolution-admin/docs/superpowers/artifacts/2026-05-04-event-v2-basket/player/ && \
cp /root/betssolution-player/components/event-v2/PlayerOverUnderRow.tsx /root/betssolution-admin/docs/superpowers/artifacts/2026-05-04-event-v2-basket/player/ && \
cp "/root/betssolution-player/app/(kiosk)/event/[eventId]/page-v2.tsx" /root/betssolution-admin/docs/superpowers/artifacts/2026-05-04-event-v2-basket/player/ && \
ls /root/betssolution-admin/docs/superpowers/artifacts/2026-05-04-event-v2-basket/player/'
```

Expected: 6 files copied.

- [ ] **Step 19b: Write RUNBOOK.md**

Content:
```markdown
# Event-v2 basket extension — RUNBOOK

Date deployed: 2026-05-04

## Files modified
- Backend (admin git): services/odds-api-ingester/src/transformer.ts (+rule 0a)
- Backend tests: services/odds-api-ingester/src/__tests__/transformer.test.ts (+3 cases)
- Frontend (player non-git, mirrored in `player/` here):
  - lib/market-config-v2.ts (+BASKET_*)
  - lib/market-categorizer-v2.ts (+@over-under-flat)
  - lib/line-picker-defaults.ts (+MEDIAN_LINE, +basket DEFAULTS, +SENTINEL_FAMILIES)
  - components/event-v2/LinePicker.tsx (pickDefault MEDIAN_LINE branch)
  - components/event-v2/PlayerOverUnderRow.tsx (NEW)
  - app/(kiosk)/event/[eventId]/page-v2.tsx (+isHero basket guard, +BASKET_TITLE_OVERRIDES, +PlayerOverUnderRow wiring)
- Config: /root/betssolution-player/.env.local — flag now `=calcio,tennis,basket`
- Backup: /root/betssolution-player/.env.local.bak-pre-basket-flip

## BUILD_ID
- pre-deploy: LSNWI9YAkVtiTA_sn-l4D
- post-deploy: <FILL IN from step 14a>

## Player Props re-ingest
- Pre-cleanup count: <FILL IN from step 6a>
- Deleted rows: <FILL IN from step 6b>
- Post-ingest verification timestamp: <FILL IN>

## Cross-sport regression check (Task 1)
- Findings: <inline summary or "no findings">

## Rollback
Frontend:
```
sed -i 's/NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio,tennis,basket/NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio,tennis/' /root/betssolution-player/.env.local
systemctl restart betssolution-player
```

Backend (transformer):
```
cd /root/betssolution-admin
git revert <transformer-commit-sha>
npm run build
systemctl restart odds-api-ingester
```
```

Save as `/root/betssolution-admin/docs/superpowers/artifacts/2026-05-04-event-v2-basket/RUNBOOK.md`.

### Task 20: Commit artifacts + final memory update

- [ ] **Step 20a: Commit RUNBOOK + player mirror**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git add docs/superpowers/artifacts/2026-05-04-event-v2-basket/ && git commit -m "$(cat <<EOF
docs(artifacts): event-v2 basket extension deployment mirror

RUNBOOK + player file mirror (lib/market-config-v2.ts, market-categorizer-v2.ts,
line-picker-defaults.ts, LinePicker.tsx, PlayerOverUnderRow.tsx, page-v2.tsx)
since /root/betssolution-player/ is non-git.

Includes BUILD_ID, deployed flag value, Player Props re-ingest counts,
cross-sport regression findings, rollback procedure.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"'
```

- [ ] **Step 20b: Push branch**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git push origin feature/plan-d-settlement-d1'
```

If push fails (auth issues / rate limits), use the bundled-VPS-pattern from previous sessions (gh as `infoundertheguns-ops`). Refer to memory.

- [ ] **Step 20c: Update local MEMORY.md**

In Claude Code, write a new memory file `session-2026-05-04-event-v2-basket.md` summarizing this session and add a one-line entry to `MEMORY.md`. Capture: branch HEAD, BUILD_ID, flag state, Phase-1 transformer fix, Phase-2 frontend, edge cases observed, follow-up items.

---

## Done criteria

All boxes ticked. End-state matches:
- `git log --oneline -5` on `feature/plan-d-settlement-d1` shows: spec commit (already there) + transformer fix commit + artifacts commit. All pushed origin.
- VPS `betssolution-player` BUILD_ID changed from `LSNWI9YAkVtiTA_sn-l4D` to new
- VPS `.env.local` has `NEXT_PUBLIC_NEW_EVENT_PAGE_SPORTS=calcio,tennis,basket`
- Both services `active`, health 200
- Smoke test 5 events PASSED with no regressions on calcio/tennis
- v_player_outcomes for Player Props markets now have `<player>::over`/`<player>::under` format
- MEMORY.md updated with new session pickup file
