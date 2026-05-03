# v_player_outcomes player_team investigation

**Date**: 2026-05-03
**Context**: Plan 2026-05-03-event-page-redesign Task 0.1, blocks Task 12 (PlayerListTwoCol)

## v_player_outcomes schema (columns only)

```
id                  | uuid
market_id           | uuid
source_outcome_key  | text     -- raw odds-api key (often equals player name verbatim)
name                | text     -- translated/display name
odds                | numeric
raw_odds            | numeric
line                | numeric
line_norm           | numeric
manual_odds         | numeric
manual_suspended    | boolean
is_suspended        | boolean
is_active           | boolean
override_expires_at | timestamptz
updated_at          | timestamptz
```

**No** `team_id`, `home_or_away`, `team_name`, or any team-association column exists in the view.

## outcomes_v2 raw schema (columns only)

```
id, market_id, outcome_key, line, odds, is_active, is_suspended, created_at, updated_at, line_norm
```

**No team column at the raw source level either.** The data simply isn't ingested. odds-api `/odds` payload for player-prop markets returns `{ name: "Anytime Goalscorer", outcomes: [{ name: "<player name>", price: ... }] }` with no team field — there is nothing to expose.

## Adjacent tables also lack team-on-outcome

- `markets_v2`: only `event_id`, `bookmaker`, `market_name`. No team scoping (a Marcatore market lists players from BOTH teams in one market).
- `events_v2`/`v_player_events`: have `home`/`away` team text + `home_id`/`away_id` (numeric odds-api ids), but those are event-level, not outcome-level.

## Sample player outcomes (calcio Marcatore + Team Goalscorer)

Market_type `Marcatore` (source: "Anytime Goalscorer") — Al-Shabab FC (SA) vs Al-Fateh SC, 15 outcomes sampled, all from BOTH rosters mixed together:

```
Vincent Sierro     3.75
Saad Al Sharfa     2.75
Yannick Carrasco   2.10
Wesley Delgado     5.00
Sofiane Bendebka   3.75
Saad Yaslam        5.50
Ziyad Al Jari     11.00
Zaydou Youssouf    5.50
Yacine Adli        4.33
Wesley Hoedt       8.00
Unai Hernandez     3.75
Sultan Al Anzi     3.75
Sattam Al Tumbukti 9.00
Saeed Baattia     11.00
Othman Al Othman   5.00
```

`source_outcome_key` and `name` are **identical** plain player names. No `(Home)`/`(Away)`/`(Team X)` suffix and no separate column.

Market_type `Team Goalscorer` (Caykur Rizespor vs Konyaspor) — outcomes carry only a positional `(First)` suffix (= first goalscorer for that player's team), still no team token:

```
Emrecan Bulut (First)        5.00
Altin Zeqiri (First)         5.50
Valentin Mihaila (First)     5.50
...
```

So "Team Goalscorer" doesn't help either: the team association is implicit (you'd need a roster lookup to know which side each player belongs to).

## Other Marcatore-family markets present in production

- `Marcatore` (source: Anytime Goalscorer) — flat list, both teams mixed
- `Multi Scorers` (combos like "PlayerA & PlayerB") — n/a for two-col layout
- `Team Goalscorer` — flat with `(First)` positional, both teams mixed

## Decision

- **Selected option**: **2 (fallback: flat list sorted by odds ascending)**
- **Rationale**:
  1. The data does not exist. Neither `v_player_outcomes` nor the underlying `outcomes_v2`/`markets_v2`/`oddsapi_translations` tables carry any team marker per outcome. Extending the view is impossible without first ingesting team data per player outcome — and odds-api's payload for player-prop markets does not provide it.
  2. Option 3 (heuristic frontend roster lookup) is explicitly discouraged by the plan and would require a new roster source (Flashscore lineup scraping, third-party API). That is its own multi-day project, well outside Task 12 scope.
  3. A flat single-column list sorted by odds ascending (favorites top) is a perfectly valid UX pattern used by major sportsbooks (Bet365, Snai, Sisal all default to it for Marcatore Anytime). It also handles `Team Goalscorer` and `Multi Scorers` uniformly.

- **Implementation note for Task 12**:
  - Component name `PlayerListTwoCol` is now a misnomer — rename to `PlayerListFlat` (or keep the name but render single-col) to avoid future confusion.
  - Sort outcomes by `odds ASC` (lowest = favorite at top).
  - Render as a single column of rows: `[player name]  [odds button]`. Reuse `OutcomeButton` from Task 4.
  - On mobile keep single column; on desktop the section can sit in a `lg:grid-cols-2` wrapper at the page level so two distinct markets sit side-by-side, but each individual player list stays single-column.
  - Long lists: cap visible to ~10 with a "Mostra tutti (N)" expand button (typical Marcatore market has 25-40 players).
  - Future re-evaluation trigger: if we ever add a Flashscore lineup ingestion that maps `player_name -> team_side`, we can add a derived column to `v_player_outcomes` (LEFT JOIN on `event.flashscore_id` + lineup table) and re-design as 2-col. Not blocking.

## Concerns

- None for the current pilot (calcio). The decision is clean: the data isn't there, fallback Option 2 is the only safe path.
- Cosmetic: rename Task 12 component from `PlayerListTwoCol` -> `PlayerListFlat` in the plan to keep naming honest. Suggest doing this when picking up Task 12 (no need to amend the plan now).
