/**
 * In-memory state for the api-football live ingester.
 *
 * Tracks two per-fixture facts across discovery cycles:
 *
 *  - lastSeenScores: latest `{home, away}` goals observed from
 *    `/fixtures?live=all`. Used by the events fetcher (M1.10) to decide
 *    whether a fixture's score has advanced since the last cycle — if so,
 *    we re-fetch `/fixtures/events` (player attribution for Goal/Card/Sub),
 *    otherwise we skip and save quota.
 *
 *  - lastEventsFetchAt: epoch ms of the last successful
 *    `/fixtures/events` call per fixture. Used as a TTL guard so we don't
 *    spam events on rapid score updates within a few seconds, and as a
 *    safety net to refresh stale data even when score is unchanged.
 *
 * Invariant: `lastEventsFetchAt` keys are always a subset of
 * `lastSeenScores` keys (we set the score before kicking off the events
 * fetch). `pruneStale` enforces this by iterating both maps independently
 * — defensive against any future code path that violates the invariant.
 *
 * Lifecycle: scoped to a single `scheduler.ts` process. On restart the
 * state resets to empty; the worst case is one extra `/fixtures/events`
 * call per live fixture on cold start, which is acceptable.
 */
export class FixtureState {
  private lastSeenScores = new Map<number, { home: number; away: number }>();
  private lastEventsFetchAt = new Map<number, number>();

  /**
   * Returns the most recent score observed for `fixtureId`, or
   * `{home: 0, away: 0}` if we've never seen it. The default is chosen
   * so that the first `/fixtures?live=all` response will always count
   * as a 'score advanced' transition (0-0 -> actual) when the fixture
   * is non-trivial, triggering an initial events fetch.
   */
  getLastScore(fixtureId: number): { home: number; away: number } {
    return this.lastSeenScores.get(fixtureId) ?? { home: 0, away: 0 };
  }

  setLastScore(fixtureId: number, score: { home: number; away: number }): void {
    this.lastSeenScores.set(fixtureId, score);
  }

  /**
   * Returns the epoch ms of the last `/fixtures/events` fetch for
   * `fixtureId`, or `0` if never fetched. Callers compare against
   * `Date.now()` with a TTL.
   */
  getLastEventsFetchAt(fixtureId: number): number {
    return this.lastEventsFetchAt.get(fixtureId) ?? 0;
  }

  setEventsFetchAt(fixtureId: number, tsMs: number): void {
    this.lastEventsFetchAt.set(fixtureId, tsMs);
  }

  /**
   * Removes fixtures that are no longer in `activeFixtureIds` (typically
   * the id set from the most recent `/fixtures?live=all` response).
   * Called after each discovery cycle to prevent unbounded growth as
   * matches finish.
   *
   * Defensive: iterates both internal maps independently rather than
   * relying on the subset invariant, so any orphan entry in
   * lastEventsFetchAt also gets cleaned.
   */
  pruneStale(activeFixtureIds: Set<number>): void {
    for (const id of this.lastSeenScores.keys()) {
      if (!activeFixtureIds.has(id)) {
        this.lastSeenScores.delete(id);
      }
    }
    for (const id of this.lastEventsFetchAt.keys()) {
      if (!activeFixtureIds.has(id)) {
        this.lastEventsFetchAt.delete(id);
      }
    }
  }
}
