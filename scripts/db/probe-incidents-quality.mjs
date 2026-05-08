import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local","utf8");
for (const line of env.split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["'"]|["'"]$/g,""); }
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const since = new Date(Date.now()-24*3600_000).toISOString();
const {data,error} = await supa.from("events_v2").select("id,home,away,league_name,status,live_data").eq("sport_slug","football").in("status",["live","settled"]).gte("starts_at",since).not("live_data","is",null).limit(200);
if(error){console.log("ERR",error.message);process.exit(1);}
let hasIncArr=0, totalIncidents=0, withPlayerName=0, withTypeCode=0;
const examples=[];
for(const ev of data){
  const inc=ev.live_data?.incidents;
  if(!Array.isArray(inc) || inc.length===0) continue;
  hasIncArr++;
  for(const i of inc){
    totalIncidents++;
    if(i.player?.name) withPlayerName++;
    if(i.typeCode!=null) withTypeCode++;
  }
  if(examples.length<3 && inc.some(i=>i.player?.name)) examples.push({league:ev.league_name, home:ev.home, away:ev.away, sample: inc.find(i=>i.player?.name)});
}
console.log(JSON.stringify({totalEvents:data.length, eventsWithIncidents:hasIncArr, totalIncidentRows:totalIncidents, withPlayerName, withTypeCode, examples},null,2));
