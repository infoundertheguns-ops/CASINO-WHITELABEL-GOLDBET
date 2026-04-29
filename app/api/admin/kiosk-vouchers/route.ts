export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminSession } from "@/lib/auth/admin-session";

export async function GET(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const status = sp.get("status"); // 'pending' | 'redeemed' | 'all'
  const limit = Math.min(parseInt(sp.get("limit") || "100", 10), 500);

  const supabase = createAdminClient();
  let q = supabase
    .from("kiosk_vouchers")
    .select(`
      id, code, amount, status, created_at, redeemed_at, notes,
      kiosk:kiosks(id, code, name),
      redeemed_admin:admin_users!kiosk_vouchers_redeemed_by_fkey(id, username)
    `)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status && status !== "all") {
    q = q.eq("status", status);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // KPI aggregates
  const [{ count: pendingCount }, { data: todayRedeemed }] = await Promise.all([
    supabase.from("kiosk_vouchers").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase
      .from("kiosk_vouchers")
      .select("amount")
      .eq("status", "redeemed")
      .gte("redeemed_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
  ]);
  const todayAmount = (todayRedeemed ?? []).reduce((s: number, v: any) => s + Number(v.amount), 0);

  return NextResponse.json({
    vouchers: data ?? [],
    kpi: {
      pending: pendingCount ?? 0,
      today_redeemed_count: (todayRedeemed ?? []).length,
      today_redeemed_amount: todayAmount,
    },
  });
}
