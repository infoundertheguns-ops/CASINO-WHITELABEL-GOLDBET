import Fastify from "fastify";
import { searchEvent, searchCache } from "./search.js";

interface SportCounters {
  ok: number;
  no_match_feed_empty: number;
  no_match_time: number;
  no_match_name: number;
  ambiguous: number;
  unavailable: number;
  unknown_sport: number;
}
function newCounters(): SportCounters {
  return { ok: 0, no_match_feed_empty: 0, no_match_time: 0, no_match_name: 0, ambiguous: 0, unavailable: 0, unknown_sport: 0 };
}

const bySport: Record<string, SportCounters> = {};
const startMs = Date.now();
let totalRequests = 0;

function bump(slug: string, key: keyof SportCounters): void {
  if (!bySport[slug]) bySport[slug] = newCounters();
  bySport[slug][key]++;
}

export async function startServer(port = 8090, host = "127.0.0.1"): Promise<void> {
  const apiKey = process.env.FS_SEARCH_API_KEY ?? "";
  if (!apiKey) throw new Error("FS_SEARCH_API_KEY env var required");

  const app = Fastify({ logger: { level: "info" } });

  app.addHook("onRequest", async (req, reply) => {
    if (req.url.startsWith("/health")) return;
    const provided = req.headers["x-api-key"];
    if (provided !== apiKey) {
      reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.get("/health", async () => ({ ok: true, uptime_sec: Math.round((Date.now() - startMs) / 1000) }));

  app.get("/search", async (req, reply) => {
    const q = req.query as Record<string, string>;
    if (!q.sport_slug || !q.starts_at || !q.home || !q.away) {
      return reply.code(400).send({ error: "missing_params" });
    }
    totalRequests++;
    const result = await searchEvent({
      sportSlug: q.sport_slug,
      startsAt: q.starts_at,
      home: q.home,
      away: q.away,
    });
    const slug = q.sport_slug;
    if (result.status === 200) bump(slug, "ok");
    else if (result.status === 409) bump(slug, "ambiguous");
    else if (result.status === 503) bump(slug, "unavailable");
    else if (result.status === 400) bump(slug, "unknown_sport");
    else if (result.status === 404) {
      const reason = (result.body as { reason: string }).reason;
      if (reason === "feed_empty") bump(slug, "no_match_feed_empty");
      else if (reason === "time_window_miss") bump(slug, "no_match_time");
      else bump(slug, "no_match_name");
    }
    return reply.code(result.status).send(result.body);
  });

  app.get("/stats", async () => ({
    uptime_sec: Math.round((Date.now() - startMs) / 1000),
    search_requests_total: totalRequests,
    cache_hits: searchCache.hits(),
    cache_misses: searchCache.misses(),
    cache_size: searchCache.size(),
    by_sport: bySport,
  }));

  await app.listen({ port, host });
  console.log(`[search-server] listening on http://${host}:${port}`);
}
