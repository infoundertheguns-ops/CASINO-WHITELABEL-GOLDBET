#!/usr/bin/env node
// scripts/mine-aliases.mjs
//
// Alias-mining tool — for each events_v2 row missing flashscore_id, try to
// find a likely FS counterpart using relaxed token-overlap scoring across
// today + tomorrow + yesterday FS feeds. Outputs candidate suggestions
// grouped by sport with a confidence score; you (or a future agent) curate
// them into flashscore-scraper/src/team-aliases.json or normalize.ts noise/reserve sets.
//
// Usage:
//   FS_NINJA_BASE=https://global.flashscore.ninja/2/x/feed \
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/mine-aliases.mjs [--limit 200] [--sport football]
//
// Output: stdout, grouped per sport, ranked by score desc.
// No DB writes. No alias file writes. Pure suggestions.

import { createClient } from "@supabase/supabase-js";

const FS_BASE = process.env.FS_NINJA_BASE ?? "https://global.flashscore.ninja/2/x/feed";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0",
  Accept: "*/*",
  "Accept-Language": "it-IT,it;q=0.9",
  Referer: "https://www.flashscore.it/",
  "x-fsign": "SW9D1eZo",
  Origin: "https://www.flashscore.it",
};

// Mirror the scraper's sport-id-map.json
const SPORT_ID = {
  football: 1,
  tennis: 2,
  basketball: 3,
  "ice-hockey": 4,
  "american-football": 5,
  baseball: 6,
  handball: 7,
  rugby: 8,
  volleyball: 12,
  cricket: 13,
  darts: 14,
  snooker: 15,
  boxing: 16,
  mma: 28,
  esports: 36,
};

const args = parseArgs(process.argv.slice(2));
const SPORT_FILTER = args.sport;
const LIMIT = Number(args.limit ?? 200);
const TIME_WINDOW_HOURS = Number(args.window ?? 4);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      out[k] = v;
    }
  }
  return out;
}

async function fetchFsFeed(sportId, dayOffset) {
  const url = `${FS_BASE}/f_${sportId}_${dayOffset}_3_it-it_1`;
  try {
    const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return "";
    return await r.text();
  } catch {
    return "";
  }
}

function parseAll(raw) {
  const out = [];
  if (!raw) return out;
  let curLeague = "";
  for (const item of raw.split("~")) {
    const fields = {};
    for (const f of item.split("¬")) {
      const i = f.indexOf("÷");
      if (i < 0) continue;
      const k = f.substring(0, i);
      const v = f.substring(i + 1);
      if (!(k in fields)) fields[k] = v;
    }
    if (fields.ZA && !fields.AA) {
      curLeague = fields.ZA;
      continue;
    }
    if (fields.AA && fields.AE && fields.AF) {
      const ts = parseInt(fields.AD, 10);
      out.push({
        matchId: fields.AA,
        home: fields.AE,
        away: fields.AF,
        ts: Number.isFinite(ts) ? ts : null,
        league: curLeague,
      });
    }
  }
  return out;
}

function tokens(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,()'"]/g, "")
    .split(/[\s\-/&]+/)
    .filter((t) => t.length >= 3);
}

const STOPWORDS = new Set([
  "fc", "ac", "cf", "sc", "afc", "cfc",
  "fk", "nk", "hnk", "kk", "ks", "bk", "ofk",
  "club", "team", "sport", "sports", "city",
]);

function discriminative(toks) {
  return toks.filter((t) => !STOPWORDS.has(t));
}

function overlapCount(a, b) {
  let n = 0;
  for (const t of a) if (b.includes(t)) n++;
  return n;
}

function scorePair(qH, qA, fsH, fsA) {
  const same = overlapCount(qH, fsH) + overlapCount(qA, fsA);
  const swap = overlapCount(qH, fsA) + overlapCount(qA, fsH);
  return Math.max(same, swap);
}

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const cutoff = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const future = new Date(Date.now() + 48 * 3600 * 1000).toISOString();

  let q = sb
    .from("events_v2")
    .select("id, sport_slug, home, away, starts_at, status")
    .is("flashscore_id", null)
    .in("status", ["pending", "live"])
    .gte("starts_at", cutoff)
    .lte("starts_at", future)
    .order("starts_at", { ascending: true })
    .limit(LIMIT);
  if (SPORT_FILTER) q = q.eq("sport_slug", SPORT_FILTER);
  const { data: targets, error } = await q;
  if (error) {
    console.error("DB error:", error.message);
    process.exit(1);
  }
  console.error(`Mining ${targets.length} unmatched events_v2 rows...`);

  // Group by sport for FS feed reuse
  const bySport = {};
  for (const r of targets) (bySport[r.sport_slug] ||= []).push(r);

  for (const [sport, evs] of Object.entries(bySport)) {
    const sid = SPORT_ID[sport];
    if (!sid) {
      console.log(`\n## ${sport}  (NOT MAPPED — skip)\n`);
      continue;
    }
    console.log(`\n## ${sport}  (${evs.length} events)`);

    // Fetch 3 day-slots once per sport
    const feeds = await Promise.all([-1, 0, 1].map((d) => fetchFsFeed(sid, d)));
    const fsAll = feeds.flatMap((raw) => parseAll(raw));
    console.log(`   FS pool: ${fsAll.length} events across [-1, 0, +1] day window`);

    const suggestions = [];
    const noCandidate = [];

    for (const ev of evs) {
      const evTs = new Date(ev.starts_at).getTime() / 1000;
      const qH = discriminative(tokens(ev.home));
      const qA = discriminative(tokens(ev.away));
      const inWin = fsAll.filter(
        (f) => f.ts && Math.abs(f.ts - evTs) <= TIME_WINDOW_HOURS * 3600
      );
      const ranked = inWin
        .map((f) => ({
          ...f,
          score: scorePair(qH, qA, discriminative(tokens(f.home)), discriminative(tokens(f.away))),
        }))
        .sort((a, b) => b.score - a.score);
      const top = ranked.slice(0, 3).filter((c) => c.score >= 1);
      if (top.length === 0) {
        noCandidate.push(ev);
      } else {
        suggestions.push({ ev, candidates: top });
      }
    }

    // Sort suggestions by best-candidate score desc (highest confidence first)
    suggestions.sort((a, b) => b.candidates[0].score - a.candidates[0].score);

    for (const { ev, candidates } of suggestions) {
      const top = candidates[0];
      const conf =
        top.score >= 4 ? "HIGH" : top.score >= 3 ? "MED" : top.score >= 2 ? "LOW" : "WEAK";
      console.log(
        `\n  [${conf} sc=${top.score}] ev_v2:  ${ev.home}  vs  ${ev.away}    @${ev.starts_at}`
      );
      for (const c of candidates) {
        console.log(`     → fs: ${c.home} vs ${c.away}    | ${c.league.substring(0, 50)}`);
      }
    }
    if (noCandidate.length > 0) {
      console.log(`\n  -- ${noCandidate.length} events with NO FS candidate (likely uncovered league):`);
      for (const ev of noCandidate.slice(0, 10))
        console.log(`     · ${ev.home}  vs  ${ev.away}  @${ev.starts_at}`);
      if (noCandidate.length > 10)
        console.log(`     ... ${noCandidate.length - 10} more`);
    }
  }

  console.log("\n\n# Curation guidance");
  console.log("# - HIGH/MED suggestions: review for inclusion in team-aliases.json");
  console.log("# - LOW/WEAK suggestions: probably distinct teams; review carefully");
  console.log("# - NO candidate: likely outside FS coverage (small / niche league)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
