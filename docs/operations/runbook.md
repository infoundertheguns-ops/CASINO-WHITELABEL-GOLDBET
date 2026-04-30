# Operations Runbook

## FS-id population (Plan D #4)

The `events_v2.flashscore_id` column is populated by:
1. **Live hook** in `services/odds-api-ingester` (`Upserter.maybeResolveFsId`) — runs after every events_v2 upsert, fire-and-forget, bounded parallelism via `p-limit` (default 4 concurrent).
2. **One-shot backfill script** `services/odds-api-ingester/scripts/backfill-fs-id.ts` — for clearing legacy NULL backlog or re-running after alias changes.

Cascade order (3 steps, short-circuit):
- Step 1: legacy direct — `events.flashscore_id` where `events.external_id = 'odds-api:<oid>'`
- Step 2: canonical chain — events sharing `canonical_id` with FS-tagged event
- Step 3: search HTTP — `http://127.0.0.1:8090/search?sport_slug=...&starts_at=...&home=...&away=...`

The search server runs inside `flashscore-scraper` (Fastify on 127.0.0.1:8090). API key in systemd unit env `FS_SEARCH_API_KEY`.

### Adding aliases for unmatched team names

1. Inspect search-side stats:
   ```
   API_KEY=$(grep '^Environment=FS_SEARCH_API_KEY=' /etc/systemd/system/flashscore-scraper.service | cut -d= -f3-)
   curl -H "X-API-Key: $API_KEY" http://127.0.0.1:8090/stats
   ```
   Look at `no_match_count` and `cache_hits`/`cache_misses` to confirm endpoint health.

2. Inspect 5 unmatched events to see actual team-name shapes:
   ```sql
   SELECT odds_api_id, sport_slug, home, away, starts_at FROM events_v2
   WHERE flashscore_id IS NULL ORDER BY starts_at DESC LIMIT 5;
   ```
   For each, curl the search endpoint manually (with auth) and inspect the 404/409 response body (409 includes candidate dump).

3. Edit `/root/flashscore-scraper/src/team-aliases.json` — sport-scoped key format `<sport_slug>:<lowercase_team_input>` → canonical normalized form.

4. Restart scraper to reload alias dict:
   ```
   systemctl restart flashscore-scraper
   curl http://127.0.0.1:8090/health
   ```

5. Optional: rerun backfill for residual NULL rows (see below).

### Re-running backfill

One-shot:
```
cd /root/betssolution-admin/services/odds-api-ingester
nohup npx tsx scripts/backfill-fs-id.ts > /var/log/backfill-fs-id-$(date +%Y%m%d-%H%M).log 2>&1 &
```
ETA at 1 req/sec: ~30-40min for full NULL queue (~2300 rows). Optional smoke: `BACKFILL_LIMIT=50 npx tsx scripts/backfill-fs-id.ts`.

Step A (bulk SQL legacy + canonical) is idempotent: re-runs are no-ops if data already populated. Step B (search) is the slow part.

### Diagnosing search endpoint failures

- `curl http://127.0.0.1:8090/health` — server reachable?
- `curl -H "X-API-Key: $API_KEY" http://127.0.0.1:8090/stats` — counters; if `fs_5xx_count` > 0, scraper had upstream Flashscore failures.
- `journalctl -u flashscore-scraper -n 200 --no-pager | grep -iE 'search|error'` — server logs.
- Sport mapping issues: check `/root/flashscore-scraper/src/sport-id-map.json` covers the `sport_slug` returned by 400 `unknown_sport` errors.

### Coverage SQL

Global:
```sql
SELECT count(*) FILTER (WHERE flashscore_id IS NOT NULL) AS pop, count(*) AS tot,
       round(100.0*count(*) FILTER (WHERE flashscore_id IS NOT NULL)/count(*), 2) AS pct
FROM events_v2;
```

Per-sport:
```sql
SELECT sport_slug, count(*) FILTER (WHERE flashscore_id IS NOT NULL) AS with_fs, count(*) AS total,
       round(100.0*count(*) FILTER (WHERE flashscore_id IS NOT NULL)/count(*), 1) AS pct
FROM events_v2 GROUP BY sport_slug ORDER BY total DESC;
```

Realistic ceiling per current scraper config: ~50-55% global, 75% football, 60% basketball, 38% tennis (lower-tier ITF unindexed). Sports without FS coverage: baseball NPB, esports, handball, darts, boxing, mma, snooker.

### Rollback

- Stop search server only: kill the listener on port 8090 by editing `src/index.ts` to comment out `startServer(...)`. Existing scraper feed loops unaffected.
- Revert ingester hook: `git revert <T8 commit>` and redeploy. Existing populated `flashscore_id` values remain correct (no schema change).
