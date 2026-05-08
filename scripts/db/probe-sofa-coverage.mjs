import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local","utf8");
for (const line of env.split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["'"]|["'"]$/g,""); }
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});

// 1. event_enrichment schema
const {data: eeOne, error: eeErr} = await supa.from("event_enrichment").select("*").limit(1);
console.log("=== event_enrichment columns ===");
if (eeErr) console.log("ERR", eeErr.message);
else console.log(eeOne[0] ? Object.keys(eeOne[0]).join(", ") : "EMPTY TABLE");

// 2. event_enrichment counts per sport (joined via events_v2)
const since = new Date(Date.now()-24*3600_000).toISOString();
const {data: events, error: evErr} = await supa.from("events_v2").select("id, sport_slug, status, sofascore_id, flashscore_id").gte("starts_at",since).in("status",["live","settled"]);
if (evErr) { console.log("ERR ev", evErr.message); process.exit(1); }
const bySport = {};
for (const ev of events) {
  const s = ev.sport_slug;
  if (!bySport[s]) bySport[s] = { total:0, fs:0, sofa:0, both:0 };
  bySport[s].total++;
  if (ev.flashscore_id) bySport[s].fs++;
  if (ev.sofascore_id) bySport[s].sofa++;
  if (ev.flashscore_id && ev.sofascore_id) bySport[s].both++;
}
console.log("\n=== Source binding per sport (last 24h, live+settled) ===");
console.log(JSON.stringify(bySport, null, 2));

// 3. event_enrichment sample row showing actual structured payload
const sofaIds = events.filter(e=>e.sofascore_id).slice(0,5).map(e=>e.sofascore_id);
console.log("\n=== SofaScore IDs to inspect (first 5 with binding) ===", sofaIds);
if (sofaIds.length) {
  const {data: enrichRows, error: enrErr} = await supa.from("event_enrichment").select("*").in("sofascore_id", sofaIds);
  if (enrErr) console.log("ERR enr", enrErr.message);
  else {
    console.log("\n=== event_enrichment rows for those ===");
    for (const r of enrichRows ?? []) {
      const summary = {};
      for (const [k,v] of Object.entries(r)) {
        if (v === null || v === undefined) summary[k] = "null";
        else if (Array.isArray(v)) summary[k] = `array[${v.length}]`;
        else if (typeof v === "object") summary[k] = `obj{${Object.keys(v).join(",")}}`;
        else if (typeof v === "string" && v.length > 60) summary[k] = `str[${v.length}]`;
        else summary[k] = v;
      }
      console.log(JSON.stringify(summary));
    }
  }
}

// 4. enrichment count per sport
const {data: allEnrich, error: aeErr} = await supa.from("event_enrichment").select("sofascore_id");
if (!aeErr && allEnrich) console.log("\n=== Total event_enrichment rows ===", allEnrich.length);
