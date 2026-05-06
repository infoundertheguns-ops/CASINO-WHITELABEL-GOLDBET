# Tennis fixes B1.B — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the data-grounded comma-split fix + defensive paren-strip + tennis-specific NOISE tokens to `flashscore-scraper/src/normalize.ts`. Single-file modification + 13 new tests. Target: tennis ok rate ≥5% at T+30 (vs B1.A baseline 0.59%).

**Architecture:** Pure normalize-layer change. The `tokenize()` regex is broadened to split on comma and strip parens (3-character regex update). `NOISE_TOKENS_BY_SPORT.tennis` is populated with 8 tournament admin tokens (q1, q2, q3, ll, wc, pr, alt, qualifier). The 3-stage matchTeams algorithm is unchanged — once tokens are clean, the existing subset-match Stage 3 handles all `Surname, Firstname` ↔ `Surname F.` cases naturally. No new files; no other modules affected.

**Tech Stack:** TypeScript, Node 20 (via nvm on VPS), Vitest 4.1.5, tsx (no compile step). Deploy via scp + systemctl restart on `scraper-vps` (`flashscore-scraper.service`). `flashscore-scraper` is **non-git on the VPS**; source-of-truth lives in `docs/superpowers/artifacts/<date>-<topic>/scraper/` mirrors. SSH config `scraper-vps` already set up with key auth.

**Reference docs:**
- Spec: `docs/superpowers/specs/2026-05-06-tennis-fixes-B1B-design.md`
- Predecessor RUNBOOK (B1.A): `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/RUNBOOK.md`
- Captured sample data (input): `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/samples-tennis-name_mismatch.json`
- Source-of-truth scraper mirror (current = post-B1.A): `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/`

---

## Working environment (READ FIRST)

Same as B1.A. `flashscore-scraper` is **NOT a local directory** — source lives on `scraper-vps:~/flashscore-scraper/`. Local working copy expected at `/tmp/flashscore-scraper-work/` (carried over from B1.A session; refresh if missing).

**Key commands**:
```bash
# Refresh working copy from VPS (if /tmp/flashscore-scraper-work/ is stale or missing)
ssh scraper-vps "cd ~/flashscore-scraper && tar czf - --exclude=node_modules --exclude=dist --exclude=.git --exclude='src/*.bak*' ." \
  | tar xzf - -C /tmp/flashscore-scraper-work/

# Push edited source to VPS
scp /tmp/flashscore-scraper-work/src/normalize.ts scraper-vps:~/flashscore-scraper/src/
scp /tmp/flashscore-scraper-work/src/__tests__/normalize.test.ts scraper-vps:~/flashscore-scraper/src/__tests__/

# Run vitest on VPS (nvm sourced + node_modules/.bin path)
ssh scraper-vps "source /root/.nvm/nvm.sh && cd ~/flashscore-scraper && ./node_modules/.bin/vitest run 2>&1 | tail -10"

# Run typecheck
ssh scraper-vps "source /root/.nvm/nvm.sh && cd ~/flashscore-scraper && ./node_modules/.bin/tsc --noEmit 2>&1 | head -10"

# Restart scraper service after deploy
ssh scraper-vps "systemctl restart flashscore-scraper.service"

# Capture /stats (FS_SEARCH_API_KEY = 9da2486093af1366d92024f4cf311ceee93659020a6d1c95)
ssh scraper-vps "curl -s -H 'x-api-key: 9da2486093af1366d92024f4cf311ceee93659020a6d1c95' http://127.0.0.1:8090/stats"
```

Mirror at `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/scraper/` is committed to git as the canonical source-of-truth for B1.B state.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `flashscore-scraper/src/normalize.ts` | MODIFY | tokenize regex update + populate NOISE_TOKENS_BY_SPORT.tennis |
| `flashscore-scraper/src/__tests__/normalize.test.ts` | EXTEND | +1 describe block, 13 new tests |
| `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/scraper/src/normalize.ts` | CREATE (mirror) | Post-deploy snapshot for git history + rollback reference |
| `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/scraper/src/__tests__/normalize.test.ts` | CREATE (mirror) | idem |
| `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/RUNBOOK.md` | CREATE | T-0 baseline, deploy log, post-window validation |
| `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/baseline-stats-T0.json` | CREATE | Pre-deploy /stats snapshot |
| `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/post-window-stats.json` | CREATE | T+30 /stats snapshot |
| `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/samples-tennis-residual.json` | CREATE | T+30 sample dump for residual pattern analysis |

**Branch**: `feature/plan-d-settlement-d1` (current).

---

## Task 0: T-0 baseline + RUNBOOK skeleton + mirror dir

**Files:**
- Create: `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/RUNBOOK.md`
- Create: `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/baseline-stats-T0.json`
- Create: `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/scraper/src/__tests__/` directory tree

**Note**: T-0 baseline here is the AUTHORITATIVE comparison snapshot for B1.B success criteria. (B1.A used a 2-baseline pattern — sanity-check at T0 + authoritative at T6 — but B1.B is a single fast-deploy cycle, so one capture immediately pre-deploy suffices.)

- [ ] **Step 1: Capture /stats baseline immediately pre-restart**

```bash
cd /c/Users/philp/Documents/Project/betssolution-admin-plan-d
mkdir -p docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/scraper/src/__tests__
ssh scraper-vps "curl -s -H 'x-api-key: 9da2486093af1366d92024f4cf311ceee93659020a6d1c95' http://127.0.0.1:8090/stats" \
  | tee docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/baseline-stats-T0.json | head -c 500
```
Expected: JSON with `uptime_sec`, `search_requests_total`, `by_sport.tennis.{ok, no_match_*}`. Note the values for tennis ok rate, time/name shares — these are the comparison reference.

- [ ] **Step 2: Write RUNBOOK header + baseline section**

Create `RUNBOOK.md` with this content (fill in [paste] placeholders from baseline-stats-T0.json):

```markdown
# Tennis fixes B1.B — Deployment Runbook

Implementation plan: `docs/superpowers/plans/2026-05-06-tennis-fixes-B1B.md`
Spec: `docs/superpowers/specs/2026-05-06-tennis-fixes-B1B-design.md`
Branch: `feature/plan-d-settlement-d1`

## T-0 Baseline (authoritative — captured immediately pre-deploy)

Source: `baseline-stats-T0.json` (this directory).

[paste relevant by_sport.tennis + by_sport.football + by_sport.basketball values here]

Tennis ok rate target post-B1.B: hard ≥5%, soft ≥3% at T+30.

## Pre-deploy validation (local)

[populated by T2]

## Deploy log

[populated by T3]

## Post-window validation (T+30 min)

[populated by T4]
```

- [ ] **Step 3: Commit baseline + skeleton**

```bash
touch docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/scraper/.gitkeep
git add docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/
git commit -m "fs-id B1.B T0: baseline stats + RUNBOOK skeleton + mirror dir"
```

---

## Task 1: TDD — write 13 failing tests in normalize.test.ts

**Files:**
- Modify: `/tmp/flashscore-scraper-work/src/__tests__/normalize.test.ts` (extend with 1 new describe block)

The current test file (post-B1.A) has 8 describe blocks ending with `"normalizeTeam — per-sport scaffold (B1.A)"`. Append a new block AFTER it.

- [ ] **Step 1: Verify working copy is current**

```bash
ls /tmp/flashscore-scraper-work/src/normalize.ts \
   /tmp/flashscore-scraper-work/src/__tests__/normalize.test.ts 2>&1
```
If either is missing, refresh the working copy:
```bash
mkdir -p /tmp/flashscore-scraper-work
ssh scraper-vps "cd ~/flashscore-scraper && tar czf - --exclude=node_modules --exclude=dist --exclude=.git --exclude='src/*.bak*' ." \
  | tar xzf - -C /tmp/flashscore-scraper-work/
```

- [ ] **Step 2: Append the new describe block**

Add this exact content to the END of `/tmp/flashscore-scraper-work/src/__tests__/normalize.test.ts`:

```ts
describe("normalizeTeam — tennis (B1.B comma + paren + NOISE)", () => {
  // ── Comma-format positive tests (data-driven from B1.A captured samples) ──
  it("Sabalenka, Aryna matches Sabalenka A.", () => {
    const a = normalizeTeam("Sabalenka, Aryna", "tennis");
    const b = normalizeTeam("Sabalenka A.", "tennis");
    expect(matchTeams(a, b)).toBe(true);
  });

  it("Pucinelli de Almeida, Matheus matches Pucinelli De Almeida M.", () => {
    const a = normalizeTeam("Pucinelli de Almeida, Matheus", "tennis");
    const b = normalizeTeam("Pucinelli De Almeida M.", "tennis");
    expect(matchTeams(a, b)).toBe(true);
  });

  it("Diaz Acosta, Facundo matches Diaz Acosta F.", () => {
    const a = normalizeTeam("Diaz Acosta, Facundo", "tennis");
    const b = normalizeTeam("Diaz Acosta F.", "tennis");
    expect(matchTeams(a, b)).toBe(true);
  });

  it("Struff, Jan-Lennard matches Struff J. (hyphen + comma combo)", () => {
    const a = normalizeTeam("Struff, Jan-Lennard", "tennis");
    const b = normalizeTeam("Struff J.", "tennis");
    expect(matchTeams(a, b)).toBe(true);
  });

  it("Sinner, J. matches Sinner Jannik (initial-first comma to full name)", () => {
    const a = normalizeTeam("Sinner, J.", "tennis");
    const b = normalizeTeam("Sinner Jannik", "tennis");
    expect(matchTeams(a, b)).toBe(true);
  });

  it("Sinner J. matches Sinner, Jannik (reverse direction)", () => {
    const a = normalizeTeam("Sinner J.", "tennis");
    const b = normalizeTeam("Sinner, Jannik", "tennis");
    expect(matchTeams(a, b)).toBe(true);
  });

  // ── Comma-format negative tests (no false positives) ──
  it("Korda, Sebastian does NOT match Korda, Petr (different first names ≥4 chars)", () => {
    // both first names ≥ 4 chars → both are discriminating tokens; subset
    // match must NOT collapse father/son players sharing surname
    const a = normalizeTeam("Korda, Sebastian", "tennis");
    const b = normalizeTeam("Korda, Petr", "tennis");
    expect(matchTeams(a, b)).toBe(false);
  });

  it("Sabalenka, A does NOT match Pegula, A (different surnames, same initial)", () => {
    const a = normalizeTeam("Sabalenka, A", "tennis");
    const b = normalizeTeam("Pegula, A", "tennis");
    expect(matchTeams(a, b)).toBe(false);
  });

  // ── Paren strip tests (defensive — country code suffixes) ──
  it("Sinner J. (ITA) matches Sinner Jannik (parens stripped)", () => {
    const a = normalizeTeam("Sinner J. (ITA)", "tennis");
    const b = normalizeTeam("Sinner Jannik", "tennis");
    expect(matchTeams(a, b)).toBe(true);
  });

  it("Alcaraz C. (ESP) matches Alcaraz Carlos (parens stripped)", () => {
    const a = normalizeTeam("Alcaraz C. (ESP)", "tennis");
    const b = normalizeTeam("Alcaraz Carlos", "tennis");
    expect(matchTeams(a, b)).toBe(true);
  });

  // ── Tennis NOISE token tests ──
  it("Korda S. (Q1) matches Korda Sebastian (qualifier marker stripped)", () => {
    const a = normalizeTeam("Korda S. (Q1)", "tennis");
    const b = normalizeTeam("Korda Sebastian", "tennis");
    expect(matchTeams(a, b)).toBe(true);
  });

  it("Maric F. WC matches Maric Filip (wildcard marker stripped)", () => {
    const a = normalizeTeam("Maric F. WC", "tennis");
    const b = normalizeTeam("Maric Filip", "tennis");
    expect(matchTeams(a, b)).toBe(true);
  });

  it("Li, Na tokens preserve 'li' and 'na' (2-char Chinese surname NOT in NOISE)", () => {
    // Regression guard: future maintainer must NOT add common 2-char tokens to
    // tennis NOISE without checking surname collision risk. "li" is a real
    // surname for many Asian players (Na Li, etc.). This test locks the intent.
    const r = normalizeTeam("Li, Na", "tennis");
    expect(r.tokens).toContain("li");
    expect(r.tokens).toContain("na");
  });
});
```

- [ ] **Step 3: scp test file to VPS and run — verify all 13 NEW tests fail**

```bash
scp /tmp/flashscore-scraper-work/src/__tests__/normalize.test.ts scraper-vps:~/flashscore-scraper/src/__tests__/
ssh scraper-vps "source /root/.nvm/nvm.sh && cd ~/flashscore-scraper && ./node_modules/.bin/vitest run src/__tests__/normalize.test.ts 2>&1 | tail -30"
```

Expected:
- 60 existing tests still PASS (37 normalize + the cache/sample-collector/search ones if vitest runs the whole file).
- 13 new tests in the new describe block FAIL. The most likely failure mode: the `Sabalenka, Aryna matches Sabalenka A.` test (and similar comma tests) returns `false` because `tokenize` doesn't split on comma. Failure messages will look like `expected false to be true` for positive tests; the 2 negative tests + the `Li, Na tokens` test may pass coincidentally pre-fix (the negatives are guards, not regressions).

Either way: **do NOT proceed to Step 4 until you've confirmed the comma-positive tests fail**. If they unexpectedly pass, the working copy may be out of date with current normalize.ts state — investigate before continuing.

- [ ] **Step 4: Commit failing tests as TDD checkpoint**

```bash
cp /tmp/flashscore-scraper-work/src/__tests__/normalize.test.ts \
   docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/scraper/src/__tests__/normalize.test.ts
git add docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/scraper/src/__tests__/normalize.test.ts
git commit -m "fs-id B1.B T1: failing TDD tests (13) — comma + paren + NOISE"
```

---

## Task 2: Apply normalize.ts fix + verify all tests pass

**Files:**
- Modify: `/tmp/flashscore-scraper-work/src/normalize.ts`

The current normalize.ts (post-B1.A T2) has:
- `_DEFAULT_NOISE` Set with 30 tokens
- `_DEFAULT_RESERVE` Set with 14 tokens
- `NOISE_TOKENS_BY_SPORT` Record with `_default` only (tennis slot is just a comment)
- `RESERVE_MARKERS_BY_SPORT` Record with `_default` only
- `tokenize(raw, sportSlug)` with regex `.replace(/[.']/g, "")` + `.split(/[\s\-/&]+/)`

We make exactly 2 modifications:

- [ ] **Step 1: Apply Modification A — tokenize regex updates**

In `/tmp/flashscore-scraper-work/src/normalize.ts`, find the `tokenize` function and update the two regexes:

```ts
// FROM:
.replace(/[.']/g, "")
.split(/[\s\-/&]+/)

// TO:
.replace(/[.'()]/g, "")
.split(/[\s\-/&,]+/)
```

That's it for Modification A — 1 character added to strip regex (`(`+`)` collapsed into one regex char-class addition), 1 character (`,`) added to split regex.

- [ ] **Step 2: Apply Modification B — populate NOISE_TOKENS_BY_SPORT.tennis**

In the same file, find the `NOISE_TOKENS_BY_SPORT` declaration block. Replace the existing version:

```ts
// FROM:
const NOISE_TOKENS_BY_SPORT: Record<string, Set<string>> = {
  _default: _DEFAULT_NOISE,
  // tennis, baseball populated in B1.B based on captured samples
};

// TO:
const _TENNIS_NOISE = new Set([
  ..._DEFAULT_NOISE,
  // Tournament admin markers (not part of player identity)
  "q1", "q2", "q3",   // qualifying round indicators
  "ll",                // lucky loser
  "wc",                // wildcard entry
  "pr",                // protected ranking
  "alt",               // alternate
  "qualifier",         // explicit qualifier word
]);

const NOISE_TOKENS_BY_SPORT: Record<string, Set<string>> = {
  _default: _DEFAULT_NOISE,
  tennis:    _TENNIS_NOISE,
  // baseball intentionally not added — captured samples show failures are FS
  // coverage gaps, not normalize defects. Adding mascot/nickname tokens to
  // NOISE would collide distinct teams (e.g. "Eagles", "Bears", "Panthers"
  // are part of identity, not noise).
};
```

`RESERVE_MARKERS_BY_SPORT` stays unchanged (no tennis-specific reserve markers in B1.B).

- [ ] **Step 3: scp updated normalize.ts to VPS**

```bash
scp /tmp/flashscore-scraper-work/src/normalize.ts scraper-vps:~/flashscore-scraper/src/
```

- [ ] **Step 4: Run normalize tests on VPS — verify all 13 new tests now PASS**

```bash
ssh scraper-vps "source /root/.nvm/nvm.sh && cd ~/flashscore-scraper && ./node_modules/.bin/vitest run src/__tests__/normalize.test.ts 2>&1 | tail -15"
```
Expected: 50 normalize tests PASS (37 existing + 13 new).

- [ ] **Step 5: Run FULL test suite — verify zero regressions**

```bash
ssh scraper-vps "source /root/.nvm/nvm.sh && cd ~/flashscore-scraper && ./node_modules/.bin/vitest run 2>&1 | tail -15"
```
Expected: **73/73 PASS** (5 cache + 6 sample-collector + 50 normalize + 12 search). If any pre-existing test fails, STOP and investigate — the change is supposed to be regression-free.

- [ ] **Step 6: Run typecheck**

```bash
ssh scraper-vps "source /root/.nvm/nvm.sh && cd ~/flashscore-scraper && ./node_modules/.bin/tsc --noEmit 2>&1 | head -20"
```
Expected: 0 errors, no output.

- [ ] **Step 7: Mirror to artifacts + commit**

```bash
cd /c/Users/philp/Documents/Project/betssolution-admin-plan-d
cp /tmp/flashscore-scraper-work/src/normalize.ts \
   docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/scraper/src/normalize.ts
git add docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/scraper/src/normalize.ts
git commit -m "fs-id B1.B T2: comma split + paren strip + tennis NOISE — 73/73 tests pass"
```

- [ ] **Step 8: Append "Pre-deploy validation" to RUNBOOK**

Edit `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/RUNBOOK.md`, replace the `[populated by T2]` placeholder under "Pre-deploy validation (local)" with:

```markdown
- vitest run: 73/73 PASS (5 cache + 6 sample-collector + 50 normalize + 12 search)
- tsc --noEmit: 0 errors
- Diff vs B1.A normalize.ts:
  - tokenize strip regex: `[.']` → `[.'()]` (parens added)
  - tokenize split regex: `[\s\-/&]+` → `[\s\-/&,]+` (comma added)
  - NOISE_TOKENS_BY_SPORT.tennis populated with `_DEFAULT_NOISE + 8 tournament admin markers`
  - All other functions/exports unchanged
```

```bash
git add docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/RUNBOOK.md
git commit -m "fs-id B1.B T2 follow-up: RUNBOOK pre-deploy validation"
```

---

## Task 3: VPS deploy + smoke

**Files:**
- Update: `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/RUNBOOK.md`

The new normalize.ts is already on VPS from T2 Step 3. The running service is still using the OLD code (loaded at PID 1312509 startup time). Restart picks up the new code via tsx (no build step).

- [ ] **Step 1: Capture pre-restart memory baseline**

```bash
ssh scraper-vps "ps -o rss= -p \$(systemctl show flashscore-scraper.service --property=MainPID --value)" | tr -d ' '
```
Record the value (KB).

- [ ] **Step 2: Restart service**

```bash
ssh scraper-vps "systemctl restart flashscore-scraper.service && sleep 3 && systemctl status flashscore-scraper.service --no-pager 2>&1 | head -10"
```
Expected: `Active: active (running)`, new PID, uptime < 5 sec.

- [ ] **Step 3: Smoke /stats post-restart**

```bash
ssh scraper-vps "curl -s -H 'x-api-key: 9da2486093af1366d92024f4cf311ceee93659020a6d1c95' http://127.0.0.1:8090/stats" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'uptime_sec={d[\"uptime_sec\"]} reqs={d[\"search_requests_total\"]} sports={list(d.get(\"by_sport\",{}).keys())[:6]}')"
```
Expected: uptime ≤ 30, requests ≥ 0 (counters reset by restart).

- [ ] **Step 4: Force a known-comma query to verify fix lands**

Pick a tennis player from baseline samples, e.g. `Sabalenka, Aryna`. Try a manual /search with a sport+time combo that should match a real FS event:

```bash
# Try with a future-ish but plausible time. Tennis events are constantly being added.
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
ssh scraper-vps "curl -s -H 'x-api-key: 9da2486093af1366d92024f4cf311ceee93659020a6d1c95' \
  'http://127.0.0.1:8090/search?sport_slug=tennis&starts_at=$NOW&home=Sabalenka,%20Aryna&away=Pegula,%20Jessica'"
```

Result interpretation:
- `200` with matchId → fix works.
- `404 reason=feed_empty` or `time_window_miss` → FS doesn't have these players in the time window today. Fine — the fix can't be tested without aligned scheduling. Real verification comes via T+30 prod traffic.
- `404 reason=name_mismatch` with actual `fs_candidates` populated → CONCERN: candidates exist but match still failed. Investigate immediately.

If the curl returns 404 for time/feed reasons, that's normal — proceed. The actual ship verification is post-T4.

- [ ] **Step 5: Memory delta check**

```bash
ssh scraper-vps "ps -o rss= -p \$(systemctl show flashscore-scraper.service --property=MainPID --value)" | tr -d ' '
```
Compare to Step 1 value. Threshold: ≤ +5MB (5120 KB). The change adds 8 strings to a Set + 2 chars in regexes — memory impact should be negligible (likely <100KB).

- [ ] **Step 6: Sample collector smoke (still running from B1.A)**

```bash
ssh scraper-vps "curl -s -H 'x-api-key: 9da2486093af1366d92024f4cf311ceee93659020a6d1c95' 'http://127.0.0.1:8090/stats/samples?sport=tennis&limit=5' | python3 -c 'import json,sys; d=json.load(sys.stdin); print(f\"count={d[\"count\"]} reasons={set(s[\"reason\"] for s in d[\"samples\"])}\")'"
```
Expected: count grows from 0 quickly. Whatever reasons remain in samples post-fix are the *residual* patterns we couldn't fix — that's the data we want for analysis at T4.

- [ ] **Step 7: Append deploy log to RUNBOOK**

Edit `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/RUNBOOK.md`, replace `[populated by T3]` with:

```markdown
### Restart timestamp

[date -u]
PID before: [from step 1 command preceding restart]
PID after: [from step 2 systemctl status]

### Smoke results

- /stats post-restart: counters reset (uptime_sec=[N])
- Manual /search probe (Sabalenka,Aryna...): [200/404+reason]
- Memory delta: pre=[N]KB, post=[N]KB, delta=[N]KB (threshold +5MB)
- /stats/samples?sport=tennis: count=[N] within [Y] seconds — collector active
```

```bash
git add docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/RUNBOOK.md
git commit -m "fs-id B1.B T3: deploy + smoke — service restarted, fix live"
```

- [ ] **Step 8: Decision gate — proceed to T4 or rollback**

Rollback trigger conditions (any one):
- `systemctl status` shows non-active or repeated restarts
- Memory delta > +5MB
- Manual /search probe returned 5xx error
- `/stats/samples` endpoint not reachable

If any condition met: rollback per the spec rollback section, then STOP and surface to user.

If smoke clean: proceed to T4 wait window.

```bash
# ROLLBACK COMMAND (skip if smoke green):
SCRAPER_PREV=docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper
scp $SCRAPER_PREV/src/normalize.ts scraper-vps:~/flashscore-scraper/src/normalize.ts
scp $SCRAPER_PREV/src/__tests__/normalize.test.ts scraper-vps:~/flashscore-scraper/src/__tests__/normalize.test.ts
ssh scraper-vps "systemctl restart flashscore-scraper.service"
```

---

## Task 4: 30-min wait + post-window validation

**Files:**
- Update: `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/RUNBOOK.md`
- Create: `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/post-window-stats.json`
- Create: `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/samples-tennis-residual.json`

**Executor handoff guidance**: T4 has a 30-min wait window. After T3 deploy completes, the executor should:
1. Record T3 commits, push to origin
2. Tell orchestrator "B1.B deployed, exiting for wait window — resume T4 after ≥30 min"
3. Exit cleanly, do NOT poll

The wait is real wall-clock time (need new ingester ticks to hit the search endpoint with real events).

- [ ] **Step 1: Wait 30 minutes minimum**

The ingester runs ~100-500 /search calls per minute across all sports. Tennis gets ~50-100 of those. After 30 min, expect ~1500-3000 tennis requests in counters — large enough sample for ratio comparison.

- [ ] **Step 2: Capture post-window /stats and samples**

```bash
ssh scraper-vps "curl -s -H 'x-api-key: 9da2486093af1366d92024f4cf311ceee93659020a6d1c95' http://127.0.0.1:8090/stats" \
  > docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/post-window-stats.json
ssh scraper-vps "curl -s -H 'x-api-key: 9da2486093af1366d92024f4cf311ceee93659020a6d1c95' \
  'http://127.0.0.1:8090/stats/samples?sport=tennis&reason=name_mismatch&limit=200'" \
  > docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/samples-tennis-residual.json
```

- [ ] **Step 3: Compute success criteria deltas**

Compare `post-window-stats.json` to `baseline-stats-T0.json`:

```bash
python3 << 'EOF'
import json
b = json.load(open('docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/baseline-stats-T0.json'))
p = json.load(open('docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/post-window-stats.json'))

def share(c):
    total = sum(c.values())
    if not total: return None
    return total, c['ok']/total*100, c['no_match_time']/total*100, c['no_match_name']/total*100

print(f"Sport       | T-0 total ok%  time%  name% | T+30 total ok%  time%  name% | Δok    Δtime   Δname")
print("-"*120)
for sport in ['tennis', 'football', 'basketball', 'baseball']:
    bb = b['by_sport'].get(sport, {})
    pp = p['by_sport'].get(sport, {})
    if not bb or not pp:
        continue
    bs = share(bb)
    ps = share(pp)
    if not bs or not ps:
        continue
    bt, bok, bt_, bn = bs
    pt, pok, pt_, pn = ps
    print(f"{sport:11s} | {bt:5d} {bok:5.2f}% {bt_:5.2f}% {bn:5.2f}% | {pt:5d} {pok:5.2f}% {pt_:5.2f}% {pn:5.2f}% | {pok-bok:+5.2f}  {pt_-bt_:+5.2f}  {pn-bn:+5.2f}")
EOF
```

- [ ] **Step 4: Analyze residual sample patterns**

```bash
python3 << 'EOF'
import json, re
d = json.load(open('docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/samples-tennis-residual.json'))
patterns = {'comma': 0, 'slash': 0, 'plain': 0}
for s in d['samples']:
    h, a = s['query_home'], s['query_away']
    text = h + ' ' + a
    if ',' in text: patterns['comma'] += 1
    elif '/' in text: patterns['slash'] += 1
    else: patterns['plain'] += 1
total = sum(patterns.values())
print(f"Residual {total} samples by format:")
for k, v in patterns.items():
    print(f"  {k:8s} {v:4d}  ({v/total*100:.1f}%)")
print()
print("Expected post-fix: comma share should drop from B1.A's 54.7% to <20%.")
print("Top 10 unique residual queries:")
seen = set()
for s in d['samples']:
    p = (s['query_home'], s['query_away'])
    if p not in seen:
        seen.add(p)
        print(f"  H={s['query_home']:35s} A={s['query_away']}")
        if len(seen) >= 10: break
EOF
```

- [ ] **Step 5: Decision — SHIP / soft ship / rollback**

Per spec success criteria:

| Outcome | Tennis ok rate | Action |
|---------|----------------|--------|
| **Hard target met** | ≥ 5% | SHIP, push origin, register B1.B as done. Roadmap → B2 next. |
| **Soft minimum** | 3-5% | SHIP with caveat. Register residual pattern analysis as B1.C ticket. Roadmap → B2 next. |
| **Below soft min** | < 3% | Investigate first. If basketball/football regressed → rollback. If only tennis underperformed → likely FS coverage gap (not fix bug); document and ship anyway. |
| **Football/basketball regressed** | their ok% lower than baseline | ROLLBACK immediately. |

- [ ] **Step 6: Append post-window section to RUNBOOK**

Edit `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/RUNBOOK.md`, replace `[populated by T4]` with:

```markdown
## Post-window validation (T+30 min)

Captured at T+[N]min (uptime_sec=[N], search_requests_total=[N]).

### /stats by_sport delta vs T-0

[paste output of Step 3 script]

### Residual sample pattern analysis

[paste output of Step 4 script]

### Success criteria result

| Criterion | Threshold | T-0 | T+30 | Pass? |
|-----------|-----------|-----|------|------:|
| Tennis ok rate | ≥5% hard / ≥3% soft | [N]% | [N]% | [✅/⚠️/❌] |
| Tennis name_mismatch share | ≤35% | [N]% | [N]% | [✅/❌] |
| Football ok rate | ≥ baseline | [N]% | [N]% | [✅/❌] |
| Basketball ok rate | ≥ baseline | [N]% | [N]% | [✅/❌] |
| Memory delta | ≤+5MB | [N]KB | [N]KB | [✅/❌] |
| 0 sample-collector warnings | 0 | — | [N] | [✅/❌] |

### Decision

[SHIP / SOFT-SHIP / ROLLBACK + rationale]

### Carryover

[Any new follow-ups, especially anything pointing to B1.C / B2 / B3 / B4]
```

- [ ] **Step 7: Commit final RUNBOOK + artifacts + push origin**

```bash
git add docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/{RUNBOOK.md,post-window-stats.json,samples-tennis-residual.json}
git commit -m "fs-id B1.B T4: post-window validation — [SHIP/SOFT-SHIP] tennis ok rate [N]%"
git push origin feature/plan-d-settlement-d1
```

Confirm push success.

---

## Success criteria (B1.B — overall)

- [ ] 73/73 vitest pass on VPS, 0 typecheck errors (T2)
- [ ] Service restart clean, smoke probes green, memory delta ≤ +5MB (T3)
- [ ] Tennis ok rate ≥ 5% (hard) or ≥ 3% (soft) at T+30 (T4)
- [ ] Football + basketball ok rates ≥ T-0 baseline (T4)
- [ ] 0 sample-collector warnings during 30-min window (T4)

If hard target met: ✅ B1.B SHIPPED. Push origin, mark done. Proceed to B2 brainstorm.
If soft min met: ✅ B1.B SHIPPED with B1.C ticket registered for residual patterns.
If neither: investigate, possibly rollback.

---

## Out-of-scope (for B2 / B3 / B4)

- **B2**: sport_id mapping for darts/boxing/mma/snooker (independent)
- **B3**: alias mining via /stats/samples (uses same telemetry, separate consumer)
- **B4**: operational hygiene — getSamples reason type tightening (T4-I1 carryover), array-form query param defense (T4-I2 carryover), lastInWindow most-relevant-offset fix (T3 reviewer Important #2/#3), rollback trigger doc tighten
