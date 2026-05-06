# Design — Tennis fixes B1.B (comma split + paren strip + tennis NOISE)

**Status**: Design — pending implementation plan
**Date**: 2026-05-06
**Author**: pair (user + Claude)
**Branch**: `feature/plan-d-settlement-d1`
**Predecessors**:
- `2026-05-06-tennis-fixes-B1-design.md` (B1.A — instrumentation, shipped 2026-05-06 with 8/9 success criteria pass)
- B1.A T7 RUNBOOK with 200 captured tennis name_mismatch samples used as input data
**Related**:
- `flashscore-scraper/src/normalize.ts` (per-sport scaffold ready in B1.A T2 — `NOISE_TOKENS_BY_SPORT.tennis` slot empty pending this spec)
- `services/odds-api-ingester/src/resolve-flashscore-id.ts` (caller, untouched)

## Problem

After B1.A ship (2026-05-06 20:40 UTC), captured 200 real tennis name_mismatch samples in 49 minutes of prod traffic. Pattern analysis on 172 unique queries:

| Pattern | Count | Share | Fix in B1.B? |
|---------|------:|------:|--------------|
| `Surname, Firstname` (with comma) | 94 | 54.7% | **YES — primary target** |
| `Firstname Surname` (no comma, no slash) | 70 | 40.7% | NO — FS coverage gap |
| Multi-word surname with comma (e.g. `Pucinelli de Almeida, Matheus`) | 9 | 5.2% | YES (same fix) |
| Doubles slash format (e.g. `Justo G I / Roncadelli F`) | 8 | 4.7% | NO — FS coverage gap |
| Country code `(USA)`, qualifier markers `Q1/LL/WC`, parens, special chars | 0 | 0% | Defensive only |

**Diagnostic insight (the actual bug)**:

`tokenize()` in `normalize.ts` splits on `[\s\-/&]+` but **NOT on comma**. So `"Sabalenka, Aryna"` becomes:
- after lowercase + diacritic strip: `"sabalenka, aryna"`
- after `replace(/[.']/g, "")`: `"sabalenka, aryna"` (comma untouched)
- after split: `["sabalenka,", "aryna"]` ← comma still attached to first token

The match algorithm Stage 3 then does subset comparison: bookmaker `aDisc = {"sabalenka,", "aryna"}` vs FS `bDisc = {"sabalenka"}`. Since `Set.has("sabalenka")` returns false against `"sabalenka,"`, the subset check fails. **All 94 single-surname-comma queries hit this exact bug.** Multi-word surname comma queries hit the same bug for the comma'd surname-end token.

**Tennis ok rate at T-0 baseline 0.56% → T+49 after B1.A 0.59% (essentially unchanged)** — proves time-window expansion alone barely moved the needle for tennis. The comma fix is the single highest-leverage move available.

## Why this matters

Tennis: 17.9% events have FS-id (post-B1.A). 2.269 tennis events with NULL fs_id → all stats+player markets hidden by `v_player_markets` Phase 1.5 filter. Recovering ~60% of name_mismatch failures (54.7% comma + 5.2% multi-word comma = ~59.9% of unique fails) translates directly to fs_id population for those events on the next ingester tick.

Conservative impact estimate: tennis ok rate 0.59% → ~5-8% (~10× improvement), unlocking visibility for hundreds of tennis events worth of player+stats markets.

## What we are NOT doing here

- Fix the `lastInWindow` semantics for `time_window_miss` records (B4 carryover from T3 reviewer Important #2/#3)
- Address the 40.7% no-comma `Firstname Surname` failures — these are FS coverage gaps, not normalize defects
- Fix doubles slash format (4.7%) — also FS coverage gaps for the lower-tier tournaments these appear in
- Touch baseball normalize — captured baseball samples show the failures are FS coverage gaps for minor league/college baseball, not normalize defects. Adding NOISE tokens for mascots (Eagles, Bears, Panthers) would COLLIDE distinct teams. Bad idea.
- Per-sport time tolerance further tuning — registry P2, deferred
- Alias dict mining — separate Bundle (B3), uses same telemetry endpoint but different consumer
- Sport_id mapping for darts/boxing/mma/snooker — separate Bundle (B2)

## Design rationale: data-grounded plus narrow defense

The single root-cause fix from data is **comma split**. We add two narrow defensive measures because the cost is trivial and they address well-documented bookmaker quirks:

1. **Paren strip** — handles country code suffixes like `Sinner J. (ITA)`. Not seen in current 200 samples but documented in domain knowledge (Bet365 and others use this for athletes under neutral flags). Risk-free: no team name we care about contains intentional parens.

2. **Tennis-specific NOISE tokens** — handles tournament admin markers (`q1`/`q2`/`q3`/`ll`/`wc`/`pr`/`alt`/`qualifier`) that bookmakers occasionally include but FS does not. Domain-grounded list, not exhaustive country code list. Player names never legitimately contain `q1` or `ll`, so false-positive risk is near-zero.

Tokens explicitly **NOT added to NOISE**:
- `jr`, `sr` — needed to distinguish father/son players (e.g. `Korda Jr.` vs `Korda Sr.`)
- Country codes like `usa`, `ita` — already excluded from Stage 3 discriminating filter by length<4 constraint, no further action needed
- Generic words like `seed`, `seeds` — could occur in legitimate team names

## B1.B architecture

### File changes

```
flashscore-scraper/src/
├── normalize.ts          (modified: tokenize regex + NOISE_TOKENS_BY_SPORT.tennis populated)
└── __tests__/
    └── normalize.test.ts (extended: 1 new describe block, 12 new tests)
```

All other files (sample-collector.ts, search.ts, server.ts, cache.ts) untouched. Pure normalize-layer change.

### normalize.ts modifications

**Modification A — tokenize regex (3-character change total)**:

```ts
// BEFORE
function tokenize(raw: string, sportSlug: string): string[] {
  const noise = noiseFor(sportSlug);
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITIC_RE, "")
    .replace(/[.']/g, "")            // strips dots, apostrophes
    .split(/[\s\-/&]+/)              // splits on whitespace/hyphen/slash/ampersand
    .filter((t) => t.length > 0 && !noise.has(t));
}

// AFTER
function tokenize(raw: string, sportSlug: string): string[] {
  const noise = noiseFor(sportSlug);
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITIC_RE, "")
    .replace(/[.'()]/g, "")          // ADD: strip parens too — for country code suffixes
    .split(/[\s\-/&,]+/)             // ADD: split on comma too — primary fix
    .filter((t) => t.length > 0 && !noise.has(t));
}
```

Net diff: 1 character added to strip regex (`(`+`)`→single regex char), 1 character added to split regex (`,`).

**Modification B — populate `NOISE_TOKENS_BY_SPORT.tennis`**:

```ts
// In normalize.ts, replace the existing comment-only tennis slot:
//   // tennis, baseball populated in B1.B based on captured samples

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

8 new tokens beyond `_DEFAULT_NOISE`. RESERVE map untouched (no tennis-specific reserve markers needed).

### Why no behavior changes for football/baseball/etc

- The tokenize regex change is GLOBAL (affects all sports). But the additions only matter for inputs containing `,` or `()` — football team names captured in 36 existing tests don't have these. Defensive: regression test confirms zero behavior change on existing fixtures.
- The NOISE map change is per-sport. Only `noiseFor("tennis")` returns the new tokens. Other sports continue to use `_default`. Football tokens explicitly verified unchanged.

### Match algorithm (Stage 1/2/3) — unchanged

The 3-stage matchTeams logic stays exactly as B1.A T2. After tokenize fix, the existing subset-match Stage 3 handles all the `Surname, Firstname` ↔ `Surname F.` cases naturally:

```
Bookmaker: "Sabalenka, Aryna"
  → tokenize → ["sabalenka", "aryna"]   ← comma now stripped, no trailing comma
  → key: "sabalenka aryna"
  → aDisc (len≥4): {"sabalenka", "aryna"}

FS: "Sabalenka A."
  → tokenize → ["sabalenka", "a"]
  → key: "sabalenka a"
  → bDisc (len≥4): {"sabalenka"}     ← "a" excluded by length filter

Stage 1 (reserve markers eq): both empty → pass
Stage 2 (key strict eq): "sabalenka aryna" ≠ "sabalenka a" → fail
Stage 3 (subset on disc): isSubset({sabalenka}, {sabalenka, aryna}) = TRUE → MATCH ✓
```

Multi-word surname case:
```
Bookmaker: "Pucinelli de Almeida, Matheus"
  → tokens: ["pucinelli", "de", "almeida", "matheus"]
  → aDisc (len≥4): {"pucinelli", "almeida", "matheus"}     ← "de" excluded by length

FS: "Pucinelli De Almeida M."
  → tokens: ["pucinelli", "de", "almeida", "m"]
  → bDisc (len≥4): {"pucinelli", "almeida"}

Stage 3: isSubset({pucinelli, almeida}, aDisc) = TRUE → MATCH ✓
```

Country code case:
```
Bookmaker: "Sinner J. (ITA)"
  → tokens (after paren strip): ["sinner", "j", "ita"]
  → aDisc (len≥4): {"sinner"}                              ← "j" len 1, "ita" len 3 excluded

FS: "Sinner Jannik"
  → tokens: ["sinner", "jannik"]
  → bDisc (len≥4): {"sinner", "jannik"}

Stage 3: isSubset({sinner}, {sinner, jannik}) = TRUE → MATCH ✓
```

Qualifier case:
```
Bookmaker: "Korda S. (Q1)"
  → tokens (after paren strip + tennis NOISE filter): ["korda", "s"]
                                              ← "q1" filtered by tennis NOISE
  → aDisc (len≥4): {"korda"}

FS: "Korda Sebastian"
  → tokens: ["korda", "sebastian"]
  → bDisc (len≥4): {"korda", "sebastian"}

Stage 3: isSubset({korda}, {korda, sebastian}) = TRUE → MATCH ✓
```

## Error handling

| Failure mode | Behavior |
|--------------|----------|
| Empty string after tokenize | Existing handling: `key.length === 0` → matchTeams returns false. Unchanged. |
| All tokens are short (<4) | Stage 3 falls through with empty discriminating sets → returns false. Unchanged. |
| Tennis NOISE entry collides with a real player surname | Theoretical risk only. Tokens chosen (`q1`, `ll`, `wc`, etc.) are all <=2 chars or are tournament admin language. No documented tennis player has any of these as a surname. |
| Comma in legitimate team name (e.g. football "Lokomotiv, Moscow"?) | None known. Football team names captured in 36 existing tests don't contain commas. Regression test guards against future fixtures. |

## Testing strategy

**TDD ordering**: write failing tests first using captured samples as fixtures, verify failures, then apply fix, verify passes.

### normalize.test.ts (extended, +12 tests in 1 new describe block)

Block name: `normalizeTeam — tennis (B1.B comma + paren + NOISE)`

**Comma-format positive tests** (data-driven from real samples, 6 tests):
```ts
it("Sabalenka, Aryna matches Sabalenka A.", () => {
  const a = normalizeTeam("Sabalenka, Aryna", "tennis");
  const b = normalizeTeam("Sabalenka A.", "tennis");
  expect(matchTeams(a, b)).toBe(true);
});
it("Pucinelli de Almeida, Matheus matches Pucinelli De Almeida M.", ...)
it("Diaz Acosta, Facundo matches Diaz Acosta F.", ...)
it("Struff, Jan-Lennard matches Struff J.", ...)  // tests hyphen + comma combo
it("Sinner, J. matches Sinner Jannik", ...)        // initial-first comma → full name
it("Sinner J. matches Sinner, Jannik", ...)        // reverse direction
```

**Comma-format negative tests** (2 tests):
```ts
it("Sabalenka, Aryna does NOT match Sabalenka, Iga", () => {
  // different first names → still distinct
  const a = normalizeTeam("Sabalenka, Aryna", "tennis");
  const b = normalizeTeam("Sabalenka, Iga", "tennis");
  expect(matchTeams(a, b)).toBe(false);
});
it("Sabalenka, A does NOT match Pegula, A", ...)  // same first initial, different surname
```

**Paren-strip tests** (2 tests):
```ts
it("Sinner J. (ITA) matches Sinner Jannik", ...)
it("Alcaraz C. (ESP) matches Alcaraz Carlos", ...)
```

**Tennis NOISE token tests** (2 tests):
```ts
it("Korda S. (Q1) matches Korda Sebastian (qualifier marker stripped)", ...)
it("Maric F. WC matches Maric Filip (wildcard marker stripped)", ...)
```

### Regression coverage

The 60 existing tests (5 cache + 6 sample-collector + 37 normalize incl B1.A regression + 12 search) MUST continue to pass with zero changes. The `tokenize` regex modifications are global but operate only on input characters that don't appear in football/basketball test fixtures. The regression test from B1.A T2 (tennis-falls-back-to-default) STILL passes because tennis now has its own NOISE list — the test explicitly compares tennis vs football for inputs without comma/paren, where both produce identical output.

**Total tests post-B1.B**: 60 existing + 12 new = **72 tests**.

## Deploy plan (B1.B)

1. **Local validation** (working directory `/tmp/flashscore-scraper-work/`):
   - Edit `src/normalize.ts` per Modifications A + B above
   - Edit `src/__tests__/normalize.test.ts` to add 12 new tests
2. **VPS test-run**:
   - `scp` modified files to `scraper-vps:~/flashscore-scraper/src/{normalize.ts,__tests__/normalize.test.ts}`
   - Run vitest + tsc on VPS, verify 72/72 PASS, 0 typecheck errors
3. **Mirror to artifacts**: copy from `/tmp/` to `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/scraper/src/...`
4. **Commit + push origin** (~3-4 commits: spec, plan, RUNBOOK skeleton, normalize impl)
5. **VPS deploy**: `systemctl restart flashscore-scraper.service` (no build step — service runs `tsx src/index.ts` directly)
6. **Smoke test (immediate, T+0..2 min)**:
   - `curl /stats` → counters reset (uptime ≤ 30)
   - Force a known-comma query via `/search?sport_slug=tennis&starts_at=...&home=Sabalenka,Aryna&away=...` → verify response 200 with matchId
   - `curl /stats by_sport.tennis` → at least 1 ok within first minute
7. **Wait window 30 min** (shorter than B1.A — we measure composition shift, not sample volume)
8. **Post-window validation (T+30 min)**:
   - Capture `/stats by_sport.tennis` → tennis ok rate ≥ 5% (hard target), or ≥ 3% (soft minimum)
   - Capture `/stats/samples?sport=tennis&reason=name_mismatch&limit=200` → residual samples should NO LONGER be dominated by `Surname, Firstname` (if they still are, fix didn't deploy correctly)
   - Football/basketball ok rates: must NOT drop vs T-0 baseline of B1.B deploy

## Rollback

Trigger conditions (any one):
- Tennis ok rate strictly LOWER than baseline 0.59% at T+30
- Football or basketball ok rate strictly LOWER than their T-0-B1.B baseline (regression in non-targeted sport)
- vitest fails to pass post-deploy
- /stats endpoint returns 5xx

Rollback steps (revert ONLY normalize.ts, keep all other B1.A files):
```bash
SCRAPER_PREV=docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper
scp $SCRAPER_PREV/src/normalize.ts scraper-vps:~/flashscore-scraper/src/normalize.ts
scp $SCRAPER_PREV/src/__tests__/normalize.test.ts scraper-vps:~/flashscore-scraper/src/__tests__/normalize.test.ts
ssh scraper-vps "systemctl restart flashscore-scraper.service"
```

The B1.A artifact mirror at `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1A/scraper/src/normalize.ts` is the canonical previous-good state. SampleCollector + time tolerance + endpoint stay live (they're orthogonal to normalize).

## Success criteria — B1.B

| Criterion | Threshold | Source |
|-----------|-----------|--------|
| Tests pass | 72/72 green | `vitest run` on VPS |
| Type check | 0 errors | `tsc --noEmit` on VPS |
| /stats by_sport.tennis.ok / total | **≥ 5%** at T+30 (hard target); **≥ 3%** (soft min for ship) | `/stats` |
| /stats/samples residual pattern | post-fix `Surname, Firstname` should drop from 54.7% to ≤20% of unique residual samples | `/stats/samples?sport=tennis&reason=name_mismatch&limit=200` analysis |
| Football ok rate | ≥ T-0-B1.B baseline | `/stats by_sport.football` |
| Basketball ok rate | ≥ T-0-B1.B baseline | idem |
| Memory delta | ≤ +5MB | `ps -o rss=` |
| 0 sample-collector warnings | 0 | journalctl |

If hard target met → ship + proceed to B2 brainstorm.
If soft minimum but not hard target → ship + register residual analysis as next-iter B1.C ticket.
If soft min not met → rollback + investigate.

## Open questions

None at this writing. The fix is data-grounded (94 unique samples confirm comma bug), the algorithm change is minimal (3-character regex update), the defensive additions (parens, tennis NOISE) are domain-justified and risk-bounded.

## File inventory summary

| File | Action | LoC delta |
|------|--------|-----------|
| `flashscore-scraper/src/normalize.ts` | modify | +12 (tokenize regex + tennis NOISE Set) |
| `flashscore-scraper/src/__tests__/normalize.test.ts` | extend | +60 (1 describe, 12 tests) |
| `docs/superpowers/specs/2026-05-06-tennis-fixes-B1B-design.md` | NEW (this file) | — |
| `docs/superpowers/plans/2026-05-06-tennis-fixes-B1B.md` | NEW (next step) | — |
| `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/RUNBOOK.md` | NEW (during impl) | — |
| `docs/superpowers/artifacts/2026-05-06-tennis-fixes-B1B/scraper/src/normalize.ts` | mirror | — |

Total scraper LoC change: **~72** (12 prod + 60 test).

Estimated impl time: ~1.5-2h from plan-write through ship.
