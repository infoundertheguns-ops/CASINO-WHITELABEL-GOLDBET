# Phase 1.F Code Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all dead-source legacy code (kambi, 22bet/twobet, betfair, leon, Goldbet/Camoufox) from `betssolution-admin` and from `scraper-vps` host — including systemd services, API endpoints, hero/dashboard components, source filter pills in admin UI, dead test fixtures, and legacy regex patterns — while preserving `ippica-scraper`, `flashscore-scraper`, and `odds-api-ingester`.

**Architecture:** Execute on the **working directory of `scraper-vps`** (`/root/betssolution-admin/`, served by `betssolution-admin.service`), which is the authoritative source — `origin/master` (HEAD `6946f77`) is ~150 commit-equivalents behind. Branch `feature/phase-1f-cleanup` is cut from backup snapshot `wip-scraper-vps-snapshot-2026-04-29`. Each phase produces an atomic commit; final branch is pushed to `origin` but **NOT merged to `master`** until the broader git desync is reconciled (separate session). All operations run via `ssh scraper-vps '...'` from operator's local machine. DB cleanup (mig 151 — drop legacy MVs/indexes/RPCs) is in a separate plan executed only after this plan is stable in production for ≥7 days.

**Tech Stack:** Next.js 14 (App Router) + TypeScript + Vitest + pnpm + Postgres/Supabase (via REST + RPC) + systemd on Ubuntu 22.04.

**Constraints:**
- DO NOT push `feature/phase-1f-cleanup` to `master` until structural reconciliation decided.
- DO NOT touch historical migration files in `migrations/*.sql` (88 files reference legacy sources — they are DB history).
- DO NOT modify `flashscore-scraper`, `ippica-scraper`, `odds-api-ingester` services or repos — these are KEEP.
- Keep working tree clean before each commit. Stop if `git status` shows pre-existing uncommitted changes — surface to operator.

---

## File Structure

### Files to be DELETED

**Cluster A — Hero pages, dashboard, isolated tests** (~1029 LoC):
- `components/admin/scraper/betfair-hero-section.tsx` (210 LoC)
- `components/admin/scraper/kambi-hero-section.tsx` (177 LoC)
- `components/admin/scraper/twobet-hero-section.tsx` (194 LoC)
- `components/admin/scraper/stats-dashboard.tsx` (390 LoC, only consumer of `/api/scraper/stats`)
- `tests/lib/normalize/regex-patterns-betfair.test.ts` (~58 LoC)
- Likely also `app/admin/scraper/page.tsx` (the hub page that imports the heroes — verify in T2)

**Cluster B — Orphan API endpoints** (~714 LoC, entire `app/api/scraper/` dir):
- `app/api/scraper/dedup/route.ts` (103 LoC, zero callers)
- `app/api/scraper/live/route.ts` (40 LoC, only kambi-scraper)
- `app/api/scraper/prematch/route.ts` (40 LoC, only kambi-scraper)
- `app/api/scraper/results/route.ts` (126 LoC, zero callers)
- `app/api/scraper/stats/route.ts` (349 LoC, only stats-dashboard + screenshot util)
- `app/api/scraper/upcoming-events/route.ts` (56 LoC, zero callers)

**Cluster C — Orphan cron route** (~137 LoC):
- `app/api/cron/sync-twobet-catalog/route.ts`

**Cluster G — Dev util** (~50 LoC, verify in T3):
- `screenshot-all-tabs.js` (root of admin repo, only fetches `/api/scraper/stats`)

### Files to be MODIFIED (legacy refs surgically removed)

**Cluster D — Core lib + tests** (heavy):
- `lib/normalize/regex-patterns.ts` (38 refs / 700 LoC)
- `tests/lib/normalize/regex-patterns.test.ts` (136 refs / 1495 LoC)
- `tests/lib/settlement/canonical-fallback-e2e.test.ts` (48 refs / 463 LoC)
- `tests/lib/settlement/canonical-dispatcher.test.ts` (36 refs / 393 LoC)
- `app/api/system/health/route.ts` (29 refs / 276 LoC)
- `lib/health.ts` (21 refs / 478 LoC)

**Cluster D residual** — long tail of files with 1–20 legacy refs each (~80 files estimated, ~500–800 LoC of net deletion).

**Cluster E — Admin pages (remove source-filter pills + legacy badges)** (~80 LoC patches):
- `app/admin/market-normalization/page.tsx`
- `app/admin/market-catalog/page.tsx`
- `app/admin/consensus/page.tsx`
- `app/admin/canonicalization/explore-tab.tsx`
- `app/admin/canonicalization/components/source-card.tsx`
- `app/admin/canonicalization/overview-tab.tsx`
- `app/admin/outcome-normalization/page.tsx`
- `app/admin/market-coverage/page.tsx`
- `app/admin/market-translations/page.tsx` (verify existence — memory says deleted in E3)
- `app/admin/shade-monitor/page.tsx`

### Files explicitly NOT touched

- `migrations/*.sql` (88 files referencing legacy sources — DB history, off-limits).
- `lib/scraper/flashscore/**`
- `lib/scraper/ippica/**` (if exists)
- `lib/odds-api/**` and `services/odds-api-ingester/**`
- Any `*.md` doc/handoff that *describes* the historical legacy state — those are records, not code.

---

## Tasks

### Task 0: Setup, Baseline & Branch

**Files:** none modified — verification + branch setup + plan checked-in.

- [ ] **Step 1: SSH attach + verify working tree clean**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git status --short && echo "---HEAD---" && git rev-parse HEAD && echo "---BRANCH---" && git branch --show-current'
```
Expected: empty `git status` (or only untracked files we know about). HEAD on a recent feature branch (e.g. `feature/chunked-upsert-mig150`). If working tree is dirty with unrelated changes → STOP, surface to operator.

- [ ] **Step 2: Verify backup snapshot branch exists locally on the host**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git rev-parse wip-scraper-vps-snapshot-2026-04-29 && git rev-parse origin/wip-scraper-vps-snapshot-2026-04-29'
```
Expected: same commit SHA from local + origin. If missing → STOP. (Memory: should be `6e3cabc`.)

- [ ] **Step 3: Create cleanup branch from snapshot**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git checkout wip-scraper-vps-snapshot-2026-04-29 && git checkout -b feature/phase-1f-cleanup'
```
Expected: `Switched to a new branch 'feature/phase-1f-cleanup'`.

- [ ] **Step 4: Capture vitest baseline**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && pnpm test --run 2>&1 | tee /tmp/phase1f-vitest-baseline.txt | tail -25'
```
Expected: record number of pass/fail tests as baseline (memory: ~655–672 tests). Note any pre-existing failures so they aren't blamed on this plan.

- [ ] **Step 5: Capture build baseline**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && pnpm build 2>&1 | tee /tmp/phase1f-build-baseline.txt | tail -15'
```
Expected: build succeeds. If it doesn't → STOP, fix baseline first.

- [ ] **Step 6: Capture residual-grep baseline (for Task 5 measurement)**

```bash
ssh scraper-vps "cd /root/betssolution-admin && grep -rE 'kambi|22bet|twobet|betfair|leon|goldbet' --include='*.ts' --include='*.tsx' --include='*.js' app/ components/ lib/ tests/ 2>/dev/null | grep -v node_modules | grep -v '.next/' | wc -l"
```
Expected: ~1635 grep matches (per inventory). Record this number — Task 5 acceptance criterion is to bring it under 20.

- [ ] **Step 7: Save plan to branch**

```bash
ssh scraper-vps 'mkdir -p /root/betssolution-admin/docs/superpowers/plans'
scp ~/plans/2026-04-29-phase-1f-code-cleanup.md scraper-vps:/root/betssolution-admin/docs/superpowers/plans/
ssh scraper-vps 'cd /root/betssolution-admin && git add docs/superpowers/plans/2026-04-29-phase-1f-code-cleanup.md && git commit -m "docs(phase-1f): add code cleanup plan"'
```
Expected: 1 file changed, ~400 insertions.

---

### Task 1: Kill Dead Systemd Services & Archive Repos

**Files:** none in repo. Service-level operations on `scraper-vps`.

**Services to STOP+DISABLE+REMOVE:** `kambi-scraper`, `betfair-scraper`, `leon-scraper`, `scraper` (Camoufox Goldbet).
**Services to KEEP RUNNING:** `ippica-scraper`, `flashscore-scraper`, `odds-api-ingester`.

- [ ] **Step 1: Capture pre-state of every scraper service**

```bash
ssh scraper-vps 'systemctl list-units --all --type=service | grep -iE "scraper|odds-api" | tee /tmp/phase1f-services-before.txt'
```
Expected: file written. Reference for Step 8 verification.

- [ ] **Step 2: Stop & disable kambi-scraper**

```bash
ssh scraper-vps 'systemctl stop kambi-scraper.service && systemctl disable kambi-scraper.service ; systemctl is-active kambi-scraper.service'
```
Expected: final line prints `inactive`.

- [ ] **Step 3: Stop & disable betfair-scraper**

```bash
ssh scraper-vps 'systemctl stop betfair-scraper.service 2>/dev/null ; systemctl disable betfair-scraper.service ; systemctl is-active betfair-scraper.service'
```
Expected: `inactive` (was already dead).

- [ ] **Step 4: Stop & disable leon-scraper**

```bash
ssh scraper-vps 'systemctl stop leon-scraper.service 2>/dev/null ; systemctl disable leon-scraper.service ; systemctl is-active leon-scraper.service'
```
Expected: `inactive`.

- [ ] **Step 5: Stop & disable `scraper.service` (Camoufox Goldbet)**

```bash
ssh scraper-vps 'systemctl cat scraper.service 2>&1 | grep -E "^WorkingDirectory|^ExecStart" ; systemctl stop scraper.service 2>/dev/null ; systemctl disable scraper.service ; systemctl is-active scraper.service'
```
Expected: capture `WorkingDirectory=` path (needed for Step 7), and final line prints `inactive`.

- [ ] **Step 6: Verify the 3 KEEP services are still running**

```bash
ssh scraper-vps 'systemctl is-active ippica-scraper.service flashscore-scraper.service odds-api-ingester.service'
```
Expected: 3 × `active`. If ANY is not active → STOP, surface to operator. **DO NOT continue.**

- [ ] **Step 7: Archive scraper repos (move, not delete — recovery window)**

```bash
ssh scraper-vps 'mkdir -p /root/_archive_phase1f && for d in kambi-scraper betfair-scraper leon-scraper 22bet-scraper twobet-scraper; do [ -d "/root/$d" ] && mv "/root/$d" /root/_archive_phase1f/ && echo "moved /root/$d"; done && ls /root/_archive_phase1f/'
```
Plus, if `WorkingDirectory` from Step 5 is something like `/root/scraper/` or `/root/goldbet-scraper/`, archive that too:
```bash
ssh scraper-vps '[ -d /root/<goldbet-dir> ] && mv /root/<goldbet-dir> /root/_archive_phase1f/'
```
Expected: 3–5 directories under `_archive_phase1f/`. Recovery is `mv` back if needed.

- [ ] **Step 8: Move unit files into archive + reload daemon**

```bash
ssh scraper-vps 'cd /etc/systemd/system && for u in kambi-scraper.service betfair-scraper.service leon-scraper.service scraper.service; do [ -f "$u" ] && mv "$u" /root/_archive_phase1f/ && echo "archived $u"; done && systemctl daemon-reload && systemctl list-units --all --type=service | grep -iE "scraper|odds-api"'
```
Expected: kambi/betfair/leon/scraper.service no longer listed. ippica + flashscore + odds-api-ingester still listed and `active`.

- [ ] **Step 9: Final state check**

```bash
ssh scraper-vps 'systemctl is-active ippica-scraper.service flashscore-scraper.service odds-api-ingester.service betssolution-admin.service'
```
Expected: 4 × `active`.

> **No commit in this task** — purely host-level. Operational record kept in `/tmp/phase1f-services-before.txt`. Rollback recipe at end of plan.

---

### Task 2: Delete Cluster A — Hero Pages, Dashboard, Betfair Test

**Files to DELETE:**
- `components/admin/scraper/betfair-hero-section.tsx`
- `components/admin/scraper/kambi-hero-section.tsx`
- `components/admin/scraper/twobet-hero-section.tsx`
- `components/admin/scraper/stats-dashboard.tsx`
- `tests/lib/normalize/regex-patterns-betfair.test.ts`
- Possibly `app/admin/scraper/` directory (decided in Step 1)

- [ ] **Step 1: Inspect import sites + scraper hub page**

```bash
ssh scraper-vps "cd /root/betssolution-admin && echo '---hub page---' && cat app/admin/scraper/page.tsx 2>/dev/null | head -80 && echo '---other importers---' && grep -rE '(betfair-hero-section|kambi-hero-section|twobet-hero-section|stats-dashboard)' app/ components/ --include='*.tsx' --include='*.ts' | grep -v 'components/admin/scraper/'"
```
Decision rule:
- If `app/admin/scraper/page.tsx` exists and only imports the 3 hero components + stats-dashboard → delete the entire `app/admin/scraper/` directory.
- If it has other content (e.g., links to live admin tools, other widgets) → patch it: remove only the legacy imports/usages.
- Other importers found outside `components/admin/scraper/` → patch them in Step 4.

Capture decision in operator notes.

- [ ] **Step 2: Delete the 4 component files + 1 test file**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && rm -f \
  components/admin/scraper/betfair-hero-section.tsx \
  components/admin/scraper/kambi-hero-section.tsx \
  components/admin/scraper/twobet-hero-section.tsx \
  components/admin/scraper/stats-dashboard.tsx \
  tests/lib/normalize/regex-patterns-betfair.test.ts && \
  ls components/admin/scraper/ 2>/dev/null'
```
Expected: directory either empty or with leftover files (which we'll inspect). If completely empty:
```bash
ssh scraper-vps 'rmdir /root/betssolution-admin/components/admin/scraper/ 2>/dev/null'
```

- [ ] **Step 3: Delete `app/admin/scraper/` if it was a pure legacy hub (per Step 1 decision)**

```bash
ssh scraper-vps 'rm -rf /root/betssolution-admin/app/admin/scraper/'
```
Skip this step if Step 1 said the page has non-legacy content.

- [ ] **Step 4: Patch any other importers**

For each file found in Step 1's "other importers" list, use `Edit` (or `sed`) on scraper-vps to delete the import line and the JSX tag. Examples of expected import patterns:
```tsx
import { BetfairHeroSection } from "@/components/admin/scraper/betfair-hero-section"; // DELETE
<KambiHeroSection /> // DELETE
```

After each edit, run quick sanity:
```bash
ssh scraper-vps 'cd /root/betssolution-admin && grep -nE "(betfair-hero-section|kambi-hero-section|twobet-hero-section|stats-dashboard)" <file>'
```
Expected: no output.

- [ ] **Step 5: tsc check**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && pnpm tsc --noEmit 2>&1 | tail -30'
```
Expected: zero errors. If errors mention `Cannot find module './kambi-hero-section'` etc → return to Step 4.

- [ ] **Step 6: vitest run**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && pnpm test --run 2>&1 | tail -15'
```
Expected: passing tests. Total count = baseline minus the betfair-pattern test count (a few tests dropped). NO new failures.

- [ ] **Step 7: Commit**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git add -A && git status --short && git commit -m "chore(phase-1f): delete legacy scraper hero pages + stats dashboard

- betfair/kambi/twobet hero-section components
- stats-dashboard.tsx (sole consumer of orphan /api/scraper/stats)
- regex-patterns-betfair.test.ts
- app/admin/scraper/ hub page (legacy-only, see plan T2)
- strip imports/usages from any remaining consumers"'
```

---

### Task 3: Delete Cluster B (API endpoints) + Cluster C (cron) + Cluster G (screenshot util)

**Files to DELETE:**
- entire `app/api/scraper/` directory (6 routes)
- `app/api/cron/sync-twobet-catalog/route.ts` (and its directory)
- `screenshot-all-tabs.js` if its only legacy ref is `/api/scraper/stats` (verify in Step 1)

- [ ] **Step 1: Inspect `screenshot-all-tabs.js` scope**

```bash
ssh scraper-vps 'cat /root/betssolution-admin/screenshot-all-tabs.js'
```
Decision rule:
- If the script only fetches `/api/scraper/stats` → delete entirely.
- If it screenshots multiple tabs and only one block fetches the legacy endpoint → patch (remove just that fetch block).

- [ ] **Step 2: Delete API routes + cron route**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && rm -rf app/api/scraper/ app/api/cron/sync-twobet-catalog/ && ls app/api/cron/ && echo "---scraper dir gone?---" && ls app/api/ | grep -i scraper || echo "OK gone"'
```
Expected: `app/api/scraper/` no longer present. `app/api/cron/` lists only the surviving cron routes (event-normalization/run-engine, market-normalization/run-engine, etc.).

- [ ] **Step 3: Delete or patch screenshot-all-tabs.js per Step 1**

If decision was DELETE:
```bash
ssh scraper-vps 'rm -f /root/betssolution-admin/screenshot-all-tabs.js'
```
If decision was PATCH: edit the file on scraper-vps to remove only the `/api/scraper/stats` fetch block + any helpers used solely by it.

- [ ] **Step 4: Verify zero `/api/scraper/*` refs remain in app code**

```bash
ssh scraper-vps "cd /root/betssolution-admin && grep -rE '/api/scraper/' --include='*.ts' --include='*.tsx' --include='*.js' 2>/dev/null | grep -v node_modules | grep -v '.next/' | grep -v 'docs/superpowers/plans/'"
```
Expected: no output (excluding refs inside this very plan doc, which is expected). If any → patch.

- [ ] **Step 5: Verify cron has no orphan callers**

```bash
ssh scraper-vps "crontab -l | grep -iE 'sync-twobet|/api/scraper/(dedup|live|prematch|results|stats|upcoming)' || echo 'CLEAN'"
```
Expected: `CLEAN`. If a cron entry is found → remove via `crontab -e` (manual, surface to operator).

- [ ] **Step 6: tsc + vitest**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && pnpm tsc --noEmit 2>&1 | tail -10 && echo "---tests---" && pnpm test --run 2>&1 | tail -10'
```
Expected: zero tsc errors, vitest passing (count same as Task 2).

- [ ] **Step 7: Commit**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git add -A && git commit -m "chore(phase-1f): delete orphan /api/scraper/* endpoints + sync-twobet cron

- 6 endpoints under app/api/scraper/ (live/prematch/stats only used by dead kambi-scraper; dedup/results/upcoming-events had zero callers)
- app/api/cron/sync-twobet-catalog (orphan)
- screenshot-all-tabs.js (sole legacy caller)"'
```

---

### Task 4: Patch Cluster D — Core libs + tests

**Files to MODIFY:**
- `lib/normalize/regex-patterns.ts`
- `tests/lib/normalize/regex-patterns.test.ts`
- `tests/lib/settlement/canonical-fallback-e2e.test.ts`
- `tests/lib/settlement/canonical-dispatcher.test.ts`
- `app/api/system/health/route.ts`
- `lib/health.ts`

Strategy: each file gets a dedicated step. Read it, surgically delete legacy entries (object literals, switch cases, fixture rows, test blocks), preserve flashscore/odds-api/canonical paths.

- [ ] **Step 1: Patch `lib/normalize/regex-patterns.ts`**

Read entire file. Identify the data structure:
- Likely an array of objects `{ source: 'kambi' | '22bet' | ... , market_pattern: /.../, sport: '...' }`, OR
- A `Map<source, Pattern[]>`, OR
- A switch/case router by source.

Remove every entry whose source is `kambi`, `22bet`, `twobet`, `betfair`, `leon`, or `goldbet`. Preserve flashscore/odds-api entries and any source-agnostic helpers.

Verify post-patch:
```bash
ssh scraper-vps 'cd /root/betssolution-admin && grep -nE "kambi|22bet|twobet|betfair|leon|goldbet" lib/normalize/regex-patterns.ts | head -20'
```
Expected: zero non-comment matches (a bare comment like `// removed kambi 2026-04-29` is fine but per repo convention prefer no comment).

- [ ] **Step 2: Patch `tests/lib/normalize/regex-patterns.test.ts`**

Remove `describe`/`it` blocks whose subject is a deleted pattern. Preserve flashscore/odds-api/cross-source tests.

- [ ] **Step 3: Run regex-patterns suite alone**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && pnpm test --run tests/lib/normalize/regex-patterns 2>&1 | tail -15'
```
Expected: all green, lower test count than baseline.

- [ ] **Step 4: Patch `tests/lib/settlement/canonical-fallback-e2e.test.ts`**

Remove fixture rows and `it` blocks that target legacy sources. Cross-source tests that mention multiple sources can stay if at least one surviving source remains in the assertion (otherwise drop).

- [ ] **Step 5: Patch `tests/lib/settlement/canonical-dispatcher.test.ts`**

Same approach.

- [ ] **Step 6: Run settlement suite**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && pnpm test --run tests/lib/settlement 2>&1 | tail -15'
```
Expected: all green.

- [ ] **Step 7: Patch `app/api/system/health/route.ts`**

Remove legacy source health-check probes (per-source row counts, last-ingested-at timestamps, source-specific error counters). Keep flashscore/odds-api probes. Update the JSON response shape to match.

- [ ] **Step 8: Patch `lib/health.ts`**

Same intent — remove helper functions referencing legacy sources. Adjust exports.

- [ ] **Step 9: Smoke-test `/api/system/health`**

```bash
ssh scraper-vps 'systemctl restart betssolution-admin.service && sleep 5 && curl -s http://localhost:3000/api/system/health | jq .'
```
Expected: HTTP 200, JSON without `kambi`/`22bet`/`betfair`/`leon`/`goldbet` keys, overall `status: "green"`.

- [ ] **Step 10: Full vitest**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && pnpm test --run 2>&1 | tail -15'
```
Expected: all tests pass. Count slightly lower than baseline (legacy tests removed).

- [ ] **Step 11: Commit**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git add -A && git commit -m "chore(phase-1f): strip legacy sources from regex-patterns, settlement tests, health probes"'
```

---

### Task 5: Patch Cluster D residual — Long tail (~80 files)

**Files to MODIFY:** every remaining file with legacy refs (1–20 each).

- [ ] **Step 1: Enumerate remaining files**

```bash
ssh scraper-vps "cd /root/betssolution-admin && grep -rlE 'kambi|22bet|twobet|betfair|leon|goldbet' --include='*.ts' --include='*.tsx' app/ components/ lib/ tests/ 2>/dev/null | grep -v node_modules | grep -v '.next/' | grep -v 'migrations/' | grep -v 'docs/superpowers/plans/' > /tmp/phase1f-residual.txt && wc -l /tmp/phase1f-residual.txt && echo '---first 30---' && head -30 /tmp/phase1f-residual.txt"
```
Expected: <80 files (Tasks 2–4 already removed the heaviest hitters). Capture full list.

- [ ] **Step 2: Triage — categorize each file**

For each file in `/tmp/phase1f-residual.txt`:
- **Type α** — comment / string-literal only (cosmetic): delete the line.
- **Type β** — code branch (functional): collapse switch case, drop array entry, delete if-branch.
- **Type γ** — admin-page filter (covered in Cluster E later): SKIP, leave for Tasks 6–7.

Filter Cluster E paths out of the worklist:
```bash
ssh scraper-vps "grep -vE 'app/admin/(market-normalization|market-catalog|consensus|canonicalization|outcome-normalization|market-coverage|market-translations|shade-monitor)' /tmp/phase1f-residual.txt > /tmp/phase1f-residual-d.txt && wc -l /tmp/phase1f-residual-d.txt"
```
Expected: smaller list (Cluster E removed).

- [ ] **Step 3: Edit batch (~10 files at a time)**

For each file in `/tmp/phase1f-residual-d.txt`:
1. Read file.
2. Delete legacy lines/blocks (Type α or β).
3. Verify imports still resolve.

Every 10 files, run:
```bash
ssh scraper-vps 'cd /root/betssolution-admin && pnpm tsc --noEmit 2>&1 | tail -10'
```
Expected: zero errors. If errors, fix before continuing — do not let them accumulate.

- [ ] **Step 4: Final sweep**

```bash
ssh scraper-vps "cd /root/betssolution-admin && grep -rE 'kambi|22bet|twobet|betfair|leon|goldbet' --include='*.ts' --include='*.tsx' app/ components/ lib/ tests/ 2>/dev/null | grep -v node_modules | grep -v '.next/' | grep -v 'migrations/' | grep -v 'docs/superpowers/plans/' | grep -vE 'app/admin/(market-normalization|market-catalog|consensus|canonicalization|outcome-normalization|market-coverage|market-translations|shade-monitor)' | wc -l"
```
Expected: <20 lines (only legitimate business-context comments — operator decides what to keep).

- [ ] **Step 5: tsc + vitest**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && pnpm tsc --noEmit 2>&1 | tail -10 && echo "---tests---" && pnpm test --run 2>&1 | tail -10'
```
Expected: zero errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git add -A && git commit -m "chore(phase-1f): residual legacy ref cleanup (~80 long-tail files)"'
```

---

### Task 6: Patch Cluster E batch 1 — Canonicalization + Normalization admin pages

**Files to MODIFY:**
- `app/admin/market-normalization/page.tsx`
- `app/admin/market-catalog/page.tsx`
- `app/admin/consensus/page.tsx`
- `app/admin/canonicalization/explore-tab.tsx`
- `app/admin/canonicalization/components/source-card.tsx`
- `app/admin/canonicalization/overview-tab.tsx`
- `app/admin/outcome-normalization/page.tsx`

For each: locate the source-filter pills array (typically `const SOURCES = ['kambi', '22bet', 'betfair', 'flashscore', 'odds-api', ...]` or the equivalent) and reduce to `['flashscore', 'odds-api']`. Also remove any `<SourceBadge source="kambi">`-style legacy badge variants and any switch cases that branch on source.

- [ ] **Step 1: Inspect a sample to learn the pattern**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && grep -nE "kambi|22bet|twobet|betfair|leon|goldbet" app/admin/market-normalization/page.tsx | head -30'
```
Capture: is the source list a const, an enum import, a switch in render, an inline JSX list? Same shape will likely apply to the other 6 files.

- [ ] **Step 2: Patch `app/admin/market-normalization/page.tsx`**

Reduce source list. If the default filter selection includes a legacy source, change to `flashscore` (or whatever is currently the canonical default). Remove dead `case 'kambi':` branches.

- [ ] **Step 3: Smoke-test page**

```bash
ssh scraper-vps 'systemctl restart betssolution-admin.service && sleep 5 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/admin/market-normalization'
```
Expected: 200 (or 401/redirect if auth — fine, not blocking; what matters is no 500).

- [ ] **Step 4: Patch `app/admin/market-catalog/page.tsx`**

Same pattern.

- [ ] **Step 5: Patch `app/admin/consensus/page.tsx`**

Same pattern. Note: consensus is line-aware (memory mig 107) — confirm logic stays line-aware after pruning sources.

- [ ] **Step 6: Patch `app/admin/canonicalization/explore-tab.tsx`**

Same pattern.

- [ ] **Step 7: Patch `app/admin/canonicalization/components/source-card.tsx`**

Likely renders one card per source. Remove legacy variants, keep flashscore + odds-api card variants.

- [ ] **Step 8: Patch `app/admin/canonicalization/overview-tab.tsx`**

Same pattern. If overview KPI calculations summed legacy-source rows, recompute on flashscore + odds-api only.

- [ ] **Step 9: Patch `app/admin/outcome-normalization/page.tsx`**

Same pattern.

- [ ] **Step 10: Smoke-test all 5 admin paths**

```bash
for p in market-normalization market-catalog consensus canonicalization outcome-normalization; do
  echo -n "/admin/$p: "
  ssh scraper-vps "curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/admin/$p"
done
```
Expected: all 200/redirect, none 5xx.

- [ ] **Step 11: tsc + vitest + commit**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && pnpm tsc --noEmit 2>&1 | tail -10 && pnpm test --run 2>&1 | tail -10 && git add -A && git commit -m "chore(phase-1f): remove legacy source filters from canonicalization/normalization admin pages (E batch 1)"'
```

---

### Task 7: Patch Cluster E batch 2 — Coverage + Translations + Shade-monitor

**Files to MODIFY:**
- `app/admin/market-coverage/page.tsx`
- `app/admin/market-translations/page.tsx` (verify exists — memory says deleted in E3 on 2026-04-24)
- `app/admin/shade-monitor/page.tsx`

- [ ] **Step 1: Verify market-translations existence**

```bash
ssh scraper-vps 'ls /root/betssolution-admin/app/admin/market-translations/ 2>&1 || echo "ALREADY DELETED"'
```
If `ALREADY DELETED` → skip Step 4 below. Otherwise proceed.

- [ ] **Step 2: Patch `app/admin/market-coverage/page.tsx`**

Remove legacy source columns/rows from the coverage table. Reduce KPIs to flashscore + odds-api. If the page imports a `getCoverageMatrix(sources)` helper, ensure it's called with `['flashscore', 'odds-api']` (or whatever the canonical set is).

- [ ] **Step 3: Smoke-test market-coverage**

```bash
ssh scraper-vps 'curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/admin/market-coverage'
```
Expected: 200.

- [ ] **Step 4: Patch `app/admin/market-translations/page.tsx` (if exists)**

Remove legacy source pills and any per-source translation rows.

- [ ] **Step 5: Patch `app/admin/shade-monitor/page.tsx`**

Remove legacy source filter and any per-source aggregation. Shade-monitor is a KPI page; verify the metric still makes sense with only flashscore + odds-api.

- [ ] **Step 6: Smoke-test all touched admin paths**

```bash
ssh scraper-vps 'systemctl restart betssolution-admin.service && sleep 5'
for p in market-coverage shade-monitor market-translations; do
  echo -n "/admin/$p: "
  ssh scraper-vps "curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/admin/$p"
done
```
Expected: 200 (or 404 for market-translations if it was already deleted).

- [ ] **Step 7: tsc + vitest + commit**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && pnpm tsc --noEmit 2>&1 | tail -10 && pnpm test --run 2>&1 | tail -10 && git add -A && git commit -m "chore(phase-1f): remove legacy sources from market-coverage, shade-monitor, market-translations (E batch 2)"'
```

---

### Task 8: Final Regression + Branch Push

**Files:** none modified. Comprehensive end-to-end verification.

- [ ] **Step 1: Full vitest**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && pnpm test --run 2>&1 | tee /tmp/phase1f-vitest-final.txt | tail -25'
```
Expected: all green. Count = baseline minus deleted tests (~50–150 fewer).

- [ ] **Step 2: Production build**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && pnpm build 2>&1 | tee /tmp/phase1f-build-final.txt | tail -20'
```
Expected: build succeeds. Bundle size smaller than baseline (visible in build output's route summary).

- [ ] **Step 3: Restart admin service**

```bash
ssh scraper-vps 'systemctl restart betssolution-admin.service && sleep 8 && systemctl is-active betssolution-admin.service && journalctl -u betssolution-admin.service -S "1 min ago" --no-pager | tail -25'
```
Expected: `active`, no error logs after the startup banner.

- [ ] **Step 4: Health check**

```bash
ssh scraper-vps 'curl -s http://localhost:3000/api/system/health | jq .'
```
Expected: HTTP 200, status `green`, JSON has no legacy-source keys.

- [ ] **Step 5: Smoke 8 admin pages**

```bash
for p in canonicalization market-normalization market-catalog consensus outcome-normalization market-coverage shade-monitor agent-tickets; do
  echo -n "/admin/$p: "
  ssh scraper-vps "curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/admin/$p"
done
```
Expected: all 200 (or auth redirect).

- [ ] **Step 6: Settlement engine sanity**

```bash
ssh scraper-vps 'curl -s -X POST http://localhost:3000/api/admin/event-normalization/run-engine -H "x-cron-key: f0a827f96513391b93a36654da229208c0d65c31fc5638b28d7bbc56bd419130" -H "Content-Type: application/json" -d "{\"batch_size\":10,\"use_llm\":false}" | jq ."
```
Expected: HTTP 200, normal output (not 5xx, no `cannot find module` traces).

- [ ] **Step 7: Verify ingester still pushing**

```bash
ssh scraper-vps 'journalctl -u odds-api-ingester -S "5 min ago" --no-pager | tail -25'
```
Expected: heartbeat lines (`[live]`, `[imminent]`, `[mid]`, `[slow]`, `[stale-lives]`) present in last 5 min, no errors.

- [ ] **Step 8: Verify the 3 KEEP services are still alive**

```bash
ssh scraper-vps 'systemctl is-active ippica-scraper.service flashscore-scraper.service odds-api-ingester.service betssolution-admin.service'
```
Expected: 4 × `active`.

- [ ] **Step 9: Diff summary for review**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && echo "---commits since snapshot---" && git log --oneline wip-scraper-vps-snapshot-2026-04-29..HEAD && echo "---file diff stat---" && git diff --stat wip-scraper-vps-snapshot-2026-04-29..HEAD | tail -20 && echo "---residual grep count---" && grep -rE "kambi|22bet|twobet|betfair|leon|goldbet" --include="*.ts" --include="*.tsx" --include="*.js" app/ components/ lib/ tests/ 2>/dev/null | grep -v node_modules | grep -v ".next/" | grep -v "migrations/" | grep -v "docs/superpowers/plans/" | wc -l'
```
Expected: 7–9 commits, ~3000–3500 lines deleted, ~50–100 lines modified. Residual grep count <20.

- [ ] **Step 10: Push branch (NO master merge)**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git push -u origin feature/phase-1f-cleanup'
```
Expected: branch published to origin. **Do NOT open a PR-merge to master** in this plan.

- [ ] **Step 11: Memory update**

After successful push, operator updates memory file `MEMORY.md` and creates `project-phase-1f-cleanup-2026-04-29.md` with: branch SHA, commit count, LoC deleted, services killed (kambi/betfair/leon/goldbet), services preserved (ippica/flashscore/odds-api-ingester), final test count, build status, residual grep count.

---

## Rollback Recipes

### Rollback Task 1 (revive a service)

```bash
ssh scraper-vps 'mv /root/_archive_phase1f/<service>.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now <service>.service'
ssh scraper-vps 'mv /root/_archive_phase1f/<scraper-dir> /root/'
```

### Rollback all code changes (Tasks 2–7)

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git checkout wip-scraper-vps-snapshot-2026-04-29 && systemctl restart betssolution-admin.service'
```

### Hard rollback (production safety net)

The branch `wip-scraper-vps-snapshot-2026-04-29` (commit `6e3cabc`) is the full pre-cleanup snapshot. Any catastrophic regression: checkout that branch, restart `betssolution-admin.service`. Service-level changes from Task 1 are reversible via the archive recipe above.

---

## Out of Scope (separate plans)

- **Plan B — DB cleanup migration (mig 151):** drop `mv_twobet_sport_catalog_summary`, `_kambi_*` indexes, legacy RPCs (`*_betfair*`, etc.), and any orphan enum values. Execute only after this plan is in production for ≥7 days with no regressions. Brainstorm separately to inventory exact DB objects to drop.
- **Plan C — New admin pages:** `/admin/odds-api-monitor` (heartbeat dashboard for ingester tiers), `/admin/canonicalization-queue` (autopilot unified queue per the canonicalization-autopilot vision in memory). Brainstorm separately as "ultimo task".
- **git desync reconciliation:** `origin/master` is ~150 commits behind working dir. Separate session decides merge strategy (likely: rebase the long-running feature branches onto master in topological order, or fast-forward master to a curated branch). This plan deliberately does NOT push to master.

---

## Acceptance Criteria

This plan is DONE when:

1. ✅ `kambi/betfair/leon/scraper(goldbet)` systemd services stopped, disabled, unit files archived.
2. ✅ `ippica-scraper`, `flashscore-scraper`, `odds-api-ingester` still `active`.
3. ✅ `app/api/scraper/` directory removed, `app/api/cron/sync-twobet-catalog` removed.
4. ✅ Cluster A files (3 hero pages + stats-dashboard + betfair test) removed.
5. ✅ Residual grep count for `kambi|22bet|twobet|betfair|leon|goldbet` in `.ts/.tsx/.js` (excluding migrations/ and docs/) is **<20**.
6. ✅ `pnpm tsc --noEmit` clean, `pnpm test --run` all green, `pnpm build` succeeds.
7. ✅ All admin pages return 200 (or auth redirect).
8. ✅ `/api/system/health` returns 200 green with no legacy-source keys.
9. ✅ Settlement engine + odds-api-ingester continue functioning.
10. ✅ Branch `feature/phase-1f-cleanup` pushed to `origin`. NOT merged to master.
