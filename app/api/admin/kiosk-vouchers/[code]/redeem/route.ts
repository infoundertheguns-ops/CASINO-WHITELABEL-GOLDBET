export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminSession } from "@/lib/auth/admin-session";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const { code } = await params;
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("redeem_voucher", {
    p_code: code.trim().toUpperCase(),
    p_admin_id: session.adminUserId,
  });

  if (error) {
    // Map Postgres custom error codes to HTTP
    if (error.code === "P0002") return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    if (error.code === "P0003") return NextResponse.json({ error: "ALREADY_REDEEMED", detail: error.details }, { status: 409 });
    if (error.code === "P0004") return NextResponse.json({ error: "INVALID_STATUS", detail: error.details }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
