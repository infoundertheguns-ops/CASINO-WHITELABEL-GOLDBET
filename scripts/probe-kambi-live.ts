#!/usr/bin/env tsx
/**
 * Probe Kambi live endpoints to answer Q3:
 * - Does /event/live/open.json + /betoffer/event/{id}.json exhaust markets for live event?
 * - Does an alternate endpoint exist (e.g. /live/event/{id}.json)?
 * - Does operator set affect live market count?
 *
 * Usage: tsx scripts/probe-kambi-live.ts
 */

const BASE_URL = "https://eu-offering-api.kambicdn.com/offering/v2018";
const OPERATORS = ["888it", "unibet", "ub"];
const LANG = "it_IT";
const MARKET = "IT";

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.log(`  HTTP ${res.status}: ${url.split("?")[0]}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    console.log(`  ERR: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

function buildUrl(operator: string, path: string, extra?: Record<string, string>) {
  const u = new URL(`${BASE_URL}/${operator}/${path}`);
  u.searchParams.set("lang", LANG);
  u.searchParams.set("market", MARKET);
  if (extra) for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u.toString();
}

interface LiveEvent {
  event: { id: number; name: string; sport: string; group: string; state: string };
  liveData?: { matchClock?: { minute: number; period: string } };
}
interface LiveResp {
  liveEvents: LiveEvent[];
}

interface BetOfferResp {
  betOffers: { id: number; criterion: { id: number; label: string }; outcomes: { id: number }[] }[];
  events?: unknown[];
}

async function main() {
  console.log("═══ KAMBI LIVE PROBE ═══\n");

  // Step 1: Get live events per operator — pick a top football match
  console.log("── Step 1: Fetch live events per operator ──");
  const liveByOp: Record<string, LiveEvent[]> = {};
  for (const op of OPERATORS) {
    const url = buildUrl(op, "event/live/open.json");
    const resp = await fetchJson<LiveResp>(url);
    const evs = resp?.liveEvents || [];
    const football = evs.filter((e) => e.event.sport?.toLowerCase().includes("football"));
    liveByOp[op] = football;
    console.log(`  ${op.padEnd(10)} → ${evs.length} live events total (${football.length} football)`);
  }

  // Pick a match that's live on 888it and preferably a top-league one
  const candidates = liveByOp["888it"] || [];
  if (candidates.length === 0) {
    console.log("\n⚠️  No live football matches on 888it right now. Trying tennis as fallback.");
    for (const op of OPERATORS) {
      const resp = await fetchJson<LiveResp>(buildUrl(op, "event/live/open.json"));
      const tennis = (resp?.liveEvents || []).filter((e) =>
        e.event.sport?.toLowerCase().includes("tennis")
      );
      liveByOp[op] = tennis;
      console.log(`  ${op.padEnd(10)} → ${tennis.length} live tennis events`);
    }
  }

  const sample = (liveByOp["888it"].length > 0 ? liveByOp["888it"] : liveByOp["unibet"]).slice(0, 3);
  if (sample.length === 0) {
    console.log("\n❌ No live events at all across operators. Re-run during active hours.");
    return;
  }

  console.log("\n── Step 2: Probe betoffers for each sampled event across operators ──");

  for (const le of sample) {
    console.log(
      `\n── Event ${le.event.id}: ${le.event.name} [${le.event.group}] ──`
    );

    // For each operator, try the standard betoffer endpoint + a few alternates
    for (const op of OPERATORS) {
      const standard = buildUrl(op, `betoffer/event/${le.event.id}.json`, {
        includeParticipants: "true",
      });
      const r = await fetchJson<BetOfferResp>(standard);
      const n = r?.betOffers?.length || 0;
      const outcomes = (r?.betOffers || []).reduce(
        (acc, bo) => acc + (bo.outcomes?.length || 0),
        0
      );
      console.log(
        `  [${op.padEnd(8)}] /betoffer/event/{id}.json           → ${n.toString().padStart(3)} markets, ${outcomes} outcomes`
      );

      // Try with includePrematch/includeLive hints that sometimes exist
      const withHints = buildUrl(op, `betoffer/event/${le.event.id}.json`, {
        includeParticipants: "true",
        includePrematchBetOffers: "true",
      });
      const r2 = await fetchJson<BetOfferResp>(withHints);
      const n2 = r2?.betOffers?.length || 0;
      if (n2 !== n) {
        console.log(
          `  [${op.padEnd(8)}] ↑ with includePrematchBetOffers       → ${n2} markets`
        );
      }

      // Try the alternate live endpoint
      const altLive = buildUrl(op, `event/${le.event.id}/live.json`, {
        includeParticipants: "true",
      });
      const rLive = await fetchJson<BetOfferResp>(altLive);
      if (rLive !== null) {
        const nL = rLive?.betOffers?.length || 0;
        console.log(
          `  [${op.padEnd(8)}] /event/{id}/live.json (alternate)    → ${nL} markets`
        );
      }

      // Check listView/live variant
      // (not per-event, but worth confirming existence)

      await new Promise((res) => setTimeout(res, 400));
    }
  }

  // Step 3: compare one match's prematch vs live market surface conceptually
  // (We can only observe live now — the "prematch was 200, live is 15" claim comes from the spec;
  // our probe verifies we're hitting full API surface per operator.)
  console.log("\n── Step 4: Market criterion breakdown for first sample ──");
  const e = sample[0];
  for (const op of OPERATORS) {
    const r = await fetchJson<BetOfferResp>(
      buildUrl(op, `betoffer/event/${e.event.id}.json`, { includeParticipants: "true" })
    );
    if (!r?.betOffers) continue;
    const labels = new Map<string, number>();
    for (const bo of r.betOffers) {
      const key = `${bo.criterion.id}:${bo.criterion.label}`;
      labels.set(key, (labels.get(key) || 0) + 1);
    }
    console.log(`\n  [${op}] market criteria for event ${e.event.id}:`);
    [...labels.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([k, v]) => console.log(`    ${v.toString().padStart(3)}× ${k}`));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
