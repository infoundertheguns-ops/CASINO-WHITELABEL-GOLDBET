# Canonicalization Page — Esplora Redesign Plan (2026-04-27)

> Continuation of `2026-04-26-canonicalization-observability-page.md` after live UAT feedback. The Inspector-by-search tab is replaced with a hierarchical browse tree (Sport → Lega → Event-group → Source cards). KPI tab stays.

## Goal

Replace the Inspector tab on `/admin/canonicalization` with an "Esplora" tab that lets the operator drill down via accordion `Sport → Lega → Event-group` and shows the existing source-cards detail when an event-group is expanded. Add a top-of-page search bar that filters the tree (subsumes the previous Inspector search-only role). Add a CSV export button that flattens all groups into a one-row-per-group spreadsheet.

## Spec (frozen with user 2026-04-27)

- **Filter**: `events.status != 'ended'` AND status NOT IN any other "dead" state (`'cancelled'` if it exists). No time filter — antepost (`prematch` events scheduled months ahead) must be included.
- **Tree shape**:
  - Level 1: Sport. Show name + total event count under filter.
  - Level 2: League (per sport). Show name + country + event count.
  - Level 3: Event-group. Show `home vs away · YYYY-MM-DD HH:MM · sport` + group_type badge (🟢 flashscore / 🟡 trigram / 🔵 isolated). Reuse the existing grouping logic from `inspect_event()` but scoped to a sport+league.
  - Level 4 (expanded): the existing `<SourceCard>` row (1-3 cards: kambi/22bet/betfair).
- **Search bar at the top of the Esplora tab**: when non-empty, the tree collapses and a flat list of matching event-groups appears (same shape as Level 3+4 above). When cleared, tree returns. Min 2 chars, debounced 400ms, `AbortController`-cancellable. Same matching as `inspect_event`: home_team / away_team ILIKE / external_id equality / flashscore_id equality.
- **CSV export**: button "📥 Esporta CSV (tutti i gruppi)" top-right of Esplora tab. Output is **option B** (flat, one row per group, fixed columns):
  ```
  group_type, real_world_label, sport, league, country, country_code, tour_code, starts_at,
  flashscore_id, verified, match_stage, confidence, llm_verify, verified_by,
  kambi_external_id, kambi_status, kambi_markets, kambi_outcomes,
  22bet_external_id, 22bet_status, 22bet_markets, 22bet_outcomes,
  betfair_external_id, betfair_status, betfair_markets, betfair_outcomes
  ```
  Encoding UTF-8, semicolon `;` separator (Italian Excel friendly), values quoted with `"` if they contain `;` or newline. Filename `canonicalization-groups-YYYYMMDD-HHMMSS.csv`.
- **Tab "Gerarchia & KPI"**: unchanged. Stays at `?tab=overview`.
- **Tab "Esplora"** is the new default (`?tab=explore`).

## Tasks

### Task 1 — Mig 123: 3 RPCs + 1 RPC for CSV export

Create `supabase/migrations/123_canonicalization_browse_rpcs.sql`. All RPCs `SECURITY DEFINER`, `search_path = public, extensions`, `statement_timeout = '120s'`.

#### `canonicalization_browse_sports()` → JSONB array
```
[{ sport_id, sport_name, event_count }, ...]  -- only sports with ≥1 non-ended event
```
Order by `event_count DESC`. Single JOIN: `sports JOIN events ON events.sport_id = sports.id WHERE events.status != 'ended' GROUP BY sport_id`. Filter out 22bet placeholder synthetics (`home_team NOT IN ('Home','Home (Special bets)') AND home_team NOT LIKE '% +'`) consistent with mig 122.

#### `canonicalization_browse_leagues(p_sport_id uuid)` → JSONB array
```
[{ league_id, league_name, country, country_code, tour_code, event_count }, ...]
```
Order by `event_count DESC`. Same status/placeholder filter.

#### `canonicalization_browse_groups(p_sport_id uuid, p_league_id uuid, p_search text default null, p_limit int default 200)` → JSONB array
Returns the same `EventGroup[]` shape as `inspect_event()`. Reuse the trigram-cluster CTE chain (cluster_min, grouping, agg) verbatim — but the `filtered` CTE uses:
```
WHERE e.sport_id = p_sport_id
  AND (p_league_id IS NULL OR e.league_id = p_league_id)
  AND e.status != 'ended'
  AND e.home_team NOT IN ('Home','Home (Special bets)')
  AND e.home_team NOT LIKE '% +'
  AND (
    p_search IS NULL OR length(trim(p_search)) < 2
    OR e.home_team ILIKE '%' || p_search || '%'
    OR e.away_team ILIKE '%' || p_search || '%'
    OR e.external_id = p_search
    OR e.flashscore_id = p_search
  )
ORDER BY e.starts_at DESC
LIMIT 500
```
The trailing `LIMIT p_limit` on the agg CTE caps the number of groups returned (default 200 — operator can rarely scroll past that, and the cluster CTE is O(n²) on the filtered set).

#### `canonicalization_export_groups()` → JSONB array
Returns a flat array, one element per group, with the columns listed in the CSV spec above. No filter except `status != 'ended'` + placeholder filter. Order by `sport_name, league_name, starts_at`. Cap at e.g. 50 000 rows for safety. Fields per source picked via `(array_agg(... ORDER BY src_kind) FILTER (WHERE src_kind = 'kambi'))[1]` etc.

### Task 2 — Apply mig 123 to staging + prod
```
node scripts/db/apply-mig.mjs --target staging --file supabase/migrations/123_canonicalization_browse_rpcs.sql
node scripts/db/apply-mig.mjs --target prod    --file supabase/migrations/123_canonicalization_browse_rpcs.sql
```
Smoke each: call `canonicalization_browse_sports()` from each, confirm rows return.

### Task 3 — TS types extension
Append to `lib/admin/canonicalization-types.ts`:
```
export interface BrowseSport { sport_id: string; sport_name: string; event_count: number; }
export interface BrowseLeague {
  league_id: string; league_name: string; country: string|null;
  country_code: string|null; tour_code: string|null; event_count: number;
}
export interface BrowseGroupsResponse { groups: EventGroup[]; truncated: boolean; }
```
The existing `EventGroup` is reused.

### Task 4 — 3 new API routes + 1 CSV export route

- `GET /api/admin/canonicalization/browse-sports` → calls RPC, no params, 60s `unstable_cache`.
- `GET /api/admin/canonicalization/browse-leagues?sport_id=...` → calls RPC, 60s cache keyed on sport_id.
- `GET /api/admin/canonicalization/browse-groups?sport_id=...&league_id=...&q=...&limit=...` → calls RPC, no cache (search is dynamic).
- `GET /api/admin/canonicalization/export.csv` → calls `canonicalization_export_groups()`, formats as CSV, returns `text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="canonicalization-groups-YYYYMMDD-HHMMSS.csv"`.

Use `createAdminClient()` and `export const dynamic = 'force-dynamic'` per the existing pattern.

CSV serialization: small inline helper. Quote values containing `;`, `"`, or `\n`. Escape `"` as `""`. Booleans emitted as `true`/`false`/empty. Numbers emitted as-is. Nulls/undefined as empty. Timestamps emitted as `YYYY-MM-DDTHH:MM:SS`.

### Task 5 — `<ExploreTab />` component

Create `app/admin/canonicalization/explore-tab.tsx`:
- State: `searchQ`, `selectedSportId`, `selectedLeagueId`, `expandedGroupKey`, `sports[]`, `leagues[]`, `groups[]`, plus loading flags.
- On mount: load sports list.
- On sport click (accordion expand): if leagues for this sport not loaded → fetch + cache.
- On league click: load groups for sport+league.
- On group row click: toggle expand → render `<SourceCard>` set inline.
- On search non-empty: skip tree, fetch groups directly with `q=...` and a flat list view appears.
- AbortController on every fetch (debounce 400ms on search).

Layout sketch:
```
[ search bar.................................................... ]   [📥 Esporta CSV]
─────────────────────────────────────────────────────────────────────
▾ Calcio (4127)
   ▾ Coppa Italia · Italy (24)
      ▸ Lazio vs Internazionale Milano · 13/05 21:00 · Calcio  🟡
      ▾ Roma vs Milan · 14/05 20:45 · Calcio  🟢                   ← expanded
         [SourceCard kambi]  [SourceCard 22bet]  [SourceCard betfair]
   ▸ Serie A · Italy (280)
▸ Tennis (892)
▸ ...
```

Accordion toggle is purely client state; no router pushes for tree expansion (would explode URL state). Only `?tab=explore` and `?q=...` go to URL.

### Task 6 — Page wiring

Modify `app/admin/canonicalization/page.tsx`:
- Default tab → `'explore'`.
- Tabs: `🌳 Esplora` (default) + `📊 Gerarchia & KPI`.
- Drop the old `inspector-tab.tsx` import; render `<ExploreTab />` in its place.
- Keep `<OverviewTab />` as the second tab.
- Delete `app/admin/canonicalization/inspector-tab.tsx` (replaced).

### Task 7 — Tests

- `tests/lib/admin/csv-export.test.ts` — small unit test for the CSV serializer (5-7 cases: plain string, string with `;`, string with `"`, string with `\n`, null, boolean, number).
- The `<ExploreTab />` itself does not get an integration test in this iteration (no Playwright in scope per the parent plan); manual smoke is the gate.

### Task 8 — Smoke + push

- `npm run build` clean, `npm run test` clean (679 + new tests passing; pre-existing v_consensus_latest failure tolerated).
- Commit per task. Push master, merge to staging, push staging.
- Manual smoke staging: tree opens, search filters, CSV download works (open in Excel, verify Italian columns).

### Task 9 — Prod deploy + memory update

- Apply mig 123 to prod (already pre-built into the SQL file).
- Trigger `Deploy Production` workflow with `branch=master`.
- Smoke prod URL.
- Update memory: chiusura redesign + baseline numbers post-redesign.

## Acceptance criteria

- Esplora tab is the default landing on `/admin/canonicalization`.
- The accordion expands/collapses smoothly; sport counts match `canonicalization_browse_sports()`.
- Searching "Lazio" surfaces the duplicate Lazio-Inter group (the same one from UAT) and shows 2 source cards.
- The CSV downloads in <5s, opens in Excel with semicolon delimiter, has the columns specified above, and includes ≥1 row per non-ended event-group.
- The Gerarchia & KPI tab continues to work as before.
- 0 regressions on existing test suite.

## Out of scope

- Trends / time-series (deferred to a future round).
- Mutation actions in the tree (verify, edit, link). Read-only browse only.
- Pagination beyond LIMIT 200 per league (unlikely to hit; if it does, future iteration).

## Rollback

UI: revert the page.tsx switch back to `<InspectorTab />` (still on disk if not deleted) or just remove the new tab from the array.
DB: `DROP FUNCTION canonicalization_browse_sports(); DROP FUNCTION canonicalization_browse_leagues(uuid); DROP FUNCTION canonicalization_browse_groups(uuid, uuid, text, int); DROP FUNCTION canonicalization_export_groups();`
