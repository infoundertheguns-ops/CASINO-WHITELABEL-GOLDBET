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

[populated by T2]

## Deploy log

[populated by T3]

## Post-window validation (T+30 min)

[populated by T4]
