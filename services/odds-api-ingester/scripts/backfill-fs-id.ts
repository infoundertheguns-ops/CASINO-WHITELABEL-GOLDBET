import "dotenv/config";
import { Pool } from "pg";
import pLimit from "p-limit";
import { resolveFlashscoreId } from "../src/resolve-flashscore-id.js";

const BACKFILL_LIMIT = process.env.BACKFILL_LIMIT ? Number(process.env.BACKFILL_LIMIT) : null;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const log = {
  info: (obj: any, msg: string) => console.log(JSON.stringify({ level: "info", ...obj, msg })),
  warn: (obj: any, msg: string) => console.warn(JSON.stringify({ level: "warn", ...obj, msg })),
};

const db = {
  queryOne: async <T = any>(sql: string, params: any[]): Promise<T | null> => {
    const r = await pool.query(sql, params);
    return (r.rows[0] as T) ?? null;
  },
};

async function stepA(): Promise<void> {
  console.log("[backfill] Step A — bulk SQL");
  const a1 = await pool.query(`
    UPDATE events_v2 v SET flashscore_id = e.flashscore_id, updated_at = now()
    FROM events e
    WHERE e.external_id = 'odds-api:' || v.odds_api_id::text
      AND e.flashscore_id IS NOT NULL
      AND v.flashscore_id IS NULL
  `);
  console.log(`[backfill] A1 legacy_direct: populated ${a1.rowCount} rows`);

  const a2 = await pool.query(`
    UPDATE events_v2 v SET flashscore_id = e_fs.flashscore_id, updated_at = now()
    FROM events e_oa
    JOIN events e_fs ON e_fs.canonical_id = e_oa.canonical_id AND e_fs.flashscore_id IS NOT NULL
    WHERE e_oa.external_id = 'odds-api:' || v.odds_api_id::text
      AND v.flashscore_id IS NULL
  `);
  console.log(`[backfill] A2 canonical_chain: populated ${a2.rowCount} rows`);
}

async function stepB(): Promise<void> {
  console.log("[backfill] Step B — search endpoint" + (BACKFILL_LIMIT ? ` (LIMIT ${BACKFILL_LIMIT})` : ""));
  const rows = await pool.query(`
    SELECT id, odds_api_id, sport_slug, starts_at, home, away, status
    FROM events_v2
    WHERE flashscore_id IS NULL
    ORDER BY
      CASE status WHEN 'live' THEN 0 WHEN 'pending' THEN 1 ELSE 9 END,
      starts_at ASC
    ${BACKFILL_LIMIT ? `LIMIT ${BACKFILL_LIMIT}` : ""}
  `);
  console.log(`[backfill] Step B queue size: ${rows.rowCount}`);

  const limit = pLimit(1);
  let matched = 0, noMatch = 0, errors = 0, idx = 0;

  await Promise.all(
    rows.rows.map((r) =>
      limit(async () => {
        idx++;
        if (idx % 100 === 0) {
          console.log(`[backfill] progress ${idx}/${rows.rowCount} matched=${matched} no_match=${noMatch} errors=${errors}`);
        }
        try {
          const matchId = await resolveFlashscoreId(
            { odds_api_id: r.odds_api_id, sport_slug: r.sport_slug, starts_at: new Date(r.starts_at), home: r.home, away: r.away },
            { db, searchUrl: process.env.FS_SEARCH_URL!, apiKey: process.env.FS_SEARCH_API_KEY!, log }
          );
          if (matchId) {
            await pool.query(`UPDATE events_v2 SET flashscore_id = $1, updated_at = now() WHERE id = $2 AND flashscore_id IS NULL`, [matchId, r.id]);
            matched++;
          } else {
            noMatch++;
          }
        } catch (err) {
          errors++;
          console.error(`[backfill] error on ${r.odds_api_id}:`, err);
        }
        await new Promise((res) => setTimeout(res, 1000));
      })
    )
  );

  console.log(`[backfill] Step B complete: matched=${matched} no_match=${noMatch} errors=${errors}`);
}

(async () => {
  const t0 = Date.now();
  try {
    await stepA();
    await stepB();
    const cov = await pool.query(`SELECT count(*) FILTER (WHERE flashscore_id IS NOT NULL) AS pop, count(*) AS tot FROM events_v2`);
    const { pop, tot } = cov.rows[0];
    console.log(`[backfill] FINAL coverage: ${pop}/${tot} (${((pop / tot) * 100).toFixed(1)}%) in ${Math.round((Date.now() - t0) / 1000)}s`);
  } finally {
    await pool.end();
  }
})();
