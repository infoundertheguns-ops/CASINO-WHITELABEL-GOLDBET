import { createClient } from "@supabase/supabase-js";
const sb = createClient(
  "https://xgnyqkmugnfzhdveeqom.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhnbnlxa211Z25memhkdmVlcW9tIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTA3MDc2NSwiZXhwIjoyMDg2NjQ2NzY1fQ.-W_1CdyboKbNMvv2u8wXwAUhUUsDtezUuKs_NDTG9dc",
  { auth: { persistSession: false } }
);

console.log("=== Test 1: simple from(view) — no nested ===");
let r = await sb.from("v_player_events").select("id, source, home_team, away_team, v2_sport_slug").limit(5);
console.log("err:", r.error?.message ?? "ok");
console.log("rows:", r.data?.length);
if (r.data) r.data.forEach(e => console.log(" ", e.source, e.home_team, "v", e.away_team, e.v2_sport_slug));

console.log("\n=== Test 2: with sport+league joins ===");
r = await sb.from("v_player_events").select("id, source, home_team, sport:sports(slug,name)").limit(3);
console.log("err:", r.error?.message ?? "ok");
console.log("rows:", r.data?.length);
if (r.data) console.log(" sample:", JSON.stringify(r.data[0], null, 2));

console.log("\n=== Test 3: with markets(*, outcomes(*)) — the BIG QUESTION ===");
r = await sb.from("v_player_events").select("id, source, home_team, markets(id, name)").limit(3);
console.log("err:", r.error?.message ?? "ok");
console.log("rows:", r.data?.length);
if (r.data) console.log(" sample:", JSON.stringify(r.data[0]).substring(0, 300));
