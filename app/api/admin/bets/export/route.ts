import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveBetsScope } from "@/lib/admin/bets-permissions";
import { buildBetsListPostgrest } from "@/lib/admin/bets-list-query";
import type { BetsListFilters } from "@/lib/types/bets-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_ROWS = 10000;

function parseFilters(sp: URLSearchParams): BetsListFilters {
  // Same parser as list route — duplicated here intentionally to avoid coupling
  const num = (k: string) => { const v = sp.get(k); return v ? Number(v) : undefined; };
  const bool = (k: string) => { const v = sp.get(k); return v == null ? undefined : v === "true" || v === "1"; };
  return {
    status: (sp.get("status") as any) || "all",
    from: sp.get("from") || undefined,
    to: sp.get("to") || undefined,
    kiosk_id: sp.get("kiosk_id") || undefined,
    user_id: sp.get("user_id") || undefined,
    sport: sp.get("sport") || undefined,
    min_stake: num("min_stake"),
    max_stake: num("max_stake"),
    is_live: bool("is_live"),
    risk_min: num("risk_min"),
    risk_max: num("risk_max"),
    search: sp.get("search") || undefined,
    sort: "created_at", dir: "desc", limit: MAX_ROWS, offset: 0,
  };
}

function csvEscape(v: any): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: NextRequest) {
  try {
    const cookieStore = cookies();
    let sbToken: string | undefined;
    for (const c of cookieStore.getAll()) {
      if (c.name.startsWith("sb-") && c.name.includes("-auth-token")) {
        try { const p = JSON.parse(c.value); if (p?.access_token) { sbToken = p.access_token; break; } }
        catch { if (c.value.startsWith("eyJ")) { sbToken = c.value; break; } }
      }
    }
    if (!sbToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sb = createAdminClient();
    const { data: userData } = await sb.auth.getUser(sbToken);
    const userId = userData?.user?.id;
    if (!userId) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

    let scope;
    try { scope = await resolveBetsScope(sb, userId); }
    catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }

    const filters = parseFilters(req.nextUrl.searchParams);

    // Count first to enforce MAX_ROWS
    const countQuery = buildBetsListPostgrest(sb, filters, scope).select("id", { count: "exact", head: true });
    const { count } = await countQuery;
    if ((count ?? 0) > MAX_ROWS) {
      return NextResponse.json(
        { error: `Export limited to ${MAX_ROWS} rows. Narrow your filters (current match: ${count}).` },
        { status: 422 }
      );
    }

    const { data, error } = await buildBetsListPostgrest(sb, filters, scope).range(0, MAX_ROWS - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const headers = ["id","created_at","username","kiosk_code","agent_code","bet_type","stake","total_odds","potential_win","actual_win","status","risk_score","selections_count"];
    const rows = (data ?? []).map((r: any) => [
      r.id,
      r.created_at,
      r.user?.username ?? "",
      r.kiosk?.code ?? "",
      r.kiosk?.agent?.code ?? "",
      r.bet_type,
      r.stake,
      r.total_odds ?? "",
      r.potential_win ?? "",
      r.actual_win ?? "",
      r.status,
      r.risk_score ?? 0,
      r.selections_count ?? 0,
    ].map(csvEscape).join(","));

    const csv = [headers.join(","), ...rows].join("\n");
    const ts = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="bets-${ts}.csv"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
