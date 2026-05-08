import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local","utf8");
for (const line of env.split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,""); }
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});

// Window: events that started or will start within today/yesterday
const since = new Date(Date.now() - 24*3600_000).toISOString();
const until = new Date(Date.now() + 48*3600_000).toISOString();

const { data: rows, error, count } = await supa
  .from("events_v2")
  .select("id, sport_slug, status, home, away, flashscore_id, sofascore_id", { count:"exact" })
  .gte("starts_at", since).lt("starts_at", until)
  .neq("status","cancelled");

if (error) { console.error(error); process.exit(1); }

console.log(`=== Total events_v2 in window [${since}, ${until}] non-cancelled: ${rows.length} ===\n`);

// 4-way breakdown per sport: total, only_fs, only_sofa, both, neither
const bySport = {};
for (const r of rows) {
  const s = r.sport_slug || "unknown";
  if (!bySport[s]) bySport[s] = { total:0, only_fs:0, only_sofa:0, both:0, neither:0 };
  bySport[s].total++;
  const hasFs = !!r.flashscore_id;
  const hasSo = !!r.sofascore_id;
  if (hasFs && hasSo) bySport[s].both++;
  else if (hasFs) bySport[s].only_fs++;
  else if (hasSo) bySport[s].only_sofa++;
  else bySport[s].neither++;
}

console.log("Sport               total  both  only_fs only_sofa  neither   coverage");
console.log("-".repeat(75));
let totals = { total:0, only_fs:0, only_sofa:0, both:0, neither:0 };
const sortedSports = Object.keys(bySport).sort((a,b)=>bySport[b].total-bySport[a].total);
for (const s of sortedSports) {
  const c = bySport[s];
  totals.total += c.total; totals.only_fs += c.only_fs; totals.only_sofa += c.only_sofa;
  totals.both += c.both; totals.neither += c.neither;
  const cov = Math.round(100*(c.both+c.only_fs+c.only_sofa)/c.total);
  console.log(`${s.padEnd(20)} ${String(c.total).padStart(4)}  ${String(c.both).padStart(4)}  ${String(c.only_fs).padStart(6)}  ${String(c.only_sofa).padStart(8)}  ${String(c.neither).padStart(7)}     ${String(cov).padStart(3)}%`);
}
console.log("-".repeat(75));
const cov = Math.round(100*(totals.both+totals.only_fs+totals.only_sofa)/totals.total);
console.log(`${"TOTAL".padEnd(20)} ${String(totals.total).padStart(4)}  ${String(totals.both).padStart(4)}  ${String(totals.only_fs).padStart(6)}  ${String(totals.only_sofa).padStart(8)}  ${String(totals.neither).padStart(7)}     ${String(cov).padStart(3)}%`);

console.log(`\n=== Coverage summary ===`);
console.log(`Both FS+Sofa:    ${totals.both}/${totals.total} = ${Math.round(100*totals.both/totals.total)}% ⭐ (full coverage for settlement)`);
console.log(`Only FS:         ${totals.only_fs}/${totals.total} = ${Math.round(100*totals.only_fs/totals.total)}% (partial)`);
console.log(`Only Sofa:       ${totals.only_sofa}/${totals.total} = ${Math.round(100*totals.only_sofa/totals.total)}% (partial)`);
console.log(`Neither:         ${totals.neither}/${totals.total} = ${Math.round(100*totals.neither/totals.total)}% ⚠️ (only OddsAPI score available)`);

// Sample some events with neither — these are the gap
console.log(`\n=== Sample 10 events with NEITHER FS nor Sofa (target for matcher fix) ===`);
const neither = rows.filter(r => !r.flashscore_id && !r.sofascore_id).slice(0, 10);
for (const r of neither) {
  console.log(`  [${r.sport_slug.padEnd(18)}] ${r.status.padEnd(8)} ${r.home} vs ${r.away}`);
}

// Sample boxing/mma events specifically
console.log(`\n=== Sample boxing+mma events (any status) ===`);
const fights = rows.filter(r => r.sport_slug === "boxing" || r.sport_slug === "mma").slice(0, 15);
if (fights.length === 0) console.log("  (no boxing/mma events in window)");
for (const r of fights) {
  const tags = [];
  if (r.flashscore_id) tags.push("FS");
  if (r.sofascore_id) tags.push("Sofa");
  const tagStr = tags.length ? `[${tags.join("+")}]` : "[--]";
  console.log(`  ${tagStr.padEnd(12)} ${r.sport_slug.padEnd(8)} ${r.status.padEnd(8)} ${r.home} vs ${r.away}`);
}
