import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local","utf8");
for (const line of env.split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,""); }
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});

const flipTime = "2026-05-08T14:47:46Z";

// Get enrichment rows post-flip
const { data: enrRows, error } = await supa
  .from("event_enrichment")
  .select("event_v2_id, sport_slug, last_endpoint_status")
  .gte("last_synced_at", flipTime);
if (error) { console.error(error); process.exit(1); }

// Lookup events_v2.status for each event_v2_id (chunked)
const ids = [...new Set(enrRows.map(r=>r.event_v2_id))];
const idToStatus = new Map();
for (let i=0; i<ids.length; i+=200) {
  const chunk = ids.slice(i, i+200);
  const { data: evs } = await supa.from("events_v2").select("id, status").in("id", chunk);
  for (const e of evs ?? []) idToStatus.set(e.id, e.status);
}

const statusToTier = (s) => {
  if (s === "live") return "live";
  if (s === "pending") return "prematch";
  if (s === "settled") return "finished";
  return "other";
};

// Aggregate: byEndpoint[ep][sport][tier] = { ok, total }
const allEndpoints = ["stats","lineups","incidents","momentum","shotmap","best_players","highlights","comments","votes","featured_players"];
const data = {};
for (const ep of allEndpoints) data[ep] = {};

const tierCount = {};

for (const r of enrRows) {
  const sport = r.sport_slug || "unknown";
  const tier = statusToTier(idToStatus.get(r.event_v2_id));
  const k = `${sport}|${tier}`;
  tierCount[k] = (tierCount[k] || 0) + 1;
  const st = r.last_endpoint_status || {};
  for (const ep of allEndpoints) {
    if (!data[ep][sport]) data[ep][sport] = {};
    if (!data[ep][sport][tier]) data[ep][sport][tier] = { ok:0, total:0 };
    const e = st[ep];
    if (!e) continue;
    data[ep][sport][tier].total++;
    if (e.ok === true) data[ep][sport][tier].ok++;
  }
}

console.log("=== Sample sizes per (sport, tier) ===");
const sortedKeys = Object.keys(tierCount).sort((a,b)=>tierCount[b]-tierCount[a]);
for (const k of sortedKeys) console.log(`  ${k.padEnd(28)} ${tierCount[k]}`);
console.log();

// Sports list ordered by total
const sportTotals = {};
for (const k of sortedKeys) { const [s] = k.split("|"); sportTotals[s] = (sportTotals[s]||0) + tierCount[k]; }
const sportsSorted = Object.keys(sportTotals).sort((a,b)=>sportTotals[b]-sportTotals[a]);

const tiers = ["prematch","live","finished"];
for (const tier of tiers) {
  console.log(`\n=== TIER: ${tier.toUpperCase()} — % OK per (sport, endpoint) ===`);
  let header = "sport".padEnd(20) + "rows ".padEnd(7) + allEndpoints.map(ep => ep.slice(0,8).padStart(8)).join(" ");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const s of sportsSorted) {
    const sample = (data["votes"][s]?.[tier]?.total) || 0;
    if (sample < 3) continue;  // skip too-small samples
    let line = s.padEnd(20) + String(sample).padEnd(7);
    for (const ep of allEndpoints) {
      const c = data[ep][s]?.[tier];
      if (!c || c.total === 0) { line += "      —  "; continue; }
      const pct = Math.round(100 * c.ok / c.total);
      line += `   ${String(pct).padStart(3)}% `;
    }
    console.log(line);
  }
}
