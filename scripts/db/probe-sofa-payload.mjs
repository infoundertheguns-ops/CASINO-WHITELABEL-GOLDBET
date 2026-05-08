import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local","utf8");
for (const line of env.split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["'"]|["'"]$/g,""); }
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});

// total enrichment rows + per sport
const {data: allEnrich, error: aeErr} = await supa.from("event_enrichment").select("sport_slug,stats,lineups,incidents,momentum,shotmap,best_players,highlights,comments,votes,featured_players,last_endpoint_status").limit(500);
if(aeErr){console.log("ERR",aeErr.message);process.exit(1);}
console.log("=== Total enrichment rows fetched ===", allEnrich.length);

const COLS = ["stats","lineups","incidents","momentum","shotmap","best_players","highlights","comments","votes","featured_players"];
const bySport = {};
for (const r of allEnrich) {
  const s = r.sport_slug || "unknown";
  if (!bySport[s]) { bySport[s] = { total:0 }; for (const c of COLS) bySport[s][c]=0; }
  bySport[s].total++;
  for (const c of COLS) {
    const v = r[c];
    const present = v!=null && (Array.isArray(v) ? v.length>0 : (typeof v==="object" ? Object.keys(v).length>0 : true));
    if (present) bySport[s][c]++;
  }
}
console.log("\n=== Coverage per sport (presence non-empty) ===");
for (const [sport, c] of Object.entries(bySport)) {
  const pct = (n) => `${n}/${c.total} (${Math.round(n/c.total*100)}%)`;
  console.log(`${sport.padEnd(12)} N=${c.total}  stats=${pct(c.stats)}  lineups=${pct(c.lineups)}  incidents=${pct(c.incidents)}  shotmap=${pct(c.shotmap)}  bestp=${pct(c.best_players)}  momentum=${pct(c.momentum)}`);
}

// sample tennis enrichment row
console.log("\n=== Sample tennis enrichment ===");
const {data: tennisRow} = await supa.from("event_enrichment").select("*").eq("sport_slug","tennis").limit(1).maybeSingle();
if (tennisRow) {
  for (const k of COLS) {
    const v = tennisRow[k];
    if (v == null) console.log(`  ${k}: null`);
    else if (Array.isArray(v)) console.log(`  ${k}: array[${v.length}]${v[0]?" first="+JSON.stringify(v[0]).slice(0,150):""}`);
    else if (typeof v === "object") console.log(`  ${k}: obj keys=${Object.keys(v).join(",")}`);
    else console.log(`  ${k}: ${typeof v} ${String(v).slice(0,80)}`);
  }
  console.log("  last_endpoint_status:", JSON.stringify(tennisRow.last_endpoint_status));
}
