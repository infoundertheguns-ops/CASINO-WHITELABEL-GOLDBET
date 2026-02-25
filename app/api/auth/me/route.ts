import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();

  if (!authUser) {
    return NextResponse.json({ user: null, wallet: null, isAdmin: false });
  }

  const [profileRes, walletRes, adminRes] = await Promise.all([
    supabase.from("users").select("*").eq("id", authUser.id).single(),
    supabase.from("wallets").select("*").eq("user_id", authUser.id).single(),
    supabase.from("admin_users").select("id").eq("user_id", authUser.id).single(),
  ]);

  return NextResponse.json({
    user: profileRes.data,
    wallet: walletRes.data,
    isAdmin: !!adminRes.data,
  });
}
