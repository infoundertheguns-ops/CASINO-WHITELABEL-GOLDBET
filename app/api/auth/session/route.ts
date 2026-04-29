export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth/admin-session";

export async function GET() {
  const s = await getAdminSession();
  if (!s) return NextResponse.json({}, { status: 401 });
  return NextResponse.json({
    adminUserId: s.adminUserId,
    role: s.role,
    username: s.username,
  });
}
