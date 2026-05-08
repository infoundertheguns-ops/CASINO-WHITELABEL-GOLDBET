import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local","utf8");
for (const line of env.split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["'"]|["'"]$/g,""); }
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const {data,error} = await supa.from("events_v2").select("*").eq("status","live").limit(1);
if(error){console.log("ERR",error.message);process.exit(1);}
console.log(Object.keys(data[0]||{}).join("\n"));
