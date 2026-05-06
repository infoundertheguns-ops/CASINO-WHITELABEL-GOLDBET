# Tennis fixes B1.B — Deployment Runbook

Implementation plan: `docs/superpowers/plans/2026-05-06-tennis-fixes-B1B.md`
Spec: `docs/superpowers/specs/2026-05-06-tennis-fixes-B1B-design.md`
Branch: `feature/plan-d-settlement-d1`

## T-0 Baseline (authoritative — captured immediately pre-deploy)

Source: `baseline-stats-T0.json` (this directory).

```text
uptime_sec: 4802 (~80 min since v2 deploy yesterday + B1.A redeploy)
search_requests_total: 6182

| Sport      | ok / total      | ok rate | time_share | name_share |
|------------|-----------------|--------:|-----------:|-----------:|
| tennis     |     15 /  2523  |  0.59%  | 34.76%     | 64.65%     |
| football   |     32 /  1382  |  2.32%  | 16.06%     | 79.31%     |
| basketball |      4 /   368  |  1.09%  | 27.72%     | 70.11%     |
| baseball   |      1 /   509  |  0.20%  |  6.48%     | 93.32%     |
```

**Tennis ok rate target post-B1.B**: hard ≥5%, soft ≥3% at T+30. (Spec arithmetic: 0.59% × ~10× recovery factor = ~5.9% theoretical upper bound; 5% hard = 85% of that, 3% soft = 50%.)

**Football/basketball regression guard**: ok rates must not drop. Football=2.32%, basketball=1.09% are floors.

**Baseball context**: baseball ok rate is structurally low (0.20%) due to FS coverage gaps for minor league/college baseball. Not a B1.B target — left as-is.

## Pre-deploy validation (local)

- vitest run: 75/75 PASS (5 cache + 6 sample-collector + 52 normalize + 12 search)
- tsc --noEmit: 0 errors
- Diff vs B1.A normalize.ts:
  - tokenize strip regex: `[.']` → `[.'()]` (parens added — 2 chars)
  - tokenize split regex: `[\s\-/&]+` → `[\s\-/&,]+` (comma added — 1 char)
  - NOISE_TOKENS_BY_SPORT.tennis populated with _DEFAULT_NOISE + 10 tokens: `b`, `c` (single-letter initials that collide with _DEFAULT_RESERVE "B/C team" markers — tennis has no team reserves; silencing via NOISE prevents false Stage-1 hard-fail) + 8 tournament admin markers (q1/q2/q3/ll/wc/pr/alt/qualifier)
  - All other functions/exports unchanged
- Pre-fix state from T1: 11 fail / 64 pass; post-fix: 75/75 pass (all 11 previously-failing tests now green)
- Notable implementation finding: `"c"` in `_DEFAULT_RESERVE` (3rd-team marker) collides with the initial `"C"` in player names like `"Alcaraz C. (ESP)"`. Fix: add `"b"` and `"c"` to `_TENNIS_NOISE` (NOISE filter runs before reserve detection, so they never land in reserveMarkers for tennis). Sinner J. (ITA) worked without this fix only because `"j"` is NOT in `_DEFAULT_RESERVE`; Alcaraz C. (ESP) exposed the gap.

## Deploy log

[populated by T3]

## Post-window validation (T+30 min)

[populated by T4]
