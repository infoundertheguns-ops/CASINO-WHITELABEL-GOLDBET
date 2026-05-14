export interface ResolveEvent {
  odds_api_id: number;
  sport_slug: string;
  starts_at: Date;
  home: string;
  away: string;
}

export interface ResolveDeps {
  db: { queryOne: <T = any>(sql: string, params: any[]) => Promise<T | null> };
  searchUrl: string;
  apiKey: string;
  log: { info: (...a: any[]) => void; warn: (...a: any[]) => void };
  fetch?: typeof fetch;
}

export async function resolveFlashscoreId(
  event: ResolveEvent,
  deps: ResolveDeps
): Promise<string | null> {
  const fetchFn = deps.fetch ?? fetch;

  // Step 1 — events_v2 cache (same odds_api_id already resolved in a previous tick)
  const direct = await deps.db.queryOne<{ flashscore_id: string }>(
    `SELECT flashscore_id FROM events_v2
     WHERE odds_api_id = $1 AND flashscore_id IS NOT NULL LIMIT 1`,
    [event.odds_api_id]
  );
  if (direct?.flashscore_id) {
    deps.log.info({ odds_api_id: event.odds_api_id, via: "v2_direct" }, "[fs-id] resolved");
    return direct.flashscore_id;
  }

  // Step 2 — search endpoint
  try {
    const url = new URL(`${deps.searchUrl}/search`);
    url.searchParams.set("sport_slug", event.sport_slug);
    url.searchParams.set("starts_at", event.starts_at.toISOString());
    url.searchParams.set("home", event.home);
    url.searchParams.set("away", event.away);
    const res = await fetchFn(url, {
      headers: { "X-API-Key": deps.apiKey },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const body = (await res.json()) as { matchId: string };
      deps.log.info({ odds_api_id: event.odds_api_id, via: "search", matchId: body.matchId }, "[fs-id] resolved");
      return body.matchId;
    }
    deps.log.info({ odds_api_id: event.odds_api_id, status: res.status }, "[fs-id] search no match");
  } catch (err) {
    deps.log.warn({ odds_api_id: event.odds_api_id, err: String(err) }, "[fs-id] search failed");
  }
  return null;
}
