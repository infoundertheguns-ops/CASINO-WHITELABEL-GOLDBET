import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local","utf8");
for (const line of env.split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,""); }
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});

// 1. column inventory
const { data: one } = await supa.from("event_enrichment").select("*").limit(1);
console.log("=== event_enrichment columns ===");
console.log(one[0] ? Object.keys(one[0]).join(", ") : "EMPTY");
console.log();

// 2. total rows + recency
const { count: total } = await supa.from("event_enrichment").select("*",{count:"exact",head:true});
const { data: recent } = await supa.from("event_enrichment").select("last_synced_at").order("last_synced_at",{ascending:false}).limit(5);
const { data: oldest } = await supa.from("event_enrichment").select("last_synced_at").order("last_synced_at",{ascending:true}).limit(1);
console.log("=== row count + freshness ===");
console.log("total rows:", total);
console.log("oldest last_synced_at:", oldest?.[0]?.last_synced_at);
console.log("most recent 5 last_synced_at:", recent?.map(r=>r.last_synced_at).join("\n  "));
console.log();

// 3. populated columns (10 endpoint outputs + last_endpoint_status)
const fields = ["stats","lineups","incidents","momentum","shotmap","best_players","highlights","comments","votes","featured_players"];
console.log("=== populated counts per endpoint field ===");
for (const f of fields) {
  const { count } = await supa.from("event_enrichment").select("*",{count:"exact",head:true}).not(f,"is",null);
  console.log(`  ${f.padEnd(18)} ${count}`);
}
console.log();

// 4. last_endpoint_status sample (most recent 10)
const { data: statusSample } = await supa.from("event_enrichment").select("sport_slug,last_synced_at,last_endpoint_status").order("last_synced_at",{ascending:false}).limit(10);
console.log("=== last_endpoint_status (10 most recent) ===");
for (const r of statusSample ?? []) {
  console.log(`  ${r.last_synced_at}  ${r.sport_slug?.padEnd(12)}  ${JSON.stringify(r.last_endpoint_status)}`);
}
console.log();

// 5. distribution by sport
const { data: bySport } = await supa.from("event_enrichment").select("sport_slug");
const sportCounts = {};
for (const r of bySport ?? []) sportCounts[r.sport_slug] = (sportCounts[r.sport_slug]||0)+1;
console.log("=== rows per sport ===");
console.log(Object.entries(sportCounts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`  ${k.padEnd(12)} ${v}`).join("\n"));

// 6. rows added/updated AFTER the env flip (14:47:46 UTC)
const flipTime = "2026-05-08T14:47:46Z";
const { count: postFlip } = await supa.from("event_enrichment").select("*",{count:"exact",head:true}).gte("last_synced_at", flipTime);
console.log(`\n=== rows synced AFTER flag flip (${flipTime}) ===`);
console.log("count:", postFlip);

// 7. Among post-flip rows, which fields are populated
console.log("\n=== post-flip populated counts per endpoint field ===");
for (const f of fields) {
  const { count } = await supa.from("event_enrichment").select("*",{count:"exact",head:true}).gte("last_synced_at", flipTime).not(f,"is",null);
  console.log(`  ${f.padEnd(18)} ${count}`);
}
