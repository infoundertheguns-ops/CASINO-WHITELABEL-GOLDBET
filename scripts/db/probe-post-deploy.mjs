import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local","utf8");
for (const line of env.split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,""); }
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});

const deployTime = "2026-05-08T16:45:48Z";

const { data: enrRows, error } = await supa
  .from("event_enrichment")
  .select("event_v2_id, sport_slug, last_endpoint_status")
  .gte("last_synced_at", deployTime);
if (error) { console.error(error); process.exit(1); }

console.log(`=== Sample size: ${enrRows.length} rows synced after deploy (${deployTime}) ===\n`);

const ids = [...new Set(enrRows.map(r=>r.event_v2_id))];
const idToStatus = new Map();
for (let i=0; i<ids.length; i+=200) {
  const chunk = ids.slice(i, i+200);
  const { data: evs } = await supa.from("events_v2").select("id, status").in("id", chunk);
  for (const e of evs ?? []) idToStatus.set(e.id, e.status);
}
const statusToTier = (s) => s === "live" ? "live" : s === "pending" ? "prematch" : s === "settled" ? "finished" : "other";

const allEndpoints = ["stats","lineups","incidents","momentum","shotmap","best_players","highlights","comments","votes","featured_players"];
// sport -> tier -> endpoint -> {ok, total, called}
const data = {};
const tierTotals = {};

for (const r of enrRows) {
  const sport = r.sport_slug || "unknown";
  const tier = statusToTier(idToStatus.get(r.event_v2_id));
  const k = `${sport}|${tier}`;
  tierTotals[k] = (tierTotals[k]||0)+1;
  const st = r.last_endpoint_status || {};
  data[sport] ??= {};
  data[sport][tier] ??= {};
  for (const ep of allEndpoints) {
    data[sport][tier][ep] ??= {ok:0, called:0};
    const e = st[ep];
    if (e === undefined) continue;  // not called → mapping took effect
    data[sport][tier][ep].called++;
    if (e.ok === true) data[sport][tier][ep].ok++;
  }
}

console.log("=== Sample sizes per (sport, tier) ===");
const sortedKeys = Object.keys(tierTotals).sort((a,b)=>tierTotals[b]-tierTotals[a]);
for (const k of sortedKeys) console.log(`  ${k.padEnd(28)} ${tierTotals[k]}`);
console.log();

const sportTotals = {};
for (const k of sortedKeys) { const [s] = k.split("|"); sportTotals[s] = (sportTotals[s]||0) + tierTotals[k]; }
const sportsSorted = Object.keys(sportTotals).sort((a,b)=>sportTotals[b]-sportTotals[a]);

for (const tier of ["prematch","live","finished"]) {
  const cellsForTier = sportsSorted.filter(s => (data[s]?.[tier] && tierTotals[`${s}|${tier}`] >= 3));
  if (cellsForTier.length === 0) continue;
  console.log(`\n=== POST-DEPLOY ${tier.toUpperCase()} — ok / called (skipped if endpoint not called per mapping) ===`);
  let header = "sport               n  ";
  for (const ep of allEndpoints) header += `${ep.slice(0,8).padStart(10)}`;
  console.log(header);
  console.log("-".repeat(header.length));
  for (const s of cellsForTier) {
    const n = tierTotals[`${s}|${tier}`];
    let line = `${s.padEnd(20)} ${String(n).padEnd(2)} `;
    for (const ep of allEndpoints) {
      const c = data[s][tier][ep];
      if (!c || c.called === 0) {
        line += "       —- ";  // never called → mapping working
      } else {
        const pct = Math.round(100 * c.ok / c.called);
        line += ` ${String(c.ok).padStart(3)}/${String(c.called).padStart(3)}(${String(pct).padStart(3)}%)`;
      }
    }
    console.log(line);
  }
}
console.log(`\nLegend: "—-" = endpoint not called per new sport-mapping. "X/Y(Z%)" = X ok / Y called.`);
