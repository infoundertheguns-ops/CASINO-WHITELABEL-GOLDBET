const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const envLines = fs.readFileSync(".env.local", "utf8").split("\n");
const env = {};
for (const l of envLines) { const [k,...v] = l.split("="); if (k && k.trim()) env[k.trim()] = v.join("=").trim(); }
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const userId = "5d5b2529-a42d-4f28-af35-5cc5f3a383f8";
const testBets = [
  { id: "6c428842", name: "TEST1 MULTI-WIN (3 legs, expected: WON)" },
  { id: "068b1014", name: "TEST2 MULTI-LOST (2 legs, expected: LOST)" },
  { id: "6abcbca7", name: "TEST3 MULTI-PARTIAL (3 legs, 1 prematch, expected: OPEN)" },
];
(async () => {
  for (const t of testBets) {
    const { data: bet } = await sb.from("bets").select("id, status, actual_win, settled_at, stake").ilike("id", t.id + "%").single();
    if (bet === null) { console.log(t.name + " NOT FOUND"); continue; }
    const { data: legs } = await sb.from("bet_selections")
      .select("result, odds_at_placement, markets(market_type), outcomes(name), events(home_team, away_team, score_home, score_away)")
      .eq("bet_id", bet.id);
    console.log("\n" + t.name);
    console.log("  Status:", bet.status, "| Win:", bet.actual_win, "| Settled:", bet.settled_at ? "YES" : "NO");
    for (const l of legs || []) {
      console.log("  Leg:", l.events.home_team, l.events.score_home + "-" + l.events.score_away, l.events.away_team,
        "|", l.markets.market_type, "->", l.outcomes.name, "@" + l.odds_at_placement, "->", l.result || "PENDING");
    }
  }
  const { data: w } = await sb.from("wallets").select("balance").eq("user_id", userId).single();
  console.log("\nWallet AFTER:", w.balance, "(was 11846.09, diff: +" + (w.balance - 11846.09).toFixed(2) + ")");
  const { data: txs } = await sb.from("transactions").select("type, amount, description").eq("user_id", userId).order("created_at", { ascending: false }).limit(5);
  console.log("\nRecent transactions:");
  for (const tx of txs || []) console.log(" ", tx.type, tx.amount, "—", tx.description);
})();
