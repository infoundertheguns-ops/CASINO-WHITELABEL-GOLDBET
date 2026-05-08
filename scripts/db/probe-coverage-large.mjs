import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local","utf8");
for (const line of env.split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["'"]|["'"]$/g,""); }
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const since = new Date(Date.now()-24*3600_000).toISOString();

const SPORTS = ["football","basketball","tennis","baseball","cricket","darts","handball","volleyball","rugby","esports"];
const result = {};
for (const sport of SPORTS) {
  const {data,error} = await supa.from("events_v2").select("league_name,live_data").eq("sport_slug",sport).in("status",["live","settled"]).gte("starts_at",since).not("live_data","is",null).limit(500);
  if(error){result[sport]={error:error.message};continue;}
  const total = data.length;
  let hasPeriods=0, hasMatchMeta=0, hasIncidents=0, hasStats=0;
  let mmFull=0, mmPartial=0, mmEmpty=0;
  let incFull=0, incPartial=0, incEmpty=0;
  let totalIncidents=0, incWithPlayer=0, incWithType=0;
  for (const ev of data) {
    const ld = ev.live_data || {};
    if (Array.isArray(ld.periods) && ld.periods.length>0) hasPeriods++;
    const mm = ld.matchMeta;
    if (mm && Object.keys(mm).length>0) {
      hasMatchMeta++;
      const richKeys = ["venue","town","referee","capacity","attendance"].filter(k=>mm[k]);
      if (richKeys.length>=3) mmFull++;
      else if (richKeys.length>=1) mmPartial++;
      else mmEmpty++;
    }
    const inc = ld.incidents;
    if (Array.isArray(inc) && inc.length>0) {
      hasIncidents++;
      let withPlayer=0;
      for (const i of inc) {
        totalIncidents++;
        if (i.player?.name) { incWithPlayer++; withPlayer++; }
        if (i.typeCode!=null) incWithType++;
      }
      const ratio = withPlayer/inc.length;
      if (ratio>=0.7) incFull++;
      else if (ratio>0) incPartial++;
      else incEmpty++;
    }
    const st = ld.stats;
    if (Array.isArray(st) && st.length>0) hasStats++;
    else if (st && typeof st==="object" && Object.keys(st).length>0) hasStats++;
  }
  result[sport] = {
    total,
    periods: `${hasPeriods}/${total} (${total?Math.round(hasPeriods/total*100):0}%)`,
    matchMeta: `${hasMatchMeta}/${total} (${total?Math.round(hasMatchMeta/total*100):0}%)`,
    matchMetaQuality: hasMatchMeta>0 ? `full=${mmFull} partial=${mmPartial} empty=${mmEmpty}` : "n/a",
    incidents: `${hasIncidents}/${total} (${total?Math.round(hasIncidents/total*100):0}%)`,
    incidentsQuality: hasIncidents>0 ? `full=${incFull} partial=${incPartial} empty=${incEmpty}, total_rows=${totalIncidents} player_named=${incWithPlayer}` : "n/a",
    stats: `${hasStats}/${total} (${total?Math.round(hasStats/total*100):0}%)`,
  };
}
console.log(JSON.stringify(result,null,2));
