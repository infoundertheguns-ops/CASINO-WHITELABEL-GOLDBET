export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminSession } from "@/lib/auth/admin-session";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const { code } = await params;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("kiosk_vouchers")
    .select(`
      id, code, amount, status, created_at, redeemed_at, notes,
      kiosk:kiosks(id, code, name),
      redeemed_admin:admin_users!kiosk_vouchers_redeemed_by_fkey(id, username)
    `)
    .eq("code", code.trim().toUpperCase())
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json(data);
}
