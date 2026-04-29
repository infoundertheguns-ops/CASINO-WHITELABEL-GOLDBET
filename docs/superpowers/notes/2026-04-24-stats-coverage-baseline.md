# Stats Coverage Baseline — 2026-04-24

**Context:** Phase 0 Task 0.3 of Kambi+22bet integration plan asked to smoke-test prod DB stat ingestion. Output was surprising and warrants a separate note.

## Findings

### 1. Extractor code is correct ✅
- Italian section/stat names confirmed on live flashscore feed via direct fetch:
  - `Partita: Possesso palla`, `Partita: Tiri totali`, `Partita: Tiri in porta`, `Partita: Calci d'angolo` (and `1 Tempo`/`2 Tempo` equivalents).
- `lib/settlement/stats-extractor.ts` (Task 0.1) matches these correctly. Tested on 16 unit cases + 1 integration.

### 2. Prod DB stats coverage is ~0.6% across last 500 events with non-NULL stats
- `scripts/smoke-test-stats-ingestion.ts` sampled 500 events where `live_data->stats IS NOT NULL`.
- **497/500** had `stats: []` (empty array).
- **3/500** had non-empty stats: 2 hockey (NHL/AHL) + 1 tennis (ATP doubles). Zero calcio.
- In last 48h: 23938 ended events across all sports, 3474 with `flashscore_id` set, zero with populated calcio stats.

### 3. Root cause: status-mismatch between our DB and flashscore
- `scripts/probe-direct-fetch-by-dbfsid.ts` took 8 flashscore_ids for events our DB has as `status=ended`, fetched their detail.
- Result:
  - 4/8 returned `status=not_started` from flashscore with no stats — these are matches our DB considers ended but flashscore considers not-yet-played. Stale DB state.
  - 4/8 returned `status=live` with 16 stats each — Italian names, complete structure. Our DB thinks ended but flashscore still has them live.
- Implication: `app/api/cron/verify-results/route.ts` calls `fetchMatchDetail` at a moment when flashscore returns `status=not_started` or `status=live`. Current cron does NOT gate stats persistence on status, but even when stats ARE returned (live case), they represent an in-progress snapshot — and then the cron presumably runs again when flashscore says finished, OR the event is missed.
- The **final** stats state in DB is `[]` for most matches, which suggests either (a) a previous `stats: []` write from an empty fetch has overwritten data, or (b) the cron never successfully runs against a match AFTER flashscore marks it finished.

### 4. Separately, 99% of events don't have flashscore_id set
- 23938 ended / 3474 with fsid = 14.5% match rate.
- 85.5% of ended events have NO flashscore verification path at all — likely lower-tier leagues flashscore doesn't cover, or fuzzy-matching threshold not met.

## Impact on Kambi+22bet integration

- **Phase 1 Family A settlers will function correctly** on matches that DO have stats in DB. The code is right.
- **Measurable impact** (settle rate on corner/cards/shots markets) will be **low until the separate stats pipeline issue is fixed**. On current coverage, Family A settlers would fire on a fraction of a percent of events.
- This is **not a blocker** for Phase 1 — the fix still closes the latent extractor bug and prepares the codebase. But don't expect prod metrics to jump dramatically after Phase 1 rollout.

## Follow-up tasks (OUT OF SCOPE for Phase 0-5)

1. Investigate why `verify-results` cron doesn't pick up calcio events after flashscore marks them finished. Hypothesis: the events update_at is older than the cron's lookback window by the time flashscore finalizes the match. Widen the lookback or add a second pass.
2. Investigate why flashscore returns `status=not_started` for some fsids our DB thinks ended. Likely a stale fsid from mis-match during pre-match fixture matching — fix by also verifying fsid against current flashscore state before committing.
3. Expand `matchFixtures` / `matchEvents` fuzzy-match threshold or add alternative sources to lift the 14.5% fsid coverage rate.

## Artefacts

- `scripts/smoke-test-stats-ingestion.ts` — 500-event survey
- `scripts/probe-direct-fetch-by-dbfsid.ts` — direct-fetch confirmation
- Probe output committed in session history / transcripts.

## Decision

Task 0.3 is considered **DONE_WITH_CONCERNS**. Extractor correctness is verified. Data coverage is low but that's a separate pipeline bug, not Phase 0's problem. Proceed with Phase 1 and revisit stats ingestion as a standalone follow-up.
