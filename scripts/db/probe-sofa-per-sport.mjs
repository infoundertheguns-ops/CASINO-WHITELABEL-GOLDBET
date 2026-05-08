import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local","utf8");
for (const line of env.split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,""); }
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});

const flipTime = "2026-05-08T14:47:46Z";

const { data: rows, error } = await supa
  .from("event_enrichment")
  .select("sport_slug, last_endpoint_status, last_synced_at")
  .gte("last_synced_at", flipTime);

if (error) { console.error(error); process.exit(1); }

console.log(`=== Sample size: ${rows.length} rows synced after flag flip ===\n`);

// shape: byEndpoint[endpoint][sport] = { ok, http200_payload_error, http404, http403, http_other, total }
const byES = {};
const allEndpoints = ["stats","lineups","incidents","momentum","shotmap","best_players","highlights","comments","votes","featured_players"];
for (const ep of allEndpoints) byES[ep] = {};

for (const r of rows) {
  const sport = r.sport_slug || "unknown";
  const st = r.last_endpoint_status || {};
  for (const ep of allEndpoints) {
    if (!byES[ep][sport]) byES[ep][sport] = { ok:0, http200_err:0, http404:0, http403:0, http0:0, http_other:0, total:0 };
    const e = st[ep];
    if (!e) continue;
    byES[ep][sport].total++;
    if (e.ok === true) byES[ep][sport].ok++;
    else if (e.http === 200) byES[ep][sport].http200_err++;
    else if (e.http === 404) byES[ep][sport].http404++;
    else if (e.http === 403) byES[ep][sport].http403++;
    else if (e.http === 0) byES[ep][sport].http0++;
    else byES[ep][sport].http_other++;
  }
}

// rows per sport (denominator)
const sportCount = {};
for (const r of rows) sportCount[r.sport_slug] = (sportCount[r.sport_slug]||0)+1;
const sportsSorted = Object.keys(sportCount).sort((a,b)=>sportCount[b]-sportCount[a]);

console.log("Sport row counts:");
for (const s of sportsSorted) console.log(`  ${s.padEnd(20)} ${sportCount[s]}`);
console.log();

// Per endpoint, table sport x ok%
console.log("=== % OK per (sport, endpoint) — only sports with >=5 rows ===\n");
const eligibleSports = sportsSorted.filter(s => sportCount[s] >= 5);

const header = "sport".padEnd(20) + allEndpoints.map(ep => ep.padStart(8)).join(" ");
console.log(header);
console.log("-".repeat(header.length));
for (const s of eligibleSports) {
  let line = s.padEnd(20);
  for (const ep of allEndpoints) {
    const c = byES[ep][s];
    if (!c || c.total === 0) { line += "      —  "; continue; }
    const pct = Math.round(100 * c.ok / c.total);
    line += `   ${String(pct).padStart(3)}% `;
  }
  console.log(line);
}

console.log("\n=== Detail breakdown (sport, endpoint) where total>=5 — only non-OK breakdown ===\n");
for (const s of eligibleSports) {
  console.log(`\n--- ${s} (${sportCount[s]} events) ---`);
  for (const ep of allEndpoints) {
    const c = byES[ep][s];
    if (!c || c.total < 5) continue;
    const okPct = Math.round(100*c.ok/c.total);
    if (okPct >= 95) continue; // skip pristine endpoints in this detail
    console.log(`  ${ep.padEnd(18)} total=${c.total} ok=${c.ok}(${okPct}%) http200_err=${c.http200_err} 404=${c.http404} 403=${c.http403} conn_err=${c.http0} other=${c.http_other}`);
  }
}
