import "dotenv/config";
import { Pool } from "pg";
import pLimit from "p-limit";
import { resolveFlashscoreId } from "../src/resolve-flashscore-id.js";

const BACKFILL_LIMIT = process.env.BACKFILL_LIMIT ? Number(process.env.BACKFILL_LIMIT) : null;
const CONCURRENCY = process.env.BACKFILL_CONCURRENCY ? Number(process.env.BACKFILL_CONCURRENCY) : 4;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

interface StepCounter {
  legacy_direct: number;
  canonical_chain: number;
  search: number;
}

interface SportSummary {
  ok: number;
  fail: number;
}

const stats = {
  total: 0,
  resolved: 0,
  failed: 0,
  errors: 0,
  by_sport: {} as Record<string, SportSummary>,
  by_step: { legacy_direct: 0, canonical_chain: 0, search: 0 } as StepCounter,
};

function bumpSport(slug: string, ok: boolean): void {
  if (!stats.by_sport[slug]) stats.by_sport[slug] = { ok: 0, fail: 0 };
  if (ok) stats.by_sport[slug].ok++;
  else stats.by_sport[slug].fail++;
}

const log = {
  info: (obj: { via?: string; [k: string]: unknown }, _msg: string) => {
    if (obj.via === "legacy_direct") stats.by_step.legacy_direct++;
    else if (obj.via === "canonical_chain") stats.by_step.canonical_chain++;
    else if (obj.via === "search") stats.by_step.search++;
  },
  warn: (_obj: unknown, _msg: string) => {},
};

const db = {
  queryOne: async <T = unknown>(sql: string, params: unknown[]): Promise<T | null> => {
    const r = await pool.query(sql, params);
    return ((r.rows[0] as T) ?? null);
  },
};

async function stepA_bulkSQL(): Promise<void> {
  console.log("[backfill-v2] Step A — bulk SQL (legacy_direct + canonical_chain)");
  const a1 = await pool.query(`
    UPDATE events_v2 v SET flashscore_id = e.flashscore_id, updated_at = now()
    FROM events e
    WHERE e.external_id = 'odds-api:' || v.odds_api_id::text
      AND e.flashscore_id IS NOT NULL
      AND v.flashscore_id IS NULL
  `);
  console.log(`[backfill-v2] A1 legacy_direct: populated ${a1.rowCount} rows`);

  const a2 = await pool.query(`
    UPDATE events_v2 v SET flashscore_id = e_fs.flashscore_id, updated_at = now()
    FROM events e_oa
    JOIN events e_fs ON e_fs.canonical_id = e_oa.canonical_id AND e_fs.flashscore_id IS NOT NULL
    WHERE e_oa.external_id = 'odds-api:' || v.odds_api_id::text
      AND v.flashscore_id IS NULL
  `);
  console.log(`[backfill-v2] A2 canonical_chain: populated ${a2.rowCount} rows`);
}

async function stepB_searchHTTP(): Promise<void> {
  console.log(`[backfill-v2] Step B — search HTTP (concurrency=${CONCURRENCY}${BACKFILL_LIMIT ? `, LIMIT ${BACKFILL_LIMIT}` : ""})`);

  const rows = await pool.query<{
    id: string;
    odds_api_id: number;
    sport_slug: string;
    starts_at: Date;
    home: string;
    away: string;
    status: string;
  }>(`
    SELECT id, odds_api_id, sport_slug, starts_at, home, away, status
    FROM events_v2
    WHERE flashscore_id IS NULL
    ORDER BY
      (status = 'live') DESC,
      (status = 'pending' AND starts_at < now() + interval '6 hours') DESC,
      (status = 'pending') DESC,
      starts_at ASC
    ${BACKFILL_LIMIT ? `LIMIT ${BACKFILL_LIMIT}` : ""}
  `);

  stats.total = rows.rowCount ?? 0;
  console.log(`[backfill-v2] queue size: ${stats.total}`);

  const limit = pLimit(CONCURRENCY);
  let progressIdx = 0;
  const reportEvery = Math.max(50, Math.floor(stats.total / 20));

  await Promise.all(
    rows.rows.map((r) =>
      limit(async () => {
        progressIdx++;
        if (progressIdx % reportEvery === 0) {
          console.log(`[backfill-v2] progress ${progressIdx}/${stats.total} resolved=${stats.resolved} failed=${stats.failed} errors=${stats.errors}`);
        }
        try {
          const matchId = await resolveFlashscoreId(
            {
              odds_api_id: r.odds_api_id,
              sport_slug: r.sport_slug,
              starts_at: new Date(r.starts_at),
              home: r.home,
              away: r.away,
            },
            {
              db,
              searchUrl: process.env.FS_SEARCH_URL!,
              apiKey: process.env.FS_SEARCH_API_KEY!,
              log,
            }
          );
          if (matchId) {
            await pool.query(
              `UPDATE events_v2 SET flashscore_id = $1, updated_at = now() WHERE id = $2 AND flashscore_id IS NULL`,
              [matchId, r.id]
            );
            stats.resolved++;
            bumpSport(r.sport_slug, true);
          } else {
            stats.failed++;
            bumpSport(r.sport_slug, false);
          }
        } catch (err) {
          stats.errors++;
          console.error(`[backfill-v2] error on ${r.odds_api_id}:`, err);
          bumpSport(r.sport_slug, false);
        }
      })
    )
  );
}

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log("[backfill-v2] start");
  await stepA_bulkSQL();
  await stepB_searchHTTP();
  const dt = Math.round((Date.now() - t0) / 1000);
  console.log("\n[backfill-v2] === SUMMARY ===");
  console.log(JSON.stringify({ duration_sec: dt, ...stats }, null, 2));
  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill-v2] fatal:", err);
  process.exit(1);
});
