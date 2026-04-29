export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// GET  /api/admin/market-catalog
//   ?action=groups&q=...&limit=...         — search groups
//   ?action=outcomes&g=<G>                 — all outcomes for a group
//   ?action=stats                          — totals + last sync timestamp
//   ?action=normalization&source=&q=       — normalization rows (future editor)
// POST /api/admin/market-catalog           — upsert normalization row
// POST /api/admin/market-catalog?action=sync — trigger sync (admin only)

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const action = sp.get("action") || "groups";
  const supabase = createAdminClient();

  try {
    // ─── E4: explorer endpoints ─────────────────────────────

    if (action === "sports") {
      // Distinct sports available in events table with active/prematch/live event count.
      const { data, error } = await supabase
        .from("sports")
        .select("id, slug, name")
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return NextResponse.json({ sports: data ?? [] });
    }

    if (action === "events") {
      // Events for a sport with flashscore_id present (unified key).
      // Used by Market Explorer sport→event dropdown.
      const sportId = sp.get("sport_id");
      const limit = Math.min(200, Math.max(10, Number(sp.get("limit") ?? 80)));
      if (!sportId) return NextResponse.json({ error: "sport_id required" }, { status: 400 });
      const { data, error } = await supabase
        .from("events")
        .select("id, home_team, away_team, starts_at, flashscore_id, source, status")
        .eq("sport_id", sportId)
        .not("flashscore_id", "is", null)
        .in("status", ["prematch", "live"])
        .order("starts_at", { ascending: true })
        .limit(limit);
      if (error) throw error;
      // Dedup by flashscore_id (same event across sources → one card)
      const seen = new Set<string>();
      const rows: Array<{ flashscore_id: string; home_team: string; away_team: string; starts_at: string; sources: string[] }> = [];
      const bySrc: Record<string, Set<string>> = {};
      for (const e of data ?? []) {
        const key = e.flashscore_id as string;
        if (!key) continue;
        if (!bySrc[key]) bySrc[key] = new Set();
        bySrc[key].add(e.source as string);
        if (!seen.has(key)) {
          seen.add(key);
          rows.push({ flashscore_id: key, home_team: e.home_team, away_team: e.away_team, starts_at: e.starts_at, sources: [] });
        }
      }
      for (const r of rows) r.sources = Array.from(bySrc[r.flashscore_id] ?? []).sort();
      return NextResponse.json({ events: rows });
    }

    if (action === "event_markets") {
      // For a flashscore_id, return markets grouped by canonical_key with odds from all 3 sources.
      // Shape: [{ canonical_key, canonical_name_it, outcomes: [{name, kambi_odds, twobet_odds, betfair_odds}] }]
      const flashscoreId = sp.get("flashscore_id");
      if (!flashscoreId) return NextResponse.json({ error: "flashscore_id required" }, { status: 400 });

      // 1) Collect event_ids for all sources matching this flashscore_id.
      const { data: eventRows, error: evErr } = await supabase
        .from("events")
        .select("id, source")
        .eq("flashscore_id", flashscoreId);
      if (evErr) throw evErr;
      const eventIds = (eventRows ?? []).map((e) => e.id);
      if (eventIds.length === 0) return NextResponse.json({ markets: [] });

      // 2) Fetch active markets + outcomes for those events (bounded by limit to protect DB).
      const { data: marketRows, error: mkErr } = await supabase
        .from("markets")
        .select("id, event_id, source, market_type, handicap, period, is_active, outcomes(id, name, odds, line, is_active, is_suspended)")
        .in("event_id", eventIds)
        .eq("is_active", true)
        .limit(1500);
      if (mkErr) throw mkErr;

      // 3) Map source_market_type → canonical_key via market_normalization.
      const distinctTypes = Array.from(new Set((marketRows ?? []).map((m: any) => `${m.source}::${m.market_type}`)));
      const normMap: Record<string, { canonical_key: string | null; canonical_name_it: string | null }> = {};
      if (distinctTypes.length > 0) {
        const { data: normRows } = await supabase
          .from("market_normalization")
          .select("source, source_market_type, canonical_key, canonical_name_it")
          .in("source_market_type", Array.from(new Set((marketRows ?? []).map((m: any) => m.market_type as string))));
        for (const nr of normRows ?? []) {
          normMap[`${nr.source}::${nr.source_market_type}`] = {
            canonical_key: nr.canonical_key,
            canonical_name_it: nr.canonical_name_it,
          };
        }
      }

      // 4) Group markets by canonical_key (fallback to raw market_type if no canonical).
      type CanonicalBucket = {
        canonical_key: string;
        canonical_name_it: string;
        period: string | null;
        handicap: number | null;
        outcomes: Record<string, { kambi: number | null; twobet: number | null; betfair: number | null }>;
      };
      const buckets: Record<string, CanonicalBucket> = {};
      for (const m of marketRows ?? []) {
        const norm = normMap[`${m.source}::${m.market_type}`] ?? { canonical_key: null, canonical_name_it: null };
        const ck = norm.canonical_key ?? `raw:${m.market_type}`;
        const groupKey = `${ck}|${m.handicap ?? ""}|${m.period ?? ""}`;
        if (!buckets[groupKey]) {
          buckets[groupKey] = {
            canonical_key: ck,
            canonical_name_it: norm.canonical_name_it ?? m.market_type,
            period: m.period,
            handicap: m.handicap,
            outcomes: {},
          };
        }
        const b = buckets[groupKey];
        for (const o of m.outcomes ?? []) {
          if (o.is_active === false) continue;
          const outName = (o.name as string)?.trim();
          if (!outName) continue;
          if (!b.outcomes[outName]) b.outcomes[outName] = { kambi: null, twobet: null, betfair: null };
          const col = m.source === "kambi" ? "kambi" : m.source === "22bet" ? "twobet" : m.source === "betfair" ? "betfair" : null;
          if (col) b.outcomes[outName][col] = Number(o.odds);
        }
      }

      return NextResponse.json({
        flashscore_id: flashscoreId,
        markets: Object.values(buckets).map((b) => ({
          canonical_key: b.canonical_key,
          canonical_name_it: b.canonical_name_it,
          period: b.period,
          handicap: b.handicap,
          outcomes: Object.entries(b.outcomes).map(([name, odds]) => ({ name, ...odds })),
        })),
      });
    }

    // ─── Existing actions ───────────────────────────────────

    if (action === "stats") {
      const [g, o, n, lastSync, sports] = await Promise.all([
        supabase.from("twobet_market_groups").select("twobet_g", { count: "exact", head: true }),
        supabase.from("twobet_market_outcomes").select("twobet_t", { count: "exact", head: true }),
        supabase.from("market_normalization").select("id", { count: "exact", head: true }),
        supabase.from("system_config").select("value").eq("key", "last_twobet_catalog_sync").single(),
        supabase.from("mv_twobet_sport_catalog_summary").select("sport_slug, sport_name, groups_used").order("groups_used", { ascending: false }),
      ]);
      let last: any = null;
      try { last = lastSync?.data?.value ? JSON.parse(lastSync.data.value) : null; } catch {}
      return NextResponse.json({
        groups: g.count ?? 0,
        outcomes: o.count ?? 0,
        normalization_rows: n.count ?? 0,
        last_sync: last,
        sports: sports.data ?? [],
      });
    }

    if (action === "outcomes") {
      const g = Number(sp.get("g"));
      if (!Number.isFinite(g)) return NextResponse.json({ error: "g required" }, { status: 400 });
      const { data, error } = await supabase
        .from("twobet_market_outcomes")
        .select("twobet_t, twobet_g, name_template_it")
        .eq("twobet_g", g)
        .order("twobet_t");
      if (error) throw error;
      return NextResponse.json({ rows: data ?? [] });
    }

    if (action === "normalization") {
      const source = sp.get("source");
      const q = sp.get("q");
      let qb = supabase.from("market_normalization").select("*").order("source").order("source_market_type").limit(500);
      if (source) qb = qb.eq("source", source);
      if (q) qb = qb.ilike("source_market_type", `%${q}%`);
      const { data, error } = await qb;
      if (error) throw error;
      return NextResponse.json({ rows: data ?? [] });
    }

    // default: groups (optionally filtered by sport)
    const q = sp.get("q");
    const sport = sp.get("sport");
    const limit = Math.min(500, Math.max(10, Number(sp.get("limit") ?? 200)));

    if (sport) {
      // Join mv to restrict to groups observed in the given sport.
      const { data: used, error: usedErr } = await supabase
        .from("mv_twobet_group_sports")
        .select("twobet_g, name_it")
        .eq("sport_slug", sport)
        .limit(1000);
      if (usedErr) throw usedErr;
      const gids = (used ?? []).map(r => r.twobet_g);
      if (gids.length === 0) return NextResponse.json({ rows: [] });
      let qb = supabase
        .from("twobet_market_groups")
        .select("twobet_g, name_it, outcome_count, updated_at")
        .in("twobet_g", gids)
        .order("outcome_count", { ascending: false })
        .limit(limit);
      if (q) qb = qb.ilike("name_it", `%${q}%`);
      const { data, error } = await qb;
      if (error) throw error;
      return NextResponse.json({ rows: data ?? [] });
    }

    let qb = supabase
      .from("twobet_market_groups")
      .select("twobet_g, name_it, outcome_count, updated_at")
      .order("outcome_count", { ascending: false })
      .limit(limit);
    if (q) qb = qb.ilike("name_it", `%${q}%`);
    const { data, error } = await qb;
    if (error) throw error;
    return NextResponse.json({ rows: data ?? [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const action = sp.get("action");

  if (action === "sync") {
    // Legacy sync proxy removed (cron sync-twobet-catalog deleted in T3 cleanup).
    return NextResponse.json({ error: "sync action no longer supported" }, { status: 410 });
  }

  // Upsert normalization row
  const body = await req.json().catch(() => null);
  if (!body?.source || !body?.source_market_type) {
    return NextResponse.json({ error: "source + source_market_type required" }, { status: 400 });
  }
  const supabase = createAdminClient();
  const { error } = await supabase.from("market_normalization").upsert(
    {
      source: body.source,
      source_market_type: body.source_market_type,
      canonical_key: body.canonical_key ?? null,
      canonical_name_it: body.canonical_name_it ?? null,
      notes: body.notes ?? null,
      verified: !!body.verified,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "source,source_market_type" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
