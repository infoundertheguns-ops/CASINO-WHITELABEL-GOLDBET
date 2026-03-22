# Ippica Frontend — Design Spec

**Date**: 2026-03-22
**Status**: Draft

## Overview

Full horse racing frontend for Vincitu: racecard-style listing page, race detail page with runners grid and odds, betslip integration with full betting, and navigation tab. Data comes from existing `ippica_*` tables populated by the MST Channel scraper.

## Pages

### `/ippica` — Meeting & Race Listing (Racecard Style)

**Layout**: Two-panel racecard.

**Left panel** (sidebar on desktop, dropdown on mobile):
- Meeting list grouped by country (Italia, UK, Francia, etc.)
- Each meeting shows: name, race type icon (GL=galoppo/TR=trotto), number of races, next race time
- Click to select meeting, first meeting auto-selected on load
- Country groups collapsible, sorted: Italy first, then alphabetical

**Main panel**:
- Header: selected meeting name, country flag, date, race type badge
- Race cards listed vertically, one per race in the meeting
- Each race card:
  - **Header row**: Race # badge, title, time (or "LIVE"/"CHIUSA"), distance, going, prize
  - **Runner grid** (table):
    - Columns: `#` | Nome | Jockey | Form | Peso | Winner | Place
    - Each row = one runner (skip non-runners, shown greyed at bottom)
    - Winner/Place odds as clickable buttons (add to betslip on click)
    - Odds colored by trend: green border flash = shortened, red = drifted
    - Non-runner rows: strikethrough name, no odds
  - **Expand button**: "Tutti i mercati" → links to `/ippica/{raceId}`

**Quick "Prossime Corse" strip** (top of page):
- Horizontal scrollable strip showing next 5-8 races across ALL meetings
- Each chip: time, meeting name (abbreviated), race #
- Click jumps to that meeting+race

**Betslip**: Same `BetslipPanel` component, right sidebar on desktop, floating button on mobile.

### `/ippica/[id]` — Race Detail

**Header section**:
- Meeting name + country
- Race # + title
- Distance, going, weather, track type, class, handicap badge
- Prize amount
- Status badge: Programmata / Aperta / Chiusa / In Corso / Conclusa / Annullata

**Market tabs** (horizontal scroll):
- VINCENTE (Winner)
- PIAZZATO (Place 2/3/4 — grouped)
- TESTA A TESTA (H2H pairs)
- PARI/DISPARI (Even/Odd)

**Runners table** (full detail, shown under VINCENTE tab):
- Columns: `#` | Silk | Nome | Eta | Sesso | Peso | Jockey | Trainer | Form | Rating | Quota
- Sortable by: number (default), odds, rating
- Expandable row detail: breeding, comments (Italian), owner, color
- Non-runners at bottom, greyed, marked "NP" (Non Parte)

**Place tab**: Same runner list but with Place odds columns (2/3/4 depending on available markets)

**H2H tab**: Card per each H2H matchup, two runners side by side with odds buttons

**Even/Odd tab**: Two large buttons with odds

**Betslip**: Integrated, same as listing page.

### Results (post-race)
When race status = `finished`:
- Runner grid shows finish position column (1st, 2nd, 3rd highlighted)
- Winning odds highlighted in green
- "Risultati" badge on race card

## Data Hook: `use-ippica.ts`

```typescript
// Main hook
function useIppica() → {
  meetings, races, selectedMeeting, setSelectedMeeting,
  loading, error
}

// Race detail hook
function useIppicaRace(raceId: string) → {
  race, runners, markets, odds,
  loading, error
}

// Next races hook (for quick strip)
function useNextRaces(limit: number) → {
  races, loading
}
```

**Data source**: Direct Supabase queries on `ippica_*` tables via browser client.

**Polling**: `useIppicaRace` polls every 30s for odds updates (no SSE pipeline for ippica yet). Uses `previous_odds` + `trend` from DB for direction arrows.

**Queries**:
- Meetings: `ippica_meetings` where `meeting_date = today`, ordered by country, name
- Races: `ippica_races` where `meeting_id = selected`, ordered by `race_number`
- Runners: `ippica_runners` where `race_id`, ordered by `runner_number`
- Markets: `ippica_markets` where `race_id` + `is_active = true`
- Odds: `ippica_odds` where `market_id IN (...)` + `status != 'void'`

## Navigation

Add "Ippica" to `NAV_ITEMS` in `player-nav.tsx`:
```typescript
{ href: "/ippica", icon: "🏇", label: "Ippica" }
```
Position: after "Marcatori", before "Le Mie Bet".

Desktop sidebar: when on `/ippica`, show meeting list sidebar (like sport sidebar shows sport filters).

## Betslip Integration

Ippica bets use the same `bets` + `bet_selections` tables as sport bets.

**Selection format for ippica**:
- `event_id`: NULL (ippica uses separate tables)
- New columns needed in `bet_selections`:
  - `ippica_race_id` UUID FK nullable → `ippica_races`
  - `ippica_odds_id` UUID FK nullable → `ippica_odds`
- Or simpler: use `market_id` and `outcome_id` as generic text fields storing ippica IDs

**Recommended approach**: Add `source` column to `bet_selections` ("sport" | "ippica") + store ippica IDs in existing `market_id`/`outcome_id` columns as UUID text. Settlement checks source to know which tables to query.

**Betslip state**: Extend existing Zustand-like betslip store to support ippica selections alongside sport selections. Each selection carries:
```typescript
{
  source: "ippica",
  raceId: string,
  raceName: string,
  meetingName: string,
  marketType: string,    // "Winner", "Place (2)", etc.
  selectionName: string, // horse name
  odds: number,
  oddsId: string,        // ippica_odds.id
}
```

**Place bet flow**: POST `/api/player/place-bet` — extend to handle `source: "ippica"` selections.

## DB Migration (025)

```sql
-- Add ippica support to bet_selections
ALTER TABLE bet_selections ADD COLUMN source TEXT NOT NULL DEFAULT 'sport';
ALTER TABLE bet_selections ADD COLUMN ippica_race_id UUID REFERENCES ippica_races(id);
ALTER TABLE bet_selections ADD COLUMN ippica_market_id UUID REFERENCES ippica_markets(id);
ALTER TABLE bet_selections ADD COLUMN ippica_odds_id UUID REFERENCES ippica_odds(id);

-- Index for ippica settlement queries
CREATE INDEX idx_bet_selections_ippica ON bet_selections(ippica_race_id) WHERE source = 'ippica';
```

## Settlement

Ippica settlement is already handled by the scraper's results-loop (sets `ippica_odds.result`).

For bet settlement, add a step in the cleanup cron or a dedicated ippica settlement check:
1. Find ippica bets where all selections have `ippica_odds.result IS NOT NULL`
2. Calculate: all "won" → bet wins, any "lost" → bet loses, mix → partial (for sistema)
3. Credit winnings to wallet

## File Structure

```
app/(player)/ippica/
  page.tsx                    # Meeting listing + racecard
  [id]/page.tsx               # Race detail
components/ippica/
  meeting-sidebar.tsx         # Country-grouped meeting list
  race-card.tsx               # Single race racecard (runners + odds grid)
  runner-row.tsx              # Runner table row
  race-header.tsx             # Race info header
  market-tabs.tsx             # VINCENTE/PIAZZATO/H2H/P-D tabs
  next-races-strip.tsx        # Horizontal upcoming races
lib/hooks/
  use-ippica.ts               # Data fetching hooks
```

## Styling

Follow existing Vincitu player theme:
- White cards on gray-50 background
- Brand orange for interactive elements
- Same responsive breakpoints (mobile max-w-[430px], desktop lg:)
- Trend colors: green for shortened odds, red for drifted
- Race status badges: same color system as sport events
- Racing-specific: silk/jersey colors when available from DB

## Out of Scope

- SSE real-time pipeline (polling is fine for ippica's 2min refresh)
- Ante-post / futures markets
- Forecast / Tricast combination bets
- Admin ippica dashboard (can add later)
- Kiosk ippica view
