// Sample live_data shape per sport from events_v2 (status=live).
// For each sport: count events, key presence pct, 1 sample row.
// Run on admin-vps where @supabase/supabase-js + .env.local exist.
//
//   /root/.nvm/versions/node/v22.22.1/bin/node scripts/db/sample-live-data.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// minimal .env.local loader (no dotenv dep)
const env = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("missing SUPABASE env");

const supa = createClient(url, key, { auth: { persistSession: false } });

const SPORTS = [
  "football",
  "basketball",
  "tennis",
  "baseball",
  "handball",
  "volleyball",
  "darts",
  "cricket",
  "rugby",
  "esports",
];

function leafKeys(obj, prefix = "", out = new Set()) {
  if (obj === null || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) {
      out.add(`${path}[]`);
      if (v.length > 0 && typeof v[0] === "object" && v[0] !== null) leafKeys(v[0], `${path}[0]`, out);
    } else if (v !== null && typeof v === "object") {
      out.add(`${path}{}`);
      leafKeys(v, path, out);
    } else {
      out.add(path);
    }
  }
  return out;
}

const report = {};
for (const sport of SPORTS) {
  // Last 12h of activity (live now + recently settled) — gives us samples
  // for sports that aren't live at this moment.
  const since = new Date(Date.now() - 12 * 3600_000).toISOString();
  const { data, error, count } = await supa
    .from("events_v2")
    .select("id, sport_slug, home, away, starts_at, status, score_home, score_away, live_data, flashscore_id, period, minute, period_scores", { count: "exact" })
    .eq("sport_slug", sport)
    .in("status", ["live", "settled"])
    .gte("starts_at", since)
    .not("live_data", "is", null)
    .order("starts_at", { ascending: false })
    .limit(8);

  if (error) {
    report[sport] = { error: error.message };
    continue;
  }

  const events = data ?? [];
  const total = count ?? 0;

  // Per-key presence: how many rows have each top-level key non-empty
  const keyPresence = {};
  for (const ev of events) {
    const ld = ev.live_data ?? {};
    for (const k of Object.keys(ld)) {
      const v = ld[k];
      const present = v !== null && v !== undefined && (Array.isArray(v) ? v.length > 0 : (typeof v === "object" ? Object.keys(v).length > 0 : true));
      if (!keyPresence[k]) keyPresence[k] = { present: 0, empty: 0 };
      if (present) keyPresence[k].present += 1;
      else keyPresence[k].empty += 1;
    }
  }

  // Sample: take first event with the richest live_data (most non-empty keys)
  let sample = null;
  let sampleScore = -1;
  for (const ev of events) {
    const ld = ev.live_data ?? {};
    let score = 0;
    for (const v of Object.values(ld)) {
      if (Array.isArray(v) && v.length > 0) score += 1;
      else if (v !== null && typeof v === "object" && Object.keys(v).length > 0) score += 1;
      else if (v !== null && v !== undefined && v !== "") score += 0.5;
    }
    if (score > sampleScore) { sampleScore = score; sample = ev; }
  }

  // Schema (leaf keys) of richest sample
  const schema = sample ? Array.from(leafKeys(sample.live_data)).sort() : [];

  report[sport] = {
    live_total: total,
    sampled: events.length,
    fs_bound: events.filter(e => e.flashscore_id).length,
    keyPresence,
    schema,
    sample: sample ? {
      home: sample.home,
      away: sample.away,
      score: `${sample.score_home ?? "?"}-${sample.score_away ?? "?"}`,
      period: sample.period,
      minute: sample.minute,
      starts: sample.starts_at,
      flashscore_id: sample.flashscore_id,
      live_data: sample.live_data,
    } : null,
  };
}

console.log(JSON.stringify(report, null, 2));
