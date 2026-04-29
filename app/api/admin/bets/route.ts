import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveBetsScope } from "@/lib/admin/bets-permissions";
import { buildBetsListPostgrest } from "@/lib/admin/bets-list-query";
import type { BetsListFilters, BetsListResponse, BetListItem, BetStatus, BetType } from "@/lib/types/bets-admin";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseFilters(sp: URLSearchParams): BetsListFilters {
  const num = (k: string) => {
    const v = sp.get(k);
    return v != null && v !== "" ? Number(v) : undefined;
  };
  const bool = (k: string) => {
    const v = sp.get(k);
    if (v == null || v === "") return undefined;
    return v === "true" || v === "1";
  };
  return {
    status: (sp.get("status") as BetsListFilters["status"]) || "all",
    from: sp.get("from") || undefined,
    to: sp.get("to") || undefined,
    kiosk_id: sp.get("kiosk_id") || undefined,
    agent_id: sp.get("agent_id") || undefined,
    user_id: sp.get("user_id") || undefined,
    sport: sp.get("sport") || undefined,
    min_stake: num("min_stake"),
    max_stake: num("max_stake"),
    is_live: bool("is_live"),
    risk_min: num("risk_min"),
    risk_max: num("risk_max"),
    search: sp.get("search") || undefined,
    sort: (sp.get("sort") as BetsListFilters["sort"]) || "created_at",
    dir: (sp.get("dir") as BetsListFilters["dir"]) || "desc",
    limit: Math.min(200, num("limit") ?? 50),
    offset: num("offset") ?? 0,
  };
}

export async function GET(req: NextRequest) {
  try {
    // Resolve auth user from cookie session
    // Cookie is set by /api/auth/login as sb-{project_id}-auth-token.0 with JSON value
    const cookieStore = cookies();
    const allCookies = cookieStore.getAll();
    let sbToken: string | undefined;
    for (const c of allCookies) {
      if (c.name.startsWith("sb-") && c.name.includes("-auth-token")) {
        try {
          const parsed = JSON.parse(c.value);
          if (parsed?.access_token) { sbToken = parsed.access_token; break; }
        } catch {
          // plain token (old format)
          if (c.value.startsWith("eyJ")) { sbToken = c.value; break; }
        }
      }
    }
    if (!sbToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminSb = createAdminClient();
    // Resolve user via JWT
    const { data: userData } = await adminSb.auth.getUser(sbToken);
    const userId = userData?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    let scope;
    try {
      scope = await resolveBetsScope(adminSb, userId);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const filters = parseFilters(req.nextUrl.searchParams);

    // Build query
    const baseQuery = buildBetsListPostgrest(adminSb, filters, scope);

    // Fetch page
    const { data, error, count } = await baseQuery.range(filters.offset!, filters.offset! + filters.limit! - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Post-filter: search on username (since we couldn't include in PostgREST .or for nested FK)
    let rows = data ?? [];
    if (filters.search?.trim()) {
      const s = filters.search.trim().toLowerCase();
      rows = rows.filter((r: any) => {
        const u = r.user?.username?.toLowerCase() ?? "";
        const k = r.kiosk?.code?.toLowerCase() ?? "";
        const id = r.id?.toLowerCase() ?? "";
        return u.includes(s) || k.includes(s) || id.includes(s);
      });
    }

    // Map to BetListItem shape
    const bets: BetListItem[] = rows.map((r: any) => ({
      id: r.id,
      code: r.id.split("-")[0],
      user: { id: r.user?.id ?? r.user_id, username: r.user?.username ?? null },
      kiosk: r.kiosk ? { code: r.kiosk.code ?? null, name: r.kiosk.name ?? null } : null,
      agent: r.kiosk?.agent ? { code: r.kiosk.agent.code ?? null, name: r.kiosk.agent.name ?? null } : null,
      bet_type: r.bet_type as BetType,
      stake: Number(r.stake ?? 0),
      potential_win: r.potential_win != null ? Number(r.potential_win) : null,
      actual_win: r.actual_win != null ? Number(r.actual_win) : null,
      total_odds: r.total_odds != null ? Number(r.total_odds) : null,
      status: r.status as BetStatus,
      is_live: !!r.is_live,
      selections_count: r.selections_count ?? 0,
      risk_score: r.risk_score ?? 0,
      created_at: r.created_at,
      settled_at: r.settled_at,
    }));

    // Aggregates: separate query (fast — uses indexes on status + same scope).
    // For agent scope we must keep kiosk embedded as !inner so the
    // kiosk.agent_id filter actually restricts parent rows (chaining .select
    // replaces the previous select and would otherwise drop the embed).
    const aggSelect =
      scope === "all"
        ? "status, stake, actual_win"
        : "status, stake, actual_win, kiosk:kiosks!inner(agent_id)";
    const aggQuery = buildBetsListPostgrest(adminSb, { ...filters, sort: undefined, dir: undefined }, scope)
      .select(aggSelect, { count: "exact", head: false })
      .limit(50000); // safety; aggregates over up to 50k rows
    const { data: aggData } = await aggQuery;
    const all = aggData ?? [];
    const total_stake = all.reduce((s: number, r: any) => s + Number(r.stake ?? 0), 0);
    const total_payout = all.reduce((s: number, r: any) => s + Number(r.actual_win ?? 0), 0);
    const open_count = all.filter((r: any) => r.status === "open" || r.status === "pending_acceptance").length;
    const ggr_pct = total_stake > 0 ? Number((((total_stake - total_payout) / total_stake) * 100).toFixed(1)) : 0;

    const response: BetsListResponse = {
      bets,
      total: count ?? 0,
      aggregates: { total_stake, total_payout, ggr_pct, open_count },
    };

    return NextResponse.json(response);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
