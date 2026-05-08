import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local","utf8");
for (const line of env.split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["'"]|["'"]$/g,""); }
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const since2h = new Date(Date.now()-2*3600_000).toISOString();
const since30m = new Date(Date.now()-30*60_000).toISOString();

const {data: r2h} = await supa.from("events_v2").select("sport_slug, sofascore_id").gte("updated_at", since2h).not("sofascore_id","is",null);
const {data: r30m} = await supa.from("events_v2").select("sport_slug, sofascore_id").gte("updated_at", since30m).not("sofascore_id","is",null);

const aggr = (rows) => { const o={}; for (const r of rows) o[r.sport_slug]=(o[r.sport_slug]||0)+1; return o; };
console.log("=== events updated last 2h with sofascore_id ===");
console.log(JSON.stringify(aggr(r2h), null, 2));
console.log("=== events updated last 30m with sofascore_id ===");
console.log(JSON.stringify(aggr(r30m), null, 2));

const {data: enrich} = await supa.from("event_enrichment").select("sport_slug, last_synced_at").gte("last_synced_at", since30m);
const aggrE = aggr((enrich||[]).map(r=>({sport_slug:r.sport_slug})));
console.log("=== event_enrichment rows synced last 30m ===");
console.log(JSON.stringify(aggrE, null, 2));
