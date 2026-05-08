import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local","utf8");
for (const line of env.split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["'"]|["'"]$/g,""); }
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const since = new Date(Date.now()-24*3600_000).toISOString();
const {data,error} = await supa.from("events_v2").select("sport_slug, status").gte("starts_at", since).not("live_data","is",null);
if(error){console.log("ERR",error.message);process.exit(1);}
const counts = {};
for (const r of data) {
  const k = r.sport_slug + "@" + r.status;
  counts[k] = (counts[k]||0)+1;
}
const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
for (const [k,v] of sorted) console.log(v, k);
