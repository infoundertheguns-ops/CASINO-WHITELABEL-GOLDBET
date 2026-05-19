/**
 * Per-fixture decision logic for the api-football live ingester.
 *
 * `shouldFetchEvents` decides whether to call `/fixtures/events` for a
 * given live fixture during a discovery cycle (L3 score-delta tier per
 * spec §3.4). Two triggers:
 *
 *   1. **score-delta** — current goals differ from the last observed
 *      score (in either direction; VAR cancellations count as a delta).
 *   2. **card-poll** — a TTL safety net so a fixture with a frozen
 *      scoreboard but ongoing card/sub activity still gets refreshed
 *      periodically. The same trigger covers cold start (lastEventsFetchAt
 *      defaults to 0, so the first cycle has msSinceLastFetch >> TTL).
 *
 * Precedence: `score-delta` is checked first. A cold-start fixture that
 * already has a live score (e.g. ingester restarted mid-match) emits
 * `score-delta`, not `card-poll`.
 *
 * The function is **pure**: it does not mutate state, does not call
 * `Date.now()` outside the default parameter, and performs no I/O. The
 * scheduler is responsible for calling `state.setLastScore` and
 * `state.setEventsFetchAt` after a successful fetch+persist.
 */
import type { FixtureState } from './state.js';
import type { AFFixture } from './types.js';

export type FetchReason = 'score-delta' | 'card-poll' | 'seed' | 'final';

export interface ShouldFetchDecision {
  fetch: boolean;
  reason?: FetchReason;
}

/** TTL between safety-net `/fixtures/events` polls when score is unchanged. */
export const CARD_POLL_TTL_MS = 5 * 60 * 1000;

export function shouldFetchEvents(
  state: FixtureState,
  fixture: Pick<AFFixture, 'fixture' | 'goals'>,
  nowMs: number = Date.now()
): ShouldFetchDecision {
  const id = fixture.fixture.id;
  const last = state.getLastScore(id);
  // Coerce null -> 0: api-football reports null before the first whistle
  // and occasionally on partial responses. Treating null as 0 means we
  // never spuriously flag a delta against the state default {0,0}.
  const currHome = fixture.goals.home ?? 0;
  const currAway = fixture.goals.away ?? 0;

  if (currHome !== last.home || currAway !== last.away) {
    return { fetch: true, reason: 'score-delta' };
  }

  const msSinceLastFetch = nowMs - state.getLastEventsFetchAt(id);
  if (msSinceLastFetch > CARD_POLL_TTL_MS) {
    return { fetch: true, reason: 'card-poll' };
  }

  return { fetch: false };
}
