/**
 * Shared types for the api-football ingester.
 *
 * Scope (M1.7): RateLimitInfo + AFFixture (full).
 * Stub interfaces below are placeholders for follow-up milestones — they will
 * be fleshed out when their consumers land. Do NOT use them for real parsing
 * until then.
 */

export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
}

/**
 * Fixture envelope from `/fixtures` (live + scheduled) endpoints.
 * Fields populated per api-football v3 docs.
 */
export interface AFFixture {
  fixture: {
    id: number;
    date: string;
    status: { elapsed: number | null; long: string; short: string; extra?: number | null };
    venue: { id: number | null; name: string; city: string };
  };
  league: { id: number; name: string; country: string };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals: { home: number | null; away: number | null };
  score: {
    halftime: { home: number | null; away: number | null };
    fulltime: { home: number | null; away: number | null };
    extratime: { home: number | null; away: number | null };
    penalty: { home: number | null; away: number | null };
  };
}

// --- Stub interfaces (to be fleshed out in later M1 milestones) ---

/**
 * TODO(M1.10): event row from `/fixtures/events` — goals, cards, subs.
 * Shape will be defined during discovery task.
 */
export interface AFEvent {
  // placeholder — see M1.10 discovery
  [key: string]: unknown;
}

/**
 * TODO(M1.12): team-level statistic row from `/fixtures/statistics`.
 * Shape will be defined during enrichment task.
 */
export interface AFStatistic {
  // placeholder — see M1.12 enrichment
  [key: string]: unknown;
}

/**
 * TODO(M1.12): player-level row from `/fixtures/players` and `/players`.
 * Shape will be defined during enrichment task.
 */
export interface AFPlayer {
  // placeholder — see M1.12 enrichment
  [key: string]: unknown;
}

/**
 * TODO(M1.12): lineup envelope from `/fixtures/lineups`.
 * Shape will be defined during enrichment task.
 */
export interface AFLineup {
  // placeholder — see M1.12 enrichment
  [key: string]: unknown;
}
