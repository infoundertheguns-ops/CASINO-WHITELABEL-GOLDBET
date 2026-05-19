/**
 * FIELD_OWNERSHIP_FOOTBALL — single source of truth for cross-ingester
 * field ownership in the football (calcio) domain.
 *
 * Purpose
 * -------
 * Declares which ingester (`api-football` vs `fs-scraper`) owns each
 * writable column / `live_data` sub-key on `events_v2`. Used as a
 * docs-as-code reference so changes to ownership boundaries are reviewed
 * via PR rather than buried in per-route code.
 *
 * M2 context — timer ownership switch
 * -----------------------------------
 * In milestone M2 the football timer (`minute`, `period`) and live score
 * (`score_home`, `score_away`, `period_scores`) move from `fs-scraper`
 * to `api-football`. The switch is feature-flag-gated by
 * `API_FOOTBALL_TIMER_OWNER` (system_config). This table reflects the
 * post-M2 steady state.
 *
 * Runtime usage
 * -------------
 * Not used at runtime yet. Future work may add a lint rule or
 * pre-write guard that consults this table to prevent the
 * non-owning ingester from writing an owned field. For now this is
 * pure documentation, exported for type-safe references.
 *
 * Reference
 * ---------
 * Spec: `football-api-sports-integration` §3.2 (Field ownership matrix).
 */

export type FieldOwner = 'api-football' | 'fs-scraper';

export const FIELD_OWNERSHIP_FOOTBALL = {
  // api-football timer/score columns (M2 ownership switch)
  'events_v2.minute':                    'api-football',
  'events_v2.period':                    'api-football',
  'events_v2.score_home':                'api-football',
  'events_v2.score_away':                'api-football',
  'events_v2.period_scores':             'api-football',

  // fs-scraper-owned columns (unchanged through M2)
  'events_v2.country_fs':                'fs-scraper',
  'events_v2.league_fs':                 'fs-scraper',

  // fs-scraper-owned live_data sub-keys
  'events_v2.live_data.incidents':       'fs-scraper',
  'events_v2.live_data.stats':           'fs-scraper',
  'events_v2.live_data.matchMeta':       'fs-scraper',
  'events_v2.live_data.fs_pregame':      'fs-scraper',

  // api-football-owned live_data sub-keys (suffix _af)
  'events_v2.live_data.lineups_af':      'api-football',
  'events_v2.live_data.statistics_af':   'api-football',
  'events_v2.live_data.events_af':       'api-football',
  'events_v2.live_data.players_af_ht':   'api-football',
  'events_v2.live_data.players_af_ft':   'api-football',
  'events_v2.live_data.predictions_af':  'api-football',
  'events_v2.live_data.h2h_af':          'api-football',
} as const satisfies Record<string, FieldOwner>;

export type FieldPath = keyof typeof FIELD_OWNERSHIP_FOOTBALL;
