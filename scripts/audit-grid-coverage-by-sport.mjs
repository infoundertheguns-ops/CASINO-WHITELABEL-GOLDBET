#!/usr/bin/env node
// Audit per sport: top canonical_keys attivi per source (kambi vs 22bet)
// incrociato con ciò che la market grid del player si aspetta.
//
// Usage: node scripts/audit-grid-coverage-by-sport.mjs --target prod
//        node scripts/audit-grid-coverage-by-sport.mjs --target prod --sport calcio
//        node scripts/audit-grid-coverage-by-sport.mjs --target prod --json
//
// Output: per sport, tabella con canonical_key | kambi_markets | 22bet_markets
// + sample market_types per source (primi 3 raw types).

import pg from "pg";

const args = process.argv.slice(2).reduce((a, x, i, arr) => {
  if (x.startsWith("--")) a[x.replace(/^--/, "")] = arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true;
  return a;
}, {});
const target = args.target || "prod";
const slugFilter = typeof args.sport === "string" ? args.sport : null;
const jsonOut = args.json === true;

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
    host, port: 5432,
    user: `postgres.${p.projectRef}`,
    password: p.password,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
  });
  try { await c.connect(); client = c; if (!jsonOut) console.log(`connected via ${host} (${target})`); break; }
  catch { await c.end().catch(() => {}); }
}
if (!client) { console.error("no pool host connected"); process.exit(1); }

const q = async (sql, params = []) => (await client.query(sql, params)).rows;

// Bypass default pooler statement_timeout — heavy JOINs on markets × v_events_unified
await q("SET statement_timeout = 0");

// ── 1. Pick sports with at least one active market from either source ──
// Scope to live+prematch only to avoid scanning 80k+ ended events.
let sportsRows;
if (slugFilter) {
  // Skip the heavy summary when drilling into one sport
  sportsRows = await q(
    `SELECT id AS uuid, slug, name FROM sports WHERE slug = $1 OR lower(name) = lower($1)`,
    [slugFilter],
  );
} else {
  sportsRows = await q(`
    SELECT s.id AS uuid, s.slug, s.name,
           COUNT(*) FILTER (WHERE vu.source='kambi' AND m.is_active AND NOT m.is_suspended) AS kambi_markets,
           COUNT(*) FILTER (WHERE vu.source='22bet' AND m.is_active AND NOT m.is_suspended) AS twobet_markets,
           COUNT(DISTINCT vu.id) FILTER (WHERE vu.source='kambi') AS kambi_events,
           COUNT(DISTINCT vu.id) FILTER (WHERE vu.source='22bet') AS twobet_events
    FROM sports s
    JOIN v_events_unified vu ON vu.sport_id = s.id
    JOIN markets m ON m.event_id = vu.id
    WHERE (vu.is_live = true OR vu.status = 'prematch')
      AND m.is_active AND NOT m.is_suspended
    GROUP BY s.id, s.slug, s.name
    ORDER BY (COUNT(*)) DESC
  `);
}

const sports = sportsRows;

if (!jsonOut) {
  console.log("\n=== Sports with active markets (kambi + 22bet combined, ordered by volume) ===");
  console.table(sports.map(s => ({
    slug: s.slug,
    name: s.name,
    kambi_ev: Number(s.kambi_events),
    twobet_ev: Number(s.twobet_events),
    kambi_mkts: Number(s.kambi_markets),
    twobet_mkts: Number(s.twobet_markets),
  })));
}

const result = { target, generatedAt: new Date().toISOString(), sports: [] };

for (const sport of sports) {
  const rows = await q(`
    SELECT mn.canonical_key,
           COALESCE(cm.canonical_name_it, mn.canonical_key) AS name_it,
           COUNT(*) FILTER (WHERE vu.source='kambi' AND m.is_active AND NOT m.is_suspended) AS kambi_markets,
           COUNT(*) FILTER (WHERE vu.source='22bet' AND m.is_active AND NOT m.is_suspended) AS twobet_markets,
           (ARRAY_AGG(DISTINCT m.market_type) FILTER (WHERE vu.source='kambi'
             AND m.is_active AND NOT m.is_suspended))[1:3] AS kambi_samples,
           (ARRAY_AGG(DISTINCT m.market_type) FILTER (WHERE vu.source='22bet'
             AND m.is_active AND NOT m.is_suspended))[1:3] AS twobet_samples
    FROM markets m
    JOIN v_events_unified vu ON vu.id = m.event_id
    JOIN market_normalization mn
      ON mn.source = vu.source AND mn.source_market_type = m.market_type
    LEFT JOIN canonical_markets cm ON cm.canonical_key = mn.canonical_key
    WHERE vu.sport_id = $1
      AND (vu.is_live = true OR vu.status = 'prematch')
      AND m.is_active AND NOT m.is_suspended
      AND mn.canonical_key IS NOT NULL
    GROUP BY mn.canonical_key, cm.canonical_name_it
    HAVING (
      COUNT(*) FILTER (WHERE vu.source='kambi' AND m.is_active AND NOT m.is_suspended)
      + COUNT(*) FILTER (WHERE vu.source='22bet' AND m.is_active AND NOT m.is_suspended)
    ) > 0
    ORDER BY (
      COUNT(*) FILTER (WHERE vu.source='kambi' AND m.is_active AND NOT m.is_suspended)
      + COUNT(*) FILTER (WHERE vu.source='22bet' AND m.is_active AND NOT m.is_suspended)
    ) DESC
    LIMIT 50
  `, [sport.uuid]);

  const sportEntry = {
    slug: sport.slug,
    name: sport.name,
    canonicals: rows.map(r => ({
      canonical_key: r.canonical_key,
      name_it: r.name_it,
      kambi_markets: Number(r.kambi_markets),
      twobet_markets: Number(r.twobet_markets),
      kambi_samples: r.kambi_samples ?? [],
      twobet_samples: r.twobet_samples ?? [],
    })),
  };
  result.sports.push(sportEntry);

  if (!jsonOut) {
    console.log(`\n\n━━━━━━━━━━━━ ${sport.name.toUpperCase()} (slug: ${sport.slug}) ━━━━━━━━━━━━`);
    if (rows.length === 0) {
      console.log("  (no canonicalized markets)");
      continue;
    }
    console.table(sportEntry.canonicals.map(c => ({
      canonical_key: c.canonical_key,
      name_it: (c.name_it ?? "").slice(0, 30),
      kambi: c.kambi_markets,
      twobet: c.twobet_markets,
      kambi_sample: (c.kambi_samples[0] ?? "").slice(0, 30),
      twobet_sample: (c.twobet_samples[0] ?? "").slice(0, 30),
    })));
  }
}

if (jsonOut) {
  console.log(JSON.stringify(result, null, 2));
}

await client.end();
