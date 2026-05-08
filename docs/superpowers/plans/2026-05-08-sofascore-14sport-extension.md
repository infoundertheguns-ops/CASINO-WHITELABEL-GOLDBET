# SofaScore 14-Sport Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend SofaScore matcher + Python scraper from 3 sports (football, tennis, basketball) to 14 (parity con events_v2 reali in 48h). Big-bang rollout in single deploy cycle.

**Architecture:** Single source of truth `SOFA_SPORTS as const` tuple in admin `_lib.ts` (driving Set + buildPoolQuery slugs) + Python `discovery.py` (driving discovery loop). `TIME_TOLERANCE_BY_SPORT: Record<SofaSport, number>` exhaustive. Capacity bump rps 2.5→10 + workers 4→16. Pre-flight probe script for slug compatibility.

**Tech Stack:** Next.js 14 App Router (admin), TypeScript, Supabase JS v2, Vitest, Python 3.12 (sofascore-scraper). Code lives on VPS at `/root/betssolution-admin/` (admin git repo) and `/root/sofascore-scraper/` (separate git repo). Branch admin `feature/plan-d-settlement-d1` HEAD `369152d`. Branch scraper `main` HEAD `727a0a2`.

---

## Operating Environment

All file edits via SSH. From local PowerShell:
- Read VPS files: `ssh scraper-vps "cat /root/<path>"`
- Edit VPS files: scp local temp → SSH overwrite, OR ssh + sed for trivial. **scp-a-script preferred for multi-line patches** (avoids quote-escape hell).
- Run admin tests: `ssh scraper-vps "export PATH=/root/.nvm/versions/node/v22.22.1/bin:\$PATH && cd /root/betssolution-admin && npm test -- <pattern>"`
- Build admin: `ssh scraper-vps "export PATH=/root/.nvm/versions/node/v22.22.1/bin:\$PATH && cd /root/betssolution-admin && npm run build"`
- Restart services: `ssh scraper-vps "systemctl restart <name>"`
- Push origin (PowerShell only): `$t = gh auth token; ssh scraper-vps "cd /root/<repo> && git push https://oauth2:$t@github.com/infoundertheguns-ops/<repo>.git <branch>"`

**Critical context:**
- Vitest baseline 1018/1019 pass + 1 pre-existing `tests/api/consensus/list-outliers.test.ts` failure (unrelated, leave alone)
- Admin PATH MUST be exported before npm/npx (`export PATH=/root/.nvm/versions/node/v22.22.1/bin:$PATH`)
- Python scraper service: `sofascore-scraper.service` systemd unit, EnvironmentFile=`/root/sofascore-scraper/.env`
- Admin service: `betssolution-admin.service`, /api/health on :3000
- DB cleanup script convention: place in `scripts/db/`, run from `/root/betssolution-admin/`, then `rm` (NOT `/tmp/` — no node_modules)
- Pre-existing working tree drift in admin (market-categories-seed.json + .bak + scripts/probes/ etc.) is NOT in scope, leave untouched

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `/root/sofascore-scraper/scripts/probe-sofa-slugs.py` | Create | Pre-flight script: itera 14 EN slugs, fetch SofaScore /scheduled-events/{today} via SofaClient, log received N events per sport. Exit 0 always. Output saved to commit body. |
| `/root/sofascore-scraper/sofascore_scraper/discovery.py` | Modify | `SOFA_SPORTS` list extended 3→14 EN slugs. |
| `/root/sofascore-scraper/.env` | Modify | `SOFA_RATE_LIMIT_RPS=10` (was 2.5), `SOFA_WORKER_POOL_SIZE=16` (was 4) |
| `app/api/sofascore/fixtures/_lib.ts` | Modify | `SOFA_SPORTS as const` tuple 3→14. `TIME_TOLERANCE_BY_SPORT: Record<SofaSport, number>` exhaustive 14 entries. `TIME_TOLERANCE_DEFAULT_SEC` invariato (1200). |
| `tests/api/sofascore/fixtures.test.ts` | Modify | `SOFA_VALID_SPORTS.size === 14` assertion. +3 positive regression tests (baseball/mma/darts within tolerance). +1 negative regression (football 25min still no_time_window). Conserva existing 16 tests. |
| `tests/api/sofascore/stats.test.ts` | Modify | `by_sport` empty assertion 14 keys all 0. |

No DB migrations. No frontend coupling. Spec: `docs/superpowers/specs/2026-05-08-sofascore-14sport-extension-design.md`.

---

## Task 0: Verify Workspace State

**Files:** none (verification only)

- [ ] **Step 1: Confirm admin branch + HEAD**

```powershell
ssh scraper-vps "cd /root/betssolution-admin && git rev-parse --abbrev-ref HEAD && git log --oneline -3"
```
Expected: `feature/plan-d-settlement-d1`, HEAD `369152d` (spec v2 commit), parent `bc9ffb6` (spec v1) or directly `1c48797` if v1 was amended out.

- [ ] **Step 2: Confirm scraper repo state**

```powershell
ssh scraper-vps "cd /root/sofascore-scraper && git rev-parse --abbrev-ref HEAD && git log --oneline -3 && git status -s"
```
Expected: branch `main`, HEAD `727a0a2` (skip-finished filter), clean tree.

- [ ] **Step 3: Confirm vitest baseline still 1018/1019**

```powershell
ssh scraper-vps "export PATH=/root/.nvm/versions/node/v22.22.1/bin:`$PATH && cd /root/betssolution-admin && npm test -- tests/api/sofascore 2>&1 | tail -8"
```
Expected: `19 passed (19)` for sofascore-only suite (16 fixtures + 4 stats + 10 enrichment - duplicate, double-check actual baseline; either way must be all green).

- [ ] **Step 4: Confirm services running**

```powershell
ssh scraper-vps "systemctl is-active betssolution-admin.service sofascore-scraper.service"
```
Expected: `active` `active` (two lines).

If any step fails, surface to human before proceeding.

---

## Task 1: Pre-flight Probe Script (Python repo)

**Files:**
- Create: `/root/sofascore-scraper/scripts/probe-sofa-slugs.py`

- [ ] **Step 1: Write probe script locally**

Save to `C:/Users/philp/AppData/Local/Temp/probe-sofa-slugs.py`:

```python
"""
Pre-flight probe: iterate 14 EN sport slugs against SofaScore
/scheduled-events/{today} endpoint, log received-events count per sport.
Output a one-line summary suitable for commit body inclusion.

Usage (from /root/sofascore-scraper):
    set -a && . .env && set +a && .venv/bin/python scripts/probe-sofa-slugs.py
"""
import asyncio
import sys
from datetime import datetime, timezone

sys.path.insert(0, "/root/sofascore-scraper")
from sofascore_scraper.client import SofaClient
from sofascore_scraper.config import Config

ALL_SPORTS = [
    "football", "tennis", "basketball",
    "baseball", "esports", "handball", "rugby", "darts",
    "ice-hockey", "cricket", "volleyball", "boxing", "mma",
    "american-football", "snooker",
]


async def main():
    cfg = Config.from_env()
    today = datetime.now(timezone.utc).date().isoformat()
    print(f"[probe] date={today} sports={len(ALL_SPORTS)} rps={cfg.rate_limit_rps}")
    client = SofaClient(rps=cfg.rate_limit_rps, backoff_max_s=cfg.backoff_max_s, proxies=cfg.proxy_urls)

    supported = []
    unsupported = []
    for sport in ALL_SPORTS:
        ok, payload, _ = await client.get(f"/sport/{sport}/scheduled-events/{today}")
        if not ok or not payload:
            unsupported.append((sport, "no-response"))
            print(f"[probe] {sport}: received=0 (no response)")
            continue
        events = payload.get("events", [])
        n = len(events)
        if n == 0:
            unsupported.append((sport, "zero-events"))
            print(f"[probe] {sport}: received=0")
        else:
            supported.append((sport, n))
            print(f"[probe] {sport}: received={n}")

    print(f"\n[probe] summary: supported={len(supported)}/14, unsupported={len(unsupported)}")
    if unsupported:
        print(f"[probe] unsupported: {[s for s, _ in unsupported]}")


asyncio.run(main())
```

- [ ] **Step 2: scp + run + capture output**

```powershell
ssh scraper-vps "mkdir -p /root/sofascore-scraper/scripts"
scp C:/Users/philp/AppData/Local/Temp/probe-sofa-slugs.py scraper-vps:/root/sofascore-scraper/scripts/probe-sofa-slugs.py
ssh scraper-vps "set -a && . /root/sofascore-scraper/.env && set +a && cd /root/sofascore-scraper && .venv/bin/python scripts/probe-sofa-slugs.py 2>&1 | tail -30"
```
Expected: 14 lines `[probe] {sport}: received={N}` + summary line. CAPTURE the full output (paste in commit body next step).

- [ ] **Step 3: Commit probe script (Python repo)**

Build commit message body with probe output. Save commit msg locally to `C:/Users/philp/AppData/Local/Temp/probe-commit.txt`:

```
chore(scripts): pre-flight probe for SofaScore slug compatibility

Iterates 14 EN sport slugs (events_v2 vocabulary) against SofaScore
/scheduled-events/{today} to verify endpoint compatibility before
extending discovery loop.

Probe output captured 2026-05-08:
[paste full probe stdout here]

Used as gate step in 2026-05-08-sofascore-14sport-extension plan.
Spec: docs/superpowers/specs/2026-05-08-sofascore-14sport-extension-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```powershell
scp C:/Users/philp/AppData/Local/Temp/probe-commit.txt scraper-vps:/tmp/probe-commit.txt
ssh scraper-vps "cd /root/sofascore-scraper && git add scripts/probe-sofa-slugs.py && git -c user.email='info.softvisiontechnologies@gmail.com' -c user.name='philp' commit -F /tmp/probe-commit.txt && rm /tmp/probe-commit.txt && git log -1 --format='%H %s'"
```
Expected: new commit SHA on `main`, parent `727a0a2`. Capture probe output table for downstream tasks (which slugs supported).

---

## Task 2: Python Discovery Extension + Capacity Bump

**Files:**
- Modify: `/root/sofascore-scraper/sofascore_scraper/discovery.py`
- Modify: `/root/sofascore-scraper/.env`

- [ ] **Step 1: Patch discovery.py SOFA_SPORTS list**

Use scp-a-script approach. Save locally to `C:/Users/philp/AppData/Local/Temp/patch-discovery-sports.py`:

```python
import sys
p = '/root/sofascore-scraper/sofascore_scraper/discovery.py'
s = open(p).read()
old = 'SOFA_SPORTS = ["football", "tennis", "basketball"]'
new = '''SOFA_SPORTS = [
    "football", "tennis", "basketball",
    "baseball", "esports", "handball", "rugby", "darts",
    "ice-hockey", "cricket", "volleyball", "boxing", "mma",
    "american-football", "snooker",
]'''
if old not in s:
    print('ERROR: SOFA_SPORTS line not found', file=sys.stderr); sys.exit(1)
open(p, 'w').write(s.replace(old, new))
print('OK')
```

```powershell
scp C:/Users/philp/AppData/Local/Temp/patch-discovery-sports.py scraper-vps:/tmp/patch-discovery-sports.py
ssh scraper-vps "python3 /tmp/patch-discovery-sports.py && rm /tmp/patch-discovery-sports.py"
```
Expected stdout: `OK`.

- [ ] **Step 2: Verify discovery.py change**

```powershell
ssh scraper-vps "grep -A 6 'SOFA_SPORTS = \[' /root/sofascore-scraper/sofascore_scraper/discovery.py"
```
Expected: shows the 14-element list across multiple lines.

- [ ] **Step 3: Patch .env capacity values**

```powershell
ssh scraper-vps "sed -i 's/^SOFA_RATE_LIMIT_RPS=2.5$/SOFA_RATE_LIMIT_RPS=10/' /root/sofascore-scraper/.env"
ssh scraper-vps "sed -i 's/^SOFA_WORKER_POOL_SIZE=4$/SOFA_WORKER_POOL_SIZE=16/' /root/sofascore-scraper/.env"
ssh scraper-vps "grep -E '^SOFA_(RATE_LIMIT|WORKER_POOL)' /root/sofascore-scraper/.env"
```
Expected: shows `SOFA_RATE_LIMIT_RPS=10` and `SOFA_WORKER_POOL_SIZE=16`.

- [ ] **Step 4: Commit (Python repo)**

```powershell
ssh scraper-vps "cd /root/sofascore-scraper && git add sofascore_scraper/discovery.py .env && git -c user.email='info.softvisiontechnologies@gmail.com' -c user.name='philp' commit -m 'feat(discovery): extend SOFA_SPORTS to 14 + capacity bump (rps 2.5->10, workers 4->16)

Adds baseball, esports, handball, rugby, darts, ice-hockey, cricket,
volleyball, boxing, mma, american-football, snooker to discovery loop
(events_v2 sport_slug parity).

Capacity bump justified by phase-0 measured 0%% block ratio at
2.5 rps x 4 workers = 10 rps total. New 10 rps x 16 workers = 160 rps
gives 10x headroom over peak load (16 calls/s with 100 live concurrent
events x 10 endpoints / 60s interval).

Slug compatibility verified by scripts/probe-sofa-slugs.py (commit b9...
or earlier). 24h capacity gate post-deploy required.

Spec: docs/superpowers/specs/2026-05-08-sofascore-14sport-extension-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>' && git log -1 --format='%H %s'"
```
Capture commit SHA.

---

## Task 3: Admin Tests Update (TDD red)

**Files:**
- Modify: `tests/api/sofascore/fixtures.test.ts`
- Modify: `tests/api/sofascore/stats.test.ts`

This is TDD red — tests will fail until Task 4 lands.

- [ ] **Step 1: Patch fixtures.test.ts**

Two changes:
1. Update `SOFA_VALID_SPORTS.size` assertion from `3` to `14`
2. Add 4 new tests (3 positive sport-tolerance + 1 negative football regression)

Save locally to `C:/Users/philp/AppData/Local/Temp/patch-fixtures-tests.py`:

```python
import sys
p = '/root/betssolution-admin/tests/api/sofascore/fixtures.test.ts'
s = open(p).read()

# Change 1: size assertion
old1 = 'expect(SOFA_VALID_SPORTS.size).toBe(3);'
new1 = 'expect(SOFA_VALID_SPORTS.size).toBe(14);'
if old1 not in s:
    print('ERROR: size assertion not found', file=sys.stderr); sys.exit(1)
s = s.replace(old1, new1)

# Change 2: add 4 new tests after existing "football retains 20min" test
old2 = '''  it("football retains 20min default tolerance (does NOT match at 25min off)", () => {
    // football fixture at 19:00, candidate at 19:25 (25min off — outside football 20min tolerance)
    const r = matchSofaToCandidate(baseFx, [{ ...baseC, starts_at: "2026-05-07T19:25:00Z" }]);
    expect(r.kind).toBe("no_time_window");
  });'''
new2 = '''  it("football retains 20min default tolerance (does NOT match at 25min off)", () => {
    // football fixture at 19:00, candidate at 19:25 (25min off — outside football 20min tolerance)
    const r = matchSofaToCandidate(baseFx, [{ ...baseC, starts_at: "2026-05-07T19:25:00Z" }]);
    expect(r.kind).toBe("no_time_window");
  });

  it("uses 90min tolerance for baseball (sport-specific, long innings)", () => {
    // baseball fixture at 19:00, candidate at 20:00 (60min off — within 90min baseball tolerance)
    const fxBb: SofaFixture = { ...baseFx, sofa_sport: "baseball", sofa_event_id: 11, home: "Yankees", away: "Red Sox" };
    const cBb: Candidate = { ...baseC, sport_slug: "baseball", id: "uuid-bb", home: "Yankees", away: "Red Sox", starts_at: "2026-05-07T20:00:00Z" };
    const r = matchSofaToCandidate(fxBb, [cBb]);
    expect(r.kind).toBe("matched_fuzzy");
  });

  it("uses 90min tolerance for mma (sport-specific, card structure)", () => {
    // mma fixture at 19:00, candidate at 20:20 (80min off — within 90min mma tolerance)
    const fxMma: SofaFixture = { ...baseFx, sofa_sport: "mma", sofa_event_id: 12, home: "Conor McGregor", away: "Khabib Nurmagomedov" };
    const cMma: Candidate = { ...baseC, sport_slug: "mma", id: "uuid-mma", home: "Conor McGregor", away: "Khabib Nurmagomedov", starts_at: "2026-05-07T20:20:00Z" };
    const r = matchSofaToCandidate(fxMma, [cMma]);
    expect(r.kind).toBe("matched_fuzzy");
  });

  it("uses 60min tolerance for darts (sport-specific)", () => {
    // darts fixture at 19:00, candidate at 19:50 (50min off — within 60min darts tolerance)
    const fxDart: SofaFixture = { ...baseFx, sofa_sport: "darts", sofa_event_id: 13, home: "Michael van Gerwen", away: "Peter Wright" };
    const cDart: Candidate = { ...baseC, sport_slug: "darts", id: "uuid-dart", home: "Michael van Gerwen", away: "Peter Wright", starts_at: "2026-05-07T19:50:00Z" };
    const r = matchSofaToCandidate(fxDart, [cDart]);
    expect(r.kind).toBe("matched_fuzzy");
  });

  it("uses 30min tolerance for ice-hockey (sport-specific)", () => {
    // ice-hockey fixture at 19:00, candidate at 19:25 (25min off — within 30min hockey tolerance)
    const fxHk: SofaFixture = { ...baseFx, sofa_sport: "ice-hockey", sofa_event_id: 14, home: "Boston Bruins", away: "New York Rangers" };
    const cHk: Candidate = { ...baseC, sport_slug: "ice-hockey", id: "uuid-hk", home: "Boston Bruins", away: "New York Rangers", starts_at: "2026-05-07T19:25:00Z" };
    const r = matchSofaToCandidate(fxHk, [cHk]);
    expect(r.kind).toBe("matched_fuzzy");
  });'''
if old2 not in s:
    print('ERROR: football retains test not found', file=sys.stderr); sys.exit(1)
s = s.replace(old2, new2)

open(p, 'w').write(s)
print('OK')
```

```powershell
scp C:/Users/philp/AppData/Local/Temp/patch-fixtures-tests.py scraper-vps:/tmp/patch-fixtures-tests.py
ssh scraper-vps "python3 /tmp/patch-fixtures-tests.py && rm /tmp/patch-fixtures-tests.py"
```
Expected stdout: `OK`.

- [ ] **Step 2: Patch stats.test.ts by_sport empty assertion**

Save locally to `C:/Users/philp/AppData/Local/Temp/patch-stats-test.py`:

```python
import sys
p = '/root/betssolution-admin/tests/api/sofascore/stats.test.ts'
s = open(p).read()
old = 'expect(json.by_sport).toEqual({ football: 0, tennis: 0, basketball: 0 });'
new = '''expect(json.by_sport).toEqual({
      football: 0, tennis: 0, basketball: 0,
      baseball: 0, esports: 0, handball: 0, rugby: 0, darts: 0,
      "ice-hockey": 0, cricket: 0, volleyball: 0, boxing: 0, mma: 0,
      "american-football": 0, snooker: 0,
    });'''
if old not in s:
    print('ERROR: empty by_sport assertion not found', file=sys.stderr); sys.exit(1)
open(p, 'w').write(s.replace(old, new))
print('OK')
```

```powershell
scp C:/Users/philp/AppData/Local/Temp/patch-stats-test.py scraper-vps:/tmp/patch-stats-test.py
ssh scraper-vps "python3 /tmp/patch-stats-test.py && rm /tmp/patch-stats-test.py"
```
Expected: `OK`.

- [ ] **Step 3: Run sofascore tests, confirm RED**

```powershell
ssh scraper-vps "export PATH=/root/.nvm/versions/node/v22.22.1/bin:`$PATH && cd /root/betssolution-admin && npm test -- tests/api/sofascore 2>&1 | tail -15"
```
Expected: failures because:
- `SOFA_VALID_SPORTS.size` is 3 in `_lib.ts` (assertion expects 14)
- 4 new sport-tolerance tests fail because TIME_TOLERANCE_BY_SPORT only has football/tennis/basketball
- stats by_sport assertion fails because route returns 3-key object

Note failures count + sample messages. NO COMMIT YET — Task 5 stages tests + impl together.

---

## Task 4: Admin _lib.ts Update (TDD green)

**Files:**
- Modify: `app/api/sofascore/fixtures/_lib.ts`

- [ ] **Step 1: Patch _lib.ts SOFA_SPORTS tuple + TIME_TOLERANCE_BY_SPORT**

Save locally to `C:/Users/philp/AppData/Local/Temp/patch-lib-sports.py`:

```python
import sys
p = '/root/betssolution-admin/app/api/sofascore/fixtures/_lib.ts'
s = open(p).read()

# Change 1: SOFA_SPORTS tuple extension
old1 = 'const SOFA_SPORTS = ["football", "tennis", "basketball"] as const;'
new1 = '''const SOFA_SPORTS = [
  "football", "tennis", "basketball",
  "baseball", "esports", "handball", "rugby", "darts",
  "ice-hockey", "cricket", "volleyball", "boxing", "mma",
  "american-football", "snooker",
] as const;'''
if old1 not in s:
    print('ERROR: SOFA_SPORTS tuple not found', file=sys.stderr); sys.exit(1)
s = s.replace(old1, new1)

# Change 2: TIME_TOLERANCE_BY_SPORT exhaustive
old2 = '''const TIME_TOLERANCE_BY_SPORT: Record<SofaSport, number> = {
  football: 20 * 60,
  tennis: 30 * 60,
  basketball: 60 * 60,
};'''
new2 = '''const TIME_TOLERANCE_BY_SPORT: Record<SofaSport, number> = {
  football: 20 * 60,
  tennis: 30 * 60,
  basketball: 60 * 60,
  baseball: 90 * 60,
  cricket: 90 * 60,
  "ice-hockey": 30 * 60,
  handball: 20 * 60,
  volleyball: 20 * 60,
  rugby: 30 * 60,
  "american-football": 30 * 60,
  darts: 60 * 60,
  boxing: 60 * 60,
  mma: 90 * 60,
  snooker: 60 * 60,
  esports: 30 * 60,
};'''
if old2 not in s:
    print('ERROR: TIME_TOLERANCE_BY_SPORT block not found', file=sys.stderr); sys.exit(1)
s = s.replace(old2, new2)

open(p, 'w').write(s)
print('OK')
```

```powershell
scp C:/Users/philp/AppData/Local/Temp/patch-lib-sports.py scraper-vps:/tmp/patch-lib-sports.py
ssh scraper-vps "python3 /tmp/patch-lib-sports.py && rm /tmp/patch-lib-sports.py"
```
Expected stdout: `OK`.

- [ ] **Step 2: Verify _lib.ts**

```powershell
ssh scraper-vps "grep -A 5 'SOFA_SPORTS = \[' /root/betssolution-admin/app/api/sofascore/fixtures/_lib.ts | head -8"
ssh scraper-vps "grep -B 1 -A 18 'TIME_TOLERANCE_BY_SPORT' /root/betssolution-admin/app/api/sofascore/fixtures/_lib.ts | head -22"
```
Expected: tuple shows 14 entries; Record shows 14 entries with proper quoting on `ice-hockey` and `american-football` keys.

- [ ] **Step 3: Run sofascore tests, confirm GREEN**

```powershell
ssh scraper-vps "export PATH=/root/.nvm/versions/node/v22.22.1/bin:`$PATH && cd /root/betssolution-admin && npm test -- tests/api/sofascore 2>&1 | tail -10"
```
Expected: ALL passing. Both fixtures (now 23 tests: 19 prior + 4 new) and stats (4 tests) and enrichment (10 tests).

---

## Task 5: Full vitest + tsc + Admin Commit

**Files:** none (verification + commit only)

- [ ] **Step 1: Full vitest suite**

```powershell
ssh scraper-vps "export PATH=/root/.nvm/versions/node/v22.22.1/bin:`$PATH && cd /root/betssolution-admin && npm test 2>&1 | tail -6"
```
Expected: `Tests 1 failed | 102X passed (102X+1)` where 102X is baseline 1021 + 4 new sofascore tests = 1025. The 1 failure is the pre-existing consensus one.

If anything else fails: stop, diagnose. Do not proceed.

- [ ] **Step 2: tsc --noEmit**

```powershell
ssh scraper-vps "export PATH=/root/.nvm/versions/node/v22.22.1/bin:`$PATH && cd /root/betssolution-admin && npx tsc --noEmit 2>&1 | tail -5"
```
Expected: empty output / clean exit.

If tsc fails (likely cause: typo in TIME_TOLERANCE_BY_SPORT key), inspect error message and fix. Re-run from Step 1.

- [ ] **Step 3: Commit admin (3 files staged)**

Save locally to `C:/Users/philp/AppData/Local/Temp/admin-extension-commit.txt`:

```
feat(sofascore): extend matcher to 14 sports + per-sport tolerance

Extends SOFA_SPORTS tuple from 3 (football/tennis/basketball) to 14 by
adding baseball/esports/handball/rugby/darts/ice-hockey/cricket/volleyball/
boxing/mma/american-football/snooker. Single source of truth via
`as const` tuple drives SOFA_VALID_SPORTS Set + buildPoolQuery().slugs +
type SofaSport union.

TIME_TOLERANCE_BY_SPORT extended exhaustive (Record<SofaSport, number>):
- 20min: football (existing), handball, volleyball
- 30min: tennis (existing), ice-hockey, rugby, american-football, esports
- 60min: basketball (existing), darts, boxing, snooker
- 90min: baseball, cricket, mma

Default fallback (TIME_TOLERANCE_DEFAULT_SEC = 1200) invariato — exhaustive
Record makes fallback unreachable for in-tuple slugs; remains as safety net
gated by skipped_unknown_sport stage-0 check.

Tests: SOFA_VALID_SPORTS.size assertion 3->14, +4 new positive regression
tests (baseball/mma/darts/ice-hockey within sport tolerance), +1 retained
negative regression (football 25min still no_time_window). Stats by_sport
empty assertion extended to 14 keys.

Companion to sofascore-scraper main commit (discovery.py SOFA_SPORTS +
.env capacity bump). No DB migration. No frontend coupling.

Spec: docs/superpowers/specs/2026-05-08-sofascore-14sport-extension-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```powershell
scp C:/Users/philp/AppData/Local/Temp/admin-extension-commit.txt scraper-vps:/tmp/admin-extension-commit.txt
ssh scraper-vps "cd /root/betssolution-admin && git add app/api/sofascore/fixtures/_lib.ts tests/api/sofascore/fixtures.test.ts tests/api/sofascore/stats.test.ts && git -c user.email='info.softvisiontechnologies@gmail.com' -c user.name='philp' commit -F /tmp/admin-extension-commit.txt && rm /tmp/admin-extension-commit.txt && git log -1 --format='%H %s'"
```
Expected: new commit SHA. Verify only the 3 sofascore files staged via `git show --stat HEAD`.

---

## Task 6: Build Admin

**Files:** none (build artifact)

- [ ] **Step 1: npm run build**

```powershell
ssh scraper-vps "export PATH=/root/.nvm/versions/node/v22.22.1/bin:`$PATH && cd /root/betssolution-admin && npm run build 2>&1 | tail -5 && cat .next/BUILD_ID"
```
Expected: build success (route table at end with sofascore routes ƒ Dynamic), BUILD_ID printed. Capture BUILD_ID.

If build fails: diagnose tsc error in build output, fix, retry.

- [ ] **Step 2: Verify compiled outputs**

```powershell
ssh scraper-vps "ls /root/betssolution-admin/.next/server/app/api/sofascore/{fixtures,stats,enrichment}/route.js"
```
Expected: 3 files exist.

---

## Task 7: Restart Services

**Files:** none

- [ ] **Step 1: Restart admin + scraper**

```powershell
ssh scraper-vps "systemctl restart betssolution-admin.service sofascore-scraper.service && sleep 8 && systemctl is-active betssolution-admin.service sofascore-scraper.service"
```
Expected: `active` `active`.

- [ ] **Step 2: Health check**

```powershell
ssh scraper-vps "curl -s -o /dev/null -w 'admin %{http_code} %{time_total}s\n' http://127.0.0.1:3000/api/health"
```
Expected: `200 <under 1s>`.

- [ ] **Step 3: Verify scraper started with new config**

```powershell
ssh scraper-vps "journalctl -u sofascore-scraper --since '30 sec ago' --no-pager | grep 'starting' | tail -1"
```
Expected: `starting sofascore-scraper sports=['football', 'tennis', 'basketball', ...] phase0=False`. Sports list should contain all 14.

---

## Task 8: Acceptance Verification

**Files:** none (verification only)

Wait 5-10 minutes for first discovery + matching cycle.

- [ ] **Step 1: Wait for first discovery cycle**

```powershell
ssh scraper-vps "sleep 90 && journalctl -u sofascore-scraper --since '2 min ago' --no-pager | grep -iE 'discovery|matched' | tail -3 && echo --- && journalctl -u betssolution-admin --since '2 min ago' --no-pager | grep 'sofascore/fixtures' | tail -3"
```
Expected: at least 1 discovery line + at least 1 admin POST line showing received N matched_fuzzy M etc.

- [ ] **Step 2: Acceptance #2 — no_time_window ratio**

From the admin POST log captured above, parse `received` and `no_time_window`. Compute ratio. Acceptance: `< 0.30`.

If ratio is 0.30+: investigate. Possibly a new sport has high baseline drift not captured by tolerance config — note for follow-up.

- [ ] **Step 3: Acceptance #1b — by_sport stats**

```powershell
ssh scraper-vps "curl -s http://127.0.0.1:3000/api/sofascore/stats | python3 -m json.tool | head -25"
```
Expected: `by_sport` JSON with 14 keys. At least 4 of the 11 NEW sports (baseball/esports/handball/rugby/darts/ice-hockey/cricket/volleyball/boxing/mma/american-football/snooker) have count > 0.

If <4 new sports populated: per spec rollback procedure, may need to remove 1+ slug from SOFA_SPORTS tuple based on probe output.

- [ ] **Step 4: Acceptance #6 — enrichment populating (60min check)**

Optional immediate: can be deferred 30-60min for accurate signal. Quick sample now:

```powershell
ssh scraper-vps "cat > /root/betssolution-admin/scripts/db/sofa-extension-enrich-check.mjs << 'EOF'
import pg from 'pg';
const c = new pg.Client({ host:'aws-1-eu-central-1.pooler.supabase.com', port:6543, user:'postgres.xgnyqkmugnfzhdveeqom', password:'2MQhskawT3I6XVKW', database:'postgres', ssl:{rejectUnauthorized:false} });
await c.connect();
const r = await c.query(\`
  SELECT e.sport_slug, COUNT(*) FILTER (WHERE ee.last_endpoint_status->'stats'->>'http' = '200') populated, COUNT(*) total
  FROM event_enrichment ee JOIN events_v2 e ON e.id = ee.event_v2_id
  WHERE ee.last_synced_at > NOW() - INTERVAL '60 minutes'
  GROUP BY e.sport_slug ORDER BY populated DESC
\`);
console.table(r.rows);
await c.end();
EOF
export PATH=/root/.nvm/versions/node/v22.22.1/bin:\$PATH && cd /root/betssolution-admin && node scripts/db/sofa-extension-enrich-check.mjs && rm scripts/db/sofa-extension-enrich-check.mjs"
```
Expected: at least 3 new sport rows with populated > 0. If too early (just deployed), defer this check to follow-up.

---

## Task 9: Push Origin Both Repos

**Files:** none (deploy artifact)

- [ ] **Step 1: Push admin**

```powershell
$t = gh auth token; ssh scraper-vps "cd /root/betssolution-admin && git push https://oauth2:$t@github.com/infoundertheguns-ops/betssolution-admin.git feature/plan-d-settlement-d1 2>&1 | tail -3"
```
Expected: `<old>..<new> feature/plan-d-settlement-d1 -> feature/plan-d-settlement-d1`.

- [ ] **Step 2: Push sofascore-scraper**

```powershell
$t = gh auth token; ssh scraper-vps "cd /root/sofascore-scraper && git push https://oauth2:$t@github.com/infoundertheguns-ops/sofascore-scraper.git main 2>&1 | tail -3"
```
Expected: `<old>..<new> main -> main`.

- [ ] **Step 3: Verify origin sync**

```powershell
$adminOrigin = gh api repos/infoundertheguns-ops/betssolution-admin/branches/feature%2Fplan-d-settlement-d1 --jq '.commit.sha'
$scraperOrigin = gh api repos/infoundertheguns-ops/sofascore-scraper/branches/main --jq '.commit.sha'
$adminVps = ssh scraper-vps "cd /root/betssolution-admin && git rev-parse HEAD"
$scraperVps = ssh scraper-vps "cd /root/sofascore-scraper && git rev-parse HEAD"
"admin   origin: $adminOrigin / vps: $adminVps"
"scraper origin: $scraperOrigin / vps: $scraperVps"
```
Expected: matched pairs.

---

## Done When

- All 9 tasks completed
- Acceptance #1a (probe ≥10/14 supported) ✅ from Task 1 output
- Acceptance #1b (≥4 new sports stats > 0) ✅ from Task 8 Step 3
- Acceptance #2 (no_time_window ratio < 0.30) ✅ from Task 8 Step 2
- Acceptance #3 (vitest green except consensus) ✅ from Task 5 Step 1
- Acceptance #4 (tsc clean) ✅ from Task 5 Step 2
- Both origin/VPS HEADs synced ✅ from Task 9 Step 3
- Acceptance #5 (24h capacity gate) → manual reminder for 2026-05-09 ~14:00 UTC
- Acceptance #6 (enrichment populating) → re-check at +60min if Task 8 Step 4 deferred
- Memory updated with deploy commit SHAs + BUILD_ID
