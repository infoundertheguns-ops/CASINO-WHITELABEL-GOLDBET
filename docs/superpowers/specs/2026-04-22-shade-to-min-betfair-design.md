# Shade-to-Min: Betfair Third Source + Read-Time Odds Consensus

**Status**: Design draft — pending spec-reviewer + user approval
**Date**: 2026-04-22
**Author**: Session brainstorming with operator
**Supersedes**: Auto-suspend cron introduced in mig 088e (`auto_suspend_consensus_outliers`)

---

## 1. Problem Statement

### Current behavior (to be replaced)
A cron job (`auto_suspend_consensus_outliers`) runs every 5 minutes on scraper-vps. It inspects `consensus_snapshots` for outcome-level deltas ≥50% between Kambi and 22bet on core markets (1X2, U/O, GG/NG, DC, Handicap). For each outlier found, it sets `outcomes.manual_suspended = true` for 30 minutes, effectively blocking the outcome from being bettable on the kiosk player.

### Why replace it
1. **Lost ticket volume**. Suspension is binary: the outcome is either fully bettable or fully blocked. Suspending on |delta|≥50% means even the "safe" lower quota becomes unbettable, rejecting tickets that would have been profitable for the book.
2. **Stateful complexity**. Suspend writes a flag, requires an expiry cleanup cron, races with operator manual actions, and must be re-evaluated every cycle. A drained 19.732-row backlog at first run signals scale problems.
3. **Wrong asymmetry**. Analysis of 24h consensus data (prod, ≥50% delta) showed 257k outlier rows split ~50/50 between "Kambi higher" and "22bet higher". At mid-range divergence (5-10× ratio), 22bet accounts for 72.6% of outliers. Auto-suspend treats both sources as equally suspect, which is mathematically unnecessary when a conservative floor is available.
4. **Two-source consensus is weak**. Without a tiebreaker, when Kambi and 22bet disagree we cannot identify which is correct. Adding a third source changes this fundamentally.

### Goal
Replace stateful suspension with a **read-time shade-to-min** computation across three sources (Kambi + 22bet + Betfair Exchange). The player always sees the lowest available quota across all bettable sources when they diverge meaningfully (>25%). This:
- Preserves ticket flow (outcome always bettable unless truly unavailable on all sources)
- Protects bookmaker P&L (we always pay the floor)
- Is self-correcting (no cleanup — just recomputes on next read)
- Exploits the third source as a natural tiebreaker

---

## 2. Scope

### In scope
- New scraper `betfair-scraper` on scraper-vps using Betfair public-API endpoints (no account, no login) via Webshare Austrian residential proxies
- Market + outcome normalization rules for Betfair (extends existing 5-stage engine from `lib/normalize/`)
- Migration 089: extend `consensus_snapshots` with Betfair columns; create view `v_outcomes_displayed` + function `fn_compute_displayed_odds`
- Frontend change in `betssolution-player`: read `displayed_odds` instead of raw `odds`
- Feature flag `SHADE_ENABLED` for safe rollout
- Decommission auto-suspend cron (keep RPC in DB as rollback)
- Basic monitoring page `/admin/shade-monitor` (post-rollout)

### Out of scope (explicit)
- Full outcome canonicalization (currently ~35% coverage). MVP shade works only on operator-verified canonical mappings (~95% core markets). Player props and exotic markets keep primary-source display with no shade.
- Betfair admin UI (scraper output is a backend signal only)
- Live video/audio Betfair feed
- Lay-side odds (only `back_price_1` used)
- Alternative third sources (Pinnacle, oddsportal, The Odds API) — documented as fallback options but not implemented

---

## 3. Architecture

### 3.1 New service: `betfair-scraper`

Standalone systemd service on scraper-vps, mirroring `kambi-scraper` / `twobet-scraper` conventions:

```
/root/betfair-scraper/
├── src/
│   ├── betfair-api.ts          # vendored from betfair-exchange/scraper/
│   ├── live-loop.ts            # 30s: inPlayOnly=true per sport
│   ├── prematch-loop.ts        # 5min: inPlayOnly=false per sport
│   ├── sport-discovery.ts      # fetchNavigation, cache sport list
│   ├── push-to-vincitu.ts      # upsert events/markets/outcomes source='betfair'
│   └── index.ts                # orchestrator
├── config.json                 # proxy list (Austrian), sport whitelist
└── .env                        # Supabase service_role + Webshare creds
```

**Code origin (`betfair-api.ts`)**: vendored (copy) from `C:/Users/philp/Downloads/betfair-exchange/scraper/betfair-api.ts`. The source repo is kept as-is for reference; the new `betfair-scraper` repo is a fresh standalone project (same pattern as `kambi-scraper` / `twobet-scraper`). No git fork, just file copy, because the source repo also contains a Next.js frontend that is irrelevant to this service. The vendored file may need light adaptation for our proxy config format and `.env` pattern.

**Canonicalization scope**: the scraper does NOT embed market/outcome normalization logic. Raw `market_type` and `name` strings are upserted as-is into `markets`/`outcomes`. Canonicalization is fully delegated to the existing normalization infrastructure (`market_normalization` + `outcome_normalization` tables, fed by the `lib/normalize/` engine that already drains via cron). The only Betfair-specific addition is regex rules added to `lib/normalize/rules/betfair.ts` (Phase 2) and dict entries in the outcome seed (mig 089 addendum or mig 090). The 5-stage engine (regex + alias_dict + trigram + propagation + LLM) applies to Betfair mappings just as it does to Kambi/22bet — Betfair doesn't get a special simpler path.

Service unit: `/etc/systemd/system/betfair-scraper.service` (Type=simple, Restart=on-failure, ExecStart=`npx tsx src/index.ts`).

### 3.2 Proxy infrastructure

Webshare Static Residential pool, 20-30 IPs allocated to Austria via dashboard UI (the API is read-only on country selection). Proxy URLs go in `.env` → read by `config.ts` → consumed by `getProxies()` in `betfair-api.ts`.

Fallback chain if Austrian IPs all rate-limited:
1. UK pool (Betfair primary geo)
2. DE pool
3. Log warn + Betfair becomes 2-source for that cycle

### 3.3 Database changes (migration 089)

**Important schema note** — canonicalization in this project does not live as columns on `outcomes`/`markets`. It lives in separate mapping tables:
- `market_normalization` maps `(source, raw_market_type) → canonical_key` with a `verified boolean` per mapping row
- `outcome_normalization` (mig 065) maps `(source, canonical_key, raw_outcome_name) → canonical_outcome_key` with a `verified boolean` per mapping row

The view must therefore resolve canonicalization at read-time via joins to those two tables. We do NOT propose adding denormalized columns on `outcomes`/`markets` (would add write amplification + trigger cascades for scraper hot path).

```sql
-- 1) Extend consensus_snapshots for 3-source awareness (columns nullable for backward compat)
ALTER TABLE consensus_snapshots
  ADD COLUMN IF NOT EXISTS betfair_event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS betfair_odds numeric;

-- 2) Pure-input compute function (IMMUTABLE for planner optimization)
-- INVARIANT: this function must remain pure in its inputs. Any future change that
-- reads from current_timestamp, session vars, or other tables MUST change the
-- volatility marker to STABLE or VOLATILE to avoid planner cache bugs.
CREATE OR REPLACE FUNCTION fn_compute_displayed_odds(
  p_kambi_odds numeric, p_kambi_active boolean, p_kambi_suspended boolean,
  p_twobet_odds numeric, p_twobet_active boolean, p_twobet_suspended boolean,
  p_betfair_odds numeric, p_betfair_active boolean, p_betfair_suspended boolean,
  p_manual_odds numeric,
  p_canonical_verified boolean  -- see section 5 for precise definition
) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_available numeric[];
  v_min numeric; v_max numeric;
  v_spread numeric;
  v_primary numeric;
BEGIN
  IF p_manual_odds IS NOT NULL THEN RETURN p_manual_odds; END IF;

  v_available := ARRAY[]::numeric[];
  IF p_kambi_odds IS NOT NULL AND p_kambi_active AND NOT p_kambi_suspended THEN
    v_available := array_append(v_available, p_kambi_odds);
  END IF;
  IF p_twobet_odds IS NOT NULL AND p_twobet_active AND NOT p_twobet_suspended THEN
    v_available := array_append(v_available, p_twobet_odds);
  END IF;
  IF p_betfair_odds IS NOT NULL AND p_betfair_active AND NOT p_betfair_suspended THEN
    v_available := array_append(v_available, p_betfair_odds);
  END IF;

  IF array_length(v_available, 1) IS NULL THEN RETURN NULL; END IF;

  v_primary := COALESCE(
    CASE WHEN p_kambi_active AND NOT p_kambi_suspended THEN p_kambi_odds END,
    CASE WHEN p_twobet_active AND NOT p_twobet_suspended THEN p_twobet_odds END,
    CASE WHEN p_betfair_active AND NOT p_betfair_suspended THEN p_betfair_odds END
  );

  IF NOT p_canonical_verified THEN RETURN v_primary; END IF;

  IF array_length(v_available, 1) = 1 THEN
    IF v_available[1] > 3.0 THEN
      RETURN ROUND(v_available[1] * 0.90, 2);
    ELSE
      RETURN v_available[1];
    END IF;
  END IF;

  SELECT MIN(x), MAX(x) INTO v_min, v_max FROM unnest(v_available) x;
  v_spread := (v_max / v_min) - 1;
  IF v_spread > 0.25 THEN
    RETURN v_min;
  ELSE
    RETURN v_primary;
  END IF;
END $$;

-- 3) Resolution helper: per-outcome canonical resolution joining normalization tables
-- Returns rows with one row per (flashscore_id, canonical_key, canonical_outcome_key)
-- triple, with per-source odds collapsed via FILTER aggregates.
CREATE OR REPLACE VIEW v_outcomes_canonical AS
SELECT
  e.flashscore_id,
  e.sport_id,
  mn.canonical_key    AS market_canonical_key,
  mn.verified         AS market_canon_verified,
  onz.canonical_outcome_key,
  onz.verified        AS outcome_canon_verified,
  e.source,
  o.id                AS outcome_id,
  o.odds,
  o.is_active,
  o.is_suspended,
  o.manual_odds,
  o.manual_suspended,
  m.id                AS market_id
FROM outcomes o
  JOIN markets  m   ON m.id = o.market_id
  JOIN events   e   ON e.id = m.event_id
  LEFT JOIN market_normalization mn
    ON mn.source = e.source
   AND mn.raw_market_type = m.market_type
  LEFT JOIN outcome_normalization onz
    ON onz.source = e.source
   AND onz.canonical_key = mn.canonical_key
   AND onz.raw_outcome_name = o.name
WHERE e.flashscore_id IS NOT NULL;

-- 4) Display view: pivots per-source rows into one row per canonical outcome,
-- then computes displayed_odds via fn_compute_displayed_odds.
CREATE OR REPLACE VIEW v_outcomes_displayed AS
WITH pivoted AS (
  SELECT
    flashscore_id,
    sport_id,
    market_canonical_key,
    canonical_outcome_key,
    -- Per-source odds
    MAX(odds) FILTER (WHERE source='kambi')   AS kambi_odds,
    BOOL_OR(is_active) FILTER (WHERE source='kambi')    AS kambi_active,
    BOOL_OR(is_suspended) FILTER (WHERE source='kambi') AS kambi_suspended,
    MAX(odds) FILTER (WHERE source='22bet')   AS twobet_odds,
    BOOL_OR(is_active) FILTER (WHERE source='22bet')    AS twobet_active,
    BOOL_OR(is_suspended) FILTER (WHERE source='22bet') AS twobet_suspended,
    MAX(odds) FILTER (WHERE source='betfair') AS betfair_odds,
    BOOL_OR(is_active) FILTER (WHERE source='betfair')    AS betfair_active,
    BOOL_OR(is_suspended) FILTER (WHERE source='betfair') AS betfair_suspended,
    -- Manual override: any source's manual takes precedence (operator acts on one,
    -- shade applies to the canonical group). Take first non-null.
    MAX(manual_odds)      AS manual_odds,
    BOOL_OR(manual_suspended) AS manual_suspended,
    -- Trust boundary: all contributing (market + outcome) canonicalizations must be verified
    -- See section 5 for formal definition.
    BOOL_AND(COALESCE(market_canon_verified,  false))
      AND BOOL_AND(COALESCE(outcome_canon_verified, false)) AS canonical_verified,
    -- Return one primary outcome_id per canonical group (for FK joins by frontend)
    (ARRAY_AGG(outcome_id ORDER BY
       CASE source WHEN 'kambi' THEN 1 WHEN '22bet' THEN 2 WHEN 'betfair' THEN 3 ELSE 9 END
    ))[1] AS primary_outcome_id
  FROM v_outcomes_canonical
  WHERE market_canonical_key IS NOT NULL
    AND canonical_outcome_key IS NOT NULL
  GROUP BY flashscore_id, sport_id, market_canonical_key, canonical_outcome_key
)
SELECT
  *,
  fn_compute_displayed_odds(
    kambi_odds, kambi_active, kambi_suspended,
    twobet_odds, twobet_active, twobet_suspended,
    betfair_odds, betfair_active, betfair_suspended,
    manual_odds,
    canonical_verified
  ) AS displayed_odds
FROM pivoted;

-- 5) Runtime feature flag in system_config (NOT a Next.js env var — those are
-- build-time inlined and cannot be toggled without rebuild+deploy).
-- Frontend reads this via server component / API route on each page request.
INSERT INTO system_config (key, value, description)
VALUES ('shade_enabled', 'false'::jsonb,
        'Enable shade-to-min on player frontend. When false, player reads outcomes.odds (primary source). When true, player reads v_outcomes_displayed.displayed_odds.')
ON CONFLICT (key) DO NOTHING;

-- 6) Supporting indexes
CREATE INDEX IF NOT EXISTS idx_market_normalization_lookup
  ON market_normalization(source, raw_market_type);
CREATE INDEX IF NOT EXISTS idx_outcome_normalization_lookup
  ON outcome_normalization(source, canonical_key, raw_outcome_name);
CREATE INDEX IF NOT EXISTS idx_events_flashscore_source
  ON events(flashscore_id, source) WHERE flashscore_id IS NOT NULL;
```

**Note on exact normalization table column names**: `market_normalization` and `outcome_normalization` column names (especially `raw_market_type` vs `source_market_type`, etc.) must be verified against the actual schemas of migrations 042-085 at implementation time; the join semantics are canonical but the exact column names may require small adjustments when writing the migration.

### 3.4 Frontend changes (`betssolution-player`)

- `lib/hooks/use-event.ts` (or equivalent) switches from reading `outcomes.odds` to reading from `v_outcomes_displayed` joined by `flashscore_id` + `market_canonical_key` + `canonical_outcome_key`
- Feature flag read at runtime from `system_config.shade_enabled` (NOT a Next.js env var — those are build-time inlined and cannot be flipped without rebuild+deploy):
  - Server component or API route reads `system_config` on each request
  - Value cached for 30s client-side to avoid query storm, refreshed on visibility change
  - Flag flip via admin UI or direct SQL UPDATE → propagates to all kiosks within 30s without deploy
- Rendering logic:
  - `displayedOdds = shade_enabled ? row.displayed_odds : row.primary_odds` (where `primary_odds` is the pre-pivoted Kambi odds from the same hook, preserving pre-rollout behavior when flag is off)
  - `isBettable = (displayedOdds IS NOT NULL) AND (NOT row.manual_suspended)`
- No UI changes beyond the value shown on the button
- **Realtime compatibility**: `v_outcomes_displayed` is a view and Supabase Realtime doesn't subscribe to views directly. Frontend continues to subscribe to `outcomes` table changes (as today), and re-queries the view on change events. The view is lightweight enough for this pattern given the indexes in migration 089.

---

## 4. Data Flow

### 4.1 Ingest (Betfair → Supabase)

The scraper pushes raw data only. Canonicalization (market/outcome normalization + event bridging to `flashscore_id`) happens **asynchronously** via the existing normalization cron jobs, which already drain pending rows every 10-15 minutes. This matches the existing Kambi/22bet pattern and avoids making the scraper dependent on synchronous RPC calls to a resolution engine that runs on a different schedule.

```
Betfair public API
  (GET /www/sports/exchange/readonly/v1/bymarket with _ak key)
       │
       ▼
Response parser (parseExchangeData — vendored from betfair-exchange/scraper/)
       │
       ▼
Sport map: Betfair event_type_id → our sport_id (static table, see Appendix A)
       │
       ▼
Upsert events with flashscore_id=NULL
  (Existing event_normalization cron picks them up on next tick,
   runs the 5-stage pipeline, sets flashscore_id where match found.
   Unmatched events stay flashscore_id=NULL and are excluded from
   consensus until the negative-cache expires or new evidence arrives.)
       │
       ▼
Upsert markets with raw market_type as-is
  (Existing market_normalization cron picks up new rows, applies regex
   rules in lib/normalize/rules/betfair.ts to write a row in
   market_normalization table mapping source='betfair' + raw_market_type
   to a canonical_key. Phase 2 of rollout adds ~25 Betfair rules.)
       │
       ▼
Upsert outcomes with raw name as-is, odds = runner.back_price_1
  (Existing outcome_normalization cron picks up new rows, resolves
   canonical_outcome_key via dict lookups — dict extended with ~50
   Betfair entries in Phase 2.)
       │
       ▼
All Supabase writes complete. Canonicalization resolves asynchronously.
```

**Event mapping robustness**: even if the `event_normalization` cron is delayed or fails for a specific event, the Betfair data is still stored — it just doesn't participate in consensus until resolved. This is the same contract Kambi and 22bet have today. No synchronous dependency; no new RPC needed.

**Phase 2 normalization rule examples** (to be added to `lib/normalize/rules/betfair.ts`, ~25 total):

| Betfair raw `market_type` | Canonical key |
|---|---|
| `MATCH_ODDS` | `1x2_h_ft` |
| `OVER_UNDER_25` | `u_o_ft_2.5` |
| `OVER_UNDER_05`, `OVER_UNDER_15`, `OVER_UNDER_35`, `OVER_UNDER_45` | `u_o_ft_<line>` (regex parametric) |
| `BOTH_TEAMS_TO_SCORE` | `gg_ng_ft` |
| `DOUBLE_CHANCE` | `dc_ft` |
| `CORRECT_SCORE` | `correct_score_ft` |
| `HALF_TIME` | `1x2_h_ht` |
| `HALF_TIME_FULL_TIME` | `htft_ft` |
| `ASIAN_HANDICAP` (+runner handicap) | `asian_handicap_ft_<line>` |
| `HANDICAP` (+runner handicap) | `handicap_ft_<line>` |

**Verification policy for Betfair mappings**: per post-Wave-34 auto-verify pattern, a normalization row gets `verified=true` automatically when the regex rule's confidence score is ≥90, OR when an operator manually confirms via `/admin/market-normalization` or `/admin/outcome-normalization`. No per-Betfair-rule operator review required if confidence is high — rules with confidence <90 surface in the UI for manual verification.

### 4.2 Three-source join key

| Source  | `external_id`       | canonical via           |
|---------|---------------------|-------------------------|
| Kambi   | `kambi:{eventId}`   | `events.flashscore_id`  |
| 22bet   | `twobet:{eventId}`  | `events.flashscore_id`  |
| Betfair | `betfair:{eventId}` | `events.flashscore_id`  |

Three rows in `events` for the same match, one per source, sharing `flashscore_id`. Same pattern applies to markets (`canonical_key`) and outcomes (`canonical_outcome_key`).

### 4.3 Read path (player)

```
Player frontend requests outcomes for event {flashscore_id='abc123'}
       │
       ▼
Query v_outcomes_displayed WHERE flashscore_id='abc123'
       │
       ▼
For each row:
  displayed_odds = fn_compute_displayed_odds(...)
  - Manual override → returns manual_odds
  - ≥2 sources + spread>25% → returns min
  - ≥2 sources + spread≤25% → returns primary (kambi→twobet→betfair chain)
  - 1 source + quota>3.0 → returns source × 0.90
  - 1 source + quota≤3.0 → returns source intact
  - 0 sources → returns NULL (outcome unavailable)
       │
       ▼
Render button with displayed_odds
Manual_suspended disables button regardless of quota
```

---

## 5. Shade-to-Min Algorithm (core)

See `fn_compute_displayed_odds` SQL in section 3.3 for the authoritative implementation. Decision table:

| Kambi | 22bet | Betfair | Manual | Verified | Spread | `displayed_odds` | Rationale |
|-------|-------|---------|--------|----------|--------|---------------------|-----------|
| 2.10  | 2.15  | 2.12    | —      | ✓        | 2.4%   | 2.10                | Aligned, primary (kambi) shown |
| 2.10  | 5.80  | —       | —      | ✓        | 176%   | 2.10                | Shade to min (2-source) |
| 2.10  | 5.80  | 2.08    | —      | ✓        | 179%   | 2.08                | Shade to global min (3-source) |
| 2.10  | —     | —       | —      | ✓        | n/a    | 2.10                | Single-source, quota ≤3.0, intact |
| 5.80  | —     | —       | —      | ✓        | n/a    | 5.22                | Single-source, quota >3.0, markup ×0.90 |
| 2.10  | 5.80  | —       | —      | ✗        | —      | 2.10                | Unverified canon → show primary intact |
| 2.10  | 5.80  | 2.08    | 1.95   | ✓        | —      | 1.95                | Manual override wins over everything |
| —     | —     | —       | —      | any      | —      | NULL                | Truly unavailable |

### Why read-time, not state-mutation
Computing `displayed_odds` at read-time (on every query via the view) instead of materializing it as a column avoids the write amplification of the current cron approach (which mutates `manual_suspended` on thousands of rows every 5 minutes). When a source converges back within tolerance, the shade disappears on the next read with zero cleanup.

### `canonical_verified` — precise definition

Per canonical outcome group `(flashscore_id, market_canonical_key, canonical_outcome_key)`:

```
canonical_verified = TRUE iff
  for every source S that contributes to this group's available_odds set:
      market_normalization.verified = TRUE  for (S, raw_market_type → canonical_key)
  AND outcome_normalization.verified = TRUE  for (S, canonical_key, raw_outcome_name → canonical_outcome_key)
```

In the view pivot (section 3.3 step 4), this is computed as:
```sql
BOOL_AND(COALESCE(market_canon_verified, false))
  AND BOOL_AND(COALESCE(outcome_canon_verified, false)) AS canonical_verified
```

Implication: if even one of the (market + outcome) canonicalizations across the sources in the group is unverified, the whole group is treated as unverified → shade does NOT fire → primary source is shown intact.

**How a mapping gets verified:**
- **Auto**: normalization engine rule scores the mapping with confidence ≥90 (post-Wave-34 pattern) → cron sets `verified=true`
- **Manual**: operator confirms via `/admin/market-normalization` or `/admin/outcome-normalization` UI

**How a mapping gets un-verified:**
- Operator dismisses via `/admin/consensus` action buttons (existing — migration 088d resolver) → writes `normalization_issues` row with `dismiss_type='mismatch_normalization'` → trigger sets `verified=false` on the offending mapping row
- Admin manual edit in normalization UI

### Why this gate matters
It is the safety rail against mass-mismap incidents. Without it, a bad rule that (e.g.) maps "Over 3.5" as "Over 2.5" across 5000 markets would cause a shade-to-lowest storm paying out loss across the book. With it, shade only fires on confidence-scored or operator-confirmed canonicalizations (~95% of core markets today). Mapping verification is the shade's trust boundary — the blast radius of any single bad rule is contained to "we don't shade that outcome" rather than "we pay out wrong quota across the book."

---

## 6. Rollout Plan

### Phase 1 — Shadow ingest (24-48h)
- Deploy `betfair-scraper` systemd service on scraper-vps
- Webshare Austrian IPs allocated (20-30)
- Scraper writes `events/markets/outcomes` with `source='betfair'`
- **Nobody reads Betfair yet** — zero user-visible impact
- Success criteria:
  - Live cycle <60s, prematch cycle <300s
  - No cronic 403/429 (<1% error rate)
  - Events canonicalized to flashscore_id: >50% of scraped events (target 70%+ calcio, lower acceptable for exotic sports)

### Phase 2 — Normalization rule extension
- Add Betfair market_type regex rules to `lib/normalize/rules/betfair.ts` (~25 rules)
- Extend outcome_normalization dict with ~50 Betfair runner names
- Normalization engine cron picks them up automatically
- **Verification path**: rules with confidence ≥90 auto-verify via the post-Wave-34 cron pattern; rules with lower confidence surface in `/admin/market-normalization` for operator review. This means reaching 85% verified in Phase 2 does NOT require batch operator review — well-designed regex rules hit ≥90 confidence automatically for clean Betfair strings (they are UPPERCASE English constants, not localized free text)
- Success criteria: >85% of core markets (1X2, U/O, GG/NG, DC, Handicap) mapped with `verified=true` for Betfair events within 48h of Phase 2 deploy
- No UI changes

### Phase 3 — View deploy + frontend with flag OFF
- Migration 089: `consensus_snapshots` extension + `fn_compute_displayed_odds` + `v_outcomes_canonical` + `v_outcomes_displayed` + `system_config.shade_enabled = false`
- `betssolution-player` frontend updated to read `v_outcomes_displayed.displayed_odds` when `system_config.shade_enabled = true`, otherwise fall back to primary-source `outcomes.odds` (identical to pre-rollout)
- Deploy to prod player
- Success criteria: zero regressions, kiosk operation identical for 24h observation

### Phase 4 — Activate shade + decommission auto-suspend
- Activate shade on **staging first**: `UPDATE system_config SET value='true'::jsonb WHERE key='shade_enabled'` on staging DB
- Test internally for 24h
- Activate on **prod** via same SQL UPDATE → propagates to all kiosks within the 30s cache window, no rebuild required
- Comment crontab entry for `auto_suspend_consensus_outliers` (keep RPC in DB for rollback)
- Monitor `/admin/manual-overrides`: auto-suspend entries should stop growing; manual entries stay active
- Success criteria:
  - Kiosk ticket volume stable or up (shade preserves bet flow vs suspend)
  - No "unfair quota" complaints from operators
  - P&L directionally improved on outcomes that previously triggered auto-suspend

### Rollback strategy
- Phase 3 to baseline: no rollback needed, flag is already OFF
- Phase 4 rollback: `UPDATE system_config SET value='false'::jsonb WHERE key='shade_enabled'` → 30-second propagation; optionally uncomment crontab to re-enable auto-suspend
- DB objects (view, function, columns) are additive and safe to leave in place even on full rollback
- Since the flag flip is a DB write (not a code deploy), rollback SLA is bound by the 30s client cache window + database commit latency — typically under 60 seconds end-to-end

---

## 7. Error Handling

| Scenario | Response |
|---|---|
| Betfair endpoint returns 403/429 | Rotate to next proxy IP, exponential backoff (1s/5s/30s), mark sport as cooling if persistent |
| All Austrian proxies exhausted | Fallback proxy pools UK/DE; log WARN; Betfair becomes 2-source for that cycle |
| Betfair event has no team split in `eventName` | Save with `home=NULL, away=NULL`; event_normalization skips; remains single-source |
| event_normalization fails to map event | Event saved with `flashscore_id=NULL`; excluded from consensus view rows; retry on next normalization engine tick |
| Market type unknown to normalizer | Saved with `canonical_key=NULL`; excluded from shade (only 1 source effectively); flag for manual normalization review |
| View query times out | `statement_timeout=3s` at query level + indexes on `events.flashscore_id`, `market_normalization(source, raw_market_type)`, `outcome_normalization(source, canonical_key, raw_outcome_name)` (defined in mig 089 step 6) |
| Mismapped canonicalization detected post-fact | Operator dismisses via `/admin/consensus` UI → `normalization_issues` row + `verified=false` → shade stops firing on that canon key until re-verified |
| Betfair scraper crashes | systemd `Restart=on-failure`, `RestartSec=5s`; alerts via log monitor |
| Player frontend can't reach `v_outcomes_displayed` (DB error) | Fallback to direct `outcomes` table read (primary source), degraded mode equivalent to `SHADE_ENABLED=false` |

---

## 8. Testing Strategy

### Unit tests (vitest)
- `fn_compute_displayed_odds`: 20+ scenarios covering all 7 rows of the decision table + edge cases (null, 0, negative, extreme spreads, single NaN source)
- Betfair market normalization rules: 25 regex rules with fixtures per rule (happy + edge cases)
- Outcome normalization Betfair dict entries: round-trip mapping tests

### Integration tests
- Mock Betfair API response → parse → upsert → verify row shape in Supabase (dev instance)
- 3-source join: insert 1 event + 3 outcomes (one per source, all same canonical keys) → query `v_outcomes_displayed` → assert expected `displayed_odds`
- Rollback: flip `SHADE_ENABLED` on/off → same event query → verify fallback to primary

### Smoke test in prod (post-Phase 1)
- For N=100 sampled calcio major events where all 3 sources have a `verified=true` canonical outcome:
  - Compute spread distribution
  - Alert if >5% of outcomes have spread >100% (probable mass mismap to investigate)
- For N=50 tennis / basket / hockey: same check with lower thresholds (sports are more volatile)

### Post-rollout monitoring
New admin page `/admin/shade-monitor` (Phase 4+1 day):
- Rolling 24h: % outcomes shaded vs intact (histogram by sport)
- Spread distribution pre-shade (detect new mismap patterns)
- Top 20 canonical markets where shade fires most frequently (investigate for systematic issues)
- Revenue impact: avg ticket win rate on shaded vs non-shaded outcomes (A/B proxy)

---

## 9. Open Questions / Known Gaps

1. **Outcome canonicalization coverage (~35% today)** — MVP shade fires only on verified core markets. Extending to player props / exotic markets is a separate multi-session project (Phase 3 Part 2 in existing roadmap).
2. **Betfair event-to-flashscore bridge reliability** — event_normalization engine must handle Betfair's English team names (vs Kambi/22bet Italian). Trigram stage should handle this but needs empirical validation in Phase 1.
3. **Betfair market exotic coverage** — Phase 1 data will show which Betfair market types appear frequently but lack normalization rules. Phase 2 expands the ruleset iteratively based on actual traffic.
4. **Webshare Austrian IP availability** — needs dashboard confirmation. If AT pool is insufficient, fallback to UK/DE changes geo-routing (Betfair.com routes vary by IP geo).
5. **Liquidity is ignored (C3)** — a Betfair market with €50 matched can produce a 10x-anomalous quota that then drags `min` down. User explicitly chose to accept this risk. Future refinement could add weighted consensus, but not in MVP.

---

## 10. Success Metrics (90 days post-rollout)

- `manual_overrides` auto-suspend count → 0 (cron decommissioned)
- `manual_overrides` operator-initiated count → steady or declining (vs baseline pre-rollout)
- % outcomes shaded (active) → 3-8% range during normal operation; spikes indicate source glitch worth investigating
- Ticket submission rate → stable or up (suspend removed friction)
- P&L on shaded-path outcomes → net positive (no payouts at anomalous-high quota)
- Incident count "operator manually suspended wrong outcome" → reduced (less operator burden)

---

## Appendix A — Sport ID mapping (Betfair → ours)

Resolved from the `sports` table in prod (2026-04-22). Unknown Betfair sport IDs default to NULL → event is saved with `sport_id=NULL` → excluded from consensus for that cycle; normalization tooling flags for manual mapping expansion.

| Betfair `eventTypeId` | Betfair name | Our `sports.slug` | `sports.id` (uuid) |
|---|---|---|---|
| 1 | Soccer | `calcio` | `495cc9f2-d414-4ed7-9f33-a20db8ec3122` |
| 2 | Tennis | `tennis` | `23bbb7b6-5fff-45ec-bb85-6020661c3ab3` |
| 3 | Golf | `golf` | `397d3e5a-c939-4fb0-ae4a-b559f5c9c4c1` |
| 4 | Cricket | `cricket` | `28da75b0-8835-4892-acfd-a56f824f79f7` |
| 5 | Rugby Union | `rugby-union` | `52cec107-2902-44cf-b0cf-b050c4d19487` |
| 7 | Horse Racing | *(handled by `ippica-scraper`, skip in Betfair scraper to avoid duplication)* | — |
| 7522 | Basketball | `basket` | `6220caec-789d-4dd5-b179-acaa887dd3fe` |
| 7524 | Ice Hockey | `hockey-ghiaccio` | `af3a27e5-71fe-46eb-a855-4e94d556156e` |
| 1477968 | Rugby League | `rugby-league` | `dc613fce-1bf5-43c2-aedb-312571d53506` |
| 7511 | Baseball | `baseball` | `16667314-d8d0-4a3e-aa9f-a155f6df13de` |
| 6423 | American Football | `football-americano` | `63265903-76c3-4d3b-acf6-efcdf6699ad4` |
| 26420387 | MMA | `mma` | `f95b9083-a57a-4157-9a4a-a418eb836cec` |
| 998919 | Volleyball | `pallavolo` | `9c3f3ed2-8453-4468-bba2-f8013ef529ef` |
| 468328 | Handball | `pallamano` | `161815ec-30ab-4333-9780-d4176303d588` |
| 6422 | Snooker | `snooker` | `cd11415b-f96a-4aef-bb6e-1e6858c149e3` |
| 3503 | Darts | `freccette` | `f1277c9f-230e-4441-88c7-be09002e4c57` |
| 2540321 | Table Tennis | `tennis-tavolo` | `cecc0692-9175-4003-9d5c-081b3f67e95d` |

Additional Betfair sport types (boxing, motor sport, cycling, esports) can be added iteratively; the scraper whitelists by `eventTypeId` and adds new entries to this map without code changes.

## Appendix B — Migration file

`supabase/migrations/089_shade_to_min_three_source.sql` — to be created during implementation per plan.
