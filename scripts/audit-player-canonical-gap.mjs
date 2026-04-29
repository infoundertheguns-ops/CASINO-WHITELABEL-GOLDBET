#!/usr/bin/env node
// Quick audit: how many 22bet-only events are visible to the player
// via v_events_unified, and how many of their markets WOULD fall
// through the current GROUP_TO_MARKET_PATTERN regex dispatch if we
// didn't have canonical_key.
//
// Usage: node scripts/audit-player-canonical-gap.mjs --target prod

import pg from "pg";

const args = process.argv.slice(2).reduce((a, x, i, arr) => {
  if (x.startsWith("--")) a[x.replace(/^--/, "")] = arr[i + 1];
  return a;
}, {});
const target = args.target || "prod";
const PROJECTS = {
  staging: { projectRef: "bnabvfalytivjsrwqydo", password: "Veronihina2020@" },
  prod: { projectRef: "xgnyqkmugnfzhdveeqom", password: "2MQhskawT3I6XVKW" },
};
const p = PROJECTS[target];
if (!p) { console.error("invalid target"); process.exit(1); }

const hosts = [
  "aws-1-eu-central-1.pooler.supabase.com",
  "aws-0-eu-central-1.pooler.supabase.com",
  "aws-0-eu-west-1.pooler.supabase.com",
];
let client = null;
for (const host of hosts) {
  const c = new pg.Client({
    host,
    port: 5432,
    user: `postgres.${p.projectRef}`,
    password: p.password,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
  });
  try {
    await c.connect();
    client = c;
    console.log(`connected via ${host} (${target})`);
    break;
  } catch {
    await c.end().catch(() => {});
  }
}
if (!client) { console.error("no pool host connected"); process.exit(1); }

async function q(sql, params = []) {
  const r = await client.query(sql, params);
  return r.rows;
}

console.log("\n=== 1. Event-level source breakdown in v_events_unified ===");
const srcBreak = await q(`
  SELECT source, COUNT(*) AS n,
         SUM(CASE WHEN is_live THEN 1 ELSE 0 END) AS live,
         SUM(CASE WHEN status='prematch' THEN 1 ELSE 0 END) AS prematch
  FROM v_events_unified
  GROUP BY source
  ORDER BY n DESC
`);
console.table(srcBreak);

console.log("\n=== 2. Top 20 market_type strings from 22bet-only events (by count, is_active) ===");
const topMts = await q(`
  SELECT m.market_type, COUNT(*) AS n,
         COUNT(DISTINCT m.event_id) AS events,
         MAX(mn.canonical_key) AS example_canonical
  FROM markets m
  JOIN v_events_unified vu ON vu.id = m.event_id
  LEFT JOIN market_normalization mn
    ON mn.source = vu.source AND mn.source_market_type = m.market_type
  WHERE vu.source = '22bet' AND m.is_active = true AND m.is_suspended = false
  GROUP BY m.market_type
  ORDER BY n DESC
  LIMIT 20
`);
console.table(topMts);

console.log("\n=== 3. Canonical coverage on 22bet markets in v_events_unified ===");
const canCov = await q(`
  WITH classified AS (
    SELECT
      CASE WHEN mn.canonical_key IS NOT NULL THEN 'canonicalized' ELSE 'unmapped' END AS status,
      m.id AS market_id, m.event_id
    FROM markets m
    JOIN v_events_unified vu ON vu.id = m.event_id
    LEFT JOIN market_normalization mn
      ON mn.source = vu.source AND mn.source_market_type = m.market_type
    WHERE vu.source = '22bet' AND m.is_active = true
  )
  SELECT status, COUNT(*) AS markets, COUNT(DISTINCT event_id) AS events
  FROM classified
  GROUP BY status
`);
console.table(canCov);

console.log("\n=== 4. Top canonical_keys on 22bet events (what display columns we'd need) ===");
const topCanonicals = await q(`
  SELECT mn.canonical_key, COUNT(*) AS markets,
         COUNT(DISTINCT m.event_id) AS events,
         MAX(cm.canonical_name_it) AS name_it
  FROM markets m
  JOIN v_events_unified vu ON vu.id = m.event_id
  JOIN market_normalization mn
    ON mn.source = vu.source AND mn.source_market_type = m.market_type
  LEFT JOIN canonical_markets cm ON cm.canonical_key = mn.canonical_key
  WHERE vu.source = '22bet' AND m.is_active = true AND m.is_suspended = false
    AND mn.canonical_key IS NOT NULL
  GROUP BY mn.canonical_key
  ORDER BY markets DESC
  LIMIT 25
`);
console.table(topCanonicals);

console.log("\n=== 5. Same for Kambi (baseline for comparison) ===");
const topCanonicalsKambi = await q(`
  SELECT mn.canonical_key, COUNT(*) AS markets,
         COUNT(DISTINCT m.event_id) AS events
  FROM markets m
  JOIN v_events_unified vu ON vu.id = m.event_id
  JOIN market_normalization mn
    ON mn.source = vu.source AND mn.source_market_type = m.market_type
  WHERE vu.source = 'kambi' AND m.is_active = true AND m.is_suspended = false
    AND mn.canonical_key IS NOT NULL
  GROUP BY mn.canonical_key
  ORDER BY markets DESC
  LIMIT 15
`);
console.table(topCanonicalsKambi);

console.log("\n=== 6. 22bet event sample with markets count and canonical coverage ===");
const sampleEvents = await q(`
  SELECT vu.id, vu.home_team, vu.away_team, vu.starts_at, vu.is_live,
         COUNT(m.id) AS total_markets,
         COUNT(mn.canonical_key) AS canonical_markets
  FROM v_events_unified vu
  JOIN markets m ON m.event_id = vu.id AND m.is_active = true AND m.is_suspended = false
  LEFT JOIN market_normalization mn
    ON mn.source = vu.source AND mn.source_market_type = m.market_type
  WHERE vu.source = '22bet'
  GROUP BY vu.id, vu.home_team, vu.away_team, vu.starts_at, vu.is_live
  ORDER BY vu.is_live DESC, total_markets DESC
  LIMIT 10
`);
console.table(sampleEvents);

console.log("\n=== 7. country_code coverage on 22bet-only events (flag gap check) ===");
const countryCov = await q(`
  WITH c AS (
    SELECT CASE WHEN l.country IS NULL OR l.country = '' THEN 'missing' ELSE 'present' END AS status
    FROM v_events_unified vu
    LEFT JOIN leagues l ON l.id = vu.league_id
    WHERE vu.source = '22bet'
  )
  SELECT status, COUNT(*) AS events FROM c GROUP BY status
`);
console.table(countryCov);

console.log("\n=== 8. Live clock / period format check — 22bet live sample ===");
const liveSample = await q(`
  SELECT vu.home_team, vu.away_team, vu.minute, vu.period,
         vu.live_data->>'matchClock' AS clock_raw,
         vu.score_home, vu.score_away
  FROM v_events_unified vu
  WHERE vu.source = '22bet' AND vu.is_live = true
  LIMIT 5
`);
console.table(liveSample);

console.log("\n=== 9. Same Kambi live sample for contrast ===");
const liveKambi = await q(`
  SELECT vu.home_team, vu.away_team, vu.minute, vu.period,
         vu.live_data->>'matchClock' AS clock_raw,
         vu.score_home, vu.score_away
  FROM v_events_unified vu
  WHERE vu.source = 'kambi' AND vu.is_live = true
  LIMIT 5
`);
console.table(liveKambi);

await client.end();
